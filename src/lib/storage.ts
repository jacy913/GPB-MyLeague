import {
  Game,
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerTransaction,
  SimulationSettings,
  Team,
  TeamRosterSlot,
} from '../types';
import { getFallbackPlayerBio } from '../logic/playerBio';
import { supabase } from './supabaseClient';

const STORAGE_KEYS = {
  teams: 'glb_teams',
  settings: 'glb_settings',
  games: 'glb_games',
  players: 'glb_players',
  battingStats: 'glb_batting_stats',
  pitchingStats: 'glb_pitching_stats',
  battingRatings: 'glb_batting_ratings',
  pitchingRatings: 'glb_pitching_ratings',
  rosterSlots: 'glb_roster_slots',
  playerTransactions: 'glb_player_transactions',
  currentDate: 'glb_current_date',
  progress: 'glb_progress',
  seasonComplete: 'glb_season_complete',
};
const LOCAL_LEAGUE_STATE_KEYS = [
  STORAGE_KEYS.teams,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.games,
  STORAGE_KEYS.currentDate,
  STORAGE_KEYS.progress,
  STORAGE_KEYS.seasonComplete,
] as const;
const LOCAL_PLAYER_STATE_KEYS = [
  STORAGE_KEYS.players,
  STORAGE_KEYS.battingStats,
  STORAGE_KEYS.pitchingStats,
  STORAGE_KEYS.battingRatings,
  STORAGE_KEYS.pitchingRatings,
  STORAGE_KEYS.rosterSlots,
  STORAGE_KEYS.playerTransactions,
] as const;
const LOCAL_INDEXED_DB_NAME = 'gpb_local_state_v1';
const LOCAL_INDEXED_DB_VERSION = 1;
const LOCAL_INDEXED_DB_STORE = 'kv';
let localStateDbPromise: Promise<IDBDatabase> | null = null;
const LOCAL_SAFETY_SNAPSHOT_PREFIX = 'gpb_local_safety_snapshot_v1_';
const LOCAL_SAFETY_SNAPSHOT_INDEX_KEY = 'gpb_local_safety_snapshot_index_v1';
const LOCAL_SAFETY_SNAPSHOT_LIMIT = 5;
const LOCAL_SAFETY_SNAPSHOT_MIN_INTERVAL_MS = 60 * 1000;
const LOCAL_EXPORT_FORMAT = 'gpb_local_state_export';
const LOCAL_EXPORT_VERSION = 1;
const LOCAL_DRAFT_CENTER_KEY = 'gpb_draft_center_v1';
let localSafetySnapshotLastAt = 0;
let localSafetySnapshotTimer: ReturnType<typeof setTimeout> | null = null;

const LEAGUE_SLUG = 'grand-league';
const LEAGUE_NAME = 'Grand League Baseball';
const LEAGUE_ID_CACHE_KEY = 'gpb_supabase_league_id_v1';
const SUPABASE_BACKOFF_UNTIL_KEY = 'gpb_supabase_backoff_until_v1';
const SUPABASE_BACKOFF_MS = 2 * 60 * 1000;
const DB_RATING_MIN = 60;
const DB_RATING_MAX = 100;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const sanitizeDbRating = (value: number): number =>
  clamp(Number.isFinite(value) ? Math.round(value) : DB_RATING_MIN, DB_RATING_MIN, DB_RATING_MAX);
let cachedLeagueId: string | null = null;
let ensureLeaguePromise: Promise<string> | null = null;
let supabaseBackoffUntil = 0;

export interface LocalStateExportBundle {
  format: typeof LOCAL_EXPORT_FORMAT;
  version: typeof LOCAL_EXPORT_VERSION;
  exportedAt: string;
  leagueState: {
    teams: Team[] | null;
    settings: SimulationSettings | null;
    games: Game[] | null;
    currentDate: string | null;
    progress: number | null;
    seasonComplete: boolean | null;
  };
  playerState: LeaguePlayerState;
  extras?: {
    draftCenterRaw: string | null;
  };
}

interface TeamRow {
  team_id: string;
  city: string;
  name: string;
  league: Team['league'];
  division: Team['division'];
  rating: number;
  previous_baseline_wins: number;
  wins: number;
  losses: number;
  runs_scored: number;
  runs_allowed: number;
}

interface SettingsRow {
  continuity_weight: number;
  win_loss_variance: number;
  home_field_advantage: number;
  game_luck_factor: number;
  league_environment_balance: number;
  batting_variance_factor: number;
}

export interface SliderPresetRecord {
  id: number;
  presetName: string;
  settings: SimulationSettings;
  updatedAt: string;
}

interface SliderPresetRow {
  id: number;
  preset_name: string;
  continuity_weight: number;
  win_loss_variance: number;
  home_field_advantage: number;
  game_luck_factor: number;
  league_environment_balance: number;
  batting_variance_factor: number;
  updated_at: string;
}

interface GameRow {
  game_id: string;
  game_date: string;
  home_team_id: string;
  away_team_id: string;
  phase: Game['phase'];
  status: Game['status'];
  home_score: number;
  away_score: number;
  playoff: Game['playoff'] | null;
  stats: Game['stats'];
}

interface LeagueStateRow {
  current_sim_date: string | null;
  progress: number;
  season_complete: boolean;
}

interface PlayerRow {
  player_id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  player_type: Player['playerType'];
  primary_position: Player['primaryPosition'];
  secondary_position: Player['secondaryPosition'];
  bats: Player['bats'];
  throws: Player['throws'];
  age: number;
  height?: string;
  weight_lbs?: number;
  potential: number;
  status: Player['status'];
  contract_years_left?: number;
  draft_class_year: number | null;
  draft_round: number | null;
  years_pro: number;
  retirement_year: number | null;
}

interface PlayerSeasonBattingRow {
  player_id: string;
  season_year: number;
  season_phase: PlayerSeasonBatting['seasonPhase'];
  games_played: number;
  plate_appearances: number;
  at_bats: number;
  runs_scored: number;
  hits: number;
  doubles: number;
  triples: number;
  home_runs: number;
  walks: number;
  strikeouts: number;
  rbi: number;
  avg: number;
  ops: number;
}

interface PlayerSeasonPitchingRow {
  player_id: string;
  season_year: number;
  season_phase: PlayerSeasonPitching['seasonPhase'];
  wins: number;
  losses: number;
  saves: number;
  games: number;
  games_started: number;
  innings_pitched: number;
  hits_allowed: number;
  earned_runs: number;
  walks: number;
  strikeouts: number;
  era: number;
  whip: number;
}

interface PlayerBattingRatingsRow {
  player_id: string;
  season_year: number;
  contact: number;
  power: number;
  plate_discipline: number;
  avoid_strikeout: number;
  speed: number;
  baserunning: number;
  fielding: number;
  arm: number;
  overall: number;
  potential_overall: number;
}

interface PlayerPitchingRatingsRow {
  player_id: string;
  season_year: number;
  stuff: number;
  command: number;
  control: number;
  movement: number;
  stamina: number;
  hold_runners: number;
  fielding: number;
  overall: number;
  potential_overall: number;
}

interface TeamRosterSlotRow {
  season_year: number;
  team_id: string;
  slot_code: TeamRosterSlot['slotCode'];
  player_id: string;
}

interface PlayerTransactionRow {
  player_id: string;
  event_type: PlayerTransaction['eventType'];
  from_team_id: string | null;
  to_team_id: string | null;
  effective_date: string;
  notes: string | null;
}

const toTeam = (row: TeamRow): Team => ({
  id: row.team_id,
  city: row.city,
  name: row.name,
  league: row.league,
  division: row.division,
  rating: row.rating,
  previousBaselineWins: row.previous_baseline_wins,
  wins: row.wins,
  losses: row.losses,
  runsScored: row.runs_scored,
  runsAllowed: row.runs_allowed,
});

const toTeamRow = (team: Team, leagueId: string): TeamRow & { league_id: string } => ({
  league_id: leagueId,
  team_id: team.id,
  city: team.city,
  name: team.name,
  league: team.league,
  division: team.division,
  rating: team.rating,
  previous_baseline_wins: team.previousBaselineWins,
  wins: team.wins,
  losses: team.losses,
  runs_scored: team.runsScored,
  runs_allowed: team.runsAllowed,
});

