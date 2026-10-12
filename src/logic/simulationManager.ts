import { Game, LeaguePlayerState, PlayoffGameDetails, PlayoffLeague, PlayoffRoundKey, SimulationSettings, SimulationTarget, Team } from '../types';
import { addDaysToISODate } from './simulation';
import { buildCompletedGameFromSession, createGameSession, simulateGameToFinal } from './gameEngine';
import { buildGameParticipants, buildPitcherRestIndex, readPitchersUsed, type GameParticipantsBuildContext } from './gameParticipants';
import {
  applyPlayerGameStatDeltaToAccumulator,
  createPlayerStatAccumulator,
  materializePlayerStatAccumulator,
  PlayerStatAccumulator,
} from './playerStats';
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
  playerState: LeaguePlayerState;
  settings: SimulationSettings;
  currentDate: string;
}

export interface SimulationManagerResult {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  currentDate: string;
  simulatedGameCount: number;
  progress: number;
}

export interface SimulationProgressUpdate {
  label: string;
  completedGames: number;
  totalGames: number;
  currentDate: string;
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
  private readonly playersById: Map<string, LeaguePlayerState['players'][number]>;
  private readonly participantBuildContext: Omit<GameParticipantsBuildContext, 'battingStatsByPlayerId' | 'pitchingStatsByPlayerId'>;
  private readonly playerStatAccumulator: PlayerStatAccumulator;
  private games: Game[];
  private playerState: LeaguePlayerState;
  private readonly seasonStartDate: string;
  private readonly regularSeasonEndDate: string;
  private currentDate: string;
  private allDates: string[];
  private nextGameNumber: number;
  private readonly leagueSeedCache = new Map<Team['league'], SeededPlayoffTeam[]>();
  private readonly seedMapCache = new Map<Team['league'], Map<string, SeededPlayoffTeam>>();
  /**
   * Last date each pitcher appeared, maintained incrementally.
   *
   * Seeded once from the games already on the books, so a run that resumes
   * mid-season inherits the rest history instead of starting every arm fresh.
   * From then on `applyGameResult` folds each finished game in as it completes,
   * which keeps this O(1) per game rather than re-reading the ledger of every
   * completed game before every pregame.
   */
  private readonly pitcherRestByPlayerId: Map<string, string>;

