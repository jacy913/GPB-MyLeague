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
import { PRICE_MAX, PRICE_SANITY_MAX } from '../src/lib/analytics/sharePrice';
import { seededRandomStream, withSeededRandom, withSeededRandomAsync } from '../src/lib/analytics/playoffMonteCarlo';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const SEEDS = [4242, 991, 20260101, 7, 31337];
const WARMUP_DAYS = 60;
const PRICED_DAYS = 120;
const TRIALS = 250;

/**
 * "STUCK" NO LONGER MEANS "AT $1,000", AND THE OLD DEFINITION WAS MEASURING THE WRONG THING.
 *
 * The first version counted a run as stuck when a close sat within half a percent of `PRICE_MAX`.
 * That was the right question while `PRICE_MAX` was also a clamp on the close, because reaching it
 * meant the price COULD NOT go higher.
 *
 * After the wall came down it became nonsense: a club sitting at exactly $1,000 is now simply trading
 * at its maximum possible fair value, which is a legitimate state that a dominant club reaches
 * routinely. Worse, the metric would have gone GREEN while the original defect persisted, because a
 * frozen price is free to be frozen at any level and $1,000 happened to be the old wall. Moving the
 * threshold from 1000 to 100,000 would have hidden the bug rather than fixed it.
 *
 * So this now measures the DEFECT rather than a proxy for it, in two ways that do not depend on any
 * particular constant:
 *
 *   1. A RUN AT THE SANITY CEILING. `PRICE_SANITY_MAX` is a corruption guard and must never bind in
 *      normal play. Any run here is a real wall.
 *   2. A RUN OF BYTE-IDENTICAL CONSECUTIVE CLOSES. This is the honest definition of "the price cannot
 *      move": whatever the level, a price that returns the exact same number on consecutive days is
 *      frozen. It catches a freeze at any value, which the old threshold could not.
 */

const iso = (offset: number): string =>
  new Date(Date.parse(getDefaultSeasonStartDate(YEAR)) + offset * 86400000).toISOString().slice(0, 10);

/** One day of the ledger, with the recorded fair layer kept so saturation can be detected. */
interface Day {
  date: string;
  close: Record<string, number>;
  fair: Record<string, number>;
}

/** A run of consecutive days a price failed to move, or sat on a ceiling. */
interface Run {
  club: string;
  kind: 'identical' | 'sanity_ceiling';
  from: string;
  to: string;
  days: number;
  level: number;
}

const buildLedger = async (seed: number): Promise<Day[]> => {
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

  const rows: Day[] = [];
  let previous: Record<string, number> | undefined;
  for (let d = 0; d < PRICED_DAYS; d += 1) {
    const board = priceBoardForDay({
      teams, games, date: iso(d), playerState, seasonYear: YEAR,
      seed, previousClose: previous, mcTrials: TRIALS, settings: DEFAULT_SETTINGS,
    });
    previous = board.close;
    rows.push({ date: board.date, close: board.close, fair: board.fair });
  }
  return rows;
};

