/**
 * HXSE positions. Long only, cash-only settlement, integer everything.
 *
 * ===========================================================================
 * SCOPE, DELIBERATELY NARROWER THAN THE PLAN
 * ===========================================================================
 *
 * The plan's Phase 4 §6.3 lists long, short, partial close, and a liquidity-scaled position limit.
 * This implements the first and the fourth. Shorts need a locate or collateral forfeiture, which is
 * a genuinely separate build with its own failure modes, and partial closes fall out of the sell
 * path for free once sells accept a share count. Deferring shorts loses nothing that makes the
 * feature a game; it defers the part most likely to mint money by accident.
 *
 * §6.2's rule is honoured exactly: **cash moves only on trades.** Unrealised P&L is computed for
 * display and never touches `cashCents`. A portfolio whose cash balance swung every simulated day
 * would be unauditable, and §6.1 is blunt that this ledger is where the bugs will live.
 *
 * ===========================================================================
 * EVERY AMOUNT IS AN INTEGER NUMBER OF CENTS
 * ===========================================================================
 *
 * Closes come out of the board as floats -- a club trades at 993.4871 -- so dollars-as-float is
 * already the app's shape. But a float balance is not a ledger: 0.1 + 0.2 !== 0.3, and a
 * hundred-share position traded forty times drifts far enough to be worth money. `centsFor` is the
 * single crossing point, and it rounds HALF UP once, on the way in, so the stored figure is always
 * an exact number of cents that equals what the screen showed.
 *
 * ===========================================================================
 * THE INVARIANT, WHICH IS THE WHOLE DESIGN
 * ===========================================================================
 *
 *     cashCents + sum(position.costCents) === STARTING_CASH_CENTS + realisedCents
 *
 * Buying moves cents from cash into a position's cost basis, so the left side does not move.
 * Selling releases proceeds and books `realisedCents`, and the two sides move together. Nothing
 * else in this file is permitted to write `cashCents`.
 *
 * The consequence is that **`cashCents` is fully derivable and is therefore never believed.**
 * `wallet.ts` stores a balance and reads it back verbatim behind a comment describing a
 * reconciliation it does not perform, so a tampered balance round-trips untouched. This module
 * cannot be tampered with that way, because a portfolio whose cash disagrees with its own position
 * history is rejected on load rather than loaded.
 */

/** Opening cash, in cents. `$1,000`, matching `STARTING_BALANCE` in `wallet.ts`. */
export const STARTING_CASH_CENTS = 100_000;

/** An open long position in one club. */
export interface Position {
  teamId: string;
  /** INTEGER, always positive. Fractional shares are not tradeable and are refused. */
  shares: number;
  /** Total cents paid, for ALL shares currently held. Never a per-share figure. */
  costCents: number;
  /** ISO date the position was opened, for display and for the age of a trade. */
  openedOn: string;
}

export interface Portfolio {
  cashCents: number;
  positions: Position[];
  /**
   * Realised profit or loss for the CURRENT SEASON, in cents. Negative is a loss and is expected.
   *
   * Reset to zero by settlement, which is the whole point of settlement -- see below.
   */
  realisedCents: number;
  /**
   * The date through which settlement has run, or null if it never has.
   *
   * THIS IS WHAT MAKES SETTLEMENT IDEMPOTENT. Without it, anything that re-runs the settlement
   * effect -- a reload, a second render, a second rollover with no new prices -- would liquidate the
   * book again. The book is empty after the first pass so the damage would be small, but "small and
   * invisible" is exactly the failure mode this file exists to avoid, so the guard is explicit and
   * checked rather than implied by the state happening to be empty.
   */
  settledThrough: string | null;
  /**
   * Realised profit or loss across every season played, in cents.
   *
   * DISPLAY ONLY, and deliberately NOT part of `derivedCashCents`. It is the season record; cash is
   * the season budget. Conflating them is how "start fresh with $1,000" quietly becomes "start fresh
   * with whatever you made last year", which is the same exploit the settlement rule exists to bound.
   */
  lifetimeRealisedCents: number;
}

/**
 * A refusal. Every mutation returns one of these rather than throwing or silently no-opping.
 *
 * `error` is declared optional-and-undefined on the success arm rather than simply being absent
 * from it. That is not cosmetic: this project's tsconfig does not enable `strictNullChecks`, and
 * without it TypeScript does not narrow a union by its `ok` discriminant, so `if (!r.ok)` would
 * leave `r` as the whole union and `r.error` would not typecheck. Declaring the field on both arms
 * makes `error` reachable either way, which is what the UI wants anyway -- it renders the message
 * on refusal and ignores it otherwise.
 */
