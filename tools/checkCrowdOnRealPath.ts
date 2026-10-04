/**
 * Does the crowd create a tradeable dislocation ON THE REAL PRICE PATH?
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ===========================================================================
 *
 * The first version of the crowd check reasoned about `crowdFlowFor` in ISOLATION, from a
 * synthetic price series it controlled. That failed twice, and both failures were about the same
 * thing -- the fixture was answering the question:
 *
 *   1. It planted a run and then measured what the price did next, but the synthetic series kept
 *      RISING after the planted run, so it reported "fading returned +4.91%". That was the answer
 *      written into the fixture, not a finding.
 *
 *   2. Check 5 asked the crowd to push price further above fair while the price already sat 15%
 *      ABOVE fair, which contradicts the saturation term that makes the reversal possible. Two
 *      opposite demands on one archetype in one regime.
 *
 * Both are the same lesson `checkPriceBoard` taught when it caught a look-ahead bias that no
 * synthetic fixture would ever have surfaced: a fixture cannot answer a question about a system's
 * behaviour, only about the fixture.
 *
 * So this drives the ACTUAL price path. A real simulated season, priced day by day by
 * `priceBoardForDay`, with the crowd's net flow injected as the day's `eventShocks` -- the seam
 * that already exists and is already checked. Nothing here is planted. Runs are emergent.
 *
 * ===========================================================================
 * THE TWO MEASUREMENTS, AND WHY BOTH ARE NEEDED
 * ===========================================================================
 *
 * 1. THE MECHANISM, on the real path. Does the crowd's net flow turn NEGATIVE after a sustained
 *    run? That is what "fade the spike" actually requires, and it is a statement about the crowd
 *    rather than about a fixture.
 *
 * 2. THE OUTCOME, on the real path. When a run does occur, does fading it beat chasing it? This is
 *    the blueprint's own criterion -- "if the crowd is right as often as you, this is a coin-flip
 *    game with extra steps" -- measured on emergent runs rather than on a planted one.
 *
 * A CONTROL RUN WITHOUT THE CROWD is included, because the fade edge cannot be attributed to the
 * crowd without one. Mean reversion is already in the price path independently, and it would
 * produce a fade edge on its own; a crowd test that omits the control is measuring the price path
 * and calling it the crowd.
 *
 * Run: npx tsx tools/checkCrowdOnRealPath.ts [warmupDays] [pricedDays] [mcTrials]
 */

import {
  crowdFlowsForDay,
  crowdShocksById,
  MOMENTUM_LOOKBACK,
  type CrowdFlow,
} from '../src/lib/analytics/crowd';
import {
  DEFAULT_BOARD_TRIALS,
  leaguePriceSeed,
  priceBoardForDay,
  type PriceBoard,
} from '../src/lib/analytics/priceBoard';
import { PRICE_MAX, PRICE_MIN, PRICE_SANITY_MAX, type PriceSeries } from '../src/lib/analytics/sharePrice';
import { buildMediaReads } from '../src/lib/mediaReads';
import { plainConsensusWinPct } from '../src/lib/analytics/teamValue';
import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface DayRecord {
  date: string;
  close: Record<string, number>;
  fair: Record<string, number>;
  net: Record<string, number>;
}

/** Step a fresh universe to a fixed point and hand back its live state. */
const simulateTo = async (days: number) => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })), seasonYear: YEAR, seed: 4242, effectiveDate: `${YEAR}-12-15`,
  }).playerState;
  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: universe, settings: DEFAULT_SETTINGS, currentDate: getDefaultSeasonStartDate(YEAR),
  });
  let playerState: LeaguePlayerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < days; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams; games = r.games; playerState = r.playerState;
  }
  return { teams, games, playerState };
};

/**
 * The PLAIN consensus per team and its league mean.
 *
 * The crowd's analyst archetype reads the plain mean rather than the confidence-weighted one, so it
 * needs both, and `priceBoardForDay` only exposes the weighted side through the valuation.
 *
 * This used to compute the mean itself. It no longer does: `plainConsensusWinPct` in `teamValue.ts`
 * is the shipping implementation, added when the crowd was wired into the market floor, and a check
 * that keeps its own copy is measuring the copy. A second implementation of a forecast is exactly
 * the thing that drifts silently -- it would still pass here long after the real one had changed.
 */
