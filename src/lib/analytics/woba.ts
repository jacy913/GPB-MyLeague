/**
 * wOBA: weight on base average, fitted to THIS simulation.
 *
 * A wOBA weight is the expected runs a plate appearance scores when it resolves
 * that way. The level is the point, not a difference against a baseline, because
 * wOBA is read as "runs created per plate appearance" and wRC+ divides it by the
 * league's own run rate.
 *
 * THE WEIGHTS BELOW ARE MEASURED, NOT COPIED. tools/fitWobaWeights.ts fits them by
 * regressing runs scored on a plate appearance against outcome, holding the
 * number of runners aboard as a control, and reading off the conditional mean for
 * each outcome. The constants are the MEAN over three 90-day replicates at
 * universe seed 4242, because the schedule is not seeded (see below) and a single
 * run's output is not precise enough to ship.
 *
 *   category      mean       sd      range    range as % of mean
 *   OUT_OR_ERR   0.0035   0.0003   0.0031-0.0038    18.07%
 *   SO           0.0000   0.0000   0.0000-0.0000     n/a
 *   BB           0.0405   0.0040   0.0359-0.0433    18.32%
 *   1B           0.1800   0.0036   0.1759-0.1828     3.85%
 *   2B           0.2807   0.0096   0.2697-0.2870     6.17%
 *   3B           0.6497   0.0377   0.6146-0.6895    11.54%
 *   HR           1.7048   0.0193   1.6826-1.7178     2.07%
 *
 *   league wOBA 0.0941 runs per plate appearance
 *
 * Read that spread before trusting the small numbers. HR and 1B, the weights that
 * do most of the ranking, are pinned to 2-4%. BB and OUT_OR_ERR swing 18%, because
 * their weights are a small numerator over a large count and move on a handful of
 * scoring events. Three replicates fixes the DIRECTION of every weight; it does
 * not make the small ones exact.
 *
 * WHY THE SCHEDULE IS NOT SEEDED, which is why replicates are needed at all. The
 * at-bat engine is fully deterministic given its universe: there is no
 * `Math.random` inside a game, and every draw comes from a seeded LCG
 * (`gameEngine.ts:35-38`, seeded at `:1107` from the game's own identity). But
 * `generateSchedule` shuffles game dates through `shuffleArray`
 * (`simulation.ts:193-200`), which does call `Math.random`. So the universe seed
 * fixes WHO the players are and never fixes WHEN they play. Two runs at the same
 * seed are two different leagues. Measured: the walk weight came out 0.0403 and
 * 0.0367 from two runs that differed only in schedule order.
 *
 * The fit was validated separately against an independently built universe (seed
 * 987654), which is a different question from schedule noise and agrees on the
 * weights that matter.
 *
 * WHY THEY ARE NOT FANGRAPHS' NUMBERS. FanGraphs publishes BB 0.689, 1B 0.884,
 * 2B 1.261, 3B 1.601, HR 2.072, fitted against MLB. This league is not MLB and
 * the difference is not noise:
 *
 *   - A walk scores ONLY when all three bases are occupied (gameEngine.ts:908,
 *     `resolveWalk`). Real walks also score with a runner on second or third, so
 *     a walk here is worth a small fraction of a real one.
 *   - `SCORING_ADVANCE_RATES` score runners far less often than real baserunners
 *     advance, so an extra-base hit is worth much less than its analogue.
 *   - Home runs are correct, because a home run is scored as exactly 1, 2, 3 or 4
 *     runs by runners on base, and that is the one place the engine is faithful.
 *
 * So the weights are far below the published ones and no amount of fitting would
 * raise them. They are internally consistent and reproduce the league's run rate
 * exactly; they are simply on this league's scale, which is the scale wRC+ wants,
 * since it is a ratio against the league average either way.
 *
 * WHY OUT AND ERR ARE ONE CATEGORY. `PlayerSeasonBatting` has no errors field, so
 * a season batting line cannot distinguish a retired-on-an-error from any other
 * out. It is recoverable from the play log, but that log is the bounded one-slate
 * mirror, so there is no season-long version of it. "OUT or ERR" is therefore the
 * outcome a season row can actually measure, and wOBA is only computable over
 * measurable categories. The fitted weight is small but NOT zero -- errors reach
 * on with a runner aboard often enough to score occasionally -- and folding them
 * in is what makes a player's wOBA comparable to the league's.
 *
 * KNOWN BOUND, STATED RATHER THAN HIDDEN. One weight per outcome is an
 * approximation, and the tool reports how coarse. Every scoring outcome has an
 * occupancy spread equal to its bases-loaded value: a walk is worth 0.000 with
 * the bases empty and 1.000 loaded, a single 0.000 to 1.436, a home run 1.000 to
 * 4.000. Each fitted weight is the average over the base states in which that
 * outcome actually occurred, so it is a fair central value, but a player whose
 * extra-base hits came with men on base is credited less than his raw counting
 * stat suggests. Fitting per outcome-and-base-state and averaging is the fix, and
 * was deliberately deferred; this is the cost of that choice, quantified.
 */