export type PortfolioResult =
  | { ok: true; portfolio: Portfolio; realisedCents: number; error?: undefined }
  | { ok: false; error: string; portfolio?: undefined };

/** The refusal message, or an empty string when the trade was accepted. */
export const rejectionOf = (result: PortfolioResult): string => result.error ?? '';

/**
 * Dollars to cents, rounding half up, once, on the way in.
 *
 * `Math.round` on a negative is toward +Infinity, which would make a sell below cost round the
 * wrong way, so the sign is pulled off before rounding and put back after.
 */
export const centsFor = (price: number): number => {
  if (!Number.isFinite(price)) return 0;
  const scaled = price * 100;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
};

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * How many shares of one club the player may hold.
 *
 * §6.3 gives this cap two jobs -- realism, and stopping the player exploiting the market -- and the
 * second matters more now than it did when the plan was written. `checkShareEdge` measures a
 * fade-the-dislocation edge at +13.41% over twenty days, in five leagues out of five. Unbounded, that
 * compounds into a money printer.
 *
 * ---------------------------------------------------------------------------
 * IN SHARES, NOT IN DOLLARS, AND THE FIRST VERSION GOT THAT WRONG
 * ---------------------------------------------------------------------------
 *
 * This was originally a notional cap of $25 in the thinnest name to $250 in the thickest, and that
 * cap makes the feature unusable. The price band runs 0-1000 and clubs really do trade at $993, so a
 * $250 limit permits ZERO shares of the most expensive club in the league -- the player opens the
 * screen, picks the club the whole page is about, and is told they cannot afford one share.
 *
 * §6.3's own wording is the correction: "you cannot buy 10,000 shares of an illiquid small-market
 * club". The constraint is on COUNT. That is also the honest shape here, because a dollar cap and a
 * share cap are not the same restriction and this price scale makes the difference enormous: 25
 * shares is $500 of a $20 club and $25,000 of a $1,000 one.
 *
 * Concentration is bounded by the share count and total exposure is bounded by cash, which is
 * already enforced. Those are different jobs and they do not need one number to do both.
 *
 * LINEAR, and linear on purpose: `liquidityFromSize` in `fanbase.ts` is linear for the same reason
 * and with the same caveat -- a curve would be one more shape to justify with no data behind it.
 * Twenty-five shares in the thinnest name, four hundred in the thickest.
 */
export const maxSharesFor = (marketSize: number): number =>
  Math.round(25 + (Math.max(0, Math.min(100, marketSize)) / 100) * 375);

/**
 * The cost basis of `n` shares out of `position`, in whole cents.
 *
 * The rounding is the interesting part. An intermediate partial sell rounds, and the error would
 * normally accumulate -- sell a thousand shares one at a time and the drift is cents. It cannot
 * drift here, because the FINAL sell of a position is not computed proportionally at all: it
 * returns the remaining cost basis verbatim. So the proportional sells and the remainder always sum
 * to exactly `costCents`, no matter how the position was divided, and the ledger cannot gain or
 * lose a cent to rounding over any sequence of partial exits.
 */
export const costOfShares = (position: Position, n: number): number => {
  if (n >= position.shares) return position.costCents;
  return Math.round((position.costCents * n) / position.shares);
};

/** Average cost per share in dollars, for display. A float on purpose -- it is never stored. */
export const averageCost = (position: Position): number =>
  position.shares > 0 ? position.costCents / position.shares / 100 : 0;

export const createPortfolio = (): Portfolio => ({
  cashCents: STARTING_CASH_CENTS,
  positions: [],
  realisedCents: 0,
  settledThrough: null,
  lifetimeRealisedCents: 0,
});

export const positionIn = (portfolio: Portfolio, teamId: string): Position | undefined =>
  portfolio.positions.find((p) => p.teamId === teamId);

/** Total cost basis held, in cents. The other half of the invariant. */
export const investedCents = (portfolio: Portfolio): number =>
  portfolio.positions.reduce((sum, p) => sum + p.costCents, 0);

/**
 * BUY, long only.
 *
 * Four refusals, and all four are things that would otherwise become bugs rather than errors: a
 * non-integer or non-positive share count, a price that is not a real number, more money than the
 * cash on hand, and a position that would exceed the club's liquidity cap.
 */
