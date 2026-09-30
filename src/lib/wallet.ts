import type { Game, Team } from '../types';
import type { MediaId } from '../data/media';
import { formatAmerican } from './markets';

/**
 * Book and wallet.
 *
 * A price with nothing riding on it is a ranking, and a ranking is not a game.
 * This is the smallest thing that makes the lines mean something: a balance, a
 * slip, and settlement against what actually happened.
 *
 * Two rules that matter and are enforced here rather than in the UI:
 *
 *   1. A bet locks when it is placed and cannot be changed afterwards. Bets are
 *      recorded against the date they were taken, and settlement only ever
 *      considers bets placed strictly before the game. Without that, settling
 *      after seeing the result is free money and the whole thing is theatre.
 *   2. Bets settle from data the simulation already produced. A game settles
 *      from its final score, a season settles from season history. No bet
 *      requires a result the engine does not already record.
 */

export const STARTING_BALANCE = 1000;
export const MIN_STAKE = 5;
export const MAX_STAKE = 250;

export type BetKind = 'moneyline' | 'total' | 'first5' | 'division' | 'league' | 'award';
export type BetStatus = 'open' | 'won' | 'lost' | 'void';
export type Selection = 'away' | 'home' | 'over' | 'under' | string;

export interface PlacedBet {
  id: string;
  kind: BetKind;
  /** Identifies the market, e.g. a game id or a season key. */
  marketKey: string;
  marketTitle: string;
  selection: Selection;
  selectionLabel: string;
  stake: number;
  /** American price taken, including whatever margin the house was posting. */
  price: number;
  placedOn: string;
  status: BetStatus;
  payout: number;
  /** Which forecaster's number the bettor used, when they acted on one. */
  backedMedia: MediaId | null;
  note?: string;
}

export interface Wallet {
  balance: number;
  bets: PlacedBet[];
}

/** Profit or return on a winning bet at a given price. */
export const settleReturn = (stake: number, price: number, won: boolean): number => {
  if (!won) return 0;
  if (price > 0) return stake + (stake * price) / 100;
  return stake + (stake * 100) / Math.abs(price);
};

export const createWallet = (): Wallet => ({ balance: STARTING_BALANCE, bets: [] });

const betId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const canAfford = (wallet: Wallet, stake: number): boolean =>
  stake >= MIN_STAKE && stake <= MAX_STAKE && stake <= wallet.balance;

export const placeBet = (
  wallet: Wallet,
  input: Omit<PlacedBet, 'id' | 'status' | 'payout'>,
): { wallet: Wallet; bet: PlacedBet } | { error: string } => {
  if (!canAfford(wallet, input.stake)) {
    return { error: `Stake must be ${MIN_STAKE}-${MAX_STAKE} and within your balance.` };
  }
  const bet: PlacedBet = { ...input, id: betId(), status: 'open', payout: 0 };
  return {
    wallet: { balance: wallet.balance - bet.stake, bets: [bet, ...wallet.bets] },
    bet,
  };
};

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

export interface SettlementContext {
  games: Game[];
  teams: Team[];
  currentDate: string;
  seasonComplete: boolean;
  /** Final division and league winners once a season is archived. */
  seasonWinners: {
    seasonYear: number;
    divisions: Map<string, string>;
    leagues: Map<string, string>;
  } | null;
  /** Final award winners, keyed by award name. */
  awardWinners: Map<string, string> | null;
}

const gameFinal = (game: Game | undefined): Game | null =>
  game && game.status === 'completed' ? game : null;

