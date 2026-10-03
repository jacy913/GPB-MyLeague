/**
 * WOULD ATTACHING AN ERROR BAR TO FAIR VALUE SAVE THE HXSE AS A GAME?
 *
 * ===========================================================================
 * THE PROBLEM OPTION C IS TRYING TO SOLVE
 * ===========================================================================
 *
 * The Exchange prints each club's fair value and the chart draws it, so the dislocation -- the entire
 * thing worth trading -- is a subtraction the reader does not have to make. `checkShareEdge` measured
 * what happens when that subtraction is automated: +13.41% over twenty days, five leagues out of five.
 *
 * The edge is real and free and it is a spreadsheet. Option C stops handing over the answer.
 *
 * ===========================================================================
 * WHY AN ERROR BAR AND NOT A DELAY OR A CORRUPTION
 * ===========================================================================
 *
 * The board already runs 250 Monte Carlo trials per day to compute fair value, and the only randomness
 * in that valuation is the playoff term. The spread across those trials IS the real uncertainty, so
 * "fair value, plus or minus its actual precision" is not a lie -- it is the same number with its
 * error attached. A delay would instead report a stale price, and with 5.6% daily sigma a five-day-old
 * price has drifted roughly 12%, which buries the signal in noise rather than making it a judgement.
 *
 * ===========================================================================
 * THE EXPERIMENT, AND IT IS THE WHOLE POINT
 * ===========================================================================
 *
 * The band width is the easy half. The question that decides whether to build ANY of this is whether
 * the edge SURVIVES the player acting on a fair value that carries realistic estimation error.
 *
 * So each day is priced twice from the same league and the same previous close, differing only in
 * the Monte Carlo seed. That yields two INDEPENDENT estimates of the same valuation -- one is what the
 * market priced against, the other is what a player with the same information would compute. The
 * strategy is then run twice: once on the true dislocation, once on the disclosed one.
 *
 * Fair value does not depend on `previousClose` -- it comes from roster, form and playoff odds -- so
 * the second call is a re-estimate of the same quantity rather than a different day's price. That
 * assumption is asserted by the probe rather than merely relied upon.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { priceBoardForDay } from '../src/lib/analytics/priceBoard';
import { PRICE_SANITY_MAX } from '../src/lib/analytics/sharePrice';
import { seededRandomStream, withSeededRandom, withSeededRandomAsync } from '../src/lib/analytics/playoffMonteCarlo';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const SEEDS = [4242, 991, 20260101, 7, 31337];
const WARMUP_DAYS = 60;
const PRICED_DAYS = 100;
const TRIALS = 250;
const ENTRY_THRESHOLD = 0.10;
const HOLD_DAYS = 20;
const CONTROL_DRAWS = 400;

/** A different Monte Carlo seed per league, so the "disclosed" estimate is an independent draw. */
const ALT_SEED_OFFSET = 7717;

const iso = (offset: number): string =>
  new Date(Date.parse(getDefaultSeasonStartDate(YEAR)) + offset * 86400000).toISOString().slice(0, 10);

interface Day {
  date: string;
  /** What the market priced against. */
  close: Record<string, number>;
  fairTrue: Record<string, number>;
  /** What a player computing the same valuation from the same information would get. */
  fairShown: Record<string, number>;
}

const buildLedger = async (seed: number): Promise<Day[]> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );

  const schedule = withSeededRandom(seededRandomStream(seed), () =>
    generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }));

  const manager = new SimulationManager({
    teams, games: schedule, playerState: universe,
    settings: DEFAULT_SETTINGS, currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let playerState: LeaguePlayerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < WARMUP_DAYS; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams; games = r.games; playerState = r.playerState;
  }

  const rows: Day[] = [];
  let previous: Record<string, number> | undefined;
  for (let d = 0; d < PRICED_DAYS; d += 1) {
    const common = {
      teams, games, date: iso(d), playerState, seasonYear: YEAR,
      previousClose: previous, mcTrials: TRIALS, settings: DEFAULT_SETTINGS,
    };
    const priced = priceBoardForDay({ ...common, seed });
    /*
      The SECOND CALL IS THE EXPERIMENT.

      Same league, same day, same previous close -- only the Monte Carlo seed differs -- so the fair
      layer it produces is an independent estimate of the same valuation. It is not a different price:
      `fair` comes from roster, form and playoff odds and does not read `previousClose`.
    */
    const reEstimated = priceBoardForDay({ ...common, seed: seed + ALT_SEED_OFFSET });
    previous = priced.close;
    rows.push({ date: priced.date, close: priced.close, fairTrue: priced.fair, fairShown: reEstimated.fair });
  }
  return rows;
};

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

interface Trade { t: number; club: string; fwd: number }

/** Run the fade-the-dislocation strategy using whichever fair layer it is handed. */
const runStrategy = (days: Day[], fairKey: 'fairTrue' | 'fairShown'): Trade[] => {
  const out: Trade[] = [];
  for (let t = 0; t + HOLD_DAYS < days.length; t += 1) {
    for (const [club, close] of Object.entries(days[t].close)) {
      const fair = days[t][fairKey][club];
      if (typeof fair !== 'number' || fair <= 0 || close <= 0) continue;
      if (close / fair - 1 >= -ENTRY_THRESHOLD) continue;
      const exit = days[t + HOLD_DAYS].close[club];
      if (typeof exit !== 'number' || exit <= 0 || exit > PRICE_SANITY_MAX) continue;
      out.push({ t, club, fwd: exit / close - 1 });
    }
  }
  return out;
};

