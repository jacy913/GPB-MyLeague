/**
 * Stage 1: what happened in this game, with no opinion attached.
 *
 * Reads a game's derived lines and emits `GameEvent`s. Writes no prose, knows nothing
 * about reporters, and makes no choice about who covers what -- that is Stage 2's job
 * in `headlinerPipeline`. The separation is the architecture: a detector that also
 * wrote copy could not be reused by a second persona without rewriting the copy.
 *
 * THE LINES COME FROM `deriveGameLines`, not from a second parse of the play log. One
 * parser, one set of numbers -- see that function's docstring for why two parsers of
 * one play log is a real hazard and not a tidy-up.
 *
 * EVERY DECLARED `GameEventKind` IS EMITTED HERE. That is deliberate. `covers` is a
 * gate over emitted kinds, so a kind with no emitter leaves a persona silently
 * ineligible for it forever -- the same failure shape as an inert feedback loop, where
 * every aggregate looks healthy and nothing is happening. `EMITTABLE_KINDS` is exported
 * so a verifier can assert the two sets are equal rather than trusting this comment.
 *
 * THRESHOLDS ARE STATED, NOT INHERITED. The inline blocks in `headlineEngine.ts` pick
 * thresholds ad hoc and interleave them with prose. Each detector below names its own,
 * so a threshold can be argued with and the overlap between "what made a good anonymous
 * headline" and "what makes a good event" is a choice rather than an accident.
 */

import type { Game, Player, Team } from '../types';
import type { DerivedGameLines, GameShape } from './headlineEngine';
import { SEVERITY_BAND, type GameEvent, type GameEventKind, type HeadlineSlots } from './headliners';

/** A league rate with the spread needed to judge how surprising a night was. */
export interface RateBaseline {
  value: number;
  standardDeviation: number;
}

export interface LeagueRateBaselines {
  babip: RateBaseline;
  avg: RateBaseline;
  obp: RateBaseline;
  iso: RateBaseline;
  kPer9: RateBaseline;
  bbPer9: RateBaseline;
  /** Qualified single-game lines sampled, so a thin baseline is visible. */
  sampleSize: number;
}

/** Everything a detector is given, in one object so call sites read clearly. */
export interface HeadlinerEventInput {
  game: Game;
  shape: GameShape;
  derived: DerivedGameLines;
  teamsById: Map<string, Team>;
  playersById: Map<string, Player>;
  /**
   * Completed games on or before this one, newest first, INCLUDING this game.
   *
   * Three detectors cannot work from a single game: streaks need the team's run of
   * results, a debut needs to know the player was never here before, and a sustained
   * rate needs a window. Every scan is bounded -- see `HISTORY_SCAN_LIMIT`.
   */
  completedGamesDesc: readonly Game[];
  /** League rate baselines for the analyst. Null when they have not been built. */
  baselines: LeagueRateBaselines | null;
}

/** One detector's finding, before the shared fields are attached. */
interface Detection {
  kind: GameEventKind;
  severity: number;
  valence: GameEvent['valence'];
  slots?: HeadlineSlots;
  playerId?: string;
  teamId?: string;
}

type Detector = (input: HeadlinerEventInput) => Detection | null;

// ---------------------------------------------------------------------------
// Bounds, stated because they are real limitations
// ---------------------------------------------------------------------------

/**
 * How far back history detectors look.
 *
 * A correct debut check is "no earlier appearance anywhere in the league", which over a
 * season means parsing every completed game's play log -- far too expensive per game
 * per candidate player. The bound is honest about being a bound: a batter who debuted
 * 60 games ago and was never seen again is invisible to a 40-game window, so
 * `big_debut` will miss them. A missed debut is a smaller failure than a false one,
 * because a false debut invents a story about a player who has been in the league for
 * months.
 */
const HISTORY_SCAN_LIMIT = 40;

/** Streaks longer than this stop counting, for the same cost reason. */
const STREAK_SCAN_LIMIT = 20;

/**
 * How many standard deviations from a league mean counts as interesting.
 *
 * Two is the conventional threshold and is not tuned here. With a few hundred
 * qualified lines per season it is roughly the top couple of percent of nights, which
 * is about how often a newsroom should notice something.
 */
const ANOMALY_SIGMAS = 2;

/** Minimum at-bats before a single-game rate is worth an analyst's attention. */
const MIN_RATE_AT_BATS = 3;
/** Minimum at-bats across the window before a "sustained" claim is defensible. */
const MIN_SUSTAINED_AT_BATS = 40;

// ---------------------------------------------------------------------------
// Slot helpers -- every one reads the map the caller already has
// ---------------------------------------------------------------------------

