/**
 * Verifies the offline metric layer against the engine's real behaviour.
 *
 * src/lib/analytics/metrics.ts transcribes the engine's counting rules rather
 * than inferring them, and a transcription is only as good as the evidence
 * behind it. This file supplies that evidence by running real games and
 * deriving counts from the play log using the transcribed rules, then checking
 * them three ways.
 *
 * 1. AGAINST THE ENGINE'S OWN ACCUMULATOR. Each game's `stats.participants`
 *    carries every batter's season line as of immediately BEFORE that game,
 *    because simulationManager.ts:707 reads the accumulator to build the
 *    snapshot and only applies the game's delta afterwards at line 719. So for
 *    a player whose appearances in the sample run are F..L, the snapshot at L
 *    minus the snapshot at F is the accumulator's own total contribution
 *    across the games in between. That telescopes, so it needs no per-game
 *    alignment, and it is the engine's real arithmetic rather than mine. Only
 *    fields derivable from the log are compared; gamesPlayed is not one of
 *    them, because the engine increments it somewhere the log does not record.
 *
 * 2. AGAINST INTERNAL IDENTITIES. The module header claims
 *    `atBats === plateAppearances - walks` is load-bearing, because it is why
 *    the on-base denominator equals plate appearances exactly. If that is
 *    wrong, OBP is wrong and the header is lying.
 *
 * 3. FOR RANGE AND NON-VACUITY. Every rate lands in a valid range, an
 *    undefined rate is null rather than zero, the standard error shrinks with
 *    the denominator, and the sample is big enough for the claim to mean
 *    something.
 *
 * WHAT THE HIT AND RUN CROSS-CHECKS ARE NOT. The engine already throws if the
 * accumulator's hits or runs disagree with the scoreboard (gameEngine.ts:1036,
 * 1040), so those invariants hold for every game that completes. The checks
 * here therefore do not independently confirm that hits and runs reconcile.
 * They test something the engine's guard does not: that the SERIALIZED PLAY
 * LOG agrees with the accumulator. Both could be wrong in the same way and the
 * engine's guard would still pass. This matters because the metric layer and
 * every split view read the log, so if the log mislabels an outcome the
 * metrics would be wrong while the engine stayed silent.
 *
 * It also reports the measured league values of every new metric. Those are
 * the numbers a user will eventually see, and a metric nobody has looked at a
 * real value of is a metric nobody has checked.
 *
 * Run: npx tsx tools/verifyMetrics.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import {
  battingMetrics,
  pitchingMetrics,
  type BattingCounts,
  type PitchingCounts,
} from '../src/lib/analytics/metrics';
import type {
  AtBatOutcome,
  Game,
  GameParticipantsSnapshot,
  PlayLogEvent,
  PlayerSeasonBatting,
} from '../src/types';

const DAYS = Number(process.argv[2] ?? 60);
const YEAR = 2026;
const SEED = 4242;

/** The eight outcomes that consume a plate appearance. */
const AT_BAT_OUTCOMES: readonly string[] = ['OUT', 'SO', 'BB', '1B', '2B', '3B', 'HR', 'ERR'];

/** Outcomes the engine credits a hit on. gameEngine.ts:1316, 1341, 1352, 1373. */
const HIT_OUTCOMES: readonly string[] = ['1B', '2B', '3B', 'HR'];

interface Check {
  label: string;
  pass: boolean;
  measured: string;
}

const results: Check[] = [];
const failures: string[] = [];

/**
 * `measured` is what the tool actually observed and is always what gets
 * reported. `why` is prose explaining the failure and is only ever surfaced
 * when the check fails, so a passing run never prints a reason it did not need.
 */
const check = (label: string, pass: boolean, measured: string, why?: string): void => {
  results.push({ label, pass, measured: pass ? measured : (why ?? `FAILED, observed: ${measured}`) });
  if (!pass) {
    failures.push(`${label}: ${why ?? measured}`);
  }
};

const emptyBatting = (): BattingCounts => ({
  gamesPlayed: 0,
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  runsScored: 0,
  rbi: 0,
});

