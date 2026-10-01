/**
 * Where a player sits in a league, which is a different question from where they rank.
 *
 * The Leaders screen had rank and nothing else. "3rd of 700" says the third player on a
 * list has the third-largest number; it does not say whether that is exceptional, and on
 * a league where every club is within two runs of the same average, third is not
 * remarkable at all. Every number on that screen was therefore unreadable without a
 * reference the screen did not carry.
 *
 * This module supplies that reference. It is deliberately small and deliberately pure,
 * because it is the one piece of the leaders work that has to be right before anything
 * is drawn: every other thing on the new screen is a presentation of these numbers.
 *
 * ---------------------------------------------------------------------------
 * THE MEAN HERE IS A MEAN OF PLAYER RATES, NOT A LEAGUE AGGREGATE
 * ---------------------------------------------------------------------------
 *
 * These are different numbers and conflating them is a classic sabermetrics error.
 *
 *   mean of player rates   average of each player's .280, .241, .312, ...
 *   league aggregate       total hits / total at-bats across the whole league
 *
 * They differ because a player with 20 at-bats counts as much as one with 600 in the
 * first and 1/30th as much in the second. The aggregate is the honest "what did the
 * league hit", and it is what a reader comparing a *team* or a *season* wants. The mean
 * of rates is what describes the distribution the individual rows sit in, and it is what
 * a row can legitimately be compared against -- a .310 hitter is being compared with
 * other .310 hitters, not with a number that a short-season rookie helped drag downward.
 *
 * `mean` here is the mean of rates, and it is labelled "MEAN" on screen rather than
 * "LEAGUE AVG" so that nobody reads an aggregate into it. If an aggregate is ever wanted,
 * it is a second function and a second column, not a reinterpretation of this one.
 *
 * ---------------------------------------------------------------------------
 * WHY PERCENTILE AND NOT A Z-SCORE
 * ---------------------------------------------------------------------------
 *
 * A z-score is the better statistic and the wrong one here. It assumes the distribution
 * is roughly normal, and these are not: batting averages are bounded at both ends and
 * pile up near .250, so a handful of extreme seasons produce z-scores in the double
 * digits and compress everything else into an unreadable band. Percentile is
 * distribution-free, it needs no assumption, and it answers the question a reader
 * actually asks, which is "how many people are better than this".
 */

/** Which way is better for a given stat. `asc` is for ERA and WHIP. */
export type Better = 'asc' | 'desc';

/**
 * A pool of player-level values, summarised.
 *
 * Built once per board rather than per row: a percentile needs the whole distribution,
 * so computing it per row would make a ten-row board sort the league ten times.
 */
export interface Distribution {
  /** Mean of the player-level values. NOT an aggregate -- see the header note. */
  mean: number;
  /** Ascending. Kept sorted because the percentile search is a binary search. */
  sorted: number[];
  size: number;
  /** Direction that counts as better for the stat this distribution was built for. */
  better: Better;
}

/**
 * Summarise a pool.
 *
 * Non-finite values are dropped rather than coerced to zero. A rate of NaN is a player
 * with no at-bats, and treating that as .000 would put them at the bottom of a
 * leaderboard they never qualified for, which is a different and wrong claim.
 */
export const summarise = (values: readonly number[], better: Better): Distribution => {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const total = clean.reduce((sum, v) => sum + v, 0);
  return {
    mean: clean.length > 0 ? total / clean.length : 0,
    sorted: clean,
    size: clean.length,
    better,
  };
};

/**
 * Where a value sits in the distribution, 0-100.
 *
 * Counted as "the share of the pool strictly worse than this", divided by `size - 1` so
 * the best player lands on exactly 100 and the worst on exactly 0.
 *
 * STRICTLY worse, so tied players get the same percentile. That matters here because
 * these stats tie constantly -- two hitters at exactly .280 are genuinely tied and
 * showing them 71 and 72 would invent a difference that does not exist.
 *
 * A pool of one returns 100, because the player is both the best and the worst of the
 * only person who qualifies. Any other answer would be a claim about the league, and a
 * one-person league is not one.
 */
export const percentileOf = (value: number, distribution: Distribution): number => {
  const { sorted, size } = distribution;
  if (size <= 1) return size === 1 ? 100 : 0;
  if (!Number.isFinite(value)) return 0;

  // Number of pool members strictly worse than `value`, under this stat's direction.
  let strictlyWorse = 0;
  if (distribution.better === 'desc') {
    strictlyWorse = sorted.reduce((n, v) => (v < value ? n + 1 : n), 0);
  } else {
    strictlyWorse = sorted.reduce((n, v) => (v > value ? n + 1 : n), 0);
  }
  return (strictlyWorse / (size - 1)) * 100;
};

/**
 * A percentile as it is shown.
 *
 * One decimal above 90, because the top of a leaderboard is exactly where a reader
 * wants precision, and whole numbers elsewhere because `72` is already more than a
 * leaderboard can usefully distinguish. This is a display choice and is not the same as
 * the ranking -- it never is, which is the point of the column.
 */
export const formatPercentile = (percentile: number): string => {
  if (!Number.isFinite(percentile)) return '-';
  // The whole-number branch comes FIRST. An earlier draft had it last, behind the
  // `>= 90` test, which made it unreachable: the best player in a league of any size
  // scores 100, so `>= 90` caught them and printed "100.0". Dead code in a display
  // formatter is not harmless -- it is the branch that was written for a case the
  // author thought could happen and could not.
  if (percentile >= 99.95) return '100';
  if (percentile >= 90) return percentile.toFixed(1);
  return Math.round(percentile).toString();
};

/**
 * Where a value sits against the mean, in words.
 *
 * For the tooltip on the mean marker. Deliberately coarse: "about average" and "well
 * clear of it" are what a reader wants, and a two-decimal distance from the mean is a
 * number nobody acts on.
 */
export const describeVsMean = (
  value: number,
  distribution: Distribution,
): 'well below average' | 'below average' | 'about average' | 'above average' | 'well above average' => {
  if (distribution.size <= 1 || distribution.sorted[distribution.size - 1] === distribution.sorted[0]) {
    return 'about average';
  }
  const spread = Math.abs(distribution.sorted[distribution.size - 1] - distribution.sorted[0]);
  const offset = Math.abs(value - distribution.mean) / spread;
  if (offset < 0.1) return 'about average';
  if (offset < 0.28) return distribution.better === 'desc'
    ? (value > distribution.mean ? 'above average' : 'below average')
    : (value < distribution.mean ? 'above average' : 'below average');
  return value === distribution.mean
    ? 'about average'
    : (distribution.better === 'desc') === (value > distribution.mean)
      ? 'well above average'
      : 'well below average';
};