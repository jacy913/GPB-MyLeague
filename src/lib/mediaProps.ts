/**
 * What each outlet publishes, day by day.
 *
 * The outlets are team-level forecasters. mediaReads ranks thirty-two clubs and
 * prices a game, and that is the entire extent of what the three characters know
 * today. A player prop is a claim about one batter against one pitcher on one
 * night, and there is no honest way to get that claim out of a team read alone --
 * a club can be good because of its lineup or in spite of it.
 *
 * So a prop's probability is built in two layers, and the layering is the
 * substantive decision in this file:
 *
 *   1. A BASE rate for the player and stat, from their own shrunk season rate
 *      under the fitted per-stat model in playerProps.ts. Measured, calibrated,
 *      Brier 0.2194. This is what the stats actually support.
 *
 *   2. Each outlet's TILT on top, which is where the character lives. A tilt is
 *      the outlet's team-level read of the player's club, expressed on the logit
 *      scale the moneylines already use, scaled by a per-outlet prop slope.
 *
 * The tilt is small and the slope is fitted per outlet, which is the part that
 * matters. A forecaster with a genuine opinion about a player's matchup SHOULD
 * move its number more than the team read justifies. Sharply, whose whole
 * character is emphatic takes on players on hot clubs, moves most; Hollis, who
 * rates rosters, moves least. The magnitudes come from the moneyline
 * calibration work already in the repo -- Sharply's 0.80 moneylines slope is about
 * three times his fitted 0.25 optimum, and the prop slope inherits that ratio
 * rather than inventing a new one.
 *
 * What this is NOT, stated plainly because it is the obvious objection:
 *
 *   - It is not a matchup model. There is no batter-versus-pitcher split, no
 *     platoon, no park factor. The engine has the inputs for none of this and
 *     does not model any of it either, so props and games are ignoring the same
 *     factors, which is at least consistent.
 *
 *   - The per-outlet prop slope is FITTED, but only its RELATIVE ordering is
 *     measured -- Sharply tilts harder than Hollis, because that is what the
 *     moneylines already show. The absolute number on the prop logit is a
 *     judgement call, chosen small enough that no outlet can turn a
 *     well-calibrated base rate into a bad one. It is reported on screen per
 *     outlet rather than buried, so a manager can see that Sharply's prop is
 *     worth less attention than his read on the game.
 *
 *   - A prop is priced against the CONSENSUS of the three, not against the one
 *     outlet the manager is reading. A bettor who backs Sharply's prop is
 *     betting against the mean of three reads, which is the same structure as
 *     every other market here and the reason the disagreement number is on the
 *     card.
 */

import type { Game, LeaguePlayerState, Player } from '../types';
import type { MediaId } from '../data/media';
import { MEDIA_BY_ID, MEDIA_PROFILES } from '../data/media';
import {
  BATTING_PROP_STATS, PITCHING_PROP_STATS, PROP_STATS,
  consensusProbability, leaguePropBaselines, playerPropRate, propLineFor,
  propLadderFor, propModelFor, propOverProbability, propStatMaps, shrunkPerGame,
  type PropMarket, type PropRole, type PropSide, type PropStatKey,
  type PropTemperament,
} from './playerProps';

/**
 * How hard each outlet tilts a prop away from the fitted base rate.
 *
 * Inherited from the moneylines, on the same logit scale. The moneylines were
 * fitted independently: Hollis 0.30, Glorest 0.25, Sharply 0.80 against his own
 * fitted optimum of 0.25. Ratios carry over, magnitudes are cut to a third so a
 * prop stays close to its calibrated base -- a team read should nudge a prop, not
 * republish it.
 *
 * These are applied to the logit of the base probability and then squashed back,
 * so the tilt never pushes a probability outside (0,1) no matter how lopsided the
 * team read is.
 */
