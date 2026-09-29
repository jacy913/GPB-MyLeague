import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Game } from '../../types';
import { RetroButton } from '../ui';
import {
  ProgressTrack, SimPanel, StatTile,
  getMonthKey,
  type CalendarMilestone,
} from './shared';

/**
 * Season calendar.
 *
 * A six-by-seven month grid where each day carries its own state: completed,
 * on the slate, queued in the current run, the run cursor, the selected date,
 * the league's current date, and any milestone landing on it. That is a lot of
 * simultaneous signals in one 108px cell, so the states are separated by edge
 * treatment and label rather than by stacking tinted backgrounds.
 */
export const SeasonCalendar: React.FC<{
  monthLabel: string;
  focusedMonth: string;
  calendarCells: string[];
  gameCountsByDate: Map<string, { scheduled: number; completed: number; playoff: number }>;
  milestonesByDate: Map<string, CalendarMilestone[]>;
  activeDate: string;
  cursorDate: string;
  currentDate: string;
  isSimulating: boolean;
  isTarget: (date: string) => boolean;
  isQueued: (date: string) => boolean;
  isRunCompleted: (date: string) => boolean;
  seasonProgress: { completedGames: number; totalGames: number; progress: number };
  onShiftMonth: (delta: number) => void;
  onSelectDate: (date: string) => void;
}> = ({
  monthLabel, focusedMonth, calendarCells, gameCountsByDate, milestonesByDate,
  activeDate, cursorDate, currentDate, isSimulating, isTarget, isQueued, isRunCompleted,
  seasonProgress, onShiftMonth, onSelectDate,
}) => (
  <SimPanel
    title="Season Calendar"
    eyebrow="Schedule"
    aside={
      <div className="flex items-center gap-1">
        <RetroButton variant="ghost" size="sm" onClick={() => onShiftMonth(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </RetroButton>
        <span className="t-label min-w-[9ch] text-center">{monthLabel}</span>
        <RetroButton variant="ghost" size="sm" onClick={() => onShiftMonth(1)} aria-label="Next month">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </RetroButton>
      </div>
    }
  >
    <div className="mb-2 flex flex-wrap items-center gap-3">
      <StatTile label="Games" value={`${seasonProgress.completedGames}/${seasonProgress.totalGames}`} />
      <div className="min-w-[160px] flex-1">
        <ProgressTrack percent={seasonProgress.progress} label="Season progress" />
      </div>
      <span className="t-caption text-[var(--color-ink-faint)]">{Math.round(seasonProgress.progress)}%</span>
    </div>

    <div className="grid grid-cols-7 gap-1">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
        <div key={label} className="t-caption pb-1 text-center text-[var(--color-ink-faint)]">{label}</div>
      ))}

      {calendarCells.map((date) => {
        const counts = gameCountsByDate.get(date) ?? { scheduled: 0, completed: 0, playoff: 0 };
        const milestone = milestonesByDate.get(date)?.[0] ?? null;
        const inMonth = getMonthKey(date) === focusedMonth;
        const isActive = date === activeDate;
        const isCursor = date === cursorDate;
        const isCurrent = !isSimulating && date === currentDate;
        const runDone = isRunCompleted(date);
        const queued = isQueued(date) && !runDone;
        const target = isTarget(date);

        const completed = counts.completed > 0 || runDone;
        const pending = counts.scheduled > counts.completed || queued;

        const label = runDone
          ? 'Sim complete'
          : counts.completed > 0
            ? `${counts.completed} final`
            : pending ? 'On slate' : 'Open day';

        // Edge priority: cursor beats target beats active, so the day the run is
        // standing on is never confused with the day it is heading toward.
        const edge = isCursor
          ? 'border-l-[var(--color-info)]'
          : target
            ? 'border-l-[var(--color-gold)]'
            : isActive
              ? 'border-l-[3px] border-l-[var(--color-gold)]'
              : isCurrent
                ? 'border-l-[var(--color-pos)]'
                : 'border-l-transparent';

        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDate(date)}
            aria-current={isActive ? 'date' : undefined}
            className={`relative flex min-h-[92px] flex-col items-start gap-1 border border-[var(--color-chrome-lo)] border-l-[3px] ${edge} px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-panel-2)] ${
              inMonth ? 'bg-[var(--color-sunken)]' : 'opacity-40'
            }`}
          >
            <span className={`t-stat-sm ${isActive ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-dim)]'}`}>
              {Number(date.slice(8, 10))}
            </span>
            <span className="t-caption text-[var(--color-ink-faint)]">{label}</span>
            {milestone && (
              <span className="mt-auto inline-block border border-[var(--color-gold)] bg-[var(--color-base-2)] px-1 t-caption text-[var(--color-gold)]">
                {milestone.shortLabel}
              </span>
            )}
            {counts.playoff > 0 && !milestone && (
              <span className="mt-auto inline-block border border-[var(--color-gold)] bg-[var(--color-base-2)] px-1 t-caption text-[var(--color-gold)]">
                PO
              </span>
            )}
          </button>
        );
      })}
    </div>

    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {[
        ['var(--color-info)', 'Run cursor'],
        ['var(--color-gold)', 'Selected / target'],
        ['var(--color-pos)', 'Current date'],
        ['var(--color-chrome-lo)', 'On slate or complete'],
      ].map(([colour, text]) => (
        <li key={text} className="flex items-center gap-1.5 t-caption text-[var(--color-ink-faint)]">
          <span className="h-2 w-2" style={{ background: colour }} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  </SimPanel>
);
