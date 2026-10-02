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
  type HxseIndices,
  type ValuedTeam,
} from '../src/lib/analytics/hxseIndex';
import {
  buildValueInputs,
  measureLeague,
  teamValueFor,
  TEAM_VALUE_TERMS,
  TEAM_VALUE_WEIGHTS,
  type TeamValueInput,
} from '../src/lib/analytics/teamValue';

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
      // Correlated with the others on purpose, as it is in the real league: a strong roster
      // produces both a better consensus read and a likelier postseason. Independent synthetic
      // columns would make the standardisation test pass for reasons that never occur live.
      playoffProbability: ((i / 31) * 0.3) ** 2,
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

  /*
    THE GATE, WHICH HAS CHANGED STATE SINCE THIS FILE WAS FIRST WRITTEN.

    It originally asserted that `buildHxseIndices` THROWS while the playoff-probability term is
    missing, and that the error names the term. That was correct then: there was no source for the
    term, so refusing to publish was the honest behaviour.

    The Monte Carlo now exists and the weights are fitted with the term included, so
    PLAYOFF_PROBABILITY_AVAILABLE is true and the index builds. Asserting a throw from here on
    would be asserting that the project stays unfinished -- a check that fails the moment the work
    lands, which is the mirror image of the "check that fails at random" problem.

    So the gate is tested from the side that actually carries risk now. The danger is no longer
    "the index publishes while incomplete"; it is the flag claiming completeness while the
    valuation quietly ignores the term. PLAYOFF_PROBABILITY_AVAILABLE is a constant, and a constant
    can be flipped by anyone in a hurry. So: build the composite, then prove a club's
    playoffProbability actually moves it.
   */
  let indices: HxseIndices | null = null;
  let buildError = '';
  try {
    indices = buildHxseIndices(teams);
  } catch (e) {
    buildError = (e as Error).message;
  }
  check(
    'the index BUILDS now that the playoff term has a source and the weights are fitted with it',
    indices !== null,
    indices !== null
      ? `composite ${indices.composite.level.toFixed(4)} across ${indices.composite.constituents} clubs, `
      + `${Object.keys(indices.divisions).length} divisions, ${Object.keys(indices.leagues).length} leagues`
      : `it still refused: "${buildError.slice(0, 100)}..." -- the flag and the value function disagree`,
  );
  check(
    'and every division and league actually reports a reading',
    indices !== null
      && Object.values(indices.divisions).every((d) => d.constituents === 8)
      && Object.values(indices.leagues).every((l) => l.constituents === 16),
    indices === null
      ? 'not built'
      : `divisions ${Object.entries(indices.divisions).map(([k, v]) => `${k}:${v.constituents}`).join(' ')}, `
      + `leagues ${Object.entries(indices.leagues).map(([k, v]) => `${k}:${v.constituents}`).join(' ')}. `
      + 'Eight per division and sixteen per league is what the 32-club structure requires.',
  );

  /*
    THE ONE THAT MATTERS. Prove the term is not merely declared present.
   */
  const playoffCarries: number[] = [];
  {
    const mid = teams[16];
    const knocked = buildValueInputs({
      teamIds: teams.map((t) => t.teamId),
      consensusWinPctById: new Map(teams.map((t) => [t.teamId, 0.5])),
      surplusById: new Map(teams.map((t) => [t.teamId, 0])),
      playoffProbabilityById: new Map(teams.map((t) => [t.teamId, t.teamId === mid.teamId ? 1 : 0])),
      games: [],
    });
    const other = buildValueInputs({
      teamIds: teams.map((t) => t.teamId),
      consensusWinPctById: new Map(teams.map((t) => [t.teamId, 0.5])),
      surplusById: new Map(teams.map((t) => [t.teamId, 0])),
      playoffProbabilityById: new Map(teams.map((t) => [t.teamId, 0])),
      games: [],
    });
    const leagueA = measureLeague(knocked);
    const leagueB = measureLeague(other);
    playoffCarries.push(teamValueFor(knocked.find((i) => i.teamId === mid.teamId) as TeamValueInput, leagueA)
      - teamValueFor(other.find((i) => i.teamId === mid.teamId) as TeamValueInput, leagueB));
  }
  check(
    'a club made certain by playoff probability is valued far above one with none',
    playoffCarries[0] > 5,
    `the same club differs by ${playoffCarries[0].toFixed(2)} points of value on playoff odds alone. `
    + 'If this were near zero the PLAYOFF_PROBABILITY_AVAILABLE flag would be a lie, and the index '
    + 'would publish a composite that quietly omits the term the flag claims is present.',
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
  const weightSum = TEAM_VALUE_TERMS.reduce((sum, term) => sum + TEAM_VALUE_WEIGHTS[term], 0);
  check(
    'the value weights sum to 1 across ALL four terms, so the blend is an average not a scale',
    Math.abs(weightSum - 1) < 1e-9 && TEAM_VALUE_TERMS.length === 4,
    `${TEAM_VALUE_TERMS.length} terms summing to ${weightSum.toFixed(6)}: `
    + TEAM_VALUE_TERMS.map((t) => `${t} ${TEAM_VALUE_WEIGHTS[t]}`).join(', '),
  );
  check(
    'every weight is positive -- a term the fit could not justify ships at a floor, never negative',
    TEAM_VALUE_TERMS.every((term) => TEAM_VALUE_WEIGHTS[term] > 0),
    TEAM_VALUE_TERMS.map((t) => `${t} ${TEAM_VALUE_WEIGHTS[t]}`).join(', '),
  );

  /*
    THE UNITS TEST. The four terms do not share units -- win percentage is 0-1, roster surplus is
    points on the league scale, momentum is a capped win rate, playoff probability is 0-1. Blending
    them raw would let whichever has the widest spread dominate and quietly publish a
    roster-strength index labelled as a valuation.

    What proves standardisation is per-term and weight-aware: lifting any one term by exactly one
    standard deviation must raise the value by exactly that term's weight times (50 / 3), because
    the mapping is 50 + z * (50/3) and the blend is weight * z.

    TWO EARLIER VERSIONS OF THIS TEST WERE WRONG, and both failed against correct code.

    The first compared a club lifted 30 roster-surplus points against one lifted 0.3 momentum and
    called the difference a units failure. Those are the same number of STANDARD DEVIATIONS on
    terms with DIFFERENT WEIGHTS, so they were bound to differ -- it was measuring the weights,
    not the standardisation.

    The rewrite then hard-coded sd 0.1 for the probability terms when measureLeague gives 0.08165
    over three clubs (population variance). Surplus was hard-coded correctly and passed, which made
    the failure look like a term-specific units bug when it was one wrong constant in the test.

    So the sds below are MEASURED from the league, and the loop runs over TEAM_VALUE_TERMS rather
    than naming terms individually -- which means a term added later is covered by this check
    automatically instead of silently escaping it.
   */
  const SD_SCALE = 50 / 3;
  // Every term sits exactly at its league mean, so the base value is a clean 50 and any lift is
  // attributable to the single term that moved.
  const leagueRows: TeamValueInput[] = [
    { teamId: 'a', expectedWinPct: 0.5, rosterSurplus: 50, momentum: 0.5, playoffProbability: 0.20 },
    { teamId: 'b', expectedWinPct: 0.6, rosterSurplus: 60, momentum: 0.6, playoffProbability: 0.40 },
    { teamId: 'c', expectedWinPct: 0.4, rosterSurplus: 40, momentum: 0.4, playoffProbability: 0.00 },
  ];
  const league = measureLeague(leagueRows);
  const baseInput: TeamValueInput = {
    teamId: 'x',
    expectedWinPct: 0.5,
    rosterSurplus: 50,
    momentum: 0.5,
    playoffProbability: 0.2,
  };
  const baseValue = teamValueFor(baseInput, league);

  const measuredSd = (values: number[]): number => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  };
  const leagueColumn = (pick: (i: TeamValueInput) => number): number[] =>
    [0, 1, 2].map((i) => pick(leagueRows[i]));

  const liftReport = TEAM_VALUE_TERMS.map((term) => {
    const sd = measuredSd(leagueColumn((i) => i[term]));
    const lifted = teamValueFor({ ...baseInput, [term]: baseInput[term] + sd }, league) - baseValue;
    const want = TEAM_VALUE_WEIGHTS[term] * SD_SCALE;
    return { term, sd, lifted, want, ok: Math.abs(lifted - want) < 0.05 };
  });
  const liftFails = liftReport.filter((r) => !r.ok);

  check(
    'a one-standard-deviation move in ANY term raises the value by exactly weight * (50/3)',
    liftFails.length === 0,
    liftFails.length === 0
      ? TEAM_VALUE_TERMS.map((t) => `${t} ${liftReport.find((r) => r.term === t)?.lifted.toFixed(2)}/${liftReport.find((r) => r.term === t)?.want.toFixed(2)}`).join('  ')
      : liftFails.map((r) => `${r.term}: measured ${r.lifted.toFixed(3)}, expected ${r.want.toFixed(3)} (sd ${r.sd.toFixed(4)})`).join('; ')
      + '. A mismatch means a term is contributing raw units, and whichever has the widest raw '
      + 'spread is silently dominating the blend.',
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