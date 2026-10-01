/**
 * Where does the 8.4s actually go?
 *
 * `measureSplitCost.ts` reported 8.42s to derive splits for a full simulated season and
 * 332/332 reconciliation, which settled the architecture as "lazy and cached, never in a
 * render". That is necessary and not sufficient. Before choosing between running the
 * derivation on the main thread in chunks and running it in a worker, the cost has to be
 * broken up, because the two approaches differ enormously depending on which half is
 * expensive:
 *
 *   - If the time is SPREAD (per-event work in the loop), chunking the main thread is
 *     cheap and a worker buys nothing but a thread.
 *
 *   - If the time is CONCENTRATED in `JSON.parse` of the stored log strings, a worker
 *     cannot help either, because the worker needs those strings. Transferring them costs
 *     a structured clone that is itself a copy of the whole payload.
 *
 * There is a third possibility that would change the decision outright: if the play logs
 * are enormous relative to the number of events in them, then the parse is paying for
 * fields this derivation never reads -- `description`, `batterName`, `pitcherName`,
 * `defenderName`, `scoringPlayerIds` and the scoreboard pair are all per-event strings
 * that splits do not use. In that case the honest fix is upstream of threading: do not
 * store what nothing reads.
 *
 * So this measures five things and prints them side by side:
 *
 *   1. PAYLOAD      total bytes of play log, and bytes per event
 *   2. PARSE        `JSON.parse` alone, with nothing else in the loop
 *   3. WALK         the event loop with parsing hoisted out, over pre-parsed events
 *   4. TRANSFER     `structuredClone` of the raw strings, as a proxy for the cost of
 *                   posting them into a worker
 *   5. FIELD COST   parse time when the log is reduced to only the fields splits read,
 *                   to size the win available from not storing the rest
 *
 * Run: npx tsx tools/measureSplitBackfill.ts [warmupDays] [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 20);
const DAYS = Number(process.argv[3] ?? 90);

/** The fields the splits derivation actually reads off a play-log event. */
const NEEDED = [
  'outcome', 'batterId', 'pitcherId', 'battingTeamId', 'inning', 'half',
] as const;

interface LogEvent {
  inning?: number;
  half?: string;
  battingTeamId?: string | null;
  outcome?: string;
  batterId?: string | null;
  pitcherId?: string | null;
}

const ms = (n: number): string => `${(n / 1000).toFixed(2)}s`;

