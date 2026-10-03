/**
 * The player's trading desk: what they hold, what it is worth, and the two buttons that change it.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE FILE
 * ===========================================================================
 *
 * `ExchangeView.tsx` is already 1,081 lines and its whole job is drawing prices. Mixing position
 * accounting into it would put a second responsibility on a file whose first one is already hard to
 * read, and it would make the ledger impossible to delete without unpicking the chart.
 *
 * ===========================================================================
 * THE HEADLINE IS NOT THE CASH FIGURE
 * ===========================================================================
 *
 * The Exchange leads with a 56px share price because the page is about what things cost. The desk
 * leads with TOTAL VALUE, because once you can trade, the number you are playing for is no longer
 * the price of a club -- it is what your book is worth. Leading with cash would put the number the
 * player can still spend above the number they are trying to grow, which is the wrong priority.
 *
 * ===========================================================================
 * EVERY FIGURE HERE IS EARNED
 * ===========================================================================
 *
 * Four rules the panel holds to, all of them visible in the markup below:
 *
 *   1. NO TRADE BEFORE A PRICE EXISTS. A club with no close shows the cap and the club name and no
 *      buttons, rather than buttons that would refuse.
 *   2. THE COST PREVIEW IS LIVE AND IT IS THE REFUSAL'S SOURCE. What the reader is about to spend
 *      is computed from the same integers `buyShares` will charge, not from the displayed price, so
 *      the preview and the refusal cannot disagree by a cent.
 *   3. A GAIN IS TEAL AND A LOSS IS RED. Same convention as the premium figures in the club rail,
 *      so one colour means one thing on this page.
 *   4. CASH MOVES ON TRADES ONLY. The total revalues every day as the ledger grows; the cash figure
 *      never does, because nothing has been sold. Those two lines moving differently is §6.2
 *      working, not a bug.
 */

import * as React from 'react';
import { Panel, PanelHeader, TeamLogo } from '../ui';
import { dollars, signedDollars, valueOf, STARTING_CASH_CENTS } from '../../lib/portfolio';
import { marketSizeFor } from '../../lib/analytics/fanbase';
import type { UsePortfolio } from '../../hooks/usePortfolio';
import { fmtPrice } from './ExchangeView';
import type { Team } from '../../types';

/** A gain, a loss, or nothing at all -- never a "$+0.00" dressed up as a result. */
const pnlText = signedDollars;
const pnlClass = (cents: number): string =>
  cents < 0 ? 'text-[var(--color-media-glorest)]' : cents > 0 ? 'text-[var(--color-neutral)]' : 'text-[var(--color-ink-faint)]';

export interface ExchangeDeskProps {
  teams: Team[];
  /** The most recent close for every club. */
  closes: Record<string, number>;
  /** Date of that close, for labelling what the mark is against. */
  markedOn: string | null;
  /** The club the chart is showing, which is also the club these buttons trade. */
  selectedClub: string | null;
  /** The book, created by App rather than here, so settlement cannot be skipped by not opening this page. */
  book: UsePortfolio;
  /**
   * Point the chart and the trade box at a club.
   *
   * Exists so a position row can be the way you go and trade a position, rather than putting a second
   * amount input on every row. It routes through ExchangeView's `chooseClub`, which is the only thing
   * that sets the selection -- so a click from the desk marks the choice as deliberate and the
   * rank-1 default can never reassert itself over it.
   */
  onSelect: (teamId: string) => void;
}

