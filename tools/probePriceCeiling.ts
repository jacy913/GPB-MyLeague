/**
 * DOES ANY CLUB EVER GET STUCK AT $1000?
 *
 * ===========================================================================
 * WHY THIS TOOL EXISTS
 * ===========================================================================
 *
 * A player reported that in one of their saves the Phantoms kept on winning while their share price
 * sat at exactly $1000 and stopped moving. That is not a rendering fault. Reading the code, it is
 * structural, and it happens in two steps:
 *
 *   1. `teamValue.ts` returns `50 + clamp(blended, +/-Z_CLAMP) * VALUE_SCALE` with `Z_CLAMP = 3` and
 *      `VALUE_SCALE = 50/3`. So valuation is a z-score SATURATED INTO [0, 100]. A dominant club's
 *      blended z-score reaches +3 and the valuation is 100 -- and stays 100 no matter how much
 *      better the club gets.
 *   2. `fairPriceFor(100)` is exactly `PRICE_MAX`, and `nextPrice` clamps the close into
 *      `[PRICE_MIN, PRICE_MAX]`.
 *
 * So once a club's valuation saturates, its fair value is pinned at the band ceiling, its close is
 * pinned at the band ceiling, and the entire price mechanism for that club -- the mean reversion,
 * the crowd, the game shocks -- becomes INERT. Further wins cost the club nothing and gain it
 * nothing, because there is nowhere left to go.
 *
 * The worst part is that it hits the best club. The valuation is a z-score against the league, so
 * the club most likely to saturate is the one playing best, which is exactly the club whose price
 * a player most wants to read.
 *
 * ===========================================================================
 * WHY `checkSharePrice` DID NOT CATCH IT
 * ===========================================================================
 *
 * Check 9 asserts "no price leaves the declared band across every seed tested" -- and it passes,
 * because `nextPrice` CLAMPS. The clamp is the bug's hiding place: it makes the band assertion
 * unfalsifiable. A check that cannot fail for the thing it is about is worse than no check, and this
 * one was measuring the clamp rather than the market.
 *
 * So this tool does not ask "did any price leave the band". It asks the question a player would
 * ask: HOW LONG IS A PRICE STUCK, AND WHAT IS THE LONGEST STUCK RUN.
 *
 * ===========================================================================
 * WHAT WOULD COUNT AS HEALTHY
 * ===========================================================================
 *
 * A price pinned to the ceiling for many consecutive days is not a market. This reports the longest
 * run of consecutive days any club spent AT the ceiling or the floor, and how many clubs ever got
 * there at all, so the fix can be judged against a number rather than against the current silence.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { priceBoardForDay } from '../src/lib/analytics/priceBoard';
import { PRICE_MAX, PRICE_MIN } from '../src/lib/analytics/sharePrice';
import { seededRandomStream, withSeededRandom, withSeededRandomAsync } from '../src/lib/analytics/playoffMonteCarlo';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const SEEDS = [4242, 991, 20260101, 7, 31337];
const WARMUP_DAYS = 60;
const PRICED_DAYS = 120;
const TRIALS = 250;

/**
 * How close to the edge counts as "stuck".
 *
 * Not 1e-9. The clamp means a saturated club sits at EXACTLY 1000.0, but a club that merely
 * drifts near the top is not broken -- it is trading. The threshold is set at half a percent of the
 * band so the count is about pinning, not about being expensive.
 */
const STUCK_WITHIN = PRICE_MAX * 0.005;

const iso = (offset: number): string =>
  new Date(Date.parse(getDefaultSeasonStartDate(YEAR)) + offset * 86400000).toISOString().slice(0, 10);

interface Run {
  club: string;
  clubName: string;
  edge: 'ceiling' | 'floor';
  from: string;
  to: string;
  days: number;
}

