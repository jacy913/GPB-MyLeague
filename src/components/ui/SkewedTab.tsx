import React from 'react';

export type SkewedTabVariant = 'inactive' | 'active';
export type SkewedTabDirection = 'skew-r' | 'skew-l';

interface SkewedTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  direction?: SkewedTabDirection;
  variant?: SkewedTabVariant;
  children: React.ReactNode;
  className?: string;
}

/**
 * SkewedTab — Tab-strip segment with angular geometry.
 *
 * The skew-shadow wrapper pattern is enforced internally so the focus ring
 * remains visible (clip-path would clip a naive outline).
 */
export const SkewedTab: React.FC<SkewedTabProps> = ({
  direction = 'skew-r',
  variant = 'inactive',
  children,
  className = '',
  ...props
}) => {
  const base = 'skew-shadow relative px-4 py-2 t-label transition-colors';
  const dirClass = direction;
  const variantClass = variant === 'active'
    ? 'bg-[var(--color-gold)] text-[var(--color-ink-invert)]'
    : 'bg-[var(--color-panel-2)] text-[var(--color-ink-dim)] hover:bg-[var(--color-panel-3)]';

  return (
    <button className={`${base} ${dirClass} ${variantClass} ${className}`} {...props}>
      <span className="relative z-10">{children}</span>
    </button>
  );
};