const clubName = (input: HeadlinerEventInput, teamId: string): string => {
  const team = input.teamsById.get(teamId);
  return team ? `${team.city} ${team.name}` : 'the club';
};

const cityOf = (input: HeadlinerEventInput, teamId: string): string =>
  input.teamsById.get(teamId)?.city ?? 'Somewhere';

const ageOf = (input: HeadlinerEventInput, playerId: string | undefined): number | undefined =>
  playerId === undefined ? undefined : input.playersById.get(playerId)?.age;

/** The pitcher who threw the most innings for a side. */
const leaderPitcher = (
  input: HeadlinerEventInput,
  teamId: string,
): DerivedGameLines['pitchingLines'][number] | null =>
  input.derived.pitchingLines
    .filter((line) => line.teamId === teamId)
    .reduce<DerivedGameLines['pitchingLines'][number] | null>(
      (best, line) => (!best || line.outsRecorded > best.outsRecorded ? line : best),
      null,
    );

/** The hitter who did the most for a side, by total bases. */
const leaderBatter = (
  input: HeadlinerEventInput,
  teamId: string,
): DerivedGameLines['battingLines'][number] | null =>
  input.derived.battingLines
    .filter((line) => line.teamId === teamId)
    .reduce<DerivedGameLines['battingLines'][number] | null>((best, line) => {
      if (!best) return line;
      const power = (l: DerivedGameLines['battingLines'][number]) =>
        l.hits + l.doubles + 2 * l.triples + 3 * l.homeRuns;
      return power(line) > power(best) ? line : best;
    }, null);

/** Prior games, excluding this one, most recent first. */
const priorGames = (input: HeadlinerEventInput, limit = HISTORY_SCAN_LIMIT): Game[] =>
  input.completedGamesDesc
    .filter((entry) => entry.gameId !== input.game.gameId)
    .slice(0, limit);

/**
 * Every batter id seen in a set of games.
 *
 * A malformed log contributes nothing rather than clearing the set. That direction is
 * chosen deliberately: an unreadable prior game must not be able to manufacture a
 * debut.
 */
const battersSeenIn = (games: readonly Game[]): Set<string> => {
  const seen = new Set<string>();
  for (const entry of games) {
    const raw = typeof entry.stats.playLog === 'string' ? entry.stats.playLog : null;
    if (!raw) continue;
    try {
      for (const event of JSON.parse(raw) as Array<{ batterId?: string | null }>) {
        if (event.batterId) seen.add(event.batterId);
      }
    } catch {
      // Skip. See the note above.
    }
  }
  return seen;
};

/** Hits and at-bats per batter across a set of games. */
const battingTotalsIn = (
  games: readonly Game[],
): Map<string, { hits: number; atBats: number; name: string }> => {
  const totals = new Map<string, { hits: number; atBats: number; name: string }>();
  for (const entry of games) {
    const raw = typeof entry.stats.playLog === 'string' ? entry.stats.playLog : null;
    if (!raw) continue;
    try {
      const events = JSON.parse(raw) as Array<{
        batterId?: string | null;
        batterName?: string | null;
        outcome?: string;
      }>;
      for (const event of events) {
        if (!event.batterId) continue;
        if (event.outcome === 'HALF_END' || event.outcome === 'GAME_END' || event.outcome === 'PITCHING_CHANGE') {
          continue;
        }
        const row = totals.get(event.batterId) ?? { hits: 0, atBats: 0, name: event.batterName ?? 'Unknown' };
        if (event.outcome !== 'BB') row.atBats += 1;
        if (event.outcome === '1B' || event.outcome === '2B' || event.outcome === '3B' || event.outcome === 'HR') {
          row.hits += 1;
        }
        totals.set(event.batterId, row);
      }
    } catch {
      // Skip. A claim about a season cannot rest on a log we could not read.
    }
  }
  return totals;
};

const zScore = (value: number, baseline: RateBaseline): number =>
  baseline.standardDeviation > 0 ? (value - baseline.value) / baseline.standardDeviation : 0;

const clampSeverity = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/** Strip a leading zero the way every rate in the app is displayed: .317 not 0.317. */
const leadingDot = (value: number, digits: number): string => {
  const fixed = value.toFixed(digits);
  return fixed.startsWith('0.') ? fixed.slice(1) : fixed;
};

// ---------------------------------------------------------------------------
// Per-player detectors
// ---------------------------------------------------------------------------

/** A cycle is a single, a double, a triple and a home run in the same game. */
const detectCycle = (input: HeadlinerEventInput): Detection | null => {
  const line = input.derived.battingLines.find(
    (entry) => entry.singles > 0 && entry.doubles > 0 && entry.triples > 0 && entry.homeRuns > 0,
  );
  if (!line) return null;
  return {
    kind: 'cycle',
    severity: SEVERITY_BAND.historic - 3,
    valence: 'positive',
    playerId: line.playerId,
    teamId: line.teamId,
    slots: { PLAYER: line.playerName, TEAM: clubName(input, line.teamId) },
  };
};

