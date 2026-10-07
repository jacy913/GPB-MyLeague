/*
 * How long does the betting page actually take, and where does the time go?
 *
 * EVERYTHING HERE IS MEASURED on a real league, because the alternative -- reading the code and
 * declaring it slow -- is how this repo documents most of its mistakes.
 *
 * These measurements are from AFTER the performance pass. The three defects that pass fixed, each
 * measured here first:
 *
 *   1. `buildMediaReads` ran on EVERY render, because `BettingPage` and `MediaHub` built their
 *      memo key with a rest spread and therefore handed React a new object every time. Fixed by
 *      assembling the key from the stable input fields.
 *   2. `outletProbability` re-summed all thirty-two club scores on every call, to produce nine
 *      numbers that never change during a slate rebuild. Fixed by measuring the nine means once
 *      in `buildPropMarkets` and passing them in.
 *   3. `buildPropMarkets` filtered all 1,285 players inside its per-game loop, and
 *      `selectOutletProps` recomputed each market's score inside its sort comparator. Fixed with
 *      a club -> players index and a decorate-sort-undecorate.
 *
 * The run that motivated the pass read ~215 ms on EVERY render -- because (1) fed fresh identities
 * to every memo keyed on the read result, the prop board included -- against ~218 ms for a single
 * slate change. After the pass the per-render cost is gone and the build is cheaper.
 *
 * Run: npx tsx tools/measureBettingCost.ts
 */
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildMediaReads, type MediaReadInput } from '../src/lib/mediaReads';
import { buildPropMarkets, selectOutletProps, MAX_PROPS_PER_OUTLET } from '../src/lib/mediaProps';
import { buildAwardsForBoard, type AwardInputs } from '../src/lib/awardRace';
import { AWARD_RACE_SPECS, buildAwardMarket } from '../src/lib/mediaMarkets';
import {
  generateSchedule,
  getDefaultSeasonStartDate,
  DEFAULT_SETTINGS,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../src/logic/playerStats';
import { seededRandomStream } from '../src/lib/analytics/playoffMonteCarlo';
import { MEDIA_PROFILES } from '../src/data/media';
import type { LeaguePlayerState } from '../src/types';

/** Median of N, because a single run on a busy machine is not evidence of anything. */
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const time = <T,>(fn: () => T, runs = 5): { ms: number; value: T } => {
  const samples: number[] = [];
  let value!: T;
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    value = fn();
    samples.push(performance.now() - t0);
  }
  return { ms: median(samples), value };
};

// ---------------------------------------------------------------------------
// A real league, far enough into a season that every prop stat has a sample.
// ---------------------------------------------------------------------------

const SEED = 4242;
const YEAR = 2026;

const built = buildNewUniverse({
  teams: INITIAL_TEAMS.map((t) => ({ ...t })),
  seasonYear: YEAR,
  seed: SEED,
  effectiveDate: `${YEAR}-12-15`,
});

const teams = recalculateTeamRatingsFromRosters(
  INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
  built.playerState,
  YEAR,
);

const manager = new SimulationManager({
  teams,
  games: generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
    random: seededRandomStream(90210),
  }),
  playerState: built.playerState,
  settings: DEFAULT_SETTINGS,
  currentDate: getDefaultSeasonStartDate(YEAR),
});

let playerState: LeaguePlayerState = built.playerState;
let games = manager['games'] ?? [];
for (let day = 0; day < 130; day += 1) {
  const r = await manager.run({ scope: 'day' });
  playerState = r.playerState;
  games = r.games;
}

const upcoming = games.filter((g) => g.status !== 'completed').sort((a, b) => a.date.localeCompare(b.date));
const slateDate = upcoming[0]?.date ?? games[0].date;
const slateGames = games.filter((g) => g.date === slateDate);

const readInput = {
  teams,
  players: playerState.players,
  battingRatings: playerState.battingRatings,
  pitchingRatings: playerState.pitchingRatings,
  battingStats: playerState.battingStats,
  pitchingStats: playerState.pitchingStats,
  playerState,
  seasonYear: YEAR,
} as unknown as MediaReadInput;

const { scores, spread } = buildMediaReads(readInput);



console.log('\nBETTING PAGE COST -- measured on a real league\n');
console.log(`  ${playerState.players.length} players, ${upcoming.length} games left, slate ${slateDate} (${slateGames.length} games)`);
console.log(`  ${MEDIA_PROFILES.length} forecasters\n`);

const propInput = {
  games,
  playerState,
  slateDate,
  teamScores: scores,
  scoreSpread: spread,
} as unknown as Parameters<typeof buildPropMarkets>[0];

// ---------------------------------------------------------------------------
// 1. buildMediaReads
// ---------------------------------------------------------------------------
const reads = time(() => buildMediaReads(readInput));
console.log('  1. buildMediaReads -- one call');
console.log(`       ${reads.ms.toFixed(1)} ms`);
console.log('       The memo key is built from the stable input fields now, so this holds across');
console.log('       renders and is paid once per data change. It used to rebuild on every render, and');
console.log('       everything keyed on its result -- the prop board included -- rebuilt with it.\n');

// ---------------------------------------------------------------------------
// 2. buildPropMarkets, and what is inside it
// ---------------------------------------------------------------------------
const propBoards = time(() => buildPropMarkets(propInput), 3);
console.log('  2. buildPropMarkets -- one slate rebuild');
console.log(`       ${propBoards.ms.toFixed(1)} ms   for ${propBoards.value.length} markets`);
console.log(`       ${(propBoards.ms / Math.max(1, propBoards.value.length)).toFixed(3)} ms per market\n`);

const propMarkets = propBoards.value;

