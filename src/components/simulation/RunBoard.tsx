import React from 'react';
import {
  AlertTriangle, ArrowLeftRight, BriefcaseBusiness, CalendarDays, Clock3, PauseCircle, Play,
  RotateCcw, ShieldAlert, SkipForward, TimerReset, Wand2,
} from 'lucide-react';
import type { SimulationTarget, Team } from '../../types';
import { Panel, RetroButton } from '../ui';
import {
  ProgressTrack, SimPanel, StatTile, formatLongDate, getTargetLabel,
  runStatusLabel, runStatusTone, toneEdge, toneText,
  type RunStatus, type TimelineStep,
} from './shared';

export interface SimulationRunState {
  status: 'running' | 'interrupted' | 'complete' | 'error' | 'cancelled';
  label: string;
  targetLabel: string;
  queuedDates: string[];
  currentIndex: number;
  startDate: string;
  currentDate: string;
  targetDate: string;
  simulatedGameCount: number;
  message?: string;
  interruptionKind?: 'trade' | 'free_agency';
  interruptionCount?: number;
}

const targetButton = (
  title: string,
  body: string,
  onClick: () => void,
  disabled: boolean,
  primary = false,
) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`border-l-[3px] px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      primary
        ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)] hover:bg-[var(--color-panel-2)]'
        : 'border-l-[var(--color-chrome-lo)] bg-[var(--color-sunken)] hover:border-l-[var(--color-gold)]'
    }`}
  >
    <span className="block t-stat-sm">{title}</span>
    <span className="mt-0.5 block t-caption text-[var(--color-ink-dim)]">{body}</span>
  </button>
);

export const RunBoard: React.FC<{
  teams: Team[];
  selectedTeamId: string;
  activeDate: string;
  uniqueDateCount: number;
  currentDate: string;
  currentDateIndex: number;
  controlsLocked: boolean;
  isSimulating: boolean;
  isResetting: boolean;
  regularSeasonComplete: boolean;
  seasonComplete: boolean;
  onStart: (target: SimulationTarget) => void;
  onCancel: () => void;
  onReset: () => void;
  onSelectTeamId: (teamId: string) => void;
  onSelectDate: (date: string) => void;
  onTerminate: () => void;
  onGeneratePlayers: () => void;
}> = ({
  teams, selectedTeamId, activeDate, uniqueDateCount, currentDate, currentDateIndex,
  controlsLocked, isSimulating, isResetting, regularSeasonComplete, seasonComplete,
  onStart, onCancel, onReset, onSelectTeamId, onSelectDate, onTerminate, onGeneratePlayers,
}) => {
  const selectClass =
    'w-full appearance-none border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 t-stat-sm text-[var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]';

  return (
    <SimPanel title="Run Target" aside={<ShieldAlert className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />}>
      <div className="grid gap-2 sm:grid-cols-2">
        {targetButton('Sim Day', 'Resolve the slate and advance one step.', () => onStart({ scope: 'day' }), controlsLocked)}
        {targetButton('Sim Week', 'Walk forward until the week closes.', () => onStart({ scope: 'week' }), controlsLocked)}
        {targetButton('Sim Month', 'A longer stretch, still interruptible.', () => onStart({ scope: 'month' }), controlsLocked)}
        {targetButton('Next Team Game', 'Stop at the next date involving the selected club.', () => onStart({ scope: 'next_game', teamId: selectedTeamId }), controlsLocked)}
        {targetButton('To Reg Finale', 'Carry the league through the regular season.', () => onStart({ scope: 'regular_season' }), controlsLocked || regularSeasonComplete)}
        {targetButton('Full Season', 'Run continuously. The market resolves itself.', () => onStart({ scope: 'season' }), controlsLocked || seasonComplete, true)}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <label className="flex flex-col gap-1">
          <span className="t-caption text-[var(--color-ink-faint)]">SIM TO SELECTED DATE</span>
          <input
            type="date"
            value={activeDate}
            onChange={(event) => onSelectDate(event.target.value)}
            className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 t-stat-sm text-[var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-caption text-[var(--color-ink-faint)]">SELECTED CLUB</span>
          <select value={selectedTeamId} onChange={(event) => onSelectTeamId(event.target.value)} className={selectClass}>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.id.toUpperCase()} - {team.city}</option>
            ))}
          </select>
        </label>
        <RetroButton
          variant="primary"
          onClick={() => onStart({ scope: 'to_date', targetDate: activeDate })}
          disabled={controlsLocked || !activeDate}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" /> Sim To Date
        </RetroButton>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <RetroButton variant="default" onClick={onCancel} disabled={!isSimulating || isResetting}>
          <PauseCircle className="h-4 w-4" aria-hidden="true" /> Stop Run
        </RetroButton>
        <RetroButton variant="default" onClick={onReset} disabled={controlsLocked}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset
        </RetroButton>
      </div>

      {/* Universe lifecycle, together.
          Generate Players and Terminate Universe are the same operation on the
          same seed -- buildNewUniverse runs generate, develop and fill, and
          neither stops at a bare pool -- so they belong side by side. They used
          to be two unrelated controls in two unrelated places, which is how a
          league ended up with teams, a schedule and no players and no obvious
          way back. */}
      <div className="mt-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-3">
        <p className="t-caption text-[var(--color-ink-faint)]">Universe</p>
        <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
          Both actions rebuild the player pool from the seed below and refill every roster.
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <RetroButton
            variant="default"
            onClick={onGeneratePlayers}
            disabled={controlsLocked}
          >
            <Wand2 className="h-4 w-4" aria-hidden="true" /> Generate Players
          </RetroButton>
          <RetroButton
            variant="danger"
            onClick={onTerminate}
            disabled={controlsLocked}
          >
            Terminate Universe
          </RetroButton>
        </div>
      </div>
    </SimPanel>
  );
};

