import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  ChevronRight,
  Crown,
  Newspaper,
  ScrollText,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import {
  Game,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerTransaction,
  Team,
} from '../types';
import {
  buildGameIndexes,
  buildGameStoryCandidates,
  buildTransactionIndexes,
  buildTransactionStoryCandidates,
  formatTickerGame,
  formatTickerTransaction,
  generateHeadlineDeck,
  getFeaturedGame,
  type GameStoryCacheEntry,
  type StoryCandidate,
} from '../logic/headlineEngine';
import { isPlayoffGame, isRegularSeasonGame } from '../logic/playoffs';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { formatBattingAverage } from '../logic/statFormatting';
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
  pitchingStats: PlayerSeasonPitching[];
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

type MvpCandidate = {
  playerId: string;
  playerName: string;
  team: Team | null;
  odds: number;
  summary: string;
};

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeOdds = (
  entries: Array<Omit<MvpCandidate, 'odds'>>,
  rawScores: number[],
): MvpCandidate[] => {
  const positiveScores = rawScores.map((score) => Math.max(0.1, score));
  const total = positiveScores.reduce((sum, score) => sum + score, 0);
  return entries.map((entry, index) => ({
    ...entry,
    odds: total > 0 ? Number(((positiveScores[index] / total) * 100).toFixed(1)) : 0,
  }));
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
  pitchingStats,
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
  const [mvpBoard, setMvpBoard] = useState<'batting' | 'pitching'>('batting');
  const [tradeFromTeamId, setTradeFromTeamId] = useState(selectedTeamId);
  const [tradeToTeamId, setTradeToTeamId] = useState(teams.find((team) => team.id !== selectedTeamId)?.id ?? teams[0]?.id ?? '');
  const [tradeFromPlayerId, setTradeFromPlayerId] = useState('');
  const [tradeToPlayerId, setTradeToPlayerId] = useState('');

  const gameStoryCacheRef = useRef<Map<string, GameStoryCacheEntry>>(new Map());
  const gameStoryCacheDependenciesRef = useRef<{
    teamsById: Map<string, Team> | null;
    battingStatsByPlayerId: Map<string, PlayerSeasonBatting> | null;
    battingRatingsByPlayerId: Map<string, PlayerBattingRatings> | null;
    pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings> | null;
  }>({
    teamsById: null,
    battingStatsByPlayerId: null,
    battingRatingsByPlayerId: null,
    pitchingRatingsByPlayerId: null,
  });
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const gameIndexes = useMemo(() => buildGameIndexes(games), [games]);
  const transactionIndexes = useMemo(() => buildTransactionIndexes(transactions), [transactions]);
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
  const preferredBattingStatsByPlayerId = useMemo(
    () => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'),
    [battingStats],
  );
  const preferredPitchingStatsByPlayerId = useMemo(
    () => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'),
    [pitchingStats],
  );
  if (
    gameStoryCacheDependenciesRef.current.teamsById !== teamsById ||
    gameStoryCacheDependenciesRef.current.battingStatsByPlayerId !== battingStatsByPlayerId ||
    gameStoryCacheDependenciesRef.current.battingRatingsByPlayerId !== battingRatingsByPlayerId ||
    gameStoryCacheDependenciesRef.current.pitchingRatingsByPlayerId !== pitchingRatingsByPlayerId
  ) {
    gameStoryCacheRef.current.clear();
    gameStoryCacheDependenciesRef.current = {
      teamsById,
      battingStatsByPlayerId,
      battingRatingsByPlayerId,
      pitchingRatingsByPlayerId,
    };
  }

  const timelineDate = currentDate || selectedDate || games[0]?.date || '';
  const todaysGames = useMemo(
    () => gameIndexes.gamesByDate.get(timelineDate) ?? [],
    [gameIndexes, timelineDate],
  );
  const headlineTransactionDate = timelineDate || transactionIndexes.spotlightTransactionsDesc[0]?.effectiveDate || '';
  const headlineTransactionStories = useMemo(
    () =>
      buildTransactionStoryCandidates(
        headlineTransactionDate
          ? transactionIndexes.spotlightTransactionsByDate.get(headlineTransactionDate) ?? []
          : transactionIndexes.spotlightTransactionsDesc,
        playersById,
        teamsById,
        battingRatingsByPlayerId,
        pitchingRatingsByPlayerId,
      ),
    [
      battingRatingsByPlayerId,
      headlineTransactionDate,
      pitchingRatingsByPlayerId,
      playersById,
      teamsById,
      transactionIndexes,
    ],
  );
  const headlineDeck = useMemo(() => {
    const getGameStoryCandidates = (game: Game): StoryCandidate[] => {
      const rawPlayLog = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
      const awayHits = typeof game.stats.awayHits === 'number' ? game.stats.awayHits : null;
      const homeHits = typeof game.stats.homeHits === 'number' ? game.stats.homeHits : null;
      const isPlayoff = isPlayoffGame(game);
      const cached = gameStoryCacheRef.current.get(game.gameId);

      if (
        cached &&
        cached.rawPlayLog === rawPlayLog &&
        cached.awayScore === game.score.away &&
        cached.homeScore === game.score.home &&
        cached.awayHits === awayHits &&
        cached.homeHits === homeHits &&
        cached.isPlayoff === isPlayoff
      ) {
        return cached.stories;
      }

      const stories = buildGameStoryCandidates(
        game,
        teamsById,
        battingStatsByPlayerId,
        battingRatingsByPlayerId,
        pitchingRatingsByPlayerId,
      );
      gameStoryCacheRef.current.set(game.gameId, {
        rawPlayLog,
        awayScore: game.score.away,
        homeScore: game.score.home,
        awayHits,
        homeHits,
        isPlayoff,
        stories,
      });

      return stories;
    };

    return generateHeadlineDeck(
      gameIndexes,
      teamsById,
      timelineDate,
      headlineTransactionStories,
      getGameStoryCandidates,
      headlineTransactionDate || null,
    );
  }, [
    battingStatsByPlayerId,
    battingRatingsByPlayerId,
    gameIndexes,
    headlineTransactionDate,
    headlineTransactionStories,
    pitchingRatingsByPlayerId,
    teamsById,
    timelineDate,
  ]);
  const headline = headlineDeck.primary;
  const featuredGame = useMemo(() => getFeaturedGame(todaysGames, teamsById), [todaysGames, teamsById]);
  const battingMvpCandidates = useMemo(() => {
    const entries = players
      .map((player) => {
        const stat = preferredBattingStatsByPlayerId.get(player.playerId);
        const rating = battingRatingsByPlayerId.get(player.playerId);
        if (!stat || !rating || stat.atBats < 120) {
          return null;
        }
        const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
        const winPctBonus = team ? getWinPct(team) * 60 : 0;
        const rawScore =
          stat.avg * 700 +
          stat.ops * 260 +
          stat.homeRuns * 4 +
          stat.rbi * 1.75 +
          stat.hits * 0.5 +
          stat.runsScored * 0.7 +
          rating.overall * 0.45 +
          winPctBonus;
        return {
          rawScore,
          entry: {
            playerId: player.playerId,
            playerName: `${player.firstName} ${player.lastName}`,
            team,
            summary: `${formatBattingAverage(stat.avg)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI | ${rating.overall} OVR`,
          },
        };
      })
      .filter((entry): entry is { rawScore: number; entry: Omit<MvpCandidate, 'odds'> } => Boolean(entry))
      .sort((left, right) => right.rawScore - left.rawScore)
      .slice(0, 8);

    return normalizeOdds(entries.map((entry) => entry.entry), entries.map((entry) => entry.rawScore)).slice(0, 3);
  }, [battingRatingsByPlayerId, players, preferredBattingStatsByPlayerId, teamsById]);
  const pitchingMvpCandidates = useMemo(() => {
    const entries = players
      .map((player) => {
        const stat = preferredPitchingStatsByPlayerId.get(player.playerId);
        const rating = pitchingRatingsByPlayerId.get(player.playerId);
        if (!stat || !rating || (stat.inningsPitched < 50 && stat.saves < 12)) {
          return null;
        }
        const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
        const winPctBonus = team ? getWinPct(team) * 55 : 0;
        const rawScore =
          clamp(6 - stat.era, 0, 6) * 40 +
          clamp(2 - stat.whip, 0, 2) * 70 +
          stat.strikeouts * 0.9 +
          stat.wins * 4.5 +
          stat.saves * 2.25 +
          stat.inningsPitched * 1.1 +
          rating.overall * 0.45 +
          winPctBonus;
        return {
          rawScore,
          entry: {
            playerId: player.playerId,
            playerName: `${player.firstName} ${player.lastName}`,
            team,
            summary: `${stat.era.toFixed(2)} ERA | ${stat.strikeouts} K | ${stat.inningsPitched.toFixed(1)} IP | ${rating.overall} OVR`,
          },
        };
      })
      .filter((entry): entry is { rawScore: number; entry: Omit<MvpCandidate, 'odds'> } => Boolean(entry))
      .sort((left, right) => right.rawScore - left.rawScore)
      .slice(0, 8);

    return normalizeOdds(entries.map((entry) => entry.entry), entries.map((entry) => entry.rawScore)).slice(0, 3);
  }, [pitchingRatingsByPlayerId, players, preferredPitchingStatsByPlayerId, teamsById]);
  const milestones = useMemo(() => getMilestones(games), [games]);
  const nextMilestone = useMemo(
    () => milestones.find((milestone) => milestone.date > timelineDate && milestone.date <= (games[games.length - 1]?.date ?? milestone.date)) ?? null,
    [games, milestones, timelineDate],
  );
  const recentTickerItems = useMemo(() => {
    const recentGames = gameIndexes.completedGamesDesc
      .slice(0, 10)
      .map((game) => formatTickerGame(game, teamsById));
    const recentTransactions = transactionIndexes.sortedTransactionsDesc
      .slice(0, 6)
      .map((transaction) => formatTickerTransaction(transaction, playersById, teamsById));

    const items = [...recentGames, ...recentTransactions];
    return items.length > 0 ? items : ['LEAGUE OFFICE | Headlines, scores, and transactions will stream here as the season develops.'];
  }, [gameIndexes, playersById, teamsById, transactionIndexes]);

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
    const intervalId = window.setInterval(() => {
      setMvpBoard((current) => (current === 'batting' ? 'pitching' : 'batting'));
    }, 7000);

    return () => window.clearInterval(intervalId);
  }, []);

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
  const activeMvpCandidates = mvpBoard === 'batting' ? battingMvpCandidates : pitchingMvpCandidates;

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
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Award Race</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">
                  {mvpBoard === 'batting' ? 'Batting MVP Candidates' : 'Pitching MVP Candidates'}
                </p>
              </div>
              {mvpBoard === 'batting' ? <Crown className="h-5 w-5 text-[#d4bb6a]" /> : <Trophy className="h-5 w-5 text-platinum" />}
            </div>

            <div className="mt-5 space-y-3">
              {activeMvpCandidates.length > 0 ? (
                activeMvpCandidates.map((candidate, index) => (
                  <div key={`${mvpBoard}-${candidate.playerId}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-lg text-zinc-500">{index + 1}</span>
                        {candidate.team ? <TeamLogo team={candidate.team} sizeClass="h-12 w-12" /> : <div className="h-12 w-12 rounded-xl border border-white/10 bg-white/[0.03]" />}
                        <div className="min-w-0">
                          <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white truncate">{candidate.playerName}</p>
                          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 truncate">
                            {candidate.team ? `${candidate.team.city} ${candidate.team.name}` : 'Free Agent'}
                          </p>
                        </div>
                      </div>
                      <p className={`font-mono text-xl ${mvpBoard === 'batting' ? 'text-[#ecd693]' : 'text-platinum'}`}>{candidate.odds.toFixed(1)}%</p>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full ${mvpBoard === 'batting' ? 'bg-[linear-gradient(90deg,#d4bb6a,#f0e4b1)]' : 'bg-[linear-gradient(90deg,#0fe7d5,#9ff5ec)]'}`}
                        style={{ width: `${Math.max(8, candidate.odds)}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm text-zinc-400">{candidate.summary}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <p className="font-headline text-3xl uppercase tracking-[0.08em] text-white">No Candidates Yet</p>
                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                    MVP candidates will appear after enough regular-season data is available.
                  </p>
                </div>
              )}
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
