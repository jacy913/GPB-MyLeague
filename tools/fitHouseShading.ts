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
 * Two parameters are fitted here, both against settled games:
 *
 *   HOUSE_SHADE   how far the house line is pulled back toward even
 *   LINE_MARGIN   how far the run total is raised, in runs
 *
 * Both are chosen to sit just past the point where a flat strategy on the
 * published number stops making money. A shade that exactly cancels the edge
 * would leave a market with no risk, which is not a market either.
 *
 *   npx tsx tools/fitHouseShading.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters, getTeamRosterStrength } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { buildGameLine } from '../src/lib/mediaOdds';
import { buildTotalMarkets, TOTAL_LINE_CENTRE } from '../src/lib/mediaMarkets';
import { probabilityToAmerican } from '../src/lib/mediaOdds';
import { MEDIA_PROFILES } from '../src/data/media';
import { settleReturn, STARTING_BALANCE } from '../src/lib/wallet';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

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
      const strength = getTeamRosterStrength(state.teams, state.playerState, year);
      const values = [...strength.values()];
      const strengthMean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
      const strengthSd = Math.sqrt(
        values.reduce((s, v) => s + (v - strengthMean) ** 2, 0) / Math.max(1, values.length),
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
       * The model's OWN total, before the board touches it.
       *
       * Two things had to be undone here. An earlier version captured
       * houseLine, which already carries the centre factor and the margin, and
       * then swept both again on top -- so every candidate was double
       * transformed and the fit asked for a centre of 1.0 for a model it had
       * already shrunk to 0.89. The constant is divided back out below so the
       * sweep measures the raw model, and a centre of 0.89 in the output
       * reproduces exactly what ships.
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
        const scoreFor = (teamId: string) => ({
          hollis: scores.hollis.get(teamId) ?? 0.5,
          glorest: scores.glorest.get(teamId) ?? 0.5,
          sharply: scores.sharply.get(teamId) ?? 0.5,
        });
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

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${moneylines.length} moneyline games, ${totals.length} totals\n`);

  /* ---------------- house shade ---------------- */

  const clip = (p: number): number => Math.max(0.02, Math.min(0.98, p));

  /** House probability after shading the consensus toward even. */
  const shade = (consensus: number, amount: number, margin: number): number => {
    const pulled = 0.5 + (consensus - 0.5) * (1 - amount);
    const favourite = pulled >= 0.5;
    return clip(favourite ? pulled - margin / 2 : pulled + margin / 2);
  };

  console.log('1. HOUSE SHADE');
  console.log('   Flat $25 on the house favourite, full sample. The published consensus');
  console.log('   has a real edge in the middle bands, so shading has to remove that');
  console.log('   edge without making the house line a coin flip.\n');
  console.log('   shade   margin   bankroll   net      worst band   strongest side');
  const BANDS: Array<[number, number, string]> = [
    [0.60, 1.01, 'over 60%'],
    [0.55, 0.60, '55-60%'],
    [0.50, 0.55, '50-55%'],
  ];

  for (const amount of [0, 0.15, 0.25, 0.35, 0.45, 0.55]) {
    for (const margin of [0.045]) {
      let balance = STARTING_BALANCE;
      let bets = 0;
      const bandStats = BANDS.map(([lo, hi, label]) => ({ label, n: 0, hits: 0, posted: 0 }));
      const strongP: number[] = [];

      moneylines.forEach(({ consensus, hit }) => {
        const house = shade(consensus, amount, margin);
        // Price the side actually being backed. An earlier version computed the
        // away price but bet as though the pick were the favourite, which handed
        // the bettor a free side on every game and reported the house as
        // unbeatable even at a coin-flip line with a margin on it.
        const backAway = house >= 0.5;
        const price = probabilityToAmerican(backAway ? house : 1 - house);
        if (!Number.isFinite(price) || Math.abs(price) > 900) return;
        const won = backAway ? hit : !hit;
        if (balance >= 5) {
          balance -= 5;
          balance += settleReturn(5, price, won);
          bets += 1;
        }
        const backed = backAway ? house : 1 - house;
        const backedHit = won;
        if (backed >= 0.60) strongP.push(backed);
        BANDS.forEach(([lo, hi, label], i) => {
          if (backed >= lo && backed < hi) {
            bandStats[i].n += 1;
            if (backedHit) bandStats[i].hits += 1;
            bandStats[i].posted += backed;
          }
        });
      });

      const worst = bandStats.reduce((max, band) => {
        if (band.n < 40) return max;
        const actual = band.hits / band.n;
        const posted = band.posted / band.n;
        return Math.max(max, Math.abs(actual - posted));
      }, 0);
      const strongest = strongP.length
        ? probabilityToAmerican(strongP.reduce((s, p) => s + p, 0) / strongP.length)
        : 0;

      console.log(
        `   ${amount.toFixed(2).padStart(5)}${margin.toFixed(3).padStart(9)}` +
        `${String(Math.round(balance)).padStart(11)}` +
        `${(balance - STARTING_BALANCE >= 0 ? '+' : '') + Math.round(balance - STARTING_BALANCE)}`.padStart(8) +
        `${(worst * 100).toFixed(1).padStart(13)} pts` +
        `${String(strongest).padStart(18)}   (${bets} bets)`,
      );
    }
  }
  console.log('\n   A net of zero or slightly negative is the target. Deeply negative');
  console.log('   means the house has shaded so far that no bettor can act on it.');

  /* ---------------- total line margin ---------------- */

  console.log('\n2. RUN TOTAL MARGIN, in runs');

  // Why a mean-centred line is the wrong centre for this market.
  const sorted = totals.map((t) => t.actual).sort((a, b) => a - b);
  const meanTotal = sorted.reduce((s, v) => s + v, 0) / Math.max(1, sorted.length);
  const medianTotal = sorted[Math.floor(sorted.length / 2)];
  console.log(`   mean total   ${meanTotal.toFixed(3)}`);
  console.log(`   median total ${medianTotal}`);
  console.log(`   skew         ${(meanTotal - medianTotal).toFixed(3)} runs above the median`);
  console.log('\n   A game total is right-skewed, so a line at the MEAN sits well above');
  console.log('   the median and loses the over more often than not. That is not a');
  console.log('   margin effect at all, it is a level error, and it hands the under a');
  console.log('   standing profit on every game in the league. The line has to be');
  console.log('   centred where the outcome is actually even.\n');

  console.log('   Where is the over rate even, on the HALF-RUN grid the board posts?');
  console.log('   The grid matters: the line is quoted in half-runs, so a centre that');
  console.log('   is even in theory can land half a run away in practice, and that');
  console.log('   rounding error is itself a leak. The figure below is measured with');
  console.log('   the same rounding the market applies.\n');
  console.log('   centre   margin   over rate   bettor edge');
  const candidates = [0.84, 0.86, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 1.00];
  const margins = [0.15, 0.25, 0.35];
  // The target is the over rate a 0.25-run margin is worth, not simply even.
  // A game total's standard deviation is about three runs, so a quarter run is
  // roughly an eighth of a standard deviation and prices out near 0.46.
  const TARGET = 0.46;
  let best = { centre: 0, margin: 0, rate: 0, error: 9 };
  candidates.forEach((centre) => {
    margins.forEach((margin) => {
      let over = 0;
      totals.forEach(({ fair, actual }) => {
        const line = Math.round((fair * centre + margin) * 2) / 2;
        if (actual > line) over += 1;
      });
      const rate = over / Math.max(1, totals.length);
      const error = Math.abs(rate - TARGET);
      if (error < best.error) best = { centre, margin, rate, error };
      console.log(
        `   ${centre.toFixed(2).padStart(7)}${margin.toFixed(2).padStart(9)}` +
        `${rate.toFixed(4).padStart(13)}${(error * 100).toFixed(2).padStart(11)} pts`,
      );
    });
  });
  console.log(`\n   Target over rate ${TARGET.toFixed(2)}, for a 0.25 run margin on a 3-run spread.`);
  console.log(`   Best: centre ${best.centre}, margin ${best.margin}, over rate ${best.rate.toFixed(4)},` +
    ` ${(best.error * 100).toFixed(2)} points off.`);
  console.log('\n   The over rate only moves in steps here, because the half-run grid is');
  console.log('   coarse against a three-run spread. That quantisation is itself a');
  console.log('   residual: there is no line that lands on the target exactly, and the');
  console.log('   gap that remains is the best the grid allows. tools/checkTotalVig.ts');
  console.log('   measures what that residual is worth to a bettor.');
};

void main();
