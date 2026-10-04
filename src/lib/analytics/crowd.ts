/**
 * The crowd: five archetypes whose net flow is the day's shock.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 *
 * `priceBoardForDay` already accepts `eventShocks` and is already checked end to end against a real
 * season. The crowd plugs into that seam and nothing else changes: aggregate flow becomes the day's
 * shock, and the price path does what it already did.
 *
 * The design goal is NOT realism. It is that the crowd is systematically WRONG in one identifiable
 * way, because that is what makes it learnable. The blueprint puts it plainly -- "the momentum
 * crowd is the largest and most wrong... that gives the player a learnable strategy, and a
 * learnable strategy is the difference between a feature and a gambling mechanic."
 *
 * So `checkCrowd` gates on the thing that actually matters: after a run, does the price come back?
 * If the crowd were right as often as the player, every strategy here would be a coin flip with
 * extra steps, and the whole module would be decoration.
 *
 * ===========================================================================
 * THE FIVE ARCHETYPES, AND WHY NONE OF THEM IS DECORATIVE
 * ===========================================================================
 *
 * MOMENTUM -- buys what is rising, and its flow is proportional to the recent RETURN rather than to
 *   the gap to fair value. That is what lets it DIVERGE from fair value, which was the explicit
 *   decision: a crowd that only ever damps toward fair leaves no dislocation to trade, and "fade the
 *   spike" stops being a strategy and becomes a decoration on a chart.
 *
 * VALUE -- buys below the club's OWN recent average price, not below fair value. It is deliberately
 *   a different signal from the analyst archetype: Value mean-reverts against history, analysts trend
 *   toward a forecast. Using the same input for both would have made one of them unfalsifiable.
 *
 * NEWS-REACTIVE -- chases the day's own shocks. Trades noise as signal, which is the named
 *   vulnerability. Implemented as a small multiple of today's shock, so it amplifies a headline
 *   rather than originating a view.
 *
 * ANALYST-FOLLOWERS -- trends toward the forecaster consensus. The subtlety that keeps this from
 *   being a duplicate of the passive archetype: analysts use the PLAIN MEAN of the eight forecaster
 *   views while fair value uses the CONFIDENCE-WEIGHTED consensus. They therefore differ exactly
 *   when forecasters disagree -- which is precisely when "if Sharply is loud, the crowd is Sharply"
 *   is a real effect rather than a slogan. `checkCrowd` asserts they actually diverge.
 *
 * PASSIVE / INDEX -- the beta. Trends toward fair value with no view at all, and is the reason the
 *   market does not drift away permanently.
 *
 * ===========================================================================
 * THE SHARES ARE A DESIGN PARAMETER, AND THE MEASUREMENT IS THE SUCCESS CRITERION
 * ===========================================================================
 *
 * The blueprint gives shares qualitatively -- Momentum "Large", three others "Medium", Passive
 * "Fixed" -- and no numbers. Numbers were needed, so these were chosen to produce the behaviour the
 * blueprint describes, and that is stated rather than dressed up as a measurement: there is no
 * ground truth for crowd behaviour to be fitted against.
 *
 * What IS measured is the thing the blueprint actually asks for. The shares are a means; the gate
 * is whether the resulting market has a detectable, fadeable dislocation. If the momentum share is
 * set so that chasing winners pays, the module has failed regardless of how plausible the shares
 * look.
 *
 * The shares were fixed BEFORE `checkCrowd` ran and are not tuned to pass it.
 */

import type { PriceSeries, PriceRegime } from './sharePrice';
import { MAX_DAILY_MOVE, shocksForDate } from './sharePrice';
import { gapRiskFor, marketSizeFor } from './fanbase';
import type { Game, Team } from '../../types';

/** The five archetypes, and how much of the crowd each is. */
export const CROWD_SHARES = {
  /** Chases whatever is rising. The largest single share, and the one that is wrong. */
  momentum: 0.40,
  /** Buys below the club's own recent average. */
  value: 0.20,
  /** Chases the day's shocks. Amplifies, does not originate. */
  newsReactive: 0.15,
  /** Trends toward the forecaster consensus, unweighted. Inherits forecaster bias. */
  analysts: 0.15,
  /** The beta. Trends toward fair value with no view. */
  passive: 0.10,
} as const;

export type Archetype = keyof typeof CROWD_SHARES;

/** How far back momentum looks. Three days is the blueprint's own example of a "run". */
export const MOMENTUM_LOOKBACK = 3;

/** How far back value looks. Longer than momentum, because a dip is judged against a trend. */
export const VALUE_LOOKBACK = 20;

