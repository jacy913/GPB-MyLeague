import React from 'react';

export type StatValueVariant = 'default' | 'accent' | 'pos' | 'neg';
export type StatValueSize = 'sm' | 'default' | 'lg';

interface StatValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: StatValueVariant;
  size?: StatValueSize;
  children: React.ReactNode;
  className?: string;
}

/**
 * StatValue — A single figure with proper numeric typography.
 *
 * Variants:
 * - default: --color-ink, t-stat
 * - accent: --color-gold, t-stat (for highlighted/active values)
 * - pos: --color-pos, t-stat (positive differentials)
 * - neg: --color-neg, t-stat (negative differentials)
 */
export const StatValue: React.FC<StatValueProps> = ({
  variant = 'default',
  size = 'default',
  children,
  className = '',
  ...props
}) => {
  const sizeClass: Record<StatValueSize, string> = {
    sm: 't-stat-sm',
    default: 't-stat',
    lg: 't-stat-lg',
  };

  const variantClass: Record<StatValueVariant, string> = {
    default: 'text-[var(--color-ink)]',
    accent: 'text-[var(--color-gold)]',
    pos: 'text-[var(--color-pos)]',
    neg: 'text-[var(--color-neg)]',
  };

  return (
    <span className={`${sizeClass[size]} ${variantClass[variant]} tabular-nums ${className}`} {...props}>
      {children}
    </span>
  );
};