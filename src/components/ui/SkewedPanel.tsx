import React from 'react';
import { Panel, type PanelVariant } from './Panel';

export type SkewDirection = 'skew-r' | 'skew-l' | 'notch-tr' | 'notch-bl';

interface SkewedPanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  direction?: SkewDirection;
  panelVariant?: PanelVariant;
  children: React.ReactNode;
  className?: string;
}

/**
 * SkewedPanel — Panel with clipped corner geometry.
 *
 * CRITICAL: The shadow lives on a wrapper (via ::before), the clip on the inner element.
 * This prevents clip-path from clipping the box-shadow, which would leave a flat
 * angular shape that reads as broken rather than machined.
 *
 * Do not export raw .skew-* utilities for arbitrary use — the wrapper pattern
 * is enforced by construction here.
 */
export const SkewedPanel: React.FC<SkewedPanelProps> = ({
  direction = 'skew-r',
  panelVariant = 'default',
  children,
  className = '',
  ...props
}) => {
  const variantClass: Record<PanelVariant, string> = {
    default: 'panel',
    sunken: 'panel-sunken',
    hero: 'panel-hero',
  };

  const skewClass = `skew-shadow ${direction} ${variantClass[panelVariant]}`;

  return (
    <div className={skewClass} {...props}>
      <div className="p-4">{children}</div>
    </div>
  );
};