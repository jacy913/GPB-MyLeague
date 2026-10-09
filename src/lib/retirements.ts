/**
 * Who retired, and how to say it.
 *
 * ============================================================================
 * WHY THE OFFSEASON NEEDS THIS AT ALL
 * ============================================================================
 *
 * `applyOffseasonRetirements` ages the league, resolves retirements, and returns a COUNT. That count
 * arrives as one line in a notice: "Aging complete: 7 retired". Seven players ended their careers
 * and the interface reported the plural.
 *
 * That is the whole reason the offseason reads as a checklist. A retirements step whose entire
 * visible result is an integer has nothing to attend to, and the one part of a winter that is
 * genuinely final gets the least ceremony of anything on the calendar.
 *
 * ============================================================================
 * WHY IT IS DERIVED RATHER THAN STORED
 * ============================================================================
 *
 * Everything here is read back out of `playerState`, and deliberately so. The alternative was
 * snapshotting the retiring players at the moment the stage ran and persisting that list -- which is
 * one more thing that can be lost, one more field to migrate, and one more source of disagreement
 * with the roster. A retired player is already `status: 'retired'` with a `retirementYear` stamped
 * on them, and that stamp is in the save for the same reason the archive is: because the game
 * needed it to be durable.
 *
 * So the wall is a pure read of persisted state, which means it renders identically before a
 * reload and after one. That is the same property the offseason recovery work depends on, and it
 * is why this is a module rather than a snapshot.
 *
 * ============================================================================
 * WHY THE FINAL CLUB COMES FROM THE TRANSACTION LOG
 * ============================================================================
 *
 * Retiring clears `teamId` to null, correctly: a retired player genuinely has no club. So the club
 * they belonged to is not on the player row any more, and the retirement transaction is the only
 * record of it. Null there is a real answer rather than a lookup failure -- a player can retire as
 * a free agent, and there is no crest to show for that.
 */

import type {
  LeaguePlayerState,
  Player,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
} from '../types';

/** A retiring player, resolved far enough to build a card. */
export interface RetirementRecord {
  player: Player;
  /** The club they last played for. Null when they retired as a free agent. */
  finalClubId: string | null;
  /** Rating at the moment of retirement, from the latest ratings the save holds. */
  overall: number;
  /** The season they ended on, or null when they never appeared. */
  battingLine: PlayerSeasonBatting | null;
  pitchingLine: PlayerSeasonPitching | null;
}

/**
 * Retirements are tiered for presentation, and the tiers are about how much of a hole this leaves.
 *
 * The headline threshold is 84, which is the same number `headlineEngine` uses to file a story about
 * a retirement. That is not a coincidence and it should not drift: a farewell screen that treats a
 * player as a headline act while the newsroom that covered his last season did not would be telling
 * two different stories about the same man.
 */
export const HEADLINE_RETIREMENT_OVERALL = 84;

/** A veteran: not a franchise player, but a career that was worth a paragraph. */
export const VETERAN_RETIREMENT_OVERALL = 72;

/**
 * A player's final season, read from the newest row at or before `seasonYear`.
 *
 * The comparison is `<=` and the sort is descending because a player who sat out the last months of
 * a season still belongs to that winter -- taking the newest available row, rather than demanding
 * one from that exact year, is what keeps a short-season appearance from dropping off a farewell.
 */
const latestLine = <T extends { playerId: string; seasonYear: number; seasonPhase: string }>(
  rows: T[],
  seasonYear: number,
): Map<string, T> => {
  const latest = new Map<string, T>();
  rows
    .filter((row) => row.seasonPhase === 'regular_season' && row.seasonYear <= seasonYear)
    .forEach((row) => {
      const current = latest.get(row.playerId);
      if (!current || row.seasonYear > current.seasonYear) {
        latest.set(row.playerId, row);
      }
    });
  return latest;
};

