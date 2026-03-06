import {
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerTransaction,
  Team,
} from '../types';

type QualifyingOfferDecision = 'accepted' | 'declined' | 'none';

export interface OffseasonMeta {
  seasonYear: number;
  qoDecision: QualifyingOfferDecision;
  qoTeamId: string | null;
  qoYears: number | null;
}

export interface OffseasonRolloverSummary {
  seasonYear: number;
  decrementedContracts: number;
  releasedToMarket: number;
  qualifyingOffersMade: number;
  qualifyingOffersAccepted: number;
  qualifyingOffersDeclined: number;
}

export interface OffseasonRolloverResult {
  nextPlayerState: LeaguePlayerState;
  summary: OffseasonRolloverSummary;
}

interface ApplyOffseasonRolloverArgs {
  playerState: LeaguePlayerState;
  teams: Team[];
  seasonYear: number;
  effectiveDate: string;
  rng?: () => number;
}

const QUALIFYING_OFFER_YEARS = 1;
const OFFSEASON_META_PREFIX = '[offseason_meta:';
const OFFSEASON_META_SUFFIX = ']';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const getLatestBattingRatings = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const next = new Map<string, PlayerBattingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) {
        next.set(rating.playerId, rating);
      }
    });
  return next;
};

const getLatestPitchingRatings = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const next = new Map<string, PlayerPitchingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) {
        next.set(rating.playerId, rating);
      }
    });
  return next;
};

