import {
  LeaguePlayerState,
  PlayerGameBattingLine,
  PlayerGamePitchingLine,
  PlayerGameStatDelta,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  SeasonPhase,
} from '../types';

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

export const applyPlayerGameStatDelta = (
  playerState: LeaguePlayerState,
  delta: PlayerGameStatDelta,
  seasonYear: number,
  seasonPhase: SeasonPhase,
): LeaguePlayerState => {
  const battingMap = new Map<string, PlayerSeasonBatting>(
    playerState.battingStats.map((stat) => [`${stat.playerId}:${stat.seasonYear}:${stat.seasonPhase}`, stat] as const),
  );
  const pitchingMap = new Map<string, PlayerSeasonPitching>(
    playerState.pitchingStats.map((stat) => [`${stat.playerId}:${stat.seasonYear}:${stat.seasonPhase}`, stat] as const),
  );

  Object.values(delta.batting).forEach((battingLine) => {
    const key = `${battingLine.playerId}:${seasonYear}:${seasonPhase}`;
    const current = battingMap.get(key) ?? createEmptyBattingStat(battingLine.playerId, seasonYear, seasonPhase);
    battingMap.set(key, applyBattingLine(current, battingLine));
  });

  Object.values(delta.pitching).forEach((pitchingLine) => {
    const key = `${pitchingLine.playerId}:${seasonYear}:${seasonPhase}`;
    const current = pitchingMap.get(key) ?? createEmptyPitchingStat(pitchingLine.playerId, seasonYear, seasonPhase);
    pitchingMap.set(key, applyPitchingLine(current, pitchingLine));
  });

  return {
    ...playerState,
    battingStats: Array.from(battingMap.values()),
    pitchingStats: Array.from(pitchingMap.values()),
  };
};
