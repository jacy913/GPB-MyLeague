/// <reference lib="webworker" />

import { PendingTradeProposal } from '../types';
import { buildFreeAgencyMarketEntries } from '../logic/freeAgencyLogic';
import { automaticallyAcceptTrades, automaticallySignFreeAgents } from '../logic/automaticMarket';
import { SimulationManager } from '../logic/simulationManager';
import { isRegularSeasonGame } from '../logic/playoffs';
import { generatePendingTradeProposals } from '../logic/tradeLogic';
import { latestClose, priceAndAppendDay } from '../lib/analytics/priceBoard';
import type { PriceSeries } from '../lib/analytics/sharePrice';
import { SimulationWorkerRequest, SimulationWorkerResponse, SimulationWorkerSnapshot, SimulationWorkerStartPayload } from './simulationWorkerTypes';

interface SimulationMarketAlert {
  key: string;
  playerName: string;
  teamName: string;
  interest: number;
}

const workerScope = self as DedicatedWorkerGlobalScope;

const getStableTradeMarketKey = (proposal: PendingTradeProposal): string =>
  [
    proposal.fromTeamId,
    proposal.toTeamId,
    proposal.fromPlayerId,
    proposal.toPlayerId,
    proposal.needSlot,
  ].join(':');

const getSimulationFreeAgencyAlerts = (payload: SimulationWorkerStartPayload): SimulationMarketAlert[] =>
  buildFreeAgencyMarketEntries(
    payload.teams,
    payload.playerState.players,
    payload.playerState.battingRatings,
    payload.playerState.pitchingRatings,
    payload.playerState.battingStats,
    payload.playerState.pitchingStats,
    payload.playerState.rosterSlots,
    payload.playerState.transactions,
  )
    .filter((entry) => entry.marketValue >= 78)
    .flatMap((entry) =>
      entry.offers
        .filter((offer) => offer.interest >= 82)
        .slice(0, 1)
        .map((offer) => ({
          key: `${entry.player.playerId}:${offer.team.id}:${offer.slotCode}`,
          playerName: `${entry.player.firstName} ${entry.player.lastName}`,
          teamName: `${offer.team.city} ${offer.team.name}`,
          interest: offer.interest,
        })),
    )
    .sort((left, right) => right.interest - left.interest || left.playerName.localeCompare(right.playerName))
    .slice(0, 6);

const postMessageToMain = (message: SimulationWorkerResponse) => {
  workerScope.postMessage(message);
};

let cancelRequested = false;
let runInFlight = false;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

