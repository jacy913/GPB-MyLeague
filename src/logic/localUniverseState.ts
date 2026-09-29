import type {
  Game,
  LeaguePlayerState,
  PendingTradeProposal,
  SeasonHistoryEntry,
  SimulationSettings,
  Team,
} from '../types';
import type { DraftClassState, DraftHistoryEntry } from './draftLogic';
import { auditRosterInvariants } from './rosterManagement';

export const LOCAL_UNIVERSE_FORMAT = 'gpb_local_universe_state';
export const LOCAL_UNIVERSE_VERSION = 1;

export type LocalOffseasonStage =
  | 'idle'
  | 'awards'
  | 'retirements'
  | 'draft_lottery'
  | 'draft'
  | 'free_agency'
  | 'start_next_season';

export interface LocalOffseasonWorkflow {
  seasonYear: number | null;
  stage: LocalOffseasonStage;
}

export interface LocalDraftCenterState {
  activeClass: DraftClassState | null;
  history: DraftHistoryEntry[];
}

export interface LocalUniverseBundle {
  format: typeof LOCAL_UNIVERSE_FORMAT;
  version: typeof LOCAL_UNIVERSE_VERSION;
  exportedAt: string;
  league: {
    teams: Team[];
    settings: SimulationSettings;
    games: Game[];
    currentDate: string;
    progress: number;
    seasonComplete: boolean;
  };
  players: LeaguePlayerState;
  seasonHistory: SeasonHistoryEntry[];
  offseasonWorkflow: LocalOffseasonWorkflow;
  draftCenter: LocalDraftCenterState;
  pendingTrades: PendingTradeProposal[];
}

export interface LocalUniverseValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const pushError = (errors: string[], condition: boolean, message: string): void => {
  if (!condition) errors.push(message);
};

const validateSettings = (settings: unknown, errors: string[]): settings is SimulationSettings => {
  if (!isRecord(settings)) {
    errors.push('League settings must be an object.');
    return false;
  }

  const fields: Array<keyof SimulationSettings> = [
    'continuityWeight',
    'winLossVariance',
    'homeFieldAdvantage',
    'gameLuckFactor',
    'leagueEnvironmentBalance',
    'battingVarianceFactor',
  ];
  fields.forEach((field) => pushError(errors, isFiniteNumber(settings[field]), `Setting ${field} must be a finite number.`));
  return errors.length === 0;
};

const validateTeams = (teams: unknown, errors: string[]): teams is Team[] => {
  if (!Array.isArray(teams) || teams.length !== 32) {
    errors.push('The universe must contain exactly 32 teams.');
    return false;
  }

  const teamIds = teams.map((team) => (isRecord(team) && typeof team.id === 'string' ? team.id : ''));
  if (teamIds.some((teamId) => teamId.length === 0)) errors.push('Every team must have a non-empty ID.');
  if (new Set(teamIds).size !== teamIds.length) errors.push('Team IDs must be unique.');
  return errors.length === 0;
};

const validateGames = (games: unknown, teamIds: Set<string>, errors: string[]): games is Game[] => {
  if (!Array.isArray(games)) {
    errors.push('League games must be an array.');
    return false;
  }

  const gameIds = new Set<string>();
  games.forEach((game, index) => {
    if (!isRecord(game)) {
      errors.push(`Game ${index} must be an object.`);
      return;
    }
    const gameId = typeof game.gameId === 'string' ? game.gameId : '';
    if (!gameId) errors.push(`Game ${index} is missing gameId.`);
    if (gameIds.has(gameId)) errors.push(`Duplicate game ID: ${gameId}.`);
    gameIds.add(gameId);
    if (typeof game.homeTeam !== 'string' || !teamIds.has(game.homeTeam)) errors.push(`Game ${gameId} references an invalid home team.`);
    if (typeof game.awayTeam !== 'string' || !teamIds.has(game.awayTeam)) errors.push(`Game ${gameId} references an invalid away team.`);
    if (game.homeTeam === game.awayTeam) errors.push(`Game ${gameId} has the same home and away team.`);
    if (game.status !== 'scheduled' && game.status !== 'completed') errors.push(`Game ${gameId} has an invalid status.`);
    if (game.phase !== 'regular_season' && game.phase !== 'playoffs') errors.push(`Game ${gameId} has an invalid phase.`);
    if (!isRecord(game.score) || !isFiniteNumber(game.score.home) || !isFiniteNumber(game.score.away)) errors.push(`Game ${gameId} has an invalid score.`);
  });
  return errors.length === 0;
};