export const ExchangeDesk: React.FC<ExchangeDeskProps> = ({
  teams, closes, markedOn, selectedClub, book, onSelect,
}) => {
  /*
    THE INPUT IS AN AMOUNT OF MONEY, and this is the single most important line in the component.

    The first version asked for a share count and refused anything fractional, which is a defensible
    engineering choice and the wrong interface. With a price band to $1,000 against a $1,000 account,
    whole shares leave the player committing 99% of everything or nothing at all -- there is no
    middle move, so there is no decision.

    The player says how much they want in. The share count is what that buys, and it is reported back
    as a receipt rather than asked for.
  */
  const [amount, setAmount] = React.useState('50');

  const byId = React.useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const selected = selectedClub ? byId.get(selectedClub) ?? null : null;
  const selectedClose = selectedClub ? closes[selectedClub] ?? null : null;
  const selectedMarketSize = selected ? marketSizeFor(selected) : 0;
  const cap = selected ? book.capFor(selected.id, selectedMarketSize) : { allowed: 0, held: 0 };

  /*
    The share count is PARSED, never taken from the raw string. `Number('')` is 0 and
    `Number('abc')` is NaN, and either reaching `buyShares` as a share count is a nonsense order.
    An unparseable field simply reads as 1, which is also the smallest legal order, so the buttons
    stay honest instead of going dead.
  */
  /*
    THE AMOUNT IS PARSED TO WHOLE CENTS, never carried as a float.

    `parseFloat("12.345")` would spend 1234.5 cents, and a ledger whose amounts are not integers is
    the exact class of bug this module exists to avoid. Anything that is not a positive whole number
    of cents reads as one cent -- the smallest legal trade -- so the buttons stay alive and honest
    rather than going dead on a typo.
  */
  const parsedAmount = Number.parseFloat(amount);
  const investCents = Number.isFinite(parsedAmount) && parsedAmount > 0 ? Math.round(parsedAmount * 100) : 1;

  const heldCents = selected ? book.investedIn(selected.id) : 0;

  /*
    SELLING IS DENOMINATED IN WHAT YOU PUT IN, so the sell figure is capped by the position rather than
    by anything about the current price. "`dollars(investCents)`" reads as unwinding that much of your
    own money, which is the same unit the position row is displayed in. Selling a DOLLAR VALUE instead
    would put two different units two inches apart on the same row.
  */
  const sellCents = Math.min(investCents, heldCents);
  const canSell = heldCents > 0;

  /*
    THE PREVIEW AND THE REFUSAL CANNOT DISAGREE, because they are the same integer.

    `buyAmount` charges `cents` and this previews `cents`. Nothing in the UI re-derives an amount
    from a price, so a player cannot be shown one figure and charged another.
  */
  const affordable = investCents <= book.cashCents;
  const capRoom = Math.max(0, cap.allowed - cap.held);
  const capBinds = capRoom < investCents;

  const act = React.useCallback((direction: 'buy' | 'sell') => {
    if (!selected || selectedClose === null) return;
    if (direction === 'buy') {
      book.buy({
        teamId: selected.id,
        teamName: selected.name,
        cents: investCents,
        price: selectedClose,
        date: markedOn ?? '',
        marketSize: selectedMarketSize,
      });
    } else {
      book.sell({ teamId: selected.id, teamName: selected.name, cents: sellCents, price: selectedClose });
    }
  }, [book, selected, selectedClose, investCents, sellCents, markedOn, selectedMarketSize]);

  const gain = book.totalCents - STARTING_CASH_CENTS;
  const positions = book.portfolio.positions
    .slice()
    .sort((a, b) => (closes[b.teamId] ?? 0) - (closes[a.teamId] ?? 0));

  return (
    <Panel>
      <PanelHeader
        title="Your desk"
        tagline={`cash, holdings, and what they are worth${markedOn ? ` as of ${markedOn}` : ''}`}
      />

      {/*
        THE FOUR FIGURES. Total first and largest because it is the one being played for; the other
        three explain it. Gain-versus-starting sits with the total rather than being buried in the
        positions table, because a player who cannot see their season score will not know they have
        one.
      */}
      <div className="grid grid-cols-4 gap-px border-b border-[var(--color-chrome-lo)] bg-[var(--color-chrome-lo)]">
        <Stat label="Total value" value={dollars(book.totalCents)} emphasis sub={pnlText(gain)} subClass={pnlClass(gain)} />
        <Stat label="Cash" value={dollars(book.cashCents)} />
        <Stat label="Holdings" value={dollars(book.holdingsCents)} />
        <Stat
          label="Open P/L"
          value={pnlText(book.unrealisedCents)}
          valueClass={pnlClass(book.unrealisedCents)}
        />
      </div>

      {/*
        THE TRADE BOX, for whichever club the chart is showing.

        The buttons are absent rather than disabled when there is no price, because a greyed-out Buy
        next to a club the market has not printed yet reads as "you cannot afford this" -- which is a
        different and wrong thing to say.
      */}
      <div className="border-b border-[var(--color-chrome-lo)] px-3 py-3">
        {selected && selectedClose !== null ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className="t-label text-[var(--color-ink-faint)]">Invest</span>
                  <input
                    type="number"
                    min={0.01}
                    step={1}
                    inputMode="decimal"
                    aria-label={`Amount to invest in ${selected ? selected.name : 'this club'}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="t-stat w-28 rounded border border-[var(--color-chrome-mid)] bg-[var(--color-chrome-lo)] px-2 py-1 text-[var(--color-ink)]"
                  />
                </label>
                <div className="pb-1">
                  <div className="t-label text-[var(--color-ink-faint)]">Shares</div>
                  {/*
                    THE COST IS NOT COLOURED ON AFFORDABILITY, and that took a correction.

                    THE SECOND TILE IS WHAT THE AMOUNT BUYS, PREVIEWED.

                    It used to show the cost, which was a derived figure saying what the input beside
                    it already said -- and after the switch to dollar-denominated trading it became
                    literally redundant, because an amount bought at the current price is worth
                    exactly that amount the instant after.

                    What is genuinely NOT computable at a glance is how many shares the money turns
                    into, because that is a division. So the receipt line sits here, shown BEFORE
                    committing rather than only afterwards. It is a consequence of the input, never a
                    second input, and never editable.

                    It is not coloured on affordability either. Red already means "a loss" in the P/L
                    table two inches below, and one screen must not use one colour for two unrelated
                    things -- a red figure next to a red LOSS reads as two losses when one of them is
                    just a share count.
                  */}
                  <div className="t-stat text-[var(--color-ink-dim)]">
                    {selectedClose !== null && selectedClose > 0
                      ? (investCents / Math.round(selectedClose * 100)).toFixed(6)
                      : '--'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pb-0.5">
                <button
                  type="button"
                  onClick={() => act('buy')}
                  disabled={!affordable}
                  className={`rounded border px-4 py-2 t-stat-sm ${
                    affordable
                      ? 'border-[var(--color-neutral)] text-[var(--color-neutral)] hover:bg-[var(--color-neutral)] hover:text-[var(--color-ink)]'
                      : 'cursor-not-allowed border-[var(--color-chrome-mid)] text-[var(--color-ink-faint)] opacity-50'
                  }`}
                >
                  Invest {dollars(investCents)}
                </button>
                <button
                  type="button"
                  onClick={() => act('sell')}
                  disabled={!canSell}
                  className={`rounded border px-4 py-2 t-stat-sm ${
                    canSell
                      ? 'border-[var(--color-ink-dim)] text-[var(--color-ink-dim)] hover:bg-[var(--color-chrome-mid)]'
                      : 'cursor-not-allowed border-[var(--color-chrome-mid)] text-[var(--color-ink-faint)] opacity-50'
                  }`}
                >
                  Unwind {dollars(sellCents)}
                </button>
              </div>
            </div>

            {/*
              THE LIMIT LINE, and it names whichever limit actually binds.

              The first version printed only the share cap: "Holding 0 of 311 allowed". Against a
              $1,000 account and a $993 club that is actively misleading -- 311 shares is $309,000,
              so the cap is nowhere near the thing stopping the player, and printing it alone implies
              a freedom that does not exist.

              Cash binds first at almost any real price, because the band runs to $1,000 and the
              account holds $1,000. So the line leads with what the player can actually buy, and says
              which rule produced that number. When the cap is the binding one it says so instead.
            */}
            <div className="mt-2 space-y-0.5">
              {/*
                TWO SHORT LINES, and the first version was one long one.

                It read "Holding 0. You can buy 0 more -- limited by your cash (cap 311, cash allows
                0) · this order is $810.17 short of your cash · a thick market" and wrapped to two
                ragged lines. Four facts, two of which were the same fact twice ("you can buy 0"
                and "cash allows 0"), and the duplicate made it read as a stutter rather than as
                information.

                So: the cap sentence is always there because it is a property of the club, and the
                cash sentence appears ONLY when cash is what is actually stopping the order. When
                cash is not binding there is nothing to say about it.
              */}
              <p className="t-caption text-[var(--color-ink-faint)]">
                {`Holding ${dollars(cap.held)} of a ${dollars(cap.allowed)} cap · ${selectedMarketSize < 33 ? 'thin market' : selectedMarketSize < 67 ? 'middling market' : 'thick market'} (size ${selectedMarketSize.toFixed(0)} of 100)`}
              </p>
              {/*
                SHOWN ONLY WHEN THE ORDER IS GENUINELY UNAFFORDABLE, and the first version got that
                wrong in a way only looking at it could catch.

                The gate was "is cash the binding constraint", which stays true after a sell has freed
                cash -- cash still limits how MANY shares, long after it stops preventing THIS one.
                So the panel said "Cash allows 1 more share -- this order is $-183.32 short" on a
                $408 order the player could plainly afford, with a NEGATIVE shortfall.

                A negative shortfall is the worst kind of wrong here: it is not a rounding artefact
                that looks like a rounding artefact, it is a sentence confidently reporting a
                shortage of money in a situation with a surplus of it. The shortfall is now clamped
                to the branch that can actually produce one.
              */}
              {/*
                SHOWN ONLY WHEN THE ORDER IS GENUINELY UNAFFORDABLE, and this took two corrections.

                The first gate was "is cash the binding constraint", which stays true after a sell has
                freed cash -- cash still limits how much you can add long after it stops preventing
                THIS one. So the panel said "`this order is $-183.32 short`" on an order the player
                could plainly afford, with a NEGATIVE shortfall. A negative shortfall is the worst
                kind of wrong here: not a rounding artefact that looks like one, but a sentence
                confidently reporting a shortage of money in a situation with a surplus of it.

                The cap sentence is separate because it is a property of the club rather than of this
                order, and a shortfall against it is a different message from a shortfall against cash.
              */}
              {!affordable && investCents > book.cashCents ? (
                <p className="t-caption text-[var(--color-ink-faint)]">
                  {`This is ${dollars(investCents - book.cashCents)} more than you have.`}
                </p>
              ) : null}
              {capBinds && affordable ? (
                <p className="t-caption text-[var(--color-ink-faint)]">
                  {`This club takes ${dollars(cap.allowed)} at most, and you have ${dollars(capRoom)} of room.`}
                </p>
              ) : null}
            </div>

            {/*
              THE RECEIPT, OR THE REFUSAL.

              A successful trade says what it bought in SHARE TERMS even though the player typed
              dollars -- "`received 0.122445 shares`" -- because that is the one number they cannot
              derive themselves and it closes the loop between the amount they typed and the thing
              they now own. A refusal is red because it is a refusal and nothing else on this screen
              uses red for anything but that.
            */}
            {book.notice ? (
              <p className={`t-caption mt-2 ${book.notice.ok
                ? 'text-[var(--color-neutral)]'
                : 'text-[var(--color-media-glorest)]'}`}>
                {book.notice.message}
              </p>
            ) : null}
          </>
        ) : (
          <p className="t-caption text-[var(--color-ink-faint)]">
            {selected
              ? 'This club has no close yet, so there is nothing to trade at.'
              : 'Pick a club to trade it.'}
          </p>
        )}
      </div>

      {/* THE BOOK. Empty state says what to do rather than showing a dash. */}
      <div className="px-3 py-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="t-label text-[var(--color-ink-faint)]">Positions</span>
          <span className="t-caption text-[var(--color-ink-faint)]">
            realised {pnlText(book.realisedCents)}
          </span>
        </div>

          {/*
            THE TABLE SPEAKS ONLY IN DOLLARS, and that was the player's instruction rather than mine:
            "i don't want the portfolio to say 4 shares of Team A. I simply want the screen to show
            how much money I have invested in that team and how much it's worth."

            Four columns, all of them money: what you put in, what it is worth, and what that is
            worth as a gain. The share count is deliberately ABSENT -- it is what an amount buys, not
            the thing being tracked, and putting it here would invite the reader to do arithmetic in
            a unit the screen has already done for them.

            The row is a BUTTON because the useful action on a position is to go trade it: clicking
            selects the club, which moves the chart to it and points the Unwind control at it, rather
            than putting a second amount input on every row.
          */}
        {positions.length === 0 ? (
          <p className="t-caption text-[var(--color-ink-faint)]">
            Nothing held. Buy a club trading below its fair value and the gap is what you are paid to
            wait out.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="t-label text-[var(--color-ink-faint)]">
                <th className="pb-1 text-left font-normal">Club</th>
                <th className="pb-1 text-right font-normal">Invested</th>
                <th className="pb-1 text-right font-normal">Worth</th>
                <th className="pb-1 text-right font-normal">Open P/L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const team = byId.get(p.teamId);
                const last = closes[p.teamId];
                const priced = typeof last === 'number' && Number.isFinite(last) && last > 0;
                const worth = priced ? valueOf(p, last) : p.costCents;
                const pnl = worth - p.costCents;
                const pct = p.costCents > 0 ? (pnl / p.costCents) * 100 : 0;
                return (
                  <tr
                    key={p.teamId}
                    className={`border-t border-[var(--color-chrome-lo)] ${
                      p.teamId === selectedClub ? 'bg-[var(--color-panel-3)]' : ''
                    }`}
                  >
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => onSelect(p.teamId)}
                        className="flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neutral)]"
                      >
                        {team ? <TeamLogo team={team} sizeClass="h-5 w-5" lazy /> : null}
                        <span className="t-stat-sm text-[var(--color-ink)]">{team?.name ?? p.teamId}</span>
                      </button>
                    </td>
                    <td className="t-stat-sm py-1.5 text-right text-[var(--color-ink-dim)]">
                      {dollars(p.costCents)}
                    </td>
                    <td className="t-stat-sm py-1.5 text-right text-[var(--color-ink-dim)]">
                      {priced ? dollars(worth) : dollars(p.costCents)}
                    </td>
                    <td className={`t-stat-sm py-1.5 text-right ${priced ? pnlClass(pnl) : 'text-[var(--color-ink-faint)]'}`}>
                      {priced
                        ? `${pnlText(pnl)}${pct === 0 ? '' : ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`}`
                        : 'unpriced'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {book.unpriced > 0 ? (
          <p className="t-caption mt-2 text-[var(--color-media-glorest)]">
            {book.unpriced} position(s) have no close today and are being held at cost, not written
            off.
          </p>
        ) : null}

        {book.warning ? (
          <p className="t-caption mt-2 text-[var(--color-ink-faint)]">Saved book: {book.warning}</p>
        ) : null}
      </div>
    </Panel>
  );
};

const Stat: React.FC<{
  label: string;
  value: string;
  sub?: string;
  subClass?: string;
  emphasis?: boolean;
  valueClass?: string;
}> = ({ label, value, sub, subClass, emphasis, valueClass }) => (
  <div className="bg-[var(--color-panel)] px-3 py-2.5">
    <div className="t-label text-[var(--color-ink-faint)]">{label}</div>
    <div className={`${emphasis ? 't-stat-lg' : 't-stat'} mt-1 ${valueClass ?? 'text-[var(--color-ink)]'}`}>
      {value}
    </div>
    {sub ? <div className={`t-caption mt-0.5 ${subClass ?? 'text-[var(--color-ink-faint)]'}`}>{sub}</div> : null}
  </div>
);