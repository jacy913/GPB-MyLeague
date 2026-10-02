import React from 'react';
import { AlertTriangle, ChevronRight, Gauge } from 'lucide-react';
import type { MediaProfile } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import { MEDIA_IMAGES, MEDIA_MARKS, MEDIA_WALLPAPERS } from './mediaImages';

/**
 * Media identity card.
 *
 * The photograph is a masthead rather than a page background. The page's real
 * content is a thirty-two-row ranking, and photography behind tabular data
 * destroys legibility -- and a full-bleed photo would be a new visual language
 * in a product that has none. This is the poster idiom instead: one bounded
 * image per forecaster, a scrim to carry the name, then the data on solid
 * panels below. It is the same move as the trophy on the history champion card.
 */
export const MediaCard: React.FC<{
  profile: MediaProfile;
  selected: boolean;
  /** Selecting the outlet, which also collapses or opens their details box. */
  onSelect: (id: MediaProfile['id']) => void;
  /** Open the details popup for this outlet. */
  onOpenDetails: (id: MediaProfile['id']) => void;
}> = ({ profile, selected, onSelect, onOpenDetails }) => {
  const image = MEDIA_IMAGES[profile.id];
  /*
    THE WALLPAPER TAKKES THE CARD'S IMAGE SLOT WHERE ONE EXISTS.

    Six outlets have a supplied wallpaper and three do not, so this is a fallback rather than a
    replacement. It matters because a WALLPAPER is a different kind of picture from a masthead: it
    is the room the outlet works out of, where a masthead is the room's sign. The card wants the
    first of those, and three outlets are currently showing their portrait in that slot because
    they have nothing else -- which is a substitution the alt text has to apologise for and this
    removes for five of the nine.

    The three with no wallpaper (Sharply, Hollis and Sallow) keep whatever they had, unchanged. A
    placeholder would be worse than the gap: it looks like art rather than like a missing file, so
    the absence stays visible.

    The PORTRAIT is deliberately not rendered here. It belongs in the details popup, where there is
    room to frame a person, and a 160px card slot is where a portrait gets letterboxed into
    something nobody would recognise.
  */
  const wallpaper = MEDIA_WALLPAPERS[profile.id];
  const cardImage = wallpaper ?? image;
  return (
  <button
    type="button"
    onClick={() => onSelect(profile.id)}
    aria-pressed={selected}
    className={`flex w-full flex-col border text-left transition-colors ${
      selected
        ? 'border-[var(--color-chrome-hi)] bg-[var(--color-panel-2)]'
        : 'border-[var(--color-chrome-lo)] bg-[var(--color-panel)] hover:border-[var(--color-chrome-hi)]'
    }`}
    style={selected ? { borderLeft: `3px solid var(--color-media-${profile.accent})` } : undefined}
  >
    <div className="relative h-40 w-full overflow-hidden">
      <img
        src={cardImage.src}
        alt={cardImage.alt}
        className="h-full w-full object-cover"
        loading="lazy"
      />
      {/* Scrim. Needed because the photography is high-key in places -- the
          press box is bright daylight -- so white text would not hold without
          it regardless of which crop is used. */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, var(--color-void) 6%, rgba(5,7,13,0.55) 55%, rgba(5,7,13,0.2) 100%)' }}
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <div className="min-w-0">
          <p
            className="truncate t-h2"
            style={{ color: `var(--color-media-${profile.accent}-hi)` }}
          >
            {profile.name}
          </p>
          <p className="truncate t-caption text-[var(--color-ink-dim)]">{profile.outlet}</p>
        </div>
        <img
          src={MEDIA_MARKS[profile.id]}
          alt=""
          aria-hidden="true"
          className="h-12 w-12 shrink-0 object-contain"
        />
      </div>
    </div>

    <div className="flex flex-1 flex-col gap-2 p-3">
      <p className="t-caption text-[var(--color-ink-faint)]">{profile.role}</p>
      <p className="t-caption text-[var(--color-ink-dim)]">{profile.thesis}</p>

      <div className="mt-auto flex items-center gap-2 pt-2">
        <span
          className="inline-flex items-center gap-1.5 border px-1.5 py-0.5 t-caption"
          style={{
            borderColor: `var(--color-media-${profile.accent}-dim)`,
            background: `var(--color-media-${profile.accent}-dim)`,
            color: `var(--color-media-${profile.accent}-hi)`,
          }}
        >
          <Gauge className="h-3 w-3" aria-hidden="true" />
          {Math.round(profile.confidence * 100)}% conviction
        </span>

        {/*
         * Details, beside the conviction chip because the two answer the same
         * question from opposite ends: conviction says how sure this outlet is,
         * details says what they are sure about. They sit together because a
         * manager weighing whether to act on an outlet wants both before acting,
         * not one now and the other after a page change.
         *
         * A separate control rather than making the whole card open the popup,
         * because the card already selects. Two behaviours on one target means
         * the second is only discoverable by trying it, and the popup is the more
         * expensive of the two -- it builds five props and a slate's worth of
         * lines. Keeping it behind a labelled control means it is also the
         * thing a screen reader announces, rather than an unlabelled region of
         * clickable pixels.
         */}
        <button
          type="button"
          onClick={() => onOpenDetails(profile.id)}
          className="ml-auto inline-flex items-center gap-1 border border-[var(--color-chrome-lo)] bg-[var(--color-panel-2)] px-1.5 py-0.5 t-caption text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-chrome-hi)] hover:text-[var(--color-gold-hi)]"
          aria-label={`Details and published lines for ${profile.outlet}`}
        >
          details
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  </button>
  );
};

