import { Dispatch, SetStateAction, useEffect } from 'react';
import { INITIAL_TEAMS } from '../data/teams';
import { DEFAULT_SETTINGS } from '../logic/simulation';
import {
  loadLocalLeagueStateAsync,
  loadLocalPlayerStateAsync,
  loadSupabaseLeagueState,
  loadSupabasePlayerState,
  replaceSupabaseTeamsFromSource,
  seedSupabaseLeagueState,
} from '../lib/storage';
import { Game, LeaguePlayerState, SimulationSettings, Team } from '../types';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

const SUPABASE_TEAM_SOURCE_SYNC_KEY = 'gpb_supabase_team_source_sync_v1';
const SUPABASE_TEAM_SOURCE_SYNC_VERSION = '2026-03-03-teams-ts-trade-fix';
const SUPABASE_BOOTSTRAP_TIMEOUT_MS = 45000;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = globalThis.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      globalThis.clearTimeout(timeoutHandle);
    }
  }
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

interface UseLeagueBootstrapArgs {
  isSupabaseConfigured: boolean;
  sanitizeTeams: (value: unknown) => Team[] | null;
  sanitizeGames: (value: unknown) => Game[] | null;
  isValidSettingsShape: (value: unknown) => value is SimulationSettings;
  getProgressFromGames: (seasonGames: Game[]) => number;
  saveLocalPlayerStateSafely: (nextPlayerState: LeaguePlayerState) => boolean;
  saveLocalLeagueStateSafely: (
    nextTeams: Team[],
    nextSettings: SimulationSettings,
    nextGames: Game[],
    nextCurrentDate: string,
    nextProgress: number,
    nextSeasonComplete: boolean,
  ) => boolean;
  pushNotice: (message: string, level?: NoticeLevel) => void;
  setIsBootstrapping: Dispatch<SetStateAction<boolean>>;
  setPlayerState: Dispatch<SetStateAction<LeaguePlayerState>>;
  setTeams: Dispatch<SetStateAction<Team[]>>;
  setSettings: Dispatch<SetStateAction<SimulationSettings>>;
  setGames: Dispatch<SetStateAction<Game[]>>;
  setCurrentDate: Dispatch<SetStateAction<string>>;
  setSelectedDate: Dispatch<SetStateAction<string>>;
  setProgress: Dispatch<SetStateAction<number>>;
  setSeasonComplete: Dispatch<SetStateAction<boolean>>;
  setDataSource: Dispatch<SetStateAction<'supabase' | 'local'>>;
}

export const useLeagueBootstrap = ({
  isSupabaseConfigured,
  sanitizeTeams,
  sanitizeGames,
  isValidSettingsShape,
  getProgressFromGames,
  saveLocalPlayerStateSafely,
  saveLocalLeagueStateSafely,
  pushNotice,
  setIsBootstrapping,
  setPlayerState,
  setTeams,
  setSettings,
  setGames,
  setCurrentDate,
  setSelectedDate,
  setProgress,
  setSeasonComplete,
  setDataSource,
}: UseLeagueBootstrapArgs): void => {
  useEffect(() => {
    const bootstrap = async () => {
      setIsBootstrapping(true);

      try {
        if (isSupabaseConfigured) {
          let [remoteState, remotePlayerState] = await withTimeout(
            Promise.all([
              loadSupabaseLeagueState(),
              loadSupabasePlayerState(),
            ]),
            SUPABASE_BOOTSTRAP_TIMEOUT_MS,
            'Supabase initial load',
          );
          const hasRemoteTeams = Array.isArray(remoteState.teams) && remoteState.teams.length > 0;
          const hasRemoteSettings = Boolean(remoteState.settings);
          if (!hasRemoteTeams || !hasRemoteSettings) {
            await withTimeout(
              seedSupabaseLeagueState(INITIAL_TEAMS, DEFAULT_SETTINGS),
              SUPABASE_BOOTSTRAP_TIMEOUT_MS,
              'Supabase seed',
            );
            [remoteState, remotePlayerState] = await withTimeout(
              Promise.all([
                loadSupabaseLeagueState(),
                loadSupabasePlayerState(),
              ]),
              SUPABASE_BOOTSTRAP_TIMEOUT_MS,
              'Supabase reload after seed',
            );
          }

          const hasSyncedTeamSource = localStorage.getItem(SUPABASE_TEAM_SOURCE_SYNC_KEY) === SUPABASE_TEAM_SOURCE_SYNC_VERSION;
          if (!hasSyncedTeamSource) {
            await withTimeout(
              replaceSupabaseTeamsFromSource(INITIAL_TEAMS),
              SUPABASE_BOOTSTRAP_TIMEOUT_MS,
              'Supabase team source sync',
            );
            localStorage.setItem(SUPABASE_TEAM_SOURCE_SYNC_KEY, SUPABASE_TEAM_SOURCE_SYNC_VERSION);
          }

          const validRemoteTeams = sanitizeTeams(remoteState.teams);
          const validRemoteSettings = isValidSettingsShape(remoteState.settings) ? remoteState.settings : null;
          const validRemoteGames = sanitizeGames(remoteState.games);

          setPlayerState(remotePlayerState);
          saveLocalPlayerStateSafely(remotePlayerState);

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
            saveLocalLeagueStateSafely(
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

        const localState = await loadLocalLeagueStateAsync();
        const localPlayerState = await loadLocalPlayerStateAsync();
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
        const bootstrapErrorMessage = toErrorMessage(error);
        const localState = await loadLocalLeagueStateAsync();
        const localPlayerState = await loadLocalPlayerStateAsync();
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
        pushNotice(
          `Supabase bootstrap failed: ${bootstrapErrorMessage.slice(0, 180)}. Using local storage fallback.`,
          'warning',
        );
      } finally {
        setIsBootstrapping(false);
      }
    };

    void bootstrap();
  }, [
    getProgressFromGames,
    isSupabaseConfigured,
    isValidSettingsShape,
    pushNotice,
    sanitizeGames,
    sanitizeTeams,
    saveLocalLeagueStateSafely,
    saveLocalPlayerStateSafely,
    setCurrentDate,
    setDataSource,
    setGames,
    setIsBootstrapping,
    setPlayerState,
    setProgress,
    setSeasonComplete,
    setSelectedDate,
    setSettings,
    setTeams,
  ]);
};
