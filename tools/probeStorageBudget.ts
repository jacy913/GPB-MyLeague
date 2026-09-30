/**
 * Measures how big a persisted game actually is, and where the bytes go.
 *
 * The storage quota fallback has to choose what to drop, and every threshold in
 * it should come from measurement rather than taste. This runs real games from
 * real seeds and reports the distribution of each stats field, plus what a full
 * season's worth of games costs against the localStorage budget.
 *
 * Run: npx tsx tools/probeStorageBudget.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import type { Game, Team } from '../src/types';

const DAYS = Number(process.argv[2] ?? 30);
const YEAR = 2026;
const SEED = 4242;

/**
 * localStorage is a UTF-16 store, so bytes are counted as UTF-16 code units,
 * which is what actually counts against the ~5,000,000 unit origin quota.
 */
const units = (value: unknown): number => (value == null ? 0 : JSON.stringify(value).length);

const pct = (value: number, total: number): string => (total === 0 ? '0.00%' : `${((value / total) * 100).toFixed(2)}%`);

/**
 * localStorage is a per-origin budget, not a per-key one, and the spec value
 * is the same 5 MiB every Chromium-family browser enforces. It is a platform
 * constant rather than a property of this league, so it is stated here once.
 */
const LOCAL_STORAGE_TOTAL_QUOTA_UNITS = 5 * 1024 * 1024;

const describe = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    mean: Math.round(sum / Math.max(1, sorted.length)),
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    totalMB: +(sum / 1024 / 1024).toFixed(2),
  };
};