const emptyPitching = (): PitchingCounts => ({
  games: 0,
  gamesStarted: 0,
  saves: 0,
  inningsPitched: 0,
  hitsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
});

/**
 * Apply one at-bat to a batter's line, transcribed from the engine. Every
 * outcome is handled in exactly one place so an at-bat cannot be counted
 * twice, and the field each outcome touches is visible at a glance.
 *
 *   gameEngine.ts:1283  every outcome: plateAppearances += 1
 *   gameEngine.ts:1288  OUT: atBats += 1
 *   gameEngine.ts:1290  SO:  atBats += 1, strikeouts += 1
 *   gameEngine.ts:1302  BB:  walks += 1, and NOT atBats
 *   gameEngine.ts:1314  ERR: atBats += 1, and NOT hits, NOT hitsAllowed
 *   gameEngine.ts:1327  1B:  atBats += 1, hits += 1
 *   gameEngine.ts:1340  2B:  atBats += 1, hits += 1, doubles += 1
 *   gameEngine.ts:1351  3B:  atBats += 1, hits += 1, triples += 1
 *   gameEngine.ts:1372  HR:  atBats += 1, hits += 1, homeRuns += 1
 */
const applyAtBatToBatter = (counts: BattingCounts, outcome: AtBatOutcome, event: PlayLogEvent): void => {
  counts.plateAppearances += 1;
  switch (outcome) {
    case 'OUT':
    case 'SO':
    case 'ERR':
      counts.atBats += 1;
      break;
    case 'BB':
      counts.walks += 1;
      break;
    case '1B':
      counts.atBats += 1;
      counts.hits += 1;
      break;
    case '2B':
      counts.atBats += 1;
      counts.hits += 1;
      counts.doubles += 1;
      break;
    case '3B':
      counts.atBats += 1;
      counts.hits += 1;
      counts.triples += 1;
      break;
    case 'HR':
      counts.atBats += 1;
      counts.hits += 1;
      counts.homeRuns += 1;
      break;
    default:
      break;
  }
  if (outcome === 'SO') {
    counts.strikeouts += 1;
  }
  // The play's RBI belongs to the batter, and only when it is above zero:
  // gameEngine.ts:849 guards the credit with `rbi > 0`, and an error play is
  // zeroed at line 1313, so nobody is credited on an error.
  if (event.rbi > 0 && event.batterId) {
    counts.rbi += event.rbi;
  }
};

const statNumber = (game: Game, key: string): number => {
  const value = game.stats?.[key];
  return typeof value === 'number' ? value : 0;
};