const toSettings = (row: SettingsRow): SimulationSettings => ({
  continuityWeight: row.continuity_weight,
  winLossVariance: row.win_loss_variance,
  homeFieldAdvantage: row.home_field_advantage,
  gameLuckFactor: row.game_luck_factor,
  leagueEnvironmentBalance: row.league_environment_balance,
  battingVarianceFactor: row.batting_variance_factor,
});

const toSettingsRow = (settings: SimulationSettings, leagueId: string): SettingsRow & { league_id: string } => ({
  league_id: leagueId,
  continuity_weight: settings.continuityWeight,
  win_loss_variance: settings.winLossVariance,
  home_field_advantage: settings.homeFieldAdvantage,
  game_luck_factor: settings.gameLuckFactor,
  league_environment_balance: settings.leagueEnvironmentBalance,
  batting_variance_factor: settings.battingVarianceFactor,
});

const toSliderPresetRecord = (row: SliderPresetRow): SliderPresetRecord => ({
  id: row.id,
  presetName: row.preset_name,
  settings: toSettings(row),
  updatedAt: row.updated_at,
});

const toSliderPresetRow = (presetName: string, settings: SimulationSettings, leagueId: string) => ({
  league_id: leagueId,
  preset_name: presetName,
  continuity_weight: settings.continuityWeight,
  win_loss_variance: settings.winLossVariance,
  home_field_advantage: settings.homeFieldAdvantage,
  game_luck_factor: settings.gameLuckFactor,
  league_environment_balance: settings.leagueEnvironmentBalance,
  batting_variance_factor: settings.battingVarianceFactor,
});

const toGame = (row: GameRow): Game => ({
  gameId: row.game_id,
  date: row.game_date,
  homeTeam: row.home_team_id,
  awayTeam: row.away_team_id,
  phase: row.phase,
  status: row.status,
  score: {
    home: row.home_score,
    away: row.away_score,
  },
  playoff: row.playoff ?? null,
  stats: row.stats ?? {},
});

const toGameRow = (game: Game, leagueId: string): GameRow & { league_id: string } => ({
  league_id: leagueId,
  game_id: game.gameId,
  game_date: game.date,
  home_team_id: game.homeTeam,
  away_team_id: game.awayTeam,
  phase: game.phase,
  status: game.status,
  home_score: game.score.home,
  away_score: game.score.away,
  playoff: game.playoff ?? null,
  stats: game.stats ?? {},
});

const toLeagueStateRow = (
  leagueId: string,
  currentDate: string,
  progress: number,
  seasonComplete: boolean,
): LeagueStateRow & { league_id: string } => ({
  league_id: leagueId,
  current_sim_date: currentDate || null,
  progress,
  season_complete: seasonComplete,
});

const toPlayer = (row: PlayerRow): Player => ({
  ...getFallbackPlayerBio(row.primary_position, row.status, row.age),
  playerId: row.player_id,
  teamId: row.team_id,
  firstName: row.first_name,
  lastName: row.last_name,
  playerType: row.player_type,
  primaryPosition: row.primary_position,
  secondaryPosition: row.secondary_position,
  bats: row.bats,
  throws: row.throws,
  age: row.age,
  height: row.height ?? getFallbackPlayerBio(row.primary_position, row.status, row.age).height,
  weightLbs: row.weight_lbs ?? getFallbackPlayerBio(row.primary_position, row.status, row.age).weightLbs,
  potential: row.potential,
  status: row.status,
  contractYearsLeft: row.contract_years_left ?? getFallbackPlayerBio(row.primary_position, row.status, row.age).contractYearsLeft,
  draftClassYear: row.draft_class_year,
  draftRound: row.draft_round,
  yearsPro: row.years_pro,
  retirementYear: row.retirement_year,
});

const toPlayerRow = (player: Player, leagueId: string): PlayerRow & { league_id: string } => ({
  league_id: leagueId,
  player_id: player.playerId,
  team_id: player.teamId,
  first_name: player.firstName,
  last_name: player.lastName,
  player_type: player.playerType,
  primary_position: player.primaryPosition,
  secondary_position: player.secondaryPosition === player.primaryPosition ? null : player.secondaryPosition,
  bats: player.bats,
  throws: player.throws,
  age: clamp(Math.round(player.age), 15, 60),
  height: player.height,
  weight_lbs: clamp(Math.round(player.weightLbs), 120, 400),
  potential: clamp(player.potential, 0, 1),
  status: player.status,
  contract_years_left: clamp(Math.round(player.contractYearsLeft), 0, 5),
  draft_class_year: player.draftClassYear,
  draft_round: player.draftRound === null ? null : Math.max(1, Math.round(player.draftRound)),
  years_pro: Math.max(0, Math.round(player.yearsPro)),
  retirement_year: player.status === 'retired'
    ? player.retirementYear ?? new Date().getUTCFullYear()
    : null,
});

const toBattingStat = (row: PlayerSeasonBattingRow): PlayerSeasonBatting => ({
  playerId: row.player_id,
  seasonYear: row.season_year,
  seasonPhase: row.season_phase,
  gamesPlayed: row.games_played,
  plateAppearances: row.plate_appearances,
  atBats: row.at_bats,
  runsScored: row.runs_scored,
  hits: row.hits,
  doubles: row.doubles,
  triples: row.triples,
  homeRuns: row.home_runs,
  walks: row.walks,
  strikeouts: row.strikeouts,
  rbi: row.rbi,
  avg: row.avg,
  ops: row.ops,
});

const toBattingStatRow = (stat: PlayerSeasonBatting): PlayerSeasonBattingRow => ({
  player_id: stat.playerId,
  season_year: stat.seasonYear,
  season_phase: stat.seasonPhase,
  games_played: stat.gamesPlayed,
  plate_appearances: stat.plateAppearances,
  at_bats: stat.atBats,
  runs_scored: stat.runsScored,
  hits: stat.hits,
  doubles: stat.doubles,
  triples: stat.triples,
  home_runs: stat.homeRuns,
  walks: stat.walks,
  strikeouts: stat.strikeouts,
  rbi: stat.rbi,
  avg: stat.avg,
  ops: stat.ops,
});

const toPitchingStat = (row: PlayerSeasonPitchingRow): PlayerSeasonPitching => ({
  playerId: row.player_id,
  seasonYear: row.season_year,
  seasonPhase: row.season_phase,
  wins: row.wins,
  losses: row.losses,
  saves: row.saves,
  games: row.games,
  gamesStarted: row.games_started,
  inningsPitched: row.innings_pitched,
  hitsAllowed: row.hits_allowed,
  earnedRuns: row.earned_runs,
  walks: row.walks,
  strikeouts: row.strikeouts,
  era: row.era,
  whip: row.whip,
});

const toPitchingStatRow = (stat: PlayerSeasonPitching): PlayerSeasonPitchingRow => ({
  player_id: stat.playerId,
  season_year: stat.seasonYear,
  season_phase: stat.seasonPhase,
  wins: stat.wins,
  losses: stat.losses,
  saves: stat.saves,
  games: stat.games,
  games_started: stat.gamesStarted,
  innings_pitched: stat.inningsPitched,
  hits_allowed: stat.hitsAllowed,
  earned_runs: stat.earnedRuns,
  walks: stat.walks,
  strikeouts: stat.strikeouts,
  era: stat.era,
  whip: stat.whip,
});

const toBattingRatings = (row: PlayerBattingRatingsRow): PlayerBattingRatings => ({
  playerId: row.player_id,
  seasonYear: row.season_year,
  contact: row.contact,
  power: row.power,
  plateDiscipline: row.plate_discipline,
  avoidStrikeout: row.avoid_strikeout,
  speed: row.speed,
  baserunning: row.baserunning,
  fielding: row.fielding,
  arm: row.arm,
  overall: row.overall,
  potentialOverall: row.potential_overall,
});

