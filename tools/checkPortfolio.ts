/**
 * Is the positions ledger actually a ledger?
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 *
 * The plan calls Phase 4 "the expensive part and the part most likely to harbour bugs", and names
 * the reason: `wallet.ts` has already shipped two documented ledger bugs -- a pending/void
 * conflation, and a profit double-count where a $50 bet returning $104 reported +$104 instead of
 * the $54 actually made. Both were arithmetic that looked correct while being wrong.
 *
 * Positions are a larger surface than bet slips: you hold across time, cost basis has to survive
 * partial exits, and cash must reconcile against a history that can be tampered with. So the checks
 * here are not smoke tests. Each one targets a specific way this file could be wrong while still
 * looking fine.
 *
 * ===========================================================================
 * THE SPINE IS THE INVARIANT, AND IT IS CHECKED AFTER EVERY SINGLE TRADE
 * ===========================================================================
 *
 * `cashCents + sum(costCents) === STARTING_CASH_CENTS + realisedCents`
 *
 * Not once at the end of a scripted happy path -- after every trade in a long seeded sequence of
 * buys, adds, partial sells and full exits. A ledger that reconciles on the fixtures and drifts on
 * the eleventh random sell is a ledger that will reconcile on the demo and drift in someone's save.
 *
 * The sequence is SEEDED rather than random for the same reason `verifyFuturesRisk` was pinned: an
 * unseeded sequence that fails once in ten runs teaches you nothing except that the check is
 * annoying.
 */

import {
  averageCost,
  buyShares,
  costOfShares,
  createPortfolio,
  centsFor,
  derivedCashCents,
  dollars,
  loadPortfolio,
  loadPortfolioLastWarning,
  markValue,
  positionIn,
  maxSharesFor,
  reconciles,
  savePortfolio,
  rejectionOf,
  sellShares,
  STARTING_CASH_CENTS,
  type Portfolio,
  type PortfolioResult,
} from '../src/lib/portfolio';
import { seededRandomStream } from '../src/lib/analytics/playoffMonteCarlo';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const CLUBS = ['alp', 'bra', 'cor', 'dra', 'eli', 'fen'];
const unwrap = (r: PortfolioResult): Portfolio => {
  if (!r.ok) throw new Error(`expected the trade to be accepted, got: ${r.error}`);
  return r.portfolio;
};

// -- 1. CENTS CROSSING POINT ROUNDS HALF UP, ON BOTH SIDES ---------------------------------------
/*
  `Math.round` on a negative rounds toward +Infinity, which would round a SELL below cost the wrong
  way. The sign is pulled off before rounding in `centsFor`, and this is the assertion for it:
  -0.005 must land on -1 cent, not 0.
*/
check(
  'centsFor rounds half away from zero, so a sub-cent loss is never rounded to nothing',
  centsFor(0.005) === 1 && centsFor(-0.005) === -1 && centsFor(993.4871) === 99349 && centsFor(0) === 0,
  `0.005 -> ${centsFor(0.005)}, -0.005 -> ${centsFor(-0.005)}, 993.4871 -> ${centsFor(993.4871)}, `
  + '0 -> 0. A plain Math.round turns -0.005 into 0, which silently deletes a loss.',
);

// -- 2. THE INVARIANT HOLDS AFTER EVERY TRADE IN A LONG SEEDED SEQUENCE ---------------------------
/*
  This is the check the whole module exists to pass. A random walk of buys, adds, partial sells and
  full exits across six clubs, reconciling after EVERY mutation rather than at the end.
*/
const rng = seededRandomStream(90210);
/*
  A FIXED PRICE PER CLUB, and that is load-bearing rather than tidy.

  The first version of this walk drew a fresh random price on every trade, so a club bought at $20
  could be sold the next instant at $900 -- and the walk finished reporting $284,236 of realised
  profit on a $1,000 account. The invariant still held, so the check still passed, but it was
  printing a fantasy economy and the number would have been quoted back as a finding.

  With one price per club, no trade can make money except through rounding, so realised P&L becomes
  a direct measurement of rounding error across thousands of trades. It comes out at zero, which is
  a much stronger statement than "the identity held".
*/
const PRICE_OF: Record<string, number> = {};
CLUBS.forEach((club, i) => { PRICE_OF[club] = 40 + i * 137; });

