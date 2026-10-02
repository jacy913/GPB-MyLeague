/**
 * Does the price chart's geometry tell the truth?
 *
 * ============================================================================
 * WHY THIS CHECKS MATH AND NOT APPEARANCE
 * ============================================================================
 *
 * A price chart has one unforgivable failure and it is not an ugly colour: an INVERTED AXIS, where a
 * rising price is drawn as a falling line. It still looks like a chart. It still has a plausible
 * shape. It is simply backwards, and no amount of staring at it in a browser reliably reveals that --
 * you have to know which way it should go.
 *
 * So the geometry is pure functions and this asserts them. The rendering is then a thin layer over
 * numbers that are already known to be right, which is the only reason a hand-rolled chart is safe to
 * hand-roll.
 *
 * ============================================================================
 * WHY THE FIXED BAND IS ASSERTED RATHER THAN DESCRIBED
 * ============================================================================
 *
 * Every other chart here fits its axis to the data. If someone "improves" this one to auto-fit, the
 * chart still renders and still looks reasonable and now a quiet week reads as a crash. That is a
 * regression with no crash and no obvious symptom, so it gets a check.
 *
 * Run: npx tsx tools/checkShareChart.ts
 */

import {
  BAND_LINES,
  CHART_HEIGHT,
  CHART_PADDING,
  CHART_WIDTH,
  lastMove,
  linePath,
  xFor,
  yFor,
  type PricePoint,
} from '../src/components/ui/SharePriceChart';
import { PRICE_MAX } from '../src/lib/analytics/sharePrice';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const series = (values: number[]): PricePoint[] =>
  values.map((value, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, value }));

const rising = series([400, 450, 520, 610, 700]);

// -- 1. THE AXIS IS NOT INVERTED -------------------------------------------------------------
const topY = yFor(PRICE_MAX);
const midY = yFor(PRICE_MAX / 2);
const bottomY = yFor(0);
check(
  'a higher price draws HIGHER on the chart -- the axis is not inverted',
  topY < midY && midY < bottomY,
  `${PRICE_MAX} -> y=${topY.toFixed(1)}, 500 -> y=${midY.toFixed(1)}, 0 -> y=${bottomY.toFixed(1)}. `
  + 'A path with these three in the other order is a chart that still looks like a chart.',
);

// -- 2. THE BAND IS THE FULL TRADING BAND, ALWAYS ----------------------------------------------
check(
  'the axis spans the whole 0-1000 band regardless of the data',
  Math.abs(bottomY - (CHART_HEIGHT - CHART_PADDING.bottom)) < 1e-9
  && Math.abs(topY - CHART_PADDING.top) < 1e-9,
  `y(0) sits exactly on the bottom padding line and y(${PRICE_MAX}) exactly on the top one, whatever `
  + 'the series contains. An auto-fitted axis would still render and would make a quiet week look like '
  + 'a crash, so this is asserted rather than trusted.',
);

// -- 3. VALUES ARE CLAMPED, NOT PROJECTED ------------------------------------------------------
const over = yFor(PRICE_MAX * 3);
const under = yFor(-500);
check(
  'a close outside the band is clamped to the edge rather than drawn off the chart',
  Math.abs(over - topY) < 1e-9 && Math.abs(under - bottomY) < 1e-9,
  `y(${PRICE_MAX * 3}) equals y(${PRICE_MAX}) and y(-500) equals y(0). The band is load-bearing in `
  + 'sharePrice.ts -- a price that leaves it is no longer comparable -- so the view cannot invent room '
  + 'for one that has.',
);

// -- 4. X IS EVENLY SPACED AND MONOTONIC -----------------------------------------------------
const xs = rising.map((_, i) => xFor(i, rising.length, CHART_WIDTH));
const monotonic = xs.every((x, i) => i === 0 || x > xs[i - 1]);
const evenGaps = xs.slice(1).map((x, i) => Math.abs((x - xs[i]) - (xs[1] - xs[0])));
check(
  'observations are evenly spaced and strictly left-to-right',
  monotonic && evenGaps.every((g) => g < 1e-6),
  `${xs.length} points at ${xs.map((x) => x.toFixed(0)).join(', ')}. Indexed rather than time-scaled, `
  + 'because the ledger has one point per SIMULATED day and the league does not play on off-days -- a '
  + 'seven-day break would otherwise occupy the same width as a one-day break.',
);

