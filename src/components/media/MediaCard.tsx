import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import type { MediaProfile } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import type { Team } from '../../types';
import { MEDIA_MARKS_SQUARE, MEDIA_WALLPAPERS } from './mediaImages';
import { TeamLogo } from '../ui';

/**
 * ============================================================================
 * THE OUTLET RAIL -- NINE ACROSS, ONE ROW, NO SCROLLING
 * ============================================================================
 *
 * This replaces a three-column grid that was built when there were three outlets and has been fed
 * nine ever since. It wrapped into three rows of three, each card carrying a 160px photograph, a
 * thesis paragraph and a conviction chip, so the nine outlets consumed roughly 450px of vertical
 * space before the manager reached anything they could act on. On a page whose whole purpose is
 * prices, that is a full screen of mastheads before the first number.
 *
 * WHY A RAIL AND NOT A HORIZONTAL SCROLLER, which was the first idea and is a real option:
 *
 *   At three outlets a scroller is barely a scroller. At nine, each tile wide enough to show a
 *   portrait is ~200px, so the row is ~1800px -- wider than most screens. Scrolling past Sharply to
 *   reach Wardley hides six outlets from a manager deciding whether to fade one of them, and a
 *   hidden control is not a reachable control. A rail shows all nine at once, which is the entire
 *   point of a rail.
 *
 * THE THESIS IS GONE FROM THE RAIL, and that is the main thing this buys.
 *
 * `profile.thesis` is two sentences of argument, and nine of them is a page. It was never what a
 * manager uses the rail for: they use the rail to answer "who, and who do I trust tonight". The
 * thesis, the weights, the stated weakness and the voice samples are all still one click away in
 * the details popup, which is the better home for an argument anyway -- it is the entire subject of
 * that dialog rather than a paragraph competing with eight others for a glance.
 *
 * ============================================================================
 * THE PICK CREST
 * ============================================================================
 *
 * The rail tile carries the club that outlet is currently backing on the next slate, under the
 * mark. This is new information on the rail, not a repeat of the lines table: the table shows a
 * PRICE per outlet per game, and this shows a single club per outlet -- the answer to "who is
 * Sharply picking tonight", which the table answers only by making you compare nine columns.
 *
 * Derived from the same `GameLine` the table uses, so the two cannot disagree: a crest here is
 * `probability > 0.5` for that outlet on that game, and the table prints the price from that same
 * number. An independent calculation would be a second source of truth for one question, which is
 * the class of bug this page has already collected once.
 *
 * Shown only when a slate exists and the outlet has a lean on any of its games. A rail of nine tiles
 * with eight crests and one blank would read as a missing image rather than as "no games yet".
 */
export const MediaRail: React.FC<{
  selectedId: MediaProfile['id'];
  onSelect: (id: MediaProfile['id']) => void;
  onOpenDetails: (id: MediaProfile['id']) => void;
  /**
   * The club each outlet is currently backing, by outlet id.
   *
   * An explicit map rather than a prop of `Team | undefined` per tile, so the rail has no opinion
   * about where the picks come from and the page computes them once.
   */
  picksByMediaId: Partial<Record<MediaProfile['id'], Team>>;
  /** False when there is no slate ahead, which suppresses the whole pick row. */
  hasSlate: boolean;
}> = ({ selectedId, onSelect, onOpenDetails, picksByMediaId, hasSlate }) => (
  <div
    role="radiogroup"
    aria-label="Media outlets"
    className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9"
  >
    {MEDIA_PROFILES.map((profile) => (
      <RailTile
        key={profile.id}
        profile={profile}
        selected={profile.id === selectedId}
        pick={picksByMediaId[profile.id] ?? null}
        showPick={hasSlate}
        onSelect={onSelect}
        onOpenDetails={onOpenDetails}
      />
    ))}
  </div>
);

const RailTile: React.FC<{
  profile: MediaProfile;
  selected: boolean;
  pick: Team | null;
  showPick: boolean;
  onSelect: (id: MediaProfile['id']) => void;
  onOpenDetails: (id: MediaProfile['id']) => void;
}> = ({ profile, selected, pick, showPick, onSelect, onOpenDetails }) => {
  /*
    The wallpaper, as a faint tile ground.

    Nine mastheads at 160px each was the problem, so the picture moves to being a wash behind the mark
    rather than the card's subject. It still identifies the outlet at a glance -- which is what the
    photography was for -- but it now costs nothing in height and does not compete with the numbers
    below it.
  */
  const wallpaper = MEDIA_WALLPAPERS[profile.id];

  return (
    /*
      A DIV carrying the radio role, not a button.

      The previous version was a `<button>` with a second `<button>` -- the details control --
      nested inside it, which is invalid HTML. Chrome was already logging "In HTML, <button> cannot
      be a descendant of <button>" on this page before any of this work, and an earlier attempt to
      fix it here left the nesting in place while the comment claimed otherwise, which is worse than
      not having tried: the comment would have stopped the next reader looking.

      A nested control is also unreachable in the way that matters. Tab lands on the outer tile, the
      inner one is skipped, and a screen reader announces one control whose name is the tile's, so
      "details for Sharply" is announced as "Quincy Hollis, The Booth".

      So the tile is a container, the selection is a button filling it, and the details chevron is a
      sibling above it. Three separate problems, one shape: two siblings and no nesting.
    */
    <div
      role="radio"
      aria-checked={selected}
      aria-label={`${profile.outlet}, ${Math.round(profile.confidence * 100)}% conviction`}
      className={`relative flex flex-col items-center gap-1.5 overflow-hidden border p-2 text-center transition-colors ${
        selected
          ? 'border-[var(--color-chrome-hi)] bg-[var(--color-panel-2)]'
          : 'border-[var(--color-chrome-lo)] bg-[var(--color-panel)] hover:border-[var(--color-chrome-hi)]'
      }`}
      /*
        THE SELECTION STRIPE, as an inset shadow rather than an inline `borderLeft`.

        The obvious way to mark the selected tile is `style={{ borderLeft: selected ? ... : undefined }}`,
        and it is wrong for a reason React is explicit about: the tile's className sets `border`, a
        shorthand for all four sides, so the style prop is mixing a shorthand with a longhand -- and
        dropping the longhand entirely when the tile deselects changes which properties React is
        managing. That produced eight console warnings across nine tiles on every selection change,
        and the failure it guards against is silent: the surviving property from one render leaking
        into the next is exactly how a stripe ends up on the wrong tile.

        An inset shadow has no shorthand to conflict with and is always present -- transparent rather
        than absent when unselected -- so the managed property list is identical in both states.
      */
      style={{
        boxShadow: selected
          ? `inset 3px 0 0 var(--color-media-${profile.accent})`
          : 'inset 3px 0 0 transparent',
      }}
    >
      {wallpaper && (
        <img
          src={wallpaper.src}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15"
          loading="lazy"
        />
      )}

      {/* The selection target: the whole tile, behind everything else. */}
      <button
        type="button"
        onClick={() => onSelect(profile.id)}
        aria-label={`Select ${profile.name}`}
        className="absolute inset-0 z-0 h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-gold)]"
      />

      <img
        src={MEDIA_MARKS_SQUARE[profile.id]}
        alt=""
        aria-hidden="true"
        className="pointer-events-none relative h-7 w-7 object-contain"
      />

      {showPick && pick && (
        <div className="pointer-events-none relative" title={`${profile.outlet} · backing ${pick.city} ${pick.name}`}>
          {/*
            TeamLogo rather than a raw <img src={team.crest}>: a Team has no crest field. The logo
            primitive resolves the asset AND carries a labelled fallback for a club with no image, and
            the text alternative is generated from the team rather than hand-written per outlet, so a
            rename cannot leave a stale "is backing" string behind.
          */}
          <TeamLogo team={pick} sizeClass="h-6 w-6" />
          <span className="sr-only">Backing {pick.city} {pick.name}</span>
        </div>
      )}

      <div className="pointer-events-none relative min-w-0">
        <p
          className="truncate t-caption"
          style={{ color: `var(--color-media-${profile.accent}-hi)` }}
        >
          {profile.name}
        </p>
        <p className="truncate text-[10px] leading-tight text-[var(--color-ink-faint)]">
          {profile.outlet}
        </p>
      </div>

      {/*
        CONVICTION, as a bar rather than a chip.

        It was "68% conviction" in a bordered pill, which is a lot of horizontal furniture for one
        number in a tile 100px wide. A 3px bar under the name carries the same figure visually and
        compares across all nine at a glance, which is the only reason to show it on a rail: you are
        picking who to lean on, and that is a comparison.
      */}
      <div
        className="pointer-events-none relative h-[3px] w-full"
        style={{ background: `var(--color-media-${profile.accent}-dim)` }}
        aria-hidden="true"
      >
        <div
          className="h-full"
          style={{
            width: `${Math.round(profile.confidence * 100)}%`,
            background: `var(--color-media-${profile.accent})`,
          }}
        />
      </div>

      {/*
        DETAILS, a sibling of the selection button rather than a child of it.

        Sits above it in the stacking order so the top-right corner is the chevron and the rest of the
        tile is the selection, which is the expected split -- a small affordance in one corner, a
        large target everywhere else.
      */}
      <button
        type="button"
        onClick={() => onOpenDetails(profile.id)}
        aria-label={`Details for ${profile.outlet}`}
        className="absolute right-0.5 top-0.5 z-10 inline-flex items-center rounded-sm p-0.5 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-panel-3)] hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
      >
        <ChevronRight className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
};

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