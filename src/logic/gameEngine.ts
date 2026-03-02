import {
  AtBatOutcome,
  BaseState,
  Game,
  GameSessionState,
  InningHalf,
  InningLine,
  PlayLogEvent,
  SimulationSettings,
  Team,
} from '../types';

const OUTCOME_POOL: AtBatOutcome[] = ['OUT', 'BB', '1B', '2B', '3B', 'HR', 'ERR'];
const BASE_WEIGHTS: Record<AtBatOutcome, number> = {
  OUT: 680,
  BB: 90,
  '1B': 150,
  '2B': 40,
  '3B': 5,
  HR: 30,
  ERR: 5,
};

const cloneBases = (bases: BaseState): BaseState => ({ ...bases });

const getBattingTeamId = (session: GameSessionState): string =>
  session.half === 'top' ? session.awayTeamId : session.homeTeamId;

const getFieldingTeamId = (session: GameSessionState): string =>
  session.half === 'top' ? session.homeTeamId : session.awayTeamId;

const getOutcomeWeights = (
  battingTeam: Team,
  fieldingTeam: Team,
  isHomeBatting: boolean,
  settings: SimulationSettings,
): Record<AtBatOutcome, number> => {
  const ratingEdge = battingTeam.rating - fieldingTeam.rating;
  const homeBonus = isHomeBatting ? settings.homeFieldAdvantage * 100 : -settings.homeFieldAdvantage * 100;
  const varianceNoise = (Math.random() - 0.5) * settings.gameLuckFactor * 50;
  const edge = ratingEdge * 0.8 + homeBonus + varianceNoise;

  return {
    OUT: Math.max(560, Math.min(760, BASE_WEIGHTS.OUT - edge * 6)),
    BB: Math.max(55, Math.min(135, BASE_WEIGHTS.BB + edge * 1.2)),
    '1B': Math.max(100, Math.min(220, BASE_WEIGHTS['1B'] + edge * 2.4)),
    '2B': Math.max(18, Math.min(72, BASE_WEIGHTS['2B'] + edge * 0.9)),
    '3B': Math.max(2, Math.min(10, BASE_WEIGHTS['3B'] + edge * 0.08)),
    HR: Math.max(10, Math.min(65, BASE_WEIGHTS.HR + edge * 0.8)),
    ERR: BASE_WEIGHTS.ERR,
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

const createLog = (
  session: GameSessionState,
  outcome: PlayLogEvent['outcome'],
  description: string,
  runsScored: number,
): PlayLogEvent => ({
  seq: session.nextEventSeq,
  inning: session.inning,
  half: session.half,
  battingTeamId: getBattingTeamId(session),
  outcome,
  description,
  runsScored,
  outs: session.outs,
  scoreAway: session.scoreboard.awayRuns,
  scoreHome: session.scoreboard.homeRuns,
  bases: cloneBases(session.bases),
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

const appendLog = (session: GameSessionState, log: PlayLogEvent): GameSessionState => ({
  ...session,
  logs: [...session.logs, log],
  nextEventSeq: session.nextEventSeq + 1,
});

const isWalkOff = (session: GameSessionState): boolean =>
  session.half === 'bottom' &&
  session.inning >= 9 &&
  session.scoreboard.homeRuns > session.scoreboard.awayRuns;

const completeGame = (session: GameSessionState, description: string): GameSessionState => {
  const completed = {
    ...session,
    status: 'completed' as const,
  };
  return appendLog(completed, createLog(completed, 'GAME_END', description, 0));
};

export const createGameSession = (game: Game): GameSessionState => ({
  gameId: game.gameId,
  date: game.date,
  awayTeamId: game.awayTeam,
  homeTeamId: game.homeTeam,
  status: game.status === 'completed' ? 'completed' : 'pregame',
  inning: 1,
  half: 'top',
  outs: 0,
  bases: { first: false, second: false, third: false },
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
    return {
      gameId: game.gameId,
      date: game.date,
      awayTeamId: game.awayTeam,
      homeTeamId: game.homeTeam,
      status: 'completed',
      inning,
      half: 'bottom',
      outs: 3,
      bases: { first: false, second: false, third: false },
      scoreboard: {
        awayRuns: game.score.away,
        homeRuns: game.score.home,
        awayHits: typeof game.stats.awayHits === 'number' ? game.stats.awayHits : 0,
        homeHits: typeof game.stats.homeHits === 'number' ? game.stats.homeHits : 0,
        awayErrors: typeof game.stats.awayErrors === 'number' ? game.stats.awayErrors : 0,
        homeErrors: typeof game.stats.homeErrors === 'number' ? game.stats.homeErrors : 0,
      },
      lineScore,
      logs,
      nextEventSeq: logs.length + 1,
    };
  } catch {
    return null;
  }
};

export const startGameSession = (session: GameSessionState): GameSessionState => ({
  ...session,
  status: 'in_progress',
  inning: 1,
  half: 'top',
  outs: 0,
  bases: { first: false, second: false, third: false },
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
  nextEventSeq: 1,
});

export const simulateNextAtBat = (
  input: GameSessionState,
  awayTeam: Team,
  homeTeam: Team,
  settings: SimulationSettings,
): GameSessionState => {
  if (input.status === 'completed') {
    return input;
  }

  const session = input.status === 'pregame' ? startGameSession(input) : input;
  const battingTeam = session.half === 'top' ? awayTeam : homeTeam;
  const fieldingTeam = session.half === 'top' ? homeTeam : awayTeam;
  const weights = getOutcomeWeights(battingTeam, fieldingTeam, session.half === 'bottom', settings);
  const outcome = pickOutcome(weights);

  let nextSession: GameSessionState = {
    ...session,
    bases: cloneBases(session.bases),
    scoreboard: { ...session.scoreboard },
    lineScore: session.lineScore.map((line) => ({ ...line })),
  };

  let runsScored = 0;
  let description = '';

  if (outcome === 'OUT') {
    nextSession.outs += 1;
    description = `${battingTeam.city} ${battingTeam.name} records an out.`;
  } else if (outcome === 'BB') {
    const forcedRun = nextSession.bases.first && nextSession.bases.second && nextSession.bases.third ? 1 : 0;
    if (forcedRun) {
      runsScored += 1;
    }
    nextSession.bases = {
      first: true,
      second: nextSession.bases.first || nextSession.bases.second,
      third: nextSession.bases.third || (nextSession.bases.second && nextSession.bases.first),
    };
    description = `${battingTeam.city} ${battingTeam.name} draws a walk.`;
  } else if (outcome === '1B' || outcome === 'ERR') {
    const isSingle = outcome === '1B';
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += isSingle ? 1 : 0;
      nextSession.scoreboard.homeErrors += isSingle ? 0 : 1;
    } else {
      nextSession.scoreboard.homeHits += isSingle ? 1 : 0;
      nextSession.scoreboard.awayErrors += isSingle ? 0 : 1;
    }

    if (nextSession.bases.third) {
      runsScored += 1;
    }
    const runnerFromSecondScores = nextSession.bases.second && Math.random() > 0.5;
    const newThird = nextSession.bases.second && !runnerFromSecondScores;
    if (runnerFromSecondScores) {
      runsScored += 1;
    }

    nextSession.bases = {
      first: true,
      second: nextSession.bases.first,
      third: newThird,
    };
    description = isSingle
      ? `${battingTeam.city} ${battingTeam.name} lines a single.`
      : `${fieldingTeam.city} ${fieldingTeam.name} commits an error.`;
  } else if (outcome === '2B') {
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += 1;
    } else {
      nextSession.scoreboard.homeHits += 1;
    }

    if (nextSession.bases.third) runsScored += 1;
    if (nextSession.bases.second) runsScored += 1;
    const runnerFromFirstScores = nextSession.bases.first && Math.random() < 0.4;
    if (runnerFromFirstScores) {
      runsScored += 1;
    }

    nextSession.bases = {
      first: false,
      second: true,
      third: nextSession.bases.first && !runnerFromFirstScores,
    };
    description = `${battingTeam.city} ${battingTeam.name} drives a double.`;
  } else if (outcome === '3B') {
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += 1;
    } else {
      nextSession.scoreboard.homeHits += 1;
    }

    runsScored += Number(nextSession.bases.first) + Number(nextSession.bases.second) + Number(nextSession.bases.third);
    nextSession.bases = { first: false, second: false, third: true };
    description = `${battingTeam.city} ${battingTeam.name} rips a triple.`;
  } else if (outcome === 'HR') {
    if (session.half === 'top') {
      nextSession.scoreboard.awayHits += 1;
    } else {
      nextSession.scoreboard.homeHits += 1;
    }

    runsScored += Number(nextSession.bases.first) + Number(nextSession.bases.second) + Number(nextSession.bases.third) + 1;
    nextSession.bases = { first: false, second: false, third: false };
    description = `${battingTeam.city} ${battingTeam.name} launches a home run.`;
  }

  nextSession = addRuns(nextSession, runsScored);
  nextSession = appendLog(nextSession, createLog(nextSession, outcome, description, runsScored));

  if (isWalkOff(nextSession)) {
    return completeGame(nextSession, `${homeTeam.city} ${homeTeam.name} walk it off in the bottom of the ${nextSession.inning}th.`);
  }

  if (nextSession.outs >= 3) {
    const endedHalf = nextSession.half;
    nextSession = {
      ...nextSession,
      lineScore: ensureLineScore(nextSession.lineScore, nextSession.inning),
    };
    const halfDescription =
      endedHalf === 'top'
        ? `Top ${nextSession.inning} complete.`
        : `Bottom ${nextSession.inning} complete.`;
    const withHalfLog = appendLog(nextSession, createLog(nextSession, 'HALF_END', halfDescription, 0));

    if (endedHalf === 'top') {
      if (withHalfLog.inning >= 9 && withHalfLog.scoreboard.homeRuns > withHalfLog.scoreboard.awayRuns) {
        return completeGame(withHalfLog, `${homeTeam.city} ${homeTeam.name} win ${withHalfLog.scoreboard.homeRuns}-${withHalfLog.scoreboard.awayRuns}.`);
      }

      return {
        ...withHalfLog,
        half: 'bottom',
        outs: 0,
        bases: { first: false, second: false, third: false },
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
      bases: { first: false, second: false, third: false },
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

export const buildCompletedGameFromSession = (game: Game, session: GameSessionState): Game => ({
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
    finalInning: session.inning,
    interactiveSim: true,
    simulatedAt: new Date().toISOString(),
  },
});
