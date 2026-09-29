import React from 'react';

export type LeagueBadgeVariant = 'prestige' | 'platinum';

interface LeagueBadgeProps {
  variant: LeagueBadgeVariant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * LeagueBadge — Prestige / Platinum identifier chip.
 *
 * League colors are identity-only, never chrome. Used for team affiliation,
 * not for active states or general decoration.
 */
export const LeagueBadge: React.FC<LeagueBadgeProps> = ({
  variant,
  size = 'md',
  className = '',
}) => {
  const sizeClass: Record<'sm' | 'md' | 'lg', string> = {
    sm: 't-caption px-2 py-0.5',
    md: 't-label px-2.5 py-1',
    lg: 't-h3 px-3 py-1.5',
  };

  const variantClass = variant === 'prestige'
    ? 'bg-[var(--color-prestige)] text-[var(--color-ink-invert)]'
    : 'bg-[var(--color-platinum)] text-[var(--color-ink-invert)]';

  return (
    <span className={`inline-flex items-center ${sizeClass[size]} ${variantClass} ${className}`}>
      {variant === 'prestige' ? 'PRESTIGE' : 'PLATINUM'}
    </span>
  );
};