const getPlayerOverall = (
  player: Player,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number => battingRatingsByPlayerId.get(player.playerId)?.overall ?? pitchingRatingsByPlayerId.get(player.playerId)?.overall ?? 0;

const getQualifyingOfferChance = (overall: number, age: number): number => {
  let chance = 0.14;
  if (overall >= 88) chance = 0.96;
  else if (overall >= 84) chance = 0.9;
  else if (overall >= 80) chance = 0.76;
  else if (overall >= 76) chance = 0.58;
  else if (overall >= 72) chance = 0.38;

  if (age <= 27) chance += 0.05;
  if (age >= 34) chance -= 0.14;

  return clamp(chance, 0.08, 0.98);
};

const getQualifyingOfferAcceptanceChance = (overall: number, age: number): number => {
  let chance = 0.62;
  chance -= Math.max(0, overall - 78) * 0.018;
  chance += Math.max(0, age - 31) * 0.03;
  if (overall < 72) chance += 0.08;
  if (age <= 27 && overall >= 80) chance -= 0.08;
  return clamp(chance, 0.16, 0.88);
};

const buildOffseasonMetaTag = (meta: OffseasonMeta): string => {
  const qoTeamIdValue = meta.qoTeamId ?? '';
  const qoYearsValue = typeof meta.qoYears === 'number' && Number.isFinite(meta.qoYears) ? String(meta.qoYears) : '';
  return `${OFFSEASON_META_PREFIX}seasonYear=${meta.seasonYear},qoDecision=${meta.qoDecision},qoTeamId=${qoTeamIdValue},qoYears=${qoYearsValue}${OFFSEASON_META_SUFFIX}`;
};

const withOffseasonMeta = (note: string, meta: OffseasonMeta): string => `${note} ${buildOffseasonMetaTag(meta)}`;

export const parseOffseasonMeta = (notes: string | null | undefined): OffseasonMeta | null => {
  if (!notes) {
    return null;
  }

  const escapedPrefix = OFFSEASON_META_PREFIX.replace('[', '\\[');
  const escapedSuffix = OFFSEASON_META_SUFFIX.replace(']', '\\]');
  const regex = new RegExp(`${escapedPrefix}([^\\]]+)${escapedSuffix}`, 'i');
  const match = notes.match(regex);
  if (!match?.[1]) {
    return null;
  }

  const keyValueMap = new Map<string, string>();
  match[1].split(',').forEach((chunk) => {
    const [rawKey, rawValue] = chunk.split('=');
    const key = (rawKey ?? '').trim();
    if (!key) {
      return;
    }
    keyValueMap.set(key, (rawValue ?? '').trim());
  });

  const seasonYear = Number(keyValueMap.get('seasonYear'));
  if (!Number.isFinite(seasonYear) || seasonYear <= 0) {
    return null;
  }

  const qoDecisionRaw = keyValueMap.get('qoDecision');
  const qoDecision: QualifyingOfferDecision =
    qoDecisionRaw === 'accepted' || qoDecisionRaw === 'declined' || qoDecisionRaw === 'none'
      ? qoDecisionRaw
      : 'none';

  const qoTeamIdRaw = keyValueMap.get('qoTeamId');
  const qoTeamId = qoTeamIdRaw ? qoTeamIdRaw : null;

  const qoYearsRaw = Number(keyValueMap.get('qoYears'));
  const qoYears = Number.isFinite(qoYearsRaw) && qoYearsRaw > 0 ? Math.round(qoYearsRaw) : null;

  return {
    seasonYear: Math.round(seasonYear),
    qoDecision,
    qoTeamId,
    qoYears,
  };
};

export const applyOffseasonFreeAgencyRollover = ({
  playerState,
  teams,
  seasonYear,
  effectiveDate,
  rng = Math.random,
}: ApplyOffseasonRolloverArgs): OffseasonRolloverResult => {
  const battingRatingsByPlayerId = getLatestBattingRatings(playerState.battingRatings);
  const pitchingRatingsByPlayerId = getLatestPitchingRatings(playerState.pitchingRatings);
  const teamIds = new Set(teams.map((team) => team.id));

  let decrementedContracts = 0;
  let releasedToMarket = 0;
  let qualifyingOffersMade = 0;
  let qualifyingOffersAccepted = 0;
  let qualifyingOffersDeclined = 0;

  const releasedPlayerIds = new Set<string>();
  const offseasonTransactions: PlayerTransaction[] = [];

  const nextPlayers = playerState.players.map((player) => {
    if (player.status !== 'active' || !player.teamId || !teamIds.has(player.teamId)) {
      return { ...player };
    }

    const nextContractYears = Math.max(0, player.contractYearsLeft - 1);
    if (nextContractYears !== player.contractYearsLeft) {
      decrementedContracts += 1;
    }

    if (nextContractYears > 0) {
      return {
        ...player,
        contractYearsLeft: nextContractYears,
      };
    }

    const overall = getPlayerOverall(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
    const qoOffered = rng() < getQualifyingOfferChance(overall, player.age);

    if (!qoOffered) {
      releasedToMarket += 1;
      releasedPlayerIds.add(player.playerId);
      offseasonTransactions.push({
        playerId: player.playerId,
        eventType: 'released',
        fromTeamId: player.teamId,
        toTeamId: null,
        effectiveDate,
        notes: withOffseasonMeta(
          `Contract expired. ${player.firstName} ${player.lastName} reached free agency.`,
          {
            seasonYear,
            qoDecision: 'none',
            qoTeamId: null,
            qoYears: null,
          },
        ),
      });
      return {
        ...player,
        teamId: null,
        status: 'free_agent' as const,
        contractYearsLeft: 0,
      };
    }

    qualifyingOffersMade += 1;
    const acceptedOffer = rng() < getQualifyingOfferAcceptanceChance(overall, player.age);

    if (acceptedOffer) {
      qualifyingOffersAccepted += 1;
      offseasonTransactions.push({
        playerId: player.playerId,
        eventType: 'signed',
        fromTeamId: player.teamId,
        toTeamId: player.teamId,
        effectiveDate,
        notes: withOffseasonMeta(
          `${player.firstName} ${player.lastName} accepted a qualifying offer.`,
          {
            seasonYear,
            qoDecision: 'accepted',
            qoTeamId: player.teamId,
            qoYears: QUALIFYING_OFFER_YEARS,
          },
        ),
      });
      return {
        ...player,
        contractYearsLeft: QUALIFYING_OFFER_YEARS,
      };
    }

    qualifyingOffersDeclined += 1;
    releasedToMarket += 1;
    releasedPlayerIds.add(player.playerId);
    offseasonTransactions.push({
      playerId: player.playerId,
      eventType: 'released',
      fromTeamId: player.teamId,
      toTeamId: null,
      effectiveDate,
      notes: withOffseasonMeta(
        `${player.firstName} ${player.lastName} declined a qualifying offer and entered free agency.`,
        {
          seasonYear,
          qoDecision: 'declined',
          qoTeamId: player.teamId,
          qoYears: QUALIFYING_OFFER_YEARS,
        },
      ),
    });

    return {
      ...player,
      teamId: null,
      status: 'free_agent' as const,
      contractYearsLeft: 0,
    };
  });

  const nextRosterSlots = playerState.rosterSlots
    .filter((slot) => !releasedPlayerIds.has(slot.playerId))
    .map((slot) => ({ ...slot }));

  return {
    nextPlayerState: {
      ...playerState,
      players: nextPlayers,
      battingStats: playerState.battingStats.map((stat) => ({ ...stat })),
      pitchingStats: playerState.pitchingStats.map((stat) => ({ ...stat })),
      battingRatings: playerState.battingRatings.map((rating) => ({ ...rating })),
      pitchingRatings: playerState.pitchingRatings.map((rating) => ({ ...rating })),
      rosterSlots: nextRosterSlots,
      transactions: [
        ...offseasonTransactions,
        ...playerState.transactions.map((transaction) => ({ ...transaction })),
      ],
    },
    summary: {
      seasonYear,
      decrementedContracts,
      releasedToMarket,
      qualifyingOffersMade,
      qualifyingOffersAccepted,
      qualifyingOffersDeclined,
    },
  };
};
