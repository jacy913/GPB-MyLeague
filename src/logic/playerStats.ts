import {
  LeaguePlayerState,
  Player,
  PlayerGameBattingLine,
  PlayerGamePitchingLine,
  PlayerGameStatDelta,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  SeasonPhase,
} from '../types';

export interface PlayerStatAccumulator {
  battingByKey: Map<string, PlayerSeasonBatting>;
  pitchingByKey: Map<string, PlayerSeasonPitching>;
  preferredBattingByPhase: Record<SeasonPhase, Map<string, PlayerSeasonBatting>>;
  preferredPitchingByPhase: Record<SeasonPhase, Map<string, PlayerSeasonPitching>>;
}

const getSeasonPhasePreferenceScore = (seasonPhase: SeasonPhase, preferredPhase: SeasonPhase): number => {
  if (seasonPhase === preferredPhase) {
    return 2;
  }

  if (preferredPhase === 'playoffs' && seasonPhase === 'regular_season') {
    return 1;
  }

  return 0;
};

const compareSeasonStatPriority = <
  T extends {
    playerId: string;
    seasonYear: number;
    seasonPhase: SeasonPhase;
  },
>(
  left: T,
  right: T,
  preferredPhase: SeasonPhase,
): number => {
  if (left.seasonYear !== right.seasonYear) {
    return right.seasonYear - left.seasonYear;
  }

  const leftPhaseScore = getSeasonPhasePreferenceScore(left.seasonPhase, preferredPhase);
  const rightPhaseScore = getSeasonPhasePreferenceScore(right.seasonPhase, preferredPhase);
  if (leftPhaseScore !== rightPhaseScore) {
    return rightPhaseScore - leftPhaseScore;
  }

  return left.playerId.localeCompare(right.playerId);
};

