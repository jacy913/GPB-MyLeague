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

const OUTCOME_POOL: AtBatOutcome[] = ['OUT', 'SO', 'BB', '1B', '2B', '3B', 'HR', 'ERR'];
const INNING_OUT_VALUE = Number((1 / 3).toFixed(3));

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

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
  if (runsScored <= 0) {
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

  const index = Math.floor(Math.random() * lineup.length);
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

const getOutcomeWeights = (
  session: GameSessionState,
  batter: GameParticipantBatter,
  pitcher: GameParticipantPitcher,
  battingTeam: Team,
  fieldingTeam: Team,
  isHomeBatting: boolean,
  settings: SimulationSettings,
): Record<AtBatOutcome, number> => {
  const fatiguePenalty = getFatiguePenalty(session, pitcher);
  const defenseQuality = getDefenseQuality(session);
  const homeBonus = isHomeBatting ? settings.homeFieldAdvantage * 80 : -settings.homeFieldAdvantage * 80;
  const teamEdge = (battingTeam.rating - fieldingTeam.rating) * 0.65;
  const noise = (Math.random() - 0.5) * settings.gameLuckFactor * 60;
  const powerEdge = batter.battingRatings.power - pitcher.pitchingRatings.movement;
  const contactEdge = batter.battingRatings.contact - (pitcher.pitchingRatings.stuff * 0.55 + pitcher.pitchingRatings.movement * 0.45);
  const disciplineEdge = batter.battingRatings.plateDiscipline - pitcher.pitchingRatings.control;
  const strikeoutEdge = batter.battingRatings.avoidStrikeout - pitcher.pitchingRatings.stuff;
  const speedEdge = (batter.battingRatings.speed + batter.battingRatings.baserunning) / 2 - defenseQuality;
  const batterForm = getBatterFormBonus(batter);
  const pitcherForm = getPitcherFormBonus(pitcher);
  const edge = teamEdge + homeBonus + noise + fatiguePenalty + batterForm - pitcherForm;

  return {
    OUT: clamp(410 - contactEdge * 0.85 - powerEdge * 0.12 + defenseQuality * 0.35 - edge * 0.35, 320, 560),
    SO: clamp(180 - strikeoutEdge * 1.05 + (pitcher.pitchingRatings.command - batter.battingRatings.contact) * 0.45 - fatiguePenalty * 0.45 - batterForm * 0.16 + pitcherForm * 0.22, 90, 255),
    BB: clamp(68 + disciplineEdge * 0.7 + (pitcher.pitchingRatings.command - pitcher.pitchingRatings.control) * -0.22 + fatiguePenalty * 0.35 + edge * 0.08, 28, 125),
    '1B': clamp(140 + contactEdge * 0.82 + batterForm * 0.24 - pitcherForm * 0.18 + edge * 0.24, 92, 210),
    '2B': clamp(33 + powerEdge * 0.32 + speedEdge * 0.12 + batterForm * 0.1 - pitcherForm * 0.08 + edge * 0.08, 12, 62),
    '3B': clamp(4 + speedEdge * 0.05 + contactEdge * 0.015, 1, 10),
    HR: clamp(21 + powerEdge * 0.42 + batterForm * 0.15 - pitcherForm * 0.1 + edge * 0.1 - defenseQuality * 0.03, 4, 48),
    ERR: clamp(5 + (90 - defenseQuality) * 0.12, 1, 12),
  };
};

const pickOutcome = (weights: Record<AtBatOutcome, number>): AtBatOutcome => {
  const total = OUTCOME_POOL.reduce((sum, outcome) => sum + weights[outcome], 0);
  let roll = Math.random() * total;
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
    outcome === 'BB' ? 5 + Math.floor(Math.random() * 2)
      : outcome === 'SO' ? 4 + Math.floor(Math.random() * 2)
        : 3 + Math.floor(Math.random() * 3);

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
  const scoringPlayerIds: string[] = [];
  const runnerFromThird = session.bases.third;
  const runnerFromSecond = session.bases.second;
  const runnerFromFirst = session.bases.first;

  if (runnerFromThird) {
    scoringPlayerIds.push(runnerFromThird);
  }

  const secondRunnerScores = runnerFromSecond
    ? Math.random() < clamp((getRunnerSpeed(session, runnerFromSecond) - 55) / 55, 0.45, 0.92)
    : false;
  if (runnerFromSecond && secondRunnerScores) {
    scoringPlayerIds.push(runnerFromSecond);
  }

  const firstRunnerToThird = runnerFromFirst
    ? Math.random() < clamp((getRunnerSpeed(session, runnerFromFirst) - 45) / 60, 0.25, 0.82)
    : false;

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
  const scoringPlayerIds = [session.bases.third, session.bases.second].filter((runnerId): runnerId is string => Boolean(runnerId));
  const runnerFromFirstScores = session.bases.first
    ? Math.random() < clamp((getRunnerSpeed(session, session.bases.first) - 45) / 65, 0.3, 0.78)
    : false;

  if (session.bases.first && runnerFromFirstScores) {
    scoringPlayerIds.push(session.bases.first);
  }

  return {
    bases: {
      first: null,
      second: batterId,
      third: session.bases.first && !runnerFromFirstScores ? session.bases.first : null,
    },
    scoringPlayerIds,
  };
};

const resolveTripleAdvance = (
  session: GameSessionState,
  batterId: string,
): { bases: BaseState; scoringPlayerIds: string[] } => ({
  bases: {
    first: null,
    second: null,
    third: batterId,
  },
  scoringPlayerIds: [session.bases.first, session.bases.second, session.bases.third].filter(
    (runnerId): runnerId is string => Boolean(runnerId),
  ),
});

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
  if (session.scoreboard.awayRuns > session.scoreboard.homeRuns) {
    session.playerStats.winningPitcherId = awayPitcherId;
    session.playerStats.losingPitcherId = homePitcherId;
  } else if (session.scoreboard.homeRuns > session.scoreboard.awayRuns) {
    session.playerStats.winningPitcherId = homePitcherId;
    session.playerStats.losingPitcherId = awayPitcherId;
  }

  if (session.playerStats.winningPitcherId) {
    ensurePitchingDelta(session, session.playerStats.winningPitcherId).wins += 1;
  }
  if (session.playerStats.losingPitcherId) {
    ensurePitchingDelta(session, session.playerStats.losingPitcherId).losses += 1;
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

  const startedSession = input.status === 'pregame' ? startGameSession(input) : input;
  const session = maybeMakePitchingChange(startedSession);
  const batter = getCurrentBatter(session);
  const pitcher = getCurrentPitcher(session);
  if (!batter || !pitcher) {
    return session;
  }

  const battingTeam = session.half === 'top' ? awayTeam : homeTeam;
  const fieldingTeam = session.half === 'top' ? homeTeam : awayTeam;
  const weights = getOutcomeWeights(session, batter, pitcher, battingTeam, fieldingTeam, session.half === 'bottom', settings);
  const outcome = pickOutcome(weights);
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
  while (current.status !== 'completed') {
    current = simulateNextAtBat(current, awayTeam, homeTeam, settings);
  }
  return current;
};

export const buildCompletedGameFromSession = (game: Game, session: GameSessionState): CompletedGameResult => ({
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
});
