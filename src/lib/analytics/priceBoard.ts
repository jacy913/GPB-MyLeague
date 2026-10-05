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
  plainConsensusWinPct,
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
 * Monte Carlo trials for a DAILY board, and the number was measured rather than guessed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHEAP PATH IS THE RIGHT ONE, WITH THE NUMBERS
 * ---------------------------------------------------------------------------
 *
 * The Monte Carlo is deterministic given its seed, so a 250-trial read is not a noisy version of a
 * 2000-trial read -- it is a CONSISTENTLY DIFFERENT one. Trial count is therefore a MODEL choice,
 * not a sampling nuisance, which has a sharp consequence: switching trial count mid-season makes
 * every fair value jump and puts a discontinuity in the series. It must be constant within a
 * season. `checkPriceBoard` measures the cost of getting this wrong.
 *
 * Measured on five real days of a real league, 32 clubs, same seed throughout:
 *
 *   trials   sec/day   mean |close vs 2000|   max    season cost (180 days)
 *      100       0.08                2.51%   7.47%   ~14s
 *      250       0.16                1.47%   3.83%   ~29s
 *      400       0.24                0.80%   2.96%   ~43s
 *     2000       1.22                  --     --    ~3.7 min
 *
 * In-season daily sigma is 4%. At 250 the WORST single club differs from a full-resolution read by
 * 3.83% -- under one day of the market's own noise -- for an eighth of the cost. Buying the
 * remaining 0.8% of mean accuracy would multiply the compute by eight to move a price by less than
 * the noise already in it, which is the wrong trade.
 *
 * 100 is too cheap: a 7.47% worst case is nearly two sigma, which a reader would see and could not
 * explain. That is the line, and 250 is the rung on the safe side of it.
 *
 * ---------------------------------------------------------------------------
 * CORRECTION: THE "4%" ABOVE IS A STATIC-FAITHURE NUMBER, AND THE REAL ONE IS ~6%
 * ---------------------------------------------------------------------------
 *
 * The 4% is the realised daily sigma of `checkSharePrice`, where fair value is held roughly still.
 * On a real league the fair value MOVES day to day -- the consensus reads the record, and the
 * playoff term moves with it -- so a day-over-day return contains that drift as well as the noise.
 * Measured over 160 day-over-day returns from a real board, realised sigma is 6.10%.
 *
 * The conclusion survives, and the constant is defensible either way: the cheap read's worst
 * divergence measures 3.04-3.58% against 2000, which is under 6.10%. But the justification belongs
 * to the real number, and `checkPriceBoard` now measures the sigma from its own run rather than
 * citing a constant that is only a noise scale.
 *
 * RAISING THIS IS A BREAKING CHANGE TO SAVED SERIESES. Every stored close was computed with this
 * constant, and a different value produces a different -- still valid, but different -- market.
 */
export const HXSE_DAILY_TRIALS = 250;

/**
 * Trials for an authoritative read, for a caller that wants one rather than a daily price.
 *
 * NOT run automatically. The daily board is the cheap path, and nothing in the day loop should
 * quietly pay for 2000 trials; this is exposed so a boundary read (season close, a manual refresh)
 * can ask for one and know what it costs.
 */
export const HXSE_SETTLEMENT_TRIALS = 2000;

/**
 * Monte Carlo trials when the caller does not say.
 *
 * The daily figure. `DEFAULT_BOARD_SETTINGS`-style defaults exist so a caller that has not thought
 * about cost still gets a board, and the sensible default turned out to be the cheap one.
 */
export const DEFAULT_BOARD_TRIALS = HXSE_DAILY_TRIALS;

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
  /**
   * Optional cache key for the EXPENSIVE layer, normally `(season, date)`.
   *
   * ---------------------------------------------------------------------------
   * ONLY THE FAIR LAYER IS CACHED, AND THAT IS LOAD-BEARING
   * ---------------------------------------------------------------------------
   *
   * It is tempting to memoise the whole board by `(season, date)`, and that would be a correctness
   * bug rather than an optimisation. The close depends on `previousClose`, so two callers asking for
   * the same date from different ledgers want DIFFERENT closes and must both get them. The fair
   * prices and valuations depend only on the league state, the seed and the trial count, so those
   * are what gets cached.
   *
   * The trial count is part of the key. Serving a 250-trial fair price to a caller who asked for
   * 2000 would be exactly the kind of quietly-wrong number this project keeps paying for, and it
   * would be invisible -- the shapes would match perfectly.
   */
  fairCacheKey?: string;
}

