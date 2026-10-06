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
  /**
   * The town the park stands in. NOT the club's city, and not read by any factor.
   *
   * OPTIONAL in the type, REQUIRED in the data. `parks.json` has it on all thirty-two and
   * `checkParks` fails the build without it, but a hypothetical park built in a test -- the neutral
   * reference park, an archetype -- genuinely has no town, and inventing "Testville" for those
   * would be a fabricated fact in a file that treats hand-set values as authoritative. The same
   * arrangement as `flavour`: optional to the type, asserted where it matters.
   *
   * It lives here rather than in a second file keyed by team id because a park with no name cannot
   * be drawn or titled, and a second file is one more thing that can disagree with this one.
   */
  parkCity?: string;
  /**
   * This park's annual mean temperature, which overrides the regime's default.
   *
   * Optional, and the fallback is `CLIMATE_C[climate]` -- so every park that omits it behaves
   * exactly as before this field existed. The regime is the band; this is the value, because five
   * `hot_humid` parks are not the same temperature.
   *
   * HAND-SET DELIBERATELY, NOT RANDOMISED. This reaches `airDensityRatio`, and therefore
   * `carryMultiplier` and every park factor, so generating it per load would make each park's
   * home-run factor a different number on every page refresh -- unfixable sim results, and the
   * league's standings would jitter as you read them. `generateSchedule` already has a version of
   * this bug and it is documented as a known limitation; this field is deliberately not a second
   * instance of it. If you want a park warmer or colder, edit the number.
   */
  meanTempC?: number;
  altitude: AltitudeBand;
  /**
   * This park's own height in feet, inside its band. DISPLAY ONLY -- see `altitudeFtShown`.
   *
   * Optional, and the fallback is the band midpoint, so a hypothetical park built in a test needs
   * no value and behaves exactly as before this field existed. Same arrangement as `meanTempC`.
   *
   * The reason it exists at all: the four bands are wide, so a park's altitude used to read as
   * whichever midpoint its band happened to carry. `high` is 3,000-4,500 ft and every one of them
   * said 3,750. Per-park values inside the band make the label a fact about the park rather than
   * about the band.
   *
   * HAND-SET, NOT DERIVED AT RUNTIME. Display-only does not mean load-only: a value that changed
   * on refresh would mean the park's own altitude was not a fixed property of the park, which is
   * the same defect `meanTempC` was hand-set to avoid. `tools/stampParkAltitude.ts` generated
   * these once from a hash of the team id and they are now ordinary editable numbers.
   */
  altitudeFt?: number;
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
  /**
   * This park's own seasonal shape, Celsius from its own annual mean, April..October.
   *
   * Optional; the fallback is `CLIMATE_MONTH_OFFSET_C[climate]`, so 31 of the 32 parks are
   * untouched by this field existing. It exists for `ars`, which is a Denver-shaped park in an
   * ocean of regime-shaped ones.
   *
   * DISPLAY ONLY, and more firmly than `altitudeFt` is. `climateMonthC` already cannot reach the
   * physics -- the density figure is computed from the annual mean alone -- but this field makes
   * the separation load-bearing, so it is worth being blunt: reading a per-park curve back into
   * `airDensityRatio` would make seven hand-set numbers decide a home-run factor. `checkParks`
   * asserts this field is seven finite numbers, and `climateMonthC` asserts its length against
   * `CLIMATE_MONTHS`, but nothing asserts the absence of a code path that should not be there.
   */
  seasonOffsetC?: readonly number[];
  /** Optional prose. Never read by anything here, and must never be. */
  flavour?: string;
}

