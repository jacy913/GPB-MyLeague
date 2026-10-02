/**
 * Are the run totals calibrated, and is the first-half share a guess or a fact?
 *
 * Two claims in mediaMarkets.ts need proving rather than assuming:
 *
 *   1. The totals model centres on this simulator's measured run environment,
 *      not the real one. If the predicted mean is near the real mean, the
 *      model is quietly importing the real-baseball figure.
 *   2. FIRST_HALF_SHARE is a constant. Completed games persist their
 *      inning-by-inning line score in stats.lineScore, so the actual share can
 *      be measured instead of estimated. If the constant is wrong, every
 *      first-five price is wrong by a fixed amount.
 *
 *   npx tsx tools/verifyMediaTotals.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters, getTeamRosterStrength } from '../src/logic/teamStrength';
import { MEDIA_PROFILES } from '../src/data/media';
import { buildTotalMarkets, buildFirstHalfMarkets, LEAGUE_RUNS_PER_TEAM_GAME, FIRST_HALF_SHARE } from '../src/lib/mediaMarkets';
import { buildMediaReads } from '../src/lib/mediaReads';
import { americanToProbability } from '../src/lib/markets';
import type { MediaId } from '../src/data/media';
import { listByMedia, uniformByMedia } from './mediaFixtures';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

const main = async (): Promise<void> => {
  const predicted = listByMedia<number>();
  const actualTotals: number[] = [];
  const actualFirstFive: number[] = [];
  /** [margin of actual total above the house line, did it go over] */
  const houseOverSamples: Array<{ predictedOver: number; over: boolean }> = [];
  let games = 0;

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const built = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year, seed: SEED, effectiveDate: `${year}-12-15`,
    });
    const playerState = built.playerState;
    let teams = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      playerState, year,
    );
    const schedule = buildSchedule(teams, year);

    const manager = new SimulationManager({
      teams, games: schedule, playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });

    for (let guard = 0; guard < 220; guard += 1) {
      const slateDate = state.currentDate;
      const teamById = new Map(state.teams.map((t) => [t.id, t]));

      const strength = getTeamRosterStrength(state.teams, playerState, year);
      const values = [...strength.values()];
      const strengthMean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
      const strengthSd = Math.sqrt(
        values.reduce((s, v) => s + (v - strengthMean) ** 2, 0) / Math.max(1, values.length),
      );

      const totals = buildTotalMarkets(
        state.games.filter((g) => g.date === slateDate && g.status !== 'completed'),
        {
          teams: state.teams, strength, strengthMean, strengthSd,
          hasSeasonOutput: state.teams.some((t) => t.wins + t.losses > 0),
        },
        teamById,
      );
      const firstFive = buildFirstHalfMarkets(totals);

      state = await manager.run({ scope: 'day' });

      for (const market of totals) {
        const gameId = market.key.replace('total:', '');
        const played = state.games.find((g) => g.gameId === gameId);
        if (!played || played.status !== 'completed') continue;
        games += 1;

        const actual = played.score.away + played.score.home;
        actualTotals.push(actual);
        for (const profile of MEDIA_PROFILES) predicted[profile.id].push(market.fair[profile.id]);
        houseOverSamples.push({
          // Bin by what the model PREDICTED, not by where the game landed.
          // Sorting by the actual margin is tautological -- a game that landed
          // over by one went over, so the table reports 100% in the over band
          // and proves nothing.
          predictedOver: mean(
            MEDIA_PROFILES.map((profile) => market.overProbability[profile.id]),
          ),
          over: actual > market.houseLine,
        });

        // The first-five share, measured from the persisted line score.
        const raw = played.stats?.lineScore;
        if (typeof raw === 'string' && raw.length > 0) {
          try {
            const parsed = JSON.parse(raw) as Array<{ inning: number; away: number; home: number }>;
            const first = parsed.filter((l) => l.inning <= 5)
              .reduce((s, l) => s + l.away + l.home, 0);
            if (actual > 0) actualFirstFive.push(first / actual);
          } catch { /* a game without a usable line score is simply skipped */ }
        }
        void firstFive;
      }
    }
    teams = state.teams;
  }

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${games} games\n`);

  console.log('RUN ENVIRONMENT');
  console.log(`  model baseline (per team-game)   ${LEAGUE_RUNS_PER_TEAM_GAME.toFixed(2)}`);
  console.log(`  actual mean (per game)           ${mean(actualTotals).toFixed(2)}`);
  console.log(`  actual median (per game)         ${median(actualTotals)}`);
  console.log(`  real-MLB reference (per game)    8.56  <- must NOT be what the model predicts`);
  console.log('');

  console.log('PER-OUTLET TOTAL, mean predicted vs actual');
  console.log('outlet              mean predicted   bias');
  for (const profile of MEDIA_PROFILES) {
    const predictedMean = mean(predicted[profile.id]);
    console.log(
      `${profile.outlet.padEnd(20)}${predictedMean.toFixed(2).padStart(16)}` +
      `${(predictedMean - mean(actualTotals) >= 0 ? '+' : '') + (predictedMean - mean(actualTotals)).toFixed(2)}`,
    );
  }

  console.log('\nFIRST-FIVE SHARE, measured from the persisted line score');
  if (actualFirstFive.length === 0) {
    console.log('  no completed game carried a usable lineScore');
  } else {
    console.log(`  samples                     ${actualFirstFive.length}`);
    console.log(`  measured mean share         ${mean(actualFirstFive).toFixed(4)}`);
    console.log(`  measured median share       ${median(actualFirstFive).toFixed(4)}`);
    console.log(`  constant used in the model  ` + FIRST_HALF_SHARE.toFixed(4));
    console.log(`  difference                  ${(FIRST_HALF_SHARE - mean(actualFirstFive)).toFixed(4)}`);
  }

  console.log('\nCALIBRATION OF THE HOUSE TOTAL, binned by what the model predicted');
  const BANDS: Array<[number, number, string]> = [
    [0, 0.4, 'under 40%'],
    [0.4, 0.5, '40-50%'],
    [0.5, 0.6, '50-60%'],
    [0.6, 1.01, 'over 60%'],
  ];
  console.log('  band            n     predicted   actual over   gap');
  BANDS.forEach(([lo, hi, label]) => {
    const inBand = houseOverSamples.filter((s) => s.predictedOver >= lo && s.predictedOver < hi);
    if (inBand.length === 0) return;
    const predicted = mean(inBand.map((s) => s.predictedOver));
    const actual = inBand.filter((s) => s.over).length / inBand.length;
    console.log(
      `  ${label.padEnd(15)}${String(inBand.length).padStart(5)}${predicted.toFixed(3).padStart(13)}` +
      `${actual.toFixed(3).padStart(16)}${((actual - predicted >= 0 ? '+' : '') + (actual - predicted).toFixed(3))}`,
    );
  });
  void americanToProbability;
};

void main();
