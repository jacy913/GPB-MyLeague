/**
 * What does a splits explorer actually cost, and is it even correct?
 *
 * Written BEFORE the splits explorer is built, because the leaders plan says so:
 *
 *   "Sequencing note: measure the derivation cost on real data *before* committing to
 *    this phase, and report the number rather than discovering it mid-build."
 *
 * Splitting a season means reading every at-bat of every completed game, bucketing it by
 * home/road, by the pitcher's throwing hand, by month and by game situation, and
 * attaching a name and a crest. For 32 teams and a full roster that is roughly a quarter
 * of a million play-by-play records, and nothing in the current app parses them all.
 *
 * So this measures two things and reports both:
 *
 *   1. COST. Wall time and allocation for a full season, so the phase can be scheduled
 *      against a number rather than a guess.
 *
 *   2. CORRECTNESS. The split totals are reconciled against the season aggregates the
 *      engine already stores. This is the part that matters more. A splits panel whose
 *      home figure and road figure do not add up to the player's season line is worse
 *      than no splits panel, because it disagrees with the leaders table beside it and
 *      nothing on screen would say so. The reconciliation is the check that would catch
 *      it, and it is cheap to write now and impossible to retrofit later.
 *
 * Run: npx tsx tools/measureSplitCost.ts [warmupDays] [days]
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
import type { Game, LeaguePlayerState, Player, PlayerSeasonBatting, Team } from '../src/types';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 20);
const DAYS = Number(process.argv[3] ?? 90);

/** The buckets the explorer would offer. One axis at a time, so the cost is not multiplied. */
type SplitKind = 'season' | 'home' | 'road' | 'vs_left' | 'vs_right' | 'high_leverage';

/** A batter's line within one bucket. Counts only -- the rates come from metrics.ts. */
interface SplitLine {
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
}

const blankSplit = (): SplitLine => ({
  plateAppearances: 0, atBats: 0, hits: 0, doubles: 0, triples: 0,
  homeRuns: 0, walks: 0, strikeouts: 0,
});

/**
 * Apply one plate appearance to a line.
 *
 * THE AT-BAT DEFINITION, AND IT IS NOT THE OBVIOUS ONE.
 *
 * The first version of this function counted an at-bat only on `OUT` and `ERR`, which is
 * the standard definition -- and it disagreed with the engine on every single player:
 * 228 derived at-bats against 421 stored, while hits, walks, strikeouts and home runs
 * all matched exactly. That signature is the whole diagnosis. If coverage were wrong the
 * hits would be wrong too; hits being right and only at-bats being short means the
 * DERIVATION was wrong, not the walk.
 *
 * `gameEngine.ts:1330-1358` settles it:
 *
 *   OUT, SO                  at-bats += 1
 *   BB                       walks  += 1, and NO at-bat
 *   1B, ERR                  at-bats += 1
 *   2B / 3B / HR             at-bats += 1
 *
 * So in this engine an at-bat is a plate appearance MINUS A WALK, which is the textbook
 * rule. It is written out per outcome rather than derived as `pa - bb` so that the rule
 * is visible next to the thing it has to agree with, and so that adding a new outcome
 * forces a decision here instead of silently defaulting to "not an at-bat".
 *
 * This also makes `metrics.ts`'s note finally true: on-base opportunities are
 * "at-bats plus walks, identical to plateAppearances in this engine". The first version
 * broke that identity, which is how the reconciliation found it.
 */
const addSplit = (target: SplitLine, outcome: string): void => {
  target.plateAppearances += 1;
  switch (outcome) {
    case 'SO':
      target.atBats += 1;
      target.strikeouts += 1;
      break;
    case 'BB':
      // The only outcome that is a plate appearance and NOT an at-bat.
      target.walks += 1;
      break;
    case '1B':
      target.atBats += 1;
      target.hits += 1;
      break;
    case '2B':
      target.atBats += 1;
      target.hits += 1;
      target.doubles += 1;
      break;
    case '3B':
      target.atBats += 1;
      target.hits += 1;
      target.triples += 1;
      break;
    case 'HR':
      target.atBats += 1;
      target.hits += 1;
      target.homeRuns += 1;
      break;
    case 'OUT':
    case 'ERR':
      target.atBats += 1;
      break;
    default:
      // An unknown outcome still consumed a plate appearance, which is counted above. Not
      // counted as an at-bat, because asserting that would be the guess this whole
      // function exists to avoid.
      break;
  }
};

/**
 * Leverage, from the state of the bases before the play.
 *
 * The classic definition is a function of runners on base, the outs, and the inning, and
 * it needs a run expectancy table to be right. That table does not exist here, so this is
 * an ARITHMETIC PROXY rather than the real thing, and it is labelled as one because a
 * leverage column that quietly disagrees with the published definition would be worse
 * than one that admits it is a simplification.
 *
 * Deliberately crude: two or more runners aboard with fewer than two outs. That is close
 * to what "high leverage" means in a way a reader will recognise, and it does not pretend
 * to a precision it cannot deliver.
 */
