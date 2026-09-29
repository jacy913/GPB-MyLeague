/**
 * Where do the 1-0s come from?
 *
 * The user reports final scores reading 1-0. The league environment section of
 * the lab says 3.83 runs per team-game, which is ~7.7 per game and would make
 * 1-0 rare. Either the report is about a different surface, or something
 * collapses scores on the way to the screen. This measures the distribution of
 * final scores so the question is answered with a number, not an argument.
 *
 * Drives SimulationManager.run({scope:'season'}) over the same bootstrap the
 * app and the lab use, so the path under test is the real one.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import type { Team } from '../src/types';

const resetTeamRecord = (teams: Team[]): Team[] =>
  teams.map((team) => ({ ...team, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 }));

const SEED = Number(process.argv[2] ?? 1337);
const START_YEAR = 2026;

// Same construction the lab uses. Passing a bare year here would fall through
// to the default-year schedule and quietly measure a different season than the
// universe bootstrap was told to build.
const buildSchedule = (roster: Team[], seasonYear: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(seasonYear), seasonDays: 180 });

let teams = resetTeamRecord(INITIAL_TEAMS.map((team) => ({ ...team })));
let games = buildSchedule(teams, START_YEAR);

const built = buildNewUniverse({
  teams,
  seasonYear: START_YEAR,
  seed: SEED,
  effectiveDate: getDefaultSeasonStartDate(START_YEAR),
});
const playerState = built.playerState;
teams = recalculateTeamRatingsFromRosters(teams, playerState, START_YEAR);

const manager = new SimulationManager({
  teams,
  games,
  playerState,
  settings: DEFAULT_SETTINGS,
  currentDate: getDefaultSeasonStartDate(START_YEAR),
});

const result = await manager.run({ scope: 'season' });

const completed = result.games.filter((game) => game.status === 'completed');
const totalRuns = completed.map((game) => game.score.away + game.score.home).sort((a, b) => a - b);

const pct = (p: number) => totalRuns[Math.min(totalRuns.length - 1, Math.floor(totalRuns.length * p))];
const mean = totalRuns.reduce((s, v) => s + v, 0) / Math.max(1, totalRuns.length);

const pairs = new Map<string, number>();
completed.forEach((game) => {
  const key = `${game.score.away}-${game.score.home}`;
  pairs.set(key, (pairs.get(key) ?? 0) + 1);
});

const share = (n: number) => `${((n / Math.max(1, completed.length)) * 100).toFixed(2)}%`;
const oneZero = totalRuns.filter((v) => v === 1).length;
const threeOrFewer = totalRuns.filter((v) => v <= 3).length;
const shutouts = completed.filter((g) => g.score.away === 0 || g.score.home === 0).length;
const homeWins = completed.filter((g) => g.score.home > g.score.away).length;
const ties = completed.filter((g) => g.score.away === g.score.home).length;

console.log(`seed ${SEED}   completed games ${completed.length} of ${result.games.length}`);
console.log(`total runs per game    mean ${mean.toFixed(2)}   median ${pct(0.5)}`);
console.log('');
console.log('total-runs percentiles');
for (const p of [0.05, 0.25, 0.5, 0.75, 0.95]) {
  const v = pct(p);
  console.log(`  p${String(Math.round(p * 100)).padStart(2)}  ${String(v).padStart(2)} runs  ${'#'.repeat(Math.min(46, v))}`);
}
console.log('');
console.log(`1-0 scorelines         ${String(oneZero).padStart(4)}   ${share(oneZero)} of completed`);
console.log(`<= 3 total runs        ${String(threeOrFewer).padStart(4)}   ${share(threeOrFewer)}`);
console.log(`shutouts (either 0)    ${String(shutouts).padStart(4)}   ${share(shutouts)}`);
console.log(`home winners           ${String(homeWins).padStart(4)}   ${share(homeWins)}   (MLB ~54%)`);
console.log(`ties                   ${String(ties).padStart(4)}   ${share(ties)}`);
console.log('');
console.log('most common exact scorelines');
[...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  .forEach(([k, n]) => console.log(`  ${k.padEnd(7)} ${String(n).padStart(4)}  ${share(n)}`));
