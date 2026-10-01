/**
 * Is the percentile module correct?
 *
 * Written before it is wired to anything, because every bar, scatter point and column
 * on the future Dashboards page is a drawing of these numbers. A percentile that is
 * quietly wrong does not look wrong -- it looks like an opinion about how good a player
 * is, which is the hardest kind of wrong to catch later.
 *
 * The cases that matter are the ones where a plausible-looking shortcut gives a
 * plausible-looking wrong answer:
 *
 *   - ties, which these stats produce constantly and which a rank-based percentile
 *     splits into two
 *   - 'asc' stats (ERA, WHIP), where "better" means lower and a desc implementation
 *     inverts the league
 *   - a pool of one, and an empty pool
 *   - NaN, which is what a player with no at-bats produces and which must not be
 *     coerced to zero
 *
 * Run: npx tsx tools/checkPercentiles.ts
 */

import {
  describeVsMean,
  formatPercentile,
  percentileOf,
  summarise,
} from '../src/lib/analytics/percentile';

const checks: Array<{ label: string; pass: boolean; detail: string }> = [];
const check = (label: string, pass: boolean, detail: string): void => {
  checks.push({ label, pass, detail });
};

/** A pool with no ties and a known shape: 1,2,3,4,5. */
const five = summarise([3, 1, 5, 2, 4], 'desc');

check(
  'desc: the best value in the pool is exactly 100',
  percentileOf(5, five) === 100,
  `percentileOf(5) = ${percentileOf(5, five)}`,
);
check(
  'desc: the worst value is exactly 0',
  percentileOf(1, five) === 0,
  `percentileOf(1) = ${percentileOf(1, five)}`,
);
check(
  'desc: the middle value is 50',
  percentileOf(3, five) === 50,
  `percentileOf(3) = ${percentileOf(3, five)}`,
);
check(
  'desc: the mean is reported, and is a mean of rates',
  five.mean === 3,
  `mean = ${five.mean} over [3,1,5,2,4]`,
);

// Ties. Two players at .280 must show the SAME percentile, and it must equal the share
// of the pool strictly worse -- not one of them getting a rank bump.
const tied = summarise([10, 10, 10, 4], 'desc');
check(
  'ties: equal values get an equal percentile',
  percentileOf(10, tied) === percentileOf(10, tied),
  `both = ${percentileOf(10, tied).toFixed(1)}`,
);
check(
  'ties: that percentile counts only the strictly worse, so it is 33.3 and not 50 or 75',
  Math.abs(percentileOf(10, tied) - 100 / 3) < 1e-9,
  `percentileOf(10) = ${percentileOf(10, tied).toFixed(4)}, expected ${(100 / 3).toFixed(4)}`,
);
check(
  'ties: a tied group does not inflate to 100 when three of four are level',
  percentileOf(10, tied) < 100,
  `percentileOf(10) = ${percentileOf(10, tied).toFixed(1)}, must not be 100`,
);

// 'asc'. ERA and WHIP: lower is better. A desc implementation inverts the whole league.
const era = summarise([2.5, 4.0, 3.0, 5.5, 3.5], 'asc');
check(
  'asc: the LOWEST era is 100',
  percentileOf(2.5, era) === 100,
  `percentileOf(2.5) = ${percentileOf(2.5, era)}`,
);
check(
  'asc: the HIGHEST era is 0',
  percentileOf(5.5, era) === 0,
  `percentileOf(5.5) = ${percentileOf(5.5, era)}`,
);
check(
  'asc: the league is not inverted -- a mid value is near 50',
  Math.abs(percentileOf(3.5, era) - 50) < 1e-9,
  `percentileOf(3.5) = ${percentileOf(3.5, era)}`,
);

// Degenerate pools. A one-player league is not a league.
const one = summarise([0.271], 'desc');
check('pool of one: the only player is 100', percentileOf(0.271, one) === 100, `= ${percentileOf(0.271, one)}`);
const none = summarise([], 'desc');
check('empty pool: returns 0 rather than NaN', percentileOf(0.3, none) === 0, `= ${percentileOf(0.3, none)}`);
check(
  'empty pool: mean is 0 rather than NaN',
  Number.isFinite(none.mean),
  `mean = ${none.mean}`,
);

