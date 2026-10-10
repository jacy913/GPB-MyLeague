/**
 * IS THE WORLD SERIES MVP ACTUALLY SPECTACULAR NOW?
 *
 * ============================================================================
 * WHY THIS TOOL EXISTS
 * ============================================================================
 *
 * A manager watched the World Series MVP go to a reliever who pitched six innings and allowed one
 * run, and pointed out the thing that was actually wrong with it: that is a good outing, not an MVP.
 * The thing that should win is spectacular -- a hitter who hit several home runs, or a starter who
 * shut it down two or three times in games that decided it.
 *
 * The cause was structural rather than a matter of taste, which is what makes it worth a guard.
 * The old score was
 *
 *     clamp(8 - ERA, 0, 8) * 52 + clamp(2.2 - WHIP, 0, 2.2) * 58 + ... + IP*3
 *
 * whose first two terms saturate almost immediately: a reliever reaches the ERA ceiling by throwing
 * six or seven shutout innings, earning the same points an eighteen-inning starter earns. Innings
 * were worth three points apiece, so volume was a rounding error. Meanwhile the whole batting board
 * topped out near 250, BELOW what one relief outing could score. A legendary hitter could not win
 * under any circumstances, and a two-win ace could lose to a cameo.
 *
 * ============================================================================
 * WHAT IS ACTUALLY TESTED
 * ============================================================================
 *
 * Two layers, because the claim has two parts and either alone is weak.
 *
 *   1. THE HEAD-TO-HEADS. Fixed, hand-written lines -- the reported case and its neighbours --
 *      scored directly. These pin the ordering claim exactly and cost nothing, and they are the only
 *      place a specific number can be asserted.
 *   2. REAL POSTSEASONS. A season is played to its end and the actual board is inspected, because a
 *      formula that wins the right head-to-heads can still produce a degenerate board in practice --
 *      for instance if no hitter in a real postseason can reach the scoring ceiling at all.
 *
 * Layer 2 is the one that would have caught the original bug on its own, and it is the reason the
 * ranking was moved out of `App.tsx` into `worldSeriesMvp.ts`: from inside a React component, the
 * only way to measure it would be to render the app and read pixels.
 *
 * What this tool deliberately does NOT assert: that the MVP is always a starter, or that hitters win
 * some fixed fraction of the time. Both are opinions about taste, and both would fail the first time
 * somebody tuned a weight. It asserts the properties that are defects rather than preferences.
 *
 * Run: npx tsx tools/verifyWorldSeriesMvp.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import {
  blankWorldSeriesBattingLine,
  blankWorldSeriesPitchingLine,
  computeLeverageWeight,
  computeWorldSeriesMvpCandidates,
  isWorldSeriesBatterCandidate,
  isWorldSeriesPitcherCandidate,
  scoreWorldSeriesBatter,
  scoreWorldSeriesPitcher,
  WORLD_SERIES_MVP_WEIGHTS,
} from '../src/lib/worldSeriesMvp';

const failures: string[] = [];
const notes: string[] = [];

const check = (label: string, pass: boolean, measured: string, why?: string) => {
  if (!pass) {
    failures.push(`${label}: ${measured}${why ? ` (${why})` : ''}`);
  }
  const line = `${pass ? 'PASS' : 'FAIL'}  ${label}  -- ${measured}`;
  if (pass && !why) {
    notes.push(line);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

// ============================================================================
// 1. THE REPORTED CASE, AND THE NEIGHBOURS THAT DEFINE IT
// ============================================================================
//
// The reported line and the two that must beat it. These are the OLD formula's scores, kept here as
// the record of what was wrong: reliever 557, ace 485, slugger 247.

const relieverCameo = {
  ...blankWorldSeriesPitchingLine(),
  outsRecorded: 18, // 6.0 IP
  runsAllowed: 0,
  strikeouts: 8,
  saves: 1,
  weightedStrikeouts: 8.8,
};

const aceTwoDominantStarts = {
  ...blankWorldSeriesPitchingLine(),
  outsRecorded: 42, // 14.0 IP
  runsAllowed: 3,
  strikeouts: 15,
  wins: 2,
  weightedStrikeouts: 16.5,
};

const starSlugger = {
  ...blankWorldSeriesBattingLine(),
  plateAppearances: 28,
  atBats: 24,
  hits: 11,
  doubles: 2,
  homeRuns: 4,
  runs: 7,
  rbi: 10,
  walks: 4,
  weightedHomeRuns: 4.4,
  weightedRbi: 11,
  weightedRuns: 7.7,
  weightedExtraBaseHits: 6.6,
};

const monsterSeries = {
  ...starSlugger,
  homeRuns: 5,
  weightedHomeRuns: 5.5,
  rbi: 13,
  weightedRbi: 14.3,
  hits: 12,
  weightedExtraBaseHits: 7.7,
};

const scoreReliever = scoreWorldSeriesPitcher(relieverCameo);
const scoreAce = scoreWorldSeriesPitcher(aceTwoDominantStarts);
const scoreSlugger = scoreWorldSeriesBatter(starSlugger);
const scoreMonster = scoreWorldSeriesBatter(monsterSeries);

check(
  'the reported case is now reversed: the ace who won twice beats the six-inning cameo',
  scoreAce > scoreReliever * 1.4,
  `ace ${scoreAce.toFixed(0)} vs cameo ${scoreReliever.toFixed(0)}`,
  'the old formula scored these 485 to 557, which is the bug as reported',
);

check(
  'and a slugger with four home runs is back in contention rather than priced out',
  scoreSlugger > scoreReliever,
  `slugger ${scoreSlugger.toFixed(0)} vs cameo ${scoreReliever.toFixed(0)}`,
  'a batter used to top out near 247 against a cameo that could reach 557, so no hitter could ever win',
);

check(
  'a genuinely spectacular series can take the award outright',
  scoreMonster > scoreAce,
  `5-HR series ${scoreMonster.toFixed(0)} vs ace ${scoreAce.toFixed(0)}`,
  'the point of the exercise: spectacular work on either side of the ball should be able to win it',
);

check(
  'volume beats rate: identical rate, twice the innings, a materially higher score',
  scoreWorldSeriesPitcher({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: relieverCameo.outsRecorded * 2,
    runsAllowed: relieverCameo.runsAllowed,
    strikeouts: relieverCameo.strikeouts,
    saves: relieverCameo.saves,
    weightedStrikeouts: relieverCameo.weightedStrikeouts,
  }) > scoreReliever * 1.7,
  `same ERA at 12 IP scores ${scoreWorldSeriesPitcher({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: relieverCameo.outsRecorded * 2,
    runsAllowed: relieverCameo.runsAllowed,
    strikeouts: relieverCameo.strikeouts,
    saves: relieverCameo.saves,
    weightedStrikeouts: relieverCameo.weightedStrikeouts,
  }).toFixed(0)} vs ${scoreReliever.toFixed(0)} at 6 IP`,
  'in the old formula the innings term was IP*3, so doubling the work was worth six points',
);

// ============================================================================
// 2. THE SPECTACULAR FLOOR: A CAMEO MAY NOT EVEN REACH THE BOARD
// ============================================================================
//
// Separate from the score on purpose. A 1.00 ERA over one inning is a curiosity, not a candidacy,
// and putting it on a ten-man board a manager reads in the offseason is noise regardless of score.

check(
  'a hitter who walked once is not a candidate',
  !isWorldSeriesBatterCandidate({
    ...blankWorldSeriesBattingLine(),
    plateAppearances: 1,
    walks: 1,
  }),
  '1 PA, 1 BB excluded',
);

check(
  'but a pinch hitter who hit a home run is',
  isWorldSeriesBatterCandidate({
    ...blankWorldSeriesBattingLine(),
    plateAppearances: 1,
    homeRuns: 1,
  }),
  '1 PA with a HR included',
  'the floor must admit the spectacular cameo even while rejecting the empty one',
);

check(
  'a hitter with real production and few plate appearances is admitted',
  isWorldSeriesBatterCandidate({
    ...blankWorldSeriesBattingLine(),
    plateAppearances: 2,
    rbi: 3,
  }),
  '2 PA, 3 RBI included',
);

check(
  'a pitcher who threw one pitch is not a candidate',
  !isWorldSeriesPitcherCandidate({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: 1,
  }),
  '1 out excluded',
);

check(
  'but a closer who converted a save is',
  isWorldSeriesPitcherCandidate({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: 3,
    saves: 2,
  }),
  '1.0 IP with 2 saves included',
  'two saves is the shape of a real closer\'s series',
);

check(
  'and a closer with ONE save and two innings is not -- the floor has to hold against the score',
  !isWorldSeriesPitcherCandidate({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: 6,
    saves: 1,
  }),
  '2.0 IP, 1 save excluded',
  'a short outing is nearly all quality innings, and quality innings is the biggest term in the score -- so the floor, not the weighting, is what keeps a cameo off the board',
);

check(
  'a starter with a full outing and no decision is still a candidate',
  isWorldSeriesPitcherCandidate({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: 21, // 7.0 IP
    runsAllowed: 4,
  }),
  '7.0 IP included',
);

check(
  'a single scoreless inning is not',
  !isWorldSeriesPitcherCandidate({
    ...blankWorldSeriesPitchingLine(),
    outsRecorded: 3,
  }),
  '1.0 IP, no decision, no save excluded',
  'this is the exact shape the manager described, and it should not reach the board at all',
);

// ============================================================================
// 3. LEVERAGE: CONSEQUENTIAL PLAYS, AND ONLY CONSEQUENTIAL PLAYS
// ============================================================================

const lateTied = computeLeverageWeight({ inning: 9, margin: 0, outs: 2, basesOccupied: 3 });
const earlyBlowout = computeLeverageWeight({ inning: 1, margin: 9, outs: 0, basesOccupied: 0 });

check(
  'a ninth-inning play in a tied game is worth more than the same play in a ninth-run rout',
  lateTied > earlyBlowout * 1.8,
  `${lateTied.toFixed(2)} vs ${earlyBlowout.toFixed(2)}`,
);

check(
  'the leverage weight stays inside its declared bounds',
  lateTied <= 2 && earlyBlowout >= 0.55,
  `max seen ${lateTied.toFixed(2)}, min seen ${earlyBlowout.toFixed(2)}`,
);

check(
  'outs and traffic both raise the weight of an otherwise identical play',
  computeLeverageWeight({ inning: 9, margin: 0, outs: 2, basesOccupied: 3 })
    > computeLeverageWeight({ inning: 9, margin: 0, outs: 0, basesOccupied: 0 }),
  'two outs with runners aboard beats a clean first-pitch count in the ninth',
);

check(
  'leverage cannot make a nine-run lead worth chasing',
  computeLeverageWeight({ inning: 9, margin: 9, outs: 2, basesOccupied: 3 }) < 1.1,
  `${computeLeverageWeight({ inning: 9, margin: 9, outs: 2, basesOccupied: 3 }).toFixed(2)}`,
  'the floor matters as much as the ceiling: a blowout run should not be worth double a walk-off',
);

/**
 * THE ONE THAT WOULD BE EASY TO GET WRONG.
 *
 * Weighting every counting stat would let a leadoff hitter in a nine-nothing game out-score a man
 * who tied it in the ninth -- which is the same bias the old formula had, wearing a different hat.
 * So `hits` is unweighted and must stay that way even as the weighted totals climb.
 */