const toBattingRatingsRow = (ratings: PlayerBattingRatings): PlayerBattingRatingsRow => ({
  player_id: ratings.playerId,
  season_year: ratings.seasonYear,
  contact: sanitizeDbRating(ratings.contact),
  power: sanitizeDbRating(ratings.power),
  plate_discipline: sanitizeDbRating(ratings.plateDiscipline),
  avoid_strikeout: sanitizeDbRating(ratings.avoidStrikeout),
  speed: sanitizeDbRating(ratings.speed),
  baserunning: sanitizeDbRating(ratings.baserunning),
  fielding: sanitizeDbRating(ratings.fielding),
  arm: sanitizeDbRating(ratings.arm),
  overall: sanitizeDbRating(ratings.overall),
  potential_overall: sanitizeDbRating(Math.max(ratings.potentialOverall, ratings.overall)),
});

const toPitchingRatings = (row: PlayerPitchingRatingsRow): PlayerPitchingRatings => ({
  playerId: row.player_id,
  seasonYear: row.season_year,
  stuff: row.stuff,
  command: row.command,
  control: row.control,
  movement: row.movement,
  stamina: row.stamina,
  holdRunners: row.hold_runners,
  fielding: row.fielding,
  overall: row.overall,
  potentialOverall: row.potential_overall,
});

const toPitchingRatingsRow = (ratings: PlayerPitchingRatings): PlayerPitchingRatingsRow => ({
  player_id: ratings.playerId,
  season_year: ratings.seasonYear,
  stuff: sanitizeDbRating(ratings.stuff),
  command: sanitizeDbRating(ratings.command),
  control: sanitizeDbRating(ratings.control),
  movement: sanitizeDbRating(ratings.movement),
  stamina: sanitizeDbRating(ratings.stamina),
  hold_runners: sanitizeDbRating(ratings.holdRunners),
  fielding: sanitizeDbRating(ratings.fielding),
  overall: sanitizeDbRating(ratings.overall),
  potential_overall: sanitizeDbRating(Math.max(ratings.potentialOverall, ratings.overall)),
});

const toRosterSlot = (row: TeamRosterSlotRow): TeamRosterSlot => ({
  seasonYear: row.season_year,
  teamId: row.team_id,
  slotCode: row.slot_code,
  playerId: row.player_id,
});

const toRosterSlotRow = (slot: TeamRosterSlot, leagueId: string): TeamRosterSlotRow & { league_id: string } => ({
  league_id: leagueId,
  season_year: slot.seasonYear,
  team_id: slot.teamId,
  slot_code: slot.slotCode,
  player_id: slot.playerId,
});

const toPlayerTransaction = (row: PlayerTransactionRow): PlayerTransaction => ({
  playerId: row.player_id,
  eventType: row.event_type,
  fromTeamId: row.from_team_id,
  toTeamId: row.to_team_id,
  effectiveDate: row.effective_date,
  notes: row.notes,
});

const toPlayerTransactionRow = (
  transaction: PlayerTransaction,
  leagueId: string,
): PlayerTransactionRow & { league_id: string } => ({
  league_id: leagueId,
  player_id: transaction.playerId,
  event_type: transaction.eventType,
  from_team_id: transaction.fromTeamId,
  to_team_id: transaction.toTeamId,
  effective_date: transaction.effectiveDate,
  notes: transaction.notes,
});

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const isRetryableSupabaseError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('statement timeout') ||
    message.includes('"code":"57014"') ||
    message.includes('canceling statement') ||
    message.includes('gateway timeout') ||
    message.includes('"code":"504"') ||
    message.includes('"code":"40001"') ||
    message.includes('deadlock')
  );
};

const runSupabaseMutationWithRetry = async (
  operation: () => PromiseLike<{ error: unknown }>,
  retries = 2,
): Promise<void> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { error } = await operation();
    if (!error) {
      return;
    }

    lastError = error;
    if (!isRetryableSupabaseError(error) || attempt >= retries) {
      break;
    }

    await sleep(180 * (attempt + 1));
  }

  throw lastError;
};

const upsertLeagueGameRowsWithRetry = async (
  rows: Array<GameRow & { league_id: string }>,
  retries = 2,
): Promise<void> => {
  if (!supabase || rows.length === 0) {
    return;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const { error } = await supabase
      .from('league_games')
      .upsert(rows, { onConflict: 'league_id,game_id' });

    if (!error) {
      return;
    }

    lastError = error;
    if (!isRetryableSupabaseError(error) || attempt >= retries) {
      break;
    }

    await sleep(200 * (attempt + 1));
  }

  if (rows.length > 1 && isRetryableSupabaseError(lastError)) {
    const splitIndex = Math.ceil(rows.length / 2);
    await upsertLeagueGameRowsWithRetry(rows.slice(0, splitIndex), retries);
    await upsertLeagueGameRowsWithRetry(rows.slice(splitIndex), retries);
    return;
  }

  throw lastError;
};

const dedupeByKey = <T,>(items: T[], getKey: (item: T) => string): T[] =>
  Array.from(new Map(items.map((item) => [getKey(item), item])).values());

const isSupabaseBackoffError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('522') ||
    message.includes('cloudflare') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('fetch failed') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('gateway timeout') ||
    message.includes('connection reset')
  );
};

const getSupabaseBackoffUntil = (): number => {
  if (supabaseBackoffUntil > 0) {
    return supabaseBackoffUntil;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(SUPABASE_BACKOFF_UNTIL_KEY);
      const parsed = raw ? Number(raw) : 0;
      if (Number.isFinite(parsed) && parsed > 0) {
        supabaseBackoffUntil = parsed;
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Unable to read Supabase backoff cache:', error);
  }

  return 0;
};

const setSupabaseBackoff = (durationMs = SUPABASE_BACKOFF_MS): void => {
  const until = Date.now() + Math.max(1, durationMs);
  supabaseBackoffUntil = until;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SUPABASE_BACKOFF_UNTIL_KEY, String(until));
    }
  } catch (error) {
    console.warn('Unable to persist Supabase backoff cache:', error);
  }
};

const clearSupabaseBackoff = (): void => {
  supabaseBackoffUntil = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SUPABASE_BACKOFF_UNTIL_KEY);
    }
  } catch (error) {
    console.warn('Unable to clear Supabase backoff cache:', error);
  }
};

const ensureLeague = async (): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  if (cachedLeagueId) {
    return cachedLeagueId;
  }

  const backoffUntil = getSupabaseBackoffUntil();
  if (backoffUntil > Date.now()) {
    throw new Error(`Supabase temporary backoff active until ${new Date(backoffUntil).toISOString()}`);
  }

  if (ensureLeaguePromise) {
    return ensureLeaguePromise;
  }

  ensureLeaguePromise = (async () => {
    try {
      if (typeof localStorage !== 'undefined') {
        const storedLeagueId = localStorage.getItem(LEAGUE_ID_CACHE_KEY);
        if (storedLeagueId) {
          cachedLeagueId = storedLeagueId;
          return storedLeagueId;
        }
      }
    } catch (error) {
      console.warn('Unable to read cached Supabase league id from localStorage:', error);
    }

    let existingLeague: { id?: string } | null = null;
    try {
      const { data, error: fetchError } = await supabase
        .from('leagues')
        .select('id')
        .eq('slug', LEAGUE_SLUG)
        .maybeSingle();
      if (fetchError) {
        throw fetchError;
      }
      existingLeague = data as { id?: string } | null;
    } catch (error) {
      if (isSupabaseBackoffError(error)) {
        setSupabaseBackoff();
      }
      throw error;
    }

    if (existingLeague?.id) {
      cachedLeagueId = existingLeague.id;
      clearSupabaseBackoff();
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(LEAGUE_ID_CACHE_KEY, existingLeague.id);
        }
      } catch (error) {
        console.warn('Unable to persist Supabase league id cache:', error);
      }
      return existingLeague.id;
    }

    let insertedLeague: { id: string };
    try {
      const { data, error: insertError } = await supabase
        .from('leagues')
        .insert({
          slug: LEAGUE_SLUG,
          name: LEAGUE_NAME,
        })
        .select('id')
        .single();

      if (insertError) {
        throw insertError;
      }
      insertedLeague = data as { id: string };
    } catch (error) {
      if (isSupabaseBackoffError(error)) {
        setSupabaseBackoff();
      }
      throw error;
    }

    cachedLeagueId = insertedLeague.id;
    clearSupabaseBackoff();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LEAGUE_ID_CACHE_KEY, insertedLeague.id);
      }
    } catch (error) {
      console.warn('Unable to persist Supabase league id cache:', error);
    }
    return insertedLeague.id;
  })();

  try {
    return await ensureLeaguePromise;
  } finally {
    ensureLeaguePromise = null;
  }
};

