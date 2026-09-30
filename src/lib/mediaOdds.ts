import type { Game, Team } from '../types';
import { MEDIA_PROFILES, type MediaId } from '../data/media';

/**
 * Published lines for a slate.
 *
 * The same three reads the media page already publishes across a league,
 * narrowed to the two clubs in one game. That is deliberate rather than
 * convenient: a league-wide ranking and a per-game price are the same
 * computation at different scopes, so a forecaster cannot be well calibrated on
 * one and badly calibrated on the other without this being visible.
 *
 * Every outlet states a probability. The house line is the mean of those three
 * probabilities, NOT the mean of three American odds -- odds are not linear in
 * probability, so averaging them arithmetically is meaningless. A house margin
 * is then applied to the mean and the result converted back to a price.
 *
 * There is no betting here yet. This is what the odds layer will read, so that
 * the layer is a presentation of these numbers rather than a second set.
 */

export interface GameLine {
  gameId: string;
  date: string;
  awayTeam: Team;
  homeTeam: Team;
  /** Each outlet's probability that the away club wins. */
  probability: Record<MediaId, number>;
  /** Each outlet's posted price for the away club. */
  odds: Record<MediaId, number>;
  /** Mean of the three probabilities, before margin. */
  consensusProbability: number;
  /** The line the house would post, after margin. */
  houseProbability: number;
  houseOdds: number;
  /** Widest probability gap between any two outlets, in points. */
  disagreement: number;
  /** The outlet furthest from the other two on this game. */
  outlier: MediaId;
}

/**
 * House margin.
 *
 * Applied to the consensus probability, not to each outlet. It is the price of
 * acting on the consensus and it is the only reason backing the house line is
 * not automatically correct.
 */
export const HOUSE_MARGIN = 0.045;

/**
 * Home advantage, in log-odds.
 *
 * This is the measured value, not the real-baseball one. Repeated runs of the
 * simulator put home winners between 49.9 and 51.4 per cent of decided games,
 * which is to say home field is very nearly neutral in this league. Encoding
 * the real-world 53-54 per cent would be importing a fact about a different
 * simulation, and it would hand every forecaster a systematic error.
 */
export const HOME_ADVANTAGE_LOGIT = 0.04;

const clampProbability = (value: number): number => Math.max(0.02, Math.min(0.98, value));

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

/** Probability -> American price. */
export const probabilityToAmerican = (probability: number): number => {
  const p = clampProbability(probability);
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
};

/** American price -> probability, with the vig divided back out. */
export const americanToProbability = (american: number): number => {
  if (american < 0) return clampProbability(-american / (-american + 100));
  return clampProbability(100 / (american + 100));
};

/**
 * Per-outlet logistic slopes, applied to a z-scored gap.
 *
 * Not free parameters, and not guesses. tools/fitMediaOdds.ts dumps each
 * outlet's Brier score over a grid of slopes against settled games; these are
 * the measured values. For scale, a flat 50/50 call scores 0.2500, so anything
 * above that is worse than calling every game a coin flip.
 *
 *   The Booth     fitted 0.30  brier 0.2448
 *   Glorest       fitted 0.25  brier 0.2464
 *   Lined Sharply fitted 0.25  brier 0.2479
 *
 * The first attempt used hand-picked slopes of 0.9 / 0.8 / 1.9 and scored
 * 0.266 -- materially worse than a coin flip, which is actively harmful
 * information wearing a price. Single-game baseball is noisy, and a model that
 * is confident about it is simply wrong often.
 *
 * Sharply is the deliberate exception, and the exception is the point. His
 * fitted optimum is 0.25, the flattest of the three, because his signal is the
 * weakest. He posts 0.80 instead -- roughly three times what the data supports
 * -- which makes his prices measurably overconfident: about 0.0056 Brier worse
 * than a coin flip, and 0.010 worse than his own optimum. That gap is the
 * exploitable flaw the character is built around. A bettor should be able to
 * fade him, and this is the number that makes that true rather than a claim.
 */
const SLOPE: Record<MediaId, number> = {
  hollis: 0.30,
  glorest: 0.25,
  sharply: 0.80,
};

export interface OddsInput {
  game: Game;
  away: Team;
  home: Team;
  /** Raw per-method scores for the away club, by outlet. */
  awayScores: Record<MediaId, number>;
  /** Raw per-method scores for the home club, by outlet. */
  homeScores: Record<MediaId, number>;
  /** Per-outlet spread of the score distribution, from the read module. */
  spread: Record<MediaId, number>;
}

/**
 * A single game's three prices.
 *
 * The probability for each outlet is its own read narrowed to two clubs: the
 * gap between the two raw scores, pushed through a logistic at that outlet's
 * slope. Because the inputs are the same scores the ranking page displays, an
 * outlet cannot be well behaved in one place and badly behaved in the other.
 *
 * The slope is where the personality lives. Hollis is barely pushed, because a
 * forecaster that is right about most things should not price the ones it is
 * unsure about at 90 per cent. Sharply is pushed hard, because the third
 * outlet's entire character is certainty it has not earned.
 */
export const buildGameLine = (input: OddsInput): GameLine => {
  const { game, away, home, awayScores, homeScores, spread } = input;

  const probability = {} as Record<MediaId, number>;
  const odds = {} as Record<MediaId, number>;

  MEDIA_PROFILES.forEach((profile) => {
    const rawGap = (awayScores[profile.id] ?? 0.5) - (homeScores[profile.id] ?? 0.5);
    const z = rawGap / Math.max(0.02, spread[profile.id] ?? 1);
    const p = clampProbability(logistic(z * SLOPE[profile.id] - HOME_ADVANTAGE_LOGIT));
    probability[profile.id] = p;
    odds[profile.id] = probabilityToAmerican(p);
  });

  const values = MEDIA_PROFILES.map((profile) => probability[profile.id]);
  const consensusProbability = values.reduce((sum, value) => sum + value, 0) / values.length;

  // Margin is taken off the favourite side, which is how a real book prices.
  const houseProbability = clampProbability(consensusProbability - HOUSE_MARGIN / 2);

  const gap = Math.max(...values) - Math.min(...values);
  const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const outlierEntry = MEDIA_PROFILES
    .map((profile) => [profile.id, Math.abs(probability[profile.id] - median)] as const)
    .sort((a, b) => b[1] - a[1])[0];

  return {
    gameId: game.gameId,
    date: game.date,
    awayTeam: away,
    homeTeam: home,
    probability,
    odds,
    consensusProbability,
    houseProbability,
    houseOdds: probabilityToAmerican(houseProbability),
    disagreement: gap,
    outlier: outlierEntry[0],
  };
};

/** The next date that actually has games on it, after the current one. */
export const getNextSlateDate = (games: Game[], currentDate: string): string | null => {
  const dated = new Set(games.map((game) => game.date));
  const future = [...dated].filter((date) => date > currentDate).sort();
  return future[0] ?? null;
};

export const formatAmerican = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