/**
 * Over how many days the passive archetype closes a gap to fair value.
 *
 * ===========================================================================
 * WHY THIS EXISTS: THE SHARES WERE NOT DESCRIBING WHO MOVED THE MARKET
 * ===========================================================================
 *
 * This constant was missing and the module did not work because of it. The symptom looked like a
 * tuning problem rather than a structural one, so it is worth being precise about what was wrong.
 *
 * `momentumSignal` returns a PER-DAY RATE. It divides the three-day return by the lookback, because a
 * full-size move every day of a run compounds into a bubble with no pull at all. Then it multiplies by
 * the saturation appetite.
 *
 * `towardFairSignal` returned a LEVEL -- the raw fractional gap to fair -- with no normalisation at
 * all. So a 12% gap produced a signal of 0.12, while a hot three-day run produced 0.014. One was 8x
 * the other, for a smaller price move.
 *
 * The consequence, measured on the seven-day run in `checkCrowd`, share-weighted contribution mid-run:
 *
 *     momentum   share 0.40   +0.318%
 *     passive    share 0.10   -0.416%
 *
 * The archetype with the LARGEST share lost to the one with the SMALLEST, by 1.3x. The design premise
 * in this file's own header is that "the momentum crowd is the largest and most wrong". It was neither.
 *
 * And it destroyed the fade strategy on the way, through the net rather than through any one archetype:
 *
 *   - `net` was NEGATIVE for the whole run, so a chaser was already losing mid-run. The design says
 *     "during a run the momentum archetype buys, flow is positive, and a chaser makes money", which
 *     did not happen and cannot happen while an unnormalised term dominates the sum.
 *   - Momentum's saturation was firing correctly and nobody could see it, because its contribution was
 *     smaller than the term it was fighting. `checkCrowd` reported two failures that looked like a
 *     saturation constant set too low. The constant was fine.
 *
 * Dividing by a drift horizon puts passive on the same per-day footing as momentum, so the two signals
 * become comparable and CROWD_SHARES describes actual influence. The reasoning is momentum's own,
 * stated above: the archetypes act daily, so a gap that persists for a week is closed over days rather
 * than in a single move.
 *
 * Three is a CHOSEN number, in the same way CROWD_SATURATION is, and for the same reason: there is no
 * ground truth for crowd behaviour to be fitted against. What is measured is the consequence, and
 * `checkCrowd` gates on the consequence.
 */
export const PASSIVE_DRIFT_DAYS = 3;

/**
 * How strongly each archetype acts on its own signal.
 *
 * These convert a normalised signal into a fractional flow. Chosen so that the resulting daily
 * moves stay inside the band `MAX_DAILY_MOVE` already enforces, and so that no single archetype can
 * exceed its share's influence on a quiet day. Not fitted to anything -- the shares are the design
 * parameter and these only set the unit conversion.
 */
export const CROWD_GAIN = {
  momentum: 0.55,
  value: 0.30,
  newsReactive: 0.25,
  analysts: 0.25,
  passive: 0.35,
} as const;

export interface CrowdInput {
  teamId: string;
  /** Closes for this club, oldest first, including today's provisional price. */
  closes: number[];
  /** Today's fair price, from `fairPriceFor`. */
  fair: number;
  /** Today's game-result shocks, before crowd flow. */
  gameShock: number;
  /** The confidence-weighted consensus win percentage -- what fair value is built from. */
  weightedConsensusWinPct: number;
  /** The PLAIN MEAN consensus win percentage. Differs from the weighted one when forecasters
   *  disagree, which is the only condition under which the analyst archetype does anything
   *  distinct from the passive one. */
  plainConsensusWinPct: number;
  /** League mean of the plain consensus, so the analyst signal can be expressed as a deviation. */
  plainConsensusLeagueMean: number;
  /** Market size 0-100, from `marketSizeFor`. Drives gap risk. */
  marketSize: number;
}

export interface CrowdFlow {
  teamId: string;
  /** Per-archetype fractional flow, before shares are applied. Reported so the mix is legible. */
  byArchetype: Record<Archetype, number>;
  /** Share-weighted net flow. This is the day's crowd shock. */
  net: number;
  /** The flow the day actually applied, after the thin-book gap multiplier. */
  applied: number;
  /** How violently this name moves on a given flow, 1.0 to MAX_REACHABLE_GAP. */
  gapMultiplier: number;
}

const clamp = (value: number): number => Math.max(-MAX_DAILY_MOVE, Math.min(MAX_DAILY_MOVE, value));