const supportsIndexedDb = (): boolean => typeof indexedDB !== 'undefined';

const openLocalStateDb = async (): Promise<IDBDatabase> => {
  if (!supportsIndexedDb()) {
    throw new Error('IndexedDB is not available in this runtime.');
  }

  if (localStateDbPromise) {
    return localStateDbPromise;
  }

  localStateDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LOCAL_INDEXED_DB_NAME, LOCAL_INDEXED_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_INDEXED_DB_STORE)) {
        db.createObjectStore(LOCAL_INDEXED_DB_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open local IndexedDB store.'));
  });

  try {
    return await localStateDbPromise;
  } catch (error) {
    localStateDbPromise = null;
    throw error;
  }
};

const readLocalStorageValues = (keys: readonly string[]): Record<string, string | null> =>
  Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));

const hasAnyStoredValue = (raw: Record<string, string | null>, keys: readonly string[]): boolean =>
  keys.some((key) => raw[key] !== null);

const readIndexedDbValues = async (keys: readonly string[]): Promise<Record<string, string | null>> => {
  const values: Record<string, string | null> = Object.fromEntries(keys.map((key) => [key, null]));
  if (!supportsIndexedDb()) {
    return values;
  }

  try {
    const db = await openLocalStateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_INDEXED_DB_STORE, 'readonly');
      const store = tx.objectStore(LOCAL_INDEXED_DB_STORE);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed reading local IndexedDB values.'));

      keys.forEach((key) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const row = request.result as { id: string; value: string } | undefined;
          values[key] = typeof row?.value === 'string' ? row.value : null;
        };
      });
    });
  } catch (error) {
    console.warn('Failed to read from local IndexedDB. Falling back to localStorage.', error);
  }

  return values;
};

const writeIndexedDbValues = async (entries: Array<[string, string]>): Promise<void> => {
  if (!supportsIndexedDb() || entries.length === 0) {
    return;
  }

  try {
    const db = await openLocalStateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_INDEXED_DB_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_INDEXED_DB_STORE);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed writing local IndexedDB values.'));

      entries.forEach(([id, value]) => {
        store.put({ id, value });
      });
    });
  } catch (error) {
    console.warn('Failed to write local IndexedDB values.', error);
  }
};

const removeIndexedDbValues = async (keys: readonly string[]): Promise<void> => {
  if (!supportsIndexedDb() || keys.length === 0) {
    return;
  }

  try {
    const db = await openLocalStateDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOCAL_INDEXED_DB_STORE, 'readwrite');
      const store = tx.objectStore(LOCAL_INDEXED_DB_STORE);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed removing local IndexedDB values.'));

      keys.forEach((key) => {
        store.delete(key);
      });
    });
  } catch (error) {
    console.warn('Failed to remove local IndexedDB values.', error);
  }
};

const parseLocalLeagueStateFromRaw = (raw: Record<string, string | null>): {
  teams: Team[] | null;
  settings: SimulationSettings | null;
  games: Game[] | null;
  currentDate: string | null;
  progress: number | null;
  seasonComplete: boolean | null;
} => {
  const parseJson = <T,>(value: string | null): T | null => {
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.error('Failed to parse local league-state JSON payload:', error);
      return null;
    }
  };

  const rawProgress = raw[STORAGE_KEYS.progress];
  const rawSeasonComplete = raw[STORAGE_KEYS.seasonComplete];

  return {
    teams: parseJson<Team[]>(raw[STORAGE_KEYS.teams]),
    settings: parseJson<SimulationSettings>(raw[STORAGE_KEYS.settings]),
    games: parseJson<Game[]>(raw[STORAGE_KEYS.games]),
    currentDate: raw[STORAGE_KEYS.currentDate],
    progress: rawProgress !== null ? Number(rawProgress) : null,
    seasonComplete: rawSeasonComplete === null ? null : rawSeasonComplete === 'true',
  };
};

const parseLocalPlayerStateFromRaw = (raw: Record<string, string | null>): LeaguePlayerState => {
  const parseJson = <T,>(value: string | null, fallback: T): T => {
    if (!value) {
      return fallback;
    }

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      console.error('Failed to parse local player-state JSON payload:', error);
      return fallback;
    }
  };

  const rawPlayers = parseJson<Player[]>(raw[STORAGE_KEYS.players], []);
  const normalizedPlayers = rawPlayers.map((player) => {
    const fallback = getFallbackPlayerBio(player.primaryPosition, player.status, player.age);
    return {
      ...player,
      height: player.height ?? fallback.height,
      weightLbs: typeof player.weightLbs === 'number' ? player.weightLbs : fallback.weightLbs,
      contractYearsLeft: typeof player.contractYearsLeft === 'number' ? player.contractYearsLeft : fallback.contractYearsLeft,
    };
  });

  return {
    players: normalizedPlayers,
    battingStats: parseJson<PlayerSeasonBatting[]>(raw[STORAGE_KEYS.battingStats], []),
    pitchingStats: parseJson<PlayerSeasonPitching[]>(raw[STORAGE_KEYS.pitchingStats], []),
    battingRatings: parseJson<PlayerBattingRatings[]>(raw[STORAGE_KEYS.battingRatings], []),
    pitchingRatings: parseJson<PlayerPitchingRatings[]>(raw[STORAGE_KEYS.pitchingRatings], []),
    rosterSlots: parseJson<TeamRosterSlot[]>(raw[STORAGE_KEYS.rosterSlots], []),
    transactions: parseJson<PlayerTransaction[]>(raw[STORAGE_KEYS.playerTransactions], []),
  };
};