/**
 * Three or more home runs. Three is the threshold because two is a good night rather
 * than a story, and the reporter needs a story.
 */
const detectMultiHomer = (input: HeadlinerEventInput): Detection | null => {
  let best: DerivedGameLines['battingLines'][number] | null = null;
  for (const line of input.derived.battingLines) {
    if (line.homeRuns >= 3 && (!best || line.homeRuns > best.homeRuns)) best = line;
  }
  if (!best) return null;
  return {
    kind: 'multi_homer',
    severity: Math.min(100, SEVERITY_BAND.significant + (best.homeRuns - 3) * 6),
    valence: 'positive',
    playerId: best.playerId,
    teamId: best.teamId,
    slots: { PLAYER: best.playerName, FIGURE: String(best.homeRuns), TEAM: clubName(input, best.teamId) },
  };
};

/** Eight or more driven in -- the traditional "carried the whole lineup" line. */
const detectRbiBarrage = (input: HeadlinerEventInput): Detection | null => {
  let best: DerivedGameLines['battingLines'][number] | null = null;
  for (const line of input.derived.battingLines) {
    if (line.rbi >= 8 && (!best || line.rbi > best.rbi)) best = line;
  }
  if (!best) return null;
  return {
    kind: 'rbi_barrage',
    severity: best.rbi >= 10 ? SEVERITY_BAND.notable : SEVERITY_BAND.notable - 6,
    valence: 'positive',
    playerId: best.playerId,
    teamId: best.teamId,
    slots: { PLAYER: best.playerName, FIGURE: String(best.rbi), TEAM: clubName(input, best.teamId) },
  };
};

/** Four hits is a story; five is a louder one and gets its own kind. */
const detectOnBaseMachine = (input: HeadlinerEventInput): Detection | null => {
  const line = input.derived.battingLines.find((entry) => entry.hits >= 4);
  if (!line) return null;
  return {
    kind: 'on_base_machine',
    severity: SEVERITY_BAND.moderate + 6,
    valence: 'positive',
    playerId: line.playerId,
    teamId: line.teamId,
    slots: { PLAYER: line.playerName, FIGURE: String(line.hits), TEAM: clubName(input, line.teamId) },
  };
};

const detectHitFury = (input: HeadlinerEventInput): Detection | null => {
  const line = input.derived.battingLines.find((entry) => entry.hits >= 5);
  if (!line) return null;
  return {
    kind: 'hit_fury',
    severity: SEVERITY_BAND.notable,
    valence: 'positive',
    playerId: line.playerId,
    teamId: line.teamId,
    slots: { PLAYER: line.playerName, FIGURE: String(line.hits), TEAM: clubName(input, line.teamId) },
  };
};

/** Fifteen strikeouts in one outing. */
const detectPitchingDome = (input: HeadlinerEventInput): Detection | null => {
  let best: DerivedGameLines['pitchingLines'][number] | null = null;
  for (const line of input.derived.pitchingLines) {
    if (line.strikeouts >= 15 && (!best || line.strikeouts > best.strikeouts)) best = line;
  }
  if (!best) return null;
  return {
    kind: 'pitching_dome',
    severity: Math.min(100, SEVERITY_BAND.notable + (best.strikeouts - 15) * 2),
    valence: 'positive',
    playerId: best.playerId,
    teamId: best.teamId,
    slots: { PLAYER: best.playerName, FIGURE: String(best.strikeouts), TEAM: clubName(input, best.teamId) },
  };
};

/**
 * Twenty-seven outs, nothing hit, nobody walked, one pitcher.
 *
 * Checked before `complete_game` because a perfect game is also a complete game, and
 * it is the better story.
 */
const detectPerfectGame = (input: HeadlinerEventInput): Detection | null => {
  if (input.shape.winnerPitcherCount !== 1) return null;
  const only = input.derived.pitchingLines.filter((line) => line.teamId === input.shape.winnerTeamId);
  if (only.length !== 1) return null;
  const line = only[0];
  if (line.hitsAllowed !== 0 || line.walks !== 0 || line.outsRecorded < 27) return null;
  return {
    kind: 'perfect_game',
    severity: 100,
    valence: 'positive',
    playerId: line.playerId,
    teamId: line.teamId,
    slots: { PLAYER: line.playerName, TEAM: clubName(input, line.teamId), OPPONENT: cityOf(input, input.shape.loserTeamId) },
  };
};

/**
 * Twenty-seven outs by one pitcher, with something hit.
 *
 * Separate from a perfect game because the two are different stories: domination with
 * no help, versus a shutout with an error in it.
 */
