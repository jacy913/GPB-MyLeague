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
 * Vertical position for a price. Fixed band, so this is total and cannot be data-driven.
 *
 * Exported and separately checked because an inverted axis is the failure this cannot be eyeballed
 * out of: a chart that draws a rising price as a falling line still looks like a chart.
 */
export const yFor = (value: number, height: number = CHART_HEIGHT): number => {
  const clamped = Math.max(0, Math.min(PRICE_MAX, value));
  const ratio = clamped / PRICE_MAX;
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
): string => {
  if (points.length === 0) return '';
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i, points.length, width).toFixed(2)} ${yFor(p.value, height).toFixed(2)}`)
    .join(' ');
};

/** The band edges and midpoint, for the reference lines. */
export const BAND_LINES = [
  { value: PRICE_MAX, label: '1000' },
  { value: PRICE_MAX / 2, label: '500' },
  { value: 0, label: '0' },
] as const;

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

export interface SharePriceChartProps {
  points: readonly PricePoint[];
  /** Rendered width in px. Height is fixed by CHART_HEIGHT. */
  width?: number;
  height?: number;
  /** Describes the series for a screen reader. Required: an SVG chart is meaningless without one. */
  'aria-label'?: string;
  /** Draws the 500 midpoint and band edges. Off for a sparkline. */
  showBand?: boolean;
  className?: string;
}

export const SharePriceChart: React.FC<SharePriceChartProps> = ({
  points,
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
  'aria-label': ariaLabel,
  showBand = false,
  className = '',
}) => {
  const path = linePath(points, width, height);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? 'HXSE share price'}
      preserveAspectRatio="none"
    >
      {showBand && BAND_LINES.map((line) => (
        <g key={line.value}>
          <line
            x1={CHART_PADDING.left}
            x2={width - CHART_PADDING.right}
            y1={yFor(line.value, height)}
            y2={yFor(line.value, height)}
            stroke={line.value === PRICE_MAX / 2 ? 'var(--color-chrome-mid)' : 'var(--color-chrome-lo)'}
            strokeWidth={line.value === PRICE_MAX / 2 ? 1 : 0.5}
            strokeDasharray={line.value === PRICE_MAX / 2 ? '3 3' : undefined}
          />
          <text
            x={2}
            y={yFor(line.value, height) + 3}
            fill="var(--color-ink-faint)"
            fontSize={8}
          >
            {line.label}
          </text>
        </g>
      ))}

      {/*
        The area under the line is the chart's only non-data ink. It is drawn from the line down to the
        band floor at a low opacity, which reads as "volume of time spent at this price" without
        needing a second series to say it.
      */}
      {points.length > 1 && (
        <path
          d={`${path} L${xFor(points.length - 1, points.length, width).toFixed(2)} ${yFor(0, height).toFixed(2)} L${xFor(0, points.length, width).toFixed(2)} ${yFor(0, height).toFixed(2)} Z`}
          fill="var(--color-media-glorest)"
          fillOpacity={0.10}
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
          cx={xFor(points.length - 1, points.length, width)}
          cy={yFor(points[points.length - 1].value, height)}
          r={2}
          fill="var(--color-media-glorest)"
        />
      )}
    </svg>
  );
};