export const loadLocalLeagueStateAsync = async (): Promise<{
  teams: Team[] | null;
  settings: SimulationSettings | null;
  games: Game[] | null;
  currentDate: string | null;
  progress: number | null;
  seasonComplete: boolean | null;
}> => {
  const indexedDbRaw = await readIndexedDbValues(LOCAL_LEAGUE_STATE_KEYS);
  if (hasAnyStoredValue(indexedDbRaw, LOCAL_LEAGUE_STATE_KEYS)) {
    return parseLocalLeagueStateFromRaw(indexedDbRaw);
  }

  const localRaw = readLocalStorageValues(LOCAL_LEAGUE_STATE_KEYS);
  if (hasAnyStoredValue(localRaw, LOCAL_LEAGUE_STATE_KEYS)) {
    void writeIndexedDbValues(
      Object.entries(localRaw)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }
  return parseLocalLeagueStateFromRaw(localRaw);
};

export const loadLocalPlayerStateAsync = async (): Promise<LeaguePlayerState> => {
  const indexedDbRaw = await readIndexedDbValues(LOCAL_PLAYER_STATE_KEYS);
  if (hasAnyStoredValue(indexedDbRaw, LOCAL_PLAYER_STATE_KEYS)) {
    return parseLocalPlayerStateFromRaw(indexedDbRaw);
  }

  const localRaw = readLocalStorageValues(LOCAL_PLAYER_STATE_KEYS);
  if (hasAnyStoredValue(localRaw, LOCAL_PLAYER_STATE_KEYS)) {
    void writeIndexedDbValues(
      Object.entries(localRaw)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }
  return parseLocalPlayerStateFromRaw(localRaw);
};

export const loadLocalLeagueState = (): {
  teams: Team[] | null;
  settings: SimulationSettings | null;
  games: Game[] | null;
  currentDate: string | null;
  progress: number | null;
  seasonComplete: boolean | null;
} => parseLocalLeagueStateFromRaw(readLocalStorageValues(LOCAL_LEAGUE_STATE_KEYS));

export const loadLocalPlayerState = (): LeaguePlayerState =>
  parseLocalPlayerStateFromRaw(readLocalStorageValues(LOCAL_PLAYER_STATE_KEYS));

const readSafetySnapshotIndex = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const raw = localStorage.getItem(LOCAL_SAFETY_SNAPSHOT_INDEX_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch (error) {
    console.warn('Failed to parse local safety snapshot index.', error);
    return [];
  }
};

const writeSafetySnapshotIndex = (snapshotIds: string[]): void => {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(LOCAL_SAFETY_SNAPSHOT_INDEX_KEY, JSON.stringify(snapshotIds));
  } catch (error) {
    console.warn('Failed to persist local safety snapshot index.', error);
  }
};

const normalizeProgress = (progress: number | null): number =>
  typeof progress === 'number' && Number.isFinite(progress) ? progress : 0;

const normalizeSeasonComplete = (seasonComplete: boolean | null): boolean =>
  typeof seasonComplete === 'boolean' ? seasonComplete : false;

const queueLocalSafetySnapshot = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  if (localSafetySnapshotTimer) {
    return;
  }

  const elapsed = Date.now() - localSafetySnapshotLastAt;
  const delay = elapsed >= LOCAL_SAFETY_SNAPSHOT_MIN_INTERVAL_MS
    ? 1500
    : LOCAL_SAFETY_SNAPSHOT_MIN_INTERVAL_MS - elapsed;

  localSafetySnapshotTimer = window.setTimeout(() => {
    localSafetySnapshotTimer = null;
    void (async () => {
      try {
        const [leagueState, playerState] = await Promise.all([
          loadLocalLeagueStateAsync(),
          loadLocalPlayerStateAsync(),
        ]);
        const snapshot: LocalStateExportBundle = {
          format: LOCAL_EXPORT_FORMAT,
          version: LOCAL_EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          leagueState: {
            ...leagueState,
            progress: normalizeProgress(leagueState.progress),
            seasonComplete: normalizeSeasonComplete(leagueState.seasonComplete),
          },
          playerState,
          extras: {
            draftCenterRaw:
              typeof localStorage !== 'undefined'
                ? localStorage.getItem(LOCAL_DRAFT_CENTER_KEY)
                : null,
          },
        };
        const snapshotId = `${LOCAL_SAFETY_SNAPSHOT_PREFIX}${Date.now()}`;
        await writeIndexedDbValues([[snapshotId, JSON.stringify(snapshot)]]);

        const previousIndex = readSafetySnapshotIndex();
        const nextIndex = [snapshotId, ...previousIndex].slice(0, LOCAL_SAFETY_SNAPSHOT_LIMIT);
        writeSafetySnapshotIndex(nextIndex);
        const trimmedKeys = previousIndex.slice(LOCAL_SAFETY_SNAPSHOT_LIMIT - 1);
        if (trimmedKeys.length > 0) {
          void removeIndexedDbValues(trimmedKeys);
        }
        localSafetySnapshotLastAt = Date.now();
      } catch (error) {
        console.warn('Failed to create local safety snapshot.', error);
      }
    })();
  }, delay);
};

const asObjectRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const assertStringOrNull = (value: unknown, label: string): string | null => {
  if (typeof value === 'string' || value === null) {
    return value;
  }
  throw new Error(`Invalid backup payload: ${label} must be a string or null.`);
};

const assertNumber = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`Invalid backup payload: ${label} must be a finite number.`);
};

const assertBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`Invalid backup payload: ${label} must be a boolean.`);
};

const assertArray = <T>(value: unknown, label: string): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }
  throw new Error(`Invalid backup payload: ${label} must be an array.`);
};

const parseImportBundle = (payload: unknown): LocalStateExportBundle => {
  const root = asObjectRecord(payload);
  if (!root) {
    throw new Error('Invalid backup payload: root must be an object.');
  }

  if (root.format !== LOCAL_EXPORT_FORMAT) {
    throw new Error('Invalid backup payload: unsupported format.');
  }
  if (root.version !== LOCAL_EXPORT_VERSION) {
    throw new Error('Invalid backup payload: unsupported version.');
  }

  const leagueStateRaw = asObjectRecord(root.leagueState);
  const playerStateRaw = asObjectRecord(root.playerState);
  if (!leagueStateRaw || !playerStateRaw) {
    throw new Error('Invalid backup payload: missing leagueState or playerState.');
  }

  const settingsRaw = asObjectRecord(leagueStateRaw.settings);

  return {
    format: LOCAL_EXPORT_FORMAT,
    version: LOCAL_EXPORT_VERSION,
    exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : new Date().toISOString(),
    leagueState: {
      teams: leagueStateRaw.teams === null ? null : assertArray<Team>(leagueStateRaw.teams, 'leagueState.teams'),
      settings: settingsRaw ? {
        continuityWeight: assertNumber(settingsRaw.continuityWeight, 'leagueState.settings.continuityWeight'),
        winLossVariance: assertNumber(settingsRaw.winLossVariance, 'leagueState.settings.winLossVariance'),
        homeFieldAdvantage: assertNumber(settingsRaw.homeFieldAdvantage, 'leagueState.settings.homeFieldAdvantage'),
        gameLuckFactor: assertNumber(settingsRaw.gameLuckFactor, 'leagueState.settings.gameLuckFactor'),
        leagueEnvironmentBalance: assertNumber(settingsRaw.leagueEnvironmentBalance, 'leagueState.settings.leagueEnvironmentBalance'),
        battingVarianceFactor: assertNumber(settingsRaw.battingVarianceFactor, 'leagueState.settings.battingVarianceFactor'),
      } : null,
      games: leagueStateRaw.games === null ? null : assertArray<Game>(leagueStateRaw.games, 'leagueState.games'),
      currentDate: assertStringOrNull(leagueStateRaw.currentDate, 'leagueState.currentDate'),
      progress: leagueStateRaw.progress === null
        ? null
        : assertNumber(leagueStateRaw.progress, 'leagueState.progress'),
      seasonComplete: leagueStateRaw.seasonComplete === null
        ? null
        : assertBoolean(leagueStateRaw.seasonComplete, 'leagueState.seasonComplete'),
    },
    playerState: {
      players: assertArray<Player>(playerStateRaw.players, 'playerState.players'),
      battingStats: assertArray<PlayerSeasonBatting>(playerStateRaw.battingStats, 'playerState.battingStats'),
      pitchingStats: assertArray<PlayerSeasonPitching>(playerStateRaw.pitchingStats, 'playerState.pitchingStats'),
      battingRatings: assertArray<PlayerBattingRatings>(playerStateRaw.battingRatings, 'playerState.battingRatings'),
      pitchingRatings: assertArray<PlayerPitchingRatings>(playerStateRaw.pitchingRatings, 'playerState.pitchingRatings'),
      rosterSlots: assertArray<TeamRosterSlot>(playerStateRaw.rosterSlots, 'playerState.rosterSlots'),
      transactions: assertArray<PlayerTransaction>(playerStateRaw.transactions, 'playerState.transactions'),
    },
    extras: (() => {
      const extrasRaw = asObjectRecord(root.extras);
      if (!extrasRaw) {
        return undefined;
      }
      return {
        draftCenterRaw: assertStringOrNull(extrasRaw.draftCenterRaw, 'extras.draftCenterRaw'),
      };
    })(),
  };
};

export const exportLocalStateBundle = async (): Promise<LocalStateExportBundle> => {
  const [leagueState, playerState] = await Promise.all([
    loadLocalLeagueStateAsync(),
    loadLocalPlayerStateAsync(),
  ]);

  return {
    format: LOCAL_EXPORT_FORMAT,
    version: LOCAL_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    leagueState: {
      ...leagueState,
      progress: normalizeProgress(leagueState.progress),
      seasonComplete: normalizeSeasonComplete(leagueState.seasonComplete),
    },
    playerState,
    extras: {
      draftCenterRaw:
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(LOCAL_DRAFT_CENTER_KEY)
          : null,
    },
  };
};

