/**
 * Series standing, counted from completed games.
 *
 * ONE implementation, shared by the newsroom detectors and the postseason slate panel. It was moved
 * out of `headlinerEvents.ts` when the slate panel needed it, because importing a private helper out
 * of an event-detection module into a dashboard component is wrong twice over -- wrong layering, and
 * it invites a second copy. Two copies of "is this series over" is how the bracket and the newsroom
 * come to disagree about whether a club advanced, which is the exact shape of the
 * `leagueSeriesLosers` bug recorded in the handover (that one counted venues instead of clubs,
 * returned an empty set, and eliminated nobody).
 *
 * Nothing here reads or writes state. Given a `PlayoffGameDetails` and a list of completed games it
 * returns the standing. The caller is responsible for scoping that list to the games it cares
 * about -- see `seriesStandingForGame` for the headliner's scoping, and the slate panel's call site
 * for the unscoped one.
 */

import type { Game, PlayoffGameDetails } from '../types';

export interface SeriesStanding {
  seriesId: string;
  round: PlayoffGameDetails['round'];
  league: PlayoffGameDetails['league'];
  bestOf: number;
  seriesLabel: string;
  /** Games one side must win to take it. Derived, never stored. */
  winsNeeded: number;
  /** Win totals keyed by club id, from completed games only. */
  winsByTeamId: Map<string, number>;
  /** The club that took the series, when one has. */
  winnerId: string | null;
  /** The club that was knocked out, when the series is over. Includes a club that won nothing. */
  loserId: string | null;
}

/**
 * Games one side must win to take the series.
 *
 * Derived from `bestOf` rather than stored, because the bracket already persists the series length on
 * every game and a second copy of this rule could disagree with the one that actually decides a
 * series is over in `simulationManager`.
 */
export const winsNeededFor = (bestOf: number): number => Math.floor(bestOf / 2) + 1;

/**
 * The standing for one series, counted from `completedGames`.
 *
 * COUNTED BY CLUB, NEVER BY VENUE. A best-of-seven alternates home and away, so counting
 * `homeWins` against `awayWins` reads a real 4-2 as 2-2. That exact mistake was made twice in this
 * project -- once in `lockedRaces` and once in `leagueSeriesLosers`. Here it would read as "the
 * series is not over" and quietly drop the postseason's best story.
 *
 * PARTICIPANTS ARE TRACKED SEPARATELY FROM THE WIN MAP. The loser is the participant that did not
 * take the series -- not "the other entry in the win map". A club that never won a game is absent
 * from a map of wins, so deriving the loser from that map silently dropped the loser of every sweep.
 * That was found by `tools/checkPostseasonHeadliners.ts` and is the reason the two structures are
 * separate here.
 *
 * `completedGames` is scanned in whatever order it is given; it does not need to be sorted, because
 * wins are counted and the "decided" test is a threshold, not a position.
 */
export const seriesStanding = (
  details: PlayoffGameDetails,
  completedGames: readonly Game[],
): SeriesStanding => {
  const winsByTeamId = new Map<string, number>();
  const participants: string[] = [];

  for (const completed of completedGames) {
    if (completed.playoff?.seriesId !== details.seriesId) continue;
    if (completed.status !== 'completed') continue;

    for (const teamId of [completed.awayTeam, completed.homeTeam]) {
      if (!participants.includes(teamId)) participants.push(teamId);
    }

    if (completed.score.away > completed.score.home) {
      winsByTeamId.set(completed.awayTeam, (winsByTeamId.get(completed.awayTeam) ?? 0) + 1);
    } else if (completed.score.home > completed.score.away) {
      winsByTeamId.set(completed.homeTeam, (winsByTeamId.get(completed.homeTeam) ?? 0) + 1);
    }
    // A tie scores nobody. Not reachable in this engine, and if it ever were, silently counting
    // neither club is the right answer -- inventing a win for the home side is the failure mode
    // this project keeps paying for.
  }

  const winsNeeded = winsNeededFor(details.bestOf);
  const decided = [...winsByTeamId.entries()].find(([, wins]) => wins >= winsNeeded);

  return {
    seriesId: details.seriesId,
    round: details.round,
    league: details.league,
    bestOf: details.bestOf,
    seriesLabel: details.seriesLabel,
    winsNeeded,
    winsByTeamId,
    winnerId: decided ? decided[0] : null,
    loserId: decided ? participants.find((teamId) => teamId !== decided[0]) ?? null : null,
  };
};

/**
 * The standing for the series a completed game belongs to, or null when it is not a playoff game.
 *
 * `history` must already be scoped to games completed ON OR BEFORE `game` -- which is what
 * `GameIndexes.completedGamesUpTo` returns. Passing the unscoped league list would hand the caller
 * results from games that have not been played, and a series would look decided on every game of it.
 */
export const seriesStandingForGame = (
  game: Game,
  history: readonly Game[],
): SeriesStanding | null => {
  if (!game.playoff) return null;
  return seriesStanding(game.playoff, history);
};