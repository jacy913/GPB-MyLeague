/**
 * IS THERE AN EDGE IN THE HXSE, OR WOULD A PLAYER ONLY BE ABLE TO LOSE?
 *
 * ===========================================================================
 * THIS IS A GATE, NOT A CHECK. IT HAS NO PASS/FAIL.
 *
 * The plan's Phase 4 lets the player buy shares. Before building a screen with a "buy" button on
 * it, someone has to answer the question the screen implies: if a player spends money here, are
 * they doing something clever, or are they paying to watch a number move?
 *
 * The mean reversion is real and large -- `checkSharePrice` measures stray-from-fair sd at 7.52%
 * WITH the drift term and 21.55% without it. That is a necessary condition for an edge and it is
 * not a sufficient one, for two reasons this tool exists to measure rather than argue:
 *
 *   1. THE CROWD ALREADY TRADES IT. The drift in `nextPrice` pulls price toward fair value, but
 *      `crowd.ts` pushes price around every day too. Reversion being real does not mean reversion
 *      being left on the table.
 *   2. NOISE SWAMPS SIGNAL. Drift per day is `MEAN_REVERSION_K` (0.06) times the gap, so a club 10%
 *      below fair drifts up 0.6% a day -- against an in-season daily sigma near 5.6%. Over a
 *      20-day hold the drift contributes about 12% and the noise about 25%. Whether that nets
 *      positive is arithmetic this tool performs instead of assuming.
 *
 * ===========================================================================
 * THE COMPARISON IS AGAINST A CONTROL, BECAUSE "positive return" PROVES NOTHING
 *
 * In-season prices drift up on average, so ANY strategy that is simply long would show a gain. The
 * question is not "does buying make money" but "does buying BECAUSE THE CLUB IS CHEAP beat buying
 * for no reason at all".
 *
 * So every strategy is measured against a control with the SAME DAYS and the SAME HOLDING PERIOD,
 * differing only in WHICH CLUB was picked: the control picks a random club on the same day the
 * strategy fired. Matching days removes the drift and the season shape from the comparison, which
 * is exactly what a naive "strategy vs zero" comparison would leave in and misread as skill.
 *
 * The control is averaged over many draws because one random draw is itself noisy, and the whole
 * point of the tool is to not be fooled by noise.
 *
 * ===========================================================================
 * THE NUMBER THAT DECIDES IT IS THE BREAK-EVEN COST
 *
 * A game's price has no published spread, so rather than invent a vig and then argue about it,
 * this tool reports how much round-trip friction the edge survives. Break-even cost is the honest
 * question: if the gross edge is 0.4% per trade and any real spread exceeds that, the market is a
 * trap with a nice chart behind it, and no amount of UI makes it a game.
 *
 * `DECLARED_COST` below is the pre-registered hurdle, fixed before this ran.
 *
 * ===========================================================================
 * MULTIPLE SEEDS, BECAUSE ONE SEASON IS A COIN FLIP
 *
 * `verifyFuturesRisk` shipped a check that passed about half the time it was run, for exactly this
 * reason. A single 100-day season has enough variance to invent an edge that is not there. So this
 * runs several independent leagues and reports how MANY of them show a gain. "Two seeds out of
 * five" is reported as the non-result it is, not rounded to a pass.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { priceBoardForDay } from '../src/lib/analytics/priceBoard';
import { marketSizeFor } from '../src/lib/analytics/fanbase';
import { seededRandomStream, withSeededRandom, withSeededRandomAsync } from '../src/lib/analytics/playoffMonteCarlo';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;

/*
  DECLARED BEFORE MEASURING, and not adjusted afterwards.

  WARMUP: long enough that rosters and ratings have settled, so the first priced day is not
  measuring a league that has not finished forming.

  PRICED_DAYS / TRIALS: the same MC trial count the app uses, because fair value is a Monte Carlo
  estimate and a cheaper one would make every stray in this tool an artefact of the estimator.

  ENTRY_THRESHOLD and HOLD_DAYS are swept rather than fixed, because picking one pair in advance and
  reporting only that pair is how a tool ends up reporting whichever cell happened to look best.
  The sweep is printed in full.

  CONTROL_DRAWS: the control is a mean, so its own error shrinks as 1/sqrt(draws). 400 puts it
  well under the spread between seeds, which is the comparison that actually decides the question.
*/
const WARMUP_DAYS = 60;
const PRICED_DAYS = 110;
const TRIALS = 250;
const SEEDS = [4242, 991, 20260101, 7, 31337];
const ENTRY_THRESHOLDS = [0.05, 0.10, 0.15, 0.20];
const HOLD_DAYS = [5, 10, 20, 30];
const CONTROL_DRAWS = 400;

/**
 * Round-trip friction, pre-registered as 1.0%: half a percent each way.
 *
 * A player who crosses a market should pay something, and 0.5% a side is a deliberately round
 * number that a reader can argue with. The point of the tool is not that this number is correct --
 * it is that BREAK-EVEN COST is reported next to it, so the reader can substitute their own.
 */
