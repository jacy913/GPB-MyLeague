/**
 * Does the playoff Monte Carlo actually simulate, and does it restore what it borrowed?
 *
 * ---------------------------------------------------------------------------
 * WHY THE STRUCTURAL INVARIANTS CARRY THIS CHECK
 * ---------------------------------------------------------------------------
 *
 * The fixture is random: `generateSchedule` shuffles clubs with `Math.random`, and the "already
 * played" games are scored by the engine. So no particular number here can be gated -- a hard-coded
 * expectation would fail at random, and a check that fails at random is worse than no check.
 *
 * Everything gated below is instead a property that MUST hold for every possible outcome of the
 * simulation. These come from the bracket's shape, not from tuning, and they are exactly the
 * things that break when the seeding path, the bracket or the tally is wrong:
 *
 *   - Each league's make-playoff probabilities sum to EXACTLY 6. Six of sixteen clubs make.
 *     A wrong field size, a duplicated club, or a tally that counts the same club twice all break
 *     this immediately, and none of them would be obvious by eye in a table of 32 probabilities.
 *
 *   - winLeague sums to EXACTLY 2 across the league. One champion per league.
 *
 *   - championship sums to EXACTLY 1 across all 32. One champion, worldwide.
 *
 *   - championship <= winLeague <= makePlayoff, per club. Structural: you cannot win the title
 *     without winning the league, and you cannot win the league without making the postseason. A
 *     violation means the tiers are being tallied against the wrong condition.
 *
 * These four are the reason the module is trustworthy, and they are unfixable-by-coincidence:
 * they are equalities, not ranges.
 *
 * ---------------------------------------------------------------------------
 * THE DETERMINISM CLAIM, WHICH IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 *
 * The result is cached by `(season, date)`. That cache is only legitimate if the same input gives
 * the same output, so determinism is asserted directly: two runs, same seed, compared exactly.
 *
 * And the flip side is asserted too, because determinism can be faked by an output that does not
 * depend on the seed at all -- a constant would pass a naive "same seed, same answer" check while
 * being a completely dead simulation. So a DIFFERENT seed must give a different answer. Together
 * the two pin the behaviour down from both sides.
 *
 * ---------------------------------------------------------------------------
 * THE SAFETY PROPERTY
 * ---------------------------------------------------------------------------
 *
 * `withSeededRandom` swaps the global `Math.random`. If it failed to restore, every later draw in
 * the running application -- dice rolls, UI jitter, anything -- would silently come from a dead
 * seeded generator, and the corruption would outlive the exception that caused it. Both the normal
 * return and the throw path are checked, by function identity.
 *
 * Run: npx tsx tools/checkPlayoffMonteCarlo.ts [trials]
 */

import {
  DEFAULT_TRIALS,
  PLAYOFF_FIELD_SIZE,
  playoffMonteCarlo,
  sanitisedPlayoffOdds,
  withSeededRandom,
  type MonteCarloInput,
  type PlayoffOdds,
} from '../src/lib/analytics/playoffMonteCarlo';
import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate, simulateGame } from '../src/logic/simulation';
import type { Game, Team } from '../src/types';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const YEAR = 2026;

/**
 * A seeded generator for the FIXTURE only.
 *
 * The module under test seeds its own stream; this one exists so the check reports the same
 * numbers on every run. It is deliberately duplicated from the module rather than imported -- a
 * check that reuses the code it is checking inherits its bugs instead of catching them. The
 * trade is four lines of duplication, and the check asserts determinism independently.
 */
const fixtureRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * A real league, part-way through a real season.
 *
 * Real on purpose: `INITIAL_TEAMS` carries the actual division and league assignment, and
 * `generateSchedule` carries the actual home/away pattern. A synthetic 32-team fixture would
 * happily pass every invariant below while the real bracket was mispaired, because the invariants
 * only know that SIX clubs make -- not that the right six do.
 */
