import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DraftHistoryEntry, DraftClassState } from '../logic/draftLogic';
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
import { HomeDashboard } from './HomeDashboard';
import { SimulationHub, SimulationRunState } from './SimulationHub';
import { TeamCalendar } from './TeamCalendar';
import { TeamsHub } from './TeamsHub';
import { PlayersHub } from './PlayersHub';
import { FreeAgencyHub } from './FreeAgencyHub';
import { TradesHub } from './TradesHub';
import { DraftHub } from './DraftHub';
import { LotteryHub } from './LotteryHub';
import { GameScreen } from './GameScreen';
import { StandingsHub } from './StandingsHub';
import { LeadersHub } from './LeadersHub';
import { HistoryHub } from './HistoryHub';
import { GPBBook } from './GPBBook';
import { PlayoffsBracket } from './PlayoffsBracket';
import { CommissionerNotificationsPanel } from './CommissionerNotificationsPanel';
import { CommissionerSettings } from './CommissionerSettings';
import { type AppView } from './MainNavigation';
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

type OffseasonStage = 'idle' | 'draft_lottery' | 'draft' | 'free_agency';

interface AppViewRouterProps {
  view: AppView;
  teams: Team[];
  games: Game[];
  playerState: LeaguePlayerState;
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  seasonComplete: boolean;
  offseasonStage: OffseasonStage;
  hasPendingSeasonAwards: boolean;
  awardsUnlockDate: string;
  lotteryOpenDate: string;
  draftOpenDate: string;
  freeAgencyOpenDate: string;
  isDraftOpen: boolean;
  isFreeAgencyMarketOpen: boolean;
  freeAgencyMarketStatusMessage: string;
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
  settings: SimulationSettings;
  dataSource: 'supabase' | 'local';
  playerGenerationPreview: LeaguePlayerState | null;
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
  onResetSeason: () => void;
  onTerminateUniverse: () => void;
  onSimulateToDate: (targetDate: string) => void;
  onProposeTrade: (trade: TradeProposal) => void;
  onApprovePendingTrade: (proposalId: string) => void;
  onVetoPendingTrade: (proposalId: string) => void;
  onRefreshTradeBoard: () => void;
  onAssignFreeAgent: (assignment: FreeAgencyAssignment) => void;
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
  onClearHistoricalData: () => void;
  onPreviewGeneratePlayers: () => void;
  onGeneratePlayers: () => void;
  onHardWipePlayers: () => void;
  onDismissPlayerPreview: () => void;
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
  offseasonStage,
  hasPendingSeasonAwards,
  awardsUnlockDate,
  lotteryOpenDate,
  draftOpenDate,
  freeAgencyOpenDate,
  isDraftOpen,
  isFreeAgencyMarketOpen,
  freeAgencyMarketStatusMessage,
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
  settings,
  dataSource,
  playerGenerationPreview,
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
  onResetSeason,
  onTerminateUniverse,
  onSimulateToDate,
  onProposeTrade,
  onApprovePendingTrade,
  onVetoPendingTrade,
  onRefreshTradeBoard,
  onAssignFreeAgent,
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
  onPreviewGeneratePlayers,
  onGeneratePlayers,
  onHardWipePlayers,
  onDismissPlayerPreview,
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
          onSimulateToSelectedDate={onSimulateToSelectedDate}
          onSimulateToEndOfRegularSeason={onSimulateToEndOfRegularSeason}
          onSimulateDay={onSimulateDay}
          onSimulateWeek={onSimulateWeek}
          onSimulateMonth={onSimulateMonth}
          onSimulateNextGame={onSimulateNextTeamGame}
          onQuickSimSeason={onQuickSimSeason}
          onResetSeason={onResetSeason}
          onSimulateToDate={onSimulateToDate}
          onProposeTrade={onProposeTrade}
        />
      )}

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
          seasonResetStatus={seasonResetStatus}
          onOpenTrades={() => onSetView('trades')}
          onOpenFreeAgency={() => onSetView('free_agency')}
          onOpenLottery={() => onSetView('lottery')}
          onOpenDraft={() => onSetView('draft')}
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
          onExit={() => onSetView('dashboard')}
        />
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

      {view === 'leaders' && (
        <LeadersHub
          teams={teams}
          players={playerState.players}
          battingStats={playerState.battingStats}
          pitchingStats={playerState.pitchingStats}
          battingRatings={playerState.battingRatings}
          pitchingRatings={playerState.pitchingRatings}
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
          onPreviewGeneratePlayers={onPreviewGeneratePlayers}
          onGeneratePlayers={onGeneratePlayers}
          onHardWipePlayers={onHardWipePlayers}
          onDismissPlayerPreview={onDismissPlayerPreview}
          playerGenerationPreview={playerGenerationPreview}
          isClearingHistoricalData={isClearingHistoricalData}
          isGeneratingPlayers={isGeneratingPlayers}
          isWipingPlayers={isWipingPlayers}
          isSupabaseEnabled={isSupabaseEnabled}
        />
      )}
    </motion.div>
  </AnimatePresence>
);
