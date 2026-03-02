import {
  BatterPosition,
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  Game,
  GameParticipantBatter,
  GameParticipantPitcher,
  GameParticipantsSnapshot,
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PitcherPosition,
  PlayerPitchingRatings,
  STARTING_PITCHER_SLOTS,
  TeamRosterSlot,
} from '../types';

type TeamRosterEntry = {
  player: Player;
  battingRatings: PlayerBattingRatings | null;
  pitchingRatings: PlayerPitchingRatings | null;
  battingStat: PlayerSeasonBatting | null;
  pitchingStat: PlayerSeasonPitching | null;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const compareGameOrder = (left: Game, right: Game): number =>
  left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date);

const getLatestRosterSeasonYear = (rosterSlots: TeamRosterSlot[]): number | null => {
  if (rosterSlots.length === 0) {
    return null;
  }

  return Math.max(...rosterSlots.map((slot) => slot.seasonYear));
};

const getLatestBattingRatingsByPlayerId = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const byPlayerId = new Map<string, PlayerBattingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!byPlayerId.has(rating.playerId)) {
        byPlayerId.set(rating.playerId, rating);
      }
    });

  return byPlayerId;
};

const getLatestPitchingRatingsByPlayerId = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const byPlayerId = new Map<string, PlayerPitchingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!byPlayerId.has(rating.playerId)) {
        byPlayerId.set(rating.playerId, rating);
      }
    });

  return byPlayerId;
};

const getLatestBattingStatsByPlayerId = (stats: PlayerSeasonBatting[]): Map<string, PlayerSeasonBatting> => {
  const byPlayerId = new Map<string, PlayerSeasonBatting>();
  [...stats]
    .sort((left, right) => {
      if (left.seasonYear !== right.seasonYear) {
        return right.seasonYear - left.seasonYear;
      }
      return left.seasonPhase === right.seasonPhase ? 0 : left.seasonPhase === 'playoffs' ? -1 : 1;
    })
    .forEach((stat) => {
      if (!byPlayerId.has(stat.playerId)) {
        byPlayerId.set(stat.playerId, stat);
      }
    });

  return byPlayerId;
};

const getLatestPitchingStatsByPlayerId = (stats: PlayerSeasonPitching[]): Map<string, PlayerSeasonPitching> => {
  const byPlayerId = new Map<string, PlayerSeasonPitching>();
  [...stats]
    .sort((left, right) => {
      if (left.seasonYear !== right.seasonYear) {
        return right.seasonYear - left.seasonYear;
      }
      return left.seasonPhase === right.seasonPhase ? 0 : left.seasonPhase === 'playoffs' ? -1 : 1;
    })
    .forEach((stat) => {
      if (!byPlayerId.has(stat.playerId)) {
        byPlayerId.set(stat.playerId, stat);
      }
    });

  return byPlayerId;
};

const getBattingTrendBonus = (entry: TeamRosterEntry): number => {
  const stat = entry.battingStat;
  if (!stat || stat.plateAppearances < 20) {
    return 0;
  }

  const avgBonus = (stat.avg - 0.25) * 120;
  const opsBonus = (stat.ops - 0.72) * 30;
  const powerBonus = stat.homeRuns * 0.15;
  return avgBonus + opsBonus + powerBonus;
};

const getPitchingTrendScore = (entry: TeamRosterEntry): number => {
  const ratingsScore = entry.pitchingRatings?.overall ?? 0;
  const stat = entry.pitchingStat;
  if (!stat || stat.inningsPitched < 5) {
    return ratingsScore;
  }

  const eraBonus = clamp(4.25 - stat.era, -2.5, 2.5) * 3.2;
  const whipBonus = clamp(1.35 - stat.whip, -0.45, 0.45) * 12;
  const strikeoutBonus = stat.inningsPitched > 0 ? (stat.strikeouts / stat.inningsPitched) * 0.85 : 0;
  return ratingsScore + eraBonus + whipBonus + strikeoutBonus;
};