const main = async () => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const blank: Team[] = INITIAL_TEAMS.map((t) => ({
    ...t,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  }));
  const teams = recalculateTeamRatingsFromRosters(blank, playerState, YEAR);
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, {
    seasonStartDate: startDate,
    seasonDays: 180,
  });

  const mgr = new SimulationManager({
    teams,
    games: schedule,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: startDate,
  });

  // run() returns the whole accumulated game list, so only newly completed
  // games are measured -- re-measuring an earlier game would weight the
  // distribution toward the first days of the season.
  const seen = new Set<string>();
  const games: Game[] = [];
  // The end-of-run player state, which is what the sibling keys are sized from.
  // The season's transactions and ratings grow as the season is played, so
  // measuring them against the pre-run state would understate the real cost.
  let playerStateRef = playerState;
  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    playerStateRef = result.playerState;
    result.games.forEach((game) => {
      if (game.status === 'completed' && !seen.has(game.gameId)) {
        seen.add(game.gameId);
        games.push(game);
      }
    });
  }

  if (games.length === 0) {
    console.error('No completed games to measure.');
    process.exit(1);
  }

  const fields = [
    'playLog',
    'participants',
    'lineScore',
  ] as const;

  const perField: Record<string, number[]> = {};
  const perFieldTotal: Record<string, number> = {};
  fields.forEach((f) => {
    perField[f] = [];
    perFieldTotal[f] = 0;
  });

  const gameUnits: number[] = [];
  const envelopeUnits = games.map((g) => units({ ...g, stats: {} }));
  const fullUnits = games.map((g) => units(g));

  games.forEach((game, index) => {
    gameUnits.push(fullUnits[index]);
    fields.forEach((field) => {
      const size = units(game.stats[field]);
      perField[field].push(size);
      perFieldTotal[field] += size;
    });
  });

  const envelopeTotal = envelopeUnits.reduce((a, b) => a + b, 0);
  const fullTotal = fullUnits.reduce((a, b) => a + b, 0);

  const out: Record<string, unknown> = {
    days: DAYS,
    completedGames: games.length,
    structuralEnvelope: { mean: Math.round(envelopeTotal / games.length) },
    fullGame: describe(gameUnits),
    perField: Object.fromEntries(
      fields.map((f) => [
        f,
        {
          perGame: describe(perField[f]),
          shareOfTotalBytes: pct(perFieldTotal[f], fullTotal),
          shareOfNonPlayLogBytes: pct(perFieldTotal[f], fullTotal - perFieldTotal.playLog),
        },
      ]),
    ),
    scalarStatsBytesTotal: fullTotal - envelopeTotal - perFieldTotal.playLog - perFieldTotal.participants - perFieldTotal.lineScore,
  };

  // ---- the rest of the origin ----
  // localStorage is a per-origin budget shared by every key, not a per-key
  // one. The games mirror budget is a fraction of the quota precisely because
  // these seven keys live in the same 5 MB, and how much they actually take is
  // a measurement, not an assumption.
  const siblingKeys: Record<string, number> = {
    glb_teams: units(teams),
    glb_settings: units(DEFAULT_SETTINGS),
    glb_players: units(playerState.players),
    glb_batting_stats: units(playerState.battingStats),
    glb_pitching_stats: units(playerState.pitchingStats),
    glb_batting_ratings: units(playerState.battingRatings),
    glb_pitching_ratings: units(playerState.pitchingRatings),
    glb_roster_slots: units(playerState.rosterSlots),
    glb_player_transactions: units(playerState.transactions),
  };
  const siblingTotal = Object.values(siblingKeys).reduce((a, b) => a + b, 0);
  out.siblingKeys = {
    note: 'Measured at the end of the run, from the same state the app would save.',
    units: siblingKeys,
    siblingTotalUnits: siblingTotal,
    siblingTotalMB: +(siblingTotal / 1024 / 1024).toFixed(2),
    projectedSeasonSiblingTotalMB: +((siblingTotal / DAYS) * 180 / 1024 / 1024).toFixed(2),
    quotaUnits: LOCAL_STORAGE_TOTAL_QUOTA_UNITS,
    headroomLeftForGamesUnits: LOCAL_STORAGE_TOTAL_QUOTA_UNITS - siblingTotal,
    headroomLeftForGamesMB: +((LOCAL_STORAGE_TOTAL_QUOTA_UNITS - siblingTotal) / 1024 / 1024).toFixed(2),
  };

  // What a full 162-game season across 32 teams costs, extrapolated from the mean.
  const meanGame = fullTotal / games.length;
  const seasonGames = 32 * 81; // half of a double round robin
  out.projectedSeason = {
    games: seasonGames,
    meanGameUnits: Math.round(meanGame),
    totalMB: +((meanGame * seasonGames) / 1024 / 1024).toFixed(2),
    localStorageOriginQuotaMB: 5,
    verdict: (meanGame * seasonGames) > 5 * 1024 * 1024
      ? 'EXCEEDS localStorage quota -- fallback will engage'
      : 'fits localStorage',
  };

  // Where each tier would land at season scale, given the measured distribution.
  out.fallbackAnalysis = {
    note: 'Bytes per game at season scale, against a 5 MiB origin quota.',
    perGame: {
      fullGame: Math.round(fullTotal / games.length),
      withoutPlayLog: Math.round((fullTotal - perFieldTotal.playLog) / games.length),
      envelopeOnly: Math.round((envelopeTotal + perFieldTotal.lineScore) / games.length),
    },
    seasonMB: {
      full: +(((fullTotal / games.length) * seasonGames) / 1024 / 1024).toFixed(2),
      withoutPlayLog: +((((fullTotal - perFieldTotal.playLog) / games.length) * seasonGames) / 1024 / 1024).toFixed(2),
      envelopeOnly: +((((envelopeTotal + perFieldTotal.lineScore) / games.length) * seasonGames) / 1024 / 1024).toFixed(2),
    },
  };

  // ---- participants composition ----
  // participants is the second-largest field and, unlike playLog, its size is
  // near-constant per game. That points at duplicated player records rather
  // than at anything that varies with the game, so it is worth knowing which
  // part of it carries the weight before proposing to slim it.
  const breakdown: Record<string, number> = {};
  const sample = games[0];
  const participants = typeof sample?.stats.participants === 'string'
    ? JSON.parse(sample.stats.participants) as {
        awayLineup: Array<Record<string, unknown>>;
        homeLineup: Array<Record<string, unknown>>;
        awayStarter: Record<string, unknown> | null;
        homeStarter: Record<string, unknown> | null;
        awayBullpen: Array<Record<string, unknown>>;
        homeBullpen: Array<Record<string, unknown>>;
      }
    : null;

  if (participants) {
    const all: Array<Record<string, unknown>> = [
      ...participants.awayLineup,
      ...participants.homeLineup,
      ...(participants.awayStarter ? [participants.awayStarter] : []),
      ...(participants.homeStarter ? [participants.homeStarter] : []),
      ...participants.awayBullpen,
      ...participants.homeBullpen,
    ];
    const fields = new Set<string>();
    all.forEach((p) => Object.keys(p).forEach((k) => fields.add(k)));
    fields.forEach((f) => {
      breakdown[f] = all.reduce((acc, p) => acc + (p[f] == null ? 0 : units(p[f])), 0);
    });
    out.participantsBreakdown = {
      participantCount: all.length,
      totalUnits: units(participants),
      byField: Object.fromEntries(
        Object.entries(breakdown)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => [k, { units: v, share: pct(v, units(participants)) }]),
      ),
    };
  }

  // ---- how many games actually fit in localStorage ----
  out.fitsInLocalStorage = {
    quotaUnits: LOCAL_STORAGE_TOTAL_QUOTA_UNITS,
    fullGames: Math.floor(LOCAL_STORAGE_TOTAL_QUOTA_UNITS / (fullTotal / games.length)),
    envelopePlusLineScoreGames: Math.floor(
      LOCAL_STORAGE_TOTAL_QUOTA_UNITS / ((envelopeTotal / games.length) + (perFieldTotal.lineScore / games.length)),
    ),
    envelopePlusLineScorePlusScalarGames: Math.floor(
      LOCAL_STORAGE_TOTAL_QUOTA_UNITS / (
        (fullTotal - perFieldTotal.playLog - perFieldTotal.participants) / games.length
      ),
    ),
    note: 'Envelope is everything except stats. Scalar = hits/errors/pitcher ids/finalInning/simulatedAt.',
  };

  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error('THREW', e);
  process.exit(1);
});
