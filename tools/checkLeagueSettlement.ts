/**
 * Does a league bet pay the club that WON the league championship series?
 *
 * ============================================================================
 * THE BUG THIS IS WRITTEN AGAINST
 * ============================================================================
 *
 * Settlement derived the league champion from the standings:
 *
 *     leagues: new Map(latest.divisionWinners.map((w) => [w.league, w.teamId]))
 *
 * `divisionWinners` has one entry per DIVISION, and there are two divisions per league, so that
 * writes the key `Platinum` twice. A Map keeps the last write. The archived "league champion" was
 * therefore whichever division leader came last in `DIVISION_ORDER` -- not a seed, not the better
 * record, and not anything the playoffs decided.
 *
 * The user bet Platinum and Prestige. Both paid out to a club that had won nothing, because the
 * answer came from an array ordering rather than from played games.
 *
 * ============================================================================
 * WHY THIS CHECKS THE CONTEXT BUILDER AND NOT `settleWallet`
 * ============================================================================
 *
 * `settleWallet` was never wrong. It looks up whatever champion it is handed and compares it to the
 * bet's selection. The bug was entirely in what it was handed, which lived inside a React hook where
 * nothing could call it.
 *
 * So the context builder was extracted to `src/lib/settlementContext.ts` and THAT is what is
 * asserted here. A test of `settleWallet` with a hand-written champion would pass while the bug was
 * live, which is the shape of test that gives false comfort.
 *
 * ============================================================================
 * WHY THE FIXTURE IS BUILT TO MAKE THE OLD ANSWER WRONG
 * ============================================================================
 *
 * The old derivation returns the LAST division winner. This archive deliberately puts a club that
 * lost its league series in that position, so the old code and the new code disagree about who won.
 * A fixture where both agree would not have caught the bug.
 *
 * Run: npx tsx tools/checkLeagueSettlement.ts
 */
import { buildSettlementContext } from '../src/lib/settlementContext';
import { settleWallet, createWallet, type PlacedBet, type Wallet } from '../src/lib/wallet';
import type { SeasonHistoryEntry, Game, Team } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const team = (id: string, league: Team['league'], division: Team['division'], wins: number): Team =>
  ({ id, league, division, wins, losses: 0, runsScored: 0, runsAllowed: 0 } as unknown as Team);

/*
 * THE FIXTURE FIELD.
 *
 * Platinum: Bram beat Corvix in the league series and is the champion. Delph leads South and is the
 * LAST division winner for Platinum in `divisionWinners` order -- which is exactly the slot the old
 * derivation read from. So the old code names Delph, and the new code names Bram.
 *
 * South's own race is genuinely won by Delph, so the two clubs are not interchangeable: Delph has a
 * division title and no league title, Bram has a league title.
 */
const TEAMS: Team[] = [
  team('brah', 'Platinum', 'North', 100),
  team('corvix', 'Platinum', 'North', 90),
  team('delph', 'Platinum', 'South', 99),
  team('eska', 'Platinum', 'South', 80),
];

const DIVISION_WINNERS = [
  { teamId: 'brah', teamCity: 'Brah', teamName: 'Club', wins: 100, losses: 0, league: 'Platinum' as const, division: 'North' as const },
  // Deliberately last: this is the row the old derivation overwrote Platinum with.
  { teamId: 'delph', teamCity: 'Delph', teamName: 'Club', wins: 99, losses: 0, league: 'Platinum' as const, division: 'South' as const },
];

const archive = (overrides: Partial<SeasonHistoryEntry> = {}): SeasonHistoryEntry => ({
  seasonYear: 2026,
  completedAt: '2026-11-01T00:00:00.000Z',
  // No league or division: SeasonHistoryTeamRecord carries neither, and the champion is keyed by
  // team id alone. Putting them here was an invented shape, and tsc was right to refuse it.
  champion: { teamId: 'brah', teamCity: 'Brah', teamName: 'Club', wins: 104, losses: 58 },
  divisionWinners: DIVISION_WINNERS,
  leagueWinners: [
    { teamId: 'brah', teamCity: 'Brah', teamName: 'Club', wins: 100, losses: 0, league: 'Platinum' },
  ],
  battingMvp: null,
  pitchingMvp: null,
  worldSeriesMvp: null,
  ...overrides,
});

const contextFor = (entry: SeasonHistoryEntry) =>
  buildSettlementContext({ games: [] as Game[], teams: TEAMS, currentDate: '2026-11-01', seasonHistory: [entry] });

/** A wallet holding one open league bet on `selection`, priced at even money. */
const OPENING_BALANCE = 1000;
const walletBet = (selection: string): Wallet => {
  const base = { ...createWallet(), balance: OPENING_BALANCE };
  const bet: PlacedBet = {
    id: 'bet-1',
    kind: 'league',
    marketKey: 'Platinum',
    marketTitle: 'Platinum League',
    selection,
    selectionLabel: selection,
    price: 100,
    stake: 100,
    placedOn: '2026-05-01',
    status: 'open',
    payout: 0,
    backedMedia: null,
  };
  return { ...base, balance: base.balance - 100, bets: [bet] };
};

