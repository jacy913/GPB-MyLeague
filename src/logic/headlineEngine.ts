import {
  Game,
  PlayLogEvent,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerTransaction,
  Team,
} from '../types';
import { isPlayoffGame } from './playoffs';

export type HeadlineCard = {
  headline: string;
  summary: string;
  accent: string;
  game: Game | null;
};

export type HeadlineDeck = {
  primary: HeadlineCard;
  secondary: HeadlineCard[];
  sourceDate: string | null;
};

export type StoryCandidate = HeadlineCard & {
  priority: number;
};

export type TransactionStoryCandidate = HeadlineCard & {
  priority: number;
  key: string;
};

export type GameIndexes = {
  gamesByDate: Map<string, Game[]>;
  completedGamesDesc: Game[];
  completedGamesByDate: Map<string, Game[]>;
};

export type TransactionIndexes = {
  sortedTransactionsDesc: PlayerTransaction[];
  spotlightTransactionsDesc: PlayerTransaction[];
  spotlightTransactionsByDate: Map<string, PlayerTransaction[]>;
};

export type GameStoryCacheEntry = {
  rawPlayLog: string | null;
  awayScore: number;
  homeScore: number;
  awayHits: number | null;
  homeHits: number | null;
  isPlayoff: boolean;
  stories: StoryCandidate[];
};

export type FeaturedGameCard = {
  game: Game;
  lore: string;
  angle: string;
};

type DerivedBattingLine = {
  playerId: string;
  playerName: string;
  teamId: string;
  plateAppearances: number;
  atBats: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  rbi: number;
  runsScored: number;
};

type DerivedPitchingLine = {
  playerId: string;
  playerName: string;
  teamId: string;
  outsRecorded: number;
  hitsAllowed: number;
  walks: number;
  strikeouts: number;
  runsAllowed: number;
};

export const compareGameOrder = (left: Game, right: Game): number =>
  left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date);

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

const getLeader = (awayScore: number, homeScore: number): 'away' | 'home' | 'tie' => {
  if (awayScore === homeScore) {
    return 'tie';
  }

  return awayScore > homeScore ? 'away' : 'home';
};

export const formatTickerTransaction = (
  transaction: PlayerTransaction,
  playersById: Map<string, Player>,
  teamsById: Map<string, Team>,
): string => {
  const player = playersById.get(transaction.playerId);
  const playerLabel = player ? `${player.firstName} ${player.lastName}` : 'Unknown Player';
  const fromTeam = transaction.fromTeamId ? teamsById.get(transaction.fromTeamId) : null;
  const toTeam = transaction.toTeamId ? teamsById.get(transaction.toTeamId) : null;
  const fromLabel = fromTeam ? fromTeam.city : 'FA Pool';
  const toLabel = toTeam ? toTeam.city : 'FA Pool';

  if (transaction.eventType === 'traded') {
    return `TRADE | ${playerLabel} shipped from ${fromLabel} to ${toLabel}`;
  }

  if (transaction.eventType === 'signed') {
    return `SIGNING | ${playerLabel} joins ${toLabel}`;
  }

  if (transaction.eventType === 'released') {
    return `RELEASE | ${playerLabel} departs ${fromLabel}`;
  }

  return `${transaction.eventType.toUpperCase()} | ${playerLabel}`;
};

export const formatTickerGame = (game: Game, teamsById: Map<string, Team>): string => {
  const awayTeam = teamsById.get(game.awayTeam);
  const homeTeam = teamsById.get(game.homeTeam);
  const awayLabel = awayTeam ? awayTeam.id.toUpperCase() : game.awayTeam.toUpperCase();
  const homeLabel = homeTeam ? homeTeam.id.toUpperCase() : game.homeTeam.toUpperCase();
  const gameTag = isPlayoffGame(game) ? 'PL' : 'REG';
  return `${gameTag} | ${awayLabel} ${game.score.away} - ${homeLabel} ${game.score.home}`;
};

const parseStoredLogs = (game: Game): PlayLogEvent[] => {
  const raw = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as PlayLogEvent[];
  } catch {
    return [];
  }
};

const formatInningsPitched = (outsRecorded: number): string => `${Math.floor(outsRecorded / 3)}.${outsRecorded % 3}`;

const getTopEntry = <T,>(entries: Iterable<T>, compare: (left: T, right: T) => number): T | undefined => {
  let best: T | undefined;
  for (const entry of entries) {
    if (!best || compare(entry, best) < 0) {
      best = entry;
    }
  }
  return best;
};

export const buildGameIndexes = (games: Game[]): GameIndexes => {
  const gamesByDate = new Map<string, Game[]>();
  const completedGamesDesc: Game[] = [];
  const completedGamesByDate = new Map<string, Game[]>();

  for (const game of games) {
    const gamesForDate = gamesByDate.get(game.date);
    if (gamesForDate) {
      gamesForDate.push(game);
    } else {
      gamesByDate.set(game.date, [game]);
    }

    if (game.status !== 'completed') {
      continue;
    }

    completedGamesDesc.push(game);
    const completedForDate = completedGamesByDate.get(game.date);
    if (completedForDate) {
      completedForDate.push(game);
    } else {
      completedGamesByDate.set(game.date, [game]);
    }
  }

  for (const gamesForDate of gamesByDate.values()) {
    gamesForDate.sort(compareGameOrder);
  }

  completedGamesDesc.sort((left, right) => compareGameOrder(right, left));
  for (const gamesForDate of completedGamesByDate.values()) {
    gamesForDate.sort((left, right) => compareGameOrder(right, left));
  }

  return {
    gamesByDate,
    completedGamesDesc,
    completedGamesByDate,
  };
};

