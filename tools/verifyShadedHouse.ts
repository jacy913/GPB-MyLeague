/**
 * Does the house hold up once it is shaded?
 *
 * tools/fitHouseShading.ts produced a table of candidate shades. This is the
 * other half: it takes one shade, applies it the way buildGameLine would, and
 * asks whether a bettor with no edge at all can profit by betting one side
 * relentlessly.
 *
 * The shade is a difficulty knob, and the honest thing is to report the whole
 * curve rather than pick a flattering point on it. A shade of zero leaves a
 * +EV underdog; a shade of one half turns the moneyline into a coin flip with
 * a vig, which is safe and dull. Somewhere in between is the interesting
 * region, and this shows where.
 *
 *   npx tsx tools/verifyShadedHouse.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { buildGameLine, probabilityToAmerican } from '../src/lib/mediaOdds';
import { HOUSE_MARGIN } from '../src/lib/markets';
import { settleReturn, STARTING_BALANCE } from '../src/lib/wallet';
import { type MediaId, MEDIA_PROFILES } from '../src/data/media';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const main = async (): Promise<void> => {
  const samples: Array<{ consensus: number; hit: boolean }> = [];

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
        samples.push({ consensus: line.consensusProbability, hit: played.score.away > played.score.home });
      });
    }
  }

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${samples.length} games\n`);

  /** Flat bet one side of every game at a flat stake, bankrolled. */
  const run = (shade: number, takeFavourite: boolean): { net: number; bets: number; peak: number } => {
    let balance = STARTING_BALANCE;
    let peak = STARTING_BALANCE;
    let bets = 0;
    samples.forEach(({ consensus, hit }) => {
      const pulled = 0.5 + (consensus - 0.5) * (1 - shade);
      const awayPrice = pulled * (1 + HOUSE_MARGIN);
      const homePrice = (1 - pulled) * (1 + HOUSE_MARGIN);
      if (awayPrice > 0.985 || homePrice > 0.985) return;
      if (balance < 5) return;
      const backAway = takeFavourite ? pulled >= 0.5 : pulled < 0.5;
      const price = probabilityToAmerican(backAway ? awayPrice : homePrice);
      if (!Number.isFinite(price) || Math.abs(price) > 900) return;
      balance -= 5;
      balance += settleReturn(5, price, backAway ? hit : !hit);
      bets += 1;
      peak = Math.max(peak, balance);
    });
    return { net: balance - STARTING_BALANCE, bets, peak };
  };

  console.log('FLAT STRATEGIES BY SHADE');
  console.log('Both sides must lose. A bettor with no edge betting one side');
  console.log('relentlessly is the floor on how good the book has to be.\n');
  console.log('  shade   fav net    dog net   worst side   both lose?');

  const SHADES = [0, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
  let firstViable: number | null = null;

  SHADES.forEach((shade) => {
    const fav = run(shade, true);
    const dog = run(shade, false);
    const bothLose = fav.net < 0 && dog.net < 0;
    if (bothLose && firstViable === null) firstViable = shade;
    console.log(
      `  ${shade.toFixed(2).padStart(5)}` +
      `${(fav.net >= 0 ? '+' : '') + Math.round(fav.net)}`.padStart(11) +
      `${(dog.net >= 0 ? '+' : '') + Math.round(dog.net)}`.padStart(11) +
      `${Math.max(fav.net, dog.net) >= 0 ? '   THE BETTOR' : '   house'}`.padStart(17) +
      `${bothLose ? '  yes' : '  NO'}   (${fav.bets} bets)`,
    );
  });

  console.log('\nWHAT THE SHADE COSTS THE SHARP BETTOR');
  console.log('A shade is only worth having if acting on a forecaster still pays.');
  console.log('The sharpest available signal is an outlet that disagrees with the');
  console.log('house, so this measures the best side available at each shade.\n');
  console.log('  shade   best single side edge per bet');

  [0, 0.15, 0.20, 0.25, 0.30].forEach((shade) => {
    // The theoretical best a bettor could do: know the true outcome rate for
    // each posted price and always take the best-priced side. This is an upper
    // bound no real bettor reaches, so it answers "is there still anything here".
    /*
     * Bucket by posted price and compare each bucket's realised hit rate to the
     * probability that was actually charged.
     *
     * The first version of this reported 0.00 points at every shade, which
     * looked like "the shade leaves nothing on the table" and was actually a
     * broken measurement: it took the MAXIMUM of the per-bucket gaps, so any
     * bucket that came in unlucky reported a negative gap and was silently
     * discarded, leaving only the zero buckets to compare. The honest statistic
     * is the best gap among buckets that actually cleared the sample floor, and
     * a negative maximum means the worst-priced band rather than the best.
     */
    const buckets = new Map<string, { n: number; hits: number; implied: number }>();
    samples.forEach(({ consensus, hit }) => {
      const pulled = 0.5 + (consensus - 0.5) * (1 - shade);
      const awayPrice = pulled * (1 + HOUSE_MARGIN);
      const homePrice = (1 - pulled) * (1 + HOUSE_MARGIN);
      if (awayPrice > 0.985 || homePrice > 0.985) return;
      const backAway = pulled >= 0.5;
      const price = probabilityToAmerican(backAway ? awayPrice : homePrice);
      if (!Number.isFinite(price) || Math.abs(price) > 900) return;
      const bucketKey = String(Math.round(price / 10) * 10);
      const bucket = buckets.get(bucketKey) ?? { n: 0, hits: 0, implied: 0 };
      bucket.n += 1;
      if (backAway ? hit : !hit) bucket.hits += 1;
      bucket.implied += backAway ? awayPrice : homePrice;
      buckets.set(bucketKey, bucket);
    });

    const rows = [...buckets.entries()]
      .filter(([, b]) => b.n >= 60)
      .map(([price, b]) => ({ price, n: b.n, gap: b.hits / b.n - b.implied / b.n }))
      .sort((a, b) => b.gap - a.gap);

    if (rows.length === 0) {
      console.log(`  ${shade.toFixed(2).padStart(5)}   no band had 60+ games`);
      return;
    }
    const bestRow = rows[0];
    const worstRow = rows[rows.length - 1];
    console.log(
      `  ${shade.toFixed(2).padStart(5)}   ` +
      `best ${(bestRow.gap * 100).toFixed(2).padStart(6)} pts at ${bestRow.price}   ` +
      `worst ${(worstRow.gap * 100).toFixed(2).padStart(6)} pts   ` +
      `(${rows.length} bands)`,
    );
  });
  console.log('\n  This is the edge in the best-priced band, ignoring everything a real');
  console.log('  bettor would have to know. It is a ceiling, not a strategy.');

  if (firstViable === null) {
    console.log('\n  No shade in this range beats both flat strategies.');
  } else {
    console.log(`\n  Lowest shade where both flat strategies lose: ${firstViable.toFixed(2)}`);
  }
};

void main();
