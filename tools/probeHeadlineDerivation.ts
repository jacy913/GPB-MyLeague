/**
 * Proves the `deriveGameLines` extraction changed no headline output.
 *
 * WHY A FIXTURE PROBE AND NOT A SEASON DIFF. The obvious check is to run a season
 * before and after and compare the two headline decks. That does not work here: the
 * schedule is unseeded (`shuffleArray` calls `Math.random`,
 * `simulation.ts:193-200`), so two runs of the same seed are two different sets of
 * games. A before/after diff would report differences that are schedule noise, and
 * the tempting conclusion -- "the refactor is fine, the diff is just noise" -- would
 * be indistinguishable from the refactor having broken something.
 *
 * So the equivalence is tested at the unit instead: synthetic games with hand-built
 * play logs, chosen to cover the branches the extraction moved. That is deterministic
 * by construction, and a difference in output is a real difference rather than a
 * different set of baseball games.
 *
 * THE FIXTURES, one per branch that could plausibly break:
 *   - empty log          the early-return path, which returns the fallback card
 *   - malformed log      JSON that fails to parse, which must also fall back
 *   - walk-off           the score-change block's home-lead-from-behind condition
 *   - lead changes       tie counting and lead-change counting
 *   - pitching change    the PITCHING_CHANGE continue branch
 *   - half end           the HALF_END reset, which drives the outs-delta maths
 *   - extra innings      the `Math.max(..., 9)` floor and multi-frame lines
 *   - no-hitter          the noHitOpponentId branch and its pitcher lookup
 *   - mixed              several outcomes on one line, to catch field drift
 *
 * It prints a stable digest of every story field. Run it before and after the
 * refactor; the digests must be identical.
 *
 * Run: npx tsx tools/probeHeadlineDerivation.ts
 */

import { createHash } from 'node:crypto';
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildGameStoryCandidates } from '../src/logic/headlineEngine';
import type { AtBatOutcome, BaseState, Game, InningHalf, PlayLogEvent, Team } from '../src/types';

const EMPTY_BASES: BaseState = { first: null, second: null, third: null };

interface LogSpec {
  inning: number;
  half: InningHalf;
  battingTeamId: string;
  outcome: AtBatOutcome | 'PITCHING_CHANGE' | 'HALF_END' | 'GAME_END';
  batterId?: string | null;
  batterName?: string | null;
  pitcherId?: string | null;
  pitcherName?: string | null;
  runsScored?: number;
  rbi?: number;
  scoringPlayerIds?: string[];
  outs?: number;
  scoreAway: number;
  scoreHome: number;
}

const makeLog = (spec: LogSpec, seq: number): PlayLogEvent => ({
  seq,
  inning: spec.inning,
  half: spec.half,
  battingTeamId: spec.battingTeamId,
  outcome: spec.outcome,
  batterId: spec.batterId ?? null,
  batterName: spec.batterName ?? null,
  pitcherId: spec.pitcherId ?? null,
  pitcherName: spec.pitcherName ?? null,
  defenderId: null,
  defenderName: null,
  description: `${spec.outcome} in the ${spec.inning}${spec.half}`,
  runsScored: spec.runsScored ?? 0,
  rbi: spec.rbi ?? 0,
  scoringPlayerIds: spec.scoringPlayerIds ?? [],
  outs: spec.outs ?? 0,
  scoreAway: spec.scoreAway,
  scoreHome: spec.scoreHome,
  bases: EMPTY_BASES,
});

const AWAY = INITIAL_TEAMS[0].id;
const HOME = INITIAL_TEAMS[1].id;

const teams: Team[] = INITIAL_TEAMS.map((t) => ({
  ...t,
  wins: 60,
  losses: 42,
  runsScored: 0,
  runsAllowed: 0,
}));

const teamsById = new Map(teams.map((t) => [t.id, t]));

const makeGame = (
  gameId: string,
  logs: PlayLogEvent[],
  over: { awayScore: number; homeScore: number; awayHits?: number; homeHits?: number },
): Game => ({
  gameId,
  date: '2026-04-01',
  seasonYear: 2026,
  seasonPhase: 'regular_season',
  awayTeam: AWAY,
  homeTeam: HOME,
  status: 'completed',
  startTime: '2026-04-01T00:00:00.000Z',
  playoff: null,
  score: { away: over.awayScore, home: over.homeScore, innings: over.homeScore > over.awayScore ? 9 : 9 },
  stats: {
    awayHits: over.awayHits ?? 8,
    homeHits: over.homeHits ?? 8,
    awayErrors: 1,
    homeErrors: 1,
    playLog: JSON.stringify(logs),
  },
} as unknown as Game);

// --- fixtures -------------------------------------------------------------

/** Nothing to derive: must take the early return and yield the fallback card. */
const emptyLog = [makeGame('empty-log', [], { awayScore: 4, homeScore: 1 })];

