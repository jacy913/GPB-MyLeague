import { Dispatch, SetStateAction, useCallback, useEffect, useMemo } from 'react';
import { getCurrentSimTimeLabel } from '../logic/gameTimes';
import { isPlayoffGame, isRegularSeasonGame } from '../logic/playoffs';
import { generatePendingTradeProposals } from '../logic/tradeLogic';
import { Game, LeaguePlayerState, PendingTradeProposal, Team } from '../types';

type CalendarSummary = {
  total: number;
  completed: number;
  scheduled: number;
  playoff: number;
};

type SeasonProgressSummary = {
  completedGames: number;
  totalGames: number;
  remainingGames: number;
  progress: number;
};

type PregameRecordSnapshot = {
  awayWins: number;
  awayLosses: number;
  homeWins: number;
  homeLosses: number;
};

interface UseScheduleDerivedStateArgs {
  view: string;
  isSimulating: boolean;
  isFinalizingSimulation: boolean;
  selectedDate: string;
  currentDate: string;
  games: Game[];
  teams: Team[];
  playerState: LeaguePlayerState;
  pendingTrades: PendingTradeProposal[];
  tradeBoardDate: string;
  setPendingTrades: Dispatch<SetStateAction<PendingTradeProposal[]>>;
  setTradeBoardDate: Dispatch<SetStateAction<string>>;
  getProjectedSeasonSummary: (seasonGames: Game[]) => SeasonProgressSummary;
}

interface UseScheduleDerivedStateResult {
  activeDate: string;
  currentTimelineDate: string;
  scheduleViewActive: boolean;
  simulationPerformanceMode: boolean;
  refreshTradeBoard: () => void;
  allScheduleDates: string[];
  bannerDate: string;
  gamesForBannerDate: Game[];
  gamesForActiveDate: Game[];
  seasonProgressSummary: SeasonProgressSummary;
  calendarSummaryByDate: Map<string, CalendarSummary>;
  lastRegularSeasonDate: string;
  teamLookup: Map<string, Team>;
  pregameRecordByGameId: Map<string, PregameRecordSnapshot>;
  activeDateHasPlayoffs: boolean;
  currentTimelineTimeLabel: string;
}

const compareGamesByStatusThenId = (left: Game, right: Game): number =>
  left.status === right.status
    ? left.gameId.localeCompare(right.gameId)
    : left.status === 'completed'
      ? -1
      : 1;

const compareGamesByDateThenId = (left: Game, right: Game): number =>
  left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date);

const getGamesForDate = (games: Game[], date: string): Game[] =>
  games.filter((game) => game.date === date).sort(compareGamesByStatusThenId);

