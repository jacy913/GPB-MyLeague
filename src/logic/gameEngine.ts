import {
  AtBatOutcome,
  BaseState,
  CompletedGameResult,
  Game,
  GameParticipantBatter,
  GameParticipantPitcher,
  GameParticipantsSnapshot,
  GameSessionState,
  InningHalf,
  InningLine,
  PlayLogEvent,
  PlayerGameBattingLine,
  PlayerGamePitchingLine,
  PlayerGameStatDelta,
  SimulationSettings,
  Team,
} from '../types';
import { TEAM_EDGE_WEIGHT } from './teamStrength';
import {
  applyParkEnvironment,
  parkFactorsForTeam,
  type ParkFactors,
} from '../lib/analytics/parkFactors';

const OUTCOME_POOL: AtBatOutcome[] = ['OUT', 'SO', 'BB', '1B', '2B', '3B', 'HR', 'ERR'];
const INNING_OUT_VALUE = Number((1 / 3).toFixed(3));

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const createRandomSeed = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
};

const nextRandom = (session: GameSessionState): number => {
  session.randomState = (Math.imul(session.randomState, 1664525) + 1013904223) >>> 0;
  return session.randomState / 4294967296;
};

const cloneBases = (bases: BaseState): BaseState => ({ ...bases });

const emptyBases = (): BaseState => ({
  first: null,
  second: null,
  third: null,
});

const normalizeBases = (bases: unknown): BaseState => {
  if (!bases || typeof bases !== 'object') {
    return emptyBases();
  }

  const candidate = bases as Partial<Record<keyof BaseState, unknown>>;
  return {
    first: typeof candidate.first === 'string' ? candidate.first : candidate.first ? '__occupied__' : null,
    second: typeof candidate.second === 'string' ? candidate.second : candidate.second ? '__occupied__' : null,
    third: typeof candidate.third === 'string' ? candidate.third : candidate.third ? '__occupied__' : null,
  };
};

const getBattingTeamId = (session: GameSessionState): string =>
  session.half === 'top' ? session.awayTeamId : session.homeTeamId;

const getFieldingTeamId = (session: GameSessionState): string =>
  session.half === 'top' ? session.homeTeamId : session.awayTeamId;

const createEmptyPitchingLine = (playerId: string): PlayerGamePitchingLine => ({
  playerId,
  wins: 0,
  losses: 0,
  saves: 0,
  games: 0,
  gamesStarted: 0,
  inningsPitched: 0,
  hitsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
});

const createEmptyBattingLine = (playerId: string): PlayerGameBattingLine => ({
  playerId,
  gamesPlayed: 0,
  plateAppearances: 0,
  atBats: 0,
  runsScored: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  rbi: 0,
});

const createEmptyPlayerStatDelta = (): PlayerGameStatDelta => ({
  batting: {},
  pitching: {},
  winningPitcherId: null,
  losingPitcherId: null,
  savePitcherId: null,
});

const clonePlayerStatDelta = (playerStats: PlayerGameStatDelta): PlayerGameStatDelta => ({
  batting: Object.fromEntries(Object.entries(playerStats.batting).map(([playerId, line]) => [playerId, { ...line }])),
  pitching: Object.fromEntries(Object.entries(playerStats.pitching).map(([playerId, line]) => [playerId, { ...line }])),
  winningPitcherId: playerStats.winningPitcherId,
  losingPitcherId: playerStats.losingPitcherId,
  savePitcherId: playerStats.savePitcherId,
});

const ensureLineScore = (lineScore: InningLine[], inning: number): InningLine[] => {
  if (lineScore.some((line) => line.inning === inning)) {
    return lineScore.map((line) => ({ ...line }));
  }

  return [...lineScore.map((line) => ({ ...line })), { inning, away: 0, home: 0 }];
};

const updateLineScore = (
  lineScore: InningLine[],
  inning: number,
  half: InningHalf,
  runsScored: number,
): InningLine[] =>
  ensureLineScore(lineScore, inning).map((line) =>
    line.inning === inning
      ? {
          ...line,
          away: half === 'top' ? line.away + runsScored : line.away,
          home: half === 'bottom' ? line.home + runsScored : line.home,
        }
      : line,
  );

const appendLog = (session: GameSessionState, log: PlayLogEvent): GameSessionState => ({
  ...session,
  logs: [...session.logs, log],
  nextEventSeq: session.nextEventSeq + 1,
});

const addRuns = (session: GameSessionState, runsScored: number): GameSessionState => {
  if (!Number.isFinite(runsScored) || runsScored <= 0) {
    return session;
  }

  const isAwayBatting = session.half === 'top';
  const scoreboard = {
    ...session.scoreboard,
    awayRuns: isAwayBatting ? session.scoreboard.awayRuns + runsScored : session.scoreboard.awayRuns,
    homeRuns: !isAwayBatting ? session.scoreboard.homeRuns + runsScored : session.scoreboard.homeRuns,
  };

  return {
    ...session,
    scoreboard,
    lineScore: updateLineScore(session.lineScore, session.inning, session.half, runsScored),
  };
};

const getPitchingParticipants = (
  session: GameSessionState,
  teamId: string,
): Array<GameParticipantPitcher> => {
  if (!session.participants) {
    return [];
  }

  return teamId === session.awayTeamId
    ? [session.participants.awayStarter, ...session.participants.awayBullpen].filter(
        (pitcher): pitcher is GameParticipantPitcher => Boolean(pitcher),
      )
    : [session.participants.homeStarter, ...session.participants.homeBullpen].filter(
        (pitcher): pitcher is GameParticipantPitcher => Boolean(pitcher),
      );
};

const getTeamPitchingState = (session: GameSessionState, teamId: string) =>
  teamId === session.awayTeamId ? session.awayPitching : session.homePitching;

const withTeamPitchingState = (
  session: GameSessionState,
  teamId: string,
  pitchingState: GameSessionState['awayPitching'],
): GameSessionState =>
  teamId === session.awayTeamId
    ? { ...session, awayPitching: pitchingState }
    : { ...session, homePitching: pitchingState };

const getTeamStarter = (session: GameSessionState, teamId: string): GameParticipantPitcher | null => {
  if (!session.participants) {
    return null;
  }

  return teamId === session.awayTeamId ? session.participants.awayStarter : session.participants.homeStarter;
};

const getTeamBullpen = (session: GameSessionState, teamId: string): GameParticipantPitcher[] => {
  if (!session.participants) {
    return [];
  }

  return teamId === session.awayTeamId ? session.participants.awayBullpen : session.participants.homeBullpen;
};

const getCurrentBatter = (session: GameSessionState): GameParticipantBatter | null => {
  if (!session.participants) {
    return null;
  }

  const lineup = session.half === 'top' ? session.participants.awayLineup : session.participants.homeLineup;
  const index = session.half === 'top' ? session.awayBatterIndex : session.homeBatterIndex;
  if (lineup.length === 0) {
    return null;
  }

  return lineup[index % lineup.length] ?? null;
};

const getCurrentPitcher = (session: GameSessionState): GameParticipantPitcher | null => {
  if (!session.participants) {
    return null;
  }

  const fieldingTeamId = getFieldingTeamId(session);
  const currentPitcherId = fieldingTeamId === session.awayTeamId
    ? session.awayPitching.currentPitcherId
    : session.homePitching.currentPitcherId;

  return getPitchingParticipants(session, fieldingTeamId).find((pitcher) => pitcher.playerId === currentPitcherId) ?? null;
};

const getParticipantById = (session: GameSessionState, playerId: string | null): GameParticipantBatter | GameParticipantPitcher | null => {
  if (!playerId || !session.participants) {
    return null;
  }

  const batters = [...session.participants.awayLineup, ...session.participants.homeLineup];
  const pitchers = [
    session.participants.awayStarter,
    ...session.participants.awayBullpen,
    session.participants.homeStarter,
    ...session.participants.homeBullpen,
  ].filter((entry): entry is GameParticipantPitcher => Boolean(entry));

  return batters.find((entry) => entry.playerId === playerId) ??
    pitchers.find((entry) => entry.playerId === playerId) ??
    null;
};

