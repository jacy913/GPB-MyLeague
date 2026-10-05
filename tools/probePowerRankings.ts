/**
 * Which column should power rankings sort on?
 *
 * A measurement, not a preference. `championship` was the obvious candidate -- it is the only figure
 * that already accounts for the schedule a club actually has to play -- and the measurement says it
 * is unusable as a sort key at the trial count this game uses. See the note on `rankBasis` in
 * `src/lib/analytics/powerRankings.ts` for the numbers and the reasoning.
 *
 * Three scenarios: a pristine universe, a month in, and mid season. For each, how far apart the top
 * and bottom clubs actually are on each candidate column, and whether the two orderings agree.
 *
 * Run: npx tsx tools/probePowerRankings.ts
 */

import { normalizeSeed } from '../src/lib/random';
import { buildPowerRankings, rankSpread } from '../src/lib/analytics/powerRankings';
import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { SimulationManager } from '../src/logic/simulationManager';

const YEAR = 2026;
const SEED = normalizeSeed('probe-power-rankings');

const pct = (v: number) => `${(v * 100).toFixed(1).padStart(5)}%`;

/*
  THE SCHEDULE IS BUILT ONCE, HERE, FOR ALL THREE SCENARIOS.

  This probe originally called `generateSchedule` inside the per-scenario build, and three runs of the
  same code gave three different top valuations (82.7 / 86.6 / 87.7). `probeFairLayerDeterminism`
  cleared the pricing, and `probeUniverseDeterminism` cleared roster generation -- 1283 identical
  players, zero rating spread -- which left `generateSchedule`: it reshuffles 2459 of its 2464 games
  between calls and takes no seed.

  That is a real pre-existing finding, recorded in `probeUniverseDeterminism.ts`. It does not affect
  the app, which generates a schedule once and persists it, so a reload re-reads the saved slate. It
  does mean a measurement cannot regenerate a slate and expect the same answer twice.
*/
const pristineTeams = recalculateTeamRatingsFromRosters(
  INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
  buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState,
  YEAR,
);
const START = getDefaultSeasonStartDate(YEAR);
const SCHEDULE = generateSchedule(pristineTeams, { seasonStartDate: START, seasonDays: 180 });

const build = async (days: number) => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;
  const manager = new SimulationManager({
    teams: pristineTeams,
    games: SCHEDULE,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: START,
  });
  let teams = pristineTeams;
  let playerState = universe;
  let games = SCHEDULE;
  let currentDate = START;
  for (let d = 0; d < days; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams;
    games = r.games;
    playerState = r.playerState;
    currentDate = r.currentDate;
  }
  return { teams, games, playerState, currentDate };
};

const report = async (label: string, days: number) => {
  const state = await build(days);
  const rankings = buildPowerRankings({
    teams: state.teams,
    games: state.games,
    playerState: state.playerState,
    seasonYear: YEAR,
    date: state.currentDate,
    settings: DEFAULT_SETTINGS,
    // A distinct key per scenario, so one cannot be served another's cached layer.
    fairCacheKey: `probe|${label}`,
  });

  const champ = rankSpread(rankings.rows, 'championship');
  const val = rankSpread(rankings.rows, 'valuation');

  console.log(`\n${label.toUpperCase()}  (${state.games.filter((g) => g.status === 'completed').length} games played)\n`);
  console.log(`  championship   top ${pct(champ.top)}  bottom ${pct(champ.bottom)}  spread ${pct(champ.spread)}`);
  console.log(`  valuation      top ${pct(val.top)}  bottom ${pct(val.bottom)}  spread ${pct(val.spread)}`);
  console.log(`  valuation discriminates ${(champ.spread > 0 ? val.spread / champ.spread : 0).toFixed(2)}x as widely`);

  console.log(`\n  divisions, strongest first:`);
  for (const d of rankings.divisions) {
    console.log(`    ${d.league.padEnd(9)} ${d.division.padEnd(6)} mean ${d.meanValuation.toFixed(1).padStart(5)}`
      + `  z ${d.z.toFixed(2).padStart(6)}  ${d.tag}`);
  }

  console.log(`\n  top 5, as the board presents it (${rankings.rankBasis}):`);
  for (const r of rankings.rows.slice(0, 5)) {
    console.log(`    ${String(r.rank).padStart(2)}. ${r.league.padEnd(9)} ${r.division.padEnd(6)}`
      + ` val ${r.valuation.toFixed(1).padStart(5)}  title ${pct(r.championshipPct)}  ${r.divisionTag}`);
  }

  /*
    Both orderings are built from scratch here, NOT from `rankings.rows`.

    An earlier version compared `rankings.rows` against a valuation-sorted copy. That was a real
    comparison while the default was championship, and became a TAUTOLOGY the moment the default
    changed to valuation -- it compared valuation with itself and cheerfully reported "yes". A
    comparison that cannot fail is not a check.
  */
  const byChampionship = [...rankings.rows].sort((l, r) => r.championshipPct - l.championshipPct);
  const byValuation = [...rankings.rows].sort((l, r) => r.valuation - l.valuation);
  const sameOrder = byChampionship.map((r) => r.teamId).join(',') === byValuation.map((r) => r.teamId).join(',');

  // Absolute gaps. A descending sort yields negative consecutive differences, so a naive minimum
  // reports the most-negative figure and calls every scenario narrow regardless of the data.
  const gapsOn = (list: typeof rankings.rows, pick: (r: (typeof list)[number]) => number) => {
    const g = list.slice(0, -1).map((r, i) => Math.abs(pick(list[i + 1]) - pick(r)));
    return g.length > 0 ? Math.min(...g) : 0;
  };
  const champGap = gapsOn(byChampionship, (r) => r.championshipPct);
  const valGap = gapsOn(byValuation, (r) => r.valuation / 100);

  console.log(`\n  smallest neighbouring gap, championship basis: ${pct(champGap)}`);
  console.log(`  smallest neighbouring gap, valuation basis:    ${pct(valGap)}`);
  console.log(`  the two orderings agree: ${sameOrder ? 'yes' : 'NO'}`);
  if (!sameOrder) {
    const best = byValuation[0];
    const champRank = byChampionship.findIndex((r) => r.teamId === best.teamId) + 1;
    console.log(`    strongest club by valuation (${best.valuation.toFixed(1)}) is rank ${champRank}`
      + ` of ${byChampionship.length} on championship probability, which gives it ${pct(best.championshipPct)}`);
  }
  console.log(`  championship basis: ${champGap < 0.005 ? 'adjacent rows within simulation noise -- UNUSABLE'
    : 'usable'}`);
  console.log(`  valuation basis:    ${valGap < 0.005 ? 'adjacent rows within noise' : 'usable'}`);
};

const main = async () => {
  console.log('\nPOWER RANKING SPREAD -- which column actually separates the clubs\n');
  await report('pristine universe', 0);
  await report('one month in', 30);
  await report('mid season', 90);
  console.log('');
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});