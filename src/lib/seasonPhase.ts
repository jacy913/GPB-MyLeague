/**
 * Whether the league is in its postseason window.
 *
 * A pure function over the schedule, in `lib/` rather than in the dashboard, because three
 * consumers will want it and a component-local copy would be the second implementation. No state,
 * no lifecycle, no hook: this is derived from data every caller already holds, which is the cheapest
 * kind of gate to be right about.
 */

import { getGamePhase } from '../logic/playoffs';
import type { Game } from '../types';

/**
 * TRUE FROM THE FIRST SCHEDULED PLAYOFF GAME. Not from the first completed one.
 *
 * The front page should say October is coming while it is still September. A gate that waited for a
 * result would leave the dashboard in its regular-season shape on the morning of a game a manager
 * has been waiting six weeks for -- which is the one morning it most matters.
 *
 * FALSE ONCE THE POSTSEASON IS OVER. The new dashboard section carries a `Go to Bracket` button, and
 * a button that navigates to a bracket with no games left in it is worse than no section. That is
 * why this counts SCHEDULED games specifically:
 *
 *   - a completed playoff game must never hold the window open, or the autumn palette would follow
 *     a manager into the offseason for ever;
 *   - the last scheduled playoff game is the true end of the window, and when it is played the
 *     count falls to zero on its own.
 *
 * Measured on a real season (`tools/spikePlayoffState.ts`): opens on simulated day 179, closes on
 * day 201, and the whole postseason simulates in about 14 seconds.
 */
export const isPostseasonWindow = (games: readonly Game[]): boolean => {
  for (const game of games) {
    if (game.status !== 'scheduled') continue;
    if (getGamePhase(game) === 'playoffs') return true;
  }
  return false;
};

/**
 * How many playoff games are still to come, for a readout that wants the number.
 *
 * Same definition as the gate -- scheduled only -- so a panel and the palette can never disagree
 * about whether the postseason is live. Returns 0 rather than null for "none": there is no state in
 * which an unknown count is more useful than a zero.
 */
export const scheduledPlayoffGameCount = (games: readonly Game[]): number => {
  let count = 0;
  for (const game of games) {
    if (game.status !== 'scheduled') continue;
    if (getGamePhase(game) === 'playoffs') count += 1;
  }
  return count;
};