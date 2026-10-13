/**
 * THE GAME-TIME THERMOSTAT -- one temperature per played game, and nothing else.
 *
 * WHAT THIS IS
 *
 * Every game played in this league carries exactly one temperature, derived from the park it is
 * played in and the month it is played during. A manager can read it off the game screen, and a
 * future ranking can bucket games by it ("the club with the most wins in cold weather, 61F and
 * below") without storing a single number -- it is a pure function of the inputs the game already
 * has.
 *
 * THE BOUNDARY IT RESPECTS, AND WHY THE BOUNDARY IS THE POINT
 *
 * `parkProfile.ts` is emphatic on one point: the monthly temperature curve (`climateMonthC`) is a
 * DISPLAY of a plausible season, and it must never be read back into the physics, which uses the
 * annual mean alone (`airDensityRatio`). This module is exactly the sanctioned reader. It takes the
 * monthly curve and turns it into a game-time value for the screen -- it does not touch a park
 * factor, an outcome weight, or anything the engine consumes. The temperature MEANS nothing to the
 * simulation, and shipping it that way is the whole design, not a limitation.
 *
 * WHY IT IS DETERMINISTIC, SO THE RANKING CAN BE SURE
 *
 * Nothing here calls `Math.random`. Jitter is seeded from the game's own id, which is assigned at
 * schedule creation and never changes, so recomputing a game's temperature today, next week, or
 * after a season archive round-trip produces the identical number. A ranking bucketed on these
 * temperatures therefore reproduces itself on every run. A stored field would be one more copy of a
 * value that can disagree with its own source; there is no stored field.
 *
 * THE TWO INPUTS AND THE JITTER RANGE, WHICH IS A CHOICE LIKE EVERY TEMPERATURE HERE
 *
 *   base  = the park's monthly mean for the game's month (`climateMonthC` index), in Celsius.
 *   jitter = a value in [-GAME_TEMPERATURE_JITTER_C, +GAME_TEMPERATURE_JITTER_C] seeded by the
 *            game id, so two games in the same park and month are not twins.
 *
 * `GAME_TEMPERATURE_JITTER_C` is 3 -- nine Fahrenheit degrees of swing around the norm, which is a
 * plausible real-world day-to-day spread. It sits in the same class as `CLIMATE_C` and
 * `CLIMATE_MONTH_OFFSET_C`: a number somebody chose, stated as such, and editable in one place.
 *
 * MONTHS OUTSIDE THE SEASON CLAMP, PER THE SHAPE OF THIS LEAGUE
 *
 * The curve covers April through October and nothing else. A game before April or after October
 * (playoffs running into November) clamps to the nearest season month, so a late-October park is
 * October's park and an early-November one is too.
 */

import { CLIMATE_MONTHS, climateMonthC, parkProfile, toF } from './analytics/parkProfile';

/** The first month of `CLIMATE_MONTHS` in the calendar. April. */
const SEASON_START_MONTH = 4;

/**
 * How far a single game's temperature may swing around its park's monthly norm, Celsius.
 *
 * A choice, not a measurement -- real game-time temperatures vary more than this and less, and no
 * measurement in this repo could settle the number. +/-3C (about 9F) is a believable day-to-day
 * spread and small enough that the league's monthly picture still reads on it.
 */
export const GAME_TEMPERATURE_JITTER_C = 3;

/**
 * FNV-1a 32-bit string hash, used only to seed the jitter.
 *
 * Any stable integer hash would do; this one is written out rather than imported so the seed
 * cannot silently change its distribution when a dependency does.
 */
const hashString = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * The index into `CLIMATE_MONTHS` for a game date, clamped at the season's ends.
 *
 * April (4) is index 0 and October (10) is the last index; anything outside that span clamps to
 * the nearest season month rather than indexing out of range. A malformed date falls back to April
 * rather than producing NaN.
 */
const monthIndexOf = (date: string): number => {
  const month = Number(date.slice(5, 7));
  if (!Number.isFinite(month)) {
    return 0;
  }
  const index = month - SEASON_START_MONTH;
  return Math.max(0, Math.min(CLIMATE_MONTHS.length - 1, index));
};

/**
 * The game-time temperature in Celsius, to one decimal place.
 *
 * `null` when the home club has no park profile -- custom-league clubs play with no park
 * environment at all (see the ParkPanel's missing-park copy), and a thermostat for a park that does
 * not exist would be inventing a number for them. Not rounded to an integer here: the ranking's
 * temperature cutoffs may want a degree of resolution, and the Fahrenheit side does its own
 * rounding for the screen.
 */
export const gameTemperatureC = (homeTeamId: string, date: string, gameId: string): number | null => {
  const profile = parkProfile(homeTeamId);
  if (!profile) {
    return null;
  }

  const baseC = climateMonthC(profile)[monthIndexOf(date)];
  const jitterUnit = (hashString(gameId) % 10001) / 10000; // [0, 1]
  const jitterC = (jitterUnit * 2 - 1) * GAME_TEMPERATURE_JITTER_C; // [-3, +3]

  return Math.round((baseC + jitterC) * 10) / 10;
};

/**
 * The game-time temperature in Fahrenheit, rounded to the whole degree the screen shows.
 *
 * Derived from `gameTemperatureC` and nothing else, so the archive and the screen cannot disagree
 * about what a game's temperature was.
 */
export const gameTemperatureF = (homeTeamId: string, date: string, gameId: string): number | null => {
  const celsius = gameTemperatureC(homeTeamId, date, gameId);
  return celsius === null ? null : Math.round(toF(celsius));
};

/**
 * The temperature as it is printed, from an already-computed Fahrenheit value: "73F".
 *
 * The field thermometer reads a game's temperature as a NUMBER, because it needs it to place its
 * marker; this is how that same number becomes the characters on the screen. Both the meter and the
 * sentence go through it, so the reading on the thermometer and the reading in the box score cannot
 * drift apart.
 */
export const formatTemperatureF = (valueF: number): string => `${valueF}\u00B0F`;

/** The temperature as it is computed and printed in one call. */
export const formatGameTemperature = (homeTeamId: string, date: string, gameId: string): string | null => {
  const fahrenheit = gameTemperatureF(homeTeamId, date, gameId);
  return fahrenheit === null ? null : `${fahrenheit}\u00B0F`;
};