export const buildTransactionIndexes = (transactions: PlayerTransaction[]): TransactionIndexes => {
  const sortedTransactionsDesc = [...transactions].sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate));
  const spotlightTransactionsDesc = sortedTransactionsDesc.filter(
    (transaction) =>
      transaction.eventType === 'signed' ||
      transaction.eventType === 'traded' ||
      transaction.eventType === 'released' ||
      transaction.eventType === 'retired' ||
      transaction.eventType === 'drafted',
  );
  const spotlightTransactionsByDate = new Map<string, PlayerTransaction[]>();

  for (const transaction of spotlightTransactionsDesc) {
    const transactionsForDate = spotlightTransactionsByDate.get(transaction.effectiveDate);
    if (transactionsForDate) {
      transactionsForDate.push(transaction);
    } else {
      spotlightTransactionsByDate.set(transaction.effectiveDate, [transaction]);
    }
  }

  return {
    sortedTransactionsDesc,
    spotlightTransactionsDesc,
    spotlightTransactionsByDate,
  };
};

const createStory = (
  priority: number,
  headline: string,
  summary: string,
  accent: string,
  game: Game,
): StoryCandidate => ({
  priority,
  headline,
  summary,
  accent,
  game,
});

const createTransactionStory = (
  priority: number,
  key: string,
  headline: string,
  summary: string,
  accent: string,
): TransactionStoryCandidate => ({
  priority,
  key,
  headline,
  summary,
  accent,
  game: null,
});

const getHeadlinePriorityScore = (game: Game): number => {
  const margin = Math.abs(game.score.away - game.score.home);
  const totalRuns = game.score.away + game.score.home;
  let score = totalRuns * 2 + margin * 5;

  if (isPlayoffGame(game)) {
    score += 40;
  }

  if (game.score.away === 0 || game.score.home === 0) {
    score += 18;
  }

  if (margin <= 1) {
    score += 10;
  }

  return score;
};

const createGameHeadline = (game: Game, teamsById: Map<string, Team>): HeadlineCard => {
  const awayTeam = teamsById.get(game.awayTeam);
  const homeTeam = teamsById.get(game.homeTeam);
  const margin = Math.abs(game.score.away - game.score.home);
  const totalRuns = game.score.away + game.score.home;
  const awayWon = game.score.away > game.score.home;
  const winner = awayWon ? awayTeam : homeTeam;
  const loser = awayWon ? homeTeam : awayTeam;

  if (game.score.away === 0 || game.score.home === 0 || totalRuns <= 2) {
    return {
      headline: 'A MASTERCLASS ON THE MOUND',
      summary: `${winner?.city ?? 'A contender'} smothered ${loser?.city ?? 'the opposition'} in a low-scoring showcase that sent shockwaves through the league.`,
      accent: 'from-[#6a560d] via-[#1d1d1d] to-[#132f2a]',
      game,
    };
  }

  if (margin >= 7) {
    return {
      headline: 'TOTAL DOMINATION',
      summary: `${winner?.city ?? 'The winner'} turned the latest slate into a statement, rolling to a ${game.score.away}-${game.score.home} finish that shifted the tone of the season.`,
      accent: 'from-[#4a3408] via-[#191919] to-[#12352d]',
      game,
    };
  }

  if (isPlayoffGame(game)) {
    return {
      headline: 'OCTOBER PRESSURE RISING',
      summary: `${winner?.city ?? 'The winner'} tightened its grip on the postseason spotlight and forced the bracket to react.`,
      accent: 'from-[#5a450b] via-[#1f1f1f] to-[#0d2f43]',
      game,
    };
  }

  return {
    headline: 'THE RACE TIGHTENS',
    summary: `${winner?.city ?? 'The victor'} edged ${loser?.city ?? 'its rival'} and added another layer of drama to the standings chase.`,
    accent: 'from-[#45340c] via-[#1d1d1d] to-[#10362f]',
    game,
  };
};

