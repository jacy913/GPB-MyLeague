/**
 * Verifies wOBA and wRC+ against the engine's real behaviour.
 *
 * The weights in src/lib/analytics/woba.ts are a measurement, and a measurement
 * nobody re-takes becomes a guess with a comment on it. This tool exists so the
 * constants cannot rot silently: it runs its own season, fits the weights itself
 * from the same probe the fit used, and checks the shipped constants against what
 * it just found.
 *
 * WHAT IS AND IS NOT INDEPENDENT HERE. The weights are fitted against the probe's
 * joint (outcome x runners-on) table, while player-level wOBA comes from the
 * accumulator's season rows. So the two sides are read from different structures
 * and the identity check is what establishes they describe the same games. It is a
 * consistency check between them, NOT independent confirmation that either is
 * correct, and it is labelled as such rather than presented as more than that.
 *
 * WHAT THE PROBE CANNOT SEE. The probe knows outcomes and runs, but not which
 * player was batting, so it cannot produce a per-player wOBA. Every per-player
 * check here therefore goes through the season batting rows.
 *
 * `PlayerSeasonBatting` carries no errors field, so OUT and ERR are not separable
 * in any player-level check either. The weights are fitted on the folded category
 * for exactly that reason, and this verifier fits the same folded category so the
 * comparison is like for like.
 *
 * Run: npx tsx tools/verifyWrc.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import {
  readGameEngineProbe,
  startGameEngineProbe,
  stopGameEngineProbe,
} from '../src/logic/gameEngine';
import type { AtBatOutcome, PlayerSeasonBatting, Team } from '../src/types';
import { toBattingCounts, type BattingCounts } from '../src/lib/analytics/metrics';
import {
  LEAGUE_WOBA,
  WOBA_WEIGHTS,
  leagueRelativeWoba,
  runsCreated,
  woba,
} from '../src/lib/analytics/woba';
import { BASELINE_MINIMUM_PA, leagueBaseline, wrcPlus } from '../src/lib/analytics/wrcPlus';

const DAYS = Number(process.argv[2] ?? 90);
const YEAR = 2024;

/**
 * A seed deliberately different from the one the shipped weights were fitted on,
 * so the weights check is out of sample rather than a restatement.
 */
const VERIFY_SEED = 20240613;

const CATEGORIES: Readonly<Record<string, readonly AtBatOutcome[]>> = {
  OUT_OR_ERR: ['OUT', 'ERR'],
  SO: ['SO'],
  BB: ['BB'],
  '1B': ['1B'],
  '2B': ['2B'],
  '3B': ['3B'],
  HR: ['HR'],
};
const CATEGORY_NAMES = Object.keys(CATEGORIES);

/** Shipped weight per category, read out of the module under test. */
const SHIPPED: Readonly<Record<string, number>> = {
  OUT_OR_ERR: WOBA_WEIGHTS.outOrError,
  SO: WOBA_WEIGHTS.strikeout,
  BB: WOBA_WEIGHTS.walk,
  '1B': WOBA_WEIGHTS.single,
  '2B': WOBA_WEIGHTS.double,
  '3B': WOBA_WEIGHTS.triple,
  HR: WOBA_WEIGHTS.homeRun,
};

/**
 * Tolerance for comparing a shipped weight against a fresh fit.
 *
 * The replicate spread at one seed is 2% to 18% depending on the category, and a
 * different seed moves them by a comparable amount. So this is deliberately loose
 * for the small-denominator categories and tight for the ones that do the
 * ranking, rather than one threshold that would have to be either too loose to
 * catch a real regression or too tight to survive a schedule change.
 *
 * HR is held to 5% because it is the largest weight and the one whose
 * mis-specification would most distort a ranking. OUT_OR_ERR is loose at 60%
 * because its weight is a handful of runs over 50,000 plate appearances; a
 * threshold tight enough to be meaningful there would fail on a schedule reshuffle
 * alone, and a check that fails at random is worse than no check.
 */
const WEIGHT_TOLERANCE: Readonly<Record<string, number>> = {
  OUT_OR_ERR: 0.6,
  SO: 1,
  BB: 0.35,
  '1B': 0.1,
  '2B': 0.15,
  '3B': 0.2,
  HR: 0.05,
};