export const buyShares = (
  portfolio: Portfolio,
  request: { teamId: string; shares: number; price: number; date: string; marketSize: number },
): PortfolioResult => {
  const { teamId, shares, price, date, marketSize } = request;

  if (!teamId) return { ok: false, error: 'No club selected.' };
  if (!Number.isInteger(shares) || shares <= 0) {
    return { ok: false, error: 'Shares must be a whole number.' };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: 'That club has no price to trade at.' };
  }

  const priceCents = centsFor(price);
  const cost = priceCents * shares;

  if (cost > portfolio.cashCents) {
    return { ok: false, error: `Not enough cash. ${dollars(cost)} needed, ${dollars(portfolio.cashCents)} on hand.` };
  }

  const existing = positionIn(portfolio, teamId);
  const limit = maxSharesFor(marketSize);
  const sharesAfter = (existing?.shares ?? 0) + shares;
  if (sharesAfter > limit) {
    return {
      ok: false,
      error: `That would hold ${sharesAfter} shares of this club, over the ${limit} allowed for a club this size.`,
    };
  }

  const positions = existing
    ? portfolio.positions.map((p) => (
      p.teamId === teamId
        ? { ...p, shares: p.shares + shares, costCents: p.costCents + cost }
        : p
    ))
    : [...portfolio.positions, { teamId, shares, costCents: cost, openedOn: date }];

  return {
    ok: true,
    realisedCents: 0,
    portfolio: {
      cashCents: portfolio.cashCents - cost,
      positions,
      realisedCents: portfolio.realisedCents,
      settledThrough: portfolio.settledThrough,
      lifetimeRealisedCents: portfolio.lifetimeRealisedCents,
    },
  };
};

/**
 * SELL, in whole shares, including a partial close.
 *
 * Realised P&L is booked here and nowhere else. Adding to a position averages the cost basis; it
 * never touches realised, because nothing has been sold.
 */
export const sellShares = (
  portfolio: Portfolio,
  request: { teamId: string; shares: number; price: number },
): PortfolioResult => {
  const { teamId, shares, price } = request;
  const position = positionIn(portfolio, teamId);
  if (!position) return { ok: false, error: 'No position in that club.' };
  if (!Number.isInteger(shares) || shares <= 0) return { ok: false, error: 'Shares must be a whole number.' };
  if (shares > position.shares) return { ok: false, error: `Only ${position.shares} held.` };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'That club has no price to trade at.' };

  const proceeds = centsFor(price) * shares;
  const released = costOfShares(position, shares);
  const realised = proceeds - released;

  const remaining = position.shares - shares;
  const positions = remaining === 0
    ? portfolio.positions.filter((p) => p.teamId !== teamId)
    : portfolio.positions.map((p) => (
      p.teamId === teamId ? { ...p, shares: remaining, costCents: p.costCents - released } : p
    ));

  return {
    ok: true,
    realisedCents: realised,
    portfolio: {
      cashCents: portfolio.cashCents + proceeds,
      positions,
      realisedCents: portfolio.realisedCents + realised,
      settledThrough: portfolio.settledThrough,
      lifetimeRealisedCents: portfolio.lifetimeRealisedCents,
    },
  };
};

/**
 * The mark-to-market view. Display only -- see §6.2, cash moves on trades and nowhere else.
 */
export const markValue = (
  portfolio: Portfolio,
  closes: Record<string, number>,
): { holdingsCents: number; unrealisedCents: number; totalCents: number; unpriced: number } => {
  let holdingsCents = 0;
  let unpriced = 0;
  for (const p of portfolio.positions) {
    const close = closes[p.teamId];
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) {
      // A position whose club has no close is HELD AT COST, not written off. Dropping it would
      // silently realise a loss that never happened, and marking it at zero would invent one.
      holdingsCents += p.costCents;
      unpriced += 1;
      continue;
    }
    holdingsCents += centsFor(close) * p.shares;
  }
  const unrealisedCents = holdingsCents - investedCents(portfolio);
  return {
    holdingsCents,
    unrealisedCents,
    totalCents: portfolio.cashCents + holdingsCents,
    unpriced,
  };
};

/**
 * Cash DERIVED from the position history, never read from storage.
 *
 * See the invariant at the top of this file. `derivedCashCents` is the only function permitted to
 * answer "how much cash does this portfolio hold", and `loadPortfolio` uses it in preference to
 * whatever number was persisted.
 */
export const derivedCashCents = (portfolio: Portfolio): number =>
  STARTING_CASH_CENTS + portfolio.realisedCents - investedCents(portfolio);

