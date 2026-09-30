import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaId } from '../data/media';
import {
  createWallet, loadWallet, saveWallet,
  placeBet, settleWallet, summariseWallet,
  type Wallet, type BetKind, type Selection, type PlacedBet,
} from '../lib/wallet';
import type { SeasonHistoryEntry, Team, Game } from '../types';
import { MIN_STAKE, MAX_STAKE } from '../lib/wallet';

/**
 * The slip, as shared state.
 *
 * This is the reason the betting layer is usable at all. The wallet used to live
 * inside BettingPage, which meant the slip rendered at the bottom of one screen
 * and vanished the moment you navigated anywhere -- so picking a price meant
 * scrolling to the foot of a long page, and a manager who wanted to check their
 * stake had to come back to it. A price is something you add to a list; the
 * list has to outlive the page.
 *
 * So the wallet is lifted to the shell, and the slip is a panel over whatever
 * screen you happen to be on. The Betting screen and the slip now read the same
 * state, which is also the only way they can agree about what is in it.
 */

export interface SlipEntry {
  kind: BetKind;
  marketKey: string;
  marketTitle: string;
  selection: Selection;
  selectionLabel: string;
  price: number;
  line?: number;
  backedMedia: MediaId | null;
}

export interface BettingSlipState {
  wallet: Wallet;
  /** The bet being assembled, or null. Never committed without a confirm. */
  slip: SlipEntry | null;
  stake: number;
  notice: string | null;
  isOpen: boolean;

  open: () => void;
  close: () => void;
  toggle: () => void;
  select: (entry: SlipEntry) => void;
  clear: () => void;
  setStake: (value: number) => void;
  confirm: (currentDate: string) => void;
  removeBet: (id: string) => void;
  summary: ReturnType<typeof summariseWallet>;
  openBets: PlacedBet[];
}

export interface SettlementInput {
  games: Game[];
  teams: Team[];
  currentDate: string;
  seasonHistory: SeasonHistoryEntry[];
}

export const useBettingSlip = (): BettingSlipState & { settle: (input: SettlementInput) => void } => {
  const [wallet, setWallet] = useState<Wallet>(loadWallet);
  const [slip, setSlip] = useState<SlipEntry | null>(null);
  const [stake, setStake] = useState(50);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    saveWallet(wallet);
  }, [wallet]);

  /**
   * Settle from the shell rather than from the Betting page.
   *
   * This has to run wherever the app happens to be, because a bet settles when
   * its game finishes and the manager will have wandered off to Standings by
   * then. It is an effect rather than a call site so there is exactly one place
   * that can settle, and it no-ops when nothing is open.
   */
  const settle = useCallback((input: SettlementInput) => {
    setWallet((current) => {
      if (current.bets.every((bet) => bet.status !== 'open')) return current;

      const latest = input.seasonHistory[input.seasonHistory.length - 1];
      const next = settleWallet(current, {
        games: input.games,
        teams: input.teams,
        currentDate: input.currentDate,
        seasonComplete: Boolean(latest),
        seasonWinners: latest
          ? {
            seasonYear: latest.seasonYear,
            divisions: new Map(latest.divisionWinners.map((w) => [`${w.league} ${w.division}`, w.teamId])),
            leagues: new Map(latest.divisionWinners.map((w) => [w.league, w.teamId])),
          }
          : null,
        awardWinners: latest
          ? new Map<string, string>([
            ['batting_mvp', latest.battingMvp?.playerId],
            ['pitching_mvp', latest.pitchingMvp?.playerId],
          ].filter((pair): pair is [string, string] => Boolean(pair[1])))
          : null,
      });
      // Identity is preserved when nothing settled, so this does not re-render
      // the shell on every simulation tick.
      return next === current ? current : next;
    });
  }, []);

  const select = useCallback((entry: SlipEntry) => {
    setSlip(entry);
    setNotice(null);
    // Opening on add is the e-commerce convention and the whole reason this
    // was worth lifting out of the page: you press a price, you see what you
    // just picked, and the confirm is right there.
    setOpen(true);
  }, []);

  const clear = useCallback(() => {
    setSlip(null);
    setNotice(null);
  }, []);

  const confirm = useCallback((currentDate: string) => {
    if (!slip) return;
    if (stake < MIN_STAKE || stake > MAX_STAKE) {
      setNotice(`Stake must be between ${MIN_STAKE} and ${MAX_STAKE}.`);
      return;
    }
    setWallet((current) => {
      const result = placeBet(current, {
        kind: slip.kind,
        marketKey: slip.marketKey,
        marketTitle: slip.marketTitle,
        selection: slip.selection,
        selectionLabel: slip.selectionLabel,
        stake,
        price: slip.price,
        placedOn: currentDate,
        backedMedia: slip.backedMedia,
        // A total needs the line that was actually posted, carried on the bet.
        // Recomputing it later would settle against a number the bettor never
        // saw.
        note: slip.line === undefined ? undefined : String(slip.line),
      });
      if ('error' in result) {
        setNotice(result.error);
        return current;
      }
      return result.wallet;
    });
    setSlip(null);
    setNotice(`Staked ${stake} on ${slip.selectionLabel}.`);
  }, [slip, stake]);

  /**
   * Withdraw a bet that has not settled.
   *
   * A real book takes a bet back until the game starts. Without this the only
   * way out of a mistimed click is to let it ride, which is the wrong lesson to
   * teach about a slip.
   */
  const removeBet = useCallback((id: string) => {
    setWallet((current) => {
      const bet = current.bets.find((b) => b.id === id);
      if (!bet || bet.status !== 'open') return current;
      return {
        balance: current.balance + bet.stake,
        bets: current.bets.filter((b) => b.id !== id),
      };
    });
  }, []);

  const summary = useMemo(() => summariseWallet(wallet), [wallet]);
  const openBets = useMemo(
    () => wallet.bets.filter((bet) => bet.status === 'open'),
    [wallet.bets],
  );

  return {
    wallet, slip, stake, notice, isOpen,
    open: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
    toggle: useCallback(() => setOpen((v) => !v), []),
    select, clear, setStake, confirm, removeBet, summary, openBets, settle,
  };
};

export { createWallet };
export type { Wallet };