const getRunnerSpeed = (session: GameSessionState, runnerId: string | null): number => {
  const participant = getParticipantById(session, runnerId);
  if (!participant || !('battingRatings' in participant)) {
    return 75;
  }

  return (participant.battingRatings.speed + participant.battingRatings.baserunning) / 2;
};

const getDefenseQuality = (session: GameSessionState): number => {
  if (!session.participants) {
    return 75;
  }

  const lineup = session.half === 'top' ? session.participants.homeLineup : session.participants.awayLineup;
  if (lineup.length === 0) {
    return 75;
  }

  const total = lineup.reduce(
    (sum, participant) => sum + participant.battingRatings.fielding * 0.65 + participant.battingRatings.arm * 0.35,
    0,
  );
  return total / lineup.length;
};

const pickDefender = (session: GameSessionState): GameParticipantBatter | null => {
  if (!session.participants) {
    return null;
  }

  const lineup = session.half === 'top' ? session.participants.homeLineup : session.participants.awayLineup;
  if (lineup.length === 0) {
    return null;
  }

  const index = Math.floor(nextRandom(session) * lineup.length);
  return lineup[index] ?? null;
};

const getFatiguePenalty = (session: GameSessionState, pitcher: GameParticipantPitcher): number => {
  const pitchingState = getTeamPitchingState(session, getFieldingTeamId(session));
  const staminaLimit = 15 + (pitcher.pitchingRatings.stamina - 60) * 0.6;
  const pitchLimit = 65 + (pitcher.pitchingRatings.stamina - 60) * 1.5;
  const battersOver = Math.max(0, pitchingState.battersFaced - staminaLimit);
  const pitchesOver = Math.max(0, pitchingState.pitchCount - pitchLimit);
  return battersOver * 1.8 + pitchesOver * 0.18;
};

const scorePitcherSelection = (pitcher: GameParticipantPitcher): number =>
  pitcher.pitchingRatings.overall +
  getPitcherFormBonus(pitcher) +
  pitcher.pitchingRatings.command * 0.16 +
  pitcher.pitchingRatings.movement * 0.12 +
  pitcher.pitchingRatings.stuff * 0.08;

const getCloser = (session: GameSessionState, teamId: string): GameParticipantPitcher | null =>
  getTeamBullpen(session, teamId).find((pitcher) => pitcher.role === 'CL') ?? null;

const getAvailableBullpenOptions = (
  session: GameSessionState,
  teamId: string,
  includeCloser: boolean,
): GameParticipantPitcher[] => {
  const pitchingState = getTeamPitchingState(session, teamId);
  const bullpen = getTeamBullpen(session, teamId)
    .filter((pitcher) => pitcher.playerId !== pitchingState.currentPitcherId)
    .filter((pitcher) => includeCloser || pitcher.role !== 'CL');

  const unused = bullpen.filter((pitcher) => !pitchingState.bullpenUsedIds.includes(pitcher.playerId));
  if (unused.length > 0) {
    return unused;
  }

  return session.inning >= 10 ? bullpen : [];
};

const pickBullpenArm = (
  session: GameSessionState,
  teamId: string,
  preferredRole: 'closer' | 'reliever',
): GameParticipantPitcher | null => {
  if (preferredRole === 'closer') {
    const closer = getCloser(session, teamId);
    if (closer && !getTeamPitchingState(session, teamId).bullpenUsedIds.includes(closer.playerId)) {
      return closer;
    }
  }

  const options = getAvailableBullpenOptions(session, teamId, preferredRole === 'closer');
  if (preferredRole === 'closer') {
    const closer = options.find((pitcher) => pitcher.role === 'CL');
    if (closer) {
      return closer;
    }
  }

  const filtered = preferredRole === 'reliever'
    ? options.filter((pitcher) => pitcher.role !== 'CL')
    : options;
  const candidates = filtered.length > 0 ? filtered : options;
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => scorePitcherSelection(right) - scorePitcherSelection(left))[0] ?? null;
};

const isStarterNoHitBidActive = (
  session: GameSessionState,
  teamId: string,
  pitcherId: string | null,
): boolean => {
  const starter = getTeamStarter(session, teamId);
  if (!starter || starter.playerId !== pitcherId || session.inning < 7) {
    return false;
  }

  const hitsAllowed = teamId === session.awayTeamId ? session.scoreboard.homeHits : session.scoreboard.awayHits;
  return hitsAllowed === 0;
};

const shouldUseCloser = (
  session: GameSessionState,
  teamId: string,
  pitcherId: string | null,
): boolean => {
  if (session.inning !== 9 || isStarterNoHitBidActive(session, teamId, pitcherId)) {
    return false;
  }

  const closer = getCloser(session, teamId);
  return Boolean(closer) && closer.playerId !== pitcherId;
};

const shouldPullStarter = (
  session: GameSessionState,
  teamId: string,
  pitcher: GameParticipantPitcher,
): boolean => {
  if (isStarterNoHitBidActive(session, teamId, pitcher.playerId)) {
    return false;
  }

  if (session.inning <= 5) {
    return false;
  }

  const pitchingState = getTeamPitchingState(session, teamId);
  const fatiguePenalty = getFatiguePenalty(session, pitcher);
  const earnedRuns = session.playerStats.pitching[pitcher.playerId]?.earnedRuns ?? 0;

  if (session.inning >= 8) {
    return true;
  }

  if (session.inning === 6) {
    return (
      pitchingState.pitchCount >= 88 ||
      pitchingState.battersFaced >= 24 ||
      fatiguePenalty >= 10 ||
      earnedRuns >= 4
    );
  }

  return (
    pitchingState.pitchCount >= 102 ||
    pitchingState.battersFaced >= 27 ||
    fatiguePenalty >= 8 ||
    earnedRuns >= 3
  );
};

const shouldPullReliever = (
  session: GameSessionState,
  teamId: string,
  pitcher: GameParticipantPitcher,
): boolean => {
  const pitchingState = getTeamPitchingState(session, teamId);
  const fatiguePenalty = getFatiguePenalty(session, pitcher);
  return (
    session.inning > pitchingState.enteredInning ||
    pitchingState.pitchCount >= 24 ||
    pitchingState.battersFaced >= 6 ||
    fatiguePenalty >= 8
  );
};

const getBatterFormBonus = (batter: GameParticipantBatter): number => {
  const stat = batter.battingStat;
  if (!stat || stat.plateAppearances < 20) {
    return 0;
  }

  const avgBonus = clamp((stat.avg - 0.25) * 160, -10, 10);
  const opsBonus = clamp((stat.ops - 0.72) * 36, -8, 8);
  const powerBonus = clamp(stat.homeRuns * 0.18, 0, 6);
  const strikeoutPenalty = stat.plateAppearances > 0
    ? clamp(-(stat.strikeouts / stat.plateAppearances - 0.22) * 40, -6, 4)
    : 0;

  return avgBonus + opsBonus + powerBonus + strikeoutPenalty;
};

const getPitcherFormBonus = (pitcher: GameParticipantPitcher): number => {
  const stat = pitcher.pitchingStat;
  if (!stat || stat.inningsPitched < 5) {
    return 0;
  }

  const eraBonus = clamp((4.25 - stat.era) * 3.4, -9, 9);
  const whipBonus = clamp((1.35 - stat.whip) * 12, -6, 6);
  const strikeoutBonus = stat.inningsPitched > 0
    ? clamp((stat.strikeouts / stat.inningsPitched - 0.95) * 5, -4, 4)
    : 0;

  return eraBonus + whipBonus + strikeoutBonus;
};

