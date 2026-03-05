import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  TimerReset,
} from 'lucide-react';
import { addDaysToISODate } from '../logic/simulation';
import { isPlayoffGame, isRegularSeasonGame } from '../logic/playoffs';
import { Game, SimulationTarget, Team } from '../types';

export interface SimulationRunState {
  status: 'running' | 'interrupted' | 'complete' | 'error' | 'cancelled';
  label: string;
  targetLabel: string;
  queuedDates: string[];
  currentIndex: number;
  startDate: string;
  currentDate: string;
  targetDate: string;
  simulatedGameCount: number;
  message?: string;
  interruptionKind?: 'trade' | 'free_agency';
  interruptionCount?: number;
}

interface SimulationHubProps {
  teams: Team[];
  games: Game[];
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  isSimulating: boolean;
  seasonComplete: boolean;
  simulationProgress: { completedGames: number; totalGames: number; currentDate: string; label: string } | null;
  simulationRunState: SimulationRunState | null;
  seasonResetStatus: { isResetting: boolean; progress: number; label: string };
  simulationSaveStatus: { isSaving: boolean; progress: number; label: string };
  onSelectDate: (date: string) => void;
  onSelectTeamId: (teamId: string) => void;
  onStartSimulation: (target: SimulationTarget) => void;
  onCancelSimulation: () => void;
  onResetSeason: () => void;
  onOpenTrades: () => void;
  onOpenFreeAgency: () => void;
}

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#121212,#202020,#0e0e0e)]';

const getUniqueDates = (games: Game[]): string[] =>
  Array.from(new Set<string>(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));

const formatLongDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const formatShortDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

const getMonthKey = (isoDate: string): string => isoDate.slice(0, 7);

const getMonthStart = (monthKey: string): string => `${monthKey}-01`;

const shiftMonth = (monthKey: string, delta: number): string => {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};

const getWeekdayIndex = (isoDate: string): number => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

const getDaysInMonth = (monthKey: string): number => {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
};

const buildCalendarCells = (monthKey: string): string[] => {
  const monthStart = getMonthStart(monthKey);
  const daysInMonth = getDaysInMonth(monthKey);
  const leading = getWeekdayIndex(monthStart);
  const gridStart = addDaysToISODate(monthStart, -leading);
  return Array.from({ length: 42 }, (_, index) => addDaysToISODate(gridStart, index));
};

const getTargetLabel = (target: SimulationTarget, selectedDate: string, teams: Team[]): string => {
  if (target.scope === 'to_date') {
    return selectedDate ? `To ${formatShortDate(selectedDate)}` : 'Selected Date';
  }
  if (target.scope === 'day') return 'Single Day';
  if (target.scope === 'week') return 'One Week';
  if (target.scope === 'month') return 'One Month';
  if (target.scope === 'regular_season') return 'Regular Season Finish';
  if (target.scope === 'season') return 'Full Season';
  const team = teams.find((entry) => entry.id === target.teamId) ?? null;
  return team ? `To ${team.city}'s Next Game` : 'Next Team Game';
};

