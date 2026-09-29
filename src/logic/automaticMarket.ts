import { buildFreeAgencyMarketEntries } from './freeAgencyLogic';
import { getGeneratedContractYearsLeft } from './playerBio';
import { repairRosterSlotsForTeams } from './rosterManagement';
import { Game, LeaguePlayerState, PendingTradeProposal, Team } from '../types';

const getSeasonYear = (playerState: LeaguePlayerState, effectiveDate: string): number =>
  playerState.rosterSlots.length > 0
    ? Math.max(...playerState.rosterSlots.map((slot) => slot.seasonYear))
    : Number(effectiveDate.slice(0, 4));

const resolveFreeAgencyMarket = (
  teams: Team[],
  playerState: LeaguePlayerState,
  effectiveDate: string,
  minimumUpgrade: number,
  maxSignings = Number.POSITIVE_INFINITY,
  protectedIncumbentOverall = Number.POSITIVE_INFINITY,
): { playerState: LeaguePlayerState; signings: number } => {
  const market = buildFreeAgencyMarketEntries(
    teams,
    playerState.players,
    playerState.battingRatings,
    playerState.pitchingRatings,
    playerState.battingStats,
    playerState.pitchingStats,
    playerState.rosterSlots,
    playerState.transactions,
  );
  const seasonYear = getSeasonYear(playerState, effectiveDate);
  const getLiveOverall = (playerId: string): number => {
    const batting = playerState.battingRatings.filter((rating) => rating.playerId === playerId)
      .sort((left, right) => right.seasonYear - left.seasonYear)[0];
    const pitching = playerState.pitchingRatings.filter((rating) => rating.playerId === playerId)
      .sort((left, right) => right.seasonYear - left.seasonYear)[0];
    return batting?.overall ?? pitching?.overall ?? 0;
  };
  let nextState = playerState;
  let signings = 0;

  // The board is evaluated once per day. This prevents players released by a
  // signing from being immediately re-signed in the same market pass.
  market.forEach((entry) => {
    if (signings >= maxSignings) return;

    const freeAgent = nextState.players.find((player) => player.playerId === entry.player.playerId);
    if (!freeAgent || freeAgent.status !== 'free_agent') return;
    let offer: typeof entry.offers[number] | null = null;
    let displacedPlayer: typeof freeAgent | null = null;

    // The offer board can become stale after an earlier signing. Validate the
    // actual current occupant before authorizing a roster move.
    for (const candidate of entry.offers) {
      const incumbentSlot = nextState.rosterSlots.find(
        (slot) => slot.seasonYear === seasonYear && slot.teamId === candidate.team.id && slot.slotCode === candidate.slotCode,
      );
      const incumbent = incumbentSlot
        ? nextState.players.find((player) => player.playerId === incumbentSlot.playerId) ?? null
        : null;
      const incumbentOverall = incumbent ? getLiveOverall(incumbent.playerId) : null;
      if (incumbentOverall !== null && incumbentOverall >= protectedIncumbentOverall) continue;
      if (incumbentOverall !== null && entry.overall < incumbentOverall + minimumUpgrade) continue;
      offer = candidate;
      displacedPlayer = incumbent;
      break;
    }
    if (!offer) return;
    const players = nextState.players.map((player) => {
      if (player.playerId === freeAgent.playerId) {
        return {
          ...player,
          teamId: offer.team.id,
          status: 'active' as const,
          contractYearsLeft: Math.max(1, offer.contractYears || getGeneratedContractYearsLeft('active', player.age, Math.random)),
        };
      }
      if (displacedPlayer && player.playerId === displacedPlayer.playerId) {
        return { ...player, teamId: null, status: 'free_agent' as const, contractYearsLeft: 0 };
      }
      return player;
    });
    const repaired = repairRosterSlotsForTeams({ ...nextState, players }, [offer.team.id], seasonYear);
    nextState = {
      ...nextState,
      players,
      rosterSlots: repaired.rosterSlots,
      transactions: [
        {
          playerId: freeAgent.playerId,
          eventType: 'signed',
          fromTeamId: offer.isQualifyingOffer ? offer.team.id : null,
          toTeamId: offer.team.id,
          effectiveDate,
          notes: `Auto-signed with preferred offer: ${offer.team.city} ${offer.team.name} (${offer.slotCode}).`,
        },
        ...(displacedPlayer ? [{
          playerId: displacedPlayer.playerId,
          eventType: 'released' as const,
          fromTeamId: offer.team.id,
          toTeamId: null,
          effectiveDate,
          notes: `Released after automatic free-agency signing at ${offer.slotCode}.`,
        }] : []),
        ...nextState.transactions,
      ],
    };
    signings += 1;
  });

  return { playerState: nextState, signings };
};

