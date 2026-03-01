import { Game, GamePhase, PlayoffRoundKey, Team } from '../types';

export type ClinchType = 'division' | 'wildcard';

interface HomeRecord {
  wins: number;
  losses: number;
  pct: number;
}

export interface SeededPlayoffTeam {
  seed: number;
  clinchType: ClinchType;
  team: Team;
  wins: number;
  losses: number;
  runDiff: number;
  homeWins: number;
  homeLosses: number;
  homePct: number;
}

export interface ProjectedSeries {
  id: string;
  round: PlayoffRoundKey;
  league: Team['league'] | 'GPB';
  label: string;
  bestOf: number;
  topSeed: SeededPlayoffTeam;
  bottomSeed: SeededPlayoffTeam;
  projectedWinner: SeededPlayoffTeam;
  projectedResult: string;
  topProjectedWins: number;
  bottomProjectedWins: number;
}

export interface LeaguePlayoffProjection {
  league: Team['league'];
  seeds: SeededPlayoffTeam[];
  wildCard: [ProjectedSeries, ProjectedSeries];
  divisional: [ProjectedSeries, ProjectedSeries];
  leagueSeries: ProjectedSeries;
  champion: SeededPlayoffTeam;
}

export interface PlayoffProjection {
  status: 'projected';
  prestige: LeaguePlayoffProjection;
  platinum: LeaguePlayoffProjection;
  worldSeries: ProjectedSeries;
  champion: SeededPlayoffTeam;
}

const DIVISIONS: Team['division'][] = ['North', 'South', 'East', 'West'];

export const getGamePhase = (game: Game): GamePhase => game.phase ?? 'regular_season';
export const isRegularSeasonGame = (game: Game): boolean => getGamePhase(game) === 'regular_season';
export const isPlayoffGame = (game: Game): boolean => getGamePhase(game) === 'playoffs';
const getRunDiff = (team: Team): number => team.runsScored - team.runsAllowed;

export const getHomeRecords = (games: Game[]): Map<string, HomeRecord> => {
  const records = new Map<string, HomeRecord>();

  games.forEach((game) => {
    if (game.status !== 'completed' || !isRegularSeasonGame(game)) {
      return;
    }

    const current = records.get(game.homeTeam) ?? { wins: 0, losses: 0, pct: 0 };
    if (game.score.home > game.score.away) {
      current.wins += 1;
    } else {
      current.losses += 1;
    }

    const gamesPlayed = current.wins + current.losses;
    current.pct = gamesPlayed > 0 ? current.wins / gamesPlayed : 0;
    records.set(game.homeTeam, current);
  });

  return records;
};

export const compareTeamsForPlayoffs = (a: Team, b: Team, homeRecords: Map<string, HomeRecord>): number => {
  if (b.wins !== a.wins) {
    return b.wins - a.wins;
  }

  const diffDelta = getRunDiff(b) - getRunDiff(a);
  if (diffDelta !== 0) {
    return diffDelta;
  }

  const aHome = homeRecords.get(a.id) ?? { wins: 0, losses: 0, pct: 0 };
  const bHome = homeRecords.get(b.id) ?? { wins: 0, losses: 0, pct: 0 };
  if (bHome.pct !== aHome.pct) {
    return bHome.pct - aHome.pct;
  }

  if (bHome.wins !== aHome.wins) {
    return bHome.wins - aHome.wins;
  }

  return a.id.localeCompare(b.id);
};

export const toSeededTeam = (
  team: Team,
  seed: number,
  clinchType: ClinchType,
  homeRecords: Map<string, HomeRecord>,
): SeededPlayoffTeam => {
  const homeRecord = homeRecords.get(team.id) ?? { wins: 0, losses: 0, pct: 0 };
  return {
    seed,
    clinchType,
    team,
    wins: team.wins,
    losses: team.losses,
    runDiff: getRunDiff(team),
    homeWins: homeRecord.wins,
    homeLosses: homeRecord.losses,
    homePct: homeRecord.pct,
  };
};

export const compareSeededTeams = (a: SeededPlayoffTeam, b: SeededPlayoffTeam): number => {
  if (a.seed !== b.seed) {
    return a.seed - b.seed;
  }

  if (b.wins !== a.wins) {
    return b.wins - a.wins;
  }

  if (b.runDiff !== a.runDiff) {
    return b.runDiff - a.runDiff;
  }

  if (b.homePct !== a.homePct) {
    return b.homePct - a.homePct;
  }

  return a.team.id.localeCompare(b.team.id);
};

export const getRoundBestOf = (round: PlayoffRoundKey): number => {
  if (round === 'wild_card') {
    return 3;
  }
  if (round === 'divisional') {
    return 5;
  }
  return 7;
};

const getProjectedSeriesScore = (bestOf: number, topSeed: SeededPlayoffTeam, bottomSeed: SeededPlayoffTeam) => {
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  const strengthMargin =
    (topSeed.wins - bottomSeed.wins) * 3 +
    (topSeed.runDiff - bottomSeed.runDiff) / 6 +
    (topSeed.homePct - bottomSeed.homePct) * 12 +
    (bottomSeed.seed - topSeed.seed) * 2;

  let loserWins = winsNeeded - 1;
  if (strengthMargin >= 18) {
    loserWins = Math.max(winsNeeded - 3, 0);
  } else if (strengthMargin >= 10) {
    loserWins = Math.max(winsNeeded - 2, 0);
  }

  return {
    topProjectedWins: winsNeeded,
    bottomProjectedWins: loserWins,
  };
};

