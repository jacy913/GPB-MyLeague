/**
 * IS THERE ANY RISK IN BUYING A MISPRICED CLUB?
 *
 * ===========================================================================
 * WHY THIS QUESTION, AND WHY IT IS THE ONE THAT MATTERS NOW
 * ===========================================================================
 *
 * Option C proposed attaching an error bar to fair value so that finding a dislocation would take a
 * judgement rather than a subtraction. `tools/probeFairUncertainty.ts` measured it and the answer was
 * no: the 250-trial Monte Carlo resolves fair value to about +/-1.6%, against a signal of -10% or
 * worse, and 101.1% of the edge survived. The band would be honest and would change nothing.
 *
 * That falsified the remedy, and it also corrected the diagnosis. The complaint was never that the
 * number is too precise. It is that buying a club 10% under fair has almost no DOWNSIDE, because mean
 * reversion reliably brings it back.
 *
 * So the question is whether there is risk already in the system, and the honest way to answer it is
 * not to look at the average return -- an average of +13% says nothing about whether a given
 * purchase was survivable. It is to look at the PATH.
 *
 * ===========================================================================
 * THREE THINGS THAT MATTER MORE THAN THE MEAN
 * ===========================================================================
 *
 *   1. THE FULL DISTRIBUTION at each horizon, including the losing tail. A strategy whose 10th
 *      percentile is -30% is a different game from one whose 10th percentile is -2%.
 *   2. MAX ADVERSE EXCURSION -- how far underwater the position went before it came back. Mean
 *      reversion is not obliged to be monotonic, and if a purchase routinely goes 10% under to 28%
 *      under before recovering, then the risk is already there and the design is finished.
 *   3. TIME TO CROSS FAIR. If it typically takes 30 days, a player learns to hold. If some take a
 *      full season, that is the risk.
 *
 * ===========================================================================
 * WHY THIS IS A PROBE AND NOT A CHECK
 * ===========================================================================
 *
 * There is no pass/fail here, because "is this market interesting" is a product decision and a check
 * that could fail it would only be tuned until it passed. What is reported is the distribution, so
 * the decision can be made against numbers.
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
const PRICED_DAYS = 200;
const TRIALS = 250;
const ENTRY_THRESHOLD = 0.10;

const HORIZONS = [10, 20, 40, 60, 90, 120, 180];

const iso = (offset: number): string =>
  new Date(Date.parse(getDefaultSeasonStartDate(YEAR)) + offset * 86400000).toISOString().slice(0, 10);

interface Day { date: string; close: Record<string, number>; fair: Record<string, number> }

const buildLedger = async (seed: number): Promise<Day[]> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe, YEAR,
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
    const board = priceBoardForDay({
      teams, games, date: iso(d), playerState, seasonYear: YEAR,
      seed, previousClose: previous, mcTrials: TRIALS, settings: DEFAULT_SETTINGS,
    });
    previous = board.close;
    rows.push({ date: board.date, close: board.close, fair: board.fair });
  }
  return rows;
};

const quantile = (sorted: number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)))];

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

interface Position {
  club: string;
  entryDay: number;
  entryStray: number;
  /** Forward return at each horizon, indexed the same as HORIZONS. NaN where unavailable. */
  forward: number[];
  /** Worst return seen at any point during the hold, i.e. how far underwater it went. */
  worst: number;
  /** Days until the close first exceeded its fair value, or null if it never did. */
  daysToFair: number | null;
}

