import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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
  generateHeadlineDeck,
  getFeaturedGame,
  type GameStoryCacheEntry,
  type StoryCandidate,
} from '../logic/headlineEngine';
import { isPlayoffGame } from '../logic/playoffs';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { buildAwardsForBoard, type MvpBoard } from '../lib/awardRace';
import { HomePanel, getMilestones, sortStandings, type DivisionSnapshot, type Milestone } from './home/shared';
import { FeaturedGamePanel, HeadlinePanel } from './home/HeadlinePanel';
import { MvpRacePanel } from './home/MvpRacePanel';
import { ActionCenter, DivisionSnapshotPanel, MilestoneTimeline, TradeDeskModal } from './home/Panels';
import { RetroButton, StatValue } from './ui';

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

/**
 * Front page. Orchestration only.
 *
 * This was a single 1,034-line file holding eleven panels inline, which meant
 * no panel could be restyled without rewriting the ten around it, and the MVP
 * scoring had already been duplicated onto the Leaders screen where the two
 * copies had begun to disagree on presentation. The panels now live under
 * components/home/, the scoring under lib/awardRace, and this file composes
 * them. Every computation below is carried over from the previous version
 * unchanged -- the headline deck, the story cache, the division grouping, the
 * trade-desk state and its validity effects.
 */
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
  const [mvpBoard, setMvpBoard] = useState<MvpBoard>('batting');
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
      if (!existing || stat.seasonYear > existing.seasonYear) next.set(stat.playerId, stat);
    });
    return next;
  }, [battingStats]);

  const preferredBattingStatsByPlayerId = useMemo(
    () => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'),
    [battingStats],
  );
  const preferredPitchingStatsByPlayerId = useMemo(
    () => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'),
    [pitchingStats],
  );
  const battingRatingsByPlayerId = useMemo(() => new Map(battingRatings.map((rating) => [rating.playerId, rating])), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => new Map(pitchingRatings.map((rating) => [rating.playerId, rating])), [pitchingRatings]);

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

  const awardInputs = useMemo(() => ({
    players,
    teamsById,
    battingStats: preferredBattingStatsByPlayerId,
    pitchingStats: preferredPitchingStatsByPlayerId,
    battingRatings: battingRatingsByPlayerId,
    pitchingRatings: pitchingRatingsByPlayerId,
  }), [battingRatingsByPlayerId, players, preferredBattingStatsByPlayerId, preferredPitchingStatsByPlayerId, pitchingRatingsByPlayerId, teamsById]);

  // Top three for the front page. The full eight-candidate field with the
  // component breakdown is on the Leaders screen.
  const mvpAwards = useMemo(() => buildAwardsForBoard(mvpBoard, awardInputs, 3), [awardInputs, mvpBoard]);

  const milestones = useMemo(() => getMilestones(games), [games]);
  const nextMilestone = useMemo(
    () => milestones.find((milestone) => milestone.date > timelineDate && milestone.date <= (games[games.length - 1]?.date ?? milestone.date)) ?? null,
    [games, milestones, timelineDate],
  );
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

  const simActions: Array<{ label: string; run: () => void; disabled?: boolean }> = [
    { label: 'Sim Day', run: onSimulateDay, disabled: isSimulating },
    { label: 'Sim Week', run: onSimulateWeek, disabled: isSimulating },
    { label: 'Sim Month', run: onSimulateMonth, disabled: isSimulating },
    { label: 'Next Game', run: onSimulateNextGame, disabled: isSimulating },
    { label: 'To Date', run: onSimulateToSelectedDate, disabled: isSimulating },
    { label: 'End Season', run: onSimulateToEndOfRegularSeason, disabled: isSimulating },
    { label: 'Quick Sim', run: onQuickSimSeason, disabled: isSimulating },
  ];

  return (
    <section className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
        <HeadlinePanel
          deck={headlineDeck}
          awayTeam={heroAwayTeam}
          homeTeam={heroHomeTeam}
          timelineDate={timelineDate}
          teamLookup={teamsById}
          onOpenGame={onOpenGame}
        />

        <div className="flex flex-col gap-5">
          <FeaturedGamePanel
            gameId={featuredGame ? featuredGame.game.gameId : null}
            angle={featuredGame ? featuredGame.angle : null}
            lore={featuredGame ? featuredGame.lore : null}
            away={featuredAwayTeam}
            home={featuredHomeTeam}
            date={featuredGame ? featuredGame.game.date : null}
            onOpenGame={onOpenGame}
          />
          <MvpRacePanel board={mvpBoard} onBoardChange={setMvpBoard} entries={mvpAwards} />
        </div>
      </div>

      <MilestoneTimeline
        milestones={milestones}
        timelineDate={timelineDate}
        nextMilestone={nextMilestone}
        isSimulating={isSimulating}
        onOpenSimulation={onOpenSimulation}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="flex flex-col gap-5">
          <HomePanel title="Simulation Desk">
            <div className="flex flex-wrap gap-2">
              {simActions.map((action) => (
                <RetroButton
                  key={action.label}
                  variant={action.label === 'Quick Sim' ? 'primary' : 'default'}
                  size="sm"
                  onClick={action.run}
                  disabled={action.disabled}
                >
                  {action.label}
                </RetroButton>
              ))}
              <RetroButton variant="ghost" size="sm" onClick={onResetSeason} disabled={isSimulating}>
                Reset Season
              </RetroButton>
            </div>
          </HomePanel>

          <ActionCenter
            onProposeTrade={() => setIsTradeModalOpen(true)}
            onOpenFreeAgency={onOpenFreeAgency}
            onOpenTeams={onOpenTeams}
            onOpenStandings={onOpenStandings}
            freeAgentCount={freeAgents.length}
            selectedTeam={selectedTeam}
          />
        </div>

        <div className="flex flex-col gap-5">
          <DivisionSnapshotPanel
            snapshots={divisionSnapshots}
            activeIndex={activeDivisionIndex}
            onSelect={setActiveDivisionIndex}
          />

          <HomePanel title="Daily Slate" bodyClassName="p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="t-caption text-[var(--color-ink-faint)]">CURRENT DAY</p>
                <p className="t-h2 mt-1">
                  {timelineDate ? new Date(`${timelineDate}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'NO ACTIVE DATE'}
                </p>
                <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
                  {todaysGames.length > 0
                    ? `${todaysGames.length} game${todaysGames.length === 1 ? '' : 's'} on deck across the league.`
                    : 'No games are scheduled for the active date.'}
                </p>
              </div>
              {featuredGame && (
                <RetroButton variant="default" size="sm" onClick={() => onOpenGame(featuredGame.game.gameId)}>
                  Featured Game <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </RetroButton>
              )}
            </div>
          </HomePanel>
        </div>
      </div>

      {isTradeModalOpen && (
        <TradeDeskModal
          teams={teams}
          fromTeamId={tradeFromTeamId}
          toTeamId={tradeToTeamId}
          fromPlayerId={tradeFromPlayerId}
          toPlayerId={tradeToPlayerId}
          fromPlayers={availableFromPlayers}
          toPlayers={availableToPlayers}
          onFromTeam={setTradeFromTeamId}
          onToTeam={setTradeToTeamId}
          onFromPlayer={setTradeFromPlayerId}
          onToPlayer={setTradeToPlayerId}
          onClose={() => setIsTradeModalOpen(false)}
          onSubmit={handleTradeSubmit}
        />
      )}
    </section>
  );
};
