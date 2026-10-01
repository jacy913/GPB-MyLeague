import { MEDIA_PROFILES, type MediaId } from '../data/media';
import { liveOutcomeCount } from './futuresRisk';

/**
 * Market framework.
 *
 * One construction for every market, so the betting layer has one rule rather
 * than five. Each forecaster states a FAIR VALUE. The house takes the mean of
 * those fair values and applies a margin. The margin is the only reason acting
 * on the house is not automatically correct.
 *
 * Two shapes, because two kinds of question exist:
 *
 *   Field markets -- moneyline, division winner, MVP. A set of mutually
 *   exclusive outcomes, each forecaster posting a probability for each, summing
 *   to one. Mean the probabilities, then price them.
 *
 *   Line markets -- run total, first-five total. A number, not a field. Each
 *   forecaster posts the total at which over/under would be even. Mean those
 *   totals, and the mean is the house line.
 *
 * The important detail is that a field market averages PROBABILITIES, never
 * prices. American odds are not linear in probability, so the arithmetic mean of
 * three prices is the mean of nothing. tools/verifyMediaOdds.ts prints both so
 * the difference stays visible.
 */

/** House margin, applied to the consensus rather than to each forecaster. */
export const HOUSE_MARGIN = 0.045;

/**
 * How far the house line is pulled back toward even.
 *
 * The house is not the average of the three forecasters, because averaging a
 * well-calibrated read with a badly calibrated one does not land in between.
 * Lined Sharply posts 0.78 on games that have historically gone 0.53, and that
 * overconfidence is deliberate -- it is the exploitable flaw the layer is built
 * around, and flattening it would be correcting a character rather than fixing
 * a bug. But it does drag the CONSENSUS up, so the house ends up long at 70% in
 * a band that pays 60%.
 *
 * A real book shades toward the centre instead. This is the fitted value, and
 * the fit is measured on a book that actually charges -- an earlier version was
 * fitted while the moneyline's two sides were negations of each other, which is
 * arithmetically zero vig, so its numbers described a book paying out fair
 * value on both sides.
 *
 * Fitted by tools/fitHouseShading.ts and confirmed by
 * tools/verifyShadedHouse.ts, which replays flat strategies at each shade:
 *
 *   shade   fav net    dog net  (three seeds)
 *   0.00      -997    +197 / +393 / -6     <- bettor profits
 *   0.10      -996    -246 / +171 / -221
 *   0.15      -997    -458 / +65 / -324
 *   0.20      -997    -661 / -38 / -424    <- shipping
 *   0.30      -996    -995 / -236 / -616
 *
 * The spread between seeds is real and worth stating: the at-bat engine carries
 * unseeded randomness, so the same shade moves by a few hundred dollars between
 * runs. 0.20 is the mildest shade where BOTH flat strategies lose on every
 * seed, which is the bar that matters -- a bettor with no edge at all, betting
 * one side relentlessly, must not print money.
 *
 * What this does NOT fix: the worst-priced band is still 9 to 19 points off,
 * and the best is worth 2 to 3. Shading is a uniform transform, so it scales
 * every band together and cannot correct error that varies across them. Closing
 * that residual means moving the forecasters' slopes, which would be editing
 * the characters rather than the book.
 */
export const HOUSE_SHADE = 0.20;

/**
 * Home advantage, in log-odds.
 *
 * The measured value, not the real-baseball one. Repeated runs of the simulator
 * put home winners between 49.9 and 51.4 per cent of decided games, so home
 * field is very nearly neutral in this league. Encoding the real-world 53-54
 * per cent would be importing a fact about a different simulation and would
 * hand every forecaster a systematic error.
 */
export const HOME_ADVANTAGE_LOGIT = 0.04;

/**
 * Over/under margin, in runs.
 *
 * A total is a number the user has to beat, so the margin is added to the line
 * rather than taken out of a probability. Two-and-a-half tenths of a run is
 * worth roughly the same edge as the probability margin above, and is inside the
 * quarter-run increment used by every real board.
 */
export const LINE_MARGIN = 0.25;

const clampProbability = (value: number): number => Math.max(0.005, Math.min(0.995, value));

export const probabilityToAmerican = (probability: number): number => {
  const p = clampProbability(probability);
  if (p >= 0.5) return Math.round(-100 * p / (1 - p));
  return Math.round(100 * (1 - p) / p);
};

export const americanToProbability = (american: number): number => {
  if (american < 0) return clampProbability(-american / (-american + 100));
  return clampProbability(100 / (american + 100));
};