/**
 * The outcome weights, and the park they are played in.
 *
 * `parkFactors` is the HOME team's park, passed in by the caller. It is deliberately not
 * derived from `isHomeBatting` or from `battingTeam`/`fieldingTeam` here, because those two
 * swap over between halves of an inning and a park is a property of a place, not of a half:
 * `simulateNextAtBat` resolves the home team once and hands the same park down for every
 * at-bat of the game, top and bottom alike.
 *
 * WHY A PARK IS NOT A HOME-FIELD BONUS
 *
 * `settings.homeFieldAdvantage` is a RELATIVE edge: it says the home team does somewhat better
 * than the visitor, and it flows into the scalar `edge` below. A park factor is an ABSOLUTE
 * environment: this building suppresses or amplifies scoring, and it applies to BOTH teams in
 * every game played there. Those are two different quantities, and treating a park as a home
 * bonus would count one effect twice. `tools/checkParkWiring.ts` measures the consequence --
 * it asserts that the home/road split of realised scoring tracks each club's OWN park.
 *
 * WHY PARK FATIGUE MULTIPLIES THE ENGINE'S OWN FATIGUE RATHER THAN REPLACING IT
 *
 * `getFatiguePenalty` already models a tired pitcher, and it already flows into the outcome
 * weights through coefficients that have been tuned. A hot humid park makes that same fatigue
 * bite harder, so it multiplies it: `penalty * (1 + rate)`. Re-deriving a second fatigue model
 * would mean a second set of coefficients for the same phenomenon.
 *
 * The two PITCHING-CHANGE gates above deliberately keep the UNMODIFIED penalty. They model a
 * manager reading pitch count, batters faced and runs allowed, and park heat does not change
 * what a manager can see. So park fatigue changes how much a tired pitcher is punished, not
 * who gets pulled. That is a real scope boundary rather than an oversight, and it is the
 * reason "applied exactly once" is checkable at all: the park enters through one weight map
 * and nowhere else.
 */
const getOutcomeWeights = (
  session: GameSessionState,
  batter: GameParticipantBatter,
  pitcher: GameParticipantPitcher,
  battingTeam: Team,
  fieldingTeam: Team,
  isHomeBatting: boolean,
  settings: SimulationSettings,
  parkFactors: ParkFactors | null,
): Record<AtBatOutcome, number> => {
  const parkFatigue = parkFactors ? 1 + parkFactors.pitcherFatigueRate : 1;
  const fatiguePenalty = getFatiguePenalty(session, pitcher) * parkFatigue;
  const defenseQuality = getDefenseQuality(session);
  const homeBonus = isHomeBatting ? settings.homeFieldAdvantage * 80 : -settings.homeFieldAdvantage * 80;
  const environmentBias = (0.5 - settings.leagueEnvironmentBalance) * 2;
  const varianceScale = 0.8 + settings.battingVarianceFactor * 0.8;
  const teamEdge = (battingTeam.rating - fieldingTeam.rating) * TEAM_EDGE_WEIGHT;
  const noise = (nextRandom(session) - 0.5) * settings.gameLuckFactor * 60;
  const powerEdge = (batter.battingRatings.power - pitcher.pitchingRatings.movement) * varianceScale;
  const contactEdge = (batter.battingRatings.contact - (pitcher.pitchingRatings.stuff * 0.55 + pitcher.pitchingRatings.movement * 0.45)) * varianceScale;
  const disciplineEdge = (batter.battingRatings.plateDiscipline - pitcher.pitchingRatings.control) * varianceScale;
  const strikeoutEdge = (batter.battingRatings.avoidStrikeout - pitcher.pitchingRatings.stuff) * varianceScale;
  const speedEdge = (batter.battingRatings.speed + batter.battingRatings.baserunning) / 2 - defenseQuality;
  const batterForm = getBatterFormBonus(batter) * (0.75 + settings.battingVarianceFactor * 0.5);
  const pitcherForm = getPitcherFormBonus(pitcher) * (0.75 + settings.battingVarianceFactor * 0.5);
  const edge = teamEdge + homeBonus + noise + fatiguePenalty + batterForm - pitcherForm;

  // Base weights are anchored to the league's real per-plate-appearance outcome
  // rates rather than being free-floating constants. An MLB plate appearance
  // resolves roughly as:
  //
  //   strikeout 18.5%   out in play 48.1%   walk 9.2%
  //   single    15.0%   double      4.8%    triple 0.6%   homer 2.9%
  //
  // The totals here (862) are arbitrary as a scale -- only the proportions
  // matter, because pickOutcome normalises by the sum -- so each base is the real
  // share multiplied by 862. The modifier coefficients around them are unchanged,
  // and are what make a good hitter and a good pitcher move outcomes apart.
  //
  // This matters more than it sounds. The previous intercepts were unanchored,
  // and the league drifted to too many strikeouts and singles with too few
  // homers, extra-base hits and walks, which showed up as 2.96 runs per
  // team-game against a real 4.28: the right number of outs turning into the
  // wrong outcomes.
  const base: Record<AtBatOutcome, number> = {
    OUT: clamp(414 - contactEdge * 0.82 - powerEdge * 0.1 + defenseQuality * 0.35 - edge * 0.31 - environmentBias * 33, 295, 570),
    SO: clamp(160 - strikeoutEdge * 1.07 + (pitcher.pitchingRatings.command - batter.battingRatings.contact) * 0.45 - fatiguePenalty * 0.36 - batterForm * 0.09 + pitcherForm * 0.21 - environmentBias * 8.5, 88, 262),
    BB: clamp(79 + disciplineEdge * 0.58 + (pitcher.pitchingRatings.command - pitcher.pitchingRatings.control) * -0.18 + fatiguePenalty * 0.3 + edge * 0.055 + environmentBias * 6, 28, 118),
    '1B': clamp(129 + contactEdge * 0.72 + batterForm * 0.18 - pitcherForm * 0.17 + edge * 0.21 + environmentBias * 15, 96, 210),
    '2B': clamp(41 + powerEdge * 0.3 + speedEdge * 0.1 + batterForm * 0.075 - pitcherForm * 0.07 + edge * 0.065 + environmentBias * 5, 11, 56),
    '3B': clamp(5.4 + speedEdge * 0.048 + contactEdge * 0.012 + environmentBias * 0.45, 0.8, 8.5),
    HR: clamp(24.6 + powerEdge * 0.34 + batterForm * 0.11 - pitcherForm * 0.1 + edge * 0.06 - defenseQuality * 0.02 + environmentBias * 3.5, 3.5, 38),
    ERR: clamp(8.6 + (90 - defenseQuality) * 0.09 + environmentBias * 0.35, 0.5, 16),
  };

  /*
   * THE PARK IS APPLIED HERE, AFTER THE CLAMPS, AND THAT PLACEMENT IS DELIBERATE.
   *
   * `clamp` exists to stop a pathological combination of ratings producing a weight of zero or
   * a runaway. If the park scaled the terms BEFORE the clamp, a hitter-friendly park could
   * push a home-run weight past the clamp ceiling and the clamp would then silently undo part
   * of the park's effect -- so a 155 park would behave like a 140 park and the archetype
   * calibration would stop meaning what it says.
   *
   * Scaling the clamped result keeps the clamp as a genuine safety bound on the BASE weights,
   * which is what it was written for, and makes the park a clean multiplier on top. Because
   * `pickOutcome` normalises by the sum, the total need not stay at 862; only the proportions
   * matter, which is the property the base weights were already relying on.
   */
  return parkFactors ? applyParkEnvironment(base, parkFactors) : base;
};

const pickOutcome = (session: GameSessionState, weights: Record<AtBatOutcome, number>): AtBatOutcome => {
  const total = OUTCOME_POOL.reduce((sum, outcome) => sum + weights[outcome], 0);
  let roll = nextRandom(session) * total;
  for (const outcome of OUTCOME_POOL) {
    roll -= weights[outcome];
    if (roll <= 0) {
      return outcome;
    }
  }
  return 'OUT';
};

const advanceBatterIndex = (session: GameSessionState): GameSessionState => ({
  ...session,
  awayBatterIndex: session.half === 'top' && session.participants
    ? (session.awayBatterIndex + 1) % Math.max(1, session.participants.awayLineup.length)
    : session.awayBatterIndex,
  homeBatterIndex: session.half === 'bottom' && session.participants
    ? (session.homeBatterIndex + 1) % Math.max(1, session.participants.homeLineup.length)
    : session.homeBatterIndex,
});