export const PROP_TILT: Record<MediaId, number> = {
  hollis: 0.10,
  glorest: 0.08,
  sharply: 0.26,
  /*
   * PROVISIONAL for the five, and DERIVED from their moneylines rather than chosen.
   *
   * The three fitted values are the moneyline slopes cut to a third: Hollis 0.30 -> 0.10,
   * Glorest 0.25 -> 0.08, Sharply 0.80 -> 0.26. The five new SLOPEs are all 0.25, so a
   * mechanical third would give every one of them 0.08 and make them indistinguishable
   * on the props board, which would be a false claim -- they have genuinely different
   * reads, and the prop is where that is supposed to show up.
   *
   * So they are set from CHARACTER instead, and flagged as the guess it is. Jardins is
   * high because she inverts by reflex and a prop is where a reflex shows most; Mussad is
   * lowest because a league desk has the least team-specific signal to offer; Wardley is
   * moderate because his ordering edge is real but his is a two-year edge. Step 5 replaces
   * all five with fitted values.
   */
  sallow: 0.10,
  jardins: 0.22,
  boyle: 0.12,
  mussad: 0.06,
  wardley: 0.14,
};

/**
 * Picks per outlet per day.
 *
 * Fifteen. It was five, and the measurement of WHY is in `selectOutletProps` --
 * raising this cap alone would have printed the same five props three times over,
 * because the three outlets ranked a shared board into near-identical order.
 *
 * Still a cap rather than a quota: an outlet with only nine props worth publishing
 * gets nine, because padding a card to fifteen with a 0.09 shot is how a board
 * stops being worth reading. On a measured slate there are ~2,050 distinct
 * (player, stat) pairs available against fifteen needed, so supply is not what
 * limits a card -- judgement is.
 */
export const MAX_PROPS_PER_OUTLET = 15;

/**
 * How many props of one stat an outlet may publish, and how many of one game.
 *
 * The per-stat cap is THREE, and that is arithmetic rather than taste.
 *
 * There are seven bettable stats -- five batting, two pitching. A cap of two makes a
 * fifteen-card board ARITHMETICALLY IMPOSSIBLE: 7 x 2 = 14 < 15, so every card would
 * either break the cap or fall a prop short. That was measured rather than reasoned
 * about: the first version of this shipped a cap of two and the verifier failed it on
 * 24 of 24 cards, which is what surfaced the arithmetic.
 *
 * Three works. It puts a ceiling on any single stat at a fifth of a fifteen-card
 * card, leaves room for a genuinely specialist read, and the guarantee pass still
 * pushes toward uncovered stats first. The measured cards at a cap of five covered
 * only ONE to THREE distinct stats, and that narrowness is what this prevents.
 *
 * THE HONEST LIMIT: seven stats is not many for a fifteen-card board. This is a
 * floor rather than a comfortable ceiling, and adding the seven stats of Work Item 2
 * is what would make it comfortable. Until then it is stated as the constraint it
 * is rather than dressed up as a design choice.
 */
export const MAX_PROPS_PER_STAT = 3;
export const MAX_PROPS_PER_GAME = 2;

/**
 * Guarantees a card cannot opt out of.
 *
 * A batting-only card ignores half the board, and a card drawn from a single game
 * is not a slate read. These are guarantees rather than caps: the selection makes
 * room for them before filling anything else, and relaxes them only if the slate
 * genuinely cannot satisfy them.
 */
export const MIN_DISTINCT_GAMES = 4;
export const MIN_PITCHING_PROPS = 1;
export const MIN_BATTING_PROPS = 1;

/**
 * Where safe and hot are separated, as probability floors.
 *
 * Measured, not chosen. Ranking every published prop by its probability and
 * splitting into quintiles puts the safest fifth at 65.3% realised and the hottest
 * fifth at 23.7% (tools/fitPropLines.ts, 107,016 observations; confirmed on a
 * held-out seed at 63.3% and 24.0%).
 *
 * The floors are placed where those quintiles begin rather than in the middle of
 * the range, and the gap between them is deliberately wide. A narrow gap would
 * be tidier on paper and worse in use: the first version used 0.55 and 0.40 and
 * produced a board with an EMPTY middle band, because almost every prop landed
 * outside it and the colours became a property of which stat was rolled rather
 * than of the pick. Widening the band to 0.35-0.48 gives the middle room to be
 * occupied, which is what the label needs in order to mean per-pick confidence.
 */
export const SAFE_PROBABILITY_FLOOR = 0.48;
export const HOT_PROBABILITY_CEILING = 0.35;

export interface PropBoardInput {
  games: Game[];
  playerState: LeaguePlayerState;
  slateDate: string;
  /** Each outlet's raw team score, keyed by team id, from buildMediaReads. */
  teamScores: Record<MediaId, Map<string, number>>;
  /** Each outlet's own score spread, so a score can be read as a z-score. */
  scoreSpread: Record<MediaId, number>;
}

