import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaId } from '../data/media';
import {
  createWallet, loadWallet, resetWallet as resetStoredWallet, saveWallet,
  placeBet, settleWallet, summariseWallet,
  type Wallet, type BetKind, type Selection, type PlacedBet,
} from '../lib/wallet';
import type { SeasonHistoryEntry, Team, Game } from '../types';
import { MIN_STAKE, MAX_STAKE } from '../lib/wallet';
import { buildSettlementContext } from '../lib/settlementContext';
import type { PropStatKey } from '../lib/playerProps';
import { lockedMarketRefusal, type LockedRace } from '../lib/markets';

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
   * When this bet settles, carried from the board that offered it.
   *
   * Travels through the slip for the same reason the prop terms below do: the slip is
   * a staging post, and anything that has to survive onto the bet must be attached
   * before the confirm. A slip that held the game but not its date would let a
   * manager confirm a bet and lose the one fact that says which night to watch.
   */
  resolvesOn?: string;
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
  propTeamId?: string;
  propPlayerName?: string;
  propLine?: number;
  /**
   * The race's closure, as the board computed it, when the market is already decided.
   *
   * Travel on the slip and read at BOTH ends of its life -- when a price is picked, and again when
   * it is confirmed -- because either check alone leaves a hole:
   *
   *   checking only `confirm` means the board still sells a decided race and the manager finds out
   *   at the last click. The button was there, the price was quoted, and the refusal arrives too late
   *   to be anything but a bait-and-switch.
   *
   *   checking only `select` means a slip opened while the race was genuinely live can still be
   *   confirmed after it closes. A race can end between the two clicks, and that is not a
   *   hypothetical here: a bet on a division ten games up sits in the slip for as long as the
   *   manager takes to enter a stake.
   *
   * This is the same staging-post reasoning as the line and the resolution date above: anything that
   * must be true when the money moves has to be attached before it does, because by confirm time the
   * board is somewhere else on screen and cannot be consulted.
   *
   * Undefined means OPEN, matching `FieldMarket.locked`. See that field for why the default runs this
   * way rather than the other.
   */
  locked?: LockedRace;
  /** The winner's name, so a refusal can name them rather than saying "a club". */
  lockedWinnerName?: string;
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
  /**
   * Put the wallet back to a fresh $1,000 with no bets.
   *
   * Exists for exactly one caller -- Terminate Universe -- and it is a separate method rather than a
   * field on the returned object so that clearing a league's money cannot be reached by accident from
   * anywhere else. The portfolio already has the equivalent (`book.reset()`), and the omission of this
   * one is why a terminated universe kept its balance and its whole betting record.
   */
  resetWallet: () => void;
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
  /**
   * Reset to a fresh wallet, for Terminate Universe.
   *
   * THE SLIP GOES TOO, and that is deliberate rather than an oversight: a half-assembled wager on a
   * player pool that no longer exists is not something to carry into the next universe, and leaving it
   * in the drawer would let it be confirmed against a balance that has just been restored to $1,000.
   *
   * `bets` goes with `balance`, which is the consequence worth being explicit about. The record of what
   * was wagered is destroyed, and that is correct here -- every one of those bets referenced players
   * from a league that no longer exists, so a retained record would be a ledger of unresolvable
   * wagers rather than a history. It is destructive, and it is destructive for a reason.
   */
  const resetWallet = useCallback(() => {
    // The pure reset from `lib/wallet`, not a hand-rolled `setWallet(createWallet())`.
    //
    // It was already written and already exported -- it clears the stored key and returns a fresh
    // wallet -- and it had no caller at all. That is why this bug was so easy to miss: the fix existed
    // and was simply never wired up. The first version of this method called `createWallet()` directly
    // and would have worked by accident, because the effect below re-saves whatever state holds; using
    // the real one means the storage-clearing path is the one that runs.
    setWallet(resetStoredWallet());
    // The slip has no equivalent in the pure function, and it must go too: a half-assembled wager on a
    // player pool that no longer exists could otherwise be confirmed against a balance just restored.
    setSlip(null);
    setFocusedProp(null);
    setStake(50);
  }, []);

  const settle = useCallback((input: SettlementInput) => {
    setWallet((current) => {
      if (current.bets.every((bet) => bet.status !== 'open')) return current;

      const next = settleWallet(current, buildSettlementContext(input));
      // Identity is preserved when nothing settled, so this does not re-render
      // the shell on every simulation tick.
      return next === current ? current : next;
    });
  }, []);

  const select = useCallback((entry: SlipEntry) => {
    /*
     * REFUSE AT THE FIRST CLICK.
     *
     * This is the earliest moment the board has said anything about the race, and refusing here
     * means a closed market never becomes a slip at all -- so there is nothing to confirm, nothing
     * staked, and no state to clean up. The notice says what happened in the plainest terms the
     * reason allows; see `lockedMarketRefusal` for why the three reasons are three sentences.
     */
    if (entry.locked) {
      setNotice(lockedMarketRefusal(entry.locked, entry.lockedWinnerName));
      /*
       * Open the slip to show the refusal, even though no slip was added.
       *
       * Without this the notice is set on a panel nobody is looking at, and the manager's experience
       * of pressing a price on a decided race is nothing at all happening. The slip is the one piece
       * of UI that owns this message, so the message has to go there -- empty, with the reason in it.
       */
      setOpen(true);
      return;
    }
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
    /*
     * REFUSE AGAIN, AT THE LAST CLICK. This is the one that matters.
     *
     * `select` already refused a market that was closed when the price was picked, but the race can
     * close while the slip sits open -- and this hook is the only path from a slip to a placed bet,
     * from every screen, which is what makes it the choke point `placeBet` would have been.
     *
     * The order matters: this runs BEFORE the stake is validated, so a closed market reports why it
     * is closed rather than complaining about a stake the manager never gets to set anyway. And it
     * drops the slip, because leaving a closed market in the slip invites a second attempt that will
     * be refused identically -- and a slip that cannot be transacted should not look transactable.
     */
    if (slip.locked) {
      setNotice(lockedMarketRefusal(slip.locked, slip.lockedWinnerName));
      setSlip(null);
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
        // The date the board promised, stored on the bet rather than recomputed.
        // See `PlacedBet.resolvesOn`.
        resolvesOn: slip.resolvesOn,
        backedMedia: slip.backedMedia,
        // A total needs the line that was actually posted, carried on the bet.
        // Recomputing it later would settle against a number the bettor never
        // saw. Same reasoning for a prop's own line.
        note: slip.line === undefined ? undefined : String(slip.line),
        propStat: slip.propStat,
        propPlayerId: slip.propPlayerId,
    propTeamId: slip.propTeamId,
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
        // CARRIED, not recomputed. This line is what makes a void safe: the voided bet's number
        // is now free, so deriving the next id from the remaining bets would hand it straight back
        // out -- and this very function looks bets up BY ID, so a repeated id would refund the
        // wrong stake. See `Wallet.nextBetNumber` in lib/wallet.ts.
        nextBetNumber: current.nextBetNumber,
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
    select, clear, setStake, confirm, removeBet, summary, openBets, settle, resetWallet,
    focusedProp, focusProp,
  };
};

export { createWallet };
export type { Wallet };