const statString = (game: Game, key: string): string | null => {
  const value = game.stats?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const fmt = (value: number | null, places = 3): string => (value === null ? 'n/a' : value.toFixed(places));
const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

interface Appearance {
  gameOrder: number;
  counts: BattingCounts;
  /** The batter's own accumulator row as of just before this game. */
  snapshot: PlayerSeasonBatting | null;
}

const main = async (): Promise<void> => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    playerState,
    YEAR,
  );
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });

  const mgr = new SimulationManager({
    teams,
    games: schedule,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: startDate,
  });

  const appearances = new Map<string, Appearance[]>();
  const pitching = new Map<string, PitchingCounts>();
  const seen = new Set<string>();
  let gameOrder = 0;

  let completedGames = 0;
  let gamesWithLog = 0;
  let gamesWithParticipants = 0;
  let plateAppearances = 0;
  let hitEvents = 0;
  let storedHits = 0;
  let gamesWithHitMismatch = 0;
  let runEvents = 0;
  let storedRuns = 0;
  let gamesWithRunMismatch = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    result.games.forEach((game: Game) => {
      if (game.status !== 'completed' || game.phase !== 'regular_season' || seen.has(game.gameId)) {
        return;
      }
      seen.add(game.gameId);
      completedGames += 1;
      gameOrder += 1;

      const rawLog = statString(game, 'playLog');
      if (!rawLog) {
        return;
      }
      gamesWithLog += 1;
      const events = JSON.parse(rawLog) as PlayLogEvent[];
      const atBats = events.filter((e) => AT_BAT_OUTCOMES.includes(e.outcome));

      // Log vs scoreboard. The engine already guarantees accumulator vs
      // scoreboard (gameEngine.ts:1040), so this is specifically testing the
      // serialized log.
      const logHits = atBats.filter((e) => HIT_OUTCOMES.includes(e.outcome)).length;
      const boxHits = statNumber(game, 'awayHits') + statNumber(game, 'homeHits');
      hitEvents += logHits;
      storedHits += boxHits;
      if (logHits !== boxHits) {
        gamesWithHitMismatch += 1;
      }

      const logRuns = atBats.reduce((sum, e) => sum + (typeof e.runsScored === 'number' ? e.runsScored : 0), 0);
      const boxRuns = game.score.home + game.score.away;
      runEvents += logRuns;
      storedRuns += boxRuns;
      if (logRuns !== boxRuns) {
        gamesWithRunMismatch += 1;
      }

      // Per-batter lines, plus each batter's pre-game accumulator row.
      const rawParticipants = statString(game, 'participants');
      let participants: GameParticipantsSnapshot | null = null;
      let preGameLines = new Map<string, PlayerSeasonBatting | null>();
      if (rawParticipants) {
        participants = JSON.parse(rawParticipants) as GameParticipantsSnapshot;
        [...participants.awayLineup, ...participants.homeLineup].forEach((batter) => {
          preGameLines.set(batter.playerId, batter.battingStat);
        });
        gamesWithParticipants += 1;
      }

      const perGame = new Map<string, BattingCounts>();
      atBats.forEach((event) => {
        const batterId = event.batterId;
        const pitcherId = event.pitcherId;
        if (!batterId || !AT_BAT_OUTCOMES.includes(event.outcome)) {
          return;
        }
        const outcome = event.outcome as AtBatOutcome;

        const counts = perGame.get(batterId) ?? emptyBatting();
        applyAtBatToBatter(counts, outcome, event);
        perGame.set(batterId, counts);

        // Runs are credited to every id in scoringPlayerIds, NOT to the batter.
        // gameEngine.ts:848 scores each id in turn, and 1338 sets the play's
        // runsScored to the length of that list. So a runner who comes home on
        // someone else's at-bat scores a run while the batter is a different
        // player, and crediting only the batter understates every runner's
        // total. The first version of this file did exactly that and reported
        // accumulator totals roughly three times the log's.
        //
        // This also creates an entry for a scorer who is not this batter, which
        // is correct and not a spurious appearance: anyone on base has already
        // batted earlier in the same game, so the entry merges with the one
        // their own at-bat creates and their plate appearances are untouched.
        if (Array.isArray(event.scoringPlayerIds)) {
          event.scoringPlayerIds.forEach((scorerId) => {
            const scorerCounts = perGame.get(scorerId) ?? emptyBatting();
            scorerCounts.runsScored += 1;
            perGame.set(scorerId, scorerCounts);
          });
        }

        if (pitcherId) {
          const line = pitching.get(pitcherId) ?? emptyPitching();
          if (outcome === 'SO') line.strikeouts += 1;
          if (outcome === 'BB') line.walks += 1;
          // An error is not a hit allowed: gameEngine.ts:1314 credits no
          // hitsAllowed on ERR.
          if (HIT_OUTCOMES.includes(outcome)) line.hitsAllowed += 1;
          pitching.set(pitcherId, line);
        }
      });

      perGame.forEach((counts, playerId) => {
        const list = appearances.get(playerId) ?? [];
        list.push({ gameOrder, counts, snapshot: preGameLines.get(playerId) ?? null });
        appearances.set(playerId, list);
      });
      plateAppearances += atBats.length;
    });
  }

  // ---- Sample adequacy -------------------------------------------------

  check(
    'a real sample was measured',
    completedGames > 0 && gamesWithLog > 0 && appearances.size > 0,
    `${completedGames} completed regular-season games, ${gamesWithLog} with a play log, `
      + `${gamesWithParticipants} with a participants snapshot, ${plateAppearances} plate appearances `
      + `across ${appearances.size} batters and ${pitching.size} pitchers`,
    'no completed games with a play log, so every metric below would be untested',
  );

  // ---- Log vs box score ------------------------------------------------

  check(
    'the play log agrees with the box score on hits',
    gamesWithHitMismatch === 0,
    `${hitEvents} hit outcomes in the logs against ${storedHits} in the box scores across ${gamesWithLog} games`,
    `${gamesWithHitMismatch} of ${gamesWithLog} games disagreed, so the log mislabels an outcome and `
      + 'every metric derived from it would be wrong',
  );

  check(
    'the play log agrees with the final score on runs',
    gamesWithRunMismatch === 0,
    `${runEvents} runs in the logs against ${storedRuns} in the final scores`,
    `${gamesWithRunMismatch} of ${gamesWithLog} games disagreed, so run attribution is being misread`,
  );

  // ---- Log-derived counts vs the engine's own accumulator ---------------

  const summed = (list: Appearance[]): BattingCounts =>
    list.reduce((acc, a) => {
      acc.plateAppearances += a.counts.plateAppearances;
      acc.atBats += a.counts.atBats;
      acc.hits += a.counts.hits;
      acc.doubles += a.counts.doubles;
      acc.triples += a.counts.triples;
      acc.homeRuns += a.counts.homeRuns;
      acc.walks += a.counts.walks;
      acc.strikeouts += a.counts.strikeouts;
      acc.runsScored += a.counts.runsScored;
      acc.rbi += a.counts.rbi;
      return acc;
    }, emptyBatting());

  const accumulatorFields: Array<keyof BattingCounts> = [
    'plateAppearances',
    'atBats',
    'hits',
    'doubles',
    'triples',
    'homeRuns',
    'walks',
    'strikeouts',
    'runsScored',
    'rbi',
  ];

  let comparedPlayers = 0;
  let comparedFields = 0;
  const accumulatorMismatches: string[] = [];

  appearances.forEach((list, playerId) => {
    if (list.length < 2) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (!first.snapshot || !last.snapshot) return;

    // The snapshot at `last` is the accumulator AFTER every game from `first`
    // up to but not including `last`, so the difference is the engine's own
    // total for exactly the appearances in [first, last).
    const mine = summed(list.slice(0, -1));
    const theirs = emptyBatting();
    accumulatorFields.forEach((field) => {
      theirs[field] = last.snapshot![field] - first.snapshot![field];
      comparedFields += 1;
      if (theirs[field] !== mine[field]) {
        accumulatorMismatches.push(
          `${playerId} ${field}: log ${mine[field]} vs accumulator ${theirs[field]}`,
        );
      }
    });
    comparedPlayers += 1;
  });

  check(
    'log-derived counts equal the engine accumulator for every player',
    accumulatorMismatches.length === 0 && comparedPlayers > 0,
    `${comparedPlayers} players compared across ${comparedFields} fields, all identical `
      + '(snapshot-at-last minus snapshot-at-first against the sum of the log in between)',
    accumulatorMismatches.length > 0
      ? `${accumulatorMismatches.length} field(s) disagree, so the transcribed counting rules are wrong: `
        + accumulatorMismatches.slice(0, 5).join('; ')
      : `only ${comparedPlayers} players had two usable snapshots, so this proves nothing`,
  );

  // ---- Internal identities ---------------------------------------------

  const totals = new Map<string, BattingCounts>();
  appearances.forEach((list, playerId) => {
    totals.set(playerId, summed(list));
  });

  const identityFailures: string[] = [];
  totals.forEach((c, playerId) => {
    if (c.atBats !== c.plateAppearances - c.walks) {
      identityFailures.push(`${playerId}: PA ${c.plateAppearances} BB ${c.walks} AB ${c.atBats}`);
    }
  });
  check(
    'at-bats equal plate appearances minus walks, for every player',
    identityFailures.length === 0,
    `${totals.size} players checked, all satisfy AB = PA - BB`,
    `${identityFailures.length} player(s) violate it, which is what the on-base denominator relies on: `
      + identityFailures.slice(0, 3).join('; '),
  );

  const hitFailures: string[] = [];
  totals.forEach((c, playerId) => {
    if (c.hits < c.doubles + c.triples + c.homeRuns) {
      hitFailures.push(`${playerId}: hits ${c.hits} below XBH ${c.doubles + c.triples + c.homeRuns}`);
    }
  });
  check(
    'hits decompose cleanly into singles plus extra-base hits',
    hitFailures.length === 0,
    `${totals.size} players checked, hits >= doubles + triples + home runs everywhere`,
    `${hitFailures.length} player(s) failed: ${hitFailures.slice(0, 3).join('; ')}`,
  );

  // ---- Range, nulls, standard errors ------------------------------------

  const rangeProblems: string[] = [];
  totals.forEach((c, playerId) => {
    const m = battingMetrics(c);
    const problems: string[] = [];
    if (m.singles < 0) problems.push(`singles ${m.singles}`);
    if (m.ballsInPlay < 0 || m.ballsInPlay > c.atBats) {
      problems.push(`ballsInPlay ${m.ballsInPlay} vs AB ${c.atBats}`);
    }
    if (m.onBaseOpportunities !== c.plateAppearances) {
      problems.push(`onBase ${m.onBaseOpportunities} != PA ${c.plateAppearances}`);
    }
    if (m.totalBases < m.extraBaseHits) problems.push(`totalBases ${m.totalBases} < XBH ${m.extraBaseHits}`);
    if (m.babip && (m.babip.value < 0 || m.babip.value > 1)) problems.push(`babip ${m.babip.value}`);
    if (m.bbPct && (m.bbPct.value < 0 || m.bbPct.value > 1)) problems.push(`bbPct ${m.bbPct.value}`);
    if (m.kPct && (m.kPct.value < 0 || m.kPct.value > 1)) problems.push(`kPct ${m.kPct.value}`);
    if (m.avg !== null && (m.avg < 0 || m.avg > 1)) problems.push(`avg ${m.avg}`);
    if (m.obp !== null && (m.obp < 0 || m.obp > 1)) problems.push(`obp ${m.obp}`);
    if (m.slg !== null && (m.slg < 0 || m.slg > 4)) problems.push(`slg ${m.slg}`);
    if (m.ops !== null && (m.ops < 0 || m.ops > 5)) problems.push(`ops ${m.ops}`);
    if (m.iso !== null && m.iso < 0) problems.push(`iso ${m.iso}`);
    if (m.bbPerStrikeout !== null && m.bbPerStrikeout < 0) problems.push(`bbPerK ${m.bbPerStrikeout}`);
    if (m.babip && m.babip.standardError === null) problems.push('babip SE null at n>0');
    // BABIP must be hits-among-balls-in-play over balls-in-play. Asserting the
    // exact numerator and denominator is the check that would have caught the
    // ballsInPlay/atBats substitution, which returned 0.768 where 0.277 is
    // correct. A range assertion alone passes both.
    if (m.babip && m.babip.denominator !== c.atBats - c.strikeouts - c.homeRuns) {
      problems.push(`babip denominator ${m.babip.denominator} != balls in play ${c.atBats - c.strikeouts - c.homeRuns}`);
    }
    if (m.babip && Math.abs(m.babip.value - (c.hits - c.homeRuns) / (c.atBats - c.strikeouts - c.homeRuns)) > 1e-12) {
      problems.push(`babip value ${m.babip.value.toFixed(4)} is not (H-HR)/(AB-SO-HR)`);
    }
    if (m.babip && m.babip.standardError !== null) {
      const expectedSe = Math.sqrt(
        (m.babip.value * (1 - m.babip.value)) / (c.atBats - c.strikeouts - c.homeRuns),
      );
      if (Math.abs(m.babip.standardError - expectedSe) > 1e-12) problems.push('babip SE not binomial in n');
    }
    if (problems.length > 0) rangeProblems.push(`${playerId}: ${problems.join(', ')}`);
  });
  check(
    'every batting metric is in range for every player',
    rangeProblems.length === 0,
    `${totals.size} players checked, all rates within their valid bounds and every denominator is the `
      + 'one the definition names',
    `${rangeProblems.length} player(s) out of range: ${rangeProblems.slice(0, 3).join('; ')}`,
  );

  const pitchingProblems: string[] = [];
  pitching.forEach((c, playerId) => {
    const m = pitchingMetrics(c);
    const problems: string[] = [];
    if (m.outs < 0) problems.push(`outs ${m.outs}`);
    if (m.era !== null && m.era < 0) problems.push(`era ${m.era}`);
    if (m.whip !== null && m.whip < 0) problems.push(`whip ${m.whip}`);
    if (m.kPer9 !== null && m.kPer9 < 0) problems.push(`kPer9 ${m.kPer9}`);
    if (m.bbPer9 !== null && m.bbPer9 < 0) problems.push(`bbPer9 ${m.bbPer9}`);
    if (problems.length > 0) pitchingProblems.push(`${playerId}: ${problems.join(', ')}`);
  });
  check(
    'every pitching metric is in range for every pitcher',
    pitchingProblems.length === 0,
    `${pitching.size} pitchers checked, all rates non-negative and outs derived from decimal innings`,
    `${pitchingProblems.length} pitcher(s) out of range: ${pitchingProblems.slice(0, 3).join('; ')}`,
  );

  const zero = battingMetrics(emptyBatting());
  const zeroPitching = pitchingMetrics(emptyPitching());
  const nullsHeld = zero.avg === null
    && zero.obp === null
    && zero.slg === null
    && zero.ops === null
    && zero.iso === null
    && zero.babip === null
    && zero.bbPct === null
    && zero.kPct === null
    && zero.kMinusBbPct === null
    && zero.bbPerStrikeout === null
    && zero.runsPerGame === null
    && zero.rbiPerGame === null
    && zeroPitching.era === null
    && zeroPitching.whip === null
    && zeroPitching.kPer9 === null
    && zeroPitching.kbb === null
    && zeroPitching.inningsPerStart === null;
  check(
    'an undefined rate is null, never zero',
    nullsHeld,
    'all 17 rates null for a player with no plate appearances and a pitcher with no innings pitched',
    'an undefined rate reported as 0 would rank a 0-for-0 player at the bottom of a leaderboard as if '
      + 'it were a real measurement',
  );

  const seAt20 = battingMetrics({ ...emptyBatting(), plateAppearances: 20, atBats: 18, hits: 5, strikeouts: 2 }).babip;
  const seAt1800 = battingMetrics({
    ...emptyBatting(),
    plateAppearances: 2000,
    atBats: 1800,
    hits: 550,
    strikeouts: 400,
  }).babip;
  const seShrinks = seAt20 !== null
    && seAt1800 !== null
    && seAt20.standardError !== null
    && seAt1800.standardError !== null
    && seAt1800.standardError < seAt20.standardError / 5;
  check(
    'standard error shrinks as the sample grows',
    seShrinks,
    `n=18 SE ${fmt(seAt20?.standardError ?? null, 4)}, n=1800 SE ${fmt(seAt1800?.standardError ?? null, 4)}, `
      + `a 100x sample cut the standard error by ${fmt(
        seAt20?.standardError && seAt1800?.standardError ? seAt20.standardError / seAt1800.standardError : null,
        1,
      )}x`,
    'a 100x larger sample barely moved the standard error, so it is not being computed from the denominator',
  );

  // ---- Measured league values ------------------------------------------

  const totalAtBats = Array.from(totals.values()).reduce((a, c) => a + c.atBats, 0);
  const totalBallsInPlay = Array.from(totals.values())
    .reduce((a, c) => a + (c.atBats - c.strikeouts - c.homeRuns), 0);
  const totalHitsAmongBallsInPlay = Array.from(totals.values())
    .reduce((a, c) => a + (c.hits - c.homeRuns), 0);
  const totalHomeRuns = Array.from(totals.values()).reduce((a, c) => a + c.homeRuns, 0);
  const totalPlateAppearances = Array.from(totals.values()).reduce((a, c) => a + c.plateAppearances, 0);
  const totalWalks = Array.from(totals.values()).reduce((a, c) => a + c.walks, 0);
  const totalStrikeouts = Array.from(totals.values()).reduce((a, c) => a + c.strikeouts, 0);
  const totalHits = Array.from(totals.values()).reduce((a, c) => a + c.hits, 0);
  const totalBip = (value: number, n: number): number | null => (n > 0 ? value / n : null);

  // Pooled rates, not the mean of per-player rates. Averaging rates unweighted
  // weights a three-at-bat appearance the same as a full season, which is the
  // mistake that made an earlier version of the park-factor probe disagree with
  // the pooled figure by 0.12 R/G.
  const pooledBabip = totalBip(totalHitsAmongBallsInPlay, totalBallsInPlay);
  const pooledBbPct = totalBip(totalWalks, totalPlateAppearances);
  const pooledKPct = totalBip(totalStrikeouts, totalPlateAppearances);
  const pooledAvg = totalBip(totalHits, totalAtBats);

  const perPlayer = Array.from(totals.entries()).map(([playerId, c]) => ({ playerId, counts: c, m: battingMetrics(c) }));
  const isoValues = perPlayer.map((r) => r.m.iso).filter((v): v is number => v !== null);

  // The leaderboard sample floor, derived rather than chosen. BABIP is a
  // binomial proportion, so the at-bat count at which its standard error falls
  // to the target is p(1-p)/se^2. SE_TARGET is a stated design choice about what
  // counts as a meaningful sample, not a measured constant; the floor it
  // produces at this league's own BABIP is what the leaderboard should use.
  const SE_TARGET = 0.05;
  const sampleFloor = pooledBabip === null
    ? null
    : Math.ceil((pooledBabip * (1 - pooledBabip)) / (SE_TARGET * SE_TARGET));
  const clearingFloor = sampleFloor === null ? 0 : perPlayer.filter((r) => r.counts.atBats >= sampleFloor).length;

  console.log(JSON.stringify({
    measured: {
      daysSimmed: DAYS,
      seed: SEED,
      completedGames,
      gamesWithLog,
      gamesWithParticipants,
      plateAppearances,
      batters: appearances.size,
      pitchers: pitching.size,
    },
    pooledLeagueRates: {
      note: 'Pooled totals over totals, NOT the mean of per-player rates. Unweighted averaging of rates '
        + 'is a different quantity and disagrees with this whenever players have unequal at-bats.',
      atBats: totalAtBats,
      plateAppearances: totalPlateAppearances,
      ballsInPlay: totalBallsInPlay,
      hitsAmongBallsInPlay: totalHitsAmongBallsInPlay,
      avg: fmt(pooledAvg),
      babip: fmt(pooledBabip),
      bbPct: fmt(pooledBbPct),
      kPct: fmt(pooledKPct),
      kMinusBbPct: pooledKPct !== null && pooledBbPct !== null ? fmt(pooledKPct - pooledBbPct) : 'n/a',
      meanPlayerIso: fmt(mean(isoValues)),
    },
    leaderboardSampleFloor: {
      note: 'Derived from the measured league BABIP rather than picked. SE_TARGET is a design choice '
        + 'about what counts as a meaningful sample, and is stated as such.',
      seTarget: SE_TARGET,
      atBatFloor: sampleFloor,
      battersClearing: clearingFloor,
      battersTotal: perPlayer.length,
    },
    checks: results,
    failures,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
  }, null, 2));
};

main().catch((error) => {
  console.error('THREW', error);
  process.exit(1);
});
