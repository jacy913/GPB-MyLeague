import { Game, LeaguePlayerState, PendingTradeProposal, SimulationSettings, SimulationTarget, Team } from '../types';

export interface SimulationWorkerSnapshot {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  currentDate: string;
  seasonComplete: boolean;
  simulatedGameCount: number;
}

export interface SimulationWorkerStartPayload {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  settings: SimulationSettings;
  target: SimulationTarget;
  startingDate: string;
  queuedDates: string[];
  targetDate: string;
  label: string;
  throttleMs: number;
}

export type SimulationWorkerRequest =
  | { type: 'start'; payload: SimulationWorkerStartPayload }
  | { type: 'cancel' };

export type SimulationWorkerResponse =
  | {
      type: 'day_started';
      payload: {
        currentDate: string;
        scheduledGames: number;
        currentIndex: number;
      };
    }
  | {
      type: 'day_completed';
      payload: {
        currentDate: string;
        scheduledGames: number;
        currentIndex: number;
        simulatedGameCount: number;
      };
    }
  | {
      type: 'cancelled';
      payload: {
        snapshot: SimulationWorkerSnapshot;
        message: string;
      };
    }
  | {
      type: 'interrupted';
      payload: {
        snapshot: SimulationWorkerSnapshot;
        interruptionKind: 'trade' | 'free_agency';
        interruptionCount: number;
        message: string;
        pendingTrades?: PendingTradeProposal[];
      };
    }
  | {
      type: 'complete';
      payload: {
        snapshot: SimulationWorkerSnapshot;
        message: string;
      };
    }
  | {
      type: 'error';
      payload: {
        message: string;
      };
    };
