import React from 'react';
import { Check, Circle, Crown, FastForward, Trophy } from 'lucide-react';
import { Panel, RetroButton, SkewedTab } from './ui';

export type OffseasonChecklistStage = 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';

interface OffseasonHubProps {
  seasonYear: number;
  stage: OffseasonChecklistStage;
  championLabel: string;
  awardsComplete: boolean;
  lotteryComplete: boolean;
  draftComplete: boolean;
  /** The aging has run for this winter, so the wall of retirements has something to show. */
  retirementsApplied: boolean;
  onAwards: () => void;
  /**
   * Step past the awards WITHOUT the results dialog.
   *
   * Its own prop, separate from `onAwards`, because the two are different acts. `onAwards` shows
   * the season's results; this one is the advance. For every other step the checklist does both
   * with one button, and that is exactly why 'awards' was the one step that could strand a
   * manager: its advance lived inside a dialog that a page reload deletes, while its button was
   * disabled because the season was already archived. Having the advance here as well means the
   * checklist is never waiting on a component that might not be mounted.
   */
  onAcknowledgeAwards: () => void;
  onRetirements: () => void;
  /**
   * Step past the wall of retirements, to the draft lottery.
   *
   * Distinct from `onRetirements`, which AGES THE LEAGUE. The step has two acts now and they are
   * ordered: the first decides who is leaving, the second is the manager deciding they have read it.
   */
  onRetirementsContinue: () => void;
  onLottery: () => void;
  onDraft: () => void;
  onFreeAgency: () => void;
  onStartSeason: () => void;
  /**
   * Open the "skip the offseason" confirmation.
   *
   * A separate callback rather than a flag the hub owns, because the dialog is MODAL state and the
   * hub is a screen. Keeping the flag in `App` means a reload mid-dialog simply loses the dialog, which
   * is the correct outcome -- an interrupted skip should resume from the save, not from a remembered
   * intention to skip.
   */
  onRequestSkip: () => void;
  /** A skip is running; the controls that would race with it are disabled. */
  isSkipping: boolean;
}

const steps: Array<{ key: OffseasonChecklistStage; title: string; description: string }> = [
  { key: 'awards', title: 'Season Awards', description: 'Review the batting and pitching MVPs decided from the regular-season stats.' },
  { key: 'retirements', title: 'Player Retirements', description: 'Age the league, then see who played their last season.' },
  { key: 'draft_lottery', title: 'Draft Lottery', description: 'Lock the rookie draft order.' },
  { key: 'draft', title: 'Rookie Draft', description: 'Make picks manually or quick-sim the class.' },
  { key: 'free_agency', title: 'Free Agency', description: 'Open the market, use Shake Up, and finalize roster movement.' },
  { key: 'start_next_season', title: 'Start Next Season', description: 'Generate the new schedule and begin a fresh campaign.' },
];

