/*
  THE SEASON ARCHIVE MUST FIND ITS MVPs IN EVERY SEASON, NOT JUST THE FIRST.

  Reported: simulating the playoffs crashes or reloads the app, and afterwards both MVP races come back
  with "No eligible candidates" -- while the World Series MVP, read out of the stored play logs,
  resolves perfectly. The report was against season 2028, the third season of a league.

  THE BUG WAS A YEAR FILTER ON A THING THAT IS NOT RE-STAMPED

  `computeBattingMvpCandidates` / `computePitchingMvpCandidates` in App.tsx asked
  `rating.seasonYear === seasonYear`. Player ratings are written when a PLAYER IS CREATED -- the initial
  universe, a draft pick, a rookie promoted into a gap -- and nothing re-stamps them when the calendar
  rolls over. Stats are different: `resetPlayerSeasonStats` gives every non-retired player a fresh row
  for each new season. So the strict equality matched almost nobody past the league's first season: it
  returned that season's rookies, who have no at-bats, and the archive wrote two nulls.

  It could never have looked like a year bug on a fresh league, which is exactly why it survived: in the
  first season every rating was created that season, so the strict filter and the correct one agree.
  A three-season run is the minimum that can tell them apart.

  WHY IT WAS NOT MERELY COSMETIC

  A null MVP is not just a blank line. The archive refuses to write an entry without both MVPs, so the
  season never reaches the history; the awards checklist step is measured off that archive, so it never
  completes; and an MVP bet has nothing to settle against. One filter, and a finished league could not
  be closed out.
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import {
  getBattingRatingsAsOfSeason,
  getPitchingRatingsAsOfSeason,
  resetPlayerSeasonStats,
} from '../src/logic/playerStats';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildAwardsForBoard, type AwardInputs } from '../src/lib/awardRace';
import type { LeaguePlayerState, PlayerBattingRatings, Team } from '../src/types';

const SEED = 4242;
const FIRST = 2026;
const SEASONS = 3;

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

/** Exactly what App.tsx builds for the archive. */
const archiveInputs = (
  teams: Team[],
  state: LeaguePlayerState,
  seasonYear: number,
): AwardInputs => ({
  players: state.players,
  teamsById: new Map(teams.map((t) => [t.id, t] as const)),
  battingStats: new Map(
    state.battingStats
      .filter((s) => s.seasonYear === seasonYear && s.seasonPhase === 'regular_season')
      .map((s) => [s.playerId, s] as const),
  ),
  pitchingStats: new Map(
    state.pitchingStats
      .filter((s) => s.seasonYear === seasonYear && s.seasonPhase === 'regular_season')
      .map((s) => [s.playerId, s] as const),
  ),
  battingRatings: getBattingRatingsAsOfSeason(state.battingRatings, seasonYear),
  pitchingRatings: getPitchingRatingsAsOfSeason(state.pitchingRatings, seasonYear),
});

/** The filter this check exists to replace. Kept so the guard can assert the old rule fails. */
const strictYearRatings = <T extends { playerId: string; seasonYear: number }>(
  ratings: T[],
  seasonYear: number,
): Map<string, T> => new Map(
  ratings.filter((r) => r.seasonYear === seasonYear).map((r) => [r.playerId, r] as const),
);

const main = async () => {
  console.log('\nSEASON ARCHIVE MVPs -- every season, not just the first\n');

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
  const seasonResults: Array<{ year: number; batting: number; pitching: number; strictHit: number }> = [];

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

    const inputs = archiveInputs(teams, state, year);
    const batting = buildAwardsForBoard('batting', inputs, 10);
    const pitching = buildAwardsForBoard('pitching', inputs, 10);
    const strict = strictYearRatings(state.battingRatings as PlayerBattingRatings[], year).size;

    seasonResults.push({ year, batting: batting.length, pitching: pitching.length, strictHit: strict });
    console.log(`  season ${year}: batting ${batting.length}, pitching ${pitching.length}`
      + `${batting[0] ? `, winner ${batting[0].name} (${batting[0].team?.city ?? 'NO TEAM'})` : '   <-- EMPTY'}`);
    console.log(`      ratings the old strict filter would have found for ${year}: ${strict}`);

    if (i < SEASONS - 1) {
      const next = year + 1;
      state = resetPlayerSeasonStats(state, next);
      teams = freshTeams(teams, state, next);
    }
  }

  console.log('');

  // -- 1. EVERY SEASON PRODUCES BOTH WINNERS ---------------------------------------------------
  const empty = seasonResults.filter((r) => r.batting === 0 || r.pitching === 0);
  check(
    'every season archives both an MVP',
    empty.length === 0,
    empty.length === 0
      ? `${SEASONS} seasons simulated through to the postseason, both races ranked in all of them`
      : `no candidates in: ${empty.map((r) => `${r.year} (batting ${r.batting}, pitching ${r.pitching})`).join(', ')}`,
  );

  // -- 2. AND THE GUARD WOULD HAVE CAUGHT THE REPORTED BUG --------------------------------------
  // If the strict filter also worked every season, this file could not tell right from wrong.
  const laterSeasons = seasonResults.slice(1);
  const strictWouldHaveFailed = laterSeasons.some((r) => r.strictHit === 0);
  check(
    'and this check can tell the old rule from the fixed one',
    strictWouldHaveFailed,
    strictWouldHaveFailed
      ? `the strict filter matched ${laterSeasons.map((r) => `${r.strictHit} rating(s) in ${r.year}`).join(', ')} -- `
        + 'empty in a later season, which is the reported failure. A check that could not tell the two '
        + 'apart would have passed the bug it was written for.'
      : 'the strict filter matched somebody in every season, so this file cannot detect the regression it exists for',
  );

  // -- 3. NO FUTURE LEAKAGE INTO A FINISHED SEASON ---------------------------------------------
  /*
    Reading the plain NEWEST rating instead would also fill the archive, and it would be wrong: it
    scores a finished season with an ability number written during a LATER offseason. That can change
    the winner retroactively, and it means the archive disagrees with what the betting board priced,
    which was standing on the numbers as they stood.
  */
  const ratings = state.battingRatings;
  const futureForFirstSeason = ratings.filter((r) => r.seasonYear > FIRST);
  const asOfFirst = getBattingRatingsAsOfSeason(ratings, FIRST);
  const leaked = futureForFirstSeason.filter((r) => asOfFirst.get(r.playerId) === r);
  check(
    'a finished season is never scored with a later season\'s rating',
    leaked.length === 0,
    `${futureForFirstSeason.length} rating rows are from seasons after ${FIRST}; none of them may be the`
    + ` row used to score that season. ${leaked.length === 0 ? 'None were.' : `${leaked.length} leaked.`}`,
  );

  // -- 4. AND AN ARCHIVED WINNER ALWAYS HAS A CLUB ---------------------------------------------
  const last = seasonResults[seasonResults.length - 1];
  const finalInputs = archiveInputs(teams, state, last.year);
  const finalBatting = buildAwardsForBoard('batting', finalInputs, 10);
  const clubless = finalBatting.filter((e) => !e.team);
  check(
    'and an archived MVP always belongs to a club',
    clubless.length === 0,
    `${finalBatting.length} candidates in the final season, ${clubless.length} without a club. The archive`
    + ' writes `entry.team?.id ?? null`, so a clubless winner would be recorded as an MVP belonging to nobody',
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  a season that finishes can always be closed out.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });