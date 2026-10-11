/**
 * HOW BIG THE PLAYER STATE IS ALLOWED TO GET.
 *
 * The pure arithmetic behind what `storage.ts` persists, kept out of it so it can be reasoned about and
 * measured without a browser. `storage.ts` imports these; nothing here imports `storage.ts`.
 *
 * WHY THE BUDGET IS A CONCERN AT ALL
 *
 * Player stat rows are retained for EVERY season -- `resetPlayerSeasonStats` keeps prior years, which is
 * correct, because the season archive recomputes a missing MVP from them and the season history shows
 * past numbers. But they are also the bulk of the payload and they grow without bound, while localStorage
 * grants every origin a fixed ceiling and never raises it.
 *
 * Measured over simulated seasons, as stored (localStorage holds UTF-16, so a JS string length of N costs
 * up to 2N bytes), against the 5 MiB browsers allow:
 *
 *     season 2026   2.97 MB    59%
 *     season 2027   3.75 MB    75%
 *     season 2028   4.54 MB    91%
 *     season 2029   5.33 MB   107%   <- from here the save throws
 *
 * A league that survives four seasons therefore cannot save at all, and the one before that has almost no
 * room for the games mirror, the season history, or anything else the app keeps alongside it.
 *
 * So the save has to be able to give something back. It gives back history, never the roster -- see
 * `prunePlayerStatsToRecentSeasons`.
 */
import type { LeaguePlayerState } from '../types';

/**
 * HOW MANY SEASONS OF PLAYER STATS SURVIVE THE FALLBACK.
 *
 * Two: the season in progress, and the one that just finished. The second is not negotiable -- it is the
 * season the archive writes, and the one the repair path recomputes a missing MVP from, so dropping it
 * would make an incomplete archive permanently unrecoverable. Anything older was archived automatically
 * when its season ended, so its detail is history's business rather than the save's.
 */
export const PLAYER_STATS_FALLBACK_SEASONS = 2;

/**
 * THE NEWEST SEASON PRESENT IN THE STATE.
 *
 * Read off the stat rows rather than passed in: the storage layer is handed a `LeaguePlayerState` and
 * nothing else, so knowing the season would mean guessing which years are safe to delete. A state with
 * no stats -- a brand new universe -- yields null and keeps everything.
 */
export const newestPlayerStatSeason = (playerState: LeaguePlayerState): number | null => {
  let newest: number | null = null;
  for (const stat of playerState.battingStats) {
    if (newest === null || stat.seasonYear > newest) newest = stat.seasonYear;
  }
  for (const stat of playerState.pitchingStats) {
    if (newest === null || stat.seasonYear > newest) newest = stat.seasonYear;
  }
  return newest;
};

/**
 * THE SEASON YEARS TO KEEP, newest first.
 *
 * Exposed so a caller can log exactly what it dropped, which is the difference between a save that
 * degrades quietly and one that says which history it gave up.
 */
export const retainedStatSeasonYears = (
  playerState: LeaguePlayerState,
  keep: number = PLAYER_STATS_FALLBACK_SEASONS,
): number[] => [
  ...new Set([
    ...playerState.battingStats.map((stat) => stat.seasonYear),
    ...playerState.pitchingStats.map((stat) => stat.seasonYear),
  ]),
].sort((left, right) => right - left).slice(0, Math.max(1, keep));

/**
 * DROP THE OLDEST SEASONS' STAT ROWS, keeping the newest `keep`.
 *
 * Only the stat rows go. Players, ratings and roster slots are per-player rather than per-season, so they
 * do not grow with the calendar -- and the ratings in particular are what the season archive reads to
 * score an MVP, so discarding them would empty the archive again for a reason that has nothing to do with
 * the archive's own bug. That has happened once already; it is not repeated here.
 *
 * Returns the ORIGINAL object when there is nothing older to drop, so the common case costs no copy.
 */
export const prunePlayerStatsToRecentSeasons = (
  playerState: LeaguePlayerState,
  keep: number = PLAYER_STATS_FALLBACK_SEASONS,
): LeaguePlayerState => {
  const retainedYears = new Set(retainedStatSeasonYears(playerState, keep));
  const hasOlder = playerState.battingStats.some((stat) => !retainedYears.has(stat.seasonYear))
    || playerState.pitchingStats.some((stat) => !retainedYears.has(stat.seasonYear));
  if (!hasOlder) {
    return playerState;
  }
  return {
    ...playerState,
    battingStats: playerState.battingStats.filter((stat) => retainedYears.has(stat.seasonYear)),
    pitchingStats: playerState.pitchingStats.filter((stat) => retainedYears.has(stat.seasonYear)),
  };
};

/**
 * THE STATE WITH NO STAT ROWS AT ALL. The last rung of the ladder, short of failing the save outright.
 *
 * Ratings survive here, which is the point: the current season's numbers are rebuilt as it is simulated,
 * and the awards can still be computed from the roster that remains.
 */
export const withoutPlayerStatRows = (playerState: LeaguePlayerState): LeaguePlayerState => ({
  ...playerState,
  battingStats: [],
  pitchingStats: [],
});

/**
 * WHAT ONE STATE COSTS TO WRITE, per key and in total.
 *
 * Returned as string lengths already multiplied by two, because localStorage stores UTF-16 and measuring
 * a JS string length and calling it bytes understates the real cost by a factor of two -- which is a
 * convenient way to believe a save fits right up until it does not.
 */
export const measurePlayerStatePayload = (
  playerState: LeaguePlayerState,
): { perKey: Record<string, number>; totalBytes: number } => {
  const perKey = {
    players: JSON.stringify(playerState.players).length * 2,
    battingStats: JSON.stringify(playerState.battingStats).length * 2,
    pitchingStats: JSON.stringify(playerState.pitchingStats).length * 2,
    battingRatings: JSON.stringify(playerState.battingRatings).length * 2,
    pitchingRatings: JSON.stringify(playerState.pitchingRatings).length * 2,
    rosterSlots: JSON.stringify(playerState.rosterSlots).length * 2,
    transactions: JSON.stringify(playerState.transactions).length * 2,
  };
  return {
    perKey,
    totalBytes: Object.values(perKey).reduce((sum, value) => sum + value, 0),
  };
};

/**
 * THE FALLBACK LADDER, coarsest last.
 *
 * `saveLocalPlayerState` walks these in order and stops at the first that writes. It is a function rather
 * than an inline chain so that the order is one list, and so a check can assert what is on each rung --
 * a ladder whose last rung quietly dropped the ratings would be the same archive bug wearing a different
 * hat.
 */
export const playerStateFallbackLadder = (
  playerState: LeaguePlayerState,
): Array<{ label: string; state: LeaguePlayerState }> => [
  { label: 'complete', state: playerState },
  { label: `stats trimmed to newest ${PLAYER_STATS_FALLBACK_SEASONS} seasons`, state: prunePlayerStatsToRecentSeasons(playerState) },
  { label: 'stat rows dropped', state: withoutPlayerStatRows(playerState) },
];