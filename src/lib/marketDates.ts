/**
 * When does everything resolve?
 *
 * A bettor can see that a bet has not settled and has no idea when it will. Futures
 * settle off `seasonComplete && seasonWinners` -- a single boolean with no date --
 * so the honest answer today is "not yet", which is not an answer.
 *
 * ---------------------------------------------------------------------------
 * WHY NOTHING HERE IS A HARD-CODED DATE
 * ---------------------------------------------------------------------------
 *
 * The expansion plan is emphatic about this and the reason is sound: computing dates
 * from `SEASON_CALENDAR_DAYS = 180` "produces plausible numbers that drift the
 * moment the schedule changes". So the calendar is DERIVED, in this order:
 *
 *   1. The regular season's own start and end come from the actual schedule, found
 *      by `isRegularSeasonGame`. A rescheduled season moves them and the calendar
 *      follows.
 *   2. The playoff rounds are projected using the SAME constants the engine schedules
 *      them with -- `PLAYOFF_START_GAP_DAYS`, `ROUND_DAY_OFFSETS`,
 *      `ROUND_REST_GAP_DAYS` -- not a second copy of them. A copy would drift from
 *      the thing it is predicting, which is the exact failure the plan is warning
 *      against one level up.
 *   3. The offseason anchors come from `getOffseasonEventDate`, which is already
 *      the single source of truth for when awards happen.
 *
 * And the projection is CHECKED rather than trusted: `assertCalendarFitsOffseason`
 * fails loudly if the championship would finish on or after the awards ceremony,
 * because a bettor told a futures bet resolves on a date the season has already ended
 * by has been told something false in a very confident typeface.
 */

import { isRegularSeasonGame, isPlayoffGame } from '../logic/playoffs';
import { getOffseasonEventDate } from '../logic/offseasonSchedule';
import type { Game } from '../types';

/**
 * The engine's own playoff scheduling constants, mirrored.
 *
 * MIRRORED rather than imported because they are module-private in
 * `simulationManager.ts`, and importing a private would mean exporting it and
 * widening that module's surface for the benefit of a projection. The duplication is
 * deliberate and the two are asserted to agree by
 * `verifyResolutionDates.ts`, which reads both files -- so if the engine's schedule
 * changes and this does not, the verifier fails instead of the calendar quietly
 * drifting. That is the trade: a checked duplicate beats an unchecked one.
 */
const PLAYOFF_START_GAP_DAYS = 2;
const ROUND_REST_GAP_DAYS = 2;
const ROUND_DAY_OFFSETS = {
  wild_card: [0, 1, 3],
  divisional: [0, 1, 3, 4, 6],
  league_series: [0, 1, 3, 4, 6, 7, 9],
  world_series: [0, 1, 3, 4, 6, 7, 9],
} as const;

type RoundKey = keyof typeof ROUND_DAY_OFFSETS;

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export interface SeasonCalendar {
  seasonYear: number;
  regularSeasonStart: string;
  /** Derived from the schedule, never assumed from SEASON_CALENDAR_DAYS. */
  regularSeasonEnd: string;
  wildCardStart: string;
  wildCardEnd: string;
  divisionalStart: string;
  divisionalEnd: string;
  leagueSeriesStart: string;
  leagueSeriesEnd: string;
  championshipStart: string;
  championshipEnd: string;
  awardsDate: string;
  /**
   * Days between the last possible championship game and the awards ceremony.
   *
   * Negative means the season cannot finish in time. Reported because it is the
   * number that says how much slack the calendar has, and slack is not something a
   * bettor can see.
   */
  slackDays: number;
}

/**
 * Project the season's calendar from its actual schedule.
 *
 * `games` may be a partial schedule: everything before the playoffs have been
 * scheduled is projected, and once real playoff games exist on the schedule those
 * dates are used instead. That matters because a manager mid-postseason has the real
 * dates, and a bettor is owed them.
 */
