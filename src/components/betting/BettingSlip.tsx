import React, { useEffect, useMemo, useRef } from 'react';
import { ChevronRight, Receipt, Trash2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { MEDIA_BY_ID, forecasterName } from '../../data/media';
import { formatAmerican } from '../../lib/markets';
import { MIN_STAKE, MAX_STAKE, settleReturn, STARTING_BALANCE, type PlacedBet } from '../../lib/wallet';
import type { WalletSummary } from './BettingHub';
import type { SlipEntry } from '../../hooks/useBettingSlip';
import { RetroButton, StatValue } from '../ui';
import { MEDIA_MARKS_SQUARE } from '../media/mediaImages';
import { formatResolutionDate } from '../../lib/marketDates';
import type { Game, Team } from '../../types';
import { BetFixtureLine, buildFixtureLookupFromGames, fixtureForBet } from './BetFixtureLine';

/**
 * The slip.
 *
 * A panel over whatever screen you are on, on the e-commerce model: a price is
 * added, the list is always reachable, and the list lives in the shell rather
 * than at the foot of a page. It slides in from the right because that is where
 * the eye already goes for a cart, and because a panel that arrives from the
 * left reads as navigation while one that arrives from the right reads as
 * "something you just did produced this".
 *
 * Deliberately NOT a parlay. Every leg is a separate stake that settles
 * against its own result. A parlay multiplies the legs, which against three
 * forecasters whose calibration has been measured makes the combined bet
 * strictly worse value than the same money flat -- the product decision comes
 * before the code, and the honest version of this panel is the one above.
 */

const STATUS_LABEL: Record<PlacedBet['status'], string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  void: 'Voided',
};

const STATUS_CLASS: Record<PlacedBet['status'], string> = {
  open: 'text-[var(--color-gold)] border-l-[var(--color-gold)]',
  won: 'text-[var(--color-pos)] border-l-[var(--color-pos)]',
  lost: 'text-[var(--color-neg)] border-l-[var(--color-neg)]',
  void: 'text-[var(--color-ink-faint)] border-l-[var(--color-ink-faint)]',
};