/** The three identity cards. */
export const MediaCards: React.FC<{
  selectedId: MediaProfile['id'];
  onSelect: (id: MediaProfile['id']) => void;
  onOpenDetails: (id: MediaProfile['id']) => void;
}> = ({ selectedId, onSelect, onOpenDetails }) => (
  <div className="grid gap-4 lg:grid-cols-3">
    {MEDIA_PROFILES.map((profile) => (
      <MediaCard
        key={profile.id}
        profile={profile}
        selected={profile.id === selectedId}
        onSelect={onSelect}
        onOpenDetails={onOpenDetails}
      />
    ))}
  </div>
);

/**
 * How a forecaster works, and where it is known to be wrong.
 *
 * Both halves are shown because a forecaster you cannot audit is not usable.
 * The weights are the actual inputs the read is built from, not a description
 * of them, and the stated weakness is the thing a bettor needs in order to
 * decide when to fade this outlet.
 */
export const MediaMethodPanel: React.FC<{ profile: MediaProfile }> = ({ profile }) => (
  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div>
      <p className="t-label" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
        {profile.methodLabel}
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {profile.weights.map((entry) => (
          <li key={entry.label} className="flex items-center gap-3">
            <span className="w-[14ch] shrink-0 t-caption text-[var(--color-ink-dim)]">{entry.label}</span>
            <span className="h-2.5 min-w-0 flex-1 bg-[var(--color-sunken)]">
              <span
                className="block h-full"
                style={{
                  width: `${Math.round(entry.weight * 100)}%`,
                  background: `var(--color-media-${profile.accent})`,
                }}
              />
            </span>
            <span className="t-stat-sm w-[5ch] shrink-0 text-right tabular-nums">
              {Math.round(entry.weight * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>

    <div className="border-l-[3px] bg-[var(--color-sunken)] p-4"
      style={{ borderLeftColor: 'var(--color-warn)' }}
    >
      <p className="t-label flex items-center gap-2 text-[var(--color-warn)]">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        Known weakness
      </p>
      <p className="t-body mt-2 text-[var(--color-ink-dim)]">{profile.weakness}</p>
    </div>
  </div>
);

/** Sample lines in the outlet's own register. */
export const MediaVoicePanel: React.FC<{ profile: MediaProfile }> = ({ profile }) => (
  <div className="flex flex-col gap-2">
    {profile.voice.map((line) => (
      <blockquote
        key={line}
        className="border-l-[3px] bg-[var(--color-sunken)] px-3 py-2"
        style={{ borderLeftColor: `var(--color-media-${profile.accent})` }}
      >
        <p className="t-body text-[var(--color-ink-dim)]">{line}</p>
      </blockquote>
    ))}
  </div>
);