const validatePlayers = (players: unknown, errors: string[]): players is LeaguePlayerState => {
  if (!isRecord(players)) {
    errors.push('Player state must be an object.');
    return false;
  }

  const fields: Array<keyof LeaguePlayerState> = [
    'players',
    'battingStats',
    'pitchingStats',
    'battingRatings',
    'pitchingRatings',
    'rosterSlots',
    'transactions',
  ];
  fields.forEach((field) => pushError(errors, Array.isArray(players[field]), `Player state field ${field} must be an array.`));
  if (!Array.isArray(players.players)) return false;

  const playerIds = players.players.map((player) => (isRecord(player) && typeof player.playerId === 'string' ? player.playerId : ''));
  if (playerIds.some((playerId) => playerId.length === 0)) errors.push('Every player must have a non-empty playerId.');
  if (new Set(playerIds).size !== playerIds.length) errors.push('Player IDs must be unique.');
  return errors.length === 0;
};

export const validateLocalUniverseBundle = (value: unknown): LocalUniverseValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ['Universe bundle must be an object.'], warnings };
  }
  if (value.format !== LOCAL_UNIVERSE_FORMAT) errors.push('Unsupported local universe format.');
  if (value.version !== LOCAL_UNIVERSE_VERSION) errors.push('Unsupported local universe version.');
  if (typeof value.exportedAt !== 'string' || value.exportedAt.length === 0) errors.push('Universe bundle is missing exportedAt.');

  const playersValid = validatePlayers(value.players, errors);

  const league = isRecord(value.league) ? value.league : null;
  if (!league) {
    errors.push('Universe bundle is missing league state.');
  } else {
    const teamsValid = validateTeams(league.teams, errors);
    validateSettings(league.settings, errors);
    const teamIds = new Set(
      Array.isArray(league.teams)
        ? league.teams.flatMap((team) => (isRecord(team) && typeof team.id === 'string' ? [team.id] : []))
        : [],
    );
    validateGames(league.games, teamIds, errors);
    if (typeof league.currentDate !== 'string' || league.currentDate.length === 0) errors.push('Current date must be a non-empty string.');
    if (!isFiniteNumber(league.progress) || league.progress < 0 || league.progress > 100) errors.push('League progress must be between 0 and 100.');
    if (typeof league.seasonComplete !== 'boolean') errors.push('Season completion must be boolean.');
    if (teamsValid && playersValid) {
      const playerState = value.players as LeaguePlayerState;
      const rosterAudit = auditRosterInvariants(playerState, league.teams as Team[]);
      if (!rosterAudit.isValid) errors.push(`Roster invariant failed with ${rosterAudit.totalViolations} violation${rosterAudit.totalViolations === 1 ? '' : 's'}.`);
    }
  }

  if (!playersValid) {
    warnings.push('Roster relationship checks were skipped because player state is malformed.');
  }
  if (!Array.isArray(value.seasonHistory)) errors.push('Season history must be an array.');
  if (!Array.isArray(value.pendingTrades)) errors.push('Pending trades must be an array.');
  if (!isRecord(value.offseasonWorkflow)) errors.push('Offseason workflow must be an object.');
  if (!isRecord(value.draftCenter)) errors.push('Draft center state must be an object.');

  return { valid: errors.length === 0, errors, warnings };
};

export const createLocalUniverseBundle = (input: Omit<LocalUniverseBundle, 'format' | 'version' | 'exportedAt'>): LocalUniverseBundle => ({
  format: LOCAL_UNIVERSE_FORMAT,
  version: LOCAL_UNIVERSE_VERSION,
  exportedAt: new Date().toISOString(),
  ...input,
});
