/**
 * Park Phase 2 -- does the derived profile actually do anything?
 *
 * The plan's acceptance criterion is a spread report, and the reason it is a report rather
 * than a pass/fail is this:
 *
 *   "If every park lands within 2% of every other, the data is not doing anything and that
 *    should be visible immediately rather than discovered in a season of results."
 *
 * A park file that is valid, complete and uniform produces no errors and an inert league. The
 * validator cannot see that -- every field is present and every enum is legal. Only a spread
 * can.
 *
 * So this prints every derived quantity's range across all 32 parks, flags any that is too
 * tight to matter, and reports the two extremes by name so a wrong answer is checkable
 * rather than merely plausible.
 *
 * It also checks the air density against a number that exists independently of this code: the
 * note in `parks.json`'s own schema says that at 5,280 ft "the air is about 85% as dense, so
 * the ball carries roughly 17% farther". That figure was written before the barometric formula
 * was implemented here, which makes it the only available evidence that the formula points in
 * the right direction rather than merely producing a plausible-looking number.
 *
 * Run: npx tsx tools/deriveParkProfile.ts
 */

import {
  ALL_PARK_PROFILES,
  ALTITUDE_FT,
  CLIMATE_C,
  airDensityRatio,
  barometricDensityRatio,
  barometricDensityRatioAtHeight,
  interpolateCorners,
  porchSymmetry,
  type ParkProfile,
} from '../src/lib/analytics/parkProfile';
import { INITIAL_TEAMS } from '../src/data/teams';

const cityOf = new Map(INITIAL_TEAMS.map((t) => [t.id, t.city]));

/**
 * A derived quantity narrower than this fraction of its own mean is treated as inert.
 *
 * From the plan's 2%. Applied to the RANGE as a fraction of the mean, so a quantity with a
 * small absolute spread is not flagged when its absolute scale is small too -- a wall area
 * that varies by 200 square feet on a base of 2,900 is a 7% swing and matters.
 */
const INERT_FRACTION = 0.02;

interface Stat {
  label: string;
  unit: string;
  values: number[];
  digits: number;
}

const describe = (v: number, digits: number): string => v.toFixed(digits);

