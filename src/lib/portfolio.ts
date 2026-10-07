/**
 * HXSE positions. Long only, cash-only settlement, denominated in DOLLARS.
 *
 * ===========================================================================
 * WHY DOLLARS AND NOT SHARES -- AND WHY THAT IS NOT A SIMPLIFICATION
 * ===========================================================================
 *
 * The first version of this module took a share count and refused anything fractional. That was a
 * defensible engineering choice and a wrong product choice, and the player named the difference:
 *
 *     "I never think 'oh i want to buy 0.000294884 shares'. I just say 'i have $40 of stock in
 *     Nvidia'."
 *
 * With a price band running to $1,000 and a $1,000 account, whole shares make position sizing
 * meaningless. The most expensive club in the league admits exactly one share, so a player either
 * commits 99% of their account or does nothing at all. There is no middle move, which means there is
 * no decision.
 *
 * So the interface is dollars in both directions: "I want to own $150 of the Nighthawks", and
 * selling "$50 of what I put in". The share count still exists -- it is what a dollar amount BUYS,
 * and the UI reports it as a receipt ("received 0.2541 shares") rather than as the thing you typed.
 * The concept is kept and the ergonomics are fixed. That is a better answer than deleting it.
 *
 * IT ALSO RESURRECTS THE CAP §6.3 DESCRIBES. "You cannot buy 10,000 shares of an illiquid club" is
 * awkward to express as a share COUNT, because 25 shares is $500 of a $20 club and $25,000 of a
 * $1,000 one. Expressed as a DOLLAR cap it is a real concentration limit at every price, and it is
 * finally compatible with an expensive club: $250 admits 0.2516 shares of a $993 name rather than
 * refusing outright, which is what killed the notional cap the first time round.
 *
 * ===========================================================================
 * THE INVARIANT, WHICH IS THE WHOLE DESIGN
 * ===========================================================================
 *
 *     cashCents + sum(costCents) === STARTING_CASH_CENTS + realisedCents
 *
 * Buying moves cents from cash into a cost basis, so the left side does not move. Selling releases
 * proceeds and books `realisedCents`, and the two sides move together. Nothing else may write
 * `cashCents`, and `cashCents` is derived rather than believed -- see the persistence section.
 *
 * ===========================================================================
 * WHY UNITS IS A FLOAT AND MONEY IS NOT
 * ===========================================================================
 *
 * `units` is a float because a dollar amount divides into a fractional quantity and that is the
 * point. Money is always integer cents, and the crossing point `centsFor` is the only place a price
 * becomes an amount.
 *
 * The float never touches the ledger. Selling "$50 of what I put in" releases exactly 5000 cents of
 * BASIS -- the same unit it was denominated in, so there is nothing to round -- and releases units in
 * the same proportion. A final unwind releases every remaining unit verbatim rather than
 * multiplying by a ratio, so a position cannot shed a fractional unit to accumulated error however
 * many times it is partially sold.
 */

/** Opening cash, in cents. `$1,000`, matching `STARTING_BALANCE` in `wallet.ts`. */
export const STARTING_CASH_CENTS = 100_000;

export interface Position {
  teamId: string;
  /**
   * Total cents PAID, for the whole position. This is the number the player sees as "invested", so
   * it is the primary figure rather than a derived one.
   */
  costCents: number;
  /**
   * What that money bought, as a float. NEVER DISPLAYED AS AN INPUT and never something a player
   * types -- it exists so a position can be revalued when the price moves, and it is reported as a
   * receipt after a purchase.
   */
  units: number;
  /** ISO date the position was opened, for the age of a trade. */
  openedOn: string;
}

export interface Portfolio {
  cashCents: number;
  positions: Position[];
  /**
   * Realised profit or loss, in cents, carried across seasons.
   *
   * A RUNNING TOTAL, not a season figure: it moves only when a sale books a gain or a loss, and it is
   * never reset at a season boundary. The book is a brokerage rather than a season budget -- positions
   * and cash roll over, so a profit earned last year is still yours to invest this year.
   */
  realisedCents: number;
}

