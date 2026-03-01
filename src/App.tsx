/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { INITIAL_TEAMS } from './data/teams';
import { generateSchedule, getDefaultSeasonStartDate, recalculateTeamRatings, DEFAULT_SETTINGS } from './logic/simulation';
import { Team, Game, SimulationSettings, SimulationTarget } from './types';
import { StandingsTable } from './components/StandingsTable';
import { LeagueTable } from './components/LeagueTable';
import { Leaderboard } from './components/Leaderboard';
import { TeamLogo } from './components/TeamLogo';
import { Controls } from './components/Controls';
import { CommissionerSettings } from './components/CommissionerSettings';
import { Activity, Bell, CalendarDays, Settings, Table2 } from 'lucide-react';
import gpbLogo from './assets/gpb.png';
import { motion, AnimatePresence } from 'motion/react';
import { SimulationManager } from './logic/simulationManager';
import { isSupabaseConfigured } from './lib/supabaseClient';
import {
  clearSupabaseSeasonHistory,
  loadLocalLeagueState,
  loadSupabaseLeagueState,
  saveLocalLeagueState,
  saveSupabaseLeagueState,
  saveSupabaseSeasonRun,
  seedSupabaseLeagueState,
} from './lib/storage';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

interface CommissionerNotice {
  id: string;
  message: string;
  level: NoticeLevel;
  createdAt: string;
}

const NOTICE_LEVEL_CLASS: Record<NoticeLevel, string> = {
  info: 'text-zinc-300',
  success: 'text-white',
  warning: 'text-zinc-200',
  error: 'text-zinc-400',
};

const EXPECTED_TEAM_COUNT = 32;

const isValidTeamShape = (value: unknown): value is Team => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const team = value as Partial<Team>;
  return (
    typeof team.id === 'string' &&
    typeof team.name === 'string' &&
    typeof team.city === 'string' &&
    (team.league === 'Prestige' || team.league === 'Platinum') &&
    (team.division === 'North' || team.division === 'South' || team.division === 'East' || team.division === 'West') &&
    typeof team.rating === 'number' &&
    typeof team.previousBaselineWins === 'number' &&
    typeof team.wins === 'number' &&
    typeof team.losses === 'number' &&
    typeof team.runsScored === 'number' &&
    typeof team.runsAllowed === 'number'
  );
};

const sanitizeTeams = (value: unknown): Team[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.length !== EXPECTED_TEAM_COUNT) {
    return null;
  }

  return value.every(isValidTeamShape) ? (value as Team[]) : null;
};

const isValidSettingsShape = (value: unknown): value is SimulationSettings => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as Partial<SimulationSettings>;
  return (
    typeof settings.continuityWeight === 'number' &&
    typeof settings.winLossVariance === 'number' &&
    typeof settings.homeFieldAdvantage === 'number' &&
    typeof settings.gameLuckFactor === 'number'
  );
};

