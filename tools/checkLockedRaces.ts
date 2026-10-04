/**
 * Does `lockedRaces` actually close the races that are already decided?
 *
 * ============================================================================
 * WHY THIS IS A FIXTURE TEST AND NOT A BROWSER CHECK
 * ============================================================================
 *
 * The bug this closes was found on a real September save: a division that had already been won was
 * still priced and still sellable. The CDP harness cannot reach a late-September state -- the
 * throwaway profile pays a full universe rebuild and the calendar never gets that far -- so the case
 * that motivated this cannot be reproduced in a screenshot.
 *
 * That is not a reason to skip it. A division ten games up with three to play is a DATA shape, not a
 * calendar position, so it can be written down exactly and asserted. What matters is the arithmetic
 * and the boundary cases, and both are pure functions of standings plus a schedule.
 *
 * ============================================================================
 * WHY THE FIXTURES USE PRODUCTION SPELLINGS
 * ============================================================================
 *
 * League and division names are `'Platinum'` / `'North'` and the market keys are therefore
 * `division:Platinum North` and `league:Platinum`. An earlier version of this file used lowercase
 * and was self-consistent, which is exactly why it was worthless as a guard: it could not have
 * caught a case-sensitivity bug in the key that joins `lockedRaces` to the builders, and a key
 * mismatch there is the silent failure that leaves every market open with a green suite.
 *
 * The playoff payload is typed `PlayoffLeague` / `PlayoffRoundKey` rather than `string`, for the
 * same reason -- a fixture that cannot express an impossible league cannot catch one being invented.
 *
 * ============================================================================
 * THE CASES
 * ============================================================================
 *
 *   - the motivating case: a big lead that cannot be caught
 *   - the boundary: a lead of EXACTLY one more win than the rival can reach. Closed.
 *   - the tie: a lead exactly equal to the rival's ceiling. NOT closed, because a tiebreaker decides
 *     it. `titleContenders` refuses the same case, and the two must agree.
 *   - a leader still short of the ceiling. NOT closed.
 *   - a series finished 4-2 -- closed, and closed on the night of the fourth win rather than after
 *     the sixth game
 *   - a series 3-2 with a game in hand: NOT decided, because nobody has four yet
 *   - alternating venues, which is what a real best-of-seven does
 *   - a wild-card or divisional series: never closes a futures race
 *
 * Run: npx tsx tools/checkLockedRaces.ts
 */
import { lockedRaces, type LockedRaceGame } from '../src/lib/futuresRisk';
import { WORLD_SERIES_MARKET_KEY } from '../src/lib/markets';
import type { PlayoffLeague, PlayoffRoundKey, Team } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** A club, with only the fields a closure reads. */
const club = (
  id: string,
  division: Team['division'],
  wins: number,
  league: Team['league'] = 'Platinum',
): Team => ({ id, league, division, wins } as unknown as Team);

const remaining = (counts: Record<string, number>) => new Map(Object.entries(counts));

/**
 * One completed playoff game, won by `winner`.
 *
 * The score is written 1-0 because a playoff game's score here stands for SERIES wins, and a drawn
 * game is deliberately not expressible: baseball has none, and a 0-0 would silently credit nobody
 * while looking like a game that was played.
 */
const seriesWin = (
  winner: string,
  loser: string,
  round: PlayoffRoundKey,
  league: PlayoffLeague,
  seriesId: string,
): LockedRaceGame => ({
  homeTeam: winner,
  awayTeam: loser,
  status: 'completed',
  score: { home: 1, away: 0 },
  playoff: { round, league, seriesId },
});

/** `count` completed wins by `winner` in one series. */
const series = (
  winner: string,
  loser: string,
  count: number,
  round: PlayoffRoundKey,
  league: PlayoffLeague,
  id: string,
) => Array.from({ length: count }, () => seriesWin(winner, loser, round, league, id));

/**
 * A series with the venues swapping every game, as a real one does.
 *
 * The regression guard for a real bug in the first version of this function, which tallied wins as
 * `homeWins`/`awayWins` off the first game's sides. That is only correct if a team keeps the same
 * side all series, and they do not. A genuine 4-2 came out 6-0 and locked as a sweep; a 3-2 that
 * nobody had won yet came out 5-0 and locked the market outright. Every other fixture in this file
 * keeps the winner at home all the way through and so passes either way, which is what makes this one
 * the case that actually holds the fix in place.
 */
