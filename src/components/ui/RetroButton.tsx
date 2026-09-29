import React from 'react';

export type RetroButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type RetroButtonSize = 'sm' | 'md' | 'lg';

interface RetroButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: RetroButtonVariant;
  size?: RetroButtonSize;
  children: React.ReactNode;
  className?: string;
}

/**
 * RetroButton — Beveled control with machined press-into-surface active state.
 *
 * State deltas:
 * - hover: translate -1px, shadow grows to 3px
 * - active: translate 0, shadow removed (pressed into surface)
 * - focus: 2px gold outline, 2px offset
 * - disabled: 40% opacity, no shadow, cursor-not-allowed
 */
export const RetroButton: React.FC<RetroButtonProps> = ({
  variant = 'default',
  size = 'md',
  children,
  className = '',
  disabled,
  ...props
}) => {
  const base = 'relative inline-flex items-center justify-center transition-all duration-[var(--dur-fast)] ease-[var(--ease-snap)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';

  const sizeClass: Record<RetroButtonSize, string> = {
    sm: 't-caption px-3 py-1.5',
    md: 't-label px-4 py-2',
    lg: 't-h3 px-6 py-3',
  };

  const variantClasses: Record<RetroButtonVariant, string> = {
    primary: `
      bg-gradient-to-b from-[var(--color-gold-hi)] via-[var(--color-gold)] to-[var(--color-gold-lo)]
      border border-[var(--color-gold-lo)]
      text-[var(--color-ink-invert)]
      shadow-[var(--shadow-bev-sm)]
      hover:-translate-y-px hover:shadow-[2px_3px_0_rgba(0,0,0,0.65)]
      active:translate-y-0 active:shadow-none
    `,
    default: `
      bg-gradient-to-b from-[var(--color-chrome-hi)] via-[var(--color-chrome-mid)] to-[var(--color-chrome-lo)]
      border border-[var(--color-chrome-lo)]
      text-[var(--color-ink)]
      shadow-[var(--shadow-bev-sm)]
      hover:-translate-y-px hover:shadow-[2px_3px_0_rgba(0,0,0,0.65)]
      active:translate-y-0 active:shadow-none
    `,
    ghost: `
      bg-transparent
      border border-[var(--color-chrome-lo)]
      text-[var(--color-ink-dim)]
      hover:bg-[var(--color-panel-2)]
      hover:text-[var(--color-ink)]
    `,
    danger: `
      bg-[var(--color-neg)]
      border-none
      text-[var(--color-ink)]
      hover:brightness-110
      active:brightness-90
    `,
  };

  return (
    <button
      className={`${base} ${sizeClass[size]} ${variantClasses[variant].replace(/\s+/g, ' ').trim()} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