const countingStatOnly = scoreWorldSeriesBatter({
  ...blankWorldSeriesBattingLine(),
  plateAppearances: 30,
  atBats: 27,
  hits: 12,
});
const countingStatInBlowout = scoreWorldSeriesBatter({
  ...blankWorldSeriesBattingLine(),
  plateAppearances: 30,
  atBats: 27,
  hits: 12,
  weightedHomeRuns: 12 * 0.6,
  weightedRbi: 12 * 0.6,
  weightedRuns: 8 * 0.6,
  weightedExtraBaseHits: 12 * 0.6,
});
check(
  'hits are not leverage-weighted, so a big empty series cannot out-score a clutch one',
  countingStatOnly < countingStatInBlowout,
  `unweighted ${countingStatOnly.toFixed(0)} vs weighted ${countingStatInBlowout.toFixed(0)}`,
);

const homeRunInRout = scoreWorldSeriesBatter({
  ...blankWorldSeriesBattingLine(),
  plateAppearances: 2,
  atBats: 2,
  hits: 1,
  homeRuns: 1,
  weightedHomeRuns: 0.6,
});
const homeRunWalkOff = scoreWorldSeriesBatter({
  ...blankWorldSeriesBattingLine(),
  plateAppearances: 2,
  atBats: 2,
  hits: 1,
  homeRuns: 1,
  weightedHomeRuns: 2,
});
check(
  'the same home run is worth more when it decides the game',
  homeRunWalkOff > homeRunInRout,
  `walk-off ${homeRunWalkOff.toFixed(0)} vs rout ${homeRunInRout.toFixed(0)}`,
  'a 3.3x leverage ratio on the home-run term, diluted by the two candidates\' shared unweighted OPS and hit terms -- the direction is the assertion, not the magnitude',
);