/**
 * How much of each gap the corner interpolation eats.
 *
 * THE BLUEPRINT'S OWN SUGGESTION, taken verbatim: "derive LCF and RCF as 12.5% interpolations
 * of LF/CF and CF/RF, since real parks are usually roughly symmetric that way and it halves
 * the data entry."
 *
 * That puts LCF within a few feet of centre -- Andrard reads 404 against a 410 CF -- which is a
 * fence with almost no bulge: the outfield is effectively a straight run from centre to each
 * corner, and the league's whole spread in left-centre is 26ft. That reads as flat on the diagram,
 * so this constant is the lever for changing it. See the direction note below before touching it.
 *
 * RAISED to 0.95, so the derived points sit much nearer their own corners and the fence bows.
 * The top LCF ceiling falls from 410.75 to 364.4.
 *
 * WHY 0.95 AND NOT 0.99. The derived point must never come back INSIDE its own corner, or the
 * fence goes concave and no park on earth has that. Measured margin is the derived value minus
 * its corner: at 0.95 the tightest park is `luf` at 2.1ft, then `ara` and `aub` at 2.4ft. That
 * is real headroom but not much, and it is the number to re-derive before deepening any of those
 * three. 0.99 would leave under a foot on the same parks.
 *
 * CHOSEN OVER 0.87 AFTER SEEING IT RENDERED. 0.87 was correct by every measurement available --
 * zero inversions, a comfortable 5.3ft worst margin -- and the diagram did bow properly. But it
 * pulled LCF so close to LF that the derived point and its own corner read as the same place:
 * Foulles showed a 333ft LCF above a 322ft LF, an 11ft difference on a 600ft field, and the
 * left-hand curve lost the shoulder that makes the shape legible as a ballpark. 0.95 keeps the
 * bow and restores the shoulder. The honest summary is that the safety margin was never the
 * binding constraint on this number; how the shape reads was.
 *
 * WHAT MOVING IT UP ACTUALLY DOES, since two rounds of this have now gone the wrong way and the
 * direction is the part that keeps being misread. The formula is `cf + (corner - cf) * k`, and
 * because a corner is always SHORTER than centre, `corner - cf` is negative:
 *
 *   k = 0.125  derived sits almost at CENTRE.  LCF 410.75 at the ceiling.
 *   k = 0.35   CURRENT. A visible bow, and a comfortable one.
 *   k = 0.95   derived sits almost at the CORNER, bowing hard.
 *   k = 1.0    derived EQUALS the corner -- a flat run, no bow at all.
 *   k = 1.15   derived lands 15% PAST the corner, inside it: a concave notch, all 32 parks,
 *              worst by 12.3ft. No real ballpark has this shape.
 *
 * So MORE bow is a SMALLER number. 1.15 is further from the original than 0.87 was, in the one
 * direction that breaks the geometry. Anyone reaching for a bigger value here is trying to add
 * bow and will add a dent instead.
 *
 * 0.35 AFTER SEEING 0.125, 0.87 AND 0.95 RENDER. 0.125 reads flat -- the derived point sits 6ft
 * from centre out of a 48ft corner-to-centre gap, so the outfield is very nearly a straight run.
 * 0.87 overshot the other way, leaving only 11ft between LCF and LF, so the derived point read as
 * the same place as its own corner and flattened the shoulder instead. 0.35 sits between them:
 * LCF moves 9-15ft out, and the LCF-to-LF gap stays between 26.7ft and 43.6ft, which is the range
 * where the fence still has a curve you can see. Measured margin against the nearest corner is
 * 26.7ft at `ara`, so this is nowhere near the concave boundary.
 *
 * WORTH KNOWING BEFORE CHASING VARIETY HERE. Raising k moves every park's derived point by a
 * similar amount and barely widens the spread BETWEEN them -- 26.4ft across the league at 0.125,
 * 28.9ft at 0.35. The constant changes the SHAPE, not the variety. Two parks look different
 * because their corners differ, which is what the entered LF/CF/RF are for; this number cannot
 * make one park's fence distinct from another's.
 *
 * THE CAP ALTERNATIVE WAS REJECTED, and the reason is worth keeping. Clamping the fifteen
 * longest parks to 0.87 of the 15th value does not lower them 13% -- it collapses all fifteen
 * onto one number, 344.41, because 0.87 of the 15th-longest is a cap and a cap has no spread.
 * One constant produces fifteen distinct values and preserves their order; a cap produces one
 * value repeated fifteen times and makes the 16th park depend on a sort that any corner edit
 * reshuffles.
 *
 * Note the flat-shape consequence: any raise here lowers the SHORTEST parks exactly as much as
 * the longest, because it scales the gap rather than the value. That is inherent to a single
 * lever, and the alternative -- per-park values -- is the second source of truth this file does
 * not have.
 *
 * WHAT THIS DOES AND DOES NOT MOVE. Nothing in the simulation. `hrFieldWeights` reads only
 * `lfFt`, `cfFt` and `rfFt`, so every park factor is byte-identical across this change; the
 * consumers of the derived pair are `meanWallFt`, `wallAreaSqFt` (the "sq ft of wall" in the
 * park popup) and the diagram's five control points. Measured, not assumed.
 */
export const CORNER_INTERPOLATION = 0.35;

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
 * and `hot_dry` is an annual mean of a desert rather than a July afternoon.
 *
 * NOW A FALLBACK RATHER THAN THE ANSWER. `meanTempC` in `parks.json` overrides this per park and
 * all 32 parks set it, so these five numbers are what a hypothetical park or a data file without
 * the field would get. The neutrality check in `checkParkFactors` still depends on them, which is
 * why they stay rather than being replaced by a computed average.
 *
 * WHY PER-PARK MATTERS FOR MORE THAN COSMETICS. Five `hot_humid` parks shared one 27 C before,
 * so temperature was effectively a five-valued field across the whole league and two parks on the
 * same regime were identical on both temperature-driven terms. They are not now. `airCarry` and
 * `biteLoss` both move with temperature, so measured across 32 parks: `hrFactor` 0.860-1.213
 * becomes 0.845-1.223, and `airCarry` 0.962-1.215 becomes 0.948-1.199. A small widening, in the
 * right direction -- more parks that are individually distinguishable.
 */
