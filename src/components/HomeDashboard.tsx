import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  TeamRosterSlot,
} from '../types';
import {
  buildGameIndexes,
  buildGameStoryCandidates,
  buildTransactionIndexes,
  buildTransactionStoryCandidates,
  deriveGameLines,
  deriveGameShape,
  generateHeadlineDeck,
  getFeaturedGame,
  type DerivedGameLines,
  type GameShape,
  type GameStoryCacheEntry,
  type StoryCandidate,
} from '../logic/headlineEngine';
import { buildLeagueRateBaselines, extractGameEvents } from '../logic/headlinerEvents';
import { buildPersonaDeck, diagnosePersonaDeck, TOMBUCCELLI_IMPRESSION_SEASON_CAP } from '../logic/headlinerPipeline';
import type { GameEvent, HeadlinerContext, HeadlinerId } from '../logic/headliners';
import { addDaysToISODate } from '../logic/simulation';
import { EMPTY_HEADLINER_LEDGER, type HeadlinerLedger } from '../logic/localUniverseState';
import { isPlayoffGame } from '../logic/playoffs';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { buildAwardsForBoard, type MvpBoard } from '../lib/awardRace';
import { buildMediaReads } from '../lib/mediaReads';
import { buildGameLine, type GameLine } from '../lib/mediaOdds';
import { resolveSeasonYear } from '../lib/seasonYear';
import { HomePanel, getMilestones, sortStandings, type DivisionSnapshot, type Milestone } from './home/shared';
import { HeadlinerPanel } from './home/HeadlinerPanel';
import { FeaturedGamePanel, HeadlinePanel } from './home/HeadlinePanel';
import { MvpRacePanel } from './home/MvpRacePanel';
import { ActionCenter, DivisionSnapshotPanel, MilestoneTimeline, TradeDeskModal } from './home/Panels';
import { RetroButton, StatValue } from './ui';

