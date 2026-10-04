import { MEDIA_PROFILES, type MediaId, type MediaProfile } from '../data/media';
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

/**
 * Confidence-weighted mean across the forecaster pool.
 *
 * The consensus used to be an unweighted mean of every outlet's probability, which is a
 * simplification that only holds while the pool is small and homogeneous. At eight forecasters
 * it stops being defensible: an outlet the calibration says is barely better than a coin flip
 * moves the house line exactly as much as the best-calibrated forecaster in the league, and the
 * resulting price is neither the consensus nor anyone's view.
 *
 * Weighting by the same `confidence` the profile already publishes means the number on the card
 * and the number in the maths can no longer disagree -- which was already possible, because
 * confidence used to feed only the on-screen error bar. A manager could read "62% conviction"
 * on a card and have no way to know the price behind it was computed as though every forecaster
 * were equally sure.
 *
 * Takes a SELECTOR rather than a record, deliberately. Every call site transforms its own
 * quantity before averaging -- a clamp on some, a logistic on others -- and a signature taking
 * `Record<MediaId, number>` would either push that transformation out to all four callers or,
 * worse, tempt one of them into averaging the wrong thing.
 *
 * It also CANNOT be pointed at a mean that is not over forecasters. `mediaMarkets.ts` has two
 * means that look identical in a grep and must NOT be weighted: the per-forecaster softmax that
 * centres a team's scores against the field, and the award candidates' totals. Both average over
 * teams or players rather than over outlets, and weighting them would either double-count
 * confidence or break every division and championship market. Taking a selector over profiles
 * makes the "over whom" question structural rather than a comment nobody reads.
 *
 * Returns 0.5 if the pool carries no weight at all, so a misconfigured profile set degrades to
 * "even" rather than to NaN.
 */
