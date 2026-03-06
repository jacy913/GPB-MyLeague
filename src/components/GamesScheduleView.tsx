import React from 'react';
import { Clock3 } from 'lucide-react';
import { getGameWindowStatus, getScheduledGameTimeLabel } from '../logic/gameTimes';
import { Game, Team } from '../types';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { TeamLogo } from './TeamLogo';

interface SeasonProgressSummary {
  completedGames: number;
  totalGames: number;
  remainingGames: number;
  progress: number;
}

interface DaySummary {
  total: number;
  completed: number;
  scheduled: number;
  playoff: number;
}

interface PregameRecord {
  awayWins: number;
  awayLosses: number;
  homeWins: number;
  homeLosses: number;
}

interface GamesScheduleViewProps {
  seasonProgressSummary: SeasonProgressSummary;
  seasonComplete: boolean;
  activeDateHasPlayoffs: boolean;
  currentDate: string;
  activeDate: string;
  allScheduleDates: string[];
  calendarSummaryByDate: Map<string, DaySummary>;
  lastRegularSeasonDate: string;
  gamesForActiveDate: Game[];
  games: Game[];
  teamLookup: Map<string, Team>;
  pregameRecordByGameId: Map<string, PregameRecord>;
  getStatNumber: (game: Game, key: string) => number;
  getFallbackHits: (game: Game, side: 'away' | 'home') => number;
  onSelectDate: (date: string) => void;
  onOpenGame: (gameId: string) => void;
}

