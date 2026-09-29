import React from 'react';
import { addDaysToISODate } from '../../logic/simulation';
import { isPlayoffGame, isRegularSeasonGame } from '../../logic/playoffs';
import type { Game, SimulationTarget, Team } from '../../types';
import { Panel } from '../ui';

/**
 * Shared types, date helpers and compositions for the simulation centre.
 *
 * SimulationHub was 1,050 lines holding six panels, a six-by-seven month grid
 * and a set of date utilities, with a dozen ad-hoc status colour triples inline.
 */

export type OffseasonStage = 'idle' | 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';
export type TimelineStatus = 'complete' | 'active' | 'upcoming';
export type RunStatus = 'running' | 'interrupted' | 'complete' | 'error' | 'cancelled' | null;
export type CalendarMilestoneTone = 'regular' | 'playoffs' | 'awards' | 'offseason';

export interface TimelineStep {
  key: string;
  label: string;
  description: string;
  status: TimelineStatus;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}

export interface CalendarMilestone {
  key: string;
  date: string;
  label: string;
  shortLabel: string;
  tone: CalendarMilestoneTone;
}

export const getUniqueDates = (games: Game[]): string[] =>
  Array.from(new Set<string>(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));

export const buildCalendarMilestones = (
  games: Game[],
  awardsUnlockDate: string,
  lotteryOpenDate: string,
  draftOpenDate: string,
  freeAgencyOpenDate: string,
): CalendarMilestone[] => {
  const orderedDates = getUniqueDates(games);
  const regularSeasonDates = getUniqueDates(games.filter((game) => isRegularSeasonGame(game)));
  const playoffDates = getUniqueDates(games.filter((game) => isPlayoffGame(game)));

  if (orderedDates.length === 0) return [];

  const openingDay = regularSeasonDates[0] ?? orderedDates[0];
  const regularSeasonFinale = regularSeasonDates[regularSeasonDates.length - 1] ?? orderedDates[orderedDates.length - 1];
  const playoffsBegin = playoffDates[0] ?? addDaysToISODate(regularSeasonFinale, 2);
  const playoffsFinale = playoffDates[playoffDates.length - 1] ?? orderedDates[orderedDates.length - 1];
  const awardsDay = awardsUnlockDate || addDaysToISODate(playoffsFinale, 1);
  const lotteryDay = lotteryOpenDate || addDaysToISODate(playoffsFinale, 4);
  const draftDay = draftOpenDate || addDaysToISODate(playoffsFinale, 5);
  const freeAgencyDay = freeAgencyOpenDate || addDaysToISODate(playoffsFinale, 10);

  const milestones: CalendarMilestone[] = [
    { key: 'opening_day', date: openingDay, label: 'Opening Day', shortLabel: 'OPEN', tone: 'regular' },
    { key: 'reg_finale', date: regularSeasonFinale, label: 'Regular Season Finale', shortLabel: 'REG', tone: 'regular' },
    { key: 'playoffs_begin', date: playoffsBegin, label: 'Playoffs Begin', shortLabel: 'PO', tone: 'playoffs' },
    { key: 'playoffs_finale', date: playoffsFinale, label: 'Playoffs End', shortLabel: 'END', tone: 'playoffs' },
    { key: 'awards', date: awardsDay, label: 'Awards', shortLabel: 'AWD', tone: 'awards' },
    { key: 'lottery', date: lotteryDay, label: 'Lottery', shortLabel: 'LOT', tone: 'offseason' },
    { key: 'draft', date: draftDay, label: 'Draft', shortLabel: 'DRFT', tone: 'offseason' },
    { key: 'free_agency', date: freeAgencyDay, label: 'Free Agency Opens', shortLabel: 'FA', tone: 'offseason' },
  ];

  const uniqueByKey = new Map<string, CalendarMilestone>();
  milestones.forEach((milestone) => uniqueByKey.set(`${milestone.date}:${milestone.key}`, milestone));
  return Array.from(uniqueByKey.values());
};

export const formatLongDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export const formatShortDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const getMonthKey = (isoDate: string): string => isoDate.slice(0, 7);

export const shiftMonth = (monthKey: string, delta: number): string => {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};

const getWeekdayIndex = (isoDate: string): number => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

const getDaysInMonth = (monthKey: string): number => {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
};