export const importLocalStateBundle = async (payload: unknown): Promise<void> => {
  const bundle = parseImportBundle(payload);
  const { leagueState, playerState } = bundle;

  if (!leagueState.teams || !leagueState.settings || !leagueState.games || !leagueState.currentDate) {
    throw new Error('Backup is missing required league state fields.');
  }

  saveLocalLeagueState(
    leagueState.teams,
    leagueState.settings,
    leagueState.games,
    leagueState.currentDate,
    normalizeProgress(leagueState.progress),
    normalizeSeasonComplete(leagueState.seasonComplete),
  );
  saveLocalPlayerState(playerState);
  if (typeof localStorage !== 'undefined' && bundle.extras?.draftCenterRaw !== undefined) {
    if (bundle.extras.draftCenterRaw === null) {
      localStorage.removeItem(LOCAL_DRAFT_CENTER_KEY);
    } else {
      localStorage.setItem(LOCAL_DRAFT_CENTER_KEY, bundle.extras.draftCenterRaw);
    }
  }
  queueLocalSafetySnapshot();
};

export const saveLocalLeagueState = (
  teams: Team[],
  settings: SimulationSettings,
  games: Game[],
  currentDate: string,
  progress: number,
  seasonComplete: boolean,
): void => {
  const serializedTeams = JSON.stringify(teams);
  const serializedSettings = JSON.stringify(settings);
  let serializedGames = JSON.stringify(games);

  localStorage.setItem(STORAGE_KEYS.teams, serializedTeams);
  localStorage.setItem(STORAGE_KEYS.settings, serializedSettings);
  try {
    localStorage.setItem(STORAGE_KEYS.games, serializedGames);
  } catch (error) {
    // Quota fallback: keep structural game data and strip box score payloads.
    const compactGames = games.map((game) => ({
      ...game,
      stats: {},
    }));
    serializedGames = JSON.stringify(compactGames);
    localStorage.setItem(STORAGE_KEYS.games, serializedGames);
    console.warn('Saved compact local game snapshot after quota pressure.', error);
  }
  localStorage.setItem(STORAGE_KEYS.currentDate, currentDate);
  const serializedProgress = String(progress);
  const serializedSeasonComplete = String(seasonComplete);
  localStorage.setItem(STORAGE_KEYS.progress, serializedProgress);
  localStorage.setItem(STORAGE_KEYS.seasonComplete, serializedSeasonComplete);

  void writeIndexedDbValues([
    [STORAGE_KEYS.teams, serializedTeams],
    [STORAGE_KEYS.settings, serializedSettings],
    [STORAGE_KEYS.games, serializedGames],
    [STORAGE_KEYS.currentDate, currentDate],
    [STORAGE_KEYS.progress, serializedProgress],
    [STORAGE_KEYS.seasonComplete, serializedSeasonComplete],
  ]);
  queueLocalSafetySnapshot();
};

export const saveLocalPlayerState = (playerState: LeaguePlayerState): void => {
  const serializedPlayers = JSON.stringify(playerState.players);
  const serializedBattingStats = JSON.stringify(playerState.battingStats);
  const serializedPitchingStats = JSON.stringify(playerState.pitchingStats);
  const serializedBattingRatings = JSON.stringify(playerState.battingRatings);
  const serializedPitchingRatings = JSON.stringify(playerState.pitchingRatings);
  const serializedRosterSlots = JSON.stringify(playerState.rosterSlots);
  const serializedTransactions = JSON.stringify(playerState.transactions);

  localStorage.setItem(STORAGE_KEYS.players, serializedPlayers);
  localStorage.setItem(STORAGE_KEYS.battingStats, serializedBattingStats);
  localStorage.setItem(STORAGE_KEYS.pitchingStats, serializedPitchingStats);
  localStorage.setItem(STORAGE_KEYS.battingRatings, serializedBattingRatings);
  localStorage.setItem(STORAGE_KEYS.pitchingRatings, serializedPitchingRatings);
  localStorage.setItem(STORAGE_KEYS.rosterSlots, serializedRosterSlots);
  localStorage.setItem(STORAGE_KEYS.playerTransactions, serializedTransactions);

  void writeIndexedDbValues([
    [STORAGE_KEYS.players, serializedPlayers],
    [STORAGE_KEYS.battingStats, serializedBattingStats],
    [STORAGE_KEYS.pitchingStats, serializedPitchingStats],
    [STORAGE_KEYS.battingRatings, serializedBattingRatings],
    [STORAGE_KEYS.pitchingRatings, serializedPitchingRatings],
    [STORAGE_KEYS.rosterSlots, serializedRosterSlots],
    [STORAGE_KEYS.playerTransactions, serializedTransactions],
  ]);
  queueLocalSafetySnapshot();
};

export const clearLocalPlayerState = (): void => {
  localStorage.removeItem(STORAGE_KEYS.players);
  localStorage.removeItem(STORAGE_KEYS.battingStats);
  localStorage.removeItem(STORAGE_KEYS.pitchingStats);
  localStorage.removeItem(STORAGE_KEYS.battingRatings);
  localStorage.removeItem(STORAGE_KEYS.pitchingRatings);
  localStorage.removeItem(STORAGE_KEYS.rosterSlots);
  localStorage.removeItem(STORAGE_KEYS.playerTransactions);
  void removeIndexedDbValues(LOCAL_PLAYER_STATE_KEYS);
};

export const loadSupabaseLeagueState = async (): Promise<{
  teams: Team[] | null;
  settings: SimulationSettings | null;
  games: Game[] | null;
  currentDate: string | null;
  progress: number | null;
  seasonComplete: boolean | null;
}> => {
  if (!supabase) {
    return {
      teams: null,
      settings: null,
      games: null,
      currentDate: null,
      progress: null,
      seasonComplete: null,
    };
  }

  const leagueId = await ensureLeague();

  const [
    { data: teamRows, error: teamError },
    { data: settingsRow, error: settingsError },
    { data: gameRows, error: gameError },
    { data: leagueStateRow, error: leagueStateError },
  ] = await Promise.all([
    supabase
      .from('teams')
      .select(
        'team_id, city, name, league, division, rating, previous_baseline_wins, wins, losses, runs_scored, runs_allowed',
      )
      .eq('league_id', leagueId)
      .order('team_id', { ascending: true }),
    supabase
      .from('league_settings')
      .select('continuity_weight, win_loss_variance, home_field_advantage, game_luck_factor, league_environment_balance, batting_variance_factor')
      .eq('league_id', leagueId)
      .maybeSingle(),
    supabase
      .from('league_games')
      .select('game_id, game_date, home_team_id, away_team_id, phase, status, home_score, away_score, playoff, stats')
      .eq('league_id', leagueId)
      .order('game_date', { ascending: true })
      .order('game_id', { ascending: true }),
    supabase
      .from('league_state')
      .select('current_sim_date, progress, season_complete')
      .eq('league_id', leagueId)
      .maybeSingle(),
  ]);

  if (teamError) {
    throw teamError;
  }
  if (settingsError) {
    throw settingsError;
  }
  if (gameError) {
    throw gameError;
  }
  if (leagueStateError) {
    throw leagueStateError;
  }

  return {
    teams: teamRows && teamRows.length > 0 ? (teamRows as TeamRow[]).map(toTeam) : null,
    settings: settingsRow ? toSettings(settingsRow as SettingsRow) : null,
    games: gameRows && gameRows.length > 0 ? (gameRows as GameRow[]).map(toGame) : null,
    currentDate: (leagueStateRow as LeagueStateRow | null)?.current_sim_date ?? null,
    progress: typeof (leagueStateRow as LeagueStateRow | null)?.progress === 'number'
      ? (leagueStateRow as LeagueStateRow).progress
      : null,
    seasonComplete: typeof (leagueStateRow as LeagueStateRow | null)?.season_complete === 'boolean'
      ? (leagueStateRow as LeagueStateRow).season_complete
      : null,
  };
};