const DECLARED_COST = 0.01;

const iso = (offset: number): string =>
  new Date(Date.parse(getDefaultSeasonStartDate(YEAR)) + offset * 86400000).toISOString().slice(0, 10);

interface Day {
  date: string;
  close: Record<string, number>;
  fair: Record<string, number>;
}

interface Trade {
  /** Day index the position was opened on. */
  t: number;
  club: string;
  stray: number;
  fwd: number;
  marketSize: number;
}

/** Every (day, club) pair with a realisable forward return at this horizon. */
const opportunities = (rows: Day[], horizon: number): Trade[] => {
  const out: Trade[] = [];
  for (let t = 0; t + horizon < rows.length; t += 1) {
    const today = rows[t];
    const later = rows[t + horizon];
    for (const [id, close] of Object.entries(today.close)) {
      const fair = today.fair[id];
      const exit = later.close[id];
      if (typeof fair !== 'number' || fair <= 0 || close <= 0 || typeof exit !== 'number' || exit <= 0) continue;
      out.push({ t, club: id, stray: close / fair - 1, fwd: exit / close - 1, marketSize: 0 });
    }
  }
  return out;
};

/**
 * The control, matched to a specific set of strategy trades.
 *
 * Same day, same horizon, random club -- so the only thing that differs between strategy and
 * control is whether the club was chosen for being cheap. That is the whole claim under test.
 */
const controlMean = (pool: Trade[], picks: Trade[], rng: () => number): number => {
  if (picks.length === 0) return 0;
  let total = 0;
  for (const pick of picks) {
    const sameDay = pool.filter((c) => c.t === pick.t);
    total += sameDay[Math.floor(rng() * sameDay.length)]?.fwd ?? 0;
  }
  return total / picks.length;
};

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const sd = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;

const buildLedger = async (seed: number): Promise<{ rows: Day[]; sizes: Record<string, number> }> => {
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
    teams,
    games: schedule,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let playerState: LeaguePlayerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < WARMUP_DAYS; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams; games = r.games; playerState = r.playerState;
  }

  const sizes: Record<string, number> = {};
  for (const t of teams) sizes[t.id] = marketSizeFor(t);

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
  return { rows, sizes };
};

