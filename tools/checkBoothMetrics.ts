/*
  THE EIGHT BOOTH BOARDS, CHECKED AGAINST HAND-BUILT GAMES.

  `boothMetrics.ts` is the whole feature: eight team rankings derived from completed regular-season
  games. Every one of them can be wrong in a way that still prints a clean number -- a comeback
  credited from a fourth inning that never finished, an opponent qualifying for the team it is being
  judged against, a home run's runs attributed to the wrong side -- so this file builds the games by
  hand and asserts the exact answer each board must give.

  The fixtures are deliberately tiny. A seventeen-team league would exercise scale and nothing else;
  what matters is one game per rule, arranged so that a plausible bug changes the answer.
*/
import type { Game, GamePhase, GameStatus, InningHalf, InningLine, PlayLogEvent } from '../src/types';
import { INITIAL_TEAMS } from '../src/data/teams';
import { gameTemperatureC, gameTemperatureF } from '../src/lib/gameTemperature';
import { toF } from '../src/lib/analytics/parkProfile';
import {
  type BoothBoard,
  type BoothBoardId,
  COLD_THRESHOLD_F,
  WARM_THRESHOLD_F,
  deriveBoothBoards,
} from '../src/lib/analytics/boothMetrics';

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

/* ------------------------------------------------------------------------- *
 * FIXTURE BUILDERS
 * ------------------------------------------------------------------------- */

let gameSeq = 0;
let eventSeq = 0;

interface GameSpec {
  id?: string;
  date?: string;
  home: string;
  away: string;
  homeRuns: number;
  awayRuns: number;
  phase?: GamePhase;
  status?: GameStatus;
  lineScore?: InningLine[];
  playLog?: PlayLogEvent[];
  extraStats?: Game['stats'];
}

const makeGame = (spec: GameSpec): Game => {
  const stats: Game['stats'] = { ...spec.extraStats };
  if (spec.lineScore) stats.lineScore = JSON.stringify(spec.lineScore);
  if (spec.playLog) stats.playLog = JSON.stringify(spec.playLog);
  return {
    gameId: spec.id ?? `g${++gameSeq}`,
    date: spec.date ?? '2026-06-15',
    homeTeam: spec.home,
    awayTeam: spec.away,
    phase: spec.phase ?? 'regular_season',
    status: spec.status ?? 'completed',
    score: { home: spec.homeRuns, away: spec.awayRuns },
    stats,
  };
};

/** `line([[away, home], ...])` -- innings numbered from 1. */
const line = (pairs: Array<[number, number]>): InningLine[] =>
  pairs.map(([away, home], index) => ({ inning: index + 1, away, home }));

const playEvent = (
  event: Partial<PlayLogEvent> & {
    inning: number;
    half: InningHalf;
    battingTeamId: string;
    outcome: PlayLogEvent['outcome'];
    runsScored: number;
  },
): PlayLogEvent => ({
  seq: ++eventSeq,
  inning: event.inning,
  half: event.half,
  battingTeamId: event.battingTeamId,
  outcome: event.outcome,
  batterId: event.batterId ?? null,
  batterName: event.batterName ?? null,
  pitcherId: event.pitcherId ?? null,
  pitcherName: event.pitcherName ?? null,
  defenderId: event.defenderId ?? null,
  defenderName: event.defenderName ?? null,
  description: event.description ?? '',
  runsScored: event.runsScored,
  rbi: event.rbi ?? event.runsScored,
  scoringPlayerIds: event.scoringPlayerIds ?? [],
  outs: event.outs ?? 0,
  scoreAway: event.scoreAway ?? 0,
  scoreHome: event.scoreHome ?? 0,
  bases: event.bases ?? { first: null, second: null, third: null },
  basesBefore: event.basesBefore ?? null,
});

const boardById = (boards: BoothBoard[], id: BoothBoardId): BoothBoard => {
  const board = boards.find((entry) => entry.id === id);
  if (!board) throw new Error(`no board ${id}`);
  return board;
};