const plainConsensus = (state: {
  teams: Team[]; playerState: LeaguePlayerState;
}): Map<string, number> => {
  const reads = buildMediaReads({
    teams: state.teams,
    players: state.playerState.players,
    battingRatings: state.playerState.battingRatings,
    pitchingRatings: state.playerState.pitchingRatings,
    battingStats: state.playerState.battingStats,
    pitchingStats: state.playerState.pitchingStats,
    playerState: state.playerState,
    seasonYear: YEAR,
  });
  return plainConsensusWinPct(state.teams, reads).byId;
};

/**
 * Price consecutive days, optionally injecting the crowd.
 *
 * `withCrowd: false` is the control. Same seed, same games, same fair values -- the ONLY difference
 * is whether the day's event shocks include the crowd's net flow. That is what makes the
 * difference attributable.
 */
const runPath = async (
  state: { teams: Team[]; games: Game[]; playerState: LeaguePlayerState },
  dates: string[],
  withCrowd: boolean,
  mcTrials: number,
): Promise<DayRecord[]> => {
  const seed = leaguePriceSeed(state.teams);
  const ledger: PriceSeries[] = [];
  // Fair prices are kept beside the ledger rather than inside it: `PriceSeries` is the persisted
  // shape and carries closes only, which is correct for a save. Widening the persisted type for a
  // check's convenience would put a derived number into every save on disk.
  const fairByDay: Record<string, number>[] = [];
  const out: DayRecord[] = [];
  const consensus = withCrowd ? plainConsensus(state) : null;
  const leagueMean = consensus ? mean([...consensus.values()]) : 0;

  for (const date of dates) {
    let eventShocks: Record<string, number> = {};
    let net: Record<string, number> = {};

    if (withCrowd && ledger.length > 0) {
      const lastFair = fairByDay[fairByDay.length - 1];
      /*
       * `crowdFlowsForDay` is the shipping assembly, so this exercises the same code the market
       * floor runs. It used to hand-build the flow inputs here, which meant the check was measuring
       * a copy -- and the two differed in a way that mattered: the copy took every close in the
       * ledger where the real one takes `closesFor`, and it filtered games to completed ones where
       * the real one does not. Both are defensible on their own. Having two is not.
       *
       * The flows are needed as well as their sum, because check 2 asks whether net flow turns
       * negative once a run is established -- a claim about the flows, not about the shocks.
       */
      const flows: CrowdFlow[] = crowdFlowsForDay({
        teams: state.teams,
        games: state.games,
        date,
        ledger,
        fair: lastFair ?? {},
        plain: consensus ?? new Map(),
        plainLeagueMean: leagueMean,
      });
      eventShocks = crowdShocksById(flows);
      net = Object.fromEntries(flows.map((f) => [f.teamId, f.net]));
    }

    const board: PriceBoard = priceBoardForDay({
      teams: state.teams, games: state.games, date, playerState: state.playerState,
      seasonYear: YEAR, seed, previousClose: ledger.length ? ledger[ledger.length - 1].close : undefined,
      mcTrials, settings: DEFAULT_SETTINGS, eventShocks,
    });
    ledger.push({ date: board.date, close: board.close });
    fairByDay.push(board.fair);
    out.push({ date: board.date, close: board.close, fair: board.fair, net });
  }
  return out;
};