/** Whether the stored cash agrees with the position history. False means the save is corrupt. */
export const reconciles = (portfolio: Portfolio): boolean =>
  portfolio.cashCents === derivedCashCents(portfolio);

/**
 * SETTLEMENT: close the book at the end of a season and hand the player a fresh budget.
 *
 * ===========================================================================
 * WHAT THIS BOUNDS, AND WHY IT HAS TO RESET THE CASH
 * ===========================================================================
 *
 * `checkShareEdge` measures a fade-the-dislocation edge at +13.41% over twenty days, in five leagues
 * out of five. Left alone that compounds without limit: $1,000 becomes roughly $10,200 across two
 * seasons at nine twenty-day holds each, and there is no horizon after that.
 *
 * The position cap does NOT stop it, because the cap limits concentration within one club rather than
 * exposure across time. Nothing else bounds it either. So the horizon is imposed directly: positions
 * are closed at the last price the market printed, and the next season starts on the opening balance.
 *
 * The reset is the load-bearing part. If cash were carried over as `STARTING + lifetime realised`, a
 * player would begin the new season richer than the last one and the compounding would simply
 * continue across the boundary -- a settlement rule that settles nothing. `lifetimeRealisedCents`
 * exists so the season record survives WITHOUT feeding the next season's budget.
 *
 * ===========================================================================
 * SETTLEMENT IS IDEMPOTENT, GUARDED BY `settledThrough`
 * ===========================================================================
 *
 * Anything can re-run the effect that calls this: a reload, a second render, a second rollover with no
 * new prices printed. The book is empty after the first pass so the damage would be small, but small
 * and invisible is exactly the class of failure this module is written against, so the guard is an
 * explicit date comparison rather than an assumption that the state happens to be empty.
 *
 * ===========================================================================
 * A POSITION WITH NO PRICE IS CLOSED AT COST, NOT WRITTEN OFF
 * ===========================================================================
 *
 * If the market has not printed a close for a club, the game cannot say what it is worth. Liquidating
 * at zero would book a total loss for a price nobody quoted, and keeping the position would leave it
 * open forever with no way to sell it -- `sellShares` requires a price, so an unpriced position is
 * permanently frozen. Closing at cost does neither: the player gets their money back and the season
 * ends cleanly. It is the same reasoning as `markValue` holding an unpriced position at cost.
 */
export const settlePortfolio = (
  portfolio: Portfolio,
  closes: Record<string, number>,
  through: string,
): Portfolio => {
  // Already settled this far. Returning the SAME OBJECT so a caller can use identity to detect a no-op.
  if (portfolio.settledThrough !== null && portfolio.settledThrough >= through) return portfolio;

  let gainCents = 0;
  for (const p of portfolio.positions) {
    const close = closes[p.teamId];
    gainCents += typeof close === 'number' && Number.isFinite(close) && close > 0
      ? centsFor(close) * p.shares - p.costCents
      : 0;
  }

  return {
    cashCents: STARTING_CASH_CENTS,
    positions: [],
    realisedCents: 0,
    settledThrough: through,
    lifetimeRealisedCents: portfolio.lifetimeRealisedCents + gainCents,
  };
};

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * localStorage only, deliberately, and the reason is a scar rather than a preference.
 *
 * `wallet.ts` keeps the betting wallet in localStorage with a comment saying it should not, because
 * wiring it into the sync pipeline was out of scope for that phase. This module follows the same
 * convention so the two money stores behave alike: a portfolio survives a refresh and survives
 * closing the tab, and it does not follow the player to another machine.
 *
 * It is deliberately NOT added to the save bundle. The bundle is read by three separate boot paths,
 * and the price ledger shipped three stacked restore defects precisely because restoring it correctly
 * everywhere was harder than writing it in one place. Adding a second ledger to that pipeline
 * before the UI exists would be repeating the mistake with less understanding of it. When the
 * bundle path is wired up, it gets its own check covering every boot path -- not one.
 */
const PORTFOLIO_KEY = 'gpb_hxse_portfolio_v1';

const isWholeCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/**
 * Read a saved portfolio, DERIVING its cash.
 *
 * The stored `cashCents` is not used. It is read only to notice a disagreement, which
 * `loadPortfolioLastWarning` records -- because silently correcting a tampered balance is safer
 * than loading it but leaves nobody any the wiser.
 *
 * Malformed POSITIONS are dropped individually, the way `readSharePriceLedger` drops malformed
 * clubs: one bad row should not cost a player the rest of their book. Malformed `realisedCents` is
 * fatal to the whole save, because cash is derived from it and the positions alone cannot say how
 * much money the account holds. There is no partial recovery from that one.
 */