  /**
   * ADOPT A ROSTER CHANGED BY SOMETHING OTHER THAN THE SIMULATION.
   *
   * The simulation worker runs a market between simulated days: it signs free agents and it accepts
   * trades, both of which rewrite `players`, `rosterSlots` and `transactions`. Those edits used to go
   * into the worker's own `playerState` and then evaporate, because the manager is constructed ONCE for
   * the whole run and `run()` reads `this.playerState` -- the copy it made at construction.
   *
   * So every trade the league generated was applied and then thrown away on the next day. Measured on a
   * real season: 79 proposals generated, 48 accepted, 0 surviving in the save. The signings were no
   * better -- the league kept three, which were the ones that happened on the FINAL day, because those
   * had no following day to be overwritten by.
   *
   * `run()` itself is untouched. This is the missing half of the contract: a caller that owns the player
   * state and mutates it between runs needs a way to hand it back, exactly as it already receives it.
   *
   * The derived caches are rebuilt rather than patched, because a trade is precisely the case where they
   * go stale: `playersById` and the per-team roster index both describe who is on which roster, and
   * `participantBuildContext` is what turns a roster slot into the participants for a game. Rebuilding is
   * O(players + slots) once per market pass, which is nothing beside a day's games.
   *
   * `playerStatAccumulator` is deliberately NOT rebuilt. The accumulator is this manager's own record of
   * the season it simulated, and it is materialised into the returned state at the end of every `run`.
   * Re-seeding it would be harmless for stats the market did not touch and would silently drop running
   * season totals if the two ever disagreed -- and they do disagree, because
   * `materializePlayerStatAccumulator` returns the accumulator's view rather than the adopted one.
   */
  adoptPlayerState(next: LeaguePlayerState): void {
    this.playerState = {
      players: next.players.map((player) => ({ ...player })),
      battingStats: next.battingStats.map((stat) => ({ ...stat })),
      pitchingStats: next.pitchingStats.map((stat) => ({ ...stat })),
      battingRatings: next.battingRatings.map((rating) => ({ ...rating })),
      pitchingRatings: next.pitchingRatings.map((rating) => ({ ...rating })),
      rosterSlots: next.rosterSlots.map((slot) => ({ ...slot })),
      transactions: next.transactions.map((transaction) => ({ ...transaction })),
    };

    this.playersById.clear();
    for (const player of this.playerState.players) {
      this.playersById.set(player.playerId, player);
    }

    const latestSeasonYear = this.playerState.rosterSlots.length > 0
      ? Math.max(...this.playerState.rosterSlots.map((slot) => slot.seasonYear))
      : null;
    const rosterSlotsByTeamId = new Map<string, typeof this.playerState.rosterSlots>();
    if (latestSeasonYear !== null) {
      this.playerState.rosterSlots.forEach((slot) => {
        if (slot.seasonYear !== latestSeasonYear) {
          return;
        }
        const current = rosterSlotsByTeamId.get(slot.teamId) ?? [];
        current.push(slot);
        rosterSlotsByTeamId.set(slot.teamId, current);
      });
    }
    this.participantBuildContext.latestSeasonYear = latestSeasonYear;
    this.participantBuildContext.playersById = this.playersById;
    this.participantBuildContext.battingRatingsByPlayerId = this.getLatestBattingRatingsByPlayerId();
    this.participantBuildContext.pitchingRatingsByPlayerId = this.getLatestPitchingRatingsByPlayerId();
    this.participantBuildContext.rosterSlotsByTeamId = rosterSlotsByTeamId;
  }

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
    this.playerState = {
      players: input.playerState.players.map((player) => ({ ...player })),
      battingStats: input.playerState.battingStats.map((stat) => ({ ...stat })),
      pitchingStats: input.playerState.pitchingStats.map((stat) => ({ ...stat })),
      battingRatings: input.playerState.battingRatings.map((rating) => ({ ...rating })),
      pitchingRatings: input.playerState.pitchingRatings.map((rating) => ({ ...rating })),
      rosterSlots: input.playerState.rosterSlots.map((slot) => ({ ...slot })),
      transactions: input.playerState.transactions.map((transaction) => ({ ...transaction })),
    };
    this.playersById = new Map(this.playerState.players.map((player) => [player.playerId, player]));
    this.playerStatAccumulator = createPlayerStatAccumulator(this.playerState);
    const latestSeasonYear = this.playerState.rosterSlots.length > 0
      ? Math.max(...this.playerState.rosterSlots.map((slot) => slot.seasonYear))
      : null;
    const rosterSlotsByTeamId = new Map<string, typeof this.playerState.rosterSlots>();
    if (latestSeasonYear !== null) {
      this.playerState.rosterSlots.forEach((slot) => {
        if (slot.seasonYear !== latestSeasonYear) {
          return;
        }
        const current = rosterSlotsByTeamId.get(slot.teamId) ?? [];
        current.push(slot);
        rosterSlotsByTeamId.set(slot.teamId, current);
      });
    }
    this.participantBuildContext = {
      latestSeasonYear,
      playersById: this.playersById,
      battingRatingsByPlayerId: this.getLatestBattingRatingsByPlayerId(),
      pitchingRatingsByPlayerId: this.getLatestPitchingRatingsByPlayerId(),
      rosterSlotsByTeamId,
    };

