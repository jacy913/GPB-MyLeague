import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { Game, Team } from '../types';
import { getLeaguePlayoffSeeds, isPlayoffGame } from '../logic/playoffs';
import { TeamLogo } from './TeamLogo';
import { formatHeaderDate } from './SeasonCalendarStrip';

interface TeamCalendarProps {
  teams: Team[];
  games: Game[];
  currentDate: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onOpenGame: (gameId: string) => void;
}

type LeagueFilter = 'All' | 'Prestige' | 'Platinum';
type TimelineFilter = 'full' | 'playoff_field';

const getMonthKey = (isoDate: string): string => isoDate.slice(0, 7);

const formatMonthLabel = (monthKey: string): string => {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const buildMonthDates = (monthKey: string): string[] => {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, '0')}`);
};

const getWeekdayLabel = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2).toUpperCase();
};

const getTeamAccentClasses = (team: Team): string =>
  team.league === 'Platinum'
    ? 'border-platinum/30 bg-platinum/[0.07] text-platinum'
    : 'border-prestige/30 bg-prestige/[0.08] text-prestige';

export const TeamCalendar: React.FC<TeamCalendarProps> = ({
  teams,
  games,
  currentDate,
  selectedDate,
  onSelectDate,
  onOpenGame,
}) => {
  const monthKeys = useMemo(
    () => Array.from(new Set(games.map((game) => getMonthKey(game.date)))).sort((a, b) => a.localeCompare(b)),
    [games],
  );
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>('All');
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('full');
  const [activeMonth, setActiveMonth] = useState<string>(monthKeys[0] ?? '');

  useEffect(() => {
    if (monthKeys.length === 0) {
      setActiveMonth('');
      return;
    }

    const preferredMonth = getMonthKey(currentDate || selectedDate || monthKeys[0]);
    if (monthKeys.includes(preferredMonth)) {
      setActiveMonth(preferredMonth);
      return;
    }

    if (!monthKeys.includes(activeMonth)) {
      setActiveMonth(monthKeys[0]);
    }
  }, [monthKeys, currentDate, selectedDate]);

  const activeMonthIndex = Math.max(monthKeys.indexOf(activeMonth), 0);
  const monthDates = useMemo(() => (activeMonth ? buildMonthDates(activeMonth) : []), [activeMonth]);
  const activeMonthGames = useMemo(() => games.filter((game) => getMonthKey(game.date) === activeMonth), [games, activeMonth]);
  const activeMonthHasPlayoffs = useMemo(() => activeMonthGames.some(isPlayoffGame), [activeMonthGames]);

  useEffect(() => {
    if (!activeMonthHasPlayoffs && timelineFilter === 'playoff_field') {
      setTimelineFilter('full');
    }
  }, [activeMonthHasPlayoffs, timelineFilter]);

  const playoffSeedsByLeague = useMemo(
    () => ({
      Prestige: getLeaguePlayoffSeeds(teams, games, 'Prestige'),
      Platinum: getLeaguePlayoffSeeds(teams, games, 'Platinum'),
    }),
    [teams, games],
  );

  const playoffSeedByTeamId = useMemo(() => {
    const seedMap = new Map<string, { seed: number; league: Team['league']; clinchLabel: string }>();
    playoffSeedsByLeague.Prestige.forEach((entry) => {
      seedMap.set(entry.team.id, {
        seed: entry.seed,
        league: 'Prestige',
        clinchLabel: entry.clinchType === 'division' ? 'Division' : 'Wild Card',
      });
    });
    playoffSeedsByLeague.Platinum.forEach((entry) => {
      seedMap.set(entry.team.id, {
        seed: entry.seed,
        league: 'Platinum',
        clinchLabel: entry.clinchType === 'division' ? 'Division' : 'Wild Card',
      });
    });
    return seedMap;
  }, [playoffSeedsByLeague]);

  const playoffTeamIds = useMemo(() => new Set(Array.from(playoffSeedByTeamId.keys())), [playoffSeedByTeamId]);

  const filteredTeams = useMemo(() => {
    let scopedTeams = teams;

    if (timelineFilter === 'playoff_field' && activeMonthHasPlayoffs) {
      scopedTeams = teams.filter((team) => playoffTeamIds.has(team.id));
    }

    if (leagueFilter !== 'All') {
      scopedTeams = scopedTeams.filter((team) => team.league === leagueFilter);
    }

    if (timelineFilter === 'playoff_field' && activeMonthHasPlayoffs) {
      return [...scopedTeams].sort((a, b) => {
        const aSeed = playoffSeedByTeamId.get(a.id);
        const bSeed = playoffSeedByTeamId.get(b.id);
        if (a.league !== b.league) {
          return a.league.localeCompare(b.league);
        }
        if (aSeed && bSeed && aSeed.seed !== bSeed.seed) {
          return aSeed.seed - bSeed.seed;
        }
        return a.city.localeCompare(b.city);
      });
    }

    return scopedTeams;
  }, [teams, leagueFilter, timelineFilter, activeMonthHasPlayoffs, playoffTeamIds, playoffSeedByTeamId]);

  const teamGameMap = useMemo(() => {
    const gameMap = new Map<string, Game>();
    games.forEach((game) => {
      gameMap.set(`${game.homeTeam}:${game.date}`, game);
      gameMap.set(`${game.awayTeam}:${game.date}`, game);
    });
    return gameMap;
  }, [games]);

  const selectedMonthStats = useMemo(() => {
    const uniqueGameDays = new Set(activeMonthGames.map((game) => game.date)).size;
    const playoffDays = new Set(activeMonthGames.filter(isPlayoffGame).map((game) => game.date)).size;
    const completedGames = activeMonthGames.filter((game) => game.status === 'completed').length;
    return { uniqueGameDays, playoffDays, completedGames, totalGames: activeMonthGames.length };
  }, [activeMonthGames]);

  const currentMonthLabel = activeMonth ? formatMonthLabel(activeMonth) : 'No Month';
  const columnTemplate = `220px repeat(${Math.max(monthDates.length, 1)}, minmax(64px, 1fr))`;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(23,182,144,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(167,155,0,0.12),transparent_30%),linear-gradient(135deg,#1a1a1a,#222,#171717)] p-5 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-zinc-100" />
              <h1 className="font-display text-4xl md:text-5xl uppercase tracking-widest text-white">Team Calendar</h1>
            </div>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-400 mt-2">
              Month-by-month schedule matrix synced to league game data.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 min-w-[280px]">
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Month</p>
              <p className="font-display text-xl uppercase tracking-[0.08em] text-white mt-1">{currentMonthLabel}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Game Days</p>
              <p className="font-mono text-lg text-zinc-100 mt-1">{selectedMonthStats.uniqueGameDays}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Playoff Days</p>
              <p className="font-mono text-lg text-zinc-100 mt-1">{selectedMonthStats.playoffDays}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                {activeMonthHasPlayoffs ? 'Playoff Field' : 'Focus Date'}
              </p>
              <p className="font-mono text-sm text-zinc-100 mt-1">
                {activeMonthHasPlayoffs
                  ? `${playoffTeamIds.size} teams`
                  : formatHeaderDate(selectedDate || currentDate)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#191919] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveMonth(monthKeys[Math.max(activeMonthIndex - 1, 0)] ?? activeMonth)}
              disabled={activeMonthIndex <= 0}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-35"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-2">
              <p className="font-display text-2xl uppercase tracking-[0.12em] text-white">{currentMonthLabel}</p>
            </div>
            <button
              onClick={() => setActiveMonth(monthKeys[Math.min(activeMonthIndex + 1, monthKeys.length - 1)] ?? activeMonth)}
              disabled={activeMonthIndex >= monthKeys.length - 1}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-zinc-300 transition-colors hover:border-white/20 hover:text-white disabled:opacity-35"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTimelineFilter('full')}
              className={`rounded-xl px-4 py-2 font-display text-sm uppercase tracking-[0.14em] transition-colors ${
                timelineFilter === 'full'
                  ? 'bg-white text-black'
                  : 'border border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:text-white'
              }`}
            >
              Full Timeline
            </button>
            <button
              onClick={() => setTimelineFilter('playoff_field')}
              disabled={!activeMonthHasPlayoffs}
              className={`rounded-xl px-4 py-2 font-display text-sm uppercase tracking-[0.14em] transition-colors ${
                timelineFilter === 'playoff_field'
                  ? 'bg-zinc-100 text-black'
                  : 'border border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:text-white'
              } disabled:opacity-35 disabled:hover:border-white/10 disabled:hover:text-zinc-300`}
            >
              Playoff Field
            </button>
            {(['All', 'Prestige', 'Platinum'] as LeagueFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setLeagueFilter(filter)}
                className={`rounded-xl px-4 py-2 font-display text-sm uppercase tracking-[0.14em] transition-colors ${
                  leagueFilter === filter
                    ? filter === 'Platinum'
                      ? 'bg-platinum text-black'
                      : filter === 'Prestige'
                        ? 'bg-prestige text-black'
                        : 'bg-white text-black'
                    : 'border border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:text-white'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto scrollbar-subtle pb-2">
          <div className="flex min-w-max gap-2">
            {monthKeys.map((monthKey) => {
              const monthGames = games.filter((game) => getMonthKey(game.date) === monthKey);
              const hasPlayoffs = monthGames.some(isPlayoffGame);
              const isActive = monthKey === activeMonth;
              return (
                <button
                  key={monthKey}
                  onClick={() => setActiveMonth(monthKey)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? hasPlayoffs
                        ? 'border-zinc-200/35 bg-zinc-100/10'
                        : 'border-platinum/50 bg-platinum/12'
                      : 'border-white/10 bg-black/20 hover:border-white/20'
                  }`}
                >
                  <p className="font-display text-lg uppercase tracking-[0.1em] text-white">{formatMonthLabel(monthKey)}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1">
                    {monthGames.length} games {hasPlayoffs ? '• playoff window' : ''}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#171717] p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-display text-3xl uppercase tracking-widest text-white">Month Matrix</h2>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1">
              {timelineFilter === 'playoff_field' && activeMonthHasPlayoffs
                ? 'Playoff-qualified clubs only. Click any day cell to sync the global date.'
                : 'Scroll down through teams. Click any day cell to sync the global date.'}
            </p>
          </div>
          <div className="font-mono text-xs text-zinc-500">
            {filteredTeams.length} teams | {selectedMonthStats.completedGames}/{selectedMonthStats.totalGames} games complete
          </div>
        </div>

        <div className="overflow-auto max-h-[72vh] scrollbar-subtle rounded-2xl border border-white/10 bg-black/20">
          <div className="min-w-max">
            <div
              className="sticky top-0 z-30 border-b border-white/10 bg-[#121212]/95 backdrop-blur"
              style={{ display: 'grid', gridTemplateColumns: columnTemplate }}
            >
              <div className="sticky left-0 z-40 border-r border-white/10 bg-[#121212]/95 px-4 py-3">
                <p className="font-display text-xl uppercase tracking-[0.12em] text-white">Teams</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1">{currentMonthLabel}</p>
              </div>
              {monthDates.map((date) => {
                const isCurrent = date === currentDate;
                const isSelected = date === selectedDate;
                const hasPlayoffGames = activeMonthGames.some((game) => game.date === date && isPlayoffGame(game));
                return (
                  <button
                    key={date}
                    onClick={() => onSelectDate(date)}
                    className={`border-r border-white/6 px-2 py-3 text-center transition-colors ${
                      isSelected
                        ? 'bg-white/10'
                        : isCurrent
                          ? 'bg-platinum/10'
                          : hasPlayoffGames
                            ? 'bg-zinc-100/[0.05]'
                            : 'bg-transparent'
                    }`}
                  >
                    <p className="font-display text-xl uppercase tracking-[0.08em] text-white leading-none">
                      {Number(date.slice(-2))}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1">
                      {getWeekdayLabel(date)}
                    </p>
                  </button>
                );
              })}
            </div>

            {filteredTeams.map((team) => (
              <div
                key={team.id}
                className="border-b border-white/6 last:border-b-0"
                style={{ display: 'grid', gridTemplateColumns: columnTemplate }}
              >
                <div className="sticky left-0 z-20 border-r border-white/10 bg-[#151515]/95 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`rounded-2xl border px-2 py-2 ${getTeamAccentClasses(team)}`}>
                      <TeamLogo team={team} sizeClass="w-12 h-12" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-2xl uppercase tracking-[0.08em] text-white leading-none">
                        {team.city}
                      </p>
                      <p className="font-display text-sm uppercase tracking-[0.12em] text-zinc-400 mt-1">
                        {team.name}
                      </p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-2">
                        {team.league} • {team.division}
                      </p>
                      {timelineFilter === 'playoff_field' && activeMonthHasPlayoffs && playoffSeedByTeamId.has(team.id) && (
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-300 mt-1">
                          Seed {playoffSeedByTeamId.get(team.id)?.seed} • {playoffSeedByTeamId.get(team.id)?.clinchLabel}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {monthDates.map((date) => {
                  const game = teamGameMap.get(`${team.id}:${date}`);
                  if (!game) {
                    return (
                      <button
                        key={`${team.id}-${date}`}
                        onClick={() => onSelectDate(date)}
                        className="group border-r border-white/6 bg-[#141414] px-1 py-2 transition-colors hover:bg-white/[0.03]"
                      >
                        <div className="flex h-full min-h-[92px] items-center justify-center rounded-xl border border-transparent transition-colors group-hover:border-white/10">
                          <span className="h-1.5 w-1.5 rounded-full bg-white/12" />
                        </div>
                      </button>
                    );
                  }

                  const isHome = game.homeTeam === team.id;
                  const opponentId = isHome ? game.awayTeam : game.homeTeam;
                  const opponent = teams.find((item) => item.id === opponentId);
                  const teamRuns = game.status === 'completed' ? (isHome ? game.score.home : game.score.away) : 0;
                  const opponentRuns = game.status === 'completed' ? (isHome ? game.score.away : game.score.home) : 0;
                  const resultLabel =
                    game.status === 'completed' ? (teamRuns > opponentRuns ? 'W' : 'L') : isHome ? 'VS' : '@';
                  const isPlayoffCell = isPlayoffGame(game);

                    return (
                      <button
                        key={`${team.id}-${date}`}
                        onClick={() => onOpenGame(game.gameId)}
                        className="group border-r border-white/6 px-1 py-2 text-left transition-colors hover:bg-white/[0.03]"
                      >
                      <div
                        className={`min-h-[92px] rounded-xl border px-2 py-2 transition-transform group-hover:-translate-y-0.5 ${
                          isPlayoffCell
                            ? 'border-zinc-200/18 bg-zinc-100/[0.07]'
                            : team.league === 'Platinum'
                              ? 'border-platinum/18 bg-platinum/[0.06]'
                              : 'border-prestige/18 bg-prestige/[0.06]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-300">
                            {game.status === 'completed' ? resultLabel : resultLabel}
                          </span>
                          {isPlayoffCell && (
                            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-300">PL</span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          {opponent ? <TeamLogo team={opponent} sizeClass="w-8 h-8" /> : <div className="w-8 h-8" />}
                          <div className="min-w-0">
                            <p className="font-display text-lg uppercase tracking-[0.08em] text-white leading-none">
                              {opponent ? opponent.id.toUpperCase() : opponentId.toUpperCase()}
                            </p>
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500 mt-1">
                              {isHome ? 'Home' : 'Away'}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-300">
                          {game.status === 'completed' ? `${teamRuns}-${opponentRuns}` : '0-0'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