const ensureBattingDelta = (session: GameSessionState, playerId: string): PlayerGameBattingLine => {
  const existing = session.playerStats.batting[playerId];
  if (existing) {
    return existing;
  }

  const next = createEmptyBattingLine(playerId);
  session.playerStats.batting[playerId] = next;
  return next;
};

const ensurePitchingDelta = (session: GameSessionState, playerId: string): PlayerGamePitchingLine => {
  const existing = session.playerStats.pitching[playerId];
  if (existing) {
    return existing;
  }

  const next = createEmptyPitchingLine(playerId);
  session.playerStats.pitching[playerId] = next;
  return next;
};

const recordPitchingOut = (session: GameSessionState, pitcherId: string | null, outs: number) => {
  if (!pitcherId || outs <= 0) {
    return;
  }

  const pitchingLine = ensurePitchingDelta(session, pitcherId);
  pitchingLine.inningsPitched = Number((pitchingLine.inningsPitched + INNING_OUT_VALUE * outs).toFixed(3));
};

const addPitchUsage = (session: GameSessionState, outcome: AtBatOutcome) => {
  const pitchCountDelta =
    outcome === 'BB' ? 5 + Math.floor(nextRandom(session) * 2)
      : outcome === 'SO' ? 4 + Math.floor(nextRandom(session) * 2)
        : 3 + Math.floor(nextRandom(session) * 3);

  if (getFieldingTeamId(session) === session.awayTeamId) {
    session.awayPitching = {
      ...session.awayPitching,
      pitchCount: session.awayPitching.pitchCount + pitchCountDelta,
      battersFaced: session.awayPitching.battersFaced + 1,
    };
    return;
  }

  session.homePitching = {
    ...session.homePitching,
    pitchCount: session.homePitching.pitchCount + pitchCountDelta,
    battersFaced: session.homePitching.battersFaced + 1,
  };
};

const createLog = (
  session: GameSessionState,
  outcome: PlayLogEvent['outcome'],
  description: string,
  batter: GameParticipantBatter | null,
  pitcher: GameParticipantPitcher | null,
  defender: GameParticipantBatter | null,
  runsScored: number,
  rbi: number,
  scoringPlayerIds: string[],
): PlayLogEvent => ({
  seq: session.nextEventSeq,
  inning: session.inning,
  half: session.half,
  battingTeamId: getBattingTeamId(session),
  outcome,
  batterId: batter?.playerId ?? null,
  batterName: batter?.fullName ?? null,
  pitcherId: pitcher?.playerId ?? null,
  pitcherName: pitcher?.fullName ?? null,
  defenderId: defender?.playerId ?? null,
  defenderName: defender?.fullName ?? null,
  description,
  runsScored,
  rbi,
  scoringPlayerIds,
  outs: session.outs,
  scoreAway: session.scoreboard.awayRuns,
  scoreHome: session.scoreboard.homeRuns,
  bases: cloneBases(session.bases),
});

const makePitchingChange = (
  session: GameSessionState,
  teamId: string,
  pitcher: GameParticipantPitcher,
  reason: string,
): GameSessionState => {
  const pitchingState = getTeamPitchingState(session, teamId);
  if (pitchingState.currentPitcherId === pitcher.playerId) {
    return session;
  }

  const nextState = {
    currentPitcherId: pitcher.playerId,
    pitchCount: 0,
    battersFaced: 0,
    enteredInning: session.inning,
    bullpenUsedIds: pitchingState.bullpenUsedIds.includes(pitcher.playerId)
      ? [...pitchingState.bullpenUsedIds]
      : [...pitchingState.bullpenUsedIds, pitcher.playerId],
  };
  const nextSession = withTeamPitchingState(session, teamId, nextState);
  if (!pitchingState.bullpenUsedIds.includes(pitcher.playerId)) {
    ensurePitchingDelta(nextSession, pitcher.playerId).games += 1;
  }

  return appendLog(
    nextSession,
    createLog(nextSession, 'PITCHING_CHANGE', reason, null, pitcher, null, 0, 0, []),
  );
};

const maybeMakePitchingChange = (session: GameSessionState): GameSessionState => {
  const fieldingTeamId = getFieldingTeamId(session);
  const currentPitcher = getCurrentPitcher(session);
  if (!currentPitcher) {
    return session;
  }

  if (shouldUseCloser(session, fieldingTeamId, currentPitcher.playerId)) {
    const closer = pickBullpenArm(session, fieldingTeamId, 'closer');
    if (closer) {
      return makePitchingChange(
        session,
        fieldingTeamId,
        closer,
        `${closer.fullName} enters to handle the ${session.inning}th inning.`,
      );
    }
  }

  const starter = getTeamStarter(session, fieldingTeamId);
  if (starter?.playerId === currentPitcher.playerId) {
    if (!shouldPullStarter(session, fieldingTeamId, currentPitcher)) {
      return session;
    }

    const nextPitcher = pickBullpenArm(session, fieldingTeamId, session.inning >= 9 ? 'closer' : 'reliever');
    if (!nextPitcher) {
      return session;
    }

    const reason = isStarterNoHitBidActive(session, fieldingTeamId, currentPitcher.playerId)
      ? `${nextPitcher.fullName} replaces ${currentPitcher.fullName} during a no-hit bid.`
      : `${nextPitcher.fullName} replaces tiring starter ${currentPitcher.fullName}.`;
    return makePitchingChange(session, fieldingTeamId, nextPitcher, reason);
  }

  if (!shouldPullReliever(session, fieldingTeamId, currentPitcher)) {
    return session;
  }

  const nextPitcher = pickBullpenArm(session, fieldingTeamId, session.inning >= 9 ? 'closer' : 'reliever');
  if (!nextPitcher) {
    return session;
  }

  return makePitchingChange(
    session,
    fieldingTeamId,
    nextPitcher,
    `${nextPitcher.fullName} takes over for ${currentPitcher.fullName}.`,
  );
};

const scoreRunner = (session: GameSessionState, runnerId: string | null) => {
  if (!runnerId || runnerId === '__occupied__') {
    return;
  }

  ensureBattingDelta(session, runnerId).runsScored += 1;
};

/**
 * Probability that a runner scores, by hit type and the runner's starting base.
 *
 * The base rates are the observed ones: a runner on third almost always comes
 * home on a single, a runner on second is a coin flip on a double, and a runner
 * on first is nearly always held to second on a single. That last pair is where
 * this engine was badly wrong -- it was rolling roughly even odds for a runner
 * to score from first on a single, which happens about 2% of the time in
 * baseball. Because singles are the most common hit in the league, that one
 * number was generating most of the surplus runs: the league scored 6.58 R/game
 * while collecting 12.6 total bases per team-game, a rate of 0.522 runs per
 * base against a real 0.314.
 *
 * Each figure is then nudged by the runner's own speed so a burner and a
 * lead-footed masher do not advance identically, but the modifier is deliberately
 * narrow. Base rates describe the league; speed should shade them, not replace
 * them.
 */
type RunnerOrigin = 'first' | 'second' | 'third';

const SCORING_ADVANCE_RATES: Record<string, Partial<Record<RunnerOrigin, number>>> = {
  single: {
    third: 0.97,
    second: 0.39,
    // Held to second. Roughly 1 in 50, not 1 in 2.
    first: 0.02,
  },
  double: {
    third: 0.99,
    second: 0.6,
    first: 0.11,
  },
  triple: {
    third: 1.0,
    second: 0.95,
    first: 0.88,
  },
};

/**
 * Applies a runner's speed to a scoring base rate.
 *
 * Speed is rated on the same 60-100 scale as every other attribute, so it is
 * centred by 75 to get a multiplier. The spread is deliberately narrow: a
 * league-average rate stays close to its observed value no matter who is running,
 * because the real distribution of advancement is wide and this engine's speed
 * ratings are not yet sharp enough to redistribute it meaningfully.
 */
const scoreChance = (session: GameSessionState, runnerId: string | null, baseRate: number): number => {
  if (!runnerId) {
    return 0;
  }
  const speedFactor = clamp((getRunnerSpeed(session, runnerId) - 75) / 25, -0.4, 0.4);
  return clamp(baseRate * (1 + speedFactor * 0.35), baseRate * 0.6, Math.min(1, baseRate * 1.5));
};

