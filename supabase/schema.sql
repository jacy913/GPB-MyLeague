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
  updated_at timestamptz not null default now()
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
  created_at timestamptz not null default now(),
  primary key (season_run_id, game_id)
);

create index if not exists season_runs_league_id_idx on public.season_runs(league_id);
create index if not exists season_games_season_run_id_idx on public.season_games(season_run_id);
create index if not exists teams_league_id_idx on public.teams(league_id);

alter table public.leagues enable row level security;
alter table public.league_settings enable row level security;
alter table public.teams enable row level security;
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

  if not exists (select 1 from pg_policies where tablename = 'teams' and policyname = 'allow_anon_all_teams') then
    create policy allow_anon_all_teams on public.teams for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'season_runs' and policyname = 'allow_anon_all_season_runs') then
    create policy allow_anon_all_season_runs on public.season_runs for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'season_games' and policyname = 'allow_anon_all_season_games') then
    create policy allow_anon_all_season_games on public.season_games for all to anon using (true) with check (true);
  end if;
end $$;