/** The cached layer: everything that depends on league state rather than on yesterday's close. */
interface FairLayer {
  valuation: Record<string, number>;
  fair: Record<string, number>;
  mcTrials: number;
}

/**
 * Process-local cache of fair layers, keyed by caller key plus trial count.
 *
 * Process-local and deliberately not persisted: a persisted fair price would be a valuation frozen
 * in a save, and the whole point is that it is recomputed from the league as it stands. The caller
 * memoises at the `(season, date)` level by simply not asking twice.
 */
const fairLayerCache = new Map<string, FairLayer>();

/** Exposed so a test or a season rollover can drop stale entries. Bounded by the caller's keys. */
export const clearFairLayerCache = (): void => {
  fairLayerCache.clear();
};

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
/**
 * The season seed for the price path, derived from the league's own identity.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS DERIVED RATHER THAN STORED, AND WHY THAT IS THE RIGHT WAY ROUND
 * ---------------------------------------------------------------------------
 *
 * `SimulationWorkerStartPayload` carries no seed and `LocalUniverseBundle` has no field for one,
 * so the price path had nothing to seed itself with. The alternatives were both worse:
 *
 *   - A FRESH RANDOM SEED PER RUN. The price path's entire reason for existing is that a reloaded
 *     save shows the same market. A seed that changes when the page reloads would make every close
 *     in the ledger a lie the moment it was written.
 *
 *   - A NEW FIELD ON THE BUNDLE. That is a schema change and a backfill, for a value that is
 *     completely determined by which clubs are in the league.
 *
 * So it is hashed from the sorted club ids. Stable across save and load, stable across devices,
 * stable across a season rollover that keeps the same clubs, and needing no stored state at all.
 *
 * The ids are SORTED before hashing, deliberately. A seed derived from list order would change the
 * entire market if the team array were ever re-sorted for display, which would retroactively
 * invalidate every stored close -- and would do it for no reason a player could perceive.
 */
export const leaguePriceSeed = (teams: Array<{ id: string }>): number => {
  let h = 0x811c9dc5;
  for (const id of [...teams.map((t) => t.id)].sort()) {
    for (let i = 0; i < id.length; i += 1) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  }
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
};

/**
 * Price and append one day. Returns the ledger with the day in it.
 *
 * Exported from here rather than written inline in the worker so the worker's day loop stays a thin
 * call to something that is already tested. The worker is not directly testable -- it binds
 * `self` as a worker scope at module scope, so importing it outside a worker context fails -- which
 * means any logic left in the loop body would be untestable by construction. Putting the three
 * lines here keeps the worker a wiring detail.
 *
 * Returns the BOARD as well as the ledger, because the crowd needs yesterday's FAIR prices and the
 * persisted `PriceSeries` carries closes only. That is the right split: closes are the historical
 * record and fair values are today's assessment of the same club, and putting a derived valuation
 * into every saved day would put a number on disk that was true only on the day it was written.
 */
/**
 * Yesterday's fair prices and plain consensus, for the crowd to read.
 *
 * The crowd needs three things the price board already computes -- fair value per club, the game
 * shocks, and the forecaster consensus -- and none of them is on `PriceBoard`. Rather than have the
 * market floor recompute `buildMediaReads` a second time (which `priceBoardForDay` already does
 * internally), this exposes the two pieces the board throws away.
 *
 * Returns `null` on the first day, when there is no previous board and the crowd has nothing to
 * have an opinion about yet. That null is meaningful: the crowd genuinely cannot act on day one,
 * and the market therefore opens at fair value with no flow in it.
 *
 * `plain` is the UNWEIGHTED consensus, which is not the same number `fair` is built from. That
 * difference is the entire content of the analyst archetype, so it cannot be substituted here.
 */
