/**
 * Team valuation: what a club is worth.
 *
 * THE TARGET IS REALISED SEASON WINS, and that is not a stylistic choice.
 *
 * A valuation function not fitted against something observable is a vibe with a number on it.
 * `tools/fitTeamValue.ts` simulates seasons, measures each candidate value at three points in the
 * schedule, and fits the weights against the win total a club ACTUALLY finishes with -- the same
 * shape as `fitMediaOdds`, which fits a forecaster against settled games rather than against an
 * opinion about forecasters.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR TERMS, AND WHERE EACH ONE COMES FROM
 * ---------------------------------------------------------------------------
 *
 *   expectedWinPct   the confidence-weighted forecaster consensus. Eight outlets, weighted by
 *                    measured Brier skill, so a 0.55-confidence outlet cannot move a price as far
 *                    as an 0.81 one. Clamped to [0, 1] by `buildValueInputs`.
 *
 *   rosterSurplus    `getTeamStrengthEdge`, the club's roster quality centred on the league mean.
 *                    The slowest-moving and most durable thing about a baseball club.
 *
 *   momentum         win rate over the last ten decisions. CAPPED, not scaled -- see below.
 *
 *   playoffProbability  the club's chance of winning the GPB World Series, from
 *                    `playoffMonteCarlo`. The term that makes a September game move an October
 *                    price, and the reason this module could not publish an index for most of
 *                    its life.
 *
 * ---------------------------------------------------------------------------
 * WHY MOMENTUM IS CAPPED
 * ---------------------------------------------------------------------------
 *
 * A club that has won nine straight is on a run, not a better team. Scaling form into the value
 * would price a streak as a structural advantage and then fade it, which is a two-step argument
 * about player development that this module has no evidence for. Under ten decisions played there
 * is no form to speak of, and the term sits at the league mean.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY TERM IS STANDARDISED BEFORE BLENDING
 * ---------------------------------------------------------------------------
 *
 * Win percentage is 0-1, roster surplus is points on the league's own scale, momentum is a capped
 * win rate, and playoff probability is 0-1. Blending those raw would let whichever term happens to
 * have the widest spread dominate the blend -- a silent way to publish a roster-strength index and
 * label it a valuation. So each term becomes a z-score against the league, the weighted sum of
 * z-scores is the value, and the value is mapped onto 0-100.
 *
 * `checkHxseIndex` proves this rather than asserting it: lifting any single term by exactly one
 * standard deviation must raise the value by exactly that term's weight times (50/3).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It is pure. It takes values in and returns values out. It does not simulate and does not read
 * the clock -- the Monte Carlo that produces playoff probability lives in the worker, and this
 * file is what the worker feeds. `buildValueInputs` is the single place where raw league state
 * becomes valuation inputs, so the fit and production cannot drift apart on what "momentum" means.
 */

import type { MediaReadResult } from '../mediaReads';
import type { Game, Team } from '../../types';

/** A club's valuation inputs, all already measured by something else. */
export interface TeamValueInput {
  teamId: string;
  /** Expected win percentage from the forecaster consensus. Clamped to [0, 1]. */
  expectedWinPct: number;
  /** Roster-derived surplus, centred on the league mean. `getTeamStrengthEdge`. */
  rosterSurplus: number;
  /**
   * Win rate over the last ten decisions, and NOT season-to-date.
   *
   * Season-to-date would double-count `expectedWinPct`, which already knows the record. Recent
   * form is the part of the record the consensus has not already priced.
   */
  momentum: number;
  /** Probability of winning the GPB World Series. From `playoffMonteCarlo`. */
  playoffProbability: number;
}

