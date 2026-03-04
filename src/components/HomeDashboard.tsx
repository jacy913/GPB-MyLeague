import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  ChevronRight,
  Newspaper,
  RefreshCcw,
  ScrollText,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
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
import { isPlayoffGame, isRegularSeasonGame } from '../logic/playoffs';
import { TeamLogo } from './TeamLogo';

interface TradeProposal {
  fromTeamId: string;
  toTeamId: string;
  fromPlayerId: string;
  toPlayerId: string;
}

interface HomeDashboardProps {
  teams: Team[];
  games: Game[];
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  transactions: PlayerTransaction[];
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  isSimulating: boolean;
  onSelectDate: (date: string) => void;
  onSelectTeamId: (teamId: string) => void;
  onOpenGame: (gameId: string) => void;
  onOpenTeams: () => void;
  onOpenSimulation: (targetDate?: string) => void;
  onOpenFreeAgency: () => void;
  onOpenStandings: () => void;
  onSimulateToSelectedDate: () => void;
  onSimulateToEndOfRegularSeason: () => void;
  onSimulateDay: () => void;
  onSimulateWeek: () => void;
  onSimulateMonth: () => void;
  onSimulateNextGame: () => void;
  onQuickSimSeason: () => void;
  onResetSeason: () => void;
  onSimulateToDate: (date: string) => void;
  onProposeTrade: (trade: TradeProposal) => void;
}

type MilestoneKey =
  | 'opening_day'
  | 'all_star_break'
  | 'trade_deadline'
  | 'regular_season_finale'
  | 'playoffs_begin'
  | 'draft'
  | 'free_agency';

type Milestone = {
  key: MilestoneKey;
  label: string;
  date: string;
  phase: 'regular' | 'playoffs' | 'offseason';
};

type HeadlineCard = {
  headline: string;
  summary: string;
  accent: string;
  game: Game | null;
};

type HeadlineDeck = {
  primary: HeadlineCard;
  secondary: HeadlineCard[];
  sourceDate: string | null;
};

type StoryCandidate = HeadlineCard & {
  priority: number;
};

type TransactionStoryCandidate = HeadlineCard & {
  priority: number;
  key: string;
};

type DerivedBattingLine = {
  playerId: string;
  playerName: string;
  teamId: string;
  plateAppearances: number;
  atBats: number;
  hits: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  rbi: number;
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

type FeaturedGameCard = {
  game: Game;
  lore: string;
  angle: string;
};

const compareGameOrder = (left: Game, right: Game): number =>
  left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date);

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const formatHeadlineDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

const formatMiniDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

const formatRecord = (team: Team): string => `${team.wins}-${team.losses}`;