export const LiveRun: React.FC<{
  run: SimulationRunState | null;
  activeDate: string;
  cursorDate: string;
  currentDate: string;
  planProgress: number;
  seasonProgress: number;
  simulationProgress: { completedGames: number; totalGames: number } | null;
  dateStepLabel: string;
  gamesLabel: string;
  teams: Team[];
  controlsLocked: boolean;
  onStart: (target: SimulationTarget) => void;
  onOpenTrades: () => void;
  onOpenFreeAgency: () => void;
}> = ({
  run, activeDate, cursorDate, currentDate, planProgress, seasonProgress,
  simulationProgress, dateStepLabel, gamesLabel, teams, controlsLocked,
  onStart, onOpenTrades, onOpenFreeAgency,
}) => {
  const status: RunStatus = run?.status ?? null;
  const tone = status ? runStatusTone[status] : 'muted';
  const halted = run?.status === 'interrupted';

  return (
    <SimPanel
      title={run ? run.label : 'Awaiting Command'}
      aside={<Clock3 className={`h-4 w-4 ${toneText[tone]}`} aria-hidden="true" />}
    >
      <Panel variant="sunken" className="p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="t-caption text-[var(--color-ink-faint)]">TARGET</p>
            <p className="t-h3 mt-1 truncate">
              {run ? run.targetLabel : getTargetLabel({ scope: 'to_date', targetDate: activeDate }, activeDate, teams)}
            </p>
          </div>
          <div className="text-right">
            <p className="t-caption text-[var(--color-ink-faint)]">CURSOR</p>
            <p className="t-stat">{cursorDate || 'TBD'}</p>
            <p className={`t-caption mt-0.5 ${toneText[tone]}`}>{status ? runStatusLabel[status] : 'Idle'}</p>
          </div>
        </div>

        <div className="mt-3">
          <ProgressTrack
            percent={run ? planProgress : seasonProgress.progress}
            label="Run progress"
            tone={status === 'running' ? 'info' : 'gold'}
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <StatTile label="Date Steps" value={dateStepLabel} />
          <StatTile label="Games Resolved" value={gamesLabel} />
        </div>

        {run?.message && (
          <div
            className="mt-3 border-l-[3px] bg-[var(--color-base-2)] px-3 py-2"
            style={{ borderLeftColor: toneEdge[tone] }}
            role="status"
          >
            <p className={`t-label ${toneText[tone]}`}>
              {halted ? 'Simulation Halted' : run.status}
            </p>
            <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{run.message}</p>
          </div>
        )}

        {halted && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {run.interruptionKind === 'trade' ? (
              <RetroButton variant="primary" onClick={onOpenTrades}>
                <ArrowLeftRight className="h-4 w-4" aria-hidden="true" /> View Trades
              </RetroButton>
            ) : (
              <RetroButton variant="primary" onClick={onOpenFreeAgency}>
                <BriefcaseBusiness className="h-4 w-4" aria-hidden="true" /> View Free Agency
              </RetroButton>
            )}
            <RetroButton
              variant="default"
              onClick={() => onStart({ scope: 'to_date', targetDate: activeDate })}
              disabled={controlsLocked || !activeDate}
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" /> Resume To Date
            </RetroButton>
          </div>
        )}
      </Panel>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <StatTile label="From" value={run?.startDate ? formatLongDate(run.startDate) : currentDate ? formatLongDate(currentDate) : 'TBD'} />
        <StatTile label="To" value={run?.targetDate ? formatLongDate(run.targetDate) : activeDate ? formatLongDate(activeDate) : 'TBD'} />
      </div>
    </SimPanel>
  );
};

