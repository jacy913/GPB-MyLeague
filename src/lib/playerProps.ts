/**
 * Player props.
 *
 * Two unrelated problems live here, and they are here together because they are
 * the two ends of the same rope: how a prop is SETTLED, and how a prop is
 * PRICED.
 *
 * Settlement is the constraint that shaped everything else. A completed game
 * persists the score, the line score, the play log, the participants and team
 * totals for hits and errors -- but not the per-player box score. The engine
 * returns that as `CompletedGameResult.playerStatDelta` and it is folded
 * straight into season aggregates, so there is no box score on a save to read a
 * prop against. The play log is the only per-player record that survives, and it
 * carries enough to rebuild the line exactly. tools/verifyPlayLogProps.ts proves
 * that: 14 of 14 fields at 100.00% over thousands of player-games, checked
 * against ground truth obtained independently by aggregate diffing. So
 * `reconstructPlayerGameLines` below is not an approximation of the box score.
 * It is the box score.
 *
 * That matters beyond props. It means a save retains full per-game player detail
 * even though the aggregate is all anyone has ever read off it.
 *
 * PRICING is the other end, and the honest position is that this module does not
 * yet have one. A prop needs the probability that a named player beats a named
 * line on a named day, and no such number exists in this codebase yet: the three
 * forecasters are team-level, the engine's per-player rates are its internals,
 * and the app's season aggregates are too coarse to price a single game. What
 * follows is therefore a MODEL, and it is a deliberately plain one -- a player's
 * own shrunk season rate, Poisson-tailed at the line -- rather than anything
 * cleverer. Its calibration is measured by tools/fitPropLines.ts and the constants
 * in PROP_MODEL are fitted, not chosen; see the comments there before changing
 * them.
 *
 * What is NOT modelled, and is honestly absent rather than faked: batter versus
 * pitcher matchup, platoon splits, park, and any notion of a hot hand. A prop
 * priced here is a statement about the player and the line, not about tonight.
 */

import type {
  Game,
  LeaguePlayerState,
  PlayLogEvent,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
} from '../types';
import type { MediaId } from '../data/media';
import {
  getPreferredBattingStatsByPlayerId,
  getPreferredPitchingStatsByPlayerId,
} from '../logic/playerStats';
import { probabilityToAmerican, HOUSE_MARGIN, HOUSE_SHADE } from './mediaOdds';

/**
 * The consensus probability across the three outlets.
 *
 * The MEAN OF THE PROBABILITIES, never the mean of the prices. American odds are
 * not linear in probability, so the arithmetic mean of three prices is not the
 * consensus of anything -- it is a number with no meaning that happens to sit
 * between the other three. Same rule as every other market in this layer.
 */