console.log('\nTHE CONTEXT BUILDER NAMES THE SERIES WINNER');
{
  const context = contextFor(archive());
  check('Platinum resolves to Bram, who won the series', context.seasonWinners?.leagues.get('Platinum') === 'brah',
    `got ${context.seasonWinners?.leagues.get('Platinum')}`);
  check(
    'and NOT to Delph, which is what the standings derivation returned',
    context.seasonWinners?.leagues.get('Platinum') !== 'delph',
    'Delph led the South division but lost the league championship series',
  );
  check('the divisions map is still keyed per division',
    context.seasonWinners?.divisions.get('Platinum South') === 'delph',
    'a division winner IS the division leader, so this derivation was never the problem');
  check('the champion still comes from the archive', context.seasonWinners?.champion === 'brah');
  check('an absent MVP is omitted rather than defaulted',
    !context.awardWinners?.has('batting_mvp'),
    'defaulting would settle an award bet against an empty string');
}

console.log('\nA LEAGUE BET PAYS THE RIGHT CLUB');
{
  /*
   * Statuses are 'won' / 'lost' / 'void', and a refund arrives as BALANCE rather than as a payout.
   * An earlier version of these assertions assumed a 'decided' status with a boolean `won`, and a
   * void paying 100 -- both invented. The behaviour was right and the expectations were wrong, which
   * is the same lesson as the boundary fixture in checkLockedRaces: check the expectation first.
   */
  const winner = settleWallet(walletBet('brah'), contextFor(archive()));
  check('a bet on the series winner WINS', winner.bets[0]?.status === 'won',
    `got ${JSON.stringify(winner.bets[0])}`);
  check('and is paid', winner.bets[0]?.payout === 200, `got ${winner.bets[0]?.payout}`);
  check('and the balance carries the winnings', winner.balance === OPENING_BALANCE + 100, `got ${winner.balance}`);

  const loser = settleWallet(walletBet('delph'), contextFor(archive()));
  check('a bet on the division leader who LOST the series loses', loser.bets[0]?.status === 'lost',
    `got ${JSON.stringify(loser.bets[0])}`);
  check('and the stake is gone, which is the honest outcome', loser.bets[0]?.payout === 0);
  check('with nothing paid back', loser.balance === OPENING_BALANCE - 100, `got ${loser.balance}`);
}

console.log('\nAN UNFINISHED LEAGUE RACE VOIDS RATHER THAN PAYING');
{
  const noLeagueWinner = archive({ leagueWinners: [] });
  const settled = settleWallet(walletBet('delph'), contextFor(noLeagueWinner));
  check('with no league winner recorded, the bet is VOID', settled.bets[0]?.status === 'void',
    `got ${JSON.stringify(settled.bets[0])}`);
  check('and the stake comes back as balance, not as a payout', settled.balance === OPENING_BALANCE, `got ${settled.balance}`);
  check(
    'void rather than paid-to-the-arbitrary-division-leader',
    settled.bets[0]?.status === 'void',
    'losing real money to a Map ordering bug is the failure this avoids',
  );
}

console.log('\nAN ARCHIVE PREDATING leagueWinners REFUNDS INSTEAD OF GUESSING');
{
  /*
   * Seasons saved before this field existed have no `leagueWinners` at all. `?? []` turns that into
   * "no champion known", which settles void and refunds. The alternative -- falling back to the old
   * standings derivation -- would keep the bug alive for exactly the saves that cannot be repaired.
   */
  const legacy = { ...archive() } as SeasonHistoryEntry;
  delete legacy.leagueWinners;

  const settled = settleWallet(walletBet('delph'), contextFor(legacy));
  check('a legacy archive with no leagueWinners refunds', settled.bets[0]?.status === 'void',
    `got ${JSON.stringify(settled.bets[0])}`);
  check('and returns the stake', settled.balance === 1000, `got ${settled.balance}`);
  check('the context reports no champion rather than a wrong one',
    contextFor(legacy).seasonWinners?.leagues.size === 0,
    'an empty map is the honest answer; a populated one would be a guess');
}

console.log('\nDIVISION AND TITLE BEHAVIOUR IS UNCHANGED');
{
  const context = contextFor(archive());
  const divisionBet = settleWallet(
    {
      ...walletBet('brah'),
      bets: [{
        id: 'bet-1', kind: 'division', marketKey: 'Platinum North', marketTitle: 'Platinum North',
        selection: 'brah', selectionLabel: 'Brah', price: 100, stake: 100, placedOn: '2026-05-01',
        status: 'open', payout: 0, backedMedia: null,
      }],
    },
    context,
  );
  check('a division bet still pays the division leader', divisionBet.bets[0]?.status === 'won',
    `got ${JSON.stringify(divisionBet.bets[0])}`);

  const titleBet = settleWallet(
    {
      ...walletBet('brah'),
      bets: [{
        id: 'bet-1', kind: 'world_series', marketKey: 'world_series:champion', marketTitle: 'Champion',
        selection: 'brah', selectionLabel: 'Brah', price: 100, stake: 100, placedOn: '2026-05-01',
        status: 'open', payout: 0, backedMedia: null,
      }],
    },
    context,
  );
  check('a title bet still pays the archived champion', titleBet.bets[0]?.status === 'won',
    `got ${JSON.stringify(titleBet.bets[0])}`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
