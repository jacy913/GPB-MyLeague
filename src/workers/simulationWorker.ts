/// <reference lib="webworker" />

import { PendingTradeProposal } from '../types';
import { buildFreeAgencyMarketEntries } from '../logic/freeAgencyLogic';
import { SimulationManager } from '../logic/simulationManager';
import { isRegularSeasonGame } from '../logic/playoffs';
import { generatePendingTradeProposals } from '../logic/tradeLogic';
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

const buildSnapshot = (payload: SimulationWorkerStartPayload, simulatedGameCount: number): SimulationWorkerSnapshot => ({
  teams: payload.teams.map((team) => ({ ...team })),
  games: payload.games.map((game) => ({
    ...game,
    playoff: game.playoff ? { ...game.playoff } : null,
    score: { ...game.score },
    stats: { ...game.stats },
  })),
  playerState: {
    players: payload.playerState.players.map((player) => ({ ...player })),
    battingStats: payload.playerState.battingStats.map((stat) => ({ ...stat })),
    pitchingStats: payload.playerState.pitchingStats.map((stat) => ({ ...stat })),
    battingRatings: payload.playerState.battingRatings.map((rating) => ({ ...rating })),
    pitchingRatings: payload.playerState.pitchingRatings.map((rating) => ({ ...rating })),
    rosterSlots: payload.playerState.rosterSlots.map((slot) => ({ ...slot })),
    transactions: payload.playerState.transactions.map((transaction) => ({ ...transaction })),
  },
  currentDate: payload.startingDate,
  seasonComplete: payload.games.every((game) => game.status === 'completed'),
  simulatedGameCount,
});

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

      const regularSeasonGames = working.games.filter(isRegularSeasonGame);
      const nextTrades = generatePendingTradeProposals(
        finalizedTeams,
        working.playerState,
        regularSeasonGames,
        result.currentDate,
      );
      const newTrades = nextTrades.filter((proposal) => !knownTradeIds.has(getStableTradeMarketKey(proposal)));
      knownTradeIds = new Set(nextTrades.map(getStableTradeMarketKey));

      const nextFreeAgencyAlerts = getSimulationFreeAgencyAlerts({
        ...startPayload,
        teams: finalizedTeams,
        games: working.games,
        playerState: working.playerState,
      });
      const newFreeAgencyAlerts = nextFreeAgencyAlerts.filter((alert) => !knownFreeAgencyKeys.has(alert.key));
      knownFreeAgencyKeys = new Set(nextFreeAgencyAlerts.map((alert) => alert.key));

      if (startPayload.throttleMs > 0) {
        await delay(startPayload.throttleMs);
      }

      if (newTrades.length > 0) {
        postMessageToMain({
          type: 'interrupted',
          payload: {
            snapshot: {
              teams: finalizedTeams,
              games: working.games,
              playerState: working.playerState,
              currentDate: result.currentDate,
              seasonComplete: complete,
              simulatedGameCount: totalSimulatedGames,
            },
            interruptionKind: 'trade',
            interruptionCount: newTrades.length,
            pendingTrades: nextTrades,
            message: `${newTrades.length} new trade proposal${newTrades.length === 1 ? '' : 's'} surfaced on ${result.currentDate}. Review the market before continuing.`,
          },
        });
        return;
      }

      if (newFreeAgencyAlerts.length > 0) {
        postMessageToMain({
          type: 'interrupted',
          payload: {
            snapshot: {
              teams: finalizedTeams,
              games: working.games,
              playerState: working.playerState,
              currentDate: result.currentDate,
              seasonComplete: complete,
              simulatedGameCount: totalSimulatedGames,
            },
            interruptionKind: 'free_agency',
            interruptionCount: newFreeAgencyAlerts.length,
            message: `${newFreeAgencyAlerts[0]?.playerName ?? 'A free agent'} drew a fresh offer from ${newFreeAgencyAlerts[0]?.teamName ?? 'a club'}. Review the market before continuing.`,
          },
        });
        return;
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