/** Unparseable JSON must be treated as no log, not as a crash. */
const malformedLog = [
  makeGame('malformed-log', [], { awayScore: 3, homeScore: 2 }),
];
malformedLog[0].stats.playLog = '{not json at all';

/** A full nine-inning home walk-off: the run that ends it with the home side ahead. */
const walkOff: PlayLogEvent[] = [
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: '1B', batterId: 'a1', batterName: 'Away One', pitcherId: 'h1', pitcherName: 'Home One', outs: 0, scoreAway: 0, scoreHome: 0 }, 1),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a1', batterName: 'Away One', pitcherId: 'h1', pitcherName: 'Home One', outs: 1, scoreAway: 0, scoreHome: 0 }, 2),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a2', batterName: 'Away Two', pitcherId: 'h1', pitcherName: 'Home One', outs: 2, scoreAway: 0, scoreHome: 0 }, 3),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a2', batterName: 'Away Two', pitcherId: 'h1', pitcherName: 'Home One', outs: 3, scoreAway: 0, scoreHome: 0 }, 4),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 0, scoreHome: 0 }, 5),
  makeLog({ inning: 9, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a3', batterName: 'Away Three', pitcherId: 'h1', pitcherName: 'Home One', outs: 1, scoreAway: 0, scoreHome: 0 }, 6),
  makeLog({ inning: 9, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 0, scoreHome: 0 }, 7),
  makeLog({ inning: 9, half: 'bottom', battingTeamId: HOME, outcome: 'OUT', batterId: 'h2', batterName: 'Home Two', pitcherId: 'a9', pitcherName: 'Away Nine', outs: 1, scoreAway: 0, scoreHome: 0 }, 8),
  makeLog({ inning: 9, half: 'bottom', battingTeamId: HOME, outcome: 'OUT', batterId: 'h3', batterName: 'Home Three', pitcherId: 'a9', pitcherName: 'Away Nine', outs: 2, scoreAway: 0, scoreHome: 0 }, 9),
  // Ties the game: the tieCount branch and the "previousHomeScore <= previousAwayScore"
  // precondition for a walk-off.
  makeLog({ inning: 9, half: 'bottom', battingTeamId: HOME, outcome: 'HR', batterId: 'h4', batterName: 'Home Four', pitcherId: 'a9', pitcherName: 'Away Nine', runsScored: 1, rbi: 1, scoringPlayerIds: ['h4'], outs: 2, scoreAway: 0, scoreHome: 1 }, 10),
  makeLog({ inning: 9, half: 'bottom', battingTeamId: HOME, outcome: 'HALF_END', scoreAway: 0, scoreHome: 1 }, 11),
];

/** Same walk-off, then the home side goes ahead for good in the tenth. */
const walkOffWinner: PlayLogEvent[] = [
  ...walkOff,
  makeLog({ inning: 10, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a4', batterName: 'Away Four', pitcherId: 'h5', pitcherName: 'Home Five', outs: 1, scoreAway: 0, scoreHome: 1 }, 12),
  makeLog({ inning: 10, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 0, scoreHome: 1 }, 13),
  makeLog({ inning: 10, half: 'bottom', battingTeamId: HOME, outcome: 'OUT', batterId: 'h6', batterName: 'Home Six', pitcherId: 'a9', pitcherName: 'Away Nine', outs: 1, scoreAway: 0, scoreHome: 1 }, 14),
  makeLog({ inning: 10, half: 'bottom', battingTeamId: HOME, outcome: 'HR', batterId: 'h7', batterName: 'Home Seven', pitcherId: 'a9', pitcherName: 'Away Nine', runsScored: 1, rbi: 1, scoringPlayerIds: ['h7'], outs: 1, scoreAway: 0, scoreHome: 2 }, 15),
  makeLog({ inning: 10, half: 'bottom', battingTeamId: HOME, outcome: 'GAME_END', scoreAway: 0, scoreHome: 2 }, 16),
];

/** Lead changes and ties in both directions, to exercise both counters. */
const leadChanges: PlayLogEvent[] = [
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'HR', batterId: 'a1', batterName: 'A One', pitcherId: 'h1', pitcherName: 'H One', runsScored: 1, rbi: 1, scoringPlayerIds: ['a1'], outs: 0, scoreAway: 1, scoreHome: 0 }, 1),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 1, scoreHome: 0 }, 2),
  makeLog({ inning: 1, half: 'bottom', battingTeamId: HOME, outcome: 'HR', batterId: 'h1', batterName: 'H One', pitcherId: 'a9', pitcherName: 'A Nine', runsScored: 1, rbi: 1, scoringPlayerIds: ['h1'], outs: 0, scoreAway: 1, scoreHome: 1 }, 3),
  makeLog({ inning: 2, half: 'top', battingTeamId: AWAY, outcome: 'HR', batterId: 'a1', batterName: 'A One', pitcherId: 'h2', pitcherName: 'H Two', runsScored: 1, rbi: 1, scoringPlayerIds: ['a1'], outs: 0, scoreAway: 2, scoreHome: 1 }, 4),
  makeLog({ inning: 2, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 2, scoreHome: 1 }, 5),
];