const main = async (): Promise<void> => {
  console.log('\nDOES ANY PRICE EVER FREEZE?\n');
  console.log(`  ${SEEDS.length} leagues, warmed ${WARMUP_DAYS} days then priced ${PRICED_DAYS} days`);
  console.log('  "frozen" = byte-identical closes on consecutive days, at any level');
  console.log(`  "wall"    = a close pinned to the sanity guard (${PRICE_SANITY_MAX})\n`);

  const frozenRuns: Run[] = [];
  const wallRuns: Run[] = [];
  let everFrozen = 0;
  let totalClubs = 0;
  let highestClose = 0;
  let highestCloseClub = '';
  let highestFair = 0;
  let highestRatio = 0;
  let highestRatioClub = '';
  let saturatedClubDays = 0;
  let saturatedClubDaysMoving = 0;

  for (const seed of SEEDS) {
    process.stdout.write(`  league ${seed}... `);
    const rows = await withSeededRandomAsync(seededRandomStream(seed * 6151), () => buildLedger(seed));
    const clubIds = Object.keys(rows[0].close);
    totalClubs += clubIds.length;
    let seedRuns = 0;

    for (const club of clubIds) {
      const closes = rows.map((d) => d.close[club]).filter((v): v is number => typeof v === 'number');

      const top = closes.reduce((best, v, i) => (v > closes[best] ? i : best), 0);
      if (closes[top] > highestClose) { highestClose = closes[top]; highestCloseClub = club; }

      /*
        HOW CLOSE DOES FAIR VALUE GET TO SATURATING, and how large does the premium actually get?

        These are reported because a clean "no price froze" is only meaningful alongside them. If
        fair value never approaches $1,000 then this probe never exercised the reported bug at all, and
        its silence says nothing about whether the fix worked. `checkSharePrice` covers the saturated
        case directly by DRIVING fair to $1,000 for sixty days; this measures whether real leagues get
        there on their own.
      */
      for (let i = 0; i < rows.length; i += 1) {
        const fair = rows[i].fair[club];
        const close = rows[i].close[club];
        if (typeof fair !== 'number' || typeof close !== 'number' || fair <= 0) continue;
        if (fair > highestFair) highestFair = fair;
        const ratio = close / fair;
        if (ratio > highestRatio) { highestRatio = ratio; highestRatioClub = club; }
        if (fair >= PRICE_MAX) {
          saturatedClubDays += 1;
          const next = rows[i + 1]?.close[club];
          if (typeof next === 'number' && Math.abs(next - close) > 1e-9) saturatedClubDaysMoving += 1;
        }
      }

      /*
        A RUN OF IDENTICAL CONSECUTIVE CLOSES. Counted as a run of `days` where day N equals day N-1,
        so a run of 5 means 6 days produced 5 identical repeats.
      */
      let runStart = 0;
      let runLevel = closes[0];
      for (let i = 1; i <= closes.length; i += 1) {
        const same = i < closes.length && closes[i] === runLevel;
        if (!same) {
          const repeats = i - 1 - runStart;
          if (repeats >= 2) {
            frozenRuns.push({
              club,
              kind: 'identical',
              from: rows[runStart].date,
              to: rows[i - 1].date,
              days: repeats,
              level: runLevel,
            });
            seedRuns += 1;
          }
          if (i < closes.length) { runStart = i; runLevel = closes[i]; }
        }
      }

      // A run pinned to the sanity guard, which must never happen.
      let wallStart: number | null = null;
      for (let i = 0; i < closes.length; i += 1) {
        const atWall = closes[i] >= PRICE_SANITY_MAX;
        if (atWall && wallStart === null) wallStart = i;
        if (!atWall && wallStart !== null) {
          wallRuns.push({
            club, kind: 'sanity_ceiling', from: rows[wallStart].date, to: rows[i].date,
            days: i - wallStart, level: PRICE_SANITY_MAX,
          });
          wallStart = null;
        }
      }
    }
    if (seedRuns > 0) everFrozen += 1;
    console.log(seedRuns > 0 ? `${seedRuns} frozen run(s)` : 'clean');
  }

  const longest = frozenRuns.slice().sort((a, b) => b.days - a.days);

  console.log(`\n  club-seasons priced: ${totalClubs}   leagues containing a frozen price: ${everFrozen}/${SEEDS.length}`);
  console.log(`  runs at the SANITY CEILING: ${wallRuns.length}  (must be 0 -- it is a corruption guard)`);
  console.log(`  highest close anywhere: ${highestClose.toFixed(2)} (${highestCloseClub})`);
  console.log(`  highest FAIR value anywhere: ${highestFair.toFixed(2)} -- saturation needs ${PRICE_MAX}`);
  console.log(`  widest premium: ${highestRatio.toFixed(3)}x fair (${highestRatioClub})`);
  console.log(`  club-days where fair SATURATED at ${PRICE_MAX}: ${saturatedClubDays}`);

  /*
    THE HONEST CAVEAT, printed rather than buried.

    If `saturatedClubDays` is 0 then this probe never reproduced the reported bug -- fair value never
    reached the top of the valuation scale in these leagues -- and its "no price froze" result is
    therefore NOT evidence that the fix worked. It only says that no price froze for any other reason.

    What actually tests the saturated case is the regression check in `checkSharePrice`, which drives
    `fair` to exactly $1,000 for sixty days and requires the price to keep moving and to be free to
    exceed it. That check measured 60 distinct closes spanning 366.9 points with a high of 1,226.10.
    This probe measures whether real leagues reach the condition on their own; the check measures what
    happens when they do.
  */
  if (saturatedClubDays === 0) {
    console.log('\n  NOTE: fair value never saturated in these leagues, so this run did NOT reproduce the');
    console.log('  reported bug. Its silence is not evidence the fix works -- checkSharePrice covers that');
    console.log('  case directly by driving fair to the ceiling on purpose. Read it as: nothing else froze.');
  } else {
    console.log(`  of those, ${saturatedClubDaysMoving} moved the next day `
      + `(${((saturatedClubDaysMoving / saturatedClubDays) * 100).toFixed(1)}%)`);
  }

  if (longest.length === 0) {
    console.log('\n  NO PRICE FROZE. No club held the same close on three consecutive days in any league.\n');
    return;
  }

  console.log('\n  TEN LONGEST FROZEN RUNS\n');
  console.log('   repeats  level    club    from           to');
  for (const r of longest.slice(0, 10)) {
    console.log(`   ${String(r.days).padStart(7)}  ${r.level.toFixed(2).padStart(8)}  ${r.club.padEnd(7)} ${r.from}   ${r.to}`);
  }

  const maxRun = longest[0].days;
  const over5 = frozenRuns.filter((r) => r.days >= 5).length;
  console.log(`\n  LONGEST FREEZE: ${maxRun} identical repeats. Runs of 5+ repeats: ${over5}.`);
  console.log(maxRun >= 5
    ? '  A price holding the same number for days on end is not a market, whatever the level.'
    : '  Only short repeats, which is what an offseason day at near-zero volatility looks like.');
  if (wallRuns.length === 0) {
    console.log('  Nothing reached the sanity guard, so the only ceiling left is one the market cannot feel.');
  }
  console.log('');
};

void main();