const alternating = (
  a: string,
  b: string,
  aWins: number,
  bWins: number,
  round: PlayoffRoundKey,
  league: PlayoffLeague,
  id: string,
): LockedRaceGame[] => {
  const games: LockedRaceGame[] = [];
  for (let i = 0; i < aWins + bWins; i += 1) {
    const aIsHome = i % 2 === 0;
    const aWon = i < aWins;
    games.push({
      homeTeam: aIsHome ? a : b,
      awayTeam: aIsHome ? b : a,
      status: 'completed',
      score: aIsHome
        ? { home: aWon ? 1 : 0, away: aWon ? 0 : 1 }
        : { home: aWon ? 0 : 1, away: aWon ? 1 : 0 },
      playoff: { round, league, seriesId: id },
    });
  }
  return games;
};

console.log('\nLOCKED RACES: DIVISIONS, BY STANDINGS');

// -- 1. THE MOTIVATING CASE ---------------------------------------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100), club('corvix', 'North', 90), club('delph', 'North', 88)],
    gamesRemainingByTeamId: remaining({ bram: 3, corvix: 3, delph: 3 }),
  });
  const race = locked.get('division:Platinum North');
  check('a ten-game lead with three to play is closed', race !== undefined, `got ${JSON.stringify(race)}`);
  check('and the winner is the leader', race?.winnerKey === 'bram', `got ${race?.winnerKey}`);
  check('the reason is an unreachable lead', race?.reason === 'unreachable_lead', `got ${race?.reason}`);
  check('the margin is games clear', race?.margin === 7, `expected 7, got ${race?.margin}`);
}

// -- 2. THE BOUNDARY: EXACTLY ONE MORE WIN THAN THE RIVAL CAN REACH ---------------------------
{
  /*
   * Leader 94 with 3 left. Rival 90 with 3 left can reach 93. 94 > 93, so the leader is safe even
   * losing every remaining game, and the margin is exactly one game.
   *
   * This case originally used 90 against 89, which is NOT a boundary: a leader on 90 sits three wins
   * short of the rival's 92 ceiling, so the division is genuinely still open and the function was
   * right to leave it alone. The fixture was wrong, not the code -- which is the useful thing about a
   * failing assertion, since the first question is always whether the expectation was sound.
   */
  const locked = lockedRaces({
    teams: [club('bram', 'North', 94), club('corvix', 'North', 90)],
    gamesRemainingByTeamId: remaining({ bram: 3, corvix: 3 }),
  });
  const race = locked.get('division:Platinum North');
  check('a lead of exactly one reachable win IS closed', race !== undefined, `got ${JSON.stringify(race)}`);
  check('and the margin is 1 game clear', race?.margin === 1, `expected 1, got ${race?.margin}`);
}

// -- 2b. A LEADER STILL SHORT OF THE CEILING IS NOT CLOSED --------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 90), club('corvix', 'North', 89)],
    gamesRemainingByTeamId: remaining({ bram: 3, corvix: 3 }),
  });
  check(
    'a leader who could still be caught is not closed, even with three games left',
    locked.get('division:Platinum North') === undefined,
    `got ${JSON.stringify(locked.get('division:Platinum North'))}`,
  );
}

// -- 3. THE TIE, WHICH MUST NOT CLOSE ----------------------------------------------------------
{
  // Leader 90 with 3 left finishes 93. Rival 90 with 3 left also finishes 93. A tiebreaker decides.
  const locked = lockedRaces({
    teams: [club('bram', 'North', 90), club('corvix', 'North', 90)],
    gamesRemainingByTeamId: remaining({ bram: 3, corvix: 3 }),
  });
  check(
    'a tie does NOT close the division, because a tiebreaker decides it',
    locked.get('division:Platinum North') === undefined,
    `got ${JSON.stringify(locked.get('division:Platinum North'))}`,
  );
}

