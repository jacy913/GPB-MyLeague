/**
 * Fanbase size and liquidity: which clubs trade tight, and which gap.
 *
 * ===========================================================================
 * WHY THIS EXISTS, AND WHY IT IS NOT A FIELD ON `Team`
 * ===========================================================================
 *
 * The blueprint's Phase 3 §5.3 asks for market size, because "big-market teams trade tight;
 * small-market clubs are illiquid and gap around news" does three things at once -- it makes each
 * club's trading feel distinct, it rewards finding value in thin names, and it is a real market
 * phenomenon rather than an invented mechanic.
 *
 * `Team` has no such field. Adding one is a schema change: `Team` serializes per row to Supabase,
 * so a fanbase is a migration, a backfill for existing saves, and a decision about who owns the
 * value. That is a real cost for a number the game can derive.
 *
 * So it is DERIVED, from the club's own identity, with no stored state at all.
 *
 * ===========================================================================
 * DERIVED FROM THE CLUB IDENTITY, NOT FROM THE SEED
 * ===========================================================================
 *
 * Market size is a property of the club, not of the season. `grandland` is a big market in 2026 and
 * in 2031, and it is a big market whether or not anyone is simulating right now.
 *
 * That is why this hashes `id | city | name` and takes NO seed. A seeded derivation would be
 * reproducible within a save and meaningless outside one: the same club would be a major market in
 * one universe and marginal in the next, for no reason a player could perceive. Because there is no
 * seed and no stored field, this survives save and load, and two devices looking at the same league
 * agree without exchanging anything.
 *
 * The three fields are hashed together rather than the id alone because the ids are three letters
 * (`alc`, `der`, `sta`) -- a very small space to spread 32 clubs across. The city names are long and
 * distinctive, so they carry the entropy.
 *
 * ===========================================================================
 * THE PROPERTY THAT MATTERS MOST: IT MUST NOT BE A STRENGTH PROXY
 * ===========================================================================
 *
 * If size correlated with `rating`, liquidity would quietly be a quality signal, and the crowd in
 * Phase 3 would end up trading on club strength while appearing to trade on market depth. Every
 * conclusion drawn from the crowd would then be about the thing it was not measuring.
 *
 * `checkFanbase` asserts the correlation with rating is near zero, and asserts the same across
 * `previousBaselineWins`, which is the other quality signal on `Team`. This is the check that makes
 * the derivation safe to use, and it is checked rather than assumed.
 *
 * ===========================================================================
 * THE TIER BOUNDARIES ARE CHOSEN, NOT MEASURED
 * ===========================================================================
 *
 * Nothing in this codebase has measured how market sizes should distribute across a 32-club league,
 * because there are no markets yet to measure. The quintile boundaries below are drawn so that a
 * uniform draw yields roughly one club in six major markets and one in six marginal ones -- a shape
 * with real spread and a real thin tail, rather than a smooth gradient where every club is a bit
 * illiquid and nothing is memorable.
 *
 * `checkFanbase` prints the distribution the boundaries actually produce. They were set before that
 * measurement and have not been moved since; if the printed shape is bad, the boundaries are the
 * thing to argue about rather than the number.
 */

import type { Team } from '../../types';

/** Market tiers, widest first. The names are for display and for the crowd's behaviour. */
export type MarketTier = 'major' | 'large' | 'mid' | 'small' | 'marginal';

/**
 * Draw boundaries on a 0-100 size, wide tier first.
 *
 * Quintiles, adjusted so `major` and `marginal` are thin and the middle is broad. A real league has
 * a handful of cities that matter and a handful nobody watches; a uniform spread would not.
 */
export const TIER_BOUNDS: Array<{ tier: MarketTier; above: number }> = [
  { tier: 'major', above: 84 },
  { tier: 'large', above: 64 },
  { tier: 'mid', above: 38 },
  { tier: 'small', above: 14 },
  { tier: 'marginal', above: -1 },
];

export interface Fanbase {
  teamId: string;
  /** The club's display name, carried so a caller need not look it up. */
  name: string;
  /** Continuous market size on 0-100. The raw draw, before tiering. */
  size: number;
  tier: MarketTier;
  /**
   * How easily this club trades, 0.25 to 1.0.
   *
   * The floor is 0.25 rather than 0 on purpose: even the smallest market in the league still has
   * some holders, and a liquidity of zero would make the price path undefined for those clubs
   * rather than merely thin.
   */
  liquidity: number;
  /**
   * How far this club's price can be shoved by a single order, relative to a major market.
   *
   * This is the mechanic §5.3 is actually asking for. A thin name should GAP on news -- jump more
   * than the news alone would justify, because there is no counterparty to absorb it. `liquidity`
   * alone cannot express that, because it only says how deep the book is; this says how violently the
   * price responds.
   */
  gapRisk: number;
}

