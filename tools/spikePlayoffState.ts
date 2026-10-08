/**
 * PHASE 0 SPIKE -- can a universe be driven to a state with SCHEDULED playoff games, and how long
 * does it take? Does the postseason window open AND close within one season?
 *
 * Throws away everything except the answer. If this cannot work, phases 4-10 of the postseason plan
 * are unverifiable and need re-planning rather than attempting.
 *
 * Construction copied from `tools/leagueLab.ts:runSeason`, and state read from `manager.run()`'s
 * RETURN VALUE rather than from `manager.games` / `manager.currentDate` / `manager.playerState`,
 * which are private. The second version of this spike read the private fields and `tsc` reported
 * nine errors -- all of which were the harness reaching around the API, not a defect it was testing.
 *
 * Run: npx tsx tools/spikePlayoffState.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { automaticallySignFreeAgents } from '../src/logic/automaticMarket';
import { isRegularSeasonGame } from '../src/logic/playoffs';
import type { Game, LeaguePlayerState, Team } from '../src/types';

/**
 * Seeded stream for the in-season market, matching `tools/leagueLab.ts:75`. Declared here because
 * leagueLab keeps `mulberry32` module-private and there is no `src/logic/rng` to import from.
 */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

console.log(`\nPHASE 0 SPIKE -- reaching scheduled playoff games\n`);

const seasonYear = 2026;
const startDate = getDefaultSeasonStartDate(seasonYear);
let teams: Team[] = INITIAL_TEAMS.map((t) => ({ ...t }));
// `generateSchedule(teams, options)` -- TWO arguments, and the second is a ScheduleOptions object,
// not the simulation settings. leagueLab passes `{seasonStartDate, seasonDays}`.
let games: Game[] = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });
console.log(`  ${stamp()}  schedule: ${games.length} games from ${startDate}`);

const universe = buildNewUniverse({ teams, seasonYear, seed: 20261009, effectiveDate: startDate });
let playerState: LeaguePlayerState = universe.playerState;
// (teams, playerState, seasonYear) -- the first version passed (players, teams) and the ratings
// helper iterated a Team[] where it wanted PlayerBattingRatings[].
teams = recalculateTeamRatingsFromRosters(teams, playerState, seasonYear);
console.log(`  ${stamp()}  universe: ${teams.length} clubs, ${playerState.players.length} players`);

const rng = mulberry32(4242);
const manager = new SimulationManager({
  teams,
  games,
  playerState,
  settings: DEFAULT_SETTINGS,
  currentDate: startDate,
});

let currentDate = startDate;

const report = () => {
  const all = games;
  const playoff = all.filter((g) => g.phase === 'playoffs');
  const byRound = new Map<string, number>();
  for (const g of playoff) {
    const k = g.playoff?.round ?? 'none';
    byRound.set(k, (byRound.get(k) ?? 0) + 1);
  }
  return {
    total: all.length,
    regularLeft: all.filter((g) => g.phase !== 'playoffs' && g.status === 'scheduled').length,
    playoffTotal: playoff.length,
    playoffScheduled: playoff.filter((g) => g.status === 'scheduled').length,
    playoffCompleted: playoff.filter((g) => g.status === 'completed').length,
    series: new Set(playoff.map((g) => g.playoff?.seriesId)).size,
    byRound: [...byRound.entries()].map(([k, v]) => `${k}:${v}`).join(' ') || 'none yet',
  };
};

console.log(`\n  ${stamp()}  simulating day by day through the whole postseason...\n`);
console.log('  elapsed  reg-left  po-scheduled  po-done  series  gate    currentDate');

let firstPlayoffDay: number | null = null;
let gateOpenDay: number | null = null;
let gateClosedDay: number | null = null;
let peakScheduled = 0;
let peakCompleted = 0;

