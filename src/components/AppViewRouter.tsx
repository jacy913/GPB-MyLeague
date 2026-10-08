import React from 'react';
import type { UsePortfolio } from '../hooks/usePortfolio';
import { AnimatePresence, motion } from 'motion/react';
import { DraftHistoryEntry, DraftClassState } from '../logic/draftLogic';
import type { LocalUniverseBundle } from '../logic/localUniverseState';
import type { BuildNewUniverseResult } from '../logic/universeBootstrap';
import { SimulationProgressUpdate } from '../logic/simulationManager';
import {
  CompletedGameResult,
  Game,
  LeaguePlayerState,
  PendingTradeProposal,
  RosterSlotCode,
  SeasonHistoryEntry,
  SimulationSettings,
  SimulationTarget,
  Team,
} from '../types';
import { GamesScheduleView } from './GamesScheduleView';
import { ExchangeView } from './markets/ExchangeView';
import type { PriceSeries } from '../lib/analytics/sharePrice';
import type { PowerRankings } from '../lib/analytics/powerRankings';
import { HomeDashboard } from './HomeDashboard';
import { SimulationHub, SimulationRunState } from './SimulationHub';
import { TeamCalendar } from './TeamCalendar';
import { TeamsHub } from './TeamsHub';
import { PlayersHub } from './PlayersHub';
import { FreeAgencyHub } from './FreeAgencyHub';
import { OffseasonHub } from './OffseasonHub';
import { TradesHub } from './TradesHub';
import { DraftHub } from './DraftHub';
import { LotteryHub } from './LotteryHub';
import { MapHub } from './MapHub';
import { GameScreen } from './GameScreen';
import { StandingsHub } from './StandingsHub';
import { LeadersHub } from './LeadersHub';
import { HistoryHub } from './HistoryHub';
import { MediaHub } from './media/MediaHub';
import { BettingPage } from './betting/BettingPage';
import { BettingRecordScreen } from './betting/BettingRecordScreen';
import { LeadersDashboard } from './leaders/LeadersDashboard';
import { PowerRankingsView } from './leaders/PowerRankingsView';
import type { BettingSlipState } from '../hooks/useBettingSlip';
import { resolveSeasonYear } from '../lib/seasonYear';
import { GPBBook } from './GPBBook';
import { PlayoffsBracket } from './PlayoffsBracket';
import { CommissionerNotificationsPanel } from './CommissionerNotificationsPanel';
import { CommissionerSettings } from './CommissionerSettings';
import type { AppView } from '../types';
import { UiKitGallery } from './UiKitGallery';
import { Panel } from './ui';
import { SimulationSaveStatus } from '../hooks/useSimulationEngine';

type CalendarDateSummary = {
  total: number;
  completed: number;
  scheduled: number;
  playoff: number;
};

type PregameRecord = {
  awayWins: number;
  awayLosses: number;
  homeWins: number;
  homeLosses: number;
};

type SeasonProgressSummary = {
  completedGames: number;
  totalGames: number;
  remainingGames: number;
  progress: number;
};

type TradeProposal = {
  fromTeamId: string;
  toTeamId: string;
  fromPlayerId: string;
  toPlayerId: string;
};

type FreeAgencyAssignment = {
  playerId: string;
  teamId: string;
  slotCode: RosterSlotCode;
  contractYearsLeft: number;
  isQualifyingOffer?: boolean;
};

type SeasonResetStatus = {
  isResetting: boolean;
  progress: number;
  label: string;
};

type OffseasonStage = 'idle' | 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';

