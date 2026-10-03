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
  buyShares,
  createPortfolio,
  loadPortfolio,
  loadPortfolioLastWarning,
  markValue,
  maxSharesFor,
  positionIn,
  rejectionOf,
  savePortfolio,
  sellShares,
  type Portfolio,
} from '../lib/portfolio';

export interface TradeOutcome {
  ok: boolean;
  /** Player-facing sentence. Empty on success. */
  message: string;
  /** Cents realised by this trade. Always zero for a buy. */
  realisedCents: number;
}

export interface UsePortfolio {
  portfolio: Portfolio;
  /** Cents realised across the whole book, lifetime. */
  realisedCents: number;
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
  sharesHeld: (teamId: string) => number;
  capFor: (teamId: string, marketSize: number) => { allowed: number; held: number };
}

export interface BuyRequest {
  teamId: string;
  shares: number;
  price: number;
  date: string;
  marketSize: number;
}

export interface SellRequest {
  teamId: string;
  shares: number;
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
    setNotice(outcome.ok ? null : outcome);
    return outcome;
  }, []);

  const buy = React.useCallback((request: BuyRequest): TradeOutcome => {
    const result = buyShares(portfolio, request);
    if (!result.ok) {
      setNotice({ ok: false, message: rejectionOf(result), realisedCents: 0 });
      return { ok: false, message: rejectionOf(result), realisedCents: 0 };
    }
    return commit(result.portfolio, { ok: true, message: '', realisedCents: 0 });
  }, [portfolio, commit]);

  const sell = React.useCallback((request: SellRequest): TradeOutcome => {
    const result = sellShares(portfolio, request);
    if (!result.ok) {
      setNotice({ ok: false, message: rejectionOf(result), realisedCents: 0 });
      return { ok: false, message: rejectionOf(result), realisedCents: 0 };
    }
    return commit(result.portfolio, {
      ok: true, message: '', realisedCents: result.realisedCents,
    });
  }, [portfolio, commit]);

  const sharesHeld = React.useCallback(
    (teamId: string): number => positionIn(portfolio, teamId)?.shares ?? 0,
    [portfolio],
  );

  const capFor = React.useCallback(
    (teamId: string, marketSize: number): { allowed: number; held: number } => ({
      allowed: maxSharesFor(marketSize),
      held: positionIn(portfolio, teamId)?.shares ?? 0,
    }),
    [portfolio],
  );

  const dismissNotice = React.useCallback(() => setNotice(null), []);

  return {
    portfolio,
    realisedCents: portfolio.realisedCents,
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
    sharesHeld,
    capFor,
  };
};