import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaId } from '../data/media';
import {
  createWallet, loadWallet, saveWallet,
  placeBet, settleWallet, summariseWallet,
  type Wallet, type BetKind, type Selection, type PlacedBet,
} from '../lib/wallet';
import type { SeasonHistoryEntry, Team, Game } from '../types';
import { MIN_STAKE, MAX_STAKE } from '../lib/wallet';
import type { PropStatKey } from '../lib/playerProps';

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
  /**
   * Prop terms, present only on kind 'prop'.
   *
   * These have to travel through the slip rather than being looked up at
   * settlement, and the reason is a settled bug worth recording: resultFor
   * treats a prop with no stat, no player or no line as unresolvable and voids
   * it. A prop bet confirmed through a slip entry that did not carry these would
   * therefore have been accepted, deducted from the balance, shown on the record
   * as pending, and then voided at the moment it completed -- silently refunding
   * a bet the manager thought they were on, with no error anywhere.
   */
  propStat?: PropStatKey;
  propPlayerId?: string;
  propPlayerName?: string;
  propLine?: number;
}

/** A prop to highlight, and the outlet's copy of it that was clicked. */
export interface PropFocus {
  propId: string;
  mediaId: MediaId;
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

  /**
   * A prop the manager arrived from, on another screen.
   *
   * Held in the shell rather than in either screen because the reference has to
   * survive the navigation: the id is derived from the game, the player, the stat
   * and the line, so the betting page cannot reconstruct it and the media page
   * cannot re-supply it once it has unmounted. A prop id passed as a navigation
   * argument would be gone before the page that could use it rendered.
   *
   * The outlet travels with it, and it has to. The same prop is published by
   * several outlets on the same slate, so the betting page renders it once per
   * outlet that picked it -- up to three identical rows, one per panel. A bare id
   * cannot say which of them was the one clicked, and a lookup by id finds the
   * last one registered, which is the bottom of the page rather than the top.
   * Measured: with three outlets on the same prop, the row scrolled to was the
   * third outlet's, 315px above the fold by the time it settled -- a highlight
   * that lands on the wrong copy and off screen at the same time.
   *
   * Deliberately not cleared automatically. It is cleared when the manager acts
   * on the prop, so that arriving on the betting page and then tabbing through it
   * does not lose the thing they came to look at -- but a highlight that outlives
   * several minutes of unrelated betting would be noise.
   */
  focusedProp: PropFocus | null;
  focusProp: (focus: PropFocus | null) => void;
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
  const [focusedProp, setFocusedProp] = useState<PropFocus | null>(null);

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
            // Already archived on the history entry, so this is read rather than
            // derived. Null when the season produced no champion, which settles the
            // title bets as void -- undetermined, not lost.
            champion: latest.champion?.teamId ?? null,
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
    // Acting on the prop retires the pointer to it. The highlight exists to say
    // "this is the one you came for"; once it is in the slip the slip is the
    // better place to look, and leaving the marker on the board would make a
    // prop that is already committed look like one still being considered.
    if (entry.kind === 'prop') setFocusedProp(null);
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
        // saw. Same reasoning for a prop's own line.
        note: slip.line === undefined ? undefined : String(slip.line),
        propStat: slip.propStat,
        propPlayerId: slip.propPlayerId,
        propPlayerName: slip.propPlayerName,
        propLine: slip.propLine,
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
  const focusProp = useCallback((focus: PropFocus | null) => setFocusedProp(focus), []);

  return {
    wallet, slip, stake, notice, isOpen,
    open: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
    toggle: useCallback(() => setOpen((v) => !v), []),
    select, clear, setStake, confirm, removeBet, summary, openBets, settle,
    focusedProp, focusProp,
  };
};

export { createWallet };
export type { Wallet };