export const SimulationHub: React.FC<SimulationHubProps> = ({
  teams,
  games,
  currentDate,
  selectedDate,
  selectedTeamId,
  isSimulating,
  seasonComplete,
  simulationProgress,
  simulationRunState,
  seasonResetStatus,
  simulationSaveStatus,
  onSelectDate,
  onSelectTeamId,
  onStartSimulation,
  onCancelSimulation,
  onResetSeason,
  onOpenTrades,
  onOpenFreeAgency,
}) => {
  const uniqueDates = useMemo(() => getUniqueDates(games), [games]);
  const activeDate = selectedDate || currentDate || uniqueDates[0] || '';
  const cursorDate = simulationRunState?.currentDate || currentDate || activeDate;
  const regularSeasonComplete = useMemo(
    () => games.filter((game) => isRegularSeasonGame(game)).every((game) => game.status === 'completed'),
    [games],
  );
  const seasonProgress = useMemo(() => {
    const completedGames = games.filter((game) => game.status === 'completed').length;
    return {
      completedGames,
      totalGames: games.length,
      progress: games.length > 0 ? (completedGames / games.length) * 100 : 0,
    };
  }, [games]);

  const planProgress = simulationRunState && simulationRunState.queuedDates.length > 0
    ? (simulationRunState.currentIndex / simulationRunState.queuedDates.length) * 100
    : 0;
  const controlsLocked = isSimulating || seasonResetStatus.isResetting || simulationSaveStatus.isSaving;

  const [focusedMonth, setFocusedMonth] = useState(getMonthKey(cursorDate || activeDate || uniqueDates[0] || new Date().toISOString().slice(0, 7)));

  useEffect(() => {
    const sourceDate = simulationRunState?.currentDate || cursorDate || activeDate || uniqueDates[0] || simulationRunState?.targetDate || '';
    if (sourceDate) {
      setFocusedMonth(getMonthKey(sourceDate));
    }
  }, [activeDate, cursorDate, simulationRunState, uniqueDates]);

  const calendarCells = useMemo(() => buildCalendarCells(focusedMonth), [focusedMonth]);
  const monthLabel = useMemo(
    () => new Date(`${focusedMonth}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [focusedMonth],
  );
  const queuedDates = simulationRunState?.queuedDates ?? [];
  const queuedDateSet = useMemo(() => new Set(queuedDates), [queuedDates]);
  const completedQueuedDates = useMemo(
    () => new Set(queuedDates.slice(0, simulationRunState?.currentIndex ?? 0)),
    [queuedDates, simulationRunState?.currentIndex],
  );

  const gameCountsByDate = useMemo(() => {
    const next = new Map<string, { scheduled: number; completed: number; playoff: number }>();
    games.forEach((game) => {
      const current = next.get(game.date) ?? { scheduled: 0, completed: 0, playoff: 0 };
      current.scheduled += 1;
      if (game.status === 'completed') current.completed += 1;
      if (isPlayoffGame(game)) current.playoff += 1;
      next.set(game.date, current);
    });
    return next;
  }, [games]);

  const runStatusTone = simulationRunState?.status === 'interrupted'
    ? 'border-[#d4bb6a]/40 bg-[#d4bb6a]/10 text-[#f3dfa2]'
    : simulationRunState?.status === 'error'
      ? 'border-red-400/30 bg-red-500/10 text-red-200'
      : simulationRunState?.status === 'complete'
        ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
        : simulationRunState?.status === 'cancelled'
          ? 'border-zinc-400/20 bg-zinc-500/10 text-zinc-200'
          : 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';

  return (
    <section className="space-y-6">
      <article className={`${sectionClass} overflow-hidden p-6`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Simulation Suite</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Simulation Center</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Drive the league from one command board. Pick the target, watch the calendar advance day by day, and stop the sim when the market forces you back into the office.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">League Progress</p>
              <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">{Math.round(seasonProgress.progress)}%</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Current Day</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">{cursorDate ? formatShortDate(cursorDate) : 'TBD'}</p>
            </div>
            <div className={`rounded-[1.5rem] border px-5 py-4 ${simulationRunState ? runStatusTone : 'border-white/10 bg-black/20 text-zinc-200'}`}>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">Run Status</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em]">
                {simulationRunState ? simulationRunState.status : 'Idle'}
              </p>
            </div>
          </div>
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_420px]">
        <section className={`${sectionClass} p-6`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Season Calendar</p>
              <p className="mt-1 font-headline text-4xl uppercase tracking-[0.06em] text-white">{monthLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFocusedMonth((current) => shiftMonth(current, -1))}
                className="rounded-full border border-white/10 bg-black/20 p-2 text-zinc-300 hover:border-white/20 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setFocusedMonth((current) => shiftMonth(current, 1))}
                className="rounded-full border border-white/10 bg-black/20 p-2 text-zinc-300 hover:border-white/20 hover:text-white"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-7 gap-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
              <div key={label} className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {label}
              </div>
            ))}

            {calendarCells.map((date) => {
              const counts = gameCountsByDate.get(date) ?? { scheduled: 0, completed: 0, playoff: 0 };
              const inMonth = getMonthKey(date) === focusedMonth;
              const isActive = date === activeDate;
              const isCursor = date === cursorDate;
              const isCurrent = simulationRunState ? false : date === currentDate;
              const isQueued = queuedDateSet.has(date);
              const isTarget = simulationRunState?.targetDate === date || (!simulationRunState && activeDate === date);
              const isRunCompletedDate = completedQueuedDates.has(date);
              const visualCompleted = counts.completed > 0 || isRunCompletedDate;
              const visualPending = counts.scheduled > counts.completed || (isQueued && !isRunCompletedDate && !isCursor);
              const visualLabel = isRunCompletedDate
                ? 'Sim complete'
                : counts.completed > 0
                  ? `${counts.completed} final`
                  : visualPending
                    ? 'On slate'
                    : 'Open day';

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => onSelectDate(date)}
                  className={`relative min-h-[108px] overflow-hidden rounded-[1.5rem] border p-3 text-left ${
                    inMonth ? 'border-white/10 bg-black/18' : 'border-white/5 bg-black/8'
                  } ${
                    isActive ? 'border-[#d4bb6a]/45' : ''
                  } ${
                    isCurrent ? 'shadow-[0_0_0_1px_rgba(23,214,190,0.35)]' : ''
                  } ${
                    isTarget ? 'bg-[linear-gradient(180deg,rgba(212,187,106,0.18),rgba(0,0,0,0.18))]' : ''
                  } ${
                    isRunCompletedDate ? 'bg-[linear-gradient(180deg,rgba(52,211,153,0.12),rgba(0,0,0,0.16))]' : ''
                  } hover:border-white/20`}
                >
                  {isQueued && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,rgba(212,187,106,0.2),rgba(212,187,106,0.85),rgba(212,187,106,0.2))]" />
                  )}
                  {isCursor && (
                    <div className="pointer-events-none absolute inset-0 border border-cyan-300/50 bg-cyan-400/8" />
                  )}
                  <div className="relative z-10 flex h-full flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`font-mono text-[11px] uppercase tracking-[0.18em] ${inMonth ? 'text-zinc-100' : 'text-zinc-600'}`}>
                        {date.slice(8)}
                      </span>
                      {counts.playoff > 0 ? (
                        <span className="rounded-full border border-prestige/30 bg-prestige/12 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-prestige">
                          PO
                        </span>
                      ) : counts.scheduled > 0 ? (
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-400">
                          {counts.scheduled} G
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {visualCompleted && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                        {visualPending && <span className="h-2 w-2 rounded-full bg-[#d4bb6a]" />}
                        {isCurrent && <span className="h-2 w-2 rounded-full bg-cyan-300" />}
                      </div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                        {visualLabel}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-cyan-300" /> Sim cursor</span>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#d4bb6a]" /> Pending slate</span>
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Completed day</span>
          </div>
        </section>

        <section className="space-y-6">
          <article className={`${sectionClass} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Command Board</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.06em] text-white">Run Target</p>
              </div>
              <ShieldAlert className="h-5 w-5 text-[#d4bb6a]" />
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button onClick={() => onStartSimulation({ scope: 'day' })} disabled={controlsLocked || seasonComplete} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left hover:border-white/20 disabled:opacity-50">
                <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">Sim Day</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">Resolve the current slate and advance the calendar one step.</p>
              </button>
              <button onClick={() => onStartSimulation({ scope: 'week' })} disabled={controlsLocked || seasonComplete} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left hover:border-white/20 disabled:opacity-50">
                <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">Sim Week</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">Walk forward through each day until the next full week closes.</p>
              </button>
              <button onClick={() => onStartSimulation({ scope: 'month' })} disabled={controlsLocked || seasonComplete} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left hover:border-white/20 disabled:opacity-50">
                <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">Sim Month</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">Run a longer stretch while staying interruptible for market events.</p>
              </button>
              <button onClick={() => onStartSimulation({ scope: 'next_game', teamId: selectedTeamId })} disabled={controlsLocked || seasonComplete} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left hover:border-white/20 disabled:opacity-50">
                <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">Next Team Game</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">Stop the sim at the next date involving the selected club.</p>
              </button>
              <button onClick={() => onStartSimulation({ scope: 'regular_season' })} disabled={controlsLocked || regularSeasonComplete} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left hover:border-white/20 disabled:opacity-50">
                <p className="font-headline text-xl uppercase tracking-[0.08em] text-white">To Reg Finale</p>
                <p className="mt-2 text-xs leading-5 text-zinc-400">Carry the league through the full regular-season calendar.</p>
              </button>
              <button onClick={() => onStartSimulation({ scope: 'season' })} disabled={controlsLocked || seasonComplete} className="rounded-2xl border border-[#d4bb6a]/25 bg-[#d4bb6a]/10 px-4 py-4 text-left hover:border-[#d4bb6a]/40 disabled:opacity-50">
                <p className="font-headline text-xl uppercase tracking-[0.08em] text-[#f3dea1]">Full Season</p>
                <p className="mt-2 text-xs leading-5 text-zinc-300">Run everything, but still halt when the market needs commissioner attention.</p>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Sim To Selected Date</span>
                <input
                  type="date"
                  value={activeDate}
                  min={uniqueDates[0]}
                  max={uniqueDates[uniqueDates.length - 1]}
                  onChange={(event) => onSelectDate(event.target.value)}
                  className="mt-2 block w-full bg-transparent font-mono text-sm text-white outline-none"
                />
              </label>

              <select
                value={selectedTeamId}
                onChange={(event) => onSelectTeamId(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-sm text-white outline-none"
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.id.toUpperCase()} - {team.city}
                  </option>
                ))}
              </select>

              <button
                onClick={() => onStartSimulation({ scope: 'to_date', targetDate: activeDate })}
                disabled={controlsLocked || !activeDate}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-prestige/30 bg-prestige/12 px-4 py-3 font-headline text-2xl uppercase tracking-[0.08em] text-prestige hover:border-prestige/45 disabled:opacity-50"
              >
                <CalendarDays className="h-5 w-5" />
                Sim To Date
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                onClick={onCancelSimulation}
                disabled={!isSimulating || seasonResetStatus.isResetting}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-white hover:border-white/20 disabled:opacity-50"
              >
                <PauseCircle className="h-5 w-5" />
                Stop Run
              </button>
              <button
                onClick={onResetSeason}
                disabled={controlsLocked}
                className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-white hover:border-white/20 disabled:opacity-50"
              >
                <RotateCcw className="h-5 w-5" />
                Reset
              </button>
            </div>

            {seasonResetStatus.isResetting && (
              <div className="mt-4 rounded-2xl border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200">Season Reset In Progress</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#f3dea1]">
                    {Math.max(0, Math.min(100, Math.round(seasonResetStatus.progress)))}%
                  </p>
                </div>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-300">
                  {seasonResetStatus.label || 'Resetting season state'}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#d4bb6a,#f3e5aa,#30d7c1)] transition-[width] duration-300"
                    style={{ width: `${Math.max(6, Math.min(100, seasonResetStatus.progress))}%` }}
                  />
                </div>
              </div>
            )}

            {simulationSaveStatus.isSaving && (
              <div className="mt-4 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100">Simulation Save In Progress</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">
                    {Math.max(0, Math.min(100, Math.round(simulationSaveStatus.progress)))}%
                  </p>
                </div>
                <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-cyan-100/90">
                  {simulationSaveStatus.label || 'Saving simulation snapshot'}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#30d7c1,#8be9ff,#f3e5aa)] transition-[width] duration-300"
                    style={{ width: `${Math.max(6, Math.min(100, simulationSaveStatus.progress))}%` }}
                  />
                </div>
              </div>
            )}
          </article>

          <article className={`${sectionClass} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Live Run</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.06em] text-white">
                  {simulationRunState ? simulationRunState.label : 'Awaiting Command'}
                </p>
              </div>
              <Clock3 className="h-5 w-5 text-cyan-300" />
            </div>

            <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Target</p>
                  <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">
                    {simulationRunState ? simulationRunState.targetLabel : getTargetLabel({ scope: 'to_date', targetDate: activeDate }, activeDate, teams)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Cursor</p>
                  <p className="mt-1 font-mono text-sm uppercase tracking-[0.12em] text-zinc-100">
                    {cursorDate || 'TBD'}
                  </p>
                </div>
              </div>

              <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#d4bb6a,#f3e5aa,#30d7c1)]"
                  style={{ width: `${simulationRunState ? Math.max(6, Math.min(100, planProgress)) : Math.max(6, seasonProgress.progress)}%` }}
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Date Steps</p>
                  <p className="mt-1 font-mono text-sm uppercase tracking-[0.12em] text-zinc-100">
                    {simulationRunState
                      ? `${Math.min(simulationRunState.currentIndex, simulationRunState.queuedDates.length)} / ${simulationRunState.queuedDates.length}`
                      : `${uniqueDates.indexOf(currentDate) + 1} / ${uniqueDates.length}`}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Games Resolved</p>
                  <p className="mt-1 font-mono text-sm uppercase tracking-[0.12em] text-zinc-100">
                    {simulationRunState
                      ? `${simulationRunState.simulatedGameCount} total`
                      : simulationProgress
                        ? `${simulationProgress.completedGames}/${simulationProgress.totalGames || simulationProgress.completedGames}`
                        : `${seasonProgress.completedGames}/${seasonProgress.totalGames}`}
                  </p>
                </div>
              </div>

              {simulationRunState?.message && (
                <div className={`mt-4 rounded-2xl border px-4 py-4 ${runStatusTone}`}>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                    <div className="min-w-0">
                      <p className="font-headline text-2xl uppercase tracking-[0.06em]">
                        {simulationRunState.status === 'interrupted' ? 'Simulation Halted' : simulationRunState.status}
                      </p>
                      <p className="mt-2 text-sm leading-6">{simulationRunState.message}</p>
                    </div>
                  </div>
                </div>
              )}

              {simulationRunState?.status === 'interrupted' && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {simulationRunState.interruptionKind === 'trade' ? (
                    <button
                      onClick={onOpenTrades}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-[#f3dea1] hover:border-[#d4bb6a]/45"
                    >
                      <ArrowLeftRight className="h-5 w-5" />
                      View Trades
                    </button>
                  ) : (
                    <button
                      onClick={onOpenFreeAgency}
                      className="flex items-center justify-center gap-2 rounded-2xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-[#f3dea1] hover:border-[#d4bb6a]/45"
                    >
                      <BriefcaseBusiness className="h-5 w-5" />
                      View Free Agency
                    </button>
                  )}
                  <button
                    onClick={() => onStartSimulation({ scope: 'to_date', targetDate: activeDate })}
                    disabled={controlsLocked || !activeDate}
                    className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-white hover:border-white/20 disabled:opacity-50"
                  >
                    <SkipForward className="h-5 w-5" />
                    Resume To Date
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">From</p>
                <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">
                  {simulationRunState?.startDate ? formatLongDate(simulationRunState.startDate) : (currentDate ? formatLongDate(currentDate) : 'TBD')}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">To</p>
                <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">
                  {simulationRunState?.targetDate ? formatLongDate(simulationRunState.targetDate) : (activeDate ? formatLongDate(activeDate) : 'TBD')}
                </p>
              </div>
            </div>
          </article>

          <article className={`${sectionClass} p-5`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Commissioner Guidance</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-zinc-300">
              <p>The sim advances in daily steps now. That keeps the calendar visible, avoids opaque batch runs, and gives the office a clean place to stop for market activity.</p>
              <p>New trade proposals can halt the run during the opening stretch. New free-agency opportunity alerts can halt the run when the market changes enough to deserve a manual decision.</p>
              <p>Reset is locked while a run is active. Stop the run first, then change course.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                <Play className="h-3.5 w-3.5" />
                Day-stepped
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                <TimerReset className="h-3.5 w-3.5" />
                Interruptible
              </span>
            </div>
          </article>
        </section>
      </div>
    </section>
  );
};