const main = async (): Promise<void> => {
  console.log('\nIS THERE ANY RISK IN BUYING A MISPRICED CLUB?\n');
  console.log(`  ${SEEDS.length} leagues, warmed ${WARMUP_DAYS} days then priced ${PRICED_DAYS} days`);
  console.log(`  entries: any club trading more than ${(ENTRY_THRESHOLD * 100).toFixed(0)}% below its own fair value`);
  console.log(`  the position is held to the END of the window and the whole path is examined, not just the exit\n`);

  const positions: Position[] = [];

  for (const seed of SEEDS) {
    process.stdout.write(`  league ${seed}... `);
    const days = await withSeededRandomAsync(seededRandomStream(seed * 5381), () => buildLedger(seed));

    for (let t = 0; t < days.length; t += 1) {
      for (const [club, close] of Object.entries(days[t].close)) {
        const fair = days[t].fair[club];
        if (typeof fair !== 'number' || fair <= 0 || close <= 0) continue;
        const stray = close / fair - 1;
        if (stray >= -ENTRY_THRESHOLD) continue;

        const forward = HORIZONS.map((h) => {
          const exit = days[t + h]?.close[club];
          return typeof exit === 'number' && exit > 0 && exit <= PRICE_SANITY_MAX ? exit / close - 1 : Number.NaN;
        });

        let worst = 0;
        let daysToFair: number | null = null;
        for (let k = t; k < days.length; k += 1) {
          const later = days[k].close[club];
          const laterFair = days[k].fair[club];
          if (typeof later !== 'number' || later <= 0) continue;
          worst = Math.min(worst, later / close - 1);
          if (daysToFair === null && typeof laterFair === 'number' && laterFair > 0 && later >= laterFair) {
            daysToFair = k - t;
          }
        }
        positions.push({ club, entryDay: t, entryStray: stray, forward, worst, daysToFair });
      }
    }
    console.log(`${positions.length} entries so far`);
  }

  const total = positions.length;
  const withHorizon = (h: number): number[] => positions
    .map((p) => p.forward[HORIZONS.indexOf(h)])
    .filter((x) => Number.isFinite(x));

  console.log(`\n  entries examined: ${total} across ${SEEDS.length} leagues\n`);

  console.log('  1. THE DISTRIBUTION AT EACH HORIZON, NOT JUST THE AVERAGE\n');
  console.log('     horizon    n      p10      median      mean      p90    profitable');
  for (const h of HORIZONS) {
    const xs = withHorizon(h).sort((a, b) => a - b);
    if (xs.length === 0) { console.log(`     ${String(h + 'd').padStart(7)}      0`); continue; }
    const wins = xs.filter((x) => x > 0).length;
    console.log(
      `     ${String(h + 'd').padStart(7)} ${String(xs.length).padStart(6)}  `
      + `${pct(quantile(xs, 0.10)).padStart(8)}  ${pct(quantile(xs, 0.50)).padStart(8)}  `
      + `${pct(xs.reduce((a, b) => a + b, 0) / xs.length).padStart(8)}  `
      + `${pct(quantile(xs, 0.90)).padStart(8)}  ${pct(wins / xs.length).padStart(8)}`,
    );
  }

  /*
    THE DRAWDOWN, which is the number that decides whether the market is survivable. A position that
    routinely goes further against you before it recovers is a position that needs nerve to hold, and
    nerve is the thing a game should be asking for.
  */
  const worstSorted = positions.map((p) => p.worst).sort((a, b) => a - b);
  const deeperThan = (t: number): number =>
    positions.filter((p) => p.worst <= -t).length / positions.length;

  console.log('\n  2. HOW FAR UNDERWATER DOES IT GO BEFORE IT COMES BACK?\n');
  console.log(`     drawdown percentiles: p05 ${pct(quantile(worstSorted, 0.05))}  p10 ${pct(quantile(worstSorted, 0.10))}  median ${pct(quantile(worstSorted, 0.50))}  p90 ${pct(quantile(worstSorted, 0.90))}`);
  /*
    THE MINIMUM, NOT THE MAXIMUM, AND THIS LINE PRINTED IT BACKWARDS FIRST.

    `worstSorted[length - 1]` is the LARGEST drawdown in the set -- the entries that never went
    underwater at all -- and it was labelled "worst". It printed 0.0% on a run where 35.9% of
    entries went more than 10% below water. A number that reads as reassuring because it is
    backwards is worse than a number that reads as alarming, because nobody checks the alarming one.
  */
  console.log(`     single worst drawdown observed: ${pct(worstSorted[0])}`);
  console.log(`     went more than 10% underwater: ${pct(deeperThan(0.10))} of entries`);
  console.log(`     went more than 20% underwater: ${pct(deeperThan(0.20))}`);
  console.log(`     went more than 30% underwater: ${pct(deeperThan(0.30))}`);

  const crossed = positions.filter((p) => p.daysToFair !== null);
  console.log('\n  3. HOW LONG UNTIL IT CROSSES FAIR?\n');
  console.log(`     crossed fair within the window: ${pct(crossed.length / positions.length)}`);
  if (crossed.length > 0) {
    const days = crossed.map((p) => p.daysToFair as number).sort((a, b) => a - b);
    console.log(`     days to cross: p10 ${quantile(days, 0.10)}  median ${quantile(days, 0.50)}  p90 ${quantile(days, 0.90)}`);
    const slow = days.filter((d) => d > 60).length / days.length;
    console.log(`     took more than 60 days: ${pct(slow)}`);
  }

  console.log('\n  4. WHAT THIS SAYS ABOUT THE MARKET\n');
  const p10 = quantile(worstSorted, 0.10);
  const neverCrossed = 1 - crossed.length / positions.length;
  const bigLoss = deeperThan(0.30);
  if (neverCrossed < 0.05 && p10 > -0.25) {
    console.log('     NO REAL RISK. Almost everything crosses fair, the drawdown tail is shallow, and a');
    console.log('     player who buys a dislocation cannot be meaningfully punished for it. The edge is');
    console.log('     real but the market is too kind, and the game is a spreadsheet that pays you well.');
  } else if (bigLoss > 0.10) {
    console.log(`     THERE IS RISK. ${pct(bigLoss)} of entries went more than 30% underwater, and the 10th`);
    console.log('     percentile drawdown is severe. Buying a dislocation demands nerve and can cost real');
    console.log('     money on the way, which is the thing the option-C error bar was meant to create.');
  } else {
    console.log(`     MODERATE RISK. ${pct(neverCrossed)} never crossed fair and the drawdown tail reaches`);
    console.log(`     ${pct(quantile(worstSorted, 0.05))} at the 5th percentile. Holding is uncomfortable but`);
    console.log('     rarely fatal. The market is playable as built and needs no further change.');
  }
  console.log('');
};

void main();