export const BettingSlip: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onOpenRecord: () => void;
  entry: SlipEntry | null;
  stake: number;
  onStake: (value: number) => void;
  onConfirm: () => void;
  onClear: () => void;
  notice: string | null;
  balance: number;
  openBets: PlacedBet[];
  settledBets: PlacedBet[];
  /**
   * The schedule and the club list, so a bet can be resolved to its fixture.
   *
   * GAMES AND TEAMS, NOT A PRICED SLATE, and deliberately. The slip is rendered from
   * the shell, which has neither `GameLine`s nor any market to build them from -- and
   * pricing a moneyline in the shell purely to draw two crests would derive a market
   * nobody there is going to bet. What the slip needs is identity: which two clubs, on
   * which date. `BetFixtureLine` is typed to that narrow shape for exactly this reason.
   *
   * Both come from the same schedule the betting page reads, so the two surfaces
   * cannot name different clubs for one fixture.
   */
  games: Game[];
  teams: Team[];
  summary: WalletSummary;
}> = ({
  isOpen, onClose, onOpenRecord,
  entry, stake, onStake, onConfirm, onClear, notice,
  balance, openBets, settledBets, games, teams, summary,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const fixtureById = useMemo(
    () => buildFixtureLookupFromGames(games, new Map(teams.map((team) => [team.id, team]))),
    [games, teams],
  );

  /*
   * Escape closes, and focus moves into the panel.
   *
   * A panel that appears without taking focus leaves a keyboard user tabbing
   * through the page behind it, which is the same bug as a modal that is only
   * visually modal. Focus is returned to whatever opened it on close.
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
            aria-label="Betting slip"
            tabIndex={-1}
            className="fixed right-0 top-0 z-[71] flex h-full w-full max-w-[440px] flex-col border-l-4 border-l-[var(--color-gold)] bg-[var(--color-base-2)] shadow-[-8px_0_24px_rgba(0,0,0,0.6)] focus:outline-none"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.24, ease: [0.22, 0.61, 0.36, 1] }}
          >
            {/* Header. The chevron points back at the page, because closing
                returns you there rather than going anywhere. */}
            <div className="chrome-bar flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
                <h2 className="t-h3">Betting Slip</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close slip"
                className="gold-sweep p-1 text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {/* Balance. Zero is neither a gain nor a loss and is not coloured
                as one -- an untouched slip reading "+$0" in green is a lie. */}
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-4 py-3">
              <div>
                <p className="t-caption text-[var(--color-ink-faint)]">Balance</p>
                <p className="t-stat-lg tabular-nums text-[var(--color-gold-hi)]">${Math.round(balance)}</p>
              </div>
              <div className="text-right">
                <p className="t-caption text-[var(--color-ink-faint)]">At risk</p>
                <p className="t-stat tabular-nums">${openBets.reduce((s, b) => s + b.stake, 0)}</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* The bet being assembled. */}
              {entry ? (
                <div className="border-b border-[var(--color-chrome-lo)] p-4">
                  <p className="t-caption text-[var(--color-gold)]">Ready to place</p>
                  <p className="t-h3 mt-1">{entry.selectionLabel}</p>
                  <p className="t-caption text-[var(--color-ink-faint)]">
                    {entry.marketTitle} · {formatAmerican(entry.price)}
                    {entry.line !== undefined && ` · line ${entry.line.toFixed(1)}`}
                  </p>
                  {entry.backedMedia && (
                    <div className="mt-2 flex items-center gap-2">
                      <img
                        src={MEDIA_MARKS_SQUARE[entry.backedMedia]}
                        alt=""
                        aria-hidden="true"
                        className="h-4 w-4 object-contain"
                      />
                      <span className="t-caption text-[var(--color-warn)]">
                        At {forecasterName(entry.backedMedia)}&rsquo;s price, not the house line
                      </span>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[10, 25, 50, 100, 250].map((value) => (
                      <RetroButton
                        key={value}
                        size="sm"
                        chevron={false}
                        variant={stake === value ? 'primary' : 'ghost'}
                        disabled={value > balance}
                        onClick={() => onStake(value)}
                      >
                        {value}
                      </RetroButton>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-3 py-2">
                    <span className="t-caption text-[var(--color-ink-faint)]">Returns if it wins</span>
                    <StatValue variant="accent" size="lg">
                      ${Math.round(settleReturn(stake, entry.price, true))}
                    </StatValue>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <RetroButton
                      variant="primary"
                      className="flex-1"
                      disabled={stake < MIN_STAKE || stake > MAX_STAKE || stake > balance}
                      onClick={onConfirm}
                    >
                      Place ${stake} bet
                    </RetroButton>
                    <RetroButton variant="ghost" onClick={onClear}>Clear</RetroButton>
                  </div>
                </div>
              ) : (
                <p className="t-body border-b border-[var(--color-chrome-lo)] p-4 text-[var(--color-ink-dim)]">
                  Press any price to add it here. Nothing is wagered until you confirm.
                </p>
              )}

              {/*
                THE NOTICE, AT PANEL LEVEL RATHER THAN INSIDE THE ENTRY.

                This used to sit inside the `entry ? ... : ...` branch, which meant it was only ever
                visible while a bet was loaded. That is fine for "Stake must be between 10 and
                5000" -- there is always an entry when the stake is wrong -- and it quietly hides
                every refusal that happens with NO entry, which is exactly what a closed market
                produces: `select` refuses before it sets the slip, so the manager is left looking at
                an empty slip that says nothing.

                A refusal the manager cannot read is not a refusal, it is a button that silently did
                nothing. So it renders whatever the panel holds, and the empty-state line above is
                where it lands when there is no entry.
              */}
              {notice && (
                <p
                  className="t-caption border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2 text-[var(--color-warn)]"
                  role="status"
                >
                  {notice}
                </p>
              )}

              {/* Open bets. */}
              <div className="p-4">
                <h3 className="t-label mb-2 text-[var(--color-ink-faint)]">
                  Open ({openBets.length})
                </h3>
                {openBets.length === 0 ? (
                  <p className="t-caption text-[var(--color-ink-faint)]">
                    No open bets. A bet stays open until its game is played.
                  </p>
                ) : (
                  <div className="grid gap-1">
                    {openBets.map((bet) => (
                      <div
                        key={bet.id}
                        className={`flex items-center justify-between gap-2 border-l-[3px] bg-[var(--color-sunken)] px-3 py-2 ${STATUS_CLASS[bet.status]}`}
                      >
                        <div className="min-w-0">
                          <p className="t-stat-sm truncate">
                            {bet.selectionLabel} {formatAmerican(bet.price)}
                          </p>
                          <p className="t-caption text-[var(--color-ink-faint)]">{bet.marketTitle}</p>
                          {/*
                            THE GAME AND THE DATE, IN THE SLIP.

                            This is the surface that exists to hold what the manager has
                            at risk, and until now it showed less about each bet than the
                            page behind it did -- a bet's name and its market title, and
                            nothing about which game to watch or which night it settles.
                            Opening the slip to check on your exposure gave you a worse
                            answer than not opening it.

                            Shared with the betting page's open-bets panel via
                            `BetFixtureLine`, rather than reimplemented here, because the
                            two lists disagreeing about a real wager is exactly the bug
                            this started as.
                          */}
                          <BetFixtureLine
                            bet={bet}
                            fixture={fixtureForBet(bet, fixtureById)}
                            className="mt-0.5"
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {bet.backedMedia && (
                            <img
                              src={MEDIA_MARKS_SQUARE[bet.backedMedia]}
                              alt={forecasterName(bet.backedMedia)}
                              title={`Acted on ${MEDIA_BY_ID[bet.backedMedia].outlet}'s number`}
                              className="h-4 w-4 object-contain"
                            />
                          )}
                          <span className="t-stat tabular-nums">${bet.stake}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recently settled, so the record is one glance away without a
                  second screen having to be opened. */}
              {settledBets.length > 0 && (
                <div className="px-4 pb-4">
                  <h3 className="t-label mb-2 text-[var(--color-ink-faint)]">Recently settled</h3>
                  <div className="grid gap-1">
                    {settledBets.slice(0, 5).map((bet) => (
                      <div
                        key={bet.id}
                        className={`flex items-center justify-between gap-x-2 gap-y-0.5 border-l-[3px] bg-[var(--color-sunken)] px-3 py-1.5 ${STATUS_CLASS[bet.status]}`}
                      >
                        <div className="min-w-0">
                          <p className="t-caption truncate text-[var(--color-ink-dim)]">
                            {bet.selectionLabel}
                          </p>
                          {/*
                            THE DATE A SETTLED BET RESOLVED ON.

                            A settled prop bet previously said only the selection and a
                            word like "Won". "Quincy Hollis Over 1.5 Hits — Won" does not
                            say which game it won in, which is the question a manager
                            asking after the fact actually has: not what happened, but
                            whether the thing I backed last week did what I said it would.

                            The fixture crests are deliberately NOT repeated here. Five
                            rows of two crests each is noise on a list whose job is to be
                            scannable, and the date is the part that is missing -- the
                            selection already names the player and the line.
                          */}
                          {bet.resolvesOn && (
                            <p className="t-caption tabular-nums text-[var(--color-ink-faint)]">
                              {formatResolutionDate(bet.resolvesOn)}
                            </p>
                          )}
                        </div>
                        <span className="t-caption shrink-0">{STATUS_LABEL[bet.status]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer. The record lives on its own screen, reached only from
                here, so the nav rail has one fewer permanent destination for a
                screen most managers open a few times a season. */}
            <div className="shrink-0 border-t border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="t-caption text-[var(--color-ink-faint)]">
                    {summary.settled === 0
                      ? 'No settled bets'
                      : `${summary.wins}/${summary.settled} won`}
                  </p>
                  <p className="t-stat-sm tabular-nums">
                    {summary.profit > 0 ? '+' : summary.profit < 0 ? '-' : ''}
                    ${Math.abs(Math.round(summary.profit))}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenRecord}
                  className="gold-sweep gold-edge flex items-center gap-2 border-l-[3px] border-l-transparent py-1 pl-3 pr-2 t-caption text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
                >
                  Betting Record
                  <ChevronRight depth={8} height={8} className="text-[var(--color-gold)]" />
                </button>
              </div>
              <p className="mt-1 t-caption text-[var(--color-ink-faint)]">
                Started at ${STARTING_BALANCE}
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
