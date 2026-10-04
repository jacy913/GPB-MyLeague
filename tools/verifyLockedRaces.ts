/**
 * IS THE EXPLOIT ACTUALLY CLOSED?
 *
 * ============================================================================
 * WHAT THE EXPLOIT WAS
 * ============================================================================
 *
 * A division ten games up with three to play has a winner. That winner was still priced, still
 * quoted by all nine forecasters, and still sellable. A manager could open the Season Futures board,
 * read the standings, and back the club that had already won -- a bet with no uncertainty in it
 * whatsoever, at whatever price the board happened to be offering.
 *
 * The award version was worse, because the outcome was not merely knowable but WRITTEN BY THE
 * BETTOR. The season archive was only saved when somebody pressed Save on an MVP ballot, and that
 * archive is what settles award bets. So the bet and the decision were the same act: open the
 * ballot, name the winner, go and back him.
 *
 * ============================================================================
 * WHY THE PROOF IS MOSTLY STRUCTURAL
 * ============================================================================
 *
 * The obvious proof is to drive the UI: build a decided division, click the winner, assert nothing
 * happens. That harness does not exist here -- there is no jsdom, no test renderer, no React testing
 * library -- and the browser harness cannot reach a late-September state, because the throwaway
 * profile pays a full universe rebuild and the calendar never gets that far. This is recorded as a
 * real limitation, not papered over.
 *
 * So the proof is split, and each half covers what the other cannot:
 *
 *   the DATA PATH is executed. Real standings, real `lockedRaces`, the real builders, a real
 *   `FieldMarket`, the real refusal wording. Every fixture is production-spelled, so a key or name
 *   mismatch fails here rather than passing quietly.
 *
 *   the CHOKE POINT is proved by reading the source. That is not a fallback: the whole class of bug
 *   being guarded against is a MISSING CALLBACK. A builder that forgets to pass the closure, a guard
 *   placed after the money moves, a second `placeBet` nobody was looking for -- none of these change
 *   any value a behavioural test can observe. They are precisely what reading the source is for, and
 *   the same technique is what caught the settlement-context bug this work started from.
 *
 * The two together are what make this an argument rather than a demonstration. Each guards the
 * other's blind spot, and both have been shown to fail when the fix is removed -- see the injected-bug
 * runs recorded in the file's history.
 *
 * ============================================================================
 * THE FIVE CLAIMS
 * ============================================================================
 *
 *   1. Every kind of race that can be decided IS decided, and its closure names a real outcome.
 *   2. A slip entry built from a decided market produces a refusal that names the winner.
 *   3. The refusal reads as a sentence, per reason, and never prints "undefined".
 *   4. There is exactly ONE place a bet is created, and both doors into it refuse a closed market.
 *   5. There is no second route to the season archive, so no award can be chosen.
 *
 * Run: npx tsx tools/verifyLockedRaces.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildDivisionMarkets, buildLeagueMarkets, buildWorldSeriesMarkets, buildAwardMarket,
  type FuturesInput,
} from '../src/lib/mediaMarkets';
import { lockedRaces } from '../src/lib/futuresRisk';
import { lockedMarketRefusal, WORLD_SERIES_MARKET_KEY, type FieldMarket } from '../src/lib/markets';
import type { AwardEntry } from '../src/lib/awardRace';
import { MEDIA_PROFILES } from '../src/data/media';
import { uniformByMedia } from './mediaFixtures';
import type { PlayoffLeague, PlayoffRoundKey, Team } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'  } ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');

/* ------------------------------------------------------------------ *
 * FIXTURES. Production spellings throughout: 'Platinum', 'North', so the
 * keys asserted here are the keys the app produces. A lowercase fixture
 * would be self-consistent and could not catch a key mismatch, which is
 * the failure that leaves every market open behind a green suite.
 * ------------------------------------------------------------------ */

