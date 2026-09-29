import React, { useEffect, useMemo, useState } from 'react';
import { isPlayoffGame, isRegularSeasonGame } from '../logic/playoffs';
import { NewUniversePreviewModal } from './NewUniversePreview';
import type { BuildNewUniverseResult } from '../logic/universeBootstrap';
import type { Game, SimulationTarget, Team } from '../types';
import { SeasonCalendar } from './simulation/SeasonCalendar';
import { CommissionGuidance, CommissionerNotes, LiveRun, RunBoard, SeasonFlow, type SimulationRunState } from './simulation/RunBoard';
import { TerminateUniverseModal } from './simulation/TerminateUniverseModal';
import {
  buildCalendarMilestones, formatShortDate, getMonthKey, getTargetLabel, getUniqueDates, shiftMonth,
  StatTile, timelineTone, type OffseasonStage, type TimelineStatus, type TimelineStep,
} from './simulation/shared';

export type { SimulationRunState };

interface SimulationHubProps {
  teams: Team[];
  games: Game[];
  currentDate: string;
  selectedDate: string;
  selectedTeamId: string;
  isSimulating: boolean;
  seasonComplete: boolean;
  offseasonStage: OffseasonStage;
  hasPendingSeasonAwards: boolean;
  awardsUnlockDate: string;
  lotteryOpenDate: string;
  draftOpenDate: string;
  freeAgencyOpenDate: string;
  simulationProgress: { completedGames: number; totalGames: number; currentDate: string; label: string } | null;
  simulationRunState: SimulationRunState | null;
  seasonResetStatus: { isResetting: boolean; progress: number; label: string };
  simulationSaveStatus: { isSaving: boolean; progress: number; label: string };
  isTerminatingUniverse: boolean;
  onSelectDate: (date: string) => void;
  onSelectTeamId: (teamId: string) => void;
  onStartSimulation: (target: SimulationTarget) => void;
  onCancelSimulation: () => void;
  onResetSeason: () => void;
  onTerminateUniverse: () => void;
  universeSeedInput: string;
  onSetUniverseSeedInput: (value: string) => void;
  onPreviewNewUniverse: () => void;
  newUniversePreview: BuildNewUniverseResult | null;
  onOpenTrades: () => void;
  onOpenFreeAgency: () => void;
  onOpenLottery: () => void;
  onOpenDraft: () => void;
}

/**
 * Simulation centre. Orchestration only.
 *
 * Was 1,050 lines holding six panels and a six-by-seven month grid, with six
 * ad-hoc status colour triples inlined. It is now composition over
 * components/simulation/. Every date computation, milestone derivation,
 * timeline status rule and progress figure is carried over unchanged.
 */
export const SimulationHub: React.FC<SimulationHubProps> = ({
  teams,
  games,
  currentDate,
  selectedDate,
  selectedTeamId,
  isSimulating,
  seasonComplete,
  offseasonStage,
  hasPendingSeasonAwards,
  awardsUnlockDate,
  lotteryOpenDate,
  draftOpenDate,
  freeAgencyOpenDate,
  simulationProgress,
  simulationRunState,
  seasonResetStatus,
  simulationSaveStatus,
  isTerminatingUniverse,
  onSelectDate,
  onSelectTeamId,
  onStartSimulation,
  onCancelSimulation,
  onResetSeason,
  onTerminateUniverse,
  universeSeedInput,
  onSetUniverseSeedInput,
  onPreviewNewUniverse,
  newUniversePreview,
  onOpenTrades,
  onOpenFreeAgency,
  onOpenLottery,
  onOpenDraft,
}) => {
  const uniqueDates = useMemo(() => getUniqueDates(games), [games]);
  const activeDate = selectedDate || currentDate || uniqueDates[0] || '';
  const cursorDate = simulationRunState?.currentDate || currentDate || activeDate;

  const regularSeasonComplete = useMemo(
    () => games.filter((game) => isRegularSeasonGame(game)).every((game) => game.status === 'completed'),
    [games],
  );

  const calendarMilestones = useMemo(
    () => buildCalendarMilestones(games, awardsUnlockDate, lotteryOpenDate, draftOpenDate, freeAgencyOpenDate),
    [awardsUnlockDate, draftOpenDate, freeAgencyOpenDate, games, lotteryOpenDate],
  );
  const milestonesByDate = useMemo(() => {
    const next = new Map<string, typeof calendarMilestones>();
    calendarMilestones.forEach((milestone) => {
      const bucket = next.get(milestone.date) ?? [];
      bucket.push(milestone);
      next.set(milestone.date, bucket);
    });
    return next;
  }, [calendarMilestones]);

  const seasonProgress = useMemo(() => {
    const completedGames = games.filter((game) => game.status === 'completed').length;
    return {
      completedGames,
      totalGames: games.length,
      progress: games.length > 0 ? (completedGames / games.length) * 100 : 0,
    };
  }, [games]);

  const planProgress = simulationRunState && simulationRunState.queuedDates.length > 0
    ? (simulationRunState.currentIndex / simulationRunState.queuedDates.length) * 100
    : 0;

  const controlsLocked = isSimulating || seasonResetStatus.isResetting || simulationSaveStatus.isSaving || isTerminatingUniverse;

  const [focusedMonth, setFocusedMonth] = useState(
    getMonthKey(cursorDate || activeDate || uniqueDates[0] || new Date().toISOString().slice(0, 7)),
  );
  const [terminateModalOpen, setTerminateModalOpen] = useState(false);

  useEffect(() => {
    const sourceDate = simulationRunState?.currentDate || cursorDate || activeDate
      || uniqueDates[0] || simulationRunState?.targetDate || '';
    if (sourceDate) setFocusedMonth(getMonthKey(sourceDate));
  }, [activeDate, cursorDate, simulationRunState, uniqueDates]);

  const calendarCells = useMemo(() => {
    const monthStart = `${focusedMonth}-01`;
    const leading = new Date(`${monthStart}T00:00:00Z`).getUTCDay();
    const gridStart = new Date(`${monthStart}T00:00:00Z`);
    gridStart.setUTCDate(gridStart.getUTCDate() - leading);
    return Array.from({ length: 42 }, (_, index) => {
      const cell = new Date(gridStart);
      cell.setUTCDate(cell.getUTCDate() + index);
      return cell.toISOString().slice(0, 10);
    });
  }, [focusedMonth]);

  const monthLabel = useMemo(
    () => new Date(`${focusedMonth}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [focusedMonth],
  );

  const queuedDates = simulationRunState?.queuedDates ?? [];
  const queuedDateSet = useMemo(() => new Set(queuedDates), [queuedDates]);
  const completedQueuedDates = useMemo(
    () => new Set(queuedDates.slice(0, simulationRunState?.currentIndex ?? 0)),
    [queuedDates, simulationRunState?.currentIndex],
  );

  const gameCountsByDate = useMemo(() => {
    const next = new Map<string, { scheduled: number; completed: number; playoff: number }>();
    games.forEach((game) => {
      const current = next.get(game.date) ?? { scheduled: 0, completed: 0, playoff: 0 };
      current.scheduled += 1;
      if (game.status === 'completed') current.completed += 1;
      if (isPlayoffGame(game)) current.playoff += 1;
      next.set(game.date, current);
    });
    return next;
  }, [games]);

  const effectiveOffseasonStage: OffseasonStage = seasonComplete
    ? (offseasonStage === 'idle' ? 'draft_lottery' : offseasonStage)
    : 'idle';

  const timelineStatuses = useMemo(() => {
    let lottery: TimelineStatus = 'upcoming';
    let draft: TimelineStatus = 'upcoming';
    let freeAgency: TimelineStatus = 'upcoming';
    let regularSeason: TimelineStatus = 'upcoming';
    let playoffs: TimelineStatus = 'upcoming';
    let awards: TimelineStatus = 'upcoming';

    if (!seasonComplete) {
      lottery = 'complete';
      draft = 'complete';
      freeAgency = 'complete';
      regularSeason = regularSeasonComplete ? 'complete' : 'active';
      playoffs = regularSeasonComplete ? 'active' : 'upcoming';
      awards = 'upcoming';
    } else {
      regularSeason = 'complete';
      playoffs = 'complete';
      const awardsDateReached = currentDate >= awardsUnlockDate;
      const lotteryDateReached = currentDate >= lotteryOpenDate;
      const draftDateReached = currentDate >= draftOpenDate;
      const freeAgencyDateReached = currentDate >= freeAgencyOpenDate;

      awards = !awardsDateReached ? 'upcoming' : (hasPendingSeasonAwards ? 'active' : 'complete');

      if (awards === 'complete') {
        if (effectiveOffseasonStage === 'draft_lottery') {
          lottery = lotteryDateReached ? 'active' : 'upcoming';
          draft = 'upcoming';
          freeAgency = 'upcoming';
        } else if (effectiveOffseasonStage === 'draft') {
          lottery = 'complete';
          draft = draftDateReached ? 'active' : 'upcoming';
          freeAgency = 'upcoming';
        } else {
          lottery = 'complete';
          draft = 'complete';
          freeAgency = freeAgencyDateReached ? 'active' : 'upcoming';
        }
      }
    }

    return { lottery, draft, freeAgency, regularSeason, playoffs, awards };
  }, [
    awardsUnlockDate, currentDate, draftOpenDate, effectiveOffseasonStage, freeAgencyOpenDate,
    hasPendingSeasonAwards, lotteryOpenDate, regularSeasonComplete, seasonComplete,
  ]);

  const seasonTimeline: TimelineStep[] = [
    { key: 'lottery', label: 'Lottery', description: 'Run lottery and lock the full draft order.', status: timelineStatuses.lottery, actionLabel: 'Open Lottery', onAction: onOpenLottery },
    { key: 'draft', label: 'Draft', description: 'Execute picks after lottery order is locked.', status: timelineStatuses.draft, actionLabel: 'Open Draft', onAction: onOpenDraft },
    { key: 'free_agency', label: 'Free Agency', description: 'Review offers and place free agents on rosters.', status: timelineStatuses.freeAgency, actionLabel: 'Open Free Agency', onAction: onOpenFreeAgency },
    { key: 'regular_season', label: 'Regular Season', description: 'Advance the calendar to the regular-season finale.', status: timelineStatuses.regularSeason, actionLabel: 'Sim To Reg Finale', onAction: () => onStartSimulation({ scope: 'regular_season' }), actionDisabled: controlsLocked || regularSeasonComplete },
    { key: 'playoffs', label: 'Playoffs', description: 'Run postseason games through the championship.', status: timelineStatuses.playoffs, actionLabel: 'Sim Full Season', onAction: () => onStartSimulation({ scope: 'season' }), actionDisabled: controlsLocked || seasonComplete },
    {
      key: 'awards',
      label: 'Awards',
      description: seasonComplete && currentDate < awardsUnlockDate
        ? `Awards voting opens on ${awardsUnlockDate}.`
        : hasPendingSeasonAwards
          ? 'Awards ballot is ready. Save winners to archive the season.'
          : 'Awards are archived once winners are saved.',
      status: timelineStatuses.awards,
    },
  ];

  const nextSeasonReady = seasonComplete && !hasPendingSeasonAwards && effectiveOffseasonStage === 'free_agency';
  const runStatus = simulationRunState?.status ?? null;

  const dateStepLabel = simulationRunState
    ? `${Math.min(simulationRunState.currentIndex, simulationRunState.queuedDates.length)} / ${simulationRunState.queuedDates.length}`
    : `${uniqueDates.indexOf(currentDate) + 1} / ${uniqueDates.length}`;

  const gamesLabel = simulationRunState
    ? `${simulationRunState.simulatedGameCount} total`
    : simulationProgress
      ? `${simulationProgress.completedGames}/${simulationProgress.totalGames || simulationProgress.completedGames}`
      : `${seasonProgress.completedGames}/${seasonProgress.totalGames}`;

  return (
    <section className="space-y-5">
      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile label="League Progress" value={`${Math.round(seasonProgress.progress)}%`} tone="gold" />
        <StatTile label="Current Day" value={cursorDate ? formatShortDate(cursorDate) : 'TBD'} />
        <StatTile
          label="Run Status"
          value={simulationRunState ? runStatus : 'Idle'}
          tone={runStatus === 'interrupted' || runStatus === 'error' ? 'plain' : 'gold'}
        />
      </div>

      <SeasonFlow
        steps={seasonTimeline}
        nextSeasonReady={nextSeasonReady}
        onResetSeason={onResetSeason}
        canReset={!controlsLocked}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_420px]">
        <SeasonCalendar
          monthLabel={monthLabel}
          focusedMonth={focusedMonth}
          calendarCells={calendarCells}
          gameCountsByDate={gameCountsByDate}
          milestonesByDate={milestonesByDate}
          activeDate={activeDate}
          cursorDate={cursorDate}
          currentDate={currentDate}
          isSimulating={isSimulating}
          isTarget={(date) => simulationRunState?.targetDate === date || (!simulationRunState && activeDate === date)}
          isQueued={(date) => queuedDateSet.has(date)}
          isRunCompleted={(date) => completedQueuedDates.has(date)}
          seasonProgress={seasonProgress}
          onShiftMonth={(delta) => setFocusedMonth((current) => shiftMonth(current, delta))}
          onSelectDate={onSelectDate}
        />

        <div className="flex flex-col gap-5">
          <RunBoard
            teams={teams}
            selectedTeamId={selectedTeamId}
            activeDate={activeDate}
            uniqueDateCount={uniqueDates.length}
            currentDate={currentDate}
            currentDateIndex={uniqueDates.indexOf(currentDate)}
            controlsLocked={controlsLocked}
            isSimulating={isSimulating}
            isResetting={seasonResetStatus.isResetting}
            regularSeasonComplete={regularSeasonComplete}
            seasonComplete={seasonComplete}
            onStart={onStartSimulation}
            onCancel={onCancelSimulation}
            onReset={onResetSeason}
            onSelectTeamId={onSelectTeamId}
            onSelectDate={onSelectDate}
            onTerminate={() => setTerminateModalOpen(true)}
          />

          <LiveRun
            run={simulationRunState}
            activeDate={activeDate}
            cursorDate={cursorDate}
            currentDate={currentDate}
            planProgress={planProgress}
            seasonProgress={seasonProgress}
            simulationProgress={simulationProgress}
            dateStepLabel={dateStepLabel}
            gamesLabel={gamesLabel}
            teams={teams}
            controlsLocked={controlsLocked}
            onStart={onStartSimulation}
            onOpenTrades={onOpenTrades}
            onOpenFreeAgency={onOpenFreeAgency}
          />

          <CommissionGuidance
            isResetting={seasonResetStatus.isResetting}
            resetPct={seasonResetStatus.progress}
            resetLabel={seasonResetStatus.label}
            isSaving={simulationSaveStatus.isSaving}
            savePct={simulationSaveStatus.progress}
            saveLabel={simulationSaveStatus.label}
          />

          <CommissionerNotes />
        </div>
      </div>

      {terminateModalOpen && (
        <TerminateUniverseModal
          seedInput={universeSeedInput}
          controlsLocked={controlsLocked}
          onSetSeed={onSetUniverseSeedInput}
          onClose={() => setTerminateModalOpen(false)}
          onPreview={onPreviewNewUniverse}
          onConfirm={() => {
            setTerminateModalOpen(false);
            onTerminateUniverse();
          }}
        />
      )}

      {newUniversePreview && (
        <NewUniversePreviewModal
          preview={newUniversePreview}
          onDismiss={() => setTerminateModalOpen(true)}
          isGenerating={isTerminatingUniverse}
          onConfirm={() => {
            setTerminateModalOpen(false);
            onTerminateUniverse();
          }}
        />
      )}
    </section>
  );
};

export { getTargetLabel, timelineTone };
