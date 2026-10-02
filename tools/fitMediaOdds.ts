/**
 * Fit each outlet's price slope by minimising Brier against settled games.
 *
 * The slopes in lib/mediaOdds.ts are not free parameters and must not be guessed.
 * A slope that is too flat posts a coin flip with a price on it; too steep prices
 * coin flips at 90 per cent. The first attempt at this used hand-picked slopes
 * and scored a Brier of 0.266, which is WORSE than always calling 50/50 (0.250) --
 * actively harmful information wearing a price.
 *
 * This dumps the Brier curve for each outlet over a slope grid, so the shipped
 * value is the measured minimum rather than an opinion.
 *
 *   npx tsx tools/fitMediaOdds.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { MEDIA_PROFILES } from '../src/data/media';
import { buildMediaReads } from '../src/lib/mediaReads';
import type { MediaId } from '../src/data/media';
import { listByMedia, uniformByMedia } from './mediaFixtures';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const clamp = (v: number): number => Math.max(0.02, Math.min(0.98, v));
const logistic = (v: number): number => 1 / (1 + Math.exp(-v));

const SLOPES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.4, 1.9];
const HOME_ADV = 0.04;

// Collected once: (z-score of the gap, did the away side win) per outlet.
const samples = listByMedia<{ z: number; won: boolean }>();

const main = async (): Promise<void> => {
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
      teams, games, playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });
    for (let guard = 0; guard < 220; guard += 1) {
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

      const priced = state.games
        .filter((g) => g.date === slateDate && g.status !== 'completed')
        .map((g) => {
          const away = state.teams.find((t) => t.id === g.awayTeam);
          const home = state.teams.find((t) => t.id === g.homeTeam);
          if (!away || !home) return null;
          const z = {} as Record<MediaId, number>;
          for (const profile of MEDIA_PROFILES) {
            const gap = (scores[profile.id].get(away.id) ?? 0.5) - (scores[profile.id].get(home.id) ?? 0.5);
            z[profile.id] = gap / Math.max(0.02, spread[profile.id]);
          }
          return { gameId: g.gameId, z };
        })
        .filter((v): v is { gameId: string; z: Record<MediaId, number> } => v !== null);

      state = await manager.run({ scope: 'day' });

      for (const entry of priced) {
        const played = state.games.find((g) => g.gameId === entry.gameId);
        if (!played || played.status !== 'completed') continue;
        const won = played.score.away > played.score.home;
        for (const profile of MEDIA_PROFILES) {
          samples[profile.id].push({ z: entry.z[profile.id], won });
        }
      }
    }
  }

  const n = samples.hollis.length;
  console.log(`seed ${SEED}   ${SEASONS} seasons   ${n} games per outlet\n`);
  console.log(`a flat 50/50 call scores Brier 0.2500 -- anything above that is worse than useless\n`);

  let bestSlope = uniformByMedia(0);

  for (const profile of MEDIA_PROFILES) {
    const rows = samples[profile.id];
    const results = SLOPES.map((slope) => {
      const brier = rows.reduce((sum, s) => {
        const p = clamp(logistic(s.z * slope - HOME_ADV));
        return sum + (p - (s.won ? 1 : 0)) ** 2;
      }, 0) / Math.max(1, rows.length);
      return { slope, brier };
    });
    const best = results.reduce((a, b) => (b.brier < a.brier ? b : a));
    bestSlope[profile.id] = best.slope;

    console.log(`${profile.outlet}`);
    console.log('  slope   brier    vs coin');
    for (const r of results) {
      const delta = r.brier - 0.25;
      const marker = r.slope === best.slope ? '  <-- best' : '';
      console.log(
        `  ${r.slope.toFixed(2).padStart(5)}   ${r.brier.toFixed(4)}   ${(delta >= 0 ? '+' : '') + delta.toFixed(4)}${marker}`,
      );
    }
    console.log('');
  }

  console.log('slopes to ship:');
  for (const profile of MEDIA_PROFILES) {
    console.log(`  ${profile.id.padEnd(9)} ${bestSlope[profile.id]}`);
  }
};

void main();
