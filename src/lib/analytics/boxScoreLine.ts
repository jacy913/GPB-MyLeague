/*
 * What a player did in one game, as a line of text.
 *
 * THE BOX-SCORE LINE AND THE SETTLED PROP MUST READ THE SAME WAY, and this is the one place that
 * decides that. They are answering the same question on two screens -- "how did he do" -- and they were
 * going to be written as two functions, which is how a manager ends up reading "1/4" on the game screen
 * and "went 1" on the betting record and having to work out whether those are the same fact.
 *
 * So both call this. The format is chosen to survive being printed twice at different sizes:
 *
 *   `1 for 4  ·  1 HR  ·  2 SO`
 *
 * "1 for 4" rather than "1/4" because the fraction is the phrase a reader parses instantly and the
 * slash is not, and because "1/4" next to a batting average of .254 is genuinely ambiguous.
 *
 * ONLY WHAT A PLAYER DID, NEVER WHAT IT WAS WORTH. No OPS, no AVG, nothing derived here. Those are
 * season figures and this is one night; a reader who wants the season has a screen for it.
 */
import type { PropBattingLine, PropPitchingLine } from '../playerProps';

/** `reconstructPlayerGameLines` shapes. Re-declared narrowly so this file does not import the engine. */
export interface GameBattingLine {
  atBats: number;
  hits: number;
  runsScored: number;
  rbi: number;
  homeRuns: number;
  doubles: number;
  triples: number;
  walks: number;
  strikeouts: number;
}

export interface GamePitchingLine {
  /**
   * `PropPitchingLine` has NO innings field, and that is worth being precise about rather than
   * working around quietly.
   *
   * The reconstruction counts what a pitcher was charged with -- hits, walks, strikeouts, earned runs
   * -- and not how long they lasted. So there is no "5 2/3 IP" available here, and printing one would
   * be inventing it. What a pitcher's line therefore shows is the four things that were actually
   * counted, which is enough to read the night and not enough to pretend it is a full box score.
   *
   * If innings are wanted they have to come from the game engine's own pitching line, which is a
   * different source and not one this function should reach into.
   */
  strikeouts?: number;
  walks?: number;
  hitsAllowed?: number;
  earnedRuns?: number;
}

/**
 * The parts worth printing, in the order a reader expects them: the headline, then the damage, then
 * the discipline.
 *
 * NOTHING is printed for a category that did not happen. A player who walked three times and hit
 * nothing gets "0 for 3 · 3 BB" and not a row of four zeroes, because a line of zeros reads as a
 * failure rather than as a night in which the only thing that happened was walking.
 */
export const battingGameLine = (line: GameBattingLine): string => {
  const parts: string[] = [`${line.hits} for ${line.atBats}`];

  // A walk or a strikeout is only worth stating when it was the other thing that happened. On a
  // 3-for-4 with a walk the walk is noise; on a 0-for-4 with three walks it is the story.
  if (line.hits === 0) {
    if (line.walks > 0) parts.push(`${line.walks} BB`);
    if (line.strikeouts > 0) parts.push(`${line.strikeouts} SO`);
  } else {
    if (line.homeRuns > 0) parts.push(`${line.homeRuns} HR`);
    if (line.runsScored > 0) parts.push(`${line.runsScored} R`);
    if (line.rbi > 0) parts.push(`${line.rbi} RBI`);
    if (line.strikeouts > 0) parts.push(`${line.strikeouts} SO`);
  }
  return parts.join('  ·  ');
};

/**
 * A pitcher's line, which is a different shape of sentence from a batter's.
 *
 * FOUR FIGURES, because four is what the reconstruction counted. There is no innings figure here and
 * the function does not approximate one -- see `GamePitchingLine`.
 */
export const pitchingGameLine = (line: GamePitchingLine): string => {
  const parts: string[] = [];
  if (line.strikeouts) parts.push(`${line.strikeouts} K`);
  if ((line.hitsAllowed ?? 0) > 0) parts.push(`${line.hitsAllowed} H`);
  if ((line.walks ?? 0) > 0) parts.push(`${line.walks} BB`);
  if ((line.earnedRuns ?? 0) > 0) parts.push(`${line.earnedRuns} ER`);
  return parts.join('  ·  ');
};

/**
 * THE SINGULAR STRING A LINEUP ROW SHOWS, chosen per player.
 *
 * A pitcher gets the pitching line and a batter gets the batting one, and the decision is made on the
 * presence of a pitching line rather than on a position label -- because a position string is a
 * display label that can be wrong, and "did he actually throw" cannot.
 */
export const gameLineFor = (
  playerId: string,
  batting: Map<string, PropBattingLine>,
  pitching: Map<string, PropPitchingLine>,
): string | undefined => {
  const arm = pitching.get(playerId);
  const bat = batting.get(playerId);

  // A starter's own offence comes first: a pitcher who went two-for-three is the headline, and the
  // innings pitched are the footnote. Both are printed when both happened.
  const parts: string[] = [];
  if (arm && pitchingGameLine(arm).length > 0) parts.push(pitchingGameLine(arm));
  if (bat && bat.atBats > 0) parts.push(battingGameLine(bat));

  return parts.length ? parts.join('   /   ') : undefined;
};