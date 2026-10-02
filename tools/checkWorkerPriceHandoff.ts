/**
 * Does the worker CONTINUE the market, or restart it?
 *
 * ============================================================================
 * THE DEFECT THIS GUARDS
 * ============================================================================
 *
 * `SimulationWorkerSnapshot` carried `priceLedger` OUT of the worker, and `SimulationWorkerStartPayload`
 * did not carry it IN. The worker seeded `working.priceLedger` from `[]`. Those agree on the first run
 * of a league and disagree on every run after it, because the price path is sequential: each day's
 * close is yesterday's close plus drift, shock and noise.
 *
 * With no previous close, `priceBoardForDay` opens every club at exactly fair value with a move of
 * 0.000%. So the visible consequence was that every "simulate forward" reopened the whole market at
 * fair -- a club that had climbed to 900 printed 500 on the first day of the next run, putting a
 * cliff in the share-price chart that no game produced. Momentum and mean reversion also restarted
 * from nothing each run, so the crowd had no history to read on day one.
 *
 * Note the comment directly above the seed argued that the ledger must be sequential, and then seeded
 * it in a way that broke exactly that. The reasoning was right and the code did the opposite.
 *
 * ============================================================================
 * WHY TWO KINDS OF CHECK
 * ============================================================================
 *
 * 1. SOURCE checks. `simulationWorker.ts` binds `self` as a worker scope at module scope, so it cannot
 *    be imported outside a worker and no behavioural test can reach the line that was wrong. A source
 *    assertion is therefore the only thing that CAN fail for this defect, which is the condition for
 *    a source check to be worth more than nothing.
 *
 * 2. A BEHAVIOURAL check of the mechanism the wiring relies on, plus a teeth check: the continuity
 *    comparison is run both correct and deliberately broken, and the check FAILS if the two agree.
 *    A comparison that cannot distinguish right from wrong is not evidence.
 *
 * Run: npx tsx tools/checkWorkerPriceHandoff.ts [warmupDays] [daysPerRun] [mcTrials]
 */

import {
  appendPriceDay, latestClose, leaguePriceSeed, priceBoardForDay,
} from '../src/lib/analytics/priceBoard';
import type { PriceSeries } from '../src/lib/analytics/sharePrice';
import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import type { Game, LeaguePlayerState, Team } from '../src/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const YEAR = 2026;

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const simulateTo = async (days: number) => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR, seed: 4242, effectiveDate: `${YEAR}-12-15`,
  }).playerState;
  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe, YEAR,
  );
  const start = getDefaultSeasonStartDate(YEAR);
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: start, seasonDays: 180 }),
    playerState: universe, settings: DEFAULT_SETTINGS, currentDate: start,
  });
  let playerState: LeaguePlayerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < days; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams; games = r.games; playerState = r.playerState;
  }
  return { teams, games, playerState };
};

const workerSource = (): string => readFileSync(
  resolve(process.cwd(), 'src/workers/simulationWorker.ts'), 'utf8',
);
const typesSource = (): string => readFileSync(
  resolve(process.cwd(), 'src/workers/simulationWorkerTypes.ts'), 'utf8',
);