const createEmptyBattingStat = (
  playerId: string,
  seasonYear: number,
  seasonPhase: SeasonPhase,
): PlayerSeasonBatting => ({
  playerId,
  seasonYear,
  seasonPhase,
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

const createEmptyPitchingStat = (
  playerId: string,
  seasonYear: number,
  seasonPhase: SeasonPhase,
): PlayerSeasonPitching => ({
  playerId,
  seasonYear,
  seasonPhase,
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

const applyBattingLine = (stat: PlayerSeasonBatting, delta: PlayerGameBattingLine): PlayerSeasonBatting => {
  const nextStat = {
    ...stat,
    gamesPlayed: stat.gamesPlayed + delta.gamesPlayed,
    plateAppearances: stat.plateAppearances + delta.plateAppearances,
    atBats: stat.atBats + delta.atBats,
    runsScored: stat.runsScored + delta.runsScored,
    hits: stat.hits + delta.hits,
    doubles: stat.doubles + delta.doubles,
    triples: stat.triples + delta.triples,
    homeRuns: stat.homeRuns + delta.homeRuns,
    walks: stat.walks + delta.walks,
    strikeouts: stat.strikeouts + delta.strikeouts,
    rbi: stat.rbi + delta.rbi,
  };

  const singles = Math.max(0, nextStat.hits - nextStat.doubles - nextStat.triples - nextStat.homeRuns);
  const totalBases = singles + nextStat.doubles * 2 + nextStat.triples * 3 + nextStat.homeRuns * 4;
  const battingAverage = nextStat.atBats > 0 ? nextStat.hits / nextStat.atBats : 0;
  const onBase = nextStat.atBats + nextStat.walks;
  const obp = onBase > 0 ? (nextStat.hits + nextStat.walks) / onBase : 0;
  const slugging = nextStat.atBats > 0 ? totalBases / nextStat.atBats : 0;

  return {
    ...nextStat,
    avg: Number(battingAverage.toFixed(3)),
    ops: Number((obp + slugging).toFixed(3)),
  };
};

const applyPitchingLine = (stat: PlayerSeasonPitching, delta: PlayerGamePitchingLine): PlayerSeasonPitching => {
  const nextStat = {
    ...stat,
    wins: stat.wins + delta.wins,
    losses: stat.losses + delta.losses,
    saves: stat.saves + delta.saves,
    games: stat.games + delta.games,
    gamesStarted: stat.gamesStarted + delta.gamesStarted,
    inningsPitched: Number((stat.inningsPitched + delta.inningsPitched).toFixed(3)),
    hitsAllowed: stat.hitsAllowed + delta.hitsAllowed,
    earnedRuns: stat.earnedRuns + delta.earnedRuns,
    walks: stat.walks + delta.walks,
    strikeouts: stat.strikeouts + delta.strikeouts,
  };

  const era = nextStat.inningsPitched > 0 ? (nextStat.earnedRuns * 9) / nextStat.inningsPitched : 0;
  const whip = nextStat.inningsPitched > 0 ? (nextStat.walks + nextStat.hitsAllowed) / nextStat.inningsPitched : 0;

  return {
    ...nextStat,
    era: Number(era.toFixed(2)),
    whip: Number(whip.toFixed(2)),
  };
};

const updatePreferredSeasonStat = <
  T extends {
    playerId: string;
    seasonYear: number;
    seasonPhase: SeasonPhase;
  },
>(
  preferredMap: Map<string, T>,
  updatedStat: T,
  preferredPhase: SeasonPhase,
): void => {
  const current = preferredMap.get(updatedStat.playerId);
  if (!current || compareSeasonStatPriority(updatedStat, current, preferredPhase) < 0) {
    preferredMap.set(updatedStat.playerId, updatedStat);
    return;
  }

  if (
    current.playerId === updatedStat.playerId &&
    current.seasonYear === updatedStat.seasonYear &&
    current.seasonPhase === updatedStat.seasonPhase
  ) {
    preferredMap.set(updatedStat.playerId, updatedStat);
  }
};

export const createPlayerStatAccumulator = (playerState: LeaguePlayerState): PlayerStatAccumulator => {
  const battingByKey = new Map<string, PlayerSeasonBatting>(
    playerState.battingStats.map((stat) => [`${stat.playerId}:${stat.seasonYear}:${stat.seasonPhase}`, stat] as const),
  );
  const pitchingByKey = new Map<string, PlayerSeasonPitching>(
    playerState.pitchingStats.map((stat) => [`${stat.playerId}:${stat.seasonYear}:${stat.seasonPhase}`, stat] as const),
  );

  return {
    battingByKey,
    pitchingByKey,
    preferredBattingByPhase: {
      regular_season: getPreferredBattingStatsByPlayerId(Array.from(battingByKey.values()), 'regular_season'),
      playoffs: getPreferredBattingStatsByPlayerId(Array.from(battingByKey.values()), 'playoffs'),
    },
    preferredPitchingByPhase: {
      regular_season: getPreferredPitchingStatsByPlayerId(Array.from(pitchingByKey.values()), 'regular_season'),
      playoffs: getPreferredPitchingStatsByPlayerId(Array.from(pitchingByKey.values()), 'playoffs'),
    },
  };
};

export const applyPlayerGameStatDeltaToAccumulator = (
  accumulator: PlayerStatAccumulator,
  delta: PlayerGameStatDelta,
  seasonYear: number,
  seasonPhase: SeasonPhase,
): void => {
  Object.values(delta.batting).forEach((battingLine) => {
    const key = `${battingLine.playerId}:${seasonYear}:${seasonPhase}`;
    const current = accumulator.battingByKey.get(key) ?? createEmptyBattingStat(battingLine.playerId, seasonYear, seasonPhase);
    const updated = applyBattingLine(current, battingLine);
    accumulator.battingByKey.set(key, updated);
    updatePreferredSeasonStat(accumulator.preferredBattingByPhase.regular_season, updated, 'regular_season');
    updatePreferredSeasonStat(accumulator.preferredBattingByPhase.playoffs, updated, 'playoffs');
  });

  Object.values(delta.pitching).forEach((pitchingLine) => {
    const key = `${pitchingLine.playerId}:${seasonYear}:${seasonPhase}`;
    const current = accumulator.pitchingByKey.get(key) ?? createEmptyPitchingStat(pitchingLine.playerId, seasonYear, seasonPhase);
    const updated = applyPitchingLine(current, pitchingLine);
    accumulator.pitchingByKey.set(key, updated);
    updatePreferredSeasonStat(accumulator.preferredPitchingByPhase.regular_season, updated, 'regular_season');
    updatePreferredSeasonStat(accumulator.preferredPitchingByPhase.playoffs, updated, 'playoffs');
  });
};

export const materializePlayerStatAccumulator = (
  accumulator: PlayerStatAccumulator,
): Pick<LeaguePlayerState, 'battingStats' | 'pitchingStats'> => ({
  battingStats: Array.from(accumulator.battingByKey.values()),
  pitchingStats: Array.from(accumulator.pitchingByKey.values()),
});

export const applyPlayerGameStatDelta = (
  playerState: LeaguePlayerState,
  delta: PlayerGameStatDelta,
  seasonYear: number,
  seasonPhase: SeasonPhase,
): LeaguePlayerState => {
  const accumulator = createPlayerStatAccumulator(playerState);
  applyPlayerGameStatDeltaToAccumulator(accumulator, delta, seasonYear, seasonPhase);

  return {
    ...playerState,
    ...materializePlayerStatAccumulator(accumulator),
  };
};

export const getPreferredBattingStatsByPlayerId = (
  stats: PlayerSeasonBatting[],
  preferredPhase: SeasonPhase = 'regular_season',
): Map<string, PlayerSeasonBatting> => {
  const byPlayerId = new Map<string, PlayerSeasonBatting>();
  [...stats]
    .sort((left, right) => compareSeasonStatPriority(left, right, preferredPhase))
    .forEach((stat) => {
      if (!byPlayerId.has(stat.playerId)) {
        byPlayerId.set(stat.playerId, stat);
      }
    });

  return byPlayerId;
};

export const getPreferredPitchingStatsByPlayerId = (
  stats: PlayerSeasonPitching[],
  preferredPhase: SeasonPhase = 'regular_season',
): Map<string, PlayerSeasonPitching> => {
  const byPlayerId = new Map<string, PlayerSeasonPitching>();
  [...stats]
    .sort((left, right) => compareSeasonStatPriority(left, right, preferredPhase))
    .forEach((stat) => {
      if (!byPlayerId.has(stat.playerId)) {
        byPlayerId.set(stat.playerId, stat);
      }
    });

  return byPlayerId;
};

export const resetPlayerSeasonStats = (
  playerState: LeaguePlayerState,
  seasonYear: number,
): LeaguePlayerState => {
  const battingPlayers = playerState.players.filter((player): player is Player => player.playerType === 'batter');
  const pitchingPlayers = playerState.players.filter((player): player is Player => player.playerType === 'pitcher');

  return {
    ...playerState,
    battingStats: battingPlayers.map((player) => createEmptyBattingStat(player.playerId, seasonYear, 'regular_season')),
    pitchingStats: pitchingPlayers.map((player) => createEmptyPitchingStat(player.playerId, seasonYear, 'regular_season')),
  };
};
