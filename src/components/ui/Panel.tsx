import React from 'react';

export type PanelVariant = 'default' | 'sunken' | 'hero';

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant;
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