export const useScheduleDerivedState = ({
  view,
  isSimulating,
  isFinalizingSimulation,
  selectedDate,
  currentDate,
  games,
  teams,
  playerState,
  pendingTrades,
  tradeBoardDate,
  setPendingTrades,
  setTradeBoardDate,
  getProjectedSeasonSummary,
}: UseScheduleDerivedStateArgs): UseScheduleDerivedStateResult => {
  const activeDate = selectedDate || games[0]?.date || currentDate;
  const currentTimelineDate = currentDate || activeDate;
  const scheduleViewActive = view === 'games_schedule';
  const simulationPerformanceMode = isSimulating;

  const refreshTradeBoard = useCallback(() => {
    if (!currentTimelineDate) {
      setPendingTrades([]);
      setTradeBoardDate('');
      return;
    }

    const nextTrades = generatePendingTradeProposals(
      teams,
      playerState,
      games.filter(isRegularSeasonGame),
      currentTimelineDate,
    );
    setPendingTrades(nextTrades);
    setTradeBoardDate(currentTimelineDate);
  }, [currentTimelineDate, games, playerState, setPendingTrades, setTradeBoardDate, teams]);

  const allScheduleDates = useMemo(
    () => Array.from(new Set<string>(games.map((game) => game.date))).sort((a, b) => a.localeCompare(b)),
    [games],
  );

  useEffect(() => {
    if (simulationPerformanceMode || isFinalizingSimulation || !currentTimelineDate || tradeBoardDate === currentTimelineDate) {
      return;
    }

    // Preserve interruption proposals while timeline state catches up after worker stop.
    if (pendingTrades.length > 0 && tradeBoardDate && tradeBoardDate !== currentTimelineDate) {
      return;
    }
    refreshTradeBoard();
  }, [currentTimelineDate, isFinalizingSimulation, pendingTrades.length, refreshTradeBoard, simulationPerformanceMode, tradeBoardDate]);

  const bannerDate = useMemo(() => {
    if (simulationPerformanceMode) {
      return '';
    }

    const timelineDate = currentTimelineDate;
    if (!timelineDate || allScheduleDates.length === 0) {
      return '';
    }

    const currentIndex = allScheduleDates.indexOf(timelineDate);
    if (currentIndex <= 0) {
      return timelineDate;
    }

    return allScheduleDates[currentIndex - 1];
  }, [allScheduleDates, currentTimelineDate, simulationPerformanceMode]);

  const gamesForBannerDate = useMemo(
    () => simulationPerformanceMode
      ? []
      : getGamesForDate(games, bannerDate),
    [bannerDate, games, simulationPerformanceMode],
  );

  const gamesForActiveDate = useMemo(
    () => scheduleViewActive
      ? getGamesForDate(games, activeDate)
      : [],
    [activeDate, games, scheduleViewActive],
  );

  const seasonProgressSummary = useMemo(
    () => scheduleViewActive
      ? getProjectedSeasonSummary(games)
      : { completedGames: 0, totalGames: 0, remainingGames: 0, progress: 0 },
    [games, getProjectedSeasonSummary, scheduleViewActive],
  );

  const calendarSummaryByDate = useMemo(() => {
    if (!scheduleViewActive) {
      return new Map<string, CalendarSummary>();
    }

    const summary = new Map<string, CalendarSummary>();
    games.forEach((game) => {
      const current = summary.get(game.date) ?? { total: 0, completed: 0, scheduled: 0, playoff: 0 };
      current.total += 1;
      if (game.status === 'completed') {
        current.completed += 1;
      } else {
        current.scheduled += 1;
      }
      if (isPlayoffGame(game)) {
        current.playoff += 1;
      }
      summary.set(game.date, current);
    });
    return summary;
  }, [games, scheduleViewActive]);

  const lastRegularSeasonDate = useMemo(() => {
    if (!scheduleViewActive) {
      return '';
    }

    const regularSeasonDates = games
      .filter(isRegularSeasonGame)
      .map((game) => game.date)
      .sort((left, right) => left.localeCompare(right));
    return regularSeasonDates[regularSeasonDates.length - 1] ?? '';
  }, [games, scheduleViewActive]);

  const teamLookup = useMemo(
    () => new Map<string, Team>(teams.map((team) => [team.id, team] as const)),
    [teams],
  );

  const pregameRecordByGameId = useMemo(() => {
    if (!scheduleViewActive) {
      return new Map<string, PregameRecordSnapshot>();
    }

    const orderedGames = [...games].sort(compareGamesByDateThenId);
    const currentRecords = new Map<string, { wins: number; losses: number }>(
      teams.map((team) => [team.id, { wins: 0, losses: 0 }]),
    );
    const snapshots = new Map<string, PregameRecordSnapshot>();

    orderedGames.forEach((game) => {
      const awayRecord = currentRecords.get(game.awayTeam) ?? { wins: 0, losses: 0 };
      const homeRecord = currentRecords.get(game.homeTeam) ?? { wins: 0, losses: 0 };
      snapshots.set(game.gameId, {
        awayWins: awayRecord.wins,
        awayLosses: awayRecord.losses,
        homeWins: homeRecord.wins,
        homeLosses: homeRecord.losses,
      });

      if (game.status !== 'completed' || !isRegularSeasonGame(game)) {
        return;
      }

      if (game.score.away > game.score.home) {
        awayRecord.wins += 1;
        homeRecord.losses += 1;
      } else {
        homeRecord.wins += 1;
        awayRecord.losses += 1;
      }

      currentRecords.set(game.awayTeam, awayRecord);
      currentRecords.set(game.homeTeam, homeRecord);
    });

    return snapshots;
  }, [games, scheduleViewActive, teams]);

  const activeDateHasPlayoffs = useMemo(
    () => scheduleViewActive && gamesForActiveDate.some((game) => isPlayoffGame(game)),
    [gamesForActiveDate, scheduleViewActive],
  );

  const currentTimelineTimeLabel = useMemo(
    () => getCurrentSimTimeLabel(games, currentTimelineDate),
    [games, currentTimelineDate],
  );

  return {
    activeDate,
    currentTimelineDate,
    scheduleViewActive,
    simulationPerformanceMode,
    refreshTradeBoard,
    allScheduleDates,
    bannerDate,
    gamesForBannerDate,
    gamesForActiveDate,
    seasonProgressSummary,
    calendarSummaryByDate,
    lastRegularSeasonDate,
    teamLookup,
    pregameRecordByGameId,
    activeDateHasPlayoffs,
    currentTimelineTimeLabel,
  };
};