export const formatAmerican = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));
export const clampLogit = logistic;

/* ------------------------------------------------------------------ *
 * Field markets
 * ------------------------------------------------------------------ */

export interface MarketOutcome {
  /** Stable identifier, used for settlement. A team id or a player id. */
  key: string;
  /**
   * The club this outcome belongs to, when there is one.
   *
   * Needed because an award market is keyed by PLAYER, so key cannot be used to find
   * a crest. Carried rather than parsed out of sublabel, which for awards is the
   * string `city name` and would mean matching text against the team list in a
   * component -- a lookup that silently yields no logo the day a club is renamed.
   *
   * Undefined for a genuinely club-less outcome, such as a free agent. The crest is
   * then omitted rather than replaced with a broken image; label still names them.
   */
  teamId?: string;
  label: string;
  sublabel?: string;
  /** Each forecaster's fair probability that this outcome wins. */
  probability: Record<MediaId, number>;
  odds: Record<MediaId, number>;
  consensusProbability: number;
  houseProbability: number;
  houseOdds: number;
  /** Widest probability gap between any two forecasters, in points. */
  disagreement: number;
  /** The forecaster furthest from the middle of the pack on this outcome. */
  outlier: MediaId;
  /**
   * True when the SCHEDULE has decided this outcome cannot happen.
   *
   * Undefined when the caller had no standings to decide it from, which is different
   * from false: unknown is not the same as not-eliminated, and a UI that rendered
   * undefined as false would assert a club is in contention when nobody checked.
   */
  eliminated?: boolean;
}

export type MarketKind =
  | 'moneyline'
  | 'division'
  | 'league'
  | 'world_series'
  | 'award';

/**
 * The one constant market key for the title.
 *
 * It lives here rather than in `wallet.ts` because `wallet` already imports this
 * module, so a key exported from there and consumed here would be a circular
 * import -- and the cycle would resolve to `undefined` at module-init time in
 * whichever direction happened to be evaluated first. A market key is a market
 * concern anyway.
 */
export const WORLD_SERIES_MARKET_KEY = 'world_series:champion';

export interface FieldMarket {
  shape: 'field';
  kind: MarketKind;
  key: string;
  title: string;
  subtitle?: string;
  outcomes: MarketOutcome[];
  /**
   * How many outcomes are still live in this field.
   *
   * Attached to the market rather than computed in the component because it is a
   * property OF THE MARKET, and a component recomputing it would be a second place
   * for the live floor to drift. See `LIVE_OUTCOME_FLOOR` for why 0.001 is the
   * threshold.
   */
  liveOutcomes: number;
}

/**
 * A market over mutually exclusive outcomes.
 *
 * The margin is applied to EVERY side, as a straight multiplier. The previous
 * approach took it off the favourite alone, on the reasoning that a nine-way
 * award market should not tax longshots. That reasoning was wrong, and the
 * arithmetic is worth writing down because the failure is not obvious:
 *
 *   probabilities sum to 1 by definition. Shrink the favourite by half the
 *   margin and the field now sums to 1 - margin/2, so the book pays out MORE
 *   than fair on every outcome, and a bettor can exploit it with no
 *   forecasting skill at all. Measured on an eight-candidate award field, the
 *   overround came out at MINUS 2.27 per cent.
 *
 *   Shrinking the favourite by the FULL margin instead over-corrects, because
 *   the favourite was already the only side carrying the entire charge.
 *
 * A real book applies vig proportionally to every line, which is what this
 * does, and the favourite is not specially taxed. tools/checkVig.ts asserts the
 * implied probabilities sum above 1 for a field, a total, and a moneyline.
 */