export const marketFloorFor = (
  previousBoard: PriceBoard | null,
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): { fair: Record<string, number>; plain: Map<string, number>; leagueMean: number } | null => {
  if (!previousBoard) return null;
  const reads = buildMediaReads({
    teams,
    players: playerState.players,
    battingRatings: playerState.battingRatings,
    pitchingRatings: playerState.pitchingRatings,
    battingStats: playerState.battingStats,
    pitchingStats: playerState.pitchingStats,
    playerState,
    seasonYear,
  });
  const plain = plainConsensusWinPct(teams, reads);
  return { fair: previousBoard.fair, plain: plain.byId, leagueMean: plain.leagueMean };
};

/**
 * `ledger` MAY BE `undefined` -- a universe that has never traded has no ledger, and pricing its
 * first day has to start somewhere.
 *
 * Defaulted inside the signature rather than at the call sites, for the same reason as `latestClose`
 * above: `undefined` is a real state and the defensive handling belongs with the function that knows
 * it, once, rather than being repeated as `?? []` by each caller and forgotten by the next one.
 */
export const priceAndAppendDay = (
  ledger: PriceSeries[] | undefined,
  input: PriceBoardInput,
): { ledger: PriceSeries[]; board: PriceBoard } => {
  const board = priceBoardForDay(input);
  return { ledger: appendPriceDay(ledger, board), board };
};

