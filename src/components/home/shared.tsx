import React from 'react';
import type { Game, Team } from '../../types';
import { isPlayoffGame, isRegularSeasonGame } from '../../logic/playoffs';
import { fmtPct, fmtRecord } from '../../logic/statFormatting';

/**
 * Shared helpers and small compositions for the front page.
 *
 * The dashboard was a single 1,034-line file with eleven panels inline. It was
 * not possible to restyle one panel without rewriting the ten around it, and
 * the MVP scoring had already been duplicated onto the leaderboard, where the
 * two copies had begun to disagree on presentation. These live here so the
 * panels can be moved and restyled independently.
 */

export type MilestoneKey =
  | 'opening_day'
  | 'all_star_break'
  | 'trade_deadline'
  | 'regular_season_finale'
  | 'playoffs_begin'
  | 'draft'
  | 'free_agency';

export type Milestone = {
  key: MilestoneKey;
  label: string;
  date: string;
  phase: 'regular' | 'playoffs' | 'offseason';
};

export type DivisionSnapshot = {
  key: string;
  league: string;
  division: string;
  teams: Team[];
};

export const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

export const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const formatHeadlineDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export const formatMiniDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

/** Record as an en-dash pair, via the central formatter. */
export const recordOf = (team: Team): string => fmtRecord(team.wins, team.losses);

export const winPctOf = (team: Team): string => fmtPct(getWinPct(team));

export const getMilestones = (games: Game[]): Milestone[] => {
  const orderedDates = Array.from(new Set(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));
  const regularSeasonDates = Array.from(new Set(games.filter(isRegularSeasonGame).map((game) => game.date))).sort((left, right) => left.localeCompare(right));
  const playoffDates = Array.from(new Set(games.filter(isPlayoffGame).map((game) => game.date))).sort((left, right) => left.localeCompare(right));

  if (orderedDates.length === 0) {
    return [];
  }

  const openingDay = regularSeasonDates[0] ?? orderedDates[0];
  const allStarBreak = regularSeasonDates[Math.floor(regularSeasonDates.length * 0.5)] ?? openingDay;
  const tradeDeadline = regularSeasonDates[Math.floor(regularSeasonDates.length * 0.74)] ?? openingDay;
  const regularSeasonFinale = regularSeasonDates[regularSeasonDates.length - 1] ?? orderedDates[orderedDates.length - 1];
  const playoffsBegin = playoffDates[0] ?? addDays(regularSeasonFinale, 2);
  const finalScheduledDay = orderedDates[orderedDates.length - 1];

  return [
    { key: 'opening_day', label: 'Opening Day', date: openingDay, phase: 'regular' },
    { key: 'all_star_break', label: 'All-Star Break', date: allStarBreak, phase: 'regular' },
    { key: 'trade_deadline', label: 'Trade Deadline', date: tradeDeadline, phase: 'regular' },
    { key: 'regular_season_finale', label: 'Regular Season Finale', date: regularSeasonFinale, phase: 'regular' },
    { key: 'playoffs_begin', label: 'Playoffs Begin', date: playoffsBegin, phase: 'playoffs' },
    { key: 'draft', label: 'Draft', date: addDays(finalScheduledDay, 5), phase: 'offseason' },
    { key: 'free_agency', label: 'Free Agency Opens', date: addDays(finalScheduledDay, 10), phase: 'offseason' },
  ];
};

/**
 * The events a long simulation is allowed to stop at.
 *
 * The three a manager is actually waiting on, in the order they arrive. `opening_day` is excluded
 * because it is behind you, and the playoffs/offseason entries are excluded because the point of
 * the bound is that an unattended run does not walk past the regular season.
 */
export const SEASON_STOP_KEYS = [
  'all_star_break',
  'trade_deadline',
  'regular_season_finale',
] as const satisfies readonly MilestoneKey[];

/**
 * The next event a long run should stop at, strictly after `currentDate`.
 *
 * Lives here rather than inside the date plan or the button that shows it, because two consumers
 * need the same answer and a label that disagrees with the scope it names is worse than no label:
 * the date plan picks the destination, and the desk button says which one it picked. Written twice,
 * the button would eventually say "All-Star" while the run stopped at the trade deadline.
 *
 * Strictly after, so a milestone that has already been reached is not offered again.
 */
export const nextSeasonStop = (games: Game[], currentDate: string): Milestone | null => {
  if (!currentDate) return null;
  return (
    getMilestones(games)
      .filter((milestone) => milestone.phase === 'regular' && (SEASON_STOP_KEYS as readonly string[]).includes(milestone.key))
      .filter((milestone) => milestone.date > currentDate)
      .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null
  );
};

export const sortStandings = (left: Team, right: Team): number => {
  const leftPct = getWinPct(left);
  const rightPct = getWinPct(right);
  if (leftPct !== rightPct) {
    return rightPct - leftPct;
  }

  const leftDiff = left.runsScored - left.runsAllowed;
  const rightDiff = right.runsScored - right.runsAllowed;
  if (leftDiff !== rightDiff) {
    return rightDiff - leftDiff;
  }

  return left.city.localeCompare(right.city);
};

/** Panel frame. Every front-page section is one of these plus its content. */
/**
 * Panel with a single-line header.
 *
 * No eyebrow. It was an optional second line above the title that restated it in
 * a smaller, fainter face -- "Milestones" above "Season Cycle" -- and the
 * intermediate revision that folded it inline still read as clutter. The title
 * carries the meaning on its own.
 */
export const HomePanel: React.FC<{
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}> = ({ title, aside, children, bodyClassName = 'p-4', className = '' }) => (
  <section className={`panel overflow-hidden ${className}`}>
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4">
      <h2 className="t-h3 min-w-0 truncate">{title}</h2>
      {aside}
    </div>
    <div className={bodyClassName}>{children}</div>
  </section>
);

export const StatTile: React.FC<{ label: string; value: string | number; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className={`t-stat mt-1 truncate ${accent ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink)]'}`}>{value}</p>
  </div>
);
