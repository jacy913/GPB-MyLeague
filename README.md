# Grand League Baseball Simulator

React + TypeScript simulator for a 32-team MyLeague-style baseball universe.

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env.local` and set:
   ```env
   VITE_SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co"
   VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
   ```
3. Run the app:
   ```bash
   npm run dev
   ```

If Supabase env vars are missing, the app falls back to local storage.

## Supabase Setup

1. Create a new Supabase project.
2. Open `SQL Editor` in Supabase.
3. Run the schema from [`supabase/schema.sql`](supabase/schema.sql).
4. Copy your Project URL + anon public key into `.env.local`.

The app will auto-seed initial league data on first run, then persist:
- `teams` and `league_settings` as the current universe state
- `season_runs` and `season_games` after each completed simulation

## Notes

- Current RLS policies in `supabase/schema.sql` allow anon read/write for quick setup.
- For production, move to authenticated users and tighten policies per user/league.
