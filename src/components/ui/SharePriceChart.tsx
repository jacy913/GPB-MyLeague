import React from 'react';
import { PRICE_MAX } from '../../lib/analytics/sharePrice';

/**
 * THE HXSE PRICE CHART. First thing in the project that draws the price path.
 *
 * ============================================================================
 * WHY THE SCALE IS FIXED AND NOT DATA-DRIVEN
 * ============================================================================
 *
 * Every other chart in this codebase fits its axis to the data it happens to have. This one cannot.
 * The vertical axis is the 0-1000 trading band, always, because the whole point of a share price is
 * that its height is comparable: a club at 700 on day 3 and a club at 700 on day 90 are at the same
 * place. An auto-fitted axis would make a quiet week look like a crash and a wild week look flat,
 * which is the single most common way a price chart lies to the reader.
 *
 * It also means the fair-value midpoint at 500 is a fixed line rather than a computed one, so "above
 * fair" and "below fair" are visible without reading a number.
 *
 * ============================================================================
 * WHY X IS INDEXED AND NOT TIME-AXED
 * ============================================================================
 *
 * The ledger has one point per SIMULATED day. The league does not play on off-days, so a time axis
 * would leave gaps of unequal width for reasons that have nothing to do with price -- a seven-day
 * break and a one-day break would occupy the same horizontal distance. Index spacing says "these are
 * consecutive observations", which is true.
 *
 * The cost is that the chart is not a calendar. The date is on the last point's tooltip and in the
 * panel header rather than on the axis, because an axis of 30 evenly spaced ticks with no dates is
 * worse than no axis.
 *
 * ============================================================================
 * WHY THIS IS HAND-ROLLED SVG
 * ============================================================================
 *
 * There is no charting library in the project, and `QuadrantPlot`, `DistributionStrip`, `Meter` and
 * `RatingRing` are all hand-rolled SVG. Following that pattern costs nothing in consistency and
 * avoids a dependency for one sparkline-scale chart.
 */

/** One observation. `value` is a close on the 0-1000 band. */
export interface PricePoint {
  date: string;
  value: number;
}

/**
 * Padding inside the viewBox, in user units.
 *
 * `left` is the widest because it carries the axis labels; `bottom` is for the date range, which is
 * drawn once under the chart rather than as ticks.
 */
export const CHART_PADDING = { top: 10, right: 10, bottom: 20, left: 38 } as const;

export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 96;

const plotWidth = (width: number): number => width - CHART_PADDING.left - CHART_PADDING.right;
const plotHeight = (height: number): number => height - CHART_PADDING.top - CHART_PADDING.bottom;

/**
 * THE TOP OF THE DRAWN AXIS, WHICH IS NOT THE TOP OF THE PRICE BAND.
 *
 * `PRICE_MAX` is 1000 and it is the PRICING band: `fairPriceFor` maps a 0-100 valuation onto it,
 * `readSharePriceLedger` refuses a close outside it as corrupt, and `checkSharePrice` asserts a whole
 * season stays inside. Changing it would reprice every club in the league, so it is not touched.
 *
 * This is the CHART's ceiling, and it sits above the band on purpose. With the axis ending exactly
 * at 1000, a club trading at its maximum possible value draws ON the top edge, where it is
 * indistinguishable from a club that has left the scale -- and the single most expensive club in the
 * league is the one you can least afford to misread. Headroom above the band means the ceiling is
 * visible as a line the line has not reached.
 *
 * The consequence to keep in mind: 1300 units of axis for a 1000-unit band means every price
 * occupies about 77% of the vertical space it did before, which is a real reduction in apparent
 * variance. It buys an honest ceiling at that price, and it is the right trade -- a jagged chart that
 * cannot show a club at its maximum is worse than a calmer one that can.
 */
export const AXIS_CEILING = 1300;

