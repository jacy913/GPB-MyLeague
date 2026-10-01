/**
 * Do the split lines reconcile with the engine, and does the incremental cache hold still?
 *
 * A splits panel that disagrees with the leaders table beside it is a WORSE defect than
 * having no splits panel, because nothing on screen would say so. The two sit next to each
 * other and look equally authoritative, and a reader who checks neither has no way to know
 * which is lying.
 *
 * So the central assertion is the reconciliation, and it is deliberately a comparison of
 * two INDEPENDENT paths to the same number: the split's `season` line is derived from the
 * play log, and the engine's own `PlayerSeasonBatting` is computed from the engine. If
 * `season` were read from the stored aggregate instead of derived, this check would be
 * comparing the engine with itself and would be incapable of failing.
 *
 * Three further things are checked that are not about arithmetic and are where this kind
 * of code actually goes wrong:
 *
 *   - THE AT-BAT INVARIANT. Every split line must satisfy `atBats + walks ==
 *     plateAppearances`, because that is the definition `gameEngine.ts:1330-1358` implies.
 *     Asserted on every line rather than only on the reconciled totals, so a bucket that
 *     drifts is caught even when the bucket is small.
 *
 *   - CACHE IDEMPOTENCE. The cache is module-level and incremental, which is exactly the
 *     kind of thing that is correct on the first call and wrong on the second. Called
 *     twice with the same games, it must fold in nothing further and return identical
 *     rows. Without this the failure mode is silent and looks like performance.
 *
 *   - RESET DETERMINISM. `resetSplits` must reproduce the same rows from the same input.
 *     If incremental accumulation depends on order or on residue, the answer changes
 *     depending on what was derived earlier in the session, which is unfalsifiable from
 *     the screen.
 *
 * Run: npx tsx tools/checkSplits.ts [warmupDays] [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { battingMetrics } from '../src/lib/analytics/metrics';
import {
  deriveSplits,
  derivedGameCount,
  PARTITIONING_SPLITS,
  platoonCoverage,
  resetSplits,
  SPLIT_KINDS,
  type SplitKind,
  type SplitLine,
} from '../src/lib/analytics/splits';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import type { Game, LeaguePlayerState, PlayerSeasonBatting, Team } from '../src/types';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 20);
const DAYS = Number(process.argv[3] ?? 90);

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/** Every field of a line that must agree with the engine's stored aggregate. */
const SEASON_FIELDS: ReadonlyArray<keyof SplitLine> = [
  'plateAppearances', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns', 'walks', 'strikeouts',
];