const resultFor = (
  bet: PlacedBet,
  context: SettlementContext,
): { won: boolean; voided: boolean } => {
  if (bet.kind === 'moneyline') {
    const game = gameFinal(context.games.find((g) => g.gameId === bet.marketKey));
    if (!game) return { won: false, voided: true };
    const awayWon = game.score.away > game.score.home;
    const pickedAway = bet.selection === 'away';
    return { won: awayWon === pickedAway, voided: false };
  }

  if (bet.kind === 'total' || bet.kind === 'first5') {
    const game = context.games.find((g) => g.gameId === bet.marketKey);
    const final = gameFinal(game);
    if (!final) return { won: false, voided: true };

    let actual: number;
    if (bet.kind === 'total') {
      actual = final.score.away + final.score.home;
    } else {
      const raw = final.stats?.lineScore;
      if (typeof raw !== 'string' || raw.length === 0) return { won: false, voided: true };
      try {
        const parsed = JSON.parse(raw) as Array<{ inning: number; away: number; home: number }>;
        actual = parsed.filter((line) => line.inning <= 5).reduce((sum, l) => sum + l.away + l.home, 0);
      } catch {
        return { won: false, voided: true };
      }
    }

    const line = Number(bet.note ?? NaN);
    if (!Number.isFinite(line)) return { won: false, voided: true };
    const over = actual > line;
    return { won: over === (bet.selection === 'over'), voided: false };
  }

  // Season-long markets only resolve once a season is archived.
  if (!context.seasonComplete || !context.seasonWinners) return { won: false, voided: true };
  if (bet.placedOn >= `${context.seasonWinners.seasonYear}-12-31`) return { won: false, voided: true };

  if (bet.kind === 'division') {
    const winner = context.seasonWinners.divisions.get(bet.marketKey);
    return { won: Boolean(winner) && winner === bet.selection, voided: false };
  }
  if (bet.kind === 'league') {
    const winner = context.seasonWinners.leagues.get(bet.marketKey);
    return { won: Boolean(winner) && winner === bet.selection, voided: false };
  }
  if (bet.kind === 'award') {
    const winner = context.awardWinners?.get(bet.marketKey);
    return { won: Boolean(winner) && winner === bet.selection, voided: false };
  }
  return { won: false, voided: true };
};

/**
 * Settle everything that can now be settled.
 *
 * Open bets that cannot yet be decided are left alone. Voided bets return their
 * stake, which is what a book does when a game is postponed.
 */
export const settleWallet = (wallet: Wallet, context: SettlementContext): Wallet => {
  let balance = wallet.balance;
  const bets = wallet.bets.map((bet) => {
    if (bet.status !== 'open') return bet;
    const { won, voided } = resultFor(bet, context);
    if (voided) {
      balance += bet.stake;
      return { ...bet, status: 'void' as BetStatus };
    }
    if (!won) return { ...bet, status: 'lost' as BetStatus };
    const payout = settleReturn(bet.stake, bet.price, true);
    balance += payout;
    return { ...bet, status: 'won' as BetStatus, payout };
  });
  return { balance, bets };
};

export const summariseWallet = (wallet: Wallet) => {
  const settled = wallet.bets.filter((bet) => bet.status !== 'open');
  const won = settled.filter((bet) => bet.status === 'won');
  const staked = settled.reduce((sum, bet) => sum + bet.stake, 0);
  const returned = settled.reduce((sum, bet) => sum + (bet.status === 'won' ? bet.payout : bet.status === 'void' ? bet.stake : 0), 0);
  return {
    open: wallet.bets.filter((bet) => bet.status === 'open').length,
    settled: settled.length,
    wins: won.length,
    profit: returned - staked,
    net: wallet.balance + staked - STARTING_BALANCE,
  };
};

export const describeBet = (bet: PlacedBet): string =>
  `${bet.selectionLabel} ${formatAmerican(bet.price)} on ${bet.marketTitle}`;

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * localStorage only, deliberately.
 *
 * The rest of the league state round-trips through Supabase, and wiring the
 * wallet into that pipeline means touching the sync code this phase was scoped
 * away from. So the wallet is local-browser state: it survives a refresh and it
 * survives closing the tab, but it does not follow the user to another machine
 * and it is not in the same save file as the season. That is a real limitation,
 * not a design choice, and it is the obvious next thing to fix.
 */
const WALLET_KEY = 'gpb_betting_wallet_v1';

const isWallet = (value: unknown): value is Wallet => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Wallet>;
  return typeof candidate.balance === 'number' && Array.isArray(candidate.bets);
};

export const loadWallet = (): Wallet => {
  if (typeof localStorage === 'undefined') return createWallet();
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    if (!raw) return createWallet();
    const parsed: unknown = JSON.parse(raw);
    if (!isWallet(parsed)) return createWallet();
    // Anything already decided is stored as decided, and only open bets are
    // re-examined on load, so a tampered or stale balance cannot mint money by
    // replaying settled bets.
    return { balance: parsed.balance, bets: parsed.bets };
  } catch {
    return createWallet();
  }
};

export const saveWallet = (wallet: Wallet): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  } catch {
    // A full or blocked localStorage should not take the page down. The wallet
    // simply becomes session-only.
  }
};

export const resetWallet = (): Wallet => {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(WALLET_KEY); } catch { /* nothing to do */ }
  }
  return createWallet();
};
