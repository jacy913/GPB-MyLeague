/*
 * Parks: per-park altitude must sit inside its band, the season chart must be on one scale for
 * the whole league, and Arsagam's own curve must actually swing.
 *
 * The first two are data rules that `checkParks` cannot own, because they are about the RELATION
 * between two fields on the same record rather than about either field's legality. The third is the
 * whole reason `seasonOffsetC` exists, and it is the assertion most likely to rot: widen the regime
 * tables one day and a per-park override that no longer reads as unusual stops being checked by
 * anything.
 */
import parksJson from '../src/data/parks.json';
import {
  ALL_PARK_PROFILES,
  CLIMATE_MONTHS,
  CLIMATE_MONTH_OFFSET_C,
  LEAGUE_SEASON_TEMP_C,
  climateMonthC,
  toF,
} from '../src/lib/analytics/parkProfile';
import type { AltitudeBand, ParkProfile } from '../src/lib/analytics/parkProfile';

const BAND_FT: Record<AltitudeBand, [number, number]> = {
  sea: [-10, 100],
  moderate: [101, 1150],
  high: [3000, 4500],
  extreme: [5000, 6500],
};

const problems: string[] = [];
const rows = [...ALL_PARK_PROFILES.values()];
const byId = new Map<string, ParkProfile>(rows.map((p) => [p.teamId, p]));

// --- 1. every park has an altitudeFt, inside its band ------------------------
console.log('\n  PER-PARK ALTITUDE, INSIDE ITS BAND\n');
const seen = new Set<number>();
for (const p of rows) {
  const ft = p.altitudeFtShown;
  const [lo, hi] = BAND_FT[p.dimensions.altitude];
  const stamped = p.dimensions.altitudeFt;
  if (stamped === undefined) problems.push(`${p.teamId}: no altitudeFt in the data`);
  if (ft < lo || ft > hi) problems.push(`${p.teamId}: ${ft} ft is outside ${p.dimensions.altitude} (${lo}..${hi})`);
  seen.add(ft);
}
for (const band of Object.keys(BAND_FT) as AltitudeBand[]) {
  const inBand = rows.filter((p) => p.dimensions.altitude === band);
  const fts = inBand.map((p) => p.altitudeFtShown).sort((a, b) => a - b);
  console.log(
    `  ${band.padEnd(9)} ${String(inBand.length).padStart(2)} parks   `
    + `${fts[0]}..${fts[fts.length - 1]} ft   band ${BAND_FT[band][0]}..${BAND_FT[band][1]}`,
  );
}
console.log(`\n  ${seen.size} distinct heights across ${rows.length} parks`);
// Not "every height distinct" -- two parks at the same altitude is ordinary. But if the generator
// collapsed them all onto one figure the field would be decoration, so the floor is a handful.
if (seen.size < 20) problems.push(`only ${seen.size} distinct altitudes across ${rows.length} parks`);

// The band midpoint is still what the physics reads, and the per-park height is only a label. If
// `altitudeFtShown` ever fell back to the midpoint for every park, the label would be the band and
// the panel would be quietly printing a derived value as if it were an entered one.
console.log('\n  THE PHYSICS STILL READS THE BAND\n');
const mismatched = rows.filter((p) => p.altitudeFtShown !== p.altitudeFtUsed).length;
console.log(`  ${mismatched} of ${rows.length} parks show a height other than their band midpoint`);
if (mismatched === 0) {
  problems.push('no park shows a per-park altitude: altitudeFtShown is falling back to the band');
}

// --- 2. one scale for the whole league ---------------------------------------
console.log('\n  THE SEASON CHART, IN FAHRENHEIT, ON ONE SCALE FOR ALL 32\n');
const { min, max } = LEAGUE_SEASON_TEMP_C;
console.log(`  league floor ${Math.round(toF(min))}F   ceiling ${Math.round(toF(max))}F   span ${Math.round(toF(max) - toF(min))}F`);

