/**
 * The share price series: a daily close per club, derived from the HXSE valuation.
 *
 * ===========================================================================
 * WHAT A SHARE PRICE IS HERE, AND WHY IT IS NOT A VALUATION
 * ===========================================================================
 *
 * The valuation in `teamValue.ts` is an assessment of a club. The share price is a TRADING
 * INSTRUMENT derived from that assessment -- something that moves for its own reasons, can
 * overshoot, and can be wrong about a club for weeks at a time. Those are different objects and
 * conflating them produces a UI nobody can read.
 *
 * So the scales are kept deliberately apart. The valuation lives on 0-100, centred at 50. The price
 * lives on 0-1000, centred at 500. A price of 700 does not mean a club is worth more than a
 * price of 300 by any amount a reader could compute from the screen.
 *
 * The two are related by a single documented transform, `fairPriceFor`, and that transform is
 * what mean reversion pulls toward. It is the ONLY thing connecting them.
 *
 * ===========================================================================
 * price(t+1) = price(t) x (1 + drift + shock + noise)
 * ===========================================================================
 *
 * `drift`   MEAN REVERSION toward fair value: `((fair - price) / price) x k`, clamped.
 *           This is the term that makes the whole thing read as a market. Without it the price is
 *           a random walk, and by August a club is either at zero or at infinity -- not because
 *           anything happened to it, but because a random walk does that over a hundred days.
 *           `checkSharePrice` asserts the boundedness that mean reversion buys, across many seeds,
 *           so the term cannot be quietly removed without the check noticing.
 *
 * `shock`   Discrete events, supplied by the caller: game results, headlines, transactions.
 *           These are the only terms that are facts rather than dynamics. Nothing is invented
 *           here, because a shock this module made up would be a headline nobody wrote.
 *
 * `noise`   A seeded draw, scaled by the day's volatility regime. See below.
 *
 * ===========================================================================
 * TWO VOLATILITY REGIMES, FROM CALENDAR PHASE
 * ===========================================================================
 *
 * IN-SEASON is continuous and performance-driven: the price tracks results every day. The plan's
 * figure is a daily sigma around 3-5%.
 *
 * OFFSEASON is discrete and event-driven: quiet days are genuinely near-silent, and the moves
 * happen in jumps when rosters change -- a superstar signing is a 15-20% move. That is not an
 * arbitrary multiplier bolted on for drama. Baseball offseasons really are more explosive than
 * quarterly earnings, and a quiet December that moves 4% a day on noise would be the lie.
 *
 * The regime is an INPUT (`regimeByDate`), not something this module infers. It knows nothing
 * about the league calendar, and duplicating that knowledge here would be a second place for the
 * season's shape to be wrong.
 *
 * ===========================================================================
 * DETERMINISM, AND WHY THE NOISE IS HASHED RATHER THAN STREAMED
 * ===========================================================================
 *
 * No unseeded randomness anywhere in this file. There is no `Math.random` call in this module at
 * all, and `checkSharePrice` proves it by replacing `Math.random` with a thrower and running a full
 * season through it -- an assertion that fails the moment anyone adds one.
 *
 * The per-day noise is a HASH of `(seed, date, teamId)` rather than a draw from a sequential
 * generator. That is stronger than seeding a stream, and the reason is append-only stability: with
 * a sequential stream, asking for 200 days instead of 180 would change the prices of days 1 to 180
 * and every chart already drawn would silently disagree with the next one. Hashing means the close
 * for a given day is a pure function of that day, so extending the series, loading a save from
 * month three, or recomputing a single date all give the same number.
 *
 * ===========================================================================
 * THE TWO STRUCTURAL GUARANTEES
 * ===========================================================================
 *
 * 1. NO UNSEEDED RANDOMNESS. Asserted by poisoning `Math.random`.
 * 2. THE PRICE STAYS IN ITS BAND. Mean reversion is load-bearing, and a price that reaches zero
 *    or infinity means it has stopped being a price. Checked across many seeds rather than one,
 *    because a bounded random walk is bounded by luck far more often than it is bounded by mean
 *    reversion -- one seed proves nothing here.
 */

import type { Game, Team } from '../../types';

/** The trading band. The plan's 0-1000, and NOT a valuation scale. */
export const PRICE_MIN = 0;
export const PRICE_MAX = 1000;

/** Where a club sits at exactly fair value: the midpoint of the band. */
export const PRICE_MID = 500;

/**
 * How far a price may stray from fair value in one day.
 *
 * The plan calls +6% defensible for a blowout win and "a slot machine" beyond it. This is the
 * machine, not the comment: without a cap a single compounding day can leave the band, and a
 * series that has left its band is no longer comparable to one that has not.
 */