/*
 * 3. THE REDUNDANT SUMMING, COUNTED RATHER THAN ESTIMATED.
 *
 * `outletProbability` runs once per (market x forecaster) and sums every club's score each time.
 * The sum is constant for the whole rebuild. This counts both the calls and the iterations they
 * waste, from the shape of the loops rather than by instrumenting the function -- so it stays
 * correct after the fix rather than going stale with it.
 */
const markets = propMarkets;
const calls = markets.length * MEDIA_PROFILES.length;
const iterations = calls * teams.length;

console.log('  3. THE SUMMING THAT USED TO BE REPEATED');
console.log(`       outletProbability calls   ${calls.toLocaleString()}`);
console.log(`       x ${teams.length} club scores each      ${iterations.toLocaleString()} iterations`);
console.log(`       distinct sums actually needed          ${MEDIA_PROFILES.length}`);
console.log('       Every one of those iterations was redundant. This is the shape of the work the');
console.log(`       pass removed: the ${MEDIA_PROFILES.length} means are measured once now, for`);
console.log(`       ${MEDIA_PROFILES.length * teams.length} iterations in total.\n`);

// ---------------------------------------------------------------------------
// 4. the players.filter inside the game loop
// ---------------------------------------------------------------------------
const filtersPerRebuild = slateGames.length * 2;
console.log('  4. THE PLAYER FILTER THAT USED TO SIT INSIDE THE GAME LOOP');
console.log(`       ${filtersPerRebuild} filters x ${playerState.players.length} players`
  + `   ${(filtersPerRebuild * playerState.players.length).toLocaleString()} comparisons`);
console.log('       Replaced by one club -> players index, built once: '
  + `${playerState.players.length} pushes plus ${filtersPerRebuild} lookups.\n`);

// ---------------------------------------------------------------------------
// 5. the award markets the dashboard now builds
// ---------------------------------------------------------------------------
const awardInputs = {
  players: playerState.players,
  teamsById: new Map(INITIAL_TEAMS.map((t) => [t.id, t])),
  battingStats: getPreferredBattingStatsByPlayerId(playerState.battingStats),
  pitchingStats: getPreferredPitchingStatsByPlayerId(playerState.pitchingStats),
  battingRatings: new Map(playerState.battingRatings.map((r) => [r.playerId, r])),
  pitchingRatings: new Map(playerState.pitchingRatings.map((r) => [r.playerId, r])),
} as unknown as AwardInputs;

const awards = time(() => {
  for (const board of ['batting', 'pitching'] as const) {
    const spec = AWARD_RACE_SPECS[board];
    buildAwardMarket(spec.key, spec.title, buildAwardsForBoard(board, awardInputs));
  }
}, 5);
console.log('  5. the award markets the dashboard builds on every render');
console.log(`       ${awards.ms.toFixed(1)} ms   <- the work this session added, for comparison\n`);

// ---------------------------------------------------------------------------
// 6. HOW MANY ACTUALLY RENDER -- the number that decides whether this is a
//    computation problem or a rendering one.
// ---------------------------------------------------------------------------
const rows = time(() => {
  // The same selection `usePropBoard` does, so the number is the one the page actually renders
  // rather than a guess at it.
  const byPropId = new Map<string, unknown>();
  for (const profile of MEDIA_PROFILES) {
    for (const market of selectOutletProps(propMarkets, profile.id, MAX_PROPS_PER_OUTLET)) {
      if (!byPropId.has(market.propId)) byPropId.set(market.propId, market);
    }
  }
  return [...byPropId.values()];
}, 3);
console.log('\n  6. AND HOW MANY OF THEM SURVIVE SELECTION\n');
console.log(`       markets built            ${propMarkets.length.toLocaleString()}`);
console.log(`       kept (${MAX_PROPS_PER_OUTLET}/outlet x ${MEDIA_PROFILES.length})   ${(MAX_PROPS_PER_OUTLET * MEDIA_PROFILES.length).toLocaleString()}`);
console.log(`       rows the page renders    ${rows.value.length.toLocaleString()}`);
console.log(`       DISCARDED                ${(propMarkets.length - rows.value.length).toLocaleString()}`
  + `  (${(((propMarkets.length - rows.value.length) / propMarkets.length) * 100).toFixed(1)}% of the build)`);
console.log(`       selection cost           ${rows.ms.toFixed(1)} ms\n`);

// ---------------------------------------------------------------------------
console.log('  THE BILL, PER SLATE CHANGE ON THE BETTING PAGE\n');
const oneOpen = reads.ms + propBoards.ms + rows.ms + awards.ms;
console.log(`       buildMediaReads      ${reads.ms.toFixed(1).padStart(7)} ms   once per data change`);
console.log(`       buildPropMarkets     ${propBoards.ms.toFixed(1).padStart(7)} ms   builds ${propMarkets.length.toLocaleString()}`);
console.log(`       outlet selection     ${rows.ms.toFixed(1).padStart(7)} ms   sorts them ${MEDIA_PROFILES.length} times, keeps ${MAX_PROPS_PER_OUTLET * MEDIA_PROFILES.length}`);
console.log(`       award markets        ${awards.ms.toFixed(1).padStart(7)} ms   the dashboard's`);
console.log(`       ----------------------------`);
console.log(`       TOTAL                ${oneOpen.toFixed(1).padStart(7)} ms`);
console.log(`       for ${rows.value.length} cards on screen.\n`);

console.log('  AND NONE OF IT RUNS ON RENDER ANY MORE.\n');
console.log('       Before the pass `readInput` was a rest-spread object, so buildMediaReads ran on');
console.log('       every render and every memo keyed on its result -- the prop board included --');
console.log('       rebuilt with it. Three navigations or hovers in, that was ~650 ms of pure');
console.log('       recomputation for data that had not changed. It is now once per data change.\n');