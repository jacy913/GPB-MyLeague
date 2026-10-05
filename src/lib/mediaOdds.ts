import type { Game, Team } from '../types';
import { MEDIA_PROFILES, type MediaId } from '../data/media';
import {
  HOUSE_MARGIN, HOME_ADVANTAGE_LOGIT,
  probabilityToAmerican, americanToProbability, formatAmerican, HOUSE_SHADE,
  weightedConsensus,
} from './markets';

/*
 * The odds maths now lives in markets.ts, alongside the field and line market
 * builders, so there is exactly one probability-to-price conversion in the
 * codebase. These re-exports keep the existing media page imports working and
 * keep the two verified modules reading the same way.
 */
export { HOUSE_MARGIN, HOME_ADVANTAGE_LOGIT, HOUSE_SHADE, probabilityToAmerican, americanToProbability, formatAmerican };

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
  /** The price the house posts on the away club, margin included. */
  houseProbability: number;
  houseOdds: number;
  /**
   * The home price, computed from its own probability.
   *
   * Not the negation of houseOdds. A -X/+X pair sums to exactly 1.0000 implied
   * probability, which is a book charging nothing, and the margin this module
   * carefully applies would be cancelled out by the negation.
   */
  homeProbability: number;
  homeOdds: number;
  /** Implied probability of both sides, minus 1. Positive means vig is charged. */
  overround: number;
  /** Widest probability gap between any two outlets, in points. */
  disagreement: number;
  /** The outlet furthest from the rest on this game. */
  outlier: MediaId;
}

/**
 * How far apart two outlets have to be before a game counts as SPLIT.
 *
 * One number, defined once, because it had become three literals. `MediaOddsSlate` coloured a row's
 * house price when `disagreement >= 0.12`, `BettingHub` warned on the same 0.12 twice, and the slate's
 * outlier dot is only legible relative to the same bar -- so the three could disagree about what
 * "split" meant and nothing would report it, because the code was correct in isolation each time.
 *
 * It is a wide bar on purpose. Nine forecasters include several that read the same inputs the same
 * way, so a genuinely contested game has to be quite lopsided before anybody splits on it; at a
 * tighter threshold the split rows would be most of the slate and the filter would mean nothing.
 *
 * Two other thresholds in the app look similar and are NOT this one, deliberately:
 * `HeadlinePanel` gates at 0.10 because a news story is worth writing about slightly earlier than a
 * wagering signal is worth taking, and `BettingHub` settles at 0.06 because by then the outcome is
 * known and the question is how close it was. Same quantity, three questions, three answers.
 */
export const SPLIT_DISAGREEMENT = 0.12;

/** True when the outlets are far enough apart for this game to count as contested. */
export const isSplit = (disagreement: number): boolean => disagreement >= SPLIT_DISAGREEMENT;

const clampProbability = (value: number): number => Math.max(0.02, Math.min(0.98, value));

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

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
  hollis: 0.25,
  glorest: 0.20,
  sharply: 0.80,
  /*
   * THE FIVE NEW SLOPES ARE PROVISIONAL AND THIS IS NOT AN OVERSIGHT.
   *
   * The three above are measured: tools/fitMediaOdds.ts dumped each outlet's Brier score over a
   * grid of slopes against settled games and these won. The five below were fitted against
   * THREE forecasters and have no fitted value yet.
   *
   * They are set to 0.25 -- the value Glorest fitted to -- for one reason: a slope near zero is
   * the CONSERVATIVE choice. A slope multiplies a z-scored gap, so an understated slope makes the
   * forecaster read closer to the middle of the pack than he really is, which costs him
   * discrimination. An OVERSTATED slope makes a forecaster who has never been measured look
   * emphatic, and emphatic-and-unmeasured is how a house ends up confidently wrong.
   *
   * Step 5 re-fits all eight. Until then these five are the most visible uncalibrated numbers in
   * the module, and `tools/checkMediaProfiles.ts` says so.
   *
   * SHARPLY'S 0.80 IS NOT A TYPO AND MUST SURVIVE RE-FITTING. It is roughly three times his
   * fitted optimum of 0.25. That gap is the exploitable flaw the whole media layer is built
   * around: being right on average and wrong about how sure you are are two different failures,
   * and only the second is expensive. A recalibration pass that "corrects" him to his optimum
   * destroys the best play in the game.
   */
  sallow: 0.20,
  jardins: 0.05,
  boyle: 0.20,
  mussad: 0.20,
  wardley: 0.10,
  /*
   * SCINTILLA IS FITTED AT 0.20, measured by `tools/fitMediaOdds.ts` at a Brier of 0.2482.
   *
   * He arrived on a pre-declared floor of 0.05 for the same reason his confidence arrived on one:
   * an unmeasured forecaster should read close to the middle of the pack rather than look emphatic.
   * The fit moved him to 0.20 and the floor is overridden, because he is no longer unmeasured. The
   * block above's reasoning about conservative slopes still stands for whoever is next.
   */
  scintilla: 0.20,
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
  const rawConsensus = weightedConsensus((profile) => probability[profile.id]);

  /*
   * Shade toward even, then price both sides independently.
   *
   * The house's own view is deliberately not the average of the three outlets.
   * See HOUSE_SHADE for why, and for the measurement behind the value. The
   * outlets keep their own probabilities and their own characters; only the
   * number the house posts is pulled back.
   */
  const consensusProbability = 0.5 + (rawConsensus - 0.5) * (1 - HOUSE_SHADE);

  /*
   * Both sides priced independently, each scaled by the margin.
   *
   * The board used to take the margin off the favourite and then derive the
   * other side by negating that price. Negation is arithmetically a zero-vig
   * pair: -X and +X decode to X/(X+100) and 100/(X+100), which sum to exactly
   * 1.0000 for every X. So the 4.5 per cent margin was computed, applied, and
   * then entirely erased before it reached the page, and every moneyline on the
   * board was posted at fair value.
   *
   * That was not cosmetic. With no vig, whichever side the outlets misprice is
   * simply positive expected value, and since they over-price strong
   * favourites, flat-betting the underdog printed money across a full season.
   * Fixing the vig closed most of that leak; the shade closed the rest.
   *
   * Scaling both sides by 1 + HOUSE_MARGIN is what produces a real overround.
   * It has to be a straight multiplier on each: the two probabilities are
   * complementary, so pushing them apart in opposite directions about 0.5
   * leaves their sum at exactly 1 and creates no vig at all.
   */
  const houseProbability = clampProbability(consensusProbability * (1 + HOUSE_MARGIN));
  const homeProbability = clampProbability((1 - consensusProbability) * (1 + HOUSE_MARGIN));

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
    homeProbability,
    homeOdds: probabilityToAmerican(homeProbability),
    /** over implied + under implied - 1. The margin the book is charging. */
    overround: (houseProbability + homeProbability) - 1,
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