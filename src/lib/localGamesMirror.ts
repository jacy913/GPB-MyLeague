import type { Game } from '../types';

// ---------------------------------------------------------------------------
// Bounded localStorage games mirror
// ---------------------------------------------------------------------------

/**
 * Measured sizes, from tools/probeStorageBudget.ts over 411 completed games
 * (seed 4242, 30 simmed days), in UTF-16 code units, which is what counts
 * against a localStorage origin quota:
 *
 *   full game          94,661 mean   109,202 p95
 *     playLog          60,540 mean    75,053 p95    63.95% of all bytes
 *     participants     33,254 mean    33,408 p95    35.13% of all bytes
 *     lineScore           349 mean       678 max     0.37% of all bytes
 *   structural envelope (no stats at all)          174 mean
 *
 * A 32-team season is 2,592 games, so the full payload needs roughly 233 MB
 * against a 5 MB origin quota: about 55 full games fit. That is the number the
 * previous `stats: {}` fallback was silently reacting to, and it discarded the
 * play log of every game past the 55th.
 *
 * The fix is to treat localStorage as a bounded recent-games mirror and keep
 * every game's small fields. playLog and participants are what do not fit;
 * everything else is structural or settlement-critical and is kept for every
 * game, which measures at 6,043 games against the quota.
 *
 * This lives in its own module rather than in storage.ts because storage.ts
 * imports the Supabase client, which needs Vite env vars. Keeping the mirror
 * free of that dependency is what lets verifyLocalGamesMirror.ts measure the
 * shipping code directly under tsx instead of reimplementing it.
 */

/**
 * The localStorage origin quota, in UTF-16 code units. This is a platform
 * constant rather than a property of this league: the HTML spec asks for
 * 5,242,880 and every Chromium-family browser enforces it.
 */
export const LOCAL_STORAGE_QUOTA_UNITS = 5 * 1024 * 1024;

/**
 * Units reserved for everything the mirror does not own.
 *
 * The budget is NOT a fixed fraction of the quota, because the quota is
 * per-origin and the other nine keys grow without bound across a save's
 * history: batting and pitching ratings and stats are one row per player per
 * season year, and transactions accumulate. Measured at day 40 of a season
 * (tools/probeStorageBudget.ts, seed 4242) those siblings already cost
 * 1,479,613 units -- 28% of the quota -- and a fixed 0.8 fraction would have
 * quietly overrun the origin as soon as they passed 20%. A fixed reserve
 * measured at one point in one season has the same defect one season later.
 *
 * So the mirror subtracts what the origin is actually holding when it runs.
 * That is measured per save rather than assumed, which is the only version of
 * this number that stays correct as a league is played forward.
 */
export const LOCAL_STORAGE_GAMES_RESERVED_UNITS = 128 * 1024;

/**
 * The per-origin quota less whatever the other keys currently hold.
 *
 * `occupiedUnits` is the summed length of every localStorage key except the
 * games key, measured at call time. A caller that cannot enumerate the origin
 * passes 0 and gets the whole quota less the flat reserve, which is the
 * correct reading when the mirror genuinely is the only thing stored.
 *
 * Measured sibling cost, tools/probeStorageBudget.ts seed 4242, identical at
 * day 40 and at day 180 of a season: 1,479,613 units across glb_players
 * (488,248), glb_batting_ratings (322,803), glb_pitching_ratings (231,845),
 * glb_batting_stats (188,572), glb_pitching_stats (144,273), glb_roster_slots
 * (98,049), glb_teams (5,669) and glb_settings (152). That leaves 3,763,267
 * units for games -- a figure a fixed 0.8 fraction (4,194,304) would have
 * overshot by 430,000 units, which is a QuotaExceededError at the worst
 * possible moment rather than a graceful degradation.
 *
 * The sibling total is flat WITHIN a season because ratings and stats are keyed
 * by season year, so a season's play adds transactions and nothing else. It
 * does grow once per season year, which is why this is measured per save
 * rather than pinned to the number above.
 */
export const gamesBudgetFromOccupiedUnits = (occupiedUnits: number): number =>
  Math.max(0, LOCAL_STORAGE_QUOTA_UNITS - Math.max(0, occupiedUnits) - LOCAL_STORAGE_GAMES_RESERVED_UNITS);