import type { BattingCounts } from './metrics';

/**
 * Runs per plate appearance created by each outcome category, as measured by
 * tools/fitWobaWeights.ts. Mutating this would silently redefine every wOBA and
 * every wRC+ in the app, so it is frozen.
 */
export const WOBA_WEIGHTS = Object.freeze({
  /** Out or reach on an error. See the header for why these are one category. */
  outOrError: 0.0035,
  strikeout: 0.0,
  walk: 0.0405,
  single: 0.18,
  double: 0.2807,
  triple: 0.6497,
  homeRun: 1.7048,
});

/**
 * League wOBA in runs per plate appearance, as measured by the fit.
 *
 * THIS IS A REFERENCE, NOT A DIVISOR. Do not score a player against it.
 *
 * The reasoning is measured, not stylistic. Repeated runs of the fit at the same
 * universe seed produced league wOBA of 0.0948, 0.0933, 0.0897 and 0.0920 --
 * a spread of roughly 5% driven by schedule order alone (see the header). A
 * fixed denominator of 0.0941 would therefore hand every player up to about 5%
 * of rating bias depending on which schedule their league happened to draw, and
 * on a 100-centred scale that is the same size as the entire gap between a strong
 * and an average hitter. It would rank players correctly, since a common divisor
 * cannot reorder a list, but every displayed number would be wrong.
 *
 * So `wrcPlus.ts` takes the league value as an argument and callers pass the
 * measured league baseline from the population in front of them. This constant
 * exists for two narrower jobs: reporting what the fit's own league looked like,
 * and letting tools/verifyWrc.ts check a freshly measured league line against the
 * figure the weights were calibrated on.
 *
 * It is the mean weights weighted by ONE replicate's outcome frequencies, which
 * is near but not equal to any single replicate's own league wOBA, because
 * averaging weights and averaging league values are different operations.
 */
export const LEAGUE_WOBA = 0.0941;

export interface WobaResult {
  /** wOBA in runs per plate appearance, or null with no plate appearances. */
  value: number | null;
  /** Runs created, i.e. the numerator. Kept so a rate can be weighed. */
  runsCreated: number;
  plateAppearances: number;
  /** Standard error of the weighted sum, treating categories as independent. */
  standardError: number | null;
}

/**
 * Runs created by a counting line, as a pure function of counts.
 *
 * The denominator is plate appearances because `atBats === plateAppearances -
 * walks` exactly in this engine (see the header of metrics.ts), so at-bats plus
 * walks IS plate appearances and there is no judgement call about what to divide
 * by. There is no hit-batter-pitcher outcome to exclude from the denominator,
 * because this engine has no such outcome.
 */