const detectCompleteGame = (input: HeadlinerEventInput): Detection | null => {
  if (input.shape.winnerPitcherCount !== 1) return null;
  const line = leaderPitcher(input, input.shape.winnerTeamId);
  if (!line || line.outsRecorded < 27) return null;
  if (line.hitsAllowed === 0 && line.walks === 0) return null;
  return {
    kind: 'complete_game',
    severity: SEVERITY_BAND.notable,
    valence: 'positive',
    playerId: line.playerId,
    teamId: line.teamId,
    slots: { PLAYER: line.playerName, TEAM: clubName(input, line.teamId), OPPONENT: cityOf(input, input.shape.loserTeamId) },
  };
};

/** Three or more pitchers used by the winning side. */
const detectStaffWins = (input: HeadlinerEventInput): Detection | null => {
  if (input.shape.winnerPitcherCount < 3) return null;
  const leader = leaderPitcher(input, input.shape.winnerTeamId);
  return {
    kind: 'staff_wins',
    severity: SEVERITY_BAND.significant - 4,
    valence: 'positive',
    playerId: leader?.playerId,
    teamId: input.shape.winnerTeamId,
    slots: {
      PLAYER: leader?.playerName,
      FIGURE: String(input.shape.winnerPitcherCount),
      TEAM: clubName(input, input.shape.winnerTeamId),
    },
  };
};

// ---------------------------------------------------------------------------
// Game-shape detectors
// ---------------------------------------------------------------------------

const detectNoHitter = (input: HeadlinerEventInput): Detection | null => {
  const noHitTeamId = input.shape.noHitOpponentId;
  if (!noHitTeamId) return null;
  const pitchingTeamId = noHitTeamId === input.game.awayTeam ? input.game.homeTeam : input.game.awayTeam;
  const leader = leaderPitcher(input, pitchingTeamId);
  return {
    kind: 'no_hitter',
    severity: 99,
    valence: 'positive',
    playerId: leader?.playerId,
    teamId: pitchingTeamId,
    slots: {
      PLAYER: leader?.playerName,
      TEAM: clubName(input, pitchingTeamId),
      OPPONENT: cityOf(input, noHitTeamId),
    },
  };
};

/** Nothing scored. A no-hitter is a better story and `detectNoHitter` reports it. */
const detectShutout = (input: HeadlinerEventInput): Detection | null => {
  const { game, shape } = input;
  const loserScore = shape.loserTeamId === game.awayTeam ? game.score.away : game.score.home;
  if (loserScore !== 0) return null;
  // 0-0 is not a shutout, it is a game that never happened.
  if (game.score.away === 0 && game.score.home === 0) return null;
  return {
    kind: 'shutout',
    severity: SEVERITY_BAND.negative + 6,
    valence: 'negative',
    teamId: shape.loserTeamId,
    slots: { TEAM: clubName(input, shape.loserTeamId), OPPONENT: cityOf(input, shape.winnerTeamId) },
  };
};

const detectBlowout = (input: HeadlinerEventInput): Detection | null => {
  const { game, shape } = input;
  const margin = Math.abs(game.score.away - game.score.home);
  if (margin < 7) return null;
  return {
    kind: 'blowout',
    severity: Math.min(100, SEVERITY_BAND.significant + Math.min(12, (margin - 7) * 2)),
    // A blowout is a positive story about the winner and a negative one about the
    // loser. Valence follows the winner, because that is whose story this is; the
    // hater gets his material from the loser's own events instead.
    valence: 'positive',
    teamId: shape.winnerTeamId,
    slots: {
      TEAM: clubName(input, shape.winnerTeamId),
      OPPONENT: cityOf(input, shape.loserTeamId),
      FIGURE: `${game.score.away}-${game.score.home}`,
    },
  };
};

/** Twenty or more runs combined. */
const detectScrapHeap = (input: HeadlinerEventInput): Detection | null => {
  const total = input.game.score.away + input.game.score.home;
  if (total < 20) return null;
  return {
    kind: 'scrap_heap',
    severity: Math.min(100, SEVERITY_BAND.significant + 4),
    valence: 'neutral',
    teamId: input.shape.winnerTeamId,
    slots: { FIGURE: String(total), TEAM: clubName(input, input.shape.winnerTeamId) },
  };
};

const detectOneRunGame = (input: HeadlinerEventInput): Detection | null => {
  const margin = Math.abs(input.game.score.away - input.game.score.home);
  if (margin !== 1) return null;
  return {
    kind: 'one_run_game',
    severity: SEVERITY_BAND.moderate,
    valence: 'neutral',
    teamId: input.shape.winnerTeamId,
    slots: {
      TEAM: clubName(input, input.shape.winnerTeamId),
      OPPONENT: cityOf(input, input.shape.loserTeamId),
      FIGURE: `${input.game.score.away}-${input.game.score.home}`,
    },
  };
};

