import React, { useEffect } from 'react';
import { CalendarCheck, ChevronRight, CircleCheck, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { RetroButton, StatValue } from '../ui';

/**
 * The completion panel.
 *
 * A run of dates finishes silently: the floating progress panel goes away, the
 * league has moved, and nothing says so. That is the one moment in a season
 * where the manager most wants a receipt -- how far did it go, how much actually
 * happened, and did anyone sign.
 *
 * It arrives from the right, on the same axis as the betting slip, so the two
 * share a direction and a vocabulary. Two panels from opposite sides would
 * have made the player learn two gestures to dismiss something.
 *
 * Deliberately no countdown and no "are you sure". The run is already done; a
 * timer on a finished thing is theatre. It holds until it is dismissed, because
 * the numbers on it are the reason to look at it.
 */

export interface SimReportView {
  days: number;
  targetDate: string;
  gamesPlayed: number;
  signings: number;
  signingRounds: number;
  label: string;
}

/** "1 day" is the only irregular case; everything else is plain plural. */
const DAY_WORD: Record<number, string> = { 1: 'day' };

export const SimCompletePanel: React.FC<{
  report: SimReportView | null;
  onDismiss: () => void;
}> = ({ report, onDismiss }) => {
  /*
   * Escape dismisses, matching the betting slip.
   *
   * The slip taught the key already; leaving it off here would mean the same
   * gesture works on one panel from the right and not the other. Bound only
   * while a report is on screen so the handler never sits on the document
   * capturing keys that belong to whatever the manager is actually doing.
   */
  useEffect(() => {
    if (!report) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss, report]);

  return (
    <AnimatePresence>
      {report && (
      <motion.div
        key="sim-complete"
        role="status"
        aria-live="polite"
        className="fixed right-0 top-0 z-[69] flex h-full w-full max-w-[380px] flex-col border-l-4 border-l-[var(--color-gold)] bg-[var(--color-base-2)] shadow-[-8px_0_24px_rgba(0,0,0,0.6)]"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
      >
        <div className="chrome-bar flex shrink-0 items-center gap-2">
          <CircleCheck className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-h3">Simulation Complete</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/*
            The headline is the day count, because that is the one number that
            answers "did my run actually run". Games and signings sit below it as
            supporting figures rather than competing with it.
          */}
          <div className="border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-4 py-3">
            <p className="t-caption text-[var(--color-ink-faint)]">{report.label}</p>
            {/*
              The number and its unit are separate elements with a real gap
              rather than one string. At 30px in the display face a single space
              beside a narrow "1" is easy to lose, and "1day" is the kind of
              thing that gets screenshotted as a bug. A flex gap cannot collapse.
            */}
            <p className="mt-1 flex items-baseline gap-2 text-3xl leading-none font-bold text-[var(--color-gold-hi)]">
              <span className="tabular-nums">{report.days}</span>
              <span className="text-2xl text-[var(--color-ink-dim)]">
                {DAY_WORD[report.days] ?? 'days'}
              </span>
            </p>
            <p className="t-caption mt-1.5 text-[var(--color-ink-dim)]">
              simulated and events completed through {report.targetDate}
            </p>
          </div>

          <dl className="mt-4 grid gap-2">
            <div className="flex items-center justify-between border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
              <dt className="t-caption flex items-center gap-2 text-[var(--color-ink-faint)]">
                <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Games played
              </dt>
              <dd>
                <StatValue size="sm">{report.gamesPlayed}</StatValue>
              </dd>
            </div>

            {/*
              The market line is only shown when something signed. A run that
              found no upgrades is the normal case most of the season, and a
              permanent "0 signings" row on every single-day sim trains a manager
              to stop reading the panel at all.
            */}
            {report.signings > 0 && (
              <div className="flex items-center justify-between border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
                <dt className="t-caption flex items-center gap-2 text-[var(--color-ink-faint)]">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  Free-agent signings
                </dt>
                <dd>
                  <StatValue size="sm" variant="accent">{report.signings}</StatValue>
                </dd>
              </div>
            )}
          </dl>

          <p className="t-caption mt-4 text-[var(--color-ink-faint)]">
            The free-agent market was refreshed before this run.
            {report.signings > 0
              ? ` ${report.signings} upgrade${report.signings === 1 ? '' : 's'} went through over ${report.signingRounds} round${report.signingRounds === 1 ? '' : 's'}.`
              : ' No upgrades found this time.'}
          </p>
        </div>

        <div className="shrink-0 border-t border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-4">
          <RetroButton variant="primary" className="w-full justify-between" onClick={onDismiss}>
            Back to dashboard
            <ChevronRight depth={8} height={8} />
          </RetroButton>
        </div>
      </motion.div>
    )}
    </AnimatePresence>
  );
};