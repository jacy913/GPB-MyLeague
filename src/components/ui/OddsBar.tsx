import React from 'react';
import { StatValue } from './StatValue';

export interface OddsBarProps {
  /** 0-100 */
  odds: number;
  label: string;
  className?: string;
}

/**
 * OddsBar — proportional bar plus the exact figure.
 *
 * Deliberately not the segmented Meter. Award odds are a share of a field of
 * eight, so the leader typically holds around 20%, which fills four of twenty
 * cells and puts the entire top half of the race in the same band. The cells
 * cannot separate the candidates a leaderboard exists to compare.
 *
 * The width and the printed figure both read from one `odds` value, so the bar
 * conveys proportion without claiming a precision it does not have, and the
 * two can never disagree.
 */
export const OddsBar: React.FC<OddsBarProps> = ({ odds, label, className = '' }) => {
  const clamped = Math.max(0, Math.min(100, odds));
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div
        className="h-2 flex-1 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]"
        role="img"
        aria-label={`${label} at ${clamped.toFixed(1)} percent`}
      >
        <div
          className="h-full bg-[var(--color-gold)] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-snap)]"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <StatValue size="sm" variant="accent" className="w-[6ch] shrink-0 text-right">
        {clamped.toFixed(1)}%
      </StatValue>
    </div>
  );
};
