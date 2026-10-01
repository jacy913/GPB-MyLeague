/**
 * Per-player split aggregates, derived from the stored play log.
 *
 * WHY THIS EXISTS AND WHY IT IS THIS SHAPE
 *
 * The leaders tables rank a player on one season line. That is the single most common way
 * a sabermetrics screen lies by omission: a .900 hitter who hit .900 in one half of his
 * schedule and .400 in the other is a different player from a .900 hitter who was .900
 * everywhere, and the season number cannot say which. This module is what lets the screen
 * say it.
 *
 * Three decisions in here, each of which was measured rather than assumed.
 *
 * 1. COUNTS ONLY, RATES FROM `metrics.ts`.
 *    A split is accumulated into `BattingCounts`, the same integer-count shape the engine
 *    already stores, and every rate on screen comes from `battingMetrics`. Nothing here
 *    computes an average. That is deliberate: `metrics.ts` is the one place the definition
 *    of a rate lives, and a second implementation is a second definition waiting to
 *    disagree with the first.
 *
 * 2. INCREMENTAL, KEYED ON GAME ID.
 *    Measured at 0.20ms per completed game, so a season-long cache stays warm for free as
 *    games finish. The full backfill for a whole season is 0.31s, which is why this is
 *    safe to run lazily on first open rather than eagerly on every render -- see
 *    `tools/measureSplitCost.ts`.
 *
 *    The 8.42s that this number replaced was a measurement bug: the timer wrapped the
 *    simulation as well as the derivation. See that tool and plan section 6.1.
 *
 * 3. HOME/ROAD AND PLATOON ONLY.
 *    Leverage is deliberately absent. The published definition is a function of runners,
 *    outs and inning and needs a run-expectancy table to be right; this project has no
 *    such table. An arithmetic proxy -- two or more aboard, fewer than two outs -- is
 *    close enough to be recognised and is nowhere near the real thing, and a leverage
 *    column that quietly disagrees with the published definition is worse than no column.
 *
 * A NOTE ON WHAT IS NOT HERE
 *
 * Nothing is persisted. This is derived on demand from the play log the engine already
 * writes, so there is no schema change, no migration, and no stored split that can go stale
 * against the season line beside it.
 */

import type { BattingCounts } from './metrics';
import type { AtBatOutcome, Game, Player } from '../../types';

/**
 * The split axes offered.
 *
 * `season` is the whole line and is derived rather than read from the stored aggregate,
 * on purpose: deriving it means the reconciliation in `tools/checkSplits.ts` is comparing
 * two independent paths to the same number. If `season` were read from the engine's own
 * aggregate, that check would be comparing the engine with itself and could not fail.
 */
export type SplitKind = 'season' | 'home' | 'road' | 'vs_left' | 'vs_right';

/** A player's line within one split. Zeroed counts; no rate is ever stored here. */
export type SplitLine = BattingCounts;

export type SplitRows = Map<string, Record<SplitKind, SplitLine>>;

export const SPLIT_KINDS: readonly SplitKind[] = ['season', 'home', 'road', 'vs_left', 'vs_right'];

/** What each axis is called on screen, and the short form used in tight headers. */
export const SPLIT_LABELS: Record<SplitKind, { label: string; short: string }> = {
  season: { label: 'Season', short: 'SEASON' },
  home: { label: 'Home', short: 'HOME' },
  road: { label: 'Road', short: 'ROAD' },
  vs_left: { label: 'vs LHP', short: 'VS L' },
  vs_right: { label: 'vs RHP', short: 'VS R' },
};

/**
 * The axes that PARTITION the season line, and the ones that only SUBSET it.
 *
 * This distinction is load-bearing and is the reason the reconciliation asserts different
 * things about different axes. Home and road partition exactly: every plate appearance is
 * taken either at home or away, with no third case. Platoon does NOT partition in general --
 * a plate appearance with no resolved pitcher, or a pitcher whose throwing hand is
 * unrecorded, falls into neither bucket. The measured coverage in this engine is 100%, but
 * that is a fact about the data and not a property of the code, so the code asserts only
 * the subset relationship and the coverage is reported rather than required.
 */
export const PARTITIONING_SPLITS: readonly SplitKind[] = ['home', 'road'];

/** A blank line. Every field explicit rather than spread from a zero, so a new field is a compile error. */
export const createSplitLine = (): SplitLine => ({
  gamesPlayed: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  runsScored: 0,
  rbi: 0,
});