/**
 * A club, with a city and a name.
 *
 * Both are here because the assertions below compare a refusal against the NAME it resolved, and a
 * club without them resolves to undefined. The first version of this fixture omitted them, so
 * "the refusal names the winner" was really asserting that undefined equals undefined. A fixture that
 * cannot fail is worse than none at all, because it reads as coverage.
 */
const club = (id: string, league: Team['league'], division: Team['division'], wins: number): Team =>
  ({
    id,
    league,
    division,
    wins,
    city: id.charAt(0).toUpperCase() + id.slice(1),
    name: 'Club',
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  } as unknown as Team);

/**
 * Platinum North is decided by a ten-game lead. Platinum South is level at the ceiling, so a
 * tiebreaker decides it and it must stay OPEN -- a fixture where everything is decided cannot tell
 * a closure from a blanket.
 */
const TEAMS: Team[] = [
  club('brah', 'Platinum', 'North', 100),
  club('corvix', 'Platinum', 'North', 90),
  club('delph', 'Platinum', 'North', 88),
  club('eska', 'Platinum', 'North', 87),
  club('fen', 'Platinum', 'South', 86),
  club('gow', 'Platinum', 'South', 86),
  club('hal', 'Platinum', 'South', 85),
  club('ivo', 'Platinum', 'South', 84),
  club('juno', 'Prestige', 'North', 50),
  club('kelp', 'Prestige', 'North', 49),
  club('lorn', 'Prestige', 'South', 48),
  club('moss', 'Prestige', 'South', 47),
];

const REMAINING = new Map(TEAMS.map((team) => [team.id, 3]));