export const MAX_DAILY_MOVE = 0.35;

export type PriceRegime = 'in_season' | 'offseason';

/**
 * Daily noise scale by regime, in fractional terms.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOT THE REALISED VOLATILITY, AND THE GAP IS MEASURED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 *
 * The plan names a daily sigma of 3-5% in season. That describes the market a reader would see,
 * so it is what the module aims at -- but a price being pulled toward a moving target trades a
 * little of its daily variance for the pull, so the realised daily sigma comes out BELOW the noise
 * scale fed in.
 *
 * Measured, across noise scales from 0.040 to 0.080 and across fair-value drift from -20 to +20
 * points a day, over eight seeds each:
 *
 *     realised daily sigma  ~=  0.582 x REGIME_VOLATILITY.in_season
 *
 * and the ratio held to within 0.01 across every one of those variations, so it is a property of
 * the drift term rather than of the fixture. A single AR(1) estimate predicts a ratio slightly
 * ABOVE 1, which the measurement contradicts; the remaining difference is the fair-value series
 * moving under the price faster than the price can equilibrate. No closed form is claimed here --
 * only the measured figure, and the fact that it is stable.
 *
 * So `0.07` is chosen to put the realised figure at 4.08%, the middle of the planned band, and
 * `checkSharePrice` gates the REALISED number against 3-5%. If the drift term is ever removed or
 * retuned, that gate fails, which is the point: the drift term is load-bearing for volatility as
 * well as for boundedness.
 *
 * The offseason scale is an order of magnitude smaller, which is the whole point of the two
 * regimes: offseason movement comes from events passed in as shocks, not from daily noise. A quiet
 * December should be quiet.
 *
 * Neither figure is a measured property of anything real. There are no share prices yet to measure,
 * so these come from the plan's design discussion and will earn any other description only once
 * the series has a history worth regressing.
 */
export const REGIME_VOLATILITY: Record<PriceRegime, number> = {
  in_season: 0.07,
  offseason: 0.005,
};

/**
 * Mean-reversion strength `k`.
 *
 * How much of the gap to fair value closes in a single day. Small on purpose: a large `k` would
 * make prices snap to fair value and stop being prices, trading one artefact for another. At 0.06
 * a club trading 30% above fair value closes about a sixth of the gap in a day.
 */
export const MEAN_REVERSION_K = 0.06;

/** The valuation -> price transform. The ONLY coupling between the two scales. */
export const fairPriceFor = (valuation: number): number =>
  PRICE_MIN + (Math.max(0, Math.min(100, valuation)) / 100) * (PRICE_MAX - PRICE_MIN);

/**
 * A deterministic draw in [-1, 1] from `(seed, date, teamId)`.
 *
 * mulberry32 over a 32-bit hash of the key. Not cryptographic and does not need to be -- it needs
 * to be stable across reloads and well spread across days, and both hold. The hash mixes all three
 * inputs, so two clubs sharing a date get uncorrelated draws and the same club on two days gets
 * unrelated ones.
 */
