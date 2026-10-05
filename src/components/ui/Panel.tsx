import React from 'react';

export type PanelVariant = 'default' | 'sunken' | 'hero';

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant;
  /**
   * Passed through to the underlying `<div>`.
   *
   * `HTMLAttributes` stops short of `style` -- that lives on `CSSProperties`, which only the
   * `AllHTMLAttributes` shapes carry -- so a `style` prop was not in this interface even though the
   * component has always forwarded it: `Panel` spreads `...props` onto the div, so `style` reached the
   * DOM and worked. Only the type was wrong.
   *
   * Declared because callers use it to set a per-instance accent border, and leaving it off means the
   * one component every screen is built from is the one that cannot be given an inline style without
   * an error.
   */
  style?: React.CSSProperties;
  /**
   * Passed through to the underlying `<div>`.
   *
   * Declared rather than wrapped in `forwardRef`, because React 19 passes `ref` to a function
   * component as an ordinary prop. `React.FC` stopped including it, so every `<Panel ref={...}>` in
   * the app was an error -- and `Panel` is the component every screen is built from, so this was
   * blocking a ref on the base surface rather than on one caller.
   *
   * It works at runtime today for the same reason `style` did: `Panel` spreads `...props` onto the
   * div, and React 19 reads `ref` out of those props.
   */
  ref?: React.Ref<HTMLDivElement>;
}

const variantClass: Record<PanelVariant, string> = {
  default: 'panel',
  sunken: 'panel-sunken',
  hero: 'panel-hero',
};

export const Panel: React.FC<PanelProps> = ({
  variant = 'default',
  className = '',
  children,
  ...props
}) => (
  <div className={`${variantClass[variant]} ${className}`} {...props}>
    {children}
  </div>
);