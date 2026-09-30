import React from 'react';

/**
 * Chevron and parallelogram marks.
 *
 * The silver-age Japanese console look is built from hard diagonals. On a 2002
 * cabinet the menu bar was a parallelogram, the selection cursor was a chevron,
 * and a "go" prompt was a stepped arrow. Rectangles read as a spreadsheet.
 *
 * These are small, presentational, and used across headers, the nav rail and
 * panel titles, so they live in the primitive barrel rather than being
 * re-declared per screen.
 */

/** Chevron depth, matching the --chev token. Overridable per instance. */
export type ChevronProps = {
  className?: string;
  /** Tail length. Reads as a 2000s UI cursor at 10px. */
  depth?: number;
  /**
   * Where the point faces. A right-pointing chevron marks "forward" and a
   * left-pointing one marks "back"; neither is decorative, both mean something.
   */
  direction?: 'left' | 'right';
  /** Tail width perpendicular to the point. */
  height?: number;
};

/**
 * A single chevron.
 *
 * Rendered as a clip-path on a background-coloured box rather than as an SVG or
 * a glyph, so it scales off one token and takes the current colour without a
 * second source of truth for the shape.
 */
export const Chevron: React.FC<ChevronProps> = ({
  className = '',
  depth = 10,
  direction = 'right',
  height = 8,
}) => (
  <span
    aria-hidden="true"
    className={`inline-block shrink-0 bg-current ${direction === 'right' ? 'chev' : 'chev-rev'} ${className}`}
    style={{ width: height + depth, height, ['--chev' as string]: `${depth}px` }}
  />
);

/**
 * A run of chevrons pointing one way, for marking the edge of a selected item.
 *
 * `count` bars of decreasing opacity reads as speed lines rather than as a
 * progress indicator, which is the point: it should look like motion, not state.
 */
export type ChevronEdgeProps = {
  count?: number;
  className?: string;
  depth?: number;
  direction?: 'left' | 'right';
  height?: number;
};

export const ChevronEdge: React.FC<ChevronEdgeProps> = ({
  count = 3, className = '', depth = 7, direction = 'right', height = 12,
}) => (
  <span aria-hidden="true" className={`inline-flex shrink-0 items-center gap-[2px] text-[var(--color-gold)] ${className}`}>
    {Array.from({ length: count }, (_, i) => (
      <Chevron
        key={i}
        depth={depth}
        direction={direction}
        height={height}
        className={i === 0 ? 'opacity-100' : i === 1 ? 'opacity-60' : 'opacity-30'}
      />
    ))}
  </span>
);

/**
 * A parallelogram rule, the workhorse divider of the era.
 *
 * `fade` walks the opacity down across the bars so the rule appears to travel
 * out of frame rather than simply ending.
 */
export type StripeDividerProps = {
  className?: string;
  barClassName?: string;
  bars?: number;
  depth?: number;
  direction?: 'left' | 'right';
  height?: number;
};

export const StripeDivider: React.FC<StripeDividerProps> = ({
  className = '', barClassName = '', bars = 7, depth = 8, direction = 'right', height = 3,
}) => (
  <span
    aria-hidden="true"
    className={`inline-flex items-center gap-[3px] text-[var(--color-gold)] ${className}`}
  >
    {Array.from({ length: bars }, (_, i) => {
      // Opacity ramps toward the far end so the rule has direction.
      const t = bars === 1 ? 1 : 1 - Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2);
      return (
        <span
          key={i}
          className={`${direction === 'right' ? 'stripe' : 'stripe-rev'} ${barClassName}`}
          style={{
            width: 18,
            height,
            opacity: 0.25 + t * 0.75,
            ['--chev' as string]: `${depth}px`,
          }}
        />
      );
    })}
  </span>
);

/**
 * A titled parallelogram tab.
 *
 * Chrome-bar titles are the most repeated piece of furniture in the product, so
 * this is where the era's shape language pays for itself most. `tone` picks
 * between the standard chrome bar, a gold-filled active state, and a quiet
 * outline.
 */
export type ParallelogramTitleProps = {
  children: React.ReactNode;
  className?: string;
  depth?: number;
  tone?: 'chrome' | 'gold' | 'quiet';
};

export const ParallelogramTitle: React.FC<ParallelogramTitleProps> = ({
  children, className = '', depth = 10, tone = 'chrome',
}) => {
  const toneClass = tone === 'gold'
    ? 'bg-[var(--color-gold)] text-[var(--color-void)]'
    : tone === 'quiet'
      ? 'bg-transparent text-[var(--color-ink-faint)]'
      : 'bg-[var(--color-panel-3)] text-[var(--color-gold-hi)]';

  return (
    <span
      className={`parallelogram inline-flex items-center px-4 py-1 ${toneClass} ${className}`}
      style={{ ['--chev' as string]: `${depth}px` }}
    >
      {children}
    </span>
  );
};