for (let day = 0; day < 300; day += 1) {
  // `automaticallySignFreeAgents(teams, playerState, effectiveDate)` -- THREE arguments, and it
  // RETURNS the new LeaguePlayerState rather than a list of signings. The first version of this
  // spike passed five arguments (copied from a half-remembered call shape) and then tried to map
  // over the result, which the compiler caught immediately. Read the signature; do not guess it.
  playerState = automaticallySignFreeAgents(teams, playerState, currentDate);

  const result = await manager.run({ scope: 'day' });
  games = result.games;
  teams = result.teams;
  playerState = result.playerState;
  currentDate = result.currentDate;

  const s = report();
  const gate = s.playoffScheduled > 0;
  peakScheduled = Math.max(peakScheduled, s.playoffScheduled);
  // PER-DATE peak for the panel budget. The cumulative total would report 45, which is not a
  // nightly figure -- the first version conflated the two and failed its own budget of 8.
  peakCompleted = Math.max(
    peakCompleted,
    games.filter((g) => g.phase === 'playoffs' && g.status === 'completed' && g.date === currentDate).length,
  );

  if (s.playoffScheduled > 0 && firstPlayoffDay === null) firstPlayoffDay = day;
  if (gate && gateOpenDay === null) gateOpenDay = day;
  if (gateOpenDay !== null && !gate && gateClosedDay === null) gateClosedDay = day;

  if (gateOpenDay !== null || day % 25 === 0) {
    console.log(
      `  ${stamp()}  ${String(s.regularLeft).padStart(7)}  ${String(s.playoffScheduled).padStart(12)}  ${String(
        s.playoffCompleted,
      ).padStart(7)}  ${String(s.series).padStart(6)}  ${(gate ? 'OPEN' : 'shut').padStart(6)}  ${currentDate}`,
    );
  }

  // Out the whole postseason; the point is the gate opening AND closing.
  if (s.playoffTotal > 0 && s.playoffScheduled === 0 && s.playoffCompleted === s.playoffTotal) break;
}

const final = report();
const finalGame = games.filter((g) => g.playoff?.round === 'world_series' && g.status === 'completed').pop();
const champion = finalGame
  ? finalGame.score.home > finalGame.score.away
    ? finalGame.homeTeam
    : finalGame.awayTeam
  : null;

console.log(`\n  RESULT`);
console.log(`  ${'='.repeat(54)}`);
console.log(`  bracket seeded:               ${firstPlayoffDay !== null ? `YES, simulated day ${firstPlayoffDay}` : 'NO'}`);
console.log(`  GATE OPENED:                  ${gateOpenDay !== null ? `simulated day ${gateOpenDay}` : 'NEVER'}`);
console.log(`  GATE CLOSED:                  ${gateClosedDay !== null ? `simulated day ${gateClosedDay}` : 'NEVER'}`);
console.log(`  champion:                     ${champion ?? 'none identified'}`);
console.log(`  total wall time:              ${stamp()}`);
console.log(`  games in schedule:            ${final.total}`);
console.log(`  playoff games total:          ${final.playoffTotal}`);
console.log(`  distinct series:              ${final.series}`);
console.log(`  rounds present:               ${final.byRound}`);
console.log(`  currentDate:                  ${currentDate}`);

console.log(`\n  PANEL FEASIBILITY`);
console.log(`  peak SCHEDULED on one date:   ${peakScheduled}   (panel budget 8)`);
console.log(`  peak COMPLETED on one date:   ${peakCompleted}   (previous-night budget 8)`);
console.log(`  ${peakScheduled <= 8 ? 'PASS' : 'FAIL'}   a postseason slate fits the panel`);
console.log(`  ${peakCompleted <= 8 ? 'PASS' : 'FAIL'}   a completed postseason night fits the panel`);
console.log(`\n  ${gateOpenDay !== null && gateClosedDay !== null ? 'PASS' : 'FAIL'}   the window OPENS and CLOSES within one season`);
console.log(`\n`);