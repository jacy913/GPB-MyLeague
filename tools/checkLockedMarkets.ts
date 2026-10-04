/**
 * Does a BUILT futures market carry its closure?
 *
 * `lockedRaces` is proved correct by `tools/checkLockedRaces.ts`. This proves the other half: that
 * the closure survives the trip from that function, through `BettingPage`, into the three builders,
 * and lands on the market the board actually renders -- under the market key the builder itself emits.
 *
 * That seam is where a correct function goes to die. A key that does not match, a builder that
 * forgets to pass `lockedRaces`, a memo with a stale dependency list: none of them fail a unit test
 * of `lockedRaces`, and all of them leave the exploit wide open with a green suite.
 *
 * League and division names are the production spellings -- `'Platinum'`, `'North'` -- so the keys
 * asserted here are the keys the app really produces, and a case difference anywhere in the chain
 * would fail rather than pass unnoticed.
 *
 * Run: npx tsx tools/checkLockedMarkets.ts
 */
import {
  buildDivisionMarkets, buildLeagueMarkets, buildWorldSeriesMarkets, type FuturesInput,
} from '../src/lib/mediaMarkets';
import { lockedRaces } from '../src/lib/futuresRisk';
import { WORLD_SERIES_MARKET_KEY } from '../src/lib/markets';
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

/**
 * Twelve clubs: two divisions per league, two leagues.
 *
 * Shaped like the real thing rather than two clubs, because a builder that partitions by group has to
 * survive a field with more than one partition in it, and a two-club fixture cannot tell a correct
 * key from a lucky one.
 */
const club = (id: string, league: Team['league'], division: Team['division'], wins: number): Team =>
  ({ id, league, division, wins, losses: 0, runsScored: 0, runsAllowed: 0 } as unknown as Team);

const TEAMS: Team[] = [
  // Platinum: North is decided, South is not.
  club('brah', 'Platinum', 'North', 100),
  club('corvix', 'Platinum', 'North', 90),
  club('delph', 'Platinum', 'North', 88),
  club('eska', 'Platinum', 'North', 87),
  club('fen', 'Platinum', 'South', 86),
  club('gow', 'Platinum', 'South', 85),
  club('hal', 'Platinum', 'South', 84),
  club('ivo', 'Platinum', 'South', 83),
  // Prestige, untouched.
  club('juno', 'Prestige', 'North', 50),
  club('kelp', 'Prestige', 'North', 49),
  club('lorn', 'Prestige', 'South', 48),
  club('moss', 'Prestige', 'South', 47),
];

const REMAINING = new Map(TEAMS.map((team) => [team.id, 3]));

/**
 * A read index per club, fanned across every forecaster.
 *
 * A `Map` rather than an array, because `uniformByMedia` copies ONE club-to-score lookup into a
 * per-forecaster record. Values are raw score units on the 0-100 band the board is priced on, spread
 * enough that the field has a genuine favourite rather than a flat distribution.
 */
const SCORE_BY = uniformByMedia(new Map(TEAMS.map((team, i) => [team.id, 92 - i * 3])));

const input = (locked?: Map<string, never>): FuturesInput => ({
  teams: TEAMS,
  scoreBy: SCORE_BY,
  gamesRemainingByTeamId: REMAINING,
  lockedRaces: locked as FuturesInput['lockedRaces'],
});

