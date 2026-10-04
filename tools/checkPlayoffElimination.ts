/**
 * Postseason elimination, and the award closure that lands with it.
 *
 * ============================================================================
 * WHY THIS SUITE EXISTS AT ALL
 * ============================================================================
 *
 * Because a green suite elsewhere did not catch any of the three bugs this covers. All three were
 * found by a person looking at the running product:
 *
 *   1. A club already knocked out in the first round was still being offered prices on its LEAGUE
 *      board, throughout the league championship series.
 *   2. The championship board was answering a regular-season question with a postseason one.
 *   3. The MVP races stayed sellable for five weeks of playoffs after the numbers that decide them
 *      had stopped moving.
 *
 * And the first two shared a cause that no fixture covered: `leagueSeriesLosers` tallied series wins
 * by home/away side. A best-of-seven alternates venues, so a genuine 4-2 read 2-2, a 2-0 read 1-1,
 * and "level on wins" means undecided -- so it returned an EMPTY set for essentially every real
 * series. `eliminatedFromLeague` was empty in practice, and an empty set cannot eliminate anyone.
 *
 * The same venue bug had already been found and fixed once, in `lockedRaces`, during the
 * exploit-closure work. It was found again here, in the second copy. That is the argument for this
 * file asserting the tally ONCE, through every reader of it, rather than trusting each caller.
 *
 * ============================================================================
 * FIXTURES ARE PRODUCTION-SPELLED
 * ============================================================================
 *
 * 'Platinum', 'North', and results tallied by club with venues that actually alternate. A fixture
 * where every game has the same team at home cannot distinguish a correct tally from the broken one,
 * which is precisely why the broken version survived.
 *
 * Run: npx tsx tools/checkPlayoffElimination.ts
 */
import {
  playoffEliminations, leagueSeriesLosers, remainingRegularSeasonGames, titleContenders,
  type LockedRaceGame,
} from '../src/lib/futuresRisk';
import {
  buildDivisionMarkets, buildLeagueMarkets, buildWorldSeriesMarkets, buildAwardMarket,
  type FuturesInput,
} from '../src/lib/mediaMarkets';
import { buildAwardsForBoard, type AwardInputs } from '../src/lib/awardRace';
import { MEDIA_PROFILES } from '../src/data/media';
import { uniformByMedia } from './mediaFixtures';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PlayoffLeague, PlayoffRoundKey, Team } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/* ------------------------------------------------------------------ *
 * FIXTURES
 * ------------------------------------------------------------------ */

const club = (id: string, league: Team['league'], division: Team['division'], wins: number): Team =>
  ({
    id, league, division, wins,
    city: id.charAt(0).toUpperCase() + id.slice(1), name: 'Club',
    losses: 0, runsScored: 0, runsAllowed: 0,
  } as unknown as Team);

/**
 * A completed series with the venues SWAPPING EVERY GAME, as a real one does.
 *
 * This is the fixture the original bug needed and did not have. `seriesWinFixedHome` below is the
 * same series with one club always at home -- and every assertion in this file that involves a tally
 * passes on that one too, which is exactly why the bug survived. Only the alternating form separates
 * a correct tally from the home/away one.
 */
const seriesGames = (
  winner: string, loser: string, wins: number, losses: number,
  round: PlayoffRoundKey, league: PlayoffLeague, id: string,
): LockedRaceGame[] => {
  const games: LockedRaceGame[] = [];
  for (let i = 0; i < wins + losses; i += 1) {
    const winnerIsHome = i % 2 === 0;
    const winnerWon = i < wins;
    games.push({
      homeTeam: winnerIsHome ? winner : loser,
      awayTeam: winnerIsHome ? loser : winner,
      status: 'completed',
      score: winnerIsHome
        ? { home: winnerWon ? 1 : 0, away: winnerWon ? 0 : 1 }
        : { home: winnerWon ? 0 : 1, away: winnerWon ? 1 : 0 },
      playoff: { round, league, seriesId: id },
    });
  }
  return games;
};