/** The largest extra move a marginal-market club can suffer from one shock, as a multiple. */
/**
 * The floor on liquidity, and the top of the size scale. Shared so the gap maths cannot drift apart.
 */
export const LIQUIDITY_FLOOR = 0.25;

/**
 * The SCALE on how hard a thin name's shock lands -- NOT the achievable maximum.
 *
 * ---------------------------------------------------------------------------
 * NAMED WRONG AT FIRST, AND THE ERROR WAS WORTH CATCHING
 * ---------------------------------------------------------------------------
 *
 * This was `MAX_GAP_MULTIPLE`, commented "a marginal club's shock lands up to 1.8x as hard". Both
 * halves were wrong. The reachable ceiling is not 1.8, because `gapRisk` is
 * `(1 - liquidity) * this` and liquidity has a floor of 0.25 -- so `1 - liquidity` never exceeds
 * 0.75, and the total multiplier tops out at 1 + 0.75 x 1.8 = **2.35x**, not 1.8x.
 *
 * `checkFanbase` caught it by printing a range ending at 2.80 while this header claimed 1.8. The
 * honest figures for the real 32 clubs are 1.01x for the widest market and 2.27x for the thinnest.
 * So the constant is renamed to say what it actually is -- a scale -- and the reachable bounds are
 * derived below rather than asserted in prose where they can drift.
 */
export const GAP_SCALE = 1.8;

/** The largest gap multiple any club can actually reach, given the liquidity floor. */
export const MAX_REACHABLE_GAP = 1 + (1 - LIQUIDITY_FLOOR) * GAP_SCALE;

/**
 * A 32-bit hash of a string, mixing every character.
 *
 * FNV-style with the same finaliser shape as `noiseFor` in `sharePrice.ts`, duplicated rather than
 * imported because these serve opposite purposes -- one is a per-daily market draw seeded by the
 * season, the other is a permanent property of a club -- and a shared helper would invite someone to
 * seed one with the other's argument.
 */
const hashString = (value: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
};

/** Market size on 0-100 for a club. Depends only on its identity, so it never changes. */
export const marketSizeFor = (team: Pick<Team, 'id' | 'city' | 'name'>): number =>
  (hashString(`${team.id}|${team.city}|${team.name}`) % 10000) / 100;

export const tierFor = (size: number): MarketTier =>
  TIER_BOUNDS.find((bound) => size > bound.above)?.tier ?? 'marginal';

/**
 * Liquidity from size.
 *
 * Linear on purpose. A curve would let me give mid-size clubs a floor while still making the
 * smallest genuinely painful, but a curve is one more shape to justify with no data behind it, and
 * linear already spreads the range across the band that matters.
 */
export const liquidityFor = (size: number): number =>
  LIQUIDITY_FLOOR + (1 - LIQUIDITY_FLOOR) * (Math.max(0, Math.min(100, size)) / 100);

/**
 * Gap tendency: the extra multiplier a shock picks up in a thin book.
 *
 * `1 - liquidity` runs from 0 at size 100 down to at most 0.75 at size zero, so the multiplier
 * ranges 1.00x to MAX_REACHABLE_GAP (2.35x), and measures 1.01x to 2.27x across the current league.
 * Squaring it would concentrate the effect harder on the very thinnest names; leaving it linear
 * means the difference between the smallest and the median club is visible but not absurd, which is
 * what §5.3 describes.
 */
export const gapRiskFor = (size: number): number => (1 - liquidityFor(size)) * GAP_SCALE;

export const fanbaseFor = (team: Pick<Team, 'id' | 'city' | 'name'>): Fanbase => {
  const size = marketSizeFor(team);
  return {
    teamId: team.id,
    name: team.name,
    size,
    tier: tierFor(size),
    liquidity: liquidityFor(size),
    gapRisk: gapRiskFor(size),
  };
};

/** The whole league's fanbases, in the order the teams were given. */
export const leagueFanbases = (teams: Team[]): Fanbase[] => teams.map(fanbaseFor);

/** A lookup by team id, for callers that price one club at a time. */
export const fanbaseById = (teams: Team[]): Map<string, Fanbase> =>
  new Map(leagueFanbases(teams).map((f) => [f.teamId, f]));