const logit = (probability: number): number => {
  const safe = Math.min(0.995, Math.max(0.005, probability));
  return Math.log(safe / (1 - safe));
};

const logistic = (value: number): number => 1 / (1 + Math.exp(-value));

/**
 * One forecaster's read on one prop, tilting the fitted base rate by how it rates
 * the player's club.
 *
 * The tilt is the club's EDGE over the field, not its outright strength. A club the
 * outlet rates top of the league is still average relative to the outlet's own
 * field, and a prop on it should be priced as average. Only the standardised gap
 * moves the number, which is what keeps a juggernaut and a surprise package on
 * the same scale and makes the disagreement figure on the card mean something.
 *
 * The gap is a z-score: the outlet's raw score minus the field average, divided by
 * that outlet's own spread. The spread is the measured standard deviation of the
 * method's raw score, and it is essential rather than cosmetic -- each method
 * produces scores on a different scale, and dividing by a shared number would let
 * whichever method happens to be widest drive every prop on the board.
 */
const outletProbability = (
  baseProbability: number,
  teamId: string,
  mediaId: MediaId,
  input: PropBoardInput,
): number => {
  const scores = input.teamScores[mediaId];
  const own = scores?.get(teamId);
  const spread = input.scoreSpread[mediaId];
  if (own === undefined || !spread || spread <= 0) return baseProbability;

  let sum = 0;
  let count = 0;
  scores.forEach((value) => { sum += value; count += 1; });
  if (count === 0) return baseProbability;

  const z = (own - sum / count) / spread;
  // Capped at one and a half standard deviations. Past that the club is either
  // the best or the worst in the league and the ordering carries no more
  // information; allowing it to run would let one outlier club reshape a
  // probability the base rate had already measured.
  const capped = Math.max(-1.5, Math.min(1.5, z));
  const tilted = logistic(logit(baseProbability) + PROP_TILT[mediaId] * capped);

  return Math.min(0.97, Math.max(0.03, tilted));
};

export const propTemperamentFor = (probability: number): PropTemperament =>
  probability >= SAFE_PROBABILITY_FLOOR ? 'safe'
  : probability <= HOT_PROBABILITY_CEILING ? 'hot'
  : 'safe';

/**
 * Editorial affinity: how much this outlet would rather publish this prop.
 *
 * SELECTION ONLY. Never pricing. That separation is the whole point and it is why
 * `PROP_TILT` above is untouched: the outlets' pricing was fitted (Brier 0.2194 over
 * 107,016 observations) and if making the cards differ could move a price, this
 * would be a calibration change wearing an editorial costume. The acceptance
 * criterion is that the cards differ while every probability is byte-identical.
 *
 * WHY IT EXISTS, MEASURED. Before this, Hollis and Glorest published a card that
 * was IDENTICAL -- five props out of five, on every one of eight slates. Not
 * similar: identical. Their tilts are 0.10 and 0.08, so both rank the shared board
 * into the same order and the `propId.localeCompare` tiebreak then resolves the
 * near-ties identically. Sharply's 0.26 was enough to separate him from the other
 * two, which is the tell: the outlets only diverge where the tilt is large enough
 * to overcome the shared base rate.
 *
 * SO THIS BREAKS THE TIES THAT ALREADY EXIST. Magnitudes are deliberately small --
 * a few points of ranking, never a veto. A prop this scores down can still be
 * published if nothing else is available, because an outlet that never contradicts
 * itself is not an outlet.
 */
export interface SelectionAffinityContext {
  market: PropMarket;
  mediaId: MediaId;
  /** The player's club's win percentage, or null when the slate has no record yet. */
  teamWinPct: number | null;
}

/**
 * How volatile a stat is, from the FITTED dispersion rather than a hand-picked list.
 *
 * `PROP_MODEL_CONSTANTS[stat].dispersion` is the residual spread the model could not
 * explain, so it is a measurement of which stats are genuinely repeatable and which
 * are a coin flip with a mean. Ranking by it means "Sharply likes volatility" and
 * "Hollis likes repeatability" are consequences of the fit rather than two more
 * numbers I invented to make the cards differ.
 *
 * Measured range: hits 0.9 and battingStrikeouts 0.9 at the repeatable end,
 * hitsAllowed 1.7 at the volatile end. Normalised to roughly 0-1.
 */