/** The same series with the winner at home throughout -- passes either way, and proves nothing. */
const seriesFixedHome = (
  winner: string, loser: string, wins: number,
  round: PlayoffRoundKey, league: PlayoffLeague, id: string,
): LockedRaceGame[] => Array.from({ length: wins }, () => ({
  homeTeam: winner, awayTeam: loser, status: 'completed',
  score: { home: 1, away: 0 },
  playoff: { round, league, seriesId: id },
}));

/**
 * Four divisions' worth of clubs.
 *
 * Platinum North's division winner is `brah`, and `brah` is the club that goes on to lose the
 * wild card. That single fact is the user's reported bug, so it is the centre of this fixture rather
 * than an incidental case.
 */
const TEAMS: Team[] = [
  club('brah', 'Platinum', 'North', 100),
  club('corvix', 'Platinum', 'North', 90),
  club('delph', 'Platinum', 'North', 88),
  club('eska', 'Platinum', 'North', 87),
  club('fen', 'Platinum', 'South', 80),
  club('gow', 'Platinum', 'South', 79),
  club('hal', 'Platinum', 'South', 78),
  club('ivo', 'Platinum', 'South', 77),
  club('juno', 'Prestige', 'North', 70),
  club('kelp', 'Prestige', 'North', 69),
  club('lorn', 'Prestige', 'South', 68),
  club('moss', 'Prestige', 'South', 67),
];

/** Regular season over: nobody has a game left. The postseason state. */
const NO_GAMES_LEFT = new Map(TEAMS.map((t) => [t.id, 0]));

/** Mid-season: three games each, so the standings arithmetic still bites. */
const THREE_LEFT = new Map(TEAMS.map((t) => [t.id, 3]));

const SCORE_BY = uniformByMedia(new Map(TEAMS.map((t, i) => [t.id, 92 - i * 4])));

const futuresInput = (over: Partial<FuturesInput> = {}): FuturesInput => ({
  teams: TEAMS,
  scoreBy: SCORE_BY,
  gamesRemainingByTeamId: THREE_LEFT,
  ...over,
});

/* ------------------------------------------------------------------ *
 * 1. THE TALLY, ON ALTERNATING VENUES
 * ------------------------------------------------------------------ */

console.log('\n1. SERIES ARE COUNTED BY CLUB, NOT BY HOME SIDE');

{
  const games = seriesGames('brah', 'corvix', 4, 2, 'league_series', 'Platinum', 'plat-1');
  const losers = leagueSeriesLosers(games);
  check('a 4-2 with alternating venues eliminates corvix', losers.has('corvix'),
    `got [${[...losers].join(', ')}] -- a home/away tally reads this 2-2 and eliminates nobody`);
  check('and NOT the winner', !losers.has('brah'));

  /*
   * The two-game sweep is a WILD CARD, not a league series.
   *
   * A best-of-seven needs four wins, so a 2-0 league series is simply two games played and correctly
   * eliminates nobody. Asking `leagueSeriesLosers` for a sweep was asking a best-of-seven to be a
   * best-of-three. The wild card is a best-of-three, so two wins there IS a shutout -- and it puts
   * the loser on zero wins, which is the case a 0-seeded "more wins than" comparison silently drops.
   */
  const sweep = playoffEliminations(seriesGames('brah', 'corvix', 2, 0, 'wild_card', 'Platinum', 'wc'));
  check('a two-game wild-card sweep eliminates the loser on ZERO wins', sweep.has('corvix'),
    `got [${[...sweep].join(', ')}] -- a 0-seeded comparison never records a shutout`);
  const twoOfSeven = leagueSeriesLosers(seriesGames('brah', 'corvix', 2, 0, 'league_series', 'Platinum', 'p'));
  check('while 2-0 in a best-of-SEVEN eliminates nobody, because it is undecided',
    twoOfSeven.size === 0, `got [${[...twoOfSeven].join(', ')}]`);

  const four = leagueSeriesLosers(seriesGames('brah', 'corvix', 4, 0, 'league_series', 'Platinum', 'p'));
  check('a 4-0 sweep likewise', four.has('corvix'), `got [${[...four].join(', ')}]`);

  const undecided = leagueSeriesLosers(seriesGames('brah', 'corvix', 3, 2, 'league_series', 'Platinum', 'p'));
  check('3-2 with a game in hand eliminates nobody', undecided.size === 0,
    `got [${[...undecided].join(', ')}] -- a decided race cannot be guessed`);

  const awayWon = leagueSeriesLosers(seriesGames('corvix', 'brah', 4, 1, 'league_series', 'Platinum', 'p'));
  check('the away side can win, and the right club is eliminated', awayWon.has('brah'),
    `got [${[...awayWon].join(', ')}]`);

  // The fixture that cannot fail, asserted so the suite records WHY the others are needed.
  const fixed = leagueSeriesLosers(seriesFixedHome('brah', 'corvix', 4, 'league_series', 'Platinum', 'p'));
  check('(and the fixed-home fixture passes on the broken tally too -- which is why it is not enough)',
    fixed.has('corvix'));
}

