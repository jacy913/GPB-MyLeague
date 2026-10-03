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
import { averageCost, dollars, STARTING_CASH_CENTS } from '../../lib/portfolio';
import { marketSizeFor } from '../../lib/analytics/fanbase';
import { usePortfolio } from '../../hooks/usePortfolio';
import { fmtPrice } from './ExchangeView';
import type { Team } from '../../types';

const signedDollars = (cents: number): string =>
  `${cents < 0 ? '-' : '+'}${dollars(Math.abs(cents))}`;

/**
 * A gain, a loss, or nothing at all.
 *
 * An em dash rather than `+$0.00`, and this is the third time this page has needed the same rule.
 * A flat book printed three zeroes -- total sub, open P/L, realised -- which reads as three small
 * achievements rather than as "nothing has happened yet". A number that is not a result should not
 * be dressed as one.
 */
const pnlText = (cents: number): string => (cents === 0 ? '—' : signedDollars(cents));
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
}

export const ExchangeDesk: React.FC<ExchangeDeskProps> = ({
  teams, closes, markedOn, selectedClub,
}) => {
  const book = usePortfolio(closes);
  const [shares, setShares] = React.useState('1');

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
  const wanted = Number.parseInt(shares, 10);
  const shareCount = Number.isFinite(wanted) && wanted > 0 ? wanted : 1;
  const costCents = selectedClose === null ? 0 : Math.round(selectedClose * 100) * shareCount;
  const affordable = costCents <= book.cashCents;

  const held = selected ? book.sharesHeld(selected.id) : 0;
  const canSell = held > 0 && shareCount <= held;

  /*
    WHETHER CASH IS THE BINDING CONSTRAINT, decided once so the label and the message agree.

    Both are computed from the same two integers, which is why the cost preview and the refusal
    cannot disagree by a cent: `buyShares` charges `centsFor(price) * shares` and this charges the
    same expression. A player who sees a cost and then gets told a different cost has been told one
    of them is a lie.
  */
  const capRoom = Math.max(0, cap.allowed - cap.held);
  const cashRoom = selectedClose !== null && selectedClose > 0
    ? Math.floor(book.cashCents / Math.round(selectedClose * 100))
    : 0;

  const act = React.useCallback((direction: 'buy' | 'sell') => {
    if (!selected || selectedClose === null) return;
    if (direction === 'buy') {
      book.buy({
        teamId: selected.id,
        shares: shareCount,
        price: selectedClose,
        date: markedOn ?? '',
        marketSize: selectedMarketSize,
      });
    } else {
      book.sell({ teamId: selected.id, shares: shareCount, price: selectedClose });
    }
  }, [book, selected, selectedClose, shareCount, markedOn, selectedMarketSize]);

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
                  <span className="t-label text-[var(--color-ink-faint)]">Shares</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    className="t-stat w-24 rounded border border-[var(--color-chrome-mid)] bg-[var(--color-chrome-lo)] px-2 py-1 text-[var(--color-ink)]"
                  />
                </label>
                <div className="pb-1">
                  <div className="t-label text-[var(--color-ink-faint)]">Cost</div>
                  {/*
                    THE COST IS NOT COLOURED ON AFFORDABILITY, and that took a correction.

                    The first version painted it red when the order exceeded cash. Red already means
                    "a loss" in the P/L column two inches below, and one screen must not use one
                    colour for two unrelated things -- a red COST next to a red LOSS reads as two
                    losses when one of them is just a price. Affordability is carried by the button
                    state and by an explicit shortfall, which are about the ORDER rather than about
                    money being lost.
                  */}
                  <div className="t-stat text-[var(--color-ink)]">{dollars(costCents)}</div>
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
                  Buy {selected.name}
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
                  Sell {shareCount}
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
                {`Holding ${cap.held} of a ${cap.allowed}-share cap · average cost ${held > 0
                  ? fmtPrice(averageCost(book.portfolio.positions.find((p) => p.teamId === selected.id)!))
                  : '—'} · ${selectedMarketSize < 33 ? 'thin market' : selectedMarketSize < 67 ? 'middling market' : 'thick market'}`}
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
              {!affordable && costCents > book.cashCents ? (
                <p className="t-caption text-[var(--color-ink-faint)]">
                  {`Cash allows ${cashRoom} more share${cashRoom === 1 ? '' : 's'} — this order is `
                    + `${dollars(costCents - book.cashCents)} short.`}
                </p>
              ) : null}
            </div>

            {book.notice && !book.notice.ok ? (
              <p className="t-caption mt-2 text-[var(--color-media-glorest)]">{book.notice.message}</p>
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
                <th className="pb-1 text-right font-normal">Shares</th>
                <th className="pb-1 text-right font-normal">Avg cost</th>
                <th className="pb-1 text-right font-normal">Last</th>
                <th className="pb-1 text-right font-normal">Open P/L</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const team = byId.get(p.teamId);
                const last = closes[p.teamId];
                const priced = typeof last === 'number' && Number.isFinite(last) && last > 0;
                const pnl = priced ? Math.round(last * 100) * p.shares - p.costCents : 0;
                return (
                  <tr key={p.teamId} className="border-t border-[var(--color-chrome-lo)]">
                    <td className="py-1.5">
                      <span className="flex items-center gap-2">
                        {team ? <TeamLogo team={team} sizeClass="h-5 w-5" lazy /> : null}
                        <span className="t-stat-sm text-[var(--color-ink)]">{team?.name ?? p.teamId}</span>
                      </span>
                    </td>
                    <td className="t-stat-sm py-1.5 text-right text-[var(--color-ink-dim)]">{p.shares}</td>
                    <td className="t-stat-sm py-1.5 text-right text-[var(--color-ink-dim)]">{fmtPrice(averageCost(p))}</td>
                    <td className="t-stat-sm py-1.5 text-right text-[var(--color-ink-dim)]">
                      {priced ? fmtPrice(last) : '--'}
                    </td>
                    <td className={`t-stat-sm py-1.5 text-right ${priced ? pnlClass(pnl) : 'text-[var(--color-ink-faint)]'}`}>
                      {priced ? pnlText(pnl) : 'unpriced'}
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