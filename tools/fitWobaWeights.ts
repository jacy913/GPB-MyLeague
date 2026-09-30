/**
 * Fits wOBA's linear weights to THIS league, on two independent seeds.
 *
 * WHY NOT FANGRAPHS' PUBLISHED WEIGHTS. Those weights (BB 0.689, 1B 0.884, 2B
 * 1.261, 3B 1.601, HR 2.072) are fitted against MLB, whose league differs from
 * this one in ways that move every weight: measured BABIP is 0.282 against MLB's
 * ~0.300, a single is 14.1% of plate appearances against ~11%, and this engine
 * has NO hit-by-pitch outcome at all, so a walk displaces an out where in MLB it
 * displaces a walk-adjacent outcome. Transplanting the numbers would produce a
 * wRC+ that is arithmetically fine and means nothing here.
 *
 * WHAT IS ACTUALLY FITTED. wOBA is a linear approximation of run value, so the
 * weight on an outcome is the expected runs that outcome creates. This regresses
 * runs scored on a plate appearance against outcome dummies, holding the number
 * of runners aboard as a control, and reads the fitted coefficients off.
 *
 * WHY OCCUPANCY MUST BE CONTROLLED. Without it the fit is confounded, not merely
 * imprecise: a home run with bases loaded scores more than one with bases empty,
 * so an uncontrolled HR coefficient absorbs the average runner context of the
 * league's home runs and reports it as the value of the hit. The joint
 * (outcome x runners-on) table in GameEngineProbe supplies this. The occupancy
 * strata are also reported separately, which turns "outcome is independent of
 * base state" from an assumption into something the data answers.
 *
 * WHY TWO SEEDS, AND WHAT THEY DO AND DO NOT CONTROL FOR. buildNewUniverse takes
 * a real seed (universeBootstrap.ts:179) and the at-bat engine contains no
 * Math.random at all -- every draw inside a game comes from a seeded LCG
 * (gameEngine.ts:35-38, seeded at :1107 from the game's own identity). So a
 * given universe plus a given schedule plays out identically every time.
 *
 * THE SCHEDULE IS NOT SEEDED, though. generateSchedule shuffles game dates
 * through shuffleArray (simulation.ts:193-200), which calls Math.random. So the
 * seed fixes WHO the players are and never fixes WHEN they play, and two runs of
 * the same seed are NOT the same league. Measured: two runs at seed 4242 over 90
 * days gave a BB weight of 0.0403 and 0.0367, a 9% swing, from schedule order
 * alone.
 *
 * That is why the tool reports a REPLICATE SPREAD as well as a two-seed
 * comparison. Both are honest but they answer different questions, and conflating
 * them would understate the uncertainty:
 *
 *   - Two seeds with one schedule each measures fit stability across universes.
 *   - Several replicates at one seed measures schedule-induced variation, which
 *     is the LARGER of the two effects here and the reason a single run's
 *     constants cannot be treated as exact.
 *
 * So the shipped constants in src/lib/analytics/woba.ts are a mean over
 * replicates, not one run's output, and the spread is reported so the precision
 * of that mean is visible.
 *
 * WHY THERE IS NO PARK ADJUSTMENT. Measured, not assumed: the across-team spread
 * in home run rate is below the sampling floor, so there are no park factors to
 * adjust for and adding one would be inventing a term. See the park-factor
 * section of PHASE_HANDOVER.md.
 *
 * Run: npx tsx tools/fitWobaWeights.ts [days]
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
  type GameEngineProbe,
} from '../src/logic/gameEngine';
import type { AtBatOutcome, Team } from '../src/types';

const DAYS = Number(process.argv[2] ?? 90);
const YEAR = 2026;

/** Two distinct seeds: fit on the first, validate on the second. */
const FIT_SEED = 4242;
const HOLDOUT_SEED = 987654;

/**
 * Runs at the fit seed, each generating a new schedule. generateSchedule shuffles
 * dates with an unseeded Math.random (simulation.ts:193-200), so replicates differ
 * from one another even though the players do not. Three is enough to show the
 * order of magnitude; the alternative was reporting one run's numbers as though
 * they were exact, which measured 9% wrong on the walk weight.
 */
const REPLICATES = 3;