export const priceBoardForDay = (input: PriceBoardInput): PriceBoard => {
  const mcTrials = input.mcTrials ?? DEFAULT_BOARD_TRIALS;
  const regime = input.regime ?? 'in_season';
  const cacheKey = input.fairCacheKey ? `${input.fairCacheKey}|${mcTrials}` : null;

  /*
    Hoisted out of the cache branch because the price step needs the same date filter the fair layer
    does. A cache hit must not change which games the day was allowed to see.
  */
  const asOf = input.games.filter((g) => g.date <= input.date);

  let layer = cacheKey ? fairLayerCache.get(cacheKey) : undefined;
  if (!layer) {
    /*
      ---------------------------------------------------------------------------
      `date` IS HONOURED, AND NOT HONOURING IT WAS A LOOK-AHEAD BIAS
      ---------------------------------------------------------------------------

      The first version filtered the game list by STATUS only and never by date, so the fair layer
      was computed from every game in `input.games` regardless of when they were played. Pricing day
      50 of a season from a day-90 snapshot therefore used day-90 records -- the price "knew" results
      that had not happened yet. In production the worker happens to pass a fresh snapshot after each
      day, which hid it; the check priced several days from one snapshot and it showed up immediately
      as two different dates producing identical fair prices.

      That is not a tidiness bug. A valuation that can see the future is not a forecast, and every
      statistic downstream of it -- the price, the deviation from fair, the fitted weights' apparent
      skill -- would be measuring hindsight. The date filter is applied once, above, and both the
      fair layer and the price step work from `asOf`.
    */
    const played = asOf.filter((g) => g.status === 'completed' && isRegularSeasonGame(g));
    const remaining = asOf.filter((g) => g.status !== 'completed' && isRegularSeasonGame(g));

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
    const valueInputs: TeamValueInput[] = buildValueInputs({
      teamIds: input.teams.map((t) => t.id),
      consensusWinPctById,
      surplusById,
      playoffProbabilityById,
      games: played,
    });
    const league = measureLeague(valueInputs);

    const valuation: Record<string, number> = {};
    const fair: Record<string, number> = {};
    for (const teamInput of valueInputs) {
      const value = teamValueFor(teamInput, league);
      valuation[teamInput.teamId] = value;
      fair[teamInput.teamId] = fairPriceFor(value);
    }
    layer = { valuation, fair, mcTrials };
    if (cacheKey) fairLayerCache.set(cacheKey, layer);
  }

  // 5. The price step, always recomputed -- it depends on yesterday's close, not on league state.
  const fair = layer.fair;
  const close: Record<string, number> = {};
  const move: Record<string, number> = {};
  const gameShocks = regime === 'in_season' ? shocksForDate(asOf.filter((g) => g.date === input.date)) : {};

  /*
    NO OPENING SPECIAL CASE, and this is the one that mattered.

    `isFirstDay` used to pin the close to `fairPrice` exactly. Removed for the same reason as the
    matching branch in `sharePrice.ts` -- an exchange that opens every club precisely on the
    valuation has a stray-from-fair of exactly zero across all thirty-two clubs, so the mispricing
    the whole desk exists to trade does not exist until day two.

    `previous` falls back to `fairPrice`, so on a first day the gap is zero and `drift` is zero:
    the open is `fair x (1 + noise)`. No shock is invented either -- there are no completed games on
    an opening date, so `gameShocks` is empty and `eventShocks` is whatever the caller actually
    passed. The market opens imprecise, not informed.

    `checkPriceBoard` now gates this directly, because it is the function the app actually prices
    through. `checkSharePrice` gates the same property on `buildPriceSeries`, which is a different
    implementation -- a property proven on one is not a property of the other.
  */

  for (const teamId of Object.keys(fair)) {
    const fairPrice = fair[teamId];
    const shock = (gameShocks[teamId] ?? 0) + (input.eventShocks?.[teamId] ?? 0);
    const next = nextPrice({
      seed: input.seed,
      date: input.date,
      teamId,
      previous: (input.previousClose as Record<string, number>)?.[teamId] ?? fairPrice,
      fair: fairPrice,
      shock,
      regime,
    });
    close[teamId] = next;
    move[teamId] = fairPrice > 0 ? next / fairPrice - 1 : 0;
  }

  return {
    date: input.date,
    regime,
    close,
    fair,
    valuation: layer.valuation,
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
/** `undefined` accepted for the same reason as `priceAndAppendDay` above: never-priced is a state. */
export const appendPriceDay = (ledger: PriceSeries[] | undefined, board: PriceBoard): PriceSeries[] => {
  // The `?? []` lives here rather than at each call site, so a never-priced universe cannot throw on
  // its first priced day.
  const kept = (ledger ?? []).filter((day) => day.date !== board.date);
  /*
    THE FAIR LAYER IS RECORDED, NOT CACHED, and the distinction is the whole reason this is here.

    `fairLayerCache` above is deliberately process-local: serving a persisted fair price to a caller
    who is asking for a fresh valuation would hand back a number computed for different inputs.
    This is the opposite case. The chart's second line is a HISTORICAL RECORD -- "what did this club
    trade against on 3 June" -- and recomputing it later would not answer that question, because a
    recomputation runs different Monte Carlo trials against whatever the roster has become and
    returns a different number. Drawing a recorded close next to a freshly recomputed valuation
    would compare a real trade against a hypothetical one and the gap between the lines would be an
    artefact of the recomputation rather than a fact about the market.

    So the day carries the fair value that was actually used, and the chart labels it as recorded at
    the time. It is optional on the type: a ledger written before this field existed has none, and
    the chart omits the line rather than inventing a back-filled one.
  */
  return [...kept, { date: board.date, close: { ...board.close }, fair: { ...board.fair } }]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
};

/**
 * The most recent close in a ledger, or undefined when it is empty OR absent.
 *
 * `undefined` is accepted because it is a real ledger state, not a mistake. A universe that has
 * never been priced holds no ledger at all, and `priceLedger` is `PriceSeries[] | undefined`
 * precisely to say so. Reading it as "priced and empty" would be a lie in the other direction --
 * it would claim the market traded and produced nothing.
 *
 * Terminate Universe now sets the ledger to `undefined` (a new universe has never traded), which is
 * what surfaced this. The Exchange page passed the optional value straight in here and got a blank
 * screen and a freeze, because `undefined.length` throws. Every call site that had already been
 * careful wrote `priceLedger ?? []` at the call, so the defensiveness lived in the callers and this
 * one caller had none. It belongs here instead, once.
 */
export const latestClose = (ledger: PriceSeries[] | undefined): Record<string, number> | undefined =>
  ledger && ledger.length > 0 ? ledger[ledger.length - 1].close : undefined;
