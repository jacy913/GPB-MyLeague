import React from 'react';

export type PanelHeaderVariant = 'default' | 'skewed';

interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: PanelHeaderVariant;
  title: string;
  secondary?: React.ReactNode;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  variant = 'default',
  title,
  secondary,
  className = '',
  ...props
}) => {
  const base = 'chrome-bar flex items-center justify-between px-4';
  const skewClass = variant === 'skewed' ? 'skew-r skew-shadow' : '';

  return (
    <div className={`${base} ${skewClass} ${className}`} {...props}>
      <span className="t-h3">{title}</span>
      {secondary && <span className="t-caption text-[var(--color-ink-dim)]">{secondary}</span>}
    </div>
  );
};
