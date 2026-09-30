/**
 * Can player props settle from what a saved league actually persists?
 *
 * This is the gate on the whole props feature, so it is worth being precise about
 * what is in question.
 *
 * A completed game persists, in `game.stats`: the score, the line score, the
 * full play log, the participants, and team totals for hits and errors. What it
 * does NOT persist is the per-player box score. `session.playerStats` is returned
 * from the engine as `CompletedGameResult.playerStatDelta` and immediately
 * folded into season aggregates; it never lands on the Game.
 *
 * So a prop bet cannot settle by reading the box score off a saved game -- there
 * isn't one on the save. It can only settle by deriving the player's line from
 * something that IS on the save, and the only candidate with enough detail is
 * the play log.
 *
 * This tool measures whether that derivation is EXACT, by deriving each player's
 * box score from the play log and comparing it against ground truth obtained a
 * different way: the change in season aggregates across a single simulated day.
 * A player appears in at most one game a day, so that change IS the box score.
 * Two independent routes to the same number, so a mismatch means the derivation
 * is wrong rather than that the truth moved.
 *
 * Ground truth comes from aggregate diffing rather than by instrumenting the
 * engine, precisely so that nothing in src/logic has to be touched or trusted.
 *
 * If any field fails to match exactly, the props feature has to either drop that
 * stat or persist the box score, and this file says which.
 *
 * Run: npx tsx tools/verifyPlayLogProps.ts [seed] [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import type {
  Game,
  LeaguePlayerState,
  PlayLogEvent,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
} from '../src/types';

const SEED = Number(process.argv[2] ?? 20261);
const DAYS = Number(process.argv[3] ?? 12);
const YEAR = 2026;

type BattingCounts = {
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  runsScored: number;
  rbi: number;
};

type PitchingCounts = {
  games: number;
  inningsPitched: number;
  hitsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
};

const emptyBatting = (): BattingCounts => ({
  plateAppearances: 0, atBats: 0, hits: 0, doubles: 0, triples: 0,
  homeRuns: 0, walks: 0, strikeouts: 0, runsScored: 0, rbi: 0,
});

const emptyPitching = (): PitchingCounts => ({
  games: 0, inningsPitched: 0, hitsAllowed: 0, earnedRuns: 0, walks: 0, strikeouts: 0,
});

/**
 * Rebuild every player line from the play log alone.
 *
 * Each branch below is a transcription of one branch of the engine's own
 * `resolvePlayLogEvent`, which is where the counting rules actually live. The
 * engine credits plate appearances on every logged outcome, plate appearances
 * without an at-bat only on a walk, a hit only on 1B/2B/3B/HR, and RBI to the
 * batter only when the play carried one -- an error on a reached base scores the
 * runner but explicitly credits no RBI. Reading those branches is the only way
 * to get this right; inferring the rules from baseball produces the wrong
 * answer on errors and on walks.
 */
const reconstructFromPlayLog = (events: PlayLogEvent[]) => {
  const batting = new Map<string, BattingCounts>();
  const pitching = new Map<string, PitchingCounts>();

  const bat = (id: string) => {
    const existing = batting.get(id);
    if (existing) return existing;
    const fresh = emptyBatting();
    batting.set(id, fresh);
    return fresh;
  };
  const pit = (id: string) => {
    const existing = pitching.get(id);
    if (existing) return existing;
    const fresh = emptyPitching();
    pitching.set(id, fresh);
    return fresh;
  };

  for (const event of events) {
    const outcome = event.outcome;
    if (!event.batterId) continue;
    const b = bat(event.batterId);

    b.plateAppearances += 1;
    if (outcome !== 'BB') b.atBats += 1;

    if (outcome === '1B' || outcome === '2B' || outcome === '3B' || outcome === 'HR') {
      b.hits += 1;
    }
    if (outcome === '2B') b.doubles += 1;
    if (outcome === '3B') b.triples += 1;
    if (outcome === 'HR') b.homeRuns += 1;

    if (event.rbi > 0) b.rbi += event.rbi;

    // A walk and a hit are the two outcomes that can bring a runner home, and
    // the engine hands each scoring runner their own entry in scoringPlayerIds.
    for (const runnerId of event.scoringPlayerIds ?? []) {
      bat(runnerId).runsScored += 1;
    }

    if (!event.pitcherId) continue;
    const p = pit(event.pitcherId);

    if (outcome === 'SO') {
      b.strikeouts += 1;
      p.strikeouts += 1;
    }
    if (outcome === 'BB') {
      b.walks += 1;
      p.walks += 1;
    }
    if (outcome === '1B' || outcome === '2B' || outcome === '3B' || outcome === 'HR') {
      p.hitsAllowed += 1;
    }
    if ((event.scoringPlayerIds ?? []).length > 0 && event.rbi >= 0 && outcome !== 'ERR') {
      p.earnedRuns += (event.scoringPlayerIds ?? []).length;
    }
  }

  return { batting, pitching };
};

const readPlayLog = (game: Game): PlayLogEvent[] | null => {
  const raw = game.stats?.playLog;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PlayLogEvent[]) : null;
  } catch {
    return null;
  }
};

const snapshotBatting = (state: LeaguePlayerState) =>
  new Map(state.battingStats.map((s) => [s.playerId, s]));