const scoreBattingOrderEntry = (entry: TeamRosterEntry, slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): number => {
  const ratings = entry.battingRatings;
  if (!ratings) {
    return -1;
  }

  if (slot === 3) {
    return ratings.contact * 0.5 + ratings.power * 0.5 + getBattingTrendBonus(entry) * 0.45;
  }
  if (slot === 4) {
    return ratings.power * 0.7 + ratings.contact * 0.3 + getBattingTrendBonus(entry) * 0.4;
  }
  if (slot === 1) {
    return ratings.speed * 0.4 + ratings.plateDiscipline * 0.3 + ratings.contact * 0.3 + getBattingTrendBonus(entry) * 0.25;
  }
  if (slot === 2) {
    return ratings.contact * 0.5 + ratings.avoidStrikeout * 0.3 + ratings.speed * 0.2 + getBattingTrendBonus(entry) * 0.3;
  }
  if (slot === 5) {
    return ratings.power * 0.6 + ratings.contact * 0.4 + getBattingTrendBonus(entry) * 0.35;
  }

  return ratings.contact + ratings.power + ratings.plateDiscipline + getBattingTrendBonus(entry) * 0.3;
};

const generateBattingOrder = (startingNine: TeamRosterEntry[]): TeamRosterEntry[] => {
  const available = [...startingNine].filter((entry) => entry.battingRatings);
  const ordered: Array<TeamRosterEntry | null> = Array(9).fill(null);
  const prioritySlots: Array<1 | 2 | 3 | 4 | 5> = [3, 4, 1, 2, 5];

  prioritySlots.forEach((slot) => {
    if (available.length === 0) {
      return;
    }

    let bestIndex = 0;
    let bestScore = scoreBattingOrderEntry(available[0], slot);
    for (let index = 1; index < available.length; index += 1) {
      const candidateScore = scoreBattingOrderEntry(available[index], slot);
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
      }
    }

    const [chosen] = available.splice(bestIndex, 1);
    ordered[slot - 1] = chosen;
  });

  available
    .sort((left, right) =>
      scoreBattingOrderEntry(right, 6) - scoreBattingOrderEntry(left, 6) ||
      (right.battingRatings?.overall ?? 0) - (left.battingRatings?.overall ?? 0),
    )
    .forEach((entry, index) => {
      const slotIndex = 5 + index;
      if (slotIndex < ordered.length) {
        ordered[slotIndex] = entry;
      }
    });

  return ordered.filter((entry): entry is TeamRosterEntry => entry !== null);
};

const toBatterParticipant = (entry: TeamRosterEntry): GameParticipantBatter | null => {
  if (!entry.battingRatings || entry.player.teamId === null || entry.player.playerType !== 'batter') {
    return null;
  }

  return {
    playerId: entry.player.playerId,
    teamId: entry.player.teamId,
    fullName: `${entry.player.firstName} ${entry.player.lastName}`,
    bats: entry.player.bats,
    primaryPosition: entry.player.primaryPosition as BatterPosition,
    battingRatings: entry.battingRatings,
    battingStat: entry.battingStat,
  };
};

const toPitcherParticipant = (entry: TeamRosterEntry): GameParticipantPitcher | null => {
  if (!entry.pitchingRatings || entry.player.teamId === null || entry.player.playerType !== 'pitcher') {
    return null;
  }

  return {
    playerId: entry.player.playerId,
    teamId: entry.player.teamId,
    fullName: `${entry.player.firstName} ${entry.player.lastName}`,
    throws: entry.player.throws,
    role: entry.player.primaryPosition as PitcherPosition,
    pitchingRatings: entry.pitchingRatings,
    pitchingStat: entry.pitchingStat,
  };
};

const getTeamGameIndex = (teamId: string, game: Game, games: Game[]): number => {
  const teamGames = games
    .filter((candidate) => candidate.phase === game.phase && (candidate.homeTeam === teamId || candidate.awayTeam === teamId))
    .sort(compareGameOrder);

  const gameIndex = teamGames.findIndex((candidate) => candidate.gameId === game.gameId);
  return gameIndex >= 0 ? gameIndex : 0;
};

