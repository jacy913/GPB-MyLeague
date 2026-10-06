/**
 * What the season row will actually show, measured through the real module.
 *
 * Written because the PowerShell version of this query indexed the offset table wrongly and
 * printed an empty table rather than an error, which is the worst possible failure mode for a
 * measurement: it looked like a result. This reads the same constants `ParkPanel` reads, through
 * the same `climateMonthC`, so it cannot disagree with the screen by construction.
 */

import {
  ALL_PARK_PROFILES,
  CLIMATE_MONTHS,
  climateMonthC,
} from '../src/lib/analytics/parkProfile';

const rows = [...ALL_PARK_PROFILES.values()].map((profile) => {
  const temps = climateMonthC(profile);
  return {
    id: profile.teamId,
    climate: profile.dimensions.climate,
    mean: profile.climateCUsed,
    temps,
    lo: Math.min(...temps),
    hi: Math.max(...temps),
  };
});

console.log(`\nSEASON, APRIL TO OCTOBER (${CLIMATE_MONTHS.join(' ')})\n`);
console.log('id    regime         mean   ' + CLIMATE_MONTHS.map((m) => m.padStart(4)).join(''));
rows
  .sort((a, b) => a.mean - b.mean)
  .forEach((r) => {
    console.log(
      `${r.id.padEnd(5)} ${r.climate.padEnd(14)} ${String(r.mean).padStart(4)}   `
      + r.temps.map((t) => String(t).padStart(4)).join(''),
    );
  });

const coldest = rows.reduce((a, b) => (a.lo <= b.lo ? a : b));
const warmest = rows.reduce((a, b) => (a.hi >= b.hi ? a : b));
console.log(`\n  coldest month anywhere : ${coldest.lo}C (${coldest.id})`);
console.log(`  warmest month anywhere : ${warmest.hi}C (${warmest.id})`);
console.log(`  league annual-mean range: ${rows.reduce((a, b) => Math.min(a, b.mean), 99)}`
  + ` to ${rows.reduce((a, b) => Math.max(a, b.mean), -99)} C`);

const amps = rows.map((r) => r.hi - r.lo);
console.log(`  season amplitude        : ${Math.min(...amps)} to ${Math.max(...amps)} C`);

/*
 * DOES THE REGIME ACTUALLY CHANGE THE CURVE, or is the amplitude table decorative?
 *
 * THE COMPARISON IS BETWEEN REGIMES, NOT WITHIN ONE. The first version of this check grouped swings
 * by regime and looked for parks INSIDE a regime that differed, then printed
 * "*** the table is decorative ***" when none did. That verdict was wrong and the check was
 * structurally incapable of passing: the April-to-August swing is
 * `(mean + off[Aug]) - (mean + off[Apr])`, the park's own mean cancels out, and every park sharing a
 * regime therefore has an identical swing BY CONSTRUCTION.
 *
 * The question the comment in `parkProfile.ts` actually claims is whether the regimes differ from
 * EACH OTHER -- a continental `cold` climate swinging further than a maritime `cool_coastal` one.
 * That is what is measured below, and a single swing value per regime is the expected result rather
 * than a warning sign.
 */
console.log('\nAPRIL TO AUGUST SWING, BY REGIME\n');
const swingByRegime = new Map<string, number>();
rows.forEach((r) => {
  if (!swingByRegime.has(r.climate)) swingByRegime.set(r.climate, r.temps[4] - r.temps[0]);
});
const swings = [...swingByRegime.entries()].sort((a, b) => b[1] - a[1]);
swings.forEach(([regime, swing]) => console.log(`  ${regime.padEnd(14)} ${swing} C`));

const distinct = new Set(swings.map(([, s]) => s)).size;
console.log(
  `\n  distinct swings across ${swings.length} regimes: ${distinct}`
  + `${distinct > 1 ? '' : '  *** identical: the table adds nothing ***'}`,
);
console.log(
  `  warmest-to-coolest spread: ${swings[0][1] - swings[swings.length - 1][1]} C\n`,
);