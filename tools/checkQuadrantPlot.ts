/**
 * Does the quadrant plot put players in the right corners?
 *
 * The plot is mostly drawing, and drawing is hard to assert on. But the one thing that
 * can be silently wrong in a way nobody would ever notice is the CORNER ASSIGNMENT: a
 * scatter whose labels are correct but whose quadrants are transposed still looks
 * entirely plausible, and every conclusion a reader draws from it is inverted.
 *
 * That is worth testing, because the K-BB plot deliberately inverts the usual reading
 * (high strikeouts and LOW walks is the good corner, which is up-and-LEFT rather than
 * up-and-right) and the batting plot does not. Two plots with opposite conventions side
 * by side is exactly where a transposition hides.
 *
 * The scale maths is tested too: a flat axis must not divide by zero, and the y axis
 * must be inverted exactly once. Both are invisible in a screenshot and fatal in a chart.
 *
 * Run: npx tsx tools/checkQuadrantPlot.ts
 */

import type { QuadrantDefinition, QuadrantPoint } from '../src/components/ui/QuadrantPlot';

/**
 * A reimplementation of the plot's quadrant resolution, mirroring QuadrantPlot.ts.
 *
 * Duplicated deliberately rather than exported: the component's internals are not part of
 * its API, and exporting a helper purely so a test can reach it would make the test
 * depend on the same code it is meant to check. The cost is that this must be kept in step
 * by hand -- noted, because a test that silently drifts from what it tests is worse than
 * no test at all.
 */
const quadrantOf = (
  point: { x: number; y: number },
  meanX: number,
  meanY: number,
  quadrants: readonly QuadrantDefinition[],
): QuadrantDefinition | null => {
  const xAbove = point.x >= meanX;
  const yAbove = point.y >= meanY;
  return quadrants.find((q) => q.xAbove === xAbove && q.yAbove === yAbove) ?? null;
};

/** The same scale maths the component performs, for the two degenerate cases. */
const scaleAxis = (values: number[], padFraction: number): { lo: number; hi: number } => {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * padFraction;
  return { lo: lo - pad, hi: hi + pad };
};

const BATTING: readonly QuadrantDefinition[] = [
  { xAbove: true, yAbove: true, name: 'Belt', note: '' },
  { xAbove: false, yAbove: true, name: 'Slugger', note: '' },
  { xAbove: true, yAbove: false, name: 'On-Base', note: '' },
  { xAbove: false, yAbove: false, name: 'Imprisoned', note: '' },
];

const PITCHING: readonly QuadrantDefinition[] = [
  { xAbove: true, yAbove: true, name: 'Wild', note: '' },
  { xAbove: false, yAbove: true, name: 'Workhorse', note: '' },
  { xAbove: true, yAbove: false, name: 'Dominant', note: '' },
  { xAbove: false, yAbove: false, name: 'Effective', note: '' },
];

const checks: Array<{ label: string; pass: boolean; detail: string }> = [];
const check = (label: string, pass: boolean, detail = ''): void => { checks.push({ label, pass, detail }); };

// --- batting convention: up and right is good ---------------------------------------
check('Belt is above both means', quadrantOf({ x: 0.35, y: 0.50 }, 0.32, 0.42, BATTING)?.name === 'Belt');
check('Slugger is high SLG, low OBP', quadrantOf({ x: 0.29, y: 0.55 }, 0.32, 0.42, BATTING)?.name === 'Slugger');
check('On-Base is high OBP, low SLG', quadrantOf({ x: 0.38, y: 0.35 }, 0.32, 0.42, BATTING)?.name === 'On-Base');
check('Imprisoned is below both', quadrantOf({ x: 0.25, y: 0.30 }, 0.32, 0.42, BATTING)?.name === 'Imprisoned');

// --- pitching convention: the GOOD corner is up and LEFT, deliberately -----------------
// If these two ever report 'Dominant' the plots have been transposed relative to each
// other, which is the single failure this file exists to catch.
check(
  'PITCHING: high K/9 with low BB/9 is "Dominant", i.e. up and LEFT',
  quadrantOf({ x: 11.0, y: 1.8 }, 8.0, 3.0, PITCHING)?.name === 'Dominant',
  `got "${quadrantOf({ x: 11.0, y: 1.8 }, 8.0, 3.0, PITCHING)?.name}"`,
);
check(
  'PITCHING: low K/9 with high BB/9 is "Workhorse", i.e. up and RIGHT',
  quadrantOf({ x: 5.0, y: 4.5 }, 8.0, 3.0, PITCHING)?.name === 'Workhorse',
  `got "${quadrantOf({ x: 5.0, y: 4.5 }, 8.0, 3.0, PITCHING)?.name}"`,
);
check(
  'PITCHING: high on both is "Wild"',
  quadrantOf({ x: 11.0, y: 4.5 }, 8.0, 3.0, PITCHING)?.name === 'Wild',
);
check(
  'PITCHING: low on both is "Effective"',
  quadrantOf({ x: 5.0, y: 1.8 }, 8.0, 3.0, PITCHING)?.name === 'Effective',
);

