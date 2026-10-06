/**
 * What the park numbers actually look like, measured rather than assumed.
 *
 * The panel draws bars for `hrFactor`, `fbFactor`, `gbFactor`, `runFactor` and the ten `terms`. A bar
 * needs a scale, and the scale has to come from the range the values really occupy -- picking one by
 * intuition is how a chart ends up making a 3% effect look like a 30% one, which in a screen whose
 * whole claim is "here is the working" would be a lie told in the visual language rather than in a
 * sentence.
 *
 * So: dump the real ranges across all 32 parks, and the extremes, and the archetype parks by name.
 */

import { ALL_PARK_PROFILES } from '../src/lib/analytics/parkProfile';
import { ALL_PARK_FACTORS } from '../src/lib/analytics/parkFactors';
import type { ParkFactors } from '../src/lib/analytics/parkFactors';

const rows = [...ALL_PARK_FACTORS.values()];
const factorKeys = ['hrFactor', 'fbFactor', 'gbFactor', 'runFactor'] as const;
const termKeys = Object.keys(rows[0].terms) as (keyof ParkFactors['terms'])[];

const stat = (label: string, values: number[]) => {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(
    `  ${label.padEnd(14)} min ${min.toFixed(3)}  max ${max.toFixed(3)}  mean ${mean.toFixed(3)}`
    + `  span ${span.toFixed(3)}`,
  );
};

console.log('\nPARK FACTOR RANGES  (32 parks)\n');
console.log('  OUTCOME FACTORS');
factorKeys.forEach((k) => stat(k, rows.map((r) => r[k])));
stat('fatigueRate', rows.map((r) => r.pitcherFatigueRate));

console.log('\n  TERMS');
termKeys.forEach((k) => stat(k, rows.map((r) => r.terms[k])));

console.log('\n  WORST-CASE DEVIATION FROM 1.000 (what a bar scale must hold)');
factorKeys.forEach((k) => {
  const devs = rows.map((r) => Math.abs(r[k] - 1));
  stat(k, devs);
});
termKeys.forEach((k) => {
  const devs = rows.map((r) => Math.abs(r.terms[k] - 1));
  stat(k, devs);
});

console.log('\n  ARCHETYPE PARKS\n');
const wanted = ['and', 'fey', 'sta', 'des', 'cal', 'hou'];
for (const id of wanted) {
  const f = ALL_PARK_FACTORS.get(id);
  const p = ALL_PARK_PROFILES.get(id);
  if (!f || !p) {
    console.log(`  ${id}: MISSING`);
    continue;
  }
  console.log(
    `  ${id}  ${p.lfFt}/${p.lcfFt}/${p.cfFt}/${p.rcfFt}/${p.rfFt} ft`
    + `  wall ${p.dimensions.wallHeightFt}ft ${p.dimensions.wallColor}`
    + `  roof ${p.dimensions.roof}  alt ${p.dimensions.altitude}`,
  );
  console.log(
    `        hr ${f.hrFactor.toFixed(3)}  fb ${f.fbFactor.toFixed(3)}`
    + `  gb ${f.gbFactor.toFixed(3)}  run ${f.runFactor.toFixed(3)}`
    + `  fat ${f.pitcherFatigueRate.toFixed(3)}`,
  );
  console.log(
    `        terms ${termKeys.map((k) => `${k} ${f.terms[k].toFixed(2)}`).join('  ')}`,
  );
  console.log('');
}

/* The scale the bars will use, stated as a constant so the component and this agree. */
const maxDev = Math.max(
  ...rows.flatMap((r) => [...factorKeys.map((k) => Math.abs(r[k] - 1)), Math.abs(r.pitcherFatigueRate)]),
);
console.log(`  MAX FACTOR DEVIATION FROM 1.000: ${maxDev.toFixed(4)}`);
console.log('  -> a bar scale of +/-0.30 holds every factor with headroom; +/-0.20 would clip.\n');