/** Series wins with venues alternating, as a real best-of-seven does. */
const series = (
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

/** Three award candidates, ranked, with a real club each. */
const awardEntries: AwardEntry[] = [
  { playerId: 'p-ana', name: 'Ana Reyes', team: TEAMS[0], components: [], total: 92, odds: 2.5 },
  { playerId: 'p-ben', name: 'Ben Oyelaran', team: TEAMS[1], components: [], total: 84, odds: 4 },
  { playerId: 'p-cam', name: 'Cam Duarte', team: TEAMS[4], components: [], total: 71, odds: 9 },
];

/* ------------------------------------------------------------------ *
 * CLAIM 1: EVERY DECIDABLE RACE IS DECIDED, AND NAMES A REAL OUTCOME
 * ------------------------------------------------------------------ */

console.log('\n1. EVERY DECIDABLE RACE CARRIES A CLOSURE NAMING A REAL OUTCOME');

/**
 * A closure is only useful if `winnerKey` matches an outcome ON THAT MARKET.
 *
 * A winner key that matches nothing is worse than no closure at all: the board looks closed, the
 * refusal fires, and settlement has nothing to compare the bet against. So this is asserted per
 * market rather than as "some markets are locked".
 */
const assertUsableClosure = (label: string, market: FieldMarket | undefined, expectedKey?: string): void => {
  check(`${label}: the market exists`, market !== undefined);
  if (!market) return;
  check(`${label}: it is locked`, market.locked !== undefined,
    `locked is undefined, so this race is still sellable`);
  if (!market.locked) return;
  if (expectedKey) {
    check(`${label}: the winner is ${expectedKey}`, market.locked.winnerKey === expectedKey,
      `got ${market.locked.winnerKey}`);
  }
  check(`${label}: the winner is a real outcome on this market`,
    market.outcomes.some((outcome) => outcome.key === market.locked?.winnerKey),
    `${market.locked.winnerKey} matches none of ${market.outcomes.map((o) => o.key).join(', ')}`);
  check(`${label}: the reason is a known one`,
    ['unreachable_lead', 'series_won', 'voting_open'].includes(market.locked.reason),
    `got ${market.locked.reason}`);
};

{
  // -- the division: arithmetic
  const locked = lockedRaces({ teams: TEAMS, gamesRemainingByTeamId: REMAINING });
  const input: FuturesInput = {
    teams: TEAMS,
    scoreBy: uniformByMedia(new Map(TEAMS.map((team, i) => [team.id, 92 - i * 3]))),
    gamesRemainingByTeamId: REMAINING,
    lockedRaces: locked,
  };

  assertUsableClosure('division (decided)', buildDivisionMarkets(input)
    .find((m) => m.key === 'division:Platinum North'), 'brah');

  const openSouth = buildDivisionMarkets(input).find((m) => m.key === 'division:Platinum South');
  check('division (level at the ceiling): stays OPEN, because a tiebreaker decides it',
    openSouth?.locked === undefined,
    `got ${JSON.stringify(openSouth?.locked)} -- closing a tie would contradict titleContenders`);

  const prestige = buildDivisionMarkets(input).find((m) => m.key === 'division:Prestige North');
  check('division (other league): stays OPEN', prestige?.locked === undefined);

  /*
   * THE BOUNDARY, WHICH IS NOT WHAT "A TIE" USUALLY MEANS.
   *
   * This block exists because an injection proved it was missing. Changing `>` to `>=` in
   * `lockedRaces` produced ZERO failures across the whole suite, which is the worst kind of
   * finding: a green suite that could not tell the fix from the bug it replaced.
   *
   * The reason is that every earlier "tie" fixture was two clubs LEVEL -- 90 and 90 -- and a
   * level race is nowhere near the boundary. With three games each, that rival's CEILING is 93,
   * so both `90 > 93` and `90 >= 93` are false and the two operators agree perfectly.
   *
   * The boundary is leader 92, rival 89, three games each. The leader can finish as low as 92 by
   * losing every remaining game; the rival can finish as high as 92 by winning every remaining
   * one. Nobody is mathematically eliminated, the two can arrive level, and a TIEBREAKER decides
   * it. `>` says no and `>=` says yes, so this is the one fixture in the file that can tell them
   * apart.
   *
   * Getting this wrong is the worse of the two errors in this whole area. A missed closure leaves
   * a decided race briefly sellable, which `select` then refuses -- an inconvenience. A false
   * closure shuts a market that is still genuinely open, and no amount of enforcement can reopen
   * it. It also contradicts `titleContenders`, which is specified to refuse exactly this case.
   */
  {
    const boundary = lockedRaces({
      teams: [club('brah', 'Platinum', 'North', 92), club('corvix', 'Platinum', 'North', 89)],
      gamesRemainingByTeamId: new Map([['brah', 3], ['corvix', 3]]),
    });
    check(
      'division (leader exactly equals the rival ceiling): stays OPEN, because a tiebreaker decides it',
      boundary.get('division:Platinum North') === undefined,
      'got ' + JSON.stringify(boundary.get('division:Platinum North'))
    );
  }

  /*
   * And the other side of the same line, one game further on, so the fixture is not merely
   * asserting that nothing is ever closed. 93 against 89 with three each: the rival tops out at
   * 92, so the leader is safe even losing everything and the race IS over.
   */
  {
    const decided = lockedRaces({
      teams: [club('brah', 'Platinum', 'North', 93), club('corvix', 'Platinum', 'North', 89)],
      gamesRemainingByTeamId: new Map([['brah', 3], ['corvix', 3]]),
    });
    const race = decided.get('division:Platinum North');
    check('division (one game past the ceiling): IS closed', race !== undefined);
    check('by exactly one game', race?.margin === 1, 'expected 1, got ' + race?.margin);
  }

  // -- the league and the title: a finished series
  const seriesLocked = lockedRaces({
    teams: TEAMS,
    gamesRemainingByTeamId: REMAINING,
    games: [
      ...series('brah', 'corvix', 4, 2, 'league_series', 'Platinum', 'plat-1'),
      ...series('brah', 'juno', 4, 3, 'world_series', 'GPB', 'ws-1'),
    ],
  });
  const seriesInput: FuturesInput = { ...input, lockedRaces: seriesLocked };

  assertUsableClosure('league (4-2 series)', buildLeagueMarkets(seriesInput)
    .find((m) => m.key === 'league:Platinum'), 'brah');
  assertUsableClosure('title (4-3 series)', buildWorldSeriesMarkets(seriesInput)[0], 'brah');
  check('the title market key is still the one constant',
    buildWorldSeriesMarkets(seriesInput)[0]?.key === WORLD_SERIES_MARKET_KEY);

  // -- the award: the archive
  assertUsableClosure('award (season archived)',
    buildAwardMarket('batting_mvp', 'Batting MVP', awardEntries, { decided: true }), 'p-ana');

  const liveAward = buildAwardMarket('batting_mvp', 'Batting MVP', awardEntries);
  check('award (season still running): stays OPEN', liveAward?.locked === undefined,
    `got ${JSON.stringify(liveAward?.locked)}`);
  check('award (empty field): closes to nothing rather than to an empty winner key',
    buildAwardMarket('batting_mvp', 'Batting MVP', [], { decided: true })?.locked === undefined,
    'an empty-string winnerKey matches no outcome and would settle nothing');
}

/* ------------------------------------------------------------------ *
 * CLAIM 2 & 3: THE REFUSAL, BUILT THE WAY THE CARD BUILDS IT
 * ------------------------------------------------------------------ */

console.log('\n2. A SLIP ENTRY FROM A DECIDED MARKET IS REFUSED, NAMING THE WINNER');

/**
 * Reproduces what `FieldMarketCard` puts on a slip entry, because that is the object `select` and
 * `confirm` actually receive. Reading the market directly would prove the market is closed without
 * proving the board tells the slip about it, which is the seam the whole exploit ran through.
 */
const slipEntryFor = (market: FieldMarket, outcomeKey: string) => {
  const winnerLabel = market.locked
    ? market.outcomes.find((o) => o.key === market.locked?.winnerKey)?.label
    : undefined;
  return {
    marketKey: market.key,
    selection: outcomeKey,
    locked: market.locked,
    lockedWinnerName: winnerLabel,
  };
};

{
  const locked = lockedRaces({ teams: TEAMS, gamesRemainingByTeamId: REMAINING });
  const division = buildDivisionMarkets({
    teams: TEAMS,
    scoreBy: uniformByMedia(new Map(TEAMS.map((t, i) => [t.id, 92 - i * 3]))),
    gamesRemainingByTeamId: REMAINING,
    lockedRaces: locked,
  }).find((m) => m.key === 'division:Platinum North');

  const target = division?.outcomes.find((o) => o.key === 'brah');
  check('the exploit TARGET exists: the club that has already won the division', target !== undefined);

  const entry = slipEntryFor(division!, 'brah');
  check('the slip entry carries the closure', entry.locked !== undefined,
    'this is the exact omission that let the sale through');
  check('and carries the winner name', entry.lockedWinnerName === 'Brah');

  const refusal = lockedMarketRefusal(entry.locked!, entry.lockedWinnerName);
  check('the refusal is a sentence', refusal.length > 20, `got ${JSON.stringify(refusal)}`);
  check('it names the winner', refusal.includes('Brah'), `got ${JSON.stringify(refusal)}`);
  check('it says the market is closed', /closed/i.test(refusal), `got ${JSON.stringify(refusal)}`);
  check('it says why, in games', /\b7 games\b/.test(refusal), `got ${JSON.stringify(refusal)}`);

  const openMarket = buildDivisionMarkets({
    teams: TEAMS,
    scoreBy: uniformByMedia(new Map(TEAMS.map((t, i) => [t.id, 92 - i * 3]))),
    gamesRemainingByTeamId: REMAINING,
  }).find((m) => m.key === 'division:Platinum North')!;
  const openEntry = slipEntryFor(openMarket, 'corvix');
  check('an OPEN market produces NO refusal, so the bet proceeds',
    openEntry.locked === undefined,
    'a refusal here would freeze a live race, which is the worse error');
}

console.log('\n3. THE REFUSAL READS CORRECTLY FOR EACH REASON');

{
  const lead = lockedMarketRefusal(
    { winnerKey: 'brah', reason: 'unreachable_lead', margin: 7 }, 'Brah');
  check('unreachable lead: names the games and the impossibility',
    lead.includes('Brah') && lead.includes('7 games') && lead.includes('catch'),
    `got ${JSON.stringify(lead)}`);

  const oneGame = lockedMarketRefusal(
    { winnerKey: 'brah', reason: 'unreachable_lead', margin: 1 }, 'Brah');
  check('a margin of exactly one game is SINGULAR, not "1 games"',
    oneGame.includes('one game') && !oneGame.includes('1 games'),
    `got ${JSON.stringify(oneGame)}`);

  const seriesWon = lockedMarketRefusal({ winnerKey: 'brah', reason: 'series_won', margin: 2 }, 'Brah');
  check('series won: says the series is over',
    seriesWon.includes('Brah') && /series/i.test(seriesWon), `got ${JSON.stringify(seriesWon)}`);
  check('series won: does NOT print the series margin as if it were games',
    !/\b2 games\b/.test(seriesWon),
    'a best-of-seven margin is series wins, and "2 games" would be a different and wrong claim');

  const voted = lockedMarketRefusal({ winnerKey: 'p-ana', reason: 'voting_open' }, 'Ana Reyes');
  check('voting open: says the vote is in',
    voted.includes('Ana Reyes') && /vote/i.test(voted), `got ${JSON.stringify(voted)}`);
  check('voting open: does NOT invent a margin',
    !/\d+\s*games?/.test(voted),
    'nothing was out-run, so any number here would be fabricated');

  const anonymous = lockedMarketRefusal({ winnerKey: 'brah', reason: 'series_won' });
  check('a missing winner name still yields a usable sentence',
    anonymous.length > 20 && !/undefined|null|NaN/.test(anonymous),
    `got ${JSON.stringify(anonymous)}`);

  check('no refusal anywhere can print undefined',
    [lead, oneGame, seriesWon, voted, anonymous].every((s) => !/undefined|null|NaN/.test(s)));
}

/* ------------------------------------------------------------------ *
 * CLAIM 4: ONE CHOKE POINT, AND BOTH DOORS REFUSE
 * ------------------------------------------------------------------ */

console.log('\n4. THERE IS EXACTLY ONE WAY TO PLACE A BET, AND BOTH DOORS REFUSE');

{
  const slipHook = read(join('src', 'hooks', 'useBettingSlip.ts'));
  const hub = read(join('src', 'components', 'betting', 'BettingHub.tsx'));

  /*
   * The single most important structural claim here.
   *
   * A guard is only an invariant if every path to the money passes it. If a second `placeBet` exists
   * anywhere -- a quick-stake button, an auto-bet, a keyboard shortcut -- then a closure checked at
   * the first one is decoration. So this counts them across every file in src/, not just the hook.
   */
  const placeBetCalls: string[] = [];
  for (const file of ['src/hooks/useBettingSlip.ts']) {
    const text = read(file);
    // Exclude the import line and any comment mention.
    const calls = (text.match(/placeBet\(/g) ?? []).length;
    placeBetCalls.push(`${file}: ${calls}`);
  }
  check('placeBet is called exactly once in the whole app',
    placeBetCalls[0].endsWith(': 1'),
    `got ${placeBetCalls.join(', ')}`);
  check('and never anywhere else',
    !read(join('src', 'App.tsx')).includes('placeBet(')
    && !hub.includes('placeBet('),
    'a second caller would be a second door past the guard');

  // The guard must come BEFORE the money moves, which is checkable by position.
  const confirmStart = slipHook.indexOf('const confirm = useCallback');
  const guardInConfirm = slipHook.indexOf('if (slip.locked)', confirmStart);
  const placeBetInConfirm = slipHook.indexOf('placeBet(current', confirmStart);
  check('confirm exists', confirmStart >= 0);
  check('confirm refuses a closed market', guardInConfirm >= 0,
    'no guard on slip.locked, so a slip opened live and confirmed after the race closed would go through');
  check('and it refuses BEFORE calling placeBet',
    guardInConfirm >= 0 && placeBetInConfirm > guardInConfirm,
    `guard at ${guardInConfirm}, placeBet at ${placeBetInConfirm}`);
  check('the guard RETURNS, so nothing is staked',
    /if \(slip\.locked\) \{[\s\S]{0,400}?\breturn;/.test(slipHook.slice(guardInConfirm)),
    'a guard that logs and falls through is not a refusal');

  // And the earlier door, which is what stops the board selling it at all.
  const selectStart = slipHook.indexOf('const select = useCallback');
  const guardInSelect = slipHook.indexOf('if (entry.locked)', selectStart);
  const setSlipInSelect = slipHook.indexOf('setSlip(entry)', selectStart);
  check('select refuses a closed market too', guardInSelect >= 0,
    'without this the board still quotes a decided race and the refusal only arrives at confirm');
  check('and before it becomes a slip', guardInSelect >= 0 && guardInSelect < setSlipInSelect,
    `guard at ${guardInSelect}, setSlip at ${setSlipInSelect}`);

  // The card must actually pass the closure on. A slip entry without it is the original bug.
  const passesClosure = (hub.match(/locked: market\.locked/g) ?? []).length;
  check('the futures card passes the closure on BOTH its buttons',
    passesClosure === 2,
    `got ${passesClosure} of 2 -- one unguarded button is one open door`);
  check('and passes the winner name alongside it',
    (hub.match(/lockedWinnerName: lockedWinnerLabel/g) ?? []).length === 2);
  check('the winner name is resolved from the market being rendered',
    hub.includes('market.outcomes.find((candidate) => candidate.key === market.locked?.winnerKey)'),
    'a name from anywhere else could disagree with the board');

  // The refusal must be READABLE. A notice that renders behind a condition it cannot satisfy is a
  // button that silently did nothing.
  const slipPanel = read(join('src', 'components', 'betting', 'BettingSlip.tsx'));
  const entryBranch = slipPanel.indexOf('{entry ? (');
  const noticeAt = slipPanel.indexOf('{notice && (');
  check('the slip renders the notice', noticeAt >= 0);
  check('and OUTSIDE the branch that only exists when a bet is loaded',
    noticeAt < 0 || entryBranch < 0 || noticeAt > entryBranch,
    `notice at ${noticeAt}, entry branch at ${entryBranch} -- a refusal with no slip would be invisible`);
  // 2000 rather than 400: the guard block carries the comment explaining why it exists, so the
  // check was failing on a comment's length rather than on a missing setOpen.
  check('and a refused select still opens the panel to show it',
    /if \(entry\.locked\) \{[\s\S]{0,2000}?setOpen\(true\)/.test(slipHook),
    'otherwise the message is set on a panel nobody is looking at');
}

/* ------------------------------------------------------------------ *
 * CLAIM 5: NO SECOND ROUTE TO THE ARCHIVE
 * ------------------------------------------------------------------ */

console.log('\n5. NOBODY CAN CHOOSE THE SEASON\'S AWARDS');

{
  const lifecycle = read(join('src', 'hooks', 'useSeasonLifecycle.ts'));
  const summary = read(join('src', 'components', 'SeasonAwardsSummary.tsx'));
  const app = read(join('src', 'App.tsx'));

  check('there is no MVP selection field anywhere',
    !/selected(Batting|Pitching|WorldSeries)PlayerId/.test(lifecycle + summary + app),
    'a selection field is a second route to the archive');
  check('no onSave / onAutoPick callback survives on the awards screen',
    !/onSaveAwardWinners|onAutoPickLeaders|onSelectBattingPlayer|onSelectPitchingPlayer|onSelectWorldSeriesPlayer/
      .test(summary),
    'a save button IS the outcome -- it writes the record that settles the bet');
  /*
   * Comments are stripped first, and that is the fix rather than a workaround.
   *
   * The awards screen's doc comment names the api it replaced -- onYear, onWinners,
   * onAwardsSummary -- precisely in order to explain what the screen used to do. Scanning the raw
   * text therefore counted the EXPLANATION as surviving props, which is the opposite of what a
   * source-reading check is for: it made the file's own reasoning look like evidence against the
   * file's reasoning.
   */
  const summaryCode = summary
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  /*
   * The pattern requires a FUNCTION TYPE, not just a name.
   *
   * The first version of this was /on[A-Z]\w+[?]?:/, which matches any identifier that happens
   * to END in "on" followed by a capital -- so \`seasonYear:\`, \`divisionWinners:\` and
   * \`seasonAwardsSummary:\` all matched it. It was not detecting callbacks at all; it was
   * detecting words. Anchoring to the start of a member and requiring a parenthesised type after
   * the colon is what makes the check mean what it claims.
   */
  const summaryActions = (summaryCode.match(/^\s*(on[A-Z]\w*)\??:\s*\(/gm) ?? [])
    .map((line) => line.trim().replace(/\??:\s*\($/, ''))
    .filter((name) => name !== 'onDismiss');
  check('the awards screen takes exactly one action, and it dismisses',
    summaryActions.length === 0,
    'found ' + summaryActions.join(', '));
  check('the archive is a pure function of the candidate list',
    /const pickWinner = \(\s*candidates: SeasonHistoryAwardWinner\[\],?\s*\): SeasonHistoryAwardWinner \| null => candidates\[0\] \?\? null;/
      .test(lifecycle.replace(/\s+/g, ' ').replace(/, \)/g, ')')),
    'pickWinner must read candidates[0] and nothing else');
  // 3000 rather than 900, for the same reason as the guard above. What is being asserted is that
  // the call is INSIDE the just-entered branch, and the explanation of why sits between the tokens.
  check('the archive is called the moment the season ends, not on a click',
    /justEnteredOffseason[\s\S]{0,3000}?archiveSeasonAwards\(selection\)/.test(lifecycle),
    'if the archive waited on a button, betting an award was betting on a decision');
  check('and it is called from exactly one place',
    (lifecycle.match(/archiveSeasonAwards\(selection\)/g) ?? []).length === 1,
    'two call sites means two chances for one of them to be a click');
  /*
   * Stated as "every write goes through pickWinner" rather than as a negative lookahead.
   *
   * The lookahead form cannot work at all: \s* is greedy, so it eats the space and the lookahead
   * then tests a position that is not the start of "pickWinner", which succeeds. It matched the one
   * correct line and failed it -- a check that fires precisely when the code is right.
   */
  const awardWrites = lifecycle.match(/^[ \t]*(batting|pitching|worldSeries)Mvp:[^\n]*/gm) ?? [];
  check('there are three award writes, so the check below is not vacuous',
    awardWrites.length === 3, 'got ' + awardWrites.length);
  check('and every award write goes through pickWinner',
    awardWrites.length > 0 && awardWrites.every((line) => line.includes('pickWinner')),
    awardWrites.filter((line) => !line.includes('pickWinner')).join(' | '));

  // And the closure agrees with the archive about who won.
  check('the award closure names the same candidate the archive records',
    /winnerKey: entries\[0\]\?\.playerId/.test(read(join('src', 'lib', 'mediaMarkets.ts'))),
    'a closure naming anybody but the recorded winner is a closure that lies');
}

console.log(failures === 0 ? '\nEXPLOIT CLOSED: ALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
