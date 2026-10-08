import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MediaId } from '../data/media';
import { MEDIA_PROFILES } from '../data/media';
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
  createPowerRankingsHeadline,
  getFeaturedGame,
  type DerivedGameLines,
  type GameShape,
  type GameStoryCacheEntry,
  type StoryCandidate,
} from '../logic/headlineEngine';
import { buildLeagueRateBaselines, extractGameEvents } from '../logic/headlinerEvents';
import { buildPersonaDeck, diagnosePersonaDeck } from '../logic/headlinerPipeline';
import type { GameEvent, HeadlinerContext, HeadlinerId } from '../logic/headliners';
import { addDaysToISODate } from '../logic/simulation';
import { EMPTY_HEADLINER_LEDGER, type HeadlinerLedger } from '../logic/localUniverseState';
import { isPlayoffGame } from '../logic/playoffs';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { buildAwardsForBoard, type MvpBoard } from '../lib/awardRace';
import { buildAwardMarket, AWARD_RACE_SPECS } from '../lib/mediaMarkets';
import { viewersFor } from '../lib/analytics/crowdSize';
import { probabilityToAmerican } from '../lib/markets';
import { buildMediaReads } from '../lib/mediaReads';
import { buildGameLine, type GameLine } from '../lib/mediaOdds';
import { resolveSeasonYear } from '../lib/seasonYear';
import { HomePanel, getMilestones, nextSeasonStop, sortStandings, type DivisionSnapshot, type Milestone } from './home/shared';
import { PostseasonSlate } from './home/PostseasonSlate';
import { PlayoffMasthead } from './home/PlayoffMasthead';
import { isPostseasonWindow } from '../lib/seasonPhase';
import { HeadlinerPanel } from './home/HeadlinerPanel';
import { FeaturedGamePanel, HeadlinePanel } from './home/HeadlinePanel';
import { MvpRacePanel } from './home/MvpRacePanel';
import { ActionCenter, DivisionSnapshotPanel, MilestoneTimeline, TradeDeskModal } from './home/Panels';
import { PowerRankingsStrip } from './home/PowerRankingsStrip';
import type { PowerRankings } from '../lib/analytics/powerRankings';
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
  /**
   * Opens the full power rankings board. A route switch rather than a callback into the parent,
   * because the board is a real LEAGUE nav destination and the strip should reach it the same way a
   * manager would from the rail.
   */
  onOpenPowerRankings: () => void;
  /**
   * Opens the playoff bracket. A route switch for the same reason as the power rankings: the
   * bracket is a real nav destination and the postseason section's button should reach it the way a
   * manager would from the rail, not through a private route change inside this component.
   */
  onOpenBracket: () => void;
  /**
   * The League Office board, or null when it could not be computed.
   *
   * Passed in rather than built here for one reason: the strip and the full board must read the SAME
   * object. It comes from a Monte Carlo over the remaining season, so building it twice would run the
   * expensive term twice and let the two surfaces disagree about a club.
   */
  powerRankings: PowerRankings | null;
  onSimulateToEndOfRegularSeason: () => void;
  onSimulateDay: () => void;
  onSimulateWeek: () => void;
  onSimulateMonth: () => void;
  /**
   * Advance to the next season milestone. Replaces the desk's "Quick Sim".
   *
   * `onSimulateToSelectedDate` and `onResetSeason` were removed from this panel rather than left
   * disabled. The first depended on a `selectedDate` prop that the dashboard never offers a way to
   * set, so it silently clamped to today and ran a single day -- the same thing Sim Day does. It
   * still exists on the Simulation screen, where a date field sits directly above the button that
   * uses it. The second is reachable where it makes sense, on the offseason panel, labelled for what
   * it does there.
   */
  onSimulateToNextMilestone: () => void;
  onSimulateToDate: (date: string) => void;
  onProposeTrade: (trade: TradeProposal) => void;
  /**
   * The newsroom's running tally. Optional, and defaulted to `EMPTY_HEADLINER_LEDGER`.
   *
   * The long form of this -- why it is optional rather than required, and why the tally is read-only
   * until the save path exists -- is on the destructuring default at the bottom of the component.
   *
   * It was destructured but never declared here, so `HomeDashboard` was reading a field its own props
   * type did not admit. Runtime was fine and the default made it genuinely optional; the type was the
   * only thing out of step, and only because the component was `any`.
   */
  headlinerLedger?: HeadlinerLedger;
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
  onOpenPowerRankings,
  onOpenBracket,
  powerRankings,
  onSimulateToEndOfRegularSeason,
  onSimulateDay,
  onSimulateWeek,
  onSimulateMonth,
  onSimulateToNextMilestone,
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
  /*
    THE POSTSEASON GATE.

    Derived from the schedule, not stored, and it opens on the first SCHEDULED playoff game -- so the
    front page says October is coming while it is still September, rather than on the morning after
    a result. It closes when the last scheduled playoff game is played, which is what returns the app
    to navy and is also what makes the section's `Go to Bracket` button stop pointing at an empty
    bracket.

    Keyed on the BOOLEAN, not on `games`. Keyed on `games` it would re-evaluate -- and re-run the
    effect in App that sets the palette attribute -- on every simulation, which is a DOM mutation per
    simulated day for a value that changes twice a season.
  */
  const isPostseason = useMemo(() => isPostseasonWindow(games), [games]);
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

  /*
    THE POWER RANKINGS STORY, memoised on its own.

    Separate from the deck memo on purpose. It is derived from `powerRankings` and `teamsById` alone,
    while the deck memo also depends on the play log, per-player stats and the transaction date -- so
    folding this in would rebuild the story text every time any of those moved. It is cheap either
    way, but a dependency list that changes for no reason is how a memo quietly stops being a memo.
  */
  const powerRankingsStory = useMemo(
    () => (powerRankings
      ? createPowerRankingsHeadline(powerRankings.rows, teamsById)
      : null),
    [powerRankings, teamsById],
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
      powerRankingsStory,
    );
  }, [
    battingStatsByPlayerId,
    battingRatingsByPlayerId,
    gameIndexes,
    headlineTransactionDate,
    headlineTransactionStories,
    pitchingRatingsByPlayerId,
    powerRankingsStory,
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
          completedGamesDesc: gameIndexes.completedGamesUpTo(game.gameId),
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

  /*
   * DERIVED FROM THE PROFILE LIST, NOT THREE HARDCODED KEYS.
   *
   * This was a literal with three entries, and adding five forecasters broke it at compile
   * time -- which is the type system doing precisely the job it is there for. Iterating
   * MEDIA_PROFILES means the ninth forecaster needs no change here at all, and a scorer that
   * forgets an outlet gets a neutral 0.5 rather than a missing key.
   */
  const scoreFor = (teamId: string): Record<MediaId, number> =>
    Object.fromEntries(
      MEDIA_PROFILES.map((profile) => [profile.id, scores[profile.id].get(teamId) ?? 0.5]),
    ) as Record<MediaId, number>;

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

  /*
    THE FULL CANDIDATE FIELD IS BUILT HERE AND THE TOP THREE ARE TAKEN AFTERWARDS.

    It used to be `buildAwardsForBoard(mvpBoard, awardInputs, 3)`, which was right for a panel that
    showed raw normalised shares and wrong the moment the panel started showing a MacroBet price.
    `buildAwardMarket` normalises over whatever field it is handed, so passing three entries posts
    the leader at roughly 85% -- a confident, plausible, wrong number, and nothing anywhere reports
    that it is wrong. Building the full field is what makes this panel's price the SAME price the
    book is selling, which is the entire reason for putting a MacroBet number on it.

    The field size matches `BettingPage.tsx:398` deliberately. Two call sites building the same race
    with two different field sizes would produce two different prices for the same player on the same
    day, and neither would know about the other.

    `decided` is deliberately NOT passed. It only sets `locked`, the sellability flag, and never
    touches the probability -- so omitting it cannot move the price, and `checkAwardRacePrice`
    asserts that rather than trusting it. The dashboard does not sell this market; MacroBet does,
    with the real closure computed there from the schedule. Guessing at a closure here would be
    inventing a fact this component has no business knowing.
  */
  const mvpAwards = useMemo(() => {
    const spec = AWARD_RACE_SPECS[mvpBoard];
    const field = buildAwardsForBoard(mvpBoard, awardInputs);
    if (field.length === 0) return [];
    const market = buildAwardMarket(spec.key, spec.title, field);
    // Keyed by playerId because `buildFieldMarket` keys outcomes by it. Matching on a display name
    // would silently drop a player whose club changed mid-season, which is the one moment a race is
    // most worth reading.
    const priceBy = new Map(market.outcomes.map((o) => [o.key, o.consensusProbability]));
    return field.slice(0, 3).map((entry) => ({
      ...entry,
      houseProbability: priceBy.get(entry.playerId) ?? null,
    }));
  }, [awardInputs, mvpBoard]);

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

  /*
    THE AUDIENCE FOR TONIGHT'S FEATURED FIXTURE.

    Keyed on the two clubs rather than on the game, because `getFeaturedGame` decides which fixture
    this is and the audience is a consequence of who is in it. Computed here rather than inside the
    panel because the panel takes teams and a line and has no business reaching back into the
    schedule.

    Null rather than zero when either club is missing -- a 0 audience is a certainty nobody can sell,
    and "we do not know yet" is what an absent club actually means.
  */
  const featuredViewers = useMemo(() => (
    featuredGame && featuredAwayTeam && featuredHomeTeam
      ? viewersFor({
        home: featuredHomeTeam,
        away: featuredAwayTeam,
        date: featuredGame.game.date,
        playoff: isPlayoffGame(featuredGame.game),
      })
      : null
  ), [featuredAwayTeam, featuredGame, featuredHomeTeam]);

  /**
 * The long run's destination, named on the button.
   *
   * "Quick Sim" said how fast and nothing about how far, and what it actually did was regular-season
   * end plus seventy days -- the postseason and into the offseason -- from one press. The button now
   * says which event it stops at, read from the same `nextSeasonStop` the date plan uses, so the
   * label and the scope cannot disagree.
   */
  const seasonStop = useMemo(() => nextSeasonStop(games, timelineDate), [games, timelineDate]);

  /**
   * The desk's buttons.
   *
   * "Next Game" was removed rather than repaired. The scope behind it resolves a club's next fixture
   * as "today's game or later", and all 32 clubs have a fixture on the current slate, so it was
   * always Sim Day under a different name -- two buttons on one panel doing the same thing with no
   * way to tell from the UI which was which. The scope itself is untouched and still reachable from
   * the Simulation screen; only this copy of the button is gone.
   */
  const simActions: Array<{ label: string; run: () => void; disabled?: boolean; primary?: boolean }> = [
    { label: 'Sim Day', run: onSimulateDay, disabled: isSimulating },
    { label: 'Sim Week', run: onSimulateWeek, disabled: isSimulating },
    { label: 'Sim Month', run: onSimulateMonth, disabled: isSimulating },
    {
      label: seasonStop ? `To ${seasonStop.label}` : 'To Season End',
      run: onSimulateToNextMilestone,
      disabled: isSimulating || !seasonStop,
      primary: true,
    },
    { label: 'To Reg Finale', run: onSimulateToEndOfRegularSeason, disabled: isSimulating },
  ];

  return (
    <section className="space-y-5">
      {/*
        THE POSTSEASON SECTION, at the top, and only during the postseason.

        ABOVE THE HEADLINE, not below it, because during October the bracket is the story and the
        day's story is one game of it. The headline keeps its position inside the regular layout --
        this section is a sibling of the grid, not a child of it, so nothing about the two-column
        composition below changes when it appears.

        GATED ON SCHEDULED PLAYOFF GAMES. It appears on the morning the bracket is drawn, not after a
        result, and it disappears once the last one is played -- which is also when `Go to Bracket`
        would stop pointing at anything.
      */}
      {isPostseason && (
        <PostseasonSlate
          games={games}
          currentDate={timelineDate}
          teamsById={teamsById}
          onOpenGame={onOpenGame}
          onOpenBracket={onOpenBracket}
        />
      )}

      <div className={`grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]${isPostseason ? ' xl:grid-rows-[auto_auto]' : ''}`}>
        {/*
          THE COLUMNS ARE WRAPPED, AND THEY HAVE TO BE.

          This grid had four direct children -- headline, newsroom, award race, featured odds -- and
          a two-column grid places children ROW-major. So the newsroom landed in the NARROW column,
          directly beside the headline rather than below it, which is the opposite of what the comment
          under it has always claimed.

          That went unnoticed while the newsroom was empty. "No stories filed today" is a short line
          that fits in 360px. The first real headline on that panel is a long sentence, and at 121px
          of usable width after the 208px byline column it rendered ONE WORD PER LINE down the panel
          while the headline beside it sat in 800px of white space. A latent layout fault that only
          became visible once the panel had content in it.

          Wrapping each column in a flex-col is what makes the stated layout the actual layout:
          headline, then the newsroom under it, then the award race -- all wide -- with the featured
          odds alone on the right, which is where a priced matchup belongs anyway.
        */}
        {/*
          THE TWO COLUMNS SHARE ROW TRACKS DURING THE POSTSEASON.

          Below, the right column's second panel -- the Primetime Game -- was asked to start on the same
          line as this column's second panel, the newsroom. Sized by hand that is a magic number: the
          headline panel is a carousel whose height CHANGES with the slide, so a masthead tuned to one
          story's height is wrong by the height of the next one. Measured, the miss was exactly the
          20px column gap, which is the tell that this is a row-track problem and not a sizing one.

          So the grid is given two explicit row tracks and both columns span both of them with
          `grid-rows-subgrid`, which makes each column's first child share a track with the other's.
          The masthead then fills the track the headline defines, whatever that turns out to be, and
          the alignment holds across carousel rotations, across headlines of different lengths, and
          across viewport widths -- none of which a fixed height survives.

          `auto auto` and not `1fr 1fr`: the tracks must be free to grow with the content in them, and
          the postseason masthead has an aspect ratio of its own. Forcing equal halves would fight
          both.

          Chrome 117+ for subgrid. Below that the classes do nothing and the two columns revert to
          independent flex columns, which is the previous behaviour and still a working layout.
        */}
        <div
          className={`flex min-w-0 flex-col gap-5${isPostseason ? ' xl:col-span-1 xl:row-span-2 xl:grid xl:grid-rows-subgrid' : ''}`}
        >
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
          />

          {/*
            THE AWARD RACE IS BESIDE THE NEWSROOM, NOT UNDER IT.

            It spent a commit underneath, in the wide column, on the argument that a three-row
            leaderboard of stat comparisons wants width. That argument was about the panel being
            CROWDED, and it was answered by the wrong move: stacking three panels down one column
            left the right-hand 360px holding a single short matchup card and roughly 600px of empty
            space beneath it. The award race is three rows. It fits in a narrow column next to a
            story; it does not need a whole wide one to itself.

            So the right column carries the two panels that are genuinely narrow -- the power
            rankings strip and the featured game -- and the wide column carries the two that are
            genuinely wide, the headline and the column about it. Nothing is stretched to fill
            anything.

            THE AWARD RACE IS NOT HERE ANYMORE. It moved down to sit with the division snapshot and
            the daily slate, all three reading the same "where the season stands" question; the
            reasoning is on it, where it moved to. The second grid's right column was widened from
            320px to 360px to match this one, because the award race is about to carry a 48px crest
            and a name beside it and asking that of a narrower box than the one it left would be
            setting the redesign up to fail on arrival.
          */}
        </div>

        {/* The subgrid counterpart to the left column; see the note there for why. */}
        <div
          className={`flex min-w-0 flex-col gap-5${isPostseason ? ' xl:col-span-1 xl:row-span-2 xl:grid xl:grid-rows-subgrid' : ''}`}
        >
          {/*
            THE POWER RANKINGS MOVE UP, AND THE REASON THEY NOW CARRY IS STRONGER THAN THE ONE THEY
            REPLACED.

            They spent this grid's right column second down, below the simulation desk and the action
            centre, on the argument that they are a summary of the standings and so belong with them.
            That argument was about adjacency and it was not about height, and it put the one panel
            that is computable on a freshly rebuilt universe below two panels that cannot be: the
            division snapshot reads a 0-0 record on day one and the MVP race reads season stats that
            do not exist yet. On a new league the top of the page was where the empty states went,
            and the one panel with something to say was underneath them.

            Above the featured game, beside the day's story. Nothing is stretched: the strip is the
            narrow panel it was always built to be.
          */}
          {isPostseason ? (
            /*
              THE PLAYOFF MASTHEAD, at the top of the right column, and the Featured Game stays put
              beneath it.

              The masthead replaces the Power Rankings strip, which was already suppressed -- its
              valuation is a frozen regular-season record once the bracket opens
              (`simulationManager.ts:726` gates every increment on `isRegularSeasonGame`).

              The Featured Game is where it has always been. It was briefly moved DOWN into the award
              race's slot to free the whole corner for the masthead, which left the masthead floating
              in a column with a gap under it and pushed the day's actual fixture to the bottom of the
              page. Restoring it costs the masthead the lower half of the column, which is the right
              trade: two panels stacked read as a column, one panel with a hole under it does not.
            */
            <PlayoffMasthead />
          ) : (
            <PowerRankingsStrip
              rankings={powerRankings}
              teamsById={teamsById}
              onOpenPowerRankings={onOpenPowerRankings}
              onSelectTeamId={onSelectTeamId}
            />
          )}

          <FeaturedGamePanel
            gameId={featuredGame ? featuredGame.game.gameId : null}
            angle={featuredGame ? featuredGame.angle : null}
            away={featuredAwayTeam}
            home={featuredHomeTeam}
            line={featuredLine}
            date={featuredGame ? featuredGame.game.date : null}
            viewers={featuredViewers}
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="flex flex-col gap-5">
          <HomePanel title="Simulation Desk">
            {/*
              THE DESK BUTTONS ARE PARALLELOGRAMS.

              A shape rather than a colour, so it survives every variant and both the disabled and
              enabled states without a second set of rules. The cut is the repo's existing
              `parallelogram` utility at the standard `--chev`, which is the same geometry the
              chevron buttons and the panel tags already use -- nothing new was invented for this.

              The label needs room on BOTH cut sides. The chevron already had this bug once, recorded
              on `RetroButton`: the content was centred across the whole box, so the wedge cut through
              the last few characters and "Quick Sim" rendered as "Quick| Sim". A parallelogram cuts
              both corners, so symmetric padding is the fix and it lives in the primitive rather than
              at each call site.
            */}
            <div className="flex flex-wrap gap-2">
              {simActions.map((action) => (
                <RetroButton
                  key={action.label}
                  variant={action.primary ? 'primary' : 'default'}
                  shape="parallelogram"
                  size="sm"
                  onClick={action.run}
                  disabled={action.disabled}
                >
                  {action.label}
                </RetroButton>
              ))}
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
          {/*
            THE AWARD RACE MOVES DOWN, BESIDE THE TWO PANELS THAT READ THE SAME SEASON NUMBERS IT
            DOES.

            It sat above the featured odds in the top grid for a commit, argued at length: three rows
            of stat comparison want width, so it went under the newsroom in a wide column. That left
            the right-hand 360px holding one short matchup card and about 600px of nothing, which is
            the layout fault the argument was supposed to prevent.

            Down here it is beside the division snapshot and the daily slate, and all three are
            reading the same thing -- where the season stands right now. The featured game above is
            the outlier in the old arrangement: it is a single priced fixture, and the award race was
            never going to be near it.
          */}
          {/*
            THE AWARD RACE IS HERE FOR THE WHOLE SEASON, postseason included.

            The MVP and award races CLOSE at the end of the regular season -- deliberately, to close
            a betting exploit where a manager could back an award that had not been decided and then
            decide it. That decision about the races is right. The swap was wrong, because it was
            settled on the postseason's account rather than the regular season's: it pushed the
            featured game to the bottom of the page for six weeks to cover for a panel that is merely
            finished, when the featured game could have stayed exactly where it was and the masthead
            taken the corner above it.

            So the swap is reverted and this panel is unconditional again. A decided race sitting
            here for six weeks is a dull but true fact about the league; a feature that disappears
            for a third of the year costs the reader more than the dullness does.
          */}
          <MvpRacePanel board={mvpBoard} onBoardChange={setMvpBoard} entries={mvpAwards} />

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
