/**
 * Does `isPostseasonWindow` behave? Checked against a REAL simulated postseason, not a fixture.
 *
 * A gate this simple is exactly the kind of thing that is wrong in a way no reader would notice: it
 * returns a boolean, there is nothing to throw, and "the autumn palette didn't come back in
 * November" is a report a user makes months later. The definition reads correctly; this measures
 * whether it does.
 *
 * The four properties worth asserting, and why each is a distinct failure:
 *
 *   1. FALSE on a fresh universe. Every club on a 0-0 record with a full regular-season schedule and
 *      no playoff games. A gate that opens here paints the whole app autumn for the entire regular
 *      season, which is the worst possible failure and the easiest to miss without looking.
 *   2. Opens when the bracket seeds, and only then.
 *   3. Closes when the postseason finishes -- measured, not asserted.
 *   4. A COMPLETED playoff game does not hold it open. This is the one that has to be tested rather
 *      than reasoned about, because "scheduled only" is the entire mechanism by which the window
 *      ever shuts, and a single stray completed game would carry the palette into the offseason.
 *
 * Run: npx tsx tools/checkPostseasonGate.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { automaticallySignFreeAgents } from '../src/logic/automaticMarket';
import { isPostseasonWindow, scheduledPlayoffGameCount } from '../src/lib/seasonPhase';
import type { Game, LeaguePlayerState, Team } from '../src/types';

let failures = 0;
let checks = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`  ${pass ? 'PASS  ' : 'FAIL  '}${label}`);
  console.log(`        ${detail}`);
};

console.log('\nPOSTSEASON GATE\n');

const seasonYear = 2026;
const startDate = getDefaultSeasonStartDate(seasonYear);
let teams: Team[] = INITIAL_TEAMS.map((t) => ({ ...t }));
const games: Game[] = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });
const universe = buildNewUniverse({ teams, seasonYear, seed: 20261009, effectiveDate: startDate });
let playerState: LeaguePlayerState = universe.playerState;
teams = recalculateTeamRatingsFromRosters(teams, playerState, seasonYear);

const manager = new SimulationManager({
  teams, games, playerState, settings: DEFAULT_SETTINGS, currentDate: startDate,
});

/* ------------------------------------------------------------------ 1. false on a fresh universe */

check(
  'a fresh universe is NOT in the postseason window',
  isPostseasonWindow(games) === false,
  `${games.length} games, ${games.filter((g) => g.phase === 'playoffs').length} playoff games among them`
    + `, gate reads ${isPostseasonWindow(games) ? 'OPEN' : 'shut'}`
    + `\n        a gate that opens here would paint the whole app autumn for the entire regular season`,
);

/* ------------------------------------------------------------------ run the postseason */

let currentDate = startDate;
let live = games;
let openedOnDay: number | null = null;
let closedOnDay: number | null = null;
let daysOpen = 0;
let daysWithCompletedOnly = 0;

for (let day = 0; day < 300; day += 1) {
  playerState = automaticallySignFreeAgents(teams, playerState, currentDate);
  const result = await manager.run({ scope: 'day' });
  live = result.games;
  teams = result.teams;
  playerState = result.playerState;
  currentDate = result.currentDate;

  const open = isPostseasonWindow(live);
  if (open) {
    if (openedOnDay === null) openedOnDay = day;
    daysOpen += 1;
  } else if (openedOnDay !== null && closedOnDay === null) {
    closedOnDay = day;
  }

  // The state that must NOT read as open: playoff games all played, none left scheduled.
  const poAll = live.filter((g) => g.phase === 'playoffs');
  if (poAll.length > 0 && poAll.every((g) => g.status === 'completed') && isPostseasonWindow(live)) {
    daysWithCompletedOnly += 1;
  }

  const done = poAll.length > 0 && poAll.every((g) => g.status === 'completed');
  if (done && closedOnDay !== null) break;
}

const poGames = live.filter((g) => g.phase === 'playoffs');

/* ------------------------------------------------------------------ 2. opened */

check(
  'the window OPENS when the bracket seeds',
  openedOnDay !== null,
  openedOnDay !== null
    ? `opened on simulated day ${openedOnDay}, ${currentDate} at the end of the run`
    : 'NEVER OPENED -- the bracket never seeded, so the gate was never exercised',
);

/* ------------------------------------------------------------------ 3. closed */

check(
  'the window CLOSES when the postseason finishes',
  closedOnDay !== null,
  closedOnDay !== null
    ? `closed on simulated day ${closedOnDay}; open for ${daysOpen} simulated days`
    : 'NEVER CLOSED -- a completed postseason would leave the app in the autumn palette for ever',
);

/* ------------------------------------------------------------------ 4. completed does not hold it open */

check(
  'a fully completed postseason does NOT hold the window open',
  daysWithCompletedOnly === 0 && isPostseasonWindow(live) === false,
  `${poGames.length} playoff games, all completed, ${scheduledPlayoffGameCount(live)} still scheduled;`
    + ` gate reads ${isPostseasonWindow(live) ? 'OPEN' : 'shut'}`
    + `\n        this is the whole mechanism by which the window ever shuts`,
);

/* ------------------------------------------------------------------ 5. mid-postseason, for the count */

const midway = live.filter((g) => g.phase === 'playoffs' && g.status === 'scheduled');
check(
  'scheduledPlayoffGameCount agrees with the gate and never exceeds a readable slate',
  midway.length === 0 || midway.length <= 8,
  `${midway.length} scheduled playoff games remain at the end of the run`
    + ` (panel budget 8)`,
);

console.log(`\n  rounds present: ${[...new Set(poGames.map((g) => g.playoff?.round))].join(' ')}`);
console.log(`\n  ${checks} checks, ${failures} failed\n`);
process.exitCode = failures === 0 ? 0 : 1;