export const buildFieldMarket = (input: {
  kind: MarketKind;
  key: string;
  title: string;
  subtitle?: string;
  entries: Array<{
    key: string;
    /**
     * The club this outcome belongs to, when it is not the same thing as `key`.
     *
     * Every caller supplies it. The mapper below used to drop it, which is why every award
     * row rendered an empty crest square: an award race is keyed by PLAYER, so `key` and
     * `teamId` genuinely differ there and the field has to survive the trip. On a division
     * or league race they are the same string, so the omission was invisible there.
     */
    teamId?: string;
    label: string;
    sublabel?: string;
    probability: Record<MediaId, number>;
    /**
     * True where the SCHEDULE has decided this outcome cannot happen, as opposed to
     * the price being small. Distinct on purpose: an eliminated club still has a
     * probability and a price, and those are the forecasters' opinion rather than a
     * fact about the schedule.
     */
    eliminated?: boolean;
  }>;
  /**
   * Live-field count that overrides the probability-derived one.
   *
   * The override exists because the two mean different things and only one of them
   * is true. A probability floor measures how confident the model is; a contention
   * count measures how many clubs can still win. For a 32-club title race the
   * forecasters' near-uniform scores make the first a constant, so the second is
   * what a bettor actually needs.
   */
  liveOutcomesOverride?: number;
}): FieldMarket => {
  const outcomes = input.entries.map((entry) => {
    const values = MEDIA_PROFILES.map((profile) => clampProbability(entry.probability[profile.id]));
    const consensusProbability = values.reduce((sum, value) => sum + value, 0) / values.length;
    const houseProbability = clampProbability(consensusProbability * (1 + HOUSE_MARGIN));

    const odds = {} as Record<MediaId, number>;
    MEDIA_PROFILES.forEach((profile) => { odds[profile.id] = probabilityToAmerican(entry.probability[profile.id]); });

    const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const outlier = MEDIA_PROFILES
      .map((profile) => [profile.id, Math.abs(entry.probability[profile.id] - median)] as const)
      .sort((a, b) => b[1] - a[1])[0][0];

    return {
      key: entry.key,
      // CARRIED THROUGH, AND IT WAS NOT.
      //
      // `buildAwardMarket` has been passing `teamId: entry.team?.id` on every award entry
      // since the field family was built, and the `MarketOutcome` type declares the field --
      // but this mapper never copied it onto the outcome it returns. Every other use of the
      // field silently got `undefined`.
      //
      // The visible consequence was on the awards tab and nowhere else: an award race is
      // keyed by PLAYER, so `teamById.get(outcome.key)` finds no club and the card rendered
      // an empty square on every single row. Division and league futures were unaffected
      // because their outcomes happen to be keyed by team id, so `outcome.teamId` being
      // undefined never mattered -- the key and the id were the same string.
      //
      // So this is one missing property in one mapper, and it only ever showed up on the one
      // market type where key and teamId are different things. It typechecked throughout,
      // because the field was optional on the type and the consumer handled undefined.
      teamId: entry.teamId,
      label: entry.label,
      sublabel: entry.sublabel,
      probability: entry.probability,
      odds,
      consensusProbability,
      houseProbability,
      houseOdds: probabilityToAmerican(houseProbability),
      disagreement: Math.max(...values) - Math.min(...values),
      outlier,
      // Carried through only when the caller knows it. Left undefined rather than
      // defaulting to a probability test, because "the schedule has eliminated this
      // club" and "the model rates this club low" are different claims and the UI
      // must not make the second one in the first one's voice.
      eliminated: entry.eliminated,
    };
  });

  /*
   * Scaling every probability by the same factor makes the field sum to
   * 1 + HOUSE_MARGIN before rounding, which is the overround the house is
   * charging. Rounding each price to a whole number of dollars moves that
   * slightly, by a fraction of a point on the longshots, so it is measured
   * rather than assumed by tools/checkVig.ts.
   */
  const ordered = [...outcomes].sort((a, b) => b.consensusProbability - a.consensusProbability);
  return {
    shape: 'field',
    kind: input.kind,
    key: input.key,
    title: input.title,
    subtitle: input.subtitle,
    outcomes: ordered,
    liveOutcomes: input.liveOutcomesOverride ?? liveOutcomeCount(ordered),
  };
};

/* ------------------------------------------------------------------ *
 * Line markets
 * ------------------------------------------------------------------ */

export interface LineMarket {
  shape: 'line';
  kind: 'total' | 'first5';
  key: string;
  title: string;
  subtitle?: string;
  /** Each forecaster's fair total, at which over/under would be even. */
  fair: Record<MediaId, number>;
  /** Each forecaster's probability the total beats the house line. */
  overProbability: Record<MediaId, number>;
  /**
   * Posted price for the over and the under, each derived from its own true
   * probability at the posted line.
   *
   * These are not negations of one another, even though for a two-sided market
   * they nearly are. Negating was tried and is wrong for a specific reason: it
   * was applied to the model's own belief rather than to the probability at the
   * posted line, so the two sides could disagree with each other about which
   * way round the game was.
   *
   * There is deliberately NO margin in these prices. On a total the vig is in
   * the line, and charging it here as well doubled it. See buildLineMarket.
   */
  overPrice: number;
  underPrice: number;
  /**
   * over implied + under implied - 1.
   *
   * Approximately zero, and that is the correct value here rather than a
   * missing margin. The vig on a total is carried by the line, so this measures
   * only whether the two prices are internally consistent.
   */
  overround: number;
  houseLine: number;
  /** Widest gap between any two fair totals. */
  spread: number;
  outlier: MediaId;
}