const rowFor = (board: BoothBoard, teamId: string) => board.rows.find((row) => row.teamId === teamId);

const rowOrder = (board: BoothBoard): string => board.rows.map((row) => row.teamId).join(',');

console.log('\nBOOTH METRICS -- eight boards, each checked against hand-built games\n');

/* ========================================================================== *
 * 1. SECOND HALF KINGS -- runs in the fifth and later, extras included
 * ========================================================================== */

{
  // Away A scores 1 + 3 + 1 late (innings 5, 7, 11), home B scores 2 + 1 (innings 5, 9).
  const main = makeGame({
    home: 'B', away: 'A', homeRuns: 3, awayRuns: 5,
    lineScore: line([
      [0, 0], [0, 0], [0, 0], [0, 0], // 1-4
      [1, 2], [0, 0], [3, 0], [0, 0], [0, 1], [0, 0], [1, 0], // 5-11
    ]),
  });
  // A game that ends before the fifth contributes zero late runs to both sides.
  const shortened = makeGame({
    home: 'D', away: 'C', homeRuns: 2, awayRuns: 1,
    lineScore: line([[1, 0], [0, 1], [0, 1]]), // three innings only
  });

  const board = boardById(deriveBoothBoards([], [main, shortened]), 'second_half_kings');
  const a = rowFor(board, 'A');
  const b = rowFor(board, 'B');
  const c = rowFor(board, 'C');

  check(
    'late runs are summed from the fifth inning on, extras included',
    a?.primaryDisplay === '5' && b?.primaryDisplay === '3',
    `A scored 5 after the fourth (1+3+1), B scored 3 (2+1); got A=${a?.primaryDisplay} B=${b?.primaryDisplay}`,
  );
  check(
    'the leader is the higher late-run total, not the higher final score',
    rowOrder(board).startsWith('A,B'),
    `A (5 late) must rank above B (3 late); order was ${rowOrder(board)}`,
  );
  check(
    'a game that ends before the fifth contributes zero late runs',
    c?.primaryDisplay === '0',
    `C played only a three-inning game and must read 0; got ${c?.primaryDisplay}`,
  );
}

/* ========================================================================== *
 * 2. GIANT SLAYERS -- opponent qualification, and the head-to-head exclusion
 * ========================================================================== */

