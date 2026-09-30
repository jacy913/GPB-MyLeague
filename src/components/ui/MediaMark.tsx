import React from 'react';
import { MEDIA_BY_ID, type MediaId } from '../../data/media';
import { MEDIA_MARKS } from '../media/mediaImages';

export interface MediaMarkProps {
  id: MediaId;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * MediaMark -- a forecaster identifier chip.
 *
 * The same job as LeagueBadge, for the same reason: league and media identity
 * both need a small identifier that can be dropped inline next to a number or a
 * line of copy, on the media page and later in the ticker when these outlets
 * start publishing takes.
 *
 * Carries the outlet's own mark and its name alongside the colour, so it stays
 * identifiable without relying on hue. The marks are photographic artwork with
 * their own warm and gold tones, so the chip tints the background and the edge
 * with the media hue and leaves the mark itself untinted rather than colour-
 * filtering it.
 */
export const MediaMark: React.FC<MediaMarkProps> = ({ id, size = 'md', className = '' }) => {
  const profile = MEDIA_BY_ID[id];
  const sizeClass = size === 'sm' ? 't-caption px-1.5 py-0.5' : 't-label px-2 py-1';
  const markSize = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <span
      className={`inline-flex items-center gap-2 border-l-[3px] ${sizeClass} ${className}`}
      style={{
        borderLeftColor: `var(--color-media-${profile.accent})`,
        background: `var(--color-media-${profile.accent}-dim)`,
        color: `var(--color-media-${profile.accent}-hi)`,
      }}
      title={profile.outlet}
    >
      <img src={MEDIA_MARKS[id]} alt="" className={`${markSize} shrink-0 object-contain`} aria-hidden="true" />
      {profile.outlet}
    </span>
  );
};