interface AppViewRouterProps {
  view: AppView;
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  seasonComplete: boolean;
  /** HXSE closes, one entry per simulated day. Undefined before anything is priced. */
  priceLedger?: PriceSeries[];
  /**
   * The League Office board, computed once in App.
   *
   * Null rather than optional-with-a-default because App is the only thing that can build it: it
   * needs the rosters, the schedule and the date together, and it has to be the SAME object the
   * dashboard strip reads. Building it in two places would run the Monte Carlo twice and let the two
   * surfaces disagree about a club -- which is the failure this screen exists to avoid.
   */
  rankings: PowerRankings | null;
  /**
   * The player's HXSE book, owned by App rather than by the Exchange view.
   *
   * Passed in rather than created here because the drawer and the Exchange desk must read one ledger,
   * and because the book outlives any single page: positions and cash carry across seasons.
   */
  book: UsePortfolio;
  offseasonStage: OffseasonStage;
  hasPendingSeasonAwards: boolean;
  awardsUnlockDate: string;
  lotteryOpenDate: string;
  draftOpenDate: string;
  freeAgencyOpenDate: string;
  isDraftOpen: boolean;
  isFreeAgencyMarketOpen: boolean;
  freeAgencyMarketStatusMessage: string;
  offseasonSeasonYear: number;
  offseasonChampionLabel: string;
  isSimulating: boolean;
  isFinalizingSimulation: boolean;
  simulationProgress: SimulationProgressUpdate | null;
  simulationRunState: SimulationRunState | null;
  simulationSaveStatus: SimulationSaveStatus;
  seasonResetStatus: SeasonResetStatus;
  isTerminatingUniverse: boolean;
  selectedGame: Game | null;
  blockingGamesForSelected: Game[];
  activeDateHasPlayoffs: boolean;
  activeDate: string;
  allScheduleDates: string[];
  calendarSummaryByDate: Map<string, CalendarDateSummary>;
  gamesForActiveDate: Game[];
  teamLookup: Map<string, Team>;
  pregameRecordByGameId: Map<string, PregameRecord>;
  seasonProgressSummary: SeasonProgressSummary;
  lastRegularSeasonDate: string;
  pendingTrades: PendingTradeProposal[];
  tradeBoardDate: string;
  currentTimelineDate: string;
  draftClass: DraftClassState | null;
  draftHistory: DraftHistoryEntry[];
  isDraftProcessing: boolean;
  seasonHistory: SeasonHistoryEntry[];
  /** The shell's slip. The Betting screen and the panel read the same state. */
  bettingSlip: BettingSlipState;
  /** Drops out of the record screen, which has no nav leaf to fall back on. */
  setViewFallback: () => void;
  settings: SimulationSettings;
  dataSource: 'supabase' | 'local';
  newUniversePreview: BuildNewUniverseResult | null;
  universeSeedInput: string;
  onSetUniverseSeedInput: (value: string) => void;
  isClearingHistoricalData: boolean;
  isGeneratingPlayers: boolean;
  isWipingPlayers: boolean;
  commissionerNotices: Array<{
    id: string;
    message: string;
    level: 'info' | 'success' | 'warning' | 'error';
    createdAt: string;
  }>;
  isSupabaseEnabled: boolean;
  getStatNumber: (game: Game, key: string) => number;
  getFallbackHits: (game: Game, side: 'away' | 'home') => number;
  onSetView: (nextView: AppView) => void;
  onSetSelectedDate: (nextDate: string) => void;
  onSetSelectedTeamId: (teamId: string) => void;
  onOpenGame: (gameId: string) => void;
  onOpenSimulationCenter: (targetDate?: string) => void;
  onStartSimulation: (target: SimulationTarget) => void;
  onCancelSimulation: () => void;
  onSimulateToSelectedDate: () => void;
  onSimulateToEndOfRegularSeason: () => void;
  onSimulateDay: () => void;
  onSimulateWeek: () => void;
  onSimulateMonth: () => void;
  onSimulateNextTeamGame: () => void;
  onQuickSimSeason: () => void;
  onSimulateToNextMilestone: () => void;
  onResetSeason: () => void;
  onTerminateUniverse: () => void;
  onGeneratePlayers: () => void;
  onSimulateToDate: (targetDate: string) => void;
  onProposeTrade: (trade: TradeProposal) => void;
  onApprovePendingTrade: (proposalId: string) => void;
  onVetoPendingTrade: (proposalId: string) => void;
  onRefreshTradeBoard: () => void;
  onAssignFreeAgent: (assignment: FreeAgencyAssignment) => void;
  onShakeUpFreeAgency: () => void;
  onAutoSelectAwards: () => void;
  onSimulateRetirements: () => void;
  onCompleteFreeAgency: () => void;
  onGenerateDraftClass: () => void;
  onDraftNextPick: () => void;
  onAutoDraftRound: () => void;
  onAutoDraftAll: () => void;
  onStopAutoDraft: () => void;
  onResetDraftBoard: () => void;
  onSimulateBlockingGames: () => void;
  onCompleteGame: (completedResult: CompletedGameResult) => void;
  onSelectStandingsTeam: (teamId: string) => void;
  onSimulateInlineToDate: (targetDate: string) => void;
  onSimulateNextPlayoffGameInline: () => void;
  onSimulateToGameInline: (targetGameId: string) => void;
  onClearNotifications: () => void;
  onSaveSettings: (newTeams: Team[], newSettings: SimulationSettings) => void;
  /*
    Both of these are `Promise<void>`, because they ARE async.

    App builds them as `async` handlers, and `CommissionerSettings` declares them `() => Promise<void>`
    and fires them with `void onClearHistoricalData()` -- a call that only makes sense if the result
    is a promise being deliberately not awaited. The router was the odd one out, narrowing them to
    `() => void` on the way through, which is what made passing them on to the settings page an error.
  */
  onClearHistoricalData: () => Promise<void>;
  onHardWipePlayers: () => Promise<void>;
  /**
   * Builds a throwaway universe from the current seed and shows it, without changing anything.
   *
   * Forwarded to the Simulation Desk because that is where the Terminate Universe modal lives, and
   * that modal's Preview button calls it. The whole feature existed -- the bootstrap, the preview
   * modal, the handler in App, the two props on SimulationHub -- and none of it was connected:
   * App never passed the handler down, so the button on screen invoked `undefined` and threw.
   */
  onPreviewNewUniverse: () => void;
  onDismissPlayerPreview: () => void;
  /**
   * A club the reader arrived wanting to look at, consumed once by ExchangeView.
   *
   * Set when the HXSE portfolio drawer's position rows are clicked: the comment there says the row
   * "sends the reader to the Exchange with that club already selected", and ExchangeView has always
   * had the effect that does it -- `pendingClub` is consumed on arrival and cleared through
   * `onPendingClubConsumed`. This router simply did not carry the two across, so the selection never
   * happened and the drawer landed you on the league average.
   *
   * Third instance of the same shape in this one commit: a prop written by a caller, consumed by a
   * component, and dropped in the hop between them.
   */
  pendingClub?: string | null;
  onPendingClubConsumed?: () => void;
  /*
    The two local-backup handlers, forwarded to Commissioner Settings.

    These reached the router the whole time -- App spreads `{...routerActions}` into this element, and
    that object carries both -- but they were not in this interface, so they were never destructured
    and never reached CommissionerSettings, whose own props declare them required. The Export and
    Import Local Backup controls were on screen and invoked `undefined`.

    Declared rather than removed, because the handlers exist, are correct, and are already built into
    the router-actions bundle that this file consumes. The gap was one hop.
  */
  onExportLocalBackup: () => Promise<LocalUniverseBundle>;
  onImportLocalBackup: (payload: unknown) => Promise<void>;
}

