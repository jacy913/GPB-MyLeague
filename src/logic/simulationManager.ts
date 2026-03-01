import { Game, PlayoffGameDetails, PlayoffLeague, PlayoffRoundKey, SimulationSettings, SimulationTarget, Team } from '../types';
import { addDaysToISODate, simulateGame } from './simulation';
import {
  SeededPlayoffTeam,
  compareSeededTeams,
  getLeaguePlayoffSeeds,
  getRoundBestOf,
  isPlayoffGame,
  isRegularSeasonGame,
} from './playoffs';

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

interface SeriesState {
  playoff: PlayoffGameDetails;
  games: Game[];
  topSeedTeamId: string;
  bottomSeedTeamId: string;
  topSeed: number;
  bottomSeed: number;
  winnerTeamId: string | null;
}

const ROUND_DAY_OFFSETS: Record<PlayoffRoundKey, number[]> = {
  wild_card: [0, 1, 3],
  divisional: [0, 1, 3, 4, 6],
  league_series: [0, 1, 3, 4, 6, 7, 9],
  world_series: [0, 1, 3, 4, 6, 7, 9],
};

const PLAYOFF_START_GAP_DAYS = 2;
const ROUND_REST_GAP_DAYS = 2;

const compareGameOrder = (a: Game, b: Game): number => {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }
  return a.gameId.localeCompare(b.gameId);
};

