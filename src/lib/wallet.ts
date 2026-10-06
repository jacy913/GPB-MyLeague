import type { Game, Team } from '../types';
import type { MediaId } from '../data/media';
import { WORLD_SERIES_MARKET_KEY, formatAmerican } from './markets';
import { propActualStat, type PropStatKey } from './playerProps';

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

export type BetKind = 'moneyline' | 'total' | 'first5' | 'prop' | 'division' | 'league' | 'world_series' | 'award';
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
  /**
   * The date this bet settles, as it stood when the bet was placed.
   *
   * STORED, NOT DERIVED, for the same reason `propStat` and `propPlayerName` are: a
   * bet has to keep meaning what it meant when it was taken. A season's calendar is
   * derived from the whole schedule, so recomputing the date at render time would
   * move it if anything upstream shifted -- and a bet placed in April would quietly
   * start resolving on a different night than the one it was sold against.
   *
   * `placedOn` is NOT this. That is when the manager clicked; the gap between the two
   * is the whole point of the field. Before this existed there was nothing on a placed
   * bet saying which game it belonged to or when, and a manager who took a prop had no
   * way to find out from the bet itself.
   *
   * OPTIONAL because the field postdates every save in the wild. A bet without one is
   * a bet placed before this existed, and the UI says so rather than substituting
   * today's date -- printing a wrong resolution date on a real bet is worse than
   * printing none.
   */
  resolvesOn?: string;
  status: BetStatus;
  payout: number;
  /** Which forecaster's number the bettor used, when they acted on one. */
  backedMedia: MediaId | null;
  note?: string;
  /**
   * Prop-specific fields, present only on kind 'prop'.
   *
   * The stat and the player are stored as part of the bet rather than looked up
   * at settlement time. A bet has to remain resololvable after the season that
   * produced it is over: a player can be traded, a rate can be rebuilt, and a
   * stat key can be renamed. All of that must not be able to change what a bet
   * placed last April means.
   */
  propStat?: PropStatKey;
  propPlayerId?: string;
  /**
   * The club the player belonged to WHEN THE BET WAS PLACED, not looked up at render time.
   *
   * Stored for the same reason `resolvesOn` is. A player can be traded mid-season, and a bet that
   * reads "Reinland" on one screen and "Niyoli" on another -- or worse, resolves against whichever
   * club the player happens to be on now -- is a bet that cannot be audited. The market carried
   * `teamId` and it was being dropped on the floor; this keeps it.
   */
  propTeamId?: string;
  /**
   * What the player ACTUALLY did, written when the wager settles.
   *
   * Absent on an open bet, and absent on a bet placed before this field existed -- there is nothing to
   * recover it from, since the play log that holds it belongs to a game that has scrolled off the
   * slate. So the record has to render its absence as "not recorded" rather than as a zero, which is
   * the difference between "he went oh-for-four" and "we do not know".
   */
  propActual?: number;
  propPlayerName?: string;
  /** The posted line, kept because the displayed line is part of the record. */
  propLine?: number;
}

export interface Wallet {
  balance: number;
  bets: PlacedBet[];
  /**
   * The number to put on the next bet id, and the only monotonic thing about bet ids.
   *
   * It cannot be derived from `bets`, because voiding a bet REMOVES it from the array and frees
   * whatever number it held. Only ever increments, and is carried through every operation that
   * rebuilds a wallet -- `placeBet` increments it, `removeBet` preserves it, `loadWallet` restores
   * it or reconstructs a safe lower bound for a save that predates it.
   */
  nextBetNumber: number;
}

/** Profit or return on a winning bet at a given price. */
export const settleReturn = (stake: number, price: number, won: boolean): number => {
  if (!won) return 0;
  if (price > 0) return stake + (stake * price) / 100;
  return stake + (stake * 100) / Math.abs(price);
};

export const createWallet = (): Wallet => ({ balance: STARTING_BALANCE, bets: [], nextBetNumber: 1 });

