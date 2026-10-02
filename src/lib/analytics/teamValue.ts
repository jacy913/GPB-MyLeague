/**
 * Team valuation: what a club is worth, and the index built out of it.
 *
 * THE TARGET IS REALISED SEASON WINS, and that is not a stylistic choice.
 *
 * A valuation function that is not fitted against something observable is a vibe with a number
 * on it. `tools/fitTeamValue.ts` simulates seasons, computes each candidate value, and measures
 * how well it predicts the win total a club ACTUALLY finishes with -- the same shape as
 * `fitMediaOdds`, which fits a forecaster against settled games rather than against an opinion
 * about forecasters.
 *
 * ---------------------------------------------------------------------------
 * THE WEIGHTS ARE PROVISIONAL AND THAT IS THE HONEST STATE OF THEM.
 * ---------------------------------------------------------------------------
 *
 * They sum to 1 and they are placeholders until the fit has run. They are stated here rather
 * than hidden because the module's output feeds the whole HXSE index, and an unfitted weight
 * presented as a fitted one is exactly the failure this project keeps paying for.
 *
 * Two of the three live terms can already be computed:
 *
 *   expectedWinPct  from `weightedConsensus` over the eight forecasters' reads. This is the
 *                   strongest term and it is the only one that is already measured.
 *   rosterSurplus   `getTeamStrengthEdge`, which already exists in logic/teamStrength.
 *   momentum        recent form, capped rather than scaled, following `recentForm` in mediaReads.
 *
 * THE FOURTH TERM IS MISSING AND IT IS THE MOST VALUABLE ONE.
 *
 * The blueprint lists `playoffProbability` at w2, and it is the term that makes a September game
 * move an October price. No such probability exists anywhere in this codebase -- the engine
 * computes division and league WINNERS retroactively and never the odds of MAKING them. That is
 * `Phase 1b`, it is the largest single computation in the project, and until it lands this
 * function is INCOMPLETE BY CONSTRUCTION.
 *
 * It is left out rather than approximated with a constant, and the loader refuses to build an
 * index that claims to include it. A placeholder there would be a number nobody measured,
 * weighted at 20%, propagating into every price on the exchange.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It is pure. It takes values in and returns values out. It does not simulate, it does not read
 * the clock, and it does not touch storage -- the Monte Carlo that produces playoff probability
 * belongs in the worker, and this file is what the worker feeds.
 */

/** A club's valuation inputs, all already measured by something else. */
export interface TeamValueInput {
  teamId: string;
  /**
   * Expected win percentage from the forecaster consensus.
   *
   * Confidence-weighted since step 1 of the HXSE build, so a 0.55 outlet cannot move this as
   * much as an 0.81 one. Clamped to [0, 1] by the caller.
   */
  expectedWinPct: number;
  /** Roster-derived surplus, centred on the league mean. `getTeamStrengthEdge`. */
  rosterSurplus: number;
  /**
   * Recent form over the last ten decisions, capped and NOT scaled.
   *
   * Capped because a club that has won nine straight is on a run, not a better team, and
   * scaling form into the value would price a streak as a structural advantage. With fewer
   * than ten decisions played there is no form to speak of and this is the league mean.
   */
  momentum: number;
}

/**
 * The blend, as weights summing to 1.
 *
 * PROVISIONAL. `fitTeamValue.ts` replaces these.
 *
 * The relative sizes are reasoned rather than fitted: roster quality is the slowest-moving and
 * most durable thing about a baseball club, so it carries the largest share, and momentum the
 * smallest because it is the term most likely to be noise. What the fit decides is whether that
 * ordering survives contact with data, and it is entirely possible it does not.
 */
export const TEAM_VALUE_WEIGHTS = {
  rosterSurplus: 0.45,
  expectedWinPct: 0.35,
  momentum: 0.20,
} as const;

/**
 * THE MISSING TERM, declared so its absence is a compile-time fact rather than a memory.
 *
 * `PLAYOFF_PROBABILITY_AVAILABLE` is false, and `hxseIndex` refuses to report a value-weighted
 * index while it is, because an index that silently omits its largest term is not a valuation,
 * it is a number. When the Monte Carlo lands this flips to true and the gate becomes real.
 */
export const PLAYOFF_PROBABILITY_AVAILABLE = false;

/**
 * Map a valuation input to a value on a 0-100 scale.
 *
 * All three terms are centred and scaled before they are blended, because they do not share
 * units: win percentage is 0-1, roster surplus is points on the league's own scale, and momentum
 * is a capped win rate. Blending raw values would let whichever term happens to have the widest
 * spread dominate, and that is a silent way to publish a roster-strength index and call it a
 * valuation.
 *
 * Each term is expressed as a z-score against the league, then mapped onto 0-100, so the blend
 * is a genuine average of three comparable opinions rather than a weighted sum of mismatched
 * units. `z` is the league mean and `sd` the standard deviation, both measured by the caller
 * from the actual field rather than hard-coded.
 */
export const teamValueFor = (
  input: TeamValueInput,
  league: { winPctMean: number; winPctSd: number; surplusMean: number; surplusSd: number; momentumMean: number; momentumSd: number },
): number => {
  const z = (value: number, mean: number, sd: number): number =>
    sd > 0 ? (value - mean) / sd : 0;

  const parts = [
    { weight: TEAM_VALUE_WEIGHTS.rosterSurplus, z: z(input.rosterSurplus, league.surplusMean, league.surplusSd) },
    { weight: TEAM_VALUE_WEIGHTS.expectedWinPct, z: z(input.expectedWinPct, league.winPctMean, league.winPctSd) },
    { weight: TEAM_VALUE_WEIGHTS.momentum, z: z(input.momentum, league.momentumMean, league.momentumSd) },
  ];

  const blended = parts.reduce((sum, p) => sum + p.weight * p.z, 0);
  // A z of +/-3 is three standard deviations, which is a wide but not absurd tail for a league
  // of 32. Clamped so one extreme club cannot dominate the index on its own.
  const clamped = Math.max(-3, Math.min(3, blended));
  return 50 + clamped * (50 / 3);
};

/** The league statistics every valuation needs, measured from the field itself. */
export const measureLeague = (inputs: TeamValueInput[]): {
  winPctMean: number; winPctSd: number;
  surplusMean: number; surplusSd: number;
  momentumMean: number; momentumSd: number;
} => {
  const stat = (pick: (i: TeamValueInput) => number): { mean: number; sd: number } => {
    const values = inputs.map(pick);
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length);
    return { mean, sd: Math.sqrt(variance) };
  };
  const win = stat((i) => i.expectedWinPct);
  const surplus = stat((i) => i.rosterSurplus);
  const momentum = stat((i) => i.momentum);
  return {
    winPctMean: win.mean, winPctSd: win.sd,
    surplusMean: surplus.mean, surplusSd: surplus.sd,
    momentumMean: momentum.mean, momentumSd: momentum.sd,
  };
};