/**
 * How fast the crowd's appetite for a run decays as the price extends above fair value.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE TERM THAT MAKES THE FADE STRATEGY EXIST, AND IT WAS MISSING FIRST
 * ---------------------------------------------------------------------------
 *
 * The first version of `momentumSignal` was the three-day return divided by the lookback, and that
 * is roughly CONSTANT during a steady run -- so the crowd bought a seven-day run at full size on
 * every day of it and never sold. `checkCrowd` measured net flow at +0.33% mid-run and still +0.18%
 * with the whole run visible, which is the failure the blueprint names outright: "if the crowd is
 * right as often as you, this is a coin-flip game with extra steps."
 *
 * The value archetype could not rescue it either, because its twenty-day window is never satisfied by
 * a short run. So there was no counterweight at all during exactly the situation the fade strategy
 * targets.
 *
 * Saturation is the fix, and it is the realistic one: a crowd does not buy the eighth day of a
 * parabolic move with the same enthusiasm as the second, because the people who were going to buy
 * have already bought. Appetite therefore decays with how far the price has extended from fair value.
 *
 * `CROWD_SATURATION` is a CHOSEN number, chosen so that appetite falls to roughly a third by the
 * time a move is 20% extended -- which is where the reversal has to happen for the design to work.
 * It is not fitted to anything and there is no ground truth for crowd appetite to be fitted against.
 * What IS measured is the consequence, and `checkCrowd` gates on the crowd actually turning.
 */
export const CROWD_SATURATION = 10;

const momentumSignal = (closes: number[], fair: number): number => {
  if (closes.length < MOMENTUM_LOOKBACK + 1) return 0;
  const then = closes[closes.length - 1 - MOMENTUM_LOOKBACK];
  const now = closes[closes.length - 1];
  if (then <= 0 || fair <= 0) return 0;

  // A three-day run of +9% is a signal of 0.03, not 0.09. The archetypes act daily, and without the
  // division a strong trend would produce a full-size move every day and compound into a bubble with
  // no pull at all.
  const perDay = (now / then - 1) / MOMENTUM_LOOKBACK;

  // Appetite decays with how far the price has run from fair value. Above fair only -- a club that
  // has fallen below fair and is bouncing is a genuine opportunity, not a crowded one.
  const extension = Math.max(0, now / fair - 1);
  const appetite = 1 / (1 + CROWD_SATURATION * extension);

  return clamp(perDay * appetite);
};

/** Deviation of the current price below the club's own recent average, positive when cheap. */
const valueSignal = (closes: number[]): number => {
  const window = closes.slice(-VALUE_LOOKBACK);
  if (window.length < VALUE_LOOKBACK) return 0;
  const average = window.reduce((a, b) => a + b, 0) / window.length;
  if (average <= 0) return 0;
  return clamp((average / closes[closes.length - 1] - 1));
};

/**
 * Trend toward fair value. Positive when the price is BELOW fair, so it buys.
 *
 * Divided by PASSIVE_DRIFT_DAYS, and that division is the whole point -- see the constant's note. The
 * raw gap to fair is a LEVEL and momentum's signal is a RATE; summing them directly lets a 10% weight
 * out-shout a 40% weight eight times over. Dividing makes this a per-day drift, which is what the
 * archetype actually is: it acts once a day and closes the gap over several, not in one move.
 */
const towardFairSignal = (closes: number[], fair: number): number => {
  const now = closes[closes.length - 1];
  if (now <= 0) return 0;
  return clamp(((fair - now) / now) / PASSIVE_DRIFT_DAYS);
};

/**
 * The analyst archetype's signal: deviation of the PLAIN consensus from the league mean.
 *
 * This is the only archetype with no reference to the price at all, and that is the point. It buys
 * what the unweighted forecasters like relative to the field, which is a view about the club rather
 * than a view about its price. Positive means the plain consensus rates this club above the league.
 *
 * It is scaled by a quarter so that a forecaster disagreement moves the crowd meaningfully without
 * being able to outvote the price itself. The scale is a unit conversion, chosen so a full
 * half-point of consensus disagreement produces a signal near 0.5.
 */
const analystSignal = (
  plainConsensusWinPct: number,
  plainConsensusLeagueMean: number,
): number => clamp((plainConsensusWinPct - plainConsensusLeagueMean) * 4);

