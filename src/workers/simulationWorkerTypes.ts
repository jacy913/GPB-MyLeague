import type { PriceSeries } from '../lib/analytics/sharePrice';
import type { PriceBoard } from '../lib/analytics/priceBoard';
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
  /**
   * The last board the worker priced, so a caller can keep pricing through the crowd afterwards.
   *
   * OPTIONAL and additive, for the same reason `priceLedger` is. Without it, a caller pricing a
   * single day after a bulk run has no fair values from the day before and must either invent them
   * or run that day with no crowd -- two markets from one set of clubs.
   */
  priceBoard?: PriceBoard | null;
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
  /**
   * The closes the run should CONTINUE from, oldest first.
   *
   * The ledger has to arrive with the run, not only leave with it. The price path is sequential --
   * each day's close is yesterday's close plus drift, shock and noise -- so a worker that starts
   * from an empty ledger prices its first day with no previous close, and `priceBoardForDay`
   * answers that by opening every club at exactly fair value with a move of 0.000%. Measured on the
   * real pricing path by `tools/probePreviousClose.ts`.
   *
   * The visible consequence of omitting it: every "simulate forward" run reopens the whole market at
   * fair, so a club that had climbed to 900 prints 500 on the first day of the next run and the
   * share-price chart shows a cliff that no game produced. Momentum and mean reversion also restart
   * from nothing on every run, so the crowd has no history to read on day one.
   *
   * OPTIONAL, because a genuinely new market has no prior closes. Absent means "no market yet" and
   * the run opens at fair, which is correct for a first day and wrong for every day after it.
   */
  priceLedger?: PriceSeries[];
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
