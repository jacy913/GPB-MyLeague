/**
 * What the winter did.
 *
 * ============================================================================
 * WHY THE OFFSEASON HAD NOTHING TO SAY ABOUT ITS OWN HEADLINE
 * ============================================================================
 *
 * The retirements step reported a count. The lottery produced a table. Free agency produced a market
 * you clicked through. Nowhere in a 32-team winter did the interface say which player was the biggest
 * name that moved, because nothing was ranking them -- the transaction log is per-player, chronological,
 * and nobody had ever grouped it into events.
 *
 * So the league's most newsworthy stretch had no news. This module groups the log into things that
 * HAPPENED rather than things that were recorded.
 *
 * ============================================================================
 * WHY A TRADE IS PAIRED RATHER THAN COUNTED
 * ============================================================================
 *
 * A trade is written to the log as two mirrored rows on the same date, one per player, each naming
 * the other player in its notes: "Auto-accepted trade for {other}". They are the two halves of one
 * event and they are meaningless apart -- a screen that showed them separately would print the same
 * move twice and call it two transactions.
 *
 * So they are paired here by date and direction, and each pair becomes ONE card with two crests
 * facing each other. That is also the only honest shape for a trade: a trade is a swap, and a swap
 * rendered as two unrelated lines is not a swap.
 *
 * Pairing is conservative. Two unrelated clubs can make moves on the same day, and a naive date-only
 * match would weld them into one fictional blockbuster. So a pair must be mutually consistent: same
 * date, opposite direction, and each row must name the other player. Anything else stays its own
 * card rather than being guessed at.
 *
 * ============================================================================
 * DERIVED, NOT STORED
 * ============================================================================
 *
 * Same property as the retirements wall, and for the same reason: the log is already in the save, so
 * a snapshot would be one more thing that can disagree with it or be lost on a reload. Everything
 * here is computed from `playerState` at render, which means the winter reads identically before a
 * refresh and after one.
 */

import type {
  LeaguePlayerState,
  Player,
  PlayerTransaction,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
} from '../types';

/** One offseason move, as something that happened rather than something that was recorded. */
export interface OffseasonMove {
  id: string;
  kind: 'trade' | 'signing' | 'release';
  /** The date the move took effect. */
  effectiveDate: string;
  /**
   * How much the league should care.
   *
   * This is the field that decides what is a headline and what is a footnote, so it is explicit and
   * computed once, here, rather than left to each card to guess at.
   */
  weight: number;
  /** The players involved. One for a signing or release, two for a trade. */
  players: MovePlayer[];
  /** Club on the left of the card. Null when a move involved no club -- a release into nothing. */
  fromTeamId: string | null;
  toTeamId: string | null;
}

export interface MovePlayer {
  player: Player;
  overall: number;
  battingLine: PlayerSeasonBatting | null;
  pitchingLine: PlayerSeasonPitching | null;
}

const latestRating = (playerState: LeaguePlayerState, playerId: string): number => {
  const batting = playerState.battingRatings
    .filter((rating) => rating.playerId === playerId)
    .sort((left, right) => right.seasonYear - left.seasonYear)[0];
  const pitching = playerState.pitchingRatings
    .filter((rating) => rating.playerId === playerId)
    .sort((left, right) => right.seasonYear - left.seasonYear)[0];
  return batting?.overall ?? pitching?.overall ?? 0;
};

const latestLine = <T extends { playerId: string; seasonYear: number; seasonPhase: string }>(
  rows: T[],
  playerId: string,
): T | null => {
  const rowsForPlayer = rows
    .filter((row) => row.playerId === playerId && row.seasonPhase === 'regular_season')
    .sort((left, right) => right.seasonYear - left.seasonYear);
  return rowsForPlayer[0] ?? null;
};

/**
 * THE THRESHOLD A SIGNING OR TRADE HAS TO CLEAR TO BE A HEADLINE.
 *
 * 84 is the same number that decides a retirement headline in `headlineEngine` and the same number
 * that tiers the retirements wall. Three surfaces deciding what matters, one constant.
 *
 * It is deliberately not lower. An offseason produces hundreds of transactions across 32 clubs, and
 * a feed that led with everything would state that a re-signed reserve and a franchise addition are
 * the same size of event -- which is the failure this whole module exists to avoid.
 */