/**
 * The wall of players who ended their careers after `seasonYear`.
 *
 * Keyed off `retirementYear` rather than the transaction log's dates. The stamp is set at the moment
 * of retirement and never rewritten, so it cannot drift with a rescheduled season the way a date
 * window would, and it identifies a specific winter rather than a span of the calendar.
 *
 * Ordered by how much the retirement mattered -- rating first, then service -- because the whole
 * point of a farewell is that the order is the argument. A list sorted alphabetically would make a
 * 20-year ace and a second-year reserve read as equals.
 */
export const collectRetirements = (
  playerState: LeaguePlayerState,
  seasonYear: number,
): RetirementRecord[] => {
  const battingByPlayerId = latestLine(playerState.battingStats, seasonYear);
  const pitchingByPlayerId = latestLine(playerState.pitchingStats, seasonYear);

  const records = playerState.players
    .filter((player) => player.status === 'retired' && player.retirementYear === seasonYear)
    .map<RetirementRecord>((player) => ({
      player,
      finalClubId:
        playerState.transactions.find(
          (transaction) => transaction.playerId === player.playerId && transaction.eventType === 'retired',
        )?.fromTeamId ?? null,
      overall:
        playerState.battingRatings
          .filter((rating) => rating.playerId === player.playerId)
          .sort((left, right) => right.seasonYear - left.seasonYear)[0]?.overall
        ?? playerState.pitchingRatings
          .filter((rating) => rating.playerId === player.playerId)
          .sort((left, right) => right.seasonYear - left.seasonYear)[0]?.overall
        ?? 0,
      battingLine: battingByPlayerId.get(player.playerId) ?? null,
      pitchingLine: pitchingByPlayerId.get(player.playerId) ?? null,
    }));

  return records.sort((left, right) =>
    right.overall - left.overall || right.player.yearsPro - left.player.yearsPro,
  );
};

export type RetirementTier = 'headline' | 'veteran' | 'rank_and_file';

/**
 * Which tier a retirement falls into.
 *
 * The two cut points are `HEADLINE_RETIREMENT_OVERALL` and `VETERAN_RETIREMENT_OVERALL`, exported
 * so the tiers can be asserted against the same numbers the newsroom uses.
 */
export const retirementTier = (record: RetirementRecord): RetirementTier => {
  if (record.overall >= HEADLINE_RETIREMENT_OVERALL) return 'headline';
  if (record.overall >= VETERAN_RETIREMENT_OVERALL) return 'veteran';
  return 'rank_and_file';
};

/** The wall split into its tiers, each in the same order as the wall itself. */
export const tierRetirements = (
  records: RetirementRecord[],
): Record<RetirementTier, RetirementRecord[]> => ({
  headline: records.filter((record) => retirementTier(record) === 'headline'),
  veteran: records.filter((record) => retirementTier(record) === 'veteran'),
  rank_and_file: records.filter((record) => retirementTier(record) === 'rank_and_file'),
});

/**
 * One line summarising a career's final season, for the card under the name.
 *
 * Built from the side of the diamond the player actually played, and phrased as the numbers the
 * season produced rather than as a judgement about it. A two-way bat line and a pitching line read
 * differently because they ARE different, and collapsing them into one average would hide the only
 * interesting thing about either.
 */
export const finalSeasonSummary = (record: RetirementRecord): string => {
  const { battingLine, pitchingLine } = record;
  if (pitchingLine && (pitchingLine.games > 0 || pitchingLine.gamesStarted > 0)) {
    const parts = [
      `${pitchingLine.wins}-${pitchingLine.losses}`,
      pitchingLine.saves > 0 ? `${pitchingLine.saves} SV` : null,
      `${pitchingLine.inningsPitched.toFixed(1)} IP`,
      `${pitchingLine.strikeouts} K`,
      `${pitchingLine.era.toFixed(2)} ERA`,
    ].filter(Boolean);
    return parts.join('  ·  ');
  }
  if (battingLine && battingLine.plateAppearances > 0) {
    const parts = [
      `${Math.round(battingLine.avg * 1000)} AVG`,
      `${battingLine.homeRuns} HR`,
      `${battingLine.rbi} RBI`,
      `${battingLine.hits} H`,
    ];
    return parts.join('  ·  ');
  }
  return 'Did not appear this season';
};