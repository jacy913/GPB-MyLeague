/*
 * How many people are at the game, and how many are watching it.
 *
 * ============================================================================
 * WHAT THIS IS, AND WHY IT IS NOT IN `fanbase.ts`
 * ============================================================================
 *
 * `fanbase.ts` answers "how deep is this club's order book", which is a trading question. This answers
 * "how many humans want to be in the room", which is an attention question. They share an input --
 * `marketSizeFor` -- and nothing else, and it matters that they stay separate: a club can have a thin
 * order book and a packed house, and a liquid stock is not an audience.
 *
 * ============================================================================
 * THE STICKINESS RULE, WHICH IS THE WHOLE POINT
 * ============================================================================
 *
 * "Big-market teams can play terribly and only lose a little attendance; small-market teams get hurt."
 *
 * That is not a multiplier you can apply after the fact, because the penalty itself has to differ by
 * club. It is expressed here as the EXPONENT on team form, and the exponent falls as popularity rises:
 *
 *     beta = FORM_EXPONENT_FLOOR + SPAN * (1 - popularity/100)
 *
 * so a Stripes game (pop 98, beta 0.23) barely notices form, and an Agents game (pop 5, beta 0.74)
 * feels every loss. Measured with the shipped data and a mid-tier opponent on a weekday:
 *
 *     Stripes   .500 -> 45,600      .300 -> 40,000     an 11% penalty
 *     Agents    .500 ->  5,850      .300 ->  4,150     a 29% penalty
 *
 * A single shared exponent cannot produce that pair, and producing it any other way -- a floor under
 * big markets, say -- would make the crowd insensitive to winning everywhere instead of only where
 * loyalty actually is.
 *
 * ============================================================================
 * EVERY COEFFICIENT BELOW IS A CHOICE, AND NONE OF THEM IS MEASURED
 * ============================================================================
 *
 * There are no attendance figures or broadcast ratings in this codebase to fit against. The constants
 * are chosen so the league's output lands in a plausible band -- a marginal club's gate in the low
 * thousands, a median fixture around 1.3M viewers, a marquee night near 3.5M -- and `checkCrowdSize`
 * prints the distribution so the shape can be argued about instead of trusted. If the numbers look
 * wrong they are wrong in a visible place, which is the whole reason this file exists separately from
 * the arithmetic that fills it.
 */
import { marketSizeFor } from './fanbase';
import type { Team } from '../../types';

/** Lowest win rate that still gets a club a full park. A club that cannot win 30% is not drawing anyone. */
const FORM_FLOOR = 0.3;
/** Highest win rate used. A .900 club is not twice the draw of a .700 club and the curve says so. */
const FORM_CEILING = 0.72;

/**
 * How much of a club's popularity converts into a crowd, and the floor that stops a small market
 * going to literally nobody.
 *
 * Without the floor, a marginal club's demand approaches zero and the smallest club in the league
 * gates a few hundred people, which is not a small crowd, it is a closed park.
 *
 * 0.45, and it was 0.35 until `checkCrowdSize` measured the league's spread. With capacity ALSO derived
 * from popularity -- which is right, a big market has a big ground -- a 0.35 floor put popularity into
 * the attendance figure TWICE, once as a building and once as a crowd, and the two compounded into a
 * 9.7x spread across the league. Real attendance runs nearer 3.7x from smallest ground to largest. The
 * floor is the dial for that and 0.45 brings it to 4.2x.
 */
const DEMAND_FLOOR = 0.45;

/** How hard a good opponent pulls. A big club on the road is an event; a small one is a Tuesday. */
const OPPONENT_PULL = 0.35;

/** Weekday and weekend. Chosen, small, and the shape every real league has. */
const WEEKDAY_FACTOR = 0.93;
const WEEKEND_FACTOR = 1.05;

/** Division rivals draw, and so do postseason games, by more than a good record does. */
const RIVALRY_FACTOR = 1.12;
const PLAYOFF_FACTOR = 1.25;