console.log('\n2. EVERY ROUND ELIMINATES, NOT JUST THE CHAMPIONSHIP ROUNDS');

{
  const wc = playoffEliminations(seriesGames('brah', 'corvix', 2, 1, 'wild_card', 'Platinum', 'wc-1'));
  check('a decided WILD CARD eliminates its loser', wc.has('corvix'), `got [${[...wc].join(', ')}]`);

  const div = playoffEliminations(seriesGames('delph', 'eska', 3, 2, 'divisional', 'Platinum', 'd-1'));
  check('a decided DIVISIONAL series eliminates its loser', div.has('eska'), `got [${[...div].join(', ')}]`);

  const league = playoffEliminations(seriesGames('brah', 'fen', 4, 2, 'league_series', 'Platinum', 'l-1'));
  check('a decided LEAGUE series eliminates its loser', league.has('fen'), `got [${[...league].join(', ')}]`);

  const ws = playoffEliminations(seriesGames('brah', 'juno', 4, 3, 'world_series', 'GPB', 'ws-1'));
  check('a decided WORLD SERIES eliminates its loser', ws.has('juno'), `got [${[...ws].join(', ')}]`);

  const both = playoffEliminations([
    ...seriesGames('brah', 'corvix', 2, 1, 'wild_card', 'Platinum', 'wc-1'),
    ...seriesGames('delph', 'eska', 3, 2, 'divisional', 'Platinum', 'd-1'),
  ]);
  check('and both are reported together', both.has('corvix') && both.has('eska'),
    `got [${[...both].join(', ')}]`);

  const none = playoffEliminations([]);
  check('no playoff games means nobody is eliminated', none.size === 0,
    'which is what makes this safe before the postseason without a flag');
}

/* ------------------------------------------------------------------ *
 * 3. THE REPORTED BUG
 * ------------------------------------------------------------------ */

console.log('\n3. A CLUB ELIMINATED IN THE FIRST ROUND IS OFF ITS LEAGUE BOARD');

