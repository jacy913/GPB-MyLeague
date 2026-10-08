import React from 'react';

export interface RatingRingProps {
  /** 0-100. Clamped to the floor/ceiling band. Default 60-100 for player ratings. */
  value: number | null;
  label: string;
  size?: number;
  strokeWidth?: number;
  /** Minimum value for the scale. Default 60. */
  floor?: number;
  /** Maximum value for the scale. Default 100. */
  ceiling?: number;
  /** Rendered under the value. */
  caption?: string;
  className?: string;
}

const DEFAULT_FLOOR = 60;
const DEFAULT_CEILING = 100;

/**
 * RatingRing — a single dial for a 60-100 rating.
 *
 * The club and player screens each had their own inline SVG dial, differing
 * only in radius, viewBox and accent colour. Two copies of a gauge that has to
 * stay visually identical is how they drift.
 *
 * The scale starts at 60 rather than 0 because that is where the ratings
 * actually begin. A ring that ran 0-100 would leave a 79 looking almost empty.
 */
export const RatingRing: React.FC<RatingRingProps> = ({
  value,
  label,
  size = 96,
  strokeWidth = 7,
  floor = DEFAULT_FLOOR,
  ceiling = DEFAULT_CEILING,
  caption,
  className = '',
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = value === null ? null : Math.max(floor, Math.min(ceiling, value));
  const progress = clamped === null ? 0 : (clamped - floor) / (ceiling - floor);
  const offset = circumference * (1 - progress);
  const filled = clamped !== null && clamped >= 88;

  // Display the actual value (not clamped) but use clamped for progress
  const displayValue = value === null ? '---' : typeof value === 'number' ? value.toFixed(1) : value;

  return (
    <div className={`relative flex shrink-0 flex-col items-center ${className}`} style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90"
          role="img"
          aria-label={`${label}: ${displayValue}`}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-sunken)"
            strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={filled ? 'var(--color-gold)' : 'var(--color-chrome-hi)'}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="t-caption text-[var(--color-ink-faint)]">{label}</span>
          <span className={`t-stat-lg mt-0.5 ${filled ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink)]'}`}>
            {displayValue}
          </span>
        </div>
      </div>
      {caption && <p className="t-caption mt-1 text-center text-[var(--color-ink-faint)]">{caption}</p>}
    </div>
  );
};