export const weightedConsensus = (pick: (profile: MediaProfile) => number): number => {
  let sum = 0;
  let weight = 0;
  for (const profile of MEDIA_PROFILES) {
    const w = profile.confidence;
    sum += pick(profile) * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : 0.5;
};

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
 * WHY a race has a known winner.
 *
 * ============================================================================
 * THE EXPLOIT THIS EXISTS TO CLOSE
 * ============================================================================
 *
 * A division whose leader is ten games up with three to play has ALREADY been won. Before this
 * field existed, nothing in the model could say so, so the club kept a live price and a working
 * button and could be backed at a stale number -- taking money on a result that is not in doubt.
 *
 * The reason it was possible is worth recording, because the fix is not "disable the button":
 *
 *   - `titleContenders` asks whether a club CAN still win. A club that cannot be caught satisfies
 *     that test, so a locked leader was never eliminated and stayed sellable.
 *   - `placeBet` receives no market state at all, so it could not have refused the bet even if the
 *     UI had not greyed the button out. The only enforcement was one `disabled` attribute.
 *
 * So the fact has to be carried ON THE MARKET, where the settlement layer and the button can both
 * read it. That is this type.
 *
 * ============================================================================
 * WHY IT LIVES ON `FieldMarket` AND NOT ON `MarketOutcome`
 * ============================================================================
 *
 * A race has at most one winner, and the winner is a property of the RACE -- not of an outcome.
 * Putting it on the outcome would mean one outcome says "I am decided" while its rivals say
 * nothing, which is both noisier to consume and easy to get wrong: a reader checking "can I back
 * this outcome?" would have to conclude that an outcome with no flag is live, which is the opposite
 * of the truth for the seventeen losers in a decided division.
 *
 * ============================================================================
 * WHY THE REASON IS ENUMERATED AND NOT A BOOLEAN
 * ============================================================================
 *
 * Because "decided" arrives from genuinely different places, and a manager looking at a closed
 * market deserves to know which rule closed it:
 *
 *   - `unreachable_lead` -- standings arithmetic. Nobody can catch the leader. The ordinary case,
 *     and the one that fires in the last month of the season.
 *   - `series_won` -- a completed playoff series. This is the league and title case: the platinum
 *     and prestige champions are decided by a series, not by a win total, so standings alone never
 *     close them.
 *   - `voting_open` -- the award case. Unlike every other market here, an award's winner is a
 *     choice rather than a schedule fact, so the market closes the moment voting opens.
 *
 * A single boolean would have hidden exactly the distinction a bettor needs: "nobody can catch him"
 * and "he has already won four games to nil" are different facts about the same closed market.
 */
export type LockedReason = 'unreachable_lead' | 'series_won' | 'voting_open';

/** A race that has a known winner, and therefore no live market. */
export interface LockedRace {
  /** The winning outcome's `key`. Always a member of this market's `outcomes`. */
  winnerKey: string;
  /**
   * Why the race is closed.
   *
   * Enum rather than free text so the UI can phrase it correctly and so a checker can assert that
   * a closure arrived for a real reason rather than by default.
   */
  reason: LockedReason;
  /**
   * How decisively the race was settled, in the units the reason implies.
   *
   *   `unreachable_lead` -- GAMES CLEAR. How many more wins the winner holds than the best any rival
   *     could still reach. A whole number of at least 1, and it is what lets the board say "locked,
   *     4 games clear" instead of merely "locked".
   *
   *   `series_won` -- SERIES WINS. How many more games the winner took than the loser, so 4-1 is 3.
   *
   *   `voting_open` -- absent. Nothing was out-run; the race closed because a choice was made, and a
   *     margin for that would be a number meaning nothing.
   *
   * Named `margin` rather than `marginPoints` because the units are not probability points in two of
   * the three cases. A field called `marginPoints` holding a count of games is a name that eventually
   * gets read as a percentage by somebody who trusts it.
   */
  margin?: number;
}

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
  /**
   * Set when this race has a known winner and can no longer be bet.
   *
   * OPTIONAL, and undefined means OPEN. That default is the safe direction: a market with no
   * `locked` is treated as live and therefore still bettable, so failing to compute a closure
   * leaves the board slightly wrong rather than freezing a live race shut. Every other unknown in
   * this file defaults the other way -- `eliminated` being undefined means nobody checked -- and the
   * difference is deliberate. `eliminated` protects a bettor from a false claim that a club is out;
   * `locked` protects the book from a bet on a decided race. Guessing `locked` would take money on
   * the wrong side of a real result; guessing `eliminated` would only ever hide a row.
   *
   * Once this is set, the slip REFUSES the market outright rather than relying on the UI to grey the
   * button, because a disabled attribute is not an invariant.
   *
   * The refusal lives in `useBettingSlip`, not in `placeBet`. That comment used to say `placeBet` and
   * was wrong about where it could be done: `placeBet` receives no market state, and `wallet.ts` is
   * deliberately not edited by this work. `useBettingSlip.confirm` is the equivalent choke point --
   * every bet in the app reaches a placed bet through it, from every screen, so a closure checked
   * there is checked everywhere. `select` checks it too, one step earlier, so a slip cannot even be
   * opened on a closed market.
   */
  locked?: LockedRace;
}

/**
 * WHY A CLOSED MARKET CANNOT BE BET ON, IN WORDS A MANAGER CAN ACT ON.
 *
 * Three reasons, three sentences, because they are three different facts and "market closed" would
 * hide which one you are looking at. The user is not a gambler; "locked" and "unreachable lead" mean
 * nothing on their own, so each sentence says what HAPPENED and, where there is one, by how much.
 *
 * `margin` is used where it means something and omitted where it does not. On a `voting_open`
 * closure there is no margin at all -- the race did not get run out, a choice closed it -- and
 * printing a number there would be inventing a figure.
 *
 * `winnerName` is passed rather than looked up, because this module has no team list and a lookup
 * by key would be a second place for club names to come from.
 */