{
  // Platinum North's winner (brah, 100) loses the wild card to corvix.
  const playoff = playoffEliminations(seriesGames('corvix', 'brah', 2, 1, 'wild_card', 'Platinum', 'wc-1'));

  const standings = titleContenders({
    teams: TEAMS,
    gamesRemainingByTeamId: NO_GAMES_LEFT,
    knockedOut: new Set<string>(),
  });
  check('PRECONDITION: the standings arithmetic still calls brah a contender',
    standings.has('brah'),
    'it must -- this is the trap: the regular-season numbers never learn about the playoffs');
  check('PRECONDITION: brah is in fact eliminated', playoff.has('brah'));

  const withPostseason = titleContenders({
    teams: TEAMS,
    gamesRemainingByTeamId: NO_GAMES_LEFT,
    knockedOut: playoff,
  });
  check('and is gone once the postseason eliminations are applied', !withPostseason.has('brah'),
    'THIS is the bug the user reported');

  // The league board, built the way BettingPage builds it.
  const leagueMarket = buildLeagueMarkets(futuresInput({
    gamesRemainingByTeamId: NO_GAMES_LEFT,
    eliminatedFromLeague: playoff,
  })).find((m) => m.key === 'league:Platinum');
  const brahRow = leagueMarket?.outcomes.find((o) => o.key === 'brah');
  check('the league board marks the eliminated club', brahRow?.eliminated === true,
    `got ${JSON.stringify(brahRow?.eliminated)} -- it would still take money`);
  /*
   * corvix won that wild card, and it is STILL out of the league race -- on the standings, 90 wins
   * behind brah's 100, so it cannot win its division. Which is the point: the two filters are
   * independent and both apply. Asserting it with corvix would have asserted the wrong REASON.
   *
   * So the club that won a wild card AND is still in it is fen, the South division leader.
   */
  const fenWildCard = playoffEliminations([
    ...seriesGames('corvix', 'brah', 2, 1, 'wild_card', 'Platinum', 'wc-1'),
    ...seriesGames('fen', 'gow', 2, 0, 'wild_card', 'Platinum', 'wc-2'),
  ]);
  const withBoth = buildLeagueMarkets(futuresInput({
    gamesRemainingByTeamId: NO_GAMES_LEFT,
    eliminatedFromLeague: fenWildCard,
  })).find((m) => m.key === 'league:Platinum');
  check('a DIVISION WINNER that won its wild card stays on the league board',
    withBoth?.outcomes.find((o) => o.key === 'fen')?.eliminated !== true,
    'this is the mirror of the reported bug and the reason the fixture uses fen, not corvix');
  check('and a club eliminated only on the standings is still off it',
    withBoth?.outcomes.find((o) => o.key === 'delph')?.eliminated === true,
    'corvix and delph are out on arithmetic, not on a series -- both filters are live at once');

  // The championship board.
  const title = buildWorldSeriesMarkets(futuresInput({
    gamesRemainingByTeamId: NO_GAMES_LEFT,
    eliminatedFromPlayoff: playoff,
  }))[0];
  check('the championship board marks it too',
    title.outcomes.find((o) => o.key === 'brah')?.eliminated === true);
  check('and the live field shrank', title.liveOutcomes === withPostseason.size,
    `header said ${title.liveOutcomes}, contenders were ${withPostseason.size}`);
  /*
   * Three, not 31. The regular season is over, so the standings filter has collapsed the field to
   * the four division leaders, and brah is out of that on the wild card. An expectation of 31 came
   * from imagining a single 32-club division, which this league does not have -- four divisions of
   * four. Asserted as a number rather than "less than before" so a collapse to 1 would fail too.
   */
  check('the live field is the three division leaders that survive', title.liveOutcomes === 3,
    `got ${title.liveOutcomes} -- four division leaders, less brah`);
}

console.log('\n4. BUT A DIVISION WINNER IS STILL ITS DIVISION WINNER');