const formatTickerTransaction = (
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

const formatTickerGame = (game: Game, teamsById: Map<string, Team>): string => {
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

const buildGameStoryCandidates = (
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
      homeRuns: 0,
      walks: 0,
      strikeouts: 0,
      rbi: 0,
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

    previousInning = log.inning;
    previousHalf = log.half;
    previousOuts = log.outs;
  }

  const stories: StoryCandidate[] = [];
  const awayTeam = teamsById.get(game.awayTeam);
  const homeTeam = teamsById.get(game.homeTeam);
  const winnerTeam = game.score.away > game.score.home ? awayTeam : homeTeam;
  const loserTeam = game.score.away > game.score.home ? homeTeam : awayTeam;
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
    const leadPitcher = [...pitchingByPlayer.values()]
      .filter((line) => line.teamId === pitchingTeamId)
      .sort((left, right) => right.outsRecorded - left.outsRecorded || right.strikeouts - left.strikeouts)[0];

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

  const topSlugger = [...battingByPlayer.values()].sort(
    (left, right) =>
      right.homeRuns - left.homeRuns ||
      right.rbi - left.rbi ||
      right.hits - left.hits ||
      left.playerName.localeCompare(right.playerName),
  )[0];
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

  const topRunProducer = [...battingByPlayer.values()].sort(
    (left, right) => right.rbi - left.rbi || right.hits - left.hits || left.playerName.localeCompare(right.playerName),
  )[0];
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

  const topHitCollector = [...battingByPlayer.values()].sort(
    (left, right) => right.hits - left.hits || right.rbi - left.rbi || left.playerName.localeCompare(right.playerName),
  )[0];
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

  const topArm = [...pitchingByPlayer.values()].sort(
    (left, right) =>
      right.strikeouts - left.strikeouts ||
      right.outsRecorded - left.outsRecorded ||
      left.playerName.localeCompare(right.playerName),
  )[0];
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

  const coldStar = [...battingByPlayer.values()]
    .filter((line) => {
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
    })
    .sort(
      (left, right) =>
        (battingRatingsByPlayerId.get(right.playerId)?.overall ?? 0) - (battingRatingsByPlayerId.get(left.playerId)?.overall ?? 0) ||
        right.strikeouts - left.strikeouts,
    )[0];

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

  const crackedAce = [...pitchingByPlayer.values()]
    .filter((line) => (pitchingRatingsByPlayerId.get(line.playerId)?.overall ?? 0) >= 90 && line.runsAllowed >= 5 && line.outsRecorded <= 15)
    .sort(
      (left, right) =>
        right.runsAllowed - left.runsAllowed ||
        (pitchingRatingsByPlayerId.get(right.playerId)?.overall ?? 0) - (pitchingRatingsByPlayerId.get(left.playerId)?.overall ?? 0),
    )[0];

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

  stories.push({ ...fallback, priority: getHeadlinePriorityScore(game) + (isPlayoffGame(game) ? 12 : 0) });

  return stories;
};

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

const buildTransactionStoryCandidates = (
  transactions: PlayerTransaction[],
  playersById: Map<string, Player>,
  teamsById: Map<string, Team>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
  timelineDate: string,
): TransactionStoryCandidate[] => {
  const targetDate = timelineDate || transactions[0]?.effectiveDate || '';
  const sourceTransactions = [...transactions]
    .filter((transaction) => (transaction.eventType === 'signed' || transaction.eventType === 'traded') && (!targetDate || transaction.effectiveDate === targetDate))
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate));

  return sourceTransactions.map((transaction) => {
    const player = playersById.get(transaction.playerId);
    const team = transaction.toTeamId ? teamsById.get(transaction.toTeamId) ?? null : null;
    const overall = player
      ? battingRatingsByPlayerId.get(player.playerId)?.overall ?? pitchingRatingsByPlayerId.get(player.playerId)?.overall ?? 0
      : 0;
    const playerName = player ? `${player.firstName} ${player.lastName}` : 'Unknown Player';
    const teamCity = team?.city ?? 'A contender';
    const years = player?.contractYearsLeft ?? 0;

    if (transaction.eventType === 'traded' && overall >= 86) {
      return createTransactionStory(
        235,
        `trade:${transaction.playerId}:${transaction.effectiveDate}:${transaction.toTeamId ?? 'na'}`,
        'SHAKEUP IN THE LEAGUE',
        `${teamCity} acquired superstar ${playerName}${overall > 0 ? `, an ${overall}-OVR force,` : ''} in a blockbuster trade that could bend the pennant race.`,
        'from-[#6b500c] via-[#1a1a1a] to-[#10383a]',
      );
    }

    if (overall >= 88) {
      return createTransactionStory(
        220,
        `signing:${transaction.playerId}:${transaction.effectiveDate}`,
        'THE MARKET JUST SHOOK',
        `${teamCity} landed ${playerName}, an ${overall}-OVR prize, on a ${years}-year swing that instantly changes the league map.`,
        'from-[#6a560d] via-[#1b1b1b] to-[#0d3b34]',
      );
    }

    if (overall >= 80) {
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
      `signing:${transaction.playerId}:${transaction.effectiveDate}`,
      'FREE AGENCY BOARD MOVES',
      `${teamCity} brought in ${playerName} on a ${years}-year deal, signaling a fresh roster direction before the next slate.`,
      'from-[#4e3908] via-[#1c1c1c] to-[#12312d]',
    );
  });
};

