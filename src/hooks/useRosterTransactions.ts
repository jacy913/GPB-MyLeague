import { Dispatch, SetStateAction, useCallback } from 'react';
import { getGeneratedContractYearsLeft } from '../logic/playerBio';
import { repairRosterSlotsForTeams } from '../logic/rosterManagement';
import { Game, LeaguePlayerState, PendingTradeProposal, RosterSlotCode, Team } from '../types';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

interface UseRosterTransactionsArgs {
  currentDate: string;
  selectedDate: string;
  games: Game[];
  teams: Team[];
  playerState: LeaguePlayerState;
  pendingTrades: PendingTradeProposal[];
  freeAgencyOpenDate: string;
  isFreeAgencyMarketOpen: boolean;
  freeAgencyMarketStatusMessage: string;
  isSupabaseConfigured: boolean;
  setPlayerState: Dispatch<SetStateAction<LeaguePlayerState>>;
  setSelectedTeamId: Dispatch<SetStateAction<string>>;
  setPendingTrades: Dispatch<SetStateAction<PendingTradeProposal[]>>;
  saveLocalPlayerStateSafely: (nextPlayerState: LeaguePlayerState) => boolean;
  saveSupabasePlayerState: (nextPlayerState: LeaguePlayerState) => Promise<void>;
  pushNotice: (message: string, level?: NoticeLevel) => void;
  resolveEffectiveActionDate: (currentDate: string, selectedDate: string, games: Game[]) => string;
  resolveSeasonYear: (currentDate: string | null | undefined, seasonGames?: Game[]) => number;
}

interface TradePayload {
  fromTeamId: string;
  toTeamId: string;
  fromPlayerId: string;
  toPlayerId: string;
}

interface FreeAgencyAssignment {
  playerId: string;
  teamId: string;
  slotCode: RosterSlotCode;
  contractYearsLeft: number;
  isQualifyingOffer?: boolean;
}

interface UseRosterTransactionsResult {
  handleTradeProposal: (trade: TradePayload) => Promise<void>;
  handleApprovePendingTrade: (proposalId: string) => Promise<void>;
  handleVetoPendingTrade: (proposalId: string) => void;
  handleFreeAgencyAssignment: (assignment: FreeAgencyAssignment) => Promise<void>;
}

const clonePlayerStatsAndRatings = (nextPlayerState: LeaguePlayerState) => ({
  battingStats: nextPlayerState.battingStats.map((stat) => ({ ...stat })),
  pitchingStats: nextPlayerState.pitchingStats.map((stat) => ({ ...stat })),
  battingRatings: nextPlayerState.battingRatings.map((rating) => ({ ...rating })),
  pitchingRatings: nextPlayerState.pitchingRatings.map((rating) => ({ ...rating })),
});

