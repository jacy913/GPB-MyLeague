import type { PriceSeries } from '../lib/analytics/sharePrice';
import { Game, LeaguePlayerState, PendingTradeProposal, SimulationSettings, SimulationTarget, Team } from '../types';

export interface SimulationWorkerSnapshot {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  currentDate: string;
  seasonComplete: boolean;
  simulatedGameCount: number;
  /**
   * The HXSE share-price closes, one entry per simulated day.
   *
   * OPTIONAL and additive. The field did not exist before the price path was wired into the day
   * loop, so a snapshot produced by an older build simply lacks it, and every reader must treat
   * absence as "no market yet" rather than as an error.
   *
   * Carried on the snapshot rather than recomputed by the caller because the whole point is that a
   * reloaded save shows the same market. If the caller rebuilt the ledger from the games it would be
   * rebuilding a price path that was never run.
   */
  priceLedger?: PriceSeries[];
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
  /**
   * Seed for the HXSE price path, from `leaguePriceSeed`.
   *
   * Passed in rather than generated inside the worker for two reasons. The worker's whole contract
   * is to be a pure function of its payload, and a seed generated on entry would break that. And a
   * value chosen by the caller is a value that can be held constant across a re-simulation, which is
   * what makes a re-run reproduce the same closes instead of a plausible new market.
   */
  priceSeed: number;
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
