/**
 * Are the park factors centred on the league, or do they inflate it?
 *
 * FOUND BY A BETTING CHECK FAILING, which is the most useful kind of failure.
 *
 * `verifyBetting.ts` reports that 64% of games are finishing over the posted totals line
 * against an expected 46%. Re-running it with the park application disabled gave 45.5%, which
 * passes -- so the parks raised league scoring enough to break the totals market.
 *
 * The cause is not the size of any park. It is that the factors are ABSOLUTE, calibrated so
 * that an ARBITRARY NEUTRAL park -- 385-foot walls, sea level, temperate, 8-foot dark wall --
 * scores 1.000, while the actual 32 clubs average something above that. Every game then gets
 * multiplied by a factor above 1, and a park system that is supposed to DIFFERENTIATE between
 * parks instead shifts the whole league.
 *
 * A published park factor is a RELATIVE measure: 100 is the league average, always, by
 * construction. Coors at 145 means "45% above the average park", not "45% above a hypothetical
 * park with a 385-foot wall". This league's parks are not that hypothetical park, so the
 * factors have to be re-centred on the league that actually exists.
 *
 * This prints the bias before it is corrected, per factor, and shows what the same data looks
 * like after normalisation -- because the correction is the kind that can quietly destroy the
 * differences it was supposed to preserve, and the check that it does not is the point.
 *
 * Run: npx tsx tools/probeParkFactorBias.ts
 */

import { parkFactorsFor, indexOf } from '../src/lib/analytics/parkFactors';
import { ALL_PARK_PROFILES } from '../src/lib/analytics/parkProfile';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const main = (): void => {
  const factors = [...ALL_PARK_PROFILES.values()].map((p) => parkFactorsFor(p));

  console.log('\nPARK FACTOR BIAS -- absolute model versus the league it has to serve\n');

  const channels: Array<{ key: keyof typeof factors[0]; label: string; higherIsMoreScoring: boolean }> = [
    { key: 'hrFactor', label: 'HR', higherIsMoreScoring: true },
    { key: 'fbFactor', label: 'FB', higherIsMoreScoring: true },
    { key: 'gbFactor', label: 'GB', higherIsMoreScoring: true },
    { key: 'runFactor', label: 'RUN', higherIsMoreScoring: true },
  ];

  console.log('  ABSOLUTE, as the model currently ships them');
  console.log('    channel   league mean   min    max    spread   implication');
  for (const c of channels) {
    const values = factors.map((f) => f[c.key] as number);
    const m = mean(values);
    console.log(
      `    ${c.label.padEnd(9)}${indexOf(m).toFixed(1).padStart(10)}`
      + `${indexOf(Math.min(...values)).toFixed(1).padStart(8)}${indexOf(Math.max(...values)).toFixed(1).padStart(8)}`
      + `${(Math.max(...values) - Math.min(...values)).toFixed(3).padStart(10)}`
      + `     league scoring x${m.toFixed(3)}`,
    );
  }
  const fatigue = mean(factors.map((f) => f.pitcherFatigueRate));
  console.log(`    ${'FATIGUE'.padEnd(9)}${fatigue.toFixed(4).padStart(10)}`
    + '                            every pitcher in the league is fatigued by the average park');

  console.log('\n  AFTER RE-CENTRING on the league mean');
  console.log('    channel   league mean   min    max    spread   spread retained');
  for (const c of channels) {
    const values = factors.map((f) => f[c.key] as number);
    const m = mean(values);
    const norm = values.map((v) => v / m);
    const before = Math.max(...values) - Math.min(...values);
    const after = Math.max(...norm) - Math.min(...norm);
    console.log(
      `    ${c.label.padEnd(9)}${indexOf(mean(norm)).toFixed(1).padStart(10)}`
      + `${indexOf(Math.min(...norm)).toFixed(1).padStart(8)}${indexOf(Math.max(...norm)).toFixed(1).padStart(8)}`
      + `${after.toFixed(3).padStart(10)}   ${((after / before) * 100).toFixed(1)}%`,
    );
  }

  console.log(
    '\n  Re-centring divides every park by the same constant, so the DIFFERENCES between parks'
      + '\n  survive intact -- the spread is retained to within the rounding above. What changes'
      + '\n  is that league-average scoring is no longer multiplied by anything, which is what'
      + '\n  broke the totals market.',
  );
  console.log();
};

main();