const runSimulation = async (startPayload: SimulationWorkerStartPayload) => {
  cancelRequested = false;
  runInFlight = true;
  let totalSimulatedGames = 0;
  let knownTradeIds = new Set<string>();
  let knownFreeAgencyKeys = new Set<string>();
  const working = {
    teams: startPayload.teams.map((team) => ({ ...team })),
    games: startPayload.games.map((game) => ({
      ...game,
      playoff: game.playoff ? { ...game.playoff } : null,
      score: { ...game.score },
      stats: { ...game.stats },
    })),
    playerState: {
      players: startPayload.playerState.players.map((player) => ({ ...player })),
      battingStats: startPayload.playerState.battingStats.map((stat) => ({ ...stat })),
      pitchingStats: startPayload.playerState.pitchingStats.map((stat) => ({ ...stat })),
      battingRatings: startPayload.playerState.battingRatings.map((rating) => ({ ...rating })),
      pitchingRatings: startPayload.playerState.pitchingRatings.map((rating) => ({ ...rating })),
      rosterSlots: startPayload.playerState.rosterSlots.map((slot) => ({ ...slot })),
      transactions: startPayload.playerState.transactions.map((transaction) => ({ ...transaction })),
    },
    currentDate: startPayload.startingDate,
    /*
      The HXSE price ledger, appended once per simulated day.

      Carried in `working` rather than rebuilt at the end because the price path is sequential --
      each day's close depends on the previous day's. A ledger reconstructed from the finished game
      list would be a price path that was never run, and it would disagree with every close already
      on screen.
    */
    priceLedger: [] as PriceSeries[],
  };

  try {
    const manager = new SimulationManager({
      teams: working.teams,
      games: working.games,
      playerState: working.playerState,
      settings: startPayload.settings,
      currentDate: working.currentDate,
    });

    knownTradeIds = new Set(
      generatePendingTradeProposals(
        working.teams,
        working.playerState,
        working.games.filter(isRegularSeasonGame),
        startPayload.startingDate,
      ).map(getStableTradeMarketKey),
    );
    knownFreeAgencyKeys = new Set(
      getSimulationFreeAgencyAlerts({
        ...startPayload,
        teams: working.teams,
        games: working.games,
        playerState: working.playerState,
      }).map((alert) => alert.key),
    );

    for (let index = 0; index < startPayload.queuedDates.length; index += 1) {
      if (cancelRequested) {
        postMessageToMain({
          type: 'cancelled',
          payload: {
            snapshot: {
              teams: working.teams,
              games: working.games,
              playerState: working.playerState,
              currentDate: working.currentDate,
              seasonComplete: working.games.every((game) => game.status === 'completed'),
              simulatedGameCount: totalSimulatedGames,
        priceLedger: working.priceLedger,
            },
            message: 'Simulation stopped by the commissioner before the next day began.',
          },
        });
        return;
      }

      const useTargetScopeForStep = index === 0 && (startPayload.target.scope === 'next_playoff_game' || startPayload.target.scope === 'to_game');
      const stepTarget = useTargetScopeForStep ? startPayload.target : ({ scope: 'day' } as const);
      const scheduledGames = stepTarget.scope === 'next_playoff_game'
        ? working.games.filter((game) => game.status === 'scheduled' && Boolean(game.playoff)).length
        : stepTarget.scope === 'to_game'
          ? (() => {
            const targetGameId = stepTarget.targetGameId ?? '';
            const targetGame = working.games.find((game) => game.gameId === targetGameId && game.status === 'scheduled');
            if (!targetGame) {
              return 0;
            }
            return working.games.filter((game) => {
              if (game.status !== 'scheduled') {
                return false;
              }
              if (game.date < working.currentDate) {
                return false;
              }
              if (game.date > targetGame.date) {
                return false;
              }
              if (game.date === targetGame.date && game.gameId.localeCompare(targetGame.gameId) > 0) {
                return false;
              }
              return true;
            }).length;
          })()
          : working.games.filter((game) => game.status === 'scheduled' && game.date === working.currentDate).length;
      postMessageToMain({
        type: 'day_started',
        payload: {
          currentDate: working.currentDate,
          scheduledGames,
          currentIndex: index,
        },
      });

      const result = await manager.run(stepTarget);
      const complete = result.games.every((game) => game.status === 'completed');
      const finalizedTeams = complete
        ? result.teams.map((team) => ({ ...team, previousBaselineWins: team.wins }))
        : result.teams;

      working.teams = finalizedTeams;
      working.games = result.games;
      working.playerState = result.playerState;
      working.currentDate = result.currentDate;
      totalSimulatedGames += result.simulatedGameCount;

      postMessageToMain({
        type: 'day_completed',
        payload: {
          currentDate: result.currentDate,
          scheduledGames,
          currentIndex: index + 1,
          simulatedGameCount: totalSimulatedGames,
        },
      });

      working.playerState = automaticallySignFreeAgents(finalizedTeams, working.playerState, result.currentDate);
      const regularSeasonGames = working.games.filter(isRegularSeasonGame);
      const nextTrades = generatePendingTradeProposals(
        finalizedTeams,
        working.playerState,
        regularSeasonGames,
        result.currentDate,
      );
      const newTrades = nextTrades.filter((proposal) => !knownTradeIds.has(getStableTradeMarketKey(proposal)));
      knownTradeIds = new Set(nextTrades.map(getStableTradeMarketKey));
      if (newTrades.length > 0) {
        working.playerState = automaticallyAcceptTrades(newTrades, working.playerState, result.currentDate);
      }

      /*
        PRICE THE DAY.

        Placed after the day's trade and free-agency resolution rather than straight after
        `manager.run`, because the board's fair value is built from `playerState` -- a club that
        signed someone this morning should be valued as the club it is this morning, not as it was
        before the signings.

        `fairCacheKey` is (starting date, day), so a re-request for a day already priced in this
        run reuses the fair layer instead of paying for another Monte Carlo. The previous close comes
        from the LEDGER, not from the cache -- the close depends on yesterday, and the cache only
        holds the league-dependent half. That separation is the reason `priceBoardForDay` caches the
        fair layer rather than the whole board.

        SAFE HERE BECAUSE THE WORKER IS SERIAL. `playoffMonteCarlo` swaps the global `Math.random`
        and is not reentrant; this loop handles one request at a time so nothing overlaps. That is
        the whole reason the price path sits on this side of the worker boundary and not in a React
        render path.
      */
      working.priceLedger = priceAndAppendDay(working.priceLedger, {
        teams: working.teams,
        games: working.games,
        date: result.currentDate,
        playerState: working.playerState,
        seasonYear: Number(result.currentDate.slice(0, 4)),
        seed: startPayload.priceSeed,
        previousClose: latestClose(working.priceLedger),
        settings: startPayload.settings,
        regime: 'in_season',
        fairCacheKey: `${startPayload.startingDate}|${result.currentDate}`,
      });

      if (startPayload.throttleMs > 0) {
        await delay(startPayload.throttleMs);
      }

      if (useTargetScopeForStep) {
        break;
      }
    }

    postMessageToMain({
      type: 'complete',
      payload: {
        snapshot: {
          teams: working.teams,
          games: working.games,
          playerState: working.playerState,
          currentDate: working.currentDate,
          seasonComplete: working.games.every((game) => game.status === 'completed'),
          simulatedGameCount: totalSimulatedGames,
        priceLedger: working.priceLedger,
        },
        message: totalSimulatedGames > 0
          ? `Simulation completed through ${working.currentDate}.`
          : 'No scheduled games matched the selected simulation target.',
      },
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
    postMessageToMain({
      type: 'error',
      payload: {
        message: message || 'The simulation engine failed unexpectedly.',
      },
    });
  } finally {
    runInFlight = false;
    cancelRequested = false;
  }
};

workerScope.onmessage = (event: MessageEvent<SimulationWorkerRequest>) => {
  if (event.data.type === 'cancel') {
    cancelRequested = true;
    return;
  }

  if (runInFlight) {
    postMessageToMain({
      type: 'error',
      payload: {
        message: 'Simulation worker is already processing a run.',
      },
    });
    return;
  }

  void runSimulation(event.data.payload);
};

export {};
