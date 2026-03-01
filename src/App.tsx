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
import { GPBBook } from './components/GPBBook';
import { PlayoffsBracket } from './components/PlayoffsBracket';
import { formatHeaderDate } from './components/SeasonCalendarStrip';
import { TeamLogo } from './components/TeamLogo';
import { Controls } from './components/Controls';
import { CommissionerSettings } from './components/CommissionerSettings';
import { Activity, Bell, BookOpen, CalendarDays, Settings, Table2, Trophy } from 'lucide-react';
import gpbLogo from './assets/gpb.png';
import { motion, AnimatePresence } from 'motion/react';
import { SimulationManager } from './logic/simulationManager';
import { isPlayoffGame, isRegularSeasonGame } from './logic/playoffs';
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
  const [view, setView] = useState<'games_schedule' | 'league_standings' | 'playoffs' | 'gpb_book' | 'notifications' | 'settings'>('games_schedule');
  const [standingsMode, setStandingsMode] = useState<'divisional' | 'league'>('divisional');
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

  const simulateToEndOfRegularSeason = useCallback(() => {
    runSimulationTarget({ scope: 'regular_season' });
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

  const activeDate = selectedDate || games[0]?.date || currentDate;

  const gamesForActiveDate = useMemo(
    () =>
      games
        .filter((game) => game.date === activeDate)
        .sort((a, b) => (a.status === b.status ? a.gameId.localeCompare(b.gameId) : a.status === 'completed' ? -1 : 1)),
    [games, activeDate],
  );

  const teamLookup = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const pregameRecordByGameId = useMemo(() => {
    const orderedGames = [...games].sort((a, b) => (a.date === b.date ? a.gameId.localeCompare(b.gameId) : a.date.localeCompare(b.date)));
    const currentRecords = new Map<string, { wins: number; losses: number }>(
      teams.map((team) => [team.id, { wins: 0, losses: 0 }]),
    );
    const snapshots = new Map<string, {
      awayWins: number;
      awayLosses: number;
      homeWins: number;
      homeLosses: number;
    }>();

    orderedGames.forEach((game) => {
      const awayRecord = currentRecords.get(game.awayTeam) ?? { wins: 0, losses: 0 };
      const homeRecord = currentRecords.get(game.homeTeam) ?? { wins: 0, losses: 0 };
      snapshots.set(game.gameId, {
        awayWins: awayRecord.wins,
        awayLosses: awayRecord.losses,
        homeWins: homeRecord.wins,
        homeLosses: homeRecord.losses,
      });

      if (game.status !== 'completed' || !isRegularSeasonGame(game)) {
        return;
      }

      if (game.score.away > game.score.home) {
        awayRecord.wins += 1;
        homeRecord.losses += 1;
      } else {
        homeRecord.wins += 1;
        awayRecord.losses += 1;
      }

      currentRecords.set(game.awayTeam, awayRecord);
      currentRecords.set(game.homeTeam, homeRecord);
    });

    return snapshots;
  }, [games, teams]);

  const getStatNumber = (game: Game, key: string): number => {
    const value = game.stats[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };

  const hashKey = (input: string): number => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) % 2147483647;
    }
    return hash;
  };

  const getFallbackHits = (game: Game, side: 'away' | 'home'): number => {
    const runs = side === 'away' ? game.score.away : game.score.home;
    return runs + 3 + (hashKey(`${game.gameId}:${side}:h`) % 5);
  };

  const activeDateHasPlayoffs = useMemo(() => gamesForActiveDate.some((game) => isPlayoffGame(game)), [gamesForActiveDate]);

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
              <span className="font-mono">{formatHeaderDate(currentDate || activeDate)}</span>
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
              onClick={() => setView('playoffs')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'playoffs' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Trophy className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Playoffs</span>
            </button>
            <button
              onClick={() => setView('gpb_book')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'gpb_book' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">GPB Book</span>
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
          <div className="lg:hidden grid grid-cols-3 gap-2 mb-6">
            <button onClick={() => setView('games_schedule')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'games_schedule' ? 'bg-prestige text-black' : 'bg-[#202020] text-zinc-300'}`}>Games</button>
            <button onClick={() => setView('league_standings')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'league_standings' ? 'bg-platinum text-black' : 'bg-[#202020] text-zinc-300'}`}>Standings</button>
            <button onClick={() => setView('playoffs')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'playoffs' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Playoffs</button>
            <button onClick={() => setView('gpb_book')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'gpb_book' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Book</button>
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
                    onSimulateToEndOfRegularSeason={simulateToEndOfRegularSeason}
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

                    <div className="space-y-4">
                      {gamesForActiveDate.length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-[#181818] px-4 py-8 text-center text-zinc-500 font-mono">
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
                          const playoffLabel = game.playoff ? `${game.playoff.seriesLabel} • Game ${game.playoff.gameNumber}` : null;

                          return (
                            <article key={game.gameId} className="rounded-2xl border border-white/10 bg-[#171717] px-4 py-5">
                              <div className="flex items-center justify-between mb-4">
                                <div>
                                  <span className={`font-mono text-[11px] uppercase ${game.status === 'completed' ? 'text-platinum' : 'text-zinc-500'}`}>
                                    {game.status === 'completed' ? 'Final' : 'Scheduled'}
                                  </span>
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
              )}

              {view === 'league_standings' && (
                <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                  <div className="xl:col-span-3 space-y-8">
                    <section className="bg-gradient-to-r from-[#1f1f1f] via-[#262626] to-[#1f1f1f] rounded-2xl border border-white/10 p-3">
                      <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
                        <button
                          onClick={() => setStandingsMode('divisional')}
                          className={`px-4 py-2 rounded-lg font-display text-sm uppercase tracking-widest transition-colors ${
                            standingsMode === 'divisional'
                              ? 'bg-white text-black'
                              : 'text-zinc-300 hover:text-white'
                          }`}
                        >
                          Divisional View
                        </button>
                        <button
                          onClick={() => setStandingsMode('league')}
                          className={`px-4 py-2 rounded-lg font-display text-sm uppercase tracking-widest transition-colors ${
                            standingsMode === 'league'
                              ? 'bg-white text-black'
                              : 'text-zinc-300 hover:text-white'
                          }`}
                        >
                          League View
                        </button>
                      </div>
                    </section>

                    {standingsMode === 'divisional' ? (
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
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <LeagueTable leagueName="Prestige League" teams={getLeagueTeams('Prestige')} headerColor="text-prestige" />
                        <LeagueTable leagueName="Platinum League" teams={getLeagueTeams('Platinum')} headerColor="text-platinum" />
                      </div>
                    )}
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

              {view === 'gpb_book' && (
                <GPBBook
                  teams={teams}
                  games={games}
                  settings={settings}
                  currentDate={currentDate}
                  dataSource={dataSource}
                />
              )}

              {view === 'playoffs' && (
                <PlayoffsBracket
                  teams={teams}
                  games={games}
                  seasonComplete={seasonComplete}
                  currentDate={currentDate}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                />
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