const detectExtraInnings = (input: HeadlinerEventInput): Detection | null => {
  if (input.derived.extraInnings <= 9) return null;
  return {
    kind: 'extra_innings',
    severity: Math.min(100, SEVERITY_BAND.notable + (input.derived.extraInnings - 10) * 2),
    valence: 'neutral',
    teamId: input.shape.winnerTeamId,
    slots: { FIGURE: String(input.derived.extraInnings), TEAM: clubName(input, input.shape.winnerTeamId) },
  };
};

/** Three or more lead changes. Two is a game; three is a see-saw worth reporting. */
const detectMomentumSwing = (input: HeadlinerEventInput): Detection | null => {
  if (input.derived.leadChanges < 3) return null;
  return {
    kind: 'momentum_swing',
    severity: Math.min(100, SEVERITY_BAND.moderate + input.derived.leadChanges * 2),
    valence: 'neutral',
    teamId: input.shape.winnerTeamId,
    slots: { FIGURE: String(input.derived.leadChanges), TEAM: clubName(input, input.shape.winnerTeamId) },
  };
};

const detectWalkOff = (input: HeadlinerEventInput): Detection | null => {
  const name = input.derived.walkOffBatterName;
  if (!name) return null;
  return {
    kind: 'walk_off',
    severity: SEVERITY_BAND.notable + 4,
    valence: 'positive',
    teamId: input.shape.winnerTeamId,
    slots: {
      PLAYER: name,
      TEAM: clubName(input, input.shape.winnerTeamId),
      OPPONENT: cityOf(input, input.shape.loserTeamId),
      ARENA: cityOf(input, input.shape.winnerTeamId),
      FIGURE: `${input.game.score.away}-${input.game.score.home}`,
    },
  };
};

const detectUnderdogWin = (input: HeadlinerEventInput): Detection | null => {
  if (!input.shape.winnerWasUnderdog) return null;
  return {
    kind: 'underdog_win',
    severity: SEVERITY_BAND.moderate + 10,
    valence: 'positive',
    teamId: input.shape.winnerTeamId,
    slots: {
      TEAM: clubName(input, input.shape.winnerTeamId),
      OPPONENT: cityOf(input, input.shape.loserTeamId),
    },
  };
};

/**
 * The losing side trailed by six or more at some point and never came back.
 *
 * The worst deficit rather than the final margin: a team that was up nine in the
 * fourth and lost by one had a collapse, and reporting it as a one-run game would be
 * technically true and completely misleading.
 */
const detectMeltdown = (input: HeadlinerEventInput): Detection | null => {
  const deficit = input.shape.awayWon
    ? input.derived.homeLargestDeficit
    : input.derived.awayLargestDeficit;
  if (deficit < 6) return null;
  return {
    kind: 'meltdown',
    severity: Math.min(100, SEVERITY_BAND.negative + deficit),
    valence: 'negative',
    teamId: input.shape.loserTeamId,
    slots: { TEAM: clubName(input, input.shape.loserTeamId), FIGURE: String(deficit) },
  };
};

// ---------------------------------------------------------------------------
// History detectors
// ---------------------------------------------------------------------------

/**
 * Streaks, walking completed games backwards.
 *
 * This game is filtered out first, so a team that has just won three in a row reports
 * three rather than four.
 */
const detectWinningStreak = (input: HeadlinerEventInput): Detection | null => {
  const prior = priorGames(input, STREAK_SCAN_LIMIT);
  let run = 0;
  for (const entry of prior) {
    if (entry.awayTeam !== input.shape.winnerTeamId && entry.homeTeam !== input.shape.winnerTeamId) continue;
    const isHome = entry.homeTeam === input.shape.winnerTeamId;
    const won = isHome ? entry.score.home > entry.score.away : entry.score.away > entry.score.home;
    if (!won) break;
    run += 1;
  }
  // Four, because three is noise on a 162-game schedule.
  if (run < 3) return null;
  return {
    kind: 'winning_streak',
    severity: Math.min(100, SEVERITY_BAND.moderate + run + 1),
    valence: 'positive',
    teamId: input.shape.winnerTeamId,
    slots: { TEAM: clubName(input, input.shape.winnerTeamId), FIGURE: String(run + 1) },
  };
};