const main = async (): Promise<void> => {
  console.log('\nIS THERE AN EDGE IN THE HXSE?\n');
  console.log(`  ${SEEDS.length} leagues, each warmed ${WARMUP_DAYS} days then priced ${PRICED_DAYS} days`);
  console.log(`  ${TRIALS} MC trials per day (the app's own figure, so fair value is not an artefact here)`);
  console.log(`  control: same days and same holding period, random club, ${CONTROL_DRAWS} draws`);
  console.log(`  declared round-trip cost to clear: ${pct(DECLARED_COST)}\n`);

  const perSeed: Array<{ seed: number; rows: Day[]; sizes: Record<string, number> }> = [];
  for (const seed of SEEDS) {
    process.stdout.write(`  running league seed ${seed}... `);
    const { rows, sizes } = await withSeededRandomAsync(
      seededRandomStream(seed * 7919),
      () => buildLedger(seed),
    );
    perSeed.push({ seed, rows, sizes });
    console.log(`${rows.length} priced days`);
  }

  /*
    TEST 1 -- IS THERE ANY SIGNAL AT ALL?

    Forward returns bucketed by how cheap the club was on the day of entry, averaged over every
    seed. If the cheap buckets do NOT out-earn the expensive ones, there is nothing for a strategy
    to exploit and the grid below is reading noise.

    The thing to look at is MONOTONICITY, not the level. A single bucket being good is a fluke
    waiting to happen across seven buckets; seven buckets stepping downward is a signal.
  */
  const BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
    { label: 'under -20%', lo: -Infinity, hi: -0.20 },
    { label: '-20% to -10%', lo: -0.20, hi: -0.10 },
    { label: '-10% to -5%', lo: -0.10, hi: -0.05 },
    { label: '-5% to +5%', lo: -0.05, hi: 0.05 },
    { label: '+5% to +10%', lo: 0.05, hi: 0.10 },
    { label: '+10% to +20%', lo: 0.10, hi: 0.20 },
    { label: 'over +20%', lo: 0.20, hi: Infinity },
  ];

  console.log('\n  1. FORWARD RETURN BY HOW CHEAP THE CLUB WAS ON ENTRY DAY (30-day hold)\n');
  console.log('     bucket          n      mean fwd     sd      vs +5%..+10% bucket');
  const bucketStats = BUCKETS.map((b) => {
    const fwd: number[] = [];
    for (const { rows, sizes } of perSeed) {
      for (const o of opportunities(rows, 30)) {
        if (o.stray >= b.lo && o.stray < b.hi) fwd.push(o.fwd);
      }
    }
    return { label: b.label, n: fwd.length, mean: mean(fwd), sd: sd(fwd) };
  });
  const rich = bucketStats.find((b) => b.label === '+5% to +10%')?.mean ?? 0;
  for (const b of bucketStats) {
    console.log(`     ${b.label.padEnd(15)} ${String(b.n).padStart(6)}  ${pct(b.mean).padStart(9)}  ${pct(b.sd).padStart(8)}   ${(b.mean - rich >= 0 ? '+' : '')}${pct(b.mean - rich).padStart(8)}`);
  }

  /*
    TEST 2 -- THE SWEEP. Entry threshold x holding period, strategy against its matched control.

    Positive means "buying because it was cheap beat buying at random on the same day". Costs are
    NOT subtracted here on purpose; the break-even line below reads the gross number directly.
  */
  console.log('\n  2. EDGE vs MATCHED CONTROL -- buy below the threshold, hold, sell\n');
  const grid: Array<{ entry: number; hold: number; deltas: number[]; picks: number[] }> = [];
  for (const entry of ENTRY_THRESHOLDS) {
    for (const hold of HOLD_DAYS) {
      const deltas: number[] = [];
      const pickCounts: number[] = [];
      for (const { rows, sizes } of perSeed) {
        const pool = opportunities(rows, hold).map((o) => ({ ...o, marketSize: sizes[o.club] ?? 0 }));
        const picks = pool.filter((o) => o.stray < -entry);
        if (picks.length === 0) continue;
        const strat = mean(picks.map((o) => o.fwd));
        const rng = seededRandomStream(rows.length * 131 + hold * 17 + Math.round(entry * 100));
        const ctrl = mean(Array.from({ length: CONTROL_DRAWS }, () => controlMean(pool, picks, rng)));
        deltas.push(strat - ctrl);
        pickCounts.push(picks.length);
      }
      grid.push({ entry, hold, deltas, picks: pickCounts });
    }
  }
  console.log('     entry    hold    seeds up    mean edge    sd     n/trade   break-even cost');
  for (const g of grid) {
    const up = g.deltas.filter((d) => d > 0).length;
    const m = mean(g.deltas);
    const breakEven = m > 0 ? m : 0;
    const clears = g.deltas.filter((d) => d > DECLARED_COST).length;
    console.log(
      `     ${pct(g.entry).padStart(6)}  ${String(g.hold).padStart(4)}d  ${String(up).padStart(4)}/${g.deltas.length}`
      + `  ${(m >= 0 ? '+' : '') + pct(m)}  ${pct(sd(g.deltas)).padStart(8)}`
      + `  ${String(Math.round(mean(g.picks))).padStart(7)}   ${pct(breakEven).padStart(7)}`
      + (clears > 0 ? `   (${clears} seed(s) clear ${pct(DECLARED_COST)})` : '   (none clear)'),
    );
  }

  /*
    TEST 3 -- WHERE THE EDGE SITS, AND WHETHER IT IS EXITABLE.

    §6.3 makes position size scale with liquidity precisely so a player cannot load up on a name
    they cannot get out of. If the profitable entries are all in the thinnest names, the position
    limit is not a restriction on an edge -- it is the only thing standing between that edge and a
    degenerate strategy.
  */
  console.log('\n  3. WHERE THE ENTRIES LAND, BY CLUB SIZE (entry 10%, hold 20d)\n');
  const entriesBySize: { size: number; count: number; meanFwd: number }[] = [];
  const sizeQuartiles = [25, 50, 75];
  const allSizes = perSeed.flatMap(({ sizes }) => Object.values(sizes)).sort((a, b) => a - b);
  const q = (p: number): number => allSizes[Math.floor(allSizes.length * p)] ?? 0;
  const bounds = [0, q(sizeQuartiles[0] / 100), q(sizeQuartiles[1] / 100), q(sizeQuartiles[2] / 100), 100];
  for (let i = 0; i < 4; i += 1) {
    const picked: number[] = [];
    for (const { rows, sizes } of perSeed) {
      const pool = opportunities(rows, 20).map((o) => ({ ...o, marketSize: sizes[o.club] ?? 0 }));
      for (const o of pool) {
        if (o.stray < -0.10 && o.marketSize >= bounds[i] && o.marketSize < bounds[i + 1]) picked.push(o.fwd);
      }
    }
    entriesBySize.push({ size: (bounds[i] + bounds[i + 1]) / 2, count: picked.length, meanFwd: mean(picked) });
  }
  console.log('     club size band        n entries    mean forward return');
  const sizeLabels = ['thinnest', 'small', 'large', 'thickest'];
  for (let i = 0; i < 4; i += 1) {
    const e = entriesBySize[i];
    console.log(`     ${sizeLabels[i].padEnd(10)} ${bounds[i].toFixed(0).padStart(4)}-${bounds[i + 1].toFixed(0).padEnd(4)} ${String(e.count).padStart(9)}   ${pct(e.meanFwd).padStart(10)}`);
  }

  console.log('');
};

void main();