/**
 * Measured peak cost of every non-games key, used as the floor when a save
 * cannot enumerate the origin. Set from the 1,479,613 measured above, rounded
 * up to 1.75 MB, so a caller without enumeration still leaves room for a full
 * season's worth of ratings growth rather than assuming the league is static.
 */
export const LOCAL_STORAGE_SIBLING_FLOOR_UNITS = 1.75 * 1024 * 1024;

/**
 * The localStorage key the mirror writes. It is the one key excluded from the
 * occupied-unit measurement.
 */
export const LOCAL_GAMES_STORAGE_KEY = 'glb_games';

/**
 * Units of the origin's quota currently held by every key EXCEPT the games key.
 *
 * This lives here, next to the budget formula that consumes it, rather than in
 * storage.ts. storage.ts imports the Supabase client and cannot be loaded
 * outside a Vite build, so putting the measurement in storage.ts would have
 * forced tools/verifyStorageBudgetBrowser.mjs to reimplement it -- and a test
 * that audits a copy of the budget logic is not testing the budget logic. The
 * module stays free of Supabase and reaches the browser only through this one
 * guarded call, which the existing tsx verifier exercises through its
 * `typeof localStorage === 'undefined'` branch.
 *
 * The games key is excluded because it is about to be overwritten with the
 * payload being sized; counting its previous contents would shrink the new
 * budget on every save, a ratchet that would drive retention to zero over time.
 *
 * An unreadable key is charged a nominal unit rather than zero and warns. A
 * value that cannot be read is still occupying space, and undercounting here is
 * the direction that overruns the origin.
 */
export const measureOccupiedUnits = (): number => {
  if (typeof localStorage === 'undefined') {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key === null || key === LOCAL_GAMES_STORAGE_KEY) {
      continue;
    }
    try {
      const value = localStorage.getItem(key);
      if (typeof value === 'string') {
        total += value.length;
      }
    } catch (error) {
      total += 1;
      console.warn(`Could not measure localStorage key "${key}" for the games budget.`, error);
    }
  }
  return total;
};

/**
 * The budget a real save uses: the origin's actual headroom, measured now.
 */
export const measureGamesBudgetUnits = (): number => gamesBudgetFromOccupiedUnits(measureOccupiedUnits());

/**
 * The bulky fields, in the order they are wanted within a date.
 *
 * Both are read by name: playLog by playerProps, headlineEngine, GameScreen,
 * HomeDashboard and App; participants by gameEngine.hydrateGameSessionFromGame,
 * which rebuilds an interactive game from a stored one.
 *
 * playLog comes first because it is the one that pays out. A missing play log
 * does not merely lose a game's detail, it voids that game's props outright --
 * wallet.ts reads an absent log as an empty one. participants only gate
 * interactive replay, which is a convenience. So when the budget cannot hold
 * both for a date, the date gets its play logs and loses its replay snapshot.
 */
type RetainedGameFields = 'playLog' | 'participants';

/**
 * The fields every game keeps no matter what the budget allows.
 *
 * lineScore is 0.37% of stored bytes and is what wallet.ts settles first-five
 * bets from, so it is never treated as droppable. The rest are read by name
 * across App.tsx, useBroadcastFlair and GameScreen, and are a few bytes each,
 * so losing them would silently corrupt the box score for every game rather
 * than losing a game's detail.
 */
export const envelopeStats = (stats: Game['stats']): Game['stats'] => {
  const source = stats ?? {};
  const next: Game['stats'] = {};
  if (typeof source.awayHits === 'number') next.awayHits = source.awayHits;
  if (typeof source.homeHits === 'number') next.homeHits = source.homeHits;
  if (typeof source.awayErrors === 'number') next.awayErrors = source.awayErrors;
  if (typeof source.homeErrors === 'number') next.homeErrors = source.homeErrors;
  // null is carried as null rather than dropped. "There was no losing pitcher"
  // is a fact, and collapsing it to an absent key would make a stored game
  // indistinguishable from one whose stats were never written.
  if (typeof source.winningPitcherId === 'string' || source.winningPitcherId === null) {
    next.winningPitcherId = source.winningPitcherId;
  }
  if (typeof source.losingPitcherId === 'string' || source.losingPitcherId === null) {
    next.losingPitcherId = source.losingPitcherId;
  }
  if (typeof source.savePitcherId === 'string' || source.savePitcherId === null) {
    next.savePitcherId = source.savePitcherId;
  }
  if (typeof source.finalInning === 'number') next.finalInning = source.finalInning;
  if (typeof source.interactiveSim === 'boolean') next.interactiveSim = source.interactiveSim;
  if (typeof source.simulatedAt === 'string') next.simulatedAt = source.simulatedAt;
  if (typeof source.lineScore === 'string') next.lineScore = source.lineScore;
  return next;
};

