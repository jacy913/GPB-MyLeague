/**
 * Park Phase 2 -- the derived physical profile.
 *
 * WHAT THIS MODULE IS BOUNDED BY, AND WHY THAT BOUNDARY IS THE POINT
 *
 * Phase 2 derives what can be derived WITHOUT CHOOSING A COEFFICIENT. That is the whole
 * discipline of this file, and it is what separates it from Phase 3.
 *
 *   Here: geometry and air density.
 *     - The five wall distances, two of them interpolated. Arithmetic.
 *     - Mean wall distance, porch asymmetry, centre excess, wall area. Arithmetic.
 *     - Air density ratio, from the US Standard Atmosphere barometric formula and the
 *       ideal gas law. PHYSICS, with a stated reference condition.
 *
 *   NOT here: HR factor, run factor, FB factor, GB factor, pitcher fatigue, home-field
 *     advantage.
 *
 * Every one of those needs a number somebody chose -- how much does a 6-foot wall add, how
 * much does a foot of altitude cost, how much does long grass suppress a ground ball. Those
 * coefficients are Phase 3's job and they are validated against the ten archetypes in
 * `GPBBook.tsx:519-530`. Putting them here would mean shipping outcome weights that no
 * archetype has ever seen, which is the exact failure the park plan is built to avoid.
 *
 * The temptation to "just add the surface index while I'm here" is the specific thing this
 * header exists to stop. `surface` and `grassLength` are enums in the data and assigning
 * them numbers is a coefficient decision.
 *
 * THE AIR DENSITY NUMBER IS PHYSICS; THE REPRESENTATIVE HEIGHTS AND TEMPERATURES ARE
 * CHOICES, AND THEY ARE LABELLED AS CHOICES
 *
 * The barometric formula is real and the reference condition is real. What a park *band*
 * means physically is not: `high` covers 3,000-4,500 ft and a park is somewhere in that
 * range, so the profile uses the band midpoint and RECORDS IT, so the number can be checked
 * against a park someone thinks is wrong. A density figure quoted without the height it was
 * computed at is not auditable.
 *
 * Same for climate: `hot_dry` is a band, not a temperature, so each regime gets a stated
 * annual mean. Change the constants and every park moves; that is why they are exported and
 * why nothing else in the codebase gets to hold its own private copy.
 *
 * WHY `porchFt` MATTERS MORE THAN IT LOOKS
 *
 * The data cannot express a true short porch opposite a true monument corner, because LCF and
 * RCF are interpolated (plan section 2.3, the blueprint's own suggestion). So a park's
 * handedness asymmetry has to live in LF versus RF. `porchFt` is that asymmetry, and it is
 * the one derived quantity here that a left-handed power hitter would care about. It is kept
 * even though it is a single subtraction, because it is the only place the symmetric
 * interpolation's cost becomes visible in a number.
 */

import parksJson from '../../data/parks.json';

// ---------------------------------------------------------------------------
// The entered dimensions, as types. `checkParks` is the authority on legality;
// this is the typed view of a file that has already been validated.
// ---------------------------------------------------------------------------

export type AltitudeBand = 'sea' | 'moderate' | 'high' | 'extreme';
export type RoofKind = 'open_air' | 'fixed_roof' | 'retractable_open' | 'dome';
export type WallColor = 'light' | 'dark' | 'glass';
export type Surface = 'grass' | 'turf' | 'hybrid';
export type GrassLength = 'short' | 'standard' | 'long';
export type SoilType = 'dry_hard' | 'standard_clay' | 'damp_heavy' | 'sandy_loose';
export type ClimateRegime = 'cold' | 'temperate' | 'hot_dry' | 'hot_humid' | 'cool_coastal';
export type HumidityBand = 'arid' | 'moderate' | 'humid';
export type FoulGround = 'small' | 'standard' | 'generous';

export interface ParkDimensions {
  altitude: AltitudeBand;
  roof: RoofKind;
  lfFt: number;
  cfFt: number;
  rfFt: number;
  wallHeightFt: number;
  wallColor: WallColor;
  surface: Surface;
  grassLength: GrassLength;
  soilType: SoilType;
  climate: ClimateRegime;
  humidity: HumidityBand;
  foulGround: FoulGround;
  /** Optional prose. Never read by anything here, and must never be. */
  flavour?: string;
}

/**
 * How much of each gap the corner interpolation eats.
 *
 * The blueprint's own suggestion, taken verbatim: "derive LCF and RCF as 12.5% interpolations
 * of LF/CF and CF/RF, since real parks are usually roughly symmetric that way and it halves
 * the data entry."
 */
export const CORNER_INTERPOLATION = 0.125;

/**
 * Representative height per altitude band, in FEET.
 *
 * A CHOICE, not a measurement. Midpoints of the ranges `parks.json` documents. Exported so
 * the density figure is auditable and so nothing downstream can quietly use a different one.
 */
export const ALTITUDE_FT: Record<AltitudeBand, number> = {
  sea: 0,
  moderate: 1150,
  high: 3750,
  extreme: 5750,
};

/**
 * Representative annual mean temperature per climate regime, in CELSIUS.
 *
 * Also a CHOICE. `cold` is a coastal or northern climate rather than a cold-month average,
 * and `hot_dry` is an annual mean of a desert rather than a July afternoon. Phase 3 will want
 * a seasonal curve instead; this is the single scalar that Phase 2 needs, and stating it is
 * better than pretending the data implies it.
 */
export const CLIMATE_C: Record<ClimateRegime, number> = {
  cold: 4,
  temperate: 15,
  hot_dry: 32,
  hot_humid: 27,
  cool_coastal: 17,
};

/** Air density at sea level and 15 C, the reference every ratio is taken against. */
export const REFERENCE_DENSITY = 1.225; // kg/m^3
export const REFERENCE_C = 15;

/** US Standard Atmosphere constants. These are physical, not choices. */
const LAPSE_K_PER_M = 0.0065;
const T0_K = 288.15;
const GRAVITY = 9.80665;
const R_SPECIFIC = 287.05;
/** g/(R*L) - 1 = 4.2559, the exponent on the barometric term. */
const DENSITY_EXPONENT = GRAVITY / (R_SPECIFIC * LAPSE_K_PER_M) - 1;

const FT_TO_M = 0.3048;
const C_TO_K = 273.15;

/**
 * The altitude channel alone: density ratio from height, at the reference climate.
 *
 * `(1 - L*h/T0)^4.2559`. The exponent is `g/(R*L) - 1` rather than `g/(R*L)` because density
 * falls with pressure to a lower power than pressure itself does.
 *
 * THE DIVISION BY T0 IS LOAD-BEARING AND WAS MISSED IN THE FIRST VERSION, which produced
 * `NaN` for every park above about 1,300 ft. Without it the base of the power is
 * `1 - L*h`, which goes NEGATIVE once `L*h` exceeds 1 -- at 3,750 ft that is `1 - 7.43`, and
 * raising a negative number to a fractional power is NaN. The formula was returning NaN for
 * 11 of the 32 parks and a plausible-looking number for the other 21, which is the worst
 * possible shape for a bug to have.
 *
 * Dividing by T0 is what makes the term dimensionless, and it is why the schema's own
 * "about 85% as dense" at 5,280 ft is reproducible: this function alone returns 0.8543
 * there, and 1/0.8543 - 1 is 17.05%, which is the "roughly 17% farther" in the note. That
 * sentence was written before this formula existed, so it is independent evidence rather than
 * a fit.
 */
export const barometricDensityRatio = (altitude: AltitudeBand): number =>
  barometricDensityRatioAtHeight(ALTITUDE_FT[altitude]);

/**
 * The same term at an ARBITRARY height in feet.
 *
 * Exists for one reason, and the reason is a check that failed when it should not have.
 * `deriveParkProfile.ts` verifies this formula against the schema's own "about 85% as dense at
 * 5,280 ft". The first version of that check RE-IMPLEMENTED the barometric formula inside the
 * tool, to keep it independent of the library. That was the wrong kind of independence: with
 * the `/T0` division deleted from the library, the tool still agreed with the schema, still
 * printed 32/32, and still exited 0 -- while printing `air xNaN` two lines above its own
 * verdict. It had been validating a copy of the formula, not the formula.
 *
 * A check that cannot fail for the thing it is about is worse than no check, because it
 * reports success. So the check now CALLS this, and 5,280 ft -- which is not any band's
 * midpoint -- is reachable because this takes a height rather than a band.
 */
