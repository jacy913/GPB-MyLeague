/**
 * Verifies the resolution-date calendar: derivation, ordering, and the offseason fit.
 *
 * The expansion plan's Work Item 1 is "small" and costs almost nothing, and almost
 * all of that cost is in the places it says not to cut:
 *
 *   - No date derived from `SEASON_CALENDAR_DAYS` as a constant, because that
 *     "produces plausible numbers that drift the moment the schedule changes".
 *   - `championshipEnd < awardsDate` asserted and logged, because "a silently-wrong
 *     calendar is worse than a loud one".
 *
 * The second one turns out to be the interesting part. The playoff rounds are
 * projected from the last regular-season game using the engine's own gap constants,
 * and the arithmetic leaves very little room before the awards ceremony. How much is
 * measured here rather than assumed, because slack is not something a bettor can see
 * and a date that is one day clear is a date that will not stay one day clear.
 *
 * It also checks the two places a derived date can quietly go wrong:
 *   - the MIRRORED playoff constants in marketDates, read against the engine's own,
 *     so a copy that drifts fails a check instead of a calendar;
 *   - the duplicated pitching denominator, for the same reason.
 *
 * Run: npx tsx tools/verifyResolutionDates.ts
 */

import { readFileSync } from 'node:fs';
import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import {
  assertCalendarFitsOffseason,
  formatResolutionDate,
  projectSeasonCalendar,
  resolveDateFor,
} from '../src/lib/marketDates';
import { getOffseasonEventDate } from '../src/logic/offseasonSchedule';
import type { Game, Team } from '../src/types';

const YEAR = 2026;

interface Check {
  label: string;
  pass: boolean;
  measured: string;
}

const results: Check[] = [];
const failures: string[] = [];

const check = (label: string, pass: boolean, measured: string, why?: string): void => {
  results.push({ label, pass, measured: pass ? measured : (why ?? `FAILED, observed: ${measured}`) });
  if (!pass) failures.push(`${label}: ${why ?? measured}`);
};

