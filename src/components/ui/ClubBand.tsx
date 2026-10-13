import React from 'react';
import type { Team } from '../../types';
import type { TeamId } from '../../data/teamColors';
import { clubInk, clubTint, type ClubSurface, type ClubTheme } from '../../lib/clubColour';
import { TeamLogo } from './TeamLogo';

/**
 * ============================================================================
 * THE CLUB BAND
 * ============================================================================
 *
 * One club's uniform, drawn across one row. This is the treatment that made the
 * Booth Metrics boards, and it is extracted here so the answer to "what does a
 * club's row look like" is written down ONCE. A second copy in the standings and
 * a third on the dashboard is how three screens end up disagreeing about the same
 * club.
 *
 * It has exactly three parts, and nothing else in it is part of the design:
 *
 *   1. THE FILL. The row is filled with `clubTint` -- the club's colour mixed
 *      into the surface, never the raw palette primary. That is the whole reason
 *      `clubColour.ts` exists: three of the 32 primaries are effectively invisible
 *      against this app's panel, so a naive "use the team's colour" would render a
 *      row you cannot see for those clubs. The tint lifts while holding hue, so
 *      all 32 get the same treatment and none of them is the club whose colour
 *      happens to be bright enough.
 *
 *   2. THE EDGE. A full-strength `clubInk` bar down the leading side. It is where
 *      the club's real colour gets to appear at full strength, and it is at the
 *      leading edge rather than under the text on purpose: a full-strength club
 *      colour under a figure is a legibility problem, and the edge cannot be
 *      underneath anything.
 *
 *   3. THE CROPPED CREST. The crest is drawn LARGER than the row and clipped to
 *      it, so it bleeds off the top and bottom the way a broadcast scorebug's mark
 *      does. It reads as sitting IN the row rather than as a thumbnail floating on
 *      top of it. The crop window is exactly the crest's width, so the mark is
 *      only ever clipped vertically -- a club's crest is never cut off at the sides.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THAT IS EASY TO GET WRONG
 * ---------------------------------------------------------------------------
 *
 * The row height and the crest size are INLINE STYLES, not Tailwind arbitrary
 * classes. An interpolated class name (`h-[${n}px]`) never reaches the Tailwind
 * scanner, so it compiles to nothing and the crop silently does not happen. Static
 * arbitrary classes (`w-[86px]`) are fine; computed ones are not. Every size a
 * caller passes in here becomes an inline style for exactly this reason.
 */

/** The club colour's share of the row fill. Chosen, and shared by every band row. */
export const CLUB_BAND_TINT = 0.22;

/** Width of the full-strength leading edge, in px. */
export const CLUB_BAND_EDGE_WIDTH = 5;

/** How much taller than the row the crest is drawn, before the row crops it. */
export const CLUB_BAND_CREST_OVERDRAW = 1.45;

export interface ClubBandPalette {
  /** The row fill: the club's tinted uniform, or the sunken surface for an unknown club. */
  fill: string;
  /** The full-strength leading edge: the club's ink, or a neutral rule for an unknown club. */
  edge: string;
}

export interface ClubBandOptions {
  surface?: ClubSurface;
  theme?: ClubTheme;
  tint?: number;
}

/**
 * The fill and edge for a club, resolved for a surface and theme.
 *
 * Split out from the row components because a table row cannot be a `<li>`: the
 * standings needs the same fill and edge on a `<tr>`, so the colours are a value a
 * caller applies rather than something only a component can produce. `null` never
 * throws -- an unknown or missing club gets the neutral surface and rule, because a
 * row that cannot find its club must still render.
 */
export const clubBandPalette = (
  teamId: TeamId | null | undefined,
  { surface = 'panel', theme = 'regular', tint = CLUB_BAND_TINT }: ClubBandOptions = {},
): ClubBandPalette => ({
  fill: teamId ? clubTint(teamId, tint, surface, theme) : 'var(--color-sunken)',
  edge: (teamId ? clubInk(teamId, surface, theme)?.hex : null) ?? 'var(--color-chrome-mid)',
});