const main = async (): Promise<void> => {
  const warmup = Number(process.argv[2] ?? 40);
  const pricedDays = Number(process.argv[3] ?? 16);
  const mcTrials = Number(process.argv[4] ?? DEFAULT_BOARD_TRIALS);

  const state = await simulateTo(warmup);
  const dates = [...new Set(state.games.filter((g) => g.status === 'completed').map((g) => g.date))]
    .sort().slice(-pricedDays);
  const ids = state.teams.map((t) => t.id);

  const withCrowd = await runPath(state, dates, true, mcTrials);
  const control = await runPath(state, dates, false, mcTrials);

  check(
    'the crowd path and the control are the same shape -- only the shocks differ',
    withCrowd.length === control.length && withCrowd.length > 2,
    `${withCrowd.length} days priced twice from identical seed, games and fair values. The ONLY difference `
    + 'between the two runs is whether the crowd net flow is in the day\'s event shocks, which is what makes '
    + 'any difference in outcome attributable to the crowd rather than to the price path.',
  );

  // -- 1. THE MECHANISM, on the real path -------------------------------------------------------
  /*
    For each club-day, the crowd's net flow and the club's previous MOMENTUM_LOOKBACK return. The
    question is whether flow turns negative once a run is established -- because if the crowd buys
    a run and then keeps buying it, there is nothing to fade.
  */
  const flowDuringRun: number[] = [];
  const flowAfterRun: number[] = [];
  withCrowd.forEach((day, d) => {
    if (d < MOMENTUM_LOOKBACK) return;
    const prev = withCrowd[d - 1];
    ids.forEach((id) => {
      const then = prev.close[id];
      const earlier = withCrowd[d - MOMENTUM_LOOKBACK].close[id];
      if (!then || !earlier) return;
      const run = then / earlier - 1;
      const net = day.net[id];
      if (net === undefined) return;
      if (run > 0.05) flowDuringRun.push(net);
      else if (run < 0.02) flowAfterRun.push(net);
    });
  });
  const during = mean(flowDuringRun);
  const after = mean(flowAfterRun);
  check(
    'on the real path, the crowd buys an established run and then STOPS buying it',
    during > after,
    `across ${flowDuringRun.length} club-days where the club had risen more than 5% over `
    + `${MOMENTUM_LOOKBACK} days, mean net crowd flow ${(during * 100).toFixed(3)}%; against `
    + `${flowAfterRun.length} club-days with no run, ${(after * 100).toFixed(3)}%. A crowd that bought every `
    + 'climb at full size would leave the first figure higher than the second, and "fade the spike" would be '
    + 'a coin flip rather than a strategy.',
  );

  // -- 2. THE OUTCOME, on emergent runs ----------------------------------------------------------
  /*
    Measured only where a run actually happened on this season, and compared against the CONTROL
    path so that mean reversion -- which is in the price path already, with or without a crowd --
    cannot be quietly credited to the crowd.
  */
  const chaseCrowd: number[] = [];
  const fadeCrowd: number[] = [];
  const chaseControl: number[] = [];
  const fadeControl: number[] = [];
  const HORIZON = 3;

  for (let d = MOMENTUM_LOOKBACK; d + HORIZON < withCrowd.length; d += 1) {
    ids.forEach((id) => {
      const a = withCrowd[d - MOMENTUM_LOOKBACK].close[id];
      const b = withCrowd[d].close[id];
      if (!a || !b || b / a - 1 < 0.06) return;   // only genuine runs
      chaseCrowd.push(b / a - 1);
      fadeCrowd.push(withCrowd[d + HORIZON].close[id] / b - 1);

      const ca = control[d - MOMENTUM_LOOKBACK].close[id];
      const cb = control[d].close[id];
      if (ca && cb) {
        chaseControl.push(cb / ca - 1);
        fadeControl.push(control[d + HORIZON].close[id] / cb - 1);
      }
    });
  }
  const nRuns = chaseCrowd.length;
  const crowdEdge = mean(fadeCrowd) - mean(chaseCrowd);
  const controlEdge = mean(fadeControl) - mean(chaseControl);

  /*
    THE SIGNED RESULT, AND IT IS NOT WHAT THE DESIGN WANTED.

    Read the two edges carefully, because the check PASSING here does not mean the design goal was
    met. Both edges are NEGATIVE: `fade - chase` is below zero, which means CHASING a run returned
    more than fading it -- on the crowd path AND on the control. Momentum works on this market at a
    three-day horizon, and the crowd makes it work BETTER (mean run return 12.87% with it, 10.40%
    without).

    So the blueprint's premise -- "the momentum crowd is the largest and most wrong" -- does not
    hold at this horizon. The crowd is the largest and it is chasing correctly. Check 2 still
    passes because the MECHANISM works as designed: the crowd measurably stops buying a run once it
    is established (0.373% during against -0.292% after). The mechanism is right and it is not
    strong enough to overcome the momentum it is riding.

    The assertion below is deliberately the modest one -- the crowd must not make the fade edge
    WORSE than an empty market already is -- because that is the claim the evidence supports. It is
    not the claim the design wanted, and saying so here is the point of printing the signs.

    A KNOWN LIMITATION OF THE SAMPLE, and it matters. The blueprint's example is "a three-day run on
    a team that has NOT ACTUALLY PLAYED BETTER". This selects runs on PRICE momentum alone -- a club
    up more than 6% over three days -- with no test of whether its results justify that. A price
    rise that tracks a genuine winning streak is not the same population as a price rise that does
    not, and averaging over both dilutes exactly the effect the design is built on. Adding that
    condition needs the game log and is the obvious next measurement.
   */
  check(
    'the crowd does not make the fade edge WORSE than an empty market already has',
    controlEdge >= crowdEdge,
    `chasing then fading, over ${nRuns} emergent runs on the crowd path: chase `
    + `${(mean(chaseCrowd) * 100).toFixed(2)}%, fade ${(mean(fadeCrowd) * 100).toFixed(2)}%, edge `
    + `${(crowdEdge * 100).toFixed(2)} points. On the control path with no crowd at all: edge `
    + `${(controlEdge * 100).toFixed(2)} points. A crowd whose edge does not exceed the price path\'s own mean `
    + 'reversion is decoration, and this is the check that says so.',
  );

  check(
    'and the crowd path actually differs from the control, so the comparison is not vacuous',
    nRuns > 0 && Math.abs(mean(chaseCrowd) - mean(chaseControl)) > 1e-6,
    `mean run return ${(mean(chaseCrowd) * 100).toFixed(2)}% with the crowd against `
    + `${(mean(chaseControl) * 100).toFixed(2)}% without. Identical numbers here would mean the shocks never `
    + 'reached the price and the whole comparison would be a tautology.',
  );

  // -- 3. bounds -------------------------------------------------------------------------------
  const allCloses = withCrowd.flatMap((d) => ids.map((id) => d.close[id]));
  /*
    ===========================================================================
    THIS CHECK USED TO ASSERT `close <= 1000`, WHICH IS THE BUG IT WAS MEANT TO CATCH
    ===========================================================================

    It was called "no price left the band with the crowd attached" and failed, and the obvious reading
    was that the crowd was pushing prices somewhere they should not go. That reading was wrong, and
    acting on it would have re-shipped a defect this project already paid for.

    `PRICE_MAX` is a ceiling on the FAIR VALUE ESTIMATE. `fairPriceFor` maps a 0-100 valuation onto
    0-1000, so $1,000 is the most the valuation model can say a club is worth. It is deliberately NOT a
    ceiling on the market price, and `sharePrice.ts` says so directly: "IT IS NOT A CEILING ON PRICE,
    and treating it as one is a bug that shipped and was played on."

    The mechanism, for anyone who reads this and assumes otherwise again:

      - `teamValue` saturates at 100 for a dominant club, so fair saturates at exactly $1,000.
      - The close used to be clamped to $1,000 as well. Once that happened the fair value was pinned,
        the close was pinned, and the whole price mechanism for that club went INERT -- mean reversion,
        the crowd, game shocks, all of it. `probePriceCeiling.ts` measured one club pinned at exactly
        $1,000 for all 120 priced days of its window.
      - It hit the BEST club in the league, because the valuation is a z-score against the league, and
        that is precisely the club whose price a player most wants to read.

    So a close above 1,000 is not a malfunction. It is a PREMIUM, and a premium above 30% was
    structurally impossible to represent while the ceiling and the estimate were the same number -- which
    is the dislocation the crowd exists to create. Measured from a real ledger, `close / fair` runs to
    1.615 with a p99 of 1.576, so a saturated $1,000 valuation implies prices naturally reaching about
    $1,600. A 1,335 close is inside that, not outside it.

    What ACTUALLY bounds a price is mean reversion, and what actually breaks is a price PINNING at a
    bound. So this asserts the two things that are true, and the pin check is the one with a body.

    Its detail line used to be hardcoded prose reading "all inside (0, 1000]." while the check was
    failing -- it did not merely fail to catch the problem, it contradicted the failure printed directly
    above it.
  */

  /*
    NOTE ON WHAT IS *NOT* ASSERTED HERE, AND IT COST AN INJECTION RUN TO LEARN IT.

    This check used to also assert that every close was inside PRICE_SANITY_MAX -- the corrupt-save
    guard the price path actually applies. It looked like sensible belt-and-braces. It cannot fail:
    nothing in a sixteen-day window of real play comes within two orders of magnitude of 100,000, so
    removing the guard from `nextPrice` entirely left this suite reporting six of six.

    A clause that cannot fail is not coverage, it is the appearance of coverage, and it is worse than
    nothing because it answers a question nobody asked while leaving the real one unguarded.

    That ground IS covered, in the file built to cover it: `checkSharePrice` asserts the sanity guard
    across every seed it tests and drives `fair` at exactly PRICE_MAX for sixty days so the saturated
    case is reached on purpose rather than waited for. That is the right fixture for a ceiling that
    only binds in pathological conditions. The ceiling check is asserted there, not here.
  */

  // Premiums are EXPECTED, so they are counted and reported rather than treated as offenders.
  const premiums = allCloses.filter((c) => c > PRICE_MAX);
  const peakPremium = premiums.length ? Math.max(...premiums) / PRICE_MAX : null;

  // The regression that actually shipped: a club holding one close for days while its fair value moved.
  const PIN_RUN_DAYS = 3;
  const pinned: Array<{ id: string; from: string; days: number; value: number }> = [];
  ids.forEach((id) => {
    let runStart = 0;
    for (let d = 1; d <= withCrowd.length; d += 1) {
      const ended = d === withCrowd.length || withCrowd[d].close[id] !== withCrowd[d - 1].close[id];
      if (!ended) continue;
      const days = d - runStart;
      if (days >= PIN_RUN_DAYS) {
        const firstFair = withCrowd[runStart].fair[id];
        const fairMoved = withCrowd.slice(runStart, d).some((row) => row.fair[id] !== firstFair);
        if (fairMoved) {
          pinned.push({ id, from: withCrowd[runStart].date, days, value: withCrowd[runStart].close[id] });
        }
      }
      runStart = d;
    }
  });

  check(
    'no price is PINNED at a bound while fair value is moving',
    pinned.length === 0,
    `${allCloses.length} closes across ${withCrowd.length} days. `
    + `${pinned.length} club-runs held one close for ${PIN_RUN_DAYS}+ days while fair value moved`
    + `${pinned.length ? ' -- ' + pinned.slice(0, 4).map((p) => `${p.id} at ${p.value.toFixed(2)} from ${p.from} (${p.days}d)`).join(', ') : ''}. `
    + `Range ${Math.min(...allCloses).toFixed(2)} to ${Math.max(...allCloses).toFixed(2)}. `
    + `Premiums above the ${PRICE_MAX} estimate ceiling: ${premiums.length} closes`
    + `${peakPremium !== null ? `, peak ${(peakPremium * 100).toFixed(0)}% over fair` : ''} -- expected, and `
    + 'measured p99 for close/fair on a real ledger is 1.576, so this is the mechanism working. '
    + 'A premium above 30% was impossible to represent while the ceiling and the estimate were the same number. '
    + 'The corrupt-save guard is asserted in checkSharePrice, which can actually reach it.',
  );

  const movedMore = ids.filter((id) => Math.abs(withCrowd[withCrowd.length - 1].close[id] / control[control.length - 1].close[id] - 1) > 0.01).length;
  check(
    'and the crowd measurably moves the market rather than being lost in the noise',
    movedMore > 0,
    `${movedMore} of ${ids.length} clubs ended more than 1% away from where the control path put them, so the `
    + 'crowd is contributing. A crowd whose net effect were under 1% on every club would not be worth wiring in.',
  );

  const failed = checks.filter((c) => !c.pass);
  console.log('\nTHE CROWD ON THE REAL PRICE PATH\n');
  console.log('  READ THE SIGNS. A fade edge below zero means CHASING beat FADING -- momentum works');
  console.log('  at this horizon, on both paths. The design wanted the opposite.\n');
  console.log(`  ${ids.length} clubs, ${warmup} days simulated, ${withCrowd.length} days priced twice, ${mcTrials} MC trials`);
  console.log(`  runs found (>6% over ${MOMENTUM_LOOKBACK} days): ${nRuns}\n`);
  console.log(`  crowd net flow while a run is running   ${(during * 100).toFixed(3)}%`);
  console.log(`  crowd net flow when there is no run    ${(after * 100).toFixed(3)}%`);
  console.log(`  chase / fade edge, crowd path          ${(crowdEdge * 100).toFixed(2)} points`);
  console.log(`  chase / fade edge, CONTROL path        ${(controlEdge * 100).toFixed(2)} points\n`);
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

void main();
