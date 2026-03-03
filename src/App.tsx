/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { INITIAL_TEAMS } from './data/teams';
import { generateSchedule, getDefaultSeasonStartDate, recalculateTeamRatings, DEFAULT_SETTINGS } from './logic/simulation';
import { CompletedGameResult, LeaguePlayerState, Team, Game, SimulationSettings, SimulationTarget } from './types';
import { StandingsTable } from './components/StandingsTable';
import { LeagueTable } from './components/LeagueTable';
import { Leaderboard } from './components/Leaderboard';
import { LeadersHub } from './components/LeadersHub';
import { GPBBook } from './components/GPBBook';
import { PlayoffsBracket } from './components/PlayoffsBracket';
import { HomeDashboard } from './components/HomeDashboard';
import { TeamCalendar } from './components/TeamCalendar';
import { TeamsHub } from './components/TeamsHub';
import { PlayersHub } from './components/PlayersHub';
import { GameScreen } from './components/GameScreen';
import { formatHeaderDate } from './components/SeasonCalendarStrip';
import { TeamLogo } from './components/TeamLogo';
import { CommissionerSettings } from './components/CommissionerSettings';
import { Activity, BarChart3, Bell, BookOpen, CalendarDays, CalendarRange, Clock3, LayoutDashboard, Settings, Table2, Trophy, UserRound, Users } from 'lucide-react';
import gpbLogo from './assets/gpb.png';
import { motion, AnimatePresence } from 'motion/react';
import { SimulationManager, SimulationProgressUpdate } from './logic/simulationManager';
import { createGameSession, simulateGameToFinal, buildCompletedGameFromSession } from './logic/gameEngine';
import { buildGameParticipants } from './logic/gameParticipants';
import { getCurrentSimTimeLabel, getGameWindowStatus, getScheduledGameTimeLabel } from './logic/gameTimes';
import { generatePlayerPool } from './logic/playerGenerator';
import { applyPlayerGameStatDelta, resetPlayerSeasonStats } from './logic/playerStats';
import { isPlayoffGame, isRegularSeasonGame } from './logic/playoffs';
import { isSupabaseConfigured } from './lib/supabaseClient';
import {
  clearLocalPlayerState,
  clearSupabasePlayerState,
  clearSupabaseSeasonHistory,
  loadLocalLeagueState,
  loadLocalPlayerState,
  replaceSupabaseTeamsFromSource,
  loadSupabaseLeagueState,
  loadSupabasePlayerState,
  saveLocalLeagueState,
  saveLocalPlayerState,
  saveSupabaseLeagueState,
  saveSupabasePlayerState,
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
const SUPABASE_TEAM_SOURCE_SYNC_KEY = 'gpb_supabase_team_source_sync_v1';
const SUPABASE_TEAM_SOURCE_SYNC_VERSION = '2026-03-02-teams-ts';

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
    typeof settings.gameLuckFactor === 'number' &&
    typeof settings.leagueEnvironmentBalance === 'number' &&
    typeof settings.battingVarianceFactor === 'number'
  );
};

const isValidGameShape = (value: unknown): value is Game => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const game = value as Partial<Game>;
  return (
    typeof game.gameId === 'string' &&
    typeof game.date === 'string' &&
    typeof game.homeTeam === 'string' &&
    typeof game.awayTeam === 'string' &&
    (game.phase === 'regular_season' || game.phase === 'playoffs') &&
    (game.status === 'scheduled' || game.status === 'completed') &&
    Boolean(game.score) &&
    typeof game.score?.home === 'number' &&
    typeof game.score?.away === 'number' &&
    Boolean(game.stats) &&
    typeof game.stats === 'object'
  );
};

const sanitizeGames = (value: unknown): Game[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.every(isValidGameShape) ? (value as Game[]) : null;
};

const EMPTY_PLAYER_STATE: LeaguePlayerState = {
  players: [],
  battingStats: [],
  pitchingStats: [],
  battingRatings: [],
  pitchingRatings: [],
  rosterSlots: [],
  transactions: [],
};