/**
 * Optional diagnostic probe for the run environment.
 *
 * Questions about scoring cannot be answered from the box score, because the
 * box score records what happened to hitters and never what happened to runners
 * already aboard. This collects, per at-bat, how many runners were on base and
 * how many runs each outcome produced -- the two facts needed to tell a league
 * that swings too little apart from one that strands its baserunners.
 *
 * It is inert unless startGameEngineProbe() is called and nothing is persisted,
 * so ordinary simulation pays nothing for it. The league lab switches it on when
 * it needs to attribute scoring, then reads and resets it.
 *
 * WHY THE JOINT TABLE EXISTS. The marginals above are enough to describe the run
 * environment but not to fit anything to it. runsByOutcome says an HR scored N
 * runs over M plate appearances; it cannot say whether those plate appearances
 * were mostly bases-loaded, in which case the fitted "value of a home run" has
 * silently absorbed the runner context and will misattribute it. Any regression
 * of runs on outcome needs the (outcome x runners-on) joint, so that occupancy can
 * be held as a control instead of being confounded with the outcome. That is what
 * runsByOutcomeAndOccupancy and plateAppearancesByOutcomeAndOccupancy provide.
 */
export interface GameEngineProbe {
  plateAppearances: number;
  runnersOnBase: number;
  /** Counters indexed by 0, 1, 2, 3 runners aboard. */
  baseCounts: [number, number, number, number];
  runsByOutcome: Record<string, number>;
  plateAppearancesByOutcome: Record<string, number>;
  /**
   * Joint outcome x occupancy, each indexed by 0, 1, 2, 3 runners aboard at the
   * time of the plate appearance. Keyed by AtBatOutcome; a cell counts plate
   * appearances, the other sums the runs scored on them.
   */
  runsByOutcomeAndOccupancy: Record<string, [number, number, number, number]>;
  plateAppearancesByOutcomeAndOccupancy: Record<string, [number, number, number, number]>;
}

let activeProbe: GameEngineProbe | null = null;

const emptyJointRow = (): [number, number, number, number] => [0, 0, 0, 0];

export const startGameEngineProbe = (): void => {
  activeProbe = {
    plateAppearances: 0,
    runnersOnBase: 0,
    baseCounts: [0, 0, 0, 0],
    runsByOutcome: {},
    plateAppearancesByOutcome: {},
    runsByOutcomeAndOccupancy: {},
    plateAppearancesByOutcomeAndOccupancy: {},
  };
};

// Copied rather than returned by reference so a caller holding a previous
// reading cannot mutate the live probe, and so the rows are not aliased between
// the two joint tables.
const cloneJointRows = (
  rows: Record<string, [number, number, number, number]>,
): Record<string, [number, number, number, number]> => {
  const copy: Record<string, [number, number, number, number]> = {};
  Object.keys(rows).forEach((key) => {
    copy[key] = [...rows[key]] as [number, number, number, number];
  });
  return copy;
};

export const readGameEngineProbe = (): GameEngineProbe | null =>
  activeProbe
    ? {
        plateAppearances: activeProbe.plateAppearances,
        runnersOnBase: activeProbe.runnersOnBase,
        baseCounts: [...activeProbe.baseCounts] as [number, number, number, number],
        runsByOutcome: { ...activeProbe.runsByOutcome },
        plateAppearancesByOutcome: { ...activeProbe.plateAppearancesByOutcome },
        runsByOutcomeAndOccupancy: cloneJointRows(activeProbe.runsByOutcomeAndOccupancy),
        plateAppearancesByOutcomeAndOccupancy: cloneJointRows(activeProbe.plateAppearancesByOutcomeAndOccupancy),
      }
    : null;

export const stopGameEngineProbe = (): void => {
  activeProbe = null;
};

const recordProbeAtBat = (bases: BaseState, outcome: AtBatOutcome, runsScored: number): void => {
  if (!activeProbe) {
    return;
  }
  const occupied = (bases.first ? 1 : 0) + (bases.second ? 1 : 0) + (bases.third ? 1 : 0);
  activeProbe.plateAppearances += 1;
  activeProbe.runnersOnBase += occupied;
  activeProbe.baseCounts[occupied] += 1;
  activeProbe.runsByOutcome[outcome] = (activeProbe.runsByOutcome[outcome] ?? 0) + runsScored;
  activeProbe.plateAppearancesByOutcome[outcome] = (activeProbe.plateAppearancesByOutcome[outcome] ?? 0) + 1;
  // Joint cell, so occupancy can be controlled for rather than confounded with
  // the outcome. `occupied` is bounded 0..3 by the expression above, which is the
  // same bound the baseCounts tuple is sized for.
  const runsRow = activeProbe.runsByOutcomeAndOccupancy[outcome] ?? emptyJointRow();
  runsRow[occupied] += runsScored;
  activeProbe.runsByOutcomeAndOccupancy[outcome] = runsRow;
  const paRow = activeProbe.plateAppearancesByOutcomeAndOccupancy[outcome] ?? emptyJointRow();
  paRow[occupied] += 1;
  activeProbe.plateAppearancesByOutcomeAndOccupancy[outcome] = paRow;
};

const assignRunsAndRbi = (
  session: GameSessionState,
  scoringPlayerIds: string[],
  batterId: string | null,
  pitcherId: string | null,
  rbi: number,
  countAsEarnedRun: boolean,
) => {
  scoringPlayerIds.forEach((runnerId) => scoreRunner(session, runnerId));
  if (batterId && rbi > 0) {
    ensureBattingDelta(session, batterId).rbi += rbi;
  }
  if (pitcherId && countAsEarnedRun && scoringPlayerIds.length > 0) {
    ensurePitchingDelta(session, pitcherId).earnedRuns += scoringPlayerIds.length;
  }
};

const resolveWalk = (
  session: GameSessionState,
  batterId: string,
): { bases: BaseState; scoringPlayerIds: string[] } => {
  const nextBases = cloneBases(session.bases);
  const scoringPlayerIds: string[] = [];

  if (nextBases.first && nextBases.second && nextBases.third) {
    scoringPlayerIds.push(nextBases.third);
  }

  const newThird = nextBases.first && nextBases.second ? nextBases.second : nextBases.third;
  const newSecond = nextBases.first ? nextBases.first : nextBases.second;

  return {
    bases: {
      first: batterId,
      second: newSecond,
      third: newThird,
    },
    scoringPlayerIds,
  };
};

const resolveSingleLikeAdvance = (
  session: GameSessionState,
  batterId: string,
): { bases: BaseState; scoringPlayerIds: string[] } => {
  const rates = SCORING_ADVANCE_RATES.single;
  const scoringPlayerIds: string[] = [];
  const runnerFromThird = session.bases.third;
  const runnerFromSecond = session.bases.second;
  const runnerFromFirst = session.bases.first;

  if (runnerFromThird) {
    scoringPlayerIds.push(runnerFromThird);
  }

  const secondRunnerScores =
    runnerFromSecond !== null && nextRandom(session) < scoreChance(session, runnerFromSecond, rates.second!);
  if (runnerFromSecond && secondRunnerScores) {
    scoringPlayerIds.push(runnerFromSecond);
  }

  const firstRunnerToThird =
    runnerFromFirst !== null && nextRandom(session) < scoreChance(session, runnerFromFirst, rates.first!);

  return {
    bases: {
      first: batterId,
      second: !runnerFromFirst || firstRunnerToThird ? null : runnerFromFirst,
      third: runnerFromSecond && !secondRunnerScores ? runnerFromSecond : firstRunnerToThird ? runnerFromFirst : null,
    },
    scoringPlayerIds,
  };
};

