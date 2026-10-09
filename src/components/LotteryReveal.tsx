import React from 'react';
import { Shuffle } from 'lucide-react';
import { DRAFT_ROUNDS, type DraftClassState } from '../logic/draftLogic';
import type { Team } from '../types';
import { Panel, TeamLogo } from './ui';

/**
 * THE LOTTERY, AS A REVEAL.
 *
 * ============================================================================
 * WHY THIS IS ABOVE THE TABLE AND NOT INSTEAD OF IT
 * ============================================================================
 *
 * A 32-club draft order is genuinely dense: 32 rows across every round, and the lottery only
 * reshuffles the top of the first. That table is real information and a commissioner tracking a
 * rebuild needs it. Replacing it with fourteen big crests would be a downgrade dressed as a
 * redesign.
 *
 * So this is the summary and the table stays as the reference. The lottery window -- the fourteen
 * picks the draw actually moved -- is what a manager is waiting to see, and it is the one thing on
 * this screen that is a result rather than a schedule. Everything below it is bookkeeping.
 *
 * ============================================================================
 * WHY THE ORDER IS THE DRAW, NOT THE SORT
 * ============================================================================
 *
 * The cards are listed in draft order, 1 through 14, because the entire point of a lottery is that
 * position is luck. Sorting by club name or by strength would flatten the one thing being revealed
 * into an alphabetical index and lose the result entirely. So the first card is the club that won
 * the first pick, and it reads as the winner because it is first.
 *
 * The window is read off the SAME `draftOrder` the draft itself uses. Deriving it here separately
 * would be a second implementation of "which picks did the lottery move", and the two would drift
 * the moment the draw rules changed.
 */

/** The lottery reshuffles the top of the first round. This is how far. */
const LOTTERY_WINDOW = 14;

interface LotteryRevealProps {
  draftClass: DraftClassState | null;
  teamsById: Map<string, Team>;
  seasonYear: number;
}

export const LotteryReveal: React.FC<LotteryRevealProps> = ({ draftClass, teamsById, seasonYear }) => {
  if (!draftClass || draftClass.draftOrder.length === 0) {
    return (
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <Shuffle className="h-9 w-9 text-[var(--color-gold)]" aria-hidden="true" />
          <p className="t-h2 text-[var(--color-ink)]">The {seasonYear} Draft Order Is Not Drawn</p>
          <p className="t-body max-w-lg text-[var(--color-ink-dim)]">
            Fourteen envelopes, fourteen clubs, and one order that nobody earned. Run the lottery and
            the first round lands here -- crest by crest, worst luck first.
          </p>
        </div>
      </Panel>
    );
  }

  const window = draftClass.draftOrder
    .slice(0, LOTTERY_WINDOW)
    .map((teamId, index) => ({ teamId, pick: index + 1, team: teamsById.get(teamId) ?? null }));

  return (
    <section className="space-y-3">
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div>
            <p className="t-label text-[var(--color-gold)]">{seasonYear} Draft Lottery</p>
            <h2 className="t-display mt-1">The Draw</h2>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              {LOTTERY_WINDOW} clubs in the lottery window. This order decides the first
              {' '}{DRAFT_ROUNDS > 1 ? 'round' : 'pass'} of the {seasonYear} draft and nothing after it.
            </p>
          </div>
        </div>
      </Panel>

      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {window.map(({ teamId, pick, team }) => (
          <li key={teamId}>
            <Panel
              variant={pick === 1 ? 'hero' : 'default'}
              className={`h-full overflow-hidden ${pick === 1 ? 'border-[var(--color-gold)]' : ''}`}
            >
              <div className="flex flex-col items-center gap-2 p-3 text-center">
                {/* Pick 1 is the result everyone came for, so it gets the oversized crest and the
                    display numeral. The other thirteen are results too, just smaller ones -- so they
                    scale down rather than disappearing. */}
                <p
                  className={`${pick === 1 ? 't-display' : 't-h2'} leading-none text-[var(--color-ink-faint)]`}
                >
                  {pick}
                </p>
                {team
                  ? <TeamLogo team={team} sizeClass={pick === 1 ? 'h-20 w-20' : 'h-12 w-12'} />
                  : <div
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-[var(--color-ink-faint)] text-tiny text-[var(--color-ink-faint)]"
                      aria-hidden="true"
                    >
                      ?
                    </div>}
                <p className="t-label leading-tight text-[var(--color-ink)]">
                  {team ? `${team.city} ${team.name}` : teamId.toUpperCase()}
                </p>
                {pick === 1 && (
                  <p className="t-caption text-[var(--color-gold)]">FIRST PICK</p>
                )}
              </div>
            </Panel>
          </li>
        ))}
      </ol>
    </section>
  );
};