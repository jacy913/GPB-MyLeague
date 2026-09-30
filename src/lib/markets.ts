import { MEDIA_PROFILES, type MediaId } from '../data/media';

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
}

export type MarketKind =
  | 'moneyline'
  | 'division'
  | 'league'
  | 'award';

export interface FieldMarket {
  shape: 'field';
  kind: MarketKind;
  key: string;
  title: string;
  subtitle?: string;
  outcomes: MarketOutcome[];
}

/**
 * A market over mutually exclusive outcomes.
 *
 * Margins are taken off the most likely side, which is how a real book prices,
 * and the margin is not shared across the field: a nine-outcome award market
 * taking a cut from every candidate would be punishing outcomes that are
 * already long shots.
 */
export const buildFieldMarket = (input: {
  kind: MarketKind;
  key: string;
  title: string;
  subtitle?: string;
  entries: Array<{
    key: string;
    label: string;
    sublabel?: string;
    probability: Record<MediaId, number>;
  }>;
}): FieldMarket => {
  const outcomes = input.entries.map((entry) => {
    const values = MEDIA_PROFILES.map((profile) => clampProbability(entry.probability[profile.id]));
    const consensusProbability = values.reduce((sum, value) => sum + value, 0) / values.length;
    const isFavourite = entry.key === input.entries[0].key;
    const houseProbability = clampProbability(consensusProbability - (isFavourite ? HOUSE_MARGIN / 2 : 0));

    const odds = {} as Record<MediaId, number>;
    MEDIA_PROFILES.forEach((profile) => { odds[profile.id] = probabilityToAmerican(entry.probability[profile.id]); });

    const median = [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const outlier = MEDIA_PROFILES
      .map((profile) => [profile.id, Math.abs(entry.probability[profile.id] - median)] as const)
      .sort((a, b) => b[1] - a[1])[0][0];

    return {
      key: entry.key,
      label: entry.label,
      sublabel: entry.sublabel,
      probability: entry.probability,
      odds,
      consensusProbability,
      houseProbability,
      houseOdds: probabilityToAmerican(houseProbability),
      disagreement: Math.max(...values) - Math.min(...values),
      outlier,
    };
  });

  // The favourite is whatever the consensus says it is, not whatever the caller
  // happened to pass first.
  const ordered = [...outcomes].sort((a, b) => b.consensusProbability - a.consensusProbability);
  const favouriteKey = ordered[0]?.key;
  return {
    shape: 'field',
    kind: input.kind,
    key: input.key,
    title: input.title,
    subtitle: input.subtitle,
    outcomes: ordered.map((outcome) => (
      outcome.key === favouriteKey
        ? { ...outcome, houseProbability: clampProbability(outcome.consensusProbability - HOUSE_MARGIN / 2), houseOdds: probabilityToAmerican(clampProbability(outcome.consensusProbability - HOUSE_MARGIN / 2)) }
        : outcome
    )),
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
  const houseLine = values.reduce((sum, value) => sum + value, 0) / values.length + LINE_MARGIN;

  const overProbability = {} as Record<MediaId, number>;
  MEDIA_PROFILES.forEach((profile) => {
    overProbability[profile.id] = clampProbability(
      logistic((input.fair[profile.id] - houseLine) * input.slope[profile.id]),
    );
  });

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
    // Rounded to the half-run rather than the quarter. A quarter-run grid
    // implies a precision the underlying run model does not have: the measured
    // spread of a single game's total is about three runs, so a quarter run is
    // a fifteenth of the noise. Half-runs match the increment a real board uses
    // and stop the page implying a distinction it cannot make.
    houseLine: Math.round(houseLine * 2) / 2,
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
  award: 'Award',
};
