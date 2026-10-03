import React from 'react';

export type PanelHeaderVariant = 'default' | 'skewed';

interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: PanelHeaderVariant;
  title: string;
  secondary?: React.ReactNode;
  /**
   * Rendered immediately BEFORE the title, on the same line. For a crest or wordmark.
   *
   * Added rather than done with a wrapper because every existing header is a plain title and a
   * caller wanting a logo should not have to reimplement the chrome bar to get one.
   */
  leading?: React.ReactNode;
  /**
   * Rendered immediately AFTER the title, on the same line and in caption weight.
   *
   * This is NOT `secondary`. `secondary` is the far-right slot on the opposite end of a
   * justify-between bar, which reads as an aside; a tagline that belongs to the title has to sit
   * next to it or it reads as a different piece of information.
   */
  tagline?: React.ReactNode;
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  variant = 'default',
  title,
  secondary,
  leading,
  tagline,
  className = '',
  ...props
}) => {
  const base = 'chrome-bar flex items-center justify-between px-4';
  const skewClass = variant === 'skewed' ? 'skew-r skew-shadow' : '';

  return (
    <div className={`${base} ${skewClass} ${className}`} {...props}>
      <span className="flex items-center gap-2">
        {leading}
        <span className="t-h3">{title}</span>
        {tagline ? (
          <span className="t-caption text-[var(--color-ink-dim)]">{tagline}</span>
        ) : null}
      </span>
      {secondary && <span className="t-caption text-[var(--color-ink-dim)]">{secondary}</span>}
    </div>
  );
};