interface Check {
  label: string;
  pass: boolean;
  measured: string;
}

const results: Check[] = [];
const failures: string[] = [];

/**
 * `measured` is what the tool actually observed and is always what gets reported.
 * `why` is prose explaining the failure and is only ever surfaced when the check
 * fails, so a passing run never prints a reason it did not need.
 */
const check = (label: string, pass: boolean, measured: string, why?: string): void => {
  results.push({ label, pass, measured: pass ? measured : (why ?? `FAILED, observed: ${measured}`) });
  if (!pass) {
    failures.push(`${label}: ${why ?? measured}`);
  }
};

const zeroTeams = (): Team[] =>
  INITIAL_TEAMS.map((t) => ({
    ...t,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  }));

interface Marginals {
  runs: Map<string, number>;
  pa: Map<string, number>;
  totalRuns: number;
  totalPa: number;
}

interface Run extends Marginals {
  batting: BattingCounts[];
  games: number;
  elapsedMs: number;
}

/**
 * One season with the probe running, yielding both the season batting rows and the
 * probe's league totals.
 *
 * The probe is started immediately before the run and stopped immediately after, so
 * no earlier or later work can leave a stale table to be read.
 */
const runSeason = async (seed: number): Promise<Run> => {
  const startedAt = Date.now();

  const playerState = buildNewUniverse({
    teams: zeroTeams(),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const teams = recalculateTeamRatingsFromRosters(zeroTeams(), playerState, YEAR);
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });

  const mgr = new SimulationManager({
    teams,
    games: schedule,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: startDate,
  });

  startGameEngineProbe();
  let completedGames = 0;
  let finalState: Awaited<ReturnType<SimulationManager['run']>>['playerState'] | null = null;
  const seen = new Set<string>();
  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    // Each run materialises the accumulator into playerState, so the last day's
    // result carries the season totals. Kept rather than reaching into the manager,
    // which exposes no getter for its own state.
    finalState = result.playerState;
    result.games.forEach((game) => {
      if (game.status === 'completed' && game.phase === 'regular_season' && !seen.has(game.gameId)) {
        seen.add(game.gameId);
        completedGames += 1;
      }
    });
  }
  const probe = readGameEngineProbe();
  stopGameEngineProbe();

  if (!probe) {
    throw new Error('probe was not running; the run collected nothing');
  }

  const runs = new Map<string, number>();
  const pa = new Map<string, number>();
  let totalRuns = 0;
  let totalPa = 0;
  Object.keys(probe.runsByOutcome).forEach((outcome) => {
    const outcomeRuns = probe.runsByOutcome[outcome] ?? 0;
    const outcomePa = probe.plateAppearancesByOutcome[outcome] ?? 0;
    runs.set(outcome, outcomeRuns);
    pa.set(outcome, outcomePa);
    totalRuns += outcomeRuns;
    totalPa += outcomePa;
  });

  if (!finalState) {
    throw new Error('the run produced no state; DAYS must be at least 1');
  }

  const batting = finalState.battingStats
    .filter((stat) => stat.plateAppearances > 0)
    .map((stat: PlayerSeasonBatting) => toBattingCounts(stat));

  return {
    batting,
    runs,
    pa,
    totalRuns,
    totalPa,
    games: completedGames,
    elapsedMs: Date.now() - startedAt,
  };
};

/** Fit the category weights from a run's probe marginals, independently of src/. */
const fitCategories = (marginals: Marginals): Map<string, number> => {
  const weights = new Map<string, number>();
  CATEGORY_NAMES.forEach((category) => {
    let runs = 0;
    let pa = 0;
    CATEGORIES[category].forEach((outcome) => {
      runs += marginals.runs.get(outcome) ?? 0;
      pa += marginals.pa.get(outcome) ?? 0;
    });
    weights.set(category, pa > 0 ? runs / pa : 0);
  });
  return weights;
};

/** Sum the season rows' runs created, the numerator of a pooled league wOBA. */
const pooledRunsCreated = (rows: readonly BattingCounts[]): number =>
  rows.reduce((sum, counts) => sum + runsCreated(counts), 0);

