/**
 * wRC+: league-relative runs created, batter side only, park-neutral.
 *
 * WHAT THIS IS. A player's runs created per plate appearance, divided by the
 * league's, on a scale where 100 is exactly league average. FanGraphs' definition
 * with two parts deliberately removed, each for a measured reason rather than by
 * preference. Both removals are stated below because a reader who knows wRC+ will
 * notice them and should be able to check the reasoning.
 *
 * PARK FACTORS: REMOVED, MEASURED. FanGraphs multiplies by a park factor. This
 * engine has none to multiply by. `homeFieldAdvantage` is a single global
 * constant (gameEngine.ts:481) with no per-team or per-park term, and a probe of
 * across-team home run rates (tools/probeHomeAwayFactors.ts) put the spread below
 * the sampling floor: chi-square 31.3 on 31 degrees of freedom, against 46.19 at
 * 5% and 53.49 at 1%. A spread that small is indistinguishable from chance, so a
 * park factor fitted to it would be fitting noise, and dividing it out would move
 * players by amounts no measurement supports. The metric is therefore park-neutral
 * because there is nothing to neutralise, not because parks were judged unimportant.
 *
 * PITCHING EQUIVALENT: ABSENT, ON PURPOSE. FanGraphs publishes a wRC+ for
 * pitchers too. There is no counterpart here that could be built without inventing
 * a new metric: a pitcher's wOBA analogue would need weights for the outcomes a
 * batter produces against them, and this engine records nothing at the
 * pitch-to-plate level to fit them from. Inventing one and labelling it wRC+ would
 * put an unvalidated number under a name readers trust. Pitching runs a separate,
 * honestly-named path instead -- see `PitchingWrcNote` below and the run-scored
 * rates in metrics.ts.
 *
 * WHY THE LEAGUE VALUE IS AN ARGUMENT AND NOT A CONSTANT. The obvious
 * implementation divides by a stored league wOBA. That would be wrong here, and
 * the size of the error is measured: repeated runs of tools/fitWobaWeights.ts at
 * one universe seed produced league wOBA of 0.0948, 0.0933, 0.0897 and 0.0920,
 * differing by about 5% on schedule order alone, because generateSchedule shuffles
 * dates with an unseeded Math.random (simulation.ts:193-200). A stored divisor
 * would hand every player up to 5% of rating bias depending on their league's
 * schedule draw. On a 100-centred scale that is the entire width of the gap
 * between a strong hitter and an average one. A common divisor cannot reorder a
 * leaderboard, so such a bug would look correct in a ranking while every printed
 * number was wrong -- the worst kind. So the baseline is measured from the
 * population being scored, via `leagueBaseline`.
 *
 * WHY SHRINKAGE EXISTS AND WHY IT IS NOT A MAGIC PA FLOOR. A hitter with 40 plate
 * appearances has a wOBA standard error several times that of a hitter with 600,
 * and the leaderboards would otherwise rank a September call-up above a starter
 * purely on variance. The usual fix is a sample-size floor, which throws away the
 * measurement instead of weighting it. This shrinks toward the league mean with a
 * weight set by each player's own standard error, so a poorly measured line is
 * pulled toward average in proportion to how little it can be trusted.
 *
 * Note the weight is set by PRECISION, not by sample size, and those are not the
 * same thing for this metric -- see "WHY PRECISION TRACKS HOME RUNS" below, where it
 * is measured that plate appearances are essentially uninformative about wOBA
 * precision while home run count is strongly informative. The weight is not a tuned
 * constant either: it comes from the between-player variance estimated in
 * `leagueBaseline`, so it adapts to the population, and a league of uniformly weak
 * hitters is not shrunk as hard as a league of varied ones.
 *
 * SHRINKAGE IS A CORRECTION, NOT A MEASUREMENT. `wrcPlus` reports the unshrunk
 * value alongside the shrunk one so a caller can show either, and so the size of
 * the correction is visible rather than buried.
 *
 * HOW MUCH SHRINKAGE, MEASURED, AND IT IS A LOT. Across three 90-day verify
 * leagues of ~292 qualified hitters each, the between-player variance came out at
 * 0.99e-4, 1.02e-4 and 1.38e-4 runs squared, against a mean sampling variance of
 * 2.56e-4 and 2.59e-4. Put plainly: a hitter's TRUE wOBA sits about as far from the
 * league average as the error in measuring it. The PA-weighted standard deviation of
 * wRC+ fell from 22.1 and 21.3 raw to 8.6 and 6.9 shrunk, and the mean correction was
 * 13 to 15 points.
 *
 * That compression is the correct reading of this league, not a defect to tune away.
 * Players DO differ here -- `getOutcomeWeights` (gameEngine.ts:486-490) makes outcome
 * probabilities depend on the batter's power, contact, discipline and
 * avoid-strikeout against the pitcher's stuff and movement -- but the differences are
 * small relative to what a season can resolve. A leaderboard showing raw values would
 * mostly be reporting which hitters got lucky with home runs.
 *
 * WHY PRECISION TRACKS HOME RUNS AND NOT SAMPLE SIZE. This is the least obvious
 * measured property of the metric and it drives everything above. Substituting
 * n_j = PA * p_j into the multinomial variance gives
 *
 *   Var(wOBA) = [ sum_j w_j^2 * p_j * (1 - p_j) ] / PA
 *
 * so precision depends on the player's own outcome MIX as well as on PA, and home
 * runs dominate the numerator: w_HR^2 is 2.906 against 0.032 for a single. Measured
 * across qualified players, the Spearman correlation between the wOBA standard error
 * and home run COUNT is +0.807, while its correlation with plate appearances is
 * -0.048. Sample size is essentially uninformative about how well wOBA is measured.
 *
 * The practical consequence is that a 600-PA slugger hitting .050 carries MORE wOBA
 * variance than a 100-PA contact hitter hitting .010, and is shrunk harder for it.
 * That is correct, not a bug: the slugger's wOBA rests on ~30 home runs whose count
 * is itself noisy, so their rating genuinely deserves less trust. Shrinking on plate
 * appearances alone would have got this exactly backwards. Two earlier versions of
 * tools/verifyWrc.ts asserted that the shrinkage weight rises with plate
 * appearances and both failed (Pearson 0.23, Spearman 0.05) before this was measured;
 * the shrinkage follows the standard error, and the verifier now tests that directly.
 *
 * The honest reading is that a full season of this engine can separate a clearly
 * above-average hitter from the pack and cannot finely rank the top twenty. That is
 * a real limit on the metric, worth more to a reader than a spread of numbers that
 * looks precise.
 *
 * CONSEQUENCE FOR CALLERS. Do not present shrunk wRC+ to a tenth of a point, or rank
 * players whose values differ by less than the reported spread. Present the raw value
 * alongside it, and treat differences inside a few points as ties.
 */

