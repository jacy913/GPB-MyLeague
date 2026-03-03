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

const LEAGUE_SLUG = 'grand-league';
const LEAGUE_NAME = 'Grand League Baseball';

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
  potential: number;
  status: Player['status'];
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
  potential: row.potential,
  status: row.status,
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
  secondary_position: player.secondaryPosition,
  bats: player.bats,
  throws: player.throws,
  age: player.age,
  potential: player.potential,
  status: player.status,
  draft_class_year: player.draftClassYear,
  draft_round: player.draftRound,
  years_pro: player.yearsPro,
  retirement_year: player.retirementYear,
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
  contact: ratings.contact,
  power: ratings.power,
  plate_discipline: ratings.plateDiscipline,
  avoid_strikeout: ratings.avoidStrikeout,
  speed: ratings.speed,
  baserunning: ratings.baserunning,
  fielding: ratings.fielding,
  arm: ratings.arm,
  overall: ratings.overall,
  potential_overall: ratings.potentialOverall,
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
  stuff: ratings.stuff,
  command: ratings.command,
  control: ratings.control,
  movement: ratings.movement,
  stamina: ratings.stamina,
  hold_runners: ratings.holdRunners,
  fielding: ratings.fielding,
  overall: ratings.overall,
  potential_overall: ratings.potentialOverall,
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

const ensureLeague = async (): Promise<string> => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data: existingLeague, error: fetchError } = await supabase
    .from('leagues')
    .select('id')
    .eq('slug', LEAGUE_SLUG)
    .maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (existingLeague?.id) {
    return existingLeague.id;
  }

  const { data: insertedLeague, error: insertError } = await supabase
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

  return insertedLeague.id;
};

export const loadLocalLeagueState = (): {
  teams: Team[] | null;
  settings: SimulationSettings | null;
  games: Game[] | null;
  currentDate: string | null;
  progress: number | null;
  seasonComplete: boolean | null;
} => {
  const parseJson = <T,>(raw: string | null): T | null => {
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      console.error('Failed to parse local league state JSON:', error);
      return null;
    }
  };

  const savedTeams = parseJson<Team[]>(localStorage.getItem(STORAGE_KEYS.teams));
  const savedSettings = parseJson<SimulationSettings>(localStorage.getItem(STORAGE_KEYS.settings));
  const savedGames = parseJson<Game[]>(localStorage.getItem(STORAGE_KEYS.games));
  const rawCurrentDate = localStorage.getItem(STORAGE_KEYS.currentDate);
  const rawProgress = localStorage.getItem(STORAGE_KEYS.progress);
  const rawSeasonComplete = localStorage.getItem(STORAGE_KEYS.seasonComplete);

  return {
    teams: savedTeams,
    settings: savedSettings,
    games: savedGames,
    currentDate: rawCurrentDate,
    progress: rawProgress !== null ? Number(rawProgress) : null,
    seasonComplete: rawSeasonComplete === null ? null : rawSeasonComplete === 'true',
  };
};

export const loadLocalPlayerState = (): LeaguePlayerState => {
  const parseJson = <T,>(raw: string | null, fallback: T): T => {
    if (!raw) {
      return fallback;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      console.error('Failed to parse local player state JSON:', error);
      return fallback;
    }
  };

  return {
    players: parseJson<Player[]>(localStorage.getItem(STORAGE_KEYS.players), []),
    battingStats: parseJson<PlayerSeasonBatting[]>(localStorage.getItem(STORAGE_KEYS.battingStats), []),
    pitchingStats: parseJson<PlayerSeasonPitching[]>(localStorage.getItem(STORAGE_KEYS.pitchingStats), []),
    battingRatings: parseJson<PlayerBattingRatings[]>(localStorage.getItem(STORAGE_KEYS.battingRatings), []),
    pitchingRatings: parseJson<PlayerPitchingRatings[]>(localStorage.getItem(STORAGE_KEYS.pitchingRatings), []),
    rosterSlots: parseJson<TeamRosterSlot[]>(localStorage.getItem(STORAGE_KEYS.rosterSlots), []),
    transactions: parseJson<PlayerTransaction[]>(localStorage.getItem(STORAGE_KEYS.playerTransactions), []),
  };
};