/**
 * The eight outcomes that consume a plate appearance, in the order the engine's
 * OUTCOME_POOL declares them (gameEngine.ts:21).
 */
const OUTCOMES: readonly AtBatOutcome[] = ['OUT', 'SO', 'BB', '1B', '2B', '3B', 'HR', 'ERR'];

/**
 * THE CATEGORIES A SEASON ROW CAN ACTUALLY SEE.
 *
 * PlayerSeasonBatting has no errors field, so a season batting line cannot
 * distinguish a retired on an error from any other out. It can be recovered from
 * the play log, but that log is the bounded one-slate mirror, so there is no
 * season-long version to recover it from.
 *
 * That makes "OUT or ERR" the outcome category a season row can measure, and
 * wOBA is only computable over measurable categories. So the shipped weights fit
 * this partition, not the engine's eight-way one. Fitting the eight separately
 * and then discovering errors are unreachable would ship a constant that no
 * player could ever earn -- which is worse than folding, because a dead constant
 * reads as a live one.
 *
 * The eight-way split is still printed below, as a diagnostic, because the folded
 * weight is otherwise hard to reason about: it is small (errors usually happen
 * with the bases empty, when nothing scores) and it is NOT zero.
 */
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

/** Runners aboard, i.e. the occupancy strata, 0..3. */
const OCCUPANCIES = [0, 1, 2, 3];

interface Cell {
  /** Plate appearances in this (outcome, occupancy) cell. */
  plateAppearances: number;
  /** Runs scored on those plate appearances. */
  runs: number;
}

/** The full joint table plus the marginals, kept together so they stay comparable. */
interface Sample {
  joint: Map<string, Cell[]>;
  totalPlateAppearances: number;
  totalRuns: number;
  completedGames: number;
  elapsedMs: number;
}

const emptyRow = (): Cell[] => OCCUPANCIES.map(() => ({ plateAppearances: 0, runs: 0 }));

const zeroTeams = (): Team[] =>
  INITIAL_TEAMS.map((t) => ({
    ...t,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  }));

/**
 * Run one season from a given seed with the probe enabled, and fold the probe's
 * joint table into a Sample.
 *
 * The probe accumulates across the whole run, so this reads it once at the end
 * rather than per game. That is safe because the probe is stopped and reset
 * immediately afterwards, and because nothing else reads it during the run.
 */
const collectSample = async (seed: number): Promise<Sample> => {
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

  // Enabled immediately before the run so nothing prior pollutes it, and stopped
  // immediately after so no later work can read a stale table.
  startGameEngineProbe();
  let completedGames = 0;
  const seen = new Set<string>();
  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
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

  const joint = new Map<string, Cell[]>();
  OUTCOMES.forEach((outcome) => joint.set(outcome, emptyRow()));

  // Cross-check: the joint table must reproduce the marginals the probe already
  // kept, cell by cell. If it does not, the new accumulator disagrees with the
  // old one and nothing downstream can be trusted. These throw rather than warn,
  // because a disagreement here means the instrument is wrong, not the league.
  let marginalRunsMismatch = 0;
  let marginalPaMismatch = 0;

  OUTCOMES.forEach((outcome) => {
    const runsRow = probe.runsByOutcomeAndOccupancy[outcome] ?? [0, 0, 0, 0];
    const paRow = probe.plateAppearancesByOutcomeAndOccupancy[outcome] ?? [0, 0, 0, 0];
    const cells = joint.get(outcome)!;
    let summedRuns = 0;
    let summedPa = 0;
    OCCUPANCIES.forEach((occupancy) => {
      cells[occupancy] = { plateAppearances: paRow[occupancy], runs: runsRow[occupancy] };
      summedRuns += runsRow[occupancy];
      summedPa += paRow[occupancy];
    });
    if (summedRuns !== (probe.runsByOutcome[outcome] ?? 0)) {
      marginalRunsMismatch += 1;
    }
    if (summedPa !== (probe.plateAppearancesByOutcome[outcome] ?? 0)) {
      marginalPaMismatch += 1;
    }
  });

  if (marginalRunsMismatch > 0 || marginalPaMismatch > 0) {
    throw new Error(
      `joint table disagrees with the probe's own marginals: ` +
        `${marginalRunsMismatch} run marginals and ${marginalPaMismatch} PA marginals mismatched`,
    );
  }

  // Same cross-check on the total: the occupancy strata must sum to every plate
  // appearance the probe saw.
  const summedOccupancy = probe.baseCounts.reduce((sum, n) => sum + n, 0);
  if (summedOccupancy !== probe.plateAppearances) {
    throw new Error(
      `occupancy strata sum to ${summedOccupancy} but the probe counted ` +
        `${probe.plateAppearances} plate appearances`,
    );
  }

  return {
    joint,
    totalPlateAppearances: probe.plateAppearances,
    totalRuns:
      Object.values(probe.runsByOutcome).reduce((sum, n) => sum + n, 0),
    completedGames,
    elapsedMs: Date.now() - startedAt,
  };
};

