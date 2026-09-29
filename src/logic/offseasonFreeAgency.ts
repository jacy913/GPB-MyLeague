import {
  BULLPEN_ROSTER_SLOTS,
  CORE_ROSTER_SLOTS,
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerTransaction,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
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
  agedPlayers: number;
  retiredPlayers: number;
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
  skipAgeAndRetirements?: boolean;
}

export interface OffseasonRetirementResult {
  nextPlayerState: LeaguePlayerState;
  agedPlayers: number;
  retiredPlayers: number;
}

const QUALIFYING_OFFER_YEARS = 1;
const MIN_AUTONOMOUS_OFFER_INTEREST = 72;
const OFFSEASON_META_PREFIX = '[offseason_meta:';
const OFFSEASON_META_SUFFIX = ']';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const stableRoll = (key: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

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

const getLatestBattingStats = (stats: PlayerSeasonBatting[], seasonYear: number): Map<string, PlayerSeasonBatting> =>
  new Map(
    stats
      .filter((stat) => stat.seasonPhase === 'regular_season' && stat.seasonYear <= seasonYear)
      .sort((left, right) => right.seasonYear - left.seasonYear)
      .map((stat) => [stat.playerId, stat] as const),
  );

const getLatestPitchingStats = (stats: PlayerSeasonPitching[], seasonYear: number): Map<string, PlayerSeasonPitching> =>
  new Map(
    stats
      .filter((stat) => stat.seasonPhase === 'regular_season' && stat.seasonYear <= seasonYear)
      .sort((left, right) => right.seasonYear - left.seasonYear)
      .map((stat) => [stat.playerId, stat] as const),
  );

const getRecentUsage = (
  player: Player,
  battingStatsByPlayerId: Map<string, PlayerSeasonBatting>,
  pitchingStatsByPlayerId: Map<string, PlayerSeasonPitching>,
): number => {
  if (player.playerType === 'batter') {
    return battingStatsByPlayerId.get(player.playerId)?.plateAppearances ?? 0;
  }
  return pitchingStatsByPlayerId.get(player.playerId)?.inningsPitched ?? 0;
};

const getRetirementChance = (player: Player, overall: number, recentUsage: number, wasRostered: boolean): number => {
  if (player.status === 'retired' || player.status === 'prospect' || player.age < 30) {
    return 0;
  }

  let chance = 0;
  if (player.age >= 42) chance = 0.62;
  else if (player.age >= 40) chance = 0.42;
  else if (player.age >= 38) chance = 0.24;
  else if (player.age >= 35) chance = 0.1;
  else chance = 0.02;

  chance += Math.max(0, player.yearsPro - 14) * 0.018;
  chance += Math.max(0, 72 - overall) * 0.012;
  // Only a player who was actually on a roster can be "underused". A free agent
  // with no plate appearances was not benched, they were unsigned, and treating
  // that as reduced usage charged them for a season the roster pipeline failed to
  // give them. Unsigned players are bounded separately by the free-agent age-out.
  if (wasRostered && recentUsage < (player.playerType === 'batter' ? 90 : 20)) {
    chance += 0.08;
  }
  if (overall >= 86) chance -= 0.18;
  else if (overall >= 80) chance -= 0.1;

  return clamp(chance, 0, player.age >= 38 ? 0.72 : 0.28);
};

const getCandidateSlots = (player: Player): RosterSlotCode[] => {
  if (player.primaryPosition === 'SP') return [...STARTING_PITCHER_SLOTS];
  if (player.primaryPosition === 'RP') return BULLPEN_ROSTER_SLOTS.filter((slot) => slot !== 'CL');
  if (player.primaryPosition === 'CL') return ['CL'];
  return [player.primaryPosition];
};

const getLatestRosterSeasonYear = (rosterSlots: TeamRosterSlot[], fallbackYear: number): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : fallbackYear;

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0.5;
};

const getGeneratedContractYears = (player: Player, overall: number): number => {
  if (player.age <= 24) return overall >= 80 ? 5 : 4;
  if (player.age <= 29) return overall >= 78 ? 4 : 3;
  if (player.age <= 34) return overall >= 80 ? 3 : 2;
  return 1;
};

export interface AutonomousFreeAgencySummary {
  seasonYear: number;
  signings: number;
  displacedPlayers: number;
  summaries: string[];
}

export interface AutonomousFreeAgencyResult {
  nextPlayerState: LeaguePlayerState;
  summary: AutonomousFreeAgencySummary;
}

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