/**
 * THE STEPS THE DRAWN AXIS MAY TAKE, and the ceiling is now computed from the data rather than fixed.
 *
 * The axis was hard-pinned at $1,300 because nothing had ever traded above $1,000. Then two things
 * changed and the pin became a bug:
 *
 *   1. `nextPrice` stopped clamping the close to `PRICE_MAX`, so a price can exceed its own fair value
 *      as a premium. Measured across five leagues, the widest premium was 2.400x fair and the highest
 *      close was $1,963.04.
 *   2. So a real club in a real league now sits ABOVE the top of the plot, where it is indistinguishable
 *      from a club that has left the scale. That is the same defect the pin was introduced to prevent,
 *      moved up a level.
 *
 * WHY STEPS RATHER THAN A FITTED CEILING. A continuous fit to the visible data would make a quiet week
 * rescale the axis, so a flat fortnight looks like a crash -- which is precisely what the fixed axis
 * existed to stop, and what `checkShareChart` check 2 exists to catch. Stepping at round numbers keeps
 * that property: the axis only ever moves when a price GENUINELY crosses a step, and a week that is
 * merely boring cannot reach the next one.
 *
 * WHY THE CEILING IS COMPUTED BY THE CALLER. Every chart on the page must share one scale or two clubs
 * are not comparable, so the ceiling is derived from the whole visible ledger in `ExchangeView` and
 * passed in. A per-chart ceiling would be the fitted axis this is avoiding.
 */
export const AXIS_STEPS = [1300, 2000, 3000, 5000, 10_000, 25_000, 50_000, 100_000] as const;

/** The smallest step that contains every one of these closes. */
export const axisCeilingFor = (closes: Iterable<number>): number => {
  let max = 0;
  for (const c of closes) {
    if (typeof c === 'number' && Number.isFinite(c) && c > max) max = c;
  }
  for (const step of AXIS_STEPS) if (max <= step) return step;
  return AXIS_STEPS[AXIS_STEPS.length - 1];
};

/**
 * Vertical position for a price.
 *
 * `ceiling` defaults to `AXIS_CEILING` so every existing call keeps working and so a caller that
 * forgets to pass one gets the old behaviour rather than a broken scale. It is NOT data-driven by
 * default -- the caller decides, from the whole ledger, and that decision is what keeps two clubs on
 * one scale.
 *
 * Exported and separately checked because an inverted axis is the failure this cannot be eyeballed
 * out of: a chart that draws a rising price as a falling line still looks like a chart.
 */
export const yFor = (
  value: number,
  height: number = CHART_HEIGHT,
  ceiling: number = AXIS_CEILING,
): number => {
  const clamped = Math.max(0, Math.min(ceiling, value));
  const ratio = clamped / ceiling;
  return CHART_PADDING.top + (1 - ratio) * plotHeight(height);
};

/**
 * Horizontal position for the nth observation.
 *
 * A single observation is CENTRED rather than pinned left, because one point drawn on the left edge
 * reads as "the series started here and fell off" rather than as "there is one point".
 */
export const xFor = (index: number, count: number, width: number = CHART_WIDTH): number => {
  if (count <= 1) return CHART_PADDING.left + plotWidth(width) / 2;
  return CHART_PADDING.left + (index / (count - 1)) * plotWidth(width);
};

/**
 * Which observation a pointer is nearest, from a position in VIEWBOX units.
 *
 * THE INVERSE OF `xFor`, and exported and checked for the same reason `xFor` is: hit-testing that
 * lives inline in a pointer handler is untestable and wrong in a way nobody notices, because the
 * symptom is a crosshair that sits one day away from the dot it is labelling.
 *
 * Two details are load-bearing:
 *
 *  - It takes viewBox units, not raw client pixels. While the chart was rendered by stretching a
 *    fixed 720-unit viewBox to fill its panel, the caller had to divide by the stretch factor or the
 *    crosshair drifted right and pinned to the last day. The chart now sets its viewBox to the
 *    measured pixel width, so the two are the same number -- but the caller still passes through a
 *    ratio rather than assuming 1, because a rounding error during a resize should move the
 *    crosshair slightly rather than throw.
 *  - A single observation is CENTRED, matching `xFor`, so `indexFromX` at its own x returns 0 rather
 *    than falling out of a `(count - 1)` division by zero.
 *
 * Clamped at both ends: a pointer dragged past the plot resolves to the first or last day rather
 * than to `null` or an out-of-range index. Off-plot is still "nearest to an edge".
 */