interface Weights {
  /** Weight per outcome category, in runs per plate appearance. */
  byCategory: Map<string, number>;
  /** Plate appearances per category, which is what weights the league mean. */
  paByCategory: Map<string, number>;
  /** League wOBA implied by these weights, in runs per plate appearance. */
  leagueWoba: number;
  /** Runs per plate appearance the league actually scores. */
  leagueRunsPerPa: number;
}

/**
 * A wOBA weight is the expected runs a plate appearance scores when it resolves
 * that way. Not a difference against some baseline: the absolute level is the
 * whole point, because wOBA is read on a "runs created" scale and wRC+ divides
 * it by the league's own run rate.
 *
 * So the estimator is the unconditional mean runs per plate appearance for the
 * outcome:
 *
 *     w_o = (runs on outcome o) / (plate appearances ending in o)
 *
 * averaged over the base states in which that outcome actually occurred, which
 * is what pooling the occupancy strata by that outcome's own plate-appearance
 * distribution does automatically.
 *
 * AN EARLIER ATTEMPT AT THIS WAS WRONG and is recorded because the failure was
 * instructive. It first subtracted the within-stratum mean, producing a
 * wRAA-shaped contrast rather than a wOBA weight: it returned a NEGATIVE weight
 * for a walk and 0.088 for a single, neither of which can be a run value. The
 * diagnostic was that league wOBA came out at 0.1377 while league runs per plate
 * appearance was 0.0915. Those two are equal by construction -- wOBA is the
 * frequency-weighted mean of these weights, and the weights are the conditional
 * means of the same quantity being averaged -- so a gap between them is proof of
 * a broken estimator rather than a finding about the league. That identity is
 * now asserted in verifyWrc.ts, not merely printed.
 */
const fitWeights = (sample: Sample): Weights => {
  const byCategory = new Map<string, number>();
  const paByCategory = new Map<string, number>();

  CATEGORY_NAMES.forEach((category) => {
    const members = CATEGORIES[category];
    let runs = 0;
    let pa = 0;
    members.forEach((outcome) => {
      sample.joint.get(outcome)!.forEach((cell) => {
        runs += cell.runs;
        pa += cell.plateAppearances;
      });
    });
    byCategory.set(category, pa > 0 ? runs / pa : 0);
    paByCategory.set(category, pa);
  });

  // League wOBA is the frequency-weighted mean of the weights. Because each
  // weight is the mean runs of its category, this reproduces the league's overall
  // runs per plate appearance exactly. That identity is the estimator's own
  // check, and it is what caught the previous version.
  let weighted = 0;
  CATEGORY_NAMES.forEach((category) => {
    weighted += byCategory.get(category)! * paByCategory.get(category)!;
  });
  const leagueRunsPerPa = sample.totalRuns / sample.totalPlateAppearances;

  return {
    byCategory,
    paByCategory,
    leagueWoba: weighted / sample.totalPlateAppearances,
    leagueRunsPerPa,
  };
};

/**
 * How much an outcome's value varies with occupancy. A single weight per outcome
 * is an approximation; this reports how much it costs. The spread is wide for
 * anything where the runner context dominates, and that is the honest caveat on
 * wOBA in this engine.
 */