const snapshotPitching = (state: LeaguePlayerState) =>
  new Map(state.pitchingStats.map((s) => [s.playerId, s]));

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const roster = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({
      ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0,
    })),
    universe,
    YEAR,
  );

  const games = generateSchedule(roster, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
  });

  const manager = new SimulationManager({
    teams: roster,
    games,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  const BATTING_FIELDS: Array<keyof BattingCounts> = [
    'plateAppearances', 'atBats', 'hits', 'doubles', 'triples',
    'homeRuns', 'walks', 'strikeouts', 'runsScored', 'rbi',
  ];
  const PITCHING_FIELDS: Array<keyof PitchingCounts> = [
    'hitsAllowed', 'earnedRuns', 'walks', 'strikeouts',
  ];

  const battingChecks = new Map<string, { ok: number; bad: number }>();
  const pitchingChecks = new Map<string, { ok: number; bad: number }>();
  const bump = (m: Map<string, { ok: number; bad: number }>, k: string, ok: boolean) => {
    const row = m.get(k) ?? { ok: 0, bad: 0 };
    if (ok) row.ok += 1; else row.bad += 1;
    m.set(k, row);
  };

  let previous: LeaguePlayerState = universe;
  const seenGameIds = new Set<string>();
  let gamesChecked = 0;
  let gamesWithoutLog = 0;
  let playersChecked = 0;
  const failures: string[] = [];

  for (let day = 0; day < DAYS; day += 1) {
    // SimulationManager keeps its player state private, so the "before" snapshot
    // is carried forward from the previous run's result rather than read off the
    // manager. Same number, and it does not depend on the class's visibility.
    const beforeBat = snapshotBatting(previous);
    const beforePit = snapshotPitching(previous);

    const result = await manager.run({ scope: 'day' });
    const afterBat = snapshotBatting(result.playerState);
    const afterPit = snapshotPitching(result.playerState);
    previous = result.playerState;

    const completed = result.games.filter(
      // SimulationManager.run returns the whole accumulated games array, so
      // filtering on 'completed' alone re-checks every game played on every
      // earlier day against THIS day's aggregate delta. That produced a nonsense
      // verdict -- field-by-field match rates scattered between 39% and 96%, and
      // 1090 "games checked" over 12 days in a league that plays ~15 a day.
      // Only games not already accounted for may be compared, and the aggregate
      // delta only covers the day just simulated.
      (g) => g.status === 'completed' && !seenGameIds.has(g.gameId),
    );

    for (const game of completed) {
      seenGameIds.add(game.gameId);
    }

    for (const game of completed) {
      const events = readPlayLog(game);
      if (!events) { gamesWithoutLog += 1; continue; }
      gamesChecked += 1;

      const truth = reconstructFromPlayLog(events);

      // Ground truth by aggregate delta. A player is in at most one game on a
      // given day, so the season-total change is that one game's line.
      for (const [playerId, derived] of truth.batting) {
        const before = beforeBat.get(playerId);
        const after = afterBat.get(playerId);
        if (!after) continue;

        const delta = (key: keyof BattingCounts): number => {
          const now = after[key] as number;
          const was = (before?.[key] as number | undefined) ?? 0;
          return now - was;
        };

        playersChecked += 1;
        for (const field of BATTING_FIELDS) {
          const ok = derived[field] === delta(field);
          bump(battingChecks, field, ok);
          if (!ok && failures.length < 12) {
            failures.push(
              `batting ${playerId} ${field}: playlog=${derived[field]} aggregate=${delta(field)}`,
            );
          }
        }
      }

      for (const [playerId, derived] of truth.pitching) {
        const before = beforePit.get(playerId);
        const after = afterPit.get(playerId);
        if (!after) continue;

        const delta = (key: keyof PitchingCounts): number => {
          const now = after[key] as number;
          const was = (before?.[key] as number | undefined) ?? 0;
          return now - was;
        };

        for (const field of PITCHING_FIELDS) {
          const ok = derived[field] === delta(field);
          bump(pitchingChecks, field, ok);
          if (!ok && failures.length < 12) {
            failures.push(
              `pitching ${playerId} ${field}: playlog=${derived[field]} aggregate=${delta(field)}`,
            );
          }
        }
      }
    }
  }

  console.log(`seed ${SEED} · ${DAYS} simulated days`);
  console.log(`completed games with a usable play log: ${gamesChecked}`);
  console.log(`completed games missing a play log:     ${gamesWithoutLog}`);
  console.log(`player-games compared:                  ${playersChecked}`);
  console.log('');

  const report = (label: string, checks: Map<string, { ok: number; bad: number }>) => {
    console.log(label);
    for (const [field, row] of checks) {
      const total = row.ok + row.bad;
      const pct = total === 0 ? 0 : (row.ok / total) * 100;
      console.log(`  ${field.padEnd(18)} ${String(row.ok).padStart(6)}/${String(total).padEnd(6)} ${pct.toFixed(2)}%`);
    }
  };

  report('batting, play log vs season-aggregate delta:', battingChecks);
  console.log('');
  report('pitching, play log vs season-aggregate delta:', pitchingChecks);

  if (failures.length > 0) {
    console.log('');
    console.log('mismatches (first 12):');
    failures.forEach((f) => console.log('  ' + f));
  }

  const allOk = [...battingChecks.values(), ...pitchingChecks.values()]
    .every((row) => row.bad === 0);
  console.log('');
  console.log(allOk
    ? 'VERDICT: every checked stat reconstructs EXACTLY from the persisted play log.'
    : 'VERDICT: at least one stat does NOT reconstruct. Those props cannot settle from a save.');
};

void main();