export const SeasonFlow: React.FC<{
  steps: TimelineStep[];
  nextSeasonReady: boolean;
  onResetSeason: () => void;
  canReset: boolean;
}> = ({ steps, nextSeasonReady, onResetSeason, canReset }) => (
  <SimPanel
    title="League Flow"
    aside={
      <span className={`t-caption ${nextSeasonReady ? 'text-[var(--color-pos)]' : 'text-[var(--color-ink-faint)]'}`}>
        {nextSeasonReady ? 'Ready for next season reset' : 'Complete the active phase to progress'}
      </span>
    }
  >
    <ol className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      {steps.map((step) => {
        const tone = step.status === 'complete' ? 'pos' : step.status === 'active' ? 'gold' : 'muted';
        return (
          <li
            key={step.key}
            aria-current={step.status === 'active' ? 'step' : undefined}
            className="flex flex-col border-l-[3px] bg-[var(--color-sunken)] p-3"
            style={{ borderLeftColor: toneEdge[tone] }}
          >
            <p className={`t-caption ${toneText[tone]}`}>{step.status === 'complete' ? 'Complete' : step.status === 'active' ? 'Active' : 'Upcoming'}</p>
            <p className="t-stat-sm mt-1">{step.label}</p>
            <p className="t-caption mt-1 flex-1 text-[var(--color-ink-dim)]">{step.description}</p>
            {step.status === 'active' && step.onAction && step.actionLabel && (
              <RetroButton
                variant="primary"
                size="sm"
                onClick={step.onAction}
                disabled={step.actionDisabled}
                className="mt-2 self-start"
              >
                {step.actionLabel}
              </RetroButton>
            )}
          </li>
        );
      })}
    </ol>

    <div className="mt-3 flex flex-col gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="t-label text-[var(--color-ink-dim)]">Start Next Season</p>
        <p className="t-caption mt-0.5 text-[var(--color-ink-faint)]">
          Use Reset after Awards are saved and the offseason reaches Free Agency.
        </p>
      </div>
      <RetroButton variant="primary" onClick={onResetSeason} disabled={!canReset || !nextSeasonReady}>
        Start Next Season
      </RetroButton>
    </div>
  </SimPanel>
);

export const CommissionGuidance: React.FC<{ resetLabel?: string; saveLabel?: string; resetPct?: number; savePct?: number; isResetting?: boolean; isSaving?: boolean }> = ({
  resetLabel, saveLabel, resetPct, savePct, isResetting, isSaving,
}) => (
  <>
    {isResetting && (
      <Panel variant="sunken" className="p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="t-label text-[var(--color-warn)]">Season Reset In Progress</p>
          <span className="t-stat-sm">{Math.max(0, Math.min(100, Math.round(resetPct ?? 0)))}%</span>
        </div>
        <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{resetLabel || 'Resetting season state'}</p>
        <div className="mt-2"><ProgressTrack percent={resetPct ?? 0} label="Season reset progress" /></div>
      </Panel>
    )}
    {isSaving && (
      <Panel variant="sunken" className="p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="t-label text-[var(--color-info)]">Simulation Save In Progress</p>
          <span className="t-stat-sm">{Math.max(0, Math.min(100, Math.round(savePct ?? 0)))}%</span>
        </div>
        <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{saveLabel || 'Saving simulation state'}</p>
        <div className="mt-2"><ProgressTrack percent={savePct ?? 0} label="Save progress" tone="info" /></div>
      </Panel>
    )}
  </>
);

export const CommissionerNotes = () => (
  <SimPanel title="How The Sim Runs">
    <div className="flex flex-col gap-2">
      <p className="t-caption text-[var(--color-ink-dim)]">
        The sim advances in daily steps. That keeps the calendar visible, avoids opaque batch
        runs, and gives the office a clean place to stop for market activity.
      </p>
      <p className="t-caption text-[var(--color-ink-dim)]">
        The market runs automatically: free agents sign with their preferred offer and valid club
        trades complete without commissioner approval.
      </p>
      <p className="t-caption text-[var(--color-ink-dim)]">
        Reset is locked while a run is active. Stop the run first, then change course.
      </p>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <span className="flex items-center gap-1.5 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-1 t-caption text-[var(--color-ink-dim)]">
        <Play className="h-3 w-3" aria-hidden="true" /> Day-stepped
      </span>
      <span className="flex items-center gap-1.5 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-1 t-caption text-[var(--color-ink-dim)]">
        <TimerReset className="h-3 w-3" aria-hidden="true" /> Interruptible
      </span>
    </div>
  </SimPanel>
);