/** Ages the league and resolves retirements as a standalone checklist event. */
export const applyOffseasonRetirements = ({
  playerState,
  seasonYear,
  effectiveDate,
}: Omit<ApplyOffseasonRolloverArgs, 'teams' | 'rng' | 'skipAgeAndRetirements'>): OffseasonRetirementResult => {
  const battingRatingsByPlayerId = getLatestBattingRatings(playerState.battingRatings);
  const pitchingRatingsByPlayerId = getLatestPitchingRatings(playerState.pitchingRatings);
  const battingStatsByPlayerId = getLatestBattingStats(playerState.battingStats, seasonYear);
  const pitchingStatsByPlayerId = getLatestPitchingStats(playerState.pitchingStats, seasonYear);
  let agedPlayers = 0;
  let retiredPlayers = 0;
  const retiredPlayerIds = new Set<string>();
  const transactions: PlayerTransaction[] = [];
  // yearsPro is years of service, so it may only advance for a player who
  // occupied a roster slot in the season that just finished. Counting offseason
  // time instead let unsigned free agents bank service they never performed:
  // median yearsPro at retirement reached 11 with a p90 of 17, against a median
  // of one season actually spent on a roster. That fed straight into
  // getRetirementChance, which adds a service-based penalty above 14 years, so
  // the longer a good player sat unsigned the more likely the model was to age
  // him out -- pushing out exactly the players the retirement curve is supposed
  // to protect.
  const rosteredPlayerIds = new Set(
    playerState.rosterSlots.filter((slot) => slot.seasonYear === seasonYear).map((slot) => slot.playerId),
  );
  const players = playerState.players.map((player) => {
    if (player.status === 'retired') return { ...player };
    const wasRostered = rosteredPlayerIds.has(player.playerId);
    const agedPlayer = {
      ...player,
      age: player.age + 1,
      yearsPro: wasRostered ? player.yearsPro + 1 : player.yearsPro,
    };
    agedPlayers += 1;
    const overall = getPlayerOverall(agedPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
    const usage = getRecentUsage(agedPlayer, battingStatsByPlayerId, pitchingStatsByPlayerId);
    if (stableRoll(`${agedPlayer.playerId}:${seasonYear}:retirement`) >= getRetirementChance(agedPlayer, overall, usage, wasRostered)) {
      return agedPlayer;
    }
    retiredPlayers += 1;
    retiredPlayerIds.add(agedPlayer.playerId);
    transactions.push({
      playerId: agedPlayer.playerId, eventType: 'retired', fromTeamId: agedPlayer.teamId, toTeamId: null, effectiveDate,
      notes: `${agedPlayer.firstName} ${agedPlayer.lastName} retired after age-${agedPlayer.age} season.`,
    });
    return { ...agedPlayer, teamId: null, status: 'retired' as const, contractYearsLeft: 0, retirementYear: seasonYear };
  });
  return {
    nextPlayerState: {
      ...playerState,
      players,
      rosterSlots: playerState.rosterSlots.filter((slot) => !retiredPlayerIds.has(slot.playerId)).map((slot) => ({ ...slot })),
      transactions: [...transactions, ...playerState.transactions.map((transaction) => ({ ...transaction }))],
    },
    agedPlayers,
    retiredPlayers,
  };
};

export const applyOffseasonFreeAgencyRollover = ({
  playerState,
  teams,
  seasonYear,
  effectiveDate,
  rng = Math.random,
  skipAgeAndRetirements = false,
}: ApplyOffseasonRolloverArgs): OffseasonRolloverResult => {
  const battingRatingsByPlayerId = getLatestBattingRatings(playerState.battingRatings);
  const pitchingRatingsByPlayerId = getLatestPitchingRatings(playerState.pitchingRatings);
  const battingStatsByPlayerId = getLatestBattingStats(playerState.battingStats, seasonYear);
  const pitchingStatsByPlayerId = getLatestPitchingStats(playerState.pitchingStats, seasonYear);
  const teamIds = new Set(teams.map((team) => team.id));

  let agedPlayers = 0;
  let retiredPlayers = 0;
  let decrementedContracts = 0;
  let releasedToMarket = 0;
  let qualifyingOffersMade = 0;
  let qualifyingOffersAccepted = 0;
  let qualifyingOffersDeclined = 0;

  const releasedPlayerIds = new Set<string>();
  const retiredPlayerIds = new Set<string>();
  const offseasonTransactions: PlayerTransaction[] = [];

  // See applyOffseasonRetirements: yearsPro is years of service, so it only
  // advances for a player who held a roster slot in the completed season.
  const rosteredPlayerIds = new Set(
    playerState.rosterSlots.filter((slot) => slot.seasonYear === seasonYear).map((slot) => slot.playerId),
  );

  const nextPlayers = playerState.players.map((player) => {
    if (player.status === 'retired') {
      return { ...player };
    }

    const wasRostered = rosteredPlayerIds.has(player.playerId);
    const agedPlayer = skipAgeAndRetirements ? { ...player } : {
      ...player,
      age: player.age + 1,
      yearsPro: wasRostered ? player.yearsPro + 1 : player.yearsPro,
    };
    if (!skipAgeAndRetirements) agedPlayers += 1;

    const overall = getPlayerOverall(agedPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
    const recentUsage = getRecentUsage(agedPlayer, battingStatsByPlayerId, pitchingStatsByPlayerId);
    const retirementChance = getRetirementChance(agedPlayer, overall, recentUsage, wasRostered);
    const shouldRetire = !skipAgeAndRetirements && stableRoll(`${agedPlayer.playerId}:${seasonYear}:retirement`) < retirementChance;
    if (shouldRetire) {
      retiredPlayers += 1;
      retiredPlayerIds.add(agedPlayer.playerId);
      offseasonTransactions.push({
        playerId: agedPlayer.playerId,
        eventType: 'retired',
        fromTeamId: agedPlayer.teamId,
        toTeamId: null,
        effectiveDate,
        notes: `${agedPlayer.firstName} ${agedPlayer.lastName} retired after age-${agedPlayer.age} season.`,
      });
      return {
        ...agedPlayer,
        teamId: null,
        status: 'retired' as const,
        contractYearsLeft: 0,
        retirementYear: seasonYear,
      };
    }

    if (agedPlayer.status !== 'active' || !agedPlayer.teamId || !teamIds.has(agedPlayer.teamId)) {
      return agedPlayer;
    }

    const nextContractYears = Math.max(0, agedPlayer.contractYearsLeft - 1);
    if (nextContractYears !== agedPlayer.contractYearsLeft) {
      decrementedContracts += 1;
    }

    if (nextContractYears > 0) {
      return {
        ...agedPlayer,
        contractYearsLeft: nextContractYears,
      };
    }

    const qoOffered = rng() < getQualifyingOfferChance(overall, agedPlayer.age);

    if (!qoOffered) {
      releasedToMarket += 1;
      releasedPlayerIds.add(agedPlayer.playerId);
      offseasonTransactions.push({
        playerId: agedPlayer.playerId,
        eventType: 'released',
        fromTeamId: agedPlayer.teamId,
        toTeamId: null,
        effectiveDate,
        notes: withOffseasonMeta(
          `Contract expired. ${agedPlayer.firstName} ${agedPlayer.lastName} reached free agency.`,
          {
            seasonYear,
            qoDecision: 'none',
            qoTeamId: null,
            qoYears: null,
          },
        ),
      });
      return {
        ...agedPlayer,
        teamId: null,
        status: 'free_agent' as const,
        contractYearsLeft: 0,
      };
    }

    qualifyingOffersMade += 1;
    const acceptedOffer = rng() < getQualifyingOfferAcceptanceChance(overall, agedPlayer.age);

    if (acceptedOffer) {
      qualifyingOffersAccepted += 1;
      offseasonTransactions.push({
        playerId: agedPlayer.playerId,
        eventType: 'signed',
        fromTeamId: agedPlayer.teamId,
        toTeamId: agedPlayer.teamId,
        effectiveDate,
        notes: withOffseasonMeta(
          `${agedPlayer.firstName} ${agedPlayer.lastName} accepted a qualifying offer.`,
          {
            seasonYear,
            qoDecision: 'accepted',
            qoTeamId: agedPlayer.teamId,
            qoYears: QUALIFYING_OFFER_YEARS,
          },
        ),
      });
      return {
        ...agedPlayer,
        contractYearsLeft: QUALIFYING_OFFER_YEARS,
      };
    }

    qualifyingOffersDeclined += 1;
    releasedToMarket += 1;
    releasedPlayerIds.add(agedPlayer.playerId);
    offseasonTransactions.push({
      playerId: agedPlayer.playerId,
      eventType: 'released',
      fromTeamId: agedPlayer.teamId,
      toTeamId: null,
      effectiveDate,
      notes: withOffseasonMeta(
        `${agedPlayer.firstName} ${agedPlayer.lastName} declined a qualifying offer and entered free agency.`,
        {
          seasonYear,
          qoDecision: 'declined',
          qoTeamId: agedPlayer.teamId,
          qoYears: QUALIFYING_OFFER_YEARS,
        },
      ),
    });

    return {
      ...agedPlayer,
      teamId: null,
      status: 'free_agent' as const,
      contractYearsLeft: 0,
    };
  });

  const nextRosterSlots = playerState.rosterSlots
    .filter((slot) => !releasedPlayerIds.has(slot.playerId) && !retiredPlayerIds.has(slot.playerId))
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
      agedPlayers,
      retiredPlayers,
      decrementedContracts,
      releasedToMarket,
      qualifyingOffersMade,
      qualifyingOffersAccepted,
      qualifyingOffersDeclined,
    },
  };
};