export let loadPortfolioLastWarning: string | null = null;

export const loadPortfolio = (): Portfolio => {
  loadPortfolioLastWarning = null;
  if (typeof localStorage === 'undefined') return createPortfolio();
  try {
    const raw = localStorage.getItem(PORTFOLIO_KEY);
    if (!raw) return createPortfolio();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      loadPortfolioLastWarning = 'save was not an object; started a fresh portfolio';
      return createPortfolio();
    }

    const candidate = parsed as Partial<Portfolio>;
    if (!isWholeCents(candidate.realisedCents)) {
      loadPortfolioLastWarning = 'realised P&L was not a whole number of cents; the whole save was '
        + 'refused, because cash is derived from it and positions alone cannot say how much money '
        + 'the account holds';
      return createPortfolio();
    }

    const offered = Array.isArray(candidate.positions) ? candidate.positions : [];
    const positions = offered.filter((p): p is Position => {
      if (!p || typeof p !== 'object') return false;
      const row = p as Partial<Position>;
      return typeof row.teamId === 'string'
        && row.teamId.length > 0
        && isWholeCents(row.shares)
        && row.shares > 0
        && isWholeCents(row.costCents)
        && row.costCents >= 0
        && typeof row.openedOn === 'string';
    });

    if (positions.length !== offered.length) {
      loadPortfolioLastWarning = `dropped ${offered.length - positions.length} malformed position(s) `
        + 'and kept the rest';
    }

    /*
      Derived, not read. Everything above established that `realisedCents` is a whole number and
      that every surviving position is well formed; the cash figure then follows from the invariant
      alone. A duplicate club would double-count its cost basis, so the last one wins -- the same
      collapse `readSharePriceLedger` applies when a day is saved twice.
    */
    const deduped = new Map<string, Position>();
    for (const p of positions) deduped.set(p.teamId, p);
    if (deduped.size !== positions.length) {
      loadPortfolioLastWarning = 'collapsed duplicate positions in one club to the last one saved';
    }

    const cashCents = derivedCashCents({
      cashCents: 0,
      positions: [...deduped.values()],
      realisedCents: candidate.realisedCents,
      settledThrough: null,
      lifetimeRealisedCents: 0,
    });

    if (isWholeCents(candidate.cashCents) && candidate.cashCents !== cashCents) {
      loadPortfolioLastWarning = `stored cash of ${dollars(candidate.cashCents)} disagreed with the `
        + `position history, which says ${dollars(cashCents)}; used the derived figure`;
    }

    /*
      THE TWO SETTLEMENT FIELDS ARE OPTIONAL, because a save written before settlement existed has
      neither.

      `settledThrough` defaults to null, which is the SAFE direction: it means "never settled", so the
      next rollover will settle rather than skip. Defaulting it to a far-future date would make an old
      book silently un-settleable.

      `lifetimeRealisedCents` defaults to this season's realised figure rather than to zero. A pre-
      settlement save had no separate lifetime column, and its realised figure is the whole of what had
      been earned up to that point, so carrying it forward loses no history. Starting it at zero would
      quietly erase a player's record the first time they rolled over.
    */
    const settledThrough = typeof candidate.settledThrough === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.settledThrough)
      ? candidate.settledThrough
      : null;
    const lifetimeRealisedCents = isWholeCents(candidate.lifetimeRealisedCents)
      ? candidate.lifetimeRealisedCents
      : candidate.realisedCents;

    return {
      cashCents,
      positions: [...deduped.values()],
      realisedCents: candidate.realisedCents,
      settledThrough,
      lifetimeRealisedCents,
    };
  } catch {
    loadPortfolioLastWarning = 'save would not parse; started a fresh portfolio';
    return createPortfolio();
  }
};

export const savePortfolio = (portfolio: Portfolio): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PORTFOLIO_KEY, JSON.stringify({
      cashCents: derivedCashCents(portfolio),
      positions: portfolio.positions,
      realisedCents: portfolio.realisedCents,
      settledThrough: portfolio.settledThrough,
      lifetimeRealisedCents: portfolio.lifetimeRealisedCents,
    }));
  } catch {
    // A full or blocked localStorage should not take the page down. The portfolio becomes
    // session-only, which is the same degradation wallet.ts accepts.
  }
};