/**
 * The blend, as weights summing to 1.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, NOT REASONED. `tools/fitTeamValue.ts` fitted these against realised season win totals.
 * ---------------------------------------------------------------------------
 *
 * Ten independent simulated seasons, three snapshots each (55 / 85 / 115 games played), 960
 * observations of "what was knowable on date D, scored against what the club actually finished
 * with". Target centred within each snapshot, because the value function is intercept-free and
 * predicts a club's standing relative to its league.
 *
 *   joint R2            0.6978   69.8% of the variance in final win totals
 *   residual SE         5.392 wins
 *
 *   term                   coeff      SE       t   partial R2   shipped
 *   expectedWinPct          6.628   0.329  20.17      29.85%      0.6961
 *   playoffProbability      1.941   0.288   6.75       4.55%      0.2039
 *   rosterSurplus          -0.120   0.251   0.48       0.02%      0.0500  (floor)
 *   momentum                0.034   0.194   0.17       0.00%      0.0500  (floor)
 *
 * ---------------------------------------------------------------------------
 * WHY TWO TERMS SHIP AT THE FLOOR, AND WHY THAT IS NOT "ROSTERS DO NOT MATTER"
 * ---------------------------------------------------------------------------
 *
 * This is the finding most likely to be misread, so it is spelled out rather than left as two
 * small numbers.
 *
 * It is not evidence that roster quality is worthless. It is evidence that roster quality is
 * REDUNDANT here. `expectedWinPct` is not an independent opinion about a club -- it is built by
 * `buildMediaReads` from those same rosters, via `getTeamRosterStrength`. The consensus and the
 * roster surplus are nearly the same column of data, so once the consensus is in the model, roster
 * surplus has nothing left to explain. Its coefficient goes slightly negative for the ordinary
 * reason that a redundant regressor's residual contribution is noise.
 *
 * Momentum is the same story with a different cause. Last-ten win rate is mostly record, and
 * expectedWinPct already knows the record; a ten-game window on top of that is noise, and the
 * coefficient is 0.034 wins per standard deviation against a standard error of 0.194.
 *
 * So the honest summary is: the valuation is the forecaster consensus plus playoff odds, and two
 * terms that duplicate information already present are held at a floor rather than dressed up with
 * weight the data does not support. If a future fit with more seasons revives either, the constant
 * moves. A term at the floor is still wired, still measured, and still reported -- it is not
 * removed, because deleting it would make a future revival impossible to detect.
 *
 * The floor (0.05) was declared before the fit ran and has not been moved since.
 */
export const TEAM_VALUE_WEIGHTS = {
  rosterSurplus: 0.05,
  expectedWinPct: 0.6961,
  playoffProbability: 0.2039,
  momentum: 0.05,
} as const;

/** The term names, in the order the fit reports them. */
export const TEAM_VALUE_TERMS = [
  'rosterSurplus',
  'expectedWinPct',
  'playoffProbability',
  'momentum',
] as const;

export type TeamValueTerm = typeof TEAM_VALUE_TERMS[number];

/**
 * TRUE ONLY BECAUSE `playoffMonteCarlo` EXISTS AND THE WEIGHTS WERE FITTED WITH IT INCLUDED.
 *
 * This flag is what `buildHxseIndices` refuses to publish without. It is not a feature switch --
 * it is a statement that the valuation is complete, and it was false for the whole of Phase 1
 * step 3.2 because the term had no source. It must not be flipped on its own: flipping it while
 * `teamValue.ts` ignored playoff probability would make the index publish a composite silently
 * missing its largest input, which is the exact failure the flag exists to prevent.
 */
export const PLAYOFF_PROBABILITY_AVAILABLE = true;

/** League statistics every valuation needs, measured from the field itself rather than hard-coded. */
export interface LeagueStatistics {
  winPctMean: number;
  winPctSd: number;
  surplusMean: number;
  surplusSd: number;
  momentumMean: number;
  momentumSd: number;
  playoffMean: number;
  playoffSd: number;
}

/**
 * Measure the four terms against the field.
 *
 * Once, for the whole league. Measuring per club would give every club its own z-scores and
 * therefore an identical 50, which is a beautiful way to publish a constant.
 */
export const measureLeague = (inputs: TeamValueInput[]): LeagueStatistics => {
  const stat = (pick: (i: TeamValueInput) => number): { mean: number; sd: number } => {
    const values = inputs.map(pick);
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length);
    return { mean, sd: Math.sqrt(variance) };
  };
  const win = stat((i) => i.expectedWinPct);
  const surplus = stat((i) => i.rosterSurplus);
  const momentum = stat((i) => i.momentum);
  const playoff = stat((i) => i.playoffProbability);
  return {
    winPctMean: win.mean,
    winPctSd: win.sd,
    surplusMean: surplus.mean,
    surplusSd: surplus.sd,
    momentumMean: momentum.mean,
    momentumSd: momentum.sd,
    playoffMean: playoff.mean,
    playoffSd: playoff.sd,
  };
};

/** The z-scale. A +/-3 z is a wide but not absurd tail for a league of 32. */
export const Z_CLAMP = 3;
const VALUE_SCALE = 50 / Z_CLAMP;

/**
 * Map a club's inputs to a value on a 0-100 scale.
 *
 * The blend of z-scores is clamped to +/-3 before scaling, so one extreme club cannot dominate
 * the index on its own.
 */
export const teamValueFor = (input: TeamValueInput, league: LeagueStatistics): number => {
  const z = (value: number, mean: number, sd: number): number => (sd > 0 ? (value - mean) / sd : 0);

  const blended = TEAM_VALUE_TERMS.reduce((sum, term) => {
    const pair = TERM_TO_STATISTICS[term];
    return sum + TEAM_VALUE_WEIGHTS[term] * z(input[term], league[pair.mean], league[pair.sd]);
  }, 0);

  return 50 + Math.max(-Z_CLAMP, Math.min(Z_CLAMP, blended)) * VALUE_SCALE;
};

