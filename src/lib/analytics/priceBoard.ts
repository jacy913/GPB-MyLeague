/**
 * The daily price board: the wiring that turns a live league day into a set of share closes.
 *
 * ===========================================================================
 * WHAT THIS FILE IS FOR
 * ===========================================================================
 *
 * `sharePrice.ts` builds a price SERIES from inputs the caller assembles: fair values, shocks, a
 * regime, and a seed. `teamValue.ts` builds a club valuation from four measured terms. Neither of
 * them knows about the other, and nothing in the app called either of them -- the market existed as
 * a formula with no clock attached.
 *
 * This is the bridge. Given a live league on a date, it produces that date's closes, by composing:
 *
 *     media reads --> weighted consensus --> playoff odds (Monte Carlo) --> buildValueInputs
 *                  --> measureLeague --> teamValueFor --> fairPriceFor --> nextPrice
 *
 * ===========================================================================
 * WHY THE COMPOSITION LIVES HERE AND NOT IN A HOOK
 * ===========================================================================
 *
 * `playoffMonteCarlo` swaps the global `Math.random` for a seeded stream and is therefore NOT
 * REENTRANT -- two overlapping calls fight over the global and the loser gets a mangled stream. It
 * was documented as worker-only for exactly this reason, and that constraint is what decides where
 * this code lives.
 *
 * So `priceBoardForDay` is a plain synchronous function with no hidden global state beyond that one
 * documented swap, it is called once per simulated day from the worker's serial request loop, and it
 * is memoised by `(season, date)` by its caller. Putting it in a React render path would be a bug
 * waiting to happen, and this file says so rather than leaving it to be discovered.
 *
 * ===========================================================================
 * THE FAIR-VALUE FEED IS WHERE THE EXPENSIVE PART LIVES
 * ===========================================================================
 *
 * The Monte Carlo is the cost. `mcTrials` is a parameter with NO default of 2000 here, because
 * 2000 is right for a cached production day and absurd for a caller that wants a quick read. A
 * caller that omits it gets 500, which is deliberately coarse -- and `checkPriceBoard` asserts the
 * board still lands inside its band at that trial count, so the cheap path is a known-degradation
 * rather than an unexamined one.
 *
 * ===========================================================================
 * WHAT A DAY'S SHOCKS ACTUALLY ARE
 * ===========================================================================
 *
 * In season: the day's completed games, via `shocksForDate`. Run margin, not win/loss, because a
 * one-run win is not a blowout and pricing them identically would discard the only information a
 * game result contains.
 *
 * Off season: nothing. The offseason regime is quiet BY DESIGN and the moves arrive as explicit
 * event shocks the caller supplies -- a signing, a trade. Inventing them here would mean inventing
 * headlines, and a price that moved on a transaction that never happened is worse than a flat one.
 */

import { playoffMonteCarlo } from './playoffMonteCarlo';
import {
  buildValueInputs,
  measureLeague,
  teamValueFor,
  type TeamValueInput,
} from './teamValue';
import { buildMediaReads } from '../mediaReads';
import { weightedConsensus } from '../markets';
import { getTeamRosterStrength, getTeamStrengthEdge } from '../../logic/teamStrength';
import { isRegularSeasonGame } from '../../logic/playoffs';
import {
  fairPriceFor,
  nextPrice,
  shocksForDate,
  type PriceSeries,
  type PriceRegime,
} from './sharePrice';
import type { Game, LeaguePlayerState, SimulationSettings, Team } from '../../types';

/**
 * Monte Carlo trials when the caller does not say.
 *
 * 500, not the production 2000. This function is also called from tools and from any caller that
 * wants a board to look at, and 2000 is a poor default for that. It is coarse on purpose and the
 * coarseness is measured rather than assumed.
 */
export const DEFAULT_BOARD_TRIALS = 500;

/**
 * The engine's own default settings.
 *
 * Declared here rather than imported from `logic/simulation` to avoid a module cycle, and
 * `PriceBoardInput.settings` exists so a caller with the live season settings should pass them --
 * a board priced under different settings than the league is being simulated under would be a
 * valuation of a season that is not the one being played.
 *
 * The values are copied from `DEFAULT_SETTINGS` in `logic/simulation.ts`. `checkPriceBoard` asserts
 * they still match, because a copy that drifts is exactly the kind of unmeasured number this project
 * keeps paying for.
 */
export const DEFAULT_BOARD_SETTINGS: SimulationSettings = {
  continuityWeight: 0.6,
  winLossVariance: 4,
  homeFieldAdvantage: 0.025,
  gameLuckFactor: 0.08,
  leagueEnvironmentBalance: 0.5,
  battingVarianceFactor: 0.5,
};

export interface PriceBoardInput {
  teams: Team[];
  /** Every game in the season, completed and scheduled. Split internally by status. */
  games: Game[];
  /** The day being priced, ISO. */
  date: string;
  playerState: LeaguePlayerState;
  seasonYear: number;
  /** Season seed. Threads through to the price noise and the playoff simulation. */
  seed: number;
  /**
   * Yesterday's closes. Absent on the first priced day, when every club opens at fair value.
   *
   * Passed in rather than accumulated here so a caller can rebuild any single day without
   * replaying the season, and so the ledger in a save stays the single source of history.
   */
  previousClose?: Record<string, number>;
  /** Offseason event shocks for this date, as fractions. Never invented here. */
  eventShocks?: Record<string, number>;
  /** Whether this date is in season. Derived from the caller, which knows the calendar. */
  regime?: PriceRegime;
  mcTrials?: number;
  /** The live season's settings. Falls back to `DEFAULT_BOARD_SETTINGS`; prefer passing the real ones. */
  settings?: SimulationSettings;
}