export const runsCreated = (counts: BattingCounts): number => {
  const singles = Math.max(0, counts.hits - counts.doubles - counts.triples - counts.homeRuns);
  return (
    singles * WOBA_WEIGHTS.single +
    counts.doubles * WOBA_WEIGHTS.double +
    counts.triples * WOBA_WEIGHTS.triple +
    counts.homeRuns * WOBA_WEIGHTS.homeRun +
    counts.walks * WOBA_WEIGHTS.walk
  );
};

/**
 * wOBA for a counting line.
 *
 * `standardError` treats the seven categories as independent binomial counts,
 * which overstates the true error slightly because a plate appearance is one
 * category and not all seven; it is reported so a caller can filter on precision
 * and know what the number is worth. It is deliberately the conservative
 * direction.
 */
export const woba = (counts: BattingCounts): WobaResult => {
  const { plateAppearances } = counts;
  const runs = runsCreated(counts);

  if (!(plateAppearances > 0)) {
    return { value: null, runsCreated: runs, plateAppearances: 0, standardError: null };
  }

  // Multinomial plug-in. Treating each category count as Binomial(PA, p_i)
  // with the player's OWN observed share p_i = n_i/PA gives Var(n_i) = n_i *
  // (1 - n_i/PA), and independence across categories is what makes the variance
  // of the weighted sum a simple sum:
  //
  //   Var(sum w_i n_i) = sum w_i^2 * n_i * (1 - n_i/PA)
  //
  // Using the player's own shares rather than the league's is the standard
  // plug-in and is stable at small sample, where a league share would dominate a
  // handful of observations. It is mildly biased, since it reads a player's noise
  // as if it were signal, which is why this SE is used to SHRINK a player toward
  // the league rather than to declare them significant.
  //
  // Home runs dominate this sum, which is correct: at ~2.7% of plate appearances
  // a home run is the rarest category and the highest-weighted, so it is where
  // nearly all of a small-sample line's variance lives.
  const singles = Math.max(0, counts.hits - counts.doubles - counts.triples - counts.homeRuns);
  const categoryCounts: Array<[number, number]> = [
    [singles, WOBA_WEIGHTS.single],
    [counts.doubles, WOBA_WEIGHTS.double],
    [counts.triples, WOBA_WEIGHTS.triple],
    [counts.homeRuns, WOBA_WEIGHTS.homeRun],
    [counts.walks, WOBA_WEIGHTS.walk],
    [counts.strikeouts, WOBA_WEIGHTS.strikeout],
    [
      Math.max(0, counts.atBats - counts.hits - counts.strikeouts),
      WOBA_WEIGHTS.outOrError,
    ],
  ];

  let variance = 0;
  categoryCounts.forEach(([n, weight]) => {
    const share = n / plateAppearances;
    variance += weight * weight * n * (1 - share);
  });

  return {
    value: runs / plateAppearances,
    runsCreated: runs,
    plateAppearances,
    standardError: Math.sqrt(variance) / plateAppearances,
  };
};

/**
 * wOBA scaled to a league value, on a 100-centred scale where 100 is exactly
 * average for that league.
 *
 * The league value is an ARGUMENT, not the module constant, for the reason in
 * `LEAGUE_WOBA`'s docstring. Pass the measured baseline of the population being
 * scored -- `leagueWoba` in wrcPlus.ts builds one from a set of batting counts.
 *
 * This is wRC+ before it is shrunk for sample size, and it is named separately so
 * a caller can choose whether to apply that shrinkage. Keeping the two apart
 * matters: the shrinkage is a statistical adjustment for small samples, not part
 * of what the measurement says.
 */
export const leagueRelativeWoba = (counts: BattingCounts, leagueWoba: number): number | null => {
  const value = woba(counts).value;
  if (value === null || !(leagueWoba > 0)) {
    return null;
  }
  return 100 * (value / leagueWoba);
};