export interface CroppedCrestProps {
  team: Team;
  /** The row height, in px. The crest is drawn larger than this and clipped to it. */
  height: number;
  /** Multiplier on `height`. Defaults to {@link CLUB_BAND_CREST_OVERDRAW}. */
  overdraw?: number;
  className?: string;
}

/**
 * A club crest drawn oversized inside a row-height window that clips it top and
 * bottom. The window is exactly the crest's own width, so there is no side crop.
 *
 * Marked `aria-hidden`: a crest is never the only thing naming a club, and a
 * screen reader announcing a decorative image between the rank and the name is
 * noise. The name belongs to the row, not to the mark.
 */
export const CroppedCrest: React.FC<CroppedCrestProps> = ({
  team,
  height,
  overdraw = CLUB_BAND_CREST_OVERDRAW,
  className = '',
}) => {
  const size = Math.round(height * overdraw);
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center overflow-hidden ${className}`}
      style={{ height, width: size }}
    >
      <div className="drop-shadow-[0_3px_8px_rgba(0,0,0,0.7)]" style={{ width: size, height: size }}>
        <TeamLogo team={team} sizeClass="h-full w-full" />
      </div>
    </div>
  );
};

export interface ClubBandRowProps {
  /** The club that colours the row. Omit/null for a neutral band. */
  team?: Team | null;
  /** The club id, used for the colour when `team` is absent (a saved-but-unknown id). */
  teamId: TeamId | null;
  /** Row height in px. Drives the crest crop. */
  height: number;
  /** The ordinal, drawn before the crest. Omit for an unranked list. */
  rank?: number | string;
  /** Extra classes for the ordinal -- e.g. gold for the leader of a board. */
  rankClassName?: string;
  /**
   * The club's name. Drawn `sr-only` and used as the row's tooltip, so a row that
   * drops the visible name keeps its accessible name.
   */
  name?: string;
  surface?: ClubSurface;
  theme?: ClubTheme;
  tint?: number;
  overdraw?: number;
  className?: string;
  /** Everything after the crest: the figures, and any trailing control. */
  children: React.ReactNode;
}

/**
 * A club band as a list row: `<li>` with the fill, the leading edge, an optional
 * ordinal, the cropped crest, and the caller's content. The escape hatch for a
 * table is {@link clubBandPalette} plus {@link CroppedCrest}, since a `<tr>` cannot
 * be an `<li>`.
 */
export const ClubBandRow: React.FC<ClubBandRowProps> = ({
  team,
  teamId,
  height,
  rank,
  rankClassName,
  name,
  surface = 'panel',
  theme = 'regular',
  tint = CLUB_BAND_TINT,
  overdraw = CLUB_BAND_CREST_OVERDRAW,
  className = '',
  children,
}) => {
  const { fill, edge } = clubBandPalette(teamId, { surface, theme, tint });

  return (
    <li
      title={name}
      className={`relative flex items-center gap-3 overflow-hidden pl-4 pr-4 ${className}`}
      style={{ background: fill, minHeight: height }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0"
        style={{ width: CLUB_BAND_EDGE_WIDTH, background: edge }}
      />

      {rank !== undefined ? (
        <span className={`w-4 shrink-0 text-right t-stat text-[var(--color-ink-faint)] ${rankClassName ?? ''}`}>{rank}</span>
      ) : null}

      {team ? (
        <CroppedCrest team={team} height={height} overdraw={overdraw} />
      ) : (
        <span className="shrink-0 t-caption text-[var(--color-ink-faint)]" aria-hidden="true">
          {teamId?.slice(0, 3) ?? '—'}
        </span>
      )}

      {name ? <span className="sr-only">{name}</span> : null}

      {children}
    </li>
  );
};