const resolveDoubleAdvance = (
  session: GameSessionState,
  batterId: string,
): { bases: BaseState; scoringPlayerIds: string[] } => {
  const rates = SCORING_ADVANCE_RATES.double;
  const scoringPlayerIds: string[] = [];
  const runnerFromThird = session.bases.third;
  const runnerFromSecond = session.bases.second;
  const runnerFromFirst = session.bases.first;

  // The runner from second does not automatically come home on a double. That
  // was hardcoded to score, which is a base rate near 60%, not 100%.
  if (runnerFromThird) {
    scoringPlayerIds.push(runnerFromThird);
  }
  if (runnerFromSecond && nextRandom(session) < scoreChance(session, runnerFromSecond, rates.second!)) {
    scoringPlayerIds.push(runnerFromSecond);
  }
  if (runnerFromFirst && nextRandom(session) < scoreChance(session, runnerFromFirst, rates.first!)) {
    scoringPlayerIds.push(runnerFromFirst);
  }

  return {
    bases: {
      first: null,
      second: batterId,
      third: runnerFromFirst && !scoringPlayerIds.includes(runnerFromFirst) ? runnerFromFirst : null,
    },
    scoringPlayerIds,
  };
};

const resolveTripleAdvance = (
  session: GameSessionState,
  batterId: string,
): { bases: BaseState; scoringPlayerIds: string[] } => {
  const rates = SCORING_ADVANCE_RATES.triple;
  const scoringPlayerIds: string[] = [];
  const origins: Array<[RunnerOrigin, string | null]> = [
    ['third', session.bases.third],
    ['second', session.bases.second],
    ['first', session.bases.first],
  ];
  for (const [origin, runnerId] of origins) {
    if (runnerId && nextRandom(session) < scoreChance(session, runnerId, rates[origin]!)) {
      scoringPlayerIds.push(runnerId);
    }
  }

  return {
    bases: {
      first: null,
      second: null,
      third: batterId,
    },
    scoringPlayerIds,
  };
};

const resolveHomeRunAdvance = (
  session: GameSessionState,
  batterId: string,
): { bases: BaseState; scoringPlayerIds: string[] } => ({
  bases: emptyBases(),
  scoringPlayerIds: [session.bases.first, session.bases.second, session.bases.third, batterId].filter(
    (runnerId): runnerId is string => Boolean(runnerId),
  ),
});

const isWalkOff = (session: GameSessionState): boolean =>
  session.half === 'bottom' &&
  session.inning >= 9 &&
  session.scoreboard.homeRuns > session.scoreboard.awayRuns;

const assignPitcherDecision = (session: GameSessionState) => {
  const awayPitcherId = session.awayPitching.currentPitcherId;
  const homePitcherId = session.homePitching.currentPitcherId;
  const winningTeamId = session.scoreboard.awayRuns > session.scoreboard.homeRuns ? session.awayTeamId : session.homeTeamId;
  const losingTeamId = winningTeamId === session.awayTeamId ? session.homeTeamId : session.awayTeamId;
  const winningPitcherId = winningTeamId === session.awayTeamId ? awayPitcherId : homePitcherId;
  const losingPitcherId = losingTeamId === session.awayTeamId ? awayPitcherId : homePitcherId;

  session.playerStats.winningPitcherId = winningPitcherId;
  session.playerStats.losingPitcherId = losingPitcherId;

  if (session.playerStats.winningPitcherId) {
    ensurePitchingDelta(session, session.playerStats.winningPitcherId).wins += 1;
  }
  if (session.playerStats.losingPitcherId) {
    ensurePitchingDelta(session, session.playerStats.losingPitcherId).losses += 1;
  }

  const runMargin = Math.abs(session.scoreboard.awayRuns - session.scoreboard.homeRuns);
  if (runMargin <= 3 && winningPitcherId && winningPitcherId !== getTeamStarter(session, winningTeamId)?.playerId) {
    session.playerStats.savePitcherId = winningPitcherId;
    ensurePitchingDelta(session, winningPitcherId).saves += 1;
  }
};

const validateCompletedSession = (session: GameSessionState): void => {
  const awayLineScore = session.lineScore.reduce((total, inning) => total + inning.away, 0);
  const homeLineScore = session.lineScore.reduce((total, inning) => total + inning.home, 0);
  const battingRuns = Object.values(session.playerStats.batting).reduce((total, line) => total + line.runsScored, 0);
  const battingHits = Object.values(session.playerStats.batting).reduce((total, line) => total + line.hits, 0);

  const hasInvalidNumber = [
    session.scoreboard.awayRuns,
    session.scoreboard.homeRuns,
    awayLineScore,
    homeLineScore,
    battingRuns,
    battingHits,
  ].some((value) => !Number.isFinite(value) || value < 0 || !Number.isInteger(value));

  if (hasInvalidNumber) {
    throw new Error(`Invalid numeric box score generated for game ${session.gameId}.`);
  }

  if (awayLineScore !== session.scoreboard.awayRuns || homeLineScore !== session.scoreboard.homeRuns) {
    throw new Error(`Inning totals do not match the final score for game ${session.gameId}.`);
  }

  if (Object.keys(session.playerStats.batting).length > 0 && battingRuns !== session.scoreboard.awayRuns + session.scoreboard.homeRuns) {
    throw new Error(`Player runs do not match the final score for game ${session.gameId}.`);
  }

  if (Object.keys(session.playerStats.batting).length > 0 && battingHits !== session.scoreboard.awayHits + session.scoreboard.homeHits) {
    throw new Error(`Player hits do not match the box score for game ${session.gameId}.`);
  }
};

const completeGame = (session: GameSessionState, description: string): GameSessionState => {
  const completed = {
    ...session,
    status: 'completed' as const,
    playerStats: clonePlayerStatDelta(session.playerStats),
  };
  assignPitcherDecision(completed);
  return appendLog(completed, createLog(completed, 'GAME_END', description, null, null, null, 0, 0, []));
};

const completeBrokenGameByForfeit = (
  session: GameSessionState,
  awayTeam: Team,
  homeTeam: Team,
  brokenTeamId: string,
  reason: string,
): GameSessionState => {
  const awayBroken = brokenTeamId === awayTeam.id;
  const awayRuns = awayBroken
    ? session.scoreboard.awayRuns
    : Math.max(session.scoreboard.awayRuns, session.scoreboard.homeRuns + 1, 1);
  const homeRuns = awayBroken
    ? Math.max(session.scoreboard.homeRuns, session.scoreboard.awayRuns + 1, 1)
    : session.scoreboard.homeRuns;
  const winner = awayBroken ? homeTeam : awayTeam;
  const loser = awayBroken ? awayTeam : homeTeam;

  return completeGame(
    {
      ...session,
      scoreboard: {
        ...session.scoreboard,
        awayRuns,
        homeRuns,
      },
      lineScore: updateLineScore([], 1, awayBroken ? 'bottom' : 'top', awayBroken ? homeRuns : awayRuns),
    },
    `${winner.city} ${winner.name} take a forfeit win over ${loser.city} ${loser.name}. ${reason}`,
  );
};

const parseStoredParticipants = (game: Game): GameParticipantsSnapshot | null => {
  const raw = typeof game.stats.participants === 'string' ? game.stats.participants : null;
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as GameParticipantsSnapshot;
  } catch {
    return null;
  }
};

export const createGameSession = (
  game: Game,
  participants: GameParticipantsSnapshot | null = parseStoredParticipants(game),
): GameSessionState => ({
  gameId: game.gameId,
  date: game.date,
  awayTeamId: game.awayTeam,
  homeTeamId: game.homeTeam,
  randomState: createRandomSeed(`${game.gameId}:${game.date}:${game.awayTeam}:${game.homeTeam}`),
  participants,
  status: game.status === 'completed' ? 'completed' : 'pregame',
  inning: 1,
  half: 'top',
  outs: 0,
  bases: emptyBases(),
  awayBatterIndex: 0,
  homeBatterIndex: 0,
  awayPitching: {
    currentPitcherId: participants?.awayStarter?.playerId ?? null,
    pitchCount: 0,
    battersFaced: 0,
    enteredInning: 1,
    bullpenUsedIds: [],
  },
  homePitching: {
    currentPitcherId: participants?.homeStarter?.playerId ?? null,
    pitchCount: 0,
    battersFaced: 0,
    enteredInning: 1,
    bullpenUsedIds: [],
  },
  scoreboard: {
    awayRuns: game.status === 'completed' ? game.score.away : 0,
    homeRuns: game.status === 'completed' ? game.score.home : 0,
    awayHits: typeof game.stats.awayHits === 'number' ? game.stats.awayHits : 0,
    homeHits: typeof game.stats.homeHits === 'number' ? game.stats.homeHits : 0,
    awayErrors: typeof game.stats.awayErrors === 'number' ? game.stats.awayErrors : 0,
    homeErrors: typeof game.stats.homeErrors === 'number' ? game.stats.homeErrors : 0,
  },
  lineScore: [],
  logs: [],
  playerStats: createEmptyPlayerStatDelta(),
  nextEventSeq: 1,
});