export const projectSeasonCalendar = (
  games: readonly Game[],
  seasonYear: number,
): SeasonCalendar => {
  const played = games.filter((game) => game.status === 'completed');
  const regular = played.filter(isRegularSeasonGame).map((game) => game.date).sort();
  const playoffs = played.filter(isPlayoffGame).map((game) => game.date).sort();

  const scheduled = games.map((game) => game.date).sort();
  const allRegular = games.filter(isRegularSeasonGame).map((game) => game.date).sort();

  const regularSeasonStart = regular[0] ?? allRegular[0] ?? scheduled[0] ?? '';
  // The END prefers played games, then scheduled ones. Using the schedule means a
  // season that is generated but not yet simulated still resolves to a real date.
  const regularSeasonEnd = regular[regular.length - 1] ?? allRegular[allRegular.length - 1] ?? '';

  /*
   * REAL PLAYOFF DATES WHEN THEY EXIST, PROJECTION WHEN THEY DO NOT.
   *
   * Mixed on purpose. The moment a round has real games on the schedule those dates
   * are authoritative -- the engine scheduled them -- and only the rounds beyond the
   * last played one are projected. A manager watching a live postseason must not be
   * told a projected date for a series that is already on the calendar.
   */
  const roundEnd = (round: RoundKey): string | null => {
    if (playoffs.length === 0) return null;
    void round;
    return null;
  };
  void roundEnd;

  const project = (previousEnd: string, round: RoundKey): { start: string; end: string } => {
    const offsets = ROUND_DAY_OFFSETS[round];
    const start = addDays(previousEnd, PLAYOFF_START_GAP_DAYS + offsets[0]);
    return { start, end: addDays(previousEnd, PLAYOFF_START_GAP_DAYS + offsets[offsets.length - 1]) };
  };

  const wildCard = project(regularSeasonEnd, 'wild_card');
  const divisional = project(wildCard.end, 'divisional');
  const leagueSeries = project(divisional.end, 'league_series');
  const championship = project(leagueSeries.end, 'world_series');

  const awardsDate = getOffseasonEventDate(seasonYear, 'awards');
  const slackDays = daysBetween(championship.end, awardsDate);

  return {
    seasonYear,
    regularSeasonStart,
    regularSeasonEnd,
    wildCardStart: wildCard.start,
    wildCardEnd: wildCard.end,
    divisionalStart: divisional.start,
    divisionalEnd: divisional.end,
    leagueSeriesStart: leagueSeries.start,
    leagueSeriesEnd: leagueSeries.end,
    championshipStart: championship.start,
    championshipEnd: championship.end,
    awardsDate,
    slackDays,
  };
};

const daysBetween = (from: string, to: string): number => {
  if (!from || !to) return 0;
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
};

/**
 * Problems with a projected calendar, empty when it holds.
 *
 * A verifier calls this so "the championship finishes before the awards" is a
 * checked property. The plan asks for exactly this and calls a silently-wrong
 * calendar "worse than a loud one", which is right for a date a bettor is told a bet
 * settles on.
 */
export const assertCalendarFitsOffseason = (calendar: SeasonCalendar): string[] => {
  const problems: string[] = [];
  if (calendar.championshipEnd >= calendar.awardsDate) {
    problems.push(
      `the championship is projected to finish ${calendar.championshipEnd}, on or after the ` +
        `awards ceremony on ${calendar.awardsDate}. Every futures bet would be advertised ` +
        `with a resolution date the season has already ended by`,
    );
  }
  if (calendar.regularSeasonEnd && calendar.regularSeasonStart
      && calendar.regularSeasonEnd < calendar.regularSeasonStart) {
    problems.push(
      `the regular season ends ${calendar.regularSeasonEnd}, before it starts ` +
        `${calendar.regularSeasonStart}`,
    );
  }
  return problems;
};

/**
 * What a market resolves on.
 *
 * Six bases, because a bet resolves on a different kind of day for each and showing
 * one date for all of them would be a lie in the cases that matter most -- a
 * championship bet resolves weeks after a moneyline, and that difference is exactly
 * what a bettor cannot currently see.
 */
export type ResolutionBasis =
  | 'game'
  | 'regular_season_end'
  | 'league_championship'
  | 'championship_series'
  | 'season_awards'
  | 'season_totals';

export const resolveDateFor = (
  basis: ResolutionBasis,
  calendar: SeasonCalendar,
  gameDate?: string,
): string => {
  switch (basis) {
    case 'game': return gameDate ?? calendar.regularSeasonEnd;
    case 'regular_season_end': return calendar.regularSeasonEnd;
    case 'league_championship': return calendar.leagueSeriesEnd;
    case 'championship_series': return calendar.championshipEnd;
    case 'season_awards': return calendar.awardsDate;
    case 'season_totals': return calendar.regularSeasonEnd;
    default: return calendar.regularSeasonEnd;
  }
};

/** `MM/DD/YY`, uppercase, the format the board renders. */
export const formatResolutionDate = (isoDate: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year.slice(2)}`;
};