export const barometricDensityRatioAtHeight = (feet: number): number =>
  Math.pow(1 - (LAPSE_K_PER_M * (feet * FT_TO_M)) / T0_K, DENSITY_EXPONENT);

/**
 * The climate channel alone: density ratio from temperature, at sea level.
 *
 * `T0 / T_local`. Exactly 1.000 for the `temperate` regime, which is the reference and the
 * only regime for which this is 1.
 */
export const temperatureDensityRatio = (climate: ClimateRegime): number =>
  T0_K / (CLIMATE_C[climate] + C_TO_K);

/**
 * Air density as a ratio to sea level at 15 C, both channels combined.
 *
 * The two channels are kept separately available above because they are different kinds of
 * thing and only one of them is a function of the field's own altitude:
 *
 *   1. HEIGHT. The standard atmosphere already includes the temperature LAPSE with altitude,
 *      so `barometricDensityRatio` is the whole altitude story.
 *
 *   2. LOCAL TEMPERATE. Whatever the standard lapse says the air is doing at that height, the
 *      park's own climate is doing something else, and warmer air is thinner. Applied as
 *      `T_standard(h) / T_local`, so it is exactly 1.000 at sea level and exactly 1.000 for a
 *      `temperate` park at any height, and departs from the baseline only when the park's
 *      climate is warmer or colder than the standard atmosphere's at that altitude.
 *
 * That last property is the reason the temperature channel is scaled by the standard
 * temperature at height rather than by T0 directly. Scaling by T0 would double-count: the
 * lapse already cooled the air on the way up, and charging the park's climate for it again
 * would make `extreme + temperate` read as colder than `extreme + cool_coastal` does at the
 * same altitude.
 *
 * CONSEQUENCE WORTH KNOWING, because it is easy to mistake for an error: an
 * `extreme + temperate` park scores about 0.823, not the 0.854 the schema's altitude note
 * quotes. The 0.854 is the barometric channel alone, which is what that sentence is about.
 * Both figures are reported separately so neither can be mistaken for the other.
 */
export const airDensityRatio = (altitude: AltitudeBand, climate: ClimateRegime): number => {
  const metres = ALTITUDE_FT[altitude] * FT_TO_M;
  const standardK = T0_K - LAPSE_K_PER_M * metres;
  const localK = CLIMATE_C[climate] + C_TO_K;
  return barometricDensityRatio(altitude) * (standardK / localK);
};

// ---------------------------------------------------------------------------
// The derived profile
// ---------------------------------------------------------------------------

export interface ParkProfile {
  teamId: string;
  /** The entered dimensions, unchanged. Carried so downstream never re-reads the JSON. */
  dimensions: ParkDimensions;

  /**
   * The five wall distances, the shape `parkDataContract` in `GPBBook.tsx:539` calls
   * `ParkDimensions`. Two of these are interpolated and never entered.
   */
  lfFt: number;
  lcfFt: number;
  cfFt: number;
  rcfFt: number;
  rfFt: number;

  /** Mean of the five. The park's overall size, independent of where the size sits. */
  meanWallFt: number;
  /**
   * `lfFt - rfFt`. The handedness asymmetry, and the only place the symmetric interpolation
   * costs something visible. Positive means a left-field porch.
   */
  porchFt: number;
  /** `cfFt - (lfFt + rfFt) / 2`. How much deeper centre is than the corners. */
  centreExcessFt: number;
  /** `wallHeightFt * meanWallFt`. Wall area a ball has to clear, in square feet. */
  wallAreaSqFt: number;
  /** Symmetry, 0 at perfectly even corners and 1 at maximally uneven. See `porchSymmetry`. */
  porchSymmetry: number;

