import { Game, SimulationSettings, Team } from '../types';
import { supabase } from './supabaseClient';

const STORAGE_KEYS = {
  teams: 'glb_teams',
  settings: 'glb_settings',
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
});

const toSettingsRow = (settings: SimulationSettings, leagueId: string): SettingsRow & { league_id: string } => ({
  league_id: leagueId,
  continuity_weight: settings.continuityWeight,
  win_loss_variance: settings.winLossVariance,
  home_field_advantage: settings.homeFieldAdvantage,
  game_luck_factor: settings.gameLuckFactor,
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

  return {
    teams: savedTeams,
    settings: savedSettings,
  };
};

export const saveLocalLeagueState = (teams: Team[], settings: SimulationSettings): void => {
  localStorage.setItem(STORAGE_KEYS.teams, JSON.stringify(teams));
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
};

export const loadSupabaseLeagueState = async (): Promise<{
  teams: Team[] | null;
  settings: SimulationSettings | null;
}> => {
  if (!supabase) {
    return {
      teams: null,
      settings: null,
    };
  }

  const leagueId = await ensureLeague();

  const [{ data: teamRows, error: teamError }, { data: settingsRow, error: settingsError }] = await Promise.all([
    supabase
      .from('teams')
      .select(
        'team_id, city, name, league, division, rating, previous_baseline_wins, wins, losses, runs_scored, runs_allowed',
      )
      .eq('league_id', leagueId)
      .order('team_id', { ascending: true }),
    supabase
      .from('league_settings')
      .select('continuity_weight, win_loss_variance, home_field_advantage, game_luck_factor')
      .eq('league_id', leagueId)
      .maybeSingle(),
  ]);

  if (teamError) {
    throw teamError;
  }
  if (settingsError) {
    throw settingsError;
  }

  return {
    teams: teamRows && teamRows.length > 0 ? (teamRows as TeamRow[]).map(toTeam) : null,
    settings: settingsRow ? toSettings(settingsRow as SettingsRow) : null,
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

  const [{ error: teamInsertError }, { error: settingsInsertError }] = await Promise.all([
    supabase.from('teams').insert(teamRows),
    supabase.from('league_settings').insert(settingsRow),
  ]);

  if (teamInsertError) {
    throw teamInsertError;
  }
  if (settingsInsertError) {
    throw settingsInsertError;
  }
};

export const saveSupabaseLeagueState = async (teams: Team[], settings: SimulationSettings): Promise<void> => {
  if (!supabase) {
    return;
  }

  const leagueId = await ensureLeague();
  const teamRows = teams.map((team) => toTeamRow(team, leagueId));
  const settingsRow = toSettingsRow(settings, leagueId);

  const [{ error: teamsUpsertError }, { error: settingsUpsertError }] = await Promise.all([
    supabase.from('teams').upsert(teamRows, { onConflict: 'league_id,team_id' }),
    supabase.from('league_settings').upsert(settingsRow, { onConflict: 'league_id' }),
  ]);

  if (teamsUpsertError) {
    throw teamsUpsertError;
  }
  if (settingsUpsertError) {
    throw settingsUpsertError;
  }
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
    game_id: game.id,
    home_team_id: game.homeTeamId,
    away_team_id: game.awayTeamId,
    home_score: game.homeScore,
    away_score: game.awayScore,
    played: game.played,
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