export const indexFromX = (
  x: number,
  count: number,
  width: number = CHART_WIDTH,
): number => {
  if (count <= 0) return -1;
  if (count === 1) return 0;
  const span = plotWidth(width);
  if (span <= 0) return 0;
  const ratio = (x - CHART_PADDING.left) / span;
  const index = Math.round(ratio * (count - 1));
  return Math.max(0, Math.min(count - 1, index));
};

/**
 * The polyline path.
 *
 * Returns an empty string for no points rather than a degenerate path, so a caller can test truthiness
 * instead of checking lengths. One point yields a single `M` with no line to it -- there is nothing
 * to draw between a point and itself, and inventing a horizontal segment would imply a flat day.
 */
export const linePath = (
  points: readonly PricePoint[],
  width: number = CHART_WIDTH,
  height: number = CHART_HEIGHT,
  ceiling: number = AXIS_CEILING,
): string => {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i, points.length, width).toFixed(2)} ${yFor(p.value, height, ceiling).toFixed(2)}`)
    .join(' ');
};

/**
 * The reference lines: the price band's edges and midpoint, plus the drawn ceiling above them.
 *
 * `PRICE_MAX` is drawn differently from the rest on purpose. It is not just another gridline --
 * it is the most a club can be worth, and a line that reaches it is a club that cannot go higher.
 * Labelled and stroked as its own thing so "at the ceiling" is a state you can see rather than
 * infer from a line touching the top of the plot.
 *
 * Labels carry the currency because every other number on this page does, and an axis that reads
 * 0/500/1000 next to a headline reading $499.37 is asking the reader to do a unit conversion.
 */
const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const label = (value: number): string => `$${groupThousands(value.toFixed(0))}`;

/**
 * The reference lines for a given axis ceiling.
 *
 * `0`, `$500` and `$1,000` are ECONOMIC markers and are always drawn, because they are fixed facts
 * rather than positions on a scale: $500 is where a club sits at exactly fair value, and $1,000 is the
 * most the valuation model can say a club is worth. Neither moves when the axis does.
 *
 * The ceiling is the drawn top of the plot and is stroked and weighted separately so it cannot be
 * mistaken for a price -- above $1,000 it is emphatically not a price, since nothing can be WORTH
 * more than that. It is only where the picture stops.
 *
 * ONE extra midpoint is added above $1,000 when the gap is wide enough to need it, because at a
 * $5,000 ceiling a reader looking at a line between $1,000 and $5,000 has nothing to judge it against.
 * The rule is stated rather than tuned: a midpoint is drawn when the gap exceeds one and a half times
 * the $500 spacing used below it, so the reference lines never bunch together.
 */
export function bandLinesFor(ceiling: number): Array<{ value: number; label: string; kind: 'ceiling' | 'band' | 'mid' }> {
  const lines: Array<{ value: number; label: string; kind: 'ceiling' | 'band' | 'mid' }> = [
    { value: ceiling, label: label(ceiling), kind: 'ceiling' },
    { value: PRICE_MAX, label: label(PRICE_MAX), kind: 'band' },
    { value: PRICE_MAX / 2, label: label(PRICE_MAX / 2), kind: 'band' },
    { value: 0, label: label(0), kind: 'band' },
  ];
  const gap = ceiling - PRICE_MAX;
  if (gap > (PRICE_MAX / 2) * 1.5) {
    lines.splice(1, 0, { value: Math.round((ceiling + PRICE_MAX) / 2), label: label(Math.round((ceiling + PRICE_MAX) / 2)), kind: 'mid' });
  }
  return lines;
}

/**
 * The reference lines for the DEFAULT axis, kept as a named export because the check suite asserts
 * against them directly.
 *
 * Declared after `bandLinesFor` and its label helpers on purpose: a module-level `const` calling a
 * helper declared further down throws a temporal-dead-zone error at import time, which is exactly the
 * kind of failure that only appears when something else happens to import the module first.
 */
export const BAND_LINES = bandLinesFor(AXIS_CEILING);

/**
 * Day-over-day change on the last observation, as a fraction. Null unless there are two points.
 *
 * A single day has no move, and reporting 0% for it would be a claim about a change that did not
 * happen yet.
 */
export const lastMove = (points: readonly PricePoint[]): number | null => {
  if (points.length < 2) return null;
  const prev = points[points.length - 2].value;
  if (prev === 0) return null;
  return points[points.length - 1].value / prev - 1;
};

/**
 * Paths for a series that may be missing days, one per CONTIGUOUS run that has values.
 *
 * Returns an array rather than a single string, and that is the honest part. Two series on this
 * chart can both have holes: the fair layer, where a day whose valuation was corrupt keeps its close
 * and loses its valuation; and the comparison club's closes, where a club absent from a day leaves a
 * `null`. Joining straight across either would draw a line through a day the data says nothing
 * about, which reads as a measured path and is not one.
 *
 * So a gap is drawn as a gap. A line with a break in it is true; a continuous one through a missing
 * day is a fabrication with a stroke.
 *
 * Named for what it does rather than for the first caller: both the fair layer and the comparison
 * series use it, and a function called `fairSegments` that also drew comparison lines would be
 * lying about its own contract.
 *
 * A run of one yields an `M` with nothing after it, which draws no visible mark -- correct, since a
 * lone value has no segment to it.
 */
export const gapSegments = (
  fair: readonly (PricePoint | null)[],
  width: number = CHART_WIDTH,
  height: number = CHART_HEIGHT,
  ceiling: number = AXIS_CEILING,
): string[] => {
  const segments: string[] = [];
  let current: string[] = [];
  fair.forEach((point, i) => {
    if (!point) {
      if (current.length > 0) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${xFor(i, fair.length, width).toFixed(2)} ${yFor(point.value, height, ceiling).toFixed(2)}`);
  });
  if (current.length > 0) segments.push(current.join(' '));
  /*
    Runs of ONE are dropped, rather than returned as a bare `M`.

    `linePath` deliberately returns a lone `M` for a single point -- it is a different contract,
    because that path still describes the whole series. Here the array is a list of THINGS TO DRAW,
    and an `M` with nothing after it draws nothing. Returning it would put an empty `<path>` in the
    DOM and make `fairPaths.length` count runs rather than visible strokes, which is the number a
    reader would use to ask "is there a fair line?". It should answer that.
  */
  return segments.filter((d) => (d.match(/[ML]/g) ?? []).length > 1);
};