const isHighLeverage = (outs: number, runnersOn: number): boolean =>
  outs < 2 && runnersOn >= 2;

const countRunners = (event: { bases?: { state?: unknown } }): number => {
  const state = event.bases?.state;
  if (!state) return 0;
  // The log stores the base state after the play in a shape that varies; count the
  // occupied bases defensively rather than assuming one layout.
  if (Array.isArray(state)) return state.filter(Boolean).length;
  if (typeof state === 'object') {
    const record = state as Record<string, unknown>;
    return ['first', 'second', 'third', '1b', '2b', '3b'].reduce(
      (n, key) => (record[key] ? n + 1 : n), 0,
    );
  }
  return 0;
};

interface LogEvent {
  inning?: number;
  half?: string;
  battingTeamId?: string | null;
  outcome?: string;
  batterId?: string | null;
  pitcherId?: string | null;
  outs?: number;
  bases?: { state?: unknown };
}

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR, seed: 4242, effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe, YEAR,
  );
  const schedule = () => generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180,
  });
  let games: Game[] = schedule();
  const manager = new SimulationManager({
    teams, games, playerState: universe, settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  for (let day = 0; day < WARMUP; day += 1) {
    const r = await manager.run({ scope: 'day' });
    state = r.playerState; games = r.games; teams = r.teams;
  }

  const throwHandById = new Map(state.players.map((p) => [p.playerId, p.throws]));
  const teamOfGame = (game: Game): [string, string] => [game.awayTeam, game.homeTeam];

  /*
   * THE DERIVATION.
   *
   * One pass over every completed game's play log, writing into six bucket maps. One pass
   * rather than one per split axis, because six passes over a quarter-million events is
   * the difference between a screen that opens and one that does not, and the split is a
   * property of a single event rather than of an aggregate.
   */
  const splits = new Map<string, Record<SplitKind, SplitLine>>();
  const splitOf = (playerId: string): Record<SplitKind, SplitLine> => {
    let row = splits.get(playerId);
    if (!row) {
      row = {
        season: blankSplit(), home: blankSplit(), road: blankSplit(),
        vs_left: blankSplit(), vs_right: blankSplit(), high_leverage: blankSplit(),
      };
      splits.set(playerId, row);
    }
    return row;
  };

  const completed = new Set<string>();
  let eventsRead = 0;
  let gamesWithLogs = 0;

  const started = Date.now();
  for (let day = 0; day < DAYS; day += 1) {
    const r = await manager.run({ scope: 'day' });
    for (const game of r.games) {
      if (game.status !== 'completed') continue;
      if (completed.has(game.gameId)) continue;
      completed.add(game.gameId);

      const raw = game.stats?.playLog;
      if (typeof raw !== 'string' || raw.length === 0) continue;
      gamesWithLogs += 1;

      let events: LogEvent[];
      try {
        events = JSON.parse(raw) as LogEvent[];
      } catch {
        continue;
      }

      const [away, home] = teamOfGame(game);
      for (const event of events) {
        if (!event.batterId || !event.outcome) continue;
        if (event.outcome === 'PITCHING_CHANGE' || event.outcome === 'HALF_END' || event.outcome === 'GAME_END') continue;
        eventsRead += 1;

        const isHomeBatting = event.battingTeamId === home;
        const row = splitOf(event.batterId);
        addSplit(row.season, event.outcome);
        addSplit(isHomeBatting ? row.home : row.road, event.outcome);

        const pitcherHand = event.pitcherId ? throwHandById.get(event.pitcherId) : undefined;
        if (pitcherHand === 'L') addSplit(row.vs_left, event.outcome);
        else if (pitcherHand === 'R') addSplit(row.vs_right, event.outcome);

        if (isHighLeverage(event.outs ?? 0, countRunners(event))) {
          addSplit(row.high_leverage, event.outcome);
        }
      }
    }
    state = r.playerState; games = r.games; teams = r.teams;
  }
  const elapsed = Date.now() - started;

  // -- COST -----------------------------------------------------------------------
  console.log(`\nSPLIT DERIVATION COST\n`);
  console.log(`  window                 ${WARMUP} warmup + ${DAYS} days`);
  console.log(`  completed games        ${completed.size}  (${gamesWithLogs} carried a play log)`);
  console.log(`  play-by-play events    ${eventsRead.toLocaleString()}`);
  console.log(`  players with a line   ${splits.size}`);
  console.log(`  wall time             ${(elapsed / 1000).toFixed(2)}s`);
  console.log(`  per completed game    ${(elapsed / Math.max(1, completed.size)).toFixed(2)}ms`);
  console.log(`  per simulated day     ${(elapsed / Math.max(1, DAYS)).toFixed(0)}ms`);
  console.log(`  events per second     ${Math.round(eventsRead / Math.max(1, elapsed / 1000)).toLocaleString()}`);
  // Extrapolated by DAYS, and the distinction matters. The first version of this line
  // extrapolated by `games` and multiplied by 180, on the assumption that a season is 180
  // games -- it is not, it is about 180 DAYS, which at 16 games a day for 32 clubs is
  // nearer 2,880 games. That reported a full-season cost of 0.52s, which was sixteen
  // times too optimistic and would have made an 8-second rebuild look free.
  console.log(
    `  extrapolated to a 180-day season: ${((elapsed / Math.max(1, DAYS)) * 180 / 1000).toFixed(2)}s`,
  );

  // -- CORRECTNESS ----------------------------------------------------------------
  /*
   * THE RECONCILIATION, and it is the reason this tool exists.
   *
   * The engine's season aggregates are the truth. If a derived split line does not add up
   * to them, then either the derivation is wrong or the engine's aggregates are, and
   * nothing on the screen would say which. A splits panel sitting next to a leaders table
   * that disagrees with it is a worse defect than having no splits panel.
   */
  const statsById = new Map<string, PlayerSeasonBatting>(state.battingStats.map((s) => [s.playerId, s]));
  let checked = 0;
  let seasonMatches = 0;
  let homeRoadMatches = 0;
  const mismatches: string[] = [];

  splits.forEach((row, playerId) => {
    const stat = statsById.get(playerId);
    if (!stat) return;
    checked += 1;

    const season = row.season;
    if (
      season.atBats === stat.atBats
      && season.hits === stat.hits
      && season.walks === stat.walks
      && season.strikeouts === stat.strikeouts
      && season.homeRuns === stat.homeRuns
    ) seasonMatches += 1;
    else if (mismatches.length < 5) {
      mismatches.push(
        `${playerId}: season derived ${season.atBats}AB/${season.hits}H/${season.walks}BB vs stored `
        + `${stat.atBats}AB/${stat.hits}H/${stat.walks}BB`,
      );
    }

    if (row.home.atBats + row.road.atBats === stat.atBats
      && row.home.hits + row.road.hits === stat.hits) homeRoadMatches += 1;
  });

  // The bucket partition checks: every bucket must be a SUBSET of the season, never a
  // superset. A split that exceeds the player's own season line means a play was counted
  // into two buckets, which is the most likely bug in this kind of code.
  //
  // These are subset checks and not equality checks on purpose. The platoon buckets are a
  // partition only if every pitcher's throwing hand resolves, and the leverage bucket is
  // a partition only for players who ever came to bat with two aboard -- neither holds,
  // so an equality assertion here would be an assertion about the simulation rather than
  // about the code. What MUST hold is that a bucket never exceeds the whole, and that is
  // checked.
  let platoonSubsetOk = 0;
  let leverageWithinSeason = 0;
  // Coverage: how much of the league's plate appearances the platoon split can actually
  // classify. Reported rather than asserted, because a low figure is a fact about the
  // data and not a failure -- but a reader deserves to know a split covers 60% of a
  // player's plate appearances before trusting it as a career number.
  let paClassifiedByHand = 0;
  let paTotal = 0;
  splits.forEach((row, playerId) => {
    const stat = statsById.get(playerId);
    if (!stat) return;
    paClassifiedByHand += row.vs_left.plateAppearances + row.vs_right.plateAppearances;
    paTotal += row.season.plateAppearances;
    if (row.vs_left.atBats + row.vs_right.atBats <= stat.atBats) platoonSubsetOk += 1;
    if (row.high_leverage.plateAppearances <= stat.plateAppearances) leverageWithinSeason += 1;
  });

  console.log(`\nRECONCILIATION AGAINST THE ENGINE'S SEASON AGGREGATES\n`);
  console.log(`  players compared                ${checked}`);
  console.log(`  season line matches exactly     ${seasonMatches}/${checked}`);
  console.log(`  home + road == season           ${homeRoadMatches}/${checked}`);
  console.log(`  platoon buckets are a subset    ${platoonSubsetOk}/${checked}`);
  console.log(`  platoon split coverage          ${paTotal > 0 ? Math.round((paClassifiedByHand / paTotal) * 100) : 0}% of plate appearances classified by pitcher hand`);

  if (mismatches.length > 0) {
    console.log(`\n  ${mismatches.length} mismatch(es) shown:`);
    mismatches.forEach((m) => console.log(`    - ${m}`));
  }

  const seasonOk = checked === 0 || seasonMatches === checked;
  const homeRoadOk = checked === 0 || homeRoadMatches === checked;
  const subsetOk = platoonSubsetOk === checked;
  const leverageOk = leverageWithinSeason === checked;

  console.log(`\n  ${seasonOk && homeRoadOk && subsetOk && leverageOk
    ? 'PASS  every derived split reconciles with the stored season line'
    : 'FAIL  a derived split disagrees with the engine, and would disagree on screen'}\n`);

  if (!(seasonOk && homeRoadOk && subsetOk && leverageOk)) process.exitCode = 1;
};

void main();