/** Everything the walk step does, minus the parsing. */
const walk = (
  events: LogEvent[][],
  homeTeamOf: string[],
  throwHandById: Map<string, string>,
): number => {
  let acc = 0;
  for (let g = 0; g < events.length; g += 1) {
    const home = homeTeamOf[g];
    for (const event of events[g]) {
      if (!event.batterId || !event.outcome) continue;
      if (event.outcome === 'PITCHING_CHANGE' || event.outcome === 'HALF_END' || event.outcome === 'GAME_END') continue;
      acc += 1;
      if (event.battingTeamId === home) acc += 1;
      const hand = event.pitcherId ? throwHandById.get(event.pitcherId) : undefined;
      if (hand === 'L' || hand === 'R') acc += 1;
    }
  }
  return acc;
};

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR, seed: 4242, effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe, YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  for (let day = 0; day < WARMUP; day += 1) {
    state = (await manager.run({ scope: 'day' })).playerState;
  }

  const throwHandById = new Map(state.players.map((p) => [p.playerId, p.throws]));
  const rawStrings: string[] = [];
  const homeTeamOf: string[] = [];
  const seen = new Set<string>();

  for (let day = 0; day < DAYS; day += 1) {
    const r = await manager.run({ scope: 'day' });
    for (const game of r.games) {
      if (game.status !== 'completed' || seen.has(game.gameId)) continue;
      seen.add(game.gameId);
      const raw = (game as Game).stats?.playLog;
      if (typeof raw !== 'string' || raw.length === 0) continue;
      rawStrings.push(raw);
      homeTeamOf.push(game.homeTeam);
    }
    state = r.playerState;
  }

  // -- 1. PAYLOAD -----------------------------------------------------------------
  const bytes = rawStrings.reduce((n, s) => n + s.length, 0);
  let eventCount = 0;
  for (const s of rawStrings) {
    // Counted without a full parse where possible; a cheap comma count on the outcome
    // field is not reliable, so this uses the parse below's result instead.
    void s;
  }

  // -- 2. PARSE -------------------------------------------------------------------
  const parseStart = Date.now();
  const parsed: LogEvent[][] = rawStrings.map((s) => JSON.parse(s) as LogEvent[]);
  const parseMs = Date.now() - parseStart;
  for (const arr of parsed) eventCount += arr.length;

  // -- 3. WALK --------------------------------------------------------------------
  const walkStart = Date.now();
  const acc = walk(parsed, homeTeamOf, throwHandById);
  const walkMs = Date.now() - walkStart;

  // -- 4. TRANSFER ----------------------------------------------------------------
  const transferStart = Date.now();
  const cloned = structuredClone(rawStrings);
  const transferMs = Date.now() - transferStart;

  // -- 5. FIELD COST ---------------------------------------------------------------
  /*
   * Measure the win available from storing less, without changing storage.
   *
   * This re-parses each log and immediately projects it down to the fields splits read,
   * then serialises that projection. The re-parse dominates, so the projection time is
   * reported as the DIFFERENCE between a full round trip and a projected round trip. That
   * is deliberately a pessimistic measurement of the saving: the projection still has to
   * walk every event. What it does establish is whether a projected log is materially
   * smaller than the stored one, which is the part that would make storing less worth it.
   */
  const projectStart = Date.now();
  const projectedBytes = rawStrings.reduce((n, s) => {
    const events = JSON.parse(s) as Record<string, unknown>[];
    const slim = events.map((e) => {
      const out: Record<string, unknown> = {};
      for (const k of NEEDED) out[k] = e[k];
      return out;
    });
    return n + JSON.stringify(slim).length;
  }, 0);
  const projectMs = Date.now() - projectStart;

  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(2)} MB`;
  const totalMs = parseMs + walkMs;

  console.log('\nWHERE THE SPLIT BACKFILL GOES\n');
  console.log(`  window                 ${WARMUP} warmup + ${DAYS} days`);
  console.log(`  completed games        ${rawStrings.length}`);
  console.log(`  play-by-play events    ${eventCount.toLocaleString()}`);

  console.log('\n  1. PAYLOAD');
  console.log(`     stored play log       ${mb(bytes)}`);
  console.log(`     bytes per event       ${Math.round(bytes / Math.max(1, eventCount))}`);
  console.log(`     projected to 6 fields ${mb(projectedBytes)}  (${Math.round((projectedBytes / Math.max(1, bytes)) * 100)}% of stored)`);

  console.log('\n  2. PARSE   (JSON.parse only, nothing else)');
  console.log(`     ${ms(parseMs)}   ${Math.round((parseMs / Math.max(1, totalMs)) * 100)}% of the derivation`);
  console.log(`     throughput            ${mb(bytes)} in ${ms(parseMs)}`);

  console.log('\n  3. WALK    (events already parsed)');
  console.log(`     ${ms(walkMs)}   ${Math.round((walkMs / Math.max(1, totalMs)) * 100)}% of the derivation`);
  console.log(`     events touched        ${acc.toLocaleString()}`);

  console.log('\n  4. TRANSFER (structuredClone of the raw strings)');
  console.log(`     ${ms(transferMs)}   posting these into a worker costs this much before any work starts`);

  console.log('\n  5. FIELD COST (re-parse, project to the 6 fields splits read, re-serialise)');
  console.log(`     ${ms(projectMs)}`);

  console.log('\n  WHAT THIS IMPLIES');
  const parseShare = parseMs / Math.max(1, totalMs);
  if (transferMs > parseMs * 0.5) {
    console.log(
      '     A worker does NOT pay for itself on the backfill. Transferring the logs costs ' +
        '\n     more than half of the parse it would move off-thread, so the first open is ' +
        '\n     barely faster and the worker is pure added surface.',
    );
  } else {
    console.log(
      '     A worker is worth considering: the transfer is cheap against the parse, so ' +
        '\n     moving the parse off the main thread saves most of what it costs.',
    );
  }
  console.log(
    `     Parsing is ${Math.round(parseShare * 100)}% of the work, so chunking the main thread ` +
      '\n     bounds the jank directly: whichever half is larger, a chunk that fits the frame ' +
      '\n     budget bounds the stall. The cost is a first open that takes seconds, not a ' +
      '\n     stall that takes seconds.',
  );
  console.log(
    `     Storing only the ${NEEDED.length} fields splits reads would cut the stored log to ` +
      `${Math.round((projectedBytes / Math.max(1, bytes)) * 100)}% of its size. That is a storage` +
      '\n     change, not a UI change, and is out of scope here -- but it is the only change' +
      '\n     that would make this derivation cheap rather than merely tolerable.',
  );
  console.log();
};

void main();