function App() {
  const [teams, setTeams] = useState<Team[]>(INITIAL_TEAMS);
  const [games, setGames] = useState<Game[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [seasonComplete, setSeasonComplete] = useState(false);
  const [view, setView] = useState<'games_schedule' | 'league_standings' | 'notifications' | 'settings'>('games_schedule');
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SETTINGS);
  const [currentDate, setCurrentDate] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>(INITIAL_TEAMS[0]?.id ?? '');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [dataSource, setDataSource] = useState<'supabase' | 'local'>('local');
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [commissionerNotices, setCommissionerNotices] = useState<CommissionerNotice[]>([]);

  const pushNotice = useCallback((message: string, level: NoticeLevel = 'info') => {
    const createdAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setCommissionerNotices((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message,
        level,
        createdAt,
      },
      ...prev,
    ].slice(0, 30));
  }, []);

  const getProgressFromGames = useCallback((seasonGames: Game[]): number => {
    if (seasonGames.length === 0) {
      return 0;
    }
    const completed = seasonGames.filter((game) => game.status === 'completed').length;
    return (completed / seasonGames.length) * 100;
  }, []);

  const buildFreshSeasonTeams = useCallback((teamsToReset: Team[], settingsToUse: SimulationSettings): Team[] => {
    const zeroedTeams = teamsToReset.map((team) => ({
      ...team,
      wins: 0,
      losses: 0,
      runsScored: 0,
      runsAllowed: 0,
    }));

    return recalculateTeamRatings(zeroedTeams, settingsToUse);
  }, []);

  const createMasterSchedule = useCallback((seasonTeams: Team[]): Game[] => {
    const seasonStartDate = getDefaultSeasonStartDate(new Date().getFullYear());
    return generateSchedule(seasonTeams, { seasonStartDate, seasonDays: 180 });
  }, []);

  const persistLeagueState = useCallback(async (nextTeams: Team[], nextSettings: SimulationSettings) => {
    saveLocalLeagueState(nextTeams, nextSettings);

    if (!isSupabaseConfigured) {
      return;
    }

    await saveSupabaseLeagueState(nextTeams, nextSettings);
    setDataSource('supabase');
  }, []);

  // Load state on mount and seed Supabase if empty.
  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true);

      try {
        if (isSupabaseConfigured) {
          await seedSupabaseLeagueState(INITIAL_TEAMS, DEFAULT_SETTINGS);
          const remoteState = await loadSupabaseLeagueState();
          const validRemoteTeams = sanitizeTeams(remoteState.teams);
          const validRemoteSettings = isValidSettingsShape(remoteState.settings) ? remoteState.settings : null;

          if (validRemoteTeams) {
            setTeams(validRemoteTeams);
          }
          if (validRemoteSettings) {
            setSettings(validRemoteSettings);
          }

          if (validRemoteTeams && validRemoteSettings) {
            saveLocalLeagueState(validRemoteTeams, validRemoteSettings);
          }

          setDataSource('supabase');
          return;
        }

        const localState = loadLocalLeagueState();
        const validLocalTeams = sanitizeTeams(localState.teams);
        const validLocalSettings = isValidSettingsShape(localState.settings) ? localState.settings : null;

        if (validLocalTeams) {
          setTeams(validLocalTeams);
        }
        if (validLocalSettings) {
          setSettings(validLocalSettings);
        }
        setDataSource('local');
      } catch (error) {
        console.error('Failed to load Supabase state, falling back to local storage:', error);
        const localState = loadLocalLeagueState();
        const validLocalTeams = sanitizeTeams(localState.teams);
        const validLocalSettings = isValidSettingsShape(localState.settings) ? localState.settings : null;

        if (validLocalTeams) {
          setTeams(validLocalTeams);
        }
        if (validLocalSettings) {
          setSettings(validLocalSettings);
        }
        setDataSource('local');
        pushNotice('Supabase sync failed. Using local storage fallback.', 'warning');
      } finally {
        setIsBootstrapping(false);
      }
    };

    void bootstrap();
  }, [pushNotice]);

  // Initialize schedule on mount (or when teams change structure, but we handle that in save)
  useEffect(() => {
    if (!isBootstrapping && games.length === 0) {
      const schedule = createMasterSchedule(teams);
      setGames(schedule);
      const firstDate = schedule[0]?.date ?? getDefaultSeasonStartDate(new Date().getFullYear());
      setCurrentDate(firstDate);
      setSelectedDate(firstDate);
      setSeasonComplete(false);
      setProgress(0);
    }
  }, [teams, games.length, isBootstrapping, createMasterSchedule]);

  useEffect(() => {
    if (teams.length === 0) {
      return;
    }

    if (!teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId]);

  const resetSeason = useCallback((teamsToReset = teams, settingsToUse = settings) => {
    const freshTeams = buildFreshSeasonTeams(teamsToReset, settingsToUse);
    const schedule = createMasterSchedule(freshTeams);
    const firstDate = schedule[0]?.date ?? getDefaultSeasonStartDate(new Date().getFullYear());

    setTeams(freshTeams);
    setGames(schedule);
    setCurrentDate(firstDate);
    setSelectedDate(firstDate);
    setProgress(0);
    setSeasonComplete(false);

    void (async () => {
      try {
        await persistLeagueState(freshTeams, settingsToUse);
      } catch (error) {
        console.error('Failed to persist reset season state:', error);
        pushNotice('Season reset locally, but Supabase sync failed.', 'warning');
      }
    })();
  }, [teams, settings, buildFreshSeasonTeams, createMasterSchedule, persistLeagueState, pushNotice]);

  const handleSaveSettings = (newTeams: Team[], newSettings: SimulationSettings) => {
    setSettings(newSettings);
    resetSeason(newTeams, newSettings);
    pushNotice(
      isSupabaseConfigured ? 'League settings updated and season reset.' : 'League settings updated locally.',
      'success',
    );
    setView('games_schedule');
  };

  const handleClearHistoricalData = useCallback(async () => {
    if (!isSupabaseConfigured) {
      pushNotice('Supabase is not configured. No historical season data to clear.', 'warning');
      return;
    }

    setIsClearingHistory(true);
    try {
      const deletedRuns = await clearSupabaseSeasonHistory();
      if (deletedRuns > 0) {
        pushNotice(`Cleared ${deletedRuns} historical season runs from Supabase.`, 'success');
      } else {
        pushNotice('No historical season data found to clear.', 'info');
      }
    } catch (error) {
      console.error('Failed to clear historical season data:', error);
      pushNotice('Failed to clear historical season data from Supabase.', 'error');
    } finally {
      setIsClearingHistory(false);
    }
  }, [pushNotice]);

  const runSimulationTarget = useCallback((target: SimulationTarget) => {
    if (isSimulating || games.length === 0) {
      return;
    }

    setIsSimulating(true);

    requestAnimationFrame(() => {
      const manager = new SimulationManager({
        teams,
        games,
        settings,
        currentDate: currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear()),
      });

      const result = manager.run(target);
      const complete = result.games.every((game) => game.status === 'completed');
      const finalizedTeams = complete
        ? result.teams.map((team) => ({ ...team, previousBaselineWins: team.wins }))
        : result.teams;

      setTeams(finalizedTeams);
      setGames(result.games);
      setCurrentDate(result.currentDate);
      setSelectedDate(result.currentDate);
      setProgress(getProgressFromGames(result.games));
      setSeasonComplete(complete);
      setIsSimulating(false);

      void (async () => {
        try {
          await persistLeagueState(finalizedTeams, settings);

          if (complete && result.simulatedGameCount > 0) {
            if (isSupabaseConfigured) {
              const seasonLabel = `Season ${new Date(`${result.currentDate}T00:00:00Z`).getUTCFullYear()}`;
              await saveSupabaseSeasonRun(finalizedTeams, result.games, settings, seasonLabel);
              pushNotice('Season simulation completed and saved to Supabase.', 'success');
            } else {
              pushNotice('Season simulation completed and saved locally.', 'info');
            }
            return;
          }

          if (result.simulatedGameCount === 0) {
            pushNotice('No scheduled games matched the selected simulation scope.', 'info');
          } else {
            pushNotice(`Simulated ${result.simulatedGameCount} games through ${result.currentDate}.`, 'info');
          }
        } catch (error) {
          console.error('Failed to persist simulation results:', error);
          pushNotice('Simulation ran, but saving to Supabase failed. Local state is still updated.', 'warning');
        }
      })();
    });
  }, [isSimulating, games, teams, settings, currentDate, getProgressFromGames, persistLeagueState, pushNotice]);

  const simulateToSelectedDate = useCallback(() => {
    if (!selectedDate) {
      return;
    }
    runSimulationTarget({ scope: 'to_date', targetDate: selectedDate });
  }, [selectedDate, runSimulationTarget]);

  const simulateDay = useCallback(() => {
    runSimulationTarget({ scope: 'day' });
  }, [runSimulationTarget]);

  const simulateWeek = useCallback(() => {
    runSimulationTarget({ scope: 'week' });
  }, [runSimulationTarget]);

  const simulateMonth = useCallback(() => {
    runSimulationTarget({ scope: 'month' });
  }, [runSimulationTarget]);

  const simulateNextTeamGame = useCallback(() => {
    if (!selectedTeamId) {
      pushNotice('Select a team before running "Simulate Next Game".', 'warning');
      return;
    }
    runSimulationTarget({ scope: 'next_game', teamId: selectedTeamId });
  }, [selectedTeamId, runSimulationTarget, pushNotice]);

  const quickSimSeason = useCallback(() => {
    runSimulationTarget({ scope: 'season' });
  }, [runSimulationTarget]);

  const getDivisionTeams = (league: string, division: string) => {
    return teams.filter(t => t.league === league && t.division === division);
  };

  const getLeagueTeams = (league: string) => {
    return teams.filter(t => t.league === league);
  };

  const seasonYear = new Date().getFullYear();
  const activeDate = selectedDate || games[0]?.date || currentDate;

  const gamesForActiveDate = useMemo(
    () =>
      games
        .filter((game) => game.date === activeDate)
        .sort((a, b) => (a.status === b.status ? a.gameId.localeCompare(b.gameId) : a.status === 'completed' ? -1 : 1)),
    [games, activeDate],
  );

  const teamLookup = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#181818] text-white font-sans flex items-center justify-center">
        <div className="text-center space-y-2">
          <img src={gpbLogo} alt="GPB" className="mx-auto h-24 w-24 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)]" />
          <p className="text-slate-400 font-mono text-sm">Loading league data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans selection:bg-white/20 relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-40 -left-24 w-[420px] h-[420px] rounded-full bg-prestige/15 blur-3xl" />
        <div className="absolute top-[28%] -right-20 w-[360px] h-[360px] rounded-full bg-platinum/15 blur-3xl" />
        <div className="absolute bottom-0 left-[32%] w-[520px] h-[240px] bg-gradient-to-r from-transparent via-white/5 to-transparent blur-2xl" />
      </div>

      <header className="bg-[#151515]/95 backdrop-blur border-b border-white/10 sticky top-0 z-50">
        <div className="px-4 sm:px-6 lg:px-8 h-[88px] flex items-center justify-between">
          <button className="flex items-center gap-3" onClick={() => setView('games_schedule')}>
            <img src={gpbLogo} alt="GPB home" className="h-[68px] w-[68px] object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]" />
            <span className="font-logo text-3xl sm:text-4xl uppercase leading-none tracking-[0.06em] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
              My League
            </span>
          </button>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
              <Activity className="w-4 h-4 text-prestige" />
              <span className="font-mono">SEASON {seasonYear}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
              <span className={`w-2 h-2 rounded-full ${dataSource === 'supabase' ? 'bg-platinum' : 'bg-prestige'}`} />
              <span className="font-mono">{dataSource === 'supabase' ? 'SUPABASE' : 'LOCAL'}</span>
            </div>
            <button
              onClick={() => setView('notifications')}
              className={`relative p-2 rounded-lg transition-colors ${view === 'notifications' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-[#323232]'}`}
              title="Commissioner Notifications"
            >
              <Bell className="w-5 h-5" />
              {commissionerNotices.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-platinum text-black text-[10px] font-mono flex items-center justify-center">
                  {commissionerNotices.length > 9 ? '9+' : commissionerNotices.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 flex">
        <aside className="hidden lg:block w-64 border-r border-white/10 bg-[#161616]/80 backdrop-blur sticky top-[88px] h-[calc(100vh-88px)]">
          <div className="p-4 space-y-2">
            <button
              onClick={() => setView('games_schedule')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'games_schedule' ? 'bg-prestige text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <CalendarDays className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Games & Schedule</span>
            </button>
            <button
              onClick={() => setView('league_standings')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'league_standings' ? 'bg-platinum text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Table2 className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">League Standings</span>
            </button>
            <button
              onClick={() => setView('notifications')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'notifications' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Bell className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Notifications</span>
            </button>
            <button
              onClick={() => setView('settings')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'settings' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Settings className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Settings</span>
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
          <div className="lg:hidden grid grid-cols-2 gap-2 mb-6">
            <button onClick={() => setView('games_schedule')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'games_schedule' ? 'bg-prestige text-black' : 'bg-[#202020] text-zinc-300'}`}>Games</button>
            <button onClick={() => setView('league_standings')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'league_standings' ? 'bg-platinum text-black' : 'bg-[#202020] text-zinc-300'}`}>Standings</button>
            <button onClick={() => setView('notifications')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'notifications' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Notices</button>
            <button onClick={() => setView('settings')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'settings' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Settings</button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.24 }}
            >
              {view === 'games_schedule' && (
                <div className="space-y-6">
                  <Controls
                    games={games}
                    teams={teams}
                    currentDate={currentDate}
                    selectedDate={selectedDate}
                    selectedTeamId={selectedTeamId}
                    onSelectDate={setSelectedDate}
                    onSelectTeamId={setSelectedTeamId}
                    onSimulateToSelectedDate={simulateToSelectedDate}
                    onSimulateDay={simulateDay}
                    onSimulateWeek={simulateWeek}
                    onSimulateMonth={simulateMonth}
                    onSimulateNextGame={simulateNextTeamGame}
                    onQuickSimSeason={quickSimSeason}
                    onReset={() => resetSeason()}
                    isSimulating={isSimulating}
                    progress={progress}
                    seasonComplete={seasonComplete}
                  />

                  <section className="bg-gradient-to-br from-[#1f1f1f] via-[#242424] to-[#1f1f1f] rounded-2xl border border-white/10 p-4 md:p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-display text-3xl uppercase tracking-widest text-white">
                        Game Schedule
                      </h2>
                      <span className="font-mono text-xs text-zinc-400">
                        {activeDate} | {gamesForActiveDate.length} games
                      </span>
                    </div>

                    <div className="space-y-4">
                      {gamesForActiveDate.length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-[#181818] px-4 py-8 text-center text-zinc-500 font-mono">
                          No games scheduled for this date.
                        </div>
                      ) : (
                        gamesForActiveDate.map((game) => {
                          const awayTeam = teamLookup.get(game.awayTeam);
                          const homeTeam = teamLookup.get(game.homeTeam);
                          return (
                            <article key={game.gameId} className="rounded-2xl border border-white/10 bg-[#171717] px-4 py-5">
                              <div className="flex items-center justify-between mb-4">
                                <span className={`font-mono text-[11px] uppercase ${game.status === 'completed' ? 'text-platinum' : 'text-zinc-500'}`}>
                                  {game.status === 'completed' ? 'Final' : 'Scheduled'}
                                </span>
                                <span className="font-mono text-[11px] text-zinc-500">{game.gameId.toUpperCase()}</span>
                              </div>

                              <div className="space-y-3">
                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-4">
                                    {awayTeam ? (
                                      <TeamLogo team={awayTeam} sizeClass="w-16 h-16" />
                                    ) : (
                                      <div className="w-16 h-16 rounded-xl border border-white/10 bg-[#202020] flex items-center justify-center font-mono text-xs text-zinc-500 uppercase">
                                        {game.awayTeam}
                                      </div>
                                    )}
                                    <div>
                                      <p className="font-display text-3xl uppercase tracking-wide text-zinc-100 leading-none">
                                        {awayTeam ? awayTeam.city : game.awayTeam.toUpperCase()}
                                      </p>
                                      <p className="font-display text-xl uppercase tracking-wide text-zinc-400 leading-none mt-1">
                                        {awayTeam ? awayTeam.name : 'Unknown'}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="font-mono text-3xl text-zinc-200 min-w-10 text-right">
                                    {game.status === 'completed' ? game.score.away : '-'}
                                  </span>
                                </div>

                                <div className="h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

                                <div className="flex items-center justify-between gap-4">
                                  <div className="flex items-center gap-4">
                                    {homeTeam ? (
                                      <TeamLogo team={homeTeam} sizeClass="w-16 h-16" />
                                    ) : (
                                      <div className="w-16 h-16 rounded-xl border border-white/10 bg-[#202020] flex items-center justify-center font-mono text-xs text-zinc-500 uppercase">
                                        {game.homeTeam}
                                      </div>
                                    )}
                                    <div>
                                      <p className="font-display text-3xl uppercase tracking-wide text-zinc-100 leading-none">
                                        {homeTeam ? homeTeam.city : game.homeTeam.toUpperCase()}
                                      </p>
                                      <p className="font-display text-xl uppercase tracking-wide text-zinc-400 leading-none mt-1">
                                        {homeTeam ? homeTeam.name : 'Unknown'}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="font-mono text-3xl text-zinc-200 min-w-10 text-right">
                                    {game.status === 'completed' ? game.score.home : '-'}
                                  </span>
                                </div>
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                </div>
              )}

              {view === 'league_standings' && (
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                  <div className="xl:col-span-3 space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="flex items-center gap-3 mb-2">
                          <h2 className="font-display text-2xl uppercase text-prestige tracking-widest">Prestige</h2>
                          <div className="h-px flex-1 bg-gradient-to-r from-prestige/60 to-transparent" />
                        </div>
                        <StandingsTable divisionName="North" teams={getDivisionTeams('Prestige', 'North')} headerColor="text-prestige" />
                        <StandingsTable divisionName="South" teams={getDivisionTeams('Prestige', 'South')} headerColor="text-prestige" />
                        <StandingsTable divisionName="East" teams={getDivisionTeams('Prestige', 'East')} headerColor="text-prestige" />
                        <StandingsTable divisionName="West" teams={getDivisionTeams('Prestige', 'West')} headerColor="text-prestige" />
                      </div>
                      <div className="space-y-6">
                        <div className="flex items-center gap-3 mb-2">
                          <h2 className="font-display text-2xl uppercase text-platinum tracking-widest">Platinum</h2>
                          <div className="h-px flex-1 bg-gradient-to-r from-platinum/60 to-transparent" />
                        </div>
                        <StandingsTable divisionName="North" teams={getDivisionTeams('Platinum', 'North')} headerColor="text-platinum" />
                        <StandingsTable divisionName="South" teams={getDivisionTeams('Platinum', 'South')} headerColor="text-platinum" />
                        <StandingsTable divisionName="East" teams={getDivisionTeams('Platinum', 'East')} headerColor="text-platinum" />
                        <StandingsTable divisionName="West" teams={getDivisionTeams('Platinum', 'West')} headerColor="text-platinum" />
                      </div>
                    </div>

                    <div className="space-y-12">
                      <LeagueTable leagueName="Prestige League" teams={getLeagueTeams('Prestige')} headerColor="text-prestige" />
                      <LeagueTable leagueName="Platinum League" teams={getLeagueTeams('Platinum')} headerColor="text-platinum" />
                    </div>
                  </div>

                  <aside className="xl:col-span-1">
                    <div className="sticky top-24">
                      <Leaderboard teams={teams} />
                      <div className="mt-8 p-4 bg-[#323232] rounded-lg border border-white/10">
                        <h4 className="font-display text-xs uppercase tracking-widest text-zinc-500 mb-2">Simulation Logic</h4>
                        <div className="space-y-2 text-xs text-zinc-400 font-mono">
                          <div className="flex justify-between">
                            <span>Continuity:</span>
                            <span className="text-prestige">{(settings.continuityWeight * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Variance:</span>
                            <span className="text-platinum">{settings.winLossVariance}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>
              )}

              {view === 'notifications' && (
                <section className="max-w-4xl space-y-4">
                  <div className="bg-[#1f1f1f] rounded-2xl border border-white/10 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-display text-3xl uppercase tracking-widest text-white">Commissioner Notifications</h2>
                      <button
                        onClick={() => setCommissionerNotices([])}
                        disabled={commissionerNotices.length === 0}
                        className="text-xs font-mono text-zinc-500 hover:text-white disabled:text-zinc-700 transition-colors"
                      >
                        Clear Feed
                      </button>
                    </div>
                    {commissionerNotices.length === 0 ? (
                      <p className="text-sm font-mono text-zinc-500">No notifications yet.</p>
                    ) : (
                      <ul className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                        {commissionerNotices.map((notice) => (
                          <li key={notice.id} className="bg-[#2b2b2b] border border-white/10 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                            <span className={`text-sm font-mono ${NOTICE_LEVEL_CLASS[notice.level]}`}>{notice.message}</span>
                            <span className="text-[11px] font-mono text-zinc-500 shrink-0">{notice.createdAt}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              {view === 'settings' && (
                <CommissionerSettings
                  teams={teams}
                  settings={settings}
                  onSave={handleSaveSettings}
                  onCancel={() => setView('games_schedule')}
                  onClearHistoricalData={handleClearHistoricalData}
                  isClearingHistoricalData={isClearingHistory}
                  isSupabaseEnabled={isSupabaseConfigured}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default App;