/**
 * Builds the bounded localStorage mirror, newest games first.
 *
 * Ordering is by date descending so the games most likely to still be read --
 * today's slate, and any bet still awaiting settlement -- are the ones that
 * keep their bulky fields. Every game keeps its envelope regardless, so a game
 * is never reduced to something unloadable.
 *
 * Retained fields are stored whole. They are never truncated: a truncated JSON
 * array fails to parse, and every consumer reads a parse failure as an EMPTY
 * log, which voids props rather than merely losing the log.
 */
export const buildLocalGamesMirror = (
  games: Game[],
  budget: number = gamesBudgetFromOccupiedUnits(LOCAL_STORAGE_SIBLING_FLOOR_UNITS),
): {
  serialized: string;
  retainedPlayLogs: number;
  retainedParticipants: number;
  budgetUnits: number;
} => {
  const ordered = games
    .map((game, index) => ({ game, index }))
    .sort((left, right) => (left.game.date === right.game.date
      ? left.index - right.index
      : left.game.date < right.game.date ? 1 : -1));

  const statsByIndex = new Array<Game['stats']>(games.length);
  // Charged in SERIALIZED units, not raw string length. A play log is a JSON
  // string nested inside a JSON string, so every quote in it is escaped on the
  // way out. Charging raw length undercounts by about 12%, which is more than
  // enough to overshoot the quota on its own.
  //
  // The envelope for EVERY game is charged before any bulky field is
  // considered. Charging them in one interleaved pass instead lets the newest
  // games pass their budget test while the running total is still small, and
  // then adds the remaining envelopes unconditionally afterwards -- which is
  // how the first run of this verifier wrote 6,332,568 units against a
  // 5,242,880 quota while believing it was under budget.
  const emptyStats = '{}';
  let used = 0;
  ordered.forEach(({ game, index }) => {
    const kept = envelopeStats(game.stats ?? {});
    // Charged as ONE object, not as game-minus-stats plus stats. Splitting the
    // charge and subtracting the "{}" literal each time left out the field name
    // and quotes around the stats object, which is ~10 units per game and
    // ~26,000 units across a season. The budget then bound earlier than it
    // should, and the mirror wrote 4,178,002 units while accounting for less.
    used += JSON.stringify({ ...game, stats: kept }).length;
    statsByIndex[index] = kept;
  });
  // The array brackets and the comma between every pair of games.
  used += 2 + Math.max(0, games.length - 1);

  // Grouped by date, newest first. `ordered` is already sorted date-descending
  // with the original index ascending inside a date, so insertion order here is
  // the retention order and the greedy pass is reproducible.
  const dateBuckets: Array<{ date: string; indices: number[] }> = [];
  const byDate = new Map<string, number[]>();
  ordered.forEach(({ game, index }) => {
    const existing = byDate.get(game.date);
    if (existing) {
      existing.push(index);
      return;
    }
    const indices = [index];
    byDate.set(game.date, indices);
    dateBuckets.push({ date: game.date, indices });
  });

  let retainedPlayLogs = 0;
  let retainedParticipants = 0;

  const rawField = (index: number, field: RetainedGameFields): string | null => {
    const raw = (games[index].stats ?? {})[field];
    return typeof raw === 'string' && raw.length > 0 ? raw : null;
  };

  /**
   * The exact marginal SERIALIZED cost of adding one field to one game.
   *
   * Measured as a difference of two real serializations rather than computed
   * from string lengths, so an escaping change in the data cannot silently make
   * the cost model wrong. The difference is independent of which other fields
   * the object already holds -- adding a key costs `,"key":value` either way --
   * which is what lets a whole date be priced in one pass and then committed.
   */
  const costOfAdding = (index: number, field: RetainedGameFields): number => {
    const raw = rawField(index, field);
    if (raw === null) {
      return 0;
    }
    const kept = statsByIndex[index];
    return JSON.stringify({ ...kept, [field]: raw }).length - JSON.stringify(kept).length;
  };

  const commit = (index: number, field: RetainedGameFields, cost: number): void => {
    used += cost;
    statsByIndex[index] = { ...statsByIndex[index], [field]: rawField(index, field) as string };
  };

  /**
   * Retention is decided per DATE, not per game, and is all-or-nothing for each
   * field within a date.
   *
   * The previous version walked games newest-first and charged each game's
   * playLog and then its participants before moving on. That interleaving is
   * what stranded a slate: measured on a 2,592-game season it retained 26 play
   * logs and 30 participants, so participants -- which only serve interactive
   * replay -- consumed budget that could have bought a play log, and the newest
   * date ended up with 26 of its 28 games logged. A date that is partly logged
   * is the worst of both worlds: the UI still shows those games, and the ones
   * missing a play log void their props (wallet.ts reads an absent log as an
   * empty one).
   *
   * Grouping by date fixes the arithmetic. It also makes the priority
   * explicit, which per-game greediness did not: participants are a convenience,
   * play logs pay out money, so play logs are taken first and in full for a
   * date even when that leaves no room for replay.
   *
   * `coveredSomething` is what stops an OLDER date from being fragmented.
   * Measured on the real season, a leftover of ~66,000 units was enough for two
   * more play logs, so the builder topped the previous slate up from 12/14 while
   * 2 of its 14 games got logs and 12 did not. That fragment is worth nothing:
   * props are same-slate, so a slate missing 12 of 14 play logs cannot settle a
   * single bet. Once a whole date is in, the remaining budget may buy another
   * WHOLE date or nothing.
   */
  const coverDate = (
    indices: number[],
    coveredSomething: boolean,
  ): { playLogs: number; participants: number; exhausted: boolean } => {
    const plan = (field: RetainedGameFields) => {
      const costByIndex = indices.map((i) => costOfAdding(i, field));
      return {
        costByIndex,
        cost: costByIndex.reduce((a, b) => a + b, 0),
        count: costByIndex.filter((c) => c > 0).length,
      };
    };
    const play = plan('playLog');
    const parts = plan('participants');

    if (used + play.cost + parts.cost <= budget) {
      indices.forEach((i) => {
        const p = costOfAdding(i, 'playLog');
        if (p > 0) commit(i, 'playLog', p);
        const q = costOfAdding(i, 'participants');
        if (q > 0) commit(i, 'participants', q);
      });
      return { playLogs: play.count, participants: parts.count, exhausted: false };
    }

    if (used + play.cost <= budget) {
      // Play logs fit, replay does not. Take the logs and carry on to older
      // dates, which may still fit.
      indices.forEach((i) => {
        const p = costOfAdding(i, 'playLog');
        if (p > 0) commit(i, 'playLog', p);
      });
      return { playLogs: play.count, participants: 0, exhausted: false };
    }

    if (coveredSomething) {
      // Not affordable, and a whole date is already in. Leave this date empty
      // rather than fragmenting it into a state that settles nothing.
      return { playLogs: 0, participants: 0, exhausted: true };
    }

    // The NEWEST date cannot be afforded even for play logs alone. Retain as
    // much of it as fits and stop. An empty mirror is the failure this avoids:
    // it passes every fits-in-quota assertion while settling nothing, whereas a
    // partial newest slate at least covers some of today's games.
    let kept = 0;
    indices.forEach((i) => {
      const p = costOfAdding(i, 'playLog');
      if (p > 0 && used + p <= budget) {
        commit(i, 'playLog', p);
        kept += 1;
      }
    });
    return { playLogs: kept, participants: 0, exhausted: true };
  };

  let coveredSomething = false;
  for (const bucket of dateBuckets) {
    const got = coverDate(bucket.indices, coveredSomething);
    retainedPlayLogs += got.playLogs;
    retainedParticipants += got.participants;
    if (got.playLogs > 0 || got.participants > 0) {
      coveredSomething = true;
    }
    if (got.exhausted) {
      break;
    }
  }

  return {
    serialized: JSON.stringify(games.map((game, index) => ({ ...game, stats: statsByIndex[index] }))),
    retainedPlayLogs,
    retainedParticipants,
    budgetUnits: budget,
  };
};
