/*
 * A settled prop bet must record what the player actually did -- on a win AND on a loss.
 *
 * THE BUG. `resultFor` called `propActualStat(game, bet.propStat, bet.propPlayerId)`, had the number
 * in hand, compared it to the line, and returned `{ status: 'decided', won }`. The figure was computed
 * and discarded. There was no field on the bet to put it in.
 *
 * The complaint that surfaced it was "I lost and never saw the player's performance that day" -- which
 * is a reader who lost, so the losing branch is the one that matters. Writing the actual only on a win
 * would build the feature for the case that did not need it.
 *
 * It is also unrecoverable after the fact, which is why this has to happen at settlement: the play log
 * is the source, and by the time anyone opens the record the game has usually scrolled off the slate
 * the lookup reads from.
 */
import { createWallet, placeBet, settleWallet } from '../src/lib/wallet';
import type { PlacedBet } from '../src/lib/wallet';

const problems: string[] = [];

/**
 * A play log the real reader can parse.
 *
 * THE FIRST VERSION OF THIS FILE WROTE ONE THAT DID NOT PARSE, and every assertion below passed
 * vacuously on bets that had settled to nothing. `propActualStat` keys on `batterId` and reads
 * `outcome` -- a string per at-bat, with `1B` for a single and `SO` for a strikeout -- and my
 * invented `{ batterName, hits, atBats }` shape returned null for every player, so every bet came
 * back `void` and "did not record an actual" was true of wagers that had never been decided.
 *
 * That is the worst way for a fixture to fail. It reports as a real defect in the code under test, and
 * it reports it three times, so it looks like corroboration rather than one broken input.
 */
const BASE = { first: null, second: null, third: null };

/** One at-bat. `outcome` is what the reader counts; everything else is bookkeeping it ignores. */
const atBat = (
  seq: number,
  batterId: string,
  batterName: string,
  outcome: string,
): Record<string, unknown> => ({
  seq,
  inning: 1,
  half: 'top',
  battingTeamId: 'away',
  outcome,
  batterId,
  batterName,
  pitcherId: 'p1',
  pitcherName: 'Pitcher One',
  defenderId: null,
  defenderName: null,
  description: outcome,
  runsScored: outcome === 'HR' ? 1 : 0,
  rbi: outcome === 'HR' ? 1 : 0,
  scoringPlayerIds: outcome === 'HR' ? [batterId] : [],
  outs: outcome === 'OUT' || outcome === 'SO' ? 1 : 0,
  scoreAway: 0,
  scoreHome: 0,
  bases: BASE,
});

/** Player A goes 3 for 4 -- a single, a single, a single, then a strikeout. */
const PLAYER_A = 'pA';
const PLAYER_B = 'pB';
const PLAY_LOG = JSON.stringify([
  atBat(1, PLAYER_A, 'Player A', '1B'),
  atBat(2, PLAYER_A, 'Player A', '1B'),
  atBat(3, PLAYER_A, 'Player A', '1B'),
  atBat(4, PLAYER_A, 'Player A', 'SO'),
  atBat(5, PLAYER_B, 'Player B', 'SO'),
  atBat(6, PLAYER_B, 'Player B', 'SO'),
  atBat(7, PLAYER_B, 'Player B', 'SO'),
  atBat(8, PLAYER_B, 'Player B', 'SO'),
]);

const game = {
  gameId: 'g1',
  date: '2026-04-12',
  awayTeam: 'away',
  homeTeam: 'home',
  status: 'completed',
  score: { home: 5, away: 3 },
  stats: { playLog: PLAY_LOG },
} as never;

const context = {
  games: [game],
  teams: [],
  currentDate: '2026-04-13',
  seasonComplete: false,
} as never;

