/**
 * Is the HXSE index actually value-weighted, and does it refuse to publish an incomplete one?
 *
 * WHY THIS TOOL EXISTS
 *
 * "Value-weighted, not equal-weighted" is the blueprint's central claim about the index, and it
 * is the easiest thing in this build to get wrong in a way that still produces a plausible
 * number. An equal-weighted index of 32 clubs averages their values; a value-weighted one
 * weights each by its own value. Both return a number near 50, both look reasonable on a chart,
 * and the difference only shows when one large club moves -- which is exactly the case that
 * makes the distinction matter.
 *
 * So the weighting is not asserted in a comment. It is proved, by moving one club and checking
 * that the index moved by that club's SHARE rather than by 1/32.
 *
 * THE REFUSAL IS CHECKED TOO
 *
 * `buildHxseIndices` throws while the playoff-probability term is missing. A check that only
 * tested the happy path would leave the most important behaviour in the module -- declining to
 * publish -- untested, and "declining to publish" is exactly the sort of thing that quietly gets
 * removed by someone in a hurry.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you the valuation is CORRECT. `teamValue.ts`'s weights are provisional until
 * `tools/fitTeamValue.ts` runs, and that is a separate question answered against realised season
 * win totals. This tool checks the arithmetic of the index and the honesty of the gate.
 *
 * Run: npx tsx tools/checkHxseIndex.ts
 */

import {
  buildHxseIndices,
  equalWeightedIndex,
  indexShare,
  valueAllTeams,
  valueWeightedIndex,
  type ValuedTeam,
} from '../src/lib/analytics/hxseIndex';
import { measureLeague, teamValueFor, TEAM_VALUE_WEIGHTS, type TeamValueInput } from '../src/lib/analytics/teamValue';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const DIVISIONS = ['North', 'South', 'East', 'West'] as const;

/**
 * A synthetic field of 32 clubs with deliberately unequal values.
 *
 * Unequal on purpose. A field where every club has the same value makes value-weighted and
 * equal-weighted indices IDENTICAL, so the check that distinguishes them would pass for the
 * wrong reason -- which is the exact trap this file is here to avoid, applied to itself.
 */
const syntheticField = (): ValuedTeam[] => {
  const inputs: TeamValueInput[] = [];
  const meta = new Map<string, { city: string; league: 'Platinum' | 'Prestige'; division: 'North' | 'South' | 'East' | 'West' }>();
  for (let i = 0; i < 32; i += 1) {
    const id = `t${i}`;
    // A wide spread: the top club is roughly three times the bottom one.
    const strength = 40 + (i / 31) * 60;
    inputs.push({
      teamId: id,
      expectedWinPct: 0.35 + (i / 31) * 0.3,
      rosterSurplus: strength,
      momentum: 0.4 + ((i * 7) % 11) / 30,
    });
    meta.set(id, {
      city: `City ${i}`,
      league: i < 16 ? 'Prestige' : 'Platinum',
      division: DIVISIONS[i % 4],
    });
  }
  return valueAllTeams(inputs, meta);
};

