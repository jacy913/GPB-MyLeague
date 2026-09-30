import type { Game } from '../types';
import { getDefaultSeasonStartDate } from '../logic/simulation';

/**
 * Which season a view should be reasoning about.
 *
 * Promoted out of App.tsx so it can be shared rather than reimplemented at each
 * call site. The rule is the year of the current date, falling back to the
 * first scheduled game and then to the calendar year, so a fresh universe with
 * no date set still resolves to something usable rather than to NaN.
 */
export const resolveSeasonYear = (
  currentDate: string | null | undefined,
  seasonGames: Game[] = [],
): number => {
  const sourceDate = currentDate || seasonGames[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
  const year = Number(sourceDate?.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
};
