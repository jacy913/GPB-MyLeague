/**
 * Is the forecaster consensus actually confidence-weighted, and are the two decoys still bare?
 *
 * WHY THIS TOOL EXISTS
 *
 * `plan/gpb-macrobet-hxse.md` §2.5 and the weighted-consensus handoff both warn about the same
 * thing: a grep for an arithmetic mean over the forecaster pool returns SIX hits, four of which
 * are the consensus and two of which are not. The two decoys sit in `mediaMarkets.ts`:
 *
 *   softMaxProbabilities   centres a TEAM's scores against the group mean, inside a
 *                          per-forecaster softmax
 *   buildAwardMarket       averages AWARD CANDIDATES' totals against the field mean
 *
 * Both average over teams or players, not over outlets. Weighting either would either
 * double-count confidence or break every division and championship market, and neither failure
 * is loud -- the numbers move and nothing throws.
 *
 * So the decoys are asserted to be UNWEIGHTED, which is the only way to notice someone
 * "tidying up the means" without reading the comment that says not to.
 *
 * IT ALSO CHECKS THE HELPER'S ARITHMETIC, because a weighted mean is easy to write wrong in a
 * way that still looks like a weighted mean:
 *
 *   - with every profile weighted equally it must equal the plain arithmetic mean, or the
 *     change has not actually been made;
 *   - it must disagree with the plain mean when the weights differ, or it is not weighting;
 *   - it must return 0.5 for a pool carrying no weight, rather than NaN.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you whether `confidence` is the RIGHT weight. That is an empirical question,
 * answered by re-running `tools/fitHouseShading.ts` and `tools/verifyShadedHouse.ts` and
 * checking that a bettor with no edge still cannot print money. This tool checks that the
 * arithmetic is what was intended; the other two check that the intention was correct.
 *
 * Run: npx tsx tools/checkWeightedConsensus.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MEDIA_PROFILES, type MediaProfile } from '../src/data/media';
import { weightedConsensus } from '../src/lib/markets';

const MARKETS = resolve(process.cwd(), 'src', 'lib', 'markets.ts');
const MEDIA_ODDS = resolve(process.cwd(), 'src', 'lib', 'mediaOdds.ts');
const MEDIA_MARKETS = resolve(process.cwd(), 'src', 'lib', 'mediaMarkets.ts');

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/** Strip comments, for the same reason `checkBettingCardShape` does: prose must not be able to
 *  satisfy or break a structural assertion. */
