import React, { useMemo } from 'react';
import { CalendarDays, ChevronRight, Loader2, Play, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { Game, Team } from '../types';

interface ControlsProps {
  games: Game[];
  teams: Team[];
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  onSelectDate: (date: string) => void;
  onSelectTeamId: (teamId: string) => void;
  onSimulateToSelectedDate: () => void;
  onSimulateDay: () => void;
  onSimulateWeek: () => void;
  onSimulateMonth: () => void;
  onSimulateNextGame: () => void;
  onQuickSimSeason: () => void;
  onReset: () => void;
  isSimulating: boolean;
  progress: number;
  seasonComplete: boolean;
}

const formatDateLabel = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const Controls: React.FC<ControlsProps> = ({
  games,
  teams,
  currentDate,
  selectedDate,
  selectedTeamId,
  onSelectDate,
  onSelectTeamId,
  onSimulateToSelectedDate,
  onSimulateDay,
  onSimulateWeek,
  onSimulateMonth,
  onSimulateNextGame,
  onQuickSimSeason,
  onReset,
  isSimulating,
  progress,
  seasonComplete,
}) => {
  const uniqueDates = useMemo(
    () => Array.from(new Set(games.map((game) => game.date))).sort((a, b) => a.localeCompare(b)),
    [games],
  );

  const activeDate = selectedDate || uniqueDates[0] || currentDate;
  const gameCountByDate = useMemo(() => {
    const counts = new Map<string, { scheduled: number; completed: number }>();
    games.forEach((game) => {
      const current = counts.get(game.date) ?? { scheduled: 0, completed: 0 };
      if (game.status === 'completed') {
        current.completed += 1;
      } else {
        current.scheduled += 1;
      }
      counts.set(game.date, current);
    });
    return counts;
  }, [games]);

  return (
    <div className="flex flex-col gap-4 bg-gradient-to-r from-[#212121] via-[#2a2a2a] to-[#212121] p-4 rounded-2xl border border-white/15 shadow-2xl shadow-black/40 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-y-0 -left-24 w-48 bg-gradient-to-r from-prestige/0 via-prestige/30 to-prestige/0 skew-x-[-20deg]" />
        <div className="absolute inset-y-0 right-[-6rem] w-48 bg-gradient-to-r from-platinum/0 via-platinum/30 to-platinum/0 skew-x-[-20deg]" />
      </div>

      <div className="flex-1">
        <div className="flex justify-between text-xs uppercase tracking-wider text-zinc-400 mb-2">
          <span>Season Progress</span>
          <span className="font-mono text-white">{Math.round(progress)}%</span>
        </div>
        <div className="h-2.5 bg-black/45 rounded-full overflow-hidden border border-white/10">
          <motion.div 
            className="h-full bg-gradient-to-r from-prestige via-zinc-200 to-platinum"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'tween', ease: 'linear' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onSimulateToSelectedDate}
            disabled={isSimulating}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-prestige to-platinum hover:brightness-110 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-display font-bold tracking-wide uppercase rounded-xl transition-all shadow-lg active:scale-95"
          >
            {isSimulating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Simulating...
              </>
            ) : (
              <>
                <CalendarDays className="w-4 h-4" />
                Simulate to Today
              </>
            )}
          </button>

          <button
            onClick={onSimulateWeek}
            disabled={isSimulating || seasonComplete}
            className="px-4 py-2 bg-[#2e2e2e] hover:bg-[#3a3a3a] disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-display font-bold uppercase tracking-wide rounded-xl transition-colors"
          >
            Simulate Week
          </button>

          <button
            onClick={onSimulateMonth}
            disabled={isSimulating || seasonComplete}
            className="px-4 py-2 bg-[#2e2e2e] hover:bg-[#3a3a3a] disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-display font-bold uppercase tracking-wide rounded-xl transition-colors"
          >
            Simulate Month
          </button>

          <button
            onClick={onSimulateDay}
            disabled={isSimulating || seasonComplete}
            className="px-4 py-2 bg-[#2e2e2e] hover:bg-[#3a3a3a] disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-display font-bold uppercase tracking-wide rounded-xl transition-colors"
          >
            Simulate Day
          </button>

          <button
            onClick={onQuickSimSeason}
            disabled={isSimulating || seasonComplete}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-platinum/80 hover:bg-platinum disabled:bg-zinc-700 disabled:text-zinc-500 text-black font-display font-bold uppercase tracking-wide rounded-xl transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
            Quick Sim Season
          </button>

          <button
            onClick={onReset}
            disabled={isSimulating}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-display font-bold tracking-wide uppercase rounded-xl transition-all shadow-lg active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            Reset Season
          </button>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <input
            type="date"
            value={activeDate}
            min={uniqueDates[0]}
            max={uniqueDates[uniqueDates.length - 1]}
            onChange={(event) => onSelectDate(event.target.value)}
            className="px-3 py-2 bg-[#181818] border border-white/10 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-platinum"
          />

          <select
            value={selectedTeamId}
            onChange={(event) => onSelectTeamId(event.target.value)}
            className="px-3 py-2 bg-[#181818] border border-white/10 rounded-lg text-sm font-mono text-white focus:outline-none focus:border-platinum"
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.id.toUpperCase()} - {team.city}
              </option>
            ))}
          </select>

          <button
            onClick={onSimulateNextGame}
            disabled={isSimulating || seasonComplete}
            className="flex items-center gap-1 px-3 py-2 bg-[#2e2e2e] hover:bg-[#3a3a3a] disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-display font-bold uppercase tracking-wide rounded-xl transition-colors"
          >
            Next Team Game
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-black/30 border border-white/10 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-display uppercase tracking-widest text-zinc-300">Season Calendar</h4>
          <span className="font-mono text-xs text-zinc-500">
            Current Sim Date: {currentDate || activeDate}
          </span>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {uniqueDates.map((date) => {
            const dayCounts = gameCountByDate.get(date) ?? { scheduled: 0, completed: 0 };
            const isActive = date === activeDate;
            const isCurrent = date === currentDate;

            return (
              <button
                key={date}
                onClick={() => onSelectDate(date)}
                className={`min-w-[92px] px-2 py-2 rounded-lg border text-left transition-colors ${
                  isActive
                    ? 'border-platinum bg-platinum/15'
                    : isCurrent
                      ? 'border-prestige/70 bg-prestige/10'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="font-mono text-xs text-zinc-200">{formatDateLabel(date)}</div>
                <div className="font-mono text-[10px] text-zinc-400">
                  F {dayCounts.completed} | S {dayCounts.scheduled}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