let walked: Portfolio = createPortfolio();
let trades = 0;
let turnoverCents = 0;
let firstBreak: string | null = null;
for (let i = 0; i < 4000; i += 1) {
  const club = CLUBS[Math.floor(rng() * CLUBS.length)];
  const price = PRICE_OF[club];
  const held = positionIn(walked, club);
  const sellFirst = held !== undefined && rng() < 0.45;
  const shares = sellFirst && held ? 1 + Math.floor(rng() * held.shares) : 1 + Math.floor(rng() * 12);

  const result = sellFirst
    ? sellShares(walked, { teamId: club, shares, price })
    : buyShares(walked, { teamId: club, shares, price, date: '2026-05-01', marketSize: rng() * 100 });

  if (!result.ok) continue;
  walked = result.portfolio;
  trades += 1;
  turnoverCents += centsFor(price) * shares;
  if (!reconciles(walked) && firstBreak === null) {
    firstBreak = `trade ${trades}: cash ${walked.cashCents} but derived ${derivedCashCents(walked)}`;
  }
}
check(
  'the cash/cost/realised invariant holds after every trade, not just at the end',
  firstBreak === null && trades > 500 && walked.cashCents >= 0,
  `${trades} accepted trades across ${CLUBS.length} clubs, reconciling after each. Stored cash `
  + `${dollars(walked.cashCents)} equals derived ${dollars(derivedCashCents(walked))}. First break: `
  + `${firstBreak ?? 'none'}. Cash never went negative.`,
);

check(
  'trading at unchanged prices produces ZERO realised P&L, so rounding error is not accumulating',
  walked.realisedCents === 0,
  `${dollars(turnoverCents)} of gross turnover across ${trades} trades, and realised P&L of `
  + `${dollars(walked.realisedCents)}. Every club traded at one fixed price, so the only thing that `
  + 'could have moved the number is cent-rounding -- and nothing did, because the cost basis is '
  + 'released verbatim on the final leg of every unwind.',
);

// -- 3. PARTIAL SELLS CANNOT LOSE OR CREATE A CENT, AT ANY SPLIT ----------------------------------
/*
  The rounding hazard in `costOfShares` is that proportional rounding accumulates across many
  partial exits. It cannot, because the FINAL sell returns the remaining basis verbatim -- but that
  is an argument, not a measurement, so this measures it over every possible split of a position
  whose price makes proportional rounding genuinely lossy.
*/
const awkward = { teamId: 'alp', shares: 7, costCents: 12346 * 7 + 3, openedOn: '2026-05-01' };
let worstDrift = 0;
let splitsTested = 0;
let shortestSplit = Infinity;
for (let parts = 1; parts <= awkward.shares; parts += 1) {
  for (let seedA = 0; seedA < 40; seedA += 1) {
    const r2 = seededRandomStream(seedA * 31 + parts);
    /*
      The working position is DECREMENTED, exactly as `sellShares` does. An earlier version of this
      check passed the original position every time, which meant the final sale never took the
      `n >= shares` branch and the very path that guarantees the invariant was never executed --
      a green check that was measuring nothing, which is the failure mode this file exists to
      prevent.
    */
    let working = { ...awkward };
    let realised = 0;
    let legs = 0;
    while (working.shares > 0) {
      /*
        A quarter of the legs sell the remainder outright. That is not decoration: it is the case
        where `costOfShares` takes its `n >= shares` branch and returns the basis verbatim instead
        of estimating it, and the whole no-drift argument rests on that branch being reached.
      */
      const take = r2() < 0.25
        ? working.shares
        : working.shares === 1 ? 1 : 1 + Math.floor(r2() * Math.min(working.shares - 1, 4));
      const released = costOfShares(working, take);
      realised += 4501 * take - released;
      working = { ...working, shares: working.shares - take, costCents: working.costCents - released };
      legs += 1;
    }
    splitsTested += 1;
    shortestSplit = Math.min(shortestSplit, legs);
    worstDrift = Math.max(worstDrift, Math.abs(realised - (4501 * awkward.shares - awkward.costCents)));
    if (working.shares !== 0 || working.costCents !== 0) {
      check('a split that does not fully unwind the position', false, `left ${working.shares} shares`);
    }
  }
}
check(
  'selling a position in ANY split realises exactly proceeds minus cost -- no rounding drift',
  worstDrift === 0 && splitsTested > 100 && shortestSplit === 1,
  `${splitsTested} splits of a ${awkward.shares}-share position held at a deliberately awkward `
  + `${dollars(awkward.costCents)} basis, down to ${shortestSplit} leg(s) at a time. Worst drift `
  + `${worstDrift} cents. The guarantee is structural rather than lucky: every leg subtracts its own `
  + 'release from the basis and the final leg takes whatever is left verbatim, so the legs sum to '
  + 'the original basis whatever the rounding did on the way.',
);

// -- 4. CASH IS DERIVED, SO A TAMPERED BALANCE CANNOT SURVIVE A LOAD --------------------------------
const honest = unwrap(buyShares(createPortfolio(), {
  teamId: 'bra', shares: 2, price: 400, date: '2026-05-01', marketSize: 100,
}));
const tampered: Portfolio = { ...honest, cashCents: honest.cashCents + 5_000_00 };
check(
  'a tampered cash figure is DETECTED rather than loaded, because cash is derivable',
  reconciles(honest) && !reconciles(tampered) && derivedCashCents(honest) === honest.cashCents,
  `an honest portfolio reconciles at ${dollars(derivedCashCents(honest))}; adding $5,000 to the stored `
  + `figure makes it fail. This is the gap in wallet.ts, whose loadWallet returns parsed.balance `
  + 'verbatim behind a comment describing a reconciliation it does not perform.',
);

// -- 5. CASH IS NEVER NEGATIVE AND NEVER OVERSPENT -------------------------------------------------
let overspend: string | null = null;
let worstCash = STARTING_CASH_CENTS;
let cashWalk = createPortfolio();
let accepted = 0;
let refusedCount = 0;
/*
  Sizes and prices straddle the boundary rather than sitting wholly above it, and the stream is
  created ONCE above the loop.

  Two earlier versions of this check were quietly vacuous. The first asked for 1-40 shares at
  $100-$1,000, every one of which cost more than the entire account, so all 600 attempts were
  refused and the account never traded. The second rebuilt the seeded stream inside the loop, which
  replays the SAME draw every iteration -- one buy succeeded and 599 identical ones were then
  refused against the cash it had spent. Both "passed". Neither measured anything.
*/
const boundaryRng = seededRandomStream(4242);
for (let i = 0; i < 600; i += 1) {
  const r3 = boundaryRng;
  const club = CLUBS[Math.floor(r3() * CLUBS.length)];
  const price = 20 + r3() * 180;
  const held = positionIn(cashWalk, club);
  /*
    Sells are in the loop because buys alone drain the account and never refill it: the first
    version bought 600 times with no exit, so 599 attempts were refused against a nearly empty
    account and the walk proved only that cash cannot go negative, which was never in doubt.
    Cycling the money is what makes the boundary get tested over and over.
  */
  const res = held !== undefined && r3() < 0.5
    ? sellShares(cashWalk, { teamId: club, shares: 1 + Math.floor(r3() * held.shares), price })
    : buyShares(cashWalk, {
      teamId: club, shares: 1 + Math.floor(r3() * 8), price, date: '2026-05-02', marketSize: 100,
    });
  if (!res.ok) {
    refusedCount += 1;
    if (overspend === null && rejectionOf(res).includes('Not enough cash')) overspend = rejectionOf(res);
    continue;
  }
  accepted += 1;
  cashWalk = res.portfolio;
  worstCash = Math.min(worstCash, cashWalk.cashCents);
}
check(
  'a player cannot spend money they do not have, and cash never goes negative',
  worstCash >= 0 && overspend !== null && accepted > 50 && refusedCount > 50,
  `${accepted} of 600 trades accepted and ${refusedCount} refused, with buys and sells interleaved `
  + `so the account really did cycle. Lowest cash reached ${dollars(worstCash)}, never below zero. `
  + `A refused attempt reads: "${overspend ?? 'none was ever refused'}".`,
);

// -- 6. THE POSITION LIMIT IS ENFORCED, AND SCALES WITH LIQUIDITY ----------------------------------
const thinCap = maxSharesFor(0);
const thickCap = maxSharesFor(100);
const atThinCap = unwrap(buyShares(createPortfolio(), {
  teamId: 'alp', shares: thinCap, price: 20, date: '2026-05-01', marketSize: 0,
}));
const justOverThin = buyShares(atThinCap, {
  teamId: 'alp', shares: 1, price: 20, date: '2026-05-01', marketSize: 0,
});
const justOverThick = buyShares(createPortfolio(), {
  teamId: 'alp', shares: thickCap + 1, price: 2, date: '2026-05-01', marketSize: 100,
});
check(
  'a position cannot exceed its share cap, and the cap is bigger in a liquid club',
  rejectionOf(justOverThin).includes('over the') && justOverThick.ok === false && thinCap < thickCap,
  `thinnest club allows ${thinCap} shares, thickest ${thickCap}. One share over the thin cap is `
  + `refused ("${rejectionOf(justOverThin).slice(0, 58)}"); so is one over the thick one. The cap is `
  + 'in SHARES because §6.3 says "you cannot buy 10,000 shares" -- a dollar cap of the same spirit '
  + 'would allow zero shares of a club trading at $993 and make the most expensive club on the page '
  + 'unbuyable.',
);

check(
  'a player CAN afford at least one share of the most expensive club, which a dollar cap forbade',
  buyShares(createPortfolio(), { teamId: 'alp', shares: 1, price: 993.49, date: '2026-05-01', marketSize: 0 }).ok,
  `one share of a $993.49 club in the THINNEST market is accepted against ${dollars(STARTING_CASH_CENTS)} `
  + `of cash. The rejected first draft of this cap was $25-$250 NOTIONAL, which permits zero shares `
  + 'above a $250 price -- the player would open the page on the club it is about and be told they '
  + 'could not afford any.',
);

check(
  'the cap is clamped to a real market size rather than trusting the input',
  maxSharesFor(-500) === thinCap && maxSharesFor(9999) === thickCap,
  `market size -500 and 9999 both clamp to ${thinCap} and ${thickCap} shares. An unclamped input would `
  + 'let a negative size produce a negative cap and permit any position.',
);

// -- 7. FRACTIONAL AND IMPOSSIBLE ORDERS ARE REFUSED RATHER THAN ROUNDED ----------------------------
const started = createPortfolio();
const badShareCalls: Array<[number, string]> = [
  [0, 'zero'], [-5, 'negative'], [2.5, 'fractional'], [Number.NaN, 'NaN'], [Number.POSITIVE_INFINITY, 'infinite'],
];
const refused = badShareCalls.filter(([shares]) =>
  !buyShares(started, { teamId: 'alp', shares, price: 500, date: '2026-05-01', marketSize: 50 }).ok).length;
check(
  'zero, negative, fractional, NaN and infinite share counts are all refused',
  refused === badShareCalls.length,
  `${refused}/${badShareCalls.length} refused: ${badShareCalls.map(([, w]) => w).join(', ')}. Rounding `
  + '2.5 to 2 would let a fractional position exist in a ledger whose every other number is an '
  + 'integer, and the cost basis would no longer divide evenly on the way out.',
);

// -- 8. NO SHORTING BY ACCIDENT ---------------------------------------------------------------------
let shorted = 0;
let sold: Portfolio = unwrap(buyShares(createPortfolio(), {
  teamId: 'cor', shares: 5, price: 100, date: '2026-05-01', marketSize: 50,
}));
for (const attempt of [6, 50, 1000]) {
  const res = sellShares(sold, { teamId: 'cor', shares: attempt, price: 100 });
  if (!res.ok) shorted += 1;
}
const positionGone = sellShares(sold, { teamId: 'cor', shares: 5, price: 100 });
const afterExit = positionGone.ok ? sellShares(positionGone.portfolio, { teamId: 'cor', shares: 1, price: 100 }) : null;
check(
  'selling more than is held is refused -- there is no way to accidentally go short',
  shorted === 3 && positionGone.ok && afterExit !== null && !afterExit.ok && !positionIn(sold, 'cor') === false,
  `selling 6, 50 and 1000 of a 5-share position are all refused (${shorted}/3). After closing it fully, `
  + `selling 1 more is refused too ("${rejectionOf(afterExit ?? positionGone)}"). §6.3 defers shorts, and `
  + 'this is the line that keeps the deferral honest.',
);

// -- 9. THE ACCOUNTING IDENTITY HOLDS: REALISED PLUS UNREALISED IS THE TOTAL GAIN ----------------------
const book = unwrap(buyShares(createPortfolio(), {
  teamId: 'dra', shares: 12, price: 20, date: '2026-05-01', marketSize: 50,
}));
const marked = markValue(book, { dra: 400 });
const gain = marked.totalCents - STARTING_CASH_CENTS;
check(
  'total portfolio value minus starting cash equals realised plus unrealised, exactly',
  gain === book.realisedCents + marked.unrealisedCents && marked.holdingsCents === centsFor(400) * 12,
  `12 shares at $20.00 absorbed ${dollars(STARTING_CASH_CENTS - book.cashCents)} of cash and are `
  + `marked at ${dollars(marked.holdingsCents)} on a $400 close. Total gain ${dollars(gain)} = realised `
  + `${dollars(book.realisedCents)} + unrealised ${dollars(marked.unrealisedCents)}, with no third term.`,
);

// -- 10. A POSITION WITH NO CLOSE IS HELD AT COST, NOT MARKED TO ZERO --------------------------------
const noClose = markValue(book, {});
check(
  'a position whose club has no close is held at cost, so a missing price cannot invent a loss',
  noClose.unpriced === 1 && noClose.holdingsCents === book.positions[0].costCents
  && noClose.unrealisedCents === 0,
  `with an empty close map the position is carried at its ${dollars(book.positions[0].costCents)} cost `
  + 'basis, unrealised flat, and it is flagged unpriced. Marking it at zero would book a total loss '
  + 'for a club the market simply has not printed yet.',
);

// -- 11. AVERAGING A POSITION DOES NOT TOUCH REALISED -------------------------------------------------
const added = unwrap(buyShares(createPortfolio(), {
  teamId: 'dra', shares: 12, price: 15, date: '2026-05-01', marketSize: 50,
}));
const doubled = unwrap(buyShares(added, {
  teamId: 'dra', shares: 6, price: 10, date: '2026-05-10', marketSize: 50,
}));
const merged = positionIn(doubled, 'dra');
check(
  'adding to a position averages the cost basis and books nothing as realised',
  doubled.realisedCents === 0 && merged?.shares === 18
  && merged.costCents === 24000 && averageCost(merged!) === 24000 / 18 / 100,
  `12 at $15.00 then 6 at $10.00 -> ${merged?.shares} shares for ${dollars(merged?.costCents ?? 0)}, `
  + `an average of ${dollars(Math.round(averageCost(merged!) * 100))}. Realised is still `
  + `${dollars(doubled.realisedCents)}: nothing has been sold, so nothing has been realised.`,
);

// -- 12. A PORTFOLIO IS EMPTY AND FLAT BEFORE ANY TRADE ------------------------------------------------
const virgin = createPortfolio();
const virginMark = markValue(virgin, {});
check(
  'a fresh portfolio is exactly the starting cash with nothing held',
  virgin.cashCents === STARTING_CASH_CENTS && virgin.positions.length === 0
  && virgin.realisedCents === 0 && virginMark.totalCents === STARTING_CASH_CENTS,
  `${dollars(virgin.cashCents)}, no positions, no realised P&L, total value ${dollars(virginMark.totalCents)}.`,
);

// -- 13. A CLEAN SAVE ROUNDS-TRIPS, AND CASH IS RE-DERIVED ON THE WAY BACK ----------------------------
/*
  A FAKE localStorage, because the module reads and writes through the global. Assigning to
  `globalThis` rather than importing a mock keeps the check honest about the one thing that
  matters: that the stored cash is IGNORED, not merely overwritten.
*/
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string): void => { store.set(k, v); },
  removeItem: (k: string): void => { store.delete(k); },
};
(globalThis as unknown as { localStorage: unknown }).localStorage = fakeStorage;

const traded = unwrap(buyShares(createPortfolio(), {
  teamId: 'alp', shares: 3, price: 120, date: '2026-05-01', marketSize: 60,
}));
const roundTripped = unwrap(sellShares(traded, { teamId: 'alp', shares: 1, price: 200 }));
savePortfolio(roundTripped);
const reloaded = loadPortfolio();
check(
  'a clean save round-trips with positions, cash and realised P&L intact',
  loadPortfolioLastWarning === null
  && reloaded.positions.length === 1
  && reloaded.positions[0].shares === 2
  && reloaded.realisedCents === roundTripped.realisedCents
  && reloaded.cashCents === derivedCashCents(roundTripped)
  && JSON.stringify(reloaded) === JSON.stringify(roundTripped),
  `3 shares at $120, sold 1 at $200 -> 2 left, realised ${dollars(roundTripped.realisedCents)}, cash `
  + `${dollars(roundTripped.cashCents)}. Reloaded byte-identical with no warning.`,
);

check(
  'the RELOADED cash is derived, and a tampered stored figure is corrected and reported',
  (() => {
    const raw = JSON.parse(store.get('gpb_hxse_portfolio_v1') as string) as Record<string, unknown>;
    raw.cashCents = 9_999_99;
    store.set('gpb_hxse_portfolio_v1', JSON.stringify(raw));
    const fixed = loadPortfolio();
    return fixed.cashCents === derivedCashCents(roundTripped)
      && loadPortfolioLastWarning !== null
      && loadPortfolioLastWarning.includes('disagreed');
  })(),
  `stored cash was rewritten to $9,999.99; the load returned ${dollars(derivedCashCents(roundTripped))} `
  + `and warned: "${loadPortfolioLastWarning}". The stored figure is never used, only disagreed with.`,
);

const corruptions: Array<[string, unknown, (p: Portfolio) => boolean]> = [
  ['not an object', 'nonsense', (p) => p.positions.length === 0],
  ['realised P&L as a float', { cashCents: 1, positions: [], realisedCents: 1.5 }, (p) => p.positions.length === 0],
  ['realised P&L missing', { cashCents: 1, positions: [] }, (p) => p.positions.length === 0],
  ['fractional shares', { realisedCents: 0, positions: [{ teamId: 'a', shares: 1.5, costCents: 10, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['negative shares', { realisedCents: 0, positions: [{ teamId: 'a', shares: -2, costCents: 10, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['negative cost basis', { realisedCents: 0, positions: [{ teamId: 'a', shares: 2, costCents: -10, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['empty club id', { realisedCents: 0, positions: [{ teamId: '', shares: 2, costCents: 10, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['no opening date', { realisedCents: 0, positions: [{ teamId: 'a', shares: 2, costCents: 10 }] }, (p) => p.positions.length === 0],
  [
    'one good position among bad ones',
    {
      realisedCents: 0,
      positions: [
        { teamId: 'keep', shares: 2, costCents: 500, openedOn: '2026-05-01' },
        { teamId: 'drop', shares: -1, costCents: 500, openedOn: '2026-05-01' },
      ],
    },
    (p) => p.positions.length === 1 && p.positions[0].teamId === 'keep',
  ],
  [
    'the same club saved twice',
    {
      realisedCents: 0,
      positions: [
        { teamId: 'dup', shares: 2, costCents: 500, openedOn: '2026-05-01' },
        { teamId: 'dup', shares: 9, costCents: 500, openedOn: '2026-05-02' },
      ],
    },
    (p) => p.positions.length === 1 && p.positions[0].shares === 9,
  ],
];
let corruptionFailures = 0;
let warnedCount = 0;
for (const [, payload, survives] of corruptions) {
  store.set('gpb_hxse_portfolio_v1', JSON.stringify(payload));
  const got = loadPortfolio();
  if (!survives(got)) corruptionFailures += 1;
  if (loadPortfolioLastWarning !== null) warnedCount += 1;
  if (!reconciles(got)) corruptionFailures += 1;
}
store.set('gpb_hxse_portfolio_v1', '{ this is not json');
const fromJunk = loadPortfolio();
check(
  'every malformed save is handled, and every loaded portfolio RECONCILES afterwards',
  corruptionFailures === 0 && warnedCount === corruptions.length && fromJunk.positions.length === 0,
  `${corruptions.length} corrupt shapes: all ${warnedCount} produced a warning rather than a silent `
  + `pass, every surviving portfolio satisfies the invariant, and literal broken JSON falls back to a `
  + `fresh one. The two rows above that are NOT refused outright are the deliberate cases: one good `
  + 'position is kept when its neighbour is malformed, and a club saved twice collapses to the last.',
);

check(
  'an ABSENT save reads as a fresh portfolio, not a failure',
  (() => {
    store.delete('gpb_hxse_portfolio_v1');
    const p = loadPortfolio();
    return p.cashCents === STARTING_CASH_CENTS && p.positions.length === 0 && loadPortfolioLastWarning === null;
  })(),
  'with no stored text at all the loader returns the opening balance and no warning, because nothing '
  + 'went wrong and there is nothing to report.',
);

let failed = 0;
console.log('\nHXSE POSITIONS LEDGER\n');
for (const c of checks) {
  if (!c.pass) failed += 1;
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}   ${c.label}`);
  if (c.detail) console.log(`          ${c.detail}`);
}
console.log(`\n  ${checks.length - failed}/${checks.length} checks PASS\n`);
if (failed > 0) process.exitCode = 1;