export const buildGameStoryCandidates = (
  game: Game,
  teamsById: Map<string, Team>,
  battingStatsByPlayerId: Map<string, PlayerSeasonBatting>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): StoryCandidate[] => {
  const fallback = createGameHeadline(game, teamsById);
  const logs = parseStoredLogs(game);
  if (logs.length === 0) {
    return [{ ...fallback, priority: getHeadlinePriorityScore(game) }];
  }

  const battingByPlayer = new Map<string, DerivedBattingLine>();
  const pitchingByPlayer = new Map<string, DerivedPitchingLine>();
  let previousInning = logs[0]?.inning ?? 1;
  let previousHalf = logs[0]?.half ?? 'top';
  let previousOuts = 0;
  let awayLargestDeficit = 0;
  let homeLargestDeficit = 0;
  let previousAwayScore = 0;
  let previousHomeScore = 0;
  let previousLeader: 'away' | 'home' | 'tie' = 'tie';
  let leadChanges = 0;
  let tieCount = 0;
  let walkOffBatterName: string | null = null;

  const getBattingLine = (log: PlayLogEvent): DerivedBattingLine | null => {
    if (!log.batterId) {
      return null;
    }

    const existing = battingByPlayer.get(log.batterId);
    if (existing) {
      return existing;
    }

    const next: DerivedBattingLine = {
      playerId: log.batterId,
      playerName: log.batterName ?? 'Unknown Batter',
      teamId: log.battingTeamId,
      plateAppearances: 0,
      atBats: 0,
      hits: 0,
      singles: 0,
      doubles: 0,
      triples: 0,
      homeRuns: 0,
      walks: 0,
      strikeouts: 0,
      rbi: 0,
      runsScored: 0,
    };
    battingByPlayer.set(log.batterId, next);
    return next;
  };

  const getPitchingLine = (log: PlayLogEvent): DerivedPitchingLine | null => {
    if (!log.pitcherId) {
      return null;
    }

    const existing = pitchingByPlayer.get(log.pitcherId);
    if (existing) {
      return existing;
    }

    const next: DerivedPitchingLine = {
      playerId: log.pitcherId,
      playerName: log.pitcherName ?? 'Unknown Pitcher',
      teamId: log.battingTeamId === game.awayTeam ? game.homeTeam : game.awayTeam,
      outsRecorded: 0,
      hitsAllowed: 0,
      walks: 0,
      strikeouts: 0,
      runsAllowed: 0,
    };
    pitchingByPlayer.set(log.pitcherId, next);
    return next;
  };

  for (const log of logs) {
    if (log.outcome === 'HALF_END') {
      previousInning = log.inning;
      previousHalf = log.half;
      previousOuts = 0;
      continue;
    }

    if (log.outcome === 'GAME_END' || log.outcome === 'PITCHING_CHANGE') {
      continue;
    }

    awayLargestDeficit = Math.max(awayLargestDeficit, log.scoreHome - log.scoreAway);
    homeLargestDeficit = Math.max(homeLargestDeficit, log.scoreAway - log.scoreHome);

    const battingLine = getBattingLine(log);
    if (battingLine) {
      battingLine.plateAppearances += 1;
      if (log.outcome !== 'BB') {
        battingLine.atBats += 1;
      }
      if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
        battingLine.hits += 1;
      }
      if (log.outcome === '1B') {
        battingLine.singles += 1;
      }
      if (log.outcome === '2B') {
        battingLine.doubles += 1;
      }
      if (log.outcome === '3B') {
        battingLine.triples += 1;
      }
      if (log.outcome === 'HR') {
        battingLine.homeRuns += 1;
      }
      if (log.outcome === 'BB') {
        battingLine.walks += 1;
      }
      if (log.outcome === 'SO') {
        battingLine.strikeouts += 1;
      }
      battingLine.rbi += log.rbi;
    }

    for (const scoringPlayerId of log.scoringPlayerIds) {
      const scoringLine = battingByPlayer.get(scoringPlayerId);
      if (scoringLine) {
        scoringLine.runsScored += 1;
      }
    }

    const pitchingLine = getPitchingLine(log);
    if (pitchingLine) {
      const outsRecorded =
        log.inning === previousInning && log.half === previousHalf
          ? Math.max(0, log.outs - previousOuts)
          : Math.max(0, log.outs);
      pitchingLine.outsRecorded += outsRecorded;
      if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
        pitchingLine.hitsAllowed += 1;
      }
      if (log.outcome === 'BB') {
        pitchingLine.walks += 1;
      }
      if (log.outcome === 'SO') {
        pitchingLine.strikeouts += 1;
      }
      pitchingLine.runsAllowed += log.runsScored;
    }

    if (log.scoreAway !== previousAwayScore || log.scoreHome !== previousHomeScore) {
      const nextLeader = getLeader(log.scoreAway, log.scoreHome);
      if (nextLeader === 'tie' && previousLeader !== 'tie') {
        tieCount += 1;
      } else if (nextLeader !== 'tie' && previousLeader !== 'tie' && nextLeader !== previousLeader) {
        leadChanges += 1;
      }

      if (
        game.score.home > game.score.away &&
        log.half === 'bottom' &&
        log.inning >= 9 &&
        previousHomeScore <= previousAwayScore &&
        log.scoreHome > log.scoreAway
      ) {
        walkOffBatterName = log.batterName ?? walkOffBatterName;
      }

      previousLeader = nextLeader;
      previousAwayScore = log.scoreAway;
      previousHomeScore = log.scoreHome;
    }

    previousInning = log.inning;
    previousHalf = log.half;
    previousOuts = log.outs;
  }

  const battingLines = Array.from(battingByPlayer.values());
  const pitchingLines = Array.from(pitchingByPlayer.values());
  const stories: StoryCandidate[] = [];
  const awayTeam = teamsById.get(game.awayTeam);
  const homeTeam = teamsById.get(game.homeTeam);
  const awayWon = game.score.away > game.score.home;
  const winnerTeam = awayWon ? awayTeam : homeTeam;
  const loserTeam = awayWon ? homeTeam : awayTeam;
  const winnerTeamId = awayWon ? game.awayTeam : game.homeTeam;
  const loserTeamId = awayWon ? game.homeTeam : game.awayTeam;
  const awayWinPct = awayTeam ? getWinPct(awayTeam) : 0;
  const homeWinPct = homeTeam ? getWinPct(homeTeam) : 0;
  const sameDivision = Boolean(
    awayTeam &&
      homeTeam &&
      awayTeam.league === homeTeam.league &&
      awayTeam.division === homeTeam.division,
  );
  const sameLeague = Boolean(awayTeam && homeTeam && awayTeam.league === homeTeam.league);
  const ratingGap = awayTeam && homeTeam ? Math.abs(awayTeam.rating - homeTeam.rating) : 0;
  const winPctGap = Math.abs(awayWinPct - homeWinPct);
  const losingErrors = awayWon
    ? (typeof game.stats.homeErrors === 'number' ? game.stats.homeErrors : 0)
    : (typeof game.stats.awayErrors === 'number' ? game.stats.awayErrors : 0);
  const winnerPitcherCount = pitchingLines.filter((line) => line.teamId === winnerTeamId).length;
  const loserPitcherCount = pitchingLines.filter((line) => line.teamId === loserTeamId).length;
  const extraInnings = Math.max(...logs.map((log) => log.inning), 9);
  const winnerWasUnderdog =
    Boolean(awayTeam && homeTeam) &&
    ((awayWon && (awayTeam!.rating + 8 <= homeTeam!.rating || awayWinPct + 0.15 <= homeWinPct)) ||
      (!awayWon && (homeTeam!.rating + 8 <= awayTeam!.rating || homeWinPct + 0.15 <= awayWinPct)));
  const noHitOpponentId =
    typeof game.stats.awayHits === 'number' && game.stats.awayHits === 0
      ? game.awayTeam
      : typeof game.stats.homeHits === 'number' && game.stats.homeHits === 0
        ? game.homeTeam
        : null;

  if (noHitOpponentId) {
    const pitchingTeamId = noHitOpponentId === game.awayTeam ? game.homeTeam : game.awayTeam;
    const pitchingTeam = teamsById.get(pitchingTeamId);
    const opponentTeam = teamsById.get(noHitOpponentId);
    const leadPitcher = getTopEntry(
      pitchingLines.filter((line) => line.teamId === pitchingTeamId),
      (left, right) => right.outsRecorded - left.outsRecorded || right.strikeouts - left.strikeouts,
    );

    stories.push(
      createStory(
        180,
        'NO-HIT IMMORTALITY',
        `${leadPitcher?.playerName ?? pitchingTeam?.city ?? 'The staff'} erased ${opponentTeam?.city ?? 'the lineup'} from the hit column and authored the day's loudest statement.`,
        'from-[#61470a] via-[#191919] to-[#0f3a39]',
        game,
      ),
    );
  }

  if (walkOffBatterName) {
    stories.push(
      createStory(
        176,
        'WALK-OFF BEDLAM',
        `${walkOffBatterName} delivered the final eruption for ${winnerTeam?.city ?? 'the home club'}, ending the night in one swing of pure chaos.`,
        'from-[#6b4c08] via-[#1a1a1a] to-[#183b2a]',
        game,
      ),
    );
  }

  if (extraInnings >= 10 && Math.abs(game.score.away - game.score.home) <= 2) {
    stories.push(
      createStory(
        162,
        'MIDNIGHT BASEBALL',
        `${winnerTeam?.city ?? 'The winner'} survived ${extraInnings} innings of tension and finally broke ${loserTeam?.city ?? 'the opposition'} in a game that refused to end.`,
        'from-[#58450b] via-[#1a1a1a] to-[#102f40]',
        game,
      ),
    );
  }

  if (leadChanges >= 2 || tieCount >= 2) {
    stories.push(
      createStory(
        149,
        'MOMENTUM WHIPLASH',
        `${winnerTeam?.city ?? 'The winner'} navigated a game full of swings, counters, and collapsing leverage before grabbing the final answer.`,
        'from-[#5a3508] via-[#1c1c1c] to-[#15352f]',
        game,
      ),
    );
  }

  const topSlugger = getTopEntry(
    battingLines,
    (left, right) =>
      right.homeRuns - left.homeRuns ||
      right.rbi - left.rbi ||
      right.hits - left.hits ||
      left.playerName.localeCompare(right.playerName),
  );
  if (topSlugger?.homeRuns >= 3) {
    const sluggerTeam = teamsById.get(topSlugger.teamId);
    stories.push(
      createStory(
        165,
        'THREE-HOMER INFERNO',
        `${topSlugger.playerName} launched ${topSlugger.homeRuns} balls out of the yard and carried ${sluggerTeam?.city ?? 'his club'} through a volcanic offensive night.`,
        'from-[#5f2f09] via-[#1a1a1a] to-[#3b190c]',
        game,
      ),
    );
  }

  if (
    topSlugger &&
    topSlugger.singles >= 1 &&
    topSlugger.doubles >= 1 &&
    topSlugger.triples >= 1 &&
    topSlugger.homeRuns >= 1
  ) {
    const cycleTeam = teamsById.get(topSlugger.teamId);
    stories.push(
      createStory(
        171,
        'A CYCLE FOR THE WIRE',
        `${topSlugger.playerName} hit for the cycle and gave ${cycleTeam?.city ?? 'his club'} one of the rarest box scores of the season.`,
        'from-[#6a560d] via-[#1c1c1c] to-[#0f372d]',
        game,
      ),
    );
  }

  const topRunProducer = getTopEntry(
    battingLines,
    (left, right) => right.rbi - left.rbi || right.hits - left.hits || left.playerName.localeCompare(right.playerName),
  );
  if (topRunProducer?.rbi >= 6) {
    const producerTeam = teamsById.get(topRunProducer.teamId);
    stories.push(
      createStory(
        150,
        'RBI BARRAGE',
        `${topRunProducer.playerName} drove in ${topRunProducer.rbi} runs for ${producerTeam?.city ?? 'his club'} and turned every traffic jam into damage.`,
        'from-[#5d3008] via-[#1a1a1a] to-[#0f372d]',
        game,
      ),
    );
  }

  const onBaseMachine = getTopEntry(
    battingLines.filter((line) => line.hits + line.walks >= 5 && line.strikeouts === 0),
    (left, right) =>
      (right.hits + right.walks) - (left.hits + left.walks) ||
      right.runsScored - left.runsScored ||
      left.playerName.localeCompare(right.playerName),
  );
  if (onBaseMachine) {
    const onBaseTeam = teamsById.get(onBaseMachine.teamId);
    stories.push(
      createStory(
        144,
        'THE TABLE NEVER CLEARED',
        `${onBaseMachine.playerName} reached base ${onBaseMachine.hits + onBaseMachine.walks} times without a punchout and kept ${onBaseTeam?.city ?? 'his club'} in constant motion.`,
        'from-[#4f3909] via-[#1b1b1b] to-[#12392f]',
        game,
      ),
    );
  }

  const topHitCollector = getTopEntry(
    battingLines,
    (left, right) => right.hits - left.hits || right.rbi - left.rbi || left.playerName.localeCompare(right.playerName),
  );
  if (topHitCollector?.hits >= 4) {
    const hitTeam = teamsById.get(topHitCollector.teamId);
    stories.push(
      createStory(
        140,
        'FOUR-HIT FURY',
        `${topHitCollector.playerName} stacked ${topHitCollector.hits} hits for ${hitTeam?.city ?? 'his club'} and never let the game breathe.`,
        'from-[#4f3509] via-[#1c1c1c] to-[#14352f]',
        game,
      ),
    );
  }

  const topScorer = getTopEntry(
    battingLines,
    (left, right) => right.runsScored - left.runsScored || right.hits - left.hits || left.playerName.localeCompare(right.playerName),
  );
  if (topScorer?.runsScored >= 3) {
    const scorerTeam = teamsById.get(topScorer.teamId);
    stories.push(
      createStory(
        139,
        'TRAFFIC TURNED TO DAMAGE',
        `${topScorer.playerName} crossed the plate ${topScorer.runsScored} times and kept ${scorerTeam?.city ?? 'his club'} pressing on every inning seam.`,
        'from-[#50340a] via-[#1c1c1c] to-[#14312d]',
        game,
      ),
    );
  }

  const topArm = getTopEntry(
    pitchingLines,
    (left, right) =>
      right.strikeouts - left.strikeouts ||
      right.outsRecorded - left.outsRecorded ||
      left.playerName.localeCompare(right.playerName),
  );
  if (topArm && topArm.strikeouts >= 12 && topArm.runsAllowed <= 2) {
    const armTeam = teamsById.get(topArm.teamId);
    stories.push(
      createStory(
        155,
        'BAT-MISSING CLINIC',
        `${topArm.playerName} carved through ${loserTeam?.city ?? 'the opposition'} with ${topArm.strikeouts} strikeouts across ${formatInningsPitched(topArm.outsRecorded)} innings.`,
        'from-[#69550d] via-[#1a1a1a] to-[#0d2f3f]',
        game,
      ),
    );
    if ((pitchingRatingsByPlayerId.get(topArm.playerId)?.overall ?? 0) >= 90) {
      stories.push(
        createStory(
          148,
          'THE ACE LOOKED UNTAMED',
          `${topArm.playerName} played to his rating for ${armTeam?.city ?? 'his club'} and made an elite outing feel routine.`,
          'from-[#5c460c] via-[#1b1b1b] to-[#163229]',
          game,
        ),
      );
    }
  }

  const ironStarter = getTopEntry(
    pitchingLines.filter((line) => line.outsRecorded >= 24 && line.walks === 0 && line.runsAllowed <= 1),
    (left, right) => right.outsRecorded - left.outsRecorded || right.strikeouts - left.strikeouts,
  );
  if (ironStarter) {
    const ironTeam = teamsById.get(ironStarter.teamId);
    stories.push(
      createStory(
        154,
        'COMPLETE COMMAND',
        `${ironStarter.playerName} gave ${ironTeam?.city ?? 'his club'} a power start with ${formatInningsPitched(ironStarter.outsRecorded)} innings of near-flawless control.`,
        'from-[#66520e] via-[#191919] to-[#0e3042]',
        game,
      ),
    );
  }

  if ((game.score.away > game.score.home && awayLargestDeficit >= 4) || (game.score.home > game.score.away && homeLargestDeficit >= 4)) {
    stories.push(
      createStory(
        145,
        'COMEBACK THUNDER',
        `${winnerTeam?.city ?? 'The winner'} clawed back from a deep hole and flipped the script on ${loserTeam?.city ?? 'its rival'} before the final out.`,
        'from-[#563a08] via-[#1c1c1c] to-[#0f3a31]',
        game,
      ),
    );
  }

  if (winnerPitcherCount >= 4 && (awayWon ? game.score.home : game.score.away) <= 1) {
    stories.push(
      createStory(
        143,
        'BULLPEN BARRICADE',
        `${winnerTeam?.city ?? 'The winner'} chained together ${winnerPitcherCount} arms and left ${loserTeam?.city ?? 'the opposition'} with almost no daylight.`,
        'from-[#5b470d] via-[#1a1a1a] to-[#10313f]',
        game,
      ),
    );
  }

  const coldStar = getTopEntry(
    battingLines.filter((line) => {
      const rating = battingRatingsByPlayerId.get(line.playerId);
      const stat = battingStatsByPlayerId.get(line.playerId);
      return Boolean(
        rating &&
          rating.overall >= 88 &&
          line.atBats >= 4 &&
          line.hits === 0 &&
          line.strikeouts >= 2 &&
          ((stat?.avg ?? 0) >= 0.29 || (stat?.ops ?? 0) >= 0.85),
      );
    }),
    (left, right) =>
      (battingRatingsByPlayerId.get(right.playerId)?.overall ?? 0) - (battingRatingsByPlayerId.get(left.playerId)?.overall ?? 0) ||
      right.strikeouts - left.strikeouts,
  );

  if (coldStar) {
    const coldTeam = teamsById.get(coldStar.teamId);
    const rating = battingRatingsByPlayerId.get(coldStar.playerId);
    stories.push(
      createStory(
        142,
        'STAR GOES COLD',
        `${coldStar.playerName} came in swinging like an ${rating?.overall ?? 0}-OVR force, then went 0-for-${coldStar.atBats} with ${coldStar.strikeouts} strikeouts for ${coldTeam?.city ?? 'his club'}.`,
        'from-[#4b2c10] via-[#1b1b1b] to-[#252525]',
        game,
      ),
    );
  }

  const crackedAce = getTopEntry(
    pitchingLines.filter(
      (line) => (pitchingRatingsByPlayerId.get(line.playerId)?.overall ?? 0) >= 90 && line.runsAllowed >= 5 && line.outsRecorded <= 15,
    ),
    (left, right) =>
      right.runsAllowed - left.runsAllowed ||
      (pitchingRatingsByPlayerId.get(right.playerId)?.overall ?? 0) - (pitchingRatingsByPlayerId.get(left.playerId)?.overall ?? 0),
  );

  if (crackedAce) {
    const aceTeam = teamsById.get(crackedAce.teamId);
    stories.push(
      createStory(
        138,
        'THE ACE CRACKED',
        `${crackedAce.playerName} never settled for ${aceTeam?.city ?? 'his club'}, allowing ${crackedAce.runsAllowed} runs before the game could breathe.`,
        'from-[#492a0d] via-[#1c1c1c] to-[#311516]',
        game,
      ),
    );
  }

  if (sameDivision && Math.abs(game.score.away - game.score.home) <= 1) {
    stories.push(
      createStory(
        151,
        'DIVISION KNIFE FIGHT',
        `${winnerTeam?.city ?? 'The winner'} took a razor-close result from ${loserTeam?.city ?? 'its rival'} in a game that could echo through the division race.`,
        'from-[#5c3b09] via-[#1b1b1b] to-[#17352d]',
        game,
      ),
    );
  }

  if (sameLeague && awayWinPct >= 0.6 && homeWinPct >= 0.6) {
    stories.push(
      createStory(
        153,
        'CONTENDERS COLLIDE',
        `${winnerTeam?.city ?? 'The winner'} won a direct test between two clubs already playing at a contender's pace.`,
        'from-[#67530d] via-[#1b1b1b] to-[#12333a]',
        game,
      ),
    );
  }

  if (!sameLeague && Math.abs(game.score.away - game.score.home) <= 3) {
    stories.push(
      createStory(
        141,
        'BRAGGING RIGHTS SECURED',
        `${winnerTeam?.city ?? 'The winner'} grabbed the interleague edge and left the other side carrying the noise into the next slate.`,
        'from-[#584109] via-[#1a1a1a] to-[#12342f]',
        game,
      ),
    );
  }

  if (winnerWasUnderdog && (ratingGap >= 8 || winPctGap >= 0.15)) {
    stories.push(
      createStory(
        157,
        'STANDINGS SHOCKWAVE',
        `${winnerTeam?.city ?? 'The underdog'} flipped the expected script and stunned ${loserTeam?.city ?? 'a favorite'} with one of the sharper upsets on the board.`,
        'from-[#60320a] via-[#1b1b1b] to-[#1e3026]',
        game,
      ),
    );
  }

  if ((game.score.away >= 8 && game.score.home >= 8) || game.score.away + game.score.home >= 15) {
    stories.push(
      createStory(
        146,
        'SCOREBOARD UNDER SIEGE',
        `${awayTeam?.city ?? 'The visitors'} and ${homeTeam?.city ?? 'the home club'} turned the game into a run-trading frenzy that never really cooled off.`,
        'from-[#5e3209] via-[#1c1c1c] to-[#3a170d]',
        game,
      ),
    );
  }

  if (losingErrors >= 3) {
    stories.push(
      createStory(
        142,
        'THE GLOVES CAVED IN',
        `${loserTeam?.city ?? 'The loser'} handed away too many extra chances, and ${winnerTeam?.city ?? 'the winner'} made every one of them hurt.`,
        'from-[#4a2b0f] via-[#1d1d1d] to-[#2f1818]',
        game,
      ),
    );
  }

  if (winnerPitcherCount >= 5 && loserPitcherCount >= 5 && extraInnings >= 10) {
    stories.push(
      createStory(
        145,
        'EVERY ARM WAS SUMMONED',
        `Both dugouts emptied the bullpen script, but ${winnerTeam?.city ?? 'the winner'} found the last clean frame in a war of attrition.`,
        'from-[#5b4b0d] via-[#1a1a1a] to-[#102f38]',
        game,
      ),
    );
  }

  stories.push({ ...fallback, priority: getHeadlinePriorityScore(game) + (isPlayoffGame(game) ? 12 : 0) });

  return stories;
};