const createRow = (): Record<SplitKind, SplitLine> => ({
  season: createSplitLine(),
  home: createSplitLine(),
  road: createSplitLine(),
  vs_left: createSplitLine(),
  vs_right: createSplitLine(),
});

/**
 * Apply one plate appearance to a line.
 *
 * THE AT-BAT DEFINITION, AND IT IS NOT THE OBVIOUS ONE.
 *
 * The first version of this counted an at-bat only on `OUT` and `ERR` -- the standard
 * definition -- and it disagreed with the engine on every single player: 228 derived
 * at-bats against 421 stored, while hits, walks, strikeouts and home runs all matched
 * exactly. That signature is the whole diagnosis. If coverage were wrong the hits would be
 * wrong too; hits being right and only at-bats being short means the DERIVATION was wrong,
 * not the walk.
 *
 * `gameEngine.ts:1330-1358` settles it:
 *
 *   OUT, SO                  at-bats += 1
 *   BB                       walks  += 1, and NO at-bat
 *   1B, ERR                  at-bats += 1
 *   2B / 3B / HR             at-bats += 1
 *
 * So in this engine an at-bat is a plate appearance MINUS A WALK, which is the textbook
 * rule. It is written out per outcome rather than derived as `pa - bb` so that the rule is
 * visible next to the thing it has to agree with, and so that adding a new outcome forces
 * a decision here instead of silently defaulting to "not an at-bat".
 *
 * The `default` branch counts nothing beyond the plate appearance, and says why in place:
 * an unknown outcome consumed a PA, which is counted above, but asserting that it was or
 * was not an at-bat would be precisely the guess this function exists to avoid.
 */
const applyOutcome = (line: SplitLine, outcome: string): void => {
  line.plateAppearances += 1;
  switch (outcome) {
    case 'SO':
      line.atBats += 1;
      line.strikeouts += 1;
      return;
    case 'BB':
      // The only outcome that is a plate appearance and NOT an at-bat.
      line.walks += 1;
      return;
    case '1B':
      line.atBats += 1;
      line.hits += 1;
      return;
    case '2B':
      line.atBats += 1;
      line.hits += 1;
      line.doubles += 1;
      return;
    case '3B':
      line.atBats += 1;
      line.hits += 1;
      line.triples += 1;
      return;
    case 'HR':
      line.atBats += 1;
      line.hits += 1;
      line.homeRuns += 1;
      return;
    case 'OUT':
    case 'ERR':
      line.atBats += 1;
      return;
    default:
      return;
  }
};

/** Outcomes that mark the end of a half or a game rather than a plate appearance. */
const isRealAtBat = (outcome: string): boolean =>
  outcome !== 'PITCHING_CHANGE' && outcome !== 'HALF_END' && outcome !== 'GAME_END';

/** Field guard: the play log is stored as an untyped JSON string on `game.stats`. */
interface StoredLogEvent {
  outcome?: AtBatOutcome | 'PITCHING_CHANGE' | 'HALF_END' | 'GAME_END';
  batterId?: string | null;
  pitcherId?: string | null;
  battingTeamId?: string | null;
}

const readPlayLog = (game: Game): StoredLogEvent[] | null => {
  const raw = game.stats?.playLog;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredLogEvent[]) : null;
  } catch {
    // A game whose log will not parse is skipped rather than thrown on. The alternative is
    // that one corrupt game takes down the leaders screen, and a splits panel missing one
    // game is a smaller defect than a blank screen. `checkSplits` asserts that the number
    // of games carrying a parseable log matches the number completed, so this path cannot
    // quietly become the normal case.
    return null;
  }
};

/* ------------------------------------------------------------------------- *
 * THE INCREMENTAL CACHE
 *
 * Module-level, and that is a deliberate choice rather than an oversight.
 *
 * The derivation is a pure function of the completed games and the players' throwing
 * hands, and both of those live above this module in the app's own state tree. Passing
 * them in on every call would mean the caller has to own the cache, and the caller is a
 * screen that renders on every state change -- which is how a memo keyed on the wrong
 * thing turns into a re-parse per render.
 *
 * The cache holds the ACCUMULATED rows, not the games, so calling `deriveSplits` twice
 * with the same games costs a set lookup per game and returns the same rows.
 *
 * Correctness does NOT rest on the caller remembering to reset. `deriveSplits` checks on
 * every call that every game it has already folded in is still in the league, and discards
 * the cache whole if one is not -- because a rebuilt universe reuses player ids, and stale
 * rows keyed by a reused id would be attributed to a different player with no error anywhere.
 * `resetSplits` remains exported for the cases where a caller knows better, and
 * `tools/checkSplits.ts` asserts the guard fires.
 * ------------------------------------------------------------------------- */

