create extension if not exists pgcrypto;

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.league_settings (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  continuity_weight double precision not null,
  win_loss_variance integer not null,
  home_field_advantage double precision not null,
  game_luck_factor double precision not null,
  league_environment_balance double precision not null default 0.5,
  batting_variance_factor double precision not null default 0.5,
  updated_at timestamptz not null default now()
);

create table if not exists public.slider_presets (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  preset_name text not null,
  continuity_weight double precision not null,
  win_loss_variance double precision not null,
  home_field_advantage double precision not null,
  game_luck_factor double precision not null,
  league_environment_balance double precision not null default 0.5,
  batting_variance_factor double precision not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, preset_name)
);

create table if not exists public.teams (
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id text not null,
  city text not null,
  name text not null,
  league text not null check (league in ('Prestige', 'Platinum')),
  division text not null check (division in ('North', 'South', 'East', 'West')),
  rating double precision not null,
  previous_baseline_wins integer not null,
  wins integer not null default 0,
  losses integer not null default 0,
  runs_scored integer not null default 0,
  runs_allowed integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (league_id, team_id)
);

create table if not exists public.players (
  player_id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id text,
  first_name text not null,
  last_name text not null,
  player_type text not null check (player_type in ('batter', 'pitcher')),
  primary_position text not null,
  secondary_position text,
  bats text not null check (bats in ('L', 'R', 'S')),
  throws text not null check (throws in ('L', 'R')),
  age integer not null check (age >= 15 and age <= 60),
  height text not null default '6''0"',
  weight_lbs integer not null default 200 check (weight_lbs between 120 and 400),
  potential double precision not null check (potential >= 0 and potential <= 1),
  status text not null check (status in ('active', 'free_agent', 'prospect', 'retired')),
  contract_years_left integer not null default 0 check (contract_years_left between 0 and 5),
  draft_class_year integer,
  draft_round integer,
  years_pro integer not null default 0 check (years_pro >= 0),
  retirement_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint players_team_fk
    foreign key (league_id, team_id)
    references public.teams(league_id, team_id)
    on delete set null,
  constraint players_pitcher_position_check
    check (
      player_type <> 'pitcher'
      or (
        primary_position in ('SP', 'RP', 'CL')
        and (secondary_position is null or secondary_position in ('SP', 'RP', 'CL'))
      )
    ),
  constraint players_batter_position_check
    check (
      player_type <> 'batter'
      or (
        primary_position in ('C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH')
        and (secondary_position is null or secondary_position in ('C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'))
      )
    ),
  constraint players_retirement_check
    check (
      (status = 'retired' and retirement_year is not null)
      or (status <> 'retired' and retirement_year is null)
    ),
  constraint players_draft_round_check
    check (draft_round is null or draft_round > 0),
  constraint players_secondary_position_check
    check (secondary_position is null or secondary_position <> primary_position)
);

alter table if exists public.players
  add column if not exists height text not null default '6''0"';

alter table if exists public.players
  add column if not exists weight_lbs integer not null default 200;

alter table if exists public.players
  add column if not exists contract_years_left integer not null default 0;

create table if not exists public.player_season_batting (
  stat_id bigint generated always as identity primary key,
  player_id uuid not null references public.players(player_id) on delete cascade,
  season_year integer not null,
  season_phase text not null default 'regular_season' check (season_phase in ('regular_season', 'playoffs')),
  games_played integer not null default 0 check (games_played >= 0),
  plate_appearances integer not null default 0 check (plate_appearances >= 0),
  at_bats integer not null default 0 check (at_bats >= 0),
  runs_scored integer not null default 0 check (runs_scored >= 0),
  hits integer not null default 0 check (hits >= 0),
  doubles integer not null default 0 check (doubles >= 0),
  triples integer not null default 0 check (triples >= 0),
  home_runs integer not null default 0 check (home_runs >= 0),
  walks integer not null default 0 check (walks >= 0),
  strikeouts integer not null default 0 check (strikeouts >= 0),
  rbi integer not null default 0 check (rbi >= 0),
  avg double precision not null default 0 check (avg >= 0),
  ops double precision not null default 0 check (ops >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, season_year, season_phase)
);

