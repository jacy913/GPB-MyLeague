/**
 * Diagnostic for the mirror budget accounting.
 *
 * The mirror's cost model said it would stay under budget and the verifier
 * measured it over. Rather than reason about why, this measures the two
 * numbers side by side so the discrepancy is visible.
 *
 * Run: npx tsx tools/probeMirrorAccounting.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { envelopeStats } from '../src/lib/localGamesMirror';
import type { Game, Team } from '../src/types';

const YEAR = 2026;
const SEED = 4242;
const DAYS = 20;

const main = async (): Promise<void> => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const blank: Team[] = INITIAL_TEAMS.map((t) => ({
    ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0,
  }));
  const teams = recalculateTeamRatingsFromRosters(blank, playerState, YEAR);
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });

  const mgr = new SimulationManager({
    teams, games: schedule, playerState, settings: DEFAULT_SETTINGS, currentDate: startDate,
  });

  const seen = new Set<string>();
  const games: Game[] = [];
  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    result.games.forEach((g) => {
      if (g.status === 'completed' && !seen.has(g.gameId)) {
        seen.add(g.gameId);
        games.push(g);
      }
    });
  }

  // Per-game, compare what the cost model charges against what the final
  // serialization actually contains for that same game.
  const charged: number[] = [];
  const actual: number[] = [];
  const emptyStats = '{}';
  games.forEach((game) => {
    const kept = envelopeStats(game.stats ?? {});
    charged.push(
      JSON.stringify({ ...game, stats: {} }).length - emptyStats.length
      + JSON.stringify(kept).length - emptyStats.length,
    );
    actual.push(JSON.stringify({ ...game, stats: kept }).length);
  });

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const arrayLength = JSON.stringify(games.map((g) => ({ ...g, stats: envelopeStats(g.stats ?? {}) }))).length;

  // What a single bulky field really costs, escaped.
  const sample = games[0];
  const rawLog = String(sample.stats.playLog ?? '');
  const rawParticipants = String(sample.stats.participants ?? '');
  const keptSample = envelopeStats(sample.stats);
  const logCost = JSON.stringify({ ...keptSample, playLog: rawLog }).length - JSON.stringify(keptSample).length;

  const out = {
    games: games.length,
    chargedTotal: sum(charged),
    actualTotal: sum(actual),
    arrayLength,
    arrayOverheadVsActualSum: arrayLength - sum(actual),
    perGame: {
      chargedMean: Math.round(sum(charged) / games.length),
      actualMean: Math.round(sum(actual) / games.length),
    },
    sampleBulkyField: {
      playLogRawLength: rawLog.length,
      playLogSerializedCost: logCost,
      escapeInflation: +(logCost / rawLog.length).toFixed(3),
      participantsRawLength: rawParticipants.length,
    },
  };

  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error('THREW', e);
  process.exit(1);
});