export const crowdFlowFor = (input: CrowdInput): CrowdFlow => {
  const signals: Record<Archetype, number> = {
    momentum: momentumSignal(input.closes, input.fair),
    value: valueSignal(input.closes),
    newsReactive: clamp(input.gameShock * 2),
    analysts: analystSignal(input.plainConsensusWinPct, input.plainConsensusLeagueMean),
    passive: towardFairSignal(input.closes, input.fair),
  };

  const byArchetype = {} as Record<Archetype, number>;
  let net = 0;
  for (const archetype of Object.keys(CROWD_SHARES) as Archetype[]) {
    const flow = clamp(signals[archetype] * CROWD_GAIN[archetype]);
    byArchetype[archetype] = flow;
    net += flow * CROWD_SHARES[archetype];
  }
  net = clamp(net);

  // A thin book amplifies whatever is trying to happen. Applied to the crowd's flow only, never to
  // game results -- a blowout win is a fact about the game, and letting a small market turn it into
  // a 30% move would make the price a function of the fixture list rather than of baseball.
  const gapMultiplier = 1 + gapRiskFor(input.marketSize);
  const applied = clamp(net * gapMultiplier);

  return { teamId: input.teamId, byArchetype, net, applied, gapMultiplier };
};

/** The whole league's flows for one day. */
export const crowdFlowsFor = (inputs: CrowdInput[]): CrowdFlow[] => inputs.map(crowdFlowFor);

/** Flow by team, ready to hand to `priceBoardForDay` as `eventShocks`. */
export const crowdShocksById = (flows: CrowdFlow[]): Record<string, number> =>
  Object.fromEntries(flows.map((f) => [f.teamId, f.applied]));

/**
 * The whole crowd, for one day, from the league state and yesterday's closes.
 *
 * This is the shape the market floor has: it holds the teams, the games, the ledger so far, and
 * yesterday's fair values and plain consensus. Gathering them here rather than in the worker means
 * the worker's day loop stays a call.
 *
 * `checkCrowdOnRealPath` assembles the crowd through `crowdFlowsForDay` below, so it exercises this
 * same code rather than a copy of it -- the same "the check measures what ships" requirement that
 * `buildValueInputs` exists to satisfy on the valuation side.
 *
 * `closesFor` is deliberately NOT filtered to yesterday. Momentum is a three-day lookback, so the
 * crowd is meant to see the last few closes, and truncating the ledger to one day would silently
 * disable the archetype that matters most.
 */
export interface CrowdDayInput {
  teams: Team[];
  games: Game[];
  /** ISO date being priced. Game shocks come from this date's completed games. */
  date: string;
  /** The ledger so far, oldest first. */
  ledger: PriceSeries[];
  /** Yesterday's fair prices, from the previous board. */
  fair: Record<string, number>;
  /** The PLAIN-MEAN consensus by team, which is not what `fair` is built from. */
  plain: Map<string, number>;
  plainLeagueMean: number;
}

/**
 * The crowd's per-club flows for one day, from league state and the ledger so far.
 *
 * Split out from `crowdEventShocksFor` so a caller can see the flows and not only the shocks they
 * add up to. `checkCrowdOnRealPath` needs exactly that: it measures whether net flow turns negative
 * once a run is established, which is a claim about the flows rather than about their sum.
 *
 * The alternative was the check assembling these inputs itself, which is what it used to do -- and
 * which meant it was measuring a hand-built copy of this function rather than this function. The
 * comment above `crowdEventShocksFor` already claimed the two assembled the crowd identically, which
 * was not true until this existed.
 */
export const crowdFlowsForDay = (input: CrowdDayInput): CrowdFlow[] => {
  const gameShocks = shocksForDate(input.games.filter((g) => g.date === input.date));
  return crowdFlowsFor(input.teams.map((team) => ({
    teamId: team.id,
    closes: closesFor(input.ledger, team.id, input.date),
    fair: input.fair[team.id] ?? 500,
    gameShock: gameShocks[team.id] ?? 0,
    // The weighted consensus is not an input to any archetype; the constant is here because the
    // interface carries it for the read that does not exist. Said rather than left to look deliberate.
    weightedConsensusWinPct: 0.5,
    plainConsensusWinPct: input.plain.get(team.id) ?? 0.5,
    plainConsensusLeagueMean: input.plainLeagueMean,
    marketSize: marketSizeFor(team),
  })));
};

export const crowdEventShocksFor = (input: CrowdDayInput): Record<string, number> =>
  crowdShocksById(crowdFlowsForDay(input));

/**
 * Extract one club's closes up to and including a date from a ledger.
 *
 * Shared so the momentum and value windows are computed from the SAME series the price path wrote,
 * rather than from a reconstruction that could disagree.
 */
export const closesFor = (ledger: PriceSeries[], teamId: string, date: string): number[] =>
  ledger
    .filter((day) => day.date <= date && day.close[teamId] !== undefined)
    .map((day) => day.close[teamId]);

export type { PriceRegime };