{
  /*
   * The asymmetry, and it is deliberate.
   *
   * brah lost the wild card, so it cannot be league champion and cannot be world champion. It won
   * its division in September, which nothing since has undone. Feeding postseason eliminations to
   * the division boards would grey out the club that actually won the thing that board sells, with
   * "can no longer win" -- false on the one market where it is true that they did.
   *
   * So this asserts the division board is UNTOUCHED by a wild-card loss, and the wiring assertion in
   * Â§7 asserts it is never even handed the set.
   */
  const playoff = playoffEliminations(seriesGames('corvix', 'brah', 2, 1, 'wild_card', 'Platinum', 'wc-1'));

  const division = buildDivisionMarkets(futuresInput({
    gamesRemainingByTeamId: NO_GAMES_LEFT,
    eliminatedFromLeague: new Set<string>(),
  })).find((m) => m.key === 'division:Platinum North');
  check('the division winner is NOT marked eliminated after losing the wild card',
    division?.outcomes.find((o) => o.key === 'brah')?.eliminated !== true,
    'it won the division; the wild card is a different race');

  check('and the set that would have caused it is never passed to the division builder',
    !/buildDivisionMarkets\(\{[^}]*eliminatedFromPlayoff/.test(read(join('src', 'components', 'betting', 'BettingPage.tsx'))),
    'the division call site must not name it at all');
}

/* ------------------------------------------------------------------ *
 * 5. BETWEEN ROUNDS, AND THE REGULAR SEASON UNTOUCHED
 * ------------------------------------------------------------------ */

console.log('\n5. BETWEEN ROUNDS, AND BEFORE ANY OF IT');

{
  // Wild card done, divisional not yet played: the four wild-card winners are still alive.
  /*
   * brah loses the wild card, fen wins one. Both are division leaders, so the standings filter keeps
   * them and only the series result separates them -- which is the only way this fixture can tell the
   * two filters apart.
   *
   * The first attempt used corvix and delph, neither of which is a division leader, so both were out
   * on arithmetic alone and the playoff set was doing nothing observable.
   */
  const playoff = playoffEliminations([
    ...seriesGames('corvix', 'brah', 2, 1, 'wild_card', 'Platinum', 'wc-1'),
    ...seriesGames('fen', 'gow', 2, 0, 'wild_card', 'Platinum', 'wc-2'),
  ]);
  const contenders = titleContenders({
    teams: TEAMS, gamesRemainingByTeamId: NO_GAMES_LEFT, knockedOut: playoff,
  });
  check('a division leader that WON its wild card is still in it', contenders.has('fen'),
    `got [${[...contenders].sort().join(', ')}]`);
  check('a division leader that LOST its wild card is out', !contenders.has('brah'));
  check('a club that never reached a series is out on the standings, not the bracket',
    !contenders.has('delph'), '88 wins behind brah\'s 100 -- arithmetic, not a series');
  // Four division leaders across two leagues, one eliminated: three survive, not one and not two.
  check('and exactly three of the four division leaders survive', contenders.size === 3,
    `got ${contenders.size}: [${[...contenders].sort().join(', ')}]`);

  // Before the postseason: the intersection is a no-op, so April is byte-identical to before.
  const before = titleContenders({
    teams: TEAMS, gamesRemainingByTeamId: THREE_LEFT, knockedOut: new Set<string>(),
  });
  const beforeWithEmptySet = titleContenders({
    teams: TEAMS, gamesRemainingByTeamId: THREE_LEFT, knockedOut: playoffEliminations([]),
  });
  check('with no playoff games the standings answer is unchanged',
    [...before].sort().join() === [...beforeWithEmptySet].sort().join(),
    'which is why this needed no "has the postseason started" flag');
  check('and mid-season the standings set still has real teeth', before.size > 1 && before.size < 12,
    `got ${before.size}`);
}

/* ------------------------------------------------------------------ *
 * 6. THE AWARD CLOSURE
 * ------------------------------------------------------------------ */

console.log('\n6. THE MVP RACES CLOSE AT THE END OF THE REGULAR SEASON');

{
  const stat = (over: Record<string, number>) =>
    ({ avg: 0.300, ops: 0.800, homeRuns: 20, rbi: 70, hits: 150, runsScored: 70, atBats: 500, ...over });
  const rating = (overall: number) => ({ overall });

  const inputs = (): AwardInputs => ({
    /*
     * 'Zeb Andrews' is FIRST here and sorts LAST by name.
     *
     * He exists only so the tie-break has something to prove. With Ana, Ben and Cam the alphabetical
     * order and the input order are the same, so any sort at all -- including none -- produces the
     * same winner, and the tie-break assertion could not fail for the reason it claimed.
     */
    players: [
      { playerId: 'p0', firstName: 'Zeb', lastName: 'Andrews', teamId: 'brah' },
      { playerId: 'p1', firstName: 'Ana', lastName: 'Reyes', teamId: 'brah' },
      { playerId: 'p2', firstName: 'Ben', lastName: 'Oyelaran', teamId: 'corvix' },
      { playerId: 'p3', firstName: 'Cam', lastName: 'Duarte', teamId: 'delph' },
    ] as never,
    teamsById: new Map(TEAMS.map((t) => [t.id, t])),
    battingStats: new Map([
      ['p0', stat({ avg: 0.341, ops: 0.910, homeRuns: 31, rbi: 118 })],
      ['p1', stat({ avg: 0.341, ops: 0.910, homeRuns: 31, rbi: 118 })],
      ['p2', stat({ avg: 0.298, ops: 0.820, homeRuns: 22, rbi: 84 })],
      ['p3', stat({ avg: 0.276, ops: 0.750, homeRuns: 19, rbi: 71 })],
    ] as never),
    battingRatings: new Map([
      ['p0', rating(88)], ['p1', rating(88)], ['p2', rating(80)], ['p3', rating(74)],
    ] as never),
    pitchingStats: new Map() as never,
    pitchingRatings: new Map() as never,
  });

  const entries = buildAwardsForBoard('batting', inputs(), 8);
  check('the board ranks a field', entries.length === 4, `got ${entries.length}`);
  check('and the tie at the top is resolved by name, not by roster order',
    entries[0]?.playerId === 'p1',
    `got ${entries[0]?.playerId} -- p0 leads the input and ties on every input, so only the name break separates them`);

  const open = buildAwardMarket('batting_mvp', 'Batting MVP', entries);
  check('with no regular-season signal the race is OPEN', open.locked === undefined,
    'and undefined-means-open, so a missing signal never freezes a live race');

  const closed = buildAwardMarket('batting_mvp', 'Batting MVP', entries, { decided: true });
  check('once the regular season is played out it is CLOSED', closed.locked !== undefined);
  check('for the right reason', closed.locked?.reason === 'voting_open');
  check('naming the same player the board ranks first',
    closed.locked?.winnerKey === entries[0]?.playerId,
    `closure says ${closed.locked?.winnerKey}, ranking says ${entries[0]?.playerId}`);
  check('and it is a real outcome on that market',
    closed.outcomes.some((o) => o.key === closed.locked?.winnerKey));

  /*
   * THE ANTI-DRIFT ASSERTION.
   *
   * The board prices from `buildAwardsForBoard` and the archive settles from App's candidate
   * functions, which now both call it. Before this they were two hand-written copies of the same
   * formula that broke ties differently -- alphabetical by name in the archive, roster order on the
   * board -- so on an exact tie the board could name one MVP and settlement pay another, and a
   * correct bet would lose.
   *
   * Asserted two ways: that `take` above the field size works at all (it silently capped every
   * caller at eight before), and that a tie is broken by name rather than by input order.
   */
  /*
   * A field WIDER than the cap, because a four-player field cannot test an eight-player cap.
   *
   * This assertion passed against the broken build. The pre-slice took the top eight before
   * applying `take`, and with only four candidates in the fixture there was nothing to truncate,
   * so the check could not fail. Found by the injection run rather than by reading the code, which
   * is the only reason it was found at all.
   */
  const wideBase = inputs();
  const widePlayers = [...(wideBase.players as unknown as Array<Record<string, unknown>>)];
  const wideStats = new Map(wideBase.battingStats as Map<string, unknown>);
  const wideRatings = new Map(wideBase.battingRatings as Map<string, unknown>);
  for (let i = 0; i < 12; i += 1) {
    const id = 'x' + i;
    widePlayers.push({ playerId: id, firstName: 'Extra', lastName: 'Player' + i, teamId: 'delph' });
    wideStats.set(id, stat({ avg: 0.200 + i * 0.01, ops: 0.600, homeRuns: 4, rbi: 20 }));
    wideRatings.set(id, rating(60));
  }
  const wide = {
    ...wideBase,
    players: widePlayers as never,
    battingStats: wideStats as never,
    battingRatings: wideRatings as never,
  };
  check('a wide field ranks every candidate', buildAwardsForBoard('batting', wide, 20).length === 16,
    'twelve extras on top of the four originals');
  check('`take` is honoured above the default field size',
    buildAwardsForBoard('batting', wide, 10).length === 10,
    'the pre-slice meant a caller asking for ten silently got eight, which is what the archive asks for');
  check('and the cap still applies below it',
    buildAwardsForBoard('batting', wide, 8).length === 8);

  /*
   * Cam is tied with Ana, deliberately.
   *
   * Three things had to be equalised and the first two attempts missed two of them. The STATS are
   * only one of the three inputs that differ between two players: `rating.overall * 0.45` and the
   * team's win percentage are the other two, so equalising stats alone left the comparison decided
   * outright and there was no tie to break.
   *
   * And it has to be Ana and CAM rather than Ana and Ben, because alphabetical order agrees with
   * input order for Ana/Ben -- so that tie would pass on the old broken sort too, and assert nothing.
   * Cam sorts before Ana, so a name tie-break reverses the order and the check has teeth.
   */
  /*
   * p0 and p1 are already level by construction -- same stats, same club, same rating -- so this needs
   * no mutation and cannot drift when the fixture above is edited.
   */
  const tied = buildAwardsForBoard('batting', inputs(), 8);
  check('PRECONDITION: the top two are genuinely level', tied[0]?.total === tied[1]?.total,
    `totals ${tied[0]?.total} and ${tied[1]?.total} -- without this there is no tie to break`);
  check('and the tie is broken by NAME rather than by input order',
    tied[0]?.playerId === 'p1',
    `got ${tied[0]?.playerId} -- p0 (Zeb Andrews) LEADS the input and ties on every term, so an input-order sort would return him`);
  check('and the tie-break is stable across repeated calls',
    buildAwardsForBoard('batting', inputs(), 8).map((e) => e.playerId).join()
    === buildAwardsForBoard('batting', inputs(), 8).map((e) => e.playerId).join());

  check('an empty award field closes to nothing rather than to an empty winner key',
    buildAwardMarket('batting_mvp', 'Batting MVP', [], { decided: true }).locked === undefined,
    'an empty-string winnerKey matches no outcome and would settle nothing');

  /*
   * The price book on a CLOSED market.
   *
   * `locked` says the schedule has decided the race; it says nothing about what the forecasters
   * believe. A decided club keeps its probability and its price, because overwriting a forecast with a
   * fact would be inventing a forecast to match arithmetic. So all nine must still be posted.
   */
  const leader = closed.outcomes.find((o) => o.key === closed.locked?.winnerKey);
  // Typed from the outcome rather than defaulted bare, so the index below is checked and not `any`.
  const leaderOdds: Record<string, number> = leader?.odds ?? {};
  const unpriced = MEDIA_PROFILES.map((profile) => profile.id).filter((id) => typeof leaderOdds[id] !== 'number');
  check('the closed award market still names a winner outcome', leader !== undefined);
  check('and every forecaster still posts a price on it', unpriced.length === 0,
    'missing: ' + (unpriced.join(', ') || 'none'));
  check('including Sharply, whose fitted overconfidence is load-bearing',
    typeof leaderOdds.sharply === 'number',
    'the 3x on the moneylines is part of his character, not just a number');
}

console.log('\n7. THE WIRING, WHICH IS WHERE ALL THREE ACTUALLY LIVE');

{
  const page = read(join('src', 'components', 'betting', 'BettingPage.tsx'));
  const app = read(join('src', 'App.tsx'));
  const markets = read(join('src', 'lib', 'mediaMarkets.ts'));

  check('BettingPage computes the postseason eliminations',
    /playoffEliminations\(games\)/.test(page));
  check('and passes them to the league board',
    /buildLeagueMarkets\(\{[^}]*eliminatedFromPlayoff/.test(page));
  check('and to the championship board',
    /buildWorldSeriesMarkets\(\{[^}]*eliminatedFromPlayoff/s.test(page));
  check('but NOT to the division board',
    !/buildDivisionMarkets\(\{[^}]*eliminatedFromPlayoff/.test(page),
    'a wild-card loser is still its division champion');
  check('the league builder prefers the postseason set',
    /kind === 'league'[\s\S]{0,200}eliminatedFromPlayoff/.test(markets),
    'the two grouped kinds ask different questions and must not share one answer');
  check('the award closure no longer reads seasonComplete',
    /decided: regularSeasonOver/.test(page) && !/decided: input\.seasonComplete/.test(page),
    'seasonComplete is five weeks late for a regular-season award');
  check('regularSeasonOver is derived from the standings map, not a new count',
    /gamesRemainingByTeamId\.size > 0[\s\S]{0,120}every\(\(left\) => left <= 0\)/.test(page),
    'one signal for "the season is over", so two tabs cannot disagree');
  check('and it is guarded on a non-empty map',
    /gamesRemainingByTeamId\.size > 0/.test(page),
    '[].every() is true, so an unknown schedule would read as a finished season');

  check('App ranks the batting MVP by DELEGATING, not by re-deriving',
    /buildAwardsForBoard\(\s*'batting'/.test(app) && !/stat\.avg \* 700/.test(app),
    'two copies of a scoring function is two chances for the board and the archive to disagree');
  check('and the pitching MVP likewise',
    /buildAwardsForBoard\(\s*'pitching'/.test(app) && !/stat\.era\)\.toFixed/.test(app));
  check('the weights now live in exactly one file',
    (read(join('src', 'App.tsx')).match(/= 700|260 \*/g) ?? []).length === 0);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
