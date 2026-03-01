import React, { useMemo } from 'react';
import { CalendarDays, ChevronRight, ChevronsRight, Loader2, Play, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { Game, Team } from '../types';
import { isRegularSeasonGame } from '../logic/playoffs';
import { SeasonCalendarStrip } from './SeasonCalendarStrip';

interface ControlsProps {
  games: Game[];
  teams: Team[];
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  onSelectDate: (date: string) => void;
  onSelectTeamId: (teamId: string) => void;
  onSimulateToSelectedDate: () => void;
  onSimulateToEndOfRegularSeason: () => void;
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

export const Controls: React.FC<ControlsProps> = ({
  games,
  teams,
  currentDate,
  selectedDate,
  selectedTeamId,
  onSelectDate,
  onSelectTeamId,
  onSimulateToSelectedDate,
  onSimulateToEndOfRegularSeason,
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
  const regularSeasonComplete = useMemo(
    () => games.filter((game) => isRegularSeasonGame(game)).every((game) => game.status === 'completed'),
    [games],
  );

  const completedGames = useMemo(() => games.filter((game) => game.status === 'completed').length, [games]);
  const totalGames = games.length;
  const remainingGames = Math.max(totalGames - completedGames, 0);
  const currentDayIndex = Math.max(uniqueDates.indexOf(currentDate), 0);
  const seasonDayTotal = uniqueDates.length;

  return (
    <div className="flex flex-col gap-4 bg-gradient-to-r from-[#212121] via-[#2a2a2a] to-[#212121] p-4 rounded-2xl border border-white/15 shadow-2xl shadow-black/40 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute inset-y-0 -left-24 w-48 bg-gradient-to-r from-prestige/0 via-prestige/30 to-prestige/0 skew-x-[-20deg]" />
        <div className="absolute inset-y-0 right-[-6rem] w-48 bg-gradient-to-r from-platinum/0 via-platinum/30 to-platinum/0 skew-x-[-20deg]" />
      </div>

      <div className="rounded-xl border border-white/10 bg-black/25 p-3">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-400">Season Progress</p>
            <p className="font-display text-2xl uppercase tracking-wide text-white leading-none mt-1">
              {Math.round(progress)}% Complete
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-right min-w-[240px]">
            <div>
              <p className="text-[10px] uppercase text-zinc-500 font-mono">Played</p>
              <p className="text-sm font-mono text-zinc-100">{completedGames}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-zinc-500 font-mono">Remaining</p>
              <p className="text-sm font-mono text-zinc-100">{remainingGames}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-zinc-500 font-mono">Season Day</p>
              <p className="text-sm font-mono text-zinc-100">
                {seasonDayTotal > 0 ? `${currentDayIndex + 1}/${seasonDayTotal}` : '0/0'}
              </p>
            </div>
          </div>
        </div>
        <div className="h-3 bg-black/50 rounded-full overflow-hidden border border-white/10 relative">
          <motion.div
            className="h-full bg-[linear-gradient(90deg,#a79b00_0%,#f0f0f0_50%,#17b690_100%)] shadow-[0_0_16px_rgba(23,182,144,0.35)]"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ type: 'tween', ease: 'linear' }}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_60%)]" />
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
            onClick={onSimulateToEndOfRegularSeason}
            disabled={isSimulating || regularSeasonComplete}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-[#2e2e2e] hover:bg-[#3a3a3a] disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-display font-bold uppercase tracking-wide rounded-xl transition-colors"
          >
            <ChevronsRight className="w-4 h-4" />
            Sim To End Of Regular Season
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

      <SeasonCalendarStrip
        games={games}
        currentDate={currentDate}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
      />
    </div>
  );
};