export const OffseasonHub: React.FC<OffseasonHubProps> = ({
  seasonYear, stage, championLabel, awardsComplete, lotteryComplete, draftComplete, retirementsApplied,
  onAwards, onAcknowledgeAwards, onRetirements, onRetirementsContinue, onLottery, onDraft, onFreeAgency, onStartSeason,
  onRequestSkip, isSkipping,
}) => {
  const activeIndex = steps.findIndex((entry) => entry.key === stage);
  const activeStep = steps[activeIndex] ?? steps[0];

  const isComplete = (key: OffseasonChecklistStage, index: number): boolean =>
    key === 'awards' ? awardsComplete : key === 'draft_lottery' ? lotteryComplete : key === 'draft' ? draftComplete : index < activeIndex;

  const handlers: Record<OffseasonChecklistStage, () => void> = {
    awards: onAwards, retirements: onRetirements, draft_lottery: onLottery,
    draft: onDraft, free_agency: onFreeAgency, start_next_season: onStartSeason,
  };

  const activeComplete = isComplete(activeStep.key, activeIndex);
  const actionLabel = activeStep.key === 'start_next_season' ? 'Confirm Start' : 'Simulate Event';

  /*
   * RETIREMENTS IS A PLACE, NOT A TRANSITION.
   *
   * Every other step runs an event and hands you the next one. This one runs the aging, then STAYS,
   * so the wall of careers that ended is a thing you walk into rather than a count that flashes past
   * in a notice. Two buttons, in that order: run it, then read it.
   *
   * Which means the stage cannot advance until the manager says so -- hence `retirementsApplied`,
   * which is persisted rather than inferred, because "nobody retired" and "has not run yet" are the
   * same observation.
   */
  const retirementsAwaitReview = activeStep.key === 'retirements' && retirementsApplied;

  /*
   * THE AWARDS STEP IS ALWAYS RE-OPENABLE, AND ITS ADVANCE IS ALWAYS AVAILABLE.
   *
   * Every other step is "not done yet, press the button", so a complete one is correctly inert.
   * Awards is inverted: the archive is written the instant the season ends, so it is complete
   * before the manager has looked at it, and what is left to do is READ it and step past it. A
   * step that renders itself as finished with a disabled button is therefore not an honest
   * representation of the work left -- it is an exit with the handle removed.
   *
   * So the active awards step keeps a live tab (to read the results) and a live button (to move
   * on). Neither depends on the dialog being open, and the dialog being open is no longer the
   * only way out.
   */
  const activeIsAwards = activeStep.key === 'awards';
  const awardsAwaitingAcknowledgement = activeIsAwards && activeComplete;
  const canPressStep = (index: number): boolean => {
    const entry = steps[index];
    if (index > activeIndex) return false;
    if (isComplete(entry.key, index)) return entry.key === 'awards' && index === activeIndex;
    return true;
  };
  const activeButtonDisabled = activeComplete && !awardsAwaitingAcknowledgement;
  const activeButtonLabel = awardsAwaitingAcknowledgement
    ? 'Continue'
    : retirementsAwaitReview
      ? 'Continue to the Draft Lottery'
      : activeComplete
        ? 'Complete'
        : actionLabel;
  const activeButtonAction = awardsAwaitingAcknowledgement
    ? onAcknowledgeAwards
    : retirementsAwaitReview
      ? onRetirementsContinue
      : handlers[activeStep.key];

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <Panel className="overflow-hidden">
        <div className="flex items-start gap-4 p-5">
          <Trophy className="mt-1 h-8 w-8 shrink-0 text-[var(--color-gold)]" aria-hidden="true" />
          <div>
            <p className="t-label text-[var(--color-gold)]">Offseason Checklist</p>
            <h1 className="t-display mt-1">{seasonYear} Offseason</h1>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              World Series champion: <span className="text-[var(--color-ink)]">{championLabel}</span>.
              Complete each event in order, or quick-sim the active event.
            </p>
          </div>
        </div>
      </Panel>

      {/* Step rail. Six identical cards gave no sense of where you were in the
          sequence; a single rail shows the whole offseason at once and the
          active segment is unambiguous. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <ol className="flex min-w-max items-stretch gap-1">
          {steps.map((entry, index) => {
            const complete = isComplete(entry.key, index);
            const active = entry.key === stage;
            const locked = index > activeIndex;
            return (
              <li key={entry.key} className="flex">
                <SkewedTab
                  direction={index % 2 === 0 ? 'skew-r' : 'skew-l'}
                  variant={active ? 'active' : 'inactive'}
                  disabled={!canPressStep(index)}
                  onClick={() => canPressStep(index) && handlers[entry.key]()}
                  aria-current={active ? 'step' : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap ${
                    complete ? 'opacity-60' : locked ? 'opacity-35' : ''
                  }`}
                >
                  {complete
                    ? <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    : locked
                      ? <Circle className="h-2.5 w-2.5" aria-hidden="true" />
                      : <FastForward className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span className="t-caption text-[var(--color-ink-faint)]">{index + 1}</span>
                  {entry.title}
                </SkewedTab>
              </li>
            );
          })}
        </ol>
      </div>

      {/*
        SUPPRESSED WHILE THE WALL IS ON SCREEN.

        The wall above already carries its own "Continue to the Draft Lottery" button, and repeating
        the step's action twice on one screen is how a reader ends up unsure which of two identical
        buttons is the real one. So when the wall is up, the step panel says what the step IS and
        points at the wall rather than offering the same affordance again.
      */}
      {!retirementsAwaitReview && (
      <Panel variant={activeComplete ? 'default' : 'hero'} className={`overflow-hidden ${activeComplete ? '' : 'border-[var(--color-gold)]'}`}>
        <div className="chrome-bar flex items-center justify-between gap-3 px-4">
          <h2 className="t-h3">{activeStep.title}</h2>
          <span className="t-caption text-[var(--color-ink-faint)]">EVENT {activeIndex + 1} OF {steps.length}</span>
        </div>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="t-body text-[var(--color-ink-dim)]">{activeStep.description}</p>
          <RetroButton
            variant={activeComplete ? 'ghost' : 'primary'}
            disabled={activeButtonDisabled}
            onClick={activeButtonAction}
          >
            {activeButtonLabel}
            {!activeComplete && <FastForward className="h-4 w-4" aria-hidden="true" />}
          </RetroButton>
          {/* Reading the results is a separate act from stepping past them. The button above
              always advances; this is here so the results stay reachable afterwards, which
              matters because `reviewSeasonAwards` can now rebuild them on demand. */}
          {awardsAwaitingAcknowledgement && (
            <RetroButton variant="ghost" onClick={onAwards}>
              Read Results
            </RetroButton>
          )}
        </div>
      </Panel>
      )}

      {/* What the active event will change, and the way out of the whole thing. */}
      <Panel variant="sunken" className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <Crown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />
          <div>
            <p className="t-label text-[var(--color-ink-dim)]">Remaining</p>
            <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
              {steps.filter((entry, index) => !isComplete(entry.key, index)).length} of {steps.length} events outstanding
            </p>
          </div>
        </div>
        {/*
          SKIP, IN THE FOOTER RATHER THAN BESIDE THE STEP BUTTON.

          It asks first, so it is not a shortcut -- and putting it one click from the button that
          advances normally would make "skip" and "next step" the same gesture. It lives with the
          progress readout because that is what it acts on: the whole remaining sequence, not this step.
        */}
        <RetroButton variant="ghost" onClick={onRequestSkip} disabled={isSkipping}>
          <FastForward className="h-4 w-4" aria-hidden="true" />
          {isSkipping ? 'Skipping…' : 'Skip the Offseason'}
        </RetroButton>
      </Panel>
    </section>
  );
};