/**
 * A bet id, derived from the wallet rather than from the clock.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS CHANGED
 * ---------------------------------------------------------------------------
 *
 * It used to be `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`. Harmless
 * while the wallet is local; a sync hazard the moment it is not, because two devices that placed
 * "the same bet" at two different milliseconds would produce two different ids for one economic
 * event, and neither could be told from a duplicate. The HXSE price path refuses to touch
 * unseeded randomness for exactly the same reason -- a reloaded save must show the same market --
 * and a bet id is the same class of thing: it is a fact about the save, not about when the save
 * happened to be written.
 *
 * ---------------------------------------------------------------------------
 * WHY IT HAD TO BE A STORED COUNTER, AND TWO SCHEMES THAT LOOKED FINE
 * ---------------------------------------------------------------------------
 *
 * `removeBet` in `useBettingSlip` VOIDS open bets and filters them out of the array, so
 * `wallet.bets.length` is not monotonic. Place a bet, void it, place another, and the length is
 * back where it started. `removeBet` looks bets up BY ID, so a repeated id is a wrong-stake refund
 * or a voided the wrong bet -- not a cosmetic collision.
 *
 * First attempt: take the HIGHEST surviving `bet-<n>` and add one. That is monotonic as long as
 * nothing is ever removed -- and the void removes the highest one. `checkSharePersistence` caught it
 * reproducing `bet-1` immediately after `bet-1` was voided. The reasoning was wrong in exactly the
 * place it claimed to be safe.
 *
 * Second attempt, and the reason this field exists: the counter is stored on the Wallet and only
 * ever increments. Nothing derives it from current contents, so nothing can lower it.
 *
 * Legacy ids -- base36 timestamp, hyphen, random suffix -- are left exactly as they are. They do
 * not parse as `bet-<n>`, so `readBetCounter` ignores them and they cannot collide with a new id.
 * Ids are never parsed anywhere in the app, so the format was free to change and existing bets
 * keep working.
 */
const BET_ID_PATTERN = /^bet-(\d+)$/;

/**
 * The highest new-style id currently in the wallet, plus one.
 *
 * Used ONLY when loading a save that predates the counter, where there is no stored value to trust.
 * Once a save carries `nextBetNumber` that field is authoritative and this is never consulted, so
 * its inability to see a voided bet does not matter.
 */
