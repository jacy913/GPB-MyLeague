import {
  BATTING_ROSTER_SLOTS,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerPosition,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerType,
  RESERVE_ROSTER_SLOTS,
  STARTING_PITCHER_SLOTS,
  RELIEF_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
  LeaguePlayerState,
} from '../types';
import { generateDraftClass } from './playerGenerator';
import { repairRosterSlotsForTeams } from './rosterManagement';

export const DRAFT_ROUNDS = 4;
export const DRAFT_CLASS_SIZE = 160;
export const DRAFT_LOTTERY_TEAM_COUNT = 16;

type ProspectRatings = PlayerBattingRatings | PlayerPitchingRatings;

interface DraftBoardEntry {
  playerId: string;
  firstName: string;
  lastName: string;
  age: number;
  playerType: PlayerType;
  primaryPosition: PlayerPosition;
  overall: number;
  potentialOverall: number;
  archetype: string;
  boardScore: number;
  ratings: ProspectRatings;
}

export interface DraftProspect {
  playerId: string;
  firstName: string;
  lastName: string;
  age: number;
  playerType: PlayerType;
  primaryPosition: PlayerPosition;
  overall: number;
  potentialOverall: number;
  archetype: string;
  projectedRound: number;
}

export interface DraftPickRecord {
  draftId: string;
  seasonYear: number;
  round: number;
  pickInRound: number;
  overallPick: number;
  teamId: string;
  playerId: string;
  playerName: string;
  playerType: PlayerType;
  primaryPosition: PlayerPosition;
  age: number;
  overall: number;
  potentialOverall: number;
  waivedPlayerId: string | null;
  waivedPlayerName: string | null;
  date: string;
}

export interface DraftClassState {
  draftId: string;
  seasonYear: number;
  createdAt: string;
  draftOrder: string[];
  totalPicks: number;
  prospects: DraftProspect[];
  picks: DraftPickRecord[];
  isComplete: boolean;
}

export interface DraftHistoryEntry {
  draftId: string;
  seasonYear: number;
  completedAt: string;
  pickCount: number;
  picks: DraftPickRecord[];
}