// -- 5. DEGENERATE SERIES DO NOT PRODUCE NaN ---------------------------------------------------
const emptyPath = linePath([], CHART_WIDTH, CHART_HEIGHT);
const singlePath = linePath(series([500]), CHART_WIDTH, CHART_HEIGHT);
const twoPath = linePath(series([500, 500]), CHART_WIDTH, CHART_HEIGHT);
const anyNaN = /NaN|Infinity|undefined/.test([emptyPath, singlePath, twoPath].join(' '));
const centred = Math.abs(xFor(0, 1, CHART_WIDTH) - (CHART_PADDING.left + (CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right) / 2)) < 1e-9;
check(
  'empty, single-point and flat series produce no NaN, and a lone point is centred',
  emptyPath === '' && !anyNaN && singlePath.startsWith('M') && twoPath.split('L').length === 2 && centred,
  `empty -> ""; one point -> a single M centred at x=${xFor(0, 1, CHART_WIDTH).toFixed(0)}; two equal `
  + 'points -> one segment. A single point pinned to the left edge reads as "the series fell off", and a '
  + 'NaN in a path attribute silently drops the whole path in some renderers.',
);

// -- 6. THE PATH TRACKS THE DATA ---------------------------------------------------------------
/*
  Two separate claims, and they need different series: a FLAT pair proves the vertex count is right,
  and a RISING pair proves the direction is right. The first version of this check used the flat pair
  for both, which asserted `y0 < y1` on two equal prices and so failed while its own detail text
  cheerfully reported that everything had passed. A detail string written as prose about a result
  rather than as a report of it will happily narrate a failure.
*/
const yOf = (path: string): number[] =>
  path.split(/[ML]/).filter(Boolean).map((s) => Number(s.trim().split(/\s+/)[1]));

const flatYs = yOf(twoPath);
const risingYs = yOf(linePath(rising, CHART_WIDTH, CHART_HEIGHT));
const risingPair = yOf(linePath(series([500, 550]), CHART_WIDTH, CHART_HEIGHT));

check(
  'the path visits one y per observation, and a rising price is drawn rising',
  flatYs.length === 2
  && flatYs[0] === flatYs[1]
  && risingYs.length === rising.length
  && risingYs.every((y, i) => i === 0 || y < risingYs[i - 1])
  && risingPair.length === 2
  // GREATER, not less. A higher price is a SMALLER y, which is the entire point of check 1 and the
  // thing this file exists to catch. Writing `<` here tested "the axis is inverted" and called it
  // "the axis is correct".
  && risingPair[0] > risingPair[1],
  `flat pair 500/500 -> y ${flatYs.map((y) => y.toFixed(1)).join(' and ')} (equal, as it must be); `
  + `rising 400-700 -> ${risingYs.length} vertices for ${rising.length} points at `
  + `${risingYs.map((y) => y.toFixed(0)).join(', ')} -- y DECREASING, because a higher price sits `
  + 'higher on screen and y grows downward. Vertex count catches a dropped or duplicated observation; '
  + 'direction catches an inverted path.',
);

// -- 7. A ONE-POINT SERIES HAS NO MOVE ----------------------------------------------------------
check(
  'lastMove is null for one point, and is a real fraction for two',
  lastMove(series([500])) === null && Math.abs((lastMove(series([500, 550])) ?? 0) - 0.1) < 1e-9,
  `one point -> ${lastMove(series([500]))}, 500 -> 550 -> ${lastMove(series([500, 550]))?.toFixed(4)}. `
  + 'A single day has no move, and reporting 0% for it would be a claim about a change that has not '
  + 'happened yet.',
);

// -- 8. THE BAND REFERENCE LINES ARE THE CONTRACT'S, NOT INVENTED --------------------------------
const expected = [PRICE_MAX, PRICE_MAX / 2, 0];
check(
  'the reference lines are exactly the band edges and the fair midpoint',
  BAND_LINES.length === 3 && BAND_LINES.every((l, i) => l.value === expected[i]),
  `${BAND_LINES.map((l) => `${l.label}@y${yFor(l.value).toFixed(0)}`).join(', ')}. 500 is where a club sits `
  + 'at exactly fair value, so the line is a fixed rule rather than a computed one -- "above fair" has '
  + 'to be visible without reading a number.',
);

const failed = checks.filter((c) => !c.pass);
console.log('\nHXSE PRICE CHART GEOMETRY\n');
checks.forEach((c, i) => {
  console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
  if (c.detail) console.log('          ' + c.detail);
});
console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
if (failed.length > 0) process.exitCode = 1;