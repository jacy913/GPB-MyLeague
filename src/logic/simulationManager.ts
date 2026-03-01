import { Game, SimulationSettings, SimulationTarget, Team } from '../types';
import { addDaysToISODate, simulateGame } from './simulation';

export interface SimulationManagerInput {
  teams: Team[];
  games: Game[];
  settings: SimulationSettings;
  currentDate: string;
}

export interface SimulationManagerResult {
  teams: Team[];
  games: Game[];
  currentDate: string;
  simulatedGameCount: number;
  progress: number;
}

const compareGameOrder = (a: Game, b: Game): number => {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }
  return a.gameId.localeCompare(b.gameId);
};

const clampDateToSeason = (date: string, seasonStart: string, seasonEnd: string): string => {
  if (date < seasonStart) {
    return seasonStart;
  }
  if (date > seasonEnd) {
    return seasonEnd;
  }
  return date;
};

export class SimulationManager {
  private readonly settings: SimulationSettings;
  private readonly teamOrder: string[];
  private readonly teamsById: Map<string, Team>;
  private readonly games: Game[];
  private readonly seasonStartDate: string;
  private readonly seasonEndDate: string;
  private currentDate: string;

  constructor(input: SimulationManagerInput) {
    this.settings = input.settings;
    this.teamOrder = input.teams.map((team) => team.id);
    this.teamsById = new Map(input.teams.map((team) => [team.id, { ...team }]));
    this.games = input.games
      .map((game) => ({
        ...game,
        score: { ...game.score },
        stats: { ...game.stats },
      }))
      .sort(compareGameOrder);

    this.seasonStartDate = this.games[0]?.date ?? input.currentDate;
    this.seasonEndDate = this.games[this.games.length - 1]?.date ?? input.currentDate;
    this.currentDate = input.currentDate || this.seasonStartDate;
  }

  private getScheduledGames(): Game[] {
    return this.games.filter((game) => game.status === 'scheduled').sort(compareGameOrder);
  }

  private getGamesInDateRange(fromDate: string, toDate: string): Game[] {
    return this.getScheduledGames().filter((game) => game.date >= fromDate && game.date <= toDate);
  }

  private getNextScheduledGameForTeam(teamId: string): Game | undefined {
    return this.getScheduledGames().find((game) => game.homeTeam === teamId || game.awayTeam === teamId);
  }

  private applyGameResult(game: Game): void {
    const homeTeam = this.teamsById.get(game.homeTeam);
    const awayTeam = this.teamsById.get(game.awayTeam);
    if (!homeTeam || !awayTeam) {
      return;
    }

    const result = simulateGame(homeTeam, awayTeam, this.settings);
    game.status = 'completed';
    game.score = { home: result.homeScore, away: result.awayScore };
    game.stats = {
      winProbHome: Number(result.winProbHome.toFixed(4)),
      simulatedAt: new Date().toISOString(),
    };

    homeTeam.runsScored += result.homeScore;
    homeTeam.runsAllowed += result.awayScore;
    awayTeam.runsScored += result.awayScore;
    awayTeam.runsAllowed += result.homeScore;

    if (result.homeScore > result.awayScore) {
      homeTeam.wins += 1;
      awayTeam.losses += 1;
    } else {
      awayTeam.wins += 1;
      homeTeam.losses += 1;
    }
  }

  public run(target: SimulationTarget): SimulationManagerResult {
    const normalizedCurrent = clampDateToSeason(this.currentDate, this.seasonStartDate, this.seasonEndDate);
    let nextCurrentDate = normalizedCurrent;
    let gamesToSimulate: Game[] = [];

    if (target.scope === 'to_date') {
      const requested = target.targetDate ?? normalizedCurrent;
      const endDate = clampDateToSeason(requested, this.seasonStartDate, this.seasonEndDate);
      if (endDate >= normalizedCurrent) {
        gamesToSimulate = this.getGamesInDateRange(normalizedCurrent, endDate);
      }
      nextCurrentDate = endDate >= normalizedCurrent ? endDate : normalizedCurrent;
    } else if (target.scope === 'day') {
      const endDate = clampDateToSeason(normalizedCurrent, this.seasonStartDate, this.seasonEndDate);
      gamesToSimulate = this.getGamesInDateRange(normalizedCurrent, endDate);
      nextCurrentDate = clampDateToSeason(addDaysToISODate(normalizedCurrent, 1), this.seasonStartDate, this.seasonEndDate);
    } else if (target.scope === 'week') {
      const endDate = clampDateToSeason(addDaysToISODate(normalizedCurrent, 6), this.seasonStartDate, this.seasonEndDate);
      gamesToSimulate = this.getGamesInDateRange(normalizedCurrent, endDate);
      nextCurrentDate = clampDateToSeason(addDaysToISODate(normalizedCurrent, 7), this.seasonStartDate, this.seasonEndDate);
    } else if (target.scope === 'month') {
      const endDate = clampDateToSeason(addDaysToISODate(normalizedCurrent, 29), this.seasonStartDate, this.seasonEndDate);
      gamesToSimulate = this.getGamesInDateRange(normalizedCurrent, endDate);
      nextCurrentDate = clampDateToSeason(addDaysToISODate(normalizedCurrent, 30), this.seasonStartDate, this.seasonEndDate);
    } else if (target.scope === 'season') {
      gamesToSimulate = this.getScheduledGames();
      nextCurrentDate = this.seasonEndDate;
    } else if (target.scope === 'next_game') {
      const teamId = target.teamId ?? '';
      const nextGame = this.getNextScheduledGameForTeam(teamId);
      if (nextGame) {
        gamesToSimulate = [nextGame];
        nextCurrentDate = nextGame.date;
      }
    }

    gamesToSimulate.sort(compareGameOrder).forEach((game) => this.applyGameResult(game));

    this.currentDate = nextCurrentDate;
    const completedGames = this.games.filter((game) => game.status === 'completed').length;
    const progress = this.games.length > 0 ? (completedGames / this.games.length) * 100 : 0;

    const teams = this.teamOrder
      .map((id) => this.teamsById.get(id))
      .filter((team): team is Team => Boolean(team))
      .map((team) => ({ ...team }));

    return {
      teams,
      games: this.games.map((game) => ({
        ...game,
        score: { ...game.score },
        stats: { ...game.stats },
      })),
      currentDate: this.currentDate,
      simulatedGameCount: gamesToSimulate.length,
      progress,
    };
  }
}