const detectLosingStreak = (input: HeadlinerEventInput): Detection | null => {
  const prior = priorGames(input, STREAK_SCAN_LIMIT);
  let run = 0;
  for (const entry of prior) {
    if (entry.awayTeam !== input.shape.loserTeamId && entry.homeTeam !== input.shape.loserTeamId) continue;
    const isHome = entry.homeTeam === input.shape.loserTeamId;
    const won = isHome ? entry.score.home > entry.score.away : entry.score.away > entry.score.home;
    if (won) break;
    run += 1;
  }
  if (run < 3) return null;
  return {
    kind: 'losing_streak',
    severity: Math.min(100, SEVERITY_BAND.negative + Math.min(14, run + 1)),
    valence: 'negative',
    teamId: input.shape.loserTeamId,
    slots: { TEAM: clubName(input, input.shape.loserTeamId), FIGURE: String(run + 1) },
  };
};

/**
 * A batter appearing in a game where they had never appeared before, within the scan
 * bound. See `HISTORY_SCAN_LIMIT` for why the bound is a real limitation.
 */
const detectBigDebut = (input: HeadlinerEventInput): Detection | null => {
  const prior = priorGames(input);
  if (prior.length === 0) return null;
  const seenBefore = battersSeenIn(prior);

  let debut: DerivedGameLines['battingLines'][number] | null = null;
  for (const line of input.derived.battingLines) {
    if (seenBefore.has(line.playerId)) continue;
    if (!debut || line.hits > debut.hits) debut = line;
  }
  if (!debut) return null;
  const age = ageOf(input, debut.playerId);
  return {
    kind: 'big_debut',
    severity: SEVERITY_BAND.minor + 12,
    valence: 'positive',
    playerId: debut.playerId,
    teamId: debut.teamId,
    slots: {
      PLAYER: debut.playerName,
      TEAM: clubName(input, debut.teamId),
      ...(age === undefined ? {} : { AGE: String(age) }),
      FIGURE: String(debut.hits),
    },
  };
};

/** A featured hitter young enough for the youth reporter to care. */
const detectYoungPlayer = (input: HeadlinerEventInput): Detection | null => {
  let youngest: DerivedGameLines['battingLines'][number] | null = null;
  let youngestAge = Number.POSITIVE_INFINITY;
  for (const line of input.derived.battingLines) {
    const age = ageOf(input, line.playerId);
    // 25 is the youth reporter's ceiling, matched here so the detector does not
    // manufacture events no persona can ever cover.
    if (age === undefined || age > 25 || age >= youngestAge) continue;
    if (line.hits < 2 && line.plateAppearances < 3) continue;
    youngest = line;
    youngestAge = age;
  }
  if (!youngest) return null;
  return {
    kind: 'young_player',
    severity: SEVERITY_BAND.minor + 6,
    valence: 'neutral',
    playerId: youngest.playerId,
    teamId: youngest.teamId,
    slots: {
      PLAYER: youngest.playerName,
      TEAM: clubName(input, youngest.teamId),
      AGE: String(youngestAge),
      FIGURE: String(youngest.hits),
    },
  };
};

// ---------------------------------------------------------------------------
// Analytic detectors
// ---------------------------------------------------------------------------

/**
 * A single-game rate more than two sigma from the league norm.
 *
 * Reported against BABIP and K/9 because those are the two rates a single game can
 * make genuinely strange. Season rates like ISO are not used here: three at-bats
 * cannot produce a meaningful ISO, and reporting one would be arithmetic without
 * content.
 */
const detectAnomaly = (input: HeadlinerEventInput): Detection | null => {
  const baselines = input.baselines;
  if (!baselines) return null;
  let best: Detection | null = null;
  let bestZ = 0;

  for (const line of input.derived.battingLines) {
    if (line.atBats < MIN_RATE_AT_BATS) continue;

    const ballsInPlay = line.atBats - line.strikeouts - line.homeRuns;
    if (ballsInPlay >= MIN_RATE_AT_BATS) {
      const babip = (line.hits - line.homeRuns) / ballsInPlay;
      const z = zScore(babip, baselines.babip);
      if (Math.abs(z) >= ANOMALY_SIGMAS && Math.abs(z) > Math.abs(bestZ)) {
        bestZ = z;
        best = {
          kind: 'anomaly',
          severity: Math.min(100, SEVERITY_BAND.moderate + Math.round(Math.abs(z) * 4)),
          valence: z > 0 ? 'positive' : 'negative',
          playerId: line.playerId,
          teamId: line.teamId,
          slots: { PLAYER: line.playerName, FIGURE: leadingDot(babip, 3), TEAM: clubName(input, line.teamId) },
        };
      }
    }

    if (line.strikeouts >= 4) {
      const kPer9 = (line.strikeouts / line.atBats) * 9;
      const z = zScore(kPer9, baselines.kPer9);
      if (Math.abs(z) >= ANOMALY_SIGMAS && Math.abs(z) > Math.abs(bestZ)) {
        bestZ = z;
        best = {
          kind: 'anomaly',
          severity: Math.min(100, SEVERITY_BAND.moderate + Math.round(Math.abs(z) * 4)),
          valence: z > 0 ? 'negative' : 'positive',
          playerId: line.playerId,
          teamId: line.teamId,
          slots: { PLAYER: line.playerName, FIGURE: kPer9.toFixed(1), TEAM: clubName(input, line.teamId) },
        };
      }
    }
  }
  return best;
};