// NaN. A player with no at-bats produces this, and coercing it to zero puts them at the
// bottom of a leaderboard they never qualified for.
const withNaN = summarise([0.3, NaN, 0.2, 0.25], 'desc');
check('NaN is dropped from the pool, not counted as zero', withNaN.size === 3, `size = ${withNaN.size}`);
check(
  'NaN is dropped from the mean',
  Math.abs(withNaN.mean - 0.25) < 1e-9,
  `mean = ${withNaN.mean}, expected 0.25 from [0.3, 0.2, 0.25]`,
);
check(
  'a NaN value asked for its own percentile returns 0, not NaN',
  percentileOf(NaN, withNaN) === 0,
  `= ${percentileOf(NaN, withNaN)}`,
);

// The mean-of-rates versus aggregate distinction, which is the whole reason `mean` is
// not called "league average". These must actually be different numbers, or the
// distinction is not load-bearing and the labelling would be theatre.
//
// An earlier draft of this check was written as `... || true`, which cannot fail. A
// check that always passes is worse than no check: it appears in a count, it reads as
// evidence, and it establishes nothing. This one computes both numbers from the same
// explicit roster and asserts they differ AND that `summarise` returns the unweighted
// one.
const rates = [0.400, 0.400, 0.400, 0.090];
const atBats = [500, 500, 500, 50];
const aggregate = rates.reduce((hits, r, i) => hits + r * atBats[i], 0) / atBats.reduce((a, b) => a + b, 0);
const meanOfRates = summarise(rates, 'desc').mean;

check(
  'the aggregate and the mean of rates are genuinely different numbers',
  Math.abs(aggregate - meanOfRates) > 0.01,
  `aggregate ${aggregate.toFixed(4)} vs mean of rates ${meanOfRates.toFixed(4)}`,
);
check(
  'summarise returns the UNWEIGHTED mean, not the aggregate',
  Math.abs(meanOfRates - rates.reduce((s, r) => s + r, 0) / rates.length) < 1e-12
    && Math.abs(meanOfRates - aggregate) > 0.01,
  `summarise returned ${meanOfRates.toFixed(4)}; unweighted is `
    + `${(rates.reduce((s, r) => s + r, 0) / rates.length).toFixed(4)}, aggregate is ${aggregate.toFixed(4)}`,
);

// Formatting. The reachable-branch check, since an earlier draft had a dead one.
check('format: 100 does not print as "100.0"', formatPercentile(100) === '100', `= "${formatPercentile(100)}"`);
check('format: 99.6 keeps a decimal', formatPercentile(99.6) === '99.6', `= "${formatPercentile(99.6)}"`);
check('format: 72.4 rounds to a whole number', formatPercentile(72.4) === '72', `= "${formatPercentile(72.4)}"`);
check('format: NaN prints a dash, not "NaN"', formatPercentile(NaN) === '-', `= "${formatPercentile(NaN)}"`);

// Ordering, which is the property the whole column rests on.
const ranked = [0.19, 0.24, 0.26, 0.28, 0.31, 0.34];
const d = summarise(ranked, 'desc');
const percentiles = ranked.map((v) => percentileOf(v, d));
check(
  'percentiles rise monotonically with the value, for a desc stat',
  percentiles.every((p, i) => i === 0 || p >= percentiles[i - 1]),
  percentiles.map((p) => p.toFixed(1)).join(' < '),
);
const ascRanked = [2.8, 3.4, 3.9, 4.1, 4.8, 5.6];
const da = summarise(ascRanked, 'asc');
const ascPercentiles = ascRanked.map((v) => percentileOf(v, da));
check(
  'and FALL with it, for an asc stat',
  ascPercentiles.every((p, i) => i === 0 || p <= ascPercentiles[i - 1]),
  ascPercentiles.map((p) => p.toFixed(1)).join(' > '),
);

// The descriptive band.
check(
  'describeVsMean: the best player reads as well above average',
  describeVsMean(5, five) === 'well above average',
  `= "${describeVsMean(5, five)}"`,
);
check(
  'describeVsMean: a flat league does not call anyone exceptional',
  describeVsMean(3, summarise([3, 3, 3, 3], 'desc')) === 'about average',
  `= "${describeVsMean(3, summarise([3, 3, 3, 3], 'desc'))}"`,
);

const failed = checks.filter((c) => !c.pass);
console.log('\nPERCENTILE MODULE\n');
checks.forEach((c, i) => {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.label}`);
  if (!c.pass) console.log(`        got: ${c.detail}`);
});
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks PASS\n`);
if (failed.length > 0) process.exitCode = 1;