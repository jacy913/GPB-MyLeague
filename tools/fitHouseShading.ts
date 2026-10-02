/**
 * Calibrating the HOUSE, which is a different job from calibrating the outlets.
 *
 * tools/fitMoneylineCalibration.ts showed why these have to be separated. The
 * three outlets' published prices are their opinion, and the opinion is the
 * point: Lined Sharply posts 0.78 on a game that has historically gone 0.53, and
 * that is not a bug to be smoothed away, it is the exploitable flaw the whole
 * betting layer is built on. Changing his slope would be correcting a character.
 *
 * But the HOUSE is not the average of the outlets' opinions. Averaging a
 * well-calibrated read with a badly calibrated one does not land in between --
 * Sharply's 0.78 drags the consensus up, so the house ends up long at 70% in a
 * band that historically pays 60%. A real book shades toward the centre, and
 * this fits how far.
 *
 * Every number in section 1 is measured on a book that actually charges. An
 * earlier version of this sweep ran while the moneyline's second side was the
 * negation of the first, which is arithmetically zero vig, so its "net" figures
 * were measuring a book paying out fair value on both sides and were worthless.
 * The vig is now applied to both sides as a multiplier, which is what buildGameLine
 * does.
 *
 *   npx tsx tools/fitHouseShading.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters, getTeamRosterStrength } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { buildGameLine, probabilityToAmerican } from '../src/lib/mediaOdds';
import { buildTotalMarkets, TOTAL_LINE_CENTRE } from '../src/lib/mediaMarkets';
import { HOUSE_MARGIN } from '../src/lib/markets';
import { MEDIA_PROFILES } from '../src/data/media';
import { type MediaId } from '../src/data/media';
import { settleReturn, STARTING_BALANCE } from '../src/lib/wallet';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;
const STAKE = 5;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

interface MoneylineSample { consensus: number; hit: boolean }
interface TotalSample { fair: number; actual: number }

const main = async (): Promise<void> => {
  const moneylines: MoneylineSample[] = [];
  const totals: TotalSample[] = [];

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const built = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year, seed: SEED, effectiveDate: `${year}-12-15`,
    });
    const playerState = built.playerState;
    const teams = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      playerState, year,
    );

    const manager = new SimulationManager({
      teams, games: buildSchedule(teams, year), playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });

    for (let guard = 0; guard < 220; guard += 1) {
      const slateDate = state.currentDate;
      const teamById = new Map(state.teams.map((t) => [t.id, t]));
      const { scores, spread } = buildMediaReads({
        teams: state.teams,
        players: state.playerState.players,
        battingRatings: state.playerState.battingRatings,
        pitchingRatings: state.playerState.pitchingRatings,
        battingStats: state.playerState.battingStats,
        pitchingStats: state.playerState.pitchingStats,
        playerState: state.playerState,
        seasonYear: year,
      });

      // Z-score the roster strength properly, exactly as the page does.
      const strength = getTeamRosterStrength(state.teams, state.playerState, year);
      const strengthValues = [...strength.values()];
      const strengthMean = strengthValues.reduce((s, v) => s + v, 0) / Math.max(1, strengthValues.length);
      const strengthSd = Math.sqrt(
        strengthValues.reduce((s, v) => s + (v - strengthMean) ** 2, 0) / Math.max(1, strengthValues.length),
      );

      const lines = buildTotalMarkets(
        state.games.filter((g) => g.date === slateDate && g.status !== 'completed'),
        {
          teams: state.teams, strength, strengthMean, strengthSd,
          hasSeasonOutput: state.teams.some((t) => t.wins + t.losses > 0),
        },
        teamById,
      );

      /*
       * The model's OWN total, before the board touches it. Capturing houseLine
       * instead would double-transform every candidate below, which is how an
       * earlier version of this tool came to want a centre of 1.0 for a model it
       * had already shrunk to 0.89. Dividing the constant back out means a
       * centre of TOTAL_LINE_CENTRE here reproduces exactly what ships.
       */
      const rawTotals = new Map(lines.map((l) => [
        l.key.replace('total:', ''),
        (MEDIA_PROFILES.reduce((sum, p) => sum + l.fair[p.id], 0) / MEDIA_PROFILES.length)
          / TOTAL_LINE_CENTRE,
      ]));

      const pending = state.games.filter((g) => g.date === slateDate).map((game) => {
        const away = teamById.get(game.awayTeam);
        const home = teamById.get(game.homeTeam);
        if (!away || !home) return null;
        /*
         * Derived from MEDIA_PROFILES rather than three hardcoded outlets. Widening
         * MediaId broke this literal in four tools at once; iterating the profile list
         * means the ninth forecaster needs no change here, and a missing outlet becomes a
         * neutral 0.5 rather than a hole.
         */
        /*
         * Derived from MEDIA_PROFILES rather than three hardcoded outlets. Widening
         * MediaId broke this literal in four tools at once; iterating the profile list
         * means the ninth forecaster needs no change here, and a missing outlet becomes a
         * neutral 0.5 rather than a hole.
         *
         * The return type is annotated because spreading an Object.fromEntries widens the
         * type to `{ [k: string]: number }` and silently stops satisfying
         * `Record<MediaId, number>`. That failure is caught at compile time here; it would
         * not be caught at runtime.
         */
        const scoreFor = (teamId: string): Record<MediaId, number> =>
          Object.fromEntries(
            MEDIA_PROFILES.map((profile) => [profile.id, scores[profile.id].get(teamId) ?? 0.5]),
          ) as Record<MediaId, number>;
        return buildGameLine({ game, away, home, awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread });
      }).filter((e): e is NonNullable<typeof e> => e !== null);

      state = await manager.run({ scope: 'day' });

      pending.forEach((line) => {
        const played = state.games.find((g) => g.gameId === line.gameId);
        if (!played || played.status !== 'completed') return;
        moneylines.push({ consensus: line.consensusProbability, hit: played.score.away > played.score.home });
        const fair = rawTotals.get(line.gameId);
        if (fair !== undefined) totals.push({ fair, actual: played.score.away + played.score.home });
      });
    }
  }

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${moneylines.length} moneyline games, ${totals.length} totals`);
  console.log(`house margin ${(HOUSE_MARGIN * 100).toFixed(1)}% on both sides\n`);

  /* ---------------- house shade ---------------- */

  console.log('1. HOUSE SHADE');
  console.log(`   Flat $${STAKE} on one side of every game, bankrolled, full sample.`);
  console.log('   Both strategies have to lose for the shade to be viable: a bettor with');
  console.log('   no edge at all, betting one side relentlessly, must not print money.\n');
  console.log('   shade   fav net   dog net   worst band   strongest side');

  const BANDS: Array<[number, number, string]> = [
    [0.60, 1.01, 'over 60%'],
    [0.55, 0.60, '55-60%'],
    [0.50, 0.55, '50-55%'],
  ];

  for (const amount of [0, 0.10, 0.20, 0.30, 0.40, 0.50]) {
    const bandStats = BANDS.map(([lo, hi, label]) => ({ label, n: 0, hits: 0, posted: 0 }));
    const strongP: number[] = [];
    const net = { fav: 0, dog: 0 };

    for (const mode of ['fav', 'dog'] as const) {
      let balance = STARTING_BALANCE;
      moneylines.forEach(({ consensus, hit }) => {
        // The house's own view: consensus pulled toward even, then margined on
        // BOTH sides. This is what buildGameLine now does.
        const pulled = 0.5 + (consensus - 0.5) * (1 - amount);
        const awayPrice = pulled * (1 + HOUSE_MARGIN);
        const homePrice = (1 - pulled) * (1 + HOUSE_MARGIN);
        if (awayPrice > 0.985 || homePrice > 0.985) return;
        if (balance < STAKE) return;

        const backAway = mode === 'fav' ? pulled >= 0.5 : pulled < 0.5;
        const price = probabilityToAmerican(backAway ? awayPrice : homePrice);
        if (!Number.isFinite(price) || Math.abs(price) > 900) return;
        const won = backAway ? hit : !hit;

        balance -= STAKE;
        balance += settleReturn(STAKE, price, won);

        if (mode === 'fav') {
          const backed = backAway ? awayPrice : homePrice;
          if (backed >= 0.60) strongP.push(backed);
          BANDS.forEach(([lo, hi, label], i) => {
            if (backed >= lo && backed < hi) {
              bandStats[i].n += 1;
              if (won) bandStats[i].hits += 1;
              bandStats[i].posted += backed;
            }
          });
        }
      });
      net[mode] = balance - STARTING_BALANCE;
    }

    const worst = bandStats.reduce((max, band) => {
      if (band.n < 40) return max;
      return Math.max(max, Math.abs(band.hits / band.n - band.posted / band.n));
    }, 0);
    const strongest = strongP.length
      ? probabilityToAmerican(strongP.reduce((s, p) => s + p, 0) / strongP.length)
      : 0;

    console.log(
      `   ${amount.toFixed(2).padStart(5)}` +
      `${((net.fav >= 0 ? '+' : '') + Math.round(net.fav)).padStart(10)}` +
      `${((net.dog >= 0 ? '+' : '') + Math.round(net.dog)).padStart(10)}` +
      `${(worst * 100).toFixed(1).padStart(12)} pts` +
      `${String(strongest).padStart(16)}`,
    );
  }

  console.log('\n   Viable = both columns negative. Worst band is how badly any single');
  console.log('   probability range is priced, which is what a bettor who shops for a');
  console.log('   band rather than a side would target. That number barely moves with');
  console.log('   the shade, because shading scales all bands together; closing it');
  console.log('   needs the slopes fixed, which would be correcting a character.');

  /* ---------------- total line centre ---------------- */

  console.log('\n2. RUN TOTAL CENTRE AND MARGIN');
  const sorted = totals.map((t) => t.actual).sort((a, b) => a - b);
  const meanTotal = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);
  const medianTotal = sorted[Math.floor(sorted.length / 2)];
  console.log(`   mean total ${meanTotal.toFixed(3)}, median ${medianTotal}`);
  console.log('   A game total is right-skewed, so the mean sits above the even-money');
  console.log('   point and a line posted there loses the over more often than not.\n');
  console.log('   centre  margin  over rate  gap from 0.46');
  const TARGET = 0.46;
  let best = { centre: 0, margin: 0, rate: 0, error: 9 };
  [0.86, 0.88, 0.90, 0.92, 0.94].forEach((centre) => {
    [0.15, 0.25, 0.35].forEach((margin) => {
      let over = 0;
      totals.forEach(({ fair, actual }) => {
        if (actual > Math.round((fair * centre + margin) * 2) / 2) over += 1;
      });
      const rate = over / Math.max(1, totals.length);
      const error = Math.abs(rate - TARGET);
      if (error < best.error) best = { centre, margin, rate, error };
      console.log(
        `   ${centre.toFixed(2).padStart(6)}${margin.toFixed(2).padStart(8)}` +
        `${rate.toFixed(4).padStart(11)}${((error * 100).toFixed(2) + ' pts').padStart(18)}`,
      );
    });
  });
  console.log(`\n   Best: centre ${best.centre}, margin ${best.margin}, over rate ${best.rate.toFixed(4)}.`);
  console.log(`   Shipping TOTAL_LINE_CENTRE = ${TOTAL_LINE_CENTRE}.`);
  console.log('   The over rate moves in steps because the half-run grid is coarse');
  console.log('   against a three-run spread; that quantisation is a residual the grid');
  console.log('   cannot avoid, and tools/checkTotalVig.ts measures what it is worth.');
};

void main();