export interface SharePriceChartProps {
  points: readonly PricePoint[];
  /** Rendered width in px. Height is fixed by CHART_HEIGHT. */
  width?: number;
  height?: number;
  /** Describes the series for a screen reader. Required: an SVG chart is meaningless without one. */
  'aria-label'?: string;
  /** Draws the 500 midpoint and band edges. Off for a sparkline. */
  showBand?: boolean;
  /**
   * The recorded fair layer, INDEX-ALIGNED with `points`. A `null` is a day with no valuation.
   *
   * Aligned by index rather than by date on purpose: the two series come from the same ledger and
   * cover the same days, so index alignment is what keeps the vertical gap between the lines
   * meaning "how far this club has strayed from fair" instead of "these two series happen to share a
   * y-axis". Re-matching by date inside the chart would silently realign them and destroy that.
   */
  fair?: readonly (PricePoint | null)[];
  /**
   * A SECOND club's closes, drawn over the first for comparison.
   *
   * INDEX-ALIGNED with `points`, on the same fixed 0-1000 axis, and that is the whole design. Two
   * clubs on one axis is readable; thirty-two is a grey rectangle, which is why this is a pair rather
   * than a set. Because the axis is fixed rather than fitted to the pair, the vertical distance
   * between the two lines IS the price difference -- auto-fitting would rescale on every selection
   * and turn the comparison into a picture of nothing.
   *
   * Drawn in neutral ink rather than a second accent colour. Every accent in this app belongs to a
   * named outlet or to a bet outcome, and a comparison line is neither; borrowing an accent would
   * claim an identity the series does not have.
   */
  secondary?: readonly (PricePoint | null)[];
  /**
   * Reports which observation the pointer is over, or `null` when it has left.
   *
   * The READOUT IS THE CALLER'S, not the chart's, and that is deliberate rather than a limitation.
   * This SVG is rendered stretched, so any text drawn inside it is horizontally distorted along with
   * the geometry -- which is already true of the band labels and is a separate thing to fix. Putting
   * the numbers in real HTML beside the chart keeps them selectable, translatable and readable by a
   * screen reader at its natural size.
   *
   * What stays inside is the crosshair: a vertical line and two dots, which are not text and are not
   * visibly harmed by the scale.
   */
  onHover?: (index: number | null) => void;
  /**
   * The top of the drawn axis. Must be the SAME number for every chart on the page.
   *
   * The caller computes it from the whole visible ledger via `axisCeilingFor`, not per chart. That is
   * the whole point: two clubs are only comparable if they share a scale, and a per-chart ceiling
   * would be the fitted axis this prop exists to avoid. `ExchangeView` owns it.
   */
  ceiling?: number;
  className?: string;
}