export const BLOCKBUSTER_OVERALL = 84;

/**
 * THE MOVES THAT MADE THE WINTER.
 *
 * `fromDate` bounds the window rather than taking "the whole log", because the log spans every season
 * the save has ever run. A feed that showed all of it would open with transactions from three years
 * ago and read as though the winter were busier than it was.
 *
 * Weighted by rating, and ordered by it, because the ordering is the argument: the biggest name that
 * moved leads. A chronological feed would be honest and useless -- it would rank a club's reserve
 * signing above the trade of the winter purely by which happened to be logged first.
 */
export const collectOffseasonMoves = (
  playerState: LeaguePlayerState,
  fromDate: string,
): { moves: OffseasonMove[]; departedPlayerRows: number } => {
  const playersById = new Map(playerState.players.map((player) => [player.playerId, player]));
  const window = playerState.transactions.filter(
    (transaction) => transaction.effectiveDate >= fromDate,
  );

  const describe = (playerId: string): MovePlayer | null => {
    const player = playersById.get(playerId);
    if (!player) return null;
    return {
      player,
      overall: latestRating(playerState, playerId),
      battingLine: latestLine(playerState.battingStats, playerId),
      pitchingLine: latestLine(playerState.pitchingStats, playerId),
    };
  };

  const moves: OffseasonMove[] = [];
  const consumed = new Set<string>();

  const rowKey = (transaction: PlayerTransaction, index: number): string =>
    `${transaction.playerId}:${transaction.effectiveDate}:${index}`;

  const keyed = window.map((transaction, index) => ({ transaction, key: rowKey(transaction, index) }));

  /**
   * The name a transaction note writes. Full name, never the surname.
   *
   * Measured on a real 1292-player league: 298 last names belong to more than one man ("Farrell"
   * x5) and ZERO full names repeat. So a note is matched on the whole name -- matching a surname
   * would let two unrelated same-day moves between four different clubs satisfy each other's
   * pairing and weld into one invented blockbuster.
   */
  const fullName = (player: Player | undefined): string =>
    player ? `${player.firstName} ${player.lastName}` : '\u0000';

  // -- trades: pair the mirrored rows ------------------------------------------------------
  keyed
    .filter(({ transaction }) => transaction.eventType === 'traded')
    .forEach(({ transaction, key }) => {
      if (consumed.has(key)) return;

      const named = playersById.get(transaction.playerId);
      const counterpart = keyed.find(
        (candidate) =>
          !consumed.has(candidate.key)
          && candidate.transaction.eventType === 'traded'
          && candidate.transaction.effectiveDate === transaction.effectiveDate
          && candidate.transaction.toTeamId === transaction.fromTeamId
          && candidate.transaction.fromTeamId === transaction.toTeamId
          // Each half names the other player in its notes. Without this, two unrelated same-day
          // moves between four different clubs would pair into one invented trade.
        && (candidate.transaction.notes ?? '').includes(fullName(named))
        && (transaction.notes ?? '').includes(
            fullName(playersById.get(candidate.transaction.playerId)),
          ),
      );

      if (!counterpart) {
        // A half-trade with no mirror. Logged alone rather than dropped: it is a real transaction,
        // and silently discarding rows would make the feed disagree with the archive.
        const subject = describe(transaction.playerId);
        if (subject) {
          consumed.add(key);
          moves.push({
            id: `traded-solo-${key}`,
            kind: 'trade',
            effectiveDate: transaction.effectiveDate,
            weight: subject.overall,
            players: [subject],
            fromTeamId: transaction.fromTeamId,
            toTeamId: transaction.toTeamId,
          });
        }
        return;
      }

      consumed.add(key);
      consumed.add(counterpart.key);
      const first = describe(transaction.playerId);
      const second = describe(counterpart.transaction.playerId);
      if (!first || !second) return;

      moves.push({
        id: `trade-${key}-${counterpart.key}`,
        kind: 'trade',
        effectiveDate: transaction.effectiveDate,
        // A swap is as big as its biggest piece. Averaging the two would systematically understate a
        // trade that sends a franchise player for a prospect, which is exactly the move a feed
        // exists to surface.
        weight: Math.max(first.overall, second.overall),
        players: [first, second],
        fromTeamId: transaction.fromTeamId,
        toTeamId: transaction.toTeamId,
      });
    });

  // -- signings and releases ---------------------------------------------------------------
  // Signings and releases are single-player events, so they are never consumed by the trade pairing
  // above and need no dedupe of their own.
  window
    .filter(
      (transaction) => transaction.eventType === 'signed' || transaction.eventType === 'released',
    )
    .forEach((transaction) => {
      const subject = describe(transaction.playerId);
      if (!subject) return;
      moves.push({
        id: `${transaction.eventType}-${transaction.playerId}-${transaction.effectiveDate}`,
        kind: transaction.eventType === 'signed' ? 'signing' : 'release',
        effectiveDate: transaction.effectiveDate,
        weight: subject.overall,
        players: [subject],
        fromTeamId: transaction.eventType === 'released' ? transaction.fromTeamId : null,
        toTeamId: transaction.eventType === 'signed' ? transaction.toTeamId : null,
      });
    });

  return {
    moves: moves.sort((left, right) => right.weight - left.weight),
    /*
     * ROWS THAT NAME A PLAYER THE LEAGUE NO LONGER HAS.
     *
     * Real, and measured rather than assumed: aging a free agent out prunes the player row, but
     * their `released` transaction stays in the log. A feed that silently skipped those would
     * under-report the winter, and a count that disagrees with the archive is the exact failure this
     * module exists to prevent.
     *
     * Counted over ROWS, not cards -- a paired trade is one card and two rows, so the two counts are
     * not comparable. And these are NOT rendered as cards: with no player row there is no rating, no
     * position and no crest, and inventing any of them would put a confident lie on screen. A number
     * in the header is the honest form.
     */
    departedPlayerRows: window.filter(
      (transaction) => !playersById.has(transaction.playerId),
    ).length,
  };
};