// This is the assertion that matters. Under the old per-park scaling, these two rows were
// IDENTICAL in shape by construction, because each normalised its own min to 0 and its own max to
// 1. If they ever read identically again, the shared scale has been reverted.
const coldest = rows.reduce((a, b) => (Math.min(...climateMonthC(a)) < Math.min(...climateMonthC(b)) ? a : b));
const hottest = rows.reduce((a, b) => (Math.max(...climateMonthC(a)) > Math.max(...climateMonthC(b)) ? a : b));
const coldestShape = climateMonthC(coldest).map((t) => (t - min) / (max - min)).map((v) => v.toFixed(3));
const hottestShape = climateMonthC(hottest).map((t) => (t - min) / (max - min)).map((v) => v.toFixed(3));
console.log(`  coldest  ${coldest.teamId.padEnd(5)} ${coldestShape.join(' ')}`);
console.log(`  hottest  ${hottest.teamId.padEnd(5)} ${hottestShape.join(' ')}`);
if (coldestShape.join() === hottestShape.join()) {
  problems.push('the coldest and hottest parks draw the same shape: the scale is per-park again');
}

// The user asked for this directly: -1 at one park must not look like 14 at another.
console.log('\n  A COLD MONTH AND A MILD ONE MUST NOT LOOK ALIKE\n');
const allMonths = rows.flatMap((p) => climateMonthC(p).map((t) => ({ t, id: p.teamId })));
allMonths.sort((a, b) => a.t - b.t);
const floor = allMonths[0];
const mild = allMonths.find((m) => m.t >= floor.t + 15 && m.id !== floor.id);
if (!mild) {
  problems.push('no park sits 15C above the league\'s coldest baseball month');
} else {
  const hFloor = (floor.t - min) / (max - min);
  const hMild = (mild.t - min) / (max - min);
  console.log(`  ${floor.id} ${Math.round(toF(floor.t))}F -> bar ${(hFloor * 100).toFixed(1)}%`);
  console.log(`  ${mild.id} ${Math.round(toF(mild.t))}F -> bar ${(hMild * 100).toFixed(1)}%`);
  console.log(`  visible difference: ${((hMild - hFloor) * 100).toFixed(1)} points of bar height`);
  if (hMild - hFloor < 0.08) {
    problems.push(`15C apart reads as only ${((hMild - hFloor) * 100).toFixed(1)} points of bar`);
  }
}

// --- 3. Arsagam's own curve, which is why the field exists ---------------------
console.log('\n  ARSAGAM: A DENVER-SHAPED PARK IN AN OCEAN OF REGIME-SHAPED ONES\n');
const ars = byId.get('ars');
if (!ars) {
  problems.push('ars is missing');
} else {
  const own = ars.dimensions.seasonOffsetC;
  if (!own) {
    problems.push('ars has no seasonOffsetC: its season will read as the flat hot_dry regime curve');
  } else {
    const hotDry = CLIMATE_MONTH_OFFSET_C.hot_dry;
    console.log(`  regime hot_dry  ${hotDry.map(String).join(' ')}   swing ${hotDry[4] - hotDry[0]}C`);
    console.log(`  ars own         ${own.map(String).join(' ')}   swing ${own[4] - own[0]}C`);
    console.log(`  ars in F        ${climateMonthC(ars).map((t) => `${Math.round(toF(t))}F`).join(' ')}`);
    const swing = own[4] - own[0];
    if (swing <= hotDry[4] - hotDry[0]) {
      problems.push(`ars swings ${swing}C, which is no deeper than the ${hotDry[4] - hotDry[0]}C it replaced`);
    }
    // "Cold in April and October" was the ask. Check both ends are actually the cold ones.
    if (own[0] >= own[4] || own[6] >= own[4]) {
      problems.push('ars is not cold in April and October: both are at or above its August');
    }
  }
  console.log(`\n  ars altitude ${ars.dimensions.altitude} at ${ars.altitudeFtShown} ft `
    + `(density from ${ars.altitudeFtUsed} ft)`);
  if (ars.dimensions.altitude !== 'extreme') problems.push('ars is not in the extreme band');
}

// --- 4. the regime fallback still works ---------------------------------------
console.log('\n  THE OTHER 31 ARE UNTOUCHED\n');
const overridden = rows.filter((p) => p.dimensions.seasonOffsetC);
console.log(`  ${overridden.length} of ${rows.length} parks carry their own curve`);
if (overridden.length !== 1) {
  problems.push(`${overridden.length} parks override the regime curve; expected exactly 1`);
}

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('  every park has an altitude inside its band, one league-wide season scale, and '
  + 'Arsagam swings harder than the regime it replaced.');