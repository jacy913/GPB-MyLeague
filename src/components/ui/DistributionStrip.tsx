import React, { useMemo } from 'react';
import type { Distribution } from '../../lib/analytics/percentile';

/**
 * A league's distribution for one stat, as a shape rather than a list.
 *
 * WHY THIS EXISTS. A leaderboard answers "who is first" and a percentile answers "how
 * good is first". Neither answers "is first actually unusual", because both are stated
 * relative to the reader's expectation rather than to the shape of the league. A strip
 * shows that shape directly: where the bulk of players sit, how wide the spread is, and
 * whether the leader is out on their own or one of a crowd.
 *
 * It is the single most useful thing on the new Dashboards screen, and it is cheap --
 * the data is already computed for the percentile column on the tables side.
 *
 * BINS, AND WHY NOT MORE. Thirty-two bins over a batting average would be a noisy comb
 * with most of them empty, because a handful of players would occupy one bin each. The
 * bin count is chosen so the populated bins outnumber the empty ones, and it is
 * documented in the code rather than left as a magic number.
 */
const BINS = 18;

export interface DistributionStripProps {
  label: string;
  distribution: Distribution;
  /** Formats the mean for the axis note. */
  format: (value: number) => string;
  /** The stat's name, for the accessible description. */
  unit: string;
  className?: string;
}

export const DistributionStrip: React.FC<DistributionStripProps> = ({
  label,
  distribution,
  format,
  unit,
  className = '',
}) => {
  const { sorted, mean, size } = distribution;

  const bins = useMemo(() => {
    if (sorted.length === 0) return { counts: [] as number[], low: 0, high: 0, peak: 1 };
    // The range is the observed one rather than a round number, because a round range
    // would put the whole league in two bins whenever the spread is narrow -- and a
    // narrow spread is exactly the case where the shape is worth seeing.
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (high <= low) {
      return { counts: sorted.map(() => 1), low, high, peak: 1 };
    }
    const width = (high - low) / BINS;
    const counts = new Array<number>(BINS).fill(0);
    sorted.forEach((value) => {
      const index = Math.min(BINS - 1, Math.floor((value - low) / width));
      counts[index] += 1;
    });
    return { counts, low, high, peak: Math.max(...counts, 1) };
  }, [sorted]);

  const span = bins.high - bins.low;
  /** Where the mean sits across the strip, 0-1. Null when the league is a single value. */
  const meanPosition = span > 0 ? (mean - bins.low) / span : null;

  const description = size === 0
    ? `${label}: no players to show yet.`
    : `${label} across ${size} players, from ${format(bins.low)} to ${format(bins.high)}, ${unit}. `
      + `League mean ${format(mean)}. `
      + `The tallest bar holds ${bins.peak} player${bins.peak === 1 ? '' : 's'}.`;

  return (
    <figure className={`m-0 ${className}`}>
      <figcaption className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="t-caption text-[var(--color-ink-dim)]">{label}</span>
        <span className="t-caption tabular-nums text-[var(--color-ink-faint)]">
          {size === 0 ? 'no data' : `mean ${format(mean)}`}
        </span>
      </figcaption>

      {size === 0 ? (
        <div className="flex h-10 items-center justify-center border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]">
          <span className="t-caption text-[var(--color-ink-faint)]">No {label.toLowerCase()} yet</span>
        </div>
      ) : (
        <div role="img" aria-label={description}>
          <div className="relative flex h-10 items-end gap-px border-b border-[var(--color-chrome-lo)]">
            {bins.counts.map((count, index) => {
              const height = (count / bins.peak) * 100;
              return (
                <span
                  key={index}
                  className="flex-1 bg-[var(--color-chrome-lo)]"
                  // A zero bin gets a sliver rather than nothing, so the reader can see
                  // the gap exists instead of seeing the bars close up and implying the
                  // league is continuous where it is not.
                  style={{ height: count === 0 ? '2px' : `${Math.max(height, 4)}%` }}
                />
              );
            })}
            {meanPosition !== null && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-[var(--color-gold)]"
                style={{ left: `${meanPosition * 100}%` }}
              />
            )}
          </div>
          <div className="mt-1 flex justify-between t-caption tabular-nums text-[var(--color-ink-faint)]">
            <span>{format(bins.low)}</span>
            <span>{format(bins.high)}</span>
          </div>
        </div>
      )}
    </figure>
  );
};