import type { BattingCounts } from './metrics';
import { runsCreated, woba } from './woba';

/**
 * Plate appearances a batter needs before the between-player variance is
 * estimated from them.
 *
 * This is a floor on estimating the LEAGUE's spread, not on publishing a player.
 * Below it, a player's own wOBA is mostly sampling error, and letting those rows
 * into the variance estimate would inflate the league's spread and so shrink
 * everyone toward the mean too hard. It matches the batting floor already in use
 * for batting leaderboards, which keeps the two consistent rather than introducing
 * a second, unrelated threshold.
 */
export const BASELINE_MINIMUM_PA = 82;

/**
 * The league a population is measured against.
 *
 * Built by `leagueBaseline` from the batting counts actually in front of you.
 */
export interface LeagueBaseline {
  /**
   * Runs created per plate appearance across the qualified population.
   *
   * Weighted by plate appearance, not a mean of player rates, because an
   * unweighted mean of rates would give a 40-PA call-up the same vote as a
   * 600-PA starter. This is the denominator of every wRC+ below.
   */
  woba: number;

  /**
   * Variance of player wOBA ACROSS players, in runs squared, with sampling noise
   * removed by method of moments.
   *
   * Observed variance among qualified players is this plus the average sampling
   * variance, so the difference estimates how much players genuinely differ.
   * Floored at zero: a population with no measured spread is one where the metric
   * has nothing to rank on, and a negative estimate would mean only that the
   * noise estimate overshot.
   */
  betweenPlayerVariance: number;

  /** Observed variance of qualified players' wOBA, before noise removal. */
  observedVariance: number;

  /** Mean sampling variance among qualified players. */
  meanSamplingVariance: number;

  /** Players counted in the variance estimate, i.e. those at or above the floor. */
  qualifiedPlayers: number;

  /** Total plate appearances across all players passed in, qualified or not. */
  totalPlateAppearances: number;
}

/**
 * The measured league baseline for a set of batting lines.
 *
 * Returns null when nothing in the population reaches the floor, because a league
 * average drawn from players who cannot be measured is not a league average.
 */
export const leagueBaseline = (rows: readonly BattingCounts[]): LeagueBaseline | null => {
  const qualified: Array<{ value: number; standardError: number }> = [];
  let totalPlateAppearances = 0;

  rows.forEach((counts) => {
    totalPlateAppearances += counts.plateAppearances;
    if (counts.plateAppearances < BASELINE_MINIMUM_PA) {
      return;
    }
    const measured = woba(counts);
    if (measured.value === null || measured.standardError === null) {
      return;
    }
    qualified.push({ value: measured.value, standardError: measured.standardError });
  });

  if (qualified.length === 0 || !(totalPlateAppearances > 0)) {
    return null;
  }

  // Pooled runs created over pooled plate appearances, which is a rate weighted by
  // the evidence behind each player rather than a vote per player.
  let pooledRuns = 0;
  rows.forEach((counts) => {
    pooledRuns += runsCreated(counts);
  });
  const wobaValue = pooledRuns / totalPlateAppearances;

  // Method of moments on the qualified players only. Mean squared deviation is
  // used rather than a plain sum-of-squares so the estimate does not itself scale
  // with how many players happen to clear the floor.
  const meanValue = qualified.reduce((sum, q) => sum + q.value, 0) / qualified.length;
  const observedVariance =
    qualified.reduce((sum, q) => sum + (q.value - meanValue) ** 2, 0) / qualified.length;
  const meanSamplingVariance =
    qualified.reduce((sum, q) => sum + q.standardError ** 2, 0) / qualified.length;

  return {
    woba: wobaValue,
    betweenPlayerVariance: Math.max(0, observedVariance - meanSamplingVariance),
    observedVariance,
    meanSamplingVariance,
    qualifiedPlayers: qualified.length,
    totalPlateAppearances,
  };
};

