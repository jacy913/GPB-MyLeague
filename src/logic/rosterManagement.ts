import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  CoreRosterSlotCode,
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  RESERVE_ROSTER_SLOTS,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  TeamRosterSlot,
} from '../types';

type RosterPromotion = {
  teamId: string;
  playerId: string;
  fromSlot: RosterSlotCode | null;
  toSlot: CoreRosterSlotCode;
};

type RosterRepairResult = {
  rosterSlots: TeamRosterSlot[];
  promotions: RosterPromotion[];
  battingCoverageByTeamId: Record<string, number>;
};

const DH_FIT_POSITIONS = new Set(['DH', '1B', 'LF', 'RF', '3B', 'C']);

const getLatestSeasonYear = (rosterSlots: TeamRosterSlot[], fallbackYear: number): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : fallbackYear;

const createLatestBattingRatingsMap = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
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

const createLatestPitchingRatingsMap = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
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
): number =>
  battingRatingsByPlayerId.get(player.playerId)?.overall ??
  pitchingRatingsByPlayerId.get(player.playerId)?.overall ??
  0;

const hasPositionMatch = (player: Player, position: string): boolean =>
  player.primaryPosition === position || player.secondaryPosition === position;

const scoreBatterForSlot = (
  player: Player,
  slotCode: typeof BATTING_ROSTER_SLOTS[number],
  overall: number,
  currentSlot: RosterSlotCode | null,
): number => {
  if (player.playerType !== 'batter') {
    return Number.NEGATIVE_INFINITY;
  }

  let score = overall * 16;
  if (slotCode === 'DH') {
    if (player.primaryPosition === 'DH') score += 180;
    if (DH_FIT_POSITIONS.has(player.primaryPosition)) score += 120;
    if (player.secondaryPosition && DH_FIT_POSITIONS.has(player.secondaryPosition)) score += 70;
  } else {
    if (player.primaryPosition === slotCode) score += 220;
    else if (player.secondaryPosition === slotCode) score += 120;
    else score += 35;
  }

  if (currentSlot === slotCode) score += 45;
  else if (currentSlot && currentSlot.startsWith('BN')) score += 10;

  return score;
};

const scorePitcherForSlot = (
  player: Player,
  slotCode: Exclude<CoreRosterSlotCode, typeof BATTING_ROSTER_SLOTS[number]>,
  overall: number,
  currentSlot: RosterSlotCode | null,
): number => {
  if (player.playerType !== 'pitcher') {
    return Number.NEGATIVE_INFINITY;
  }

  let score = overall * 16;
  if (slotCode.startsWith('SP')) {
    if (player.primaryPosition === 'SP') score += 240;
    else if (player.secondaryPosition === 'SP') score += 120;
    else if (player.primaryPosition === 'RP') score += 70;
    else if (player.primaryPosition === 'CL') score += 55;
  } else if (slotCode === 'CL') {
    if (player.primaryPosition === 'CL') score += 220;
    else if (player.primaryPosition === 'RP') score += 150;
    else if (player.secondaryPosition === 'CL') score += 90;
    else if (player.primaryPosition === 'SP') score += 45;
  } else {
    if (player.primaryPosition === 'RP') score += 180;
    else if (player.primaryPosition === 'CL') score += 140;
    else if (player.secondaryPosition === 'RP') score += 90;
    else if (player.primaryPosition === 'SP') score += 65;
  }

  if (currentSlot === slotCode) score += 45;
  else if (currentSlot && currentSlot.startsWith('BN')) score += 10;

  return score;
};

const scoreReservePlayer = (
  player: Player,
  overall: number,
  currentSlot: RosterSlotCode | null,
  reserveSlot: typeof RESERVE_ROSTER_SLOTS[number],
): number => {
  let score = overall * 12;
  if (currentSlot === reserveSlot) score += 40;
  else if (currentSlot && currentSlot.startsWith('BN')) score += 25;
  return score;
};