export const useRosterTransactions = ({
  currentDate,
  selectedDate,
  games,
  teams,
  playerState,
  pendingTrades,
  freeAgencyOpenDate,
  isFreeAgencyMarketOpen,
  freeAgencyMarketStatusMessage,
  isSupabaseConfigured,
  setPlayerState,
  setSelectedTeamId,
  setPendingTrades,
  saveLocalPlayerStateSafely,
  saveSupabasePlayerState,
  pushNotice,
  resolveEffectiveActionDate,
  resolveSeasonYear,
}: UseRosterTransactionsArgs): UseRosterTransactionsResult => {
  const handleTradeProposal = useCallback(async (
    trade: TradePayload,
  ) => {
    if (
      !trade.fromTeamId ||
      !trade.toTeamId ||
      !trade.fromPlayerId ||
      !trade.toPlayerId ||
      trade.fromTeamId === trade.toTeamId ||
      trade.fromPlayerId === trade.toPlayerId
    ) {
      pushNotice('Select two different teams and two different players for a trade.', 'warning');
      return;
    }

    const fromPlayer = playerState.players.find((player) => player.playerId === trade.fromPlayerId) ?? null;
    const toPlayer = playerState.players.find((player) => player.playerId === trade.toPlayerId) ?? null;
    if (!fromPlayer || !toPlayer) {
      pushNotice('Trade proposal could not find both selected players.', 'error');
      return;
    }

    const effectiveDate = resolveEffectiveActionDate(currentDate, selectedDate, games);
    const activeRosterSeasonYear = playerState.rosterSlots.length > 0
      ? Math.max(...playerState.rosterSlots.map((slot) => slot.seasonYear))
      : resolveSeasonYear(effectiveDate, games);
    const nextPlayers = playerState.players.map((player) => {
      if (player.playerId === trade.fromPlayerId) {
        return { ...player, teamId: trade.toTeamId, status: 'active' as const };
      }
      if (player.playerId === trade.toPlayerId) {
        return { ...player, teamId: trade.fromTeamId, status: 'active' as const };
      }
      return { ...player };
    });

    const nextRosterSlots = playerState.rosterSlots.map((slot) => {
      if (slot.seasonYear !== activeRosterSeasonYear) {
        return { ...slot };
      }
      if (slot.playerId === trade.fromPlayerId) {
        return { ...slot, playerId: trade.toPlayerId };
      }
      if (slot.playerId === trade.toPlayerId) {
        return { ...slot, playerId: trade.fromPlayerId };
      }
      return { ...slot };
    });

    const repairedRoster = repairRosterSlotsForTeams(
      {
        ...playerState,
        players: nextPlayers,
        rosterSlots: nextRosterSlots,
      },
      [trade.fromTeamId, trade.toTeamId],
      activeRosterSeasonYear,
    );

    const nextPlayerState: LeaguePlayerState = {
      ...playerState,
      players: nextPlayers,
      ...clonePlayerStatsAndRatings(playerState),
      rosterSlots: repairedRoster.rosterSlots,
      transactions: [
        {
          playerId: trade.fromPlayerId,
          eventType: 'traded',
          fromTeamId: trade.fromTeamId,
          toTeamId: trade.toTeamId,
          effectiveDate,
          notes: `Swap return: ${toPlayer.firstName} ${toPlayer.lastName}`,
        },
        {
          playerId: trade.toPlayerId,
          eventType: 'traded',
          fromTeamId: trade.toTeamId,
          toTeamId: trade.fromTeamId,
          effectiveDate,
          notes: `Swap return: ${fromPlayer.firstName} ${fromPlayer.lastName}`,
        },
        ...repairedRoster.promotions.map((promotion) => ({
          playerId: promotion.playerId,
          eventType: 'promoted' as const,
          fromTeamId: promotion.teamId,
          toTeamId: promotion.teamId,
          effectiveDate,
          notes: `Auto-promoted from ${promotion.fromSlot ?? 'unassigned'} to ${promotion.toSlot} after roster reshuffle.`,
        })),
        ...playerState.transactions.map((transaction) => ({ ...transaction })),
      ],
    };

    setPlayerState(nextPlayerState);
    saveLocalPlayerStateSafely(nextPlayerState);

    try {
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }
      pushNotice(
        `Trade approved: ${fromPlayer.firstName} ${fromPlayer.lastName} for ${toPlayer.firstName} ${toPlayer.lastName}.`,
        'success',
      );
    } catch (error) {
      console.error('Failed to persist trade proposal:', error);
      pushNotice('Trade completed locally, but syncing player data failed.', 'warning');
    }
  }, [
    currentDate,
    games,
    isSupabaseConfigured,
    playerState,
    pushNotice,
    resolveEffectiveActionDate,
    resolveSeasonYear,
    saveLocalPlayerStateSafely,
    saveSupabasePlayerState,
    selectedDate,
    setPlayerState,
  ]);

  const handleApprovePendingTrade = useCallback(async (proposalId: string) => {
    const proposal = pendingTrades.find((entry) => entry.proposalId === proposalId) ?? null;
    if (!proposal) {
      pushNotice('That trade proposal is no longer available.', 'warning');
      return;
    }

    await handleTradeProposal({
      fromTeamId: proposal.fromTeamId,
      toTeamId: proposal.toTeamId,
      fromPlayerId: proposal.fromPlayerId,
      toPlayerId: proposal.toPlayerId,
    });

    setPendingTrades((current) => current.filter((entry) => entry.proposalId !== proposalId));
  }, [handleTradeProposal, pendingTrades, pushNotice, setPendingTrades]);

  const handleVetoPendingTrade = useCallback((proposalId: string) => {
    setPendingTrades((current) => current.filter((entry) => entry.proposalId !== proposalId));
    pushNotice('Trade vetoed by the commissioner.', 'info');
  }, [pushNotice, setPendingTrades]);

  const handleFreeAgencyAssignment = useCallback(async (
    assignment: FreeAgencyAssignment,
  ) => {
    if (!isFreeAgencyMarketOpen) {
      pushNotice(
        freeAgencyMarketStatusMessage || `Free agency is closed until ${freeAgencyOpenDate}.`,
        'warning',
      );
      return;
    }

    const freeAgent = playerState.players.find((player) => player.playerId === assignment.playerId) ?? null;
    const team = teams.find((candidate) => candidate.id === assignment.teamId) ?? null;
    if (!freeAgent || !team) {
      pushNotice('Free-agency assignment could not be completed.', 'error');
      return;
    }

    const effectiveDate = resolveEffectiveActionDate(currentDate, selectedDate, games);
    const seasonYear = resolveSeasonYear(currentDate, games);
    const newContractYearsLeft = assignment.contractYearsLeft > 0
      ? assignment.contractYearsLeft
      : getGeneratedContractYearsLeft('active', freeAgent.age, Math.random);
    const existingSlot = playerState.rosterSlots.find((slot) => slot.teamId === assignment.teamId && slot.slotCode === assignment.slotCode) ?? null;
    const displacedPlayer = existingSlot
      ? playerState.players.find((player) => player.playerId === existingSlot.playerId) ?? null
      : null;

    const nextPlayers = playerState.players.map((player) => {
      if (player.playerId === assignment.playerId) {
        return { ...player, teamId: assignment.teamId, status: 'active' as const, contractYearsLeft: newContractYearsLeft };
      }
      if (displacedPlayer && player.playerId === displacedPlayer.playerId) {
        return { ...player, teamId: null, status: 'free_agent' as const, contractYearsLeft: 0 };
      }
      return { ...player };
    });

    const preservedSlots = playerState.rosterSlots
      .filter((slot) => slot.playerId !== assignment.playerId)
      .map((slot) => {
        if (slot.teamId === assignment.teamId && slot.slotCode === assignment.slotCode) {
          return { ...slot, playerId: assignment.playerId, seasonYear };
        }
        return { ...slot };
      });

    const hasUpdatedSlot = preservedSlots.some((slot) => slot.teamId === assignment.teamId && slot.slotCode === assignment.slotCode);
    const nextRosterSlots = hasUpdatedSlot
      ? preservedSlots
      : [
          ...preservedSlots,
          {
            seasonYear,
            teamId: assignment.teamId,
            slotCode: assignment.slotCode,
            playerId: assignment.playerId,
          },
        ];

    const repairedRoster = repairRosterSlotsForTeams(
      {
        ...playerState,
        players: nextPlayers,
        battingStats: playerState.battingStats,
        pitchingStats: playerState.pitchingStats,
        battingRatings: playerState.battingRatings,
        pitchingRatings: playerState.pitchingRatings,
        rosterSlots: nextRosterSlots,
        transactions: [],
      },
      [assignment.teamId],
      seasonYear,
    );

    const nextTransactions = [
      {
        playerId: assignment.playerId,
        eventType: 'signed' as const,
        fromTeamId: assignment.isQualifyingOffer ? assignment.teamId : null,
        toTeamId: assignment.teamId,
        effectiveDate,
        notes: assignment.isQualifyingOffer
          ? `${team.city} retained first-dibs rights and signed into ${assignment.slotCode}.`
          : `${team.city} signed into ${assignment.slotCode}.`,
      },
      ...repairedRoster.promotions.map((promotion) => ({
        playerId: promotion.playerId,
        eventType: 'promoted' as const,
        fromTeamId: promotion.teamId,
        toTeamId: promotion.teamId,
        effectiveDate,
        notes: `Auto-promoted from ${promotion.fromSlot ?? 'unassigned'} to ${promotion.toSlot} after free-agency signing.`,
      })),
      ...playerState.transactions.map((transaction) => ({ ...transaction })),
    ];

    if (displacedPlayer) {
      nextTransactions.unshift({
        playerId: displacedPlayer.playerId,
        eventType: 'released' as const,
        fromTeamId: assignment.teamId,
        toTeamId: null,
        effectiveDate,
        notes: `${displacedPlayer.firstName} ${displacedPlayer.lastName} lost the ${assignment.slotCode} spot.`,
      });
    }

    const nextPlayerState: LeaguePlayerState = {
      ...playerState,
      players: nextPlayers,
      ...clonePlayerStatsAndRatings(playerState),
      rosterSlots: repairedRoster.rosterSlots,
      transactions: nextTransactions,
    };

    setPlayerState(nextPlayerState);
    setSelectedTeamId(assignment.teamId);
    saveLocalPlayerStateSafely(nextPlayerState);

    try {
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }

      pushNotice(
        displacedPlayer
          ? `${freeAgent.firstName} ${freeAgent.lastName} signed with ${team.city} and replaced ${displacedPlayer.firstName} ${displacedPlayer.lastName}.`
          : `${freeAgent.firstName} ${freeAgent.lastName} signed with ${team.city}.`,
        'success',
      );
    } catch (error) {
      console.error('Failed to persist free-agency assignment:', error);
      pushNotice('Free-agent assignment completed locally, but syncing player data failed.', 'warning');
    }
  }, [
    currentDate,
    freeAgencyMarketStatusMessage,
    isFreeAgencyMarketOpen,
    freeAgencyOpenDate,
    games,
    isSupabaseConfigured,
    playerState,
    pushNotice,
    resolveEffectiveActionDate,
    resolveSeasonYear,
    saveLocalPlayerStateSafely,
    saveSupabasePlayerState,
    selectedDate,
    setPlayerState,
    setSelectedTeamId,
    teams,
  ]);

  return {
    handleTradeProposal,
    handleApprovePendingTrade,
    handleVetoPendingTrade,
    handleFreeAgencyAssignment,
  };
};