export const CLIMATE_C: Record<ClimateRegime, number> = {
  cold: 4,
  temperate: 15,
  hot_dry: 32,
  hot_humid: 27,
  cool_coastal: 17,
};

/**
 * The months of the season, April to October, and what each regime does across them.
 *
 * SEVEN MONTHS, NOT TWELVE, and that is the whole shape of the baseball season as this app models
 * it: the league plays April to October and nothing outside that, so a January and a July column
 * would be reporting weather for games that are not played.
 *
 * VALUES ARE THE ANNUAL MEAN PLUS A REGIME OFFSET, not twelve separate observations. April is the
 * regemean MINUS 4 and August is the mean PLUS 8, which is a temperate-year shape, and every
 * regime shares that curve with its own amplitude. This is a display of a plausible seasonal
 * profile and NOTHING MORE -- see `climateMonthC` for why it must not be read back into the
 * physics, which uses the annual mean only.
 *
 * Ordered April..October to match `CLIMATE_MONTHS`, and the two arrays are asserted to be the same
 * length at module load rather than trusted, because a seasonal table that is one month out of step
 * with its own header is the kind of thing nobody notices until the chart is wrong.
 */
export const CLIMATE_MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'] as const;

/**
 * Seasonal offset per regime, in Celsius, relative to that regime's annual mean.
 *
 * AMPLITUDE IS THE ONLY THING THAT SEPARATES THE REGIMES HERE, because the mean is per-park and
 * arrives separately in `meanTempC`. A maritime climate should have a shallow curve and a
 * continental one a deep curve, and that -- not the mean -- is what `cold` and `temperate` really
 * differ by.
 *
 * BUT THE SEPARATION IS SMALL, and it is worth being exact about rather than implying more than the
 * table delivers. Measured April-to-August swing by `tools/reportParkSeasons.ts`: `cold` 13C,
 * `hot_dry` 13C, `temperate` 12C, `cool_coastal` 10C, `hot_humid` 10C. Three distinct values across
 * five regimes, a 3C spread. That is a real difference and it is the right direction -- the two
 * maritime regimes are shallowest, the two continental/hot ones deepest -- but 3C is a subtle read
 * on a chart, not a dramatic one. Widening it is a one-line change per regime if a future pass wants
 * the curves further apart.
 *
 * A park's own mean does NOT affect its swing: `(mean + off[Aug]) - (mean + off[Apr])` cancels the
 * mean, so every park sharing a regime has an identical curve shape, offset vertically. Two parks
 * on `temperate` at 12C and 19C therefore draw the same shape 7C apart -- which is correct, since
 * they are the same climate at different latitudes' worth of heat.
 */
export const CLIMATE_MONTH_OFFSET_C: Record<ClimateRegime, readonly number[]> = {
  // Apr   May   Jun   Jul   Aug   Sep   Oct
  cold: [-6, -3, 1, 5, 7, 4, -1],
  temperate: [-4, -1, 3, 7, 8, 5, 1],
  hot_dry: [-2, 2, 7, 10, 11, 8, 3],
  hot_humid: [-1, 2, 6, 8, 9, 7, 4],
  cool_coastal: [-4, -2, 1, 4, 6, 5, 2],
};

/**
 * One park's temperature for each month of the season, April through October.
 *
 * THE ANNUAL MEAN, NOT THE MEAN OF THESE SEVEN. The simulation's temperature channel is an annual
 * mean and this must not feed back into it: a park's annual mean is not the average of its
 * baseball months, because the four months it does not play in are systematically colder. Feeding
 * these back would double-count the season and quietly move every park factor again, which is
 * exactly the kind of drift a display field must never introduce. Read-only, by construction.
 */
export const climateMonthC = (profile: ParkProfile): number[] => {
  const mean = profile.climateCUsed;
  // A park's own curve wins over its regime's. Present on one park today; the fallback keeps the
  // other thirty-one reading exactly as they did before the field was added.
  const offsets = profile.dimensions.seasonOffsetC
    ?? CLIMATE_MONTH_OFFSET_C[profile.dimensions.climate];
  return offsets.map((offset) => mean + offset);
};

/** Celsius to Fahrenheit. Used for display only -- nothing in the physics is converted. */
export const toF = (c: number): number => (c * 9) / 5 + 32;

/**
 * The month labels and the offset table must agree in length.
 *
 * A seasonal table one month out of step with its own header is invisible in review and obvious
 * on screen -- September's temperature appearing under August. Asserted rather than trusted.
 */