export interface PriceBoard {
  date: string;
  regime: PriceRegime;
  /** teamId -> close, on the 0-1000 band. */
  close: Record<string, number>;
  /** teamId -> fair price. Reported so a caller can see how far each club has strayed. */
  fair: Record<string, number>;
  /** teamId -> the valuation that produced the fair price, 0-100. Reported, not used for pricing. */
  valuation: Record<string, number>;
  /** teamId -> the day's fractional move, after drift, shock and noise. */
  move: Record<string, number>;
  /** How many trials the playoff term actually ran with. */
  mcTrials: number;
  /** Extra shocks the caller supplied, for the record. */
  eventShocks: Record<string, number>;
}

/**
 * Today's closes for every club.
 *
 * THE ORDER MATTERS and is the whole point of the file. Fair value is a VALUATION, so it depends on
 * the forecaster consensus and on playoff odds, both of which are measured. The price is then a
 * trading instrument that reverts toward that fair value and is pushed around by the day's results.
 *
 * Running the Monte Carlo first and the reads second would produce the same closes, because neither
 * mutates the other -- but doing it in this order means the expensive term is computed from the
 * state as it stood at the START of the day, which is what a reader looking at yesterday's page
 * would expect.
 */
export const priceBoardForDay = (input: PriceBoardInput): PriceBoard => {
  const mcTrials = input.mcTrials ?? DEFAULT_BOARD_TRIALS;
  const regime = input.regime ?? 'in_season';

  const played = input.games.filter((g) => g.status === 'completed' && isRegularSeasonGame(g));
  const remaining = input.games.filter((g) => g.status !== 'completed' && isRegularSeasonGame(g));

  // 1. The forecaster consensus, confidence-weighted.
  const reads = buildMediaReads({
    teams: input.teams,
    players: input.playerState.players,
    battingRatings: input.playerState.battingRatings,
    pitchingRatings: input.playerState.pitchingRatings,
    battingStats: input.playerState.battingStats,
    pitchingStats: input.playerState.pitchingStats,
    playerState: input.playerState,
    seasonYear: input.seasonYear,
  });
  const consensusWinPctById = new Map(input.teams.map((t) => [
    t.id,
    weightedConsensus((profile) => reads.scores[profile.id]?.get(t.id) ?? 0.5),
  ]));

  // 2. Roster surplus, from the rosters rather than from the record.
  const strength = getTeamRosterStrength(input.teams, input.playerState, input.seasonYear);
  const surplusById = new Map(input.teams.map((t) => [t.id, getTeamStrengthEdge(t, strength)]));

  // 3. Playoff odds -- the expensive term, and the one `nextPrice` cannot do without.
  const odds = playoffMonteCarlo({
    teams: input.teams,
    playedGames: played,
    remainingGames: remaining,
    settings: input.settings ?? DEFAULT_BOARD_SETTINGS,
    trials: mcTrials,
    seed: input.seed,
  });
  const playoffProbabilityById = new Map(odds.odds.map((o) => [o.teamId, o.championship]));

  // 4. Valuation, then the price scale.
  const inputs: TeamValueInput[] = buildValueInputs({
    teamIds: input.teams.map((t) => t.id),
    consensusWinPctById,
    surplusById,
    playoffProbabilityById,
    games: played,
  });
  const league = measureLeague(inputs);

  const fair: Record<string, number> = {};
  const valuation: Record<string, number> = {};
  const close: Record<string, number> = {};
  const move: Record<string, number> = {};
  const gameShocks = regime === 'in_season' ? shocksForDate(input.games.filter((g) => g.date === input.date)) : {};
  const isFirstDay = !input.previousClose || Object.keys(input.previousClose).length === 0;

  for (const teamInput of inputs) {
    const value = teamValueFor(teamInput, league);
    const fairPrice = fairPriceFor(value);
    valuation[teamInput.teamId] = value;
    fair[teamInput.teamId] = fairPrice;

    const shock = (gameShocks[teamInput.teamId] ?? 0) + (input.eventShocks?.[teamInput.teamId] ?? 0);
    const next = isFirstDay
      ? fairPrice
      : nextPrice({
        seed: input.seed,
        date: input.date,
        teamId: teamInput.teamId,
        previous: (input.previousClose as Record<string, number>)[teamInput.teamId] ?? fairPrice,
        fair: fairPrice,
        shock,
        regime,
      });
    close[teamInput.teamId] = next;
    move[teamInput.teamId] = fairPrice > 0 ? next / fairPrice - 1 : 0;
  }

  return {
    date: input.date,
    regime,
    close,
    fair,
    valuation,
    move,
    mcTrials,
    eventShocks: input.eventShocks ?? {},
  };
};

/**
 * Append one day to the ledger, replacing any earlier entry for the same date.
 *
 * A pure function over an immutable array, and the replacement is the point: re-simulating a day
 * must OVERWRITE it, not stack a second copy, or a chart would show two closes for one date and
 * "today" would be ambiguous. `readSharePriceLedger` collapses duplicates for the same reason; this
 * is the write-side half of that rule.
 */
export const appendPriceDay = (ledger: PriceSeries[], board: PriceBoard): PriceSeries[] => {
  const kept = ledger.filter((day) => day.date !== board.date);
  return [...kept, { date: board.date, close: { ...board.close } }]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

/** The most recent close in a ledger, or undefined when it is empty. */
export const latestClose = (ledger: PriceSeries[]): Record<string, number> | undefined =>
  ledger.length > 0 ? ledger[ledger.length - 1].close : undefined;