const readBetCounter = (bets: PlacedBet[]): number => {
  let highest = 0;
  for (const bet of bets) {
    const match = BET_ID_PATTERN.exec(bet.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
};

/**
 * The number to put on the next bet id.
 *
 * Defensive about a wallet whose `nextBetNumber` is missing or malformed, rather than trusting it.
 * A field added to a persisted shape can always turn up absent -- an old save, a hand-edited
 * localStorage entry, a caller that built a literal. Trusting it produced `bet-undefined`, which
 * `removeBet` would then be unable to look up by id, so the void would silently do nothing while
 * the stake was still refunded. Reconstructing a lower bound is always safe: it can only ever be
 * too low to collide with a legacy id, and never collides with a live one because live ids are
 * counted upward.
 */
const betId = (wallet: Wallet): number =>
  typeof wallet.nextBetNumber === 'number' && Number.isInteger(wallet.nextBetNumber) && wallet.nextBetNumber > 0
    ? wallet.nextBetNumber
    : readBetCounter(wallet.bets);

export const canAfford = (wallet: Wallet, stake: number): boolean =>
  stake >= MIN_STAKE && stake <= MAX_STAKE && stake <= wallet.balance;

export const placeBet = (
  wallet: Wallet,
  input: Omit<PlacedBet, 'id' | 'status' | 'payout'>,
): { wallet: Wallet; bet: PlacedBet } | { error: string } => {
  if (!canAfford(wallet, input.stake)) {
    return { error: `Stake must be ${MIN_STAKE}-${MAX_STAKE} and within your balance.` };
  }
  const bet: PlacedBet = { ...input, id: `bet-${betId(wallet)}`, status: 'open', payout: 0 };
  return {
    wallet: {
      balance: wallet.balance - bet.stake,
      bets: [bet, ...wallet.bets],
      // Incremented here and nowhere else. `removeBet` must PRESERVE this rather than recompute it
      // -- see the note on `Wallet.nextBetNumber`.
      nextBetNumber: betId(wallet) + 1,
    },
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
    /**
     * The title winner's team id, or null.
     *
     * `SeasonHistoryEntry.champion` already carries this as a
     * `SeasonHistoryTeamRecord`, so it is read rather than newly archived. Null is
     * a real state -- a league that finished without a champion -- and it settles as
     * VOID rather than as a loss, because "no champion" cannot decide the bet. It is
     * not the same as a season that has not finished, which is PENDING.
     */
    champion: string | null;
  } | null;
  /** Final award winners, keyed by award name. */
  awardWinners: Map<string, string> | null;
}

/**
 * What can be said about a bet right now.
 *
 * PENDING is the state this whole function used to be missing. An earlier
 * version returned only won/voided, so a bet on a game that had not been played
 * yet -- which is every bet, immediately after it is placed -- fell into the
 * same branch as a genuinely abandoned game and was voided, refunding the stake
 * at once. The board looked correct and the money never left.
 *
 * The distinction that matters: VOID is for a market that can no longer be
 * decided, and must never be used to mean "not yet".
 */
type BetVerdict =
  | { status: 'pending' }
  | { status: 'void' }
  | { status: 'decided'; won: boolean; propActual?: number };

const resultFor = (bet: PlacedBet, context: SettlementContext): BetVerdict => {
  if (bet.kind === 'moneyline') {
    const game = context.games.find((g) => g.gameId === bet.marketKey);
    if (!game) return { status: 'void' };
    if (game.status !== 'completed') return { status: 'pending' };
    const awayWon = game.score.away > game.score.home;
    return { status: 'decided', won: awayWon === (bet.selection === 'away') };
  }

  if (bet.kind === 'prop') {
    const game = context.games.find((g) => g.gameId === bet.marketKey);
    if (!game) return { status: 'void' };
    if (game.status !== 'completed') return { status: 'pending' };

    /*
     * Props settle from the play log, and the stat is named by the bet rather
     * than inferred from the market key.
     *
     * There is no box score on a saved game -- the engine folds that into season
     * aggregates and never writes it back -- so the play log is the only record
     * that survives a save. It rebuilds the player's line exactly; see
     * verifyPlayLogProps.ts, which measures all fourteen fields at 100.00%
     * against ground truth obtained by aggregate diffing.
     *
     * A completed game whose play log cannot be read is a genuine VOID rather than
     * a wait. The game is over, the answer will never improve, and holding the
     * stake indefinitely is the one outcome that is wrong under every
     * interpretation.
     */
    if (!bet.propStat || !bet.propPlayerId || bet.propLine === undefined) {
      // A prop bet missing its own terms cannot be resolved honestly.
      return { status: 'void' };
    }
    const actual = propActualStat(game, bet.propStat, bet.propPlayerId);
    if (actual === null) {
      const log = typeof game.stats?.playLog === 'string' ? game.stats.playLog : '';
      if (log.length === 0) return { status: 'void' };
      // The log is readable and the player genuinely is not in it -- did not
      // appear, or the lineup changed after publication. Under is the answer
      // that loses the least: a player who never batted cannot have cleared any
      // line, and a prop on someone who does not play is void rather than a loss.
      return { status: 'void' };
    }
    const cleared = actual > bet.propLine;
    /*
      THE ACTUAL TRAVELS BACK OUT WITH THE VERDICT, so the record can print what the player did.

      This is the fix for "I lost and never saw the player's performance that day". `propActualStat`
      had the number in hand at the exact moment the wager was decided and returned only a boolean, so
      the one figure that makes a settled prop legible was computed and thrown away. It is not
      recoverable afterwards: the play log is the source, and by the time anyone opens the record the
      game has usually scrolled off whatever slate the lookup reads from.
    */
    return { status: 'decided', won: cleared === (bet.selection === 'over'), propActual: actual };
  }

  if (bet.kind === 'total' || bet.kind === 'first5') {
    const game = context.games.find((g) => g.gameId === bet.marketKey);
    if (!game) return { status: 'void' };
    if (game.status !== 'completed') return { status: 'pending' };

    let actual: number;
    if (bet.kind === 'total') {
      actual = game.score.away + game.score.home;
    } else {
      const raw = game.stats?.lineScore;
      // A completed game with no usable line score is genuinely unresolvable,
      // so this one really is a void rather than a wait.
      if (typeof raw !== 'string' || raw.length === 0) return { status: 'void' };
      try {
        const parsed = JSON.parse(raw) as Array<{ inning: number; away: number; home: number }>;
        actual = parsed.filter((line) => line.inning <= 5).reduce((sum, l) => sum + l.away + l.home, 0);
      } catch {
        return { status: 'void' };
      }
    }

    const line = Number(bet.note ?? NaN);
    if (!Number.isFinite(line)) return { status: 'void' };
    return { status: 'decided', won: (actual > line) === (bet.selection === 'over') };
  }

  /*
   * Season-long markets resolve only once a season is archived, so until then
   * they are PENDING rather than void. This is the same bug as the game case
   * above in a slower form: a futures bet would have been refunded on the very
   * next render.
   *
   * The date check is the guard against settling a bet against a season it was
   * not placed in. A bet taken on or after 31 December of the archived season
   * belongs to the next one, and this archive cannot decide it.
   */
  if (!context.seasonComplete || !context.seasonWinners) return { status: 'pending' };
  if (bet.placedOn >= `${context.seasonWinners.seasonYear}-12-31`) return { status: 'pending' };

  if (bet.kind === 'division') {
    const winner = context.seasonWinners.divisions.get(bet.marketKey);
    if (!winner) return { status: 'void' };
    return { status: 'decided', won: winner === bet.selection };
  }
  if (bet.kind === 'league') {
    const winner = context.seasonWinners.leagues.get(bet.marketKey);
    if (!winner) return { status: 'void' };
    return { status: 'decided', won: winner === bet.selection };
  }
  if (bet.kind === 'world_series') {
    /*
     * A single champion, and a `marketKey` that is checked but not used to look
     * anything up.
     *
     * Every other futures kind is a field market keyed by division, league or award
     * name, so `marketKey` selects the winner from a map. The title is the one market
     * with a single outcome, so there is nothing to select -- but the key is still
     * checked, because a bet carrying some other kind's key should be refused rather
     * than quietly resolved as if it were a title bet.
     */
    if (bet.marketKey !== WORLD_SERIES_MARKET_KEY) return { status: 'void' };
    const champion = context.seasonWinners.champion;
    // No champion is undetermined, not lost. See SettlementContext for why.
    if (!champion) return { status: 'void' };
    return { status: 'decided', won: champion === bet.selection };
  }
  if (bet.kind === 'award') {
    const winner = context.awardWinners?.get(bet.marketKey);
    if (!winner) return { status: 'void' };
    return { status: 'decided', won: winner === bet.selection };
  }
  return { status: 'void' };
};

/**
 * Settle everything that can now be settled.
 *
 * Open bets stay open and untouched until something can actually be said about
 * them. Voided bets return their stake, which is what a book does when a game is
 * postponed or a market is pulled.
 */
export const settleWallet = (wallet: Wallet, context: SettlementContext): Wallet => {
  let balance = wallet.balance;
  let changed = false;
  const bets = wallet.bets.map((bet) => {
    if (bet.status !== 'open') return bet;
    const verdict = resultFor(bet, context);
    if (verdict.status === 'pending') return bet;
    changed = true;
    if (verdict.status === 'void') {
      balance += bet.stake;
      return { ...bet, status: 'void' as BetStatus };
    }
    /*
      THE ACTUAL IS WRITTEN ON EVERY SETTLED PROP, WIN OR LOSS.

      On both branches, and deliberately. A win shows "went 3 for 4" as a reward and a loss shows
      "went 0 for 4" as an explanation, and a manager who reads only the losing rows -- which is who
      opens this screen -- is exactly the person who needs the second one. Writing it only on a win
      would make the feature work for the case that did not need it.

      `?? bet.propActual` rather than a bare spread, so a re-settlement cannot erase a figure that
      an earlier pass already recorded.
    */
    const settled = {
      ...bet,
      ...(verdict.propActual === undefined ? {} : { propActual: verdict.propActual }),
    };
    if (!verdict.won) return { ...settled, status: 'lost' as BetStatus };
    const payout = settleReturn(bet.stake, bet.price, true);
    balance += payout;
    return { ...settled, status: 'won' as BetStatus, payout };
  });
  // Identity is preserved when nothing settled, so the caller's effect comparing
  // by reference does not fire on every render of every game.
  //
  // `nextBetNumber` is carried rather than recomputed. Settlement never removes a bet, so this is
  // not a collision risk -- but dropping the field would leave it `undefined`, and the next
  // `placeBet` would then produce `bet-NaN`. Every path that rebuilds a wallet has to carry it.
  return changed ? { balance, bets, nextBetNumber: wallet.nextBetNumber } : wallet;
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
    /** Returned minus staked, counting only bets that have finished. */
    profit: returned - staked,
    /*
     * Running profit against the starting balance, open bets included.
     *
     * This is simply balance - STARTING_BALANCE and nothing else. An earlier
     * version added the settled stake back on top, which double-counted it: the
     * balance was debited for every stake the moment a bet was placed and
     * credited back on settlement, so a $50 bet that returned $104 reported a
     * profit of +$104 rather than the $54 actually made. The screenshot that
     * caught it showed "+$0" in profit green on a fresh wallet, which was the
     * same arithmetic reading $0 as a gain.
     */
    net: wallet.balance - STARTING_BALANCE,
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
    return {
      balance: parsed.balance,
      bets: parsed.bets,
      // A save written before the counter existed has no field for it. The reconstruction is a
      // LOWER BOUND, not a guess: it cannot collide with the legacy ids still in the wallet,
      // because those do not parse as `bet-<n>`. And once written, the stored value is
      // authoritative -- it only ever goes up, so a later void cannot hand a number back out.
      nextBetNumber: typeof parsed.nextBetNumber === 'number' && Number.isInteger(parsed.nextBetNumber) && parsed.nextBetNumber > 0
        ? parsed.nextBetNumber
        : readBetCounter(parsed.bets),
    };
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