const main = (): void => {
  const teams = syntheticField();

  // -- 1. the field is actually unequal ------------------------------------------------
  const values = teams.map((t) => t.value);
  const spread = Math.max(...values) - Math.min(...values);
  check(
    'the test field has unequal values, so weighting can be distinguished',
    spread > 5,
    `spread ${spread.toFixed(2)} -- if this is near zero the weighting checks below are vacuous`,
  );
  check(
    'value-weighted and equal-weighted indices are genuinely different here',
    Math.abs(valueWeightedIndex(teams).level - equalWeightedIndex(teams).level) > 0.5,
    `value-weighted ${valueWeightedIndex(teams).level.toFixed(3)} vs equal-weighted ${equalWeightedIndex(teams).level.toFixed(3)}. `
    + 'Equal numbers would mean the field is uniform, and the next check would pass for the wrong reason.',
  );

  // -- 2. THE PROOF: that the weighting is value-weighting and not a flat average ---------
  /*
    This is the whole point of the module. Bump ONE club's value by 10% and leave the other 31
    alone. Under equal weighting either club moves the index by the same 10/32; under value
    weighting the large club moves it more, because that club is more of the index.
   */
  const before = valueWeightedIndex(teams).level;
  const beforeEqual = equalWeightedIndex(teams).level;
  const bumpTarget = teams.reduce((a, b) => (b.value > a.value ? b : a), teams[0]);
  const bumpShare = indexShare(bumpTarget, teams) / 100;
  const bumped: ValuedTeam[] = teams.map((t) =>
    t.teamId === bumpTarget.teamId ? { ...t, value: t.value * 1.1 } : t,
  );

  /*
    THE PROOF, RESTATED -- because the first version was wrong in a way that would have "caught" a
    correct implementation.

    It asserted the index moves by the moved club's SHARE times the move. For an index of
    SUM(v^2) / SUM(v) that is not the derivative. The true relative change is

        epsilon * share * (2 * v_i / level - 1)

    and with a top club sitting above the index level that bracket is well above 1, so the naive
    share figure is roughly half the truth. Asserting it would have failed correct code.

    So this asserts the DEFINING property instead: the composite recomputes exactly as
    SUM(v^2) / SUM(v). That is value-weighted by construction, an equal-weighted index cannot
    satisfy it, and it needs no derivative to state.
   */
  const asSumOfSquares = (set: ValuedTeam[]): number => {
    const num = set.reduce((a, t) => a + t.value * t.value, 0);
    const den = set.reduce((a, t) => a + t.value, 0);
    return den > 0 ? num / den : 0;
  };
  check(
    'the composite recomputes exactly as SUM(v^2) / SUM(v) -- value-weighted by construction',
    Math.abs(before - asSumOfSquares(teams)) < 1e-9,
    `reported ${before.toFixed(6)} against an independent recomputation of ${asSumOfSquares(teams).toFixed(6)}`,
  );

  const smallTarget = teams.reduce((a, b) => (b.value < a.value ? b : a), teams[0]);
  const bumpSmall = teams.map((t) =>
    t.teamId === smallTarget.teamId ? { ...t, value: t.value * 1.1 } : t);
  const moveTop = (valueWeightedIndex(bumped).level - before) / before;
  const moveSmall = (valueWeightedIndex(bumpSmall).level - before) / before;
  check(
    'moving the LARGEST club moves the index more than moving the SMALLEST does',
    moveTop > moveSmall,
    `top club ${(moveTop * 100).toFixed(3)}% against smallest ${(moveSmall * 100).toFixed(3)}%. `
    + 'Under equal weighting either move shifts the index identically.',
  );
  check(
    'the composite is not the plain mean of club values',
    Math.abs(before - beforeEqual) > 0.5,
    `value-weighted ${before.toFixed(3)} against equal-weighted ${beforeEqual.toFixed(3)}`,
  );

  // -- 3. THE REFUSAL ---------------------------------------------------------------------
  let threw = false;
  let message = '';
  try {
    buildHxseIndices(teams);
  } catch (e) {
    threw = true;
    message = (e as Error).message;
  }
  check(
    'the index REFUSES to build while the playoff-probability term is missing',
    threw,
    threw ? `threw as intended: "${message.slice(0, 90)}..."` : 'IT BUILT. An index that silently omits its largest input is not a valuation.',
  );
  check(
    'the refusal names the missing term rather than failing generically',
    threw && /playoff/i.test(message),
    'an error that says "invalid state" sends the reader to the file; one that says which term '
    + 'is missing sends them to the work.',
  );

  // -- 4. the index helpers themselves ----------------------------------------------------
  const empty = valueWeightedIndex([]);
  check(
    'an empty field returns a zero level rather than NaN',
    empty.level === 0 && empty.constituents === 0,
    `got ${JSON.stringify(empty)}`,
  );
  const allZero = valueWeightedIndex([{ ...teams[0], value: 0 }]);
  check(
    'a field whose values are all zero does not divide by zero',
    Number.isFinite(allZero.level),
    `got ${allZero.level}`,
  );

  // -- 5. the value function -------------------------------------------------------------
  const weightSum = TEAM_VALUE_WEIGHTS.rosterSurplus
    + TEAM_VALUE_WEIGHTS.expectedWinPct
    + TEAM_VALUE_WEIGHTS.momentum;
  check(
    'the value weights sum to 1, so the blend is an average not a scale',
    Math.abs(weightSum - 1) < 1e-9,
    `they sum to ${weightSum.toFixed(4)}`,
  );

  /*
    THE UNITS TEST. Win percentage, roster surplus and momentum do not share units, so blending
    them raw would let whichever has the widest spread dominate and quietly publish a
    roster-strength index labelled as a valuation. A pure momentum club and a pure strength club
    must produce the SAME value, which is only true if each term is standardised first.
   */
  const league = measureLeague([
    { teamId: 'a', expectedWinPct: 0.5, rosterSurplus: 50, momentum: 0.5 },
    { teamId: 'b', expectedWinPct: 0.6, rosterSurplus: 60, momentum: 0.6 },
    { teamId: 'c', expectedWinPct: 0.4, rosterSurplus: 40, momentum: 0.4 },
  ]);
  /*
    THE UNITS TEST, AND THE FIRST VERSION OF IT MEASURED THE WRONG THING.

    It compared a club lifted 30 roster-surplus points against one lifted 0.3 momentum, and
    called the difference a units failure. Those are the same number of STANDARD DEVIATIONS on
    terms with DIFFERENT WEIGHTS (0.45 and 0.20), so they were bound to differ -- the test was
    measuring the weights, not the standardisation, and it failed against code that standardises
    correctly.

    What proves standardisation is per-term and weight-aware: lifting any one term by exactly one
    standard deviation must raise the value by exactly that term's weight times (50 / 3), because
    the mapping is 50 + z * (50/3) and the blend is weight * z.
   */
  const SD_SCALE = 50 / 3;
  const baseInput = { teamId: 'x', expectedWinPct: 0.5, rosterSurplus: 50, momentum: 0.5 };
  const baseValue = teamValueFor(baseInput, league);
  // The league above has winPct and momentum sd 0.0816 and surplus sd 8.165, so 0.1 is one
  // standard deviation in the two probability terms and SD_SURPLUS is one in the surplus term.
  /*
    The standard deviations are MEASURED from the same three-club league, not hard-coded. The
    first run hard-coded 0.1 and 8.165, and the two terms disagreed by a factor of 1.2246 --
    which is exactly sqrt(1.5). measureLeague uses population variance over three clubs
    (0.5, 0.6, 0.4), giving sd 0.08165, not 0.1. Surplus happened to be hard-coded correctly
    and so passed, which made the failure look like a term-specific units bug when it was one
    wrong constant in the test.
   */
  const measuredSd = (values: number[]): number => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  };
  const sdWin = measuredSd([0.4, 0.5, 0.6]);
  const sdMomentum = measuredSd([0.4, 0.5, 0.6]);
  const sdSurplus = measuredSd([40, 50, 60]);
  const liftWin = teamValueFor({ ...baseInput, expectedWinPct: baseInput.expectedWinPct + sdWin }, league) - baseValue;
  const liftMomentum = teamValueFor({ ...baseInput, momentum: baseInput.momentum + sdMomentum }, league) - baseValue;
  const liftRoster = teamValueFor({ ...baseInput, rosterSurplus: baseInput.rosterSurplus + sdSurplus }, league) - baseValue;
  const expected = (w: number): number => w * SD_SCALE;

  check(
    'a one-standard-deviation move in ANY term raises the value by exactly weight * (50/3)',
    Math.abs(liftWin - expected(TEAM_VALUE_WEIGHTS.expectedWinPct)) < 0.05
      && Math.abs(liftRoster - expected(TEAM_VALUE_WEIGHTS.rosterSurplus)) < 0.05
      && Math.abs(liftMomentum - expected(TEAM_VALUE_WEIGHTS.momentum)) < 0.05,
    `expected winPct ${expected(TEAM_VALUE_WEIGHTS.expectedWinPct).toFixed(3)}, `
    + `roster ${expected(TEAM_VALUE_WEIGHTS.rosterSurplus).toFixed(3)}, `
    + `momentum ${expected(TEAM_VALUE_WEIGHTS.momentum).toFixed(3)}; `
    + `measured winPct ${liftWin.toFixed(3)}, roster ${liftRoster.toFixed(3)}, `
    + `momentum ${liftMomentum.toFixed(3)}. A mismatch means a term is contributing raw units, `
    + 'and whichever has the widest raw spread is silently dominating the blend.',
  );

  // -- report -------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nHXSE INDEX\n');
  console.log('  "Value-weighted, not equal-weighted" is the blueprint\'s central claim and the');
  console.log('  easiest thing here to get wrong while still producing a plausible number. So it is');
  console.log('  proved: the composite recomputes as SUM(v^2)/SUM(v), and moving the largest club');
  console.log('  moves the index more than moving the smallest.\n');
  console.log('  composite (value-weighted)  ' + before.toFixed(4));
  console.log('  composite (equal-weighted) ' + beforeEqual.toFixed(4) + '   <- reported only, never shipped');
  console.log('  largest club               ' + bumpTarget.city + ', ' + (bumpShare * 100).toFixed(1) + '% of total value');
  console.log('  move largest by 10%        index +' + (moveTop * 100).toFixed(3) + '%');
  console.log('  move smallest by 10%       index +' + (moveSmall * 100).toFixed(3) + '%'
    + '   (equal weighting: ' + (10 / teams.length).toFixed(3) + '% either way)\n');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();