export const loadSupabasePlayerState = async (): Promise<LeaguePlayerState> => {
  if (!supabase) {
    return {
      players: [],
      battingStats: [],
      pitchingStats: [],
      battingRatings: [],
      pitchingRatings: [],
      rosterSlots: [],
      transactions: [],
    };
  }

  const leagueId = await ensureLeague();

  const { data: playerRows, error: playerError } = await supabase
    .from('players')
    .select(
      'player_id, team_id, first_name, last_name, player_type, primary_position, secondary_position, bats, throws, age, height, weight_lbs, potential, status, contract_years_left, draft_class_year, draft_round, years_pro, retirement_year',
    )
    .eq('league_id', leagueId)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true });

  if (playerError) {
    throw playerError;
  }

  const players = ((playerRows as PlayerRow[] | null) ?? []).map(toPlayer);
  if (players.length === 0) {
    return {
      players: [],
      battingStats: [],
      pitchingStats: [],
      battingRatings: [],
      pitchingRatings: [],
      rosterSlots: [],
      transactions: [],
    };
  }

  const playerIds = players.map((player) => player.playerId);

  const [
    { data: battingRows, error: battingError },
    { data: pitchingRows, error: pitchingError },
    { data: battingRatingRows, error: battingRatingsError },
    { data: pitchingRatingRows, error: pitchingRatingsError },
    { data: rosterRows, error: rosterError },
    { data: transactionRows, error: transactionError },
  ] = await Promise.all([
    supabase
      .from('player_season_batting')
      .select(
        'player_id, season_year, season_phase, games_played, plate_appearances, at_bats, runs_scored, hits, doubles, triples, home_runs, walks, strikeouts, rbi, avg, ops',
      )
      .in('player_id', playerIds)
      .order('season_year', { ascending: false }),
    supabase
      .from('player_season_pitching')
      .select(
        'player_id, season_year, season_phase, wins, losses, saves, games, games_started, innings_pitched, hits_allowed, earned_runs, walks, strikeouts, era, whip',
      )
      .in('player_id', playerIds)
      .order('season_year', { ascending: false }),
    supabase
      .from('player_batting_ratings')
      .select(
        'player_id, season_year, contact, power, plate_discipline, avoid_strikeout, speed, baserunning, fielding, arm, overall, potential_overall',
      )
      .in('player_id', playerIds)
      .order('season_year', { ascending: false }),
    supabase
      .from('player_pitching_ratings')
      .select(
        'player_id, season_year, stuff, command, control, movement, stamina, hold_runners, fielding, overall, potential_overall',
      )
      .in('player_id', playerIds)
      .order('season_year', { ascending: false }),
    supabase
      .from('team_roster_slots')
      .select('season_year, team_id, slot_code, player_id')
      .eq('league_id', leagueId)
      .order('season_year', { ascending: false })
      .order('team_id', { ascending: true }),
    supabase
      .from('player_transactions')
      .select('player_id, event_type, from_team_id, to_team_id, effective_date, notes')
      .eq('league_id', leagueId)
      .order('effective_date', { ascending: false }),
  ]);

  if (battingError) {
    throw battingError;
  }
  if (pitchingError) {
    throw pitchingError;
  }
  if (battingRatingsError) {
    throw battingRatingsError;
  }
  if (pitchingRatingsError) {
    throw pitchingRatingsError;
  }
  if (rosterError) {
    throw rosterError;
  }
  if (transactionError) {
    throw transactionError;
  }

  return {
    players,
    battingStats: ((battingRows as PlayerSeasonBattingRow[] | null) ?? []).map(toBattingStat),
    pitchingStats: ((pitchingRows as PlayerSeasonPitchingRow[] | null) ?? []).map(toPitchingStat),
    battingRatings: ((battingRatingRows as PlayerBattingRatingsRow[] | null) ?? []).map(toBattingRatings),
    pitchingRatings: ((pitchingRatingRows as PlayerPitchingRatingsRow[] | null) ?? []).map(toPitchingRatings),
    rosterSlots: ((rosterRows as TeamRosterSlotRow[] | null) ?? []).map(toRosterSlot),
    transactions: ((transactionRows as PlayerTransactionRow[] | null) ?? []).map(toPlayerTransaction),
  };
};

export const seedSupabaseLeagueState = async (teams: Team[], settings: SimulationSettings): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();

  const { count, error: countError } = await supabase
    .from('teams')
    .select('team_id', { head: true, count: 'exact' })
    .eq('league_id', leagueId);

  if (countError) {
    throw countError;
  }

  if ((count ?? 0) > 0) {
    return;
  }

  const teamRows = teams.map((team) => toTeamRow(team, leagueId));
  const settingsRow = toSettingsRow(settings, leagueId);

  const [{ error: teamInsertError }, { error: settingsInsertError }, { error: stateInsertError }] = await Promise.all([
    supabase.from('teams').insert(teamRows),
    supabase.from('league_settings').insert(settingsRow),
    supabase.from('league_state').insert(toLeagueStateRow(leagueId, '', 0, false)),
  ]);

  if (teamInsertError) {
    throw teamInsertError;
  }
  if (settingsInsertError) {
    throw settingsInsertError;
  }
  if (stateInsertError) {
    throw stateInsertError;
  }
};

export const replaceSupabaseTeamsFromSource = async (teams: Team[]): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();
  const teamRows = teams.map((team) => toTeamRow(team, leagueId));
  const sourceIds = teams.map((team) => team.id);
  const sourceIdSet = new Set(sourceIds);

  const { data: existingRows, error: existingRowsError } = await supabase
    .from('teams')
    .select('team_id')
    .eq('league_id', leagueId);

  if (existingRowsError) {
    throw existingRowsError;
  }

  const staleIds = ((existingRows as Array<{ team_id: string }> | null) ?? [])
    .map((row) => row.team_id)
    .filter((teamId) => !sourceIdSet.has(teamId));

  const { error: teamsUpsertError } = await supabase
    .from('teams')
    .upsert(teamRows, { onConflict: 'league_id,team_id' });

  if (teamsUpsertError) {
    throw teamsUpsertError;
  }

  if (staleIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('teams')
      .delete()
      .eq('league_id', leagueId)
      .in('team_id', staleIds);

    if (deleteError) {
      throw deleteError;
    }
  }
};

export const saveSupabaseLeagueState = async (
  teams: Team[],
  settings: SimulationSettings,
  games: Game[],
  currentDate: string,
  progress: number,
  seasonComplete: boolean,
  options?: {
    pruneMissingGames?: boolean;
    gameChunkSize?: number;
  },
): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();
  const teamRows = teams.map((team) => toTeamRow(team, leagueId));
  const settingsRow = toSettingsRow(settings, leagueId);
  const gameRows = games.map((game) => toGameRow(game, leagueId));
  const stateRow = toLeagueStateRow(leagueId, currentDate, progress, seasonComplete);
  const pruneMissingGames = options?.pruneMissingGames ?? false;
  const gameChunkSize = options?.gameChunkSize ?? 40;
  let staleGameIds: string[] = [];

  if (pruneMissingGames) {
    const sourceIds = games.map((game) => game.gameId);
    const sourceIdSet = new Set(sourceIds);
    const { data: existingGameRows, error: existingGameRowsError } = await supabase
      .from('league_games')
      .select('game_id')
      .eq('league_id', leagueId);

    if (existingGameRowsError) {
      throw existingGameRowsError;
    }

    staleGameIds = ((existingGameRows as Array<{ game_id: string }> | null) ?? [])
      .map((row) => row.game_id)
      .filter((gameId) => !sourceIdSet.has(gameId));
  }

  await Promise.all([
    runSupabaseMutationWithRetry(() => supabase.from('teams').upsert(teamRows, { onConflict: 'league_id,team_id' })),
    runSupabaseMutationWithRetry(() => supabase.from('league_settings').upsert(settingsRow, { onConflict: 'league_id' })),
    runSupabaseMutationWithRetry(() => supabase.from('league_state').upsert(stateRow, { onConflict: 'league_id' })),
  ]);

  for (let index = 0; index < gameRows.length; index += gameChunkSize) {
    const chunk = gameRows.slice(index, index + gameChunkSize);
    await upsertLeagueGameRowsWithRetry(chunk);
  }

  if (staleGameIds.length > 0) {
    for (const staleChunk of chunkArray(staleGameIds, 500)) {
      await runSupabaseMutationWithRetry(() =>
        supabase
          .from('league_games')
          .delete()
          .eq('league_id', leagueId)
          .in('game_id', staleChunk),
      );
    }
  }
};