let processedGameIds = new Set<string>();
let rows: SplitRows = new Map<string, Record<SplitKind, SplitLine>>();

/**
 * Throw away everything derived so far.
 *
 * Required when the league itself changes identity, not merely when games are added: a new
 * universe reuses the player ids, and a stale row keyed by a player id would then be
 * silently attributed to a different player.
 */
export const resetSplits = (): void => {
  processedGameIds = new Set<string>();
  rows = new Map<string, Record<SplitKind, SplitLine>>();
};

const rowFor = (playerId: string): Record<SplitKind, SplitLine> => {
  let row = rows.get(playerId);
  if (!row) {
    row = createRow();
    rows.set(playerId, row);
  }
  return row;
};

/** How many completed games have been folded in. Reported so a screen can say "so far". */
export const derivedGameCount = (): number => processedGameIds.size;

/**
 * Derive every split for every player, folding in only games not seen before.
 *
 * @param games       every game the app knows about, completed or not
 * @param players     used only for throwing hands, which decide the platoon buckets
 */
export const deriveSplits = (games: readonly Game[], players: readonly Player[]): SplitRows => {
  /*
   * THE UNIVERSE IDENTITY GUARD.
   *
   * The cache is keyed on game id and its rows are keyed on player id, and both of those are
   * reused when a league is rebuilt: `buildNewUniverse` with the same seed regenerates the
   * same player ids. So a user who resets to a new universe mid-session would otherwise get
   * the old universe's split rows silently attributed to the new universe's players -- stale
   * numbers, no error, no way to tell from the screen.
   *
   * Rather than require every caller to remember `resetSplits` on the paths that rebuild a
   * league, the cache checks its own assumption: every game it has already folded in must
   * still be in the league. If one is not, this is a different league and the cache is
   * discarded whole.
   *
   * Cost is one Set build over the completed games, which is the same order as the loop
   * below and is dwarfed by the 0.20ms per new game. The `size` comparison short-circuits
   * the common case -- a league only ever grows, so equal-or-larger skips the deep scan.
   */
  const liveGameIds = new Set<string>();
  for (const game of games) {
    if (game.status === 'completed') liveGameIds.add(game.gameId);
  }
  if (processedGameIds.size > liveGameIds.size) {
    resetSplits();
  } else {
    for (const id of processedGameIds) {
      if (!liveGameIds.has(id)) {
        resetSplits();
        break;
      }
    }
  }

  const throwHandById = new Map(players.map((p) => [p.playerId, p.throws]));

  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (processedGameIds.has(game.gameId)) continue;

    /*
     * The id is recorded BEFORE the log is read.
     *
     * The other order would let a game whose log is missing or unparseable be retried on
     * every call forever, which is the shape of a cache that appears to work and quietly
     * re-does work. A game we could not read stays unread; `checkSplits` is what notices.
     */
    processedGameIds.add(game.gameId);

    const events = readPlayLog(game);
    if (!events) continue;

    for (const event of events) {
      if (!event.batterId || !event.outcome) continue;
      if (!isRealAtBat(event.outcome)) continue;

      const row = rowFor(event.batterId);
      applyOutcome(row.season, event.outcome);
      applyOutcome(event.battingTeamId === game.homeTeam ? row.home : row.road, event.outcome);

      // An unresolvable pitcher falls into NEITHER platoon bucket. That is the honest
      // outcome: it keeps the buckets a subset of the season line instead of inflating one
      // of them with appearances whose handedness is unknown.
      const hand = event.pitcherId ? throwHandById.get(event.pitcherId) : undefined;
      if (hand === 'L') applyOutcome(row.vs_left, event.outcome);
      else if (hand === 'R') applyOutcome(row.vs_right, event.outcome);
    }
  }

  return rows;
};

/**
 * How much of the league's plate appearances the platoon axes could classify.
 *
 * Reported rather than assumed. A reader is entitled to know that a split covers 60% of a
 * player's plate appearances before treating it as a career figure, and a coverage figure
 * that is only ever 100% by assumption is not coverage.
 */
export const platoonCoverage = (table: SplitRows): { classified: number; total: number } => {
  let classified = 0;
  let total = 0;
  table.forEach((row) => {
    classified += row.vs_left.plateAppearances + row.vs_right.plateAppearances;
    total += row.season.plateAppearances;
  });
  return { classified, total };
};