/**
 * Which league statistic standardises which term.
 *
 * An explicit table rather than deriving the key by string surgery. The derived version --
 * `` league[`${camelOf(term)}Mean`] `` -- compiles, runs, and silently yields `undefined` the
 * moment a term is renamed, which is a z-score of NaN propagating into every price on the
 * exchange. A table cannot rot that way.
 */
const TERM_TO_STATISTICS: Record<TeamValueTerm, { mean: keyof LeagueStatistics; sd: keyof LeagueStatistics }> = {
  rosterSurplus: { mean: 'surplusMean', sd: 'surplusSd' },
  expectedWinPct: { mean: 'winPctMean', sd: 'winPctSd' },
  playoffProbability: { mean: 'playoffMean', sd: 'playoffSd' },
  momentum: { mean: 'momentumMean', sd: 'momentumSd' },
};

/** How many recent decisions the momentum term looks at. */
export const MOMENTUM_WINDOW = 10;

/**
 * Win rate over a club's last `MOMENTUM_WINDOW` completed decisions.
 *
 * This is the ONE definition of momentum in the codebase, and it lives here so the fit and
 * production cannot disagree about what the term means. A definition that existed only inside the
 * fit tool would drift the moment someone tuned it there for a better fit.
 *
 * Fewer than `MOMENTUM_WINDOW` decisions played, and it returns the league mean of 0.5, because
 * with three games there is no form to separate from noise.
 */
export const recentFormFor = (games: Game[], teamId: string): number => {
  const decisions: boolean[] = [];
  for (const game of games) {
    if (game.status !== 'completed' || game.phase !== 'regular_season') continue;
    if (game.homeTeam === teamId) decisions.push(game.score.home > game.score.away);
    else if (game.awayTeam === teamId) decisions.push(game.score.away > game.score.home);
  }
  if (decisions.length < MOMENTUM_WINDOW) return 0.5;
  const recent = decisions.slice(-MOMENTUM_WINDOW);
  return recent.filter(Boolean).length / recent.length;
};

/**
 * The PLAIN MEAN of the forecaster consensus, per team, plus the league mean of it.
 *
 * Exists because the crowd's analyst archetype reads the UNWEIGHTED consensus while fair value is
 * built from the CONFIDENCE-WEIGHTED one -- that difference is the only reason they are two
 * archetypes rather than one, and it is invisible unless both numbers are available side by side.
 *
 * Computing it here rather than in the crowd means the market floor, where the crowd runs, does not
 * carry a second copy of `buildMediaReads`. `buildMediaReads` is called twice a day either way,
 * which is the same cost the price path already pays, and it keeps one implementation of each
 * forecast.
 */
export const plainConsensusWinPct = (
  teams: Team[],
  reads: MediaReadResult,
): { byId: Map<string, number>; leagueMean: number } => {
  const byId = new Map<string, number>();
  teams.forEach((team) => {
    const values = Object.values(reads.scores)
      .map((scores) => scores.get(team.id))
      .filter((v): v is number => typeof v === 'number');
    byId.set(team.id, values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0.5);
  });
  const leagueMean = byId.size > 0
    ? [...byId.values()].reduce((a, b) => a + b, 0) / byId.size
    : 0.5;
  return { byId, leagueMean };
};

/**
 * THE ONE PLACE raw league state becomes valuation inputs.
 *
 * Deliberately a single function. `tools/fitTeamValue.ts` fits the weights against values built
 * HERE, and production builds them here too, so "the fit measures what ships" is a structural fact
 * rather than a promise. If momentum, the clamp, or the window were defined twice, the fit would
 * be measuring a different quantity from the one the exchange prices -- and it would keep passing
 * while meaning something else.
 *
 * Every input is a plain number or map rather than a player or a database row, so this file stays
 * free of imports from `logic/` and remains trivially testable.
 */
export const buildValueInputs = (input: {
  teamIds: string[];
  /** Consensus win percentage by team, from `weightedConsensus` over `buildMediaReads`. */
  consensusWinPctById: Map<string, number>;
  /** Roster surplus by team, from `getTeamStrengthEdge`. */
  surplusById: Map<string, number>;
  /** World Series probability by team, from `playoffMonteCarlo`. */
  playoffProbabilityById: Map<string, number>;
  /** Every game played so far, for the momentum window. */
  games: Game[];
}): TeamValueInput[] => input.teamIds.map((teamId) => ({
  teamId,
  expectedWinPct: Math.max(0, Math.min(1, input.consensusWinPctById.get(teamId) ?? 0.5)),
  rosterSurplus: input.surplusById.get(teamId) ?? 0,
  momentum: recentFormFor(input.games, teamId),
  playoffProbability: Math.max(0, Math.min(1, input.playoffProbabilityById.get(teamId) ?? 0)),
}));