const main = async (): Promise<void> => {
  const warmup = Number(process.argv[2] ?? 40);
  const daysPerRun = Number(process.argv[3] ?? 5);
  const mcTrials = Number(process.argv[4] ?? 200);

  // -- 1. SOURCE: the seed comes from the payload, not from an empty array --------------------
  const src = workerSource();
  const seedLine = src.split('\n').find((l) => /^\s*priceLedger:\s/.test(l)
    && !/working\.priceLedger|snapshot\.priceLedger/.test(l));
  check(
    'the worker seeds its price ledger from the run payload, not from an empty array',
    !!seedLine && /startPayload\.priceLedger/.test(seedLine),
    seedLine
      ? `Found \`${seedLine.trim()}\`. The worker used to hardcode \`[]\`, which is identical to this on a league's `
        + 'first run and wrong on every run after it: no previous close means every club reopens at exactly fair '
        + 'value, so each advance printed a cliff in the share price that no game produced.'
      : 'No `priceLedger:` initialiser found in the worker\'s working state.',
  );

  check(
    'the start payload actually carries the ledger, so the seed has something to read',
    /priceLedger\?:\s*PriceSeries\[\]/.test(typesSource()),
    '`SimulationWorkerStartPayload` must declare `priceLedger`. Without it the worker cannot continue a market '
    + 'even if it wanted to, and the seed above would be reading a field that does not exist.',
  );

  check(
    'the snapshot carries the last board back out, so a stepped day can price through the crowd',
    /priceBoard\?:\s*PriceBoard\s*\|\s*null/.test(typesSource()) && /priceBoard:\s*lastBoard/.test(src),
    'The closes alone cannot rebuild a fair price, so the worker returns the board it ended on and the caller '
    + 'replaces its own. Returning closes without the board would leave the next stepped day with no fair values '
    + 'to read and no crowd at all.',
  );

  // -- 2. BEHAVIOURAL: the mechanism the wiring depends on ---------------------------------------
  const state = await simulateTo(warmup);
  const dates = [...new Set(state.games
    .filter((g) => g.status === 'completed').map((g) => g.date))].sort();
  const ids = state.teams.map((t) => t.id);
  const seed = leaguePriceSeed(state.teams);
  const date = dates[10];

  const base = {
    teams: state.teams, games: state.games, date, playerState: state.playerState,
    seasonYear: YEAR, seed, mcTrials, settings: DEFAULT_SETTINGS,
  };
  const openFair = priceBoardForDay({ ...base, previousClose: undefined });
  const threaded = priceBoardForDay({
    ...base,
    previousClose: Object.fromEntries(state.teams.map((t) => [t.id, 1000])),
  });

  check(
    'an unthreaded day opens every club at exactly fair value with a 0.000% move',
    ids.every((id) => Math.abs(openFair.close[id] - openFair.fair[id]) < 1e-9
      && Math.abs(openFair.move[id]) < 1e-12),
    `across ${ids.length} clubs the close equals the fair price to within 1e-9 and the reported move is zero. This is `
    + 'the documented meaning of a missing previous close, and it is what made a restarted run visibly wrong.',
  );

  check(
    'and a threaded previous close actually moves the price, so threading is worth doing',
    ids.some((id) => Math.abs(threaded.close[id] - openFair.close[id]) > 1),
    `with every previous close set to 1000 the closes move materially (${ids[0]}: `
    + `${openFair.close[ids[0]].toFixed(1)} -> ${threaded.close[ids[0]].toFixed(1)}). Deterministic and responsive, which is `
    + 'what makes the source checks above worth anything.',
  );

  // -- 3. TEETH: continuity, and proof the comparison can tell right from wrong -------------------
  const price = (ledger: PriceSeries[], d: string) => priceBoardForDay({
    teams: state.teams, games: state.games, date: d, playerState: state.playerState,
    seasonYear: YEAR, seed, previousClose: latestClose(ledger),
    mcTrials, settings: DEFAULT_SETTINGS,
  });

  /*
    THREE PATHS, and the middle one is the whole point.

    An earlier version of this file compared a threaded run against a restarted one and asserted
    they were identical. They are not, and they are not supposed to be -- that comparison was
    asserting the defect away. The pair that must match exactly is:

      CONTINUOUS  one ledger threaded across every day
      CARRIED     the same days as SEPARATE runs, each handed the previous run's ledger

    CARRIED is the worker's actual contract: a run receives a `PriceSeries[]` and must resume from
    it. If resuming is equivalent to never stopping, the handoff is correct. RESTARTED is the old
    behaviour and exists only to prove the comparison can tell the two apart.
  */
  const runContinuous = (datesToPrice: string[]): Record<string, number>[] => {
    const out: Record<string, number>[] = [];
    let ledger: PriceSeries[] = [];
    datesToPrice.forEach((d) => {
      const b = price(ledger, d);
      out.push({ ...b.close });
      ledger = appendPriceDay(ledger, b);
    });
    return out;
  };

  const runChunked = (datesToPrice: string[], carryAcrossChunks: boolean): Record<string, number>[] => {
    const out: Record<string, number>[] = [];
    let ledger: PriceSeries[] = [];
    datesToPrice.forEach((d, i) => {
      const atChunkStart = i > 0 && i % daysPerRun === 0;
      if (atChunkStart && !carryAcrossChunks) ledger = [];
      const b = price(ledger, d);
      out.push({ ...b.close });
      ledger = appendPriceDay(ledger, b);
    });
    return out;
  };

  const window = dates.slice(0, daysPerRun * 2);
  const continuous = runContinuous(window);
  const carried = runChunked(window, true);
  const restarted = runChunked(window, false);

  check(
    'the two paths agree on day one, so the comparison below is comparing the same thing',
    ids.every((id) => Math.abs(continuous[0][id] - restarted[0][id]) < 1e-9),
    'Both open at fair, so any later disagreement is the handoff and nothing else. Without this, a comparison that '
    + 'differed from the first day could be blamed on misaligned dates rather than on the defect.',
  );

  const boundary = daysPerRun;
  const carryGap = Math.max(...ids.map((id) => Math.abs(
    carried[boundary][id] / continuous[boundary][id] - 1,
  )));
  check(
    'a run boundary does NOT reopen the market: handing the ledger to a fresh run reproduces one long run',
    carryGap < 1e-9,
    `day ${boundary + 1} of ${window.length} -- the first day of the second run. Largest gap between two carried `
    + `runs and one continuous run: ${(carryGap * 100).toFixed(3)}%. Exact agreement is required because the `
    + 'pricing is deterministic, so any real difference is a real defect rather than noise.',
  );

  const restartGap = Math.max(...ids.map((id) => Math.abs(
    restarted[boundary][id] / continuous[boundary][id] - 1,
  )));
  check(
    'and the comparison HAS TEETH: dropping the ledger really does change the answer',
    restartGap > 0.01,
    `Same dates, same seed, same fair values, differing only in whether the ledger is carried across the boundary. `
    + `Dropping it moves the first day of the second run by up to ${(restartGap * 100).toFixed(1)}%, so the check `
    + 'above can genuinely fail. A continuity check that passes for both a correct and a broken handoff is not '
    + 'evidence of anything.',
  );

  const failed = checks.filter((c) => !c.pass);
  console.log('\nWORKER PRICE HANDOFF\n');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

void main();