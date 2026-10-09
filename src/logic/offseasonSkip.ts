/**
 * Skipping the offseason.
 *
 * ============================================================================
 * WHY THIS IS A PLAN AND NOT A CHAIN OF HANDLERS
 * ============================================================================
 *
 * Skipping means running every remaining step in order: age the league, draw the lottery, draft the
 * class, finalise free agency, start next season. Written as that, every step is a React handler in
 * `App.tsx` that mutates state, and "run the rest" becomes a sequence of them fired in a row.
 *
 * That has a specific failure. The steps advance a persisted `stage`, and each one reads the stage to
 * decide whether it is allowed to run. Fire them asynchronously and the second reads the stage the
 * first has not written yet, refuses, and the run stops halfway with the manager looking at a screen
 * that claims an offseason is still in progress.
 *
 * So the plan is data: an ordered list of stages. The runner walks it, and because each step's stage
 * write is a separate persisted transition, a run interrupted by a reload RESUMES at the stage the
 * save records rather than restarting or stalling. That is the same invariant the softlock fix rests
 * on -- a gate must be satisfiable from persisted state alone -- applied to the run rather than the
 * screen.
 */

export type OffseasonStage =
  | 'idle'
  | 'awards'
  | 'retirements'
  | 'draft_lottery'
  | 'draft'
  | 'free_agency'
  | 'start_next_season';

/** The stages, in the order the offseason actually runs them. */
export const OFFSEASON_STAGE_ORDER: OffseasonStage[] = [
  'awards',
  'retirements',
  'draft_lottery',
  'draft',
  'free_agency',
  'start_next_season',
];

/**
 * WHAT "SKIP" RUNS.
 *
 * Every stage, in order, including the ones a given manager may already have done. The runner skips
 * completed work at execution time rather than being handed a pre-filtered list, because the list
 * would be computed from state the run then changes -- a skip started a moment before a stage
 * completes would plan against a stale view of it.
 */
export const SKIP_PLAN: OffseasonStage[] = OFFSEASON_STAGE_ORDER;

/** The stage a skip run finishes on. */
export const SKIP_TARGET_STAGE = 'start_next_season';

/**
 * WHERE A SKIP FROM `currentStage` LANDS.
 *
 * The stage after the current one, or the final stage when already there. Used by the dialog to tell
 * a manager where they are going before they commit -- and to make the exit explicit, so that a run
 * interrupted partway can be recognised on the next load.
 */
export const skipTargetStage = (currentStage: OffseasonStage): OffseasonStage | null => {
  const index = OFFSEASON_STAGE_ORDER.indexOf(currentStage);
  if (index < 0) return 'start_next_season';
  return OFFSEASON_STAGE_ORDER[Math.min(index + 1, OFFSEASON_STAGE_ORDER.length - 1)];
};

/**
 * THE STAGES THAT REMAIN, GIVEN WHAT IS ALREADY DONE.
 *
 * Pure, and therefore testable without a running app: this is the decision the dialog shows and the
 * runner follows, and it is the one thing about skipping that is worth being certain of.
 */
export const remainingSkipStages = (
  currentStage: OffseasonStage,
  isComplete: (stage: OffseasonStage) => boolean,
): OffseasonStage[] => {
  const start = Math.max(OFFSEASON_STAGE_ORDER.indexOf(currentStage), 0);
  return OFFSEASON_STAGE_ORDER.slice(start).filter((stage) => !isComplete(stage));
};