export const SharePriceChart: React.FC<SharePriceChartProps> = ({
  points,
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
  'aria-label': ariaLabel,
  showBand = false,
  fair,
  secondary,
  onHover,
  ceiling = AXIS_CEILING,
  className = '',
}) => {
  /*
    THE VIEWBOX IS THE MEASURED WIDTH, so nothing is ever stretched.

    This chart used to declare a fixed 720-unit viewBox and stretch it to fill its panel with
    `preserveAspectRatio="none"`. That fills the space correctly and quietly corrupts everything in
    it that is not a path: the 0 / 500 / 1000 band labels came out visibly wider than they are tall,
    because a horizontal scale of 1254/720 = 1.74 was applied to glyphs and not to the line.

    Rather than special-case the text, the viewBox is set to the element's ACTUAL pixel width and
    every geometry call uses that same number. One user unit is one CSS pixel, so there is no scale
    factor at all -- the labels are the right shape and the strokes need no `vectorEffect` to stay
    hairlines. The fixed `width` prop is what the check suite asserts against and what is used
    before the first measurement lands, so server-side and test rendering are unchanged.

    `preserveAspectRatio="none"` is kept deliberately. With a matching viewBox it is a no-op, and if
    the panel resizes between a frame's measure and its paint it degrades to "very slightly wrong"
    instead of letterboxing and leaving a gap.
  */
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [measured, setMeasured] = React.useState<number | null>(null);

  React.useLayoutEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const measure = (): void => {
      const next = Math.round(node.getBoundingClientRect().width);
      // Ignore a zero-width reading, which happens while the panel is collapsed. Falling back to
      // the declared width keeps the chart drawable rather than dividing by nothing.
      if (next > 0) setMeasured(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const plotWidthUnits = measured ?? width;
  const path = linePath(points, plotWidthUnits, height, ceiling);
  // Teal, the neutral accent. This is a reference line and not a bet, so it takes neither the
  // positive nor the negative colour -- a dashed fair line in green would read as an outcome.
  const fairPaths = fair ? gapSegments(fair, plotWidthUnits, height, ceiling) : [];
  /*
    THE COMPARISON LINE, drawn UNDER the primary so the primary stays the subject.

    It is drawn with the same gap handling as the fair layer rather than as one solid stroke, because
    a comparison club can be absent from a day for the same reasons fair value can be.

    The length is checked first: a series of a different length than `points` would be positioned
    against the wrong days, and `gapSegments` places by index, so a short array would silently
    stretch. The page builds it from the same ledger in the same pass, so a mismatch means something
    upstream has gone wrong and drawing nothing is the honest response.
  */
  const secondaryPaths = secondary && secondary.length === points.length
    ? gapSegments(secondary, plotWidthUnits, height, ceiling)
    : [];
  const [hover, setHover] = React.useState<number | null>(null);

  /*
    REPORTING IS THE EFFECT, and the state is private, so a caller that passes `onHover` cannot be
    left showing a day the pointer has already left. `onHover` is also deliberately NOT in the
    dependency list: a caller passing an inline arrow would otherwise get a fresh callback every
    render, and an effect keyed on it would fire on every render too. Using a ref for the latest
    callback is what keeps the notification tied to the HOVER rather than to renders.
  */
  const onHoverRef = React.useRef(onHover);
  onHoverRef.current = onHover;

  const announce = React.useCallback((index: number | null) => {
    setHover(index);
    onHoverRef.current?.(index);
  }, []);

  /*
    CLIENT PIXELS ARE ALREADY VIEWBOX UNITS.

    This used to scale `event.clientX` by `rect.width / width` because the svg was stretched. Now
    that the viewBox IS the rendered width, one client pixel past the left edge is one viewBox unit,
    and the scale factor is 1. The conversion is kept as a ratio anyway rather than deleted: if the
    two ever disagree by a rounding error mid-resize, this is the line that absorbs it, and a
    crosshair that is one day out is a much quieter failure than a division by a stale width.
  */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * plotWidthUnits;
    announce(indexFromX(x, points.length, plotWidthUnits));
  };

  /*
    KEYBOARD PARITY, because a pointer-only readout is not a feature for everyone.

    Arrow keys step a day, Home and End jump to the ends, Escape clears. `preventDefault` on the
    arrows so the page does not scroll while someone is walking the series.
  */
  const handleKey = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (points.length === 0) return;
    const current = hover === null ? points.length - 1 : hover;
    const step = (next: number): void => {
      event.preventDefault();
      announce(Math.max(0, Math.min(points.length - 1, next)));
    };
    if (event.key === 'ArrowRight') step(current + 1);
    else if (event.key === 'ArrowLeft') step(current - 1);
    else if (event.key === 'Home') step(0);
    else if (event.key === 'End') step(points.length - 1);
    else if (event.key === 'Escape') announce(null);
    else return;
  };

  const hoveredPoint = hover !== null && hover >= 0 && hover < points.length ? points[hover] : null;
  const hoveredFair = hover !== null && fair ? fair[hover] ?? null : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${plotWidthUnits} ${height}`}
      width="100%"
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? 'HXSE share price'}
      preserveAspectRatio="none"
      onPointerMove={handlePointer}
      onPointerLeave={() => announce(null)}
      onKeyDown={handleKey}
      onBlur={() => announce(null)}
      /*
        FOCUSABLE, and the reason is that the readout is only reachable another way.

        The svg keeps `role="img"` rather than becoming a `slider` or `application`: the thing being
        communicated is a picture of a series, and the arrow keys are a convenience for reaching the
        numbers, not the only way to get them -- the caller's readout region is the accessible path
        and is marked `aria-live` on its side. A `tabIndex` with no role change is the honest middle.

        Not focusable when there is nothing to walk: an empty or single-point series would give the
        keyboard focus to a chart with no second day to move to.
      */
      tabIndex={points.length > 1 ? 0 : undefined}
    >
      {showBand && bandLinesFor(ceiling).map((line) => {
        const isCeiling = line.kind === 'ceiling';
        const isBandEdge = line.kind === 'band' && line.value === PRICE_MAX;
        const isMid = line.kind === 'band' && line.value === PRICE_MAX / 2;
        return (
        <g key={line.value}>
          <line
            x1={CHART_PADDING.left}
            x2={plotWidthUnits - CHART_PADDING.right}
            y1={yFor(line.value, height, ceiling)}
            y2={yFor(line.value, height, ceiling)}
            stroke={isMid
              ? 'var(--color-chrome-mid)'
              : isCeiling
                ? 'var(--color-chrome-mid)'
                : 'var(--color-chrome-lo)'}
            strokeWidth={isCeiling || isBandEdge ? 1 : isMid ? 1 : 0.5}
            strokeDasharray={isMid ? '3 3' : isCeiling ? '2 4' : undefined}
            strokeOpacity={isCeiling ? 0.7 : 1}
          />
          <text
            x={2}
            /*
              11px, not 8. The old size was legible only because the axis was 140px tall and the
              labels were a footnote; at 680px the same 8px type is unreadable from a normal
              viewing distance, and an axis you cannot read is decoration. Anchored with a
              dominant-baseline middle rather than a +3 nudge so the label sits ON its line at any
              size instead of drifting below it.
            */
            y={yFor(line.value, height, ceiling)}
            dominantBaseline="middle"
            fill={isCeiling ? 'var(--color-ink-dim)' : 'var(--color-ink-faint)'}
            fontSize={11}
            fontWeight={isCeiling || isBandEdge ? 600 : 400}
          >
            {line.label}
          </text>
        </g>
        );
      })}

      {/* The recorded fair layer, drawn UNDER the close so the close stays the subject. */}
      {fairPaths.map((d, i) => (
        <path
          key={`fair-${i}`}
          d={d}
          fill="none"
          stroke="var(--color-neutral)"
          strokeWidth={1}
          strokeDasharray="4 3"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/*
        The comparison club, under everything. `--color-ink-faint` rather than a second accent: the
        accents all belong to a named outlet or to a bet outcome, and a comparison series is neither.
        It is the FAINTEST ink rather than the dim one because at 1px on a dark panel the dim ink was
        reading brighter than the dashed fair line and pulling the eye off the club under study.
      */}
      {secondaryPaths.map((d, i) => (
        <path
          key={`secondary-${i}`}
          d={d}
          fill="none"
          stroke="var(--color-ink-faint)"
          strokeWidth={1}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}

      {/*
        THE CROSSHAIR, drawn above both series so the dot on the close sits on top of the line it
        belongs to.

        The vertical rule is `--color-ink-faint` at low opacity rather than a series colour: it marks
        a POSITION, and colouring it teal would make it read as fair value. `vectorEffect` keeps it
        one pixel wide under the horizontal stretch.
      */}
      {hoveredPoint ? (
        <g pointerEvents="none">
          <line
            x1={xFor(hover as number, points.length, plotWidthUnits)}
            x2={xFor(hover as number, points.length, plotWidthUnits)}
            y1={CHART_PADDING.top}
            y2={height - CHART_PADDING.bottom}
            stroke="var(--color-ink-faint)"
            strokeWidth={1}
            strokeOpacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
          {/* The fair dot is drawn only where a valuation was actually recorded. */}
          {hoveredFair ? (
            <circle
              cx={xFor(hover as number, points.length, plotWidthUnits)}
              cy={yFor(hoveredFair.value, height, ceiling)}
              r={3}
              fill="none"
              stroke="var(--color-neutral)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          <circle
            cx={xFor(hover as number, points.length, plotWidthUnits)}
            cy={yFor(hoveredPoint.value, height, ceiling)}
            r={3.5}
            fill="var(--color-media-glorest)"
            stroke="var(--color-panel)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}

      {/*
        The area under the line is the chart's only non-data ink. It is drawn from the line down to the
        band floor at a low opacity, which reads as "volume of time spent at this price" without
        needing a second series to say it.
      */}
      {points.length > 1 && (
        <path
          d={`${path} L${xFor(points.length - 1, points.length, plotWidthUnits).toFixed(2)} ${yFor(0, height, ceiling).toFixed(2)} L${xFor(0, points.length, plotWidthUnits).toFixed(2)} ${yFor(0, height, ceiling).toFixed(2)} Z`}
          fill="var(--color-media-glorest)"
          /*
            0.06, down from 0.10, and the height is why.

            The fill is drawn from the line down to zero, so its AREA grows with the square of the
            chart height while the line's thickness stays constant. At 140px it was a hint of colour
            under the line. At 680px the same 0.10 is a solid block covering most of the plot, and it
            was the heaviest object on the page -- heavier than the series it was supposed to be
            supporting.
          */
          fillOpacity={0.06}
          stroke="none"
        />
      )}

      {path && (
        <path
          d={path}
          fill="none"
          stroke="var(--color-media-glorest)"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/*
        The last point gets a dot. Without it the newest close has no visible terminus and the eye
        reads the line as continuing past the data.
      */}
      {points.length > 0 && (
        <circle
          cx={xFor(points.length - 1, points.length, plotWidthUnits)}
          cy={yFor(points[points.length - 1].value, height, ceiling)}
          r={2}
          fill="var(--color-media-glorest)"
        />
      )}
    </svg>
  );
};