{
  // A beats B twice; B beats C twice. B's overall record is .500, so WITHOUT the exclusion B would
  // not qualify for A. Excluding A's games, B is 2-0 -- a giant -- so A must appear at 2-0.
  const games = [
    makeGame({ id: 'gs1', home: 'A', away: 'B', homeRuns: 5, awayRuns: 1 }),
    makeGame({ id: 'gs2', home: 'B', away: 'A', homeRuns: 0, awayRuns: 4 }),
    makeGame({ id: 'gs3', home: 'B', away: 'C', homeRuns: 6, awayRuns: 2 }),
    makeGame({ id: 'gs4', home: 'C', away: 'B', homeRuns: 1, awayRuns: 3 }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'giant_slayers');
  const a = rowFor(board, 'A');

  check(
    "an opponent's record excludes the games it played against the team being judged",
    a?.primaryDisplay === '100.0%' && a?.support[0].value === '2–0',
    `A beat B twice and B is 2-0 once A's games are removed, so A is 2-0 at 100.0%; got ${a?.primaryDisplay ?? 'absent'} ${a?.support[0]?.value ?? ''}`,
  );
  check(
    'a team with no qualifying opponent is absent, not ranked at 0-0',
    rowFor(board, 'B') === undefined,
    `B only ever played A and C, both unqualified once B's own games are removed; B must be absent`,
  );
}

{
  // An opponent EXACTLY at .500 does not qualify. O is 1-1 without its game against A.
  const games = [
    makeGame({ id: 'gs5', home: 'O', away: 'P', homeRuns: 3, awayRuns: 0 }),
    makeGame({ id: 'gs6', home: 'Q', away: 'O', homeRuns: 4, awayRuns: 2 }),
    makeGame({ id: 'gs7', home: 'A', away: 'O', homeRuns: 5, awayRuns: 1 }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'giant_slayers');
  check(
    'an opponent at exactly .500 is excluded (the threshold is strictly greater)',
    rowFor(board, 'A') === undefined,
    `O is 1-1 (.500) without its loss to A, so A faced no giant and must be absent`,
  );
}

{
  // A team that faced a giant and lost every meeting still has a real 0-2 and must appear.
  const games = [
    makeGame({ id: 'gs8', home: 'S', away: 'X', homeRuns: 7, awayRuns: 2 }),
    makeGame({ id: 'gs9', home: 'X', away: 'S', homeRuns: 0, awayRuns: 3 }),
    makeGame({ id: 'gs10', home: 'S', away: 'Y', homeRuns: 6, awayRuns: 1 }),
    makeGame({ id: 'gs11', home: 'Y', away: 'S', homeRuns: 2, awayRuns: 5 }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'giant_slayers');
  const x = rowFor(board, 'X');
  check(
    'a team that faced a giant but never beat one is ranked at 0.0%, not dropped',
    x?.primaryDisplay === '0.0%' && x?.support[0].value === '0–2',
    `X went 0-2 against a qualifying S and must appear at 0.0%; got ${x?.primaryDisplay ?? 'absent'} ${x?.support[0]?.value ?? ''}`,
  );
}

{
  // THE RANKING IS THE RATE, NOT THE COUNT. P is 1-0 against a giant (100.0%); Q is 3-1 (75.0%).
  // Q has more giant WINS, and ranked first when the board counted them. The rate must put P first.
  const games = [
    makeGame({ id: 'gr1', home: 'P', away: 'G', homeRuns: 5, awayRuns: 1 }), // P beats G
    makeGame({ id: 'gr2', home: 'Q', away: 'G', homeRuns: 4, awayRuns: 2 }), // Q beats G
    makeGame({ id: 'gr3', home: 'Q', away: 'G', homeRuns: 3, awayRuns: 1 }), // Q beats G
    makeGame({ id: 'gr4', home: 'G', away: 'Q', homeRuns: 0, awayRuns: 2 }), // Q beats G on the road
    makeGame({ id: 'gr5', home: 'G', away: 'Q', homeRuns: 6, awayRuns: 5 }), // G beats Q
    // G feasts on R so it clears .500 once the games against P and Q are removed.
    makeGame({ id: 'gr6', home: 'G', away: 'R', homeRuns: 7, awayRuns: 1 }),
    makeGame({ id: 'gr7', home: 'G', away: 'R', homeRuns: 6, awayRuns: 0 }),
    makeGame({ id: 'gr8', home: 'R', away: 'G', homeRuns: 2, awayRuns: 8 }),
    makeGame({ id: 'gr9', home: 'R', away: 'G', homeRuns: 1, awayRuns: 9 }),
    makeGame({ id: 'gr10', home: 'G', away: 'R', homeRuns: 10, awayRuns: 3 }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'giant_slayers');
  const p = rowFor(board, 'P');
  const q = rowFor(board, 'Q');
  check(
    'the board is ranked by win rate, so a 1-0 giant record tops a 3-1 one',
    p?.primaryDisplay === '100.0%' && q?.primaryDisplay === '75.0%' && rowOrder(board) === 'P,Q',
    `P is 1-0 (100.0%) and Q is 3-1 (75.0%); the rate must put P first; got P=${p?.primaryDisplay ?? 'absent'} Q=${q?.primaryDisplay ?? 'absent'} order=${rowOrder(board)}`,
  );
}

/* ========================================================================== *
 * 3. ONE-RUN SPECIALISTS -- margin exactly one, extras included
 * ========================================================================== */

{
  const games = [
    makeGame({ id: 'or1', home: 'A', away: 'B', homeRuns: 3, awayRuns: 2 }),
    makeGame({ id: 'or2', home: 'A', away: 'B', homeRuns: 2, awayRuns: 1 }),
    makeGame({ id: 'or3', home: 'B', away: 'A', homeRuns: 5, awayRuns: 4 }),
    // Extra innings, still one run -- must count.
    makeGame({ id: 'or4', home: 'A', away: 'E', homeRuns: 4, awayRuns: 3 }),
    // Not one run -- must not count.
    makeGame({ id: 'or5', home: 'C', away: 'D', homeRuns: 10, awayRuns: 1 }),
    // Tied margin can never be a completed decisive game, but must not sneak in as one run.
    makeGame({ id: 'or6', home: 'D', away: 'C', homeRuns: 2, awayRuns: 2 }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'one_run_specialists');
  const a = rowFor(board, 'A');
  const b = rowFor(board, 'B');

  check(
    'one-run games include extra innings and exclude larger margins',
    a?.primaryDisplay === '3–1' && a?.support[0].value === '4',
    `A is 3-1 in four one-run games (two vs B, one vs E in extras); got ${a?.primaryDisplay} ${a?.support[0].value}`,
  );
  check(
    'a team with no one-run games is absent',
    rowFor(board, 'D') === undefined && rowFor(board, 'C') === undefined,
    `C and D only played a nine-run game and a tie; both must be absent`,
  );
  check(
    'one-run losses are counted against the loser',
    b?.primaryDisplay === '1–2' && b?.support[0].value === '3',
    `B is 1-2 in three one-run games; got ${b?.primaryDisplay} ${b?.support[0].value}`,
  );
}

/* ========================================================================== *
 * 4. COMEBACK KIDS -- trailing at the END of the fourth, bottom-of-fourth included
 * ========================================================================== */

{
  const games = [
    // A (home) trails 1-3 after four, wins 5-3. Comeback.
    makeGame({
      id: 'cb1', home: 'A', away: 'B', homeRuns: 5, awayRuns: 3,
      lineScore: line([[1, 0], [0, 0], [2, 1], [0, 0], [0, 2], [0, 0], [0, 2], [0, 0], [0, 0]]),
    }),
    // Tied 2-2 after four: nobody was trailing. No comeback.
    makeGame({
      id: 'cb2', home: 'C', away: 'D', homeRuns: 4, awayRuns: 2,
      lineScore: line([[1, 1], [0, 0], [1, 1], [0, 0], [0, 1], [0, 0], [0, 1], [0, 0], [0, 0]]),
    }),
    // Ends in the third inning: the fourth never finished, so it is not evaluated at all.
    makeGame({
      id: 'cb3', home: 'E', away: 'F', homeRuns: 0, awayRuns: 2,
      lineScore: line([[1, 0], [1, 0], [0, 0]]),
      extraStats: { finalInning: 3 },
    }),
    // H (away) trails 2-3 after the fourth BECAUSE home scored in the bottom of the fourth, then H
    // wins 5-3. The bottom-of-fourth run must push H into trailing.
    makeGame({
      id: 'cb4', home: 'G', away: 'H', homeRuns: 3, awayRuns: 5,
      lineScore: line([[2, 0], [0, 0], [0, 0], [0, 3], [1, 0], [0, 0], [2, 0], [0, 0], [0, 0]]),
    }),
    // I (home) trails 0-1 after four and wins 2-1 in eleven innings.
    makeGame({
      id: 'cb5', home: 'I', away: 'J', homeRuns: 2, awayRuns: 1,
      lineScore: line([[1, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 1], [0, 0], [0, 1]]),
    }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'comeback_kids');
  const winners = board.rows.map((row) => row.teamId).sort().join(',');

  check(
    'comeback wins are counted only for the team that trailed after four and won',
    winners === 'A,H,I',
    `expected A, H and I; got ${winners || '(none)'}`,
  );
  check(
    'runs scored in the bottom of the fourth change who is trailing',
    rowFor(board, 'H') !== undefined && rowFor(board, 'G') === undefined,
    `H trailed 2-3 only after G batted in the fourth; H must count, G must not`,
  );
  check(
    'a game that never finished the fourth is excluded, not counted as no comeback',
    rowFor(board, 'E') === undefined && rowFor(board, 'F') === undefined,
    `the E/F game stopped in the third and must contribute nothing`,
  );
  check(
    'a tied checkpoint produces no trailing team',
    rowFor(board, 'C') === undefined && rowFor(board, 'D') === undefined,
    `C and D were tied after four; neither trailed`,
  );
}

/* ========================================================================== *
 * 5. SHUTOUT WINS -- wins with zero allowed, both sides of the box
 * ========================================================================== */

{
  const games = [
    makeGame({ id: 'sh1', home: 'A', away: 'B', homeRuns: 1, awayRuns: 0 }), // 1-0 shutout
    makeGame({ id: 'sh2', home: 'C', away: 'D', homeRuns: 5, awayRuns: 0 }), // home shutout
    makeGame({ id: 'sh3', home: 'C', away: 'D', homeRuns: 0, awayRuns: 2 }), // away shutout
    makeGame({ id: 'sh4', home: 'E', away: 'F', homeRuns: 3, awayRuns: 2 }), // no shutout
  ];
  const board = boardById(deriveBoothBoards([], games), 'shutout_wins');

  check(
    'a 1-0 win is a shutout and a win on the road counts too',
    rowFor(board, 'A')?.primaryDisplay === '1' && rowFor(board, 'C')?.primaryDisplay === '1',
    `A (1-0) and C (5-0 home, 0-2 road) each have one; got A=${rowFor(board, 'A')?.primaryDisplay} C=${rowFor(board, 'C')?.primaryDisplay}`,
  );
  check(
    'a loss in which the team scored does not grant a shutout',
    rowFor(board, 'E') === undefined && rowFor(board, 'F') === undefined,
    `E/F was 3-2 with no shutout`,
  );
  check(
    'being shut out grants nothing, but throwing a shutout does',
    rowFor(board, 'B') === undefined && rowFor(board, 'D')?.primaryDisplay === '1',
    `B was shut out by A and gets nothing; D shut C out 2-0 and gets one; got B=${rowFor(board, 'B')?.primaryDisplay ?? 'absent'} D=${rowFor(board, 'D')?.primaryDisplay ?? 'absent'}`,
  );
}

/* ========================================================================== *
 * 6. FENCE LEAPERS -- runs on HR plays, attributed to the batting side
 * ========================================================================== */

{
  const games = [
    makeGame({
      id: 'fl1', home: 'A', away: 'B', homeRuns: 5, awayRuns: 3,
      playLog: [
        playEvent({ inning: 1, half: 'bottom', battingTeamId: 'A', outcome: 'HR', runsScored: 3 }),
        playEvent({ inning: 3, half: 'bottom', battingTeamId: 'A', outcome: '1B', runsScored: 0 }),
        playEvent({ inning: 4, half: 'top', battingTeamId: 'B', outcome: 'HR', runsScored: 2 }),
        playEvent({ inning: 6, half: 'top', battingTeamId: 'B', outcome: 'HR', runsScored: 1 }),
      ],
    }),
    // A completed game with no play log: excluded from the ratio and surfaced in the note.
    makeGame({ id: 'fl2', home: 'C', away: 'D', homeRuns: 4, awayRuns: 2 }),
  ];
  const board = boardById(deriveBoothBoards([], games), 'fence_leapers');
  const a = rowFor(board, 'A');
  const b = rowFor(board, 'B');

  check(
    'a home run contributes its runsScored, not a flat one',
    a?.support[0].value === '3' && b?.support[0].value === '3',
    `A hit a three-run homer; B hit a two-run and a solo; both total 3 HR runs; got A=${a?.support[0].value} B=${b?.support[0].value}`,
  );
  check(
    'run reliance is HR runs over that team’s own runs',
    b?.primaryDisplay === '100.0%' && a?.primaryDisplay === '60.0%',
    `B scored 3 of 3 on homers (100.0%); A scored 3 of 5 (60.0%); got B=${b?.primaryDisplay} A=${a?.primaryDisplay}`,
  );
  check(
    'a game with no play log is excluded and noted, not silently zeroed',
    (rowFor(board, 'C') === undefined || rowFor(board, 'C')?.support[1].value === '0')
      && Boolean(board.note?.includes('no play log')),
    `the C/D game had no log, so the note must say so; note was "${board.note ?? ''}"`,
  );
}

/* ========================================================================== *
 * 7 & 8. HEAT SEEKING MISSILES / COLD BLOODED KILLERS -- the 62 / 61 boundary
 * ========================================================================== */

{
  // Find game ids that land exactly on each threshold for a real park, so the boundary is tested
  // against the actual derived temperature rather than an injected number.
  const findBoundary = (targetF: number): { home: string; date: string; gameId: string } | null => {
    for (const team of INITIAL_TEAMS) {
      for (let month = 4; month <= 10; month += 1) {
        const date = `2026-${String(month).padStart(2, '0')}-15`;
        for (let k = 0; k < 20000; k += 1) {
          const gameId = `boundary-${targetF}-${team.id}-${month}-${k}`;
          if (gameTemperatureF(team.id, date, gameId) === targetF) {
            return { home: team.id, date, gameId };
          }
        }
      }
    }
    return null;
  };

  const warmAt62 = findBoundary(WARM_THRESHOLD_F);
  const coldAt61 = findBoundary(COLD_THRESHOLD_F);

  if (!warmAt62 || !coldAt61) {
    check('a park/month/game-id can be found that lands exactly on each threshold', false,
      `62F: ${warmAt62 ? 'found' : 'MISSING'}; 61F: ${coldAt61 ? 'found' : 'MISSING'}`);
  } else {
    // The away side wins both, so the two winners are distinct and cross-contamination is visible.
    const warmGame = makeGame({
      id: warmAt62.gameId, home: warmAt62.home, away: 'W62', date: warmAt62.date,
      homeRuns: 0, awayRuns: 1,
    });
    const coldGame = makeGame({
      id: coldAt61.gameId, home: coldAt61.home, away: 'C61', date: coldAt61.date,
      homeRuns: 0, awayRuns: 1,
    });
    const boards = deriveBoothBoards(INITIAL_TEAMS, [warmGame, coldGame]);
    const warm = boardById(boards, 'heat_seeking_missiles');
    const cold = boardById(boards, 'cold_blooded_killers');

    check(
      `a game at exactly ${WARM_THRESHOLD_F}F is warm and not cold`,
      rowFor(warm, 'W62') !== undefined && rowFor(cold, 'W62') === undefined,
      `W62 won the ${WARM_THRESHOLD_F}F game; warm=${rowFor(warm, 'W62') ? 'present' : 'absent'}, cold=${rowFor(cold, 'W62') ? 'present' : 'absent'}`,
    );
    check(
      `a game at exactly ${COLD_THRESHOLD_F}F is cold and not warm`,
      rowFor(cold, 'C61') !== undefined && rowFor(warm, 'C61') === undefined,
      `C61 won the ${COLD_THRESHOLD_F}F game; cold=${rowFor(cold, 'C61') ? 'present' : 'absent'}, warm=${rowFor(warm, 'C61') ? 'present' : 'absent'}`,
    );

    // Conversion grounding: the Fahrenheit the board classifies on is the whole-degree conversion of
    // the Celsius the module computes. Forcing 62F means the C value rounds to 62, not to it.
    const celsius = gameTemperatureC(warmAt62.home, warmAt62.date, warmAt62.gameId);
    check(
      'the threshold is applied to the Fahrenheit conversion of the computed Celsius value',
      celsius !== null && gameTemperatureF(warmAt62.home, warmAt62.date, warmAt62.gameId) === Math.round(toF(celsius)),
      `C=${celsius} converts to ${celsius === null ? 'null' : Math.round(toF(celsius))}F`,
    );
  }
}

/* ========================================================================== *
 * 9. MISSING AND INVALID DATA -- empty, duplicates, incomplete, zero denominators
 * ========================================================================== */

{
  const empty = deriveBoothBoards([], []);
  check(
    'an empty league yields eight boards, all empty, with a reason and no rows',
    empty.length === 8 && empty.every((board) => board.rows.length === 0 && Boolean(board.emptyReason)),
    `${empty.filter((board) => board.emptyReason).length}/8 boards carry an empty reason`,
  );

  const oneRun = makeGame({ id: 'dup', home: 'A', away: 'B', homeRuns: 2, awayRuns: 1 });
  const dupBoard = boardById(deriveBoothBoards([], [oneRun, oneRun]), 'one_run_specialists');
  check(
    'a game reachable twice is counted once',
    rowFor(dupBoard, 'A')?.primaryDisplay === '1–0',
    `the duplicated game must leave A at 1-0; got ${rowFor(dupBoard, 'A')?.primaryDisplay}`,
  );

  const incomplete = makeGame({ id: 'inc', home: 'A', away: 'B', homeRuns: 0, awayRuns: 0, status: 'scheduled' });
  const playoff = makeGame({ id: 'po', home: 'A', away: 'C', homeRuns: 9, awayRuns: 1, phase: 'playoffs' });
  const scopeBoard = boardById(deriveBoothBoards([], [incomplete, playoff]), 'one_run_specialists');
  check(
    'scheduled and postseason games are excluded from every board',
    scopeBoard.rows.length === 0,
    `a scheduled game and a playoff blowout must not register; got ${scopeBoard.rows.length} rows`,
  );

  // A missing line score must surface on the boards that need it, not read as a zero-run game.
  const noLine = makeGame({ id: 'noline', home: 'A', away: 'B', homeRuns: 7, awayRuns: 2 });
  const lateBoard = boardById(deriveBoothBoards([], [noLine]), 'second_half_kings');
  check(
    'a completed game with no line score is noted rather than counted as zero late runs',
    Boolean(lateBoard.note?.includes('no readable line score')),
    `note was "${lateBoard.note ?? ''}"`,
  );
}

/* ========================================================================== *
 * 10. SEASON AND PHASE FILTERING
 * ========================================================================== */

{
  const lastYear = makeGame({ id: 's2025', date: '2025-06-15', home: 'OLD', away: 'X', homeRuns: 2, awayRuns: 1 });
  const thisYear = makeGame({ id: 's2026', date: '2026-06-15', home: 'NEW', away: 'Y', homeRuns: 4, awayRuns: 3 });
  const pinned = deriveBoothBoards([], [lastYear, thisYear], 2026);
  const pinnedBoard = boardById(pinned, 'one_run_specialists');

  check(
    'a season pin keeps games from another season out of every board',
    rowFor(pinnedBoard, 'NEW') !== undefined && rowFor(pinnedBoard, 'OLD') === undefined,
    `pinned to 2026: NEW=${rowFor(pinnedBoard, 'NEW') ? 'present' : 'absent'}, OLD=${rowFor(pinnedBoard, 'OLD') ? 'present' : 'absent'}`,
  );

  const unpinnedBoard = boardById(deriveBoothBoards([], [lastYear, thisYear]), 'one_run_specialists');
  check(
    'without a pin both seasons are read, so the pin is what did the filtering',
    rowFor(unpinnedBoard, 'OLD') !== undefined && rowFor(unpinnedBoard, 'NEW') !== undefined,
    `unpinned: OLD=${rowFor(unpinnedBoard, 'OLD') ? 'present' : 'absent'}, NEW=${rowFor(unpinnedBoard, 'NEW') ? 'present' : 'absent'}`,
  );
}

console.log('');
if (problems.length) {
  problems.forEach((problem) => console.log(`  FAIL  ${problem}`));
  console.log(`\n  ${problems.length} problem(s).\n`);
  process.exit(1);
}
console.log('  all eight boards behave: boundaries, attribution, scope and empty samples.\n');