export const saveLocalLeagueState = (
  teams: Team[],
  settings: SimulationSettings,
  games: Game[],
  currentDate: string,
  progress: number,
  seasonComplete: boolean,
): void => {
  localStorage.setItem(STORAGE_KEYS.teams, JSON.stringify(teams));
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
  localStorage.setItem(STORAGE_KEYS.games, JSON.stringify(games));
  localStorage.setItem(STORAGE_KEYS.currentDate, currentDate);
  localStorage.setItem(STORAGE_KEYS.progress, String(progress));
  localStorage.setItem(STORAGE_KEYS.seasonComplete, String(seasonComplete));
};

export const saveLocalPlayerState = (playerState: LeaguePlayerState): void => {
  localStorage.setItem(STORAGE_KEYS.players, JSON.stringify(playerState.players));
  localStorage.setItem(STORAGE_KEYS.battingStats, JSON.stringify(playerState.battingStats));
  localStorage.setItem(STORAGE_KEYS.pitchingStats, JSON.stringify(playerState.pitchingStats));
  localStorage.setItem(STORAGE_KEYS.battingRatings, JSON.stringify(playerState.battingRatings));
  localStorage.setItem(STORAGE_KEYS.pitchingRatings, JSON.stringify(playerState.pitchingRatings));
  localStorage.setItem(STORAGE_KEYS.rosterSlots, JSON.stringify(playerState.rosterSlots));
  localStorage.setItem(STORAGE_KEYS.playerTransactions, JSON.stringify(playerState.transactions));
};