export const hydrateGameSessionFromGame = (game: Game): GameSessionState | null => {
  const serializedLogs = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
  const serializedLineScore = typeof game.stats.lineScore === 'string' ? game.stats.lineScore : null;

  if (!serializedLogs || !serializedLineScore) {
    return null;
  }

  try {
    const logs = JSON.parse(serializedLogs) as PlayLogEvent[];
    const lineScore = JSON.parse(serializedLineScore) as InningLine[];
    const inning = typeof game.stats.finalInning === 'number' ? game.stats.finalInning : lineScore.length || 9;
    const participants = parseStoredParticipants(game);

    return {
      ...createGameSession(game, participants),
      status: 'completed',
      inning,
      half: 'bottom',
      outs: 3,
      bases: emptyBases(),
      scoreboard: {
        awayRuns: game.score.away,
        homeRuns: game.score.home,
        awayHits: typeof game.stats.awayHits === 'number' ? game.stats.awayHits : 0,
        homeHits: typeof game.stats.homeHits === 'number' ? game.stats.homeHits : 0,
        awayErrors: typeof game.stats.awayErrors === 'number' ? game.stats.awayErrors : 0,
        homeErrors: typeof game.stats.homeErrors === 'number' ? game.stats.homeErrors : 0,
      },
      lineScore,
      logs: logs.map((log) => ({ ...log, bases: normalizeBases(log.bases) })),
      nextEventSeq: logs.length + 1,
    };
  } catch {
    return null;
  }
};

export const startGameSession = (session: GameSessionState): GameSessionState => {
  const nextSession: GameSessionState = {
    ...session,
    status: 'in_progress',
    inning: 1,
    half: 'top',
    outs: 0,
    bases: emptyBases(),
    randomState: createRandomSeed(`${session.gameId}:${session.date}:${session.awayTeamId}:${session.homeTeamId}`),
    awayBatterIndex: 0,
    homeBatterIndex: 0,
    awayPitching: {
      currentPitcherId: session.participants?.awayStarter?.playerId ?? null,
      pitchCount: 0,
      battersFaced: 0,
      enteredInning: 1,
      bullpenUsedIds: [],
    },
    homePitching: {
      currentPitcherId: session.participants?.homeStarter?.playerId ?? null,
      pitchCount: 0,
      battersFaced: 0,
      enteredInning: 1,
      bullpenUsedIds: [],
    },
    scoreboard: {
      awayRuns: 0,
      homeRuns: 0,
      awayHits: 0,
      homeHits: 0,
      awayErrors: 0,
      homeErrors: 0,
    },
    lineScore: [],
    logs: [],
    playerStats: createEmptyPlayerStatDelta(),
    nextEventSeq: 1,
  };

  nextSession.participants?.awayLineup.forEach((batter) => {
    ensureBattingDelta(nextSession, batter.playerId).gamesPlayed += 1;
  });
  nextSession.participants?.homeLineup.forEach((batter) => {
    ensureBattingDelta(nextSession, batter.playerId).gamesPlayed += 1;
  });

  if (nextSession.participants?.awayStarter) {
    const line = ensurePitchingDelta(nextSession, nextSession.participants.awayStarter.playerId);
    line.games += 1;
    line.gamesStarted += 1;
  }
  if (nextSession.participants?.homeStarter) {
    const line = ensurePitchingDelta(nextSession, nextSession.participants.homeStarter.playerId);
    line.games += 1;
    line.gamesStarted += 1;
  }

  return nextSession;
};