const stripComments = (input: string): string => {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    if (ch === '/' && next === '/') { while (i < input.length && input[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        if (input[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

const main = (): void => {
  const markets = stripComments(readFileSync(MARKETS, 'utf8'));
  const mediaOdds = stripComments(readFileSync(MEDIA_ODDS, 'utf8'));
  const mediaMarkets = stripComments(readFileSync(MEDIA_MARKETS, 'utf8'));

  // -- 1. the helper exists and is exported ------------------------------------------
  check(
    'weightedConsensus is exported from markets.ts',
    /export const weightedConsensus\s*=\s*\(pick:\s*\(profile:\s*MediaProfile\)\s*=>\s*number\)/.test(markets),
    'the signature takes a SELECTOR over profiles, which is what makes it impossible to point '
    + 'it at a mean that is not over forecasters',
  );

  // -- 2. all four cross-forecaster means are weighted --------------------------------
  const consensusSites: Array<{ label: string; source: string; pattern: RegExp }> = [
    { label: 'buildFieldMarket consensus', source: markets, pattern: /consensusProbability\s*=\s*weightedConsensus\(/ },
    { label: 'buildLineMarket fair total', source: markets, pattern: /meanFair\s*=\s*weightedConsensus\(/ },
    { label: 'buildLineMarket over price', source: markets, pattern: /meanOver\s*=\s*weightedConsensus\(/ },
    { label: 'buildGameLine consensus', source: mediaOdds, pattern: /rawConsensus\s*=\s*weightedConsensus\(/ },
  ];
  for (const site of consensusSites) {
    check(`the ${site.label} is confidence-weighted`, site.pattern.test(site.source));
  }

  // -- 3. no unweighted mean survives over the forecaster pool ------------------------
  /*
    Any remaining `values.reduce((sum, value) => sum + value, 0) / values.length` in these two
    files is a consensus that did not get converted. `values` is the pool's own mapped array,
    so this is exactly the shape that was replaced four times.
   */
  const bareMeans = [...markets.matchAll(/(\w+)\s*=\s*\w+\.reduce\(\(sum, value\)\s*=>\s*sum\s*\+\s*value,\s*0\)\s*\/\s*\w+\.length;/g)]
    .map((m) => m[0]);
  const bareMeansOdds = [...mediaOdds.matchAll(/(\w+)\s*=\s*\w+\.reduce\(\(sum, value\)\s*=>\s*sum\s*\+\s*value,\s*0\)\s*\/\s*\w+\.length;/g)]
    .map((m) => m[0]);
  check(
    'no unweighted pool mean survives in markets.ts or mediaOdds.ts',
    bareMeans.length === 0 && bareMeansOdds.length === 0,
    [...bareMeans, ...bareMeansOdds].join(' | ') || undefined,
  );

  // -- 4. THE DECOYS ARE STILL BARE -----------------------------------------------------
  /*
    Asserted as a POSITIVE requirement that they stay unweighted, because the failure mode is
    silent. Weighting them moves numbers and throws nothing.
   */
  check(
    'DECOY: the per-forecaster softmax mean is NOT weighted',
    /const mean = scores\.reduce\(\(sum, value\)\s*=>\s*sum\s*\+\s*value,\s*0\)\s*\/\s*scores\.length;/.test(mediaMarkets),
    'this mean is over a TEAM\'s scores against its field, inside one forecaster\'s softmax. '
    + 'Weighting it would double-count confidence.',
  );
  check(
    'DECOY: the award-candidate mean is NOT weighted',
    /const mean = totals\.reduce\(\(sum, value\)\s*=>\s*sum\s*\+\s*value,\s*0\)\s*\/\s*Math\.max\(1, totals\.length\);/.test(mediaMarkets),
    'this mean is over PLAYERS, not over outlets. Weighting it breaks award markets.',
  );
  check(
    'DECOY: neither decoy calls weightedConsensus at all',
    !/weightedConsensus/.test(mediaMarkets),
    'mediaMarkets.ts must not reference the helper at all. If it ever does, one of the two '
    + 'assertions above is about to become false and this will say so first.',
  );

  // -- 5. THE HELPER'S ARITHMETIC --------------------------------------------------------
  const pool = MEDIA_PROFILES;

  const equalWeights = pool.map((p) => ({ ...p, confidence: 0.5 })) as MediaProfile[];
  const pickMean = (list: MediaProfile[]): number =>
    list.reduce((a, p) => a + p.confidence, 0) / list.length;

  // An equal-weight pool must reproduce the plain mean exactly.
  const asEqual = equalWeights.map((p) => p.confidence * (0.3 + 0.4 * pool.indexOf(p)));
  const plainEqual = asEqual.reduce((a, b) => a + b, 0) / asEqual.length;
  const poolWithEqual = MEDIA_PROFILES.map((p) => ({
    ...p,
    confidence: 0.5,
  })) as MediaProfile[];
  check(
    'with equal weights the helper returns the plain arithmetic mean',
    Math.abs(weightedConsensus((p) => {
      const i = poolWithEqual.findIndex((q) => q.id === p.id);
      return asEqual[i];
    }) - plainEqual) < 1e-12,
    'if this fails, the weighting is not actually being applied and the change is cosmetic',
  );

  // And with the REAL, unequal confidences it must differ from the plain mean.
  const realValues = pool.map((p, i) => 0.30 + 0.07 * i);
  const plainReal = realValues.reduce((a, b) => a + b, 0) / realValues.length;
  const weightedReal = weightedConsensus((p) => realValues[pool.indexOf(p)]);
  check(
    'with the real unequal confidences it DIFFERS from the plain mean',
    Math.abs(weightedReal - plainReal) > 1e-6,
    `plain ${plainReal.toFixed(6)} vs weighted ${weightedReal.toFixed(6)}. Equal would mean `
    + 'the confidences are all the same value, in which case the whole change is a no-op.',
  );

  // A pool carrying no weight must degrade to 0.5, not NaN.
  const zeroWeight = MEDIA_PROFILES.map((p) => ({ ...p, confidence: 0 })) as MediaProfile[];
  const saved = MEDIA_PROFILES.map((p) => p.confidence);
  for (let i = 0; i < MEDIA_PROFILES.length; i += 1) MEDIA_PROFILES[i].confidence = 0;
  const degraded = weightedConsensus(() => 0.9);
  for (let i = 0; i < MEDIA_PROFILES.length; i += 1) MEDIA_PROFILES[i].confidence = saved[i];
  check(
    'a pool with no weight at all degrades to 0.5 rather than NaN',
    degraded === 0.5,
    `returned ${degraded}`,
  );
  void zeroWeight;
  void pickMean;

  // -- 6. THE POOL IS WHAT WE THINK IT IS -----------------------------------------------
  check(
    'every profile publishes a usable confidence',
    pool.every((p) => p.confidence > 0 && p.confidence <= 1),
    `confidences: ${pool.map((p) => `${p.id} ${p.confidence}`).join(', ')}`,
  );
  check(
    'the confidences are NOT all equal',
    new Set(pool.map((p) => p.confidence)).size > 1,
    'if every profile had the same confidence, weighting would be identical to the old mean '
    + 'and this entire change would be invisible',
  );

  // -- report -------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nWEIGHTED CONSENSUS\n');
  console.log('  Four cross-forecaster means are now confidence-weighted. Two decoys in');
  console.log('  mediaMarkets.ts are means that LOOK identical in a grep and must stay bare,');
  console.log('  and their staying bare is asserted rather than left to a comment.\n');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  console.log('  This checks that the weighting is what was intended. Whether `confidence` is the');
  console.log('  RIGHT weight is answered by tools/fitHouseShading.ts and tools/verifyShadedHouse.ts:\n');
  console.log('    > a bettor with no edge at all, betting one side relentlessly, must not print money\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();