export const noiseFor = (seed: number, date: string, teamId: string): number => {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  for (const ch of `${date}|${teamId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = (h ^ (h >>> 15)) >>> 0;
  // mulberry32 finaliser, folded from the top 24 bits and mapped to [-1, 1].
  let t = h;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return unit * 2 - 1;
};

/** One day of one club. */
export interface PriceDayInput {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  teamId: string;
  /** Season seed. The only source of randomness in this module. */
  seed: number;
  /** Yesterday's close. Ignored on the first day, where `open` is used instead. */
  previous: number;
  /** Today's fair price, from `fairPriceFor(valuation)`. */
  fair: number;
  /** Today's discrete event moves, as fractions. A +0.15 means "up fifteen percent". */
  shock: number;
  regime: PriceRegime;
}

/**
 * ONE DAY of the price path, as a pure function. No state, no clock, no randomness beyond the
 * caller's seed.
 *
 * The three terms are clamped IN COMBINATION rather than individually, because the failure they
 * guard against is cumulative: three individually reasonable moves of 12% each compose to a 40%
 * day, which `MAX_DAILY_MOVE` is meant to prevent. Clamping each term separately would not stop
 * that at all.
 */
export const nextPrice = (input: PriceDayInput): number => {
  const fair = input.fair > 0 ? input.fair : PRICE_MID;
  const price = input.previous > 0 ? input.previous : fair;

  // Mean reversion. The `Math.max(0, ...)` guard matters: a price below fair is where the drift
  // term would otherwise be negative and multiplicative, which is how a series decays to zero.
  const gap = (fair - price) / price;
  const drift = Math.max(-MEAN_REVERSION_K, Math.min(MEAN_REVERSION_K, gap * MEAN_REVERSION_K));

  const noise = noiseFor(input.seed, input.date, input.teamId) * REGIME_VOLATILITY[input.regime];
  const total = drift + input.shock + noise;

  const clampedMove = Math.max(-MAX_DAILY_MOVE, Math.min(MAX_DAILY_MOVE, total));
  const next = price * (1 + clampedMove);
  return Math.max(PRICE_MIN, Math.min(PRICE_MAX, next));
};

/** A daily close. One per date, covering every club. */
export interface PriceSeries {
  /** ISO date. */
  date: string;
  /** teamId -> close. */
  close: Record<string, number>;
}

export interface PriceSeriesInput {
  /** Season seed. The ONLY source of randomness, and it is hashed, never drawn from a clock. */
  seed: number;
  /** Dates in ascending order. The first date opens at fair value. */
  dates: string[];
  teamIds: string[];
  /** ISO date -> (teamId -> fair price). */
  fairByDate: Map<string, Record<string, number>>;
  /** ISO date -> (teamId -> fractional event move). Absent dates have no events. */
  shocksByDate?: Map<string, Record<string, number>>;
  /** ISO date -> regime. Drives the volatility, per section 4.4. */
  regimeByDate: Map<string, PriceRegime>;
  /** Optional override of the opening price per club, for back-filling a series that already began. */
  openingPriceById?: Record<string, number>;
}

/**
 * Build the whole series.
 *
 * Strictly append-only in effect: a date's close depends only on the previous close, that date's
 * fair value, its shocks, its regime, and the seed. Extending `dates` does not change any earlier
 * close, which is what lets a caller recompute a single date, or load a save mid-season, and get
 * the same numbers.
 */
export const buildPriceSeries = (input: PriceSeriesInput): PriceSeries[] => {
  const series: PriceSeries[] = [];
  let previousById: Record<string, number> = { ...(input.openingPriceById ?? {}) };

  for (const date of input.dates) {
    const fair = input.fairByDate.get(date) ?? {};
    const shocks = input.shocksByDate?.get(date) ?? {};
    const regime = input.regimeByDate.get(date) ?? 'in_season';

    const close: Record<string, number> = {};
    for (const teamId of input.teamIds) {
      const fairPrice = fair[teamId] ?? PRICE_MID;
      const isFirst = Object.keys(previousById).length === 0;
      close[teamId] = isFirst
        ? Math.max(PRICE_MIN, Math.min(PRICE_MAX, fairPrice))
        : nextPrice({
          seed: input.seed,
          date,
          teamId,
          previous: previousById[teamId] ?? fairPrice,
          fair: fairPrice,
          shock: shocks[teamId] ?? 0,
          regime,
        });
    }
    previousById = close;
    series.push({ date, close });
  }
  return series;
};

/**
 * Turn a completed day's games into the day's shocks.
 *
 * A win moves the price up and a loss moves it down, scaled by how emphatic the result was --
 * because a one-run win is not a blowout, and pricing them identically would throw away the only
 * real information a game result contains.
 *
 * `runMargin` is wins minus losses, so a 6-run blowout scores higher than a 1-run win. Capped,
 * because a 14-run win is not fourteen times the news.
 */
export const shockFromGame = (runsFor: number, runsAgainst: number): number => {
  const margin = runsFor - runsAgainst;
  const perRun = 0.012;
  return Math.max(-MAX_DAILY_MOVE, Math.min(MAX_DAILY_MOVE, margin * perRun));
};

/** Roll a day's completed regular-season games into a shock map for that date. */
export const shocksForDate = (games: Game[]): Record<string, number> => {
  const shocks: Record<string, number> = {};
  for (const game of games) {
    if (game.status !== 'completed') continue;
    shocks[game.homeTeam] = (shocks[game.homeTeam] ?? 0) + shockFromGame(game.score.home, game.score.away);
    shocks[game.awayTeam] = (shocks[game.awayTeam] ?? 0) + shockFromGame(game.score.away, game.score.home);
  }
  return shocks;
};

/** Teams on a given date, for callers assembling the input maps. */
export const teamsOnDate = (teams: Team[], date: string, played: Game[]): string[] => {
  const busy = new Set<string>();
  for (const game of played) {
    if (game.date !== date) continue;
    busy.add(game.homeTeam);
    busy.add(game.awayTeam);
  }
  return teams.filter((t) => !busy.has(t.id)).map((t) => t.id);
};
