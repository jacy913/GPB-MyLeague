/**
 * The player's HXSE book, and the only place it is written.
 *
 * ===========================================================================
 * WHY PERSISTENCE IS HERE AND NOT IN THE COMPONENT
 * ===========================================================================
 *
 * A ledger that can be loaded by two paths and saved by a third is a ledger that will eventually
 * disagree with itself. Loading happens once on mount; saving happens inside the trade handlers,
 * immediately after a trade is accepted -- not in an effect watching the portfolio, which would
 * write on any render that happened to produce a new object identity.
 *
 * The write is fire-and-forget and after the state update. `savePortfolio` swallows its own storage
 * failures the way `wallet.ts` does, because a full or blocked localStorage must not take the page
 * down; the degradation is that the book becomes session-only.
 *
 * ===========================================================================
 * A REFUSAL IS SHOWN, NEVER SWALLOWED
 * ===========================================================================
 *
 * `buyShares` and `sellShares` refuse rather than clamp, and each refusal carries a sentence written
 * for a player: "that would hold 26 shares of this club, over the 25 allowed". Those strings are
 * surfaced verbatim rather than replaced with something generic, because "not enough cash" and
 * "over the position limit" call for different responses and a single "trade failed" would hide
 * which one happened.
 *
 * A refusal is NOT an error and is not counted as one. A player tapping Buy on a club they cannot
 * afford has not done anything wrong, so nothing is logged -- the message simply replaces itself on
 * the next attempt, including a successful one.
 */

import * as React from 'react';
import {
  buyAmount,
  createPortfolio,
  loadPortfolio,
  loadPortfolioLastWarning,
  markValue,
  positionLimitCentsFor,
  positionIn,
  rejectionOf,
  savePortfolio,
  sellAmount,
  settlePortfolio,
  type Portfolio,
} from '../lib/portfolio';

export interface TradeOutcome {
  ok: boolean;
  /** Player-facing sentence: the refusal on failure, the RECEIPT on success. */
  message: string;
  /** Cents realised by this trade. Always zero for a buy. */
  realisedCents: number;
}

export interface UsePortfolio {
  portfolio: Portfolio;
  /** Cents realised THIS season. Reset by settlement. */
  realisedCents: number;
  /** Cents realised across every season played. Display only. */
  lifetimeRealisedCents: number;
  /** Cents not invested. */
  cashCents: number;
  /** Cents in shares at the latest close. */
  holdingsCents: number;
  /** Cents of profit or loss on positions still open. */
  unrealisedCents: number;
  /** Cash plus holdings -- the number the player is playing for. */
  totalCents: number;
  /** Positions whose club has no close today. Should be 0; surfaced rather than swallowed. */
  unpriced: number;
  /** Whatever the last load had to correct, or null. */
  warning: string | null;
  /** The last refusal, or null after a trade succeeds. */
  notice: TradeOutcome | null;
  dismissNotice: () => void;
  buy: (request: BuyRequest) => TradeOutcome;
  sell: (request: SellRequest) => TradeOutcome;
  /** Shares held in one club. */
  investedIn: (teamId: string) => number;
  capFor: (teamId: string, marketSize: number) => { allowed: number; held: number };
  /**
   * Close the book at the end of a season.
   *
   * Idempotent and safe to call from an effect: the same `through` date twice is a no-op, so a
   * re-render, a reload or a second rollover cannot liquidate the book again. Returns true when it
   * actually settled, so the caller can tell a real settlement from a skipped one.
   */
  settle: (closes: Record<string, number>, through: string) => boolean;
}

export interface BuyRequest {
  teamId: string;
  /** Club name for the receipt. Falls back to the id if absent. */
  teamName?: string;
  /** Cents to invest. The player typed an amount of money, not a quantity of shares. */
  cents: number;
  price: number;
  date: string;
  marketSize: number;
}

export interface SellRequest {
  teamId: string;
  /** Club name for the receipt. Falls back to the id if absent. */
  teamName?: string;
  /** Cents of ORIGINAL INVESTMENT to unwind, which is the unit the position is displayed in. */
  cents: number;
  price: number;
}

/**
 * Portfolio plus its mark, recomputed whenever either input moves.
 *
 * The mark is derived rather than stored, which is §6.2's whole point: unrealised P&L is a display
 * number and never becomes cash.
 */