create table if not exists public.player_season_pitching (
  stat_id bigint generated always as identity primary key,
  player_id uuid not null references public.players(player_id) on delete cascade,
  season_year integer not null,
  season_phase text not null default 'regular_season' check (season_phase in ('regular_season', 'playoffs')),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  saves integer not null default 0 check (saves >= 0),
  games integer not null default 0 check (games >= 0),
  games_started integer not null default 0 check (games_started >= 0),
  innings_pitched double precision not null default 0 check (innings_pitched >= 0),
  hits_allowed integer not null default 0 check (hits_allowed >= 0),
  earned_runs integer not null default 0 check (earned_runs >= 0),
  walks integer not null default 0 check (walks >= 0),
  strikeouts integer not null default 0 check (strikeouts >= 0),
  era double precision not null default 0 check (era >= 0),
  whip double precision not null default 0 check (whip >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, season_year, season_phase)
);

create table if not exists public.player_batting_ratings (
  rating_id bigint generated always as identity primary key,
  player_id uuid not null references public.players(player_id) on delete cascade,
  season_year integer not null,
  contact integer not null check (contact between 60 and 100),
  power integer not null check (power between 60 and 100),
  plate_discipline integer not null check (plate_discipline between 60 and 100),
  avoid_strikeout integer not null check (avoid_strikeout between 60 and 100),
  speed integer not null check (speed between 60 and 100),
  baserunning integer not null check (baserunning between 60 and 100),
  fielding integer not null check (fielding between 60 and 100),
  arm integer not null check (arm between 60 and 100),
  overall integer not null check (overall between 60 and 100),
  potential_overall integer not null check (potential_overall between 60 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, season_year)
);
 
create table if not exists public.player_pitching_ratings (
  rating_id bigint generated always as identity primary key,
  player_id uuid not null references public.players(player_id) on delete cascade,
  season_year integer not null,
  stuff integer not null check (stuff between 60 and 100),
  command integer not null check (command between 60 and 100),
  control integer not null check (control between 60 and 100),
  movement integer not null check (movement between 60 and 100),
  stamina integer not null check (stamina between 60 and 100),
  hold_runners integer not null check (hold_runners between 60 and 100),
  fielding integer not null check (fielding between 60 and 100),
  overall integer not null check (overall between 60 and 100),
  potential_overall integer not null check (potential_overall between 60 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, season_year)
);