export const clearLocalPlayerState = (): void => {
  localStorage.removeItem(STORAGE_KEYS.players);
  localStorage.removeItem(STORAGE_KEYS.battingStats);
  localStorage.removeItem(STORAGE_KEYS.pitchingStats);
  localStorage.removeItem(STORAGE_KEYS.battingRatings);
  localStorage.removeItem(STORAGE_KEYS.pitchingRatings);
  localStorage.removeItem(STORAGE_KEYS.rosterSlots);
  localStorage.removeItem(STORAGE_KEYS.playerTransactions);
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
      'player_id, team_id, first_name, last_name, player_type, primary_position, secondary_position, bats, throws, age, potential, status, draft_class_year, draft_round, years_pro, retirement_year',
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

  const { data: existingRows, error: existingRowsError } = await supabase
    .from('teams')
    .select('team_id')
    .eq('league_id', leagueId);

  if (existingRowsError) {
    throw existingRowsError;
  }

  const staleIds = ((existingRows as Array<{ team_id: string }> | null) ?? [])
    .map((row) => row.team_id)
    .filter((teamId) => !sourceIds.includes(teamId));

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
): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();
  const teamRows = teams.map((team) => toTeamRow(team, leagueId));
  const settingsRow = toSettingsRow(settings, leagueId);
  const gameRows = games.map((game) => toGameRow(game, leagueId));
  const stateRow = toLeagueStateRow(leagueId, currentDate, progress, seasonComplete);
  const sourceIds = games.map((game) => game.gameId);

  const { data: existingGameRows, error: existingGameRowsError } = await supabase
    .from('league_games')
    .select('game_id')
    .eq('league_id', leagueId);

  if (existingGameRowsError) {
    throw existingGameRowsError;
  }

  const staleGameIds = ((existingGameRows as Array<{ game_id: string }> | null) ?? [])
    .map((row) => row.game_id)
    .filter((gameId) => !sourceIds.includes(gameId));

  const [{ error: teamsUpsertError }, { error: settingsUpsertError }, { error: stateUpsertError }] = await Promise.all([
    supabase.from('teams').upsert(teamRows, { onConflict: 'league_id,team_id' }),
    supabase.from('league_settings').upsert(settingsRow, { onConflict: 'league_id' }),
    supabase.from('league_state').upsert(stateRow, { onConflict: 'league_id' }),
  ]);

  if (teamsUpsertError) {
    throw teamsUpsertError;
  }
  if (settingsUpsertError) {
    throw settingsUpsertError;
  }
  if (stateUpsertError) {
    throw stateUpsertError;
  }

  const chunkSize = 500;
  for (let index = 0; index < gameRows.length; index += chunkSize) {
    const chunk = gameRows.slice(index, index + chunkSize);
    const { error: gamesUpsertError } = await supabase
      .from('league_games')
      .upsert(chunk, { onConflict: 'league_id,game_id' });

    if (gamesUpsertError) {
      throw gamesUpsertError;
    }
  }

  if (staleGameIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('league_games')
      .delete()
      .eq('league_id', leagueId)
      .in('game_id', staleGameIds);

    if (deleteError) {
      throw deleteError;
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
  const battingRows = playerState.battingStats.map(toBattingStatRow);
  const pitchingRows = playerState.pitchingStats.map(toPitchingStatRow);
  const battingRatingRows = playerState.battingRatings.map(toBattingRatingsRow);
  const pitchingRatingRows = playerState.pitchingRatings.map(toPitchingRatingsRow);
  const rosterRows = playerState.rosterSlots.map((slot) => toRosterSlotRow(slot, leagueId));
  const transactionRows = playerState.transactions.map((transaction) => toPlayerTransactionRow(transaction, leagueId));
  const sourcePlayerIds = playerState.players.map((player) => player.playerId);

  const { data: existingPlayerRows, error: existingPlayersError } = await supabase
    .from('players')
    .select('player_id')
    .eq('league_id', leagueId);

  if (existingPlayersError) {
    throw existingPlayersError;
  }

  const stalePlayerIds = ((existingPlayerRows as Array<{ player_id: string }> | null) ?? [])
    .map((row) => row.player_id)
    .filter((playerId) => !sourcePlayerIds.includes(playerId));

  const chunkSize = 500;

  for (let index = 0; index < playerRows.length; index += chunkSize) {
    const chunk = playerRows.slice(index, index + chunkSize);
    const { error } = await supabase.from('players').upsert(chunk, { onConflict: 'player_id' });
    if (error) {
      throw error;
    }
  }

  if (stalePlayerIds.length > 0) {
    const { error } = await supabase
      .from('players')
      .delete()
      .eq('league_id', leagueId)
      .in('player_id', stalePlayerIds);

    if (error) {
      throw error;
    }
  }

  if (sourcePlayerIds.length > 0) {
    const { error: deleteBattingError } = await supabase
      .from('player_season_batting')
      .delete()
      .in('player_id', sourcePlayerIds);
    if (deleteBattingError) {
      throw deleteBattingError;
    }

    const { error: deletePitchingError } = await supabase
      .from('player_season_pitching')
      .delete()
      .in('player_id', sourcePlayerIds);
    if (deletePitchingError) {
      throw deletePitchingError;
    }

    const { error: deleteBattingRatingsError } = await supabase
      .from('player_batting_ratings')
      .delete()
      .in('player_id', sourcePlayerIds);
    if (deleteBattingRatingsError) {
      throw deleteBattingRatingsError;
    }

    const { error: deletePitchingRatingsError } = await supabase
      .from('player_pitching_ratings')
      .delete()
      .in('player_id', sourcePlayerIds);
    if (deletePitchingRatingsError) {
      throw deletePitchingRatingsError;
    }
  }

  if (battingRows.length > 0) {
    for (let index = 0; index < battingRows.length; index += chunkSize) {
      const chunk = battingRows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from('player_season_batting')
        .insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  if (pitchingRows.length > 0) {
    for (let index = 0; index < pitchingRows.length; index += chunkSize) {
      const chunk = pitchingRows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from('player_season_pitching')
        .insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  if (battingRatingRows.length > 0) {
    for (let index = 0; index < battingRatingRows.length; index += chunkSize) {
      const chunk = battingRatingRows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from('player_batting_ratings')
        .insert(chunk);
      if (error) {
        throw error;
      }
    }
  }

  if (pitchingRatingRows.length > 0) {
    for (let index = 0; index < pitchingRatingRows.length; index += chunkSize) {
      const chunk = pitchingRatingRows.slice(index, index + chunkSize);
      const { error } = await supabase
        .from('player_pitching_ratings')
        .insert(chunk);
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
    for (let index = 0; index < rosterRows.length; index += chunkSize) {
      const chunk = rosterRows.slice(index, index + chunkSize);
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
    for (let index = 0; index < transactionRows.length; index += chunkSize) {
      const chunk = transactionRows.slice(index, index + chunkSize);
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
