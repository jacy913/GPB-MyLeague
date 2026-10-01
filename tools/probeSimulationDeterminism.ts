/**
 * Is the simulation deterministic? `checkParkWiring` says it is not, and it needs to know.
 *
 * Two invocations of `checkParkWiring.ts` with the same window and the same universe seed
 * returned home-run gap correlations of 0.623, 0.563 and 0.393. Same code, same arguments,
 * three answers. Every threshold in that tool was therefore being applied to a single noisy
 * draw, and a check that flips between pass and fail depending on when it is run is worse than
 * no check at all -- it will eventually be deleted after failing once for no reason.
 *
 * So this answers the question directly and cheaply: build the SAME universe with the SAME
 * seed, simulate the same short window twice, and compare.
 *
 * If it is deterministic, `checkParkWiring` needs its variance explained instead. If it is not,
 * every park measurement has to average replicates -- which is the pattern
 * `verifyDevelopmentFeedback` already uses, reporting "mean of 3 replicates" throughout.
 *
 * Run: npx tsx tools/probeSimulationDeterminism.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const DAYS = Number(process.argv[2] ?? 12);
const SEED = 4242;

/** One run of the same short window, from the same seed. Returns a fingerprint of the outcome. */
const runOnce = async (): Promise<{ fingerprint: string; totalRuns: number; totalHr: number }> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR, seed: SEED, effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe, YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  let games: Game[] = [];
  let totalRuns = 0;
  let totalHr = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const r = await manager.run({ scope: 'day' });
    state = r.playerState;
    games = r.games;
    teams = r.teams;
  }

  // A fingerprint of every final score. Any divergence in the RNG anywhere upstream shows up
  // here, which is the point: comparing one aggregate could hide a divergence that averages
  // out, and comparing all of them cannot.
  const fingerprint = games
    .filter((g) => g.status === 'completed')
    .map((g) => `${g.gameId}:${g.score.home}-${g.score.away}`)
    .sort()
    .join('|');

  for (const g of games) {
    if (g.status !== 'completed') continue;
    totalRuns += g.score.home + g.score.away;
    const raw = g.stats?.playLog;
    if (typeof raw === 'string' && raw.length > 0) {
      try {
        const events = JSON.parse(raw) as Array<{ outcome?: string }>;
        for (const e of events) if (e.outcome === 'HR') totalHr += 1;
      } catch { /* a game whose log will not parse contributes nothing to this count */ }
    }
  }

  return { fingerprint, totalRuns, totalHr };
};

const main = async (): Promise<void> => {
  console.log('\nSIMULATION DETERMINISM\n');
  console.log(`  universe seed    ${SEED}`);
  console.log(`  window           ${DAYS} days`);

  const results = [];
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop
    results.push(await runOnce());
    console.log(`  run ${i + 1}             ${results[i].totalRuns} runs, ${results[i].totalHr} home runs, ${Date.now() - started}ms`);
  }

  const identical = results.every((r) => r.fingerprint === results[0].fingerprint);
  const runsAgree = results.every((r) => r.totalRuns === results[0].totalRuns);

  console.log('\n  fingerprints identical   ' + (identical ? 'YES' : 'NO'));
  console.log('  total runs identical     ' + (runsAgree ? 'YES' : 'NO'));
  console.log('  distinct fingerprints    ' + new Set(results.map((r) => r.fingerprint)).size + ' of 3');

  if (identical) {
    console.log(
      '\n  DETERMINISTIC. The variation `checkParkWiring` showed between runs therefore came'
        + '\n  from sampling noise in ITS OWN statistics rather than from the engine -- which'
        + '\n  still means its single-run thresholds are unreliable and it needs replicates,'
        + '\n  but it does mean a regression in the engine will reproduce exactly.',
    );
  } else {
    console.log(
      '\n  NOT DETERMINISTIC. Identical inputs produced different leagues, so the RNG is not'
        + '\n  seeded end to end. Two consequences, both of which matter more than this tool:'
        + '\n'
        + '\n    1. Any statistical threshold on a single run is measuring the dice as much as'
        + '\n       the thing under test. `checkParkWiring` must average replicates.'
        + '\n'
        + '\n    2. A simulation regression cannot be reproduced from a seed, so a failure'
        + '\n       reported here cannot be re-run to confirm. That is the more serious of the'
        + '\n       two, and it is a pre-existing condition of the engine rather than something'
        + '\n       the park work introduced.',
    );
  }
  console.log();
};

void main();