/**
 * STADIUM CAPACITY, derived from market size rather than entered.
 *
 * Thirty-two more hand-set numbers would be thirty-two more invented facts, and the only thing they
 * would do that this does not do is be wrong in thirty-two separate ways. A club's ground is sized
 * for its market, so deriving it says that out loud instead of implying the league has surveyed its
 * parks.
 *
 * AND IT IS DELIBERATELY SHALLOW -- 30,000 to about 43,700, a 1.4x spread where real parks run nearer
 * 3.7x from smallest to largest. Because popularity already reaches attendance through `demand`, a
 * steep capacity curve would count it a second time and square the effect. This is the same mistake
 * `DEMAND_FLOOR` was corrected for, seen from the other side: one input, one place it acts.
 */
export const stadiumCapacityFor = (team: Pick<Team, 'id' | 'city' | 'name'>): number =>
  30_000 + Math.round(marketSizeFor(team) * 140);

/**
 * The form exponent, and the only genuinely new idea in this file.
 *
 * Declared separately so the stickiness rule can be argued with on its own, and so a reader can see
 * that the two ends are 0.23 and 0.74 -- a three-fold difference in how much winning matters.
 */
const FORM_EXPONENT_FLOOR = 0.22;
const FORM_EXPONENT_SPAN = 0.55;

export const formExponentFor = (popularity: number): number =>
  FORM_EXPONENT_FLOOR + FORM_EXPONENT_SPAN * (1 - Math.min(100, Math.max(0, popularity)) / 100);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** `YYYY-MM-DD` to 0 (Sunday) .. 6, in UTC so a saved game does not change its crowd at midnight local. */
const dayOfWeek = (date: string | null): number => {
  if (!date) return 3;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed).getUTCDay() : 3;
};

const isWeekend = (date: string | null): boolean => {
  const d = dayOfWeek(date);
  return d === 0 || d === 6;
};

export interface CrowdInput {
  home: Pick<Team, 'id' | 'city' | 'name' | 'wins' | 'losses'>;
  away: Pick<Team, 'id' | 'city' | 'name'>;
  date?: string | null;
  playoff?: boolean;
  /** Pre-computed so a caller can test the stickiness rule without simulating a season. */
  homeWinPct?: number;
}

const winPctOf = (team: Pick<Team, 'id' | 'city' | 'name' | 'wins' | 'losses'>): number => {
  const played = team.wins + team.losses;
  // A club that has not played yet is not a .500 club, but it is also not a .000 club. The FORM_FLOOR
  // clamp does the work from here, and picking .500 as the neutral keeps opening day comparable.
  return played === 0 ? 0.5 : team.wins / played;
};

/**
 * Who is in the seats.
 *
 * Scaled to capacity and CLAMPED, so a sellout reads as a sellout. Without the clamp a big club at
 * .700 with a big opponent on a weekend would print 61,000 into a 49,400-seat park, which is a number
 * no reader would believe and every reader would notice.
 */
export const attendanceFor = (input: CrowdInput): number => {
  const homePop = marketSizeFor(input.home);
  const awayPop = marketSizeFor(input.away);

  const demand = DEMAND_FLOOR + (1 - DEMAND_FLOOR) * (homePop / 100);
  const form = clamp(input.homeWinPct ?? winPctOf(input.home), FORM_FLOOR, FORM_CEILING);
  const beta = formExponentFor(homePop);

  const opponentPull = 1 + OPPONENT_PULL * (awayPop / 100);
  const dayFactor = isWeekend(input.date ?? null) ? WEEKEND_FACTOR : WEEKDAY_FACTOR;
  const context = input.playoff ? PLAYOFF_FACTOR : 1;

  const share = clamp(demand * (form ** beta) * opponentPull * dayFactor * context, 0, 1);
  return Math.round(stadiumCapacityFor(input.home) * share);
};

