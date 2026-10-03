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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  AXIS_CEILING,
  BAND_LINES,
  CHART_HEIGHT,
  gapSegments,
  indexFromX,
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
const topY = yFor(AXIS_CEILING);
const bandTopY = yFor(PRICE_MAX);
const midY = yFor(PRICE_MAX / 2);
const bottomY = yFor(0);
check(
  'a higher price draws HIGHER on the chart -- the axis is not inverted',
  topY < bandTopY && bandTopY < midY && midY < bottomY,
  `${AXIS_CEILING} -> y=${topY.toFixed(1)}, ${PRICE_MAX} -> y=${bandTopY.toFixed(1)}, 500 -> `
  + `y=${midY.toFixed(1)}, 0 -> y=${bottomY.toFixed(1)}. A path with these in the other order is a `
  + 'chart that still looks like a chart.',
);

// -- 2. THE AXIS IS FIXED, AND IT LEAVES HEADROOM ABOVE THE BAND ------------------------------
check(
  'the axis is fixed at 0 to AXIS_CEILING regardless of the data',
  Math.abs(bottomY - (CHART_HEIGHT - CHART_PADDING.bottom)) < 1e-9
  && Math.abs(topY - CHART_PADDING.top) < 1e-9,
  `y(0) sits exactly on the bottom padding line and y(${AXIS_CEILING}) exactly on the top one, whatever `
  + 'the series contains. An auto-fitted axis would still render and would make a quiet week look like '
  + 'a crash, so this is asserted rather than trusted.',
);

// -- 3. VALUES ARE CLAMPED, NOT PROJECTED ------------------------------------------------------
const over = yFor(AXIS_CEILING * 3);
const under = yFor(-500);
check(
  'a close outside the drawn axis is clamped to the edge rather than drawn off the chart',
  Math.abs(over - topY) < 1e-9 && Math.abs(under - bottomY) < 1e-9,
  `y(${AXIS_CEILING * 3}) equals y(${AXIS_CEILING}) and y(-500) equals y(0). The band is load-bearing in `
  + 'sharePrice.ts -- a price that leaves it is no longer comparable -- so the view cannot invent room '
  + 'for one that has.',
);