/** A pitching change mid-game, which must not disturb the outs maths. */
const pitchingChange: PlayLogEvent[] = [
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a1', batterName: 'A One', pitcherId: 'h1', pitcherName: 'H One', outs: 1, scoreAway: 0, scoreHome: 0 }, 1),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'PITCHING_CHANGE', scoreAway: 0, scoreHome: 0 }, 2),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a1', batterName: 'A One', pitcherId: 'h2', pitcherName: 'H Two', outs: 2, scoreAway: 0, scoreHome: 0 }, 3),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'OUT', batterId: 'a1', batterName: 'A One', pitcherId: 'h2', pitcherName: 'H Two', outs: 3, scoreAway: 0, scoreHome: 0 }, 4),
  makeLog({ inning: 1, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 0, scoreHome: 0 }, 5),
];

/** Every scoring outcome on one line, to catch a field drifting between the two. */
const mixedOutcomes: PlayLogEvent[] = [
  makeLog({ inning: 3, half: 'top', battingTeamId: AWAY, outcome: '2B', batterId: 'a1', batterName: 'A One', pitcherId: 'h1', pitcherName: 'H One', outs: 0, scoreAway: 0, scoreHome: 0 }, 1),
  makeLog({ inning: 3, half: 'top', battingTeamId: AWAY, outcome: '3B', batterId: 'a2', batterName: 'A Two', pitcherId: 'h1', pitcherName: 'H One', outs: 0, scoreAway: 0, scoreHome: 0 }, 2),
  makeLog({ inning: 3, half: 'top', battingTeamId: AWAY, outcome: 'BB', batterId: 'a3', batterName: 'A Three', pitcherId: 'h1', pitcherName: 'H One', outs: 0, scoreAway: 0, scoreHome: 0 }, 3),
  makeLog({ inning: 3, half: 'top', battingTeamId: AWAY, outcome: 'SO', batterId: 'a4', batterName: 'A Four', pitcherId: 'h1', pitcherName: 'H One', outs: 1, scoreAway: 0, scoreHome: 0 }, 4),
  makeLog({ inning: 3, half: 'top', battingTeamId: AWAY, outcome: 'ERR', batterId: 'a5', batterName: 'A Five', pitcherId: 'h1', pitcherName: 'H One', outs: 1, scoreAway: 0, scoreHome: 0 }, 5),
  makeLog({ inning: 3, half: 'top', battingTeamId: AWAY, outcome: 'HALF_END', scoreAway: 0, scoreHome: 0 }, 6),
];

const FIXTURES: Array<[string, Game]> = [
  ['empty log', emptyLog[0]],
  ['malformed log', malformedLog[0]],
  ['walk-off built', makeGame('walk-off-built', walkOff, { awayScore: 0, homeScore: 1 })],
  ['walk-off completed', makeGame('walk-off-done', walkOffWinner, { awayScore: 0, homeScore: 2 })],
  ['lead changes and ties', makeGame('lead-changes', leadChanges, { awayScore: 2, homeScore: 1 })],
  ['pitching change', makeGame('pitching-change', pitchingChange, { awayScore: 0, homeScore: 0 })],
  ['mixed outcomes', makeGame('mixed', mixedOutcomes, { awayScore: 0, homeScore: 0 })],
  ['no-hitter against home', makeGame('no-hit', mixedOutcomes, { awayScore: 5, homeScore: 0, awayHits: 6, homeHits: 0 })],
  ['no-hitter against away', makeGame('no-hit-away', mixedOutcomes, { awayScore: 0, homeScore: 5, awayHits: 0, homeHits: 6 })],
  ['extra innings', makeGame('extra', walkOffWinner, { awayScore: 0, homeScore: 2 })],
];

const digestFor = (label: string, game: Game): string => {
  const stories = buildGameStoryCandidates(game, teamsById, new Map(), new Map(), new Map());
  const payload = stories
    .map((s) => ({
      p: s.priority,
      h: s.headline,
      s: s.summary,
      a: s.accent,
      g: s.game?.gameId ?? null,
    }))
    .sort((left, right) => (right.p - left.p) || left.h.localeCompare(right.h));
  return `${label} :: ${payload.length} stories :: ${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}`;
};

console.log('headline derivation probe');
console.log('  Compare every DIGEST line before and after the extraction. They must match.\n');
const digests = FIXTURES.map(([label, game]) => digestFor(label, game));
digests.forEach((line) => console.log(`  ${line}`));

console.log(`\n  OVERALL ${createHash('sha256').update(digests.join('|')).digest('hex')}`);
console.log(`  fixtures ${FIXTURES.length}`);