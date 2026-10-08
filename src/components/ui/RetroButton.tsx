import React from 'react';

export type RetroButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type RetroButtonSize = 'sm' | 'md' | 'lg';

interface RetroButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: RetroButtonVariant;
  size?: RetroButtonSize;
  children: React.ReactNode;
  className?: string;
  /**
   * Cut the right edge into a chevron.
   *
   * On by default for the primary variant only. A pointed action is the era's
   * strongest signal and it means "this is the one to press" -- applying it to
   * every button in the product would be a rash of arrowheads and would say
   * nothing. Default and ghost stay square.
   */
  chevron?: boolean;
}

/**
 * RetroButton — Beveled control with machined press-into-surface active state.
 *
 * State deltas:
 * - hover: gold sweep travels left to right, bevel rises
 * - active: translate 0, shadow removed (pressed into surface)
 * - focus: 2px gold outline, 2px offset
 * - disabled: 40% opacity, no shadow, cursor-not-allowed
 *
 * The hover is a wipe rather than a brightness lift. A flat "slightly lighter"
 * is what every web interface has done since 2004; the gold travelling across
 * the face is the highlight bar on a cabinet, and it is the single cheapest
 * thing that makes the product read as that era rather than a spreadsheet.
 */
export const RetroButton: React.FC<RetroButtonProps> = ({
  variant = 'default',
  size = 'md',
  children,
  className = '',
  disabled,
  chevron,
  ...props
}) => {
  const base = 'relative inline-flex items-center justify-center transition-all duration-[var(--dur-fast)] ease-[var(--ease-snap)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';

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

  const pointed = chevron ?? variant === 'primary';

  /*
   * The chevron cut removes a wedge from the RIGHT of the box, and the content
   * is centred in the whole box, so the last few characters ended up underneath
   * the cut -- "Quick Sim" rendered as "Quick| Sim" with the m sheared off.
   *
   * The fix is padding on the cut side, not a narrower cut: a shallower angle
   * stops reading as a chevron at all, and the wedge is what carries the era.
   * The padding is a fraction of the cut so the point stays sharp.
   */
  const sizeClass: Record<RetroButtonSize, string> = {
    sm: pointed ? 't-caption pl-3 pr-5 py-1.5' : 't-caption px-3 py-1.5',
    md: pointed ? 't-label pl-4 pr-7 py-2' : 't-label px-4 py-2',
    lg: pointed ? 't-h3 pl-6 pr-10 py-3' : 't-h3 px-6 py-3',
  };

  return (
    <button
      className={`${base} ${pointed ? 'chev gold-sweep' : 'gold-sweep'} ${sizeClass[size]} ${variantClasses[variant].replace(/\s+/g, ' ').trim()} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