const randomInt = (min: number, max: number): number => {
  if (max <= min) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const generateHitsAndErrors = (runs: number): { hits: number; errors: number } => {
  const hitsFloor = Math.max(runs + 2, 3);
  const hitsCeiling = Math.max(hitsFloor + 5, runs + 7);
  const hits = randomInt(hitsFloor, hitsCeiling);
  const errorRoll = Math.random();
  const errors = errorRoll < 0.62 ? 0 : errorRoll < 0.88 ? 1 : errorRoll < 0.98 ? 2 : 3;
  return { hits, errors };
};

const getRegularSeasonEndDate = (games: Game[], fallbackDate: string): string => {
  const regularDates = games.filter(isRegularSeasonGame).map((game) => game.date).sort((a, b) => a.localeCompare(b));
  return regularDates[regularDates.length - 1] ?? fallbackDate;
};

const getNextRoundLabel = (league: PlayoffLeague, round: PlayoffRoundKey): string => {
  if (round === 'world_series') {
    return 'GPB World Series';
  }

  const baseLeague = league === 'GPB' ? 'GPB' : league;
  if (round === 'wild_card') {
    return `${baseLeague} Wild Card`;
  }
  if (round === 'divisional') {
    return `${baseLeague} Divisional`;
  }
  return `${baseLeague} Series`;
};

const getHigherSeedHomePattern = (round: PlayoffRoundKey): boolean[] => {
  if (round === 'wild_card') {
    return [true, true, false];
  }
  if (round === 'divisional') {
    return [true, true, false, false, true];
  }
  return [true, true, false, false, false, true, true];
};

export class SimulationManager {
  private readonly settings: SimulationSettings;
  private readonly teamOrder: string[];
  private readonly teamsById: Map<string, Team>;
  private games: Game[];
  private readonly seasonStartDate: string;
  private readonly regularSeasonEndDate: string;
  private currentDate: string;

  constructor(input: SimulationManagerInput) {
    this.settings = input.settings;
    this.teamOrder = input.teams.map((team) => team.id);
    this.teamsById = new Map(input.teams.map((team) => [team.id, { ...team }]));
    this.games = input.games
      .map((game) => ({
        ...game,
        phase: game.phase ?? 'regular_season',
        playoff: game.playoff ? { ...game.playoff } : null,
        score: { ...game.score },
        stats: { ...game.stats },
      }))
      .sort(compareGameOrder);

    this.seasonStartDate = this.games[0]?.date ?? input.currentDate;
    this.regularSeasonEndDate = getRegularSeasonEndDate(this.games, input.currentDate);
    this.currentDate = input.currentDate || this.seasonStartDate;
  }

  private getAllDates(): string[] {
    return Array.from(new Set(this.games.map((game) => game.date))).sort((a, b) => a.localeCompare(b));
  }

  private snapDateToExisting(rawDate: string): string {
    const dates = this.getAllDates();
    if (dates.length === 0) {
      return rawDate;
    }

    const onOrAfter = dates.find((date) => date >= rawDate);
    return onOrAfter ?? dates[dates.length - 1];
  }

  private getScheduledGames(predicate?: (game: Game) => boolean): Game[] {
    return this.games
      .filter((game) => game.status === 'scheduled' && (predicate ? predicate(game) : true))
      .sort(compareGameOrder);
  }

  private getNextScheduledGame(predicate?: (game: Game) => boolean): Game | undefined {
    return this.getScheduledGames(predicate)[0];
  }

  private getNextGameNumber(): number {
    return this.games.reduce((maxValue, game) => {
      const match = game.gameId.match(/(\d+)$/);
      const nextValue = match ? Number(match[1]) : 0;
      return Number.isFinite(nextValue) ? Math.max(maxValue, nextValue) : maxValue;
    }, 0) + 1;
  }

  private getSeriesMetadata(game: Game): {
    topSeedTeamId: string;
    bottomSeedTeamId: string;
    topSeed: number;
    bottomSeed: number;
  } | null {
    if (!game.playoff) {
      return null;
    }

    const topSeedTeamId = typeof game.stats.topSeedTeamId === 'string' ? game.stats.topSeedTeamId : '';
    const bottomSeedTeamId = typeof game.stats.bottomSeedTeamId === 'string' ? game.stats.bottomSeedTeamId : '';
    const topSeed = typeof game.stats.topSeed === 'number' ? game.stats.topSeed : 0;
    const bottomSeed = typeof game.stats.bottomSeed === 'number' ? game.stats.bottomSeed : 0;

    if (!topSeedTeamId || !bottomSeedTeamId || topSeed <= 0 || bottomSeed <= 0) {
      return null;
    }

    return { topSeedTeamId, bottomSeedTeamId, topSeed, bottomSeed };
  }

  private buildSeriesState(games: Game[]): SeriesState | null {
    const playoff = games[0]?.playoff;
    const metadata = this.getSeriesMetadata(games[0]);
    if (!playoff || !metadata) {
      return null;
    }

    const winsNeeded = Math.floor(playoff.bestOf / 2) + 1;
    const winsByTeam = new Map<string, number>();
    games
      .filter((game) => game.status === 'completed')
      .forEach((game) => {
        const winner = game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
        winsByTeam.set(winner, (winsByTeam.get(winner) ?? 0) + 1);
      });

    const winnerEntry = Array.from(winsByTeam.entries()).find(([, wins]) => wins >= winsNeeded);

    return {
      playoff,
      games,
      topSeedTeamId: metadata.topSeedTeamId,
      bottomSeedTeamId: metadata.bottomSeedTeamId,
      topSeed: metadata.topSeed,
      bottomSeed: metadata.bottomSeed,
      winnerTeamId: winnerEntry?.[0] ?? null,
    };
  }

  private getRoundSeriesStates(round: PlayoffRoundKey, league: PlayoffLeague): SeriesState[] {
    const seriesMap = new Map<string, Game[]>();
    this.games.forEach((game) => {
      if (!game.playoff || game.playoff.round !== round || game.playoff.league !== league) {
        return;
      }

      const current = seriesMap.get(game.playoff.seriesId) ?? [];
      current.push(game);
      seriesMap.set(game.playoff.seriesId, current);
    });

    return Array.from(seriesMap.values())
      .map((games) => games.sort(compareGameOrder))
      .map((games) => this.buildSeriesState(games))
      .filter((state): state is SeriesState => Boolean(state));
  }

  private cleanupClinchedPlayoffGames(): void {
    const seriesMap = new Map<string, Game[]>();
    this.games.forEach((game) => {
      if (!game.playoff) {
        return;
      }
      const current = seriesMap.get(game.playoff.seriesId) ?? [];
      current.push(game);
      seriesMap.set(game.playoff.seriesId, current);
    });

    const clinchedSeriesIds = new Set<string>();
    seriesMap.forEach((games, seriesId) => {
      const state = this.buildSeriesState(games.sort(compareGameOrder));
      if (state?.winnerTeamId) {
        clinchedSeriesIds.add(seriesId);
      }
    });

    if (clinchedSeriesIds.size === 0) {
      return;
    }

    this.games = this.games.filter((game) => {
      if (!game.playoff) {
        return true;
      }

      if (!clinchedSeriesIds.has(game.playoff.seriesId)) {
        return true;
      }

      return game.status === 'completed';
    });
  }

  private getLeagueSeeds(league: Team['league']): SeededPlayoffTeam[] {
    const teams = this.teamOrder
      .map((id) => this.teamsById.get(id))
      .filter((team): team is Team => Boolean(team));

    return getLeaguePlayoffSeeds(teams, this.games, league);
  }

  private getSeedMap(league: Team['league']): Map<string, SeededPlayoffTeam> {
    return new Map(this.getLeagueSeeds(league).map((seed) => [seed.team.id, seed]));
  }

  private createSeriesGame(
    round: PlayoffRoundKey,
    league: PlayoffLeague,
    seriesId: string,
    topSeed: SeededPlayoffTeam,
    bottomSeed: SeededPlayoffTeam,
    startDate: string,
    gameNumber: number,
    seriesLabel?: string,
  ): Game {
    const bestOf = getRoundBestOf(round);
    const dayOffsets = ROUND_DAY_OFFSETS[round];
    const homePattern = getHigherSeedHomePattern(round);
    const offset = dayOffsets[gameNumber - 1] ?? dayOffsets[dayOffsets.length - 1] ?? 0;
    const higherSeedAtHome = homePattern[gameNumber - 1] ?? homePattern[homePattern.length - 1] ?? true;
    const homeTeam = higherSeedAtHome ? topSeed.team.id : bottomSeed.team.id;
    const awayTeam = higherSeedAtHome ? bottomSeed.team.id : topSeed.team.id;

    return {
      gameId: `p-${String(this.getNextGameNumber()).padStart(5, '0')}`,
      date: addDaysToISODate(startDate, offset),
      homeTeam,
      awayTeam,
      phase: 'playoffs',
      status: 'scheduled',
      score: { home: 0, away: 0 },
      playoff: {
        round,
        league,
        seriesId,
        seriesLabel: seriesLabel ?? getNextRoundLabel(league, round),
        gameNumber,
        bestOf,
      },
      stats: {
        topSeedTeamId: topSeed.team.id,
        bottomSeedTeamId: bottomSeed.team.id,
        topSeed: topSeed.seed,
        bottomSeed: bottomSeed.seed,
      },
    };
  }

  private appendGame(gameToAdd: Game): void {
    this.games = [...this.games, gameToAdd].sort(compareGameOrder);
  }

  private ensureSeriesHasNextGame(
    round: PlayoffRoundKey,
    league: PlayoffLeague,
    seriesId: string,
    topSeed: SeededPlayoffTeam,
    bottomSeed: SeededPlayoffTeam,
    startDate: string,
    seriesLabel?: string,
  ): void {
    const seriesGames = this.games
      .filter((game) => game.playoff?.seriesId === seriesId)
      .sort(compareGameOrder);

    if (seriesGames.some((game) => game.status === 'scheduled')) {
      return;
    }

    const bestOf = getRoundBestOf(round);
    const state = seriesGames.length > 0 ? this.buildSeriesState(seriesGames) : null;
    if (state?.winnerTeamId) {
      return;
    }

    const existingGameCount = seriesGames.length;
    const nextGameNumber = existingGameCount + 1;
    if (nextGameNumber > bestOf) {
      return;
    }

    this.appendGame(
      this.createSeriesGame(round, league, seriesId, topSeed, bottomSeed, startDate, nextGameNumber, seriesLabel),
    );
  }

  private maybeAdvanceActiveSeries(): void {
    const seriesMap = new Map<string, Game[]>();
    this.games.forEach((game) => {
      if (!game.playoff) {
        return;
      }

      const current = seriesMap.get(game.playoff.seriesId) ?? [];
      current.push(game);
      seriesMap.set(game.playoff.seriesId, current);
    });

    seriesMap.forEach((seriesGames) => {
      const orderedGames = [...seriesGames].sort(compareGameOrder);
      const sampleGame = orderedGames[0];
      const playoff = sampleGame?.playoff;
      const metadata = this.getSeriesMetadata(sampleGame);
      if (!playoff || !metadata) {
        return;
      }

      if (orderedGames.some((game) => game.status === 'scheduled')) {
        return;
      }

      const state = this.buildSeriesState(orderedGames);
      if (state?.winnerTeamId) {
        return;
      }

      const topSeedTeam = this.teamsById.get(metadata.topSeedTeamId);
      const bottomSeedTeam = this.teamsById.get(metadata.bottomSeedTeamId);
      if (!topSeedTeam || !bottomSeedTeam) {
        return;
      }

      const startDate = orderedGames[0].date;
      this.ensureSeriesHasNextGame(
        playoff.round,
        playoff.league,
        playoff.seriesId,
        { team: topSeedTeam, seed: metadata.topSeed, isDivisionWinner: false },
        { team: bottomSeedTeam, seed: metadata.bottomSeed, isDivisionWinner: false },
        startDate,
        playoff.seriesLabel,
      );
    });
  }

  private maybeCreateInitialPlayoffs(): void {
    const hasPlayoffGames = this.games.some(isPlayoffGame);
    const regularSeasonScheduled = this.games.some((game) => isRegularSeasonGame(game) && game.status === 'scheduled');
    if (hasPlayoffGames || regularSeasonScheduled) {
      return;
    }

    const startDate = addDaysToISODate(this.regularSeasonEndDate, PLAYOFF_START_GAP_DAYS);
    const platinumSeeds = this.getLeagueSeeds('Platinum');
    const prestigeSeeds = this.getLeagueSeeds('Prestige');

    if (platinumSeeds.length < 6 || prestigeSeeds.length < 6) {
      return;
    }

    this.ensureSeriesHasNextGame('wild_card', 'Platinum', 'Platinum-wc-a', platinumSeeds[2], platinumSeeds[5], startDate);
    this.ensureSeriesHasNextGame('wild_card', 'Platinum', 'Platinum-wc-b', platinumSeeds[3], platinumSeeds[4], startDate);
    this.ensureSeriesHasNextGame('wild_card', 'Prestige', 'Prestige-wc-a', prestigeSeeds[2], prestigeSeeds[5], startDate);
    this.ensureSeriesHasNextGame('wild_card', 'Prestige', 'Prestige-wc-b', prestigeSeeds[3], prestigeSeeds[4], startDate);
  }

  private maybeCreateDivisionalRound(league: Team['league']): void {
    if (this.getRoundSeriesStates('divisional', league).length > 0) {
      return;
    }

    const wildCardStates = this.getRoundSeriesStates('wild_card', league);
    if (wildCardStates.length !== 2 || wildCardStates.some((state) => !state.winnerTeamId)) {
      return;
    }

    const seedMap = this.getSeedMap(league);
    const winners = wildCardStates
      .map((state) => (state.winnerTeamId ? seedMap.get(state.winnerTeamId) ?? null : null))
      .filter((seed): seed is SeededPlayoffTeam => Boolean(seed))
      .sort((a, b) => b.seed - a.seed);

    const seeds = this.getLeagueSeeds(league);
    if (winners.length !== 2 || seeds.length < 2) {
      return;
    }

    const roundEndDate = wildCardStates
      .flatMap((state) => state.games.map((game) => game.date))
      .sort((a, b) => a.localeCompare(b))
      .at(-1);

    if (!roundEndDate) {
      return;
    }

    const startDate = addDaysToISODate(roundEndDate, ROUND_REST_GAP_DAYS);
    this.ensureSeriesHasNextGame('divisional', league, `${league}-ds-a`, seeds[0], winners[0], startDate);
    this.ensureSeriesHasNextGame('divisional', league, `${league}-ds-b`, seeds[1], winners[1], startDate);
  }

  private maybeCreateLeagueSeries(league: Team['league']): void {
    if (this.getRoundSeriesStates('league_series', league).length > 0) {
      return;
    }

    const divisionalStates = this.getRoundSeriesStates('divisional', league);
    if (divisionalStates.length !== 2 || divisionalStates.some((state) => !state.winnerTeamId)) {
      return;
    }

    const seedMap = this.getSeedMap(league);
    const finalists = divisionalStates
      .map((state) => (state.winnerTeamId ? seedMap.get(state.winnerTeamId) ?? null : null))
      .filter((seed): seed is SeededPlayoffTeam => Boolean(seed))
      .sort(compareSeededTeams);

    if (finalists.length !== 2) {
      return;
    }

    const roundEndDate = divisionalStates
      .flatMap((state) => state.games.map((game) => game.date))
      .sort((a, b) => a.localeCompare(b))
      .at(-1);

    if (!roundEndDate) {
      return;
    }

    const startDate = addDaysToISODate(roundEndDate, ROUND_REST_GAP_DAYS);
    this.ensureSeriesHasNextGame('league_series', league, `${league}-cs`, finalists[0], finalists[1], startDate);
  }

  private maybeCreateWorldSeries(): void {
    if (this.getRoundSeriesStates('world_series', 'GPB').length > 0) {
      return;
    }

    const platinumLeagueSeries = this.getRoundSeriesStates('league_series', 'Platinum')[0];
    const prestigeLeagueSeries = this.getRoundSeriesStates('league_series', 'Prestige')[0];
    if (!platinumLeagueSeries?.winnerTeamId || !prestigeLeagueSeries?.winnerTeamId) {
      return;
    }

    const platinumChampion = this.getSeedMap('Platinum').get(platinumLeagueSeries.winnerTeamId);
    const prestigeChampion = this.getSeedMap('Prestige').get(prestigeLeagueSeries.winnerTeamId);
    if (!platinumChampion || !prestigeChampion) {
      return;
    }

    const finalists = [platinumChampion, prestigeChampion].sort(compareSeededTeams);
    const latestLeagueSeriesDate = [platinumLeagueSeries, prestigeLeagueSeries]
      .flatMap((state) => state.games.map((game) => game.date))
      .sort((a, b) => a.localeCompare(b))
      .at(-1);

    if (!latestLeagueSeriesDate) {
      return;
    }

    const startDate = addDaysToISODate(latestLeagueSeriesDate, ROUND_REST_GAP_DAYS);
    this.ensureSeriesHasNextGame('world_series', 'GPB', 'GPB-world-series', finalists[0], finalists[1], startDate);
  }

  private ensurePlayoffSchedule(): void {
    this.cleanupClinchedPlayoffGames();
    this.maybeCreateInitialPlayoffs();
    this.maybeAdvanceActiveSeries();
    this.maybeCreateDivisionalRound('Platinum');
    this.maybeCreateDivisionalRound('Prestige');
    this.maybeAdvanceActiveSeries();
    this.maybeCreateLeagueSeries('Platinum');
    this.maybeCreateLeagueSeries('Prestige');
    this.maybeAdvanceActiveSeries();
    this.maybeCreateWorldSeries();
    this.maybeAdvanceActiveSeries();
  }

  private applyGameResult(game: Game): void {
    const homeTeam = this.teamsById.get(game.homeTeam);
    const awayTeam = this.teamsById.get(game.awayTeam);
    if (!homeTeam || !awayTeam) {
      return;
    }

    const result = simulateGame(homeTeam, awayTeam, this.settings);
    const homeBox = generateHitsAndErrors(result.homeScore);
    const awayBox = generateHitsAndErrors(result.awayScore);
    game.status = 'completed';
    game.score = { home: result.homeScore, away: result.awayScore };
    game.stats = {
      ...game.stats,
      winProbHome: Number(result.winProbHome.toFixed(4)),
      homeHits: homeBox.hits,
      awayHits: awayBox.hits,
      homeErrors: homeBox.errors,
      awayErrors: awayBox.errors,
      simulatedAt: new Date().toISOString(),
    };

    if (isRegularSeasonGame(game)) {
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
  }

  private getCandidateGame(normalizedCurrent: string, target: SimulationTarget, targetEndDate: string | null): Game | undefined {
    if (target.scope === 'season') {
      return this.getNextScheduledGame();
    }

    if (target.scope === 'regular_season') {
      return this.getNextScheduledGame((game) => isRegularSeasonGame(game) && game.date >= normalizedCurrent);
    }

    if (target.scope === 'next_game') {
      const teamId = target.teamId ?? '';
      return this.getNextScheduledGame((game) => game.date >= normalizedCurrent && (game.homeTeam === teamId || game.awayTeam === teamId));
    }

    if (!targetEndDate) {
      return undefined;
    }

    return this.getNextScheduledGame((game) => game.date >= normalizedCurrent && game.date <= targetEndDate);
  }

  public run(target: SimulationTarget): SimulationManagerResult {
    const normalizedCurrent = this.currentDate || this.seasonStartDate;
    const targetEndDate =
      target.scope === 'to_date'
        ? target.targetDate ?? normalizedCurrent
        : target.scope === 'day'
          ? normalizedCurrent
          : target.scope === 'week'
            ? addDaysToISODate(normalizedCurrent, 6)
            : target.scope === 'month'
              ? addDaysToISODate(normalizedCurrent, 29)
              : null;

    let simulatedGameCount = 0;
    let lastSimulatedDate = normalizedCurrent;

    while (true) {
      this.ensurePlayoffSchedule();
      const candidate = this.getCandidateGame(normalizedCurrent, target, targetEndDate);
      if (!candidate) {
        break;
      }

      this.applyGameResult(candidate);
      simulatedGameCount += 1;
      lastSimulatedDate = candidate.date;

      if (target.scope === 'next_game') {
        break;
      }
    }

    this.ensurePlayoffSchedule();

    if (target.scope === 'day') {
      this.currentDate = this.snapDateToExisting(addDaysToISODate(normalizedCurrent, 1));
    } else if (target.scope === 'week') {
      this.currentDate = this.snapDateToExisting(addDaysToISODate(normalizedCurrent, 7));
    } else if (target.scope === 'month') {
      this.currentDate = this.snapDateToExisting(addDaysToISODate(normalizedCurrent, 30));
    } else if (target.scope === 'to_date') {
      this.currentDate = this.snapDateToExisting(targetEndDate ?? normalizedCurrent);
    } else if (target.scope === 'regular_season') {
      this.currentDate = this.snapDateToExisting(this.regularSeasonEndDate);
    } else if (simulatedGameCount > 0) {
      this.currentDate = this.snapDateToExisting(lastSimulatedDate);
    } else {
      this.currentDate = this.snapDateToExisting(normalizedCurrent);
    }

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
        playoff: game.playoff ? { ...game.playoff } : null,
        score: { ...game.score },
        stats: { ...game.stats },
      })),
      currentDate: this.currentDate,
      simulatedGameCount,
      progress,
    };
  }
}
