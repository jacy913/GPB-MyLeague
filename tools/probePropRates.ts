/**
 * Probe: dump concrete prop calculations for one simulated day.
 *
 * The fitted model predicts 0.06 on prop lines that actually clear 0.34, and
 * reasoning about why has produced three wrong guesses in a row. This prints
 * actual numbers for actual players on an actual day -- season totals, games,
 * the shrunk mean, the line, the prediction and what really happened -- so the
 * discrepancy is visible in one screen.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import {
  BATTING_PROP_STATS,
  leaguePropBaselines, playerPropRate, propModelFor, propOverProbability,
  propStatMaps, reconstructPlayerGameLines, shrunkPerGame,
} from '../src/lib/playerProps';
import type { LeaguePlayerState } from '../src/types';

const YEAR = 2026;
const SEED = Number(process.argv[2] ?? 4242);
const WARMUP_DAYS = Number(process.argv[3] ?? 40);

const LADDER: Record<string, { offset: number; min: number; max: number }> = {
  hits: { offset: -0.35, min: 0.5, max: 4.5 },
  runs: { offset: -0.3, min: 0.5, max: 2.5 },
  rbi: { offset: -0.3, min: 0.5, max: 2.5 },
  walks: { offset: -0.3, min: 0.5, max: 2.5 },
  battingStrikeouts: { offset: -0.3, min: 0.5, max: 2.5 },
};

const boxScore = (stat: string, line: { hits: number; runsScored: number; rbi: number; walks: number; strikeouts: number }) =>
  stat === 'hits' ? line.hits
  : stat === 'runs' ? line.runsScored
  : stat === 'rbi' ? line.rbi
  : stat === 'walks' ? line.walks
  : stat === 'battingStrikeouts' ? line.strikeouts
  : 0;

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const roster = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );

  const manager = new SimulationManager({
    teams: roster,
    games: generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let previous: LeaguePlayerState = universe;
  for (let day = 0; day < WARMUP_DAYS; day += 1) {
    previous = (await manager.run({ scope: 'day' })).playerState;
  }

  const maps = propStatMaps(previous);
  const baselines = leaguePropBaselines(maps.batting, maps.pitching);

  console.log(`after ${WARMUP_DAYS} days`);
  console.log('baselines:');
  for (const [key, value] of Object.entries(baselines)) {
    console.log(`  ${key.padEnd(20)} ${value.toFixed(4)}`);
  }
  // Constants are per stat now, so the header lists them all rather than
  // pretending there is one pair. See PROP_MODEL_CONSTANTS in playerProps.ts.
  console.log('fitted per-stat constants:');
  for (const stat of BATTING_PROP_STATS) {
    const constants = propModelFor(stat);
    console.log(`  ${stat.padEnd(20)} priorGames=${constants.priorGames} dispersion=${constants.dispersion}`);
  }
  console.log('');

  // Raw league-average actual, straight from the aggregate. This is the number
  // the baselines are supposed to reproduce, and if the two disagree the bug is
  // in the baseline and not in the Poisson.
  let games = 0; let hits = 0; let runs = 0;
  maps.batting.forEach((row) => {
    if (row.gamesPlayed <= 0) return;
    games += row.gamesPlayed; hits += row.hits; runs += row.runsScored;
  });
  console.log(`aggregate: games ${games}, hits ${hits}, runs ${runs}`);
  console.log(`aggregate per game: hits ${(hits / Math.max(1, games)).toFixed(4)}, runs ${(runs / Math.max(1, games)).toFixed(4)}`);
  console.log('');

  console.log('sample player rates (their own season totals, games, shrunk mean):');
  let shown = 0;
  maps.batting.forEach((row, playerId) => {
    if (shown >= 10 || row.gamesPlayed <= 0) return;
    shown += 1;
    const raw = row.hits / row.gamesPlayed;
    const shrunk = shrunkPerGame(row.hits, row.gamesPlayed, baselines.hits, propModelFor('hits').priorGames);
    console.log(
      `  ${playerId.slice(4, 12)} G${String(row.gamesPlayed).padStart(3)} ` +
      `H${String(row.hits).padStart(4)} raw ${raw.toFixed(3)} shrunk ${shrunk.toFixed(3)}`,
    );
  });
  console.log('');

  // Now the end-to-end check on one fresh day: what would the board have said,
  // and what happened.
  const seen = new Set<string>();
  const result = await manager.run({ scope: 'day' });
  const fresh = result.games.filter((g) => g.status === 'completed' && !seen.has(g.gameId));
  console.log(`fresh completed games: ${fresh.length}`);
  console.log('');

  console.log('the next day, prop by prop, as the board would have published it:');
  console.log('player          stat                G   total  raw    shrunk line  pred   actual  won');

  let totalProps = 0; let totalWon = 0; let sumPred = 0; let sumActual = 0;
  for (const game of fresh.slice(0, 2)) {
    const { batting } = reconstructPlayerGameLines(game);
    batting.forEach((line, playerId) => {
      for (const stat of BATTING_PROP_STATS) {
        const ladder = LADDER[stat];
        if (!ladder) continue;
        const rate = playerPropRate(stat, playerId, maps.batting, maps.pitching);
        const mean = shrunkPerGame(rate.seasonTotal, rate.gamesPlayed, baselines[stat], propModelFor(stat).priorGames);
        const rawLine = Math.round((mean + ladder.offset) / 0.5) * 0.5;
        const offered = Math.min(ladder.max, Math.max(ladder.min, rawLine));
        const predicted = propOverProbability(mean, offered, propModelFor(stat).dispersion);
        const actual = boxScore(stat, line);
        const won = actual > offered;
        totalProps += 1; totalWon += won ? 1 : 0;
        sumPred += predicted; sumActual += won ? 1 : 0;
        if (totalProps <= 24) {
          console.log(
            `${playerId.slice(4, 12).padEnd(14)} ${stat.padEnd(19)} ` +
            `${String(rate.gamesPlayed).padStart(3)} ${String(rate.seasonTotal).padStart(6)}  ` +
            `${mean.toFixed(2).padStart(5)} ${mean.toFixed(2).padStart(6)} ${offered.toFixed(1).padStart(5)} ` +
            `${predicted.toFixed(3).padStart(6)} ${String(actual).padStart(6)}  ${won ? 'Y' : 'n'}`,
          );
        }
      }
    });
  }
  console.log('');
  console.log(`on this sample: n=${totalProps} predicted ${(sumPred / Math.max(1, totalProps)).toFixed(3)} realised ${(totalWon / Math.max(1, totalProps)).toFixed(3)}`);

  // The decisive comparison: the real distribution of each stat per player-game,
  // which is what the Poisson has to reproduce.
  console.log('');
  console.log('real per-player-game distribution over the fresh games:');
  const dist = new Map<string, Map<number, number>>();
  for (const game of fresh) {
    const { batting } = reconstructPlayerGameLines(game);
    batting.forEach((line, playerId) => {
      for (const stat of BATTING_PROP_STATS) {
        const value = boxScore(stat, line);
        let bucket = dist.get(stat);
        if (!bucket) { bucket = new Map(); dist.set(stat, bucket); }
        bucket.set(value, (bucket.get(value) ?? 0) + 1);
      }
    });
  }
  for (const stat of BATTING_PROP_STATS) {
    const bucket = dist.get(stat);
    if (!bucket) continue;
    const n = [...bucket.values()].reduce((s, v) => s + v, 0);
    const parts = [...bucket.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => `${value}:${((count / n) * 100).toFixed(0)}%`);
    console.log(`  ${stat.padEnd(19)} n=${String(n).padStart(5)}  ${parts.join('  ')}`);
  }
};

void main();