/** A completed playoff series, with venues swapping every game as a real one does. */
const seriesGames = (
  winner: string,
  loser: string,
  wins: number,
  losses: number,
  round: PlayoffRoundKey,
  league: PlayoffLeague,
  id: string,
) => {
  const games = [];
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

const DIVISION_LOCK = () => lockedRaces({ teams: TEAMS, gamesRemainingByTeamId: REMAINING });

console.log('\nTHE SEAM: WHO COMPUTES IT, AND WHO PASSES IT ON');
{
  /*
   * The closure is computed in one place and read in three, and every way that can go wrong is a
   * silent one. So this reads the source rather than trusting the wiring is present, because a
   * builder that simply forgot the prop would leave every market open with a fully green suite.
   *
   * Read as text on purpose. Asserting on behaviour instead would mean constructing a case where the
   * difference is visible, and the difference here is a missing argument.
   */
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const page = read(join('src', 'components', 'betting', 'BettingPage.tsx'));
  const builders = read(join('src', 'lib', 'mediaMarkets.ts'));

  check('BettingPage imports lockedRaces from futuresRisk',
    /import\s*\{[^}]*lockedRaces[^}]*\}\s*from\s*'\.\.\/\.\.\/lib\/futuresRisk'/.test(page));
  check('BettingPage computes it once', (page.match(/lockedRaces\(/g) || []).length === 1);
  check('BettingPage passes games, so the series races can close',
    /lockedRaces\(\{\s*teams:[^}]*gamesRemainingByTeamId,\s*games\s*\}\)/s.test(page),
    'without games, league and title races can never close');
  check('all three builders receive the map',
    (page.match(/lockedRaces: locked/g) || []).length === 3,
    `got ${(page.match(/lockedRaces: locked/g) || []).length} of 3`);
  check('the grouped builder reads its own key',
    builders.includes('locked: input.lockedRaces?.get(`${kind}:${groupId}`)'));
  check('the title builder reads the title key',
    builders.includes('locked: input.lockedRaces?.get(WORLD_SERIES_MARKET_KEY)'));
}

console.log('\nDIVISION MARKETS CARRY THEIR CLOSURE');
{
  const divisions = buildDivisionMarkets(input(DIVISION_LOCK() as unknown as Map<string, never>));

  const north = divisions.find((market) => market.key === 'division:Platinum North');
  check('the decided division exists', north !== undefined, `keys: ${divisions.map((m) => m.key).join(', ')}`);
  check('it is locked', north?.locked !== undefined, `got ${JSON.stringify(north?.locked)}`);
  check('the winner is the leader', north?.locked?.winnerKey === 'brah', `got ${north?.locked?.winnerKey}`);
  check('the winner is a real outcome on that market',
    (north?.outcomes ?? []).some((o) => o.key === north?.locked?.winnerKey));
  check('the reason survives the trip', north?.locked?.reason === 'unreachable_lead');
  check('the margin survives the trip', north?.locked?.margin === 7, `expected 7, got ${north?.locked?.margin}`);

  const south = divisions.find((market) => market.key === 'division:Platinum South');
  check('the undecided division is NOT locked', south?.locked === undefined,
    `got ${JSON.stringify(south?.locked)}`);

  const prestige = divisions.find((market) => market.key === 'division:Prestige North');
  check('the untouched league is NOT locked', prestige?.locked === undefined);

  check('exactly one of four divisions is locked',
    divisions.filter((m) => m.locked).length === 1,
    `got ${divisions.filter((m) => m.locked).length}`);
}

console.log('\nA DIVISION BOARD WITH NO LOCKED MAP IS ALL OPEN');
{
  const divisions = buildDivisionMarkets(input());
  check('no locked map means nothing is locked', divisions.every((m) => m.locked === undefined));
  check(
    'and the decided division is still fully priced',
    divisions.find((m) => m.key === 'division:Platinum North')?.outcomes.length === 4,
    'which is why the default must be open, and why placeBet has to do the real work',
  );
}