const totals = (lines: SplitLine[]): SplitLine =>
  lines.reduce<SplitLine>((acc, line) => {
    acc.plateAppearances += line.plateAppearances;
    acc.atBats += line.atBats;
    acc.hits += line.hits;
    acc.doubles += line.doubles;
    acc.triples += line.triples;
    acc.homeRuns += line.homeRuns;
    acc.walks += line.walks;
    acc.strikeouts += line.strikeouts;
    return acc;
  }, {
    gamesPlayed: 0, plateAppearances: 0, atBats: 0, hits: 0, doubles: 0, triples: 0,
    homeRuns: 0, walks: 0, strikeouts: 0, runsScored: 0, rbi: 0,
  });

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
  let games: Game[] = [];
  for (let day = 0; day < WARMUP + DAYS; day += 1) {
    const r = await manager.run({ scope: 'day' });
    state = r.playerState; games = r.games; teams = r.teams;
  }

  const completed = games.filter((g) => g.status === 'completed');

  resetSplits();
  const started = Date.now();
  const table = deriveSplits(games, state.players);
  const elapsed = Date.now() - started;

  const statsById = new Map<string, PlayerSeasonBatting>(state.battingStats.map((s) => [s.playerId, s]));

  // -- 1. THE RECONCILIATION ---------------------------------------------------------
  let seasonOk = 0;
  let seasonCompared = 0;
  const seasonDetail: string[] = [];

  table.forEach((row, playerId) => {
    const stat = statsById.get(playerId);
    if (!stat) return;
    seasonCompared += 1;
    const bad = SEASON_FIELDS.filter((f) => row.season[f] !== stat[f]);
    if (bad.length === 0) seasonOk += 1;
    else if (seasonDetail.length < 3) {
      seasonDetail.push(
        `${playerId}: derived ${bad.map((f) => `${f} ${row.season[f]}`).join(', ')}`
        + ` vs stored ${bad.map((f) => `${f} ${stat[f]}`).join(', ')}`,
      );
    }
  });

  check(
    'the derived season line equals the engine\'s stored aggregate, field for field',
    seasonCompared > 0 && seasonOk === seasonCompared,
    seasonCompared === 0 ? 'nothing to compare -- the derivation produced no players'
      : `${seasonOk}/${seasonCompared}${seasonDetail.length ? `; e.g. ${seasonDetail[0]}` : ''}`,
  );

  // -- 2. THE PARTITIONING AXES -------------------------------------------------------
  let partitionOk = 0;
  let partitionCompared = 0;
  const partitionDetail: string[] = [];

  table.forEach((row, playerId) => {
    const stat = statsById.get(playerId);
    if (!stat) return;
    partitionCompared += 1;
    const sum = totals(PARTITIONING_SPLITS.map((k) => row[k]));
    const bad = SEASON_FIELDS.filter((f) => sum[f] !== row.season[f]);
    if (bad.length === 0) partitionOk += 1;
    else if (partitionDetail.length < 3) {
      partitionDetail.push(`${playerId}: home+road ${bad.map((f) => `${f} ${sum[f]}`).join(', ')} vs season ${bad.map((f) => `${f} ${row.season[f]}`).join(', ')}`);
    }
    // The stronger statement, stated where it can be seen: the partition agrees with the
    // ENGINE, not merely with our own season line. If home+road agreed with a derived
    // season line that was itself wrong, this would still pass.
    if (sum.atBats !== stat.atBats && partitionDetail.length < 4) {
      partitionDetail.push(`${playerId}: home+road atBats ${sum.atBats} vs engine ${stat.atBats}`);
    }
  });

  check(
    'home + road partitions the season line exactly, for every player',
    partitionCompared > 0 && partitionOk === partitionCompared,
    partitionCompared === 0 ? 'nothing to compare' : `${partitionOk}/${partitionCompared}${partitionDetail.length ? `; e.g. ${partitionDetail[0]}` : ''}`,
  );

  // -- 3. THE SUBSETTING AXES --------------------------------------------------------
  let subsetOk = 0;
  let subsetCompared = 0;
  table.forEach((row, playerId) => {
    const stat = statsById.get(playerId);
    if (!stat) return;
    subsetCompared += 1;
    const sum = totals([row.vs_left, row.vs_right]);
    // Subset, NOT equality. Home and road partition because every plate appearance is one
    // or the other. Platoon need not: an appearance with no resolved pitcher falls into
    // neither bucket, and requiring equality here would be asserting a fact about the data
    // rather than about the code. Coverage is reported separately.
    if (SEASON_FIELDS.every((f) => sum[f] <= row.season[f])) subsetOk += 1;
  });
  check(
    'vs LHP and vs RHP are a subset of the season line, never a superset',
    subsetCompared > 0 && subsetOk === subsetCompared,
    `${subsetOk}/${subsetCompared}`,
  );

  // -- 4. THE AT-BAT INVARIANT, ON EVERY LINE ----------------------------------------
  let invariantChecked = 0;
  const invariantBad: string[] = [];
  table.forEach((row, playerId) => {
    for (const kind of SPLIT_KINDS) {
      const line = row[kind];
      invariantChecked += 1;
      if (line.atBats + line.walks !== line.plateAppearances && invariantBad.length < 3) {
        invariantBad.push(`${playerId}/${kind}: ${line.atBats}AB + ${line.walks}BB != ${line.plateAppearances}PA`);
      }
    }
  });
  check(
    'every split line satisfies atBats + walks == plateAppearances',
    invariantBad.length === 0,
    invariantBad.length ? invariantBad[0] : `${invariantChecked} lines checked`,
  );

  // -- 5. NO EMPTY ROWS ---------------------------------------------------------------
  let emptyRows = 0;
  table.forEach((row) => { if (row.season.plateAppearances === 0) emptyRows += 1; });
  check('no player holds a split row with zero plate appearances', emptyRows === 0, `${emptyRows} empty rows`);

  // -- 6. CACHE IDEMPOTENCE ----------------------------------------------------------
  const afterFirst = derivedGameCount();
  const snapshot = new Map<string, Record<SplitKind, SplitLine>>(
    [...table.entries()].map(([id, row]) => [id, JSON.parse(JSON.stringify(row)) as Record<SplitKind, SplitLine>]),
  );
  const second = deriveSplits(games, state.players);
  const afterSecond = derivedGameCount();

  check(
    'a second call with the same games folds in nothing further',
    afterFirst === afterSecond,
    `processed ${afterFirst} then ${afterSecond}`,
  );

  let identical = second.size === snapshot.size;
  if (identical) {
    for (const [id, row] of snapshot) {
      const now = second.get(id);
      if (!now) { identical = false; break; }
      for (const kind of SPLIT_KINDS) {
        for (const f of SEASON_FIELDS) {
          if (now[kind][f] !== row[kind][f]) { identical = false; break; }
        }
        if (!identical) break;
      }
      if (!identical) break;
    }
  }
  check(
    'a second call with the same games returns identical rows',
    identical,
    identical ? `${snapshot.size} players compared field for field` : 'rows differ between calls',
  );

  // -- 7. RESET DETERMINISM ----------------------------------------------------------
  resetSplits();
  check('reset clears the processed-game count', derivedGameCount() === 0, `count ${derivedGameCount()}`);
  const afterReset = deriveSplits(games, state.players);
  let resetIdentical = afterReset.size === snapshot.size;
  if (resetIdentical) {
    for (const [id, row] of snapshot) {
      const now = afterReset.get(id);
      if (!now) { resetIdentical = false; break; }
      for (const kind of SPLIT_KINDS) {
        if (now[kind].atBats !== row[kind].atBats || now[kind].hits !== row[kind].hits
          || now[kind].walks !== row[kind].walks || now[kind].homeRuns !== row[kind].homeRuns
          || now[kind].strikeouts !== row[kind].strikeouts) { resetIdentical = false; break; }
      }
      if (!resetIdentical) break;
    }
  }
  check(
    'deriving from scratch after a reset reproduces the same rows',
    resetIdentical,
    resetIdentical ? 'incremental accumulation is order-independent here' : 'rows differ after reset',
  );

  // -- 8. RATES COME FROM metrics.ts -------------------------------------------------
  /*
   * The split stores counts only, so any rate on screen comes from `battingMetrics`. This
   * asserts the consequence: the average computed off a derived split line agrees with the
   * average the engine stored for the same player. It is the end-to-end statement of "one
   * definition of a rate", and it would fail if someone ever cached a rate into a split.
   *
   * COMPARED AT THREE DECIMAL PLACES, AND THE FIRST VERSION COMPARED AT 1e-9 AND FAILED
   * 14/332.
   *
   * That was the check being wrong, not the derivation, and the distinction is worth the
   * space. Probing the stored values directly (every one of 332 players, same window):
   *
   *   stored avg == hits/atBats exactly      13/332
   *   agree once both are rounded to 3dp   332/332
   *   largest |stored - exact|            5.00e-4
   *   largest distance from a clean 3dp    0.00e+0
   *
   * So `PlayerSeasonBatting.avg` is stored ROUNDED to three decimals -- 5.00e-4 is exactly
   * half of the last place, which is the largest distance a correctly rounded value can sit
   * from the true one, and every stored value is a clean 3dp number with zero residue. The
   * two paths agree completely once compared at the precision the engine actually keeps.
   *
   * `LeadersHub.tsx` already records this caveat, in the comment on `BattingCategory`:
   * "The stored row is pre-rounded (3dp for avg/ops), so sorting on it would tie players who
   * are not tied." That is why the tables sort on recomputed values. The error here was
   * forgetting it in a second place, which is the argument for the note being on the type
   * rather than on one call site.
   *
   * The tolerance is a rounding comparison and nothing subtler: at-least-equal at 3dp. It is
   * not a fudge factor, and it could not mask a real disagreement, because check 1 has
   * already established that the underlying COUNTS are identical field for field.
   */
  let rateOk = 0;
  let rateCompared = 0;
  table.forEach((row, playerId) => {
    const stat = statsById.get(playerId);
    if (!stat || row.season.atBats === 0) return;
    rateCompared += 1;
    const derived = battingMetrics(row.season).avg;
    if (derived === null) return;
    if (Number(derived.toFixed(3)) === Number(stat.avg.toFixed(3))) rateOk += 1;
  });
  check(
    'a rate computed from a split line equals the engine\'s stored rate, at the precision the engine stores it',
    rateCompared > 0 && rateOk === rateCompared,
    rateCompared === 0 ? 'no qualified at-bats to compare' : `${rateOk}/${rateCompared} at 3dp`,
  );

  // -- 9. NO GAME WAS SILENTLY SKIPPED ----------------------------------------------
  const gamesWithLog = completed.filter((g) => typeof g.stats?.playLog === 'string' && g.stats.playLog.length > 0).length;
  check(
    'every completed game carrying a play log was folded in',
    derivedGameCount() === completed.length,
    `processed ${derivedGameCount()}, completed ${completed.length}, of which ${gamesWithLog} carried a log`,
  );

  // -- 10. THE UNIVERSE IDENTITY GUARD ------------------------------------------------
  /*
   * The cache is keyed on game id and its rows on player id, and a rebuilt universe REUSES
   * player ids -- `buildNewUniverse` with the same seed regenerates the same ones. Without a
   * guard, a user resetting to a new universe mid-session gets the old universe's split rows
   * silently attributed to the new universe's players: stale numbers, no error, nothing on
   * screen to say so.
   *
   * Simulated directly rather than by building a second universe, because the thing under
   * test is precisely "a processed game id that is no longer in the league". Taking the real
   * league's games and dropping a slice of them produces exactly that condition, and does it
   * in milliseconds rather than in another 90-day simulation.
   */
  resetSplits();
  deriveSplits(games, state.players);
  const beforeSwap = derivedGameCount();
  const truncated = games.filter((g, i) => !(g.status === 'completed' && i % 3 === 0));
  const afterSwap = deriveSplits(truncated, state.players);
  const shrankTo = derivedGameCount();

  check(
    'the cache discards itself when a league is rebuilt underneath it',
    shrankTo < beforeSwap && shrankTo === truncated.filter((g) => g.status === 'completed').length,
    `processed ${beforeSwap}, then handed a league missing a third of its games, `
    + `and it settled at ${shrankTo}`,
  );

  // And it must be the TRUNCATED league's answer, not a blend of the two.
  resetSplits();
  const fromScratch = deriveSplits(truncated, state.players);
  let guardClean = fromScratch.size === afterSwap.size;
  if (guardClean) {
    for (const [id, row] of fromScratch) {
      const now = afterSwap.get(id);
      if (!now) { guardClean = false; break; }
      if (now.season.atBats !== row.season.atBats || now.season.hits !== row.season.hits) {
        guardClean = false;
        break;
      }
    }
  }
  check(
    'after discarding, the rows are the new league\'s alone and not a blend of both',
    guardClean,
    guardClean ? 'no residue from the previous league' : 'rows still carry the old league\'s games',
  );

  // Put the cache back on the real league for the reported numbers.
  resetSplits();
  const finalTable = deriveSplits(games, state.players);

  const coverage = platoonCoverage(finalTable);

  const failed = checks.filter((c) => !c.pass);
  console.log('\nSPLIT RECONCILIATION\n');
  checks.forEach((c, i) => {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.label}`);
    if (!c.pass && c.detail) console.log(`        ${c.detail}`);
  });
  console.log('\n  MEASURED');
  console.log(`    window                     ${WARMUP} warmup + ${DAYS} days`);
  console.log(`    completed games            ${completed.length}`);
  console.log(`    players reconciled         ${seasonCompared}`);
  console.log(`    players with a split row   ${table.size}`);
  console.log(`    cold backfill              ${elapsed}ms for ${completed.length} games`);
  console.log(`    platoon coverage           ${coverage.total > 0 ? Math.round((coverage.classified / coverage.total) * 100) : 0}% of plate appearances classified by pitcher hand`);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks PASS\n`);
  if (failed.length > 0) process.exitCode = 1;
};

void main();