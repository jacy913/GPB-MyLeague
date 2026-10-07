/**
 * Movement for the dashboard POWER RANKINGS strip.
 *
 * A ranking is a snapshot, and movement is one snapshot measured against the one before it.
 * `buildPowerRankings` carries no previous rank, so the strip keeps one itself, keyed by the date the
 * stored board was built for. That is what lets the arrows survive a reload on the same day, and what
 * makes a board on a NEW day compare against the last edition rather than against itself.
 *
 * The helpers live outside the component so TERMINATE UNIVERSE can clear the snapshot with the rest
 * of the market state: a rebuilt league must not open showing the old league's arrows. See the "HXSE
 * goes with the universe" block in `App.tsx`.
 *
 * Reads and writes are guarded. A malformed or unavailable store costs one flat edition, never a
 * broken dashboard.
 */

import type { PowerRankings } from '../../lib/analytics/powerRankings';

/** One key, overwritten every edition; there is nothing to accumulate. */
export const RANK_MOVEMENT_STORAGE_KEY = 'gpb_power_rank_movement_v1';

export interface RankMovementSnapshot {
  /** The date the stored board was built for. */
  asOf: string;
  /** teamId -> league-wide rank on that board. */
  ranks: Record<string, number>;
  /** teamId -> places moved when that board first became current. Positive is up. */
  movement: Record<string, number>;
}

export const readRankMovement = (): RankMovementSnapshot | null => {
  try {
    const raw = localStorage.getItem(RANK_MOVEMENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RankMovementSnapshot> | null;
    if (!parsed || typeof parsed.asOf !== 'string' || typeof parsed.ranks !== 'object' || parsed.ranks === null) {
      return null;
    }
    return {
      asOf: parsed.asOf,
      ranks: parsed.ranks as Record<string, number>,
      movement: (parsed.movement as Record<string, number> | undefined) ?? {},
    };
  } catch {
    return null;
  }
};

export const writeRankMovement = (snapshot: RankMovementSnapshot): void => {
  try {
    localStorage.setItem(RANK_MOVEMENT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Storage full or unavailable: the arrows still render for this session. */
  }
};

export const clearPowerRankMovement = (): void => {
  try {
    localStorage.removeItem(RANK_MOVEMENT_STORAGE_KEY);
  } catch {
    /* Nothing to do: the snapshot only ever holds ranks. */
  }
};

/**
 * The current board's arrows, plus the snapshot to persist.
 *
 * Pure -- it only READS storage. The caller persists `next`, so the write is not buried in a render
 * path React may run twice. `next` is null when this board is the edition already stored.
 */
export const resolveRankMovement = (
  rankings: PowerRankings | null,
): { movement: Map<string, number>; next: RankMovementSnapshot | null } => {
  if (!rankings || rankings.rows.length === 0) {
    return { movement: new Map(), next: null };
  }

  const ranks: Record<string, number> = {};
  for (const row of rankings.rows) ranks[row.teamId] = row.rank;

  const stored = readRankMovement();

  /*
    SAME EDITION, SAME ARROWS.

    Recomputing here would compare the board against itself and wipe every arrow the moment the page
    reloaded. The movement recorded when this date first became current is the answer until the date
    changes.
  */
  if (stored && stored.asOf === rankings.asOf) {
    return { movement: new Map(Object.entries(stored.movement)), next: null };
  }

  const movement: Record<string, number> = {};
  for (const row of rankings.rows) {
    const previous = stored?.ranks[row.teamId];
    // No prior rank means the club is NEW to the board, not unmoved by a known amount.
    if (typeof previous === 'number') movement[row.teamId] = previous - row.rank;
  }

  return {
    movement: new Map(Object.entries(movement)),
    next: { asOf: rankings.asOf, ranks, movement },
  };
};

/** Screen-reader text for an arrow, since colour alone cannot carry the direction. */
export const rankMovementLabel = (places: number): string => {
  if (places > 0) return `Up ${places} since the previous board`;
  if (places < 0) return `Down ${-places} since the previous board`;
  return 'Unmoved since the previous board';
};