/** Days of prior columns the panel remembers when picking today's lines. */
const RECENT_TITLE_DAYS = 4;
/** How many of a reporter's recent titles are held. More than one bank size, on purpose. */
const RECENT_TITLE_MEMORY = 6;
/** Ceiling on games considered for one day. A day holds about a dozen. */
const MAX_GAMES_PER_DECK = 60;

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
  /**
   * Roster slot rows.
   *
   * Passed rather than reconstructed because the front page now prices the
   * featured matchup, and buildMediaReads grades club strength off these. An
   * earlier version rebuilt a LeaguePlayerState here with an EMPTY rosterSlots
   * array to satisfy the type, which quietly downgraded the read and would have
   * made this screen quote a different price from the Betting page for the same
   * game. If the two screens are going to show the same number they have to be
   * reading the same state.
   */
  rosterSlots: TeamRosterSlot[];
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
  rosterSlots,
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
  /*
   * The newsroom's running tally.
   *
   * OPTIONAL, and defaulted to zero rather than required. The dashboard renders fine
   * without it and the pipeline reads a missing ledger as an untouched season, which
   * is the same tolerant path an old save takes. Required would mean every existing
   * caller and every test fixture had to learn about a field that only affects one
   * counter in the corner of one panel.
   *
   * NOT YET PERSISTED. Nothing writes back to the bundle yet, so an impression spent
   * today is forgotten on reload. That is a real gap rather than a hidden one, and it
   * is the reason the panel shows the tally as read-only for now. Wiring it needs the
   * save path, which reaches outside the front page, so it is a separate decision
   * rather than something to slip in here.
   */
  headlinerLedger = EMPTY_HEADLINER_LEDGER,
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

  /*
   * The bylined newsroom, for the same date as the headline above it.
   *
   * Deliberately a SEPARATE derivation rather than a second reading of the headline
   * deck. The two panels can disagree about which game is the story -- they are
   * different publications, and a columnist's take on a one-run game is not the game
   * of the day -- but they must not disagree about the DAY, so both resolve
   * `sourceDate` from the same place.
   *
   * The play-log walk is shared with the headline deck through `deriveGameLines`, and
   * each game's result is memoised by gameId for the same reason the headline story
   * cache exists: the derivation parses a stored log, and re-parsing it per panel per
   * render is exactly the kind of cost this repo has been bitten by before.
   */
  const derivedLinesByGameId = useMemo(() => {
    const map = new Map<string, DerivedGameLines>();
    gameIndexes.completedGamesDesc.forEach((game) => {
      map.set(game.gameId, deriveGameLines(game));
    });
    return map;
  }, [gameIndexes]);

  const gameShapesByGameId = useMemo(() => {
    const map = new Map<string, GameShape>();
    gameIndexes.completedGamesDesc.forEach((game) => {
      const derived = derivedLinesByGameId.get(game.gameId);
      if (derived) map.set(game.gameId, deriveGameShape(game, teamsById, derived));
    });
    return map;
  }, [derivedLinesByGameId, gameIndexes, teamsById]);

  // The analyst's league rates, built from the most recent games rather than the
  // whole season: the comparison is "is this night strange for this league right
  // now", and a baseline that drifts with the season stops flagging anything by
  // September.
  const personaBaselines = useMemo(
    () => buildLeagueRateBaselines(gameIndexes.completedGamesDesc.slice(0, 120), derivedLinesByGameId),
    [derivedLinesByGameId, gameIndexes],
  );

  /**
   * The day's events, and the context for one of them.
   *
   * Hoisted out of the deck memo because the recent-title memory needs to replay
   * previous days through the SAME functions. If the two used separate event
   * extraction, the memory would be built from different cards than the deck is, and
   * it would suppress titles the reader never actually saw.
   */
  const eventsForDate = useCallback(
    (date: string): GameEvent[] => {
      const window: Game[] = gameIndexes.completedGamesDesc
        .filter((game: Game) => game.date === date)
        .slice(0, MAX_GAMES_PER_DECK);
      return window.flatMap((game: Game) => {
        const derived = derivedLinesByGameId.get(game.gameId);
        const shape = gameShapesByGameId.get(game.gameId);
        if (!derived || !shape) return [];
        return extractGameEvents({
          game,
          derived,
          shape,
          teamsById,
          playersById,
          completedGamesDesc: gameIndexes.completedGamesDesc,
          baselines: personaBaselines,
        });
      });
    },
    [derivedLinesByGameId, gameIndexes, gameShapesByGameId, personaBaselines, playersById, teamsById],
  );

  const contextFor = useCallback(
    (game: Game | null): HeadlinerContext => {
      const shape = game ? gameShapesByGameId.get(game.gameId) : undefined;
      return {
        awayWinPct: shape?.awayWinPct ?? 0,
        homeWinPct: shape?.homeWinPct ?? 0,
        sameDivision: shape?.sameDivision ?? false,
        isPlayoffGame: shape?.isPlayoffGame ?? (game ? isPlayoffGame(game) : false),
      };
    },
    [gameShapesByGameId],
  );

  /*
   * What each reporter has already written, most recent first.
   *
   * Derived by replaying the previous days through the same pipeline, not stored. A
   * playtest over three seasons measured the same title on ~90 of 179 consecutive day
   * pairs, and the two obvious causes were both wrong -- the seeds are uniform and
   * every template bank is fully used. The real cause is arithmetic: `staff_wins`
   * alone publishes about 2,446 cards a season from eight templates, so some adjacent
   * pair must collide. Extra prose cannot fix a birthday problem; a memory can.
   *
   * Replaying rather than remembering is what keeps this deterministic. A ref that
   * grew as the season ran would make a reloaded save show different columns than the
   * one that was saved, and the pipeline's other promise -- same games, same
   * newsroom -- would quietly stop holding. Derived from the games, it cannot drift.
   */
  const recentTemplatesByByline = useMemo(() => {
    const sourceDate = headlineDeck.sourceDate ?? timelineDate;
    const dates: string[] = Array.from(
      new Set<string>(gameIndexes.completedGamesDesc.map((game: Game) => game.date as string)),
    )
      .sort()
      .filter((date) => date < sourceDate)
      .slice(-RECENT_TITLE_DAYS);

    const memory = new Map<HeadlinerId, string[]>();
    dates.forEach((date: string) => {
      buildPersonaDeck({
        events: eventsForDate(date),
        contextFor,
        impressionsSpent: 0,
        month: Number(date.slice(5, 7)) || 4,
      }).forEach((card) => {
        const list = memory.get(card.byline) ?? [];
        if (list.length < RECENT_TITLE_MEMORY) list.unshift(card.titleTemplate);
        memory.set(card.byline, list);
      });
    });
    return memory;
  }, [contextFor, eventsForDate, gameIndexes, headlineDeck.sourceDate, timelineDate]);

  const personaDeck = useMemo(() => {
    const date = headlineDeck.sourceDate ?? timelineDate;
    /*
     * THE SOURCE DATE ONLY, NOT A WINDOW AROUND IT.
     *
     * A two-day window was measured and it is wrong. `eventSeed` is derived from the
     * event's identity, so re-publishing yesterday's walk-off today renders the
     * identical title by construction -- a playtest over three seasons found the same
     * title on consecutive days 175 times out of 179, and the "consecutive days must
     * read differently" criterion failed outright.
     *
     * A day is about a dozen games, which is comfortably more than enough to fill a
     * six-card deck on a loud day and comfortably too few on a quiet one. That is the
     * stalemate rule doing its job, and widening the window to avoid empty days would
     * only be padding with yesterday's news.
     */
    const events = eventsForDate(date);

    const cards = buildPersonaDeck({
      events,
      contextFor,
      impressionsSpent: headlinerLedger.tombuccelliImpressions,
      // The memory is what stops the same reporter running the same line tomorrow.
      // Without it the deck is still correct -- it is just repetitive, which is what
      // three seasons of playtesting measured before this existed.
      recentTemplatesByByline,
      month: Number(date.slice(5, 7)) || 4,
    });

    return {
      cards,
      /*
       * Diagnostics are computed and then not shown.
       *
       * A placeholder with a stated purpose rather than a stub: `unemittableKinds` is
       * the number that catches a persona listing a kind no detector emits, which is a
       * failure where every visible aggregate stays healthy. A played season has now
       * confirmed it is 0, so this either earns a place in the panel's chrome bar or
       * it gets deleted. It does not get to sit here pretending to be observability.
       */
      diagnostics: diagnosePersonaDeck({ events, contextFor, deck: cards }),
    };
  }, [
    contextFor,
    eventsForDate,
    headlineDeck.sourceDate,
    headlinerLedger,
    recentTemplatesByByline,
    timelineDate,
  ]);

  /*
   * The price for the featured matchup.
   *
   * Built from the same read module and the same buildGameLine the Betting page
   * uses, deliberately. The front page is not allowed to invent its own number:
   * a manager who reads a price here and then walks to Betting has to find the
   * same price there, or one of the two screens is lying about the house.
   */
  const featuredLine = useMemo<GameLine | null>(() => {
    if (!featuredGame) return null;
    const away = teamsById.get(featuredGame.game.awayTeam);
    const home = teamsById.get(featuredGame.game.homeTeam);
    if (!away || !home) return null;

    const { scores, spread } = buildMediaReads({
      teams,
      players,
      battingRatings,
      pitchingRatings,
      battingStats,
      pitchingStats,
      playerState: {
        players,
        battingStats,
        pitchingStats,
        battingRatings,
        pitchingRatings,
        rosterSlots,
        transactions,
      },
      seasonYear: resolveSeasonYear(timelineDate, games),
    });

    const scoreFor = (teamId: string) => ({
      hollis: scores.hollis.get(teamId) ?? 0.5,
      glorest: scores.glorest.get(teamId) ?? 0.5,
      sharply: scores.sharply.get(teamId) ?? 0.5,
    });

    return buildGameLine({
      game: featuredGame.game,
      away,
      home,
      awayScores: scoreFor(away.id),
      homeScores: scoreFor(home.id),
      spread,
    });
  }, [
    battingRatings, battingStats, featuredGame, games, pitchingRatings,
    pitchingStats, players, rosterSlots, teams, teamsById, timelineDate,
    transactions,
  ]);

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

  /*
   * The headline panel resolves its own scoreline clubs from whichever slide is
   * showing. It used to take them as props built here from `headline.game`,
   * which is the PRIMARY headline only -- so on a carousel the big crest
   * followed the active slide while the score beside it stayed frozen on the
   * first, and the two contradicted each other from slide two onward.
   *
   * These two lookups are what that used. Kept as a comment rather than deleted
   * silently, because the failure mode is invisible: both values are valid
   * teams, and only their disagreement with the active slide is wrong.
   */
  // const heroAwayTeam = headline.game ? teamsById.get(headline.game.awayTeam) ?? null : null;
  // const heroHomeTeam = headline.game ? teamsById.get(headline.game.homeTeam) ?? null : null;
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
          timelineDate={timelineDate}
          teamLookup={teamsById}
          onOpenGame={onOpenGame}
        />

        {/*
          The bylined newsroom, directly below the headline and inside the same
          column. Adjacency rather than a new region on purpose: the two panels
          describe the same day, so putting them apart would invite the reader to
          think they describe different days, and the whole point is that one
          publication's game of the day and another publication's column about it
          sit next to each other.
        */}
        <HeadlinerPanel
          cards={personaDeck.cards}
          sourceDate={headlineDeck.sourceDate ?? null}
          timelineDate={timelineDate}
          impressionsSpent={headlinerLedger.tombuccelliImpressions}
          impressionCap={TOMBUCCELLI_IMPRESSION_SEASON_CAP}
        />

        {/*
          THE AWARD RACE MOVED UNDER THE SIDELINE REPORTS, into the wide column.

          It was in the narrow right-hand stack beneath the featured game, where a
          three-row leaderboard shared a 360px column with a priced matchup and lost.
          Every row of it is a stat comparison, and stat comparisons want width: the
          odds bar under each name had roughly a third of the room it needs to be
          readable at a glance, which is the only thing an odds bar is for.

          The wide column was also the one with slack. HeadlinePanel is a fixed-height
          hero and the newsroom carousel below it is one card, so the left column ran
          short of the right -- and this is the panel that fills that space rather than
          stretching anything to fit.
        */}
        <MvpRacePanel board={mvpBoard} onBoardChange={setMvpBoard} entries={mvpAwards} />

        <div className="flex flex-col gap-5">
          <FeaturedGamePanel
            gameId={featuredGame ? featuredGame.game.gameId : null}
            angle={featuredGame ? featuredGame.angle : null}
            away={featuredAwayTeam}
            home={featuredHomeTeam}
            line={featuredLine}
            date={featuredGame ? featuredGame.game.date : null}
            onOpenGame={onOpenGame}
          />
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
