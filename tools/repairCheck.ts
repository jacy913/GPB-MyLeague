/**
 * Does repairing an empty player pool actually produce a playable league?
 *
 * The reported symptom was a save with 32 teams and a full schedule but no
 * players, and scores reading 1-0. The gate now offers to repair it, so that
 * claim needs proving: build a universe, delete the pool exactly as a refresh
 * mid-Terminate would, then run the repair chain and check the league is
 * actually playable afterwards -- full rosters, rated teams, and a real game.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { ALL_ROSTER_SLOTS, type LeaguePlayerState, type Team } from '../src/types';

const SEED = 1337;
const START_YEAR = 2026;

const buildSchedule = (roster: Team[], year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const describe = (label: string, state: LeaguePlayerState, teams: Team[]) => {
  const filled = state.rosterSlots.filter((slot) => slot.playerId !== null).length;
  const ratings = teams.map((t) => t.rating);
  console.log(
    `${label.padEnd(22)} players ${String(state.players.length).padStart(5)}` +
    `   roster slots filled ${String(filled).padStart(5)}/${state.rosterSlots.length}` +
    `   team rating ${Math.min(...ratings).toFixed(1)}..${Math.max(...ratings).toFixed(1)}`,
  );
  return { players: state.players.length, filled };
};

let teams = INITIAL_TEAMS.map((team) => ({ ...team, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 }));
const games = buildSchedule(teams, START_YEAR);
const built = buildNewUniverse({
  teams,
  seasonYear: START_YEAR,
  seed: SEED,
  effectiveDate: `${START_YEAR}-12-15`,
});

console.log(`expected roster slots   ${ALL_ROSTER_SLOTS.length} per club x ${teams.length} clubs`);
console.log('');
const healthy = describe('healthy universe', built.playerState, recalculateTeamRatingsFromRosters(teams, built.playerState, START_YEAR));

// Exactly what a refresh mid-Terminate leaves behind: pool gone, league intact.
const wiped: LeaguePlayerState = { ...built.playerState, players: [], rosterSlots: [] };
const wipedTeams = teams.map((team) => ({ ...team, rating: 80 }));
const broken = describe('after refresh', wiped, wipedTeams);
console.log('');

// The repair the gate performs.
const repaired = buildNewUniverse({
  teams: wipedTeams,
  seasonYear: START_YEAR,
  seed: SEED,
  effectiveDate: `${START_YEAR}-12-15`,
});
const repairedTeams = recalculateTeamRatingsFromRosters(wipedTeams, repaired.playerState, START_YEAR);
const fixed = describe('after repair', repaired.playerState, repairedTeams);
console.log('');

console.log('=== the league is playable again ===');
console.log(`  players restored          ${broken.players === 0 && fixed.players > 0 ? 'yes' : 'NO'}   (${fixed.players})`);
console.log(`  rosters fully staffed     ${fixed.filled >= ALL_ROSTER_SLOTS.length * teams.length ? 'yes' : 'NO'}   (${fixed.filled}/${ALL_ROSTER_SLOTS.length * teams.length})`);
console.log(`  same seed reproduces      ${fixed.players === healthy.players ? 'yes' : 'NO'}   (${healthy.players} vs ${fixed.players})`);

const manager = new SimulationManager({
  teams: repairedTeams,
  games,
  playerState: repaired.playerState,
  settings: DEFAULT_SETTINGS,
  currentDate: getDefaultSeasonStartDate(START_YEAR),
});

// What did the sim actually produce on the broken save? This is the decisive
// test of the reported 1-0 symptom: does an empty pool give degenerate scores,
// or does it refuse to simulate at all?
console.log('=== simulating the WIPED universe (0 players) ===');
try {
  const brokenManager = new SimulationManager({
    teams: wipedTeams,
    games,
    playerState: wiped,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(START_YEAR),
  });
  const brokenResult = await brokenManager.run({ scope: 'week' });
  const brokenDone = brokenResult.games.filter((g) => g.status === 'completed');
  const brokenRuns = brokenDone.map((g) => g.score.away + g.score.home);
  const pairs = new Map<string, number>();
  brokenDone.forEach((g) => {
    const k = `${g.score.away}-${g.score.home}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  });
  const top = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const mean = brokenRuns.length ? brokenRuns.reduce((a, b) => a + b, 0) / brokenRuns.length : 0;
  console.log(`  completed ${brokenDone.length} games, mean ${mean.toFixed(2)} runs/game`);
  console.log(`  scorelines: ${top.map(([k, n]) => `${k} x${n}`).join('   ')}`);
  console.log(`  1-0 games   ${brokenRuns.filter((v) => v === 1).length} of ${brokenDone.length}`);
} catch (error) {
  console.log(`  THREW: ${(error as Error).message}`);
  console.log('  -> an empty pool does not fake scores, it refuses to simulate.');
}
console.log('');

console.log('=== simulating the REPAIRED universe ===');
const result = await manager.run({ scope: 'week' });
const done = result.games.filter((g) => g.status === 'completed');
const runs = done.map((g) => g.score.away + g.score.home);
const mean = runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0;
console.log(`  first week simulated      ${done.length} games, mean ${mean.toFixed(2)} runs/game`);
console.log(`  scores are not 1-0        ${mean > 4 ? 'yes' : 'NO'}   (mean ${mean.toFixed(2)})`);