/**
 * A refusal, or an acceptance with a RECEIPT.
 *
 * `error` is declared optional-and-undefined on the success arm rather than simply absent from it.
 * That is not cosmetic: this project's tsconfig does not enable `strictNullChecks`, and without it
 * TypeScript does not narrow a union by its `ok` discriminant, so `if (!r.ok)` would leave `r` as the
 * whole union and `r.error` would not typecheck. Declaring the field on both arms makes `error`
 * reachable either way, which is what the UI wants anyway -- it renders the refusal on failure and
 * the receipt on success.
 */
export type PortfolioResult =
  | { ok: true; portfolio: Portfolio; realisedCents: number; message: string; error?: undefined }
  | { ok: false; error: string; portfolio?: undefined; message?: undefined };

/** The refusal message, or an empty string when the trade was accepted. */
export const rejectionOf = (result: PortfolioResult): string => (result.ok ? '' : result.error);

/**
 * Dollars to cents, rounding half away from zero, once, on the way in.
 *
 * `Math.round` on a negative is toward +Infinity, which would make a sell below cost round the wrong
 * way, so the sign is pulled off before rounding and put back after.
 */
export const centsFor = (price: number): number => {
  if (!Number.isFinite(price)) return 0;
  const scaled = price * 100;
  return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
};

export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * A PRICE, which arrives in dollars rather than cents.
 *
 * Separate from `dollars` precisely because conflating them is a real bug and not a theoretical one:
 * the purchase receipt reads "Invested $150.00 in Leopards at $9.93" for a $993.49 club when a price is
 * passed to the cents formatter. Two functions with two units is cheaper than one function with one
 * unit and a caller that has to remember which is which.
 */