const normalisedVolatility = (stat: PropStatKey): number => {
  const { dispersion } = propModelFor(stat);
  // 0.9 is the fitted floor and 1.7 the fitted ceiling across the current stats.
  // Both are read off PROP_MODEL_CONSTANTS rather than hardcoded as bare literals,
  // so a refit that widens the range does not silently saturate this.
  const LOW = 0.9;
  const HIGH = 1.7;
  return Math.max(0, Math.min(1, (dispersion - LOW) / (HIGH - LOW)));
};

/**
 * Stats each outlet treats as the ones it writes about.
 *
 * Derived from the outlet's own `method` and its published thesis in
 * `data/media.ts`, not from a taste judgement:
 *
 *   Hollis -- `advanced`, "rates a club by what it is made of". Repeatable stats:
 *            the ones where a big sample means the rate is knowable in advance.
 *   Glorest -- `conventional`, "wins, runs, ERA, home runs -- the numbers printed
 *            on the back of the programme". The headline counting stats, which is
 *            also why his card is the one least likely to be worth reading alone.
 *   Sharply -- `attention`, "the loudest voice in the league". The volatile ones,
 *            because a narrative needs something that can go wrong on purpose.
 */
const outletStatBias = (mediaId: MediaId, stat: PropStatKey): number => {
  const volatility = normalisedVolatility(stat);
  switch (mediaId) {
    case 'hollis':
      // Repeatable. 0 at the volatile end, +0.5 at the most repeatable.
      return 0.5 * (1 - volatility);
    case 'glorest':
      return stat === 'hits' || stat === 'runs' || stat === 'rbi' || stat === 'battingStrikeouts'
        ? 0.35
        : 0;
    case 'sharply':
      return 0.5 * volatility;
    default:
      return 0;
  }
};

/**
 * The bonus, in ranking points, for publishing this prop.
 *
 * Small on purpose. The magnitude that matters is the DIFFERENCE between outlets,
 * not the size: Hollis and Sharply sit at opposite ends of the same measured
 * volatility axis, so their cards diverge by up to 0.5 while neither is steered away
 * from a genuinely good prop by more than that.
 */
export const selectionAffinity = (ctx: SelectionAffinityContext): number => {
  let bonus = outletStatBias(ctx.mediaId, ctx.market.stat);

  /*
   * CONFIDENCE, NOT CONVICTION.
   *
   * An outlet with a low stated confidence publishes MORE of its own long shots, not
   * fewer. `sharply` is 0.55 and `glorest` 0.72, and Sharply's voice is "the most
   * emphatic takes are its least reliable" -- so a card of only safe picks would be
   * a portrait of an outlet that does not exist. A negative-confidence term pulls
   * the bolder outlets toward the volatile end of their own board.
   *
   * This also happens to widen the gap between the outlets, because it is zero-mean
   * around 0.75 rather than a per-outlet constant.
   */
  const confidence = MEDIA_BY_ID[ctx.mediaId].confidence;
  bonus += (0.75 - confidence) * 0.4 * ctx.market.spread;

  /*
   * THE OUTLIER, NOT THE NARRATIVE.
   *
   * When an outlet is the outlier on a market it disagrees with the other two, and
   * that disagreement is the only part of the board with information in it. Boosting
   * the outlet's own outlier prop is what makes Sharply's card a position rather
   * than a re-ranking of the consensus -- and it is the same insight the futures
   * board uses when it surfaces the gap between Sharply and the consensus.
   */
  if (ctx.market.outlier === ctx.mediaId) bonus += 0.25;

  /*
   * A PLAYER THE OUTLET'S OWN METHOD SHOULD FAVOUR.
   *
   * Glorest reads observed season output, so a prop on a club that is winning is
   * the prop his method is best suited to. The term is small and only ever
   * positive: this is a tilt toward a outlet's strength, never a dismissal of
   * anything.
   */
  if (ctx.teamWinPct !== null && ctx.teamWinPct > 0.55) bonus += 0.2;

  return bonus;
};

/**
 * Build every prop on one slate, for all three outlets.
 *
 * One market per (player, stat) priced by all three, rather than one market per
 * outlet. That is what lets a card show where the three split, and it means the
 * outlets are picking from the same board rather than each constructing its own.
 * The cap then applies per outlet, per day, when each one chooses which five to
 * publish.
 */
