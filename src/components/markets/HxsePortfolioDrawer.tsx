/**
 * The HXSE portfolio drawer.
 *
 * ===========================================================================
 * WHY IT EXISTS, GIVEN THE DESK ALREADY SHOWS THE SAME NUMBERS
 * ===========================================================================
 *
 * Because the desk is on ONE page and the book follows you everywhere. Once shares are tradeable, the
 * question "what am I holding and what is it worth" is not an Exchange question -- it is a question you
 * ask while looking at a box score, and answering it required navigating to a market and reading a
 * table. The count badge on the header button is the same argument the betting slip makes: the number
 * that changes what you would do next belongs where you can see it without asking for it.
 *
 * ===========================================================================
 * IT MIRRORS THE BETTING SLIP DELIBERATELY
 * ===========================================================================
 *
 * Same scrim, same right-side slide, same focus handling, same Escape, same max width, same z-index
 * pair. Two drawers in one app that behave differently are two drawers people have to learn twice, and
 * the slip's own comment explains why it arrives from the right: "a panel that arrives from the left
 * reads as navigation, while one that arrives from the right reads as 'something you just did
 * produced this'". A portfolio is exactly that.
 *
 * The chrome is gold rather than an HXSE colour, and that is a considered choice rather than a default.
 * Every accent in this app belongs to a named outlet or to a bet outcome. The HXSE's own colour on the
 * Exchange page is red -- it is the close line -- and red here would read as a loss. So the drawer wears
 * the same app chrome as the slip and is told apart by its icon and its title, not by inventing a second
 * accent.
 *
 * ===========================================================================
 * NO SHARES ANYWHERE IN HERE
 * ===========================================================================
 *
 * Positions are listed in dollars: what you put in, what it is worth, what that is worth as a gain.
 * Shares exist only as the receipt after a purchase. A drawer is a summary, and a summary that made you
 * convert units in your head would be worse than useless.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { ChartNoAxesColumn, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { dollars, markValue, positionLimitCentsFor, signedDollars, STARTING_CASH_CENTS, valueOf } from '../../lib/portfolio';
import type { Portfolio } from '../../lib/portfolio';
import { marketSizeFor } from '../../lib/analytics/fanbase';
import type { Team } from '../../types';
import { TeamLogo } from '../ui/TeamLogo';

export interface HxsePortfolioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Send the reader to the Exchange with this club selected. */
  onOpenClub: (teamId: string) => void;
  teams: Team[];
  /** The most recent close for every club. */
  closes: Record<string, number>;
  /**
   * The book, as the real `Portfolio`.
   *
   * This was an inline re-declaration of the shape, written out field by field. It had already drifted:
   * `markValue` takes a `Portfolio`, and `Portfolio` carries `settledThrough`, which the inline copy
   * did not. The call site passes `book.portfolio`, a genuine `Portfolio`, so nothing was ever wrong
   * at runtime -- but a hand-copied interface is a snapshot that stops being true the first time the
   * type gains a field, and this one had.
   */
  portfolio: Portfolio;
  /** Date of the closes being marked against, or null if the market has never printed. */
  markedOn: string | null;
}

const pnlClass = (cents: number): string =>
  cents < 0
    ? 'text-[var(--color-media-glorest)]'
    : cents > 0 ? 'text-[var(--color-neutral)]' : 'text-[var(--color-ink-faint)]';

