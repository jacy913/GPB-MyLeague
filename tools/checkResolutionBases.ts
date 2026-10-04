/**
 * Does every futures kind advertise the date it is ACTUALLY decided on?
 *
 * ============================================================================
 * THE BUG
 * ============================================================================
 *
 * `FieldMarketCard` resolved every non-award market on `championship_series`:
 *
 *     resolveDateFor(market.kind === 'award' ? 'season_awards' : 'championship_series', calendar)
 *
 * So one branch handled awards and the other three kinds were all sent to the World Series date. A
 * division race advertised the end of October for something decided on the last day of the regular
 * season, and a league race advertised it for a championship series that finishes a fortnight
 * earlier. The user spotted it on a league bet.
 *
 * A bet stores the date the card advertised, so this was not only a caption: an open bet carried a
 * settlement date weeks after the race it was on had already finished.
 *
 * ============================================================================
 * WHY THE SOURCE IS READ RATHER THAN THE RENDERED CARD
 * ============================================================================
 *
 * Because the failure is a mapping, and a mapping is only observable through the map. Rendering the
 * board and reading the header text would work, but it would need a board in a state where a
 * division and a league are on screen together, which the harness cannot reach.
 *
 * Reading the table also pins the thing that made this bug possible in the first place: it is a
 * TOTAL map over `MarketKind`, so a sixth kind cannot be added without answering "when do we know?".
 * That is the durable property; the dates themselves are easy to eyeball.
 *
 * Run: npx tsx tools/checkResolutionBases.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveDateFor, projectSeasonCalendar, assertCalendarFitsOffseason, type ResolutionBasis,
} from '../src/lib/marketDates';
import type { MarketKind } from '../src/lib/markets';
import type { Game } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const source = readFileSync(join(process.cwd(), 'src', 'components', 'betting', 'BettingHub.tsx'), 'utf8');

/** The table, recovered from source so the assertions are about what ships. */
const tableSource = source.slice(
  source.indexOf('const FUTURES_RESOLUTION_BASIS'),
  source.indexOf('};', source.indexOf('const FUTURES_RESOLUTION_BASIS')) + 2,
);
const BASIS: Partial<Record<MarketKind, ResolutionBasis>> = {};
for (const match of tableSource.matchAll(/(\w+):\s*'(\w+)'/g)) {
  BASIS[match[1] as MarketKind] = match[2] as ResolutionBasis;
}

console.log('\nTHE TABLE IS TOTAL OVER MarketKind');
{
  const KINDS: MarketKind[] = ['moneyline', 'division', 'league', 'world_series', 'award'];
  check('every kind has an entry', KINDS.every((kind) => BASIS[kind] !== undefined),
    `got ${JSON.stringify(BASIS)}`);
  check('the type annotation is Record<MarketKind, ...>, not Partial',
    /Record<MarketKind,\s*ResolutionBasis>/.test(tableSource),
    'a Partial map is a silent default waiting to happen');
  check('the old ternary is gone from the call site',
    !/resolveDateFor\(\s*\n?\s*market\.kind === 'award'/.test(source),
    "kind === 'award' ? 'season_awards' : 'championship_series' sent every other kind to the World Series");
  check('and the call site reads the table', source.includes('FUTURES_RESOLUTION_BASIS[market.kind]'));
}

console.log('\nEACH KIND GETS ITS OWN BASIS');
{
  check("a DIVISION resolves at the end of the regular season", BASIS.division === 'regular_season_end',
    `got ${BASIS.division}`);
  check('a LEAGUE resolves when its championship series ends', BASIS.league === 'league_championship',
    `got ${BASIS.league}`);
  check('the TITLE resolves when the World Series ends', BASIS.world_series === 'championship_series',
    `got ${BASIS.world_series}`);
  check('an AWARD resolves on the awards date', BASIS.award === 'season_awards', `got ${BASIS.award}`);
}

console.log('\nTHE FOUR DATES ARE ACTUALLY DIFFERENT');
{
  /*
   * A mapping is only a fix if the outputs differ. If `regular_season_end` and
   * `leagueSeriesEnd` happened to be the same day in this calendar, the table would be correct and
   * the board would still lie, so the calendar itself has to be asked.
   */
  /*
   * The calendar PROJECTS from played games, so it needs a schedule:
   * `projectSeasonCalendar([])` returns empty strings and every comparison below becomes NaN. A
   * short synthetic regular season is enough, and is more honest than an empty one because it is
   * the shape the real function actually reads.
   */
  const gamesAt = (dates: string[]) => dates.map((date, index) => ({
    date,
    status: 'completed',
    phase: 'regular_season',
    homeTeam: `h${index}`,
    awayTeam: `a${index}`,
  })) as unknown as Game[];

  const calendar = projectSeasonCalendar(gamesAt([
    '2026-04-01', '2026-05-01', '2026-06-01', '2026-06-15', '2026-06-22', '2026-06-30',
  ]), 2026);

  /*
   * The fixture is anchored to the app's OWN validity rule rather than to a date I picked.
   *
   * A first attempt ended the synthetic season on 09/28, which projected the World Series onto the
   * awards date -- and `assertCalendarFitsOffseason` calls exactly that a problem, because every
   * futures bet would be advertised with a resolution date the season has already ended by. The
   * ordering assertions below all passed on that broken calendar, which is a good reminder that
   * "these dates are in order" is not the same claim as "these dates are possible".
   *
   * So the fixture is now required to produce a calendar the app accepts, and the check below fails
   * if it ever stops doing so.
   */
  check('the fixture produces a calendar the app considers valid',
    assertCalendarFitsOffseason(calendar).length === 0,
    assertCalendarFitsOffseason(calendar).join('; ') || 'valid');

  const regularEnd = resolveDateFor('regular_season_end', calendar);
  const leagueEnd = resolveDateFor('league_championship', calendar);
  const championshipEnd = resolveDateFor('championship_series', calendar);
  const awardsDate = resolveDateFor('season_awards', calendar);

  check('the calendar carries all four milestones',
    [regularEnd, leagueEnd, championshipEnd, awardsDate].every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    `${regularEnd} / ${leagueEnd} / ${championshipEnd} / ${awardsDate}`);
  check('the regular season ends before the league series', regularEnd < leagueEnd,
    `${regularEnd} against ${leagueEnd}`);
  check('the league series ends before the World Series', leagueEnd < championshipEnd,
    `${leagueEnd} against ${championshipEnd}`);
  check('the World Series ends before the awards', championshipEnd < awardsDate,
    `${championshipEnd} against ${awardsDate}`);
  check('the league series finishes before the World Series did',
    Date.parse(leagueEnd) < Date.parse(championshipEnd),
    `${leagueEnd} against ${championshipEnd}`);
  check('a division resolves at least a fortnight before it used to',
    Date.parse(regularEnd) <= Date.parse(championshipEnd) - 14 * 86400000,
    `regular season ended ${regularEnd}, and every card used to say ${championshipEnd}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
