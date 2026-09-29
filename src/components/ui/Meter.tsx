import React from 'react';
import { StatValue } from './StatValue';

export interface MeterProps {
  value: number; // 0-100
  segments?: number; // default 20
  className?: string;
  'aria-label'?: string;
  showValue?: boolean; // show exact percentage beside meter
}

/**
 * Meter — 20-cell segmented gauge. Replaces every rounded progress bar.
 *
 * - 20 discrete square cells, 1px gaps, zero radius
 * - Filled: --color-gold, Empty: --color-sunken with --color-chrome-lo border
 * - Resolution: 5 percentage points per cell (100/20)
 * - Width animates over --dur-slow with --ease-snap
 * - If precise percentage needed, use StatValue instead (showValue prop)
 */
export const Meter: React.FC<MeterProps> = ({
  value,
  segments = 20,
  className = '',
  'aria-label': ariaLabel,
  showValue = false,
}) => {
  const clampedValue = Math.max(0, Math.min(100, value));
  const filledCount = Math.round((clampedValue / 100) * segments);

  const cells = Array.from({ length: segments }, (_, i) => (
    <div
      key={i}
      className={`
        h-full flex-1 shrink-0 transition-all duration-[var(--dur-slow)] ease-[var(--ease-snap)]
        ${i < filledCount
          ? 'bg-[var(--color-gold)]'
          : 'bg-[var(--color-sunken)] border border-[var(--color-chrome-lo)]'
        }
      `}
    />
  ));

  return (
    <div
      className={`inline-flex items-center gap-1 ${className}`}
      role="img"
      aria-label={ariaLabel ?? `${Math.round(clampedValue)}%`}
      style={{ width: '100%', maxWidth: '200px' }}
    >
      <div className="flex h-3 flex-1 gap-px">
        {cells}
      </div>
      {showValue && (
        <StatValue size="sm" variant="accent" className="ml-2 whitespace-nowrap">
          {Math.round(clampedValue)}%
        </StatValue>
      )}
    </div>
  );
};