  /** Dimensionless density ratio, both channels. 1.000 means sea level at 15 C. */
  airDensityRatio: number;
  /** The altitude channel alone. This is what the schema's "about 85% at 5,280 ft" quotes. */
  barometricRatio: number;
  /** The climate channel alone, scaled against the standard atmosphere at this height. */
  temperatureRatio: number;
  /**
   * The reciprocal of `airDensityRatio`, i.e. how far a ball of the same launch speed would
   * carry relative to the reference park. Provided so Phase 3 does not have to remember to
   * invert it, because forgetting is the easy mistake and it inverts the sign of the effect.
   */
  carryMultiplier: number;
  /** The height the density figure was computed at, so it can be checked. */
  altitudeFtUsed: number;
  /** The temperature the density figure was computed at, for the same reason. */
  climateCUsed: number;
}

/**
 * Corner interpolation, exactly as the blueprint specifies it.
 *
 * LCF sits 12.5% of the way from centre toward the left-field corner; RCF 12.5% of the way
 * toward the right-field corner. Written as an interpolation rather than an offset so the
 * intent survives the arithmetic.
 */
export const interpolateCorners = (lfFt: number, cfFt: number, rfFt: number): {
  lcfFt: number;
  rcfFt: number;
} => ({
  lcfFt: cfFt + (lfFt - cfFt) * CORNER_INTERPOLATION,
  rcfFt: cfFt + (rfFt - cfFt) * CORNER_INTERPOLATION,
});

/**
 * How even the two corners are, from 0 to 1.
 *
 * Normalised by the mean distance rather than by the raw gap, so a symmetric 330/400/330 park
 * and a symmetric 350/400/350 park both score 0. A fixed 30-foot difference means something
 * very different in a 330-foot park than in a 400-foot one, and this measure says so.
 */
export const porchSymmetry = (lfFt: number, cfFt: number, rfFt: number): number => {
  const mean = (lfFt + cfFt + rfFt) / 3;
  if (mean === 0) return 0;
  return Math.min(1, Math.abs(lfFt - rfFt) / (2 * mean));
};

/**
 * Derive one park's physical profile.
 *
 * Pure. Takes the entered dimensions and returns the derived quantities; reads no global
 * state and touches no module-level cache, so a caller can profile a hypothetical park --
 * which is how Phase 3's archetype check will use it.
 */
export const deriveParkProfile = (teamId: string, dimensions: ParkDimensions): ParkProfile => {
  const { lfFt, cfFt, rfFt, wallHeightFt, altitude, climate } = dimensions;
  const { lcfFt, rcfFt } = interpolateCorners(lfFt, cfFt, rfFt);
  const meanWallFt = (lfFt + lcfFt + cfFt + rcfFt + rfFt) / 5;
  const density = airDensityRatio(altitude, climate);

  return {
    teamId,
    dimensions,
    lfFt,
    lcfFt,
    cfFt,
    rcfFt,
    rfFt,
    meanWallFt,
    porchFt: lfFt - rfFt,
    centreExcessFt: cfFt - (lfFt + rfFt) / 2,
    wallAreaSqFt: wallHeightFt * meanWallFt,
    porchSymmetry: porchSymmetry(lfFt, cfFt, rfFt),
    airDensityRatio: density,
    barometricRatio: barometricDensityRatio(altitude),
    temperatureRatio: density / barometricDensityRatio(altitude),
    carryMultiplier: 1 / density,
    altitudeFtUsed: ALTITUDE_FT[altitude],
    climateCUsed: CLIMATE_C[climate],
  };
};

/**
 * Every park in the file, keyed by team id.
 *
 * `_comment`, `_schema`, `_lcfRcf` and `_tierCDropped` are stripped by the underscore
 * convention rather than an explicit allow-list, so adding a documented note to the JSON can
 * never turn into a thirty-third "park".
 */
export const ALL_PARK_PROFILES: ReadonlyMap<string, ParkProfile> = new Map(
  Object.entries(parksJson as Record<string, unknown>)
    .filter(([key]) => !key.startsWith('_'))
    .map(([teamId, value]) => [teamId, deriveParkProfile(teamId, value as ParkDimensions)]),
);

export const parkProfile = (teamId: string): ParkProfile | null => ALL_PARK_PROFILES.get(teamId) ?? null;