    this.seasonStartDate = this.games[0]?.date ?? input.currentDate;
    this.regularSeasonEndDate = getRegularSeasonEndDate(this.games, input.currentDate);
    this.currentDate = input.currentDate || this.seasonStartDate;
    this.allDates = this.buildAllDates();
    this.nextGameNumber = this.computeNextGameNumber();
    // A sentinel past every real date, because this seed wants the WHOLE
    // history rather than the history before some particular game.
    this.pitcherRestByPlayerId = buildPitcherRestIndex(this.games, '9999-12-31');
  }

  private getLatestBattingRatingsByPlayerId() {
    const byPlayerId = new Map<string, LeaguePlayerState['battingRatings'][number]>();
    [...this.playerState.battingRatings]
      .sort((left, right) => right.seasonYear - left.seasonYear)
      .forEach((rating) => {
        if (!byPlayerId.has(rating.playerId)) {
          byPlayerId.set(rating.playerId, rating);
        }
      });
    return byPlayerId;
  }

  private getLatestPitchingRatingsByPlayerId() {
    const byPlayerId = new Map<string, LeaguePlayerState['pitchingRatings'][number]>();
    [...this.playerState.pitchingRatings]
      .sort((left, right) => right.seasonYear - left.seasonYear)
      .forEach((rating) => {
        if (!byPlayerId.has(rating.playerId)) {
          byPlayerId.set(rating.playerId, rating);
        }
      });
    return byPlayerId;
  }

  private buildAllDates(): string[] {
    return Array.from(new Set(this.games.map((game) => game.date))).sort((a, b) => a.localeCompare(b));
  }

  private refreshGameIndexes(): void {
    this.allDates = this.buildAllDates();
  }

  private clearSeedCaches(): void {
    this.leagueSeedCache.clear();
    this.seedMapCache.clear();
  }

  private snapDateToExisting(rawDate: string): string {
    if (this.allDates.length === 0) {
      return rawDate;
    }

    const onOrAfter = this.allDates.find((date) => date >= rawDate);
    return onOrAfter ?? rawDate;
  }

  private getScheduledGames(predicate?: (game: Game) => boolean): Game[] {
    return this.games.filter((game) => game.status === 'scheduled' && (predicate ? predicate(game) : true));
  }

  private getNextScheduledGame(predicate?: (game: Game) => boolean): Game | undefined {
    return this.games.find((game) => game.status === 'scheduled' && (predicate ? predicate(game) : true));
  }

  private getScheduledGameCount(predicate?: (game: Game) => boolean): number {
    let count = 0;
    this.games.forEach((game) => {
      if (game.status === 'scheduled' && (predicate ? predicate(game) : true)) {
        count += 1;
      }
    });
    return count;
  }

  private computeNextGameNumber(): number {
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

    if (topSeedTeamId && bottomSeedTeamId && topSeed > 0 && bottomSeed > 0) {
      return { topSeedTeamId, bottomSeedTeamId, topSeed, bottomSeed };
    }

    // Backward-compat fallback for legacy playoff games that were saved without seed metadata.
    const homeSeed =
      game.playoff.league === 'Platinum'
        ? this.getSeedMap('Platinum').get(game.homeTeam) ?? null
        : game.playoff.league === 'Prestige'
          ? this.getSeedMap('Prestige').get(game.homeTeam) ?? null
          : this.getSeedMap('Platinum').get(game.homeTeam) ?? this.getSeedMap('Prestige').get(game.homeTeam) ?? null;
    const awaySeed =
      game.playoff.league === 'Platinum'
        ? this.getSeedMap('Platinum').get(game.awayTeam) ?? null
        : game.playoff.league === 'Prestige'
          ? this.getSeedMap('Prestige').get(game.awayTeam) ?? null
          : this.getSeedMap('Platinum').get(game.awayTeam) ?? this.getSeedMap('Prestige').get(game.awayTeam) ?? null;

    if (!homeSeed || !awaySeed) {
      return null;
    }

    const top = compareSeededTeams(homeSeed, awaySeed) <= 0 ? homeSeed : awaySeed;
    const bottom = top.team.id === homeSeed.team.id ? awaySeed : homeSeed;
    game.stats = {
      ...game.stats,
      topSeedTeamId: top.team.id,
      bottomSeedTeamId: bottom.team.id,
      topSeed: top.seed,
      bottomSeed: bottom.seed,
    };
    return {
      topSeedTeamId: top.team.id,
      bottomSeedTeamId: bottom.team.id,
      topSeed: top.seed,
      bottomSeed: bottom.seed,
    };
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
    this.refreshGameIndexes();
    this.clearSeedCaches();
  }

  private getLeagueSeeds(league: Team['league']): SeededPlayoffTeam[] {
    const cached = this.leagueSeedCache.get(league);
    if (cached) {
      return cached;
    }

    const teams = this.teamOrder
      .map((id) => this.teamsById.get(id))
      .filter((team): team is Team => Boolean(team));

    const seeds = getLeaguePlayoffSeeds(teams, this.games, league);
    this.leagueSeedCache.set(league, seeds);
    return seeds;
  }

  private getSeedMap(league: Team['league']): Map<string, SeededPlayoffTeam> {
    const cached = this.seedMapCache.get(league);
    if (cached) {
      return cached;
    }

    const seedMap = new Map(this.getLeagueSeeds(league).map((seed) => [seed.team.id, seed]));
    this.seedMapCache.set(league, seedMap);
    return seedMap;
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
      gameId: `p-${String(this.nextGameNumber++).padStart(5, '0')}`,
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
    this.refreshGameIndexes();
    this.clearSeedCaches();
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
        {
          team: topSeedTeam,
          seed: metadata.topSeed,
          clinchType: 'wildcard',
          wins: topSeedTeam.wins,
          losses: topSeedTeam.losses,
          runDiff: topSeedTeam.runsScored - topSeedTeam.runsAllowed,
          homeWins: 0,
          homeLosses: 0,
          homePct: 0,
        },
        {
          team: bottomSeedTeam,
          seed: metadata.bottomSeed,
          clinchType: 'wildcard',
          wins: bottomSeedTeam.wins,
          losses: bottomSeedTeam.losses,
          runDiff: bottomSeedTeam.runsScored - bottomSeedTeam.runsAllowed,
          homeWins: 0,
          homeLosses: 0,
          homePct: 0,
        },
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

    const participants = buildGameParticipants(
      game,
      this.games,
      this.playerState,
      {
        ...this.participantBuildContext,
        battingStatsByPlayerId: this.playerStatAccumulator.preferredBattingByPhase[game.phase],
        pitchingStatsByPlayerId: this.playerStatAccumulator.preferredPitchingByPhase[game.phase],
        // Only games finished before this one are in the map, because the run
        // folds each result in as it goes.
        lastPitchedDateByPlayerId: this.pitcherRestByPlayerId,
      },
    );
    const session = simulateGameToFinal(createGameSession(game, participants), awayTeam, homeTeam, this.settings);
    const completed = buildCompletedGameFromSession(game, session);
    const completedGame = completed.game;

    game.status = completedGame.status;
    game.score = { ...completedGame.score };
    game.stats = { ...game.stats, ...completedGame.stats };

    /*
     * FOLD THIS GAME INTO THE REST LEDGER.
     *
     * Read back off the completed game rather than off the session, so the
     * ledger is driven by exactly the record that survives a save/load. A later
     * date wins, because a game being completed out of order (a simulated day
     * catching up on a postponed fixture) must not erase a newer appearance.
     */
    for (const playerId of readPitchersUsed(game)) {
      const existing = this.pitcherRestByPlayerId.get(playerId);
      if (existing === undefined || game.date > existing) {
        this.pitcherRestByPlayerId.set(playerId, game.date);
      }
    }

    applyPlayerGameStatDeltaToAccumulator(
      this.playerStatAccumulator,
      completed.playerStatDelta,
      Number(game.date.slice(0, 4)),
      game.phase,
    );

    if (isRegularSeasonGame(game)) {
      homeTeam.runsScored += completedGame.score.home;
      homeTeam.runsAllowed += completedGame.score.away;
      awayTeam.runsScored += completedGame.score.away;
      awayTeam.runsAllowed += completedGame.score.home;

      if (completedGame.score.home > completedGame.score.away) {
        homeTeam.wins += 1;
        awayTeam.losses += 1;
      } else {
        awayTeam.wins += 1;
        homeTeam.losses += 1;
      }
      this.clearSeedCaches();
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

    if (target.scope === 'next_playoff_game') {
      return this.getNextScheduledGame((game) => isPlayoffGame(game) && game.date >= normalizedCurrent);
    }

    if (target.scope === 'to_game') {
      const targetGameId = target.targetGameId ?? '';
      if (!targetGameId) {
        return undefined;
      }

      const targetGame = this.games.find((game) => game.gameId === targetGameId && game.status === 'scheduled');
      if (!targetGame) {
        return undefined;
      }

      return this.getNextScheduledGame((game) => {
        if (game.date < normalizedCurrent) {
          return false;
        }
        if (game.date > targetGame.date) {
          return false;
        }
        if (game.date === targetGame.date && game.gameId.localeCompare(targetGame.gameId) > 0) {
          return false;
        }
        return true;
      });
    }

    if (!targetEndDate) {
      return undefined;
    }

    return this.getNextScheduledGame((game) => game.date >= normalizedCurrent && game.date <= targetEndDate);
  }

  private getTargetLabel(target: SimulationTarget): string {
    if (target.scope === 'day') {
      return 'Simulating day';
    }
    if (target.scope === 'week') {
      return 'Simulating week';
    }
    if (target.scope === 'month') {
      return 'Simulating month';
    }
    if (target.scope === 'regular_season') {
      return 'Simulating regular season';
    }
    if (target.scope === 'season') {
      return 'Simulating full season';
    }
    if (target.scope === 'next_game') {
      return 'Simulating next team game';
    }
    if (target.scope === 'next_playoff_game') {
      return 'Simulating next playoff game';
    }
    if (target.scope === 'to_game') {
      return 'Simulating to selected game';
    }

    return 'Simulating selected range';
  }

  private getRemainingCandidateCount(normalizedCurrent: string, target: SimulationTarget, targetEndDate: string | null): number {
    if (target.scope === 'season') {
      return this.getScheduledGameCount();
    }

    if (target.scope === 'regular_season') {
      return this.getScheduledGameCount((game) => isRegularSeasonGame(game) && game.date >= normalizedCurrent);
    }

    if (target.scope === 'next_game') {
      const teamId = target.teamId ?? '';
      return this.getScheduledGameCount(
        (game) => game.date >= normalizedCurrent && (game.homeTeam === teamId || game.awayTeam === teamId),
      );
    }

    if (target.scope === 'next_playoff_game') {
      const nextPlayoffGame = this.getNextScheduledGame((game) => isPlayoffGame(game) && game.date >= normalizedCurrent);
      return nextPlayoffGame ? 1 : 0;
    }

    if (target.scope === 'to_game') {
      const targetGameId = target.targetGameId ?? '';
      if (!targetGameId) {
        return 0;
      }

      const targetGame = this.games.find((game) => game.gameId === targetGameId && game.status === 'scheduled');
      if (!targetGame) {
        return 0;
      }

      return this.getScheduledGameCount((game) => {
        if (game.date < normalizedCurrent) {
          return false;
        }
        if (game.date > targetGame.date) {
          return false;
        }
        if (game.date === targetGame.date && game.gameId.localeCompare(targetGame.gameId) > 0) {
          return false;
        }
        return true;
      });
    }

    if (!targetEndDate) {
      return 0;
    }

    return this.getScheduledGameCount((game) => game.date >= normalizedCurrent && game.date <= targetEndDate);
  }

  public async run(
    target: SimulationTarget,
    onProgress?: (update: SimulationProgressUpdate) => void,
  ): Promise<SimulationManagerResult> {
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
    const label = this.getTargetLabel(target);

    let simulatedGameCount = 0;
    let lastSimulatedDate = normalizedCurrent;

    this.ensurePlayoffSchedule();
    onProgress?.({
      label,
      completedGames: 0,
      totalGames: this.getRemainingCandidateCount(normalizedCurrent, target, targetEndDate),
      currentDate: normalizedCurrent,
    });

    while (true) {
      this.ensurePlayoffSchedule();
      const candidate = this.getCandidateGame(normalizedCurrent, target, targetEndDate);
      if (!candidate) {
        break;
      }

      this.applyGameResult(candidate);
      simulatedGameCount += 1;
      lastSimulatedDate = candidate.date;

      onProgress?.({
        label,
        completedGames: simulatedGameCount,
        totalGames: simulatedGameCount + this.getRemainingCandidateCount(normalizedCurrent, target, targetEndDate),
        currentDate: candidate.date,
      });

      if (simulatedGameCount % 6 === 0) {
        await new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, 0);
        });
      }

      if (target.scope === 'next_game') {
        break;
      }
      if (target.scope === 'next_playoff_game') {
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
    const materializedPlayerStats = materializePlayerStatAccumulator(this.playerStatAccumulator);
    this.playerState = {
      ...this.playerState,
      ...materializedPlayerStats,
    };

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
      playerState: {
        players: this.playerState.players.map((player) => ({ ...player })),
        battingStats: this.playerState.battingStats.map((stat) => ({ ...stat })),
        pitchingStats: this.playerState.pitchingStats.map((stat) => ({ ...stat })),
        battingRatings: this.playerState.battingRatings.map((rating) => ({ ...rating })),
        pitchingRatings: this.playerState.pitchingRatings.map((rating) => ({ ...rating })),
        rosterSlots: this.playerState.rosterSlots.map((slot) => ({ ...slot })),
        transactions: this.playerState.transactions.map((transaction) => ({ ...transaction })),
      },
      currentDate: this.currentDate,
      simulatedGameCount,
      progress,
    };
  }
}