const buildLedger = async (seed: number): Promise<Array<{ date: string; close: Record<string, number> }>> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );

  const schedule = withSeededRandom(seededRandomStream(seed), () =>
    generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }));

  const manager = new SimulationManager({
    teams,
    games: schedule,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let playerState: LeaguePlayerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < WARMUP_DAYS; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams; games = r.games; playerState = r.playerState;
  }

  const rows: Array<{ date: string; close: Record<string, number> }> = [];
  let previous: Record<string, number> | undefined;
  for (let d = 0; d < PRICED_DAYS; d += 1) {
    const board = priceBoardForDay({
      teams, games, date: iso(d), playerState, seasonYear: YEAR,
      seed, previousClose: previous, mcTrials: TRIALS, settings: DEFAULT_SETTINGS,
    });
    previous = board.close;
    rows.push({ date: board.date, close: board.close });
  }
  return rows;
};

const main = async (): Promise<void> => {
  console.log('\nDOES ANY CLUB EVER GET STUCK AT $1000?\n');
  console.log(`  ${SEEDS.length} leagues, warmed ${WARMUP_DAYS} days then priced ${PRICED_DAYS} days`);
  console.log(`  "stuck" means within ${(STUCK_WITHIN).toFixed(1)} of the band edge (${(STUCK_WITHIN / PRICE_MAX * 100).toFixed(2)}%)\n`);

  const allRuns: Run[] = [];
  let everStuck = 0;
  let totalClubs = 0;

  for (const seed of SEEDS) {
    process.stdout.write(`  league ${seed}... `);
    const rows = await withSeededRandomAsync(seededRandomStream(seed * 6151), () => buildLedger(seed));
    const clubIds = Object.keys(rows[0].close);
    totalClubs += clubIds.length;
    let seedRuns = 0;

    for (const club of clubIds) {
      for (const edge of ['ceiling', 'floor'] as const) {
        let runStart: string | null = null;
        for (const day of rows) {
          const close = day.close[club];
          const stuck = edge === 'ceiling'
            ? close >= PRICE_MAX - STUCK_WITHIN
            : close <= PRICE_MIN + STUCK_WITHIN;
          if (stuck && runStart === null) runStart = day.date;
          if (!stuck && runStart !== null) {
            const days = rows.findIndex((d) => d.date === day.date) - rows.findIndex((d) => d.date === runStart);
            allRuns.push({ club, clubName: club, edge, from: runStart, to: day.date, days });
            runStart = null;
            seedRuns += 1;
          }
        }
        if (runStart !== null) {
          allRuns.push({
            club, clubName: club, edge, from: runStart, to: 'end of window', days: rows.length,
          });
          seedRuns += 1;
        }
      }
    }
    if (seedRuns > 0) everStuck += 1;
    console.log(seedRuns > 0 ? `${seedRuns} stuck run(s)` : 'clean');
  }

  const ceilingRuns = allRuns.filter((r) => r.edge === 'ceiling');
  const floorRuns = allRuns.filter((r) => r.edge === 'floor');
  const longest = allRuns.slice().sort((a, b) => b.days - a.days);

  console.log(`\n  leagues with at least one stuck price: ${everStuck}/${SEEDS.length}`);
  console.log(`  club-seasons priced: ${totalClubs}`);
  console.log(`  runs at the CEILING: ${ceilingRuns.length}, at the FLOOR: ${floorRuns.length}`);

  if (longest.length === 0) {
    console.log('\n  NO CLUB PINNED AT EITHER EDGE in any league. The ceiling is not reachable in practice.\n');
    return;
  }

  console.log('\n  TEN LONGEST STUCK RUNS\n');
  console.log('   days  edge     club    from           to');
  for (const r of longest.slice(0, 10)) {
    console.log(`   ${String(r.days).padStart(4)}  ${r.edge.padEnd(8)} ${r.club.padEnd(7)} ${r.from}   ${r.to}`);
  }

  const over10 = allRuns.filter((r) => r.days >= 10).length;
  const maxRun = longest[0].days;
  console.log(`\n  LONGEST PIN: ${maxRun} consecutive days. Runs of 10+ days: ${over10}.`);
  console.log(`  ${maxRun >= 10
    ? 'A price that cannot move for ten days is not a market. The band ceiling is a HARD WALL the'
    : 'Pinning exists but is short-lived. Worth reporting; not yet a broken mechanism.'}`);
  if (maxRun >= 10) {
    console.log('  best club in the league, so the mechanism dies precisely where it matters most.');
  }
  console.log('');
};

void main();