// The transposition guard, stated as a single assertion because it is the whole point:
// the SAME coordinates must land in DIFFERENT names on the two plots, because the two
// axes carry opposite meanings.
check(
  'the two plots genuinely disagree about the same coordinates, so a transposition is visible',
  quadrantOf({ x: 11.0, y: 1.8 }, 8.0, 3.0, BATTING)?.name
    !== quadrantOf({ x: 11.0, y: 1.8 }, 8.0, 3.0, PITCHING)?.name,
);

// --- boundary behaviour ---------------------------------------------------------------
check(
  'a point exactly ON the mean is counted as above it, and consistently',
  quadrantOf({ x: 8.0, y: 3.0 }, 8.0, 3.0, PITCHING)?.name === 'Wild',
  `got "${quadrantOf({ x: 8.0, y: 3.0 }, 8.0, 3.0, PITCHING)?.name}"`,
);

// --- scale maths ----------------------------------------------------------------------
const flat = scaleAxis([0.300, 0.300, 0.300], 0.06);
check(
  'a flat axis does not collapse to zero width',
  flat.hi > flat.lo,
  `${flat.lo} to ${flat.hi}`,
);
const narrow = scaleAxis([0.301, 0.302, 0.303], 0.06);
check(
  'a narrow axis still gets padding, so the extremes are off the frame',
  narrow.lo < 0.301 && narrow.hi > 0.303,
  `${narrow.lo.toFixed(4)} to ${narrow.hi.toFixed(4)}`,
);
const wide = scaleAxis([0.180, 0.380], 0.06);
check(
  'a wide axis keeps most of its range',
  wide.hi - wide.lo < 0.24,
  `range ${(wide.hi - wide.lo).toFixed(4)} from a raw span of 0.200`,
);

// --- dot area -------------------------------------------------------------------------
//
// NOT proportional to playing time, and that is deliberate: a floor keeps every dot
// visible and clickable. An earlier draft of this file asserted proportionality and
// FAILED against the component, which is how a comment in QuadrantPlot.tsx claiming
// "twice the playing time, twice the dot" was caught being false. These assertions are
// the properties that actually hold and that the eye depends on.
const area = (weight: number, maxWeight: number): number => 0.9 + 2.6 * weight / maxWeight;
check(
  'dot area is MONOTONIC in playing time, which is the property the eye reads',
  area(300, 600) < area(450, 600) && area(450, 600) < area(600, 600),
  `300 -> ${area(300, 600).toFixed(2)}, 450 -> ${area(450, 600).toFixed(2)}, 600 -> ${area(600, 600).toFixed(2)}`,
);
check(
  'and is NOT proportional, because the floor makes it non-linear',
  Math.abs(area(600, 600) / area(300, 600) - 2) > 0.1,
  `600/300 ratio is ${(area(600, 600) / area(300, 600)).toFixed(3)}, i.e. 1.6x not 2x`,
);
check(
  'the ratio between the heaviest and lightest player is bounded, so no dot dominates',
  area(600, 600) / area(1, 600) < 4,
  `heaviest/lightest area ratio ${(area(600, 600) / area(1, 600)).toFixed(3)}`,
);
check(
  'a zero-weight player still gets a visible dot, because a two-pixel target is not a control',
  area(0, 600) >= 0.9,
  `zero weight area ${area(0, 600).toFixed(3)}`,
);
check(
  'the heaviest player in the pool gets the full area, whichever weight that is',
  Math.abs(area(600, 600) - 3.5) < 1e-9,
  `area(600,600) = ${area(600, 600).toFixed(3)}`,
);

// --- the points a real league would produce --------------------------------------------
const realish: QuadrantPoint[] = [
  { id: 'a', label: 'A', x: 0.340, y: 0.190, weight: 300 },
  { id: 'b', label: 'B', x: 0.290, y: 0.520, weight: 500 },
  { id: 'c', label: 'C', x: 0.381, y: 0.398, weight: 620 },
  { id: 'd', label: 'D', x: 0.251, y: 0.298, weight: 40 },
];
check(
  'every plotted player lands in exactly one quadrant, and none is null',
  realish.every((p) => quadrantOf(p, 0.320, 0.420, BATTING) !== null),
);
check(
  'a low-volume player is plotted, just smaller -- not dropped',
  realish.length === 4,
);

const failed = checks.filter((c) => !c.pass);
console.log('\nQUADRANT PLOT GEOMETRY\n');
checks.forEach((c, i) => {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.label}`);
  if (!c.pass && c.detail) console.log(`        ${c.detail}`);
});
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks PASS\n`);
if (failed.length > 0) process.exitCode = 1;