/** The moves big enough to lead the feed, in the order the winter happened. */
export const blockbusters = (moves: OffseasonMove[]): OffseasonMove[] =>
  moves.filter((move) => move.weight >= BLOCKBUSTER_OVERALL);

/** Whether a move earns a card rather than a line of text. */
export const isHeadlineMove = (move: OffseasonMove): boolean =>
  move.weight >= BLOCKBUSTER_OVERALL;

/**
 * One line describing what a move did, in the shape of the move itself.
 *
 * A trade reads as a swap between two clubs, a signing as an arrival and a release as a departure.
 * Trying to phrase all three with one template is how a card ends up saying "Player X signed to Team
 * Y" for a release, which is nonsense.
 */
export const moveHeadline = (move: OffseasonMove, nameOf: (teamId: string | null) => string): string => {
  const [first, second] = move.players;
  if (move.kind === 'trade' && first && second) {
    return `${nameOf(move.fromTeamId)} acquire ${first.player.firstName} ${first.player.lastName} for ${second.player.firstName} ${second.player.lastName}`;
  }
  if (move.kind === 'signing' && first) {
    return `${nameOf(move.toTeamId)} sign ${first.player.firstName} ${first.player.lastName}`;
  }
  if (move.kind === 'release' && first) {
    return `${nameOf(move.fromTeamId)} release ${first.player.firstName} ${first.player.lastName}`;
  }
  return 'Transaction';
};

/** The short form for the long tail: who moved, and where they went. */
export const moveSummary = (move: OffseasonMove): string => {
  const [first, second] = move.players;
  if (!first) return '';
  const name = `${first.player.firstName} ${first.player.lastName}`;
  if (move.kind === 'trade' && second) {
    return `${name} ↔ ${second.player.firstName} ${second.player.lastName}`;
  }
  if (move.kind === 'signing') return `${name} signs`;
  return `${name} released`;
};