const report = (profiles: ParkProfile[]): void => {
  const stats: Stat[] = [
    { label: 'mean wall distance', unit: 'ft', values: profiles.map((p) => p.meanWallFt), digits: 1 },
    { label: 'cf distance', unit: 'ft', values: profiles.map((p) => p.cfFt), digits: 0 },
    { label: 'lf - rf (porch)', unit: 'ft', values: profiles.map((p) => p.porchFt), digits: 1 },
    { label: 'centre excess', unit: 'ft', values: profiles.map((p) => p.centreExcessFt), digits: 1 },
    { label: 'wall area', unit: 'sq ft', values: profiles.map((p) => p.wallAreaSqFt), digits: 0 },
    { label: 'porch symmetry', unit: '0-1', values: profiles.map((p) => p.porchSymmetry), digits: 3 },
    { label: 'air density ratio', unit: 'x', values: profiles.map((p) => p.airDensityRatio), digits: 4 },
    { label: 'altitude channel', unit: 'x', values: profiles.map((p) => p.barometricRatio), digits: 4 },
    { label: 'climate channel', unit: 'x', values: profiles.map((p) => p.temperatureRatio), digits: 4 },
    { label: 'carry multiplier', unit: 'x', values: profiles.map((p) => p.carryMultiplier), digits: 4 },
  ];

  const byMean = (a: ParkProfile, b: ParkProfile, f: (p: ParkProfile) => number): number => f(a) - f(b);

  console.log('\nPARK PHASE 2 -- DERIVED PHYSICAL PROFILE\n');
  console.log(`  parks profiled          ${profiles.length}`);
  console.log(`  quantities derived      ${stats.length} per park, from 13 entered dimensions`);
  console.log('  outcome weights        NONE. HR / FB / GB / run factors are Phase 3 and are');
  console.log('                         deliberately absent -- see parkProfile.ts on why.');

  console.log('\n  SPREAD, ALL PARKS');
  console.log('    quantity                  min      max      range   range/mean   verdict');
  const inert: string[] = [];
  stats.forEach((s) => {
    const lo = Math.min(...s.values);
    const hi = Math.max(...s.values);
    const range = hi - lo;
    const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length;
    const fraction = mean === 0 ? 0 : range / Math.abs(mean);
    const inertNow = fraction < INERT_FRACTION;
    if (inertNow) inert.push(s.label);
    console.log(
      `    ${s.label.padEnd(24)}${describe(lo, s.digits).padStart(8)}${describe(hi, s.digits).padStart(9)}`
      + `${describe(range, s.digits).padStart(10)}${(fraction * 100).toFixed(1).padStart(11)}%`
      + `${inertNow ? '   INERT' : ''}`,
    );
  });

  if (inert.length > 0) {
    console.log(
      `\n  WARN  ${inert.length} derived ${inert.length === 1 ? 'quantity is' : 'quantities are'} inert:`
      + `\n        ${inert.join(', ')}`,
    );
    console.log(
      '        A range under 2% of the mean cannot move a simulation. This is not a bug in the' +
        '\n        derivation -- it is a fact about the 32 values, and it should be fixed in the' +
        '\n        data before Phase 3 picks coefficients that assume these things differ.',
    );
  } else {
    console.log('\n  Every derived quantity varies by more than 2% of its own mean. The data is live.');
  }

  // --- the extremes, by name, so a wrong answer is checkable -----------------------
  const airDensity = (p: ParkProfile) => p.airDensityRatio;
  const thinnest = [...profiles].sort((a, b) => byMean(a, b, airDensity))[0];
  const densest = [...profiles].sort((a, b) => byMean(a, b, airDensity))[profiles.length - 1];
  const biggestPorch = [...profiles].sort((a, b) => Math.abs(b.porchFt) - Math.abs(a.porchFt))[0];
  const shortestCf = [...profiles].sort((a, b) => a.cfFt - b.cfFt)[0];

  console.log('\n  THE EXTREMES, BY NAME');
  console.log(`    thinnest air      ${thinnest.teamId} (${cityOf.get(thinnest.teamId) ?? '?'})`);
  console.log(`                      density ${describe(thinnest.airDensityRatio, 4)}, `
    + `${ALTITUDE_FT[thinnest.dimensions.altitude]} ft, ${CLIMATE_C[thinnest.dimensions.climate]} C`
    + ` -> carry x${describe(thinnest.carryMultiplier, 3)}`);
  console.log(`    densest air        ${densest.teamId} (${cityOf.get(densest.teamId) ?? '?'})`);
  console.log(`                      density ${describe(densest.airDensityRatio, 4)}, `
    + `${ALTITUDE_FT[densest.dimensions.altitude]} ft, ${CLIMATE_C[densest.dimensions.climate]} C`
    + ` -> carry x${describe(densest.carryMultiplier, 3)}`);
  console.log(`    biggest porch gap ${biggestPorch.teamId} (${cityOf.get(biggestPorch.teamId) ?? '?'})`);
  console.log(`                      lf ${biggestPorch.lfFt} / rf ${biggestPorch.rfFt} -> `
    + `${describe(biggestPorch.porchFt, 0)} ft ${biggestPorch.porchFt >= 0 ? 'left' : 'right'}`);
  console.log(`    shortest to centre ${shortestCf.teamId} (${cityOf.get(shortestCf.teamId) ?? '?'})`);
  console.log(`                      cf ${shortestCf.cfFt} ft, wall ${shortestCf.dimensions.wallHeightFt} ft`);

  // --- the altitude distribution, which is a data question not a maths one ---------
  const byAltitude = new Map<string, number>();
  profiles.forEach((p) => {
    const k = p.dimensions.altitude;
    byAltitude.set(k, (byAltitude.get(k) ?? 0) + 1);
  });
  console.log('\n  ALTITUDE MIX');
  console.log(`    ${['sea', 'moderate', 'high', 'extreme'].map(
    (k) => `${k} ${byAltitude.get(k) ?? 0}`,
  ).join('   ')}`);
  const seaCount = byAltitude.get('sea') ?? 0;
  if (seaCount > profiles.length / 2) {
    console.log(
      `    WARN  ${seaCount} of ${profiles.length} parks are at sea level. That is a choice about`
        + `\n          your league rather than a fault, but it caps how much of the altitude`
        + `\n          signal the league can show: the densest park is only`
        + ` x${describe(densest.carryMultiplier, 3)} carry against x${describe(thinnest.carryMultiplier, 3)}`
        + ` for the thinnest.`,
    );
  }

  // --- the interpolation, which is arithmetic and must simply be right -------------
  const sample = { lfFt: 330, cfFt: 400, rfFt: 350 };
  const corners = interpolateCorners(sample.lfFt, sample.cfFt, sample.rfFt);
  // Each derived corner must sit between ITS OWN corner and centre.
  //
  // The first version compared RCF against `max(lf, rf)`, which is the wrong bound: for a park
  // whose left corner is the shorter one, that asks whether RCF sits beyond the SHORT corner,
  // and it reported "ORDERING IS WRONG" on a correct interpolation. The test was checking a
  // property the formula never promised.
  const cornerOrdering = sample.lfFt < corners.lcfFt
    && corners.lcfFt < sample.cfFt
    && sample.rfFt < corners.rcfFt
    && corners.rcfFt < sample.cfFt;

  console.log('\n  THE CORNER INTERPOLATION');
  console.log(`    lf ${sample.lfFt} / cf ${sample.cfFt} / rf ${sample.rfFt}`);
  console.log(`    ->  lcf ${describe(corners.lcfFt, 1)}  rcf ${describe(corners.rcfFt, 1)}`);
  console.log(`    each sits 12.5% of its gap from centre toward its corner, and inside that gap: `
    + `${cornerOrdering ? 'yes' : 'NO -- ORDERING IS WRONG'}`);
  console.log(`    porch symmetry of that park: ${describe(porchSymmetry(sample.lfFt, sample.cfFt, sample.rfFt), 4)}`);

  // --- the independent check on the physics ---------------------------------------
  /*
   * `parks.json`'s schema note says, of extreme altitude: "At 5,280 ft the air is about 85% as
   * dense, so the ball carries roughly 17% farther." That sentence was written before the
   * barometric formula was implemented in parkProfile.ts, so it is the only figure available
   * that the formula was not fitted to.
   *
   * It describes the ALTITUDE channel alone, and it has to be compared against that channel.
   * The first version here compared it against `airDensityRatio`, which multiplies in the
   * climate channel, and got 0.823 against the schema's 0.85 -- a 3% disagreement that looks
   * like a physics error and is not. `barometricDensityRatio` returns 0.8543 at 5,280 ft and
   * 1/0.8543 - 1 = 17.05%, which is both numbers in the sentence.
   *
   * 5,280 ft is not any band's midpoint, so the formula is evaluated at that height directly
   * rather than at 'extreme' (5,750 ft). Using the band would have compared a band midpoint
   * against a specific height and called the difference an error.
   */
  const MILE_HIGH_FT = 5280;
  const atMileHigh = barometricDensityRatioAtHeight(MILE_HIGH_FT);
  console.log('\n  THE PHYSICS, CHECKED AGAINST A NUMBER THIS CODE DID NOT PRODUCE');
  console.log(`    barometric density ratio at ${MILE_HIGH_FT} ft   ${describe(atMileHigh, 4).padStart(8)}`);
  console.log(`    carry multiplier                                x${describe(1 / atMileHigh, 4).padStart(7)}`);
  console.log('    parks.json schema says "about 85% as dense" and "roughly 17% farther"');
  console.log('    (compared against the ALTITUDE channel alone -- that is what the note describes)');
  console.log('    THIS CALLS THE LIBRARY. The first version re-derived the formula inside this');
  console.log('    tool to stay "independent" of it, and consequently agreed with the schema while');
  console.log('    the library was returning NaN -- reporting 32/32 and exiting 0.');
  const densityOk = Math.abs(atMileHigh - 0.85) < 0.01;
  const carryOk = Math.abs((1 / atMileHigh - 1) - 0.17) < 0.01;
  console.log(`    agreement: density ${densityOk ? 'yes' : 'NO'}, carry ${carryOk ? 'yes' : 'NO'}`);

  /*
   * FINITENESS, and this is the check that was missing.
   *
   * A NaN anywhere in a derived profile is not a cosmetic problem: it propagates silently
   * through every downstream comparison, because `NaN < x` and `NaN > x` are both false, so a
   * sort leaves it wherever it was and every "is this park an outlier" test quietly answers
   * no. The spread table printed `NaN` for four quantities and the tool still declared the
   * parks valid, because validity was being read off the number of parks rather than off the
   * numbers in them.
   *
   * So this walks every numeric field of every profile and refuses on a single non-finite
   * value, naming the park and the field.
   */
  const nonFinite: string[] = [];
  profiles.forEach((profile) => {
    (Object.keys(profile) as Array<keyof ParkProfile>).forEach((key) => {
      const value = profile[key];
      if (typeof value === 'number' && !Number.isFinite(value)) {
        nonFinite.push(`${profile.teamId}.${String(key)} = ${String(value)}`);
      }
    });
  });
  console.log('\n  FINITENESS');
  console.log(`    every numeric field of all ${profiles.length} profiles finite: `
    + `${nonFinite.length === 0 ? 'yes' : 'NO'}`);
  if (nonFinite.length > 0) {
    nonFinite.slice(0, 6).forEach((n) => console.log(`      ${n}`));
    console.log(`      ${nonFinite.length} non-finite value(s). A NaN here propagates silently: every`);
    console.log('      comparison against it is false, so sorts leave it in place and outlier');
    console.log('      tests answer "no" without ever saying so.');
  }

  // And the climate channel, so the two are separately auditable rather than only combined.
  console.log('\n  THE TWO CHANNELS, SEPARATELY');
  console.log(`    temperate at sea level       air x${describe(airDensityRatio('sea', 'temperate'), 4)}`
    + `  (reference: must be exactly 1.0000)`);
  console.log(`    cold at sea level            air x${describe(airDensityRatio('sea', 'cold'), 4)}  (thicker)`);
  console.log(`    hot_dry at sea level         air x${describe(airDensityRatio('sea', 'hot_dry'), 4)}  (thinner)`);
  console.log(`    extreme altitude, temperate  air x${describe(airDensityRatio('extreme', 'temperate'), 4)}`);
  console.log(`      of which altitude          air x${describe(barometricDensityRatio('extreme'), 4)}`);
  console.log(`      of which climate          air x${describe(airDensityRatio('extreme', 'temperate') / barometricDensityRatio('extreme'), 4)}`);
  const referenceOk = Math.abs(airDensityRatio('sea', 'temperate') - 1) < 1e-12;
  console.log(`    the reference point is exactly 1: ${referenceOk ? 'yes' : 'NO'}`);

  const problems: string[] = [];
  if (profiles.length !== INITIAL_TEAMS.length) {
    problems.push(`profiled ${profiles.length} parks for ${INITIAL_TEAMS.length} teams`);
  }
  if (!cornerOrdering) problems.push('the corner interpolation does not sit inside its own gap');
  if (nonFinite.length > 0) problems.push(`${nonFinite.length} non-finite derived value(s), e.g. ${nonFinite[0]}`);
  if (!referenceOk) problems.push(`the reference park scores ${airDensityRatio('sea', 'temperate')}, must be exactly 1`);
  if (!densityOk) problems.push(`barometric density at 5,280 ft is ${atMileHigh.toFixed(4)}, schema says about 0.85`);
  if (!carryOk) problems.push(`carry at 5,280 ft is ${(1 / atMileHigh - 1).toFixed(3)}, schema says about 0.17`);
  if (inert.length > 0) problems.push(`${inert.length} derived ${inert.length === 1 ? 'quantity is' : 'quantities are'} inert`);

  if (problems.length > 0) {
    console.log(`\n  ${problems.length} PROBLEM(S)\n`);
    problems.forEach((p) => console.log(`    - ${p}`));
    console.log();
    process.exitCode = 1;
    return;
  }
  console.log('\n  32/32 parks profiled. The interpolation is sound and the physics agrees with the');
  console.log('  figure written into the schema before the formula existed.\n');
};

report([...ALL_PARK_PROFILES.values()]);