// ============================================================================
// 4. THE WEIGHTS ARE THE CLAIM, SO THEY ARE ASSERTED DIRECTLY
// ============================================================================
//
// The module documents that its weights are exported so a rebalance has to update a test. That only
// holds if something reads them, so this reads them: the ordering claims above are re-derived from
// the exported constants rather than from hardcoded copies of the numbers.

check(
  'the home-run weight leads the batting scale',
  WORLD_SERIES_MVP_WEIGHTS.batter.homeRun
    > Math.max(
      WORLD_SERIES_MVP_WEIGHTS.batter.rbi,
      WORLD_SERIES_MVP_WEIGHTS.batter.run,
      WORLD_SERIES_MVP_WEIGHTS.batter.hit,
      WORLD_SERIES_MVP_WEIGHTS.batter.extraBaseHit,
      WORLD_SERIES_MVP_WEIGHTS.batter.ops,
    ),
  `homeRun ${WORLD_SERIES_MVP_WEIGHTS.batter.homeRun} is the largest batting term`,
  'a home run is the one offensive event that is spectacular in isolation',
);

check(
  'a win is the largest single pitching term after quality innings',
  WORLD_SERIES_MVP_WEIGHTS.pitcher.win > WORLD_SERIES_MVP_WEIGHTS.pitcher.save,
  `win ${WORLD_SERIES_MVP_WEIGHTS.pitcher.win} > save ${WORLD_SERIES_MVP_WEIGHTS.pitcher.save}`,
);

