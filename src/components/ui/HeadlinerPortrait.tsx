import React, { useMemo, useState } from 'react';
import { HEADLINER_BY_ID, type HeadlinerId } from '../../logic/headliners';

/**
 * The masked headliner portrait.
 *
 * A design-system primitive rather than a feature component: the persona section and
 * anything else that wants a byline face should use this, so the mask, the plate and
 * the fallback cannot drift apart between screens.
 *
 * WHY A MASK AND A PLATE. The sources are square portraits, so a circle is what makes
 * them read as people rather than as images. The 1px `--color-chrome-lo` plate is not
 * decoration: these are dark portraits and without it they lose their edge against
 * `--color-panel`. `rounded-full` is permitted in exactly two places elsewhere in the
 * design system -- `Meter` cells and avatar masks -- and this is the avatar case; the
 * rule's documentation should say so.
 *
 * ASSET RESOLUTION follows `TeamLogo`: `import.meta.glob` is what makes the bundled
 * files addressable at all, since there is no `public/` directory. The glob is `.webp`
 * because the portraits ship as 96x96 WebP -- the originals were 1024-2048px PNGs
 * totalling 16.3 MB for five 40px avatars.
 */

export interface HeadlinerPortraitProps {
  id: HeadlinerId;
  /** `sm` 28px, `md` 32px, `lg` 40px, `xl` 72px. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

/**
 * 28 / 32 / 40 / 72 px against a 95x95 source, so 3.4x down to 1.3x headroom.
 *
 * `xl` exists because the byline portrait on the front page was asked to match the
 * size of the crests in the headline of the day above it, and 40px is not that. It
 * stops at 72 rather than 96 for a measured reason: the shipped art is 95x95, so a
 * 96px render is 1:1 and goes soft on any 2x display, while 72px keeps 1.3x of real
 * headroom. Going past this needs the portraits re-exported at 192px or larger --
 * the originals were 1024-2048px, so the source art supports it and only the shipped
 * WebP does not.
 *
 * Named rather than accepting a raw Tailwind string, for the same reason `Meter` and
 * `StatValue` name their variants: an opaque class string here would make the plate
 * inset and the fallback glyph impossible to keep consistent.
 */
const SIZE_PX: Record<NonNullable<HeadlinerPortraitProps['size']>, number> = {
  sm: 28,
  md: 32,
  lg: 40,
  xl: 72,
};

const PORTRAIT_MODULES = import.meta.glob('../../assets/headliners/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const PORTRAIT_URL_BY_KEY: ReadonlyMap<string, string> = new Map(
  Object.entries(PORTRAIT_MODULES).map(([path, url]) => [
    (path.split('/').pop() ?? '').replace(/\.webp$/i, ''),
    url,
  ]),
);

export const HeadlinerPortrait: React.FC<HeadlinerPortraitProps> = ({
  id,
  size = 'md',
  className = '',
}) => {
  const profile = HEADLINER_BY_ID[id];
  const url = useMemo(() => PORTRAIT_URL_BY_KEY.get(profile.portraitKey), [profile.portraitKey]);
  const [failed, setFailed] = useState(false);
  const px = SIZE_PX[size];

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{
        width: px,
        height: px,
        // The plate is a background rather than a border so it sits UNDER the image
        // and cannot eat into the circle at these sizes.
        background: 'linear-gradient(180deg, var(--color-panel-2), var(--color-base-2))',
        boxShadow: 'inset 0 0 0 1px var(--color-chrome-lo)',
        borderRadius: '999px',
      }}
    >
      {url && !failed ? (
        <img
          src={url}
          // The persona's name, not a filename. These are meaningful images: they are
          // the byline the reader is being asked to attribute an opinion to.
          alt={profile.displayName}
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        // Fallback: the byline's initials on the plate. Below the 12px stat floor at
        // every size here, and it is a byline badge rather than a figure anyone
        // compares, so it stays faint.
        <span
          aria-hidden="true"
          className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]"
          style={{ fontSize: Math.max(9, Math.round(px * 0.36)) }}
        >
          {profile.shortName.slice(0, 2)}
        </span>
      )}
    </span>
  );
};