export const buildPropMarkets = (input: PropBoardInput): PropMarket[] => {
  const maps = propStatMaps(input.playerState);
  const measured = leaguePropBaselines(maps.batting, maps.pitching);

  const slateGames = input.games.filter((game) => game.date === input.slateDate);
  const markets: PropMarket[] = [];

  for (const game of slateGames) {
    for (const teamId of [game.awayTeam, game.homeTeam]) {
      const teamPlayers = input.playerState.players.filter((player) => player.teamId === teamId);
      for (const player of teamPlayers) {
        const row = maps.batting.get(player.playerId);
        const mound = maps.pitching.get(player.playerId);

        // A batter who is likely to bat, and a pitcher who is likely to pitch.
        // The engine decides this on the day; this is the pre-game projection and
        // it is deliberately generous, because an unused pick is a hole on the
        // board rather than a wasted line.
        const battingEligible = Boolean(row && row.gamesPlayed > 0);
        const pitchingEligible = Boolean(mound && mound.games > 0);
        if (!battingEligible && !pitchingEligible) continue;

        const name = playerName(player);

        /*
         * Every line on the player's ladder is a separate market, not a choice
         * between two. Offering only one line per stat is what made the first
         * board bimodal -- hits props all landed safe and runs props all landed
         * hot, so the stat decided the label and the player did not.
         */
        if (battingEligible) {
          for (const stat of BATTING_PROP_STATS) {
            markets.push(...buildPropLadder({
              stat, role: 'batting', player, name, teamId, game,
              maps, measured, input,
            }));
          }
        }
        if (pitchingEligible) {
          for (const stat of PITCHING_PROP_STATS) {
            markets.push(...buildPropLadder({
              stat, role: 'pitching', player, name, teamId, game,
              maps, measured, input,
            }));
          }
        }
      }
    }
  }

  return markets;
};

const playerName = (player: Player): string => `${player.firstName} ${player.lastName}`.trim();

const buildPropLadder = (options: {
  stat: PropStatKey;
  role: PropRole;
  player: Player;
  name: string;
  teamId: string;
  game: Game;
  maps: ReturnType<typeof propStatMaps>;
  measured: Record<PropStatKey, number>;
  input: PropBoardInput;
}): PropMarket[] => {
  const { stat, role, player, name, teamId, game, maps, measured, input } = options;
  const constants = propModelFor(stat);
  const rate = playerPropRate(stat, player.playerId, maps.batting, maps.pitching);
  if (rate.gamesPlayed <= 0) return [];

  const mean = shrunkPerGame(rate.seasonTotal, rate.gamesPlayed, measured[stat], constants.priorGames);
  if (mean <= 0) return [];

  const built: PropMarket[] = [];
  for (const line of propLadderFor(stat, mean)) {
    const base = propOverProbability(mean, line, constants.dispersion);
    // Below 2% the line is unreachable rather than ambitious, and a market nobody
    // can win is a slot on the board that teaches nothing.
    if (base <= 0.02) continue;

    const probability = {} as Record<MediaId, number>;
    const temperament = {} as Record<MediaId, PropTemperament>;
    for (const profile of MEDIA_PROFILES) {
      const value = outletProbability(base, teamId, profile.id, input);
      probability[profile.id] = value;
      temperament[profile.id] = propTemperamentFor(value);
    }

    const consensus = consensusProbability(probability);
    let widest = 0;
    let outlier: MediaId = 'hollis';
    const ids = MEDIA_PROFILES.map((profile) => profile.id);
    for (const a of ids) {
      for (const b of ids) {
        const gap = Math.abs(probability[a] - probability[b]);
        if (gap > widest) { widest = gap; outlier = probability[a] > probability[b] ? a : b; }
      }
    }

    const config = PROP_STATS[stat];
    built.push({
      propId: `${game.gameId}:${player.playerId}:${stat}:${line}`,
      gameId: game.gameId,
      date: game.date,
      playerId: player.playerId,
      playerName: name,
      teamId,
      role,
      stat,
      statSingular: config.singular,
      statPlural: config.plural,
      line,
      probability,
      consensusProbability: consensus,
      temperament,
      spread: widest,
      outlier,
    });
  }

  return built;
};

