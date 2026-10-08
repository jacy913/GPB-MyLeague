import React from 'react';

export type RetroButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type RetroButtonSize = 'sm' | 'md' | 'lg';

export type RetroButtonShape = 'rect' | 'chevron' | 'parallelogram';

/**
 * How the box is cut.
 *
 * `chevron` cuts the right edge only and is the default for the primary variant, because a pointed
 * action is the era's strongest signal and applying it everywhere would be a rash of arrowheads that
 * says nothing.
 *
 * `parallelogram` cuts both top corners the other way, the shape of a racing stripe. Both are
 * `clip-path`, which is why the padding for the cut has to be handled here rather than left to the
 * call site -- see the padding note below.
 *
 * `rect` forces the square, for a caller that wants the primary variant's weight without its point.
 */
export interface RetroButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: RetroButtonVariant;
  size?: RetroButtonSize;
  children: React.ReactNode;
  className?: string;
  /**
   * Cut the right edge into a chevron.
   *
   * Retained as an explicit override. Defaults to `true` for the primary variant only, and is now
   * redundant with `shape="chevron"`; kept because existing callers pass it and because an explicit
   * opt-out of the variant default is a real need.
   */
  chevron?: boolean;
  /** Box geometry. Defaults to the variant's own convention when `chevron` is not given. */
  shape?: RetroButtonShape;
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
  shape,
  ...props
}) => {
  const base = 'relative inline-flex items-center justify-center transition-all duration-[var(--dur-fast)] ease-[var(--ease-snap)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none';

  const variantClassesByName: Record<RetroButtonVariant, string> = {
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

  /*
   * The shape decides both the clip and the padding, and the padding is not optional.
   *
   * A `clip-path` cuts the painted box, but the CONTENT is still centred across the whole box, so
   * the wedge shears through the last few characters. That shipped once on the chevron: "Quick Sim"
   * rendered as "Quick| Sim" with the m half gone. The fix is padding on the cut side, not a
   * narrower cut -- a shallower angle stops reading as a chevron at all, and the wedge is what
   * carries the era.
   *
   * A parallelogram cuts BOTH top corners, so it needs symmetric room, which is why this is keyed
   * on shape rather than handled per call site: a caller adding a parallelogram button and forgetting
   * the padding would get a sheared label that still looked correct in code review.
   *
   * The pads are a fraction of `--chev` (10px) so the diagonal stays visibly sharp rather than
   * becoming a chamfer.
   */
  const resolvedShape: RetroButtonShape = shape ?? (chevron ?? variant === 'primary' ? 'chevron' : 'rect');
  const cutRight = resolvedShape === 'chevron';
  const cutBoth = resolvedShape === 'parallelogram';

  const sizeClass: Record<RetroButtonSize, string> = {
    sm: cutBoth ? 't-caption px-5 py-1.5' : cutRight ? 't-caption pl-3 pr-5 py-1.5' : 't-caption px-3 py-1.5',
    md: cutBoth ? 't-label px-6 py-2' : cutRight ? 't-label pl-4 pr-7 py-2' : 't-label px-4 py-2',
    lg: cutBoth ? 't-h3 px-9 py-3' : cutRight ? 't-h3 pl-6 pr-10 py-3' : 't-h3 px-6 py-3',
  };

  /*
   * The bevel shadow is dropped on a cut shape.
   *
   * `clip-path` clips box-shadow along with everything else, so keeping the bevel would mean
   * silently losing it -- a button that looks flat in one state and not another. The shape carries
   * the era on its own; the shadow was doing supporting work. Recorded here because the failure mode
   * is the shadow vanishing with no error and no way to tell from the code that it was ever asked
   * for.
   */
  const flatShadow = cutRight || cutBoth;

  const variantClasses = (raw: string): string =>
    (flatShadow ? raw.replace(/\s*(hover|active):[^\s]+/g, '') : raw).replace(/\s+/g, ' ').trim();

  const shapeClass =
    resolvedShape === 'parallelogram' ? 'parallelogram' : resolvedShape === 'chevron' ? 'chev' : '';

  return (
    <button
      className={`${base} ${shapeClass} gold-sweep ${sizeClass[size]} ${variantClasses(variantClassesByName[variant])} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
