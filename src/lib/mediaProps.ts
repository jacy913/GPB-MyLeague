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
import { MEDIA_PROFILES } from '../data/media';
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
};

/**
 * Picks per outlet per day.
 *
 * Five, as specified. The cap is applied per outlet per slate date, and it is a
 * cap rather than a quota: an outlet with only four props worth publishing gets
 * four, because padding a card to five with a 0.09 shot is how a board stops
 * being worth reading.
 */
export const MAX_PROPS_PER_OUTLET = 5;

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
 * Which five props one outlet publishes today.
 *
 * The safe three are the outlet's most confident, and the two hot ones its least.
 * That split is the feature: a board of five all-same picks is a list, and a board
 * of five all-safe picks gives a manager nothing to do with his nerve. The
 * selection is by that outlet's OWN probability, not the consensus, because the
 * whole point of reading one outlet rather than the mean is that its ordering
 * differs.
 */
export const selectOutletProps = (
  markets: PropMarket[],
  mediaId: MediaId,
  limit = MAX_PROPS_PER_OUTLET,
): PropMarket[] => {
  const ranked = [...markets].sort((a, b) => {
    const own = b.probability[mediaId] - a.probability[mediaId];
    if (Math.abs(own) > 1e-9) return own;
    // Deterministic tiebreak. Two props at the same probability must not swap
    // places between renders, or a card the manager had already read would
    // change underneath them.
    return a.propId.localeCompare(b.propId);
  });

  const safeCount = Math.max(1, Math.round(limit * 0.6));
  const selected: PropMarket[] = [];
  const seen = new Set<string>();

  for (const market of ranked) {
    if (selected.length >= limit) break;
    if (market.temperament[mediaId] !== 'safe') continue;
    // One pick per player per outlet per day. Five props on one batter is not a
    // board, it is a monologue, and it would crowd every other card off.
    if (seen.has(market.playerId)) continue;
    seen.add(market.playerId);
    selected.push(market);
    if (selected.filter((m) => m.temperament[mediaId] === 'safe').length >= safeCount) break;
  }

  for (const market of [...ranked].reverse()) {
    if (selected.length >= limit) break;
    if (selected.includes(market)) continue;
    if (market.temperament[mediaId] !== 'hot') continue;
    if (seen.has(market.playerId)) continue;
    seen.add(market.playerId);
    selected.push(market);
  }

  // If the board could not fill from safe and hot alone -- an outlet whose reads
  // all land in the middle band -- fill from the remainder by its own confidence
  // rather than showing an empty slot.
  for (const market of ranked) {
    if (selected.length >= limit) break;
    if (selected.includes(market)) continue;
    if (seen.has(market.playerId)) continue;
    seen.add(market.playerId);
    selected.push(market);
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