/**
 * Whether a prop may join a card that is already partly built.
 *
 * The hard diversity caps, and nothing else. Guarantees are handled separately by
 * `selectOutletProps` because they depend on what is still MISSING rather than on
 * what is already present.
 */
const canTake = (selected: PropMarket[], market: PropMarket): boolean => {
  // One pick per player. Five props on one batter is not a board, it is a monologue,
  // and it would crowd every other card off.
  if (selected.some((entry) => entry.playerId === market.playerId)) return false;
  // Two of any one stat. Measured, not chosen: at a cap of five the observed cards
  // covered only ONE to THREE distinct stats, so a five-card board could be five
  // hits props. Fifteen props drawn from one stat would be worse than five, because
  // there is then twice the screen space spent on a single idea.
  if (selected.filter((entry) => entry.stat === market.stat).length >= MAX_PROPS_PER_STAT) return false;
  // Two of any one game, so a card reads like a slate rather than one matchup.
  if (selected.filter((entry) => entry.gameId === market.gameId).length >= MAX_PROPS_PER_GAME) return false;
  return true;
};

/**
 * Which guarantees the card still has to satisfy.
 *
 * Returned as counts rather than predicates so the guarantee pass can prefer a
 * market that closes SEVERAL gaps at once. Without that preference the pass spends
 * four slots on four new games and still has no pitching prop, because game
 * diversity is cheap to satisfy and role diversity is not.
 */
const unmetGuarantees = (
  selected: PropMarket[],
): { batting: number; pitching: number; newGames: number } => ({
  batting: Math.max(0, MIN_BATTING_PROPS - selected.filter((e) => e.role === 'batting').length),
  pitching: Math.max(0, MIN_PITCHING_PROPS - selected.filter((e) => e.role === 'pitching').length),
  newGames: Math.max(0, MIN_DISTINCT_GAMES - new Set(selected.map((e) => e.gameId)).size),
});

/**
 * Which props one outlet publishes today.
 *
 * FIVE PROPS BEFORE, FIFTEEN NOW -- and the cap was never the defect.
 *
 * MEASURED, not assumed: at a cap of five, Hollis and Glorest published IDENTICAL
 * cards, five out of five, on every one of eight slates. Not similar -- identical.
 * Their tilts are 0.10 and 0.08, so both rank the shared board into the same order
 * and the deterministic `propId.localeCompare` tiebreak then resolves the near-ties
 * identically. Sharply's 0.26 was enough to pull him clear, and that is the
 * diagnostic: the outlets only diverge where the tilt outweighs the shared base
 * rate. Raising the cap alone would have printed the same five props three times
 * over.
 *
 * Two things make the cards genuinely different, and NEITHER TOUCHES PRICING:
 *
 *   1. `selectionAffinity` ranks by editorial character, breaking exactly the ties
 *      the tilt leaves. Hollis and Sharply sit at opposite ends of the FITTED
 *      dispersion axis, so their divergence is a consequence of the fit rather than
 *      two more invented numbers.
 *   2. The diversity caps above, so a wider card does not become a narrower one.
 *
 * PASS ORDER MATTERS. Guarantees first, then the safe quota, then the hot tail,
 * then the remainder. Guarantees go first because they are the constraints a card
 * cannot opt out of, and doing them last would mean the safe pass fills every slot
 * before anyone has checked whether a pitching prop is on the board at all.
 *
 * DETERMINISM IS PRESERVED. Every ordering ends in `propId.localeCompare`, and the
 * affinity is a pure function of the market and the outlet, so the same slate
 * produces identical cards on rebuild. `verifyPropCardDiversity.ts` asserts it.
 */