export const lockedMarketRefusal = (locked: LockedRace, winnerName?: string): string => {
  /*
   * TWO SENTENCES, AND TWO SUBJECTS.
   *
   * The first sentence is the FACT: who has won, and by how much where that means anything. The
   * second is the CONSEQUENCE, and it is the same either way, because it is the same either way --
   * there is nothing left to bet on.
   *
   * Each fact has a named and an unnamed form, and that is not decoration. The name normally
   * resolves, because the card resolves it against the very market it is rendering. But when it
   * does not -- a winner key matching no outcome, which is a board bug rather than a closure --
   * the message still has to be a sentence a manager can act on. A refusal that degrades into a
   * bare fragment reads as a glitch, and a glitch gets clicked past.
   */
  /*
   * The margin, in words, for both sentence shapes.
   *
   * Held as a bare phrase rather than as a fragment with a preposition attached, because the two
   * sentences need it differently: "...has already won BY seven games" against "is already seven
   * games CLEAR". Sharing one string with its preposition produced "The leader is already by 7
   * games", which is how the unnamed path shipped a broken sentence in the first place.
   *
   * Undefined is kept as its own case rather than folded into zero. Zero would print "0 games",
   * which is a claim about arithmetic instead of an admission that nobody computed one.
   */
  const n = locked.margin;
  const gameCount = n === undefined ? null : n === 1 ? 'one game' : n + ' games';

  switch (locked.reason) {
    case 'unreachable_lead': {
      /*
       * A division race, closed on arithmetic: the leader holds more wins than anybody can still
       * reach.
       *
       * `margin` is in GAMES, per `LockedRace`. A margin of 1 is a real margin -- a leader who
       * cannot be caught even losing every game left -- so the singular is spelled out rather
       * than rounded away or printed as "1 games".
       *
       * The margin is OPTIONAL, and a lead with none still gets a fact, because "already won" is
       * true whether or not anybody computed by how much. The alternative is refusing a bet
       * without saying what happened, which is the failure this whole message exists to avoid.
       */
      const fact = winnerName
        ? winnerName + ' has already won by ' + gameCount + '.'
        : gameCount
          ? 'The leader is already ' + gameCount + ' clear.'
          : 'The leader is already out of reach.';
      return fact + ' Nobody can catch them, so this market is closed.';
    }
    case 'series_won': {
      /*
       * A league or title race, closed on a finished series.
       *
       * The margin is SERIES WINS, so a 4-1 is 3 -- which is not how anyone describes a
       * best-of-seven out loud. It is left out on purpose: "won the series 3 ahead" is worse
       * phrasing than saying the series is over, and the board shows the scoreline beside this
       * anyway.
       */
      const fact = winnerName
        ? winnerName + ' has already won the series.'
        : 'The series is already won.';
      return fact + ' It is over, so this market is closed.';
    }
    case 'voting_open': {
      /*
       * An award race, closed because the vote has been cast.
       *
       * Nothing was out-run here, which is precisely why the margin is absent, and why this says
       * what happened rather than implying a race that was never run. The unnamed form says
       * "given" rather than "won", because an award is conferred -- while the named form says
       * "won", which is the word the board uses and the one the bettor was thinking in.
       */
      const fact = winnerName
        ? winnerName + ' has already won the award.'
        : 'The award has already been given.';
      return fact + ' The vote is in, so this market is closed.';
    }
    default:
      return 'This market is already decided, so it can no longer be bet.';
  }
};;

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
  /**
   * The known winner, when the schedule or the season has already produced one.
   *
   * Carried through to the market rather than inferred by the consumer, for the reason `eliminated`
   * is carried through: a component that re-derived a closure would be a second implementation of
   * the arithmetic, and the two would disagree on exactly the boundary cases -- a club level on the
   * leader with one game left, a series won on the final game -- where being wrong means taking
   * money on a decided race.
   */
  locked?: LockedRace;
}): FieldMarket => {
  const outcomes = input.entries.map((entry) => {
    const values = MEDIA_PROFILES.map((profile) => clampProbability(entry.probability[profile.id]));
    const consensusProbability = weightedConsensus((profile) => clampProbability(entry.probability[profile.id]));
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
    /*
     * THE CLOSURE, CARRIED VERBATIM.
     *
     * Only when the caller supplied it. A locked market whose winner is not among its own outcomes
     * would be a contradiction the settlement layer cannot resolve, so that is checked rather than
     * assumed -- see `checkLockedShape` in tools/checkFuturesShape.ts, which asserts the winner is
     * always a real member and that a locked market keeps exactly one live-free field.
     *
     * `liveOutcomes` is deliberately NOT forced to 0 here. The count describes how many clubs can
     * still WIN, which is a different question from whether the race has a winner: a division with
     * four contenders can have been clinched by one of them. Overwriting it would conflate "nobody
     * can catch him" with "he has already won", and the board needs to be able to say both.
     */
    locked: input.locked,
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
  const meanFair = weightedConsensus((profile) => input.fair[profile.id]);
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
  const meanOver = weightedConsensus((profile) => logistic((input.fair[profile.id] - houseLine) * 0.55));
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