export const simulateNextAtBat = (
  input: GameSessionState,
  awayTeam: Team,
  homeTeam: Team,
  settings: SimulationSettings,
): GameSessionState => {
  if (input.status === 'completed') {
    return input;
  }

  const startedSession = input.status === 'pregame' ? startGameSession(input) : { ...input };
  const session = maybeMakePitchingChange(startedSession);
  const batter = getCurrentBatter(session);
  const pitcher = getCurrentPitcher(session);
  if (!batter || !pitcher) {
    return session;
  }

  const battingTeam = session.half === 'top' ? awayTeam : homeTeam;
  const fieldingTeam = session.half === 'top' ? homeTeam : awayTeam;
  /*
   * THE PARK, RESOLVED FROM THE HOME TEAM.
   *
   * Not from `isHomeBatting`, and not from whichever of `battingTeam`/`fieldingTeam` happens
   * to be at the plate -- those two swap every half-inning, and a park does not. `homeTeam` is
   * the same object for every at-bat of the game, top and bottom alike, so the park is too.
   *
   * `null` when the club has no entry, which is what makes this safe for a league whose teams
   * are not the 32 in `parks.json`: the game plays with no park at all rather than with a
   * wrong one.
   */
  const park = parkFactorsForTeam(homeTeam.id);
  const weights = getOutcomeWeights(
    session, batter, pitcher, battingTeam, fieldingTeam, session.half === 'bottom', settings, park,
  );
  const outcome = pickOutcome(session, weights);
  const defender = outcome === 'ERR' || outcome === 'OUT' ? pickDefender(session) : null;

  let nextSession: GameSessionState = {
    ...session,
    bases: cloneBases(session.bases),
    awayPitching: { ...session.awayPitching, bullpenUsedIds: [...session.awayPitching.bullpenUsedIds] },
    homePitching: { ...session.homePitching, bullpenUsedIds: [...session.homePitching.bullpenUsedIds] },
    scoreboard: { ...session.scoreboard },
    lineScore: session.lineScore.map((line) => ({ ...line })),
    playerStats: clonePlayerStatDelta(session.playerStats),
  };

  const battingLine = ensureBattingDelta(nextSession, batter.playerId);
  const pitchingLine = ensurePitchingDelta(nextSession, pitcher.playerId);
  let description = '';
  let runsScored = 0;
  let rbi = 0;
  let scoringPlayerIds: string[] = [];

  battingLine.plateAppearances += 1;
  addPitchUsage(nextSession, outcome);

  if (outcome === 'OUT' || outcome === 'SO') {
    nextSession.outs += 1;
    battingLine.atBats += 1;
    if (outcome === 'SO') {
      battingLine.strikeouts += 1;
      pitchingLine.strikeouts += 1;
      description = `${batter.fullName} strikes out against ${pitcher.fullName}.`;
    } else {
      description = defender
        ? `${batter.fullName} is retired by ${defender.fullName}.`
        : `${batter.fullName} is retired.`;
    }
    recordPitchingOut(nextSession, pitcher.playerId, 1);
  } else if (outcome === 'BB') {
    const advance = resolveWalk(nextSession, batter.playerId);
    nextSession.bases = advance.bases;
    battingLine.walks += 1;
    pitchingLine.walks += 1;
    scoringPlayerIds = advance.scoringPlayerIds;
    runsScored = scoringPlayerIds.length;
    rbi = runsScored;
    description = `${batter.fullName} draws a walk off ${pitcher.fullName}.`;
  } else if (outcome === '1B' || outcome === 'ERR') {
    const advance = resolveSingleLikeAdvance(nextSession, batter.playerId);
    nextSession.bases = advance.bases;
    scoringPlayerIds = advance.scoringPlayerIds;
    runsScored = scoringPlayerIds.length;
    rbi = outcome === 'ERR' ? 0 : runsScored;
    battingLine.atBats += 1;
    if (outcome === '1B') {
      battingLine.hits += 1;
      pitchingLine.hitsAllowed += 1;
      if (session.half === 'top') {
        nextSession.scoreboard.awayHits += 1;
      } else {
        nextSession.scoreboard.homeHits += 1;
      }
      description = `${batter.fullName} singles off ${pitcher.fullName}.`;
    } else {
      if (session.half === 'top') {
        nextSession.scoreboard.homeErrors += 1;
      } else {
        nextSession.scoreboard.awayErrors += 1;
      }
      description = defender
        ? `${defender.fullName} boots the ball and ${batter.fullName} reaches on an error.`
        : `${batter.fullName} reaches on an error.`;
    }
  } else if (outcome === '2B') {
    const advance = resolveDoubleAdvance(nextSession, batter.playerId);
    nextSession.bases = advance.bases;
    scoringPlayerIds = advance.scoringPlayerIds;
    runsScored = scoringPlayerIds.length;
    rbi = runsScored;
    battingLine.atBats += 1;
    battingLine.hits += 1;
    battingLine.doubles += 1;
    pitchingLine.hitsAllowed += 1;
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += 1;
    } else {
      nextSession.scoreboard.homeHits += 1;
    }
    description = `${batter.fullName} rips a double off ${pitcher.fullName}.`;
  } else if (outcome === '3B') {
    const advance = resolveTripleAdvance(nextSession, batter.playerId);
    nextSession.bases = advance.bases;
    scoringPlayerIds = advance.scoringPlayerIds;
    runsScored = scoringPlayerIds.length;
    rbi = runsScored;
    battingLine.atBats += 1;
    battingLine.hits += 1;
    battingLine.triples += 1;
    pitchingLine.hitsAllowed += 1;
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += 1;
    } else {
      nextSession.scoreboard.homeHits += 1;
    }
    description = `${batter.fullName} triples into the gap off ${pitcher.fullName}.`;
  } else if (outcome === 'HR') {
    const advance = resolveHomeRunAdvance(nextSession, batter.playerId);
    nextSession.bases = advance.bases;
    scoringPlayerIds = advance.scoringPlayerIds;
    runsScored = scoringPlayerIds.length;
    rbi = runsScored;
    battingLine.atBats += 1;
    battingLine.hits += 1;
    battingLine.homeRuns += 1;
    pitchingLine.hitsAllowed += 1;
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += 1;
    } else {
      nextSession.scoreboard.homeHits += 1;
    }
    description = `${batter.fullName} launches a home run off ${pitcher.fullName}.`;
  }

  assignRunsAndRbi(nextSession, scoringPlayerIds, batter.playerId, pitcher.playerId, rbi, outcome !== 'ERR');
  nextSession = addRuns(nextSession, runsScored);
  // `session.bases` is the pre-at-bat state, which is the occupancy this
  // plate appearance was decided against.
  recordProbeAtBat(session.bases, outcome, runsScored);
  nextSession = advanceBatterIndex(nextSession);
  nextSession = appendLog(nextSession, createLog(nextSession, outcome, description, batter, pitcher, defender, runsScored, rbi, scoringPlayerIds));

  if (isWalkOff(nextSession)) {
    return completeGame(nextSession, `${homeTeam.city} ${homeTeam.name} walk it off in the bottom of the ${nextSession.inning}th.`);
  }

  if (nextSession.outs >= 3) {
    const endedHalf = nextSession.half;
    nextSession = {
      ...nextSession,
      lineScore: ensureLineScore(nextSession.lineScore, nextSession.inning),
      bases: emptyBases(),
    };
    const halfDescription =
      endedHalf === 'top'
        ? `Top ${nextSession.inning} complete.`
        : `Bottom ${nextSession.inning} complete.`;
    const withHalfLog = appendLog(nextSession, createLog(nextSession, 'HALF_END', halfDescription, null, null, null, 0, 0, []));

    if (endedHalf === 'top') {
      if (withHalfLog.inning >= 9 && withHalfLog.scoreboard.homeRuns > withHalfLog.scoreboard.awayRuns) {
        return completeGame(withHalfLog, `${homeTeam.city} ${homeTeam.name} win ${withHalfLog.scoreboard.homeRuns}-${withHalfLog.scoreboard.awayRuns}.`);
      }

      return {
        ...withHalfLog,
        half: 'bottom',
        outs: 0,
        bases: emptyBases(),
      };
    }

    if (withHalfLog.inning >= 9 && withHalfLog.scoreboard.awayRuns !== withHalfLog.scoreboard.homeRuns) {
      const winner = withHalfLog.scoreboard.awayRuns > withHalfLog.scoreboard.homeRuns ? awayTeam : homeTeam;
      return completeGame(withHalfLog, `${winner.city} ${winner.name} win ${withHalfLog.scoreboard.awayRuns}-${withHalfLog.scoreboard.homeRuns}.`);
    }

    return {
      ...withHalfLog,
      inning: withHalfLog.inning + 1,
      half: 'top',
      outs: 0,
      bases: emptyBases(),
    };
  }

  return nextSession;
};

export const simulateNextHalfInning = (
  session: GameSessionState,
  awayTeam: Team,
  homeTeam: Team,
  settings: SimulationSettings,
): GameSessionState => {
  let current = session;
  const halfMarker = `${current.inning}-${current.half}`;
  while (current.status !== 'completed' && `${current.inning}-${current.half}` === halfMarker) {
    current = simulateNextAtBat(current, awayTeam, homeTeam, settings);
  }
  return current;
};

export const simulateGameToFinal = (
  session: GameSessionState,
  awayTeam: Team,
  homeTeam: Team,
  settings: SimulationSettings,
): GameSessionState => {
  let current = session.status === 'pregame' ? startGameSession(session) : session;
  let stalledSteps = 0;
  let simulatedAtBats = 0;
  while (current.status !== 'completed') {
    simulatedAtBats += 1;
    if (simulatedAtBats > 1200) {
      return completeBrokenGameByForfeit(
        current,
        awayTeam,
        homeTeam,
        getBattingTeamId(current),
        'The game exceeded the maximum number of simulated at-bats.',
      );
    }

    const next = simulateNextAtBat(current, awayTeam, homeTeam, settings);
    if (next === current) {
      stalledSteps += 1;
      const missingBatter = getCurrentBatter(current);
      const missingPitcher = getCurrentPitcher(current);
      if (!missingBatter || !missingPitcher || stalledSteps >= 3) {
        const brokenTeamId = !missingBatter ? getBattingTeamId(current) : getFieldingTeamId(current);
        const reason = !missingBatter
          ? 'The batting side had no valid lineup entry available.'
          : !missingPitcher
            ? 'The fielding side had no valid pitcher available.'
            : 'The game state stalled unexpectedly and was terminated to protect the simulation.';
        return completeBrokenGameByForfeit(current, awayTeam, homeTeam, brokenTeamId, reason);
      }
    } else {
      stalledSteps = 0;
    }
    current = next;
  }
  return current;
};

export const buildCompletedGameFromSession = (game: Game, session: GameSessionState): CompletedGameResult => {
  validateCompletedSession(session);

  return {
    game: {
    ...game,
    status: 'completed',
    score: {
      away: session.scoreboard.awayRuns,
      home: session.scoreboard.homeRuns,
    },
    stats: {
      ...game.stats,
      awayHits: session.scoreboard.awayHits,
      homeHits: session.scoreboard.homeHits,
      awayErrors: session.scoreboard.awayErrors,
      homeErrors: session.scoreboard.homeErrors,
      playLog: JSON.stringify(session.logs),
      lineScore: JSON.stringify(session.lineScore),
      participants: session.participants ? JSON.stringify(session.participants) : null,
      winningPitcherId: session.playerStats.winningPitcherId,
      losingPitcherId: session.playerStats.losingPitcherId,
      savePitcherId: session.playerStats.savePitcherId,
      finalInning: session.inning,
      interactiveSim: true,
      simulatedAt: new Date().toISOString(),
    },
    },
    playerStatDelta: clonePlayerStatDelta(session.playerStats),
  };
};