export const buildCalendarCells = (monthKey: string): string[] => {
  const monthStart = `${monthKey}-01`;
  const leading = getWeekdayIndex(monthStart);
  const gridStart = addDaysToISODate(monthStart, -leading);
  return Array.from({ length: 42 }, (_, index) => addDaysToISODate(gridStart, index));
};

export const getTargetLabel = (target: SimulationTarget, selectedDate: string, teams: Team[]): string => {
  if (target.scope === 'to_date') return selectedDate ? `To ${formatShortDate(selectedDate)}` : 'Selected Date';
  if (target.scope === 'day') return 'Single Day';
  if (target.scope === 'week') return 'One Week';
  if (target.scope === 'month') return 'One Month';
  if (target.scope === 'regular_season') return 'Regular Season Finish';
  if (target.scope === 'season') return 'Full Season';
  const team = teams.find((entry) => entry.id === target.teamId) ?? null;
  return team ? `To ${team.city}'s Next Game` : 'Next Team Game';
};

/* ---- status vocabulary ----
 *
 * The previous version carried six ad-hoc colour triples (emerald, red, cyan,
 * amber, fuchsia, zinc) as raw Tailwind strings. Severity is now a semantic
 * token plus a left edge bar, and phase milestones keep a short text label so
 * colour is never the only thing distinguishing them.
 */

export const runStatusTone: Record<Exclude<RunStatus, null>, 'info' | 'warn' | 'pos' | 'neg' | 'muted'> = {
  running: 'info',
  interrupted: 'warn',
  complete: 'pos',
  error: 'neg',
  cancelled: 'muted',
};

export const runStatusLabel: Record<Exclude<RunStatus, null>, string> = {
  running: 'Running',
  interrupted: 'Halted',
  complete: 'Complete',
  error: 'Error',
  cancelled: 'Cancelled',
};

export const timelineTone: Record<TimelineStatus, 'pos' | 'gold' | 'muted'> = {
  complete: 'pos',
  active: 'gold',
  upcoming: 'muted',
};

export const toneEdge: Record<'info' | 'warn' | 'pos' | 'neg' | 'muted' | 'gold', string> = {
  info: 'var(--color-info)',
  warn: 'var(--color-warn)',
  pos: 'var(--color-pos)',
  neg: 'var(--color-neg)',
  muted: 'var(--color-chrome-lo)',
  gold: 'var(--color-gold)',
};

export const toneText: Record<'info' | 'warn' | 'pos' | 'neg' | 'muted' | 'gold', string> = {
  info: 'text-[var(--color-info)]',
  warn: 'text-[var(--color-warn)]',
  pos: 'text-[var(--color-pos)]',
  neg: 'text-[var(--color-neg)]',
  muted: 'text-[var(--color-ink-faint)]',
  gold: 'text-[var(--color-gold)]',
};

/* ---- shared compositions ---- */

export const SimPanel: React.FC<{
  title: string;
  eyebrow: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}> = ({ title, eyebrow, aside, children, bodyClassName = 'p-4' }) => (
  <Panel className="overflow-hidden">
    <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
      <div className="min-w-0">
        <p className="t-caption text-[var(--color-ink-faint)]">{eyebrow}</p>
        <h2 className="t-h3 truncate">{title}</h2>
      </div>
      {aside}
    </div>
    <div className={bodyClassName}>{children}</div>
  </Panel>
);

export const StatTile: React.FC<{ label: string; value: string | number; tone?: 'gold' | 'plain' }> = ({
  label, value, tone = 'plain',
}) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className={`t-stat-lg mt-1 truncate ${tone === 'gold' ? 'text-[var(--color-gold)]' : ''}`}>{value}</p>
  </div>
);

/**
 * Progress track.
 *
 * Keeps its continuous animation, which §5.5 exempts for simulation progress
 * because it communicates a real ongoing process rather than decoration. The
 * fully-rounded gradient track is not kept: it had no place in the period
 * language, and the exact percentage is always printed beside it.
 */
export const ProgressTrack: React.FC<{ percent: number; label: string; tone?: 'gold' | 'info' }> = ({
  percent, label, tone = 'gold',
}) => {
  const clamped = Math.max(0, Math.min(100, percent));
  const fill = tone === 'info' ? 'bg-[var(--color-info)]' : 'bg-[var(--color-gold)]';
  return (
    <div
      className="h-2 w-full border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full ${fill} transition-[width] duration-300 ease-[var(--ease-snap)]`}
        style={{ width: `${Math.max(1, clamped)}%` }}
      />
    </div>
  );
};