const buildFixture = (seed: number, playedCount: number): MonteCarloInput & { teams: Team[] } => {
  const teams: Team[] = INITIAL_TEAMS.map((t) => ({
    ...t,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  }));
  const schedule = generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
  });

  const played: Game[] = [];
  const remaining: Game[] = [];
  const original = Math.random;
  Math.random = fixtureRandom(seed);
  try {
    schedule.forEach((game, index) => {
      if (index >= playedCount) {
        remaining.push({ ...game });
        return;
      }
      const home = teams.find((t) => t.id === game.homeTeam) as Team;
      const away = teams.find((t) => t.id === game.awayTeam) as Team;
      const result = simulateGame(home, away, DEFAULT_SETTINGS);
      played.push({ ...game, status: 'completed', score: { home: result.homeScore, away: result.awayScore } });
    });
  } finally {
    Math.random = original;
  }

  return { teams, playedGames: played, remainingGames: remaining, settings: DEFAULT_SETTINGS };
};

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
const near = (a: number, b: number, tolerance = 1e-9): boolean => Math.abs(a - b) <= tolerance;

const main = (): void => {
  const trials = Number(process.argv[2] ?? 400);
  // 620 of a 2464-game schedule, so each club is about 39 games in with 115 to go. Late enough for
  // run differential to have separated the leaders, early enough that the field is still open --
  // which is where a playoff probability is interesting rather than already decided.
  const fixture = buildFixture(20260401, 620);
  const playedCount = fixture.playedGames.length;
  const remainingCount = fixture.remainingGames.length;

  const base: MonteCarloInput = {
    teams: fixture.teams,
    playedGames: fixture.playedGames,
    remainingGames: fixture.remainingGames,
    settings: DEFAULT_SETTINGS,
    trials,
    seed: 4242,
  };

  const result = playoffMonteCarlo(base);
  const byId = new Map(result.odds.map((o) => [o.teamId, o]));

  // -- 1. the invariants. Equalities, not ranges -------------------------------------------
  for (const league of ['Platinum', 'Prestige'] as const) {
    const memberIds = new Set(fixture.teams.filter((t) => t.league === league).map((t) => t.id));
    const total = sum(result.odds.filter((o) => memberIds.has(o.teamId)).map((o) => o.makePlayoff));
    check(
      `${league} make-playoff probabilities sum to exactly ${PLAYOFF_FIELD_SIZE}`,
      near(total, PLAYOFF_FIELD_SIZE),
      `measured ${total.toFixed(9)} across ${memberIds.size} clubs. Anything but ${PLAYOFF_FIELD_SIZE} `
      + 'means the field is the wrong size, or a club is being tallied more than once.',
    );
  }

  const titleTotal = sum(result.odds.map((o) => o.championship));
  check(
    'championship probabilities sum to exactly 1 across all 32 clubs',
    near(titleTotal, 1),
    `measured ${titleTotal.toFixed(9)}. There is one champion; a total of 2 would mean both league `
    + 'champions were crowned, and a total of 0 would mean the World Series was never played.',
  );

  const leagueTitleTotal = sum(result.odds.map((o) => o.winLeague));
  check(
    'league-win probabilities sum to exactly 2 (one champion per league)',
    near(leagueTitleTotal, 2),
    `measured ${leagueTitleTotal.toFixed(9)}`,
  );

  const orderBreaks = result.odds.filter(
    (o) => o.championship > o.winLeague + 1e-12 || o.winLeague > o.makePlayoff + 1e-12,
  );
  check(
    'every club satisfies championship <= winLeague <= makePlayoff',
    orderBreaks.length === 0,
    orderBreaks.length === 0
      ? `checked ${result.odds.length} clubs`
      : `violations: ${orderBreaks.map((o) => `${o.teamId} (${o.makePlayoff.toFixed(3)} / ${o.winLeague.toFixed(3)} / ${o.championship.toFixed(3)})`).join(', ')}`,
  );

  const outOfRange = result.odds.filter((o) => [o.makePlayoff, o.winLeague, o.championship].some((p) => p < 0 || p > 1));
  check(
    'every probability lies inside [0, 1]',
    outOfRange.length === 0,
    outOfRange.length === 0 ? 'no probability outside the unit interval' : `${outOfRange.length} clubs outside`,
  );

  // -- 2. determinism, and the flip side of it ------------------------------------------------
  const again = playoffMonteCarlo(base);
  const identical = JSON.stringify(again.odds) === JSON.stringify(result.odds);
  check(
    'the same input and seed produce byte-identical odds (the (season, date) cache depends on this)',
    identical,
    identical
      ? `both runs of ${trials} trials agreed exactly on all ${result.odds.length} clubs`
      : 'two runs with identical input disagreed, so a cached probability would flicker between reads',
  );

  const different = playoffMonteCarlo({ ...base, seed: 909 });
  const moved = result.odds.some((o, i) => o.makePlayoff !== different.odds[i].makePlayoff);
  check(
    'a DIFFERENT seed produces different odds, so the output is a sample and not a constant',
    moved,
    moved
      ? 'sampling responds to its own generator'
      : 'odds were identical under two seeds -- either the generator is ignored or the simulation '
      + 'is not actually drawing, and a constant would have satisfied the determinism check above',
  );

  // -- 3. ratings actually reach the output ---------------------------------------------------
  /*
    Crank one club's rating far above the field and its odds must rise. Without this, the whole
    module could pass every structural invariant above while ignoring team strength entirely --
    the invariants constrain the SHAPE of the answer, never its dependence on the inputs.
   */
  const target = fixture.teams.reduce((a, b) => (b.rating > a.rating ? b : a), fixture.teams[0]);
  const pumped = playoffMonteCarlo({
    ...base,
    teams: fixture.teams.map((t) => (t.id === target.id ? { ...t, rating: t.rating + 400 } : t)),
    seed: 4242,
  });
  const pumpedOdds = pumped.odds.find((o) => o.teamId === target.id) as PlayoffOdds;
  const originalOdds = byId.get(target.id) as PlayoffOdds;
  check(
    'raising a club\'s rating by 400 strictly raises its championship probability',
    pumpedOdds.championship > originalOdds.championship,
    `${target.name} (rating ${target.rating.toFixed(1)}): title probability `
    + `${(originalOdds.championship * 100).toFixed(2)}% at its own rating, `
    + `${(pumpedOdds.championship * 100).toFixed(2)}% at +400.`,
  );

  // The same test on the other tail, because "raise the best club" can pass by accident if the
  // club was already certain. The WORST club must also move when cranked, which requires the
  // rating to reach the tally rather than merely riding the incumbent.
  const worst = fixture.teams.reduce((a, b) => (b.rating < a.rating ? b : a), fixture.teams[0]);
  const worstOriginal = byId.get(worst.id) as PlayoffOdds;
  const worstPumped = playoffMonteCarlo({
    ...base,
    teams: fixture.teams.map((t) => (t.id === worst.id ? { ...t, rating: t.rating + 400 } : t)),
    seed: 4242,
  }).odds.find((o) => o.teamId === worst.id) as PlayoffOdds;
  check(
    'the same holds for the WORST club, so it is not just the incumbent moving',
    worstPumped.championship > worstOriginal.championship,
    `${worst.name} (rating ${worst.rating.toFixed(1)}): `
    + `${(worstOriginal.championship * 100).toFixed(2)}% -> ${(worstPumped.championship * 100).toFixed(2)}%`,
  );

  // -- 4. the exhausted season ---------------------------------------------------------------
  /*
    Nothing left to play means every trial is identical, so the odds must be 0 or 1 and the clubs
    currently in the field must be at 1. This is the offseason case, and it is also the case that
    exposes a division by zero in the series simulation.
   */
  const done = playoffMonteCarlo({ ...base, remainingGames: [], trials: 50, seed: 7 });
  const fractional = done.odds.filter((o) => o.makePlayoff !== 0 && o.makePlayoff !== 1);
  check(
    'with no games remaining, every probability is exactly 0 or 1',
    fractional.length === 0 && done.exhausted,
    `${fractional.length} clubs held a fractional probability with nothing left to simulate. `
    + `exhausted flag reported as ${done.exhausted}.`,
  );
  const champsAtOne = done.odds.filter((o) => o.championship === 1);
  const titleCandidates = done.odds.filter((o) => o.championship > 0);
  /*
    A club with the regular season finished but the playoffs unplayed should NOT sit at 100% to win
    the title -- and the first version of this check asserted exactly that, and failed.

    It was wrong for an obvious reason that took a second look: "no remaining games" means the
    REGULAR SEASON is complete, and there are still nineteen playoff games to play out. The champion
    really is uncertain, so a fractional probability is the right answer and 100% would have been
    the bug. The failing check was the wrong assertion, not the module.

    What actually holds, and what is worth gating, is the structural fact underneath: only clubs
    holding a playoff position can lift the trophy, so no club outside the twelve seeds may have any
    chance at all. That is implied by the tier ordering above but stated separately here because it
    is the thing that would break first if the championship tally were pointed at the wrong
    condition -- and it is checkable without asserting a number nobody can derive.
   */
  check(
    'with the regular season over, only clubs in the twelve playoff positions can win the title',
    titleCandidates.length <= 12
      && titleCandidates.every((o) => o.makePlayoff === 1)
      && champsAtOne.length === 0,
    `${titleCandidates.length} clubs hold any title chance, all of them seeded `
    + `(${titleCandidates.every((o) => o.makePlayoff === 1) ? 'confirmed' : 'NO -- an unseeded club can win the title'}); `
    + `${champsAtOne.length} at a flat 100%, which would mean the bracket was never played out.`,
  );

  // -- 5. the global is handed back -----------------------------------------------------------
  const before = Math.random;
  playoffMonteCarlo({ ...base, trials: 5 });
  check(
    'Math.random is the same function after a normal return',
    Math.random === before,
    Math.random === before ? 'restored' : 'THE GLOBAL WAS NOT RESTORED. Every later draw in the app would come from a dead seeded generator.',
  );

  let threw = false;
  try {
    withSeededRandom(fixtureRandom(1), () => {
      throw new Error('deliberate');
    });
  } catch {
    threw = true;
  }
  check(
    'Math.random is the same function after the body THROWS',
    Math.random === before && threw,
    threw
      ? (Math.random === before
        ? 'restored in the finally; an exception mid-simulation cannot leave the app drawing from a dead generator'
        : 'THE GLOBAL WAS NOT RESTORED AFTER A THROW. This is the corruption that outlives the error.')
      : 'the deliberate throw did not propagate, so the finally path was never exercised and this check proves nothing',
  );

  const stillRandom = Math.random();
  check(
    'and the restored generator still produces a genuine random draw',
    stillRandom >= 0 && stillRandom < 1 && stillRandom !== before(),
    `drew ${stillRandom.toFixed(6)} after restoration`,
  );

  // -- 6. the sanitiser is not quietly correcting anything ------------------------------------
  /*
    `sanitisedPlayoffOdds` clamps and enforces the tier ordering. If it were CHANGING real output
    then the raw module would be producing numbers the check above never saw. On valid input it
    must be an exact identity, and that is the only claim made for it.
   */
  const sanitised = result.odds.map(sanitisedPlayoffOdds);
  const unchanged = sanitised.every((o, i) => JSON.stringify(o) === JSON.stringify(result.odds[i]));
  check(
    'the sanitiser leaves every valid probability untouched, so it is a guard and not a fudge',
    unchanged,
    unchanged
      ? 'no probability was clamped or reordered'
      : 'the sanitiser altered real output, meaning the raw numbers above were never the ones a caller would read',
  );

  // -- report ----------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  const leaders = [...result.odds].sort((a, b) => b.makePlayoff - a.makePlayoff).slice(0, 5);
  const standardError = Math.sqrt(0.25 / trials);

  console.log('\nPLAYOFF MONTE CARLO\n');
  console.log('  fixture      ' + INITIAL_TEAMS.length + ' clubs, ' + playedCount + ' games played, '
    + remainingCount + ' remaining');
  console.log('  trials       ' + trials + ' (production default ' + DEFAULT_TRIALS + ')');
  console.log('  seed         ' + base.seed);
  console.log('  sampling SE  ' + (standardError * 100).toFixed(2) + '% at p=0.5 -- the honest resolution of this method\n');
  console.log('  top five by chance of reaching the postseason:');
  leaders.forEach((o) => {
    const t = fixture.teams.find((x) => x.id === o.teamId) as Team;
    console.log('    ' + t.name.padEnd(22) + ' make ' + (o.makePlayoff * 100).toFixed(1).padStart(5)
      + '%   league ' + (o.winLeague * 100).toFixed(1).padStart(5)
      + '%   title ' + (o.championship * 100).toFixed(1).padStart(5) + '%');
  });
  console.log('');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();
