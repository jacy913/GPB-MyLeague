import React from 'react';

export type SegmentedControlMode = 'fit' | 'fill';

interface SegmentedControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  mode?: SegmentedControlMode;
  className?: string;
  'aria-label'?: string;
}

/**
 * SegmentedControl — Exclusive option set, replaces wrapping label rows.
 *
 * Variants:
 * - fit: auto-width segments (for 2–4 options)
 * - fill: equal-width segments (for tab-strip style)
 */
export const SegmentedControl: React.FC<SegmentedControlProps> = ({
  options,
  value,
  onChange,
  mode = 'fit',
  className = '',
  'aria-label': ariaLabel,
}) => {
  const base = 'inline-flex bg-[var(--color-sunken)] border border-[var(--color-chrome-lo)] rounded-[var(--radius-control)]';
  const modeClass = mode === 'fill' ? 'w-full' : '';
  const segmentBase = 'relative px-4 py-2 t-label transition-colors duration-[var(--dur-fast)] ease-[var(--ease-snap)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)]';
  const fillClass = mode === 'fill' ? 'flex-1 text-center' : '';

  return (
    <div className={`${base} ${modeClass} ${className}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-disabled={option.disabled}
          disabled={option.disabled}
          onClick={() => !option.disabled && onChange(option.value)}
          className={`${segmentBase} ${fillClass} ${
            value === option.value
              ? 'bg-[var(--color-gold)] text-[var(--color-ink-invert)] shadow-[var(--shadow-bev-sm)]'
              : 'text-[var(--color-ink-dim)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]'
          } ${option.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};