export const usePortfolio = (closes: Record<string, number>): UsePortfolio => {
  const [portfolio, setPortfolio] = React.useState<Portfolio>(createPortfolio);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<TradeOutcome | null>(null);

  /*
    Load ONCE on mount, and there is exactly one path here. The share price ledger shipped three
    stacked restore defects because it was read on one boot path and not the others; a ledger that
    is silently empty on half the ways into the app is worse than one that is empty everywhere.
  */
  React.useEffect(() => {
    setPortfolio(loadPortfolio());
    setWarning(loadPortfolioLastWarning);
  }, []);

  const mark = React.useMemo(() => markValue(portfolio, closes), [portfolio, closes]);

  /**
   * Apply an accepted trade and persist it. A REFUSED trade deliberately does not call this, so the
   * book is untouched and no write happens -- a refusal changes nothing, so it should cost nothing.
   */
  const commit = React.useCallback((next: Portfolio, outcome: TradeOutcome): TradeOutcome => {
    setPortfolio(next);
    savePortfolio(next);
    /*
      THE NOTICE IS SET ON SUCCESS TOO, because on success it is the RECEIPT.

      This used to be `outcome.ok ? null : outcome`, which cleared the message after a good trade --
      correct when a success had nothing to say, and wrong now that the player typed an amount of
      money rather than a number of shares. The share count they received is the one figure they
      cannot derive themselves, and this is the only place it is ever shown. Clearing it meant a
      successful purchase reported nothing at all.

      The colour is the caller's business: the desk renders this teal on success and red on refusal,
      so one field carries both and neither has to invent a second channel.
    */
    setNotice(outcome);
    return outcome;
  }, []);

  const buy = React.useCallback((request: BuyRequest): TradeOutcome => {
    const result = buyAmount(portfolio, request);
    if (!result.ok) {
      setNotice({ ok: false, message: rejectionOf(result), realisedCents: 0 });
      return { ok: false, message: rejectionOf(result), realisedCents: 0 };
    }
    /*
      THE SUCCESS MESSAGE IS THE RECEIPT, and it is kept rather than discarded.

      The player asked for an amount of money, not a quantity of shares, so the shares are the
      CONSEQUENCE and belong in a confirmation rather than in the input. "Invested $50.00 at $408.34
      -- received 0.122445 shares" is the sentence that closes the loop between what they typed and
      what they now own. Discarding it would leave the trade silent.
    */
    return commit(result.portfolio, {
      ok: true, message: result.message, realisedCents: 0,
    });
  }, [portfolio, commit]);

  const sell = React.useCallback((request: SellRequest): TradeOutcome => {
    const result = sellAmount(portfolio, request);
    if (!result.ok) {
      setNotice({ ok: false, message: rejectionOf(result), realisedCents: 0 });
      return { ok: false, message: rejectionOf(result), realisedCents: 0 };
    }
    return commit(result.portfolio, {
      ok: true, message: result.message, realisedCents: result.realisedCents,
    });
  }, [portfolio, commit]);

  /** Cents currently invested in a club -- the figure the player reads as their holding. */
  const investedIn = React.useCallback(
    (teamId: string): number => positionIn(portfolio, teamId)?.costCents ?? 0,
    [portfolio],
  );

  const capFor = React.useCallback(
    (teamId: string, marketSize: number): { allowed: number; held: number } => ({
      allowed: positionLimitCentsFor(marketSize),
      held: positionIn(portfolio, teamId)?.costCents ?? 0,
    }),
    [portfolio],
  );

  const dismissNotice = React.useCallback(() => setNotice(null), []);

  /*
    SETTLEMENT. Writes through `commit` like a trade does, so persistence is in exactly one place and
    a settled book is saved by the same path that saved a bought one.

    It returns the boolean rather than nothing because the caller needs to distinguish "settled" from
    "already settled" -- an effect that fires on every render would otherwise look identical either
    way, which is the same invisibility problem the `settledThrough` stamp exists to prevent.
  */
  const settle = React.useCallback((closes: Record<string, number>, through: string): boolean => {
    if (portfolio.settledThrough !== null && portfolio.settledThrough >= through) return false;
    const next = settlePortfolio(portfolio, closes, through);
    setPortfolio(next);
    savePortfolio(next);
    setNotice(null);
    return true;
  }, [portfolio]);

  return {
    portfolio,
    realisedCents: portfolio.realisedCents,
    lifetimeRealisedCents: portfolio.lifetimeRealisedCents,
    cashCents: portfolio.cashCents,
    holdingsCents: mark.holdingsCents,
    unrealisedCents: mark.unrealisedCents,
    totalCents: mark.totalCents,
    unpriced: mark.unpriced,
    warning,
    notice,
    dismissNotice,
    buy,
    sell,
    investedIn,
    capFor,
    settle,
  };
};