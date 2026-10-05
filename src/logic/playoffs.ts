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