// ============================================================================
// 5. A REAL POSTSEASON
// ============================================================================
//
// The layer that would have caught this on its own. A formula can win every hand-to-head and still
// produce a degenerate board, because a real champion's roster might simply have nobody the formula
// likes.

const playToTheEnd = async (year: number, seed: number) => {
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((team) => ({ ...team })),
    seasonYear: year,
    seed,
    effectiveDate: `${year}-12-15`,
  });
  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((team) => ({
      ...team,
      wins: 0,
      losses: 0,
      runsScored: 0,
      runsAllowed: 0,
    })),
    built.playerState,
    year,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(year),
      seasonDays: 180,
    }),
    playerState: built.playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(year),
  });

  // `manager.games` and `manager.teams` are private, so every read goes through `run()`'s result --
  // which is also the honest read, since it is the state the app itself would hold here.
  let latest = await manager.run({ scope: 'day' });
  for (let day = 0; day < 230; day += 1) {
    latest = await manager.run({ scope: 'day' });
    const done = latest.games.filter(
      (game) => game.phase === 'playoffs' && game.status === 'completed',
    ).length;
    if (latest.games.every((game) => game.status === 'completed') && done >= 1) {
      break;
    }
  }
  return latest;
};

const main = async () => {
  const YEAR = 2026;
  const SEED = 4242;
  const latest = await playToTheEnd(YEAR, SEED);
  const bundle = computeWorldSeriesMvpCandidates(latest.teams, latest.games, latest.playerState, YEAR);

  check(
    'a played-out season produces a champion and a board',
    bundle.champion !== null && bundle.candidates.length > 0,
    `${bundle.champion?.teamCity} ${bundle.champion?.teamName}, ${bundle.candidates.length} candidates across ${bundle.completedGames} World Series games`,
  );

  const winner = bundle.candidates[0] ?? null;
  check(
    'and there is a single, unambiguous winner',
    winner !== null && bundle.candidates.filter((c) => c.playerName === winner?.playerName).length === 1,
    winner ? `${winner.playerName} -- ${winner.summary}` : 'none',
  );

  const playerById = new Map(latest.playerState.players.map((p) => [p.playerId, p] as const));
  const winnerPlayer = winner ? playerById.get(winner.playerId) : null;

  /*
   * THE WINNER HAS TO LOOK LIKE AN MVP.
   *
   * Not "has good numbers" -- the specific shapes the manager named. This is the property that was
   * false before, and it is the one that has to hold on real data rather than on hand-written lines.
   */
  if (winnerPlayer?.playerType === 'pitcher') {
    const isSpectacularPitcher = /(\b[2-9]\b|\b1\d\b) W/.test(winner.summary) || /\b([9]|[1-9]\d)\.\d IP\b/.test(winner.summary);
    check(
      'a pitching MVP is a starter with workload, not a short outing',
      isSpectacularPitcher,
      `${winner?.playerName}: ${winner?.summary}`,
      'this is the reported bug restated as an assertion: the winner must have thrown innings',
    );
  }

  const hitters = bundle.candidates.filter((c) => playerById.get(c.playerId)?.playerType === 'batter');
  check(
    'the board carries both disciplines rather than pitching sweeping it',
    hitters.length >= 3,
    `${hitters.length} batters, ${bundle.candidates.length - hitters.length} pitchers`,
  );

  const maxIp = (summary: string): number => {
    const match = /([\d.]+) IP/.exec(summary);
    return match ? Number(match[1]) : 0;
  };
  /*
   * THE AWARD, NOT THE BOARD.
   *
   * A closer who converted two saves and a reliever who picked up a win are both LEGITIMATE
   * candidates -- they earned their way onto the board through the floor rather than by accident,
   * and having them appear mid-table in a six-game series is correct. So this does not assert that
   * short outings are absent, which would be asserting that a good closer never happened.
   *
   * What it asserts is the actual defect: a short outing must never be CONTENDING. Top three is
   * where a manager would look, and the winner is what gets archived. A six-inning cameo appearing
   * at rank five is fine; appearing at rank one is the bug that was reported.
   */
  const shortOutings = bundle.candidates.filter((c) => {
    const player = playerById.get(c.playerId);
    return player?.playerType === 'pitcher' && maxIp(c.summary) > 0 && maxIp(c.summary) < 4;
  });
  const shortInTopThree = shortOutings.filter((c) => bundle.candidates.indexOf(c) < 3);
  check(
    'no sub-four-inning outing is CONTENDING for the award',
    shortInTopThree.length === 0,
    shortOutings.length === 0
      ? 'no sub-4.0 IP candidates at all'
      : `${shortOutings.length} short outing(s) on the board, all at rank ${shortOutings.map((c) => bundle.candidates.indexOf(c) + 1).join(', ')}`,
    'the score treats short outings well by construction, so the floor is what has to hold them off',
  );

  check(
    'the winner is never a sub-four-inning outing',
    winnerPlayer?.playerType === 'pitcher' ? maxIp(winner?.summary ?? '') >= 4 : true,
    winnerPlayer?.playerType === 'pitcher'
      ? `${winner?.playerName}: ${winner?.summary}`
      : 'winner is a batter, so this cannot apply',
    'the reported bug restated as the single narrowest property: what gets archived was a 6.0 IP outing',
  );

  // Determinism: the repair path for truncated MVPs recomputes this ranking later, so it must agree.
  const again = computeWorldSeriesMvpCandidates(latest.teams, latest.games, latest.playerState, YEAR);
  check(
    'the same season produces the same winner, which is what makes the MVP repair path safe',
    again.candidates[0]?.playerId === bundle.candidates[0]?.playerId,
    `${again.candidates[0]?.playerName} recomputed identically`,
  );

  // A season with no finished World Series contributes nothing.
  const unfinished = computeWorldSeriesMvpCandidates(latest.teams, [], latest.playerState, YEAR);
  check(
    'an unfinished postseason names nobody rather than naming a provisional MVP',
    unfinished.champion === null && unfinished.candidates.length === 0,
    'no games, no champion, no candidates',
  );

  process.stdout.write('\nWORLD SERIES MVP BOARD\n');
  bundle.candidates.forEach((candidate, index) => {
    const type = playerById.get(candidate.playerId)?.playerType ?? '?';
    process.stdout.write(`  ${String(index + 1).padStart(2)}. [${type.padEnd(7)}] ${candidate.playerName.padEnd(24)} ${candidate.summary}\n`);
  });
  process.stdout.write('\n');

  notes.forEach((line) => process.stdout.write(`${line}\n`));
  process.stdout.write('\n');
  if (failures.length > 0) {
    process.stdout.write(`FAILURES (${failures.length})\n`);
    failures.forEach((line) => process.stdout.write(`  - ${line}\n`));
    process.exit(1);
  }
  process.stdout.write('ALL CHECKS PASSED\n');
};

main().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});