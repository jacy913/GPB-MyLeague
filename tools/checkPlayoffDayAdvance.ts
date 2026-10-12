/*
  HOW MANY GAMES DOES ONE PRESS OF "NEXT PLAYOFF DAY" PLAY?

  Reported as a suspected bug: the button sometimes simulates two games instead of one.

  The button runs `{ scope: 'to_date', targetDate: nextPlayoffDate }`, and `buildSimulationDatePlan`
  expands a `to_date` into every calendar day from the current date THROUGH the target, inclusive. So
  one press advances the league to the next date that has a playoff game on it and plays everything
  scheduled for that date.

  Whether that is one game or four is a property of the BRACKET, not of the button: several series are
  live at once in a 32-team field and they share dates. So this measures the distribution over real
  postseasons rather than arguing from the code.

  THE FIRST VERSION OF THIS FILE WAS WRONG IN AN INTERESTING WAY. It filtered to
  `status === 'scheduled'`, which after simulating 215 days is three games rather than a postseason -- so
  it measured the tail of a finished bracket and reported a nonsense "3 presses, 66% multi-game". Grouping
  ALL playoff games by date is the right question, because the bracket's schedule is fixed whether or not
  those games have been played yet. The scheduled-only figure was an artefact of asking about the end of
  the run instead of about the shape of the bracket.
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { seededRandomStream } from '../src/lib/analytics/playoffMonteCarlo';
import { isPlayoffGame } from '../src/logic/playoffs';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const SEEDS = [4242, 90210, 1337, 20250];
const YEAR = 2026;

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

/** One league, run to the end of its postseason. */
const runToPostseason = async (seed: number): Promise<Game[]> => {
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  });
  const teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    built.playerState,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 200,
      random: seededRandomStream(seed),
    }),
    playerState: built.playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });
  let state: LeaguePlayerState = built.playerState;
  let latest = await manager.run({ scope: 'day' });
  for (let day = 0; day < 215; day += 1) {
    latest = await manager.run({ scope: 'day' });
    state = latest.playerState;
  }
  return latest.games;
};

const main = async () => {
  console.log('\nNEXT PLAYOFF DAY -- games per press, measured on real postseasons\n');

  let totalDays = 0;
  let single = 0;
  let multi = 0;
  let worst = 0;
  let allPlayoffGames = 0;
  const histogram = new Map<number, number>();

  for (const seed of SEEDS) {
    const games = await runToPostseason(seed);
    const postseason = games.filter(isPlayoffGame);
    allPlayoffGames += postseason.length;

    // One press plays everything on the next date carrying a playoff game, so the distribution of
    // games-per-date IS the distribution of games-per-press.
    const byDate = new Map<string, number>();
    for (const game of postseason) {
      byDate.set(game.date, (byDate.get(game.date) ?? 0) + 1);
    }
    console.log(`  seed ${String(seed).padStart(6)}: ${postseason.length} playoff games across ${byDate.size} dates`);

    for (const count of byDate.values()) {
      totalDays += 1;
      histogram.set(count, (histogram.get(count) ?? 0) + 1);
      if (count === 1) single += 1;
      else multi += 1;
      worst = Math.max(worst, count);
    }
  }

  console.log(`\n  ${allPlayoffGames} playoff games spread over ${totalDays} dates across ${SEEDS.length} postseasons`);
  [...histogram.entries()].sort((a, b) => a[0] - b[0]).forEach(([count, days]) => {
    console.log(`    ${count} game(s) that day: ${String(days).padStart(3)} day(s)`);
  });
  console.log('');

  check(
    'the bracket puts several games on one day, so "next DAY" is not "next GAME"',
    multi > 0,
    `${multi} of ${totalDays} playoff dates (${((multi / totalDays) * 100).toFixed(1)}%) carry more than one game,`
    + ` up to ${worst}. Only ${single} (${((single / totalDays) * 100).toFixed(1)}%) are a single game. This is the`
    + ' schedule rather than the button: in a 32-team field several series are live at once.',
  );

  check(
    'and a single-game press is the MINORITY case, so "sometimes two" understated it',
    single < totalDays / 2,
    `a press plays exactly one game ${((single / totalDays) * 100).toFixed(1)}% of the time. The report of`
    + ' "sometimes it simulates 2 games" is true and conservative -- it is the usual case. It reads as a'
    + ' bug because the button beside it moved a smaller amount, and that one has now been removed.',
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  the button does what its label says. The confusion was two controls next to each other\n'
    + '  meaning different amounts of movement; only one of them is left now.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });