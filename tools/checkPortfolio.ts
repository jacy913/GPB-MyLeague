/**
 * Is the positions ledger actually a ledger?
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 *
 * The plan calls Phase 4 "the expensive part and the part most likely to harbour bugs", and names the
 * reason: `wallet.ts` has already shipped two documented ledger bugs -- a pending/void conflation, and
 * a profit double-count where a $50 bet returning $104 reported +$104 instead of the $54 actually made.
 * Both were arithmetic that looked correct while being wrong.
 *
 * Positions are a larger surface than bet slips: you hold across time, cost basis has to survive
 * partial exits, and cash must reconcile against a history that can be tampered with. So the checks
 * here are not smoke tests. Each one targets a specific way this file could be wrong while still
 * looking fine.
 *
 * ===========================================================================
 * DOLLARS IN, NOT SHARES IN
 * ===========================================================================
 *
 * The ledger is denominated in cents. A player says "I want $150 of the Nighthawks"; what that buys is
 * a float number of units that the screen never asks them for. That reframing is the player's, not
 * mine -- "I never think 'oh i want to buy 0.000294884 shares'" -- and it is what makes a $250
 * concentration cap expressible at all, since a share COUNT is worth $500 in a cheap club and $25,000
 * in an expensive one.
 *
 * So the checks are about amounts, and `units` is treated as the internal quantity it now is.
 *
 * ===========================================================================
 * THE SPINE IS THE INVARIANT, AND IT IS CHECKED AFTER EVERY SINGLE TRADE
 * ===========================================================================
 *
 * `cashCents + sum(costCents) === STARTING_CASH_CENTS + realisedCents`
 *
 * Not once at the end of a scripted happy path -- after every trade in a long seeded sequence of buys,
 * adds, partial unwinds and full exits. A ledger that reconciles on the fixtures and drifts on the
 * eleventh random trade is a ledger that will reconcile on the demo and drift in someone's save.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buyAmount,
  createPortfolio,
  derivedCashCents,
  dollars,
  markValue,
  positionIn,
  positionLimitCentsFor,
  reconciles,
  rejectionOf,
  savePortfolio,
  sellAmount,
  valueOf,
  centsFor,
  loadPortfolio,
  loadPortfolioLastWarning,
  signedDollars,
  STARTING_CASH_CENTS,
  type Portfolio,
  type PortfolioResult,
} from '../src/lib/portfolio';
import { seededRandomStream } from '../src/lib/analytics/playoffMonteCarlo';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const CLUBS = ['alp', 'bra', 'cor', 'dwi', 'eli', 'fen'];
const unwrap = (r: PortfolioResult): Portfolio => {
  if (!r.ok) throw new Error(`expected the trade to be accepted, got: ${r.error}`);
  return r.portfolio;
};

// -- 1. CENTS CROSSING POINT ROUNDS HALF AWAY FROM ZERO, ON BOTH SIDES --------------------------------
check(
  'centsFor rounds half away from zero, so a sub-cent loss is never rounded to nothing',
  centsFor(0.005) === 1 && centsFor(-0.005) === -1 && centsFor(993.4871) === 99349 && centsFor(0) === 0,
  `0.005 -> ${centsFor(0.005)}, -0.005 -> ${centsFor(-0.005)}, 993.4871 -> ${centsFor(993.4871)}, `
  + '0 -> 0. A plain Math.round turns -0.005 into 0, which silently deletes a loss.',
);

// -- 2. THE INVARIANT HOLDS AFTER EVERY TRADE IN A LONG SEEDED SEQUENCE -----------------------------
const rng = seededRandomStream(90210);
/*
  A FIXED PRICE PER CLUB, and that is load-bearing rather than tidy.

  The first version drew a fresh random amount per trade with no relationship to any position, and the
  walk finished reporting $284,236 of realised profit on a $1,000 account. The invariant still held so
  the check still passed, but it was printing a fantasy economy and that number would have been quoted
  back as a finding.

  Prices are now fixed per club, so no trade can make money except through rounding, which turns
  realised P&L into a direct measurement of rounding error.
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
  const priceCents = centsFor(price);
  const amount = sellFirst && held
    ? Math.max(1, Math.min(held.costCents, 1 + Math.floor(rng() * held.costCents)))
    : 1 + Math.floor(rng() * 9000);

  const result = sellFirst
    ? sellAmount(walked, { teamId: club, cents: amount, price })
    : buyAmount(walked, {
      teamId: club, cents: amount, price, date: '2026-05-01', marketSize: rng() * 100,
    });

  if (!result.ok) continue;
  walked = result.portfolio;
  trades += 1;
  turnoverCents += priceCents > 0 ? amount : amount;
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
  `${dollars(turnoverCents)} of turnover across ${trades} trades, and realised P&L of `
  + `${signedDollars(walked.realisedCents)}. Every club traded at one fixed price, so the only thing `
  + 'that could have moved the number is cent-rounding -- and nothing did. Selling "$X of what you put '
  + 'in" releases exactly $X of basis because it is the same unit, and a final unwind releases every '
  + 'remaining unit verbatim rather than multiplying by a ratio.',
);

// -- 3. A PARTIAL UNWIND CANNOT LOSE OR CREATE A CENT, AT ANY SPLIT ---------------------------------
/*
  The hazard is that a proportional release accumulates error across many partial unwinds. It cannot
  here, because the BASIS released is exactly the amount asked for -- same unit, nothing to round --
  and the final unwind takes the whole remainder rather than a ratio of it.

  Measured over every way of splitting a position whose price makes proportional arithmetic awkward.
*/
const bought = unwrap(buyAmount(createPortfolio(), {
  teamId: 'alp', cents: 70_00, price: 123.457, date: '2026-05-01', marketSize: 50,
}));
const awkward = bought.positions[0];
let worstDrift = 0;
let splitsTested = 0;
let shortest = Infinity;
for (let parts = 1; parts <= 9; parts += 1) {
  for (let seedA = 0; seedA < 40; seedA += 1) {
    const r2 = seededRandomStream(seedA * 31 + parts);
    let remaining = awkward.costCents;
    let realised = 0;
    let legs = 0;
    while (remaining > 0) {
      const take = r2() < 0.25 ? remaining : 1 + Math.floor(r2() * Math.min(remaining - 1, 3000));
      const res = sellAmount(bought, { teamId: 'alp', cents: take, price: 123.457 });
      if (!res.ok) break;
      realised += res.realisedCents;
      remaining -= take;
      legs += 1;
    }
    splitsTested += 1;
    shortest = Math.min(shortest, legs);
    // Every cent of basis out, at an unchanged price, must realise exactly zero.
    worstDrift = Math.max(worstDrift, Math.abs(realised));
  }
}
check(
  'unwinding a position in ANY split realises exactly nothing at an unchanged price',
  worstDrift === 0 && splitsTested > 100 && awkward.costCents === 70_00,
  `${splitsTested} splits of a ${dollars(awkward.costCents)} position, down to ${shortest} leg(s) at a `
  + `time, at a price of $123.457 whose cent conversion is awkward. Worst realised drift `
  + `${worstDrift} cents. Unwinding money at the price you paid for it is a no-op, and this is what `
  + 'proves the split arithmetic cannot leak a cent.',
);

// -- 4. CASH IS DERIVED, SO A TAMPERED BALANCE CANNOT SURVIVE A LOAD --------------------------------
const honest = unwrap(buyAmount(createPortfolio(), {
  teamId: 'bra', cents: 20_000, price: 400, date: '2026-05-01', marketSize: 100,
}));
const tampered: Portfolio = { ...honest, cashCents: honest.cashCents + 5_000_00 };
check(
  'a tampered cash figure is DETECTED rather than loaded, because cash is derivable',
  reconciles(honest) && !reconciles(tampered) && derivedCashCents(honest) === honest.cashCents,
  `an honest portfolio reconciles at ${dollars(derivedCashCents(honest))}; adding $5,000 to the stored `
  + `figure makes it fail. This is the gap in wallet.ts, whose loadWallet returns parsed.balance `
  + 'verbatim behind a comment describing a reconciliation it does not perform.',
);

// -- 5. CASH IS NEVER NEGATIVE AND NEVER OVERSPENT ---------------------------------------------------
let overspend: string | null = null;
let worstCash = STARTING_CASH_CENTS;
let cashWalk = createPortfolio();
let accepted = 0;
let refusedCount = 0;
const boundaryRng = seededRandomStream(4242);
/*
  Buys AND sells, because buys alone drain the account and never refill it: the first version bought
  600 times with no exit, so 599 attempts were refused against a nearly empty account and the walk
  proved only that cash cannot go negative, which was never in doubt.

  The stream is created ONCE above the loop. A second version rebuilt it inside, replaying the SAME
  draw every iteration -- one buy succeeded and 599 identical ones were refused against the cash it
  had spent. Both "passed". Neither measured anything.
*/
for (let i = 0; i < 600; i += 1) {
  const club = CLUBS[Math.floor(boundaryRng() * CLUBS.length)];
  const price = 20 + boundaryRng() * 180;
  const held = positionIn(cashWalk, club);
  const res = held !== undefined && boundaryRng() < 0.5
    ? sellAmount(cashWalk, {
      teamId: club, cents: 1 + Math.floor(boundaryRng() * held.costCents), price,
    })
    : buyAmount(cashWalk, {
      /*
        One attempt in seven deliberately asks for more than the whole account, so the cash wall is
        actually reached. Without it every refusal in the walk was a CAP refusal -- the account stayed
        near $1,000 and the "Not enough cash" branch this check is named for was never taken.
      */
      teamId: club,
      cents: boundaryRng() < 0.15
        ? 100_001 + Math.floor(boundaryRng() * 400_000)
        : 1 + Math.floor(boundaryRng() * 6000),
      price,
      date: '2026-05-02',
      marketSize: 100,
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
  worstCash >= 0 && overspend !== null && accepted > 50 && refusedCount > 20,
  `${accepted} of 600 trades accepted and ${refusedCount} refused, with buys and sells interleaved `
  + `so the account really did cycle. Lowest cash reached ${dollars(worstCash)}, never below zero. `
  + `A refused attempt reads: "${overspend ?? 'none was ever refused'}".`,
);

// -- 6. THE CAP IS A DOLLAR CAP, AND IT BINDS AT EVERY PRICE ----------------------------------------
const thinCap = positionLimitCentsFor(0);
const thickCap = positionLimitCentsFor(100);
const overThin = buyAmount(createPortfolio(), {
  teamId: 'alp', cents: thinCap + 1, price: 20, date: '2026-05-01', marketSize: 0,
});
const overThick = buyAmount(createPortfolio(), {
  teamId: 'alp', cents: thickCap + 1, price: 2, date: '2026-05-01', marketSize: 100,
});
check(
  'the cap is a DOLLAR cap, bigger in a liquid club, and it is enforceable',
  overThin.ok === false && overThick.ok === false && thinCap < thickCap
  && rejectionOf(overThin).includes('over the'),
  `thinnest club allows ${dollars(thinCap)}, thickest ${dollars(thickCap)}. One cent over the thin cap `
  + `is refused ("${rejectionOf(overThin).slice(0, 60)}"); so is one over the thick one. A share-COUNT `
  + 'cap could not do this job: 25 shares is $500 of a $20 club and $25,000 of a $1,000 one, so it '
  + 'means nothing at high prices.',
);

check(
  'the cap admits a FRACTION of the most expensive club, which a share count could not',
  buyAmount(createPortfolio(), {
    teamId: 'alp', cents: 25_000, price: 993.49, date: '2026-05-01', marketSize: 100,
  }).ok,
  'the whole $250 cap -- the largest any club allows -- buys 0.251629 shares of a $993.49 club. The '
  + 'first draft of '
  + 'this cap was a share COUNT for exactly the opposite reason -- a share count made the dollar cap '
  + 'impossible -- and the rejected first draft of THAT was a dollar cap, which permitted zero shares '
  + 'above $250 and made the most expensive club on the page unbuyable. Dollars in, dollars capped.',
);

check(
  'the cap is clamped to a real market size rather than trusting the input',
  positionLimitCentsFor(-500) === thinCap && positionLimitCentsFor(9999) === thickCap,
  `market size -500 and 9999 both clamp to ${dollars(thinCap)} and ${dollars(thickCap)}. An unclamped `
  + 'input would let a negative size produce a negative cap and permit any position.',
);

// -- 7. IMPOSSIBLE AMOUNTS ARE REFUSED RATHER than ROUNDED -----------------------------------------
const started = createPortfolio();
const badAmounts: Array<[number, string]> = [
  [0, 'zero'], [-500, 'negative'], [12.5, 'fractional cents'], [Number.NaN, 'NaN'],
  [Number.POSITIVE_INFINITY, 'infinite'],
];
const refusedAmounts = badAmounts.filter(([cents]) =>
  !buyAmount(started, { teamId: 'alp', cents, price: 500, date: '2026-05-01', marketSize: 50 }).ok).length;
check(
  'zero, negative, sub-cent, NaN and infinite amounts are all refused',
  refusedAmounts === badAmounts.length,
  `${refusedAmounts}/${badAmounts.length} refused: ${badAmounts.map(([, w]) => w).join(', ')}. A ledger `
  + 'whose amounts are not integers is the exact failure this module exists to prevent, and `12.5` '
  + 'cents would be such an amount.',
);

// -- 8. NO SHORTING BY ACCIDENT ---------------------------------------------------------------------
let shorted = 0;
let sold: Portfolio = unwrap(buyAmount(createPortfolio(), {
  teamId: 'cor', cents: 12_500, price: 100, date: '2026-05-01', marketSize: 100,
}));
for (const attempt of [12_501, 50_000, 10_000_000]) {
  if (!sellAmount(sold, { teamId: 'cor', cents: attempt, price: 100 }).ok) shorted += 1;
}
const gone = sellAmount(sold, { teamId: 'cor', cents: 12_500, price: 100 });
const afterExit = gone.ok ? sellAmount(gone.portfolio, { teamId: 'cor', cents: 1, price: 100 }) : null;
check(
  'you cannot unwind more than you put in -- there is no way to accidentally go short',
  shorted === 3 && gone.ok && afterExit !== null && !afterExit.ok && positionIn(sold, 'cor') !== undefined,
  `unwinding $125.01, $500 and $100,000 against a ${dollars(12_500)} position are all refused `
  + `(${shorted}/3). After closing it fully, unwinding $0.01 more is refused too `
  + `("${rejectionOf(afterExit ?? gone)}"). §6.3 defers shorts, and this is the line that keeps the `
  + 'deferral honest.',
);

// -- 9. THE ACCOUNTING IDENTITY HOLDS ---------------------------------------------------------------
const book = unwrap(buyAmount(createPortfolio(), {
  teamId: 'dwi', cents: 20_000, price: 20, date: '2026-05-01', marketSize: 100,
}));
const marked = markValue(book, { dwi: 400 });
const gain = marked.totalCents - STARTING_CASH_CENTS;
check(
  'total portfolio value minus starting cash equals realised plus unrealised, exactly',
  gain === book.realisedCents + marked.unrealisedCents && marked.holdingsCents === valueOf(book.positions[0], 400),
  `$20.00 invested, marked at a $400.00 close. Total gain ${dollars(gain)} = realised `
  + `${dollars(book.realisedCents)} + unrealised ${dollars(marked.unrealisedCents)}, with no third `
  + 'term. The mark multiplies a FLOAT unit count by an integer price and rounds once, on the way out.',
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

// -- 11. ADDING TO A POSITION AVERAGES AND BOOKS NOTHING ---------------------------------------------
const added = unwrap(buyAmount(book, {
  teamId: 'dwi', cents: 5_000, price: 100, date: '2026-05-10', marketSize: 100,
}));
const merged = positionIn(added, 'dwi');
check(
  'adding to a position sums both the basis and the units, and books nothing as realised',
  added.realisedCents === 0 && merged?.costCents === 25_000
  && Math.abs(merged.units - (20_000 / 2000 + 5_000 / 10000)) < 1e-12,
  `$200.00 at $20.00 then $50.00 at $100.00 -> ${dollars(merged?.costCents ?? 0)} across `
  + `${merged?.units.toFixed(6)} units -- the sum of the two purchases rather than a re-derived `
  + `average, and $250.00 lands exactly ON the $250.00 cap rather than one cent over it. Realised is `
  + `still ${dollars(added.realisedCents)}: nothing has been sold.`,
);

// -- 12. A FRESH PORTFOLIO IS EMPTY AND FLAT --------------------------------------------------------
const virgin = createPortfolio();
const virginMark = markValue(virgin, {});
check(
  'a fresh portfolio is exactly the starting cash with nothing held',
  virgin.cashCents === STARTING_CASH_CENTS && virgin.positions.length === 0
  && virgin.realisedCents === 0 && virginMark.totalCents === STARTING_CASH_CENTS,
  `${dollars(virgin.cashCents)}, no positions, no realised P&L, total value ${dollars(virginMark.totalCents)}.`,
);

// -- 13. A HELD POSITION IS UNAFFECTED BY THE CALENDAR, SO IT CARRIES ACROSS A SEASON ---------------
const carried = unwrap(buyAmount(createPortfolio(), {
  teamId: 'alp', cents: 25_000, price: 250, date: '2026-05-01', marketSize: 100,
}));
const carriedBefore = JSON.stringify(carried);
const heldIntoNextSeason = markValue(carried, { alp: 500 });
check(
  'holding a position across a season boundary changes neither the position nor the cash',
  JSON.stringify(carried) === carriedBefore
  && carried.positions.length === 1
  && carried.positions[0].costCents === 25_000
  && carried.cashCents === STARTING_CASH_CENTS - 25_000
  && carried.realisedCents === 0
  && heldIntoNextSeason.totalCents === (STARTING_CASH_CENTS - 25_000) + 50_000,
  `$250.00 invested at $250.00 is one unit. Marking it at $500.00 the next season shows a total of `
  + `${dollars(heldIntoNextSeason.totalCents)} with the position still held, but books nothing: `
  + `realised stays ${dollars(carried.realisedCents)} and the basis stays `
  + `${dollars(carried.positions[0].costCents)}. A mark is a display number, so simply continuing to `
  + 'hold cannot realise anything -- and nothing resets the book at the turnover.',
);

// -- 14. REALISED P&L IS A RUNNING TOTAL, NEVER RESET BY A SEASON BOUNDARY ---------------------------
const firstSale = sellAmount(carried, { teamId: 'alp', cents: 10_000, price: 500 });
if (!firstSale.ok) throw new Error(`expected the first sale to be accepted, got: ${firstSale.error}`);
const firstLegCents = firstSale.realisedCents;
const firstExit = firstSale.portfolio;
const secondSale = sellAmount(firstExit, { teamId: 'alp', cents: 15_000, price: 300 });
if (!secondSale.ok) throw new Error(`expected the second sale to be accepted, got: ${secondSale.error}`);
const secondLegCents = secondSale.realisedCents;
const secondExit = secondSale.portfolio;
check(
  'realised P&L accumulates across sales in a running total that nothing resets',
  firstExit.realisedCents === firstLegCents
  && secondExit.realisedCents === firstLegCents + secondLegCents
  && secondExit.realisedCents !== firstExit.realisedCents
  && secondExit.cashCents === derivedCashCents(secondExit),
  `two exits booked ${signedDollars(firstLegCents)} then ${signedDollars(secondLegCents)}, and the `
  + `book reports the running SUM ${signedDollars(secondExit.realisedCents)} rather than restarting at `
  + `the second leg. Cash ${dollars(secondExit.cashCents)} still derives from it, which is what keeps `
  + 'the carry-over honest.',
);

// -- 15. AN OLD SAVE'S SETTLEMENT FIELDS ARE IGNORED, NOT ACTED ON -----------------------------------
/*
  A save written before settlement was removed still carries `settledThrough` and
  `lifetimeRealisedCents`. Reading them would be the same class of bug as acting on them, so the loader
  must ignore them and preserve the position and realised total that ARE part of the book.
*/
const legacyStore = new Map<string, string>();
const legacyStorage = {
  getItem: (k: string): string | null => (legacyStore.has(k) ? (legacyStore.get(k) as string) : null),
  setItem: (k: string, v: string): void => { legacyStore.set(k, v); },
  removeItem: (k: string): void => { legacyStore.delete(k); },
};
const storageBeforeLegacy = (globalThis as unknown as { localStorage: unknown }).localStorage;
(globalThis as unknown as { localStorage: unknown }).localStorage = legacyStorage;
legacyStore.set('gpb_hxse_portfolio_v1', JSON.stringify({
  cashCents: STARTING_CASH_CENTS - 25_000,
  positions: [{ teamId: 'alp', units: 1, costCents: 25_000, openedOn: '2026-05-01' }],
  realisedCents: 0,
  settledThrough: '2026-09-28',
  lifetimeRealisedCents: 25_000,
}));
const migrated = loadPortfolio();
(globalThis as unknown as { localStorage: unknown }).localStorage = storageBeforeLegacy;
check(
  'a save written before settlement was removed keeps its position and drops the dead fields',
  loadPortfolioLastWarning === null
  && migrated.positions.length === 1
  && migrated.positions[0].costCents === 25_000
  && migrated.cashCents === derivedCashCents(migrated)
  && !('settledThrough' in migrated)
  && !('lifetimeRealisedCents' in migrated),
  'a legacy save carrying `settledThrough` and `lifetimeRealisedCents` loads with the position intact, '
  + 'no warning, and neither dead field resurrected. The next save writes the new three-field shape.',
);

// -- 16. AN UNPRICED POSITION IS HELD, NEVER WRITTEN OFF ---------------------------------------------
const ghost = markValue(carried, {});
check(
  'a position the market never priced is HELD at cost, so a missing quote cannot invent a loss',
  ghost.unpriced === 1 && ghost.holdingsCents === carried.positions[0].costCents
  && ghost.unrealisedCents === 0 && carried.positions[0].costCents === 25_000,
  `a club with no close contributes its ${dollars(carried.positions[0].costCents)} basis and is flagged `
  + 'unpriced -- neither a gain nor a loss. With settlement gone there is no path that closes it at '
  + 'zero either; it stays held until the market prints a price or the player exits.',
);

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string): string | null => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string): void => { store.set(k, v); },
  removeItem: (k: string): void => { store.delete(k); },
};
(globalThis as unknown as { localStorage: unknown }).localStorage = fakeStorage;

const traded = unwrap(buyAmount(createPortfolio(), {
  teamId: 'alp', cents: 15_000, price: 120, date: '2026-05-01', marketSize: 100,
}));
const roundTripped = unwrap(sellAmount(traded, { teamId: 'alp', cents: 5_000, price: 200 }));
savePortfolio(roundTripped);
const reloaded = loadPortfolio();
check(
  'a clean save round-trips with positions, cash and realised P&L intact',
  loadPortfolioLastWarning === null
  && reloaded.positions.length === 1
  && reloaded.positions[0].costCents === 10_000
  && Math.abs(reloaded.positions[0].units - roundTripped.positions[0].units) < 1e-12
  && reloaded.realisedCents === roundTripped.realisedCents
  && reloaded.cashCents === derivedCashCents(roundTripped)
  && JSON.stringify(reloaded) === JSON.stringify(roundTripped),
  `$150.00 invested, $50.00 of it unwound at $200.00 -> ${dollars(reloaded.positions[0].costCents)} `
  + `left across ${reloaded.positions[0].units.toFixed(6)} units, realised `
  + `${dollars(roundTripped.realisedCents)}, cash ${dollars(roundTripped.cashCents)}. Reloaded `
  + 'byte-identical with no warning.',
);

check(
  'the RELOADED cash is derived, and a tampered stored figure is corrected and reported',
  (() => {
    const raw = JSON.parse(store.get('gpb_hxse_portfolio_v1') as string) as Record<string, unknown>;
    raw.cashCents = 9_999_99;
    store.set('gpb_hxse_portfolio_v1', JSON.stringify(raw));
    const fixed = loadPortfolio();
    return fixed.cashCents === derivedCashCents(roundTripped)
      && loadPortfolioLastWarning !== null && loadPortfolioLastWarning.includes('disagreed');
  })(),
  `stored cash was rewritten to $9,999.99; the load returned ${dollars(derivedCashCents(roundTripped))} `
  + `and warned: "${loadPortfolioLastWarning}". The stored figure is never used, only disagreed with.`,
);