export const buildLineMarket = (input: {
  kind: 'total' | 'first5';
  key: string;
  title: string;
  subtitle?: string;
  fair: Record<MediaId, number>;
  /** Probability slope on one run of over, fitted per forecaster. */
  slope: Record<MediaId, number>;
}): LineMarket => {
  const values = MEDIA_PROFILES.map((profile) => input.fair[profile.id]);

  /**
   * Round the line to the posted grid BEFORE anything is priced off it.
   *
   * The line is quoted in half-runs, so the number a bettor actually bets
   * against is not the number the model produced. An earlier version computed
   * the prices from the unrounded value and only rounded for display, which
   * meant the price described a 6.85 line while the bet settled against 7.00.
   * That gap is worth about 3.7 per cent of free expected value on the under
   * at that line, and it is invisible on the page because the two numbers
   * disagree by a quarter of a run.
   *
   * So the rounding happens first, and every probability below is derived from
   * the posted line. The rounding error itself is a residual the half-run grid
   * cannot avoid, and tools/checkTotalVig.ts bounds it.
   */
  const meanFair = values.reduce((sum, value) => sum + value, 0) / values.length;
  const houseLine = Math.round((meanFair + LINE_MARGIN) * 2) / 2;

  const overProbability = {} as Record<MediaId, number>;
  MEDIA_PROFILES.forEach((profile) => {
    overProbability[profile.id] = clampProbability(
      logistic((input.fair[profile.id] - houseLine) * input.slope[profile.id]),
    );
  });

  /**
   * The two sides, priced from the consensus rather than by negating.
   *
   * On a total the margin lives in the LINE, and only there. houseLine is the
   * mean fair total plus LINE_MARGIN runs, which is why the measured over rate
   * sits a few points under even. The price pair's job is to quote each side at
   * what is actually true once that line is posted -- no more.
   *
   * An earlier version scaled both sides by 1 + HOUSE_MARGIN as well, and that
   * charged the vig twice: the line moved 0.4 runs off fair while the price
   * moved a further 20 points, and the over carried roughly -8.7 per cent
   * expected value where it should have been near -2. Nothing about it looked
   * wrong on the page, which is why tools/checkTotalVig.ts asserts the bettor's
   * edge directly rather than trusting the overround to imply it.
   *
   * Note that pushing each side away from even does NOT work either, and looks
   * like it should: the two probabilities are complementary, so (0.5-a) + (0.5+a)
   * is 1, and scaling both about 0.5 leaves the sum at exactly 1.
   */
  const meanOver = values.reduce((sum, value) => sum + logistic((value - houseLine) * 0.55), 0)
    / values.length;
  const overPriceProbability = clampProbability(meanOver);
  const underPriceProbability = clampProbability(1 - meanOver);
  const overPrice = probabilityToAmerican(overPriceProbability);
  const underPrice = probabilityToAmerican(underPriceProbability);
  const overround = (overPriceProbability + underPriceProbability) - 1;

  const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const outlier = MEDIA_PROFILES
    .map((profile) => [profile.id, Math.abs(input.fair[profile.id] - median)] as const)
    .sort((a, b) => b[1] - a[1])[0][0];

  return {
    shape: 'line',
    kind: input.kind,
    key: input.key,
    title: input.title,
    subtitle: input.subtitle,
    fair: input.fair,
    overProbability,
    overPrice,
    underPrice,
    overround,
    houseLine,
    spread: Math.max(...values) - Math.min(...values),
    outlier,
  };
};

/* ------------------------------------------------------------------ *
 * Shared display helpers
 * ------------------------------------------------------------------ */

export const accentVar = (id: MediaId): string => `var(--color-media-${id})`;
export const accentHiVar = (id: MediaId): string => `var(--color-media-${id}-hi)`;

export const MARKET_TITLES: Record<MarketKind, string> = {
  moneyline: 'Moneyline',
  division: 'Division Winner',
  league: 'League Winner',
  world_series: 'Championship Winner',
  award: 'Award',
};