export const HxsePortfolioDrawer: React.FC<HxsePortfolioDrawerProps> = ({
  isOpen, onClose, onOpenClub, teams, closes, portfolio, markedOn,
}) => {
  const panelRef = useRef<HTMLDivElement | null>(null);

  /*
    Focus moves into the panel and comes back out on close, and Escape closes.

    A panel that appears without taking focus leaves a keyboard user tabbing through the page BEHIND
    it, which is the same bug as a modal that is only visually modal. This is copied from the betting
    slip rather than reinvented, because getting it subtly different is how two drawers end up with
    two sets of keyboard behaviour.
  */
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [isOpen, onClose]);

  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const mark = useMemo(() => markValue(portfolio, closes), [portfolio, closes]);

  const rows = useMemo(() => portfolio.positions
    .map((p) => {
      const team = byId.get(p.teamId);
      const close = closes[p.teamId];
      const priced = typeof close === 'number' && Number.isFinite(close) && close > 0;
      const worth = priced ? valueOf(p, close) : p.costCents;
      return { position: p, team, priced, worth, pnl: worth - p.costCents };
    })
    /*
      Sorted by what the position is WORTH, largest first, rather than by club name or by when it was
      opened. The reader opened a drawer to find out where their money is, so the biggest thing they own
      should be the first thing they see. Ties fall back to cost so the order is stable between renders
      rather than shuffling when two positions are worth the same.
    */
    .sort((a, b) => (b.worth - a.worth) || (b.position.costCents - a.position.costCents)),
  [portfolio.positions, closes, byId]);

  const gain = mark.totalCents - STARTING_CASH_CENTS;

  /*
    THE SUMMARY LINE, and it names the two numbers rather than making the reader subtract them.

    "Worth $150.00" alone leaves the reader doing the subtraction against what they paid, and the
    drawer is precisely the place they should not have to. Both figures are printed, and the gain
    carries its percentage because a dollar gain on a large position is a different proposition from the
    same gain on a small one.
  */
  const investedTotal = portfolio.positions.reduce((sum, p) => sum + p.costCents, 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="scrim"
            className="fixed inset-0 z-[70] bg-[var(--color-void)]/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="HXSE portfolio"
            tabIndex={-1}
            className="fixed right-0 top-0 z-[71] flex h-full w-full max-w-[440px] flex-col border-l-4 border-l-[var(--color-gold)] bg-[var(--color-base-2)] shadow-[-8px_0_24px_rgba(0,0,0,0.6)] focus:outline-none"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className="chrome-bar flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <ChartNoAxesColumn className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
                <h2 className="t-h3">HXSE Portfolio</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close portfolio"
                className="gold-sweep p-1 text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/*
                THE HEADLINE BLOCK.

                Total value leads because it is the number the drawer exists to deliver, and the season
                gain sits directly under it rather than at the foot of a list of positions. Cash and
                holdings split the difference underneath, and the mark's date is stated rather than
                implied: "as of" is what tells the reader these figures move with the market while the
                cash figure does not.
              */}
              <div className="border-b border-[var(--color-chrome-lo)] px-4 py-3">
                <div className="t-label text-[var(--color-ink-faint)]">Total value</div>
                <div className="t-stat-hero mt-1 text-[var(--color-ink)]">{dollars(mark.totalCents)}</div>
                <div className={`t-caption mt-0.5 ${pnlClass(gain)}`}>
                  {signedDollars(gain)} this season
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="t-label text-[var(--color-ink-faint)]">Cash</div>
                    <div className="t-stat mt-0.5 text-[var(--color-ink-dim)]">{dollars(portfolio.cashCents)}</div>
                  </div>
                  <div>
                    <div className="t-label text-[var(--color-ink-faint)]">Holdings</div>
                    <div className="t-stat mt-0.5 text-[var(--color-ink-dim)]">{dollars(mark.holdingsCents)}</div>
                  </div>
                </div>
                <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
                  {markedOn
                    ? `Marked to the close of ${markedOn}. Cash moves only when you trade.`
                    : 'The market has not printed a close yet.'}
                </p>
              </div>

              {rows.length === 0 ? (
                <p className="t-caption px-4 py-4 text-[var(--color-ink-faint)]">
                  Nothing held. Open the Exchange and invest an amount in a club trading below its fair
                  value -- the gap between the two lines is what you are paid to wait out.
                </p>
              ) : (
                <ul>
                  {rows.map(({ position, team, priced, worth, pnl }) => {
                    const pct = position.costCents > 0 ? (pnl / position.costCents) * 100 : 0;
                    const cap = team ? positionLimitCentsFor(marketSizeFor(team)) : null;
                    return (
                      <li key={position.teamId} className="border-b border-[var(--color-chrome-lo)]">
                        <button
                          type="button"
                          onClick={() => { onOpenClub(position.teamId); onClose(); }}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-gold)]"
                        >
                          {team ? <TeamLogo team={team} sizeClass="h-9 w-9 shrink-0" lazy /> : null}
                          <span className="min-w-0 flex-1">
                            <span className="t-stat-sm block truncate text-[var(--color-ink)]">
                              {team?.name ?? position.teamId}
                            </span>
                            {/*
                              THE CAP APPEARS ONLY WHEN IT IS NEAR.

                              The first version printed "$160.00 of a $222.60 cap" under every row,
                              which put the same number on screen twice -- once as part of the cap
                              sentence and once as the worth -- because nothing has moved since the
                              purchase. Two identical figures on one row reads as a rendering fault.

                              So the row carries the two numbers the drawer exists to deliver, what you
                              put in and what it is worth, and the cap surfaces only once it is close
                              enough to be the reason a trade would be refused. A constraint you cannot
                              act on is not worth the ink.
                            */}
                            {cap && position.costCents >= cap * 0.6 ? (
                              <span className="t-caption block text-[var(--color-ink-faint)]">
                                {dollars(position.costCents)} of a {dollars(cap)} cap
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="t-stat-sm block text-[var(--color-ink-dim)]">
                              {dollars(position.costCents)}
                            </span>
                            <span className={`t-caption block ${priced ? pnlClass(pnl) : 'text-[var(--color-ink-faint)]'}`}>
                              {priced
                                ? `${signedDollars(pnl)}${pct === 0 ? '' : ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}`
                                : 'unpriced'}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/*
              THE FOOTER carries the lifetime record, and it is the one number that survives settlement.

              Season settlement resets cash to the opening balance every season, which is what bounds
              the compounding -- and it also means the season figure starts again. Without a lifetime
              line the drawer would look like the player had lost everything each April.
            */}
            <div className="shrink-0 border-t border-[var(--color-chrome-lo)] px-4 py-3">
              <div className="flex items-baseline justify-between">
                <span className="t-label text-[var(--color-ink-faint)]">Lifetime realised</span>
                <span className={`t-stat ${pnlClass(portfolio.lifetimeRealisedCents)}`}>
                  {signedDollars(portfolio.lifetimeRealisedCents)}
                </span>
              </div>
              {/*
                WHAT THE BOOK IS TIED UP IN, because "Holdings $415.00" does not say whether that
                is $415.00 the player put in or $415.00 it grew into. Both numbers, and the change
                as a percentage, since a dollar figure means different things at different book sizes.
              */}
              <div className="mt-2 flex items-baseline justify-between border-t border-[var(--color-chrome-lo)] pt-2">
                <span className="t-caption text-[var(--color-ink-faint)]">
                  {`${dollars(investedTotal)} invested`}
                  {investedTotal > 0
                    ? ` · ${(((mark.holdingsCents - investedTotal) / investedTotal) * 100).toFixed(1)}%`
                    : ''}
                </span>
                <span className="t-caption text-[var(--color-ink-faint)]">
                  {`across ${portfolio.positions.length} club${portfolio.positions.length === 1 ? '' : 's'}`}
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};