const resolveSeasonYear = (currentDate: string | null | undefined, seasonGames: Game[] = []): number => {
  const sourceDate = currentDate || seasonGames[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
  const year = Number(sourceDate?.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
};

const PLAYOFF_ROUND_LIMITS = [
  { round: 'wild_card', seriesCount: 4, bestOf: 3 },
  { round: 'divisional', seriesCount: 4, bestOf: 5 },
  { round: 'league_series', seriesCount: 2, bestOf: 7 },
  { round: 'world_series', seriesCount: 1, bestOf: 7 },
] as const;

const getProjectedSeasonSummary = (seasonGames: Game[]) => {
  if (seasonGames.length === 0) {
    return {
      completedGames: 0,
      totalGames: 0,
      remainingGames: 0,
      progress: 0,
    };
  }

  const completedGames = seasonGames.filter((game) => game.status === 'completed').length;
  const regularSeasonGames = seasonGames.filter((game) => !isPlayoffGame(game)).length;
  const playoffGames = seasonGames.filter(isPlayoffGame);
  const playoffSeriesMap = new Map<string, Game[]>();
  const roundSeriesCounts = new Map<string, Set<string>>();

  PLAYOFF_ROUND_LIMITS.forEach(({ round }) => {
    roundSeriesCounts.set(round, new Set<string>());
  });

  playoffGames.forEach((game) => {
    const seriesId = game.playoff?.seriesId;
    const round = game.playoff?.round;
    if (!seriesId || !round) {
      return;
    }

    const existing = playoffSeriesMap.get(seriesId) ?? [];
    existing.push(game);
    playoffSeriesMap.set(seriesId, existing);
    roundSeriesCounts.get(round)?.add(seriesId);
  });

  let projectedPlayoffGames = 0;
  playoffSeriesMap.forEach((seriesGames) => {
    const orderedGames = [...seriesGames].sort((left, right) =>
      left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date),
    );
    const sample = orderedGames[0];
    const playoff = sample.playoff;
    if (!playoff) {
      return;
    }

    const completedSeriesGames = orderedGames.filter((game) => game.status === 'completed');
    const winsNeeded = Math.floor(playoff.bestOf / 2) + 1;
    const topSeedTeamId = typeof sample.stats.topSeedTeamId === 'string' ? sample.stats.topSeedTeamId : '';
    const bottomSeedTeamId = typeof sample.stats.bottomSeedTeamId === 'string' ? sample.stats.bottomSeedTeamId : '';
    let topWins = 0;
    let bottomWins = 0;

    completedSeriesGames.forEach((game) => {
      const winnerTeamId = game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
      if (winnerTeamId === topSeedTeamId) {
        topWins += 1;
      } else if (winnerTeamId === bottomSeedTeamId) {
        bottomWins += 1;
      }
    });

    const clinched = topWins >= winsNeeded || bottomWins >= winsNeeded;
    projectedPlayoffGames += orderedGames.length;

    if (!clinched) {
      projectedPlayoffGames += Math.max(playoff.bestOf - orderedGames.length, 0);
    }
  });

  PLAYOFF_ROUND_LIMITS.forEach(({ round, seriesCount, bestOf }) => {
    const existingSeriesCount = roundSeriesCounts.get(round)?.size ?? 0;
    projectedPlayoffGames += Math.max(seriesCount - existingSeriesCount, 0) * bestOf;
  });

  const totalGames = regularSeasonGames + projectedPlayoffGames;
  const remainingGames = Math.max(totalGames - completedGames, 0);
  const progress = totalGames > 0 ? (completedGames / totalGames) * 100 : 0;

  return {
    completedGames,
    totalGames,
    remainingGames,
    progress,
  };
};

function App() {
  const [teams, setTeams] = useState<Team[]>(INITIAL_TEAMS);
  const [games, setGames] = useState<Game[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationProgress, setSimulationProgress] = useState<SimulationProgressUpdate | null>(null);
  const [progress, setProgress] = useState(0);
  const [seasonComplete, setSeasonComplete] = useState(false);
  const [view, setView] = useState<'dashboard' | 'games_schedule' | 'team_calendar' | 'league_standings' | 'leaders' | 'teams' | 'players' | 'playoffs' | 'gpb_book' | 'notifications' | 'settings' | 'game_screen'>('dashboard');
  const [standingsMode, setStandingsMode] = useState<'divisional' | 'league'>('divisional');
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SETTINGS);
  const [playerState, setPlayerState] = useState<LeaguePlayerState>(EMPTY_PLAYER_STATE);
  const [currentDate, setCurrentDate] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>(INITIAL_TEAMS[0]?.id ?? '');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [dataSource, setDataSource] = useState<'supabase' | 'local'>('local');
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isWipingPlayers, setIsWipingPlayers] = useState(false);
  const [isGeneratingPlayers, setIsGeneratingPlayers] = useState(false);
  const [playerGenerationPreview, setPlayerGenerationPreview] = useState<LeaguePlayerState | null>(null);
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

  const persistLeagueState = useCallback(async (
    nextTeams: Team[],
    nextSettings: SimulationSettings,
    nextGames: Game[],
    nextCurrentDate: string,
    nextProgress: number,
    nextSeasonComplete: boolean,
  ) => {
    saveLocalLeagueState(nextTeams, nextSettings, nextGames, nextCurrentDate, nextProgress, nextSeasonComplete);

    if (!isSupabaseConfigured) {
      return;
    }

    await saveSupabaseLeagueState(
      nextTeams,
      nextSettings,
      nextGames,
      nextCurrentDate,
      nextProgress,
      nextSeasonComplete,
    );
    setDataSource('supabase');
  }, []);

  // Load state on mount and seed Supabase if empty.
  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true);

      try {
        if (isSupabaseConfigured) {
          await seedSupabaseLeagueState(INITIAL_TEAMS, DEFAULT_SETTINGS);
          const hasSyncedTeamSource = localStorage.getItem(SUPABASE_TEAM_SOURCE_SYNC_KEY) === SUPABASE_TEAM_SOURCE_SYNC_VERSION;
          if (!hasSyncedTeamSource) {
            await replaceSupabaseTeamsFromSource(INITIAL_TEAMS);
            localStorage.setItem(SUPABASE_TEAM_SOURCE_SYNC_KEY, SUPABASE_TEAM_SOURCE_SYNC_VERSION);
          }
          const [remoteState, remotePlayerState] = await Promise.all([
            loadSupabaseLeagueState(),
            loadSupabasePlayerState(),
          ]);
          const validRemoteTeams = sanitizeTeams(remoteState.teams);
          const validRemoteSettings = isValidSettingsShape(remoteState.settings) ? remoteState.settings : null;
          const validRemoteGames = sanitizeGames(remoteState.games);

          setPlayerState(remotePlayerState);
          saveLocalPlayerState(remotePlayerState);

          if (validRemoteTeams) {
            setTeams(validRemoteTeams);
          }
          if (validRemoteSettings) {
            setSettings(validRemoteSettings);
          }
          if (validRemoteGames) {
            setGames(validRemoteGames);
            const remoteCurrentDate = remoteState.currentDate || validRemoteGames[0]?.date || '';
            setCurrentDate(remoteCurrentDate);
            setSelectedDate(remoteCurrentDate);
            setProgress(typeof remoteState.progress === 'number' ? remoteState.progress : getProgressFromGames(validRemoteGames));
            setSeasonComplete(typeof remoteState.seasonComplete === 'boolean' ? remoteState.seasonComplete : validRemoteGames.every((game) => game.status === 'completed'));
          }

          if (validRemoteTeams && validRemoteSettings) {
            saveLocalLeagueState(
              validRemoteTeams,
              validRemoteSettings,
              validRemoteGames ?? [],
              remoteState.currentDate || validRemoteGames?.[0]?.date || '',
              typeof remoteState.progress === 'number' ? remoteState.progress : getProgressFromGames(validRemoteGames ?? []),
              typeof remoteState.seasonComplete === 'boolean' ? remoteState.seasonComplete : (validRemoteGames ?? []).every((game) => game.status === 'completed'),
            );
          }

          setDataSource('supabase');
          return;
        }

        const localState = loadLocalLeagueState();
        const localPlayerState = loadLocalPlayerState();
        const validLocalTeams = sanitizeTeams(localState.teams);
        const validLocalSettings = isValidSettingsShape(localState.settings) ? localState.settings : null;
        const validLocalGames = sanitizeGames(localState.games);
        setPlayerState(localPlayerState);

        if (validLocalTeams) {
          setTeams(validLocalTeams);
        }
        if (validLocalSettings) {
          setSettings(validLocalSettings);
        }
        if (validLocalGames) {
          setGames(validLocalGames);
          const localCurrentDate = localState.currentDate || validLocalGames[0]?.date || '';
          setCurrentDate(localCurrentDate);
          setSelectedDate(localCurrentDate);
          setProgress(typeof localState.progress === 'number' ? localState.progress : getProgressFromGames(validLocalGames));
          setSeasonComplete(typeof localState.seasonComplete === 'boolean' ? localState.seasonComplete : validLocalGames.every((game) => game.status === 'completed'));
        }
        setDataSource('local');
      } catch (error) {
        console.error('Failed to load Supabase state, falling back to local storage:', error);
        const localState = loadLocalLeagueState();
        const localPlayerState = loadLocalPlayerState();
        const validLocalTeams = sanitizeTeams(localState.teams);
        const validLocalSettings = isValidSettingsShape(localState.settings) ? localState.settings : null;
        const validLocalGames = sanitizeGames(localState.games);
        setPlayerState(localPlayerState);

        if (validLocalTeams) {
          setTeams(validLocalTeams);
        }
        if (validLocalSettings) {
          setSettings(validLocalSettings);
        }
        if (validLocalGames) {
          setGames(validLocalGames);
          const localCurrentDate = localState.currentDate || validLocalGames[0]?.date || '';
          setCurrentDate(localCurrentDate);
          setSelectedDate(localCurrentDate);
          setProgress(typeof localState.progress === 'number' ? localState.progress : getProgressFromGames(validLocalGames));
          setSeasonComplete(typeof localState.seasonComplete === 'boolean' ? localState.seasonComplete : validLocalGames.every((game) => game.status === 'completed'));
        }
        setDataSource('local');
        pushNotice('Supabase sync failed. Using local storage fallback.', 'warning');
      } finally {
        setIsBootstrapping(false);
      }
    };

    void bootstrap();
  }, [getProgressFromGames, pushNotice]);

  // Initialize schedule on mount (or when teams change structure, but we handle that in save)
  useEffect(() => {
    if (!isBootstrapping && games.length === 0) {
      const schedule = createMasterSchedule(teams);
      const firstDate = schedule[0]?.date ?? getDefaultSeasonStartDate(new Date().getFullYear());
      setGames(schedule);
      setCurrentDate(firstDate);
      setSelectedDate(firstDate);
      setSeasonComplete(false);
      setProgress(0);

      void (async () => {
        try {
          await persistLeagueState(teams, settings, schedule, firstDate, 0, false);
        } catch (error) {
          console.error('Failed to persist initialized schedule:', error);
        }
      })();
    }
  }, [teams, settings, games.length, isBootstrapping, createMasterSchedule, persistLeagueState]);

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
    const nextPlayerState = resetPlayerSeasonStats(playerState, resolveSeasonYear(firstDate, schedule));

    setTeams(freshTeams);
    setGames(schedule);
    setPlayerState(nextPlayerState);
    setCurrentDate(firstDate);
    setSelectedDate(firstDate);
    setProgress(0);
    setSeasonComplete(false);
    saveLocalPlayerState(nextPlayerState);

      void (async () => {
        try {
          await persistLeagueState(freshTeams, settingsToUse, schedule, firstDate, 0, false);
          if (isSupabaseConfigured) {
            await saveSupabasePlayerState(nextPlayerState);
          }
        } catch (error) {
          console.error('Failed to persist reset season state:', error);
          pushNotice('Season reset locally, but Supabase sync failed.', 'warning');
        }
      })();
  }, [teams, settings, playerState, buildFreshSeasonTeams, createMasterSchedule, persistLeagueState, pushNotice]);

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

  const handleHardWipePlayers = useCallback(async () => {
    setIsWipingPlayers(true);

    try {
      clearLocalPlayerState();
      setPlayerState(EMPTY_PLAYER_STATE);

      if (isSupabaseConfigured) {
        const deletedPlayers = await clearSupabasePlayerState();
        pushNotice(
          deletedPlayers > 0
            ? `Hard-wiped ${deletedPlayers} players from Supabase.`
            : 'No player rows were found in Supabase.',
          'success',
        );
        setDataSource('supabase');
      } else {
        pushNotice('Supabase is not configured. Cleared local player data only.', 'warning');
      }
    } catch (error) {
      console.error('Failed to hard-wipe player data:', error);
      pushNotice('Failed to hard-wipe player data.', 'error');
    } finally {
      setIsWipingPlayers(false);
    }
  }, [pushNotice]);

  const handlePreviewGeneratePlayers = useCallback(() => {
    const seasonYear = resolveSeasonYear(currentDate, games);
    const generatedPlayerState = generatePlayerPool(teams, seasonYear);
    setPlayerGenerationPreview(generatedPlayerState);
  }, [currentDate, games, teams]);

  const handleDismissPlayerPreview = useCallback(() => {
    setPlayerGenerationPreview(null);
  }, []);

  const handleGeneratePlayers = useCallback(async () => {
    setIsGeneratingPlayers(true);

    try {
      const generatedPlayerState = playerGenerationPreview ?? generatePlayerPool(teams, resolveSeasonYear(currentDate, games));

      clearLocalPlayerState();
      saveLocalPlayerState(generatedPlayerState);
      setPlayerState(generatedPlayerState);

      if (isSupabaseConfigured) {
        await clearSupabasePlayerState();
        await saveSupabasePlayerState(generatedPlayerState);
        setDataSource('supabase');
        pushNotice(`Generated ${generatedPlayerState.players.length} players and uploaded them to Supabase.`, 'success');
      } else {
        pushNotice(`Generated ${generatedPlayerState.players.length} players locally. Supabase is not configured.`, 'warning');
      }

      setPlayerGenerationPreview(null);
    } catch (error) {
      console.error('Failed to generate player data:', error);
      pushNotice('Failed to generate player data.', 'error');
    } finally {
      setIsGeneratingPlayers(false);
    }
  }, [currentDate, games, playerGenerationPreview, pushNotice, teams]);

  const runSimulationTarget = useCallback((target: SimulationTarget) => {
    if (isSimulating || games.length === 0) {
      return;
    }

    setIsSimulating(true);
    setSimulationProgress({
      label:
        target.scope === 'day'
          ? 'Simulating day'
          : target.scope === 'week'
            ? 'Simulating week'
            : target.scope === 'month'
              ? 'Simulating month'
              : target.scope === 'regular_season'
                ? 'Simulating regular season'
                : target.scope === 'season'
                  ? 'Simulating full season'
                  : target.scope === 'next_game'
                    ? 'Simulating next team game'
                    : 'Simulating selected range',
      completedGames: 0,
      totalGames: 0,
      currentDate: currentDate || games[0]?.date || '',
    });

    requestAnimationFrame(async () => {
      const manager = new SimulationManager({
        teams,
        games,
        playerState,
        settings,
        currentDate: currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear()),
      });

      try {
        const result = await manager.run(target, (update) => {
          setSimulationProgress(update);
        });
        const complete = result.games.every((game) => game.status === 'completed');
        const finalizedTeams = complete
          ? result.teams.map((team) => ({ ...team, previousBaselineWins: team.wins }))
          : result.teams;

        setTeams(finalizedTeams);
        setGames(result.games);
        setPlayerState(result.playerState);
        setCurrentDate(result.currentDate);
        setSelectedDate(result.currentDate);
        setProgress(getProgressFromGames(result.games));
        setSeasonComplete(complete);
        saveLocalPlayerState(result.playerState);

        try {
          await persistLeagueState(
            finalizedTeams,
            settings,
            result.games,
            result.currentDate,
            getProgressFromGames(result.games),
            complete,
          );

          if (isSupabaseConfigured) {
            await saveSupabasePlayerState(result.playerState);
          }

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
      } finally {
        setIsSimulating(false);
        setSimulationProgress(null);
      }
    });
  }, [isSimulating, games, teams, playerState, settings, currentDate, getProgressFromGames, persistLeagueState, pushNotice]);

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

  const simulateToDate = useCallback((targetDate: string) => {
    if (!targetDate) {
      return;
    }

    setSelectedDate(targetDate);
    runSimulationTarget({ scope: 'to_date', targetDate });
  }, [runSimulationTarget]);

  const handleTradeProposal = useCallback(async (
    trade: { fromTeamId: string; toTeamId: string; fromPlayerId: string; toPlayerId: string },
  ) => {
    if (
      !trade.fromTeamId ||
      !trade.toTeamId ||
      !trade.fromPlayerId ||
      !trade.toPlayerId ||
      trade.fromTeamId === trade.toTeamId ||
      trade.fromPlayerId === trade.toPlayerId
    ) {
      pushNotice('Select two different teams and two different players for a trade.', 'warning');
      return;
    }

    const fromPlayer = playerState.players.find((player) => player.playerId === trade.fromPlayerId) ?? null;
    const toPlayer = playerState.players.find((player) => player.playerId === trade.toPlayerId) ?? null;
    if (!fromPlayer || !toPlayer) {
      pushNotice('Trade proposal could not find both selected players.', 'error');
      return;
    }

    const effectiveDate = currentDate || selectedDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
    const nextPlayers = playerState.players.map((player) => {
      if (player.playerId === trade.fromPlayerId) {
        return { ...player, teamId: trade.toTeamId, status: 'active' as const };
      }
      if (player.playerId === trade.toPlayerId) {
        return { ...player, teamId: trade.fromTeamId, status: 'active' as const };
      }
      return { ...player };
    });

    const nextRosterSlots = playerState.rosterSlots.map((slot) => {
      if (slot.playerId === trade.fromPlayerId) {
        return { ...slot, playerId: trade.toPlayerId };
      }
      if (slot.playerId === trade.toPlayerId) {
        return { ...slot, playerId: trade.fromPlayerId };
      }
      return { ...slot };
    });

    const nextPlayerState: LeaguePlayerState = {
      ...playerState,
      players: nextPlayers,
      battingStats: playerState.battingStats.map((stat) => ({ ...stat })),
      pitchingStats: playerState.pitchingStats.map((stat) => ({ ...stat })),
      battingRatings: playerState.battingRatings.map((rating) => ({ ...rating })),
      pitchingRatings: playerState.pitchingRatings.map((rating) => ({ ...rating })),
      rosterSlots: nextRosterSlots,
      transactions: [
        {
          playerId: trade.fromPlayerId,
          eventType: 'traded',
          fromTeamId: trade.fromTeamId,
          toTeamId: trade.toTeamId,
          effectiveDate,
          notes: `Swap return: ${toPlayer.firstName} ${toPlayer.lastName}`,
        },
        {
          playerId: trade.toPlayerId,
          eventType: 'traded',
          fromTeamId: trade.toTeamId,
          toTeamId: trade.fromTeamId,
          effectiveDate,
          notes: `Swap return: ${fromPlayer.firstName} ${fromPlayer.lastName}`,
        },
        ...playerState.transactions.map((transaction) => ({ ...transaction })),
      ],
    };

    setPlayerState(nextPlayerState);
    saveLocalPlayerState(nextPlayerState);

    try {
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }
      pushNotice(
        `Trade approved: ${fromPlayer.firstName} ${fromPlayer.lastName} for ${toPlayer.firstName} ${toPlayer.lastName}.`,
        'success',
      );
    } catch (error) {
      console.error('Failed to persist trade proposal:', error);
      pushNotice('Trade completed locally, but syncing player data failed.', 'warning');
    }
  }, [currentDate, games, playerState, pushNotice, selectedDate]);

  const applyCompletedGameResults = useCallback(async (completedResults: CompletedGameResult[]) => {
    if (completedResults.length === 0) {
      return;
    }

    const orderedResults = [...completedResults].sort((left, right) =>
      left.game.date === right.game.date
        ? left.game.gameId.localeCompare(right.game.gameId)
        : left.game.date.localeCompare(right.game.date),
    );
    const nextTeamsMap = new Map<string, Team>(teams.map((team) => [team.id, { ...team }]));
    const nextGamesMap = new Map<string, Game>(
      games.map((game) => [
        game.gameId,
        {
          ...game,
          score: { ...game.score },
          stats: { ...game.stats },
          playoff: game.playoff ? { ...game.playoff } : null,
        },
      ]),
    );
    let nextPlayerState = playerState;

    orderedResults.forEach((resolvedResult) => {
      const resolvedGame = resolvedResult.game;
      const existing = nextGamesMap.get(resolvedGame.gameId);
      if (!existing) {
        return;
      }

      if (existing.status !== 'completed' && isRegularSeasonGame(existing)) {
        const homeTeam = nextTeamsMap.get(existing.homeTeam);
        const awayTeam = nextTeamsMap.get(existing.awayTeam);
        if (homeTeam && awayTeam) {
          homeTeam.runsScored += resolvedGame.score.home;
          homeTeam.runsAllowed += resolvedGame.score.away;
          awayTeam.runsScored += resolvedGame.score.away;
          awayTeam.runsAllowed += resolvedGame.score.home;

          if (resolvedGame.score.home > resolvedGame.score.away) {
            homeTeam.wins += 1;
            awayTeam.losses += 1;
          } else {
            awayTeam.wins += 1;
            homeTeam.losses += 1;
          }
        }
      }

      nextGamesMap.set(resolvedGame.gameId, {
        ...resolvedGame,
        score: { ...resolvedGame.score },
        stats: { ...resolvedGame.stats },
        playoff: resolvedGame.playoff ? { ...resolvedGame.playoff } : null,
      });

      nextPlayerState = applyPlayerGameStatDelta(
        nextPlayerState,
        resolvedResult.playerStatDelta,
        resolveSeasonYear(resolvedGame.date, games),
        resolvedGame.phase,
      );
    });

    const nextGames = Array.from(nextGamesMap.values()).sort((a, b) => (a.date === b.date ? a.gameId.localeCompare(b.gameId) : a.date.localeCompare(b.date)));
    const nextSeasonComplete = nextGames.every((game) => game.status === 'completed');
    const nextTeams = Array.from(nextTeamsMap.values()).map((team) =>
      nextSeasonComplete ? { ...team, previousBaselineWins: team.wins } : team,
    );
    const latestCompletedDate = orderedResults[orderedResults.length - 1]?.game.date ?? currentDate;
    const nextCurrentDate = latestCompletedDate > currentDate ? latestCompletedDate : currentDate;
    const nextProgress = getProgressFromGames(nextGames);

    setTeams(nextTeams);
    setGames(nextGames);
    setPlayerState(nextPlayerState);
    setCurrentDate(nextCurrentDate);
    setSelectedDate(orderedResults[orderedResults.length - 1]?.game.date ?? selectedDate);
    setProgress(nextProgress);
    setSeasonComplete(nextSeasonComplete);
    saveLocalPlayerState(nextPlayerState);

    try {
      await persistLeagueState(nextTeams, settings, nextGames, nextCurrentDate, nextProgress, nextSeasonComplete);
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }
    } catch (error) {
      console.error('Failed to persist interactive game results:', error);
      pushNotice('Game simulation completed, but saving failed.', 'warning');
      return;
    }

    pushNotice(
      orderedResults.length === 1
        ? `Simulated ${orderedResults[0].game.awayTeam.toUpperCase()} @ ${orderedResults[0].game.homeTeam.toUpperCase()}.`
        : `Simulated ${orderedResults.length} earlier games and updated the slate.`,
      'info',
    );
  }, [teams, games, playerState, currentDate, selectedDate, getProgressFromGames, persistLeagueState, settings, pushNotice]);

  const openGameScreen = useCallback((gameId: string) => {
    const targetGame = games.find((game) => game.gameId === gameId);
    if (!targetGame) {
      return;
    }

    setSelectedGameId(gameId);
    setSelectedDate(targetGame.date);
    setView('game_screen');
  }, [games]);

  const openRandomTeamPage = useCallback(() => {
    if (teams.length === 0) {
      setView('teams');
      return;
    }

    const eligibleTeams = teams.length > 1 ? teams.filter((team) => team.id !== selectedTeamId) : teams;
    const randomIndex = Math.floor(Math.random() * eligibleTeams.length);
    const nextTeam = eligibleTeams[randomIndex] ?? teams[0];
    setSelectedTeamId(nextTeam.id);
    setView('teams');
  }, [teams, selectedTeamId]);

  const openTeamPage = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
    setView('teams');
  }, []);

  const getDivisionTeams = (league: string, division: string) => {
    return teams.filter(t => t.league === league && t.division === division);
  };

  const getLeagueTeams = (league: string) => {
    return teams.filter(t => t.league === league);
  };

  const activeDate = selectedDate || games[0]?.date || currentDate;
  const currentTimelineDate = currentDate || activeDate;
  const allScheduleDates = useMemo(
    () => Array.from(new Set<string>(games.map((game) => game.date))).sort((a, b) => a.localeCompare(b)),
    [games],
  );
  const bannerDate = useMemo(() => {
    const timelineDate = currentTimelineDate;
    if (!timelineDate || allScheduleDates.length === 0) {
      return '';
    }

    const currentIndex = allScheduleDates.indexOf(timelineDate);
    if (currentIndex <= 0) {
      return timelineDate;
    }

    return allScheduleDates[currentIndex - 1];
  }, [allScheduleDates, currentTimelineDate]);

  const gamesForBannerDate = useMemo(
    () =>
      games
        .filter((game) => game.date === bannerDate)
        .sort((a, b) => (a.status === b.status ? a.gameId.localeCompare(b.gameId) : a.status === 'completed' ? -1 : 1)),
    [games, bannerDate],
  );

  const gamesForActiveDate = useMemo(
    () =>
      games
        .filter((game) => game.date === activeDate)
        .sort((a, b) => (a.status === b.status ? a.gameId.localeCompare(b.gameId) : a.status === 'completed' ? -1 : 1)),
    [games, activeDate],
  );
  const seasonProgressSummary = useMemo(() => getProjectedSeasonSummary(games), [games]);
  const calendarSummaryByDate = useMemo(() => {
    const summary = new Map<string, { total: number; completed: number; scheduled: number; playoff: number }>();
    games.forEach((game) => {
      const current = summary.get(game.date) ?? { total: 0, completed: 0, scheduled: 0, playoff: 0 };
      current.total += 1;
      if (game.status === 'completed') {
        current.completed += 1;
      } else {
        current.scheduled += 1;
      }
      if (isPlayoffGame(game)) {
        current.playoff += 1;
      }
      summary.set(game.date, current);
    });
    return summary;
  }, [games]);
  const lastRegularSeasonDate = useMemo(() => {
    const regularSeasonDates = games
      .filter(isRegularSeasonGame)
      .map((game) => game.date)
      .sort((left, right) => left.localeCompare(right));
    return regularSeasonDates[regularSeasonDates.length - 1] ?? '';
  }, [games]);

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

  const hashKey = useCallback((input: string): number => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) % 2147483647;
    }
    return hash;
  }, []);

  const getFallbackHits = useCallback((game: Game, side: 'away' | 'home'): number => {
    const runs = side === 'away' ? game.score.away : game.score.home;
    return runs + 3 + (hashKey(`${game.gameId}:${side}:h`) % 5);
  }, [hashKey]);

  const buildBroadcastSummary = useCallback((game: Game) => {
    const awayTeam = teamLookup.get(game.awayTeam);
    const homeTeam = teamLookup.get(game.homeTeam);
    const awayHitsRaw = getStatNumber(game, 'awayHits');
    const homeHitsRaw = getStatNumber(game, 'homeHits');
    const awayHits = awayHitsRaw > 0 ? awayHitsRaw : getFallbackHits(game, 'away');
    const homeHits = homeHitsRaw > 0 ? homeHitsRaw : getFallbackHits(game, 'home');
    const awayWon = game.score.away > game.score.home;
    const winnerTeam = awayWon ? awayTeam : homeTeam;
    const loserTeam = awayWon ? homeTeam : awayTeam;
    const winnerName = winnerTeam?.name ?? (awayWon ? game.awayTeam.toUpperCase() : game.homeTeam.toUpperCase());
    const winnerCity = winnerTeam?.city ?? (awayWon ? game.awayTeam.toUpperCase() : game.homeTeam.toUpperCase());
    const loserName = loserTeam?.name ?? (awayWon ? game.homeTeam.toUpperCase() : game.awayTeam.toUpperCase());
    const loserCity = loserTeam?.city ?? (awayWon ? game.homeTeam.toUpperCase() : game.awayTeam.toUpperCase());
    const winnerRuns = awayWon ? game.score.away : game.score.home;
    const loserRuns = awayWon ? game.score.home : game.score.away;
    const loserHits = awayWon ? homeHits : awayHits;
    const margin = Math.abs(game.score.away - game.score.home);
    const totalRuns = game.score.away + game.score.home;
    const totalHits = awayHits + homeHits;
    const winnerLeague = winnerTeam?.league ?? null;
    const loserLeague = loserTeam?.league ?? null;
    const homeVenue = homeTeam?.city ?? game.homeTeam.toUpperCase();
    const styleSeed = hashKey(`${game.gameId}:broadcast`) % 3;

    const winnerPrimary = styleSeed === 0 ? winnerName : winnerCity;
    const loserPrimary = styleSeed === 1 ? loserCity : loserName;

    if (loserRuns === 0 && loserHits <= 1) {
      return `${winnerPrimary} put ${loserPrimary} in total silence with a ${winnerRuns}-${loserRuns} masterpiece in ${homeVenue}.`;
    }

    if (loserRuns === 0) {
      return `${winnerPrimary} deliver a baseball masterclass, blanking ${loserPrimary} ${winnerRuns}-${loserRuns} in ${homeVenue}.`;
    }

    if (totalRuns <= 2) {
      return `${winnerPrimary} outlast ${loserPrimary} ${winnerRuns}-${loserRuns} in a pure pitching duel at ${homeVenue}.`;
    }

    if (margin >= 10) {
      return `${winnerPrimary} turn ${homeVenue} into a demolition derby, crushing ${loserPrimary} ${winnerRuns}-${loserRuns}.`;
    }

    if (winnerRuns >= 15) {
      return `${winnerPrimary} light up the scoreboard for ${winnerRuns} runs, leaving ${loserPrimary} chasing shadows in ${homeVenue}.`;
    }

    if (winnerRuns >= 8 && loserRuns >= 8) {
      return `${winnerPrimary} survive a full barnburner, beating ${loserPrimary} ${winnerRuns}-${loserRuns} after an all-night slugfest.`;
    }

    if (totalHits >= 25) {
      return `${winnerPrimary} win the track meet ${winnerRuns}-${loserRuns} as the bats stay loud all night against ${loserPrimary}.`;
    }

    if (margin === 1) {
      return `${winnerPrimary} sneak past ${loserPrimary} ${winnerRuns}-${loserRuns} in a one-run finish at ${homeVenue}.`;
    }

    if (winnerLeague && loserLeague && winnerLeague !== loserLeague) {
      return `${winnerPrimary} claim interleague bragging rights with a ${winnerRuns}-${loserRuns} result over ${loserPrimary}.`;
    }

    if (game.playoff) {
      return `${winnerPrimary} take a playoff step forward, handling ${loserPrimary} ${winnerRuns}-${loserRuns} in the ${game.playoff.seriesLabel}.`;
    }

    if (margin >= 5) {
      return `${winnerPrimary} make a statement in ${homeVenue}, taking down ${loserPrimary} ${winnerRuns}-${loserRuns}.`;
    }

    return `${winnerPrimary} defeat ${loserPrimary} ${winnerRuns}-${loserRuns} in ${homeVenue}.`;
  }, [getFallbackHits, teamLookup]);

  const activeDateHasPlayoffs = useMemo(() => gamesForActiveDate.some((game) => isPlayoffGame(game)), [gamesForActiveDate]);
  const currentTimelineTimeLabel = useMemo(
    () => getCurrentSimTimeLabel(games, currentTimelineDate),
    [games, currentTimelineDate],
  );
  const broadcastFlairDate = useMemo(() => {
    if (!currentTimelineDate || allScheduleDates.length === 0) {
      return '';
    }

    const todaysCompleted = games.some((game) => game.date === currentTimelineDate && game.status === 'completed');
    if (todaysCompleted) {
      return currentTimelineDate;
    }

    const currentIndex = allScheduleDates.indexOf(currentTimelineDate);
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidateDate = allScheduleDates[index];
      if (games.some((game) => game.date === candidateDate && game.status === 'completed')) {
        return candidateDate;
      }
    }

    return currentTimelineDate;
  }, [allScheduleDates, currentTimelineDate, games]);
  const flairGames = useMemo(
    () =>
      games
        .filter((game) => game.date === broadcastFlairDate && game.status === 'completed')
        .sort((a, b) => a.gameId.localeCompare(b.gameId)),
    [broadcastFlairDate, games],
  );
  const flairLabel = broadcastFlairDate === currentTimelineDate ? 'Today' : 'Yesterday';
  const flairSummaries = useMemo(
    () => flairGames.map((game) => ({ gameId: game.gameId, summary: buildBroadcastSummary(game) })),
    [buildBroadcastSummary, flairGames],
  );
  const flairSignature = useMemo(
    () => flairSummaries.map((item) => `${item.gameId}:${item.summary}`).join('|'),
    [flairSummaries],
  );
  const [flairIndex, setFlairIndex] = useState(0);
  const [isFlairVisible, setIsFlairVisible] = useState(true);
  const activeFlairItem = flairSummaries[flairIndex] ?? null;
  const shouldMarqueeFlair = (activeFlairItem?.summary.length ?? 0) > 92;
  const broadcastHighlightTokens = useMemo(
    () =>
      Array.from(
        new Set<string>(
          teams.flatMap((team) => [team.name, team.city]).filter((value) => value && value.trim().length > 0),
        ),
      ).sort((left, right) => right.length - left.length),
    [teams],
  );

  const renderBroadcastText = useCallback((summary: string) => {
    const escapedTokens = broadcastHighlightTokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean);

    if (escapedTokens.length === 0) {
      return summary;
    }

    const pattern = new RegExp(`(${escapedTokens.join('|')})`, 'g');
    return summary.split(pattern).filter(Boolean).map((part, index) => {
      const isHighlight = broadcastHighlightTokens.includes(part);
      return (
        <span key={`${part}-${index}`} className={isHighlight ? 'font-semibold text-white' : undefined}>
          {part}
        </span>
      );
    });
  }, [broadcastHighlightTokens]);

  useEffect(() => {
    setFlairIndex(0);
    setIsFlairVisible(true);
  }, [flairSignature]);

  useEffect(() => {
    if (flairSummaries.length <= 1) {
      return;
    }

    const holdTimer = window.setTimeout(() => {
      setIsFlairVisible(false);
    }, 7000);

    const swapTimer = window.setTimeout(() => {
      setFlairIndex((previous) => (previous + 1) % flairSummaries.length);
      setIsFlairVisible(true);
    }, 7450);

    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(swapTimer);
    };
  }, [flairIndex, flairSummaries]);
  const selectedGame = useMemo(
    () => (selectedGameId ? games.find((game) => game.gameId === selectedGameId) ?? null : null),
    [games, selectedGameId],
  );
  const blockingGamesForSelected = useMemo(() => {
    if (!selectedGame || selectedGame.status === 'completed') {
      return [];
    }

    return games
      .filter((game) => game.date === selectedGame.date && game.status === 'scheduled' && game.gameId.localeCompare(selectedGame.gameId) < 0)
      .sort((a, b) => a.gameId.localeCompare(b.gameId));
  }, [games, selectedGame]);

  const simulateBlockingGamesForSelected = useCallback(async () => {
    if (!selectedGame || blockingGamesForSelected.length === 0) {
      return;
    }

    const teamMap = new Map<string, Team>(teams.map((team) => [team.id, team]));
    const resolvedGames = blockingGamesForSelected
      .map((blockingGame: Game) => {
        const awayTeam = teamMap.get(blockingGame.awayTeam);
        const homeTeam = teamMap.get(blockingGame.homeTeam);
        if (!awayTeam || !homeTeam) {
          return null;
        }

        const participants = buildGameParticipants(blockingGame, games, playerState);
        const session = simulateGameToFinal(createGameSession(blockingGame, participants), awayTeam, homeTeam, settings);
        return buildCompletedGameFromSession(blockingGame, session);
      })
      .filter((game): game is CompletedGameResult => Boolean(game));

    await applyCompletedGameResults(resolvedGames);
  }, [selectedGame, blockingGamesForSelected, teams, games, playerState, settings, applyCompletedGameResults]);

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
    <div className="min-h-screen bg-[#141414] text-white font-sans selection:bg-white/20 relative overflow-x-hidden pb-20">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-40 -left-24 w-[420px] h-[420px] rounded-full bg-prestige/15 blur-3xl" />
        <div className="absolute top-[28%] -right-20 w-[360px] h-[360px] rounded-full bg-platinum/15 blur-3xl" />
        <div className="absolute bottom-0 left-[32%] w-[520px] h-[240px] bg-gradient-to-r from-transparent via-white/5 to-transparent blur-2xl" />
      </div>

      <div className="sticky top-0 z-50">
        <div className="border-b border-white/10 bg-[#111111]/96 backdrop-blur">
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
                        onClick={() => openGameScreen(game.gameId)}
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
        </div>

        <header className="bg-[#151515]/95 backdrop-blur border-b border-white/10">
          <div className="px-4 sm:px-6 lg:px-8 h-[88px] flex items-center justify-between">
            <button className="flex items-center gap-3" onClick={() => setView('dashboard')}>
              <img src={gpbLogo} alt="GPB home" className="h-[68px] w-[68px] object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]" />
              <span className="font-logo text-3xl sm:text-4xl uppercase leading-none tracking-[0.06em] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                My League
              </span>
            </button>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
                <Activity className="w-4 h-4 text-prestige" />
                <span className="font-mono">{formatHeaderDate(currentTimelineDate)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
                <Clock3 className="w-4 h-4 text-platinum" />
                <span className="font-mono">{currentTimelineTimeLabel}</span>
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
      </div>

      <div className="relative z-10 flex">
        <aside className="hidden lg:block w-64 border-r border-white/10 bg-[#161616]/80 backdrop-blur sticky top-[136px] h-[calc(100vh-136px)]">
          <div className="p-4 space-y-2">
            <button
              onClick={() => setView('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'dashboard' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <LayoutDashboard className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Home</span>
            </button>
            <button
              onClick={() => setView('games_schedule')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'games_schedule' ? 'bg-prestige text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <CalendarDays className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Scores</span>
            </button>
            <button
              onClick={() => setView('team_calendar')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'team_calendar' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <CalendarRange className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Calendar</span>
            </button>
            <button
              onClick={() => setView('league_standings')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'league_standings' ? 'bg-platinum text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Table2 className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Standings</span>
            </button>
            <button
              onClick={() => setView('leaders')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'leaders' ? 'bg-[#d4bb6a] text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <BarChart3 className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Leaders</span>
            </button>
            <button
              onClick={openRandomTeamPage}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'teams' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Users className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Teams</span>
            </button>
            <button
              onClick={() => setView('playoffs')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'playoffs' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <Trophy className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Playoffs</span>
            </button>
            <button
              onClick={() => setView('players')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'players' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <UserRound className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">Rosters</span>
            </button>
            <button
              onClick={() => setView('gpb_book')}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors ${view === 'gpb_book' ? 'bg-white text-black' : 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]'}`}
            >
              <BookOpen className="w-5 h-5" />
              <span className="font-display text-lg uppercase tracking-wide">GPB Engine</span>
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
            <button onClick={() => setView('dashboard')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'dashboard' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Home</button>
            <button onClick={() => setView('games_schedule')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'games_schedule' ? 'bg-prestige text-black' : 'bg-[#202020] text-zinc-300'}`}>Scores</button>
            <button onClick={() => setView('team_calendar')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'team_calendar' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Calendar</button>
            <button onClick={() => setView('league_standings')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'league_standings' ? 'bg-platinum text-black' : 'bg-[#202020] text-zinc-300'}`}>Standings</button>
            <button onClick={() => setView('leaders')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'leaders' ? 'bg-[#d4bb6a] text-black' : 'bg-[#202020] text-zinc-300'}`}>Leaders</button>
            <button onClick={openRandomTeamPage} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'teams' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Teams</button>
            <button onClick={() => setView('playoffs')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'playoffs' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Playoffs</button>
            <button onClick={() => setView('players')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'players' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Rosters</button>
            <button onClick={() => setView('gpb_book')} className={`px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide ${view === 'gpb_book' ? 'bg-white text-black' : 'bg-[#202020] text-zinc-300'}`}>Engine</button>
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
                              onChange={(event) => setSelectedDate(event.target.value)}
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
                                onClick={() => setSelectedDate(date)}
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
                              onClick={() => openGameScreen(game.gameId)}
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
              )}

              {view === 'dashboard' && (
                <HomeDashboard
                  teams={teams}
                  games={games}
                  players={playerState.players}
                  battingStats={playerState.battingStats}
                  battingRatings={playerState.battingRatings}
                  pitchingRatings={playerState.pitchingRatings}
                  transactions={playerState.transactions}
                  currentDate={currentDate}
                  selectedDate={selectedDate}
                  selectedTeamId={selectedTeamId}
                  isSimulating={isSimulating}
                  onSelectDate={setSelectedDate}
                  onSelectTeamId={setSelectedTeamId}
                  onOpenGame={openGameScreen}
                  onOpenTeams={() => setView('teams')}
                  onOpenPlayers={() => setView('players')}
                  onOpenStandings={() => setView('league_standings')}
                  onSimulateToSelectedDate={simulateToSelectedDate}
                  onSimulateToEndOfRegularSeason={simulateToEndOfRegularSeason}
                  onSimulateDay={simulateDay}
                  onSimulateWeek={simulateWeek}
                  onSimulateMonth={simulateMonth}
                  onSimulateNextGame={simulateNextTeamGame}
                  onQuickSimSeason={quickSimSeason}
                  onResetSeason={() => resetSeason()}
                  onSimulateToDate={simulateToDate}
                  onProposeTrade={handleTradeProposal}
                />
              )}

              {view === 'team_calendar' && (
                <TeamCalendar
                  teams={teams}
                  games={games}
                  currentDate={currentDate}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onOpenGame={openGameScreen}
                />
              )}

              {view === 'teams' && (
                <TeamsHub
                  teams={teams}
                  games={games}
                  players={playerState.players}
                  battingRatings={playerState.battingRatings}
                  pitchingRatings={playerState.pitchingRatings}
                  battingStats={playerState.battingStats}
                  pitchingStats={playerState.pitchingStats}
                  rosterSlots={playerState.rosterSlots}
                  currentDate={currentDate}
                  selectedTeamId={selectedTeamId}
                  onSelectTeamId={setSelectedTeamId}
                  onOpenGame={openGameScreen}
                />
              )}

              {view === 'players' && (
                <PlayersHub
                  teams={teams}
                  players={playerState.players}
                  battingRatings={playerState.battingRatings}
                  pitchingRatings={playerState.pitchingRatings}
                  battingStats={playerState.battingStats}
                  pitchingStats={playerState.pitchingStats}
                  rosterSlots={playerState.rosterSlots}
                />
              )}

              {view === 'game_screen' && selectedGame && (
                <GameScreen
                  game={selectedGame}
                  games={games}
                  teams={teams}
                  playerState={playerState}
                  settings={settings}
                  currentDate={currentDate}
                  blockingGames={blockingGamesForSelected}
                  onBack={() => setView('dashboard')}
                  onSimulateBlockingGames={simulateBlockingGamesForSelected}
                  onCompleteGame={(completedResult) => {
                    void applyCompletedGameResults([completedResult]);
                  }}
                />
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
                          <StandingsTable divisionName="North" teams={getDivisionTeams('Prestige', 'North')} headerColor="text-prestige" onSelectTeam={openTeamPage} />
                          <StandingsTable divisionName="South" teams={getDivisionTeams('Prestige', 'South')} headerColor="text-prestige" onSelectTeam={openTeamPage} />
                          <StandingsTable divisionName="East" teams={getDivisionTeams('Prestige', 'East')} headerColor="text-prestige" onSelectTeam={openTeamPage} />
                          <StandingsTable divisionName="West" teams={getDivisionTeams('Prestige', 'West')} headerColor="text-prestige" onSelectTeam={openTeamPage} />
                        </div>
                        <div className="space-y-6">
                          <div className="flex items-center gap-3 mb-2">
                            <h2 className="font-display text-2xl uppercase text-platinum tracking-widest">Platinum</h2>
                            <div className="h-px flex-1 bg-gradient-to-r from-platinum/60 to-transparent" />
                          </div>
                          <StandingsTable divisionName="North" teams={getDivisionTeams('Platinum', 'North')} headerColor="text-platinum" onSelectTeam={openTeamPage} />
                          <StandingsTable divisionName="South" teams={getDivisionTeams('Platinum', 'South')} headerColor="text-platinum" onSelectTeam={openTeamPage} />
                          <StandingsTable divisionName="East" teams={getDivisionTeams('Platinum', 'East')} headerColor="text-platinum" onSelectTeam={openTeamPage} />
                          <StandingsTable divisionName="West" teams={getDivisionTeams('Platinum', 'West')} headerColor="text-platinum" onSelectTeam={openTeamPage} />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <LeagueTable leagueName="Prestige League" teams={getLeagueTeams('Prestige')} headerColor="text-prestige" onSelectTeam={openTeamPage} />
                        <LeagueTable leagueName="Platinum League" teams={getLeagueTeams('Platinum')} headerColor="text-platinum" onSelectTeam={openTeamPage} />
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

              {view === 'leaders' && (
                <LeadersHub
                  teams={teams}
                  players={playerState.players}
                  battingStats={playerState.battingStats}
                  pitchingStats={playerState.pitchingStats}
                  battingRatings={playerState.battingRatings}
                  pitchingRatings={playerState.pitchingRatings}
                />
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
                  onPreviewGeneratePlayers={handlePreviewGeneratePlayers}
                  onGeneratePlayers={handleGeneratePlayers}
                  onHardWipePlayers={handleHardWipePlayers}
                  onDismissPlayerPreview={handleDismissPlayerPreview}
                  playerGenerationPreview={playerGenerationPreview}
                  isClearingHistoricalData={isClearingHistory}
                  isGeneratingPlayers={isGeneratingPlayers}
                  isWipingPlayers={isWipingPlayers}
                  isSupabaseEnabled={isSupabaseConfigured}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AnimatePresence>
        {isSimulating && simulationProgress && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/72 px-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-xl rounded-[2rem] border border-[#d4bb6a]/20 bg-[linear-gradient(135deg,#121212,#1b1b1b,#101010)] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.52)]"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Simulation</p>
                  <p className="mt-2 font-headline text-4xl uppercase tracking-[0.08em] text-white">{simulationProgress.label}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Active date</p>
                  <p className="mt-1 font-mono text-sm uppercase tracking-[0.12em] text-zinc-100">
                    {simulationProgress.currentDate || currentDate || 'TBD'}
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
                <div className="flex items-center justify-between gap-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Progress</p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                    {simulationProgress.totalGames > 0
                      ? `${simulationProgress.completedGames} / ${simulationProgress.totalGames} games`
                      : `${simulationProgress.completedGames} games`}
                  </p>
                </div>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#d4bb6a,#efe2ab,#37d6be)] transition-[width] duration-300"
                    style={{
                      width: `${
                        simulationProgress.totalGames > 0
                          ? Math.max(6, Math.min(100, (simulationProgress.completedGames / simulationProgress.totalGames) * 100))
                          : 12
                      }%`,
                    }}
                  />
                </div>
                <p className="mt-4 text-sm leading-6 text-zinc-400">
                  Each scheduled game is being resolved through the player-driven simulation engine and season stats are being updated game by game.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0f0f0f]/95 backdrop-blur">
        <div className="flex items-center gap-4 px-4 sm:px-6 lg:px-8 py-3">
          <div className="hidden md:flex min-w-[132px] items-center gap-3 border-r border-white/10 pr-4">
            <div className="h-2 w-2 rounded-full bg-prestige" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{flairLabel}</p>
              <p className="font-mono text-xs text-zinc-200">
                {broadcastFlairDate ? formatHeaderDate(broadcastFlairDate) : 'No Results'}
              </p>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            {activeFlairItem ? (
              <button
                key={`flair-active-${activeFlairItem.gameId}-${flairIndex}`}
                onClick={() => openGameScreen(activeFlairItem.gameId)}
                className={`block w-full overflow-hidden text-left transition-opacity duration-300 ${
                  isFlairVisible ? 'opacity-100' : 'opacity-0'
                }`}
              >
                {shouldMarqueeFlair ? (
                  <div className="broadcast-marquee">
                    <div className="broadcast-marquee__track">
                      <span className="text-base md:text-lg text-zinc-100">{renderBroadcastText(activeFlairItem.summary)}</span>
                      <span className="broadcast-marquee__gap" aria-hidden="true">|</span>
                      <span className="text-base md:text-lg text-zinc-100" aria-hidden="true">{renderBroadcastText(activeFlairItem.summary)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-base md:text-lg text-zinc-100 truncate">{renderBroadcastText(activeFlairItem.summary)}</p>
                )}              </button>
            ) : (
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                No completed games to report yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;