// -- 4. ONE GAME LEFT AND LEVEL -----------------------------------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 50), club('corvix', 'North', 50)],
    gamesRemainingByTeamId: remaining({ bram: 1, corvix: 1 }),
  });
  check('level with one game left is not decided', locked.get('division:Platinum North') === undefined);
}

// -- 5. NO STANDBINGS MEANS NO DIVISION CLOSURE -------------------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100), club('corvix', 'North', 1)],
    // gamesRemainingByTeamId deliberately absent: nothing to decide from.
  });
  check(
    'with no standings a division is never locked, not even an absurd one',
    locked.size === 0,
    `got ${JSON.stringify([...locked.entries()])}`,
  );
}

// -- 6. SEPARATE DIVISIONS AND LEAGUES DO NOT INTERFERE ------------------------------------------
{
  const locked = lockedRaces({
    teams: [
      club('bram', 'North', 100), club('corvix', 'North', 90),
      club('delph', 'South', 88), club('eska', 'South', 87),
      club('fen', 'North', 10, 'Prestige'), club('gwe', 'South', 10, 'Prestige'),
    ],
    gamesRemainingByTeamId: remaining({
      bram: 3, corvix: 3, delph: 3, eska: 3, fen: 3, gwe: 3,
    }),
  });
  check('only the decided division is closed', locked.has('division:Platinum North'));
  check(
    'the undecided division is left open',
    !locked.has('division:Platinum South'),
    'south is 88 v 87 with three each: level at the ceiling, so a tiebreaker decides',
  );
  check('the other league is untouched', !locked.has('division:Prestige North'));
  check('exactly one race is closed', locked.size === 1, `got ${locked.size}: ${[...locked.keys()].join(', ')}`);
}

// -- 6b. THE KEY SPELLING IS THE PRODUCTION ONE -------------------------------------------------
/*
 * Not a tautology. `lockedRaces` joins to the builders by string, and a case difference between the
 * standings key and the builder's key would leave every division open with a green suite. This
 * asserts the exact key production produces, with production's capitalisation.
 */
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100), club('corvix', 'North', 90)],
    gamesRemainingByTeamId: remaining({ bram: 3, corvix: 3 }),
  });
  check(
    "the key is 'division:Platinum North', matching what groupMarkets emits",
    locked.has('division:Platinum North'),
    `got ${JSON.stringify([...locked.keys()])}`,
  );
  check('and NOT a lowercase spelling', !locked.has('division:platinum north'));
}

console.log('\nLOCKED RACES: LEAGUES AND THE TITLE, BY SERIES');

// -- 7. A FINISHED LEAGUE SERIES CLOSES THAT LEAGUE ---------------------------------------------
{
  // Best-of-seven: four wins takes it. 4-2.
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: [
      ...series('bram', 'corvix', 4, 'league_series', 'Platinum', 'plat-1'),
      ...series('corvix', 'bram', 2, 'league_series', 'Platinum', 'plat-1'),
    ],
  });
  const race = locked.get('league:Platinum');
  check('a completed league series closes that league', race !== undefined, `got ${JSON.stringify(race)}`);
  check('the series winner takes it', race?.winnerKey === 'bram', `got ${race?.winnerKey}`);
  check('the reason is a won series', race?.reason === 'series_won', `got ${race?.reason}`);
  check('the margin is the series margin', race?.margin === 2, `expected 2 for 4-2, got ${race?.margin}`);
  check(
    'the division race is NOT closed by the series',
    !locked.has('division:Platinum North'),
    'a series says nothing about who won the regular season',
  );
}

// -- 8. DECIDED ON THE FOURTH WIN, NOT AFTER THE SIXTH GAME ------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: series('bram', 'corvix', 4, 'league_series', 'Prestige', 'pre-1'),
  });
  const race = locked.get('league:Prestige');
  check('four wins closes the series immediately', race !== undefined && race.winnerKey === 'bram');
  check('and the margin is 4, because nobody has lost anything yet', race?.margin === 4,
    `expected 4, got ${race?.margin}`);
}

// -- 9. THREE TO TWO WITH A GAME IN HAND IS NOT DECIDED ----------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: [
      ...series('bram', 'corvix', 3, 'league_series', 'Platinum', 'plat-1'),
      ...series('corvix', 'bram', 2, 'league_series', 'Platinum', 'plat-1'),
    ],
  });
  check(
    '3-2 is not decided, because nobody has four wins',
    !locked.has('league:Platinum'),
    `got ${JSON.stringify(locked.get('league:Platinum'))}`,
  );
}