/**
 * A rate that has held over a window, as opposed to one strange night.
 *
 * Needs a real sample across games before it will say anything: a claim about
 * consistency is a claim about several games, and one good night does not support it.
 */
const detectSustainedRate = (input: HeadlinerEventInput): Detection | null => {
  const baselines = input.baselines;
  if (!baselines) return null;
  const totals = battingTotalsIn(priorGames(input));
  if (totals.size === 0) return null;

  let best: Detection | null = null;
  let bestZ = 0;
  for (const line of input.derived.battingLines) {
    const window = totals.get(line.playerId);
    if (!window || window.atBats < MIN_SUSTAINED_AT_BATS) continue;
    const average = window.hits / window.atBats;
    const z = zScore(average, baselines.avg);
    if (Math.abs(z) >= ANOMALY_SIGMAS && Math.abs(z) > Math.abs(bestZ)) {
      bestZ = z;
      best = {
        kind: 'sustained_rate',
        severity: Math.min(100, SEVERITY_BAND.moderate + Math.round(Math.abs(z) * 3)),
        valence: z > 0 ? 'positive' : 'negative',
        playerId: line.playerId,
        teamId: line.teamId,
        slots: {
          PLAYER: line.playerName,
          TEAM: clubName(input, line.teamId),
          FIGURE: leadingDot(average, 3),
        },
      };
    }
  }
  return best;
};

/**
 * The better-rated side losing, by a margin the simulation would call an upset.
 *
 * The cleanest analytic claim available because it needs no rate baseline at all: the
 * rating gap is the expectation and the result is the observation, both already on
 * hand. Which is why it is the one analytic event that fires from the first game.
 */
const detectExpectedDivergence = (input: HeadlinerEventInput): Detection | null => {
  const { shape } = input;
  // A rating gap of 12 is where the simulation considers the result a genuine upset
  // rather than noise in the ratings.
  if (shape.ratingGap < 12) return null;
  if (!shape.winnerWasUnderdog) return null;
  const leader = leaderBatter(input, shape.winnerTeamId);
  return {
    kind: 'expected_divergence',
    severity: Math.min(100, SEVERITY_BAND.moderate + shape.ratingGap),
    valence: 'neutral',
    playerId: leader?.playerId,
    teamId: shape.winnerTeamId,
    slots: {
      TEAM: clubName(input, shape.winnerTeamId),
      OPPONENT: cityOf(input, shape.loserTeamId),
      ...(leader ? { PLAYER: leader.playerName } : {}),
      FIGURE: String(Math.round(shape.ratingGap)),
    },
  };
};

// ---------------------------------------------------------------------------
// The detector table
// ---------------------------------------------------------------------------

/**
 * Detector to kind, stated beside the detectors rather than recovered from their
 * names. `Function.prototype.name` is a property of the compiled output, not of the
 * source, and a minifier is free to rename it -- which would silently break any
 * dispatch keyed on it. This map cannot.
 */
const DETECTORS: ReadonlyArray<{ kind: GameEventKind; detect: Detector }> = [
  { kind: 'perfect_game', detect: detectPerfectGame },
  { kind: 'cycle', detect: detectCycle },
  { kind: 'no_hitter', detect: detectNoHitter },
  { kind: 'multi_homer', detect: detectMultiHomer },
  { kind: 'rbi_barrage', detect: detectRbiBarrage },
  { kind: 'hit_fury', detect: detectHitFury },
  { kind: 'on_base_machine', detect: detectOnBaseMachine },
  { kind: 'pitching_dome', detect: detectPitchingDome },
  { kind: 'complete_game', detect: detectCompleteGame },
  { kind: 'staff_wins', detect: detectStaffWins },
  { kind: 'walk_off', detect: detectWalkOff },
  { kind: 'extra_innings', detect: detectExtraInnings },
  { kind: 'scrap_heap', detect: detectScrapHeap },
  { kind: 'blowout', detect: detectBlowout },
  { kind: 'shutout', detect: detectShutout },
  { kind: 'meltdown', detect: detectMeltdown },
  { kind: 'one_run_game', detect: detectOneRunGame },
  { kind: 'momentum_swing', detect: detectMomentumSwing },
  { kind: 'underdog_win', detect: detectUnderdogWin },
  { kind: 'big_debut', detect: detectBigDebut },
  { kind: 'young_player', detect: detectYoungPlayer },
  { kind: 'winning_streak', detect: detectWinningStreak },
  { kind: 'losing_streak', detect: detectLosingStreak },
  { kind: 'anomaly', detect: detectAnomaly },
  { kind: 'sustained_rate', detect: detectSustainedRate },
  { kind: 'expected_divergence', detect: detectExpectedDivergence },
];