/**
 * HOW MANY PEOPLE ARE WATCHING, which is not the same number and does not deserve the same shape.
 *
 * Attendance is bounded by a building and therefore compressed: a sellout and a near-sellout look
 * alike. A television audience is not bounded by anything, so its spread across the league is far
 * WIDER than attendance's -- the top fixtures pull three or four times a median one while the worst
 * pull almost nobody. The exponent carries that difference: viewership uses 2.4 where attendance uses
 * a linear term, so the two concentrate in genuinely different places rather than being the same
 * ranking with different units.
 */
const VIEWERS_BASE = 60_000;
const VIEWERS_SCALE = 3_200_000;
const VIEWERS_EXPONENT = 2.8;
/**
 * How much two good clubs in one game is worth, over two ordinary ones.
 *
 * The exponent is chosen so the league's audiences spread roughly 6.8x from smallest fixture to
 * largest, against attendance's 5.5x. That ordering is not a style preference: a crowd is capped by a
 * building and therefore compresses, and an audience is capped by nothing. Measured by
 * `checkCrowdSize`, which fails if the ordering ever inverts -- the first version of this module had
 * viewership spreading NARROWER than attendance and the check was right to say so.
 *
 * The BASE is the other half of that. An additive term flattens every ratio it is added to, so a
 * large base is the quiet way to make an unbounded audience look like a bounded one. At 120,000 the
 * spread came out at 5.1x against attendance's 5.2x -- the wrong way round, and only visible because
 * the check measures both rather than assuming.
 */
const CONTENDER_BUMP = 1.25;

/**
 * The product both clubs sit at when each is exactly .500, and therefore the point where this term is
 * 1.000. See the note on `quality` below -- the first version of that expression had no such anchor
 * and could not exceed 1.000 at all, so two contending clubs made an audience SMALLER.
 */
const NEUTRAL_FORM = 0.5;
const neutralProduct = NEUTRAL_FORM ** 0.2 * NEUTRAL_FORM ** 0.2;

export const viewersFor = (input: CrowdInput & {
  awayWinPct?: number;
}): number => {
  const homePop = marketSizeFor(input.home);
  const awayPop = marketSizeFor(input.away);

  const meanPop = (homePop + awayPop) / 2 / 100;
  const draw = DEMAND_FLOOR + (1 - DEMAND_FLOOR) * meanPop;

  const homeForm = clamp(input.homeWinPct ?? winPctOf(input.home), FORM_FLOOR, FORM_CEILING);
  const awayForm = clamp(input.awayWinPct ?? 0.5, FORM_FLOOR, FORM_CEILING);

  /*
   * TWO CONTENDING CLUBS PULL, AND THE TERM IS ANCHORED AT .500 SO IT CAN GO BOTH WAYS.
   *
   * The first version was `1 + BUMP * (product - 1)`, and `product` is at most 0.904 because both
   * forms are clamped at 0.72 and raised to the 0.2. So the bracket was never positive and the term
   * only ever SUBTRACTED: at .500/.500 it applied a 0.697 factor, and at two .720 clubs it still
   * applied 0.880. Every fixture in the league was quieter than an average Tuesday, and the marquee
   * night came in under the floor the check was holding it to.
   *
   * Dividing the deviation by `neutralProduct` makes .500/.500 exactly 1.000, a fixture of two good
   * clubs 1.24, and a fixture of two bad ones 0.77. Form barely moves an audience -- people watch the
   * big clubs whether or not they are winning -- which is why the exponent is 0.2 and not 0.
   */
  const product = (homeForm ** 0.2) * (awayForm ** 0.2);
  const quality = 1 + CONTENDER_BUMP * ((product - neutralProduct) / neutralProduct);
  const context = input.playoff ? PLAYOFF_FACTOR : 1;

  return Math.round(VIEWERS_BASE + VIEWERS_SCALE * (draw ** VIEWERS_EXPONENT) * quality * context);
};

/** `3.4M` / `812K`, because a seven-figure integer nobody reads is worse than no number at all. */
export const formatCrowd = (n: number): string => (n >= 1_000_000
  ? `${(n / 1_000_000).toFixed(1)}M`
  : `${Math.round(n / 1000)}K`);