console.log('\nLEAGUE MARKETS CARRY A COMPLETED SERIES');
{
  const locked = lockedRaces({
    teams: TEAMS,
    gamesRemainingByTeamId: REMAINING,
    games: seriesGames('brah', 'corvix', 4, 2, 'league_series', 'Platinum', 'plat-1'),
  });
  const leagues = buildLeagueMarkets(input(locked as unknown as Map<string, never>));

  const platinum = leagues.find((market) => market.key === 'league:Platinum');
  check('the decided league exists', platinum !== undefined, `keys: ${leagues.map((m) => m.key).join(', ')}`);
  check('it is locked', platinum?.locked !== undefined, `got ${JSON.stringify(platinum?.locked)}`);
  check('the series winner takes it', platinum?.locked?.winnerKey === 'brah');
  check(
    'and is a real outcome on that market',
    (platinum?.outcomes ?? []).some((o) => o.key === platinum?.locked?.winnerKey),
    'a winner key outside the outcome list would settle nothing',
  );
  check('the reason is a won series', platinum?.locked?.reason === 'series_won');
  check('the margin is 2 for a 4-2', platinum?.locked?.margin === 2, `got ${platinum?.locked?.margin}`);

  const prestige = leagues.find((market) => market.key === 'league:Prestige');
  check('the league with no series is untouched', prestige?.locked === undefined);
}

console.log('\nTHE TITLE CARRIES A FINISHED WORLD SERIES');
{
  const locked = lockedRaces({
    teams: TEAMS,
    gamesRemainingByTeamId: REMAINING,
    games: seriesGames('brah', 'juno', 4, 3, 'world_series', 'GPB', 'ws-1'),
  });
  const title = buildWorldSeriesMarkets(input(locked as unknown as Map<string, never>))[0];

  check('the title market key is unchanged', title?.key === WORLD_SERIES_MARKET_KEY, `got ${title?.key}`);
  check('the title is locked', title?.locked !== undefined, `got ${JSON.stringify(title?.locked)}`);
  check('the champion is the series winner', title?.locked?.winnerKey === 'brah');
  check('and is one of the field', (title?.outcomes ?? []).some((o) => o.key === title?.locked?.winnerKey));
  check('the margin is 1 for a 4-3', title?.locked?.margin === 1, `got ${title?.locked?.margin}`);
}

console.log('\nCLOSURE DOES NOT DISTURB PRICING');
{
  /*
   * The load-bearing non-regression. `locked` says the schedule has decided the race; it says
   * nothing about what the forecasters believe. A club that has already won its division still
   * carries its probability and its price, because overwriting those with the fact would be
   * inventing a forecast to match arithmetic -- and because a stale price on a closed market is
   * correct information, since enforcement refuses the sale rather than pretending the number is
   * wrong.
   */
  const withLock = buildDivisionMarkets(input(DIVISION_LOCK() as unknown as Map<string, never>));
  const without = buildDivisionMarkets(input());

  const a = withLock.find((m) => m.key === 'division:Platinum North');
  const b = without.find((m) => m.key === 'division:Platinum North');

  check('the locked board has the same outcomes', a?.outcomes.length === b?.outcomes.length);
  check('every price is identical', JSON.stringify(a?.outcomes.map((o) => o.houseOdds))
    === JSON.stringify(b?.outcomes.map((o) => o.houseOdds)),
  'a closure must not move a price');
  check('every forecaster probability is identical',
    JSON.stringify(a?.outcomes.map((o) => o.probability))
    === JSON.stringify(b?.outcomes.map((o) => o.probability)),
  "Sharply's overconfidence must survive a closure untouched");
  check('the live count is unchanged too', a?.liveOutcomes === b?.liveOutcomes,
    `${a?.liveOutcomes} against ${b?.liveOutcomes}: "nobody can catch him" and "he has already won" differ`);
}

console.log('\nEVERY FORECASTER IS STILL PRICED ON A CLOSED BOARD');
{
  const north = buildDivisionMarkets(input(DIVISION_LOCK() as unknown as Map<string, never>))
    .find((m) => m.key === 'division:Platinum North');
  check('all nine forecasters still post a price on the winner',
    MEDIA_PROFILES.every((profile) => typeof north?.outcomes[0]?.odds[profile.id] === 'number'),
    'a closure must not empty the price book');
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