export const selectOutletProps = (
  markets: PropMarket[],
  mediaId: MediaId,
  limit = MAX_PROPS_PER_OUTLET,
  options: { teamWinPct?: (teamId: string) => number | null } = {},
): PropMarket[] => {
  const winPctFor = options.teamWinPct ?? (() => null);

  /*
   * Rank by the outlet's OWN probability plus its editorial affinity.
   *
   * Added, not substituted: an outlet still leads with its most confident read, and
   * affinity decides among props it rates similarly. That is the "break the ties"
   * role. Keeping it additive and bounded (roughly 0-1.0 against a probability
   * range of about 0.9) means it can reorder near-ties without letting a 0.95 shot
   * outrank a 0.55 on character alone.
   */
  const score = (market: PropMarket): number =>
    market.probability[mediaId] +
    selectionAffinity({ market, mediaId, teamWinPct: winPctFor(market.teamId) });

  const ranked = [...markets].sort((a, b) => {
    const own = score(b) - score(a);
    if (Math.abs(own) > 1e-9) return own;
    // Deterministic tiebreak. Two props at the same score must not swap places
    // between renders, or a card the manager had already read would change
    // underneath them.
    return a.propId.localeCompare(b.propId);
  });

  // Hottest-first, for the tail pass. Derived from the same ranking so the two
  // passes cannot disagree about which prop is the outlet's boldest pick.
  const byBoldness = [...ranked].reverse();

  const safeCount = Math.max(1, Math.round(limit * 0.6));
  const selected: PropMarket[] = [];
  const take = (market: PropMarket): void => { selected.push(market); };

  /*
   * PASS 1 -- guarantees.
   *
   * Two sub-passes, because a market that closes a role gap AND adds a game is
   * worth more than one that only adds a game. The first sub-pass weights a role
   * gap at 2 and a new game at 1, so role diversity is attempted first while the
   * card is still empty enough to accept it.
   */
  for (let weight of [2, 1]) {
    for (const market of ranked) {
      if (selected.length >= limit) break;
      if (selected.includes(market)) continue;
      if (!canTake(selected, market)) continue;
      const unmet = unmetGuarantees(selected);
      const closes =
        weight * (unmet.batting > 0 && market.role === 'batting' ? 1 : 0) +
        weight * (unmet.pitching > 0 && market.role === 'pitching' ? 1 : 0) +
        (unmet.newGames > 0 ? 1 : 0);
      if (closes === 0) continue;
      take(market);
    }
  }

  // PASS 2 -- the safe quota: the outlet's most confident reads.
  for (const market of ranked) {
    if (selected.length >= limit) break;
    if (selected.includes(market)) continue;
    if (market.temperament[mediaId] !== 'safe') continue;
    if (!canTake(selected, market)) continue;
    take(market);
    if (selected.filter((m) => m.temperament[mediaId] === 'safe').length >= safeCount) break;
  }

  // PASS 3 -- the hot tail.
  //
  // The safe/hot split is the feature: a card of all-same picks is a list, and a
  // card of all-safe picks gives a manager nothing to do with his nerve.
  for (const market of byBoldness) {
    if (selected.length >= limit) break;
    if (selected.includes(market)) continue;
    if (market.temperament[mediaId] !== 'hot') continue;
    if (!canTake(selected, market)) continue;
    take(market);
  }

  // PASS 4 -- the remainder by the outlet's own confidence, so a card is never short
  // because every one of its reads landed in the middle band.
  for (const market of ranked) {
    if (selected.length >= limit) break;
    if (selected.includes(market)) continue;
    if (!canTake(selected, market)) continue;
    take(market);
  }

  /*
   * PASS 5 -- relax, rather than show a short card.
   *
   * The caps can leave a card short on a slate where the first four games and both
   * pitchers are already used. A board that stops early because of a diversity rule
   * is worse than one that bends the rule, so they are relaxed in order of what they
   * cost the reader: game spread first, then per-stat, and NEVER the one-per-player
   * rule, which is the only one preventing a single batter from becoming the card.
   */
  const relaxations: Array<(card: PropMarket[], market: PropMarket) => boolean> = [
    (card, market) =>
      !card.some((e) => e.playerId === market.playerId) &&
      card.filter((e) => e.stat === market.stat).length < MAX_PROPS_PER_STAT,
    (card, market) => !card.some((e) => e.playerId === market.playerId),
  ];
  for (const allows of relaxations) {
    if (selected.length >= limit) break;
    for (const market of ranked) {
      if (selected.length >= limit) break;
      if (selected.includes(market)) continue;
      if (!allows(selected, market)) continue;
      take(market);
    }
  }

  return selected;
};

export const propSelectionLabel = (
  market: PropMarket, mediaId: MediaId, side: PropSide,
): string => `${market.playerName} ${side === 'over' ? 'Over' : 'Under'} ${market.line} ${market.statPlural}`;

export const propMarketTitle = (market: PropMarket): string => {
  const config = PROP_STATS[market.stat];
  return `${market.playerName} · ${config.plural}`;
};
