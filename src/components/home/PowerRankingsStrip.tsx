/**
 * The dashboard's POWER RANKINGS strip -- top five, always visible.
 *
 * ===========================================================================
 * WHY THIS IS A STANDING PANEL AND NOT A HEADLINE SLIDE
 * ===========================================================================
 *
 * It was tempting to put this in the newsroom carousel instead, and that was the first plan. Two
 * reasons it is not:
 *
 *   1. `HeadlinePanel` rotates every 7 seconds, so a ranking would be one slide among several and a
 *      manager has to CATCH it. Power rankings are a standing reference, not an event. A reference
 *      that rotates past is not a reference.
 *   2. The empty-dashboard complaint is about what is there when you ARRIVE. A slide you might miss
 *      does not answer that; a panel that is always in the same place does.
 *
 * The headline still carries a rankings story -- `headlineEngine` builds one, and it is the lead
 * slide on a pristine universe where nothing else has happened yet. This strip is the one that is
 * guaranteed to be there.
 *
 * Both read one memoised `buildPowerRankings` call, so they cannot disagree and the expensive
 * simulation runs once per (rosters, date), not twice.
 *
 * Top five rather than all thirty-two: this is a strip, not a second board. The full ranking is one
 * click away on the LEAGUE rail, and repeating all thirty-two here would push the panels that a
 * manager actually needs during a season off the bottom of the page.
 *
 * ===========================================================================
 * THE VALUATION IS GONE; THE MOVEMENT IS THE COLUMN NOW
 * ===========================================================================
 *
 * A row reads rank, crest, city, then an arrow -- green up, red down, white for unmoved -- measured
 * against the last board this manager saw. The 0-100 valuation that used to sit before the arrow is
 * dropped: it is a second reading of the club the rank already orders, and the movement is the thing
 * the order cannot tell you. The storage that remembers the previous board, and why rebuilding a past
 * `buildPowerRankings` is the wrong way to get it, are in `powerRankMovement.ts`.
 */

import React, { useEffect, useMemo } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { Team } from '../../types';
import type { PowerRankings } from '../../lib/analytics/powerRankings';
import { TeamLogo } from '../ui';
import { HomePanel } from './shared';
import { rankMovementLabel, resolveRankMovement, writeRankMovement } from './powerRankMovement';

const STRIP_SIZE = 5;

export interface PowerRankingsStripProps {
  rankings: PowerRankings | null;
  teamsById: Map<string, Team>;
  onOpenPowerRankings: () => void;
  onSelectTeamId: (teamId: string) => void;
}

export const PowerRankingsStrip: React.FC<PowerRankingsStripProps> = ({
  rankings,
  teamsById,
  onOpenPowerRankings,
  onSelectTeamId,
}) => {
  const resolved = useMemo(() => resolveRankMovement(rankings), [rankings]);

  useEffect(() => {
    if (resolved.next) writeRankMovement(resolved.next);
  }, [resolved]);

  /*
    RENDERS ITS OWN EMPTY STATE, and this is deliberate rather than defensive.

    The rankings come from a Monte Carlo over the remaining season, so on a universe with no games
    played they are still computable -- this is the whole reason the strip can fill the dashboard
    straight after a terminate, when the price ledger is empty and the Exchange has nothing to show.
    `null` therefore means "not computed", and the honest thing to say in that case is nothing at
    all: a panel reading "power rankings unavailable" on a freshly rebuilt league would be a worse
    lie than the empty dashboard it was added to fix.
  */
  if (!rankings || rankings.rows.length === 0) {
    return null;
  }

  const top = rankings.rows.slice(0, STRIP_SIZE);

  return (
    <HomePanel
      title="Power Rankings"
      aside={(
        <button
          type="button"
          onClick={onOpenPowerRankings}
          className="t-caption text-[var(--color-gold)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
        >
          Full board
        </button>
      )}
      bodyClassName="p-0"
    >
      <ul>
        {top.map((row) => {
          const team = teamsById.get(row.teamId);
          const places = resolved.movement.get(row.teamId) ?? 0;
          const MovementIcon = places > 0 ? ArrowUp : places < 0 ? ArrowDown : Minus;
          const movementClass = places > 0
            ? 'text-[var(--color-pos)]'
            : places < 0
              ? 'text-[var(--color-neg)]'
              : 'text-[var(--color-ink)]';
          return (
            <li key={row.teamId} className="border-b border-[var(--color-chrome-lo)]/40 last:border-0">
              <div className="flex items-center gap-3 px-4 py-2">
                <span className="t-stat w-6 shrink-0 text-right tabular-nums">{row.rank}</span>
                <button
                  type="button"
                  onClick={() => onSelectTeamId(row.teamId)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
                >
                  {team
                    ? <TeamLogo team={team} sizeClass="h-7 w-7 shrink-0" />
                    : <span className="h-7 w-7 shrink-0 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}
                  <span className="t-body min-w-0 truncate">{team?.city ?? row.teamId}</span>
                </button>
                <span
                  className={`inline-flex shrink-0 items-center justify-center ${movementClass}`}
                  role="img"
                  aria-label={rankMovementLabel(places)}
                >
                  <MovementIcon className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </HomePanel>
  );
};