const buildProjectedSeries = (
  id: string,
  round: PlayoffRoundKey,
  league: Team['league'] | 'GPB',
  label: string,
  bestOf: number,
  topSeed: SeededPlayoffTeam,
  bottomSeed: SeededPlayoffTeam,
): ProjectedSeries => {
  const projectedWinner = compareSeededTeams(topSeed, bottomSeed) <= 0 ? topSeed : bottomSeed;
  const projectedLoser = projectedWinner.team.id === topSeed.team.id ? bottomSeed : topSeed;
  const wins = getProjectedSeriesScore(bestOf, projectedWinner, projectedLoser);

  const topProjectedWins = projectedWinner.team.id === topSeed.team.id ? wins.topProjectedWins : wins.bottomProjectedWins;
  const bottomProjectedWins = projectedWinner.team.id === bottomSeed.team.id ? wins.topProjectedWins : wins.bottomProjectedWins;

  return {
    id,
    round,
    league,
    label,
    bestOf,
    topSeed,
    bottomSeed,
    projectedWinner,
    projectedResult: `${projectedWinner.team.name} ${wins.topProjectedWins}-${wins.bottomProjectedWins}`,
    topProjectedWins,
    bottomProjectedWins,
  };
};

export const getLeaguePlayoffSeeds = (
  teams: Team[],
  games: Game[],
  league: Team['league'],
): SeededPlayoffTeam[] => {
  const homeRecords = getHomeRecords(games);
  const leagueTeams = teams.filter((team) => team.league === league);
  const rankedByDivision = DIVISIONS.map((division) =>
    leagueTeams
      .filter((team) => team.division === division)
      .sort((a, b) => compareTeamsForPlayoffs(a, b, homeRecords)),
  );

  const divisionWinners = rankedByDivision.map((divisionTeams) => divisionTeams[0]).filter((team): team is Team => Boolean(team));
  const secondPlacers = rankedByDivision
    .map((divisionTeams) => divisionTeams[1])
    .filter((team): team is Team => Boolean(team))
    .sort((a, b) => compareTeamsForPlayoffs(a, b, homeRecords))
    .slice(0, 2);

  const divisionWinnerIds = new Set(divisionWinners.map((team) => team.id));
  return [...divisionWinners, ...secondPlacers]
    .sort((a, b) => compareTeamsForPlayoffs(a, b, homeRecords))
    .map((team, index) => toSeededTeam(team, index + 1, divisionWinnerIds.has(team.id) ? 'division' : 'wildcard', homeRecords));
};

const getLeagueProjection = (
  teams: Team[],
  games: Game[],
  league: Team['league'],
): LeaguePlayoffProjection => {
  const seeds = getLeaguePlayoffSeeds(teams, games, league);

  const wildCardA = buildProjectedSeries(`${league}-wc-a`, 'wild_card', league, `${league} Wild Card`, 3, seeds[2], seeds[5]);
  const wildCardB = buildProjectedSeries(`${league}-wc-b`, 'wild_card', league, `${league} Wild Card`, 3, seeds[3], seeds[4]);

  const wildCardWinners = [wildCardA.projectedWinner, wildCardB.projectedWinner].sort((a, b) => b.seed - a.seed);
  const lowerRemainingSeed = wildCardWinners[0];
  const upperRemainingSeed = wildCardWinners[1];

  const divisionalA = buildProjectedSeries(
    `${league}-ds-a`,
    'divisional',
    league,
    `${league} Divisional`,
    5,
    seeds[0],
    lowerRemainingSeed,
  );

  const divisionalB = buildProjectedSeries(
    `${league}-ds-b`,
    'divisional',
    league,
    `${league} Divisional`,
    5,
    seeds[1],
    upperRemainingSeed,
  );

  const finalists = [divisionalA.projectedWinner, divisionalB.projectedWinner].sort(compareSeededTeams);
  const leagueSeries = buildProjectedSeries(
    `${league}-cs`,
    'league_series',
    league,
    `${league} Series`,
    7,
    finalists[0],
    finalists[1],
  );

  return {
    league,
    seeds,
    wildCard: [wildCardA, wildCardB],
    divisional: [divisionalA, divisionalB],
    leagueSeries,
    champion: leagueSeries.projectedWinner,
  };
};

export const buildPlayoffProjection = (teams: Team[], games: Game[]): PlayoffProjection => {
  const platinum = getLeagueProjection(teams, games, 'Platinum');
  const prestige = getLeagueProjection(teams, games, 'Prestige');
  const worldSeriesTeams = [platinum.champion, prestige.champion].sort(compareSeededTeams);
  const worldSeries = buildProjectedSeries(
    'gpb-world-series',
    'world_series',
    'GPB',
    'GPB World Series',
    7,
    worldSeriesTeams[0],
    worldSeriesTeams[1],
  );

  return {
    status: 'projected',
    platinum,
    prestige,
    worldSeries,
    champion: worldSeries.projectedWinner,
  };
};
