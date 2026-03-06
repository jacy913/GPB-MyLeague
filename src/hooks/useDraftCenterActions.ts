import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from 'react';
import {
  applyNextDraftPick,
  createDraftClassState,
  DRAFT_CLASS_SIZE,
  DRAFT_ROUNDS,
  DraftClassState,
  DraftHistoryEntry,
  generateDraftClassBundle,
} from '../logic/draftLogic';
import { Game, LeaguePlayerState, Team } from '../types';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface DraftCenterState {
  activeClass: DraftClassState | null;
  history: DraftHistoryEntry[];
}

interface UseDraftCenterActionsArgs {
  currentDate: string;
  selectedDate: string;
  games: Game[];
  teams: Team[];
  seasonComplete: boolean;
  isSimulating: boolean;
  isFinalizingSimulation: boolean;
  isSupabaseConfigured: boolean;
  isDraftProcessing: boolean;
  setIsDraftProcessing: Dispatch<SetStateAction<boolean>>;
  draftCenterRef: MutableRefObject<DraftCenterState>;
  playerStateRef: MutableRefObject<LeaguePlayerState>;
  setPlayerState: Dispatch<SetStateAction<LeaguePlayerState>>;
  setDraftCenter: Dispatch<SetStateAction<DraftCenterState>>;
  saveLocalPlayerStateSafely: (nextPlayerState: LeaguePlayerState) => boolean;
  saveSupabasePlayerState: (nextPlayerState: LeaguePlayerState) => Promise<void>;
  pushNotice: (message: string, level?: NoticeLevel) => void;
  resolveEffectiveActionDate: (currentDate: string, selectedDate: string, games: Game[]) => string;
  resolveSeasonYear: (currentDate: string | null | undefined, seasonGames?: Game[]) => number;
  removePlayersFromStateByIdSet: (playerState: LeaguePlayerState, playerIdsToRemove: Set<string>) => LeaguePlayerState;
  onAdvanceOffseasonToDraft: (seasonYear: number) => void;
}

interface UseDraftCenterActionsResult {
  isDraftProcessing: boolean;
  stopDraftAutoRun: () => void;
  handleGenerateDraftClass: () => Promise<void>;
  handleDraftNextPick: () => Promise<void>;
  runDraftAuto: (scope: 'round' | 'full') => void;
  handleResetDraftBoard: () => Promise<void>;
}

export const useDraftCenterActions = ({
  currentDate,
  selectedDate,
  games,
  teams,
  seasonComplete,
  isSimulating,
  isFinalizingSimulation,
  isSupabaseConfigured,
  isDraftProcessing,
  setIsDraftProcessing,
  draftCenterRef,
  playerStateRef,
  setPlayerState,
  setDraftCenter,
  saveLocalPlayerStateSafely,
  saveSupabasePlayerState,
  pushNotice,
  resolveEffectiveActionDate,
  resolveSeasonYear,
  removePlayersFromStateByIdSet,
  onAdvanceOffseasonToDraft,
}: UseDraftCenterActionsArgs): UseDraftCenterActionsResult => {
  const draftAutoRunTimerRef = useRef<number | null>(null);

  const stopDraftAutoRun = useCallback(() => {
    if (draftAutoRunTimerRef.current !== null) {
      globalThis.clearTimeout(draftAutoRunTimerRef.current);
      draftAutoRunTimerRef.current = null;
    }
    setIsDraftProcessing(false);
  }, []);

  useEffect(() => () => {
    if (draftAutoRunTimerRef.current !== null) {
      globalThis.clearTimeout(draftAutoRunTimerRef.current);
      draftAutoRunTimerRef.current = null;
    }
  }, []);

  const executeDraftBatch = useCallback((pickCount: number) => {
    const activeDraftClass = draftCenterRef.current.activeClass;
    if (!activeDraftClass || activeDraftClass.isComplete || pickCount <= 0) {
      return { applied: 0, completed: Boolean(activeDraftClass?.isComplete), nextPlayerState: null as LeaguePlayerState | null };
    }

    const effectiveDate = resolveEffectiveActionDate(currentDate, selectedDate, games);
    let workingDraftClass = {
      ...activeDraftClass,
      prospects: [...activeDraftClass.prospects],
      picks: [...activeDraftClass.picks],
    };
    let workingPlayerState = playerStateRef.current;
    let applied = 0;

    for (let index = 0; index < pickCount; index += 1) {
      const stepResult = applyNextDraftPick(workingDraftClass, workingPlayerState, teams, effectiveDate);
      if (!stepResult) {
        break;
      }

      workingDraftClass = stepResult.draftClass;
      workingPlayerState = stepResult.playerState;
      applied += 1;

      if (workingDraftClass.isComplete) {
        break;
      }
    }

    if (applied === 0) {
      return { applied: 0, completed: workingDraftClass.isComplete, nextPlayerState: null as LeaguePlayerState | null };
    }

    const shouldArchiveClass = workingDraftClass.isComplete && !draftCenterRef.current.history.some((entry) => entry.draftId === workingDraftClass.draftId);
    const nextHistory = shouldArchiveClass
      ? [
          ...draftCenterRef.current.history,
          {
            draftId: workingDraftClass.draftId,
            seasonYear: workingDraftClass.seasonYear,
            completedAt: new Date().toISOString(),
            pickCount: workingDraftClass.picks.length,
            picks: [...workingDraftClass.picks],
          },
        ]
      : draftCenterRef.current.history;

    setPlayerState(workingPlayerState);
    playerStateRef.current = workingPlayerState;
    saveLocalPlayerStateSafely(workingPlayerState);

    const nextDraftCenter: DraftCenterState = {
      activeClass: workingDraftClass,
      history: nextHistory,
    };
    setDraftCenter(nextDraftCenter);
    draftCenterRef.current = nextDraftCenter;

    return {
      applied,
      completed: workingDraftClass.isComplete,
      nextPlayerState: workingPlayerState,
    };
  }, [
    currentDate,
    draftCenterRef,
    games,
    playerStateRef,
    resolveEffectiveActionDate,
    saveLocalPlayerStateSafely,
    selectedDate,
    setDraftCenter,
    setPlayerState,
    teams,
  ]);

  const handleGenerateDraftClass = useCallback(async () => {
    if (isSimulating || isFinalizingSimulation) {
      pushNotice('Stop simulation before generating a draft class.', 'warning');
      return;
    }

    if (isDraftProcessing) {
      pushNotice('Stop the current draft auto-run before generating a new class.', 'warning');
      return;
    }

    const existingClass = draftCenterRef.current.activeClass;
    if (existingClass && !existingClass.isComplete) {
      const approved = window.confirm('An active draft class already exists. Replace it with a new class?');
      if (!approved) {
        return;
      }
    }

    const seasonYear = resolveSeasonYear(currentDate, games);
    const targetProspectCount = Math.max(DRAFT_CLASS_SIZE, teams.length * DRAFT_ROUNDS + 32);
    const bundle = generateDraftClassBundle(seasonYear, targetProspectCount);

    const staleProspectIds = new Set<string>((existingClass?.prospects ?? []).map((prospect) => prospect.playerId));
    const cleanedPlayerState = removePlayersFromStateByIdSet(playerStateRef.current, staleProspectIds);

    const existingPlayerIds = new Set(cleanedPlayerState.players.map((player) => player.playerId));
    const nextPlayerState: LeaguePlayerState = {
      ...cleanedPlayerState,
      players: [...cleanedPlayerState.players, ...bundle.players.filter((player) => !existingPlayerIds.has(player.playerId))],
      battingStats: [...cleanedPlayerState.battingStats, ...bundle.battingStats],
      pitchingStats: [...cleanedPlayerState.pitchingStats, ...bundle.pitchingStats],
      battingRatings: [...cleanedPlayerState.battingRatings, ...bundle.battingRatings],
      pitchingRatings: [...cleanedPlayerState.pitchingRatings, ...bundle.pitchingRatings],
      rosterSlots: [...cleanedPlayerState.rosterSlots],
      transactions: [...cleanedPlayerState.transactions],
    };

    const nextDraftCenter: DraftCenterState = {
      activeClass: createDraftClassState(seasonYear, teams, bundle.prospects),
      history: draftCenterRef.current.history,
    };

    setPlayerState(nextPlayerState);
    playerStateRef.current = nextPlayerState;
    setDraftCenter(nextDraftCenter);
    draftCenterRef.current = nextDraftCenter;
    if (seasonComplete) {
      onAdvanceOffseasonToDraft(seasonYear);
    }
    saveLocalPlayerStateSafely(nextPlayerState);

    try {
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }
      pushNotice(
        seasonComplete
          ? `Draft lottery complete for ${seasonYear}. Draft board generated with ${bundle.prospects.length} prospects.`
          : `Draft class generated for ${seasonYear}: ${bundle.prospects.length} prospects are on the board.`,
        'success',
      );
    } catch (error) {
      console.error('Failed to persist generated draft class:', error);
      pushNotice('Draft class generated locally, but syncing player state failed.', 'warning');
    }
  }, [
    currentDate,
    draftCenterRef,
    games,
    isDraftProcessing,
    isFinalizingSimulation,
    isSimulating,
    isSupabaseConfigured,
    onAdvanceOffseasonToDraft,
    playerStateRef,
    pushNotice,
    removePlayersFromStateByIdSet,
    resolveSeasonYear,
    saveLocalPlayerStateSafely,
    saveSupabasePlayerState,
    seasonComplete,
    setDraftCenter,
    setPlayerState,
    teams,
  ]);

  const handleDraftNextPick = useCallback(async () => {
    if (isDraftProcessing) {
      return;
    }
    const result = executeDraftBatch(1);
    if (result.applied === 0 || !result.nextPlayerState) {
      pushNotice('No draft pick was made. Generate a class first.', 'warning');
      return;
    }

    try {
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(result.nextPlayerState);
      }
    } catch (error) {
      console.error('Failed to persist draft pick:', error);
      pushNotice('Draft pick applied locally, but syncing player state failed.', 'warning');
      return;
    }

    pushNotice(result.completed ? 'Draft complete.' : 'Draft pick processed.', 'success');
  }, [executeDraftBatch, isDraftProcessing, isSupabaseConfigured, pushNotice, saveSupabasePlayerState]);

  const runDraftAuto = useCallback((scope: 'round' | 'full') => {
    const activeClass = draftCenterRef.current.activeClass;
    if (!activeClass || activeClass.isComplete || isDraftProcessing) {
      return;
    }

    const completedPicks = activeClass.picks.length;
    const totalRemaining = Math.max(activeClass.totalPicks - completedPicks, 0);
    if (totalRemaining <= 0) {
      return;
    }
    const picksUntilRoundEnd = activeClass.draftOrder.length > 0
      ? activeClass.draftOrder.length - (completedPicks % activeClass.draftOrder.length || 0)
      : 0;
    const targetPickCount = scope === 'round' ? Math.min(picksUntilRoundEnd || 0, totalRemaining) : totalRemaining;
    if (targetPickCount <= 0) {
      return;
    }

    setIsDraftProcessing(true);
    let processed = 0;
    let latestPlayerState: LeaguePlayerState | null = null;

    const step = () => {
      const remaining = targetPickCount - processed;
      if (remaining <= 0) {
        stopDraftAutoRun();
        if (latestPlayerState && isSupabaseConfigured) {
          void saveSupabasePlayerState(latestPlayerState).catch((error) => {
            console.error('Failed to persist auto-draft state:', error);
            pushNotice('Auto draft finished locally, but Supabase sync failed.', 'warning');
          });
        }
        pushNotice(scope === 'round' ? 'Round auto draft finished.' : 'Full auto draft finished.', 'success');
        return;
      }

      const batchSize = scope === 'full' ? 8 : 4;
      const result = executeDraftBatch(Math.min(batchSize, remaining));
      processed += result.applied;
      latestPlayerState = result.nextPlayerState ?? latestPlayerState;

      if (result.applied === 0 || result.completed || processed >= targetPickCount) {
        stopDraftAutoRun();
        if (latestPlayerState && isSupabaseConfigured) {
          void saveSupabasePlayerState(latestPlayerState).catch((error) => {
            console.error('Failed to persist auto-draft state:', error);
            pushNotice('Auto draft finished locally, but Supabase sync failed.', 'warning');
          });
        }
        pushNotice(result.completed ? 'Draft complete.' : 'Auto draft finished.', 'success');
        return;
      }

      draftAutoRunTimerRef.current = globalThis.setTimeout(step, 45);
    };

    step();
  }, [draftCenterRef, executeDraftBatch, isDraftProcessing, isSupabaseConfigured, pushNotice, saveSupabasePlayerState, stopDraftAutoRun]);

  const handleResetDraftBoard = useCallback(async () => {
    if (isDraftProcessing) {
      stopDraftAutoRun();
    }

    const activeClass = draftCenterRef.current.activeClass;
    if (!activeClass) {
      return;
    }

    const approved = window.confirm('Clear the active draft board and remove undrafted prospects from this class?');
    if (!approved) {
      return;
    }

    const undraftedProspectIds = new Set<string>(activeClass.prospects.map((prospect) => prospect.playerId));
    const nextPlayerState = removePlayersFromStateByIdSet(playerStateRef.current, undraftedProspectIds);

    const nextDraftCenter: DraftCenterState = {
      ...draftCenterRef.current,
      activeClass: null,
    };

    setPlayerState(nextPlayerState);
    playerStateRef.current = nextPlayerState;
    setDraftCenter(nextDraftCenter);
    draftCenterRef.current = nextDraftCenter;
    saveLocalPlayerStateSafely(nextPlayerState);

    try {
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }
      pushNotice('Draft board cleared.', 'info');
    } catch (error) {
      console.error('Failed to persist draft board reset:', error);
      pushNotice('Draft board cleared locally, but syncing player state failed.', 'warning');
    }
  }, [
    draftCenterRef,
    isDraftProcessing,
    isSupabaseConfigured,
    playerStateRef,
    pushNotice,
    removePlayersFromStateByIdSet,
    saveLocalPlayerStateSafely,
    saveSupabasePlayerState,
    setDraftCenter,
    setPlayerState,
    stopDraftAutoRun,
  ]);

  return {
    isDraftProcessing,
    stopDraftAutoRun,
    handleGenerateDraftClass,
    handleDraftNextPick,
    runDraftAuto,
    handleResetDraftBoard,
  };
};