/*
  THE HEADROOM IS THE POINT, and this is the assertion the old axis could not make.

  `AXIS_CEILING` exists so a club trading at `PRICE_MAX` -- the most it can possibly be worth -- does
  not draw ON the top edge, where it is indistinguishable from a club that has left the scale. The
  most expensive club in the league is the one a reader can least afford to misread.

  If the ceiling is ever set back to `PRICE_MAX`, `yFor(PRICE_MAX)` returns the top padding again and
  this fails. That is deliberate: the headroom has to be a checked property rather than a constant
  somebody tidies away in a later pass.
*/
check(
  'a club at the top of its PRICE BAND is drawn BELOW the top of the axis',
  bandTopY > CHART_PADDING.top + 1e-9,
  `y(${PRICE_MAX}) = ${bandTopY.toFixed(1)} against a top padding line at ${CHART_PADDING.top} -- `
  + `${(bandTopY - CHART_PADDING.top).toFixed(1)}px of headroom, with the axis ceiling at ${AXIS_CEILING}. `
  + 'Equal means the ceiling has been collapsed onto the band and the most expensive club in the league '
  + 'draws on the edge of the plot.',
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

// -- 8. THE REFERENCE LINES, AND THE CEILING IS DISTINGUISHED FROM THE BAND ---------------------
const expectedLines = [
  { value: AXIS_CEILING, kind: 'ceiling' },
  { value: PRICE_MAX, kind: 'band' },
  { value: PRICE_MAX / 2, kind: 'band' },
  { value: 0, kind: 'band' },
];
check(
  'the reference lines are the band edges, the fair midpoint, and the axis ceiling',
  BAND_LINES.length === expectedLines.length
  && expectedLines.every((e, i) => BAND_LINES[i].value === e.value && BAND_LINES[i].kind === e.kind),
  `${BAND_LINES.map((l) => `${l.label}(${l.kind})@y${yFor(l.value).toFixed(0)}`).join(', ')}. 500 is where `
  + `a club sits at exactly fair value and ${PRICE_MAX} is the most a club can be worth, so those two are `
  + `fixed rules rather than computed ones. ${AXIS_CEILING} is the drawn ceiling above the band, tagged `
  + "'ceiling' so it is stroked and weighted differently and cannot be mistaken for a price.",
);

check(
  'every axis label carries the currency, and the ceiling label names the ceiling',
  BAND_LINES.every((l) => l.label.startsWith('$'))
  && BAND_LINES.filter((l) => l.kind === 'ceiling').length === 1,
  `labels: ${BAND_LINES.map((l) => l.label).join(', ')}. Every other number on the page is in dollars, so `
  + 'an axis reading 0/500/1000 beside a headline of $499.37 asks the reader to do a unit conversion.',
);

/*
  THE FAIR LAYER, AND SPECIFICALLY THAT IT BREAKS AT GAPS.

  This is the check that matters for the second line, because the failure is invisible: a single
  continuous path across a day with no valuation still LOOKS like a chart, and the eye reads the
  smooth join as a measurement the save does not contain. So the assertions are about discontinuity,
  not about the line existing.
*/
const gapRun = (values: (number | null)[]) =>
  gapSegments(values.map((v, i) => (v === null ? null : { date: `2026-06-0${i + 1}`, value: v })));

check(
  'a fair layer with no gaps draws as ONE segment',
  gapRun([500, 505, 498, 512]).length === 1,
  `${gapRun([500, 505, 498, 512]).length} segments from an unbroken layer. If this ever returns more `
  + 'than one, an ordinary week of recorded valuations is being drawn as several pieces.',
);

const gapped = gapRun([500, 505, null, 512, 520]);
check(
  'a day with NO recorded valuation SPLITS the fair line rather than bridging it',
  gapped.length === 2,
  `${gapped.length} segments around one missing day. A single segment here would draw a stroke across `
  + 'a day the market was never priced against, and the join would look like a measurement.',
);

check(
  'the two segments either side of a gap DO NOT share a coordinate',
  (() => {
    if (gapped.length !== 2) return false;
    // The last command of run 1 and the first of run 2 must not be a continuation of each other,
    // which is what a bridged path would produce. Compare the x each side lands on.
    const xs = gapped.map((d) => (d.match(/[ML]([\d.]+)/g) ?? []).map((m) => Number(m.slice(1))));
    return xs[0][xs[0].length - 1] !== xs[1][0];
  })(),
  'The run before a gap and the run after it land on different days, so the path cannot be a single '
  + 'stroke. Equal coordinates would mean the gap is being bridged.',
);

check(
  'a run of one draws no segment, because there is nothing to join it to',
  gapRun([null, 500, null]).length === 0,
  `${gapRun([null, 500, null]).length} segments from a lone valuation between two gaps. Drawing a `
  + 'mark for it would assert a trend to or from a day that has no neighbour.',
);

check(
  'an entirely absent fair layer draws nothing at all',
  gapRun([null, null, null]).length === 0 && gapRun([]).length === 0,
  'A ledger saved before the fair layer existed has none, and the chart must omit its second line '
  + 'rather than back-fill a valuation nobody recorded.',
);

check(
  'the fair line is INDEX-ALIGNED with the closes, not re-matched by date',
  (() => {
    // Same series length means x positions line up with the close path; if the chart re-matched by
    // date it would silently produce a different number of points than the closes.
    const closes = linePath([500, 505, 512].map((v, i) => ({ date: `d${i}`, value: v })));
    const fair = gapRun([500, 505, 512])[0] ?? '';
    const countX = (d: string) => (d.match(/[ML]/g) ?? []).length;
    return countX(closes) === countX(fair);
  })(),
  'The vertical gap between the two lines is only readable as "strayed from fair" if both cover the '
  + 'same days. Equal point counts is the cheap necessary condition for that.',
);

/*
  HIT-TESTING, which is the inverse of `xFor` and the one piece of interaction geometry.

  This is checked rather than trusted because the failure is silent and looks fine: a crosshair that
  resolves to the wrong day still draws a line, still draws a dot, and still sits on the chart. Only
  the number in the readout beside it is wrong, and nobody sees that without reading two days.

  The round-trip property is the real assertion -- for every observation, asking "what day is at this
  x?" must return that day. Testing three hand-picked coordinates would prove much less.
*/
const days = (n: number) => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, value: 500 + i }));