const assignBestPlayer = (
  slotCode: RosterSlotCode,
  availablePlayers: Player[],
  currentSlotByPlayerId: Map<string, RosterSlotCode>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): Player | null => {
  let bestPlayer: Player | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  availablePlayers.forEach((player) => {
    const currentSlot = currentSlotByPlayerId.get(player.playerId) ?? null;
    const overall = getPlayerOverall(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
    const score = BATTING_ROSTER_SLOTS.includes(slotCode as typeof BATTING_ROSTER_SLOTS[number])
      ? scoreBatterForSlot(player, slotCode as typeof BATTING_ROSTER_SLOTS[number], overall, currentSlot)
      : STARTING_PITCHER_SLOTS.includes(slotCode as typeof STARTING_PITCHER_SLOTS[number]) ||
          BULLPEN_ROSTER_SLOTS.includes(slotCode as typeof BULLPEN_ROSTER_SLOTS[number])
        ? scorePitcherForSlot(player, slotCode as Exclude<CoreRosterSlotCode, typeof BATTING_ROSTER_SLOTS[number]>, overall, currentSlot)
        : scoreReservePlayer(player, overall, currentSlot, slotCode as typeof RESERVE_ROSTER_SLOTS[number]);

    if (score > bestScore) {
      bestScore = score;
      bestPlayer = player;
    }
  });

  return bestPlayer;
};

const buildRepairedTeamSlots = (
  playerState: LeaguePlayerState,
  teamId: string,
  seasonYear: number,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): { rosterSlots: TeamRosterSlot[]; promotions: RosterPromotion[]; battingCoverage: number } => {
  const teamPlayers = playerState.players.filter((player) => player.teamId === teamId && player.status === 'active');
  const currentTeamSlots = playerState.rosterSlots.filter((slot) => slot.seasonYear === seasonYear && slot.teamId === teamId);
  const currentSlotByPlayerId = new Map(currentTeamSlots.map((slot) => [slot.playerId, slot.slotCode]));
  const availablePlayers = [...teamPlayers];
  const assignedSlots: TeamRosterSlot[] = [];
  const promotions: RosterPromotion[] = [];

  const claimPlayer = (slotCode: RosterSlotCode): void => {
    const chosen = assignBestPlayer(
      slotCode,
      availablePlayers,
      currentSlotByPlayerId,
      battingRatingsByPlayerId,
      pitchingRatingsByPlayerId,
    );

    if (!chosen) {
      return;
    }

    assignedSlots.push({
      seasonYear,
      teamId,
      slotCode,
      playerId: chosen.playerId,
    });

    const currentSlot = currentSlotByPlayerId.get(chosen.playerId) ?? null;
    if (currentSlot && currentSlot.startsWith('BN') && !slotCode.startsWith('BN')) {
      promotions.push({
        teamId,
        playerId: chosen.playerId,
        fromSlot: currentSlot,
        toSlot: slotCode as CoreRosterSlotCode,
      });
    }

    const chosenIndex = availablePlayers.findIndex((player) => player.playerId === chosen.playerId);
    if (chosenIndex >= 0) {
      availablePlayers.splice(chosenIndex, 1);
    }
  };

  BATTING_ROSTER_SLOTS.forEach(claimPlayer);
  STARTING_PITCHER_SLOTS.forEach(claimPlayer);
  BULLPEN_ROSTER_SLOTS.forEach(claimPlayer);
  RESERVE_ROSTER_SLOTS.forEach(claimPlayer);

  const battingCoverage = assignedSlots.filter((slot) => BATTING_ROSTER_SLOTS.includes(slot.slotCode as typeof BATTING_ROSTER_SLOTS[number])).length;

  return { rosterSlots: assignedSlots, promotions, battingCoverage };
};

export const repairRosterSlotsForTeams = (
  playerState: LeaguePlayerState,
  teamIds: string[],
  fallbackSeasonYear = new Date().getUTCFullYear(),
): RosterRepairResult => {
  const uniqueTeamIds = Array.from(new Set(teamIds.filter(Boolean)));
  if (uniqueTeamIds.length === 0) {
    return {
      rosterSlots: playerState.rosterSlots.map((slot) => ({ ...slot })),
      promotions: [],
      battingCoverageByTeamId: {},
    };
  }

  const seasonYear = getLatestSeasonYear(playerState.rosterSlots, fallbackSeasonYear);
  const teamIdSet = new Set(uniqueTeamIds);
  const battingRatingsByPlayerId = createLatestBattingRatingsMap(playerState.battingRatings);
  const pitchingRatingsByPlayerId = createLatestPitchingRatingsMap(playerState.pitchingRatings);
  const preservedSlots = playerState.rosterSlots
    .filter((slot) => slot.seasonYear !== seasonYear || !teamIdSet.has(slot.teamId))
    .map((slot) => ({ ...slot }));

  const battingCoverageByTeamId: Record<string, number> = {};
  const promotions: RosterPromotion[] = [];
  const repairedSlots = uniqueTeamIds.flatMap((teamId) => {
    const result = buildRepairedTeamSlots(playerState, teamId, seasonYear, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
    battingCoverageByTeamId[teamId] = result.battingCoverage;
    promotions.push(...result.promotions);
    return result.rosterSlots;
  });

  return {
    rosterSlots: [...preservedSlots, ...repairedSlots],
    promotions,
    battingCoverageByTeamId,
  };
};
