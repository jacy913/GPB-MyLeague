/// <reference lib="webworker" />

import { PendingTradeProposal } from '../types';
import { buildFreeAgencyMarketEntries } from '../logic/freeAgencyLogic';
import { automaticallyAcceptTrades, automaticallySignFreeAgents } from '../logic/automaticMarket';
import { SimulationManager } from '../logic/simulationManager';
import { isRegularSeasonGame } from '../logic/playoffs';
import { generatePendingTradeProposals } from '../logic/tradeLogic';
import { crowdEventShocksFor } from '../lib/analytics/crowd';
import { latestClose, marketFloorFor, priceAndAppendDay, type PriceBoard } from '../lib/analytics/priceBoard';
import type { PriceSeries } from '../lib/analytics/sharePrice';
import { SimulationWorkerRequest, SimulationWorkerResponse, SimulationWorkerSnapshot, SimulationWorkerStartPayload } from './simulationWorkerTypes';

interface SimulationMarketAlert {
  key: string;
  playerName: string;
  teamName: string;
  interest: number;
}

/*
    `self` is typed `Window & typeof globalThis` because the tsconfig loads the DOM lib, and a worker
    has none of that. It IS a `DedicatedWorkerGlobalScope` -- this module is only ever loaded by
    `new Worker(...)`, which is what `checkWorkerPriceHandoff` asserts about this file -- but the two
    lib types share almost nothing, so the single cast is rejected and the honest one goes through
    `unknown`.

    The alternative was narrowing with a guard on every member this file touches, which would be a
    runtime cost and a claim about types that is not what is actually happening here: this is a worker,
    unconditionally.
  */
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

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
  /*
    Typed as `SimulationWorkerSnapshot`, which is what this object is.

    This was left to inference, and the inferred type made `playoff` a REQUIRED property on every
    game because the map callback always writes one -- `{ ...game.playoff }` or `null`, never absent.
    `Game` declares it optional, so the inferred element was not a `Game` and the one line that
    assigns a real league back on, `working.games = result.games`, was a type error.

    Runtime was never affected -- absent and explicit `null` both read as falsy everywhere -- which
    is why this sat in the table as a known diagnostic instead of a bug.

    Annotating it at all is the fix; what it is annotated WITH is where two attempts went wrong.
    Spelling the fields out inline dropped `priceLedger` and produced seven fresh errors, and
    annotating it as a whole `SimulationWorkerSnapshot` failed because `seasonComplete` and
    `simulatedGameCount` are not held here -- the worker tracks the game count in its own counter and
    reports both at the end. `Omit` of the real type says exactly that and stays true if the snapshot
    gains a field later.
  */
  const working: Omit<SimulationWorkerSnapshot, 'seasonComplete' | 'simulatedGameCount'> = {
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

      Seeded from `startPayload.priceLedger`, NOT from `[]`. Those two are the same on the first run of
      a league and completely different on every run after it: an empty ledger means no previous close,
      so `previous` falls back to fair, the drift term is exactly zero, and the run restarts the price
      path from scratch. So a worker started from `[]` reopens the whole market every time it was asked to
      advance, putting a cliff in the share-price chart that no game produced.
    */
    priceLedger: startPayload.priceLedger ?? [],
  };

    /*
      Yesterday's board, carried so the crowd reads a fair price from the DAY BEFORE rather than
      from the day being priced. `PriceSeries` deliberately carries closes only -- a fair price is
      an assessment, not a record, and putting one in every saved day would put a number on disk
      that was true only on the day it was written -- so this local is where the assessment lives
      between days.
    */
    let lastBoard: PriceBoard | null = null;

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
        priceBoard: lastBoard,
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
          PRICE THE DAY, THROUGH THE CROWD.

          The crowd runs HERE rather than inside priceBoardForDay, for one reason that matters:
          IT MUST NOT SEE ITS OWN OUTPUT. A crowd priced from the same day's closes it just produced
          would be reading its own writing. `checkCrowdOnRealPath` measured what that does -- the mean
          run return rises from 10.40% on an empty market to 12.87% with the crowd -- and feeding it
          back is the difference between a market and a feedback loop. So yesterday's board supplies
          the fair prices and the plain consensus, the crowd forms its flow, and that flow becomes
          today's event shocks.

          Safe here because the worker is serial: playoffMonteCarlo swaps the global Math.random and
          is not reentrant, and this loop handles one request at a time.

          THE FINDING FROM checkCrowdOnRealPath, carried here rather than buried in a tool. The
          momentum archetype AMPLIFIES runs rather than being fadeable: chasing beat fading by 10.80
          points over 100 emergent runs, and by 9.23 on a control market with no crowd at all. The
          mechanism works -- the crowd stops buying an established run, +0.373% against -0.292% with
          no run -- but not strongly enough to beat the momentum it rides. So the blueprint's
          learnable "fade the spike" is NOT available in this market. The crowd is wired in anyway: it
          should behave as modelled, and the price path should not be withheld from it.
        */
        const floor = marketFloorFor(lastBoard, working.teams, working.playerState, Number(result.currentDate.slice(0, 4)));
        const priced = priceAndAppendDay(working.priceLedger, {
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
          eventShocks: floor ? crowdEventShocksFor({
            teams: working.teams,
            games: working.games,
            date: result.currentDate,
            ledger: working.priceLedger,
            fair: floor.fair,
            plain: floor.plain,
            plainLeagueMean: floor.leagueMean,
          }) : undefined,
        });
        working.priceLedger = priced.ledger;
        lastBoard = priced.board;

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
        priceBoard: lastBoard,
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