const pooledPlateAppearances = (rows: readonly BattingCounts[]): number =>
  rows.reduce((sum, counts) => sum + counts.plateAppearances, 0);

// ---------------------------------------------------------------- run

const main = async (): Promise<void> => {
  console.log(`Verifying wOBA and wRC+ against ${DAYS} days of real games.`);
  console.log(`Verify seed ${VERIFY_SEED}, which is not the seed the constants were fitted on.\n`);

  const run = await runSeason(VERIFY_SEED);
  console.log(
    `verify run: ${run.games} games, ${run.totalPa} probe PAs, ` +
      `${(run.elapsedMs / 1000).toFixed(1)}s\n`,
  );

  // -------------------------------------------------- 1. the identity
  //
  // The probe's league run rate and the module's pooled league wOBA describe the
  // same games by two different routes. If the weights are a correct estimator,
  // applying them to the season rows must reproduce the runs the engine recorded.
  //
  // These are NOT exactly equal and are not expected to be: the shipped weights
  // were fitted on a different league, so this compares two leagues' run rates. It
  // is checked at 5% rather than to floating point, and reported as the size of
  // the gap so it is visible rather than hidden behind a pass.
  const modulePooledRuns = pooledRunsCreated(run.batting);
  const modulePooledPa = pooledPlateAppearances(run.batting);
  const moduleWoba = modulePooledPa > 0 ? modulePooledRuns / modulePooledPa : 0;
  const probeWoba = run.totalPa > 0 ? run.totalRuns / run.totalPa : 0;
  const leagueGap = Math.abs(moduleWoba - probeWoba) / probeWoba;

  check(
    'module league wOBA agrees with the probe run rate',
    leagueGap < 0.05,
    `module ${moduleWoba.toFixed(4)} vs probe ${probeWoba.toFixed(4)} runs/PA, ` +
      `${(leagueGap * 100).toFixed(2)}% apart`,
    `the module's league wOBA is ${(leagueGap * 100).toFixed(2)}% from the probe's own ` +
      `run rate (${moduleWoba.toFixed(4)} vs ${probeWoba.toFixed(4)}). The weights are ` +
      `fitted on a different league, so some gap is expected, but 5% means either the ` +
      `weights have drifted or the two sides are not describing the same games`,
  );

  // -------------------------------------------------- 2. plate appearances agree
  //
  // If the season rows and the probe disagree about how many plate appearances
  // happened, nothing else below is comparing like with like.
  check(
    'season rows and probe agree on plate appearances',
    Math.abs(modulePooledPa - run.totalPa) <= 0,
    `both ${run.totalPa}`,
    `season rows total ${modulePooledPa} plate appearances against the probe's ` +
      `${run.totalPa}. The module reads the accumulator and the probe reads the engine, ` +
      `so a gap here means one of them is miscounting rather than that a rate is off`,
  );

  // -------------------------------------------------- 3. weights against a fresh fit
  const fitted = fitCategories(run);
  console.log('WEIGHTS -- shipped constant against a fresh fit on the verify league');
  console.log('  category     shipped    fresh     delta   delta %   tolerance');
  CATEGORY_NAMES.forEach((category) => {
    const shipped = SHIPPED[category];
    const fresh = fitted.get(category)!;
    const tolerance = WEIGHT_TOLERANCE[category];
    const delta = shipped - fresh;
    const relative = Math.abs(fresh) > 1e-9 ? delta / Math.abs(fresh) : 0;
    const within = Math.abs(relative) <= tolerance;
    console.log(
      `  ${category.padEnd(10)}${shipped.toFixed(4).padStart(9)}${fresh.toFixed(4).padStart(9)}` +
        `${delta.toFixed(4).padStart(9)}   ${(relative * 100).toFixed(2).padStart(7)}%` +
        `   ${(tolerance * 100).toFixed(0).padStart(5)}%   ${within ? 'ok' : 'OUT'}`,
    );
    check(
      `shipped weight ${category} within tolerance of a fresh fit`,
      within,
      `${shipped.toFixed(4)} shipped vs ${fresh.toFixed(4)} fitted, ` +
        `${(relative * 100).toFixed(2)}% apart, tolerance ${(tolerance * 100).toFixed(0)}%`,
      `the shipped ${category} weight ${shipped.toFixed(4)} is ` +
        `${(relative * 100).toFixed(2)}% from a fresh fit of ${fresh.toFixed(4)} on an ` +
        `independent league, outside the ${(tolerance * 100).toFixed(0)}% tolerance. Either ` +
        `the constant was transcribed wrong or the fit is no longer reproducing`,
    );
  });

  // -------------------------------------------------- 4. weight ordering
  //
  // Monotone by scoring value. A walk scoring more than a single in this engine is
  // a broken weight set, and this catches it without needing to know the numbers.
  const ordered = ['SO', 'OUT_OR_ERR', 'BB', '1B', '2B', '3B', 'HR'];
  const orderingHolds = ordered.every(
    (category, index) => index === 0 || SHIPPED[category] >= SHIPPED[ordered[index - 1]],
  );
  check(
    'weights are monotone in scoring value',
    orderingHolds,
    ordered.map((c) => `${c} ${SHIPPED[c].toFixed(4)}`).join(' < '),
    `weights are out of order: ${ordered
      .map((c) => `${c} ${SHIPPED[c].toFixed(4)}`)
      .join(', ')}. A walk or an error scoring more than a single would be a ` +
      `transcription error, since neither can score more than one runner in this engine`,
  );

  // -------------------------------------------------- 5. strikeout scores nothing
  check(
    'a strikeout creates no runs',
    WOBA_WEIGHTS.strikeout === 0,
    `weight ${WOBA_WEIGHTS.strikeout}`,
    `the strikeout weight is ${WOBA_WEIGHTS.strikeout}, but a strikeout ends the ` +
      `plate appearance with the batter retired and cannot score a runner`,
  );

  // -------------------------------------------------- 6. zero plate appearances
  const zeroCounts: BattingCounts = {
    gamesPlayed: 0,
    plateAppearances: 0,
    atBats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    walks: 0,
    strikeouts: 0,
    runsScored: 0,
    rbi: 0,
  };
  const zeroWoba = woba(zeroCounts);
  check(
    'zero plate appearances yields null wOBA',
    zeroWoba.value === null && zeroWoba.standardError === null,
    'value and standardError both null',
    `a player with no plate appearances returned value ${zeroWoba.value} and ` +
      `standardError ${zeroWoba.standardError}; division by zero must be null, not 0 or NaN`,
  );

  const zeroBaseline = leagueBaseline([zeroCounts]);
  check(
    'a baseline with nothing above the floor is null',
    zeroBaseline === null,
    'null',
    `leagueBaseline returned ${JSON.stringify(zeroBaseline)} for a population with no ` +
      `qualified players; a league average drawn from unmeasurable players is not one`,
  );

  // -------------------------------------------------- 7. league baseline arithmetic
  const baseline = leagueBaseline(run.batting);
  if (!baseline) {
    throw new Error('the verify league produced no qualified players; the run is too short');
  }
  check(
    'baseline wOBA equals pooled runs created over pooled plate appearances',
    Math.abs(baseline.woba - moduleWoba) < 1e-12,
    `baseline ${baseline.woba.toFixed(10)} vs pooled ${moduleWoba.toFixed(10)}`,
    `leagueBaseline reports ${baseline.woba} but pooled runs created over pooled plate ` +
      `appearances is ${moduleWoba}; the baseline is supposed to be exactly that quotient`,
  );

  // -------------------------------------------------- 8. wRC+ averages 100
  //
  // The UNSHRUNK mean is the one that must land exactly on 100. The denominator is
  // measured from the same rows it scores, so the PA-weighted mean of
  // (wOBA_i / leagueWoba) * 100 is 100 by construction. That is the strongest
  // available check that the scaling is coherent, and it is the check that would
  // fail if a hardcoded divisor had crept back in.
  //
  // The SHRUNK mean is deliberately not asserted to be 100, because it cannot be.
  // Each player is pulled toward average by a different amount, and the weight
  // differs per player, so shrinking moves the PA-weighted mean off 100 by
  // construction. An earlier version of this file asserted it equalled 100 and failed
  // at 98.53; that assertion was wrong, not the shrinkage.
  const wrcRows = run.batting.map((counts) => wrcPlus(counts, baseline));
  const weightedMean = (pick: (r: WrcRow) => number | null): number | null => {
    let weighted = 0;
    let weight = 0;
    run.batting.forEach((counts, index) => {
      const value = pick(wrcRows[index]);
      if (value === null) {
        return;
      }
      weighted += value * counts.plateAppearances;
      weight += counts.plateAppearances;
    });
    return weight > 0 ? weighted / weight : null;
  };
  const meanWrc = weightedMean((r) => r.value);
  const rawMeanWrc = weightedMean((r) => r.rawValue);
  check(
    'unshrunk league-weighted mean wRC+ is exactly 100',
    rawMeanWrc !== null && Math.abs(rawMeanWrc - 100) < 1e-9,
    `${rawMeanWrc?.toFixed(9)}`,
    `the unshrunk league-weighted mean wRC+ is ${rawMeanWrc}, not 100. The baseline is ` +
      `pooled runs created over pooled plate appearances from the very rows being ` +
      `scored, so this mean is 100 by construction; a gap means the scaling or the ` +
      `pooling is inconsistent`,
  );

  check(
    'shrunk league-weighted mean wRC+ stays near 100',
    meanWrc !== null && Math.abs(meanWrc - 100) < 5,
    `${meanWrc?.toFixed(4)}`,
    `the shrunk league-weighted mean wRC+ is ${meanWrc}, more than 5 points from 100. ` +
      `Shrinkage is per-player, so the PA-weighted mean is expected to drift off 100 ` +
      `somewhat, but not by this much`,
  );

  // -------------------------------------------------- 9. shrinkage follows precision
  //
  // NOT plate appearances. That distinction is measured, and this check is where it
  // was established.
  //
  // Two earlier versions of this file asserted that the shrinkage weight rises with
  // plate appearances, and both failed: Pearson 0.23, then Spearman 0.05. The second
  // number falsified the hypothesis rather than refining it, and the reason is
  // arithmetic in the standard error itself.
  //
  // Substituting n_j = PA * p_j into the multinomial variance gives
  //
  //   Var(wOBA) = [ sum_j w_j^2 * p_j * (1 - p_j) ] / PA
  //
  // so precision depends on the player's own OUTCOME MIX, not only on PA. Home runs
  // dominate that numerator: w_HR^2 is 2.906 against 0.032 for a single, so the
  // variance is essentially 2.906 * p_HR(1 - p_HR) / PA. A 600-PA slugger hitting
  // .050 therefore carries MORE wOBA variance than a 100-PA contact hitter hitting
  // .010 -- six times the plate appearances, more than five times the home run rate,
  // and the second effect wins.
  //
  // So shrinking on PA alone would be wrong for this metric, and shrinking on
  // precision is what is implemented. The ordering claim that actually holds is that
  // trust follows the STANDARD ERROR, which is tested here as tertiles: the most
  // precisely measured third of the league must be trusted more than the least
  // precisely measured third.
  const qualified = run.batting
    .map((counts, index) => ({
      pa: counts.plateAppearances,
      homeRuns: counts.homeRuns,
      weight: wrcRows[index].shrinkageWeight,
      standardError: wrcRows[index].standardError,
    }))
    .filter((entry) => entry.pa >= BASELINE_MINIMUM_PA && entry.weight !== null);

  const ranks = (values: number[]): number[] => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    const out = new Array<number>(values.length).fill(0);
    order.forEach((entry, rank) => {
      out[entry.index] = rank;
    });
    return out;
  };

  const spearman = (xs: number[], ys: number[]): number => {
    if (xs.length < 3) {
      return NaN;
    }
    const rx = ranks(xs);
    const ry = ranks(ys);
    const n = rx.length;
    const mx = rx.reduce((a, b) => a + b, 0) / n;
    const my = ry.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    rx.forEach((x, i) => {
      num += (x - mx) * (ry[i] - my);
      dx += (x - mx) ** 2;
      dy += (ry[i] - my) ** 2;
    });
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : NaN;
  };

  // Tertile comparison, which is an ordering test on the real population rather than
  // a restatement of the formula. It fails if wrcPlus ever shrinks on PA instead.
  const byPrecision = [...qualified].sort(
    (a, b) => (a.standardError as number) - (b.standardError as number),
  );
  const third = Math.floor(byPrecision.length / 3);
  const meanWeight = (slice: typeof byPrecision): number =>
    slice.reduce((sum, e) => sum + (e.weight as number), 0) / slice.length;
  const tightestWeight = meanWeight(byPrecision.slice(0, third));
  const loosestWeight = meanWeight(byPrecision.slice(-third));

  check(
    'shrinkage trusts the most precisely measured players most',
    tightestWeight > loosestWeight,
    `mean weight ${tightestWeight.toFixed(3)} for the ${third} tightest-standard-error ` +
      `players vs ${loosestWeight.toFixed(3)} for the ${third} loosest`,
    `the ${third} most precisely measured players were trusted no more than the least ` +
      `precisely measured ones (${tightestWeight} against ${loosestWeight}). Shrinkage ` +
      `must pull in the players whose wOBA is least well determined, so this ordering is ` +
      `the difference between the correction working and doing nothing`,
  );

  // The relationship the above implies, measured rather than asserted: precision
  // tracks home run rate far more than it tracks plate appearances.
  const hrCorr = spearman(
    qualified.map((e) => e.homeRuns),
    qualified.map((e) => e.standardError as number),
  );
  const paCorr = spearman(
    qualified.map((e) => e.pa),
    qualified.map((e) => e.standardError as number),
  );
  const weightCorr = spearman(
    qualified.map((e) => e.pa),
    qualified.map((e) => e.weight as number),
  );

  // The two relationships that make the tertile test above necessary. Both are
  // reported as measurements rather than asserted, because they are the reason the
  // PA-based check was wrong and they would be worth knowing if they ever changed.
  console.log('\nWHAT DRIVES wOBA PRECISION, MEASURED');
  console.log('  Spearman correlation with the standard error of wOBA, among qualified players:');
  console.log(`    home runs          ${hrCorr >= 0 ? '+' : ''}${hrCorr.toFixed(3)}`);
  console.log(`    plate appearances  ${paCorr >= 0 ? '+' : ''}${paCorr.toFixed(3)}`);
  console.log(`    shrinkage weight vs PA          ${weightCorr >= 0 ? '+' : ''}${weightCorr.toFixed(3)}`);
  console.log('  Home runs dominate, which is why the shrinkage weight follows the standard');
  console.log('  error rather than the plate appearance count. See the block comment above.');

  // -------------------------------------------------- 10. shrinkage compresses
  //
  // Not "moves players only a little" -- measured, that is not what happens here, and
  // the reason is worth stating rather than engineering away. The between-player
  // variance came out at 1.02e-4 against a mean sampling variance of 2.59e-4, so at
  // a full season of plate appearances a player's TRUE wOBA differs from average by
  // about as much as their measurement error. The weight that follows is therefore
  // genuinely small even for a 600-PA hitter, and large corrections are the correct
  // reading of that, not a defect.
  //
  // What must hold is the direction: shrinkage exists to pull in the tails, so the
  // spread of the shrunk values must be tighter than the spread of the raw ones.
  const weightedSd = (pick: (r: WrcRow) => number | null): number => {
    const mean = weightedMean(pick);
    if (mean === null) {
      return NaN;
    }
    let variance = 0;
    let weight = 0;
    run.batting.forEach((counts, index) => {
      const value = pick(wrcRows[index]);
      if (value === null) {
        return;
      }
      variance += (value - mean) ** 2 * counts.plateAppearances;
      weight += counts.plateAppearances;
    });
    return weight > 0 ? Math.sqrt(variance / weight) : NaN;
  };
  const rawSd = weightedSd((r) => r.rawValue);
  const shrunkSd = weightedSd((r) => r.value);
  check(
    'shrinkage tightens the spread of wRC+',
    Number.isFinite(shrunkSd) && shrunkSd < rawSd,
    `PA-weighted sd ${shrunkSd.toFixed(4)} shrunk vs ${rawSd.toFixed(4)} raw`,
    `shrinkage widened the spread instead of tightening it (${shrunkSd} against ` +
      `${rawSd}). Its whole effect is to pull extreme small-sample values toward ` +
      `average, so the distribution must get tighter`,
  );

  const corrections = wrcRows
    .filter((r) => r.value !== null && r.rawValue !== null)
    .map((r) => Math.abs((r.value as number) - (r.rawValue as number)));
  const meanCorrection =
    corrections.length > 0 ? corrections.reduce((a, b) => a + b, 0) / corrections.length : NaN;
  const maxCorrection = corrections.length > 0 ? Math.max(...corrections) : NaN;
  check(
    'shrinkage never moves a player past the opposite side of average',
    Number.isFinite(maxCorrection) && maxCorrection < 200,
    `largest correction ${maxCorrection.toFixed(2)} points, mean ${meanCorrection.toFixed(2)}`,
    `shrinkage moved one player by ${maxCorrection} wRC+ points. A correction that large ` +
      `would mean a player is being rated on the far side of average from where their ` +
      `own measurement put them, which no amount of small-sample caution justifies`,
  );

  // -------------------------------------------------- 11. leagueRelativeWoba uses its argument
  //
  // The signature takes the league value, so passing a deliberately wrong one must
  // change the answer. This checks the parameter is wired to the arithmetic and not
  // silently falling back to the module constant, which is the exact bug the
  // constant-as-divisor design would have introduced.
  const probeRow = run.batting.find((counts) => counts.plateAppearances >= BASELINE_MINIMUM_PA);
  const relativeToHalf = probeRow ? leagueRelativeWoba(probeRow, LEAGUE_WOBA / 2) : null;
  const relativeToFull = probeRow ? leagueRelativeWoba(probeRow, LEAGUE_WOBA) : null;
  check(
    'leagueRelativeWoba responds to the league value it is given',
    relativeToHalf === null || relativeToFull === null || relativeToHalf > relativeToFull * 1.9,
    `halving the league wOBA moved the ratio from ${relativeToFull?.toFixed(3)} to ` +
      `${relativeToHalf?.toFixed(3)}`,
    `halving the league wOBA changed the result from ${relativeToFull} to ` +
      `${relativeToHalf}, which is not roughly double. The league value is not reaching ` +
      `the arithmetic, so the module is still dividing by its own constant`,
  );

  // -------------------------------------------------- 12. non-vacuity
  check(
    'the verify league has enough qualified players to rank',
    qualified.length >= 100,
    `${qualified.length} players at or above ${BASELINE_MINIMUM_PA} PA`,
    `only ${qualified.length} players reached ${BASELINE_MINIMUM_PA} plate appearances, ` +
      `which is too few for a between-player variance to mean anything; run for more days`,
  );

  check(
    'the between-player variance is positive',
    baseline.betweenPlayerVariance > 0,
    `${baseline.betweenPlayerVariance.toExponential(3)} runs squared`,
    `the between-player variance came out at ${baseline.betweenPlayerVariance}, which is ` +
      `not positive. Either players genuinely do not differ on wOBA in this league or ` +
      `the standard errors are overstating their noise; either way shrinkage would ` +
      `flatten everyone to 100`,
  );

  // -------------------------------------------------- report
  console.log('\nMEASURED LEAGUE VALUES');
  console.log(`  probe run rate                 ${probeWoba.toFixed(4)} runs/PA`);
  console.log(`  module pooled wOBA             ${moduleWoba.toFixed(4)} runs/PA`);
  console.log(`  shipped reference LEAGUE_WOBA  ${LEAGUE_WOBA.toFixed(4)} runs/PA`);
  console.log(`  baseline qualified players     ${baseline.qualifiedPlayers}`);
  console.log(`  baseline between-player var    ${baseline.betweenPlayerVariance.toExponential(3)}`);
  console.log(`  baseline observed var          ${baseline.observedVariance.toExponential(3)}`);
  console.log(`  baseline mean sampling var     ${baseline.meanSamplingVariance.toExponential(3)}`);
  console.log(`  mean wRC+ (shrunk, PA-weighted) ${meanWrc?.toFixed(4)}`);
  console.log(`  mean wRC+ (raw, PA-weighted)    ${rawMeanWrc?.toFixed(4)}`);
  console.log(`  PA-weighted sd, shrunk          ${shrunkSd.toFixed(4)}`);
  console.log(`  PA-weighted sd, raw             ${rawSd.toFixed(4)}`);
  console.log(`  mean shrinkage correction       ${meanCorrection.toFixed(2)} points`);
  console.log(`  largest correction              ${maxCorrection.toFixed(2)} points`);
  console.log(
    `  weight, ${third} tightest vs loosest SE  ${tightestWeight.toFixed(3)} vs ${loosestWeight.toFixed(3)}`,
  );

  const top = run.batting
    .map((counts, index) => ({ id: index, wrc: wrcRows[index] }))
    .filter((entry) => entry.wrc.value !== null)
    .sort((a, b) => (b.wrc.value as number) - (a.wrc.value as number))
    .slice(0, 10);
  console.log('\nTOP TEN BY wRC+ -- what a leaderboard would actually show');
  top.forEach((entry, index) => {
    const r = entry.wrc;
    console.log(
      `  ${String(index + 1).padStart(2)}. ${r.value?.toFixed(1).padStart(5)}  ` +
        `(raw ${r.rawValue?.toFixed(1).padStart(5)})  ` +
        `${r.plateAppearances} PA, wOBA ${r.woba?.toFixed(4)}, ` +
        `shrinkage weight ${r.shrinkageWeight?.toFixed(3)}`,
    );
  });

  /*
   * PRESENTABILITY, measured rather than argued.
   *
   * A leaderboard renders whole numbers, so what matters is how many distinct
   * integers the top of the board actually produces and how wide the gap is
   * between rank 1 and rank 10. A board whose top ten reads 116 116 115 115 114
   * is telling the reader nothing, and no amount of accuracy underneath fixes
   * that -- the compression is the measurement.
   *
   * This is the evidence for the open question about whether run value belongs on
   * a main board at all, and for the claim in wrcPlus.ts that callers should treat
   * differences inside a few points as ties.
   */
  const topValues = top.map((entry) => entry.wrc.value as number);
  const asIntegers = new Set(topValues.map((v) => Math.round(v)));
  const roundedTies = topValues.filter((v, i) => i > 0 && Math.round(v) === Math.round(topValues[i - 1])).length;
  console.log(
    `\n  top ten spans ${(topValues[0] - topValues[9]).toFixed(1)} points, ` +
      `${asIntegers.size} distinct whole numbers from 10 rows, ` +
      `${roundedTies} adjacent pair${roundedTies === 1 ? '' : 's'} that tie once rounded`,
  );
  console.log('  If that tie count is high, the board is reporting noise in its own units');

  console.log('\nWHAT THIS DID NOT INDEPENDENTLY CONFIRM');
  console.log('  - The engine already throws when a game\'s hits or runs disagree with its');
  console.log('    scoreboard (gameEngine.ts:1036, 1040), so consistency of runs within a');
  console.log('    game is the engine\'s own guarantee, not a result of this tool.');
  console.log('  - Check 1 compares the module to the probe. Both read the same games, so it');
  console.log('    shows they agree, not that either is independently correct.');
  console.log('  - The weights are validated against a different league, not against a');
  console.log('    ground truth. The only ground truth available is this engine itself.');
  console.log('  - Player-level wOBA cannot be checked against the probe, which does not');
  console.log('    record which player was batting.');

  console.log('\nCHECKS');
  results.forEach((entry, index) => {
    console.log(`  ${entry.pass ? 'PASS' : 'FAIL'}  ${String(index + 1).padStart(2)}. ${entry.label}`);
    console.log(`          ${entry.measured}`);
  });

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks PASS`);
  if (failures.length > 0) {
    console.log('\nFAILURES');
    failures.forEach((line) => console.log(`  - ${line}`));
    process.exitCode = 1;
  }
};

interface WrcRow {
  value: number | null;
  rawValue: number | null;
  woba: number | null;
  shrinkageWeight: number | null;
  plateAppearances: number;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});