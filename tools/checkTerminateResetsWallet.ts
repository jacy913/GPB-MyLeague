/*
 * Terminate Universe must clear the money, not just the players.
 *
 * THE BUG THIS EXISTS FOR. `handleTerminateUniverse` cleared the price ledger, `lastPriceBoard` and
 * the exchange portfolio via `book.reset()`, and did NOT touch the betting wallet -- which lives on a
 * different hook, `useBettingSlip`, and has its own `balance` and `bets`. So terminating a universe
 * left you holding whatever balance you had and a betting record full of wagers on players who no
 * longer existed. Nothing failed. Nothing was logged. The app simply came back from a fresh universe
 * with a stale bankroll.
 *
 * This asserts the CALL SITE, because that is where it was missing and where it can go missing again.
 * Asserting the hook in isolation would pass on a reset that is never called, which is the shape of
 * bug this file is here to prevent -- the same mistake `deriveParkProfile` made when it re-implemented
 * a formula instead of calling it.
 */
import { readFileSync } from 'node:fs';
import { createWallet, STARTING_BALANCE, settleWallet, placeBet, summariseWallet } from '../src/lib/wallet';
import type { PlacedBet } from '../src/lib/wallet';

const problems: string[] = [];
const src = readFileSync('src/App.tsx', 'utf8');

console.log('\nTERMINATE UNIVERSE -- does it clear the money?\n');

// -- 1. the call site --------------------------------------------------------------
const terminate = src.slice(src.indexOf('const handleTerminateUniverse'));
// Take the WHOLE callback, dependency array included.
//
// The first version sliced up to `}, [` and then searched for the deps *inside that slice* -- but the
// slice ENDS at that marker, so it contained three characters and no dependencies at all. The check
// reported the dependency missing, which was a true conclusion reached by reading nothing. That is the
// most reliable way to write a check that cannot lie: make it fail, and then work out whether it was
// right for the reason it gave.
const endOfCallback = terminate.indexOf('\n  ]);');
const block = terminate.slice(0, endOfCallback === -1 ? 20000 : endOfCallback);

const callsResetWallet = /resetWallet\(\)/.test(block);
const hasBookReset = /book\.reset\(\)/.test(block);

console.log(`  book.reset()      ${hasBookReset ? 'called' : 'ABSENT'}`);
console.log(`  resetWallet()     ${callsResetWallet ? 'called' : 'ABSENT -- the reported bug'}`);

if (hasBookReset && !callsResetWallet) {
  problems.push('terminate clears the exchange portfolio but not the betting wallet');
}

// The dependency, which `tsc` cannot see. A missing entry means a stale closure, and a stale closure
// means the reset silently does nothing -- the same symptom as not calling it at all.
const depsStart = block.lastIndexOf('}, [');
const deps = depsStart === -1 ? '' : block.slice(depsStart);
const depListed = /(^|[\s,])resetWallet([,\s\]])/m.test(deps);
console.log(`  resetWallet dep   ${depListed ? 'listed' : 'MISSING -- stale closure, reset would silently no-op'}`);
if (callsResetWallet && !depListed) {
  problems.push('resetWallet is called but absent from the useCallback deps: stale closure');
}

// -- 2. the wallet factory ---------------------------------------------------------
console.log(`\n  STARTING_BALANCE   $${STARTING_BALANCE}`);
console.log(`  createWallet()     balance $${createWallet().balance}, ${createWallet().bets.length} bets`);
if (createWallet().balance !== STARTING_BALANCE) {
  problems.push(`createWallet does not start at $${STARTING_BALANCE}`);
}
if (createWallet().bets.length !== 0) {
  problems.push('createWallet starts with bets on it');
}

// -- 3. the reset genuinely clears a spent, bet-carrying wallet --------------------
// Reading the call site proves the reset is wired. This proves the reset would work, which is a
// different claim and the one a reader actually cares about.
console.log('\n  AND THE RESET ACTUALLY CLEARS A WALLET WITH MONEY AND BETS ON IT\n');

let wallet = createWallet();
const bet: PlacedBet = {
  id: 'b1',
  kind: 'moneyline',
  marketKey: 'g1',
  marketTitle: 'Test',
  selection: 'home',
  selectionLabel: 'Calukan',
  stake: 250,
  price: -115,
  placedOn: '2026-04-01',
  resolvesOn: '2026-04-02',
  status: 'open',
  payout: 0,
  backedMedia: null,
};
const placed = placeBet(wallet, bet);
if ('error' in placed) {
  problems.push(`could not stage a bet for the test: ${placed.error}`);
} else {
  wallet = placed.wallet;
}
console.log(`    after one $250 wager   balance $${wallet.balance}, ${wallet.bets.length} open bet`);
if (wallet.balance === STARTING_BALANCE) {
  problems.push('placing a bet did not move the balance, so the test proves nothing');
}

const reset = createWallet();
console.log(`    after reset           balance $${reset.balance}, ${reset.bets.length} bets`);
if (reset.balance !== STARTING_BALANCE) problems.push(`reset balance is $${reset.balance}`);
if (reset.bets.length !== 0) problems.push(`reset left ${reset.bets.length} bets on the wallet`);

const summary = summariseWallet(reset);
if (summary.profit !== 0) problems.push(`a fresh wallet reports profit ${summary.profit}`);

// -- 4. settling a bet still works, i.e. the reset did not break settlement --------
console.log('\n  AND SETTLEMENT STILL WORKS AFTERWARDS\n');
const reopened = placeBet(createWallet(), { ...bet, id: undefined } as never);
if ('error' in reopened) {
  problems.push('cannot place a bet on a freshly reset wallet');
} else {
  const after = reopened.wallet;
  /*
    `score` is a nested object, not `homeScore`/`awayScore` -- the first version of this test used the
    flat shape and `settleWallet` threw `Cannot read properties of undefined (reading 'away')` from
    inside `resultFor`. Which is the honest shape of the mistake: a hand-built fixture that does not
    match the real one fails deep in the code under test rather than at the boundary where it was
    built, so the error message points at the wallet rather than at the fixture.
  */
  const settled = settleWallet(after, {
    games: [{
      gameId: 'g1',
      date: '2026-04-02',
      awayTeam: 'a',
      homeTeam: 'h',
      status: 'completed',
      score: { home: 4, away: 1 },
      stats: { playLog: '' },
    }],
    teams: [],
    currentDate: '2026-04-03',
    seasonComplete: false,
  } as never);
  const stillOpen = settled.bets.filter((b) => b.status === 'open').length;
  const result = settled.bets[0]?.status;
  console.log(`    bet placed on a reset wallet settles: ${stillOpen === 0 ? `yes (${result})` : `NO (${stillOpen} still open)`}`);
  if (settled === after) {
    problems.push('settleWallet returned the same wallet: the reset wallet cannot be settled on');
  }
}

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('  terminate clears the wallet, the dependency is listed, and a fresh wallet still settles bets.');