import React from 'react';

export interface SectionTitleProps {
  children: React.ReactNode;
  className?: string;
  secondary?: React.ReactNode;
}

/**
 * SectionTitle — In-page section heading with hazard underline.
 *
 * The hazard stripe (--texture-hazard) is an accent, not wallpaper.
 * Used for active navigation items, live bracket series, section headers.
 */
export const SectionTitle: React.FC<SectionTitleProps> = ({
  children,
  secondary,
  className = '',
}) => (
  <div className={`flex items-end justify-between gap-4 ${className}`}>
    <div className="relative">
      <span className="t-h2 relative z-10">{children}</span>
      <div
        className="absolute bottom-0 left-0 right-0 h-1.5"
        style={{
          background: 'var(--texture-hazard)',
          opacity: 0.6,
        }}
        aria-hidden="true"
      />
    </div>
    {secondary && <span className="t-caption text-[var(--color-ink-dim)] whitespace-nowrap">{secondary}</span>}
  </div>
);
