import React from 'react';
import { FastForward, TriangleAlert } from 'lucide-react';
import type { OffseasonStage } from '../logic/offseasonSkip';
import { SKIP_PLAN, skipTargetStage } from '../logic/offseasonSkip';
import { Modal } from './ui/Modal';
import { RetroButton } from './ui';

/**
 * "ARE YOU SURE YOU WANT TO SKIP THE OFFSEASON?"
 *
 * ============================================================================
 * WHY THIS IS A DIALOG AND NOT A BUTTON
 * ============================================================================
 *
 * The user asked for the offseason to matter more, and for it to stay skippable. Those pull against
 * each other, and the resolution is that skipping has to be a DECISION rather than a reflex -- so it
 * asks first, and it says precisely what will be done on the manager's behalf.
 *
 * A generic "Are you sure?" would not do that. The point of this dialog is not the confirmation, it
 * is the ITEMISATION: which steps are about to happen automatically, what the picks will be, and
 * which steps will be skipped entirely because they already happened. A manager who has not read the
 * retirements is about to lose the chance to read them, and that has to be visible here rather than
 * discovered afterwards.
 *
 * So the consequences are listed, and the consequences that are not fully reversible -- the draft
 * picks being auto-selected -- are called out separately from the mechanical ones.
 */

/** The stages the plan can act on, in the order they run. */
const PLAN_LABELS: Record<OffseasonStage, string> = {
  idle: 'Nothing to do',
  awards: 'Archive the season awards',
  retirements: 'Age the league and resolve retirements',
  draft_lottery: 'Run the draft lottery',
  draft: 'Draft the class automatically',
  free_agency: 'Finalise free agency',
  start_next_season: 'Start the next season',
};

interface SkipOffseasonDialogProps {
  isOpen: boolean;
  /** Where the offseason is now. */
  currentStage: OffseasonStage;
  /** Offseason-wide steps already done and will not be repeated. */
  awardsComplete: boolean;
  retirementsApplied: boolean;
  /** Steps with nothing left to do -- the lottery or draft already ran. */
  lotteryComplete: boolean;
  draftComplete: boolean;
  isRunning: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const SkipOffseasonDialog: React.FC<SkipOffseasonDialogProps> = ({
  isOpen,
  currentStage,
  awardsComplete,
  retirementsApplied,
  lotteryComplete,
  draftComplete,
  isRunning,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const steps = SKIP_PLAN.filter((stage) => stage !== 'start_next_season').map((stage) => {
    const done = stage === 'awards'
      ? awardsComplete
      : stage === 'retirements'
        ? retirementsApplied
        : stage === 'draft_lottery'
          ? lotteryComplete
          : stage === 'draft'
            ? draftComplete
            : false;
    return { stage, label: PLAN_LABELS[stage], done };
  });

  const target = skipTargetStage(currentStage);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Skip the Offseason?"
      widthClass="max-w-xl"
      barRight={(
        <span className="t-caption text-[var(--color-ink-faint)]">
          {isRunning ? 'RUNNING' : 'NOTHING HAS RUN YET'}
        </span>
      )}
    >
      <div className="space-y-4">
        <p className="t-body text-[var(--color-ink-dim)]">
          This runs the rest of the winter for you, in order, without stopping. The steps that have
          already happened are listed for context and will not be repeated.
        </p>

        {/*
          THE DRAFT IS CALLED OUT SEPARATELY, AND THAT IS THE POINT OF THIS DIALOG.

          Everything else here is mechanical -- aging a roster, drawing an order, filling vacant
          slots. Those are decisions a commissioner delegates without thinking. Choosing a prospect is
          not, so it is not buried in the list with the rest.
        */}
        {!draftComplete && (
          <div className="border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2">
            <p className="t-label flex items-center gap-2 text-[var(--color-warn)]">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              YOUR DRAFT PICKS WILL BE AUTO-SELECTED
            </p>
            <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
              Each club takes the highest-ranked prospect still available. You will not get to reach
              for a specific player.
            </p>
          </div>
        )}

        {!retirementsApplied && (
          <div className="border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2">
            <p className="t-label flex items-center gap-2 text-[var(--color-warn)]">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              YOU WILL NOT SEE THE RETIREMENTS
            </p>
            <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
              The wall of careers that ended stays available to review afterwards, but skipping now
              means it does not stop you on the way past.
            </p>
          </div>
        )}

        <ul className="space-y-1">
          {steps.map((step) => (
            <li key={step.stage} className="flex items-center justify-between gap-3">
              <span className="t-caption text-[var(--color-ink-dim)]">{step.label}</span>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {step.done ? 'ALREADY DONE' : 'WILL RUN'}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-3">
            <span className="t-caption text-[var(--color-ink-dim)]">{PLAN_LABELS.start_next_season}</span>
            <span className="t-caption text-[var(--color-ink-faint)]">WILL RUN</span>
          </li>
        </ul>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <RetroButton variant="ghost" onClick={onCancel} disabled={isRunning}>
            Cancel
          </RetroButton>
          <RetroButton variant="primary" onClick={onConfirm} disabled={isRunning}>
            <FastForward className="h-4 w-4" aria-hidden="true" />
            {isRunning ? 'Skipping…' : 'Skip to the New Season'}
          </RetroButton>
        </div>

        {/*
          WHERE IT WILL LAND, STATED BEFORE IT HAPPENS.

          Not reassurance -- an exit. If the run stops partway through, this tells a reloading manager
          exactly which step the winter reached, so the way back in is obvious rather than a guess.
        */}
        <p className="t-caption text-[var(--color-ink-faint)]">
          Starting from {PLAN_LABELS[currentStage]}, this runs through to{' '}
          {target ? PLAN_LABELS[target] : 'the start of the next season'}. You can stop and finish the
          rest by hand at any point afterwards.
        </p>
      </div>
    </Modal>
  );
};