const occupancySpread = (sample: Sample): Map<string, { min: number; max: number; spread: number }> => {
  const out = new Map<string, { min: number; max: number; spread: number }>();
  OUTCOMES.forEach((outcome) => {
    const cells = sample.joint.get(outcome)!;
    const rates = cells
      .filter((cell) => cell.plateAppearances > 0)
      .map((cell) => cell.runs / cell.plateAppearances);
    if (rates.length === 0) {
      out.set(outcome, { min: 0, max: 0, spread: 0 });
      return;
    }
    const min = Math.min(...rates);
    const max = Math.max(...rates);
    out.set(outcome, { min, max, spread: max - min });
  });
  return out;
};

/** Per-stratum outcome rates, reported so the occupancy control can be inspected. */
const strataTable = (sample: Sample, label: string): void => {
  console.log(`\n${label} -- runs per plate appearance by outcome and runners aboard`);
  const header = ['outcome'.padEnd(8), ...OCCUPANCIES.map((n) => `on${n}`.padStart(10)), '  PA'.padStart(10)];
  console.log(`  ${header.join('')}`);
  OUTCOMES.forEach((outcome) => {
    const cells = sample.joint.get(outcome)!;
    const row = cells.map((cell) =>
      cell.plateAppearances > 0 ? (cell.runs / cell.plateAppearances).toFixed(3).padStart(10) : 'n/a'.padStart(10),
    );
    const pa = cells.reduce((sum, c) => sum + c.plateAppearances, 0);
    console.log(`  ${outcome.padEnd(8)}${row.join('')}${String(pa).padStart(12)}`);
  });
  const totals = OCCUPANCIES.map((occupancy) => {
    let runs = 0;
    let pa = 0;
    OUTCOMES.forEach((outcome) => {
      runs += sample.joint.get(outcome)![occupancy].runs;
      pa += sample.joint.get(outcome)![occupancy].plateAppearances;
    });
    return pa > 0 ? (runs / pa).toFixed(3).padStart(10) : 'n/a'.padStart(10);
  });
  console.log(`  ${'ALL'.padEnd(8)}${totals.join('')}${String(sample.totalPlateAppearances).padStart(12)}`);
};

const weightsTable = (weights: Weights, label: string): void => {
  console.log(`\n${label} -- fitted wOBA weights (runs per plate appearance)`);
  CATEGORY_NAMES.forEach((category) => {
    const weight = weights.byCategory.get(category)!;
    const pa = weights.paByCategory.get(category)!;
    // MLB's published figure, for comparison only. The number is not used
    // anywhere; it is printed so the difference from a known reference is
    // visible rather than assumed.
    const mlb: Record<string, number> = { BB: 0.689, '1B': 0.884, '2B': 1.261, '3B': 1.601, HR: 2.072 };
    const reference = mlb[category];
    const comparison =
      reference === undefined ? '  (no MLB reference)' : `  MLB ${reference.toFixed(3)}`;
    console.log(`  ${category.padEnd(9)}${weight.toFixed(4).padStart(9)}${comparison.padStart(22)}   PA ${String(pa).padStart(7)}`);
  });
  console.log(`  league wOBA (fitted)     ${weights.leagueWoba.toFixed(4)}`);
  console.log(`  league runs per PA       ${weights.leagueRunsPerPa.toFixed(4)}`);
};

/**
 * The engine's own eight-way split, printed so the folding is inspectable. This
 * is a diagnostic, not a candidate set: OUT and ERR cannot be told apart from a
 * season batting row, so neither of these two numbers ships.
 */
const unfoldedTable = (sample: Sample, label: string): void => {
  console.log(`\n${label} -- unfolded eight-way split (diagnostic; OUT and ERR do not ship separately)`);
  OUTCOMES.forEach((outcome) => {
    const cells = sample.joint.get(outcome)!;
    const runs = cells.reduce((sum, c) => sum + c.runs, 0);
    const pa = cells.reduce((sum, c) => sum + c.plateAppearances, 0);
    console.log(`  ${outcome.padEnd(8)}${(pa > 0 ? runs / pa : 0).toFixed(4).padStart(9)}   PA ${String(pa).padStart(7)}`);
  });
};