export const GamesScheduleView: React.FC<GamesScheduleViewProps> = ({
  seasonProgressSummary,
  seasonComplete,
  activeDateHasPlayoffs,
  currentDate,
  activeDate,
  allScheduleDates,
  calendarSummaryByDate,
  lastRegularSeasonDate,
  gamesForActiveDate,
  games,
  teamLookup,
  pregameRecordByGameId,
  getStatNumber,
  getFallbackHits,
  onSelectDate,
  onOpenGame,
}) => (
  <div className="space-y-6">
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(167,155,0,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(23,182,144,0.12),transparent_28%),linear-gradient(135deg,#1c1c1c,#252525 42%,#171717)] p-4 md:p-6">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Season Progress</p>
            <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <p className="font-display text-4xl uppercase tracking-[0.08em] text-white md:text-5xl">
                {Math.round(seasonProgressSummary.progress)}% Complete
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                {seasonComplete ? 'Season complete' : activeDateHasPlayoffs ? 'Playoff race live' : 'Regular season in progress'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:min-w-[520px]">
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Played</p>
              <p className="mt-2 font-display text-2xl uppercase text-white">{seasonProgressSummary.completedGames}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Remaining</p>
              <p className="mt-2 font-display text-2xl uppercase text-white">{seasonProgressSummary.remainingGames}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Season Scope</p>
              <p className="mt-2 font-display text-2xl uppercase text-white">{seasonProgressSummary.totalGames}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Sim Date</p>
              <p className="mt-2 font-display text-lg uppercase text-white">{formatHeaderDate(currentDate || activeDate)}</p>
            </div>
          </div>
        </div>

        <div className="relative h-4 overflow-hidden rounded-full border border-white/10 bg-black/35">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,#a79b00_0%,#f3f0e2_48%,#17b690_100%)] shadow-[0_0_22px_rgba(23,182,144,0.35)] transition-[width] duration-500"
            style={{ width: `${seasonProgressSummary.progress}%` }}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.18),transparent_62%)]" />
        </div>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-display text-2xl uppercase tracking-[0.12em] text-white">Season Calendar</p>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              Select a day to change the scoreboard slate
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Selected Slate</p>
              <p className="mt-2 font-display text-lg uppercase text-white">{formatHeaderDate(activeDate)}</p>
            </div>
            <label className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Jump To Date</span>
              <input
                type="date"
                value={activeDate}
                min={allScheduleDates[0]}
                max={allScheduleDates[allScheduleDates.length - 1]}
                onChange={(event) => onSelectDate(event.target.value)}
                className="mt-2 block bg-transparent font-mono text-sm text-white focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="overflow-x-auto pb-2 scrollbar-subtle">
          <div className="flex min-w-max gap-3">
            {allScheduleDates.map((date) => {
              const daySummary = calendarSummaryByDate.get(date) ?? { total: 0, completed: 0, scheduled: 0, playoff: 0 };
              const isSelected = date === activeDate;
              const isCurrent = date === currentDate;
              const isPlayoffDate = daySummary.playoff > 0;

              return (
                <button
                  key={date}
                  onClick={() => onSelectDate(date)}
                  className={`group min-w-[150px] rounded-2xl border px-4 py-4 text-left transition-all ${
                    isSelected
                      ? isPlayoffDate
                        ? 'border-zinc-200/60 bg-zinc-100/10 shadow-[0_18px_40px_rgba(255,255,255,0.06)]'
                        : 'border-prestige/55 bg-prestige/14 shadow-[0_18px_40px_rgba(23,182,144,0.1)]'
                      : isCurrent
                        ? 'border-platinum/40 bg-platinum/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-xl uppercase tracking-[0.08em] text-white">
                        {new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                        {isPlayoffDate ? 'Playoff slate' : 'Regular season'}
                      </p>
                    </div>
                    {isPlayoffDate ? (
                      <span className="rounded-full border border-zinc-200/20 bg-zinc-100/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-200">
                        PL
                      </span>
                    ) : isCurrent ? (
                      <span className="rounded-full border border-prestige/30 bg-prestige/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-prestige">
                        Today
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <p className="font-display text-lg uppercase tracking-[0.08em] text-zinc-100">
                      {daySummary.total} {daySummary.total === 1 ? 'Game' : 'Games'} Today
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      {daySummary.completed} final{daySummary.completed === 1 ? '' : 's'} / {daySummary.scheduled} upcoming
                    </p>
                    {date === lastRegularSeasonDate && (
                      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-platinum">Regular season finale</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>

    <section className="bg-gradient-to-br from-[#1f1f1f] via-[#242424] to-[#1f1f1f] rounded-2xl border border-white/10 p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-3xl uppercase tracking-widest text-white">
          Game Schedule
        </h2>
        <div className="text-right">
          {activeDateHasPlayoffs && (
            <span className="inline-flex items-center rounded-md border border-zinc-200/20 bg-zinc-200/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-zinc-200 mb-1">
              Playoff Window
            </span>
          )}
          <div className="font-mono text-xs text-zinc-400">
            {activeDate} | {gamesForActiveDate.length} games
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {gamesForActiveDate.length === 0 ? (
          <div className="xl:col-span-2 rounded-xl border border-white/10 bg-[#181818] px-4 py-8 text-center text-zinc-500 font-mono">
            No games scheduled for this date.
          </div>
        ) : (
          gamesForActiveDate.map((game) => {
            const awayTeam = teamLookup.get(game.awayTeam);
            const homeTeam = teamLookup.get(game.homeTeam);
            const pregame = pregameRecordByGameId.get(game.gameId) ?? {
              awayWins: 0,
              awayLosses: 0,
              homeWins: 0,
              homeLosses: 0,
            };

            const awayRuns = game.status === 'completed' ? game.score.away : 0;
            const homeRuns = game.status === 'completed' ? game.score.home : 0;
            const awayHitsRaw = getStatNumber(game, 'awayHits');
            const homeHitsRaw = getStatNumber(game, 'homeHits');
            const awayErrorsRaw = getStatNumber(game, 'awayErrors');
            const homeErrorsRaw = getStatNumber(game, 'homeErrors');
            const awayHits = game.status === 'completed' ? (awayHitsRaw > 0 ? awayHitsRaw : getFallbackHits(game, 'away')) : 0;
            const homeHits = game.status === 'completed' ? (homeHitsRaw > 0 ? homeHitsRaw : getFallbackHits(game, 'home')) : 0;
            const awayErrors = game.status === 'completed' ? awayErrorsRaw : 0;
            const homeErrors = game.status === 'completed' ? homeErrorsRaw : 0;
            const playoffLabel = game.playoff ? `${game.playoff.seriesLabel} | Game ${game.playoff.gameNumber}` : null;
            const scheduledTimeLabel = getScheduledGameTimeLabel(game, games);
            const gameWindowStatus = getGameWindowStatus(game, games, currentDate);
            const cardStatusLabel =
              gameWindowStatus === 'final'
                ? 'Final'
                : gameWindowStatus === 'live_window'
                  ? 'Live Window'
                  : 'Scheduled';

            return (
              <article
                key={game.gameId}
                onClick={() => onOpenGame(game.gameId)}
                className="rounded-2xl border border-white/10 bg-[#171717] px-4 py-5 cursor-pointer transition-colors hover:border-white/20"
              >
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span
                      className={`font-mono text-[11px] uppercase ${
                        gameWindowStatus === 'final'
                          ? 'text-platinum'
                          : gameWindowStatus === 'live_window'
                            ? 'text-prestige'
                            : 'text-zinc-500'
                      }`}
                    >
                      {cardStatusLabel}
                    </span>
                    <div className="mt-1 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
                      <Clock3 className="h-3 w-3" />
                      {scheduledTimeLabel}
                    </div>
                    {playoffLabel && (
                      <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-500 mt-1">
                        {playoffLabel}
                      </div>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-zinc-500">{game.gameId.toUpperCase()}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-5 items-center">
                  <div className="flex items-center gap-4 min-w-0 justify-self-start">
                    {awayTeam ? (
                      <TeamLogo team={awayTeam} sizeClass="w-20 h-20" />
                    ) : (
                      <div className="w-20 h-20 rounded-xl border border-white/10 bg-[#202020] flex items-center justify-center font-mono text-sm text-zinc-500 uppercase">
                        {game.awayTeam}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-display text-4xl uppercase tracking-wide text-zinc-100 leading-none truncate">
                        {awayTeam ? awayTeam.city : game.awayTeam.toUpperCase()}
                      </p>
                      <p className="font-display text-2xl uppercase tracking-wide text-zinc-400 leading-none mt-1 truncate">
                        {awayTeam ? awayTeam.name : 'Unknown'}
                      </p>
                      <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 mt-2">
                        {pregame.awayWins}-{pregame.awayLosses}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <div className="font-mono text-4xl md:text-5xl text-zinc-100 leading-none">
                      {awayRuns}-{homeRuns}
                    </div>
                    <div className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 mt-1">
                      {playoffLabel ?? `${awayTeam ? awayTeam.id.toUpperCase() : game.awayTeam.toUpperCase()} vs ${homeTeam ? homeTeam.id.toUpperCase() : game.homeTeam.toUpperCase()}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 min-w-0 justify-self-end">
                    <div className="min-w-0 text-right">
                      <p className="font-display text-4xl uppercase tracking-wide text-zinc-100 leading-none truncate">
                        {homeTeam ? homeTeam.city : game.homeTeam.toUpperCase()}
                      </p>
                      <p className="font-display text-2xl uppercase tracking-wide text-zinc-400 leading-none mt-1 truncate">
                        {homeTeam ? homeTeam.name : 'Unknown'}
                      </p>
                      <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500 mt-2">
                        {pregame.homeWins}-{pregame.homeLosses}
                      </p>
                    </div>
                    {homeTeam ? (
                      <TeamLogo team={homeTeam} sizeClass="w-20 h-20" />
                    ) : (
                      <div className="w-20 h-20 rounded-xl border border-white/10 bg-[#202020] flex items-center justify-center font-mono text-sm text-zinc-500 uppercase">
                        {game.homeTeam}
                      </div>
                    )}
                  </div>
                </div>

                <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent my-4" />

                <div className="rounded-xl border border-white/10 bg-[#121212] px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">Box Score (R/H/E)</p>
                    <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
                      {game.status === 'completed' ? 'Final' : 'Scheduled'}
                    </p>
                  </div>

                  <div className="grid grid-cols-[52px_minmax(0,1fr)_48px_48px_48px] gap-x-2 text-sm font-mono items-center">
                    <span className="text-zinc-500"></span>
                    <span className="text-zinc-500 uppercase">Team</span>
                    <span className="text-zinc-500 text-right">R</span>
                    <span className="text-zinc-500 text-right">H</span>
                    <span className="text-zinc-500 text-right">E</span>

                    <span className="text-zinc-500 uppercase">AWAY</span>
                    <span className="text-zinc-100 truncate">{awayTeam ? `${awayTeam.city} ${awayTeam.name}` : game.awayTeam.toUpperCase()}</span>
                    <span className="text-zinc-100 text-right">{awayRuns}</span>
                    <span className="text-zinc-100 text-right">{awayHits}</span>
                    <span className="text-zinc-100 text-right">{awayErrors}</span>

                    <span className="text-zinc-500 uppercase">HOME</span>
                    <span className="text-zinc-100 truncate">{homeTeam ? `${homeTeam.city} ${homeTeam.name}` : game.homeTeam.toUpperCase()}</span>
                    <span className="text-zinc-100 text-right">{homeRuns}</span>
                    <span className="text-zinc-100 text-right">{homeHits}</span>
                    <span className="text-zinc-100 text-right">{homeErrors}</span>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  </div>
);