const propBet = (id: string, playerName: string, line: number, side: 'over' | 'under'): PlacedBet => ({
  id,
  kind: 'prop',
  marketKey: 'g1',
  marketTitle: 'Over/Under Hits Allowed',
  selection: side,
  selectionLabel: side === 'over' ? 'Over' : 'Under',
  stake: 50,
  price: -115,
  placedOn: '2026-04-11',
  resolvesOn: '2026-04-12',
  status: 'open',
  payout: 0,
  backedMedia: null,
  propStat: 'hits',
  propPlayerId: playerName,
  propPlayerName: playerName,
  propLine: line,
});

console.log('\nSETTLED PROP -- does the bet record what the player did?\n');

// -- 1. a WIN ------------------------------------------------------------------------
console.log('  A WIN\n');
let wallet = createWallet();
const won = placeBet(wallet, propBet('w1', PLAYER_A, 2.5, 'over'));
if ('error' in won) {
  problems.push(`could not place the winning bet: ${won.error}`);
} else {
  const settled = settleWallet(won.wallet, context);
  const bet = settled.bets[0];
  console.log(`    status ${bet.status}   line ${bet.propLine}   actual ${bet.propActual ?? 'NOT RECORDED'}`);
  if (bet.propActual === undefined) problems.push('a WON prop recorded no actual');
  // 3 hits over a 2.5 line, over the line, so a win.
  if (bet.propActual !== 3) problems.push(`expected an actual of 3, got ${bet.propActual}`);
}

// -- 2. a LOSS, which is the case the complaint is about ---------------------------
console.log('\n  A LOSS -- the case the complaint is about\n');
let wallet2 = createWallet();
const lost = placeBet(wallet2, propBet('l1', PLAYER_A, 3.5, 'over'));
if ('error' in lost) {
  problems.push(`could not place the losing bet: ${lost.error}`);
} else {
  const settled = settleWallet(lost.wallet, context);
  const bet = settled.bets[0];
  console.log(`    status ${bet.status}   line ${bet.propLine}   actual ${bet.propActual ?? 'NOT RECORDED'}`);
  if (bet.status !== 'lost') problems.push(`expected the bet to lose, got ${bet.status}`);
  if (bet.propActual === undefined) {
    problems.push('a LOST prop recorded no actual -- this is the whole complaint');
  } else if (bet.propActual !== 3) {
    problems.push(`expected an actual of 3, got ${bet.propActual}`);
  }
}

// -- 3. a loss on a player who went zero --------------------------------------------
console.log('\n  AND A LOSS BY A PLAYER WHO DID NOT GET A HIT\n');
let wallet3 = createWallet();
const shutout = placeBet(wallet3, propBet('l2', PLAYER_B, 0.5, 'over'));
if ('error' in shutout) {
  problems.push(`could not place the shutout bet: ${shutout.error}`);
} else {
  const settled = settleWallet(shutout.wallet, context);
  const bet = settled.bets[0];
  console.log(`    status ${bet.status}   line ${bet.propLine}   actual ${bet.propActual ?? 'NOT RECORDED'}`);
  // The number here is ZERO, and it is the one figure that must not render as "not recorded".
  if (bet.propActual !== 0) {
    problems.push(`an oh-for-four must record an actual of 0, got ${bet.propActual}`);
  }
  if (bet.propActual === undefined) {
    problems.push('a 0 actual is indistinguishable from absent, which is the trap in this field');
  }
}

// -- 4. the display contract: absent must be sayable -------------------------------
console.log('\n  AND AN OPEN BET HAS NONE, WHICH IS CORRECT\n');
const openBet = propBet('o1', PLAYER_A, 2.5, 'over');
console.log(`    an open bet carries propActual: ${openBet.propActual !== undefined}`);
if (openBet.propActual !== undefined) {
  problems.push('an open bet already claims an actual');
}
console.log('    -> the record must print "not recorded" for absent, and 0 for zero. Those are');
console.log('       different sentences: "oh-for-four" and "we do not know".');

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('  every settled prop records the actual, on wins and losses alike, and a zero is a zero.');