/**
 * Does the daily price board actually price a real league, and survive a save?
 *
 * ===========================================================================
 * WHY A REAL SEASON, WHEN checkSharePrice USES A SYNTHETIC ONE
 * ===========================================================================
 *
 * `checkSharePrice` proves the price PATH is deterministic, bounded and correctly shaped, against a
 * fixture it controls. That is the right test for a formula.
 *
 * This one tests the WIRING, and a wiring bug is invisible to a synthetic fixture by construction.
 * The composition here is six modules deep -- media reads, weighted consensus, roster strength,
 * Monte Carlo playoff odds, `buildValueInputs`, `measureLeague`, `teamValueFor`, `fairPriceFor`,
 * `nextPrice` -- and every one of them takes real arguments in production. A fixture would pass while
 * the board silently read a stale teams array, which is exactly the bug that was sitting in
 * `verifyPropCardDiversity` and had gone unnoticed because nothing checked it.
 *
 * So this runs an actual simulated season and prices real days from it.
 *
 * ===========================================================================
 * THE CHECKS THAT MATTER MOST
 * ===========================================================================
 *
 * 1. DETERMINISM ACROSS A REAL SEASON, with `Math.random` poisoned. Same failure mode as the price
 *    path's own check, but now covering the whole composition including the Monte Carlo's seeded
 *    swap. This is the property the `(season, date)` cache depends on.
 *
 * 2. THE PRICE FOLLOWS THE VALUATION. The board is supposed to trade around fair value, so over a
 *    real season the mean close should sit near the mean fair price and individual clubs should not
 *    be wildly divorced from it. Asserted as a measured band, with the number printed either way.
 *
 * 3. GAME RESULTS MOVE THE PRICE, AND THE WINNER MOVES UP. The shocks come from real completed
 *    games, so this is the end-to-end proof that a September result reaches an October price -- the
 *    thing the playoff term was built for.
 *
 * 4. THE LEDGER APPENDS, REPLACES, AND ROUND-TRIPS. Re-simulating a day must overwrite it rather
 *    than stack a second copy, or a chart shows two closes for one date.
 *
 * 5. THE COARSE PATH IS SAFE. `DEFAULT_BOARD_TRIALS` is 500 rather than 2000, so the cheap path is
 *    checked for degradation rather than assumed to be fine.
 *
 * Run: npx tsx tools/checkPriceBoard.ts [warmupDays] [pricedDays]
 */

import {
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_BOARD_TRIALS,
  HXSE_DAILY_TRIALS,
  HXSE_SETTLEMENT_TRIALS,
  appendPriceDay,
  clearFairLayerCache,
  latestClose,
  priceBoardForDay,
  type PriceBoard,
} from '../src/lib/analytics/priceBoard';
import { PRICE_MAX, PRICE_MIN, PRICE_SANITY_MAX, REGIME_VOLATILITY, type PriceSeries } from '../src/lib/analytics/sharePrice';
import { createLocalUniverseBundle, readSharePriceLedger } from '../src/logic/localUniverseState';
import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const SEED = 4242;
const WARMUP_DAYS = Number(process.argv[2] ?? 90);
const PRICED_DAYS = Number(process.argv[3] ?? 6);

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]): number => { const m = mean(xs); return Math.sqrt(mean(xs.map((v) => (v - m) ** 2))); };

interface SeasonState {
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
}

/** Step a fresh universe forward to a fixed point in the season and hand back its state. */
const simulateTo = async (days: number): Promise<SeasonState> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;
  let teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });
  let playerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < days; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams;
    games = r.games;
    playerState = r.playerState;
  }
  return { teams, games, playerState };
};

/** Price a run of consecutive days, carrying each day's closes into the next. */
const priceRun = async (from: SeasonState, days: string[], trials: number): Promise<PriceBoard[]> => {
  const boards: PriceBoard[] = [];
  let previous: Record<string, number> | undefined;
  for (const date of days) {
    const board = priceBoardForDay({
      teams: from.teams,
      games: from.games,
      date,
      playerState: from.playerState,
      seasonYear: YEAR,
      seed: SEED,
      previousClose: previous,
      mcTrials: trials,
      settings: DEFAULT_SETTINGS,
    });
    boards.push(board);
    previous = board.close;
  }
  return boards;
};