export const loadSupabaseSliderPresets = async (): Promise<SliderPresetRecord[]> => {
  if (!supabase) {
    return [];
  }

  const leagueId = await ensureLeague();
  const { data, error } = await supabase
    .from('slider_presets')
    .select('id, preset_name, continuity_weight, win_loss_variance, home_field_advantage, game_luck_factor, league_environment_balance, batting_variance_factor, updated_at')
    .eq('league_id', leagueId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data as SliderPresetRow[] | null) ?? []).map(toSliderPresetRecord);
};

export const saveSupabaseSliderPreset = async (
  presetName: string,
  settings: SimulationSettings,
): Promise<SliderPresetRecord> => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const leagueId = await ensureLeague();
  const row = toSliderPresetRow(presetName, settings, leagueId);
  const { data, error } = await supabase
    .from('slider_presets')
    .upsert(row, { onConflict: 'league_id,preset_name' })
    .select('id, preset_name, continuity_weight, win_loss_variance, home_field_advantage, game_luck_factor, league_environment_balance, batting_variance_factor, updated_at')
    .single();

  if (error) {
    throw error;
  }

  return toSliderPresetRecord(data as SliderPresetRow);
};

export const deleteSupabaseSliderPreset = async (presetId: number): Promise<void> => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { error } = await supabase
    .from('slider_presets')
    .delete()
    .eq('id', presetId);

  if (error) {
    throw error;
  }
};

export const saveSupabasePlayerState = async (playerState: LeaguePlayerState): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();
  const playerRows = playerState.players.map((player) => toPlayerRow(player, leagueId));
  const battingRows = dedupeByKey(
    playerState.battingStats.map(toBattingStatRow),
    (row) => `${row.player_id}:${row.season_year}:${row.season_phase}`,
  );
  const pitchingRows = dedupeByKey(
    playerState.pitchingStats.map(toPitchingStatRow),
    (row) => `${row.player_id}:${row.season_year}:${row.season_phase}`,
  );
  const battingRatingRows = dedupeByKey(
    playerState.battingRatings.map(toBattingRatingsRow),
    (row) => `${row.player_id}:${row.season_year}`,
  );
  const pitchingRatingRows = dedupeByKey(
    playerState.pitchingRatings.map(toPitchingRatingsRow),
    (row) => `${row.player_id}:${row.season_year}`,
  );
  const rosterRows = dedupeByKey(
    dedupeByKey(
      playerState.rosterSlots.map((slot) => toRosterSlotRow(slot, leagueId)),
      (row) => `${row.league_id}:${row.season_year}:${row.player_id}`,
    ),
    (row) => `${row.league_id}:${row.season_year}:${row.team_id}:${row.slot_code}`,
  );
  const transactionRows = playerState.transactions.map((transaction) => toPlayerTransactionRow(transaction, leagueId));
  const sourcePlayerIds = playerState.players.map((player) => player.playerId);
  const sourcePlayerIdSet = new Set(sourcePlayerIds);

  const { data: existingPlayerRows, error: existingPlayersError } = await supabase
    .from('players')
    .select('player_id')
    .eq('league_id', leagueId);

  if (existingPlayersError) {
    throw existingPlayersError;
  }

  const stalePlayerIds = ((existingPlayerRows as Array<{ player_id: string }> | null) ?? [])
    .map((row) => row.player_id)
    .filter((playerId) => !sourcePlayerIdSet.has(playerId));

  const chunkSize = 500;

  for (const chunk of chunkArray(playerRows, chunkSize)) {
    const { error } = await supabase.from('players').upsert(chunk, { onConflict: 'player_id' });
    if (error) {
      throw error;
    }
  }

  if (stalePlayerIds.length > 0) {
    for (const chunk of chunkArray(stalePlayerIds, chunkSize)) {
      const { error } = await supabase
        .from('players')
        .delete()
        .eq('league_id', leagueId)
        .in('player_id', chunk);

      if (error) {
        throw error;
      }
    }
  }

  if (battingRows.length > 0) {
    for (const chunk of chunkArray(battingRows, chunkSize)) {
      const { error } = await supabase
        .from('player_season_batting')
        .upsert(chunk, { onConflict: 'player_id,season_year,season_phase' });
      if (error) {
        throw error;
      }
    }
  }

  if (pitchingRows.length > 0) {
    for (const chunk of chunkArray(pitchingRows, chunkSize)) {
      const { error } = await supabase
        .from('player_season_pitching')
        .upsert(chunk, { onConflict: 'player_id,season_year,season_phase' });
      if (error) {
        throw error;
      }
    }
  }

  if (battingRatingRows.length > 0) {
    for (const chunk of chunkArray(battingRatingRows, chunkSize)) {
      const { error } = await supabase
        .from('player_batting_ratings')
        .upsert(chunk, { onConflict: 'player_id,season_year' });
      if (error) {
        throw error;
      }
    }
  }

  if (pitchingRatingRows.length > 0) {
    for (const chunk of chunkArray(pitchingRatingRows, chunkSize)) {
      const { error } = await supabase
        .from('player_pitching_ratings')
        .upsert(chunk, { onConflict: 'player_id,season_year' });
      if (error) {
        throw error;
      }
    }
  }

  const { error: deleteRosterError } = await supabase
    .from('team_roster_slots')
    .delete()
    .eq('league_id', leagueId);
  if (deleteRosterError) {
    throw deleteRosterError;
  }

  if (rosterRows.length > 0) {
    for (const chunk of chunkArray(rosterRows, chunkSize)) {
      const { error } = await supabase
        .from('team_roster_slots')
        .insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  const { error: deleteTransactionsError } = await supabase
    .from('player_transactions')
    .delete()
    .eq('league_id', leagueId);
  if (deleteTransactionsError) {
    throw deleteTransactionsError;
  }

  if (transactionRows.length > 0) {
    for (const chunk of chunkArray(transactionRows, chunkSize)) {
      const { error } = await supabase
        .from('player_transactions')
        .insert(chunk);
      if (error) {
        throw error;
      }
    }
  }
};

export const clearSupabasePlayerState = async (): Promise<number> => {
  if (!supabase) {
    return 0;
  }

  const { count, error: countError } = await supabase
    .from('players')
    .select('player_id', { head: true, count: 'exact' });

  if (countError) {
    throw countError;
  }

  const { error: deleteError } = await supabase
    .from('players')
    .delete();

  if (deleteError) {
    throw deleteError;
  }

  return count ?? 0;
};

export const saveSupabaseSeasonRun = async (
  teams: Team[],
  games: Game[],
  settings: SimulationSettings,
  seasonLabel: string,
): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();

  const { data: seasonRun, error: seasonInsertError } = await supabase
    .from('season_runs')
    .insert({
      league_id: leagueId,
      season_label: seasonLabel,
      settings_snapshot: settings,
      team_snapshot: teams,
    })
    .select('id')
    .single();

  if (seasonInsertError) {
    throw seasonInsertError;
  }

  const gameRows = games.map((game) => ({
    season_run_id: seasonRun.id,
    game_id: game.gameId,
    home_team_id: game.homeTeam,
    away_team_id: game.awayTeam,
    home_score: game.score.home,
    away_score: game.score.away,
    played: game.status === 'completed',
    game_date: game.date,
    status: game.status,
    stats: game.stats,
  }));

  const chunkSize = 500;
  for (let i = 0; i < gameRows.length; i += chunkSize) {
    const chunk = gameRows.slice(i, i + chunkSize);
    const { error: gameInsertError } = await supabase.from('season_games').insert(chunk);
    if (gameInsertError) {
      throw gameInsertError;
    }
  }
};

export const clearSupabaseSeasonHistory = async (): Promise<number> => {
  if (!supabase) {
    return 0;
  }

  const leagueId = await ensureLeague();

  const { count, error: countError } = await supabase
    .from('season_runs')
    .select('id', { head: true, count: 'exact' })
    .eq('league_id', leagueId);

  if (countError) {
    throw countError;
  }

  const { error: deleteError } = await supabase
    .from('season_runs')
    .delete()
    .eq('league_id', leagueId);

  if (deleteError) {
    throw deleteError;
  }

  return count ?? 0;
};
