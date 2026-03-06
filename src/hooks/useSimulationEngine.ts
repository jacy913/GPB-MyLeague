import { useCallback, useEffect, useRef, useState } from 'react';
import { SimulationRunState } from '../components/SimulationHub';
import { SimulationProgressUpdate } from '../logic/simulationManager';
import { saveSupabaseSeasonRun } from '../lib/storage';
import { Game, LeaguePlayerState, PendingTradeProposal, SimulationSettings, SimulationTarget, Team } from '../types';
import { SimulationWorkerResponse } from '../workers/simulationWorkerTypes';

export type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

export interface SimulationSaveStatus {
  isSaving: boolean;
  progress: number;
  label: string;
}

const IDLE_SIMULATION_SAVE_STATUS: SimulationSaveStatus = {
  isSaving: false,
  progress: 0,
  label: '',
};

interface UseSimulationEngineArgs {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  settings: SimulationSettings;
  currentDate: string;
  isSupabaseConfigured: boolean;
  isDraftProcessing: boolean;
  seasonResetInProgress: boolean;
  getDefaultSeasonStartDate: (year: number) => string;
  getSimulationScopeLabel: (target: SimulationTarget) => string;
  getSimulationTargetLabel: (target: SimulationTarget, teams: Team[], targetDate: string) => string;
  buildSimulationDatePlan: (
    games: Game[],
    currentDate: string,
    target: SimulationTarget,
  ) => { dates: string[]; targetDate: string };
  pushNotice: (message: string, level?: NoticeLevel) => void;
  onOpenSimulationView: () => void;
  onOpenFreeAgencyView: () => void;
  onTradeInterruption: (pendingTrades: PendingTradeProposal[], date: string, count: number) => void;
  persistSimulationSnapshot: (
    nextTeams: Team[],
    nextGames: Game[],
    nextPlayerState: LeaguePlayerState,
    nextCurrentDate: string,
    nextSeasonComplete: boolean,
    onProgress?: (progress: number, label: string) => void,
  ) => Promise<number>;
  applySimulationFullState: (
    nextTeams: Team[],
    nextGames: Game[],
    nextPlayerState: LeaguePlayerState,
    nextCurrentDate: string,
    nextProgress: number,
    nextSeasonComplete: boolean,
  ) => void;
}

interface UseSimulationEngineResult {
  isSimulating: boolean;
  isFinalizingSimulation: boolean;
  simulationSaveStatus: SimulationSaveStatus;
  simulationProgress: SimulationProgressUpdate | null;
  simulationRunState: SimulationRunState | null;
  runSimulationTarget: (target: SimulationTarget, options?: { keepCurrentView?: boolean }) => Promise<void>;
  cancelSimulationRun: () => void;
  resetSimulationState: () => void;
}