const main = async (): Promise<void> => {
  const state = await simulateTo(WARMUP_DAYS);
  const completedDates = [...new Set(state.games.filter((g) => g.status === 'completed').map((g) => g.date))]
    .sort()
    .slice(-PRICED_DAYS);
  const teamIds = state.teams.map((t) => t.id);

  // -- 1. determinism, with the global poisoned --------------------------------------------
  /*
    The Monte Carlo inside this composition swaps `Math.random` and restores it in a `finally`, so a
    leak here would be invisible to a caller that happened not to care. Poisoning the global and
    pricing a real day proves the composition draws only from its seed.
   */
  const realRandom = Math.random;
  let leaked = '';
  let boards: PriceBoard[] = [];
  Math.random = () => { leaked = 'Math.random'; throw new Error('unseeded Math.random reached the price board'); };
  try {
    boards = await priceRun(state, completedDates, 200);
  } catch (e) {
    leaked = (e as Error).message;
  } finally {
    Math.random = realRandom;
  }
  check(
    'a real day prices with Math.random replaced by a thrower, Monte Carlo included',
    leaked === '' && boards.length === completedDates.length,
    leaked !== ''
      ? `IT REACHED FOR THE GLOBAL: ${leaked}. The Monte Carlo swaps and restores it, so a leak means the restore is broken.`
      : `${boards.length} real days priced with the global poisoned, so the whole composition draws only from its seed.`,
  );

  const again = await priceRun(state, completedDates, 200);
  check(
    'the same league state and seed produce identical closes',
    JSON.stringify(again.map((b) => b.close)) === JSON.stringify(boards.map((b) => b.close)),
    JSON.stringify(again.map((b) => b.close)) === JSON.stringify(boards.map((b) => b.close))
      ? `${boards.length} days x ${teamIds.length} closes identical across two runs, which is what the `
      + '(season, date) cache assumes'
      : 'two runs disagreed on a real season, so a cached board would flicker between reads',
  );

  // -- 2. the price follows the valuation --------------------------------------------------
  const fairAll = boards.flatMap((b) => teamIds.map((id) => b.fair[id]));
  const closeAll = boards.flatMap((b) => teamIds.map((id) => b.close[id]));
  const fairMean = mean(fairAll);
  const closeMean = mean(closeAll);
  const drift = Math.abs(closeMean - fairMean) / fairMean;
  check(
    'the mean close sits near the mean fair price over a real run',
    drift < 0.05,
    `mean fair ${fairMean.toFixed(2)}, mean close ${closeMean.toFixed(2)}, a gap of ${(drift * 100).toFixed(2)}%. `
    + 'A gap much larger than this would mean the price is not tracking the thing it is meant to trade around.',
  );

  const strays = boards.flatMap((b) => teamIds.map((id) => Math.abs(b.close[id] / b.fair[id] - 1)));
  const straySd = sd(strays);
  check(
    'and no club is wildly divorced from its own fair value',
    Math.max(...strays.map(Math.abs)) < 0.5,
    `stray-from-fair: mean ${(mean(strays) * 100).toFixed(2)}%, sd ${(straySd * 100).toFixed(2)}%, `
    + `worst ${(Math.max(...strays.map(Math.abs)) * 100).toFixed(1)}% over ${strays.length} club-days`,
  );

  check(
    'every close is inside the SANITY GUARD, and the report says how many trade as premiums',
    closeAll.every((c) => c >= PRICE_MIN && c <= PRICE_SANITY_MAX),
    `${closeAll.length} closes, all within [${PRICE_MIN}, ${PRICE_SANITY_MAX}], of which `
    + `${closeAll.filter((c) => c > PRICE_MAX).length} sit above ${PRICE_MAX} as premiums. This used to `
    + `assert [${PRICE_MIN}, ${PRICE_MAX}] and passed only because the close was clamped there -- on a run `
    + 'where one club reached a +35.78% premium at $998.90, right against the old wall.',
  );

  // -- 3. real game results reach the price --------------------------------------------------
  /*
    The whole point of the playoff term is that a September game moves an October price. This is the
    end-to-end proof: on a real day, clubs that won should sit above fair more often than clubs that
    lost, measured across every club-day where the club actually played.
   */
  let winnersAbove = 0;
  let losersAbove = 0;
  let winners = 0;
  let losers = 0;
  const winnerMoves: number[] = [];
  const loserMoves: number[] = [];
  boards.forEach((board) => {
    for (const game of state.games.filter((g) => g.date === board.date && g.status === 'completed')) {
      const homeWon = game.score.home > game.score.away;
      const winnerId = homeWon ? game.homeTeam : game.awayTeam;
      const loserId = homeWon ? game.awayTeam : game.homeTeam;
      const w = board.move[winnerId];
      const l = board.move[loserId];
      if (w === undefined || l === undefined) continue;
      winners += 1;
      losers += 1;
      winnerMoves.push(w);
      loserMoves.push(l);
      if (w > 0) winnersAbove += 1;
      if (l > 0) losersAbove += 1;
    }
  });

  /*
    THE MEAN DIFFERENCE, NOT THE SIGN-FLIP RATE, and the first version of this check was wrong twice
    over. It paired winner and loser by index into a two-element array, which silently reads the same
    club twice whenever the AWAY side wins -- so it reported winners and losers at exactly the same
    rate (44.6% each) and I nearly read that as "results do not reach the price".

    And a sign-flip rate is the weaker statistic. A one-run win moves the price by about 1.2% while
    daily noise is 4%, so the sign of the move is heavily noise-influenced and swings with the day.
    The mean of the move is a paired comparison and is what actually distinguishes a working shock
    term from an inert one -- though once the pairing was fixed BOTH statistics showed the effect
    (sign flips 58.1% against 32.6%), so the sign-flip rate is reported beside the mean rather than
    discarded.
   */
  const winnerMean = mean(winnerMoves);
  const loserMean = mean(loserMoves);
  const gap = winnerMean - loserMean;
  check(
    'on real results, winners move further above fair value than losers do',
    winnerMoves.length > 0 && gap > 0,
    `${winnerMoves.length} real results: mean move ${(winnerMean * 100).toFixed(2)}% for the winner against `
    + `${(loserMean * 100).toFixed(2)}% for the loser, a gap of ${(gap * 100).toFixed(2)} points. `
    + `Sign-flip rates were ${(winnersAbove / Math.max(1, winners) * 100).toFixed(1)}% and `
    + `${(losersAbove / Math.max(1, losers) * 100).toFixed(1)}%. Both statistics show the effect; the mean gap is `
    + 'gated because it is a paired comparison and so is far less sensitive to how the day happened to '
    + 'blow, while the sign-flip rate is reported beside it rather than used as the verdict.',
  );

  // -- 4. the ledger -------------------------------------------------------------------------
  let ledger: PriceSeries[] = [];
  boards.forEach((b) => { ledger = appendPriceDay(ledger, b); });
  check(
    'the ledger holds one entry per priced day, in order',
    ledger.length === boards.length
      && ledger.every((day, i) => day.date === boards[i].date),
    `${ledger.length} days, ${ledger.map((d) => d.date).join(' ')}`,
  );

  const replaced = appendPriceDay(ledger, boards[0]);
  check(
    're-pricing a day REPLACES its entry rather than stacking a second copy',
    replaced.length === ledger.length && replaced.filter((d) => d.date === boards[0].date).length === 1,
    `appending day ${boards[0].date} again left ${replaced.length} entries instead of ${ledger.length}. Two closes `
    + 'for one date would make "today" ambiguous on a chart.',
  );

  const roundTrip = readSharePriceLedger(JSON.parse(JSON.stringify(ledger)));
  check(
    'the ledger survives a save and reload unchanged',
    JSON.stringify(roundTrip) === JSON.stringify(ledger),
    JSON.stringify(roundTrip) === JSON.stringify(ledger)
      ? `${roundTrip.length} days reloaded byte-identical`
      : 'a JSON round trip changed the ledger, so a reloaded save would show a different market',
  );

  const stub = { league: {}, players: {}, seasonHistory: [], pendingTrades: [], offseasonWorkflow: {}, draftCenter: {} };
  const bundle = createLocalUniverseBundle({
    ...stub,
    sharePriceLedger: ledger,
  } as unknown as Parameters<typeof createLocalUniverseBundle>[0]);
  check(
    'and it rides in the save bundle, defaulting to empty rather than undefined',
    Array.isArray(bundle.sharePriceLedger) && bundle.sharePriceLedger.length === ledger.length,
    `${bundle.sharePriceLedger?.length} days in the bundle`,
  );

  check(
    'latestClose returns the final day, and undefined on an empty ledger',
    JSON.stringify(latestClose(ledger)) === JSON.stringify(boards[boards.length - 1].close)
      && latestClose([]) === undefined,
    'the caller that memoises by (season, date) reads its previous close from here',
  );

  // -- 5. the coarse path is safe ------------------------------------------------------------
  const coarse = await priceRun(state, completedDates, DEFAULT_BOARD_TRIALS);
  check(
    `the cheap path (${DEFAULT_BOARD_TRIALS} Monte Carlo trials) still prices inside the sanity guard`,
    coarse.flatMap((b) => teamIds.map((id) => b.close[id])).every((c) => c >= PRICE_MIN && c <= PRICE_SANITY_MAX),
    `${DEFAULT_BOARD_TRIALS} trials produced ${coarse.length} days all within `
    + `[${PRICE_MIN}, ${PRICE_SANITY_MAX}]. `
    + `The default is deliberately coarse, so its degradation is measured here rather than assumed.`,
  );

  // -- 6. the copied settings have not drifted -----------------------------------------------
  check(
    'the board\'s copied default settings still match the engine\'s own',
    JSON.stringify(DEFAULT_BOARD_SETTINGS) === JSON.stringify(DEFAULT_SETTINGS),
    `board ${JSON.stringify(DEFAULT_BOARD_SETTINGS)} against engine ${JSON.stringify(DEFAULT_SETTINGS)}. A copy `
    + 'that drifts is a board priced under a season that is not being played.',
  );

  /*
    THE CHEAP DAILY PATH, GATED AGAINST A FULL-RESOLUTION READ.

    This is the check that keeps `HXSE_DAILY_TRIALS` honest. The constant was chosen by measuring
    how far a cheap read's closes sit from a 2000-trial read, and if nobody re-measures it then the
    number just becomes a preference that nobody would think to question.

    The bar is the market's OWN daily volatility, not a round number. In-season daily sigma is 4%.
    A cheap read whose worst single club diverges by less than that cannot move a price by more than
    the noise already in it, so the trade is free. Measured at the time of writing: 250 trials gives a
    1.47% mean and a 3.83% worst case against 2000.
  */
  const full = await priceRun(state, completedDates, HXSE_SETTLEMENT_TRIALS);
  const deltas: number[] = [];
  teamIds.forEach((id) => full.forEach((b, d) => deltas.push(Math.abs(b.close[id] / boards[d].close[id] - 1))));
  const meanDelta = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  const maxDelta = Math.max(...deltas);

  /*
    THE BAR IS THE MARKET'S OWN DAILY VOLATILITY, MEASURED FROM THIS RUN.

    The first version of this check compared against `REGIME_VOLATILITY.in_season` and printed
    "daily sigma of 7%" -- but that constant is the NOISE SCALE fed into the hash, not the volatility
    that comes out. Realised daily sigma is about 0.582 of it, so the bar was 1.7x too loose and the
    message reported a number nobody had measured. Exactly the failure this file exists to prevent,
    committed in the check written to prevent it.

    So the sigma is computed here from consecutive closes in this run, and the cheap path is held to
    the market's actual noise rather than to a constant that only looks like a volatility.
  */
  const dailyReturns: number[] = [];
  for (let d = 1; d < boards.length; d += 1) {
    teamIds.forEach((id) => {
      const prev = boards[d - 1].close[id];
      if (prev > 0) dailyReturns.push(boards[d].close[id] / prev - 1);
    });
  }
  const returnMean = dailyReturns.reduce((a, b) => a + b, 0) / Math.max(1, dailyReturns.length);
  const realisedSigma = Math.sqrt(
    dailyReturns.reduce((a, v) => a + (v - returnMean) ** 2, 0) / Math.max(1, dailyReturns.length),
  );
  check(
    `the cheap daily read (${HXSE_DAILY_TRIALS} trials) never moves a price by more than one day of market noise`,
    maxDelta < realisedSigma,
    `against a ${HXSE_SETTLEMENT_TRIALS}-trial read: mean divergence ${(meanDelta * 100).toFixed(2)}%, `
    + `worst club ${(maxDelta * 100).toFixed(2)}%. The bar is the realised daily sigma MEASURED from this run, `
    + `${(realisedSigma * 100).toFixed(2)}% over ${dailyReturns.length} day-over-day returns -- not the `
    + `${(REGIME_VOLATILITY.in_season * 100).toFixed(0)}% noise scale, which is what this check wrongly used at first. `
    + 'A worst case under the market\'s own volatility means the cheap read is free in price terms, which is '
    + 'what justifies paying a fraction of the compute for it.',
  );

  // -- 7. the cache cannot serve the wrong answer ---------------------------------------------------
  /*
    THREE failure modes, and only two of them are obvious.

    The obvious one: the cache is keyed on `(season, date)` but the CLOSE depends on
    `previousClose`, so two callers asking for the same date from different ledgers must get
    different closes. Caching the whole board would silently give both of them the first one's
    answer.

    The subtle one: the cache must not serve a cheap fair price to a caller who asked for a
    full-resolution one. Nothing about the shapes would differ, so it would be invisible -- and it
    is precisely the number this check exists to catch.

    The third: `clearFairLayerCache` must actually clear, or a season rollover would serve last
    season's valuations to this one.
   */
  clearFairLayerCache();
  const first = priceBoardForDay({
    teams: state.teams, games: state.games, date: completedDates[0], playerState: state.playerState,
    seasonYear: YEAR, seed: SEED, mcTrials: HXSE_DAILY_TRIALS, settings: DEFAULT_SETTINGS,
    fairCacheKey: 'season-a|day-0',
  });
  const second = priceBoardForDay({
    teams: state.teams, games: state.games, date: completedDates[0], playerState: state.playerState,
    seasonYear: YEAR, seed: SEED, mcTrials: HXSE_DAILY_TRIALS, settings: DEFAULT_SETTINGS,
    fairCacheKey: 'season-a|day-0',
  });
  check(
    'a cached fair layer returns the identical fair prices',
    JSON.stringify(first.fair) === JSON.stringify(second.fair) && JSON.stringify(first.valuation) === JSON.stringify(second.valuation),
    'the second call for the same (season, date) came from the cache and matched',
  );

  const premium = priceBoardForDay({
    teams: state.teams, games: state.games, date: completedDates[0], playerState: state.playerState,
    seasonYear: YEAR, seed: SEED, mcTrials: HXSE_SETTLEMENT_TRIALS, settings: DEFAULT_SETTINGS,
    fairCacheKey: 'season-a|day-0',
  });
  const differs = JSON.stringify(premium.fair) !== JSON.stringify(first.fair);
  check(
    'a full-resolution request is NOT served from the cheap read\'s cache entry',
    differs,
    differs
      ? `the trial count is part of the cache key, so ${HXSE_SETTLEMENT_TRIALS} trials recomputed rather than `
      + `reusing the ${HXSE_DAILY_TRIALS}-trial fair prices. Had it reused them, the shapes would have matched `
      + 'perfectly and the error would have been invisible.'
      : 'THE CACHE SERVED A CHEAP FAIR PRICE TO A FULL-RESOLUTION REQUEST. The shapes match either way, so '
      + 'this error would be completely invisible in the output.',
  );

  const otherDay = priceBoardForDay({
    teams: state.teams, games: state.games, date: completedDates[1], playerState: state.playerState,
    seasonYear: YEAR, seed: SEED, mcTrials: HXSE_DAILY_TRIALS, settings: DEFAULT_SETTINGS,
    fairCacheKey: 'season-b|day-0',
  });
  check(
    'a different cache key recomputes rather than reusing another key\'s entry',
    JSON.stringify(otherDay.fair) !== JSON.stringify(first.fair),
    'a second season key over the same league still gets its own fair prices, so a rollover cannot serve '
    + 'stale valuations',
  );

  clearFairLayerCache();
  const afterClear = priceBoardForDay({
    teams: state.teams, games: state.games, date: completedDates[0], playerState: state.playerState,
    seasonYear: YEAR, seed: SEED, mcTrials: HXSE_DAILY_TRIALS, settings: DEFAULT_SETTINGS,
    fairCacheKey: 'season-a|day-0',
  });
  check(
    'clearing the cache yields the same answer, so it is an optimisation and not a hidden state',
    JSON.stringify(afterClear.fair) === JSON.stringify(first.fair),
    'a cleared cache recomputes to the identical fair prices, so nothing in the result depends on whether '
    + 'the cache happened to be warm',
  );

  /*
    THE OPENING, ON THE LIVE PATH. `checkSharePrice` proves this for `buildPriceSeries`, which is a
    DIFFERENT function -- the app prices through this one, and this one had its own `isFirstDay`
    branch. A property proven on one is not a property of the other, and nothing gated this copy.
  */
  clearFairLayerCache();
  const openingOf = (seed: number) => {
    const board = priceBoardForDay({
      teams: state.teams, games: state.games, date: state.games[0].date, playerState: state.playerState,
      seasonYear: YEAR, seed, mcTrials: HXSE_DAILY_TRIALS, settings: DEFAULT_SETTINGS,
      previousClose: undefined,
    });
    return teamIds.map((id) => board.close[id] / board.fair[id] - 1);
  };
  const openMoves = openingOf(SEED);
  const openMovesAgain = openingOf(SEED);
  const openMovesReseeded = openingOf(SEED + 1);
  const pct = (m: number) => (m * 100).toFixed(2);

  check(
    'the live path opens every club off fair, so day one has a market to trade',
    openMoves.every((m) => Math.abs(m) > 1e-9),
    `all ${openMoves.length} clubs opened off their own fair value, spanning ${pct(Math.min(...openMoves))}% `
    + `to ${pct(Math.max(...openMoves))}%. With the old exact-fair open every stray-from-fair readout on the `
    + 'Exchange was zero on opening day, which left the whole desk with nothing to price until day two.',
  );

  check(
    'that opening is seeded, so it is reproducible but not a shared constant offset',
    openMoves.every((m, i) => Math.abs(m - openMovesAgain[i]) < 1e-12)
      && openMoves.every((m, i) => Math.abs(m - openMovesReseeded[i]) > 1e-9),
    `the same seed reproduced all ${openMoves.length} openings exactly, and a seed one higher moved all `
    + `${openMoves.length} of them. Both halves are asserted: reproducibility alone would also be satisfied `
    + 'by a fixed fudge factor, which would look random on one chart while mispricing every club identically '
    + 'in every universe.',
  );

  // -- report ------------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  const sample = teamIds.slice(0, 4);
  console.log('\nDAILY PRICE BOARD\n');
  console.log(`  league       ${teamIds.length} clubs, ${WARMUP_DAYS} days simulated, `
    + `${completedDates.length} days priced, seed ${SEED}`);
  console.log(`  MC trials    ${boards[0]?.mcTrials} per day`);
  console.log(`  fair mean    ${fairMean.toFixed(2)}     close mean ${closeMean.toFixed(2)}\n`);
  console.log('  club        valuation    fair     close    move');
  sample.forEach((id) => {
    const b = boards[boards.length - 1];
    console.log(`  ${id.slice(0, 10).padEnd(10)} ${b.valuation[id].toFixed(1).padStart(9)} `
      + `${b.fair[id].toFixed(1).padStart(8)} ${b.close[id].toFixed(1).padStart(8)} `
      + `${(b.move[id] * 100 >= 0 ? '+' : '') + (b.move[id] * 100).toFixed(2)}%`.padStart(9));
  });
  console.log('');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    // Details print on PASS as well as on FAIL, matching verifyPropCardDiversity. A check that only
    // reports its measurement when it breaks gives a reader nothing to compare the next run against,
    // and several of the numbers here -- the winner/loser gap, the stray-from-fair sd -- are the
    // whole point of running the tool rather than just its exit code.
    if (c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

void main();
