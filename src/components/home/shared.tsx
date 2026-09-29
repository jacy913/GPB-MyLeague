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
export const HomePanel: React.FC<{
  title: string;
  eyebrow?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  className?: string;
}> = ({ title, eyebrow, aside, children, bodyClassName = 'p-4', className = '' }) => (
  <section className={`panel overflow-hidden ${className}`}>
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
      <div className="min-w-0">
        {eyebrow && <p className="t-caption text-[var(--color-ink-faint)]">{eyebrow}</p>}
        <h2 className="t-h3 truncate">{title}</h2>
      </div>
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
