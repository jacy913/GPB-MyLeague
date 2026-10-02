/**
 * Do the three forecasters actually behave differently?
 *
 * The characters only justify themselves if their reads differ in accuracy, not
 * just in method. A forecaster that is supposed to be reliable and one that is
 * supposed to be overconfident must be measurably different, and the
 * attention-driven one must be worst -- otherwise the personalities are
 * decoration on three copies of the same model.
 *
 * Method: build a universe, take all three reads from an early-season state,
 * simulate the rest of the season, and score each read against what actually
 * happened. Two measures, because they answer different questions:
 *
 *   Spearman rho  -- does the ordering match? Rewards getting the top and the
 *                    bottom right, which is what a bettor cares about.
 *   Brier score   -- after converting the read's index into a calibrated win
 *                    probability, how close is the forecast. Rewards not being
 *                    overconfident, which is the stated flaw of the third.
 *
 * Lower Brier is better. Higher rho is better.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { MEDIA_PROFILES } from '../src/data/media';
import { buildMediaReads } from '../src/lib/mediaReads';
import type { MediaId } from '../src/data/media';
import { emptyByMedia } from './mediaFixtures';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 3);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const spearman = (a: number[], b: number[]): number => {
  const n = a.length;
  const rank = (values: number[]): number[] => {
    const order = values.map((value, index) => ({ value, index })).sort((l, r) => l.value - r.value);
    const ranks = new Array<number>(n);
    order.forEach((entry, position) => { ranks[entry.index] = position + 1; });
    return ranks;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (n + 1) / 2;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ra[i] - mean;
    const y = rb[i] - mean;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
};

/** Index 0-100 -> a probability the team wins more than it loses. */
const indexToProbability = (index: number): number => 1 / (1 + Math.pow(10, (50 - index) / 25));

const accumulators = emptyByMedia(() => ({ rho: [] as number[], brier: [] as number[], top: 0 }));

const main = async (): Promise<void> => {
let snapshots = 0;

for (let season = 0; season < SEASONS; season += 1) {
  let teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: START_YEAR + season,
      seed: SEED,
      effectiveDate: `${START_YEAR + season}-12-15`,
    }).playerState,
    START_YEAR + season,
  );

  const games = buildSchedule(teams, START_YEAR + season);
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: START_YEAR + season,
    seed: SEED,
    effectiveDate: `${START_YEAR + season}-12-15`,
  }).playerState;

  teams = recalculateTeamRatingsFromRosters(teams, playerState, START_YEAR + season);

  // Read taken from a barely-started season, so this is a genuine forecast
  // rather than a description of what already happened.
  const partial: typeof teams = teams.map((t) => ({ ...t }));
  const manager = new SimulationManager({
    teams: partial,
    games,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(START_YEAR + season),
  });
  const early = await manager.run({ scope: 'month' });

  const earlyTeams = early.teams;
  const reads = buildMediaReads({
    teams: earlyTeams,
    players: playerState.players,
    battingRatings: playerState.battingRatings,
    pitchingRatings: playerState.pitchingRatings,
    battingStats: playerState.battingStats,
    pitchingStats: playerState.pitchingStats,
    playerState,
    seasonYear: START_YEAR + season,
  });

  const result = await manager.run({ scope: 'season' });
  void manager;
  const finalTeams = result.teams;
  snapshots += 1;

  const finalWinPct = finalTeams.map((t) => (t.wins + t.losses > 0 ? t.wins / (t.wins + t.losses) : 0.5));
  const finalById = new Map(finalTeams.map((t) => [t.id, t]));

  for (const profile of MEDIA_PROFILES) {
    const rows = reads.reads[profile.id].rows;
    const predicted = rows.map((r) => r.index);
    const actual = rows.map((r) => finalById.get(r.team.id)!.wins + finalById.get(r.team.id)!.losses > 0
      ? finalById.get(r.team.id)!.wins / (finalById.get(r.team.id)!.wins + finalById.get(r.team.id)!.losses)
      : 0.5);

    accumulators[profile.id].rho.push(spearman(predicted, actual));

    // Brier against a 0.5 coin flip per game over the season's final record.
    let brier = 0;
    rows.forEach((r) => {
      const team = finalById.get(r.team.id)!;
      const games = team.wins + team.losses;
      if (games === 0) return;
      const p = indexToProbability(r.index);
      const actualWinPct = team.wins / games;
      brier += (p - actualWinPct) ** 2;
    });
    accumulators[profile.id].brier.push(brier / rows.length);

    if (rows[0].team.id === [...finalTeams].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || b.wins - a.wins)[0].id) {
      accumulators[profile.id].top += 1;
    }
  }
  void finalWinPct;
}

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);

console.log(`seed ${SEED}   ${SEASONS} seasons   ${snapshots} forecasts taken from a one-month state\n`);
console.log('outlet            spearman rho    brier score    top pick correct');
console.log('----------------------------------------------------------------');
const order = [...MEDIA_PROFILES].sort(
  (a, b) => mean(accumulators[b.id].rho) - mean(accumulators[a.id].rho),
);
for (const profile of order) {
  const acc = accumulators[profile.id];
  console.log(
    `${profile.outlet.padEnd(18)}${mean(acc.rho).toFixed(3).padStart(10)}` +
    `${mean(acc.brier).toFixed(4).padStart(15)}` +
    `${`${acc.top}/${snapshots}`.padStart(19)}`,
  );
}

console.log('\nhigher rho and lower brier are better.');
console.log('the attention-driven outlet is meant to be the weakest; if it is not, the characters are decoration.');
};

void main();