export interface WrcPlusResult {
  /**
   * Shrunk wRC+ on a 100-centred scale, or null when the player has no plate
   * appearances.
   *
   * Before any league-standard rounding: FanGraphs reports wRC+ to the nearest
   * whole number, and rounding belongs at display time, not here.
   */
  value: number | null;

  /**
   * wRC+ with NO shrinkage applied, or null with no plate appearances.
   *
   * The raw ratio. It is the measurement; `value` is the measurement plus a
   * statistical correction. Both are returned because a caller showing a
   * leaderboard needs the ranking to be stable, and a caller investigating a
   * single player needs to see how much of the move was the correction.
   */
  rawValue: number | null;

  /** The player's own wOBA in runs per plate appearance, unshrunk. */
  woba: number | null;

  /** The league value this player was measured against, for the record. */
  leagueWoba: number;

  /**
   * Weight given to the player's own measurement, from 0 (ignored entirely, the
   * player is rated exactly average) to 1 (trusted completely, no shrinkage).
   */
  shrinkageWeight: number | null;

  /** Standard error of the player's wOBA, in runs per plate appearance. */
  standardError: number | null;

  plateAppearances: number;
  runsCreated: number;
}

/**
 * wRC+ for one hitter against a measured league baseline.
 *
 * The shrinkage is the standard empirical-Bayes form: a measurement is pulled
 * toward the prior in proportion to the ratio of the prior's uncertainty to the
 * measurement's, so
 *
 *   shrunk = league + (measured - league) * tau^2 / (tau^2 + se^2)
 *
 * When `betweenPlayerVariance` is zero the weight is zero and every player is
 * rated exactly 100, which is the honest reading of a population where no
 * measured difference survives its own noise. That case is representable rather
 * than guarded against, because a league this uniform is a real possibility.
 */
export const wrcPlus = (counts: BattingCounts, baseline: LeagueBaseline): WrcPlusResult => {
  const measured = woba(counts);
  const leagueWoba = baseline.woba;

  if (measured.value === null) {
    return {
      value: null,
      rawValue: null,
      woba: null,
      leagueWoba,
      shrinkageWeight: null,
      standardError: null,
      plateAppearances: measured.plateAppearances,
      runsCreated: measured.runsCreated,
    };
  }

  const rawValue = leagueWoba > 0 ? (100 * measured.value) / leagueWoba : null;

  const tauSquared = baseline.betweenPlayerVariance;
  const seSquared = measured.standardError === null ? 0 : measured.standardError ** 2;
  const total = tauSquared + seSquared;
  // A player with no measurable standard error cannot be shrunk, because there is
  // no evidence of how much to trust them; passing the raw value through is the
  // only defensible fallback.
  const weight = measured.standardError === null ? 1 : total > 0 ? tauSquared / total : 1;

  const shrunkWoba = leagueWoba + (measured.value - leagueWoba) * weight;
  const value = leagueWoba > 0 ? (100 * shrunkWoba) / leagueWoba : null;

  return {
    value,
    rawValue,
    woba: measured.value,
    leagueWoba,
    shrinkageWeight: weight,
    standardError: measured.standardError,
    plateAppearances: measured.plateAppearances,
    runsCreated: measured.runsCreated,
  };
};

/**
 * Why there is no `pitchingWrcPlus` beside this module, stated where someone
 * looking for one will find it rather than as a passing note in a changelog.
 *
 * FanGraphs publishes a pitching wRC+ and a reader will reasonably expect the
 * counterpart here. It does not exist because building it means inventing a
 * metric: it needs weights for what a batter's outcome is worth against a given
 * pitcher, and this engine keeps nothing at the pitch level to fit those from.
 * `PlayerSeasonPitching` carries hits allowed, earned runs, walks and strikeouts,
 * and a run-scored rate per nine innings can be built from those -- but that is
 * runs allowed, not run prevention, and calling it wRC+ would put a different
 * quantity under a name that means something specific.
 */
export const PitchingWrcNote =
  'No pitching wRC+: the engine records nothing at the pitch level to fit run ' +
  'prevention weights from, and a run-allowed rate is a different metric. ' +
  'Pitching is rated on earned runs, strikeout and walk rates from metrics.ts.';