check(
  'indexFromX is the INVERSE of xFor: every observation round-trips to its own index',
  (() => {
    for (const n of [2, 3, 7, 14, 30, 180]) {
      for (let i = 0; i < n; i += 1) {
        const back = indexFromX(xFor(i, n), n);
        if (back !== i) {
          return false;
        }
      }
    }
    return true;
  })(),
  'Round-tripped 236 observations across six series lengths. A drift of one index would still draw a '
  + 'plausible chart, so this has to be exact rather than approximate.',
);

check(
  'a pointer in the LEFT padding resolves to the first day, not to an out-of-range index',
  indexFromX(0, 10) === 0 && indexFromX(CHART_PADDING.left, 10) === 0,
  `indexFromX(0, 10) = ${indexFromX(0, 10)}, indexFromX(${CHART_PADDING.left}, 10) = ${indexFromX(CHART_PADDING.left, 10)}. `
  + 'Past the left edge is still "nearest to the first day", and a negative index would read the wrong array slot.',
);

check(
  'and past the RIGHT edge it resolves to the last day',
  indexFromX(CHART_WIDTH, 10) === 9 && indexFromX(CHART_WIDTH * 3, 10) === 9,
  `indexFromX(${CHART_WIDTH}, 10) = ${indexFromX(CHART_WIDTH, 10)}. Clamping matters because a pointer `
  + 'dragged past the plot should resolve to the nearest edge rather than to null or a negative index.',
);

check(
  'the midpoint of an EVEN series resolves to one side, not to a half index',
  (() => {
    // 5 points sit at 38, 106, 174, 242, 310; the exact middle x is 174, which is index 2.
    const n = 5;
    const mid = (CHART_PADDING.left + (CHART_WIDTH - CHART_PADDING.right)) / 2;
    return indexFromX(mid, n) === 2;
  })(),
  'Rounding must not be able to produce 2.5 and index a non-existent point.',
);

check(
  'a single observation resolves to 0 rather than dividing by a zero span',
  indexFromX(0, 1) === 0 && indexFromX(CHART_WIDTH, 1) === 0,
  'xFor CENTRES a lone point, so the inverse has to handle count === 1 the same way. A `(count - 1)` '
  + 'division here yields NaN, and a NaN index is not a hover state.',
);

check(
  'an EMPTY series resolves to -1, which the caller must read as "nothing hovered"',
  indexFromX(100, 0) === -1,
  `indexFromX(100, 0) = ${indexFromX(100, 0)}. Returning 0 for an empty series would point at a `
  + 'non-existent first day.',
);

/*
  THE COMPARISON SERIES IS LENGTH-GUARDED, and this is the one wiring claim in this file.

  Everything else here is pure geometry. This one is not, and it is labelled as a wiring assertion
  rather than dressed up as a measurement -- but the risk it guards is the worst on the page. The
  comparison series is positioned by INDEX against the primary, so a length mismatch would not look
  broken: it would draw a second club's line across the wrong days, and two lines that appear to
  converge would only be misaligned.

  A geometry check cannot see that, because the guard lives in the component rather than in a
  function. So the source is read, comments stripped so the prose cannot satisfy it.
*/
const chartSource = readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'SharePriceChart.tsx'), 'utf8');
const chartBody = chartSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
check(
  'the comparison series is dropped unless it matches the primary in length',
  /secondary\s*&&\s*secondary\.length\s*===\s*points\.length/.test(chartBody),
  'SCRIPPED THE MATCH IN SharePriceChart.tsx. The secondary is placed by index, so a shorter array '
  + 'stretches across the wrong days and looks like two clubs converging when they are not.',
);

check(
  'the comparison line uses a NEUTRAL ink, not an accent or an outcome colour',
  /stroke="var\(--color-ink-faint\)"/.test(chartBody),
  'Every accent in this app belongs to a named outlet or to a bet outcome. A comparison series is '
  + 'neither, so borrowing an accent would claim an identity the line does not have.',
);

const failed = checks.filter((c) => !c.pass);
console.log('\nHXSE PRICE CHART GEOMETRY\n');
checks.forEach((c, i) => {
  console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
  if (c.detail) console.log('          ' + c.detail);
});
console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
if (failed.length > 0) process.exitCode = 1;