/**
 * What share of at-bats produce each outcome?
 *
 * verifyMetrics.ts measured a league BABIP of 0.768. Real baseball sits near
 * 0.300 and 0.768 is not a value any real league produces, so either the BABIP
 * definition is wrong or this engine's outcomes are distributed unlike real
 * baseball. The definition was already checked against the accumulator, so this
 * measures the distribution and settles which it is.
 *
 * The arithmetic that makes the number surprising: balls in play here is every
 * at-bat that is not a strikeout and not a home run, which is a strict
 * superset of real baseball's definition because the engine has no sacrifice
 * flies AND no such thing as a ball in play that is neither a hit nor an out.
 * In this engine an 'OUT' is a ball in play. So BABIP counts outs in the
 * denominator, exactly as it should, and a .768 can only mean the engine puts
 * 77 hits in every 100 balls in play.
 *
 * That would be a property of the simulation, not of the metric. Which is worth
 * knowing before shipping a BABIP leaderboard, because a number that looks
 * broken next to real baseball reads as a bug in the leaderboard rather than as
 * a difference in the model.
 *
 * Run: npx tsx tools/probeOutcomeMix.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import type { AtBatOutcome, Game, PlayLogEvent } from '../src/types';

const DAYS = Number(process.argv[2] ?? 60);
const YEAR = 2026;
const SEED = 4242;

const AT_BAT_OUTCOMES: readonly string[] = ['OUT', 'SO', 'BB', '1B', '2B', '3B', 'HR', 'ERR'];

const main = async (): Promise<void> => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    playerState,
    YEAR,
  );
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });
  const mgr = new SimulationManager({
    teams,
    games: schedule,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: startDate,
  });

  const counts: Record<string, number> = {};
  const seen = new Set<string>();
  let games = 0;
  let atBats = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    result.games.forEach((game: Game) => {
      if (game.status !== 'completed' || seen.has(game.gameId)) return;
      seen.add(game.gameId);
      const raw = game.stats?.playLog;
      if (typeof raw !== 'string' || raw.length === 0) return;
      games += 1;
      (JSON.parse(raw) as PlayLogEvent[]).forEach((event) => {
        if (!AT_BAT_OUTCOMES.includes(event.outcome)) return;
        atBats += 1;
        const key = event.outcome;
        counts[key] = (counts[key] ?? 0) + 1;
      });
    });
  }

  const share = (key: string): number => (atBats > 0 ? (counts[key] ?? 0) / atBats : 0);
  const outs = (counts.OUT ?? 0);
  const errors = (counts.ERR ?? 0);
  const hits = (counts['1B'] ?? 0) + (counts['2B'] ?? 0) + (counts['3B'] ?? 0) + (counts.HR ?? 0);
  // Balls in play as the metric defines it: every at-bat that is not a
  // strikeout and not a home run. An 'OUT' is a ball in play here, because the
  // engine records groundouts and flyouts as a single 'OUT' outcome.
  const bip = atBats - (counts.SO ?? 0) - (counts.HR ?? 0);

  console.log(JSON.stringify({
    measured: { daysSimmed: DAYS, seed: SEED, games, atBats },
    outcomeCounts: counts,
    outcomeShare: Object.fromEntries(AT_BAT_OUTCOMES.map((k) => [k, share(k).toFixed(4)])),
    reconstruction: {
      note: 'Balls in play is derived two ways. If they agree, the high BABIP comes from the outcome '
        + 'mix rather than from an arithmetic slip.',
      ballsInPlay: bip,
      ballsInPlayAsAbMinusSoMinusHr: bip,
      ballsInPlayAsOutPlusErrPlusHitsExcludingHr:
        outs + errors + (counts['1B'] ?? 0) + (counts['2B'] ?? 0) + (counts['3B'] ?? 0),
      agreement: bip === outs + errors + (counts['1B'] ?? 0) + (counts['2B'] ?? 0) + (counts['3B'] ?? 0),
      hitsAmongBallsInPlay: hits,
      errorsAmongBallsInPlay: errors,
      outsAmongBallsInPlay: outs,
      babip: (bip > 0 ? hits / bip : 0).toFixed(4),
      hitShareOfBallsInPlay: (bip > 0 ? hits / bip : 0).toFixed(4),
      outShareOfBallsInPlay: (bip > 0 ? outs / bip : 0).toFixed(4),
      errorShareOfBallsInPlay: (bip > 0 ? errors / bip : 0).toFixed(4),
    },
    verdict: 'MEASURED, not asserted',
  }, null, 2));
};

main().catch((error) => {
  console.error('THREW', error);
  process.exit(1);
});