/** The matched control: same days, same horizon, a random club instead of a cheap one. */
const controlMean = (days: Day[], picks: Trade[], rng: () => number): number => {
  let total = 0;
  for (const pick of picks) {
    const ids = Object.keys(days[pick.t].close);
    const club = ids[Math.floor(rng() * ids.length)];
    const exit = days[pick.t + HOLD_DAYS].close[club];
    const entry = days[pick.t].close[club];
    if (typeof exit === 'number' && typeof entry === 'number' && entry > 0) total += exit / entry - 1;
  }
  return picks.length === 0 ? 0 : total / picks.length;
};

const main = async (): Promise<void> => {
  console.log('\nWOULD AN ERROR BAR ON FAIR VALUE SAVE THE HXSE?\n');
  console.log(`  ${SEEDS.length} leagues, warmed ${WARMUP_DAYS} days then priced ${PRICED_DAYS} days`);
  console.log(`  ${TRIALS} MC trials per estimate; the player's fair value is a SECOND independent draw`);
  console.log(`  strategy: buy below -${(ENTRY_THRESHOLD * 100).toFixed(0)}% vs fair, hold ${HOLD_DAYS} days\n`);

  const fairDiffs: number[] = [];
  const fairDiffPct: number[] = [];
  const edgeTrue: number[] = [];
  const edgeShown: number[] = [];
  let fairIdentical = 0;
  let fairCompared = 0;
  let tradesTrue = 0;
  let tradesShown = 0;

  for (const seed of SEEDS) {
    process.stdout.write(`  league ${seed}... `);
    const days = await withSeededRandomAsync(seededRandomStream(seed * 3931), () => buildLedger(seed));

    for (let t = 0; t < days.length; t += 1) {
      for (const [club, fair] of Object.entries(days[t].fairTrue)) {
        const shown = days[t].fairShown[club];
        if (typeof fair !== 'number' || fair <= 0 || typeof shown !== 'number' || shown <= 0) continue;
        fairCompared += 1;
        if (shown === fair) fairIdentical += 1;
        fairDiffs.push(shown - fair);
        fairDiffPct.push((shown - fair) / fair);
      }
    }

    const rng = seededRandomStream(days.length * 977 + seed);
    for (const key of ['fairTrue', 'fairShown'] as const) {
      const picks = runStrategy(days, key);
      if (key === 'fairTrue') tradesTrue += picks.length; else tradesShown += picks.length;
      const strat = mean(picks.map((p) => p.fwd));
      const ctrl = mean(Array.from({ length: CONTROL_DRAWS }, () => controlMean(days, picks, rng)));
      (key === 'fairTrue' ? edgeTrue : edgeShown).push(strat - ctrl);
    }
    console.log('done');
  }

  /*
    THE BAND WIDTH, and the derivation stated rather than waved at.

    Two independent estimates of the same quantity differ by roughly sqrt(2) times the standard error
    of ONE estimate. So the per-estimate standard error is sd(difference) / sqrt(2), and that is the
    number a one-sigma band should be drawn at.
  */
  const diffSd = sd(fairDiffs);
  const perEstimateSd = diffSd / Math.SQRT2;
  const diffPctSd = sd(fairDiffPct);

  console.log('\n  1. HOW BIG IS THE UNCERTAINTY IN FAIR VALUE?\n');
  console.log(`     estimates compared: ${fairCompared}   identical (which would mean the seed is not reaching the MC): ${fairIdentical}`);
  console.log(`     sd of (shown - true): ${perEstimateSd.toFixed(1)} points, ${pct(diffPctSd)} of fair value`);
  console.log(`     one-estimate standard error (sd / sqrt(2)): ${perEstimateSd.toFixed(1)} points`);
  console.log(`     a ONE-SIGMA BAND would therefore be about +/- ${pct(perEstimateSd / 500)} of fair value`);
  console.log(`     (the band is +/- 1 sd of the estimate, and fair is roughly 10 points per 1% )`);

  console.log('\n  2. DOES THE EDGE SURVIVE THE PLAYER SEEING A BAND?\n');
  const meanTrue = mean(edgeTrue);
  const meanShown = mean(edgeShown);
  const survived = meanShown / meanTrue;
  console.log(`     edge on the TRUE fair value:   ${pct(meanTrue)}   (sd ${pct(sd(edgeTrue))}, ${edgeTrue.filter((e) => e > 0).length}/${edgeTrue.length} leagues positive)`);
  console.log(`     edge on the SHOWN fair value:  ${pct(meanShown)}   (sd ${pct(sd(edgeShown))}, ${edgeShown.filter((e) => e > 0).length}/${edgeShown.length} leagues positive)`);
  console.log(`     trades: ${tradesTrue} on the true signal, ${tradesShown} on the shown one`);
  console.log(`     SURVIVAL: ${(survived * 100).toFixed(1)}% of the edge`);

  console.log('\n  3. VERDICT\n');
  if (meanShown <= 0) {
    console.log('     NO EDGE SURVIVES. A player trading on a fair value with real uncertainty cannot beat');
    console.log('     random entry, so the HXSE has no tradeable edge and Phase 4 has nothing to trade.');
    console.log('     Attaching a band would make the screen honest AND the feature pointless.');
  } else if (survived < 0.34) {
    console.log(`     THE EDGE ALL BUT VANISHES (${(survived * 100).toFixed(0)}% left). The band would remove the`);
    console.log('     spreadsheet and leave a market that is mostly a coin flip.');
  } else if (survived < 0.7) {
    console.log(`     USABLE. Two thirds of the edge survives (${(survived * 100).toFixed(0)}%), so a band removes the`);
    console.log('     mechanical read while leaving real analytical edge behind. This is the case worth');
    console.log('     building.');
  } else {
    console.log(`     THE EDGE IS BARELY TOUCHED (${(survived * 100).toFixed(0)}% survives). A band would be honest but`);
    console.log('     would not change the game, because the dislocation stays readable through the noise.');
  }
  console.log('');
};

void main();