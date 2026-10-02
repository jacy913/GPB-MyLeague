/**
 * Are the posted lines calibrated?
 *
 * A price that is not calibrated is decoration. This takes the three outlets'
 * lines for every game of a slate, simulates them, and then asks the only
 * question that matters about a published probability: of the games priced at
 * 65 per cent, did roughly 65 per cent of them go that way?
 *
 * Also checks the construction itself. Averaging three American prices is not
 * the same as averaging three probabilities, and the difference is large enough
 * to be the whole design; this prints both so the gap is visible rather than
 * asserted.
 *
 *   npx tsx tools/verifyMediaOdds.ts 1337 3
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { MEDIA_PROFILES } from '../src/data/media';
import { buildMediaReads } from '../src/lib/mediaReads';
import { buildGameLine, probabilityToAmerican } from '../src/lib/mediaOdds';
import type { MediaId } from '../src/data/media';
import { emptyByMedia } from './mediaFixtures';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 3);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);

// Calibration bins: [floor, ceiling) of predicted probability.
const BINS: Array<[number, number]> = [[0, 0.35], [0.35, 0.45], [0.45, 0.55], [0.55, 0.65], [0.65, 1.01]];

type Bin = { n: number; predicted: number; actual: number };

const main = async (): Promise<void> => {
  const houseBins: Bin[] = BINS.map(() => ({ n: 0, predicted: 0, actual: 0 }));
  const outletScores = emptyByMedia(() => ({ n: 0, brier: 0, predicted: 0, actual: 0 }));
  let total = 0;
  let meanOfProbabilities: number[] = [];
  let meanOfPrices: number[] = [];

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const built = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year,
      seed: SEED,
      effectiveDate: `${year}-12-15`,
    });
    const playerState = built.playerState;
    const teams = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      playerState,
      year,
    );
    const games = buildSchedule(teams, year);

    const manager = new SimulationManager({
      teams,
      games,
      playerState,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });
    let guard = 0;

    while (guard < 220) {
      guard += 1;
      // Price what the next day-run will actually cover, not the next dated
      // slate: run({scope:'day'}) resolves state.currentDate, so pricing
      // getNextSlateDate would book a day the simulation never reaches.
      const slateDate = state.currentDate;

      const { scores, spread } = buildMediaReads({
        teams: state.teams,
        players: playerState.players,
        battingRatings: playerState.battingRatings,
        pitchingRatings: playerState.pitchingRatings,
        battingStats: playerState.battingStats,
        pitchingStats: playerState.pitchingStats,
        playerState,
        seasonYear: year,
      });

      /*
       * Derived from MEDIA_PROFILES rather than three hardcoded outlets. Widening
       * MediaId broke this literal in four tools at once; iterating the profile list
       * means the ninth forecaster needs no change here, and a missing outlet becomes a
       * neutral 0.5 rather than a hole.
       */
      /*
       * Derived from MEDIA_PROFILES rather than three hardcoded outlets. Widening
       * MediaId broke this literal in four tools at once; iterating the profile list
       * means the ninth forecaster needs no change here, and a missing outlet becomes a
       * neutral 0.5 rather than a hole.
       *
       * The return type is annotated because spreading an Object.fromEntries widens the
       * type to `{ [k: string]: number }` and silently stops satisfying
       * `Record<MediaId, number>`. That failure is caught at compile time here; it would
       * not be caught at runtime.
       */
      const scoreFor = (teamId: string): Record<MediaId, number> =>
        Object.fromEntries(
          MEDIA_PROFILES.map((profile) => [profile.id, scores[profile.id].get(teamId) ?? 0.5]),
        ) as Record<MediaId, number>;

      const lines = state.games
        .filter((game) => game.date === slateDate && game.status !== 'completed')
        .map((game) => {
          const away = state.teams.find((t) => t.id === game.awayTeam);
          const home = state.teams.find((t) => t.id === game.homeTeam);
          if (!away || !home) return null;
          return buildGameLine({ game, away, home, awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread });

        })
        .filter((line): line is NonNullable<typeof line> => line !== null);

      state = await manager.run({ scope: 'day' });
      const finalGames = state.games;

      for (const line of lines) {
        const played = finalGames.find((g) => g.gameId === line.gameId);
        if (!played || played.status !== 'completed') continue;
        const awayWon = played.score.away > played.score.home;
        total += 1;

        const binIndex = BINS.findIndex(([lo, hi]) => line.houseProbability >= lo && line.houseProbability < hi);
        if (binIndex >= 0) {
          const bin = houseBins[binIndex];
          bin.n += 1;
          bin.predicted += line.houseProbability;
          bin.actual += awayWon ? 1 : 0;
        }

        for (const profile of MEDIA_PROFILES) {
          const p = line.probability[profile.id];
          const acc = outletScores[profile.id];
          acc.n += 1;
          acc.brier += (p - (awayWon ? 1 : 0)) ** 2;
          acc.predicted += p;
          acc.actual += awayWon ? 1 : 0;
        }

        meanOfProbabilities.push(line.consensusProbability);
      }
    }
  }

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${total} priced games settled\n`);

  console.log('HOUSE LINE CALIBRATION');
  console.log('predicted band      n     mean predicted   actual   gap');
  BINS.forEach(([lo, hi], index) => {
    const bin = houseBins[index];
    if (bin.n === 0) return;
    const predicted = bin.predicted / bin.n;
    const actual = bin.actual / bin.n;
    const gap = actual - predicted;
    console.log(
      `  ${(lo * 100).toFixed(0).padStart(3)}-${(Math.min(hi, 1) * 100).toFixed(0).padStart(3)}%` +
      `${String(bin.n).padStart(7)}${predicted.toFixed(3).padStart(19)}${actual.toFixed(3).padStart(9)}` +
      `${(gap >= 0 ? '+' : '') + gap.toFixed(3)}`,
    );
  });

  console.log('\nPER-OUTLET, on the games each one priced');
  console.log('outlet              n     brier   mean predicted   actual');
  for (const profile of MEDIA_PROFILES) {
    const acc = outletScores[profile.id];
    if (acc.n === 0) continue;
    console.log(
      `${profile.outlet.padEnd(20)}${String(acc.n).padStart(6)}` +
      `${(acc.brier / acc.n).toFixed(4).padStart(10)}` +
      `${(acc.predicted / acc.n).toFixed(3).padStart(19)}` +
      `${(acc.actual / acc.n).toFixed(3).padStart(9)}`,
    );
  }

  console.log('\nmean predicted away win rate across all priced games');
  console.log(`  ${(mean(meanOfProbabilities) * 100).toFixed(2)}%`);
  console.log(`  a flat coin would be 50.00%`);

  console.log('\nconstruction check -- mean of prices vs mean of probabilities');
  const asPrices = meanOfProbabilities.map(probabilityToAmerican);
  console.log(`  mean consensus probability  ${mean(meanOfProbabilities).toFixed(4)}`);
  console.log(`  mean of the posted prices   ${mean(asPrices).toFixed(1)}`);
  console.log(`  price the mean probability  ${probabilityToAmerican(mean(meanOfProbabilities))}`);
};

void main();
