/*
  THE PLAYER STATE MUST FIT, AND THE SAVE MUST NOT BE ABLE TO SAVE HALF A LEAGUE.

  Reported alongside the archive bug: the app crashes or reloads around the postseason, and afterwards
  "it is like their stats go away".

  THE CAUSE WAS NOT A CRASH. IT WAS A SAVE THAT PARTLY SUCCEEDED.

  `saveLocalPlayerState` wrote seven localStorage keys back to back with no guard. localStorage grants a
  fixed per-origin quota and throws when it is passed, so the throw landed somewhere in the middle of that
  sequence: the keys before it held this season, the keys after it still held last season's, and the next
  load assembled a league out of both. That is worse than the quota error it stands in for -- a save that
  fails loudly can be retried, and one that succeeds while corrupting cannot be detected.

  AND THE QUOTA WAS CROSSED AROUND THE THIRD SEASON

  Player stat rows are retained for every season, which is correct -- the archive recomputes a missing MVP
  from them -- but they are the bulk of the payload and they grow without bound. Measured here over
  simulated seasons, as stored (UTF-16, so two bytes per character):

      season 2026   2.97 MB    59%
      season 2027   3.75 MB    75%
      season 2028   4.54 MB    91%
      season 2029   5.33 MB   107%   <- the save starts throwing

  The ladder exists so a league past that line degrades by losing HISTORY rather than by tearing. This
  file asserts what it is allowed to lose, and -- just as importantly -- what it may never lose: the
  ratings. An earlier draft of the ladder dropped stat rows without checking what else it was carrying, and
  dropping the ratings would have emptied the award archive again for a reason with nothing to do with the
  archive's own bug.
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { resetPlayerSeasonStats } from '../src/logic/playerStats';
import {
  measurePlayerStatePayload,
  playerStateFallbackLadder,
  prunePlayerStatsToRecentSeasons,
  retainedStatSeasonYears,
  PLAYER_STATS_FALLBACK_SEASONS,
} from '../src/lib/playerStateBudget';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import type { LeaguePlayerState, Team } from '../src/types';

const SEED = 4242;
const FIRST = 2026;
const SEASONS = 6;
const BUDGET = 5 * 1024 * 1024;

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

const main = async () => {
  console.log(`\nPLAYER STATE SAVE BUDGET   (quota ${mb(BUDGET)})\n`);

  let state: LeaguePlayerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: FIRST,
    seed: SEED,
    effectiveDate: `${FIRST}-12-15`,
  }).playerState;

  const freshTeams = (teams: Team[], s: LeaguePlayerState, year: number): Team[] =>
    recalculateTeamRatingsFromRosters(
      teams.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      s,
      year,
    );

  let teams = freshTeams(INITIAL_TEAMS.map((t) => ({ ...t })), state, FIRST);

  const perSeason: Array<{ year: number; full: number; trimmed: number }> = [];

  for (let i = 0; i < SEASONS; i += 1) {
    const year = FIRST + i;
    const manager = new SimulationManager({
      teams,
      games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 200 }),
      playerState: state,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });
    let latest = await manager.run({ scope: 'day' });
    for (let d = 0; d < 215; d += 1) latest = await manager.run({ scope: 'day' });
    state = latest.playerState;
    teams = latest.teams;

    const full = measurePlayerStatePayload(state).totalBytes;
    const trimmed = measurePlayerStatePayload(prunePlayerStatsToRecentSeasons(state)).totalBytes;
    perSeason.push({ year, full, trimmed });

    console.log(`  season ${year}: full ${mb(full).padStart(8)} (${((full / BUDGET) * 100).toFixed(0).padStart(3)}% of quota)`
      + `   trimmed-to-${PLAYER_STATS_FALLBACK_SEASONS} ${mb(trimmed)}`);

    if (i < SEASONS - 1) {
      const next = year + 1;
      state = resetPlayerSeasonStats(state, next);
      teams = freshTeams(teams, state, next);
    }
  }

  console.log('');

  // -- 1. THE GROWTH IS REAL AND IT CROSSES THE LINE ---------------------------------------------
  const crossedAt = perSeason.find((s) => s.full > BUDGET);
  check(
    'the unbounded growth is real, and this league really does cross the quota',
    crossedAt !== undefined,
    crossedAt
      ? `the complete save exceeds ${mb(BUDGET)} by season ${crossedAt.year} (${mb(crossedAt.full)}). Without a`
        + ' fallback the save throws partway through seven writes and the next load is half of each.'
      : `the complete save never exceeded the quota across ${SEASONS} seasons, so this check cannot tell`
        + ' whether the fallback works',
  );

  // -- 2. AND THE FALLBACK BRINGS IT BACK UNDER -------------------------------------------------
  const overflow = perSeason.filter((s) => s.full > BUDGET);
  const recovered = overflow.every((s) => s.trimmed < BUDGET);
  check(
    'and the fallback brings the save back inside the quota',
    recovered && overflow.length > 0,
    overflow.length === 0
      ? 'no season overflowed, so nothing to recover from'
      : `every overflowing season (${overflow.map((s) => s.year).join(', ')}) trims to under ${mb(BUDGET)}`
        + `, the largest at ${mb(Math.max(...overflow.map((s) => s.trimmed)))}`,
  );

  // -- 3. THE LADDER ONLY LOSES HISTORY, NEVER THE ROSTER ----------------------------------------
  /*
    This is the one that matters most. A rung that quietly dropped the ratings would empty the season
    archive -- the bug this commit sits beside -- and would do it while looking like a successful save.
  */
  const ladder = playerStateFallbackLadder(state);
  const rungsDropRoster = ladder.filter((rung) =>
    rung.state.players.length !== state.players.length
    || rung.state.battingRatings.length !== state.battingRatings.length
    || rung.state.pitchingRatings.length !== state.pitchingRatings.length
    || rung.state.rosterSlots.length !== state.rosterSlots.length);
  check(
    'every rung of the ladder preserves the players, the ratings and the roster slots',
    rungsDropRoster.length === 0,
    `${ladder.length} rungs (${ladder.map((r) => r.label).join(' | ')}), none of which drops any of them.`
    + ' The archive is computed from the ratings, so losing them here would reproduce the null-MVP bug',
  );

  // -- 4. AND THE TRIMMED RUNG KEEPS THE SEASON THAT STILL MATTERS -------------------------------
  const trimmed = prunePlayerStatsToRecentSeasons(state);
  const kept = retainedStatSeasonYears(trimmed);
  const newest = Math.max(...kept);
  const newestSeasonSurvives = state.battingStats.some((s) => s.seasonYear === newest)
    && trimmed.battingStats.some((s) => s.seasonYear === newest);
  const previousSurvives = kept.length >= 2;
  check(
    'and the trimmed rung keeps the season in progress and the one that just finished',
    newestSeasonSurvives && previousSurvives,
    `kept ${kept.join(', ')} of ${[...new Set(state.battingStats.map((s) => s.seasonYear))].sort().join(', ')}.`
    + ' The second-newest is the season the archive writes and the repair path recomputes from, so dropping'
    + ' it would make an incomplete archive permanently unrecoverable',
  );

  // -- 5. AND PRUNING IS IDEMPOTENT AND DOES NO WORK WHEN THERE IS NOTHING TO DROP ---------------
  const twice = prunePlayerStatsToRecentSeasons(prunePlayerStatsToRecentSeasons(state));
  const idempotent = twice.battingStats.length === trimmed.battingStats.length
    && twice.pitchingStats.length === trimmed.pitchingStats.length;
  const noOpReturnsSameObject = prunePlayerStatsToRecentSeasons(trimmed) === trimmed;
  check(
    'and pruning is idempotent, and does no copy when there is nothing older to drop',
    idempotent && noOpReturnsSameObject,
    idempotent && noOpReturnsSameObject
      ? 'pruning twice equals pruning once, and a second pass returns the very same object rather than a copy'
      : 'pruning is not stable across repeated calls',
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  a long league gives up history before it gives up the roster, and never half of either.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });