/**
 * The futures temperature in SCORE units, which is what the board actually uses.
 *
 * tools/fitFuturesTemperature.ts established the behaviour: the three reads name
 * the right division winner 62.5% of the time against 25% for a blind pick, and
 * a steeper board scores better at every temperature because that lead is real.
 * What it could not give is a number, because it works in rank distance and the
 * shipped board works in the forecaster's raw score.
 *
 * This closes that gap. It reads the actual score distribution out of a live
 * season, so the conversion from "how confident should the leader look" to "what
 * number goes in the source" is measured rather than guessed.
 *
 *   npx tsx tools/fitFuturesScale.ts 1337 1
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { MEDIA_PROFILES } from '../src/data/media';
import { probabilityToAmerican } from '../src/lib/markets';

const SEED = Number(process.argv[2] ?? 1337);
const START_YEAR = 2026;
const SAMPLE_AFTER = 400;

const main = async (): Promise<void> => {
  const year = START_YEAR;
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: year, seed: SEED, effectiveDate: `${year}-12-15`,
  });
  const playerState = built.playerState;
  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    playerState, year,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 }),
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(year),
  });

  let state = await manager.run({ scope: 'week' });
  for (let guard = 0; guard < 220; guard += 1) {
    if (state.games.filter((g) => g.status === 'completed').length >= SAMPLE_AFTER) break;
    state = await manager.run({ scope: 'day' });
  }

  const { scores } = buildMediaReads({
    teams: state.teams,
    players: state.playerState.players,
    battingRatings: state.playerState.battingRatings,
    pitchingRatings: state.playerState.pitchingRatings,
    battingStats: state.playerState.battingStats,
    pitchingStats: state.playerState.pitchingStats,
    playerState: state.playerState,
    seasonYear: year,
  });

  const groups = new Map<string, string[]>();
  state.teams.forEach((team) => {
    const key = `${team.league} ${team.division}`;
    groups.set(key, [...(groups.get(key) ?? []), team.id]);
  });

  console.log(`seed ${SEED}   read taken after ${SAMPLE_AFTER} games   ${groups.size} divisions\n`);
  console.log('SCORE DISTRIBUTION WITHIN A DIVISION');
  console.log('The board runs exp((score - groupMean) * T), so what matters is the');
  console.log('gap between neighbouring clubs in raw score units.\n');
  console.log('  outlet                 min gap   median gap   max gap   full span');

  const spans: Record<string, number[]> = {};
  MEDIA_PROFILES.forEach((profile) => {
    const gaps: number[] = [];
    const spansInGroup: number[] = [];
    groups.forEach((members) => {
      const values = members.map((id) => scores[profile.id].get(id) ?? 0).sort((a, b) => a - b);
      spansInGroup.push(values[values.length - 1] - values[0]);
      for (let i = 1; i < values.length; i += 1) gaps.push(values[i] - values[i - 1]);
    });
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)] ?? 0;
    spans[profile.id] = spansInGroup;
    console.log(
      `  ${profile.outlet.padEnd(22)}${median.toFixed(3).padStart(8)}` +
      `${(gaps[Math.floor(gaps.length * 0.5)] ?? 0).toFixed(3).padStart(12)}` +
      `${(gaps[gaps.length - 1] ?? 0).toFixed(3).padStart(9)}` +
      `${(spansInGroup.reduce((a, b) => a + b, 0) / spansInGroup.length).toFixed(3).padStart(12)}`,
    );
    if (profile.id === MEDIA_PROFILES[0].id) {
      console.log(`  ${'(min gap above is the smallest)'.padEnd(22)}`);
    }
  });

  console.log('\nWHAT TEMPERATURE PRODUCES A REAL BOARD');
  console.log('fitFuturesTemperature established the read names the right division');
  console.log('winner about 62.5% of the time, so the leader genuinely deserves');
  console.log('roughly 55-60%. The table below is what each temperature posts.\n');
  console.log('   temp   leader p   leader price   2nd price   last price   distinct');

  const firstGroup = [...groups.values()][0];
  const exampleScores = firstGroup.map((id) => scores[MEDIA_PROFILES[0].id].get(id) ?? 0);
  const mean = exampleScores.reduce((a, b) => a + b, 0) / exampleScores.length;

  [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.60].forEach((T) => {
    const exps = exampleScores.map((s) => Math.exp((s - mean) * T));
    const total = exps.reduce((a, b) => a + b, 0);
    const p = exps.map((e) => e / total).sort((a, b) => b - a);
    console.log(
      `  ${T.toFixed(2).padStart(6)}` +
      `${(p[0] * 100).toFixed(1).padStart(11)}%` +
      `${String(probabilityToAmerican(p[0])).padStart(14)}` +
      `${String(probabilityToAmerican(p[1] ?? 0.5)).padStart(13)}` +
      `${String(probabilityToAmerican(p[p.length - 1] ?? 0.5)).padStart(13)}` +
      `${String(new Set(p.map((v) => probabilityToAmerican(v))).size).padStart(11)}`,
    );
  });

  console.log('\n  Target: leader near 55-60%, second close behind, a real dog at the');
  console.log('  back, and every price distinct. Pick the temperature that lands there');
  console.log('  and put THAT number in FUTURES_TEMPERATURE, not a rank-space value.');
};

void main();