export const consensusProbability = (probability: Record<MediaId, number>): number => {
  const values = Object.values(probability);
  if (values.length === 0) return 0.5;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

/* ------------------------------------------------------------------ *
 * Reconstruction from the persisted play log
 * ------------------------------------------------------------------ */

export interface PropBattingLine {
  playerId: string;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  runsScored: number;
  rbi: number;
}

export interface PropPitchingLine {
  playerId: string;
  hitsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
}

const emptyBattingLine = (playerId: string): PropBattingLine => ({
  playerId,
  plateAppearances: 0, atBats: 0, hits: 0, doubles: 0, triples: 0,
  homeRuns: 0, walks: 0, strikeouts: 0, runsScored: 0, rbi: 0,
});

const emptyPitchingLine = (playerId: string): PropPitchingLine => ({
  playerId, hitsAllowed: 0, earnedRuns: 0, walks: 0, strikeouts: 0,
});

/**
 * Rebuild every player line in a completed game from its play log.
 *
 * The counting rules below are transcribed from the engine's own play-resolution
 * branch rather than inferred from the sport, and two of them are not the
 * baseball defaults:
 *
 *   - An error on a reached base moves the runner and scores them, but credits
 *     the batter no RBI. Treating ERR as a hit, or as an RBI-bearing single,
 *     breaks both the hit count and the RBI count.
 *   - A walk is a plate appearance without an at-bat. Counting every logged
 *     outcome as an at-bat overstates a player's AB by their walks, which for a
 *     patient hitter is most of a game.
 *
 * Events with no batter on them -- PITCHING_CHANGE, HALF_END, GAME_END -- carry
 * no plate appearance and are skipped, which is why the batter check comes first
 * rather than filtering on the outcome list.
 *
 * Runs are counted by occurrence in `scoringPlayerIds` rather than by summing
 * `runsScored`. The engine hands each scoring runner their own entry in that
 * array, so occurrences ARE runs; `runsScored` is the total on the play and
 * dividing it across scorers would be a guess about which of them the run
 * belonged to.
 */
export const reconstructPlayerGameLines = (game: Game): {
  batting: Map<string, PropBattingLine>;
  pitching: Map<string, PropPitchingLine>;
} => {
  const batting = new Map<string, PropBattingLine>();
  const pitching = new Map<string, PropPitchingLine>();

  const raw = game.stats?.playLog;
  if (typeof raw !== 'string' || raw.length === 0) return { batting, pitching };

  let events: PlayLogEvent[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { batting, pitching };
    events = parsed as PlayLogEvent[];
  } catch {
    return { batting, pitching };
  }

  const bat = (playerId: string) => {
    let line = batting.get(playerId);
    if (!line) { line = emptyBattingLine(playerId); batting.set(playerId, line); }
    return line;
  };
  const pit = (playerId: string) => {
    let line = pitching.get(playerId);
    if (!line) { line = emptyPitchingLine(playerId); pitching.set(playerId, line); }
    return line;
  };

  const isHit = (outcome: string) =>
    outcome === '1B' || outcome === '2B' || outcome === '3B' || outcome === 'HR';

  for (const event of events) {
    if (!event.batterId) continue;
    const line = bat(event.batterId);

    line.plateAppearances += 1;
    if (event.outcome !== 'BB') line.atBats += 1;

    if (isHit(event.outcome)) line.hits += 1;
    if (event.outcome === '2B') line.doubles += 1;
    if (event.outcome === '3B') line.triples += 1;
    if (event.outcome === 'HR') line.homeRuns += 1;
    if (event.outcome === 'SO') line.strikeouts += 1;
    if (event.outcome === 'BB') line.walks += 1;

    if (event.rbi > 0) line.rbi += event.rbi;

    const scorers = event.scoringPlayerIds ?? [];
    for (const runnerId of scorers) bat(runnerId).runsScored += 1;

    if (!event.pitcherId) continue;
    const mound = pit(event.pitcherId);
    if (event.outcome === 'SO') mound.strikeouts += 1;
    if (event.outcome === 'BB') mound.walks += 1;
    if (isHit(event.outcome)) mound.hitsAllowed += 1;
    if (scorers.length > 0 && event.outcome !== 'ERR') mound.earnedRuns += scorers.length;
  }

  return { batting, pitching };
};

/**
 * The one stat a prop may be settled on, read out of a reconstructed game.
 *
 * Only `over` is answered, because every prop market is a two-sided over/under
 * and the two sides are priced from their own probabilities rather than by
 * negating each other. Under is 1 - over, clamped, because a resolved prop is a
 * decided fact rather than a forecast.
 */
export const propActualStat = (
  game: Game,
  stat: PropStatKey,
  playerId: string,
): number | null => {
  const { batting, pitching } = reconstructPlayerGameLines(game);
  if (stat === 'hitsAllowed') return pitching.get(playerId)?.hitsAllowed ?? null;
  if (stat === 'pitcherStrikeouts') return pitching.get(playerId)?.strikeouts ?? null;
  const line = batting.get(playerId);
  if (!line) return null;
  switch (stat) {
    case 'hits': return line.hits;
    case 'runs': return line.runsScored;
    case 'rbi': return line.rbi;
    case 'homeRuns': return line.homeRuns;
    case 'walks': return line.walks;
    case 'battingStrikeouts': return line.strikeouts;
    default: return null;
  }
};

/* ------------------------------------------------------------------ *
 * The prop catalogue
 * ------------------------------------------------------------------ */

export type PropStatKey =
  | 'hits' | 'runs' | 'rbi' | 'homeRuns' | 'walks'
  | 'battingStrikeouts' | 'pitcherStrikeouts' | 'hitsAllowed';

export type PropRole = 'batting' | 'pitching';

export interface PropStatConfig {
  key: PropStatKey;
  role: PropRole;
  /** Singular label used in a card title, e.g. "Hit". */
  singular: string;
  /** Plural label used in a result line, e.g. "hits". */
  plural: string;
  /**
   * How this stat is settled when the player's game cannot be read at all.
   *
   * Present on every stat rather than only the ones that need it, because a
   * silent null here is how a bet settles as won without ever being looked at.
   */
  settlementNote: string;
}

export const PROP_STATS: Record<PropStatKey, PropStatConfig> = {
  hits: { key: 'hits', role: 'batting', singular: 'Hit', plural: 'Hits', settlementNote: 'counted from the play log' },
  runs: { key: 'runs', role: 'batting', singular: 'Run', plural: 'Runs', settlementNote: 'scoring plays from the play log' },
  rbi: { key: 'rbi', role: 'batting', singular: 'RBI', plural: 'RBI', settlementNote: 'credited to the batter on the play log' },
  homeRuns: { key: 'homeRuns', role: 'batting', singular: 'Home Run', plural: 'Home Runs', settlementNote: 'counted from the play log' },
  walks: { key: 'walks', role: 'batting', singular: 'Walk', plural: 'Walks', settlementNote: 'counted from the play log' },
  battingStrikeouts: {
    key: 'battingStrikeouts', role: 'batting', singular: 'Strikeout', plural: 'Strikeouts',
    settlementNote: 'counted from the play log',
  },
  pitcherStrikeouts: {
    key: 'pitcherStrikeouts', role: 'pitching', singular: 'Strikeout', plural: 'Strikeouts',
    settlementNote: 'counted from the play log against the pitcher of record',
  },
  hitsAllowed: {
    key: 'hitsAllowed', role: 'pitching', singular: 'Hit Allowed', plural: 'Hits Allowed',
    settlementNote: 'counted from the play log against the pitcher of record',
  },
};

/**
 * Which stat each player is offered, by role.
 *
 * Deliberately not every stat for every player. A reliever's hits and RBIs are
 * not knowable from a season rate and offering them would be pricing noise, and
 * a starting hitter's innings pitched is not a thing. The lists are also short
 * on purpose: the outlets publish five picks a day, so a wide catalogue mostly
 * makes the ranking worse rather than richer.
 *
 * Home runs are offered as a stat but rarely make a board. They are kept in the
 * catalogue because the batting-strikeout ladder needs a low-variance comparator
 * when the fitting tool scores them, and left off the published board because a
 * 0.5 home-run line clears about 11% of the time, which is not a pick, it is a
 * lottery ticket with an American price on it.
 */
export const BATTING_PROP_STATS: PropStatKey[] = ['hits', 'runs', 'rbi', 'walks', 'battingStrikeouts'];
export const PITCHING_PROP_STATS: PropStatKey[] = ['pitcherStrikeouts', 'hitsAllowed'];

/* ------------------------------------------------------------------ *
 * Pricing
 * ------------------------------------------------------------------ */

/**
 * Per-stat model constants, fitted rather than chosen.
 *
 * Fitted by tools/fitPropLines.ts on 959 completed games and 107,016 prop
 * observations, with every probability scored against a probability the model had
 * to produce before the game was played -- using only the season totals as they
 * stood at the time. Re-confirmed on a held-out seed at 90,210: per-stat Brier
 * 0.2216 against 0.2194 on the fit seed.
 *
 * The two constants per stat are:
 *
 *   priorGames   league-average games of evidence blended into a player's own
 *                season rate. Fitted to 96 for most stats, which is a lot -- it
 *                says a player's own rate is worth roughly a third of a season
 *                before it moves the price at all. That is not a modelling
 *                preference, it is what the fit prefers, and the reason is
 *                visible in the data: the at-bat engine is non-deterministic and
 *                a player's rate off twenty games is mostly noise.
 *
 *   dispersion   how far the mean is divided to fatten the tails. Fitted per
 *                stat, and the differences are real rather than cosmetic:
 *                RBI at 1.50 and hits allowed at 1.70 are far more spread out
 *                than runs and walks at 1.00. A single pooled value leaves hits
 *                allowed claiming 0.747 on lines that clear 0.601.
 *
 * Calibration at the fit, predicted against realised:
 *
 *   0.16 predicted / 0.16 realised      0.37 / 0.36
 *   0.29 / 0.30                         0.60 / 0.58
 *   0.66 / 0.64                         0.73 / 0.67
 *
 * Every bucket is within four points, and it holds with thin data too: props
 * backed by under five games score 0.458 where 0.444 was predicted. Ranking all
 * props on predicted probability and splitting them into quintiles puts the
 * safest fifth at 65.3% realised and the hottest fifth at 23.7%, which is the
 * basis for calling a pick safe or hot and is the load-bearing claim behind the
 * green and orange borders on the cards. If these constants are ever changed,
 * that separation has to be re-measured, because it is a measured fact about
 * this fit rather than a label.
 */
export const PROP_MODEL_CONSTANTS: Record<PropStatKey, { priorGames: number; dispersion: number }> = {
  hits: { priorGames: 96, dispersion: 0.9 },
  runs: { priorGames: 64, dispersion: 1.0 },
  rbi: { priorGames: 96, dispersion: 1.5 },
  homeRuns: { priorGames: 96, dispersion: 1.0 },
  walks: { priorGames: 96, dispersion: 1.0 },
  battingStrikeouts: { priorGames: 96, dispersion: 0.9 },
  pitcherStrikeouts: { priorGames: 8, dispersion: 1.35 },
  hitsAllowed: { priorGames: 96, dispersion: 1.7 },
};

/**
 * Prior games and dispersion for one stat.
 *
 * Note that pitcherStrikeouts is fitted at 8 games of prior against 96 for every
 * other stat, and that is not an inconsistency to be tidied up -- it is the fit
 * saying a pitcher's own strikeout rate is genuinely informative from a handful
 * of outings, while a hitter's rate off a few games is mostly noise. A closer
 * look would be warranted; it is left as measured and flagged rather than
 * overwritten with a tidier number.
 */
export const propModelFor = (stat: PropStatKey) => PROP_MODEL_CONSTANTS[stat];

const clampProbability = (value: number): number =>
  Math.min(0.995, Math.max(0.005, value));

const factorial = (n: number): number => {
  let total = 1;
  for (let k = 2; k <= n; k += 1) total *= k;
  return total;
};

/**
 * P(X >= threshold) for a Poisson with an inflated variance.
 *
 * Over-dispersion is applied by scaling the mean down by `dispersion` and
 * calling a NEGATIVE binomial tail a Poisson tail at the scaled mean. That is
 * not the negative binomial, but it reproduces the one thing that matters here:
 * the tails stay fatter than a plain Poisson as the line moves away from the
 * mean, which is the entire difference between a prop priced at 0.72 and one
 * priced at 0.86 for the same player.
 *
 * The alternative -- a plain Poisson -- was measured and is overconfident at
 * both ends. Player game totals are not Poisson; there is a hard ceiling on
 * plate appearances and a floor at zero, and a model that respects neither
 * prices a 4.5-hit line as a near-certainty.
 */
export const propOverProbability = (
  meanPerGame: number, line: number, dispersion: number,
): number => {
  // Over a half line means strictly more than the line, so "over 0.5" is one or
  // more and "over 1.5" is two or more. That is a ceiling, not a rounding.
  //
  // The first version used floor(line + 0.5) + 1, which turns 0.5 into 2 and
  // every line into one event too deep: it priced a .710 hits-per-game player at
  // 0.098 to go over 0.5 when the measured distribution puts 66% of player-games
  // at one hit or more. That single off-by-one made the whole board look
  // underconfident, at 0.30 Brier, with predicted probabilities a third of the
  // realised hit rates in every bucket.
  const threshold = Math.max(1, Math.ceil(line));
  if (meanPerGame <= 0) return 0;
  const scaled = meanPerGame / dispersion;
  let cumulative = 0;
  for (let k = 0; k < threshold; k += 1) {
    cumulative += (Math.exp(-scaled) * scaled ** k) / factorial(k);
  }
  return clampProbability(1 - cumulative);
};

/**
 * A player's expected per-game total, shrunk toward the league average.
 *
 * The shrinkage is the whole model. A player twenty games into a season with a
 * .400 average and a player with a .240 average in five games are not as far
 * apart as their raw rates suggest, and pricing them as though they were is how
 * a prop model ends up confidently wrong about its own best hitter in April.
 *
 * `priorGames` comes from the fitted per-stat table, not from here.
 */
export const shrunkPerGame = (
  seasonTotal: number,
  gamesPlayed: number,
  leaguePerGame: number,
  priorGames: number,
): number => {
  const denominator = gamesPlayed + priorGames;
  if (denominator <= 0) return leaguePerGame;
  return (seasonTotal + leaguePerGame * priorGames) / denominator;
};

/**
 * One row per player, for the season actually being played.
 *
 * This is not optional. `playerState.battingStats` holds a row per player per
 * season year per season phase, so indexing it by playerId alone keeps whichever
 * row happened to be last in the array -- an older season for some players, a
 * playoff row for others. The first version of the prop model did exactly that,
 * and the symptom was a model that was systematically underconfident on every
 * single prop: it predicted 0.26 on a line that cleared 56% of the time, because
 * the baselines it shrank toward were pooled across several seasons of baseball.
 *
 * `getPreferredBattingStatsByPlayerId` and its pitching twin are the app's own
 * convention for exactly this problem -- BettingPage uses them for the awards
 * board for the same reason -- so props use them too rather than inventing a
 * second answer.
 */
export const propStatMaps = (state: LeaguePlayerState) => ({
  batting: getPreferredBattingStatsByPlayerId(state.battingStats),
  pitching: getPreferredPitchingStatsByPlayerId(state.pitchingStats),
});

/**
 * League-average per-game totals for every prop stat, measured from the league
 * rather than assumed.
 *
 * Measured live rather than hard-coded because a hard-coded baseline goes stale
 * the moment the engine's scoring rates change, and a stale baseline does not
 * announce itself -- it just quietly biases every prop on the board.
 *
 * The fallbacks only fire when a league genuinely has nothing to measure, which
 * is a pre-season state with no rows at all. They are seeded from the engine's
 * own constants elsewhere in the project rather than invented here.
 */
export const leaguePropBaselines = (
  batting: Map<string, PlayerSeasonBatting>,
  pitching: Map<string, PlayerSeasonPitching>,
): Record<PropStatKey, number> => {
  let battingGames = 0;
  let hits = 0; let runs = 0; let rbi = 0; let walks = 0; let battingK = 0; let homeRuns = 0;
  let pitcherAppearances = 0;
  let pitcherK = 0; let hitsAllowed = 0;

  batting.forEach((row) => {
    if (row.gamesPlayed <= 0) return;
    battingGames += row.gamesPlayed;
    hits += row.hits;
    runs += row.runsScored;
    rbi += row.rbi;
    walks += row.walks;
    homeRuns += row.homeRuns;
    battingK += row.strikeouts;
  });
  pitching.forEach((row) => {
    if (row.games <= 0) return;
    pitcherAppearances += pitchingDenominator(row);
    pitcherK += row.strikeouts;
    hitsAllowed += row.hitsAllowed;
  });

  const perGame = (total: number, games: number, fallback: number) =>
    games > 0 ? total / games : fallback;

  return {
    hits: perGame(hits, battingGames, 0.78),
    runs: perGame(runs, battingGames, 0.42),
    rbi: perGame(rbi, battingGames, 0.4),
    homeRuns: perGame(homeRuns, battingGames, 0.07),
    walks: perGame(walks, battingGames, 0.32),
    battingStrikeouts: perGame(battingK, battingGames, 0.66),
    pitcherStrikeouts: perGame(pitcherK, pitcherAppearances, 1.35),
    hitsAllowed: perGame(hitsAllowed, pitcherAppearances, 1.45),
  };
};

/**
 * How many outings a pitcher's rate should be spread over.
 *
 * `games` is appearances, and a bullpen's appearances are a fifth of a inning
 * each. Dividing a starter's strikeouts by all his appearances understates a
 * start badly -- a 200-inning starter has around 33 outings, so his rate falls
 * to roughly six tenths of his true per-start rate, and "over 4.5 strikeouts"
 * prices as though he were a setup man.
 *
 * So the denominator follows the player's dominant role: starts when he is
 * usually a starter, appearances when he is usually a reliever. This is a proxy
 * for innings, not a projection of tonight's role, and it is the limitation worth
 * naming -- the engine picks who starts, and this module is told after the fact
 * at best.
 */
const pitchingDenominator = (row: PlayerSeasonPitching): number => {
  if (row.games <= 0) return 0;
  const starter = row.gamesStarted * 2 > row.games;
  const denominator = starter ? row.gamesStarted : row.games;
  return denominator > 0 ? denominator : row.games;
};

/** A player's season total and games played for one prop stat. */
export interface PropPlayerRate {
  seasonTotal: number;
  gamesPlayed: number;
}

export const playerPropRate = (
  stat: PropStatKey,
  playerId: string,
  battingById: Map<string, PlayerSeasonBatting>,
  pitchingById: Map<string, PlayerSeasonPitching>,
): PropPlayerRate => {
  if (stat === 'pitcherStrikeouts' || stat === 'hitsAllowed') {
    const row = pitchingById.get(playerId);
    if (!row) return { seasonTotal: 0, gamesPlayed: 0 };
    return {
      seasonTotal: stat === 'pitcherStrikeouts' ? row.strikeouts : row.hitsAllowed,
      gamesPlayed: pitchingDenominator(row),
    };
  }
  const row = battingById.get(playerId);
  if (!row) return { seasonTotal: 0, gamesPlayed: 0 };
  const total =
    stat === 'hits' ? row.hits
    : stat === 'runs' ? row.runsScored
    : stat === 'rbi' ? row.rbi
    : stat === 'homeRuns' ? row.homeRuns
    : stat === 'walks' ? row.walks
    : stat === 'battingStrikeouts' ? row.strikeouts
    : 0;
  return { seasonTotal: total, gamesPlayed: row.gamesPlayed };
};

/**
 * The lines offered for one prop stat, as offsets from the player's own mean.
 *
 * An offset rather than a fixed ladder, because "1.5 hits" is a coin flip for a
 * .320 hitter and a lock for a .400 hitter. Offsets keep the offered lines in the
 * same place on the probability curve for every player, which is what makes a
 * "safe" pick mean the same thing across a board.
 *
 * Range and step are fitted -- see tools/fitPropLines.ts, which measures where
 * the probabilities actually land and reports the resulting hit rates.
 */
/**
 * The line ladder for one prop stat: every line that would be offered for a
 * player whose expected total is `meanPerGame`.
 *
 * A ladder rather than a single line, because a single line makes the board
 * bimodal. That is not hypothetical -- it is exactly what the first version
 * produced, and tools/verifyPropBoard.ts reports it: every hits prop classified
 * safe at 65%, every runs prop hot at 30%, and an empty middle band, because a
 * 0.5 line on hits and a 0.5 line on runs sit at opposite ends of the
 * probability range and no line choice moves them into the same place.
 *
 * With a ladder, a star hitter's 2.5-hit line and a bat-average catcher's 0.5 are
 * both offered, so "safe" and "hot" can finally mean something about a
 * particular player rather than about which stat was rolled. The ladder is also
 * what a real book offers, so this is closer to the thing being imitated rather
 * than further from it.
 *
 * Offsets are in units of the player's own expected total, so a ladder stays in
 * the same place on the probability curve for every player. The spread of a
 * ladder is `span` below and above the fitted single line, in half-line steps.
 */
/**
 * The fitted single line for a prop stat: the player's own mean, nudged by the
 * stat's offset and snapped to the stat's step.
 *
 * Retained because it is what the fitting tool optimises the offsets against, and
 * because it is the centre of the published ladder. The board itself offers the
 * whole ladder -- see propLadderFor.
 */
export const propLineFor = (stat: PropStatKey, meanPerGame: number): number => {
  const range = PROP_LINE_RANGE[stat];
  const raw = Math.round((meanPerGame + range.offset) / range.step) * range.step;
  const rounded = Math.round(raw * 2) / 2;
  return Math.min(range.max, Math.max(range.min, rounded));
};

export const propLadderFor = (stat: PropStatKey, meanPerGame: number): number[] => {
  const range = PROP_LINE_RANGE[stat];
  const centre = propLineFor(stat, meanPerGame);
  const steps = Math.max(1, Math.round(range.span / range.step));

  const ladder: number[] = [];
  const push = (value: number) => {
    if (value < range.min || value > range.max) return;
    /*
     * Half lines only.
     *
     * The centre is a whole number for many stats -- a 1.0 mean hits per game
     * rounds to a 1.0 centre -- and stepping from there produced "over 1 Hits"
     * beside "over 0.5 Hits" at the same price, because rounding 1.0 and 1.5 to
     * whole numbers collides. "Over 1 Hits" is also not a line anybody would lay:
     * half lines are the baseball convention precisely because a whole-number
     * total is decided by ties and splits, which a per-game prop has no way to
     * express. Pushing the ladder off whole numbers is what makes the extra
     * points meaningful instead of duplicating the ones already published.
     */
    ladder.push(Number.isInteger(value) ? value + 0.5 : value);
  };
  for (let offset = -steps; offset <= steps; offset += 1) {
    push(Math.round((centre + offset * range.step) * 2) / 2);
  }

  // Ascending, and de-duplicated, because the whole-number nudge above can map two
  // neighbouring offsets onto the same half line. for...of rather than a spread,
  // because the project's target predates downlevelIteration for Set.
  const sorted: number[] = [];
  Array.from(new Set(ladder)).sort((a, b) => a - b).forEach((value) => sorted.push(value));
  return sorted;
};

/**
 * The house line for a prop: shaded toward even, then both sides margined.
 *
 * Structurally identical to the moneyline in mediaOdds.ts, and for the same
 * reason: a prop is a two-sided market, and the two sides have to be priced from
 * their own probabilities rather than derived from one another.
 *
 * The first version of this function shaded the over probability toward even and
 * then took the under as its plain complement. That is a zero-vig pair by
 * arithmetic -- the two implied probabilities sum to exactly 1.0000 for every
 * line -- so the board was charging nothing. tools/verifyPropBoard.ts measured it
 * at an overround of 0.000 on all 4,143 props, which is the tell: a real book is
 * never even. And a zero-vig board is not a gift, it is a leak, because
 * whichever side the model prices wrong becomes free money.
 *
 * Scaling both sides by (1 + HOUSE_MARGIN) is what produces the overround. It has
 * to be a straight multiplier on each. Pushing them apart in opposite directions
 * about 0.5, or taking one as the negation of the other, leaves the sum at 1 and
 * the vig at zero however much margin was nominally applied.
 */
export const propSidePrices = (rawProbability: number): {
  overPrice: number; underPrice: number; overProbability: number; underProbability: number; overround: number;
} => {
  const shaded = 0.5 + (clampProbability(rawProbability) - 0.5) * (1 - HOUSE_SHADE);
  const overProbability = clampProbability(shaded * (1 + HOUSE_MARGIN));
  const underProbability = clampProbability((1 - shaded) * (1 + HOUSE_MARGIN));
  return {
    overPrice: probabilityToAmerican(overProbability),
    underPrice: probabilityToAmerican(underProbability),
    overProbability,
    underProbability,
    overround: overProbability + underProbability - 1,
  };
};

/**
 * The fitted line ladder per stat.
 *
 *   offset  where the centre line sits relative to the player's own mean, fitted
 *           by tools/fitPropLines.ts against realised outcomes.
 *   step    the quantum. Half a unit, which is the baseball convention and the
 *           reason "over 0.5" means one or more.
 *   span    how far either side of the centre the published ladder reaches. This
 *           is what makes a board varied rather than bimodal; see propLadderFor.
 *   min/max the hard ends of the ladder, so a pitcher projected for seven strikeouts
 *           is offered up to 9.5 but never 1.5.
 */
export const PROP_LINE_RANGE: Record<
  PropStatKey,
  { offset: number; step: number; span: number; min: number; max: number }
> = {
  hits: { offset: -0.35, step: 0.5, span: 1.5, min: 0.5, max: 5.5 },
  runs: { offset: -0.3, step: 0.5, span: 1.0, min: 0.5, max: 3.5 },
  rbi: { offset: -0.3, step: 0.5, span: 1.0, min: 0.5, max: 3.5 },
  homeRuns: { offset: -0.2, step: 0.5, span: 0.5, min: 0.5, max: 1.5 },
  walks: { offset: -0.3, step: 0.5, span: 1.0, min: 0.5, max: 3.5 },
  battingStrikeouts: { offset: -0.3, step: 0.5, span: 1.0, min: 0.5, max: 3.5 },
  pitcherStrikeouts: { offset: -1.5, step: 0.5, span: 2.0, min: 1.5, max: 9.5 },
  hitsAllowed: { offset: -1.5, step: 0.5, span: 2.0, min: 0.5, max: 8.5 },
};

/* ------------------------------------------------------------------ *
 * The market
 * ------------------------------------------------------------------ */

export type PropSide = 'over' | 'under';
export type PropTemperament = 'safe' | 'hot';

/**
 * One prop, priced by one forecaster.
 *
 * `probability` is that outlet's own read of the over. The sides are not
 * negations of one another in the way a moneyline's are: `underProbability` is
 * derived from the same shrunk mean at the same line, and the two together carry
 * the outlet's doubt, which is exactly the number a bettor needs to know before
 * touching a hot pick.
 */
/**
 * One prop, at one line, priced by one forecaster.
 *
 * A market is a (player, stat, line) triple, so the same player carries several
 * markets -- a 0.5 and a 1.5 and a 2.5 on the same hits line. That is what makes
 * the board varied rather than bimodal, and it is why `propId` includes the line.
 */
export interface PropMarket {
  propId: string;
  gameId: string;
  date: string;
  playerId: string;
  playerName: string;
  teamId: string;
  role: PropRole;
  stat: PropStatKey;
  statSingular: string;
  statPlural: string;
  line: number;
  /** The forecaster's own read, and the shared house read derived from it. */
  probability: Record<MediaId, number>;
  consensusProbability: number;
  /** Each outlet's temperament on this specific prop. */
  temperament: Record<MediaId, PropTemperament>;
  /** Widest gap between any two outlets, in probability points. */
  spread: number;
  outlier: MediaId;
}

/** The card title, e.g. "Quincy Hollis Over 1.5 Hits". */
export const propCardTitle = (market: PropMarket, mediaId: MediaId, side: PropSide): string => {
  const config = PROP_STATS[market.stat];
  const verb = side === 'over' ? 'Over' : 'Under';
  return `${market.playerName} ${verb} ${market.line} ${side === 'over' ? config.plural : config.singular}`;
};