export const priceLabel = (price: number): string =>
  `$${price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** A signed money string, or an em dash when there is no result to report. */
export const signedDollars = (cents: number): string =>
  cents === 0 ? '—' : `${cents < 0 ? '-' : '+'}${dollars(Math.abs(cents))}`;

/**
 * How much of one club the player may hold, in cents.
 *
 * §6.3 gives this cap two jobs -- realism, and stopping the player exploiting the market -- and the
 * second matters more now than it did when the plan was written. `checkShareEdge` measures a
 * fade-the-dislocation edge at +13.41% over twenty days, in five leagues out of five. Unbounded, that
 * compounds; with the season settlement removed this cap is the concentration limit that remains.
 *
 * LINEAR, and linear on purpose: `liquidityFromSize` in `fanbase.ts` is linear for the same reason and
 * with the same caveat -- a curve would be one more shape to justify with no data behind it. $25 in
 * the thinnest name, $250 in the thickest.
 */
export const positionLimitCentsFor = (marketSize: number): number =>
  Math.round(2_500 + (Math.max(0, Math.min(100, marketSize)) / 100) * 22_500);

/** What a position is worth right now, in cents. The number the player reads as "worth". */
export const valueOf = (position: Position, close: number): number =>
  Math.round(position.units * centsFor(close));

/** Average cost per unit in dollars. For the receipt line only; never an input. */
export const averageUnitCost = (position: Position): number =>
  position.units > 0 ? position.costCents / position.units / 100 : 0;

export const createPortfolio = (): Portfolio => ({
  cashCents: STARTING_CASH_CENTS,
  positions: [],
  realisedCents: 0,
});

export const positionIn = (portfolio: Portfolio, teamId: string): Position | undefined =>
  portfolio.positions.find((p) => p.teamId === teamId);

/** Total cost basis held, in cents. The other half of the invariant. */
export const investedCents = (portfolio: Portfolio): number =>
  portfolio.positions.reduce((sum, p) => sum + p.costCents, 0);

/**
 * Cash DERIVED from the position history, never read from storage.
 *
 * `derivedCashCents` is the only function permitted to answer "how much cash does this portfolio
 * hold", and the loader uses it in preference to whatever number was persisted.
 */
export const derivedCashCents = (portfolio: Portfolio): number =>
  STARTING_CASH_CENTS + portfolio.realisedCents - investedCents(portfolio);

/** Whether the stored cash agrees with the position history. False means the save is corrupt. */
export const reconciles = (portfolio: Portfolio): boolean =>
  portfolio.cashCents === derivedCashCents(portfolio);

/**
 * BUY AN AMOUNT.
 *
 * The player states how much money they want in the club; the units that buys are worked out here and
 * reported as a receipt. Four refusals, each a thing that would otherwise become a bug rather than an
 * error: an amount that is not whole cents, an amount that is not positive, a price the market has not
 * printed, more money than the cash on hand, and an amount that would breach the club's cap.
 */
export const buyAmount = (
  portfolio: Portfolio,
  request: {
    teamId: string;
    /** Shown in the receipt. Absent means the id is used, which is worse but never wrong. */
    teamName?: string;
    cents: number;
    price: number;
    date: string;
    marketSize: number;
  },
): PortfolioResult => {
  const { teamId, cents, price, date, marketSize } = request;

  if (!teamId) return { ok: false, error: 'No club selected.' };
  if (!isWholeCents(cents)) return { ok: false, error: 'Amounts are whole cents.' };
  if (cents <= 0) return { ok: false, error: 'Enter an amount to invest.' };
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, error: 'That club has no price to trade at.' };
  }

  const priceCents = centsFor(price);
  if (cents > portfolio.cashCents) {
    return {
      ok: false,
      error: `Not enough cash. ${dollars(cents)} needed, ${dollars(portfolio.cashCents)} on hand.`,
    };
  }

  const existing = positionIn(portfolio, teamId);
  const limit = positionLimitCentsFor(marketSize);
  const basisAfter = (existing?.costCents ?? 0) + cents;
  if (basisAfter > limit) {
    return {
      ok: false,
      error: `That would put ${dollars(basisAfter)} of yours into this club, over the `
        + `${dollars(limit)} limit for a club this size.`,
    };
  }

  const unitsBought = cents / priceCents;
  const positions = existing
    ? portfolio.positions.map((p) => (
      p.teamId === teamId
        ? { ...p, units: p.units + unitsBought, costCents: p.costCents + cents }
        : p
    ))
    : [...portfolio.positions, { teamId, units: unitsBought, costCents: cents, openedOn: date }];

  return {
    ok: true,
    realisedCents: 0,
    message: `Invested ${dollars(cents)} in ${request.teamName ?? teamId} at ${priceLabel(price)} `
      + `— received ${unitsBought.toFixed(6)} shares.`,
    portfolio: {
      cashCents: portfolio.cashCents - cents,
      positions,
      realisedCents: portfolio.realisedCents,
    },
  };
};

/**
 * SELL AN AMOUNT OF WHAT YOU PUT IN.
 *
 * Denominated in BASIS rather than in current value, which is the choice that keeps one unit of
 * account throughout the screen: the player says "$50 of my Nighthawks", $50 of cost leaves, and
 * whatever that slice has become comes back. Selling "$50 worth" instead would make "invested" and
 * the sell figure mean different things two inches apart on the same row.
 *
 * The basis released is EXACTLY the amount asked for -- it is the same unit, so there is nothing to
 * round -- and the units released are the same fraction of the holding. A final unwind releases every
 * remaining unit verbatim rather than multiplying by a ratio, so a position cannot shed a fractional
 * unit to accumulated error however many times it is partially sold.
 */
export const sellAmount = (
  portfolio: Portfolio,
  request: { teamId: string; teamName?: string; cents: number; price: number },
): PortfolioResult => {
  const { teamId, cents, price } = request;
  const position = positionIn(portfolio, teamId);
  if (!position) return { ok: false, error: 'No position in that club.' };
  if (!isWholeCents(cents)) return { ok: false, error: 'Amounts are whole cents.' };
  if (cents <= 0) return { ok: false, error: 'Enter an amount to sell.' };
  if (cents > position.costCents) {
    return {
      ok: false,
      error: `You put ${dollars(position.costCents)} into this club, so ${dollars(cents)} is more `
        + 'than you can unwind.',
    };
  }
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'That club has no price to trade at.' };

  const isFinalUnwind = cents >= position.costCents;
  const fraction = cents / position.costCents;
  const unitsSold = isFinalUnwind ? position.units : position.units * fraction;
  const proceeds = Math.round(unitsSold * centsFor(price));
  const realised = proceeds - cents;

  const positions = isFinalUnwind
    ? portfolio.positions.filter((p) => p.teamId !== teamId)
    : portfolio.positions.map((p) => (
      p.teamId === teamId
        ? { ...p, units: p.units - unitsSold, costCents: p.costCents - cents }
        : p
    ));

  return {
    ok: true,
    realisedCents: realised,
    message: `Unwound ${dollars(cents)} of your ${dollars(position.costCents)} in `
      + `${request.teamName ?? teamId} at ${priceLabel(price)} for ${dollars(proceeds)} — `
      + `${signedDollars(realised)}.`,
    portfolio: {
      cashCents: portfolio.cashCents + proceeds,
      positions,
      realisedCents: portfolio.realisedCents + realised,
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
    holdingsCents += valueOf(p, close);
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
 * SETTLEMENT IS GONE, DELIBERATELY.
 *
 * This module used to liquidate the whole book at the end of every season and reopen on the opening
 * balance, to bound a measured +13.41% fade-the-dislocation edge that would otherwise compound without
 * horizon. The bound came at a cost the player named: shares vanished at a season boundary and the
 * portfolio stopped behaving like a portfolio.
 *
 * So positions and cash now CARRY ACROSS SEASONS. There is no settlement function, no `settledThrough`
 * stamp and no season-vs-lifetime split, because there is no longer a boundary event that touches the
 * book. `realisedCents` is the running total and `derivedCashCents` keeps cash reconciled against it.
 *
 * The compounding the old rule bounded is now bounded only by the position cap and by player choice;
 * that is the trade the player asked for, and it is a product decision rather than a bug.
 */

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
 * It is deliberately NOT in the save bundle. The bundle is read by three separate boot paths, and the
 * price ledger shipped three stacked restore defects precisely because restoring it correctly
 * everywhere was harder than writing it in one place. When the bundle path is wired up it gets its
 * own check covering every boot path -- not one.
 */
const PORTFOLIO_KEY = 'gpb_hxse_portfolio_v1';

const isWholeCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value);

/**
 * Read a saved portfolio, DERIVING its cash.
 *
 * The stored `cashCents` is not used -- only read to notice a disagreement, which
 * `loadPortfolioLastWarning` records. Silently correcting a tampered balance is safer than loading it
 * and still leaves nobody any the wiser.
 *
 * Malformed POSITIONS are dropped individually, the way `readSharePriceLedger` drops malformed clubs.
 * Malformed `realisedCents` is fatal to the whole save, because cash is derived from it.
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
        && isWholeCents(row.costCents)
        && row.costCents > 0
        && typeof row.units === 'number'
        && Number.isFinite(row.units)
        && row.units > 0
        && typeof row.openedOn === 'string';
    });

    if (positions.length !== offered.length) {
      loadPortfolioLastWarning = `dropped ${offered.length - positions.length} malformed position(s) `
        + 'and kept the rest';
    }

    const deduped = new Map<string, Position>();
    for (const p of positions) deduped.set(p.teamId, p);
    if (deduped.size !== positions.length) {
      loadPortfolioLastWarning = 'collapsed duplicate positions in one club to the last one saved';
    }

    const survivors = [...deduped.values()];
    const cashCents = derivedCashCents({
      cashCents: 0, positions: survivors, realisedCents: candidate.realisedCents,
    });

    if (isWholeCents(candidate.cashCents) && candidate.cashCents !== cashCents) {
      loadPortfolioLastWarning = `stored cash of ${dollars(candidate.cashCents)} disagreed with the `
        + `position history, which says ${dollars(cashCents)}; used the derived figure`;
    }

    /*
      A SAVE WRITTEN BEFORE SETTLEMENT WAS REMOVED may still carry `settledThrough` and
      `lifetimeRealisedCents` on disk. Both are ignored rather than read: neither is part of the book
      any more. `realisedCents` is now the running total and positions and cash carry across seasons,
      so there is nothing to migrate -- the extra JSON keys are simply dropped on the next save.
    */
    return {
      cashCents,
      positions: survivors,
      realisedCents: candidate.realisedCents,
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
    }));
  } catch {
    // A full or blocked localStorage should not take the page down. The portfolio becomes
    // session-only, which is the same degradation wallet.ts accepts.
  }
};