/**
 * What does the moneyline curve actually look like?
 *
 * tools/fitMediaOdds.ts fitted a logistic SLOPE by minimising Brier score, and
 * that is the right target for a forecaster: it is the score you get judged on
 * and it weights the games you are most likely to see. It is the wrong target
 * for a book, though. Brier is dominated by the middle of the distribution, so a
 * slope can be near-optimal overall and still badly mispriced in the tail -- and
 * the tail is where a bettor goes looking for an edge.
 *
 * This dumps the empirical win rate by z-score decile so the true curve can be
 * read off directly, rather than inferred from a summary statistic.
 *
 *   npx tsx tools/fitMoneylineCalibration.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { probabilityToAmerican } from '../src/lib/mediaOdds';
import { MEDIA_PROFILES } from '../src/data/media';
import type { MediaId } from '../src/data/media';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

interface Sample { z: number; hit: boolean; mediaId: MediaId }

const main = async (): Promise<void> => {
  const samples: Sample[] = [];
  let games = 0;

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
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
      teams, games: buildSchedule(teams, year), playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });

    for (let guard = 0; guard < 220; guard += 1) {
      const slateDate = state.currentDate;
      const { scores, spread } = buildMediaReads({
        teams: state.teams,
        players: state.playerState.players,
        battingRatings: state.playerState.battingRatings,
        pitchingRatings: state.playerState.pitchingRatings,
        battingStats: state.playerState.battingStats,
        pitchingStats: state.playerState.pitchingStats,
        playerState: state.playerState,
        seasonYear: year,
      });
      const teamById = new Map(state.teams.map((t) => [t.id, t]));

      const pending = state.games.filter((g) => g.date === slateDate).map((game) => {
        const away = teamById.get(game.awayTeam);
        const home = teamById.get(game.homeTeam);
        if (!away || !home) return null;
        return { game, away, home };
      }).filter((e): e is NonNullable<typeof e> => e !== null);

      state = await manager.run({ scope: 'day' });

      pending.forEach(({ game, away, home }) => {
        const played = state.games.find((g) => g.gameId === game.gameId);
        if (!played || played.status !== 'completed') return;
        games += 1;
        // "Hit" means the AWAY side won, so the z sign matches the probability.
        const hit = played.score.away > played.score.home;
        MEDIA_PROFILES.forEach((profile) => {
          const rawGap = (scores[profile.id].get(away.id) ?? 0.5) - (scores[profile.id].get(home.id) ?? 0.5);
          samples.push({
            z: rawGap / Math.max(0.02, spread[profile.id] ?? 1),
            hit,
            mediaId: profile.id,
          });
        });
      });
    }
  }

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${games} games   ${samples.length} outlet-game samples\n`);

  const quantiles = (values: number[]): number[] => {
    const sorted = [...values].sort((a, b) => a - b);
    return [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
      .map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
  };
  const edges = quantiles(samples.map((s) => s.z));
  edges.push(samples.reduce((m, s) => Math.max(m, s.z), -Infinity) + 0.001);

  console.log('EMPIRICAL WIN RATE BY Z DECILE, all three outlets pooled');
  console.log('the "posted" column is the shipped slope of 0.30; the gap is the book\'s exposure\n');
  console.log('   z range            n     mean z   actual   posted(0.30)   gap');
  const logistic = (v: number): number => 1 / (1 + Math.exp(-v));

  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const band = samples.filter((s) => s.z >= lo && s.z < hi);
    if (band.length < 30) continue;
    const actual = band.filter((s) => s.hit).length / band.length;
    const meanZ = band.reduce((sum, s) => sum + s.z, 0) / band.length;
    const posted = logistic(meanZ * 0.30);
    const error = Math.sqrt(Math.max(1e-9, actual * (1 - actual) / band.length));
    const gap = actual - posted;
    const flag = Math.abs(gap) > 2.5 * error ? '  <-- tail' : '';
    console.log(
      `   ${`${lo.toFixed(2)} to ${hi.toFixed(2)}`.padEnd(18)}${String(band.length).padStart(5)}` +
      `${meanZ.toFixed(3).padStart(10)}${actual.toFixed(3).padStart(9)}` +
      `${posted.toFixed(3).padStart(15)}${(gap >= 0 ? '+' : '') + (gap * 100).toFixed(1).padStart(8)}${flag}`,
    );
  }

  /* ---------------- a recalibration slope ---------------- */

  console.log('\nPER OUTLET, the same table. Each has its own slope, so they cannot be');
  console.log('read off the pooled curve above.\n');
  MEDIA_PROFILES.forEach((profile) => {
    const own = samples.filter((s) => s.mediaId === profile.id);
    console.log(`  ${profile.outlet}`);
    console.log('     z range          n     actual   posted    gap');
    for (let i = 0; i < edges.length - 1; i += 1) {
      const band = own.filter((s) => s.z >= edges[i] && s.z < edges[i + 1]);
      if (band.length < 30) continue;
      const actual = band.filter((s) => s.hit).length / band.length;
      const meanZ = band.reduce((sum, s) => sum + s.z, 0) / band.length;
      const posted = logistic(meanZ * (profile.id === 'sharply' ? 0.80 : profile.id === 'glorest' ? 0.25 : 0.30));
      const error = Math.sqrt(Math.max(1e-9, actual * (1 - actual) / band.length));
      const gap = actual - posted;
      const flag = Math.abs(gap) > 2.5 * error ? '  <-- tail' : '';
      console.log(
        `     ${`${edges[i].toFixed(2)} to ${edges[i + 1].toFixed(2)}`.padEnd(15)}` +
        `${String(band.length).padStart(5)}${actual.toFixed(3).padStart(10)}` +
        `${posted.toFixed(3).padStart(10)}${((gap >= 0 ? '+' : '') + (gap * 100).toFixed(1)).padStart(8)}${flag}`,
      );
    }
    console.log('');
  });

  console.log('\nWHAT SLOPE ACTUALLY CALIBRATES THE CURVE?');
  console.log('Scored two ways. Brier is what the outlets are judged on. Max-gap is');
  console.log('the worst mispricing anywhere on the board, which is what a bettor hunts.\n');
  console.log('   slope    brier   worst band gap   price of the strongest side');

  const scoreFor = (slope: number) => {
    let brierSum = 0;
    const bands: Array<{ lo: number; hi: number; n: number; hits: number; posted: number }> = [];
    const s = samples.map((sample) => ({ ...sample, p: logistic(sample.z * slope) }));
    brierSum = s.reduce((sum, sample) => sum + (sample.p - (sample.hit ? 1 : 0)) ** 2, 0) / s.length;
    for (let i = 0; i < edges.length - 1; i += 1) {
      const band = s.filter((sample) => sample.z >= edges[i] && sample.z < edges[i + 1]);
      if (band.length < 30) continue;
      const actual = band.filter((sample) => sample.hit).length / band.length;
      bands.push({
        lo: edges[i], hi: edges[i + 1], n: band.length,
        hits: band.filter((sample) => sample.hit).length,
        posted: band.reduce((sum, sample) => sum + sample.p, 0) / band.length,
      });
      void actual;
    }
    const worst = bands.reduce((max, band) => {
      const actual = band.hits / band.n;
      return Math.max(max, Math.abs(actual - band.posted));
    }, 0);
    const strongest = s
      .filter((sample) => sample.z > 0)
      .sort((a, b) => b.z - a.z)
      .slice(0, Math.floor(s.length * 0.02));
    const strongestP = strongest.reduce((sum, sample) => sum + sample.p, 0) / Math.max(1, strongest.length);
    return { brier: brierSum, worst, strongest: strongestP };
  };

  for (const slope of [0.16, 0.20, 0.24, 0.30, 0.36, 0.42]) {
    const { brier, worst, strongest } = scoreFor(slope);
    console.log(
      `   ${slope.toFixed(2).padStart(5)}${brier.toFixed(4).padStart(9)}` +
      `${(worst * 100).toFixed(1).padStart(17)} pts` +
      `${probabilityToAmerican(strongest).toString().padStart(26)}`,
    );
  }
};

void main();
