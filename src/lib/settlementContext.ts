import type { SettlementContext } from './wallet';
import type { SeasonHistoryEntry, Game, Team } from '../types';

/** Everything settlement needs to decide one pass, gathered from the caller. */
export interface SettlementInputSnapshot {
  games: Game[];
  teams: Team[];
  currentDate: string;
  seasonHistory: SeasonHistoryEntry[];
}

/**
 * The settlement context, built from the season archive.
 *
 * ============================================================================
 * WHY THIS IS A FUNCTION AND NOT INLINE HOOK CODE
 * ============================================================================
 *
 * It used to be assembled inside `useBettingSlip`'s `settle` callback, where it could not be
 * called by a test. That is not a style preference: it is why a bug in it survived. The league
 * champion was being derived here as
 *
 *     new Map(latest.divisionWinners.map((w) => [w.league, w.teamId]))
 *
 * which writes one key per DIVISION onto a key per LEAGUE. With two divisions per league the same
 * key is written twice and a Map keeps the last write, so the archived "league champion" was
 * whichever division leader happened to come last in `DIVISION_ORDER` -- not a seed, not the better
 * record, and not anything the playoffs decided. A league bet could pay out to a club that had won
 * nothing.
 *
 * Every assertion about that requires calling this, so it lives here where one can.
 *
 * ============================================================================
 * WHAT ELSE IS DERIVED HERE, AND WHY IT IS NOT DERIVED AT ALL
 * ============================================================================
 *
 *   divisions -- from `divisionWinners`. Correct: a division winner IS the division's leader, and
 *     the map is keyed `"<league> <division>"`, so there is exactly one entry per division and no
 *     collision.
 *
 *   leagues -- from `leagueWinners`, which the archive records from the completed league
 *     championship series. The old derivation is quoted above rather than deleted outright, because
 *     it looks plausible and will be re-derived by someone who does not read this comment.
 *
 *   champion -- read from the archive, which `resolveWorldSeriesChampion` already built off played
 *     World Series games. Null is a real state (a season that finished without a champion) and
 *     settles those bets VOID: undetermined, not lost.
 *
 *   awardWinners -- from the archive's MVP records. Both are omitted when absent rather than
 *     defaulted, so an unwritten award settles void instead of paying an empty string.
 *
 * `?? []` on `leagueWinners` is load-bearing, not defensive. A season archived before that field
 * existed has no league winners, and an absent entry reaches `settleWallet` as "no champion",
 * which settles those bets VOID and refunds the stake. A refund is recoverable; paying the wrong club
 * is not.
 */
export const buildSettlementContext = (input: SettlementInputSnapshot): SettlementContext => {
  const latest = input.seasonHistory[input.seasonHistory.length - 1];
  return {
    games: input.games,
    teams: input.teams,
    currentDate: input.currentDate,
    seasonComplete: Boolean(latest),
    seasonWinners: latest
      ? {
        seasonYear: latest.seasonYear,
        divisions: new Map(latest.divisionWinners.map((w) => [`${w.league} ${w.division}`, w.teamId])),
        leagues: new Map((latest.leagueWinners ?? []).map((w) => [w.league, w.teamId])),
        champion: latest.champion?.teamId ?? null,
      }
      : null,
    awardWinners: latest
      ? new Map<string, string>([
        ['batting_mvp', latest.battingMvp?.playerId],
        ['pitching_mvp', latest.pitchingMvp?.playerId],
      ].filter((pair): pair is [string, string] => Boolean(pair[1])))
      : null,
  };
};