create table if not exists public.team_roster_slots (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  season_year integer not null,
  team_id text not null,
  slot_code text not null check (slot_code in ('C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP1', 'SP2', 'SP3', 'SP4', 'SP5', 'RP1', 'RP2', 'RP3', 'RP4', 'CL', 'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6', 'BN7', 'BN8', 'BN9', 'BN10')),
  player_id uuid not null references public.players(player_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_roster_slots_team_fk
    foreign key (league_id, team_id)
    references public.teams(league_id, team_id)
    on delete cascade,
  unique (league_id, season_year, team_id, slot_code),
  unique (league_id, season_year, player_id)
);

create table if not exists public.player_transactions (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id uuid not null references public.players(player_id) on delete cascade,
  event_type text not null check (event_type in ('drafted', 'signed', 'released', 'promoted', 'demoted', 'traded', 'retired')),
  from_team_id text,
  to_team_id text,
  effective_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint player_transactions_from_team_fk
    foreign key (league_id, from_team_id)
    references public.teams(league_id, team_id)
    on delete set null,
  constraint player_transactions_to_team_fk
    foreign key (league_id, to_team_id)
    references public.teams(league_id, team_id)
    on delete set null
);

create table if not exists public.league_state (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  current_sim_date date,
  progress double precision not null default 0,
  season_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.league_games (
  league_id uuid not null references public.leagues(id) on delete cascade,
  game_id text not null,
  game_date date not null,
  home_team_id text not null,
  away_team_id text not null,
  phase text not null check (phase in ('regular_season', 'playoffs')),
  status text not null check (status in ('scheduled', 'completed')),
  home_score integer not null default 0,
  away_score integer not null default 0,
  playoff jsonb,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (league_id, game_id)
);

create table if not exists public.season_runs (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  season_label text not null,
  completed_at timestamptz not null default now(),
  settings_snapshot jsonb not null,
  team_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.season_games (
  season_run_id bigint not null references public.season_runs(id) on delete cascade,
  game_id text not null,
  home_team_id text not null,
  away_team_id text not null,
  home_score integer not null,
  away_score integer not null,
  played boolean not null,
  game_date date,
  status text check (status in ('scheduled', 'completed')),
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (season_run_id, game_id)
);

alter table public.season_games
  add column if not exists game_date date;

alter table public.season_games
  add column if not exists status text check (status in ('scheduled', 'completed'));

alter table public.season_games
  add column if not exists stats jsonb not null default '{}'::jsonb;

alter table public.league_settings
  add column if not exists league_environment_balance double precision not null default 0.5;

alter table public.league_settings
  add column if not exists batting_variance_factor double precision not null default 0.5;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select table_name, constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and constraint_type = 'CHECK'
      and table_name in ('player_batting_ratings', 'player_pitching_ratings')
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      constraint_record.table_name,
      constraint_record.constraint_name
    );
  end loop;
end $$;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select constraint_name
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'team_roster_slots'
      and constraint_type = 'CHECK'
  loop
    execute format('alter table public.team_roster_slots drop constraint if exists %I', constraint_record.constraint_name);
  end loop;
end $$;

alter table public.player_batting_ratings
  add constraint player_batting_ratings_contact_range check (contact between 60 and 100),
  add constraint player_batting_ratings_power_range check (power between 60 and 100),
  add constraint player_batting_ratings_plate_discipline_range check (plate_discipline between 60 and 100),
  add constraint player_batting_ratings_avoid_strikeout_range check (avoid_strikeout between 60 and 100),
  add constraint player_batting_ratings_speed_range check (speed between 60 and 100),
  add constraint player_batting_ratings_baserunning_range check (baserunning between 60 and 100),
  add constraint player_batting_ratings_fielding_range check (fielding between 60 and 100),
  add constraint player_batting_ratings_arm_range check (arm between 60 and 100),
  add constraint player_batting_ratings_overall_range check (overall between 60 and 100),
  add constraint player_batting_ratings_potential_overall_range check (potential_overall between 60 and 100);

alter table public.player_pitching_ratings
  add constraint player_pitching_ratings_stuff_range check (stuff between 60 and 100),
  add constraint player_pitching_ratings_command_range check (command between 60 and 100),
  add constraint player_pitching_ratings_control_range check (control between 60 and 100),
  add constraint player_pitching_ratings_movement_range check (movement between 60 and 100),
  add constraint player_pitching_ratings_stamina_range check (stamina between 60 and 100),
  add constraint player_pitching_ratings_hold_runners_range check (hold_runners between 60 and 100),
  add constraint player_pitching_ratings_fielding_range check (fielding between 60 and 100),
  add constraint player_pitching_ratings_overall_range check (overall between 60 and 100),
  add constraint player_pitching_ratings_potential_overall_range check (potential_overall between 60 and 100);

alter table public.team_roster_slots
  add constraint team_roster_slots_slot_code_check check (
    slot_code in ('C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'SP1', 'SP2', 'SP3', 'SP4', 'SP5', 'RP1', 'RP2', 'RP3', 'RP4', 'CL', 'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6', 'BN7', 'BN8', 'BN9', 'BN10')
  );

create index if not exists season_runs_league_id_idx on public.season_runs(league_id);
create index if not exists season_games_season_run_id_idx on public.season_games(season_run_id);
create index if not exists teams_league_id_idx on public.teams(league_id);
create index if not exists players_league_team_idx on public.players(league_id, team_id);
create index if not exists players_status_idx on public.players(status);
create index if not exists batting_player_season_idx on public.player_season_batting(player_id, season_year, season_phase);
create index if not exists pitching_player_season_idx on public.player_season_pitching(player_id, season_year, season_phase);
create index if not exists batting_ratings_player_season_idx on public.player_batting_ratings(player_id, season_year);
create index if not exists pitching_ratings_player_season_idx on public.player_pitching_ratings(player_id, season_year);
create index if not exists roster_slots_team_season_idx on public.team_roster_slots(league_id, season_year, team_id);
create index if not exists player_transactions_player_idx on public.player_transactions(player_id, effective_date);
create index if not exists league_games_league_id_idx on public.league_games(league_id);
create index if not exists league_games_league_date_idx on public.league_games(league_id, game_date);
create index if not exists slider_presets_league_id_idx on public.slider_presets(league_id);

alter table public.leagues enable row level security;
alter table public.league_settings enable row level security;
alter table public.slider_presets enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.player_season_batting enable row level security;
alter table public.player_season_pitching enable row level security;
alter table public.player_batting_ratings enable row level security;
alter table public.player_pitching_ratings enable row level security;
alter table public.team_roster_slots enable row level security;
alter table public.player_transactions enable row level security;
alter table public.league_state enable row level security;
alter table public.league_games enable row level security;
alter table public.season_runs enable row level security;
alter table public.season_games enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'leagues' and policyname = 'allow_anon_all_leagues') then
    create policy allow_anon_all_leagues on public.leagues for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'league_settings' and policyname = 'allow_anon_all_league_settings') then
    create policy allow_anon_all_league_settings on public.league_settings for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'slider_presets' and policyname = 'allow_anon_all_slider_presets') then
    create policy allow_anon_all_slider_presets on public.slider_presets for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'teams' and policyname = 'allow_anon_all_teams') then
    create policy allow_anon_all_teams on public.teams for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'players' and policyname = 'allow_anon_all_players') then
    create policy allow_anon_all_players on public.players for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'player_season_batting' and policyname = 'allow_anon_all_player_season_batting') then
    create policy allow_anon_all_player_season_batting on public.player_season_batting for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'player_season_pitching' and policyname = 'allow_anon_all_player_season_pitching') then
    create policy allow_anon_all_player_season_pitching on public.player_season_pitching for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'player_batting_ratings' and policyname = 'allow_anon_all_player_batting_ratings') then
    create policy allow_anon_all_player_batting_ratings on public.player_batting_ratings for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'player_pitching_ratings' and policyname = 'allow_anon_all_player_pitching_ratings') then
    create policy allow_anon_all_player_pitching_ratings on public.player_pitching_ratings for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'team_roster_slots' and policyname = 'allow_anon_all_team_roster_slots') then
    create policy allow_anon_all_team_roster_slots on public.team_roster_slots for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'player_transactions' and policyname = 'allow_anon_all_player_transactions') then
    create policy allow_anon_all_player_transactions on public.player_transactions for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'league_state' and policyname = 'allow_anon_all_league_state') then
    create policy allow_anon_all_league_state on public.league_state for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'league_games' and policyname = 'allow_anon_all_league_games') then
    create policy allow_anon_all_league_games on public.league_games for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'season_runs' and policyname = 'allow_anon_all_season_runs') then
    create policy allow_anon_all_season_runs on public.season_runs for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'season_games' and policyname = 'allow_anon_all_season_games') then
    create policy allow_anon_all_season_games on public.season_games for all to anon using (true) with check (true);
  end if;
end $$;