const buildTeamRosterContext = (
  teamId: string,
  teamGameIndex: number,
  playerState: LeaguePlayerState,
): {
  lineup: GameParticipantBatter[];
  starter: GameParticipantPitcher | null;
  bullpen: GameParticipantPitcher[];
} | null => {
  const latestSeasonYear = getLatestRosterSeasonYear(playerState.rosterSlots);
  if (!latestSeasonYear) {
    return null;
  }

  const battingRatingsByPlayerId = getLatestBattingRatingsByPlayerId(playerState.battingRatings);
  const pitchingRatingsByPlayerId = getLatestPitchingRatingsByPlayerId(playerState.pitchingRatings);
  const battingStatsByPlayerId = getLatestBattingStatsByPlayerId(playerState.battingStats);
  const pitchingStatsByPlayerId = getLatestPitchingStatsByPlayerId(playerState.pitchingStats);
  const playersById = new Map(playerState.players.map((player) => [player.playerId, player]));

  const rosterBySlot = new Map<string, TeamRosterEntry>();
  playerState.rosterSlots
    .filter((slot) => slot.seasonYear === latestSeasonYear && slot.teamId === teamId)
    .forEach((slot) => {
      const player = playersById.get(slot.playerId);
      if (!player) {
        return;
      }

      rosterBySlot.set(slot.slotCode, {
        player,
        battingRatings: battingRatingsByPlayerId.get(slot.playerId) ?? null,
        pitchingRatings: pitchingRatingsByPlayerId.get(slot.playerId) ?? null,
        battingStat: battingStatsByPlayerId.get(slot.playerId) ?? null,
        pitchingStat: pitchingStatsByPlayerId.get(slot.playerId) ?? null,
      });
    });

  const battingEntries = BATTING_ROSTER_SLOTS
    .map((slotCode) => rosterBySlot.get(slotCode) ?? null)
    .filter((entry): entry is TeamRosterEntry => entry !== null);
  const orderedLineup = generateBattingOrder(battingEntries)
    .map(toBatterParticipant)
    .filter((entry): entry is GameParticipantBatter => entry !== null);

  const starters = STARTING_PITCHER_SLOTS
    .map((slotCode) => rosterBySlot.get(slotCode) ?? null)
    .filter((entry): entry is TeamRosterEntry => entry !== null)
    .map(toPitcherParticipant)
    .filter((entry): entry is GameParticipantPitcher => entry !== null);

  const bullpen = BULLPEN_ROSTER_SLOTS
    .map((slotCode) => rosterBySlot.get(slotCode) ?? null)
    .filter((entry): entry is TeamRosterEntry => entry !== null)
    .map(toPitcherParticipant)
    .filter((entry): entry is GameParticipantPitcher => entry !== null);

  if (orderedLineup.length === 0) {
    return null;
  }

  const sortedStarters = STARTING_PITCHER_SLOTS
    .map((slotCode) => rosterBySlot.get(slotCode) ?? null)
    .filter((entry): entry is TeamRosterEntry => entry !== null)
    .sort((left, right) => getPitchingTrendScore(right) - getPitchingTrendScore(left));

  const rotationStarter = sortedStarters.length > 0
    ? toPitcherParticipant(sortedStarters[teamGameIndex % sortedStarters.length] ?? sortedStarters[0])
    : starters[teamGameIndex % Math.max(1, starters.length)] ?? starters[0] ?? null;
  return {
    lineup: orderedLineup,
    starter: rotationStarter,
    bullpen,
  };
};

export const buildGameParticipants = (
  game: Game,
  games: Game[],
  playerState: LeaguePlayerState,
): GameParticipantsSnapshot | null => {
  const awayContext = buildTeamRosterContext(game.awayTeam, getTeamGameIndex(game.awayTeam, game, games), playerState);
  const homeContext = buildTeamRosterContext(game.homeTeam, getTeamGameIndex(game.homeTeam, game, games), playerState);

  if (!awayContext || !homeContext) {
    return null;
  }

  return {
    awayLineup: awayContext.lineup,
    homeLineup: homeContext.lineup,
    awayStarter: awayContext.starter,
    homeStarter: homeContext.starter,
    awayBullpen: awayContext.bullpen,
    homeBullpen: homeContext.bullpen,
  };
};