export const buildTransactionStoryCandidates = (
  sourceTransactions: PlayerTransaction[],
  playersById: Map<string, Player>,
  teamsById: Map<string, Team>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): TransactionStoryCandidate[] =>
  sourceTransactions.map((transaction) => {
    const player = playersById.get(transaction.playerId);
    const fromTeam = transaction.fromTeamId ? teamsById.get(transaction.fromTeamId) ?? null : null;
    const team = transaction.toTeamId ? teamsById.get(transaction.toTeamId) ?? null : null;
    const overall = player
      ? battingRatingsByPlayerId.get(player.playerId)?.overall ?? pitchingRatingsByPlayerId.get(player.playerId)?.overall ?? 0
      : 0;
    const playerName = player ? `${player.firstName} ${player.lastName}` : 'Unknown Player';
    const teamCity = team?.city ?? 'A contender';
    const fromCity = fromTeam?.city ?? 'the market';
    const years = player?.contractYearsLeft ?? 0;
    const age = player?.age ?? 0;
    const sameDivisionDeal = Boolean(
      fromTeam &&
        team &&
        fromTeam.league === team.league &&
        fromTeam.division === team.division,
    );

    if (transaction.eventType === 'retired' && overall >= 84) {
      return createTransactionStory(
        230,
        `retired:${transaction.playerId}:${transaction.effectiveDate}`,
        'AN ERA JUST CLOSED',
        `${playerName} stepped away from the field, ending a run that still carried ${overall}-OVR weight across the league map.`,
        'from-[#6a560d] via-[#1d1d1d] to-[#252525]',
      );
    }

    if (transaction.eventType === 'released' && overall >= 80) {
      return createTransactionStory(
        176,
        `released:${transaction.playerId}:${transaction.effectiveDate}:${transaction.fromTeamId ?? 'na'}`,
        'THE MARKET JUST TORE OPEN',
        `${fromCity} cut loose ${playerName}, sending an ${overall}-OVR talent into the open market and shifting the next wave of bidding.`,
        'from-[#5c360b] via-[#1d1d1d] to-[#2c1a1a]',
      );
    }

    if (transaction.eventType === 'drafted') {
      return createTransactionStory(
        162,
        `drafted:${transaction.playerId}:${transaction.effectiveDate}:${transaction.toTeamId ?? 'na'}`,
        'THE NEXT WAVE ARRIVES',
        `${teamCity} added ${playerName} and signaled another long-view bet on what the next version of the roster can become.`,
        'from-[#5d460c] via-[#1b1b1b] to-[#14352f]',
      );
    }

    if (transaction.eventType === 'traded' && sameDivisionDeal) {
      return createTransactionStory(
        214,
        `trade:${transaction.playerId}:${transaction.effectiveDate}:${transaction.toTeamId ?? 'na'}`,
        'RIVALS JUST SWAPPED FIREPOWER',
        `${teamCity} pulled ${playerName} out of a division rival's orbit, a move that could haunt the race for months.`,
        'from-[#6b490b] via-[#1a1a1a] to-[#15362f]',
      );
    }

    if (transaction.eventType === 'traded' && overall >= 86) {
      return createTransactionStory(
        235,
        `trade:${transaction.playerId}:${transaction.effectiveDate}:${transaction.toTeamId ?? 'na'}`,
        'SHAKEUP IN THE LEAGUE',
        `${teamCity} acquired superstar ${playerName}${overall > 0 ? `, an ${overall}-OVR force,` : ''} in a blockbuster trade that could bend the pennant race.`,
        'from-[#6b500c] via-[#1a1a1a] to-[#10383a]',
      );
    }

    if (transaction.eventType === 'traded' && age <= 25 && overall >= 80) {
      return createTransactionStory(
        205,
        `trade:${transaction.playerId}:${transaction.effectiveDate}:${transaction.toTeamId ?? 'na'}`,
        'THE FUTURE JUST MOVED',
        `${teamCity} bet on upside by pulling in ${playerName}, a young ${overall}-OVR piece who could reshape the club's next era.`,
        'from-[#61510d] via-[#1b1b1b] to-[#103a33]',
      );
    }

    if (transaction.eventType === 'signed' && overall >= 88) {
      return createTransactionStory(
        220,
        `signing:${transaction.playerId}:${transaction.effectiveDate}`,
        'THE MARKET JUST SHOOK',
        `${teamCity} landed ${playerName}, an ${overall}-OVR prize, on a ${years}-year swing that instantly changes the league map.`,
        'from-[#6a560d] via-[#1b1b1b] to-[#0d3b34]',
      );
    }

    if (transaction.eventType === 'signed' && age <= 27 && years >= 5 && overall >= 82) {
      return createTransactionStory(
        202,
        `signing:${transaction.playerId}:${transaction.effectiveDate}`,
        'A CORE PIECE JUST LANDED',
        `${teamCity} didn't just add ${playerName}; it planted a long-term flag with a ${years}-year deal around a still-rising ${overall}-OVR talent.`,
        'from-[#68540d] via-[#1b1b1b] to-[#10352f]',
      );
    }

    if (transaction.eventType === 'signed' && age >= 32 && years <= 2 && overall >= 78) {
      return createTransactionStory(
        178,
        `signing:${transaction.playerId}:${transaction.effectiveDate}`,
        'VETERAN URGENCY ON DISPLAY',
        `${teamCity} brought in ${playerName} on a short ${years}-year bet, a classic win-now move meant to stabilize the next push.`,
        'from-[#5b430a] via-[#1b1b1b] to-[#17312e]',
      );
    }

    if (transaction.eventType === 'signed' && overall >= 80) {
      return createTransactionStory(
        185,
        `signing:${transaction.playerId}:${transaction.effectiveDate}`,
        'A FRANCHISE BET IN FREE AGENCY',
        `${teamCity} moved aggressively for ${playerName}, locking in a ${years}-year commitment to patch a real roster need.`,
        'from-[#5c430a] via-[#1a1a1a] to-[#153531]',
      );
    }

    return createTransactionStory(
      150,
      `${transaction.eventType}:${transaction.playerId}:${transaction.effectiveDate}`,
      transaction.eventType === 'signed' ? 'FREE AGENCY BOARD MOVES' : 'ROSTER RUMBLINGS',
      transaction.eventType === 'signed'
        ? `${teamCity} brought in ${playerName} on a ${years}-year deal, signaling a fresh roster direction before the next slate.`
        : `${playerName} triggered another roster ripple, giving the league one more thread to track before the next slate.`,
      transaction.eventType === 'signed' ? 'from-[#4e3908] via-[#1c1c1c] to-[#12312d]' : 'from-[#47320a] via-[#1d1d1d] to-[#213026]',
    );
  });