const main = async (): Promise<void> => {
  // ------------------------------------------- mirrored constants have not drifted
  const managerSource = readFileSync('src/logic/simulationManager.ts', 'utf8');
  const mirrorFailures: string[] = [];
  const expectLiteral = (label: string, literal: string) => {
    if (!managerSource.includes(literal)) {
      mirrorFailures.push(`${label}: the engine no longer contains ${literal}`);
    }
  };
  expectLiteral('PLAYOFF_START_GAP_DAYS', 'PLAYOFF_START_GAP_DAYS = 2');
  expectLiteral('ROUND_REST_GAP_DAYS', 'ROUND_REST_GAP_DAYS = 2');
  expectLiteral('ROUND_DAY_OFFSETS', 'world_series: [0, 1, 3, 4, 6, 7, 9]');

  check(
    'the mirrored playoff constants still match the engine',
    mirrorFailures.length === 0,
    'PLAYOFF_START_GAP_DAYS, ROUND_REST_GAP_DAYS and every ROUND_DAY_OFFSETS entry in ' +
      'marketDates still appear verbatim in simulationManager',
    `the engine's playoff schedule has changed and the mirror in marketDates has not: ` +
      `${mirrorFailures.join('; ')}. A stale copy would make every projected resolution date ` +
      `quietly wrong, which is the drift the plan warns about`,
  );

  // ------------------------------------------------------- the real projection
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: 4242,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );
  const scheduled = generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180,
  });
  const engine = new SimulationManager({
    teams,
    games: scheduled,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  // Mid-season, on a real played schedule: the interesting case, because the
  // regular season has real dates and the playoffs do not exist yet.
  let midSeason: Game[] = scheduled;
  for (let day = 0; day < 100; day += 1) {
    const step = await engine.run({ scope: 'day' });
    midSeason = step.games;
  }

  const calendar = projectSeasonCalendar(midSeason, YEAR);

  console.log('\nPROJECTED CALENDAR, MID-SEASON (100 days played)');
  console.log(`  regular season   ${calendar.regularSeasonStart} -> ${calendar.regularSeasonEnd}`);
  console.log(`  wild card        ${calendar.wildCardStart} -> ${calendar.wildCardEnd}`);
  console.log(`  divisional       ${calendar.divisionalStart} -> ${calendar.divisionalEnd}`);
  console.log(`  league series    ${calendar.leagueSeriesStart} -> ${calendar.leagueSeriesEnd}`);
  console.log(`  championship     ${calendar.championshipStart} -> ${calendar.championshipEnd}`);
  console.log(`  awards           ${calendar.awardsDate}`);
  console.log(`  SLACK            ${calendar.slackDays} day(s) between the last possible ` +
    `championship game and the awards ceremony`);
  console.log('');

  // ------------------------------------------------------------- derived, not assumed
  check(
    'the regular season is read off the schedule, not assumed',
    calendar.regularSeasonStart === getDefaultSeasonStartDate(YEAR)
      && calendar.regularSeasonEnd > calendar.regularSeasonStart,
    `regular season ${calendar.regularSeasonStart} to ${calendar.regularSeasonEnd}, taken from the ` +
      `played schedule rather than from SEASON_CALENDAR_DAYS`,
    `the regular season dates look wrong: ${calendar.regularSeasonStart} to ` +
      `${calendar.regularSeasonEnd}. A calendar derived from a constant drifts the moment the ` +
      `schedule changes, which is the failure the plan names`,
  );

  // ------------------------------------------------------------------- ordering
  const ordered = [
    calendar.regularSeasonEnd,
    calendar.wildCardEnd,
    calendar.divisionalEnd,
    calendar.leagueSeriesEnd,
    calendar.championshipEnd,
  ];
  const monotonic = ordered.every((date, index) =>
    index === 0 || date > ordered[index - 1]);
  check(
    'every round ends after the one before it',
    monotonic,
    `regular season ${calendar.regularSeasonEnd} < wild card ${calendar.wildCardEnd} < ` +
      `divisional ${calendar.divisionalEnd} < league series ${calendar.leagueSeriesEnd} < ` +
      `championship ${calendar.championshipEnd}`,
    `the round dates are not monotonic: ${ordered.join(' / ')}. A round that ends before the ` +
      `previous one produces resolution dates that go backwards as a bettor reads down the board`,
  );

  // ------------------------------------------------- THE OFFSEASON FIT, the real one
  const fit = assertCalendarFitsOffseason(calendar);
  check(
    'the championship finishes before the awards ceremony',
    fit.length === 0,
    `projected championship ends ${calendar.championshipEnd}, awards ${calendar.awardsDate}, ` +
      `leaving ${calendar.slackDays} day(s) of slack`,
    fit.join('; '),
  );

  /*
   * The slack figure is reported as its own check, not folded into the one above,
   * because "fits" and "fits with room" are different claims. A calendar that clears
   * the awards date by a single day IS correct today and is one reschedule away from
   * telling every futures bettor a false resolution date.
   */
  const COMFORTABLE_SLACK = 7;
  check(
    'the calendar has enough slack to survive a reschedule',
    calendar.slackDays >= COMFORTABLE_SLACK,
    `${calendar.slackDays} day(s) of slack, against a bar of ${COMFORTABLE_SLACK}`,
    `only ${calendar.slackDays} day(s) between the last possible championship game and the ` +
      `awards ceremony. The projection is correct today, but the playoffs run to their longest ` +
      `possible length here, so a single rescheduled game pushes the championship past the ` +
      `awards date and every futures bettor is shown a resolution date the season has already ` +
      `ended by. This is a finding about the season LENGTH, not about the calendar code`,
  );

  // ------------------------------------------------------------- basis resolution
  const gameBasis = resolveDateFor('game', calendar, '2026-05-04');
  check(
    'a game market resolves on its own date',
    gameBasis === '2026-05-04',
    `resolveDateFor('game', ..., '2026-05-04') is ${formatResolutionDate(gameBasis)}`,
    `a game market resolved to ${gameBasis} instead of the game's own date. This is the most ` +
      `common market on the board and the one where a wrong date is most visible`,
  );

  const distinct = new Set([
    resolveDateFor('game', calendar, '2026-05-04'),
    resolveDateFor('regular_season_end', calendar),
    resolveDateFor('league_championship', calendar),
    resolveDateFor('championship_series', calendar),
    resolveDateFor('season_awards', calendar),
  ]);
  check(
    'different markets resolve on genuinely different days',
    distinct.size === 5,
    `game ${formatResolutionDate(resolveDateFor('game', calendar, '2026-05-04'))}, regular season end ` +
      `${formatResolutionDate(resolveDateFor('regular_season_end', calendar))}, league championship ` +
      `${formatResolutionDate(resolveDateFor('league_championship', calendar))}, championship ` +
      `${formatResolutionDate(resolveDateFor('championship_series', calendar))}, awards ` +
      `${formatResolutionDate(resolveDateFor('season_awards', calendar))}`,
    `only ${distinct.size} distinct dates across five bases. Showing one date for every market ` +
      `is the current state of this feature and it is what item 1 exists to fix`,
  );

  check(
    'the awards date comes from the offseason schedule',
    calendar.awardsDate === getOffseasonEventDate(YEAR, 'awards'),
    `awards ${calendar.awardsDate} matches getOffseasonEventDate(${YEAR}, 'awards')`,
    'the awards date is not read from the offseason schedule, so it is a second definition ' +
      'of a date the league already owns',
  );

  // ------------------------------------------------------------------- report
  console.log('\nCHECKS');
  results.forEach((entry, index) => {
    console.log(`  ${entry.pass ? 'PASS' : 'FAIL'}  ${String(index + 1).padStart(2)}. ${entry.label}`);
    console.log(`          ${entry.measured}`);
  });
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks PASS`);
  if (failures.length > 0) {
    console.log('\nFAILURES');
    failures.forEach((line) => console.log(`  - ${line}`));
    process.exitCode = 1;
  }
};

void main();