export const useSimulationEngine = ({
  teams,
  games,
  playerState,
  settings,
  currentDate,
  isSupabaseConfigured,
  isDraftProcessing,
  seasonResetInProgress,
  getDefaultSeasonStartDate,
  getSimulationScopeLabel,
  getSimulationTargetLabel,
  buildSimulationDatePlan,
  pushNotice,
  onOpenSimulationView,
  onOpenFreeAgencyView,
  onTradeInterruption,
  persistSimulationSnapshot,
  applySimulationFullState,
}: UseSimulationEngineArgs): UseSimulationEngineResult => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [isFinalizingSimulation, setIsFinalizingSimulation] = useState(false);
  const [simulationSaveStatus, setSimulationSaveStatus] = useState<SimulationSaveStatus>(IDLE_SIMULATION_SAVE_STATUS);
  const [simulationProgress, setSimulationProgress] = useState<SimulationProgressUpdate | null>(null);
  const [simulationRunState, setSimulationRunState] = useState<SimulationRunState | null>(null);
  const simulationWorkerRef = useRef<Worker | null>(null);

  const destroySimulationWorker = useCallback((worker?: Worker | null) => {
    const activeWorker = worker ?? simulationWorkerRef.current;
    if (!activeWorker) {
      return;
    }

    activeWorker.terminate();
    if (simulationWorkerRef.current === activeWorker) {
      simulationWorkerRef.current = null;
    }
  }, []);

  const resetSimulationState = useCallback(() => {
    destroySimulationWorker();
    setIsSimulating(false);
    setIsFinalizingSimulation(false);
    setSimulationSaveStatus(IDLE_SIMULATION_SAVE_STATUS);
    setSimulationProgress(null);
    setSimulationRunState(null);
  }, [destroySimulationWorker]);

  useEffect(() => () => {
    destroySimulationWorker();
  }, [destroySimulationWorker]);

  const runSimulationTarget = useCallback(async (target: SimulationTarget, options?: { keepCurrentView?: boolean }) => {
    if (isSimulating || isFinalizingSimulation || seasonResetInProgress || isDraftProcessing || games.length === 0) {
      if (isDraftProcessing) {
        pushNotice('Stop the active draft run before starting simulation.', 'warning');
      }
      return;
    }

    const startingDate = currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
    const plan = buildSimulationDatePlan(games, startingDate, target);
    if (plan.dates.length === 0) {
      pushNotice('No scheduled dates matched that simulation target.', 'info');
      return;
    }

    destroySimulationWorker();

    const label = getSimulationScopeLabel(target);
    const targetLabel = getSimulationTargetLabel(target, teams, plan.targetDate);
    const worker = new Worker(new URL('../workers/simulationWorker.ts', import.meta.url), { type: 'module' });
    simulationWorkerRef.current = worker;

    if (!options?.keepCurrentView) {
      onOpenSimulationView();
    }
    setIsSimulating(true);
    setIsFinalizingSimulation(false);
    setSimulationSaveStatus(IDLE_SIMULATION_SAVE_STATUS);
    setSimulationProgress({
      label,
      completedGames: 0,
      totalGames: 0,
      currentDate: startingDate,
    });
    setSimulationRunState({
      status: 'running',
      label,
      targetLabel,
      queuedDates: plan.dates,
      currentIndex: 0,
      startDate: startingDate,
      currentDate: startingDate,
      targetDate: plan.targetDate,
      simulatedGameCount: 0,
    });

    worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      void (async () => {
        if (simulationWorkerRef.current !== worker) {
          return;
        }

        const message = event.data;

        if (message.type === 'day_started') {
          setSimulationProgress({
            label,
            completedGames: 0,
            totalGames: message.payload.scheduledGames,
            currentDate: message.payload.currentDate,
          });
          setSimulationRunState((current) => current ? {
            ...current,
            currentIndex: message.payload.currentIndex,
            currentDate: message.payload.currentDate,
          } : null);
          return;
        }

        if (message.type === 'day_completed') {
          setSimulationProgress({
            label,
            completedGames: message.payload.scheduledGames,
            totalGames: message.payload.scheduledGames,
            currentDate: message.payload.currentDate,
          });
          setSimulationRunState((current) => current ? {
            ...current,
            currentIndex: message.payload.currentIndex,
            currentDate: message.payload.currentDate,
            simulatedGameCount: message.payload.simulatedGameCount,
          } : null);
          return;
        }

        if (message.type === 'error') {
          destroySimulationWorker(worker);
          setIsSimulating(false);
          setIsFinalizingSimulation(false);
          setSimulationSaveStatus(IDLE_SIMULATION_SAVE_STATUS);
          setSimulationProgress(null);
          setSimulationRunState((current) => current ? {
            ...current,
            status: 'error',
            message: message.payload.message || 'The simulation engine failed unexpectedly.',
          } : null);
          pushNotice('Simulation failed. Review the current day and try a shorter run.', 'error');
          return;
        }

        destroySimulationWorker(worker);
        setIsSimulating(false);
        setSimulationProgress(null);
        setIsFinalizingSimulation(true);
        setSimulationSaveStatus({
          isSaving: true,
          progress: 6,
          label: 'Preparing simulation snapshot',
        });

        try {
          const snapshot = message.payload.snapshot;

          if (message.type === 'cancelled') {
            setSimulationSaveStatus({
              isSaving: true,
              progress: 10,
              label: 'Saving stopped simulation state',
            });
            setSimulationRunState((current) => current ? {
              ...current,
              status: 'cancelled',
              currentDate: snapshot.currentDate,
              simulatedGameCount: snapshot.simulatedGameCount,
              message: message.payload.message,
            } : null);
            pushNotice('Simulation stopped.', 'info');
          } else if (message.type === 'interrupted') {
            setSimulationSaveStatus({
              isSaving: true,
              progress: 10,
              label: 'Saving interrupted simulation state',
            });
            if (message.payload.interruptionKind === 'trade') {
              onTradeInterruption(
                message.payload.pendingTrades ?? [],
                snapshot.currentDate,
                message.payload.interruptionCount,
              );
              pushNotice(
                message.payload.interruptionCount === 1
                  ? '1 trade needs commissioner approval.'
                  : `${message.payload.interruptionCount} trades need commissioner approval.`,
                'warning',
              );
            } else {
              pushNotice('Simulation halted for a new free-agency offer.', 'warning');
              onOpenFreeAgencyView();
            }

            setSimulationRunState((current) => current ? {
              ...current,
              status: 'interrupted',
              interruptionKind: message.payload.interruptionKind,
              interruptionCount: message.payload.interruptionCount,
              currentDate: snapshot.currentDate,
              simulatedGameCount: snapshot.simulatedGameCount,
              message: message.payload.message,
            } : null);
          } else {
            setSimulationSaveStatus({
              isSaving: true,
              progress: 10,
              label: 'Saving completed simulation state',
            });
            setSimulationRunState((current) => current ? {
              ...current,
              status: 'complete',
              currentIndex: current.queuedDates.length,
              currentDate: snapshot.currentDate,
              simulatedGameCount: snapshot.simulatedGameCount,
              message: message.payload.message,
            } : null);
          }

          const nextProgress = await persistSimulationSnapshot(
            snapshot.teams,
            snapshot.games,
            snapshot.playerState,
            snapshot.currentDate,
            snapshot.seasonComplete,
            (nextSaveProgress, nextLabel) => {
              setSimulationSaveStatus({
                isSaving: true,
                progress: nextSaveProgress,
                label: nextLabel,
              });
            },
          );

          setSimulationSaveStatus({
            isSaving: true,
            progress: 94,
            label: 'Applying saved snapshot',
          });
          applySimulationFullState(
            snapshot.teams,
            snapshot.games,
            snapshot.playerState,
            snapshot.currentDate,
            nextProgress,
            snapshot.seasonComplete,
          );

          if (message.type === 'complete' && snapshot.seasonComplete && snapshot.simulatedGameCount > 0) {
            if (isSupabaseConfigured) {
              setSimulationSaveStatus({
                isSaving: true,
                progress: 97,
                label: 'Saving season archive',
              });
              const seasonLabel = `Season ${new Date(`${snapshot.currentDate}T00:00:00Z`).getUTCFullYear()}`;
              await saveSupabaseSeasonRun(snapshot.teams, snapshot.games, settings, seasonLabel);
              pushNotice('Season simulation completed and saved to Supabase.', 'success');
            } else {
              pushNotice('Season simulation completed and saved locally.', 'success');
            }
          } else if (message.type === 'complete' && snapshot.simulatedGameCount === 0) {
            pushNotice('No scheduled games matched the selected simulation scope.', 'info');
          } else if (message.type === 'complete') {
            pushNotice(`Simulated ${snapshot.simulatedGameCount} games through ${snapshot.currentDate}.`, 'info');
          }

          setSimulationSaveStatus({
            isSaving: true,
            progress: 100,
            label: 'Save complete',
          });
        } catch (error) {
          console.error('Failed to finalize simulation snapshot:', error);
          const errorMessage = error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error);
          setSimulationRunState((current) => current ? {
            ...current,
            status: 'error',
            message: errorMessage || 'The simulation engine failed unexpectedly.',
          } : null);
          pushNotice('Simulation failed while saving the final snapshot.', 'error');
        } finally {
          setIsFinalizingSimulation(false);
          setSimulationSaveStatus(IDLE_SIMULATION_SAVE_STATUS);
        }
      })();
    };

    worker.onerror = (event) => {
      if (simulationWorkerRef.current !== worker) {
        return;
      }

      console.error('Simulation worker crashed:', event);
      const workerErrorDetails = [event.message, event.filename, event.lineno ? `line ${event.lineno}` : '', event.colno ? `col ${event.colno}` : '']
        .filter((token) => Boolean(token))
        .join(' | ');
      destroySimulationWorker(worker);
      setIsSimulating(false);
      setIsFinalizingSimulation(false);
      setSimulationSaveStatus(IDLE_SIMULATION_SAVE_STATUS);
      setSimulationProgress(null);
      setSimulationRunState((current) => current ? {
        ...current,
        status: 'error',
        message: workerErrorDetails
          ? `The background simulation worker crashed unexpectedly. ${workerErrorDetails}`
          : 'The background simulation worker crashed unexpectedly.',
      } : null);
      pushNotice('Simulation failed. The background worker crashed.', 'error');
    };

    worker.postMessage({
      type: 'start',
      payload: {
        teams,
        games,
        playerState,
        settings,
        target,
        startingDate,
        queuedDates: plan.dates,
        targetDate: plan.targetDate,
        label,
        throttleMs: 340,
      },
    });
  }, [
    applySimulationFullState,
    buildSimulationDatePlan,
    currentDate,
    destroySimulationWorker,
    games,
    getDefaultSeasonStartDate,
    getSimulationScopeLabel,
    getSimulationTargetLabel,
    isDraftProcessing,
    isFinalizingSimulation,
    isSimulating,
    isSupabaseConfigured,
    onOpenFreeAgencyView,
    onOpenSimulationView,
    onTradeInterruption,
    persistSimulationSnapshot,
    playerState,
    pushNotice,
    seasonResetInProgress,
    settings,
    teams,
  ]);

  const cancelSimulationRun = useCallback(() => {
    if (!isSimulating || !simulationWorkerRef.current) {
      return;
    }
    simulationWorkerRef.current.postMessage({ type: 'cancel' });
    pushNotice('Stopping simulation after the active day resolves.', 'info');
  }, [isSimulating, pushNotice]);

  return {
    isSimulating,
    isFinalizingSimulation,
    simulationSaveStatus,
    simulationProgress,
    simulationRunState,
    runSimulationTarget,
    cancelSimulationRun,
    resetSimulationState,
  };
};