// -- 10. THE TITLE, AND ONLY THE TITLE ----------------------------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: [
      ...series('bram', 'fen', 4, 'world_series', 'GPB', 'ws-1'),
      ...series('fen', 'bram', 3, 'world_series', 'GPB', 'ws-1'),
    ],
  });
  const race = locked.get(WORLD_SERIES_MARKET_KEY);
  check('a finished world series closes the title', race !== undefined, `got ${JSON.stringify(race)}`);
  check('the champion is the series winner', race?.winnerKey === 'bram', `got ${race?.winnerKey}`);
  check('the margin is 1 for a 4-3', race?.margin === 1, `expected 1, got ${race?.margin}`);
  check(
    'no league is closed by a world series',
    !locked.has('league:GPB'),
    "the title market key is world_series:champion, and 'GPB' is not a league that exists",
  );
}

// -- 11. AN EARLIER ROUND NEVER CLOSES A FUTURES RACE -------------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: [
      ...series('bram', 'corvix', 2, 'wild_card', 'Platinum', 'wc-1'),
      ...series('bram', 'corvix', 3, 'divisional', 'Platinum', 'div-1'),
    ],
  });
  check(
    'a won wild-card or divisional series closes nothing on the board',
    locked.size === 0,
    `got ${JSON.stringify([...locked.entries()])}`,
  );
}

// -- 12. UNFINISHED GAMES DO NOT COUNT -----------------------------------------------------------
{
  const locked = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: [
      { ...seriesWin('bram', 'corvix', 'league_series', 'Platinum', 'plat-1'), status: 'scheduled' },
      { ...seriesWin('bram', 'corvix', 'league_series', 'Platinum', 'plat-1'), status: 'in_progress' },
      ...series('bram', 'corvix', 3, 'league_series', 'Platinum', 'plat-1'),
    ],
  });
  check(
    'scheduled and in-progress games are not wins',
    !locked.has('league:Platinum'),
    `got ${JSON.stringify(locked.get('league:Platinum'))}`,
  );
}

// -- 13. THE AWARD CASE IS NOT DECIDED HERE ------------------------------------------------------
/*
 * Awards are closed by `voting_open`, not by anything in this file, and the reason is the whole
 * difference between the two kinds of market: a division winner is arithmetic over a schedule, while
 * an MVP is decided by the model and the media rather than by play alone.
 *
 * Asserted as an absence so nobody "helpfully" adds award handling here later by reading a player
 * statistic as though it were a lead.
 */
{
  const locked = lockedRaces({ teams: [club('bram', 'North', 100)], games: [] });
  check(
    'nothing about an award race is decided by standings or series',
    ![...locked.keys()].some((key) => key.startsWith('award')),
    `got ${JSON.stringify([...locked.keys()])}`,
  );
}

// -- 14. VENUE ALTERNATION MUST NOT CHANGE THE RESULT -----------------------------------------
{
  const swept = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: alternating('bram', 'corvix', 4, 2, 'league_series', 'Platinum', 'plat-1'),
  });
  check(
    'an alternating-venue 4-2 is still a 4-2',
    swept.get('league:Platinum')?.margin === 2,
    `expected margin 2, got ${swept.get('league:Platinum')?.margin}`,
  );

  const undecided = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: alternating('bram', 'corvix', 3, 2, 'league_series', 'Platinum', 'plat-1'),
  });
  check(
    'an alternating-venue 3-2 is still UNDECIDED',
    !undecided.has('league:Platinum'),
    `got ${JSON.stringify(undecided.get('league:Platinum'))}`,
  );

  const awaySideWon = lockedRaces({
    teams: [club('bram', 'North', 100)],
    games: alternating('corvix', 'bram', 4, 1, 'league_series', 'Prestige', 'pre-1'),
  });
  check(
    'the away side can take the series, and is named',
    awaySideWon.get('league:Prestige')?.winnerKey === 'corvix',
    `got ${awaySideWon.get('league:Prestige')?.winnerKey}`,
  );
}

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
