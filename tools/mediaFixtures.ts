/**
 * Two helpers for building `Record<MediaId, ...>` in the diagnostic tools.
 *
 * WHY THIS EXISTS
 *
 * Widening `MediaId` from three outlets to eight broke twenty-eight type errors across eleven
 * tools, and every one of them was the same shape: a hand-written literal with exactly three
 * keys. Test fixtures where every outlet gets the same number, and accumulators where every
 * outlet gets the same zero.
 *
 * Adding five keys to each by hand would have made all eleven stale again the moment a ninth
 * forecaster arrives, which is the same failure the widening just exposed. These two helpers
 * derive from `MEDIA_PROFILES` instead, so a tool cannot forget an outlet -- and if it does, it
 * gets the same neutral value the fixture would have given anyway.
 *
 * Run: imported by the tools; nothing to execute.
 */

import { MEDIA_PROFILES, type MediaId } from '../src/data/media';

/**
 * A record giving EVERY outlet the same value.
 *
 * For fixtures that deliberately treat all forecasters identically -- "every outlet sees the
 * same strength", which is what most of the vig and shape checks are actually testing. The
 * point of those checks is the price construction, not the outlet, so uniform is correct rather
 * than a placeholder.
 */
export const uniformByMedia = <T>(value: T): Record<MediaId, T> =>
  Object.fromEntries(MEDIA_PROFILES.map((profile) => [profile.id, value])) as Record<MediaId, T>;

/**
 * A record built fresh per outlet.
 *
 * For accumulators, where each outlet needs its own mutable cell. `Object.fromEntries` over
 * `map` is used rather than a shared literal precisely because a shared object reference would
 * silently accumulate every outlet's data into one bin.
 */
export const emptyByMedia = <T>(make: () => T): Record<MediaId, T> =>
  Object.fromEntries(MEDIA_PROFILES.map((profile) => [profile.id, make()])) as Record<MediaId, T>;

/**
 * A record of per-outlet MUTABLE collections.
 *
 * `emptyByMedia` is not enough where each cell needs to push into an array, because the factory
 * runs once per outlet and must therefore return a NEW collection each time -- which it does,
 * but only because `make` is called per profile. This exists to make that explicit at the call
 * site, because getting it wrong produces a check that silently counts one outlet eight times.
 */
export const listByMedia = <T>(): Record<MediaId, T[]> =>
  Object.fromEntries(MEDIA_PROFILES.map((profile) => [profile.id, [] as T[]])) as Record<MediaId, T[]>;