const generateHeadlineDeck = (
  games: Game[],
  teamsById: Map<string, Team>,
  timelineDate: string,
  transactions: PlayerTransaction[],
  playersById: Map<string, Player>,
  battingStatsByPlayerId: Map<string, PlayerSeasonBatting>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): HeadlineDeck => {
  const recentCompleted = [...games]
    .filter((game) => game.status === 'completed')
    .sort((left, right) => compareGameOrder(right, left));

  const transactionStories = buildTransactionStoryCandidates(
    transactions,
    playersById,
    teamsById,
    battingRatingsByPlayerId,
    pitchingRatingsByPlayerId,
    timelineDate,
  );

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
      sourceDate: timelineDate || transactions[0]?.effectiveDate || null,
    };
  }

  const targetDate = timelineDate ? addDays(timelineDate, -1) : recentCompleted[0].date;
  let sourceDate = targetDate;
  let sourceGames = recentCompleted.filter((game) => game.date === sourceDate);

  if (sourceGames.length === 0) {
    sourceDate = recentCompleted[0].date;
    sourceGames = recentCompleted.filter((game) => game.date === sourceDate);
  }

  const rankedStories = sourceGames
    .flatMap((game) =>
      buildGameStoryCandidates(game, teamsById, battingStatsByPlayerId, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
    )
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

const getFeaturedGame = (todaysGames: Game[], teamsById: Map<string, Team>): FeaturedGameCard | null => {
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

const getMilestones = (games: Game[]): Milestone[] => {
  const orderedDates = Array.from(new Set(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));
  const regularSeasonDates = Array.from(new Set(games.filter(isRegularSeasonGame).map((game) => game.date))).sort((left, right) => left.localeCompare(right));
  const playoffDates = Array.from(new Set(games.filter(isPlayoffGame).map((game) => game.date))).sort((left, right) => left.localeCompare(right));

  if (orderedDates.length === 0) {
    return [];
  }

  const openingDay = regularSeasonDates[0] ?? orderedDates[0];
  const allStarBreak = regularSeasonDates[Math.floor(regularSeasonDates.length * 0.5)] ?? openingDay;
  const tradeDeadline = regularSeasonDates[Math.floor(regularSeasonDates.length * 0.74)] ?? openingDay;
  const regularSeasonFinale = regularSeasonDates[regularSeasonDates.length - 1] ?? orderedDates[orderedDates.length - 1];
  const playoffsBegin = playoffDates[0] ?? addDays(regularSeasonFinale, 2);
  const finalScheduledDay = orderedDates[orderedDates.length - 1];

  return [
    { key: 'opening_day', label: 'Opening Day', date: openingDay, phase: 'regular' },
    { key: 'all_star_break', label: 'All-Star Break', date: allStarBreak, phase: 'regular' },
    { key: 'trade_deadline', label: 'Trade Deadline', date: tradeDeadline, phase: 'regular' },
    { key: 'regular_season_finale', label: 'Regular Season Finale', date: regularSeasonFinale, phase: 'regular' },
    { key: 'playoffs_begin', label: 'Playoffs Begin', date: playoffsBegin, phase: 'playoffs' },
    { key: 'draft', label: 'Draft', date: addDays(finalScheduledDay, 5), phase: 'offseason' },
    { key: 'free_agency', label: 'Free Agency Opens', date: addDays(finalScheduledDay, 10), phase: 'offseason' },
  ];
};

const sortStandings = (left: Team, right: Team): number => {
  const leftPct = getWinPct(left);
  const rightPct = getWinPct(right);
  if (leftPct !== rightPct) {
    return rightPct - leftPct;
  }

  const leftDiff = left.runsScored - left.runsAllowed;
  const rightDiff = right.runsScored - right.runsAllowed;
  if (leftDiff !== rightDiff) {
    return rightDiff - leftDiff;
  }

  return left.city.localeCompare(right.city);
};

const ActionTile: React.FC<{
  title: string;
  subtitle: string;
  value?: string;
  onClick: () => void;
}> = ({ title, subtitle, value, onClick }) => (
  <button
    onClick={onClick}
    className="rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] px-4 py-4 text-left transition-colors hover:border-white/20 hover:bg-white/[0.08]"
  >
    <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">{title}</p>
    <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
    {value && <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-platinum">{value}</p>}
  </button>
);

export const HomeDashboard: React.FC<HomeDashboardProps> = ({
  teams,
  games,
  players,
  battingStats,
  battingRatings,
  pitchingRatings,
  transactions,
  currentDate,
  selectedDate,
  selectedTeamId,
  isSimulating,
  onSelectDate,
  onSelectTeamId,
  onOpenGame,
  onOpenTeams,
  onOpenSimulation,
  onOpenFreeAgency,
  onOpenStandings,
  onSimulateToSelectedDate,
  onSimulateToEndOfRegularSeason,
  onSimulateDay,
  onSimulateWeek,
  onSimulateMonth,
  onSimulateNextGame,
  onQuickSimSeason,
  onResetSeason,
  onSimulateToDate,
  onProposeTrade,
}) => {
  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false);
  const [activeDivisionIndex, setActiveDivisionIndex] = useState(0);
  const [tradeFromTeamId, setTradeFromTeamId] = useState(selectedTeamId);
  const [tradeToTeamId, setTradeToTeamId] = useState(teams.find((team) => team.id !== selectedTeamId)?.id ?? teams[0]?.id ?? '');
  const [tradeFromPlayerId, setTradeFromPlayerId] = useState('');
  const [tradeToPlayerId, setTradeToPlayerId] = useState('');

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const battingStatsByPlayerId = useMemo(() => {
    const next = new Map<string, PlayerSeasonBatting>();
    battingStats.forEach((stat) => {
      const existing = next.get(stat.playerId);
      if (
        !existing ||
        stat.seasonYear > existing.seasonYear ||
        (stat.seasonYear === existing.seasonYear && stat.gamesPlayed > existing.gamesPlayed)
      ) {
        next.set(stat.playerId, stat);
      }
    });
    return next;
  }, [battingStats]);
  const battingRatingsByPlayerId = useMemo(() => new Map(battingRatings.map((rating) => [rating.playerId, rating])), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => new Map(pitchingRatings.map((rating) => [rating.playerId, rating])), [pitchingRatings]);
  const timelineDate = currentDate || selectedDate || games[0]?.date || '';
  const todaysGames = useMemo(
    () => games.filter((game) => game.date === timelineDate).sort(compareGameOrder),
    [games, timelineDate],
  );
  const headlineDeck = useMemo(
    () =>
      generateHeadlineDeck(
        games,
        teamsById,
        timelineDate,
        transactions,
        playersById,
        battingStatsByPlayerId,
        battingRatingsByPlayerId,
        pitchingRatingsByPlayerId,
      ),
    [games, teamsById, timelineDate, transactions, playersById, battingStatsByPlayerId, battingRatingsByPlayerId, pitchingRatingsByPlayerId],
  );
  const headline = headlineDeck.primary;
  const featuredGame = useMemo(() => getFeaturedGame(todaysGames, teamsById), [todaysGames, teamsById]);
  const milestones = useMemo(() => getMilestones(games), [games]);
  const nextMilestone = useMemo(
    () => milestones.find((milestone) => milestone.date > timelineDate && milestone.date <= (games[games.length - 1]?.date ?? milestone.date)) ?? null,
    [games, milestones, timelineDate],
  );
  const recentTickerItems = useMemo(() => {
    const recentGames = [...games]
      .filter((game) => game.status === 'completed')
      .sort((left, right) => compareGameOrder(right, left))
      .slice(0, 10)
      .map((game) => formatTickerGame(game, teamsById));
    const recentTransactions = [...transactions]
      .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))
      .slice(0, 6)
      .map((transaction) => formatTickerTransaction(transaction, playersById, teamsById));

    const items = [...recentGames, ...recentTransactions];
    return items.length > 0 ? items : ['LEAGUE OFFICE | Headlines, scores, and transactions will stream here as the season develops.'];
  }, [games, playersById, teamsById, transactions]);

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null;
  const divisionSnapshots = useMemo(() => {
    const grouped = new Map<string, { key: string; league: string; division: string; teams: Team[] }>();

    teams.forEach((team) => {
      const key = `${team.league}-${team.division}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.teams.push(team);
      } else {
        grouped.set(key, {
          key,
          league: team.league,
          division: team.division,
          teams: [team],
        });
      }
    });

    return Array.from(grouped.values())
      .map((snapshot) => ({
        ...snapshot,
        teams: snapshot.teams.sort(sortStandings).slice(0, 4),
      }))
      .sort((left, right) => left.league.localeCompare(right.league) || left.division.localeCompare(right.division));
  }, [teams]);
  const activeDivisionSnapshot = divisionSnapshots[activeDivisionIndex] ?? null;

  const freeAgents = useMemo(
    () => players.filter((player) => player.status === 'free_agent').sort((left, right) => right.age - left.age),
    [players],
  );

  const availableFromPlayers = useMemo(
    () =>
      players
        .filter((player) => player.teamId === tradeFromTeamId && player.status === 'active')
        .sort((left, right) => left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName)),
    [players, tradeFromTeamId],
  );

  const availableToPlayers = useMemo(
    () =>
      players
        .filter((player) => player.teamId === tradeToTeamId && player.status === 'active')
        .sort((left, right) => left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName)),
    [players, tradeToTeamId],
  );

  useEffect(() => {
    setTradeFromTeamId(selectedTeamId);
  }, [selectedTeamId]);

  useEffect(() => {
    if (tradeFromTeamId === tradeToTeamId) {
      setTradeToTeamId(teams.find((team) => team.id !== tradeFromTeamId)?.id ?? '');
    }
  }, [teams, tradeFromTeamId, tradeToTeamId]);

  useEffect(() => {
    if (!availableFromPlayers.some((player) => player.playerId === tradeFromPlayerId)) {
      setTradeFromPlayerId(availableFromPlayers[0]?.playerId ?? '');
    }
  }, [availableFromPlayers, tradeFromPlayerId]);

  useEffect(() => {
    if (!availableToPlayers.some((player) => player.playerId === tradeToPlayerId)) {
      setTradeToPlayerId(availableToPlayers[0]?.playerId ?? '');
    }
  }, [availableToPlayers, tradeToPlayerId]);

  useEffect(() => {
    if (divisionSnapshots.length === 0) {
      setActiveDivisionIndex(0);
      return;
    }

    if (!selectedTeam) {
      setActiveDivisionIndex(0);
      return;
    }

    const nextIndex = divisionSnapshots.findIndex(
      (snapshot) => snapshot.league === selectedTeam.league && snapshot.division === selectedTeam.division,
    );
    setActiveDivisionIndex(nextIndex >= 0 ? nextIndex : 0);
  }, [divisionSnapshots, selectedTeam]);

  useEffect(() => {
    if (divisionSnapshots.length <= 1) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setActiveDivisionIndex((current) => (current + 1) % divisionSnapshots.length);
    }, 7000);

    return () => window.clearInterval(intervalId);
  }, [divisionSnapshots.length]);

  const handleTradeSubmit = () => {
    if (!tradeFromTeamId || !tradeToTeamId || !tradeFromPlayerId || !tradeToPlayerId) {
      return;
    }

    onProposeTrade({
      fromTeamId: tradeFromTeamId,
      toTeamId: tradeToTeamId,
      fromPlayerId: tradeFromPlayerId,
      toPlayerId: tradeToPlayerId,
    });
    setIsTradeModalOpen(false);
  };

  const heroAwayTeam = headline.game ? teamsById.get(headline.game.awayTeam) ?? null : null;
  const heroHomeTeam = headline.game ? teamsById.get(headline.game.homeTeam) ?? null : null;
  const featuredAwayTeam = featuredGame ? teamsById.get(featuredGame.game.awayTeam) ?? null : null;
  const featuredHomeTeam = featuredGame ? teamsById.get(featuredGame.game.homeTeam) ?? null : null;

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-[#7b6a2f]/25 bg-[linear-gradient(90deg,rgba(18,18,18,0.96),rgba(35,35,35,0.94),rgba(16,16,16,0.96))]">
        <div className="broadcast-marquee px-4 py-3">
          <div className="broadcast-marquee__track">
            {recentTickerItems.concat(recentTickerItems).map((item, index) => (
              <span key={`${item}-${index}`} className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
        <article className={`relative overflow-hidden rounded-[2rem] border border-[#7b6a2f]/35 bg-gradient-to-br ${headline.accent} p-6 shadow-[0_24px_60px_rgba(0,0,0,0.32)]`}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.06),rgba(0,0,0,0.35))]" />
          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_220px]">
            <div>
              <div className="flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-[#d4bb6a]" />
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Headline Of The Day</p>
              </div>
              <h1 className="mt-5 max-w-[12ch] font-headline text-5xl uppercase leading-[0.92] tracking-[0.04em] text-white md:text-6xl xl:text-7xl">
                {headline.headline}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-200 md:text-lg">
                {headline.summary}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-300">
                  {headlineDeck.sourceDate ? formatHeadlineDate(headlineDeck.sourceDate) : formatHeadlineDate(timelineDate)}
                </span>
                <span className="rounded-full border border-[#d4bb6a]/25 bg-[#d4bb6a]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#ecd693]">
                  {headlineDeck.sourceDate ? 'Yesterday Slate' : 'GPB League Wire'}
                </span>
              </div>

              {headlineDeck.secondary.length > 0 && (
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {headlineDeck.secondary.map((card, index) => (
                    <button
                      key={`${card.headline}-${card.game?.gameId ?? index}`}
                      onClick={() => card.game && onOpenGame(card.game.gameId)}
                      className="rounded-[1.35rem] border border-white/10 bg-black/20 p-4 text-left transition-colors hover:border-white/20"
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#d8c88b]">
                        {card.game ? formatMiniDate(card.game.date) : 'League note'}
                      </p>
                      <p className="mt-3 font-headline text-xl uppercase tracking-[0.08em] text-white">{card.headline}</p>
                      <p className="mt-3 text-sm leading-6 text-zinc-300">{card.summary}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-center min-h-[130px]">
                  {heroAwayTeam ? <TeamLogo team={heroAwayTeam} sizeClass="h-20 w-20 md:h-24 md:w-24" /> : <div className="font-headline text-3xl text-zinc-500">GPB</div>}
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 flex items-center justify-center min-h-[130px]">
                  {heroHomeTeam ? <TeamLogo team={heroHomeTeam} sizeClass="h-20 w-20 md:h-24 md:w-24" /> : <div className="font-headline text-3xl text-zinc-500">NEWS</div>}
                </div>
              </div>
              {headline.game && (
                <button
                  onClick={() => onOpenGame(headline.game!.gameId)}
                  className="mt-4 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-4 text-left transition-colors hover:border-white/20"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {isPlayoffGame(headline.game) ? headline.game.playoff?.seriesLabel ?? 'Playoff spotlight' : 'Latest Result'}
                  </p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-white">
                    {headline.game.score.away}-{headline.game.score.home}
                  </p>
                </button>
              )}
            </div>
          </div>
        </article>

        <div className="grid gap-6">
          <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#1a1a1a,#202020,#141414)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Today&apos;s Featured Game</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">
                  {featuredGame ? featuredGame.angle : 'Featured Matchup'}
                </p>
              </div>
              <Sparkles className="h-5 w-5 text-[#d4bb6a]" />
            </div>

            {featuredGame && featuredAwayTeam && featuredHomeTeam ? (
              <button
                onClick={() => onOpenGame(featuredGame.game.gameId)}
                className="mt-5 w-full rounded-[1.75rem] border border-white/10 bg-black/20 p-5 text-left transition-colors hover:border-white/20"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full border border-[#d4bb6a]/20 bg-[#d4bb6a]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-[#e3cf88]">
                    {featuredGame.angle}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{formatMiniDate(featuredGame.game.date)}</span>
                </div>

                <div className="mt-5 grid grid-cols-[72px_minmax(0,1fr)_auto_minmax(0,1fr)_72px] items-center gap-3">
                  <TeamLogo team={featuredAwayTeam} sizeClass="h-16 w-16 md:h-20 md:w-20" />
                  <div className="min-w-0">
                    <p className="font-headline text-3xl uppercase tracking-[0.08em] text-white">{featuredAwayTeam.city}</p>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{formatRecord(featuredAwayTeam)}</p>
                  </div>
                  <p className="font-headline text-3xl uppercase tracking-[0.12em] text-[#d4bb6a]">VS</p>
                  <div className="min-w-0 text-right">
                    <p className="font-headline text-3xl uppercase tracking-[0.08em] text-white">{featuredHomeTeam.city}</p>
                    <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{formatRecord(featuredHomeTeam)}</p>
                  </div>
                  <div className="flex justify-end">
                    <TeamLogo team={featuredHomeTeam} sizeClass="h-16 w-16 md:h-20 md:w-20" />
                  </div>
                </div>

                <p className="mt-5 text-sm leading-6 text-zinc-300">{featuredGame.lore}</p>
              </button>
            ) : (
              <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
                <p className="font-headline text-3xl uppercase tracking-[0.08em] text-white">No Marquee Matchup</p>
                <p className="mt-3 text-sm leading-6 text-zinc-400">
                  Today&apos;s slate is light. Check back once the next wave of games is scheduled.
                </p>
              </div>
            )}
          </article>

          <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#161616,#202020,#111111)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Commissioner Console</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">Simulation Center</p>
              </div>
              <ShieldAlert className="h-5 w-5 text-prestige" />
            </div>

            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Simulation now runs from its own calendar-driven control room. Open the board, pick the window, and let the season move day by day until a trade or market event forces a commissioner stop.
            </p>

            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <label className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Queue Target Date</span>
                <input
                  type="date"
                  value={selectedDate || currentDate}
                  min={games[0]?.date}
                  max={games[games.length - 1]?.date}
                  onChange={(event) => onSelectDate(event.target.value)}
                  className="mt-2 block w-full bg-transparent font-mono text-sm text-white outline-none"
                />
              </label>
              <button onClick={() => onOpenSimulation(selectedDate || currentDate)} className="rounded-2xl border border-prestige/25 bg-prestige/10 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-prestige transition-colors hover:border-prestige/40">
                Open
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button onClick={() => onOpenSimulation()} className="rounded-2xl border border-[#d4bb6a]/20 bg-[#d4bb6a]/10 px-4 py-4 text-left font-headline text-xl uppercase tracking-[0.08em] text-[#f1dea2] transition-colors hover:border-[#d4bb6a]/35">
                Enter Simulation
              </button>
              <button onClick={onResetSeason} disabled={isSimulating} className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 font-headline text-xl uppercase tracking-[0.08em] text-white transition-colors hover:border-white/20 disabled:opacity-50">
                <RefreshCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </article>
        </div>
      </div>

      <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#232323,#141414)] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Season Cycle</p>
            <p className="mt-1 font-headline text-4xl uppercase tracking-[0.08em] text-white">Milestones Timeline</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-300">
              Current Date {timelineDate ? formatHeadlineDate(timelineDate) : 'TBD'}
            </span>
            <button
              onClick={() => nextMilestone && onOpenSimulation(nextMilestone.date)}
              disabled={isSimulating || !nextMilestone}
              className="rounded-full border border-[#d4bb6a]/25 bg-[#d4bb6a]/10 px-4 py-2 font-headline text-xl uppercase tracking-[0.08em] text-[#ecd693] transition-colors hover:border-[#d4bb6a]/40 disabled:opacity-40"
            >
              Open Next Event In Sim Center
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {milestones.map((milestone) => {
            const isCurrent = milestone.date === timelineDate;
            const isPast = milestone.date < timelineDate;
            return (
              <div
                key={milestone.key}
                className={`rounded-2xl border px-4 py-4 ${
                  isCurrent
                    ? 'border-prestige/50 bg-prestige/12'
                    : isPast
                      ? 'border-white/10 bg-black/20'
                      : milestone.phase === 'playoffs'
                        ? 'border-[#d4bb6a]/20 bg-[#d4bb6a]/8'
                        : 'border-white/10 bg-white/[0.03]'
                }`}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{milestone.phase}</p>
                <p className="mt-2 font-headline text-2xl uppercase tracking-[0.08em] text-white">{milestone.label}</p>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">{formatHeadlineDate(milestone.date)}</p>
                {isCurrent && <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-prestige">Current point in season</p>}
              </div>
            );
          })}
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#202020,#111111)] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Front Office</p>
              <p className="mt-1 font-headline text-4xl uppercase tracking-[0.08em] text-white">Action Center</p>
            </div>
            <Users className="h-5 w-5 text-zinc-400" />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ActionTile
              title="Propose Trade"
              subtitle="Open the league trade desk and swap active players between two clubs."
              value="Commissioner authority"
              onClick={() => setIsTradeModalOpen(true)}
            />
            <ActionTile
              title="Free Agency Pool"
              subtitle="Enter the market room and decide where unsigned talent lands."
              value={`${freeAgents.length} free agents`}
              onClick={onOpenFreeAgency}
            />
            <ActionTile
              title="Team Rosters"
              subtitle="Navigate directly to the 32-club roster database and depth charts."
              value="32 teams online"
              onClick={onOpenTeams}
            />
            <ActionTile
              title="League Standings"
              subtitle="Open the full standings board for division, league, and playoff races."
              value={selectedTeam ? `${selectedTeam.league} ${selectedTeam.division}` : 'League board'}
              onClick={onOpenStandings}
            />
          </div>
        </article>

        <div className="grid gap-6">
          <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#1a1a1a,#202020,#121212)] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Club Focus</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">Division Snapshot</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Auto rotation</p>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#d8c88b]">Every 7 seconds</p>
              </div>
            </div>

            <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                    {activeDivisionSnapshot ? `${activeDivisionSnapshot.league} ${activeDivisionSnapshot.division}` : 'No division loaded'}
                  </p>
                  <p className="mt-2 font-headline text-2xl uppercase tracking-[0.08em] text-white">
                    {activeDivisionSnapshot ? `${activeDivisionSnapshot.division} table` : 'Awaiting clubs'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {divisionSnapshots.map((snapshot, index) => (
                    <button
                      key={snapshot.key}
                      type="button"
                      onClick={() => setActiveDivisionIndex(index)}
                      className={`h-2.5 rounded-full transition-all ${
                        index === activeDivisionIndex ? 'w-8 bg-[#d4bb6a]' : 'w-2.5 bg-white/20 hover:bg-white/35'
                      }`}
                      aria-label={`Show ${snapshot.league} ${snapshot.division}`}
                    />
                  ))}
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {activeDivisionSnapshot?.teams.map((team, index) => (
                  <div key={team.id} className="grid grid-cols-[34px_52px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <span className="font-mono text-lg text-zinc-500">{index + 1}</span>
                    <TeamLogo team={team} sizeClass="h-12 w-12" />
                    <div className="min-w-0">
                      <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white truncate">{team.city}</p>
                      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{team.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm text-zinc-100">{formatRecord(team)}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{getWinPct(team).toFixed(3).replace(/^0/, '')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#202020,#121212)] p-5">
            <div className="flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-zinc-400" />
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">League Date</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">Daily Slate</p>
              </div>
            </div>

            <div className="mt-5 rounded-[1.75rem] border border-white/10 bg-black/20 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Current Day</p>
              <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{timelineDate ? formatHeadlineDate(timelineDate) : 'No active date'}</p>
              <p className="mt-2 text-sm text-zinc-400">
                {todaysGames.length > 0
                  ? `${todaysGames.length} game${todaysGames.length === 1 ? '' : 's'} on deck across the league.`
                  : 'No games are scheduled for the active date.'}
              </p>
              {featuredGame && (
                <button
                  onClick={() => onOpenGame(featuredGame.game.gameId)}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 font-headline text-xl uppercase tracking-[0.08em] text-white transition-colors hover:border-white/20"
                >
                  Open Featured Game
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </article>
        </div>
      </div>

      {isTradeModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#161616,#232323,#111111)] p-6 shadow-[0_28px_80px_rgba(0,0,0,0.5)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Commissioner Trade Desk</p>
                <p className="mt-1 font-headline text-4xl uppercase tracking-[0.08em] text-white">Propose Trade</p>
              </div>
              <button
                onClick={() => setIsTradeModalOpen(false)}
                className="rounded-full border border-white/10 bg-black/20 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] md:items-start">
              <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">Club A</p>
                <select
                  value={tradeFromTeamId}
                  onChange={(event) => setTradeFromTeamId(event.target.value)}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-3 font-mono text-sm text-white outline-none"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.city} {team.name}
                    </option>
                  ))}
                </select>
                <select
                  value={tradeFromPlayerId}
                  onChange={(event) => setTradeFromPlayerId(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-3 font-mono text-sm text-white outline-none"
                >
                  {availableFromPlayers.map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {player.firstName} {player.lastName} | {player.primaryPosition}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex h-full items-center justify-center">
                <div className="rounded-full border border-[#d4bb6a]/20 bg-[#d4bb6a]/10 p-4">
                  <ArrowRightLeft className="h-6 w-6 text-[#ecd693]" />
                </div>
              </div>

              <div className="rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white">Club B</p>
                <select
                  value={tradeToTeamId}
                  onChange={(event) => setTradeToTeamId(event.target.value)}
                  className="mt-4 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-3 font-mono text-sm text-white outline-none"
                >
                  {teams.filter((team) => team.id !== tradeFromTeamId).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.city} {team.name}
                    </option>
                  ))}
                </select>
                <select
                  value={tradeToPlayerId}
                  onChange={(event) => setTradeToPlayerId(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-[#121212] px-3 py-3 font-mono text-sm text-white outline-none"
                >
                  {availableToPlayers.map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {player.firstName} {player.lastName} | {player.primaryPosition}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                onClick={() => setIsTradeModalOpen(false)}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={handleTradeSubmit}
                disabled={!tradeFromPlayerId || !tradeToPlayerId || !tradeFromTeamId || !tradeToTeamId}
                className="rounded-2xl border border-prestige/25 bg-prestige/12 px-4 py-3 font-headline text-xl uppercase tracking-[0.08em] text-prestige disabled:opacity-40"
              >
                Execute Swap
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