export interface DraftClassBundle {
  prospects: DraftProspect[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
}

export interface DraftStepResult {
  draftClass: DraftClassState;
  playerState: LeaguePlayerState;
  pick: DraftPickRecord;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;
const createDraftId = (): string => `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const batterOverall = (ratings: Omit<PlayerBattingRatings, 'playerId' | 'seasonYear' | 'overall' | 'potentialOverall'>): number =>
  Math.round(
    ratings.contact * 0.22 +
    ratings.power * 0.2 +
    ratings.plateDiscipline * 0.12 +
    ratings.avoidStrikeout * 0.11 +
    ratings.speed * 0.11 +
    ratings.baserunning * 0.09 +
    ratings.fielding * 0.1 +
    ratings.arm * 0.05,
  );

const pitcherOverall = (ratings: Omit<PlayerPitchingRatings, 'playerId' | 'seasonYear' | 'overall' | 'potentialOverall'>): number =>
  Math.round(
    ratings.stuff * 0.28 +
    ratings.command * 0.19 +
    ratings.control * 0.17 +
    ratings.movement * 0.17 +
    ratings.stamina * 0.12 +
    ratings.holdRunners * 0.04 +
    ratings.fielding * 0.03,
  );

const getBatterArchetype = (position: PlayerPosition): string => {
  if (position === 'C' || position === 'SS' || position === 'CF') return 'Two-way defender';
  if (position === '1B' || position === 'LF' || position === 'RF' || position === 'DH') return 'Middle-order bat';
  return 'Balanced lineup piece';
};

const getPitcherArchetype = (position: PlayerPosition): string => {
  if (position === 'SP') return 'Starter projection';
  if (position === 'CL') return 'Late-inning stopper';
  return 'Bullpen weapon';
};

const compareTeamsForDraftOrder = (left: Team, right: Team): number => {
  const leftGames = left.wins + left.losses;
  const rightGames = right.wins + right.losses;
  const leftPct = leftGames > 0 ? left.wins / leftGames : 0.5;
  const rightPct = rightGames > 0 ? right.wins / rightGames : 0.5;
  if (leftPct !== rightPct) return leftPct - rightPct;

  const leftDiff = left.runsScored - left.runsAllowed;
  const rightDiff = right.runsScored - right.runsAllowed;
  if (leftDiff !== rightDiff) return leftDiff - rightDiff;

  return left.city.localeCompare(right.city);
};

const shuffleTeams = (teams: Team[]): Team[] => {
  const shuffled = [...teams];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const getDraftOrder = (teams: Team[]): string[] => {
  const orderedTeams = [...teams].sort(compareTeamsForDraftOrder);
  if (orderedTeams.length <= 1) {
    return orderedTeams.map((team) => team.id);
  }

  const lotteryTeamCount = Math.min(DRAFT_LOTTERY_TEAM_COUNT, orderedTeams.length);
  const lotteryPool = orderedTeams.slice(0, lotteryTeamCount);
  const nonLotteryTeams = orderedTeams.slice(lotteryTeamCount);
  const lotteryOrder = shuffleTeams(lotteryPool);

  return [...lotteryOrder, ...nonLotteryTeams].map((team) => team.id);
};

const createBattingProspectRatings = (player: Player, seasonYear: number): PlayerBattingRatings => {
  const ceiling = clamp(player.potential + randomInt(3, 12), 64, 97);
  const base = clamp(Math.round(44 + (ceiling - 55) * 0.62 + randomInt(-6, 5)), 60, 90);
  const ageBoost = clamp(21 - player.age, 0, 4);

  const raw = {
    contact: clamp(base + randomInt(-8, 8), 60, 100),
    power: clamp(base + randomInt(-9, 10), 60, 100),
    plateDiscipline: clamp(base + randomInt(-8, 8), 60, 100),
    avoidStrikeout: clamp(base + randomInt(-7, 9), 60, 100),
    speed: clamp(base + randomInt(-10, 10) + ageBoost, 60, 100),
    baserunning: clamp(base + randomInt(-9, 9) + ageBoost, 60, 100),
    fielding: clamp(base + randomInt(-10, 10), 60, 100),
    arm: clamp(base + randomInt(-10, 10), 60, 100),
  };

  const overall = clamp(batterOverall(raw), 60, 95);
  const potentialOverall = clamp(Math.max(overall + randomInt(6, 16), ceiling), overall + 1, 100);

  return {
    playerId: player.playerId,
    seasonYear,
    ...raw,
    overall,
    potentialOverall,
  };
};

const createPitchingProspectRatings = (player: Player, seasonYear: number): PlayerPitchingRatings => {
  const ceiling = clamp(player.potential + randomInt(4, 12), 65, 98);
  const base = clamp(Math.round(45 + (ceiling - 55) * 0.63 + randomInt(-6, 6)), 60, 92);
  const starterBias = player.primaryPosition === 'SP' ? 6 : player.primaryPosition === 'CL' ? -4 : 0;

  const raw = {
    stuff: clamp(base + randomInt(-8, 10), 60, 100),
    command: clamp(base + randomInt(-9, 9), 60, 100),
    control: clamp(base + randomInt(-9, 9), 60, 100),
    movement: clamp(base + randomInt(-8, 10), 60, 100),
    stamina: clamp(base + starterBias + randomInt(-8, 10), 60, 100),
    holdRunners: clamp(base + randomInt(-8, 8), 60, 100),
    fielding: clamp(base + randomInt(-10, 8), 60, 100),
  };

  const overall = clamp(pitcherOverall(raw), 60, 95);
  const potentialOverall = clamp(Math.max(overall + randomInt(6, 16), ceiling), overall + 1, 100);

  return {
    playerId: player.playerId,
    seasonYear,
    ...raw,
    overall,
    potentialOverall,
  };
};

const createEmptyBattingStats = (playerId: string, seasonYear: number): PlayerSeasonBatting => ({
  playerId,
  seasonYear,
  seasonPhase: 'regular_season',
  gamesPlayed: 0,
  plateAppearances: 0,
  atBats: 0,
  runsScored: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  rbi: 0,
  avg: 0,
  ops: 0,
});

const createEmptyPitchingStats = (playerId: string, seasonYear: number): PlayerSeasonPitching => ({
  playerId,
  seasonYear,
  seasonPhase: 'regular_season',
  wins: 0,
  losses: 0,
  saves: 0,
  games: 0,
  gamesStarted: 0,
  inningsPitched: 0,
  hitsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
  era: 0,
  whip: 0,
});

const tuneDraftBoardRatings = (entries: DraftBoardEntry[]): DraftBoardEntry[] => {
  const topTierCount = Math.min(10, entries.length);
  const topTierSpan = Math.max(topTierCount - 1, 1);
  const bulkCount = Math.max(entries.length - topTierCount, 1);

  return entries.map((entry, index) => {
    const ageUpside = clamp(21 - entry.age, 0, 4);
    const isTopTier = index < topTierCount;

    let overall = entry.overall;
    let potentialOverall = entry.potentialOverall;

    if (isTopTier) {
      const tierStrength = 1 - index / topTierSpan;
      const ovrFloor = clamp(Math.round(75 + tierStrength * 4), 75, 83);
      const ovrCeil = clamp(Math.round(82 + tierStrength * 3), 82, 85);
      overall = randomInt(ovrFloor, ovrCeil);

      const upsideFloor = 8 + Math.round(tierStrength * 2);
      const upsideCeil = 15 + Math.round(tierStrength * 3) + Math.floor(ageUpside / 2);
      potentialOverall = clamp(
        Math.max(overall + randomInt(upsideFloor, upsideCeil), randomInt(88, 97)),
        overall + 6,
        99,
      );
    } else {
      const bulkIndex = index - topTierCount;
      const bulkProgress = bulkIndex / Math.max(bulkCount - 1, 1);
      const ovrCeil = bulkProgress < 0.35 ? 75 : bulkProgress < 0.75 ? 73 : 70;
      overall = randomInt(60, ovrCeil);

      const upsideBonus = randomInt(4, 12) + Math.floor(ageUpside / 2);
      const baselinePotential = bulkProgress < 0.45 ? randomInt(72, 90) : randomInt(68, 88);
      potentialOverall = clamp(Math.max(overall + upsideBonus, baselinePotential), overall + 2, 97);
    }

    entry.overall = overall;
    entry.potentialOverall = potentialOverall;
    entry.ratings.overall = overall;
    entry.ratings.potentialOverall = potentialOverall;
    entry.boardScore = potentialOverall * 0.62 + overall * 0.38 + randomInt(-2, 2);

    return entry;
  });
};

const removePlayersFromLeagueState = (
  playerState: LeaguePlayerState,
  playerIdsToRemove: Set<string>,
): LeaguePlayerState => {
  if (playerIdsToRemove.size === 0) {
    return playerState;
  }

  return {
    ...playerState,
    players: playerState.players.filter((player) => !playerIdsToRemove.has(player.playerId)),
    battingStats: playerState.battingStats.filter((stat) => !playerIdsToRemove.has(stat.playerId)),
    pitchingStats: playerState.pitchingStats.filter((stat) => !playerIdsToRemove.has(stat.playerId)),
    battingRatings: playerState.battingRatings.filter((ratings) => !playerIdsToRemove.has(ratings.playerId)),
    pitchingRatings: playerState.pitchingRatings.filter((ratings) => !playerIdsToRemove.has(ratings.playerId)),
    rosterSlots: playerState.rosterSlots.filter((slot) => !playerIdsToRemove.has(slot.playerId)),
    transactions: playerState.transactions.filter((transaction) => !playerIdsToRemove.has(transaction.playerId)),
  };
};

export const generateDraftClassBundle = (
  seasonYear: number,
  prospectCount = DRAFT_CLASS_SIZE,
): DraftClassBundle => {
  const players = generateDraftClass(seasonYear, prospectCount).map((player) => ({
    ...player,
    status: 'prospect' as const,
    teamId: null,
    age: randomInt(17, 20),
    yearsPro: 0,
    contractYearsLeft: 0,
    draftClassYear: seasonYear,
    draftRound: null,
    retirementYear: null,
  }));

  const battingRatings: PlayerBattingRatings[] = [];
  const pitchingRatings: PlayerPitchingRatings[] = [];
  const battingStats: PlayerSeasonBatting[] = [];
  const pitchingStats: PlayerSeasonPitching[] = [];

  const draftBoard: DraftBoardEntry[] = players.map((player) => {
    if (player.playerType === 'pitcher') {
      const ratings = createPitchingProspectRatings(player, seasonYear);
      pitchingRatings.push(ratings);
      pitchingStats.push(createEmptyPitchingStats(player.playerId, seasonYear));
      return {
        playerId: player.playerId,
        firstName: player.firstName,
        lastName: player.lastName,
        age: player.age,
        playerType: player.playerType,
        primaryPosition: player.primaryPosition,
        overall: ratings.overall,
        potentialOverall: ratings.potentialOverall,
        archetype: getPitcherArchetype(player.primaryPosition),
        boardScore: ratings.potentialOverall * 0.62 + ratings.overall * 0.38 + randomInt(-3, 3),
        ratings,
      };
    }

    const ratings = createBattingProspectRatings(player, seasonYear);
    battingRatings.push(ratings);
    battingStats.push(createEmptyBattingStats(player.playerId, seasonYear));
    return {
      playerId: player.playerId,
      firstName: player.firstName,
      lastName: player.lastName,
      age: player.age,
      playerType: player.playerType,
      primaryPosition: player.primaryPosition,
      overall: ratings.overall,
      potentialOverall: ratings.potentialOverall,
      archetype: getBatterArchetype(player.primaryPosition),
      boardScore: ratings.potentialOverall * 0.6 + ratings.overall * 0.4 + randomInt(-3, 3),
      ratings,
    };
  });

  const tunedDraftBoard = tuneDraftBoardRatings(
    [...draftBoard].sort((left, right) => right.boardScore - left.boardScore),
  );

  const prospects = [...tunedDraftBoard]
    .sort((left, right) => right.boardScore - left.boardScore)
    .map((entry, index) => ({
      playerId: entry.playerId,
      firstName: entry.firstName,
      lastName: entry.lastName,
      age: entry.age,
      playerType: entry.playerType,
      primaryPosition: entry.primaryPosition,
      overall: entry.overall,
      potentialOverall: entry.potentialOverall,
      archetype: entry.archetype,
      projectedRound: clamp(Math.floor(index / 32) + 1, 1, 4),
    }));

  return {
    prospects,
    players,
    battingRatings,
    pitchingRatings,
    battingStats,
    pitchingStats,
  };
};

export const createDraftClassState = (
  seasonYear: number,
  teams: Team[],
  prospects: DraftProspect[],
): DraftClassState => ({
  draftId: createDraftId(),
  seasonYear,
  createdAt: new Date().toISOString(),
  draftOrder: getDraftOrder(teams),
  totalPicks: teams.length * DRAFT_ROUNDS,
  prospects: [...prospects],
  picks: [],
  isComplete: false,
});

const getLatestRosterSeasonYear = (rosterSlots: TeamRosterSlot[], fallbackYear: number): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : fallbackYear;

const getLatestOverallByPlayerId = (
  battingRatings: PlayerBattingRatings[],
  pitchingRatings: PlayerPitchingRatings[],
): Map<string, number> => {
  const battingMap = new Map<string, PlayerBattingRatings>();
  [...battingRatings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((ratings) => {
      if (!battingMap.has(ratings.playerId)) battingMap.set(ratings.playerId, ratings);
    });

  const pitchingMap = new Map<string, PlayerPitchingRatings>();
  [...pitchingRatings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((ratings) => {
      if (!pitchingMap.has(ratings.playerId)) pitchingMap.set(ratings.playerId, ratings);
    });

  const result = new Map<string, number>();
  battingMap.forEach((ratings, playerId) => result.set(playerId, ratings.overall));
  pitchingMap.forEach((ratings, playerId) => {
    if (!result.has(playerId)) result.set(playerId, ratings.overall);
  });
  return result;
};

const getTeamDirection = (team: Team): 'rebuild' | 'contend' | 'balanced' => {
  const gamesPlayed = team.wins + team.losses;
  const pct = gamesPlayed > 0 ? team.wins / gamesPlayed : 0.5;
  if (pct <= 0.45) return 'rebuild';
  if (pct >= 0.57) return 'contend';
  return 'balanced';
};

const getTeamNeedValue = (
  teamId: string,
  position: PlayerPosition,
  rosterSlots: TeamRosterSlot[],
  overallByPlayerId: Map<string, number>,
): number => {
  const scoreFromSlot = (slotCode: string): number => {
    const slot = rosterSlots.find((entry) => entry.teamId === teamId && entry.slotCode === slotCode) ?? null;
    if (!slot) return 34;
    const overall = overallByPlayerId.get(slot.playerId) ?? 58;
    return clamp(88 - overall, 0, 34);
  };

  if (position === 'SP') {
    return Math.max(...STARTING_PITCHER_SLOTS.map((slotCode) => scoreFromSlot(slotCode)));
  }
  if (position === 'RP') {
    return Math.max(...RELIEF_PITCHER_SLOTS.map((slotCode) => scoreFromSlot(slotCode)));
  }
  if (position === 'CL') {
    return scoreFromSlot('CL');
  }
  return scoreFromSlot(position);
};

const chooseProspectForPick = (
  team: Team,
  round: number,
  prospects: DraftProspect[],
  rosterSlots: TeamRosterSlot[],
  overallByPlayerId: Map<string, number>,
): DraftProspect | null => {
  if (prospects.length === 0) {
    return null;
  }

  const direction = getTeamDirection(team);
  const scored = prospects.map((prospect) => {
    const need = getTeamNeedValue(team.id, prospect.primaryPosition, rosterSlots, overallByPlayerId);
    const upside = prospect.potentialOverall - prospect.overall;
    const ageUpside = clamp(21 - prospect.age, 0, 4);

    let score = prospect.overall * 1.25 + prospect.potentialOverall * 0.4 + need * 1.35 + ageUpside * 1.7;
    if (direction === 'rebuild') {
      score += upside * 1.4 + ageUpside * 1.2;
    } else if (direction === 'contend') {
      score += prospect.overall * 0.55 + need * 0.55;
    } else {
      score += upside * 0.75 + need * 0.35;
    }

    if (round === 1) {
      score += prospect.potentialOverall * 0.32;
    } else if (round >= 3) {
      score += need * 0.45;
    }

    return {
      prospect,
      score: score + (Math.random() * 4 - 2),
    };
  });

  scored.sort((left, right) => right.score - left.score);
  const candidates = scored.slice(0, Math.min(10, scored.length));
  if (candidates.length === 0) {
    return prospects[0] ?? null;
  }

  const maxScore = candidates[0].score;
  const weightedCandidates = candidates.map((entry) => ({
    ...entry,
    weight: Math.exp((entry.score - maxScore) / 6),
  }));
  const totalWeight = weightedCandidates.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const entry of weightedCandidates) {
    roll -= entry.weight;
    if (roll <= 0) {
      return entry.prospect;
    }
  }

  return weightedCandidates[weightedCandidates.length - 1].prospect;
};

const getDraftContractYears = (potentialOverall: number, age: number): number => {
  if (potentialOverall >= 86 && age <= 18) return 5;
  if (potentialOverall >= 82) return 5;
  if (potentialOverall >= 75) return 4;
  return 3;
};

const getReserveSlotAssignment = (
  teamId: string,
  rosterSlots: TeamRosterSlot[],
  overallByPlayerId: Map<string, number>,
): { targetSlotCode: TeamRosterSlot['slotCode']; waivedPlayerId: string | null } => {
  const teamSeasonSlots = rosterSlots.filter((slot) => slot.teamId === teamId);
  const openReserveSlot = RESERVE_ROSTER_SLOTS.find(
    (slotCode) => !teamSeasonSlots.some((slot) => slot.slotCode === slotCode),
  );
  if (openReserveSlot) {
    return { targetSlotCode: openReserveSlot, waivedPlayerId: null };
  }

  const reserveCandidates = teamSeasonSlots
    .filter((slot) => RESERVE_ROSTER_SLOTS.includes(slot.slotCode as (typeof RESERVE_ROSTER_SLOTS)[number]))
    .map((slot) => ({
      slotCode: slot.slotCode,
      playerId: slot.playerId,
      overall: overallByPlayerId.get(slot.playerId) ?? 50,
    }))
    .sort((left, right) => left.overall - right.overall);

  const fallback = reserveCandidates[0];
  if (!fallback) {
    return { targetSlotCode: RESERVE_ROSTER_SLOTS[0], waivedPlayerId: null };
  }

  return { targetSlotCode: fallback.slotCode, waivedPlayerId: fallback.playerId };
};

export const applyNextDraftPick = (
  draftClass: DraftClassState,
  playerState: LeaguePlayerState,
  teams: Team[],
  effectiveDate: string,
): DraftStepResult | null => {
  if (draftClass.isComplete || draftClass.prospects.length === 0 || draftClass.draftOrder.length === 0) {
    return null;
  }

  const completedPickCount = draftClass.picks.length;
  const totalPicks = Math.min(draftClass.totalPicks, draftClass.draftOrder.length * DRAFT_ROUNDS);
  if (completedPickCount >= totalPicks) {
    return null;
  }

  const round = Math.floor(completedPickCount / draftClass.draftOrder.length) + 1;
  const pickIndex = completedPickCount % draftClass.draftOrder.length;
  const teamId = draftClass.draftOrder[pickIndex];
  const team = teams.find((entry) => entry.id === teamId) ?? null;
  if (!team) {
    return null;
  }

  const seasonYear = getLatestRosterSeasonYear(playerState.rosterSlots, draftClass.seasonYear);
  const seasonRosterSlots = playerState.rosterSlots.filter((slot) => slot.seasonYear === seasonYear);
  const overallByPlayerId = getLatestOverallByPlayerId(playerState.battingRatings, playerState.pitchingRatings);

  const selectedProspect = chooseProspectForPick(team, round, draftClass.prospects, seasonRosterSlots, overallByPlayerId);
  if (!selectedProspect) {
    return null;
  }

  const { targetSlotCode, waivedPlayerId } = getReserveSlotAssignment(teamId, seasonRosterSlots, overallByPlayerId);
  const playerById = new Map(playerState.players.map((player) => [player.playerId, player]));
  const waivedPlayer = waivedPlayerId ? playerById.get(waivedPlayerId) ?? null : null;

  const nextPlayers = playerState.players.map((player) => {
    if (player.playerId === selectedProspect.playerId) {
      return {
        ...player,
        teamId,
        status: 'active' as const,
        draftRound: round,
        contractYearsLeft: getDraftContractYears(selectedProspect.potentialOverall, selectedProspect.age),
      };
    }
    if (waivedPlayer && player.playerId === waivedPlayer.playerId) {
      return {
        ...player,
        teamId: null,
        status: 'free_agent' as const,
        contractYearsLeft: 0,
      };
    }
    return player;
  });

  let replacedSlot = false;
  const nextRosterSlots = playerState.rosterSlots
    .filter((slot) => slot.playerId !== selectedProspect.playerId)
    .map((slot) => {
      if (slot.seasonYear === seasonYear && slot.teamId === teamId && slot.slotCode === targetSlotCode) {
        replacedSlot = true;
        return {
          ...slot,
          playerId: selectedProspect.playerId,
        };
      }
      return slot;
    });

  if (!replacedSlot) {
    nextRosterSlots.push({
      seasonYear,
      teamId,
      slotCode: targetSlotCode,
      playerId: selectedProspect.playerId,
    });
  }

  const newPick: DraftPickRecord = {
    draftId: draftClass.draftId,
    seasonYear: draftClass.seasonYear,
    round,
    pickInRound: pickIndex + 1,
    overallPick: completedPickCount + 1,
    teamId,
    playerId: selectedProspect.playerId,
    playerName: `${selectedProspect.firstName} ${selectedProspect.lastName}`,
    playerType: selectedProspect.playerType,
    primaryPosition: selectedProspect.primaryPosition,
    age: selectedProspect.age,
    overall: selectedProspect.overall,
    potentialOverall: selectedProspect.potentialOverall,
    waivedPlayerId: waivedPlayer?.playerId ?? null,
    waivedPlayerName: waivedPlayer ? `${waivedPlayer.firstName} ${waivedPlayer.lastName}` : null,
    date: effectiveDate,
  };

  const nextProspects = draftClass.prospects.filter((prospect) => prospect.playerId !== selectedProspect.playerId);
  const nextPicks = [...draftClass.picks, newPick];
  const isComplete = nextPicks.length >= totalPicks || nextProspects.length === 0;
  const undraftedProspectIds = isComplete ? new Set(nextProspects.map((prospect) => prospect.playerId)) : new Set<string>();
  const nextDraftClass: DraftClassState = {
    ...draftClass,
    prospects: isComplete ? [] : nextProspects,
    picks: nextPicks,
    isComplete,
  };

  const nextTransactions = [
    {
      playerId: selectedProspect.playerId,
      eventType: 'drafted' as const,
      fromTeamId: null,
      toTeamId: teamId,
      effectiveDate,
      notes: `Drafted in round ${round}, pick ${pickIndex + 1} (${targetSlotCode}).`,
    },
    ...playerState.transactions,
  ];

  if (waivedPlayer) {
    nextTransactions.unshift({
      playerId: waivedPlayer.playerId,
      eventType: 'released' as const,
      fromTeamId: teamId,
      toTeamId: null,
      effectiveDate,
      notes: `Waived to clear ${targetSlotCode} for drafted prospect ${selectedProspect.lastName}.`,
    });
  }

  const basePlayerState: LeaguePlayerState = {
    ...playerState,
    players: nextPlayers,
    battingStats: playerState.battingStats,
    pitchingStats: playerState.pitchingStats,
    battingRatings: playerState.battingRatings,
    pitchingRatings: playerState.pitchingRatings,
    rosterSlots: nextRosterSlots,
    transactions: nextTransactions,
  };
  const repairedRoster = repairRosterSlotsForTeams(basePlayerState, [teamId], seasonYear);
  const rosterPromotionTransactions = repairedRoster.promotions.map((promotion) => ({
    playerId: promotion.playerId,
    eventType: 'promoted' as const,
    fromTeamId: promotion.teamId,
    toTeamId: promotion.teamId,
    effectiveDate,
    notes: `Auto-promoted from ${promotion.fromSlot ?? 'unassigned'} to ${promotion.toSlot} after draft selection.`,
  }));
  const optimizedPlayerState: LeaguePlayerState = {
    ...basePlayerState,
    rosterSlots: repairedRoster.rosterSlots,
    transactions: [...rosterPromotionTransactions, ...basePlayerState.transactions],
  };

  return {
    draftClass: nextDraftClass,
    playerState: isComplete ? removePlayersFromLeagueState(optimizedPlayerState, undraftedProspectIds) : optimizedPlayerState,
    pick: newPick,
  };
};