export const AppViewRouter = ({
  view,
  teams,
  games,
  playerState,
  currentDate,
  selectedDate,
  selectedTeamId,
  seasonComplete,
  priceLedger,
  rankings,
  book,
  offseasonStage,
  hasPendingSeasonAwards,
  awardsUnlockDate,
  lotteryOpenDate,
  draftOpenDate,
  freeAgencyOpenDate,
  isDraftOpen,
  isFreeAgencyMarketOpen,
  freeAgencyMarketStatusMessage,
  offseasonSeasonYear,
  offseasonChampionLabel,
  isSimulating,
  isFinalizingSimulation,
  simulationProgress,
  simulationRunState,
  simulationSaveStatus,
  seasonResetStatus,
  isTerminatingUniverse,
  selectedGame,
  blockingGamesForSelected,
  activeDateHasPlayoffs,
  activeDate,
  allScheduleDates,
  calendarSummaryByDate,
  gamesForActiveDate,
  teamLookup,
  pregameRecordByGameId,
  seasonProgressSummary,
  lastRegularSeasonDate,
  pendingTrades,
  tradeBoardDate,
  currentTimelineDate,
  draftClass,
  draftHistory,
  isDraftProcessing,
  seasonHistory,
  bettingSlip,
  setViewFallback,
  settings,
  dataSource,
  newUniversePreview,
  universeSeedInput,
  onSetUniverseSeedInput,
  isClearingHistoricalData,
  isGeneratingPlayers,
  isWipingPlayers,
  commissionerNotices,
  isSupabaseEnabled,
  getStatNumber,
  getFallbackHits,
  onSetView,
  onSetSelectedDate,
  onSetSelectedTeamId,
  onOpenGame,
  onOpenSimulationCenter,
  onStartSimulation,
  onCancelSimulation,
  onSimulateToSelectedDate,
  onSimulateToEndOfRegularSeason,
  onSimulateDay,
  onSimulateWeek,
  onSimulateMonth,
  onSimulateNextTeamGame,
  onQuickSimSeason,
  onSimulateToNextMilestone,
  onResetSeason,
  onTerminateUniverse,
  onGeneratePlayers,
  onSimulateToDate,
  onProposeTrade,
  onApprovePendingTrade,
  onVetoPendingTrade,
  onRefreshTradeBoard,
  onAssignFreeAgent,
  onShakeUpFreeAgency,
  onAutoSelectAwards,
  onSimulateRetirements,
  onCompleteFreeAgency,
  onGenerateDraftClass,
  onDraftNextPick,
  onAutoDraftRound,
  onAutoDraftAll,
  onStopAutoDraft,
  onResetDraftBoard,
  onSimulateBlockingGames,
  onCompleteGame,
  onSelectStandingsTeam,
  onSimulateInlineToDate,
  onSimulateNextPlayoffGameInline,
  onSimulateToGameInline,
  onClearNotifications,
  onSaveSettings,
  onClearHistoricalData,
  onHardWipePlayers,
  onPreviewNewUniverse,
  onDismissPlayerPreview,
  pendingClub,
  onPendingClubConsumed,
  onExportLocalBackup,
  onImportLocalBackup,
}: AppViewRouterProps) => (
  <AnimatePresence mode="wait">
    <motion.div
      key={view}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.24 }}
    >
      {view === 'games_schedule' && (
        <GamesScheduleView
          seasonProgressSummary={seasonProgressSummary}
          seasonComplete={seasonComplete}
          activeDateHasPlayoffs={activeDateHasPlayoffs}
          currentDate={currentDate}
          activeDate={activeDate}
          allScheduleDates={allScheduleDates}
          calendarSummaryByDate={calendarSummaryByDate}
          lastRegularSeasonDate={lastRegularSeasonDate}
          gamesForActiveDate={gamesForActiveDate}
          games={games}
          teamLookup={teamLookup}
          pregameRecordByGameId={pregameRecordByGameId}
          getStatNumber={getStatNumber}
          getFallbackHits={getFallbackHits}
          onSelectDate={onSetSelectedDate}
          onOpenGame={onOpenGame}
        />
      )}

      {view === 'dashboard' && (
        <HomeDashboard
          teams={teams}
          games={games}
          players={playerState.players}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          transactions={playerState.transactions}
          rosterSlots={playerState.rosterSlots}
          currentDate={currentDate}
          selectedDate={selectedDate}
          selectedTeamId={selectedTeamId}
          isSimulating={isSimulating}
          onSelectDate={onSetSelectedDate}
          onSelectTeamId={onSetSelectedTeamId}
          onOpenGame={onOpenGame}
          onOpenTeams={() => onSetView('teams')}
          onOpenSimulation={onOpenSimulationCenter}
          onOpenFreeAgency={() => onSetView('free_agency')}
          onOpenStandings={() => onSetView('league_standings')}
          onOpenPowerRankings={() => onSetView('power_rankings')}
          onOpenBracket={() => onSetView('playoffs')}
          powerRankings={rankings}
          onSimulateToEndOfRegularSeason={onSimulateToEndOfRegularSeason}
          onSimulateDay={onSimulateDay}
          onSimulateWeek={onSimulateWeek}
          onSimulateMonth={onSimulateMonth}
          onSimulateToNextMilestone={onSimulateToNextMilestone}
          onSimulateToDate={onSimulateToDate}
          onProposeTrade={onProposeTrade}
        />
      )}

      {view === 'ui_kit' && <UiKitGallery />}

      {view === 'simulation' && (
        <SimulationHub
          teams={teams}
          games={games}
          currentDate={currentDate}
          selectedDate={selectedDate}
          selectedTeamId={selectedTeamId}
          isSimulating={isSimulating}
          seasonComplete={seasonComplete}
          offseasonStage={offseasonStage}
          hasPendingSeasonAwards={hasPendingSeasonAwards}
          awardsUnlockDate={awardsUnlockDate}
          lotteryOpenDate={lotteryOpenDate}
          draftOpenDate={draftOpenDate}
          freeAgencyOpenDate={freeAgencyOpenDate}
          simulationProgress={simulationProgress}
          simulationRunState={simulationRunState}
          simulationSaveStatus={simulationSaveStatus}
          isTerminatingUniverse={isTerminatingUniverse}
          onSelectDate={onSetSelectedDate}
          onSelectTeamId={onSetSelectedTeamId}
          onStartSimulation={onStartSimulation}
          onCancelSimulation={onCancelSimulation}
          onResetSeason={onResetSeason}
          onTerminateUniverse={onTerminateUniverse}
          onGeneratePlayers={onGeneratePlayers}
          universeSeedInput={universeSeedInput}
          onSetUniverseSeedInput={onSetUniverseSeedInput}
          seasonResetStatus={seasonResetStatus}
          onOpenTrades={() => onSetView('trades')}
          onOpenFreeAgency={() => onSetView('free_agency')}
          onOpenLottery={() => onSetView('lottery')}
          onOpenDraft={() => onSetView('draft')}
          /*
            The two props that make the Terminate Universe modal's Preview button work.

            Both were declared required on SimulationHub and never passed, which is why this call site
            was an error -- and why clicking Preview on that modal invoked `undefined`. `onPreview`
            builds the throwaway universe; `newUniversePreview` is the result the preview modal then
            renders.

            Worth noting how this stayed invisible for so long: the feature is fully built on both
            sides and only the single hop in the middle is missing, which is the shape a feature takes
            when nothing connects it. The Preview button was on screen the whole time.
          */
          onPreviewNewUniverse={onPreviewNewUniverse}
          newUniversePreview={newUniversePreview}
        />
      )}

      {view === 'team_calendar' && (
        <TeamCalendar
          teams={teams}
          games={games}
          currentDate={currentDate}
          selectedDate={selectedDate}
          onSelectDate={onSetSelectedDate}
          onOpenGame={onOpenGame}
        />
      )}

      {view === 'teams' && (
        <TeamsHub
          teams={teams}
          games={games}
          players={playerState.players}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          rosterSlots={playerState.rosterSlots}
          currentDate={currentDate}
          selectedTeamId={selectedTeamId}
          onSelectTeamId={onSetSelectedTeamId}
          onOpenGame={onOpenGame}
        />
      )}

      {view === 'players' && (
        <PlayersHub
          teams={teams}
          players={playerState.players}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          rosterSlots={playerState.rosterSlots}
        />
      )}

      {view === 'free_agency' && (
        <FreeAgencyHub
          teams={teams}
          players={playerState.players}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          rosterSlots={playerState.rosterSlots}
          transactions={playerState.transactions}
          currentDate={currentDate}
          freeAgencyOpenDate={freeAgencyOpenDate}
          isMarketOpen={isFreeAgencyMarketOpen}
          marketStatusMessage={freeAgencyMarketStatusMessage}
          seasonComplete={seasonComplete}
          onAssignPlayer={onAssignFreeAgent}
          onShakeUp={onShakeUpFreeAgency}
          onCompleteMarket={seasonComplete && offseasonStage === 'free_agency' ? onCompleteFreeAgency : undefined}
          onExit={() => onSetView('dashboard')}
        />
      )}

      {view === 'offseason' && seasonComplete && offseasonStage !== 'idle' && (
        <OffseasonHub
          seasonYear={offseasonSeasonYear}
          stage={offseasonStage}
          championLabel={offseasonChampionLabel}
          awardsComplete={seasonHistory.some((entry) => entry.seasonYear === offseasonSeasonYear)}
          lotteryComplete={Boolean(draftClass)}
          draftComplete={Boolean(draftClass?.isComplete)}
          onAwards={onAutoSelectAwards}
          onRetirements={onSimulateRetirements}
          onLottery={onGenerateDraftClass}
          onDraft={onAutoDraftAll}
          onFreeAgency={onCompleteFreeAgency}
          onStartSeason={onResetSeason}
        />
      )}
      {view === 'offseason' && !seasonComplete && (
        <Panel className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="t-h1 text-[var(--color-ink)]">Offseason Locked</p>
          <p className="t-body max-w-md text-[var(--color-ink-dim)]">
            The checklist opens automatically when the World Series champion is announced.
          </p>
        </Panel>
      )}

      {view === 'trades' && (
        <TradesHub
          teams={teams}
          players={playerState.players}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          pendingTrades={pendingTrades}
          transactions={playerState.transactions}
          currentDate={pendingTrades.length > 0 && tradeBoardDate ? tradeBoardDate : currentTimelineDate}
          onApproveTrade={onApprovePendingTrade}
          onVetoTrade={onVetoPendingTrade}
          onRefreshBoard={onRefreshTradeBoard}
        />
      )}

      {view === 'lottery' && (
        <LotteryHub
          teams={teams}
          currentDate={currentDate}
          offseasonStage={offseasonStage}
          lotteryOpenDate={lotteryOpenDate}
          draftClass={draftClass}
          isDraftProcessing={isDraftProcessing}
          onGenerateDraftClass={onGenerateDraftClass}
          onOpenDraft={() => onSetView('draft')}
        />
      )}

      {view === 'draft' && (
        <DraftHub
          teams={teams}
          currentDate={currentDate}
          draftOpenDate={draftOpenDate}
          draftClass={draftClass}
          draftHistory={draftHistory}
          isDraftProcessing={isDraftProcessing}
          isDraftOpen={isDraftOpen}
          onOpenLottery={() => onSetView('lottery')}
          onDraftNextPick={onDraftNextPick}
          onAutoDraftRound={onAutoDraftRound}
          onAutoDraftAll={onAutoDraftAll}
          onStopAutoDraft={onStopAutoDraft}
          onResetDraftBoard={onResetDraftBoard}
        />
      )}

      {view === 'map' && <MapHub teams={teams} />}

      {view === 'game_screen' && selectedGame && (
        <GameScreen
          game={selectedGame}
          games={games}
          teams={teams}
          playerState={playerState}
          settings={settings}
          currentDate={currentDate}
          blockingGames={blockingGamesForSelected}
          onBack={() => onSetView('dashboard')}
          onSimulateBlockingGames={onSimulateBlockingGames}
          onCompleteGame={onCompleteGame}
        />
      )}

      {view === 'league_standings' && (
        <StandingsHub
          teams={teams}
          players={playerState.players}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          rosterSlots={playerState.rosterSlots}
          onSelectTeam={onSelectStandingsTeam}
        />
      )}

      {/*
        POWER RANKINGS. `rankings` is computed once in App and passed down, rather than built here,
        because the dashboard strip and this screen read the SAME object -- one Monte Carlo over the
        remaining season per (rosters, date), not two.
      */}
      {view === 'power_rankings' && (
        rankings && (
          <PowerRankingsView
            rankings={rankings}
            teamsById={teamLookup}
            onSelectTeamId={onSetSelectedTeamId}
          />
        )
      )}

      {view === 'leaders' && (
        <LeadersHub
          teams={teams}
          players={playerState.players}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          onOpenDashboards={() => onSetView('leaders_dashboards')}
        />
      )}

      {/*
        The dashboards half of Leaders.

        A route rather than a third control inside `leaders`, because that screen already
        stacks two segmented controls and this one needs its own again. Same pattern as
        `betting_record` above: no nav leaf, reached only from a switch on the sibling
        screen, and both screens carry the switch so neither can strand a reader.
      */}
      {view === 'leaders_dashboards' && (
        <LeadersDashboard
          teams={teams}
          players={playerState.players}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          games={games}
          onOpenTables={() => onSetView('leaders')}
        />
      )}

      {view === 'exchange' && (
        /*
          THE EXCHANGE. Scaffolded: one series, one chart, no controls.

          It takes `priceLedger` straight from App rather than reaching for the save, because the
          ledger is already threaded hook -> App -> bundle for the worker path and re-reading it here
          would create a second source of truth for the same array.
        */
        <ExchangeView
          priceLedger={priceLedger}
          teams={teams}
          book={book}
          pendingClub={pendingClub}
          onPendingClubConsumed={onPendingClubConsumed}
        />
      )}

      {view === 'media' && (
        <MediaHub
          teams={teams}
          games={games}
          currentDate={currentDate}
          players={playerState.players}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          playerState={playerState}
          seasonYear={resolveSeasonYear(currentDate, games)}
          onNavigateToBetting={() => onSetView('betting')}
          onPropFocus={bettingSlip.focusProp}
        />
      )}

      {view === 'betting' && (
        <BettingPage
          teams={teams}
          games={games}
          currentDate={currentDate}
          players={playerState.players}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          playerState={playerState}
          seasonYear={resolveSeasonYear(currentDate, games)}
          slip={bettingSlip}
        />
      )}

      {/*
        The record. Reached from the slip and from nowhere else -- there is no
        leaf for it in NAV_FOLDERS, so the rail cannot offer it. A manager who
        navigates here by some other route gets sent back rather than stranded
        on a screen with no way back to the slip.
      */}
      {view === 'betting_record' && (
        <BettingRecordScreen
          bets={bettingSlip.wallet.bets}
          balance={bettingSlip.wallet.balance}
          teams={teams}
          players={playerState.players}
          onBackToSlip={() => { setViewFallback(); bettingSlip.open(); }}
        />
      )}

      {view === 'history' && (
        <HistoryHub
          seasonHistory={seasonHistory}
          teams={teams}
        />
      )}

      {view === 'gpb_book' && (
        <GPBBook
          teams={teams}
          games={games}
          settings={settings}
          currentDate={currentDate}
          dataSource={dataSource}
        />
      )}

      {view === 'playoffs' && (
        <PlayoffsBracket
          teams={teams}
          games={games}
          seasonComplete={seasonComplete}
          currentDate={currentDate}
          selectedDate={selectedDate}
          onSelectDate={onSetSelectedDate}
          isSimulating={isSimulating || isFinalizingSimulation}
          onSimulateToDate={onSimulateInlineToDate}
          onSimulateNextPlayoffGame={onSimulateNextPlayoffGameInline}
          onSimulateToGame={onSimulateToGameInline}
          onCancelSimulation={onCancelSimulation}
        />
      )}

      {view === 'notifications' && (
        <CommissionerNotificationsPanel
          notices={commissionerNotices}
          onClear={onClearNotifications}
        />
      )}

      {view === 'settings' && (
        <CommissionerSettings
          teams={teams}
          settings={settings}
          onSave={onSaveSettings}
          onCancel={() => onSetView('games_schedule')}
          onClearHistoricalData={onClearHistoricalData}
          onHardWipePlayers={onHardWipePlayers}
          onDismissPlayerPreview={onDismissPlayerPreview}
          onExportLocalBackup={onExportLocalBackup}
          onImportLocalBackup={onImportLocalBackup}
          newUniversePreview={newUniversePreview}
          isClearingHistoricalData={isClearingHistoricalData}
          isGeneratingPlayers={isGeneratingPlayers}
          isWipingPlayers={isWipingPlayers}
          isSupabaseEnabled={isSupabaseEnabled}
        />
      )}
    </motion.div>
  </AnimatePresence>
);