/**
 * Every kind this module can emit.
 *
 * Exported so a verifier can assert it against the declared `GameEventKind` union
 * rather than trusting the note at the top of the file.
 */
export const EMITTABLE_KINDS: readonly GameEventKind[] = DETECTORS.map((entry) => entry.kind);

/**
 * Derive the league rate baselines the analyst measures single-game rates against.
 *
 * Built from RECENT games rather than from season totals, because the comparison is
 * "is this night strange for this league right now". A baseline that drifts with the
 * season would quietly stop flagging anything in September.
 *
 * Returns null when there is not enough data to judge a night by. A baseline built
 * from a handful of lines has a standard deviation nothing, and every z-score against
 * it is either zero or infinity -- which would make `anomaly` either silent or
 * trigger-happy depending on rounding. Refusing to build one is the honest answer.
 *
 * The line weighting matters: only games with at-bats above `MIN_RATE_AT_BATS` per
 * batter contribute, because a two-at-bat line has a BABIP of 0, 0.5 or 1 and those
 * three values would dominate a mean.
 */
export const buildLeagueRateBaselines = (
  games: readonly Game[],
  derivedByGame: ReadonlyMap<string, DerivedGameLines>,
): LeagueRateBaselines | null => {
  const babip: number[] = [];
  const avg: number[] = [];
  const obp: number[] = [];
  const iso: number[] = [];
  const kPer9: number[] = [];
  const bbPer9: number[] = [];

  for (const game of games) {
    const derived = derivedByGame.get(game.gameId);
    if (!derived) continue;
    for (const line of derived.battingLines) {
      if (line.atBats < MIN_RATE_AT_BATS) continue;

      avg.push(line.hits / line.atBats);
      kPer9.push((line.strikeouts / line.atBats) * 9);
      bbPer9.push((line.walks / line.atBats) * 9);
      // OBP needs walks over the denominator the metric layer uses: at-bats plus
      // walks, which is exactly plate appearances in this engine.
      const plateAppearances = line.atBats + line.walks;
      if (plateAppearances > 0) obp.push((line.hits + line.walks) / plateAppearances);

      const ballsInPlay = line.atBats - line.strikeouts - line.homeRuns;
      if (ballsInPlay >= MIN_RATE_AT_BATS) {
        babip.push((line.hits - line.homeRuns) / ballsInPlay);
        const totalBases = line.hits + line.doubles + 2 * line.triples + 3 * line.homeRuns;
        iso.push(totalBases / line.atBats - line.hits / line.atBats);
      }
    }
  }

  // Below this a standard deviation is dominated by which two-at-bat games happened
  // to land in the window.
  if (avg.length < 60) return null;

  const baseline = (values: number[]): RateBaseline => {
    const value = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const variance =
      values.length > 1
        ? values.reduce((s, v) => s + (v - value) ** 2, 0) / (values.length - 1)
        : 0;
    return { value, standardDeviation: Math.sqrt(variance) };
  };

  return {
    babip: baseline(babip),
    avg: baseline(avg),
    obp: baseline(obp),
    iso: baseline(iso),
    kPer9: baseline(kPer9),
    bbPer9: baseline(bbPer9),
    sampleSize: avg.length,
  };
};

/**
 * Stage 1. Every event this game produced, most severe first.
 *
 * Each detector yields at most one event, so a game produces at most one of each kind
 * -- a second cycle in the same game is the same story.
 *
 * `playerAge` is attached here rather than in each detector: it is the same lookup
 * everywhere, and the youth reporter's gate reads it off the event rather than
 * carrying a player map of its own.
 */
export const extractGameEvents = (input: HeadlinerEventInput): GameEvent[] => {
  const events: GameEvent[] = [];
  for (const { kind, detect } of DETECTORS) {
    const detection = detect(input);
    if (!detection) continue;
    events.push({
      // The detector's own kind wins if it differs, so `detectHitFury`-style
      // branching stays possible without the table becoming a lie.
      kind: detection.kind ?? kind,
      game: input.game,
      slots: detection.slots ?? {},
      playerId: detection.playerId,
      teamId: detection.teamId,
      severity: clampSeverity(detection.severity),
      valence: detection.valence,
      playerAge: ageOf(input, detection.playerId),
    });
  }
  return events.sort((left, right) => right.severity - left.severity);
};