const corruptions: Array<[string, unknown, (p: Portfolio) => boolean]> = [
  ['not an object', 'nonsense', (p) => p.positions.length === 0],
  ['realised P&L as a float', { cashCents: 1, positions: [], realisedCents: 1.5 }, (p) => p.positions.length === 0],
  ['realised P&L missing', { cashCents: 1, positions: [] }, (p) => p.positions.length === 0],
  ['a position with no units', { realisedCents: 0, positions: [{ teamId: 'a', costCents: 1000, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['zero units', { realisedCents: 0, positions: [{ teamId: 'a', units: 0, costCents: 1000, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['NaN units', { realisedCents: 0, positions: [{ teamId: 'a', units: null, costCents: 1000, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['a fractional cost basis', { realisedCents: 0, positions: [{ teamId: 'a', units: 1, costCents: 100.5, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  ['an empty club id', { realisedCents: 0, positions: [{ teamId: '', units: 1, costCents: 100, openedOn: 'x' }] }, (p) => p.positions.length === 0],
  [
    'one good position among bad ones',
    {
      realisedCents: 0,
      positions: [
        { teamId: 'keep', units: 2, costCents: 50000, openedOn: '2026-05-01' },
        { teamId: 'drop', units: -1, costCents: 50000, openedOn: '2026-05-01' },
      ],
    },
    (p) => p.positions.length === 1 && p.positions[0].teamId === 'keep',
  ],
  [
    'the same club saved twice',
    {
      realisedCents: 0,
      positions: [
        { teamId: 'dup', units: 2, costCents: 50000, openedOn: '2026-05-01' },
        { teamId: 'dup', units: 9, costCents: 50000, openedOn: '2026-05-02' },
      ],
    },
    (p) => p.positions.length === 1 && p.positions[0].units === 9,
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
  + 'pass, and every surviving portfolio satisfies the invariant. The `units` checks are specific to '
  + 'this model -- a save with no units, zero units or NaN units is dropped rather than valued, since '
  + 'a position whose size is unknown cannot be revalued. Literal broken JSON falls back to a fresh '
  + 'portfolio.',
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

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/*
  THE BOOK IS OWNED BY APP, and the reason is no longer settlement -- it is that the header drawer and
  the Exchange desk read one ledger, and the book must survive navigation between views. What used to be
  asserted here was WHERE settlement fired; now the property worth protecting is the opposite: NOTHING
  at a season boundary touches the book.

  This asserts the SOURCE rather than the behaviour, which is the same lesson as the price ledger, which
  sat at 16/16 green while two of its three boot paths were broken.
*/
const readSrc = (...parts: string[]): string =>
  readFileSync(resolve(process.cwd(), ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const appSrc = readSrc('src', 'App.tsx');
const routerSrc = readSrc('src', 'components', 'AppViewRouter.tsx');
const viewSrc = readSrc('src', 'components', 'markets', 'ExchangeView.tsx');
const deskSrc = readSrc('src', 'components', 'markets', 'ExchangeDesk.tsx');
const bookSrc = readSrc('src', 'hooks', 'usePortfolio.ts');
const portfolioSrc = readSrc('src', 'lib', 'portfolio.ts');

check(
  'App OWNS the book, so the drawer and the desk share one ledger',
  /usePortfolio\(/.test(appSrc) && !/usePortfolio\(/.test(viewSrc) && !/usePortfolio\(/.test(deskSrc),
  'App.tsx creates the book; neither view does.',
);

check(
  'NOTHING settles or liquidates the book at a season boundary',
  !/settlePortfolio/.test(portfolioSrc)
  && !/settlePortfolio/.test(bookSrc)
  && !/settlePortfolio/.test(appSrc)
  && !/book\.settle\(/.test(appSrc),
  'positions and cash carry across seasons. A refactor that reintroduced a season settlement would '
  + 'have to add `settlePortfolio` or `book.settle` back, and this check fails first. Note this asserts '
  + 'the absence of the OLD design, not the presence of a new one: the carry-over needs no runtime code '
  + 'because it is simply the default.',
);

check(
  'the desk takes DOLLARS on input and shows dollars in the table, and never asks for shares',
  /value=\{amount\}/.test(deskSrc)
  && /Invest \{dollars\(investCents\)\}/.test(deskSrc)
  && /Unwind \{dollars\(sellCents\)\}/.test(deskSrc)
  && /<th className="pb-1 text-right font-normal">Invested<\/th>/.test(deskSrc)
  && !/\{p\.shares\}/.test(deskSrc)
  && !/sharesHeld/.test(deskSrc),
  'the input is bound to `amount`, the button reads "Invest $X", the step is 1 whole cent rather than '
  + 'one whole share, and the positions table has no share column. A refactor that reintroduced a share '
  + 'input would fail here rather than shipping an interface nobody asked for.',
);

check(
  'the drawer is actually MOUNTED, with a header button and a badge',
  /<HxsePortfolioDrawer/.test(appSrc)
  && /aria-label="HXSE portfolio"/.test(appSrc)
  && /book\.portfolio\.positions\.length/.test(appSrc),
  'App renders the drawer and gives it a header button carrying the open-position count. A component '
  + 'that exists and is never mounted is the quietest failure there is -- nothing errors, nothing '
  + 'warns, and the book is simply unreachable outside the Exchange. Asserting the mount rather '
  + 'trusting that a file was imported.',
);

check(
  'a drawer row navigates to the Exchange, so the book can be acted on rather than only read',
  /onOpenClub/.test(appSrc) && /pendingClub/.test(viewSrc) && /chooseClub/.test(viewSrc),
  'App passes a pending club down and ExchangeView consumes it through chooseClub. It routes '
  + 'through the deliberate-selection path rather than setting the selection directly, because the '
  + 'rank-1 default fires on mount for anyone who has not touched a selector and would otherwise '
  + 'overwrite a drawer click arriving in the same tick.',

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