/** Resolves the current market in preference order, without requiring commissioner input. */
export const automaticallySignFreeAgents = (
  teams: Team[],
  playerState: LeaguePlayerState,
  effectiveDate: string,
): LeaguePlayerState =>
  // Daily roster moves should be selective, not a full market reshuffle.
  resolveFreeAgencyMarket(teams, playerState, effectiveDate, 2, 3, 85).playerState;

export interface FreeAgencyShakeUpResult {
  playerState: LeaguePlayerState;
  signings: number;
  rounds: number;
}

/**
 * Repeatedly gives the market its best available upgrades. Each move must
 * improve the destination slot, so released players can cascade to weaker
 * teams but cannot create a circular churn of equivalent players.
 */
export const shakeUpFreeAgency = (
  teams: Team[],
  playerState: LeaguePlayerState,
  effectiveDate: string,
): FreeAgencyShakeUpResult => {
  let nextState = playerState;
  let signings = 0;
  let rounds = 0;

  // A finite guard keeps corrupted/custom rosters from making the UI action
  // unbounded; strict upgrades normally exhaust the market much sooner.
  while (rounds < 24) {
    // One live-validated move per round guarantees that every later GM makes
    // a decision against the roster as it exists now, not an old offer board.
    const result = resolveFreeAgencyMarket(teams, nextState, effectiveDate, 2, 1, 85);
    if (result.signings === 0) break;
    nextState = result.playerState;
    signings += result.signings;
    rounds += 1;
  }

  return { playerState: nextState, signings, rounds };
};

/** Completes valid generated proposals immediately, skipping any made stale by an earlier swap. */
export const automaticallyAcceptTrades = (
  proposals: PendingTradeProposal[],
  playerState: LeaguePlayerState,
  effectiveDate: string,
): LeaguePlayerState => {
  const seasonYear = getSeasonYear(playerState, effectiveDate);
  let nextState = playerState;

  proposals.forEach((proposal) => {
    const fromPlayer = nextState.players.find((player) => player.playerId === proposal.fromPlayerId);
    const toPlayer = nextState.players.find((player) => player.playerId === proposal.toPlayerId);
    if (!fromPlayer || !toPlayer || fromPlayer.teamId !== proposal.fromTeamId || toPlayer.teamId !== proposal.toTeamId) return;

    const players = nextState.players.map((player) => {
      if (player.playerId === fromPlayer.playerId) return { ...player, teamId: proposal.toTeamId, status: 'active' as const };
      if (player.playerId === toPlayer.playerId) return { ...player, teamId: proposal.fromTeamId, status: 'active' as const };
      return player;
    });
    const repaired = repairRosterSlotsForTeams({ ...nextState, players }, [proposal.fromTeamId, proposal.toTeamId], seasonYear);
    nextState = {
      ...nextState,
      players,
      rosterSlots: repaired.rosterSlots,
      transactions: [
        {
          playerId: fromPlayer.playerId, eventType: 'traded', fromTeamId: proposal.fromTeamId, toTeamId: proposal.toTeamId,
          effectiveDate, notes: `Auto-accepted trade for ${toPlayer.firstName} ${toPlayer.lastName}.`,
        },
        {
          playerId: toPlayer.playerId, eventType: 'traded', fromTeamId: proposal.toTeamId, toTeamId: proposal.fromTeamId,
          effectiveDate, notes: `Auto-accepted trade for ${fromPlayer.firstName} ${fromPlayer.lastName}.`,
        },
        ...nextState.transactions,
      ],
    };
  });

  return nextState;
};