if (CLIMATE_MONTHS.length !== Object.values(CLIMATE_MONTH_OFFSET_C)[0].length) {
  throw new Error(
    `CLIMATE_MONTHS has ${CLIMATE_MONTHS.length} labels but the offset table has `
    + `${Object.values(CLIMATE_MONTH_OFFSET_C)[0].length} entries`,
  );
}


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
export const temperatureDensityRatio = (climate: ClimateRegime, meanTempC?: number): number =>
  T0_K / ((meanTempC ?? CLIMATE_C[climate]) + C_TO_K);

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
export const airDensityRatio = (
  altitude: AltitudeBand,
  climate: ClimateRegime,
  meanTempC?: number,
): number => {
  const metres = ALTITUDE_FT[altitude] * FT_TO_M;
  const standardK = T0_K - LAPSE_K_PER_M * metres;
  const localK = (meanTempC ?? CLIMATE_C[climate]) + C_TO_K;
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
   * The park's name, hoisted off `dimensions` because a title and a dialog's aria label both want
   * it and neither wants to reach through two levels for it. Optional for the same reason
   * `parkCity` is: a hypothetical park has no town.
   */
  parkCity?: string;

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
  /**
   * This park's own height in feet, for the label. Falls back to `altitudeFtUsed`.
   *
   * KEPT SEPARATE FROM `altitudeFtUsed` AND IT MATTERS THAT THEY CAN DIFFER. The density figure is
   * computed from the band midpoint, so a park labelled 4,120 ft has an `altitudeFtUsed` of 3,750
   * and an air density that corresponds to 3,750. Both numbers are honest and they answer different
   * questions -- one is what the park is, the other is what the simulation assumed -- and the panel
   * prints both so the reader can see the gap instead of inferring it.
   *
   * Collapsing them would be the tidier-looking mistake: it would make the label agree with the
   * physics by making the physics per-park, which is a simulation change nobody asked for dressed
   * up as a display fix.
   */
  altitudeFtShown: number;
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
  const density = airDensityRatio(altitude, climate, dimensions.meanTempC);

  return {
    teamId,
    dimensions,
    parkCity: dimensions.parkCity,
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
    altitudeFtShown: dimensions.altitudeFt ?? ALTITUDE_FT[altitude],
    climateCUsed: dimensions.meanTempC ?? CLIMATE_C[climate],
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

/*
 * Everything below needs all thirty-two parks to exist, which is why it is here and not beside the
 * seasonal constants it depends on. `climateMonthC` and `CLIMATE_MONTHS` are defined three hundred
 * lines up and are perfectly usable on their own; these two are only meaningful once the data has
 * been read.
 */

/**
 * Same length assertion for a park's OWN curve as the one beside `CLIMATE_MONTH_OFFSET_C`, and it
 * has to be per park rather than once at module load: the override lives in the data, so this is the
 * first place all thirty-two are visible. Asserted rather than trusted, because a six-month
 * override on one park produces a chart where October sits under June and nothing says so.
 */
for (const profile of ALL_PARK_PROFILES.values()) {
  const own = profile.dimensions.seasonOffsetC;
  if (own && own.length !== CLIMATE_MONTHS.length) {
    throw new Error(
      `${profile.teamId} has a seasonOffsetC of ${own.length} entries but there are `
      + `${CLIMATE_MONTHS.length} months`,
    );
  }
}

/**
 * THE COLDEST AND WARMEST BASEBALL MONTH ANYWHERE IN THE LEAGUE, and the reason the season chart is
 * drawn on a shared scale instead of each park's own.
 *
 * This exists because the per-park scaling was wrong, and it was wrong in a way that only became
 * visible once somebody opened two parks in a row. Each park's bars were scaled to that park's own
 * coldest and warmest month, so a park running -1C to 14C and a park running 27C to 47C both drew
 * columns that used the full height of the box and had the same silhouette. They looked like the
 * same climate. They are 40 degrees apart, which is the entire difference between a maritime north
 * and a desert.
 *
 * A shared scale costs each park its own curve filling the box, and that cost is real: the coldest
 * park in the league now draws short bars, which reads as less information until you notice the
 * bars are comparable to every other park's -- which is the only thing a bar chart is for. A park's
 * own shape is still legible from the printed number under each column, so nothing is actually lost
 * except the illusion, which was the thing that was wrong.
 *
 * COMPUTED FROM THE DATA, not typed in, so it cannot drift out of agreement with the thirty-two
 * charts it scales. It moves whenever a mean, a regime, or an override moves.
 *
 * IT SPANS THE WHOLE LEAGUE, including parks not currently on screen, and that is deliberate: a
 * park in the middle of the distribution should get a chart that looks unremarkable, because it is.
 */
export const LEAGUE_SEASON_TEMP_C = ((): { min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (const profile of ALL_PARK_PROFILES.values()) {
    for (const t of climateMonthC(profile)) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('no park produced a finite monthly temperature');
  }
  return { min, max };
})();
