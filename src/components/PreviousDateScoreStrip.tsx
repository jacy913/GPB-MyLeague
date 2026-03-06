import React from 'react';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { TeamLogo } from './TeamLogo';
import { isPlayoffGame } from '../logic/playoffs';
import { Game, Team } from '../types';

interface PreviousDateScoreStripProps {
  simulationPerformanceMode: boolean;
  bannerDate: string;
  currentTimelineDate: string;
  gamesForBannerDate: Game[];
  teamLookup: Map<string, Team>;
  onOpenGame: (gameId: string) => void;
}

export function PreviousDateScoreStrip({
  simulationPerformanceMode,
  bannerDate,
  currentTimelineDate,
  gamesForBannerDate,
  teamLookup,
  onOpenGame,
}: PreviousDateScoreStripProps) {
  if (simulationPerformanceMode) {
    return (
      <div className="px-3 py-3 sm:px-5 lg:px-8">
        <div className="rounded-xl border border-[#d4bb6a]/20 bg-[#d4bb6a]/8 px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d8c88b]">Simulation Focus Mode</p>
          <p className="mt-1 text-sm text-zinc-200">
            Live score banners and ticker updates are paused while the calendar sim runs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 sm:px-5 lg:px-8 py-2">
      <div className="hidden md:flex min-w-[170px] items-center gap-2 border-r border-white/10 pr-4">
        <div className="h-2 w-2 rounded-full bg-platinum" />
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Yesterday</p>
          <p className="font-mono text-xs text-zinc-200">{formatHeaderDate(bannerDate || currentTimelineDate)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto scrollbar-subtle">
        <div className="flex min-w-max gap-2">
          {gamesForBannerDate.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
              No games on previous sim date
            </div>
          ) : (
            gamesForBannerDate.map((game) => {
              const awayTeam = teamLookup.get(game.awayTeam);
              const homeTeam = teamLookup.get(game.homeTeam);
              const awayRuns = game.status === 'completed' ? game.score.away : 0;
              const homeRuns = game.status === 'completed' ? game.score.home : 0;
              const isPlayoffBannerGame = isPlayoffGame(game);

              return (
                <button
                  key={`banner-${game.gameId}`}
                  onClick={() => onOpenGame(game.gameId)}
                  className={`min-w-[196px] rounded-xl border px-3 py-2 text-left transition-colors hover:border-white/25 ${
                    isPlayoffBannerGame
                      ? 'border-zinc-200/20 bg-zinc-100/[0.06]'
                      : 'border-white/10 bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                      game.status === 'completed' ? 'text-zinc-200' : 'text-zinc-500'
                    }`}>
                      {game.status === 'completed' ? 'Final' : 'Scheduled'}
                    </span>
                    {isPlayoffBannerGame && (
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-300">PL</span>
                    )}
                  </div>

                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_28px] items-center gap-2">
                      {awayTeam ? <TeamLogo team={awayTeam} sizeClass="w-6 h-6" /> : <div className="w-6 h-6" />}
                      <span className="font-mono text-xs uppercase tracking-[0.08em] text-zinc-200 truncate">
                        {awayTeam ? awayTeam.id.toUpperCase() : game.awayTeam.toUpperCase()}
                      </span>
                      <span className="font-mono text-right text-sm text-white">{awayRuns}</span>
                    </div>
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_28px] items-center gap-2">
                      {homeTeam ? <TeamLogo team={homeTeam} sizeClass="w-6 h-6" /> : <div className="w-6 h-6" />}
                      <span className="font-mono text-xs uppercase tracking-[0.08em] text-zinc-200 truncate">
                        {homeTeam ? homeTeam.id.toUpperCase() : game.homeTeam.toUpperCase()}
                      </span>
                      <span className="font-mono text-right text-sm text-white">{homeRuns}</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
