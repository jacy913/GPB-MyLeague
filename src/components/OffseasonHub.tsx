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
  onLottery: () => void;
  onDraft: () => void;
  onFreeAgency: () => void;
  onStartSeason: () => void;
}

const steps: Array<{ key: OffseasonChecklistStage; title: string; description: string }> = [
  { key: 'awards', title: 'Season Awards', description: 'Select Batting MVP, Pitching MVP, and World Series MVP.' },
  { key: 'retirements', title: 'Player Retirements', description: 'Age the league and announce retiring veterans.' },
  { key: 'draft_lottery', title: 'Draft Lottery', description: 'Lock the rookie draft order.' },
  { key: 'draft', title: 'Rookie Draft', description: 'Make picks manually or quick-sim the class.' },
  { key: 'free_agency', title: 'Free Agency', description: 'Open the market, use Shake Up, and finalize roster movement.' },
  { key: 'start_next_season', title: 'Start Next Season', description: 'Generate the new schedule and begin a fresh campaign.' },
];

export const OffseasonHub: React.FC<OffseasonHubProps> = ({
  seasonYear, stage, championLabel, awardsComplete, lotteryComplete, draftComplete,
  onAwards, onAcknowledgeAwards, onRetirements, onLottery, onDraft, onFreeAgency, onStartSeason,
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
  const activeButtonLabel = awardsAwaitingAcknowledgement ? 'Continue' : activeComplete ? 'Complete' : actionLabel;
  const activeButtonAction = awardsAwaitingAcknowledgement ? onAcknowledgeAwards : handlers[activeStep.key];

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

      {/* What the active event will change. A checklist that only says "do the
          next thing" leaves a new user with nothing to orient by. */}
      <Panel variant="sunken" className="flex items-start gap-3 p-4">
        <Crown className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />
        <div>
          <p className="t-label text-[var(--color-ink-dim)]">Remaining</p>
          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
            {steps.filter((entry, index) => !isComplete(entry.key, index)).length} of {steps.length} events outstanding
          </p>
        </div>
      </Panel>
    </section>
  );
};