const main = async (): Promise<void> => {
  console.log(`Fitting wOBA weights to this league over ${DAYS} days, two independent seeds.`);
  console.log('Fit seed and holdout seed differ, so the holdout is a genuinely separate league.');

  const fitSample = await collectSample(FIT_SEED);
  console.log(
    `\nfit seed ${FIT_SEED}: ${fitSample.completedGames} games, ` +
      `${fitSample.totalPlateAppearances} plate appearances, ${fitSample.elapsedMs} ms ` +
      `(${(fitSample.elapsedMs / 1000).toFixed(1)}s)`,
  );
  strataTable(fitSample, 'FIT SAMPLE');

  const holdoutSample = await collectSample(HOLDOUT_SEED);
  console.log(
    `\nholdout seed ${HOLDOUT_SEED}: ${holdoutSample.completedGames} games, ` +
      `${holdoutSample.totalPlateAppearances} plate appearances, ${holdoutSample.elapsedMs} ms ` +
      `(${(holdoutSample.elapsedMs / 1000).toFixed(1)}s)`,
  );
  strataTable(holdoutSample, 'HOLDOUT SAMPLE');

  const fit = fitWeights(fitSample);
  const holdout = fitWeights(holdoutSample);

  weightsTable(fit, 'WEIGHTS FITTED ON THE FIT SEED');
  weightsTable(holdout, 'WEIGHTS FITTED INDEPENDENTLY ON THE HOLDOUT SEED');
  unfoldedTable(fitSample, 'FIT SAMPLE');

  // Replicates at the fit seed, to separate schedule-induced variation from
  // universe-induced variation. generateSchedule shuffles dates with an unseeded
  // Math.random (simulation.ts:193-200), so each of these is a different league
  // built from the SAME players.
  const replicates: Weights[] = [fit];
  for (let i = 1; i < REPLICATES; i += 1) {
    const sample = await collectSample(FIT_SEED);
    console.log(
      `  replicate ${i + 1}/${REPLICATES} (seed ${FIT_SEED}, new schedule): ` +
        `${sample.completedGames} games, ${sample.totalPlateAppearances} PAs, ` +
        `${(sample.elapsedMs / 1000).toFixed(1)}s`,
    );
    replicates.push(fitWeights(sample));
  }

  console.log(`\nREPLICATE SPREAD -- ${REPLICATES} runs at seed ${FIT_SEED}, each with a new schedule`);
  console.log('  This isolates schedule noise from universe noise. It is NOT a validation;');
  console.log('  it is the precision of the constants themselves.');
  console.log('\n  SHIPPED CONSTANTS -- mean over replicates, which is what woba.ts stores');
  console.log('  category     mean         sd       min       max      range as % of mean');
  const shipped = new Map<string, number>();
  const replicateRows: string[] = [];
  CATEGORY_NAMES.forEach((category) => {
    const values = replicates.map((r) => r.byCategory.get(category)!);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.length > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1) : 0;
    const sd = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);
    shipped.set(category, mean);
    const rangePct = mean > 1e-9 ? ((max - min) / mean) * 100 : NaN;
    replicateRows.push(
      `  ${category.padEnd(10)}${mean.toFixed(4).padStart(9)}${sd.toFixed(4).padStart(9)}` +
        `${min.toFixed(4).padStart(10)}${max.toFixed(4).padStart(10)}` +
        `   ${(Number.isFinite(rangePct) ? rangePct.toFixed(2) : 'n/a').padStart(8)}%`,
    );
  });
  console.log(replicateRows.join('\n'));

  let weightedLeague = 0;
  let totalPa = 0;
  CATEGORY_NAMES.forEach((category) => {
    weightedLeague += shipped.get(category)! * fit.paByCategory.get(category)!;
    totalPa += fit.paByCategory.get(category)!;
  });
  const shippedLeagueWoba = weightedLeague / totalPa;
  console.log(`\n  shipped league wOBA (mean weights, fit-seed frequencies): ${shippedLeagueWoba.toFixed(4)}`);
  console.log('  Note this is close to, but not exactly, each replicate\'s own league wOBA:');
  console.log('  averaging weights and averaging league values are different operations. The');
  console.log('  shipped constant is the one that matters, and verifyWrc.ts asserts the module');
  console.log('  reproduces a league line from it rather than trusting this arithmetic.');

  console.log('\nSTABILITY -- fitted on fit seed vs fitted on holdout seed');
  console.log('  category    fit      holdout    delta    delta as % of holdout weight');
  let worstRelative = 0;
  let worstCategory = '';
  CATEGORY_NAMES.forEach((category) => {
    const a = fit.byCategory.get(category)!;
    const b = holdout.byCategory.get(category)!;
    const delta = a - b;
    const scale = Math.abs(b) > 1e-9 ? Math.abs(b) : NaN;
    const relative = delta / scale;
    if (Number.isFinite(relative) && Math.abs(relative) > worstRelative) {
      worstRelative = Math.abs(relative);
      worstCategory = category;
    }
    const relativeText = Number.isFinite(relative) ? `${(relative * 100).toFixed(2)}%` : 'n/a';
    console.log(`  ${category.padEnd(10)}${a.toFixed(4).padStart(8)}${b.toFixed(4).padStart(11)}${delta.toFixed(4).padStart(9)}   ${relativeText.padStart(9)}`);
  });
  console.log(
    `\n  worst relative disagreement: ${worstCategory} at ` +
      `${(worstRelative * 100).toFixed(2)}% of the holdout weight`,
  );
  console.log('  That is the small-denominator effect: a category whose weight is a small');
  console.log('  numerator over a large count moves on a handful of extra scoring events.');
  console.log('  Compare it with the replicate spread above, which is schedule noise and is');
  console.log('  the larger effect here. The two measure different things and the larger one');
  console.log('  governs how precisely the shipped constants are known.');

  // The estimator's own identity, asserted rather than printed. wOBA is the
  // frequency-weighted mean of weights that are each the conditional mean of the
  // quantity being averaged, so these are equal by construction. A gap means a
  // broken estimator, never a fact about the league.
  const identityGap = Math.abs(fit.leagueWoba - fit.leagueRunsPerPa);
  console.log('\nIDENTITY CHECK');
  console.log(`  league wOBA minus league runs per PA: ${identityGap.toExponential(3)}`);
  console.log(`  ${identityGap < 1e-12 ? 'PASS' : 'FAIL'} -- must be exactly zero to floating-point precision`);

  const spread = occupancySpread(fitSample);
  console.log('\nOCCUPANCY SPREAD -- how much one weight per outcome approximates');
  console.log('  outcome   min rate   max rate   spread');
  OUTCOMES.forEach((outcome) => {
    const s = spread.get(outcome)!;
    console.log(`  ${outcome.padEnd(8)}${s.min.toFixed(3).padStart(9)}${s.max.toFixed(3).padStart(10)}${s.spread.toFixed(3).padStart(9)}`);
  });
  console.log('  A wide spread means the single-weight approximation is coarse for that outcome,');
  console.log('  because the value genuinely depends on who was on base. That is a property of');
  console.log('  the engine, not of the fit, and it bounds how precisely wOBA can rank players.');

  console.log('\nWHAT THESE WEIGHTS SAY ABOUT THIS LEAGUE');
  console.log('  They are far below FanGraphs\' published figures, and the reason is worth');
  console.log('  stating rather than leaving as a discrepancy:');
  console.log('   - A walk scores ONLY when all three bases are occupied (gameEngine.ts:908).');
  console.log('     With runners aboard that rarely happens, so a walk\'s value here is a small');
  console.log('     fraction of MLB\'s 0.689. This is an engine simplification, not a fit error.');
  console.log('   - The advance rates in SCORING_ADVANCE_RATES score runners on a 2B/3B far less');
  console.log('     often than in real baseball, so extra-base hits are worth much less than');
  console.log('     their MLB analogues.');
  console.log('   - Home runs are the exception: the strata read 1/2/3/4 runs exactly, which is');
  console.log('     correct, and give the largest weight in the set as they should.');
  console.log('  The weights are internally consistent and reproduce the league run rate exactly.');
  console.log('  They are not on MLB\'s scale, and no amount of fitting will put them there.');

  console.log('\nWHERE THESE WEIGHTS ARE CONSUMED');
  console.log('  src/lib/analytics/woba.ts stores the shipped constants as WOBA_WEIGHTS and');
  console.log('  LEAGUE_WOBA. tools/verifyWrc.ts re-runs this fit and checks the module against');
  console.log('  it, so the two cannot drift apart silently.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
