import React, { useMemo, useState } from 'react';
import { Receipt, TrendingDown, TrendingUp } from 'lucide-react';
import { formatAmerican } from '../../lib/markets';
import { formatResolutionDate } from '../../lib/marketDates';
import { MEDIA_BY_ID, forecasterName } from '../../data/media';
import { STARTING_BALANCE, type PlacedBet } from '../../lib/wallet';
import { MEDIA_MARKS_SQUARE } from '../media/mediaImages';
import { Panel, StatTable, StatValue, type StatTableColumn, type StatTableRow } from '../ui'
import type { Player, Team } from '../../types';;

type Filter = 'all' | 'open' | 'settled';

/**
 * The betting record.
 *
 * A screen rather than a panel, and deliberately NOT in the nav rail. It is a
 * ledger: most managers open it twice a season to see whether they are up, and
 * giving it a permanent leaf in a twenty-item sidebar would claim it is a place
 * you live. The slip links here, and the header's Parlays button brings you
 * back.
 *
 * The profit figure is running balance against the starting stake, not a sum of
 * settled returns. Those differ whenever a bet is open, and an earlier version
 * of summariseWallet reported the sum while the header showed the balance, so
 * the two figures could disagree on screen at the same time.
 */
export const BettingRecordScreen: React.FC<{
  bets: PlacedBet[];
  balance: number;
  teams: Team[];
  /*
    Player id to club id, for prop bets placed BEFORE propTeamId was stored on the bet.

    Without this the fallback is silent: a bet from an existing save has no propTeamId, so the player
    renders with no club beside them, and the original complaint -- not knowing which team the player
    is on -- persists for exactly the bets a reader already has. Reading it from the live roster is
    wrong if the player has since been traded, which is why the STORED value wins whenever it exists;
    for a bet that predates the field there is no stored value to be wrong.
  */
  players: Player[];
  onBackToSlip: () => void;
}> = ({ bets, balance, teams, players, onBackToSlip }) => {
  /*
    BUILT HERE rather than passed in, so the memo is stable across renders. The router's body is a bare
    JSX expression with nowhere to declare a const, so a map built at the call site would be a NEW
    object every render and would invalidate this screen's row memo on every parent render for no
    reason at all.
  */
  const playerTeamById = useMemo(
    () => new Map(players.filter((p) => p.teamId).map((p) => [p.playerId, p.teamId])),
    [players],
  );
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    if (filter === 'open') return bets.filter((b) => b.status === 'open');
    if (filter === 'settled') return bets.filter((b) => b.status !== 'open');
    return bets;
  }, [bets, filter]);

  const stats = useMemo(() => {
    const settled = bets.filter((b) => b.status !== 'open');
    const won = settled.filter((b) => b.status === 'won');
    const lost = settled.filter((b) => b.status === 'lost');
    const staked = bets.reduce((s, b) => s + b.stake, 0);
    const returned = settled.reduce(
      (s, b) => s + (b.status === 'won' ? b.payout : b.status === 'void' ? b.stake : 0), 0,
    );
    const peak = balance + bets.filter((b) => b.status === 'open').reduce((s, b) => s + b.stake, 0);
    return {
      open: bets.filter((b) => b.status === 'open').length,
      settled: settled.length,
      wins: won.length,
      losses: lost.length,
      winRate: settled.length ? won.length / settled.length : 0,
      staked,
      returned,
      profit: balance - STARTING_BALANCE,
      peak,
    };
  }, [balance, bets]);

  const columns: StatTableColumn[] = useMemo(() => ([
    { key: 'market', header: 'MARKET' },
    { key: 'pick', header: 'PICK' },
    { key: 'price', header: 'PRICE', align: 'right', isNumeric: true, width: '6ch' },
    { key: 'stake', header: 'STAKE', align: 'right', isNumeric: true, width: '6ch' },
    { key: 'result', header: 'RESULT', align: 'right', isNumeric: true, width: '8ch' },
  ]), []);

  const rows: StatTableRow[] = useMemo(() => visible.map((bet) => {
    const profit = bet.status === 'void'
      ? 0
      : bet.status === 'won' ? bet.payout - bet.stake : -bet.stake;

    /*
      WHOSE PLAYER, AND WHICH CLUB.

      The stored `propTeamId` first, because it was recorded at the moment the wager was made and is
      therefore correct even for a player who has since been traded. The live roster second, and only
      because a bet placed before that field existed has nothing stored -- which is precisely the bet
      the person reading this screen is looking at when they report not knowing whose player it was.
    */
    const propTeamId = bet.propTeamId
      ?? (bet.propPlayerId ? playerTeamById.get(bet.propPlayerId) : undefined);
    const playerTeam = propTeamId ? teams.find((t) => t.id === propTeamId) : undefined;
    return {
      id: bet.id,
      cells: {
        market: (
          <span className="flex min-w-0 items-center gap-2">
            {bet.backedMedia && (
              <img
                src={MEDIA_MARKS_SQUARE[bet.backedMedia]}
                alt={forecasterName(bet.backedMedia)}
                title={`Acted on ${MEDIA_BY_ID[bet.backedMedia].outlet}'s number`}
                className="h-5 w-5 shrink-0 object-contain"
              />
            )}
            <span className="min-w-0">
              <span className="block truncate t-stat-sm">{bet.marketTitle}</span>
              <span className="block truncate t-caption text-[var(--color-ink-faint)]">
                {/*
                  PLACED, AND SETTLED.

                  `placedOn` alone was the whole of the date information here, and it is
                  the wrong half to have on its own: a record spanning a season is read
                  to answer "what did this resolve on", not "when did I click". Both are
                  now labelled so neither reads as the other.

                  No crests here, deliberately. This screen holds bets from every past
                  season, and those games are long gone from any slate the app still has,
                  so a fixture lookup would resolve to nothing for most rows and the
                  column would be a row of empty squares. The crest belongs on the open
                  lists, where the game is still ahead of you.
                */}
                placed {bet.placedOn}
                {bet.resolvesOn && ` · settles ${formatResolutionDate(bet.resolvesOn)}`}
                {bet.note && ` · line ${Number(bet.note).toFixed(1)}`}
              </span>
            </span>
          </span>
        ),
        pick: (
          <span className="flex min-w-0 flex-col">
            {bet.kind === 'prop' ? (
              /*
                A PROP BET NAMES ITS PLAYER, ITS CLUB AND WHAT HE DID.

                This cell was `bet.selectionLabel` and nothing else, which for a prop is the single
                word "Over" or "Under". So a settled prop in this screen read:

                    Over/Under Hits Allowed | Over | -115 | $50 | -$50

                which does not say whose player, which club, what the line was, or how close it was --
                and this is the screen a manager opens precisely to find out why they lost. The
                complaint that produced this was "I lost and never saw the player's performance that
                day", and every one of those facts was either stored on the bet already or is now.

                `propActual` is ABSENT on a bet placed before it was recorded, and absent on a prop that
                never settled. Both print "not recorded" rather than a zero, because "he went oh-for-
                four" and "we do not know" are different sentences and a zero would claim the first.
              */
              <>
                <span className="truncate t-stat-sm">
                  {bet.propPlayerName ?? bet.selectionLabel}
                </span>
                <span className="truncate t-caption text-[var(--color-ink-faint)]">
                  {playerTeam ? `${playerTeam.city} · ` : ''}
                  O/U {typeof bet.propLine === 'number' ? bet.propLine : '?'}
                  {bet.propActual !== undefined
                    ? ` · went ${bet.propActual}`
                    : ' · actual not recorded'}
                </span>
              </>
            ) : (
              <span className="t-stat-sm">{bet.selectionLabel}</span>
            )}
          </span>
        ),
        price: formatAmerican(bet.price),
        stake: `$${bet.stake}`,
        result: (
          <span className={`t-stat-sm uppercase ${bet.status === 'won' ? 'text-[var(--color-pos)]' : bet.status === 'lost' ? 'text-[var(--color-neg)]' : 'text-[var(--color-ink-faint)]'}`}>
            {bet.status === 'open'
              ? '—'
              : `${profit > 0 ? '+' : profit < 0 ? '-' : ''}$${Math.abs(Math.round(profit))}`}
          </span>
        ),
      },
    };
  }), [visible, teams, playerTeamById]);

  const netClass = stats.profit > 0
    ? 'text-[var(--color-pos)]'
    : stats.profit < 0 ? 'text-[var(--color-neg)]' : 'text-[var(--color-ink-dim)]';

  return (
    <section className="space-y-5">
      <Panel variant="hero" className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-[var(--color-gold)]" aria-hidden="true" />
              <h1 className="t-h1">Betting Record</h1>
            </div>
            <p className="t-body mt-2 max-w-2xl text-[var(--color-ink-dim)]">
              Every stake taken this save, and what it returned. Reached from the
              slip; it is not a permanent destination in the rail.
            </p>
          </div>
          <div className="border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-4 py-3 text-right">
            <p className="t-caption text-[var(--color-ink-faint)]">Bankroll</p>
            <p className="t-stat-lg tabular-nums text-[var(--color-gold-hi)]">${Math.round(balance)}</p>
            <p className={`t-caption tabular-nums ${netClass}`}>
              {stats.profit > 0 ? '+' : stats.profit < 0 ? '-' : ''}
              ${Math.abs(Math.round(stats.profit))}
            </p>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Open', value: String(stats.open) },
          { label: 'Settled', value: String(stats.settled) },
          {
            label: 'Win rate',
            value: stats.settled ? `${(stats.winRate * 100).toFixed(0)}%` : '—',
            // No trend arrow until there is something settled to have a trend.
            // An earlier version drew a down-arrow on a fresh save, because
            // winRate starts at 0 and 0 is less than one half.
            icon: stats.settled === 0
              ? null
              : stats.winRate >= 0.5 ? TrendingUp : TrendingDown,
          },
          /*
            "Staked" counts every bet, open ones included. It previously summed
            only settled bets, so a save holding one open $50 stake read
            "Staked $0" directly above a ledger listing that very $50 --
            technically about settled action, practically a lie about money
            committed.
          */
          { label: 'Staked', value: `$${stats.staked}` },
        ].map((tile) => (
          <div key={tile.label} className="border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-4 py-3">
            <p className="t-caption text-[var(--color-ink-faint)]">{tile.label}</p>
            <p className="t-stat-lg flex items-center gap-2 tabular-nums">
              {tile.icon && <tile.icon className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />}
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3">
          <h2 className="t-h3">Ledger</h2>
          <div className="flex items-center gap-1.5">
            {(['all', 'open', 'settled'] as Filter[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`gold-sweep t-caption uppercase px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] ${
                  filter === option
                    ? 'bg-[var(--color-gold)] text-[var(--color-ink-invert)]'
                    : 'text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="t-body p-5 text-[var(--color-ink-dim)]">
            {bets.length === 0
              ? 'No bets placed yet. Open the slip from the Parlays button in the header to add one.'
              : `No ${filter} bets.`}
          </p>
        ) : (
          <StatTable
            columns={columns}
            rows={rows}
            density="dense"
            aria-label="Betting ledger"
          />
        )}
      </Panel>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={onBackToSlip}
          className="gold-sweep gold-edge flex items-center gap-2 border-l-[3px] border-l-transparent py-2 pl-4 pr-3 t-label text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
        >
          Back to the slip
        </button>
      </div>
    </section>
  );
};

/** Exported for the header, which shows the same running figure. */
export const netOf = (balance: number): number => balance - STARTING_BALANCE;
export { StatValue };