export const generateHeadlineDeck = (
  gameIndexes: GameIndexes,
  teamsById: Map<string, Team>,
  timelineDate: string,
  transactionStories: TransactionStoryCandidate[],
  getGameStoryCandidates: (game: Game) => StoryCandidate[],
  fallbackTransactionDate: string | null,
): HeadlineDeck => {
  const recentCompleted = gameIndexes.completedGamesDesc;

  if (recentCompleted.length === 0 && transactionStories.length === 0) {
    return {
      primary: {
        headline: 'THE PENNANT RACE BEGINS',
        summary: 'The GPB calendar is live. Storylines, rivalries, and title pressure will build as the season unfolds.',
        accent: 'from-[#3d2f09] via-[#1f1f1f] to-[#0d3a33]',
        game: null,
      },
      secondary: [],
      sourceDate: null,
    };
  }

  if (recentCompleted.length === 0 && transactionStories.length > 0) {
    return {
      primary: transactionStories[0],
      secondary: transactionStories.slice(1, 4),
      sourceDate: fallbackTransactionDate,
    };
  }

  const targetDate = timelineDate ? addDays(timelineDate, -1) : recentCompleted[0].date;
  let sourceDate = targetDate;
  let sourceGames = gameIndexes.completedGamesByDate.get(sourceDate) ?? [];

  if (sourceGames.length === 0) {
    sourceDate = recentCompleted[0].date;
    sourceGames = gameIndexes.completedGamesByDate.get(sourceDate) ?? [];
  }

  const rankedStories = sourceGames
    .flatMap((game) => getGameStoryCandidates(game))
    .sort((left, right) => right.priority - left.priority || compareGameOrder(right.game ?? recentCompleted[0], left.game ?? recentCompleted[0]));

  const uniqueStories: StoryCandidate[] = [];
  const seen = new Set<string>();
  for (const story of transactionStories) {
    if (seen.has(story.key)) {
      continue;
    }
    seen.add(story.key);
    uniqueStories.push(story);
  }
  for (const story of rankedStories) {
    const key = `${story.game?.gameId ?? 'none'}:${story.headline}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueStories.push(story);
  }

  if (uniqueStories.length < 4) {
    for (const game of recentCompleted) {
      const key = `${game.gameId}:fallback`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueStories.push({ ...createGameHeadline(game, teamsById), priority: getHeadlinePriorityScore(game) });
      if (uniqueStories.length >= 4) {
        break;
      }
    }
  }

  return {
    primary: uniqueStories[0],
    secondary: uniqueStories.slice(1, 4),
    sourceDate,
  };
};

export const getFeaturedGame = (todaysGames: Game[], teamsById: Map<string, Team>): FeaturedGameCard | null => {
  const candidates = todaysGames
    .map((game) => {
      const awayTeam = teamsById.get(game.awayTeam);
      const homeTeam = teamsById.get(game.homeTeam);
      if (!awayTeam || !homeTeam) {
        return null;
      }

      const awayPct = getWinPct(awayTeam);
      const homePct = getWinPct(homeTeam);
      const sameDivision = awayTeam.league === homeTeam.league && awayTeam.division === homeTeam.division;
      const sameLeague = awayTeam.league === homeTeam.league;
      const ratingGap = Math.abs(awayTeam.rating - homeTeam.rating);

      let score = (awayPct + homePct) * 100;
      score += sameDivision ? 35 : 0;
      score += sameLeague ? 10 : 0;
      score += awayPct >= 0.58 && homePct >= 0.58 ? 20 : 0;
      score += ratingGap <= 3 ? 8 : 0;
      score += isPlayoffGame(game) ? 45 : 0;

      let angle = 'Spotlight Game';
      let lore = `${awayTeam.city} and ${homeTeam.city} square off in a meaningful test.`;

      if (isPlayoffGame(game)) {
        angle = 'Postseason Pressure';
        lore = `${game.playoff?.seriesLabel ?? 'Playoff baseball'} intensifies as every inning starts to shape the bracket.`;
      } else if (sameDivision) {
        angle = 'Division Rivalry';
        lore = `A crucial ${awayTeam.league} ${awayTeam.division} clash with massive playoff implications.`;
      } else if (awayPct >= 0.58 && homePct >= 0.58) {
        angle = 'Title Contenders';
        lore = 'Two contenders collide in a measuring-stick matchup that could echo into October.';
      } else if (sameLeague) {
        angle = `${awayTeam.league} Spotlight`;
        lore = `League positioning is on the line as ${awayTeam.city} and ${homeTeam.city} fight for ground.`;
      }

      return { game, score, angle, lore };
    })
    .filter((entry): entry is { game: Game; score: number; angle: string; lore: string } => Boolean(entry))
    .sort((left, right) => right.score - left.score || compareGameOrder(left.game, right.game));

  if (candidates.length === 0) {
    return null;
  }

  return {
    game: candidates[0].game,
    angle: candidates[0].angle,
    lore: candidates[0].lore,
  };
};
