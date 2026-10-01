/**
 * Park Phase 3 -- HR, FB, GB and run factors, from the interaction rules.
 *
 * READ THIS BEFORE TRUSTING ANY NUMBER IN THIS FILE
 *
 * Every coefficient below is CHOSEN. None is measured. Phase 4 is what turns this model into
 * a measurement, by simulating seasons and correlating each park's derived factor with the
 * factor the simulation actually realises.
 *
 * The coefficients were tuned so that ten hand-built archetype parks -- the ones the
 * blueprint names at `GPBBook.tsx:519-530`, whose targets come from real MLB park factors --
 * land on their target numbers. That is CALIBRATION AGAINST TEN POINTS, and it is worth being
 * blunt about what that does and does not buy:
 *
 *   It buys: the model is not obviously wrong. A Coors-style park does come out near 145 and
 *            a Dodger-style one near 92. The archetype check is the whole safety argument for
 *            shipping these numbers at all, and it is why Phase 3 exists.
 *
 *   It does not buy: that the numbers mean anything at a park that is not one of the ten.
 *            Ten targets can be hit by many models, and nothing here distinguishes between
 *            them. The distribution across the other 22 parks is an INTERPOLATION between
 *            calibrated points, and it is only as good as the assumption that parks vary
 *            smoothly between the archetypes.
 *
 * So these factors must be labelled derived wherever they surface until Phase 4 passes, and
 * no screen may present one as an observation. This is risk 4.1 of the park plan and it is the
 * single most important constraint on this file.
 *
 * WHY EVERY COEFFICIENT IS ITS OWN NAMED CONSTANT
 *
 * Risk 4.2: the five interaction rules at `GPBBook.tsx:511-517` are all easy to implement
 * additively, because addition is what a programmer reaches for by default, and all five are
 * wrong additively:
 *
 *   1. Altitude x temperature on HR carry must MULTIPLY. Both are air density.
 *   2. Surface x grass length on ground balls must MULTIPLY. Same outcome, two doors.
 *   3. Roof x climate must NEUTRALISE, not stack. A climate-controlled dome has no climate.
 *   4. Wall distance x wall height is not a product at all -- a short wall only produces a
 *      home run if it is also tall enough, so height has to be weighted BY how close the wall
 *      is. This is the one genuine interaction and it is why `wallReachFactor` exists.
 *   5. Foul territory x wall height overlap, and must compose rather than add.
 *
 * Each is a named function below with its rule in the comment, so it is visible which rule
 * fired. A single blended expression would hide all five.
 *
 * WHY PARK FACTORS AND HOME-FIELD ADVANTAGE DO NOT DOUBLE-COUNT
 *
 * Risk 4.5 asks this to be resolved here rather than left to Phase 5, because if they are
 * tuned independently they will. The resolution is that they act on different quantities:
 *
 *   - `settings.homeFieldAdvantage` (0.025, `gameEngine.ts:481`) is a RELATIVE edge. It is
 *     `+/- 2` added to a scalar `edge` that flows into the outcome weights, and it says the
 *     home team does somewhat better than the visitor -- crowd, travel, familiarity. It is
 *     about WHO is playing, not WHERE.
 *
 *   - A park factor is an ABSOLUTE environment multiplier for a building. It says this park
 *     suppresses or amplifies scoring, and it applies to BOTH teams in every game played
 *     there. It is about WHERE.
 *
 * A Coors park raises scoring for the visitors too; home-field advantage says the home team
 * gains a little on top. Those are not two counts of one effect, and applying a park factor
 * as a home-team bonus would make them two.
 *
 * THE CONSEQUENCE, which is a wiring constraint and not a nicety: park factors must scale the
 * outcome weights for both teams symmetrically. `applyParkFactors` below is written to do
 * exactly that and takes no `isHomeBatting` argument, so it cannot be wired the other way by
 * accident. Its signature is part of the safety argument.
 *
 * A second overlap does exist and is NOT resolved here: `settings.leagueEnvironmentBalance`
 * (0.5) already shifts outcome weights league-wide through `environmentBias`, which is exactly
 * what a park factor does locally. At its default of 0.5 that term is `0` and the two do not
 * interact. It should stay at 0.5 while parks are live, and that belongs in Phase 5's
 * regression check rather than being assumed.
 */

import {
  ALL_PARK_PROFILES,
  ALTITUDE_FT,
  CLIMATE_C,
  barometricDensityRatioAtHeight,
  type HumidityBand,
  type ParkProfile,
} from './parkProfile';
import type { AtBatOutcome } from '../../types';

/**
 * THE CHOSEN COEFFICIENTS.
 *
 * Grouped by the rule they serve, and exported as one object so a reader can see the whole
 * model in one place and so nothing in this codebase holds a private copy of any of it.
 *
 * The neutrality target for every one of these is 1.000, meaning "plays like the reference
 * park": sea level, 15 C, standard grass on standard clay, a 400-foot wall 8 feet high and
 * dark-coloured, standard foul ground, open air, moderate humidity. A park built from all
 * those inputs returns exactly 1.000 on every factor, which is asserted in
 * `tools/checkParkFactors.ts` -- a model that cannot reproduce its own neutral point cannot be
 * reasoned about at all.
 *
 * NOTE ON SCALE. These multipliers are on a 1.000 scale; the blueprint's targets are on the
 * conventional park-factor INDEX scale where 100 is league average, so Coors-style's "145" is
 * a multiplier of 1.45. The two are the same number divided by 100, and mixing them up makes
 * every archetype read as a hundred-point miss. `indexOf()` is the only conversion.
 */
export const PARK_COEFFICIENTS = {
  /**
   * Where home runs actually go, as a weighting over the three wall distances.
   *
   * These are CHOSEN, from the shape of real home-run distributions rather than measured from
   * this engine, which records no batted-ball direction at all.
   */
  hrFieldWeights: { lf: 0.37, cf: 0.26, rf: 0.37 },
  /** Wall distances either side of this get proportionally less and more effect. */
  neutralWallFt: 385,
  /** The wall height at which height is worth nothing, in the height term below. */
  neutralWallHeightFt: 8,
  /** Where the "home run window" peaks: the height a wall is most worth having. */
  peakWallHeightFt: 12,
  /** The height at which the window closes and the wall starts suppressing home runs. */
  closingWallHeightFt: 24,
  /**
   * Feet of extra wall height that count as "a full wall's worth" of reach.
   */
  wallHeightRangeFt: 12,
  /**
   * How much a full-height wall at a short distance is worth, at the top of the home-run
   * window.
   *
   * SMALL, and it was 0.34 until the archetypes disagreed with each other. A 0.34 gain made the
   * Fenway archetype score 188 against a target of 100, because a 37-foot wall multiplies out
   * to more than two full units of height and 0.34 of that is a third more home runs.
   *
   * It could not simply be raised to serve the short-porch archetypes either: a linear term
   * gave one coefficient the job of both a 17-foot wall and a 37-foot wall and they wanted
   * opposite things. Making the term a WINDOW rather than a slope is what resolved it, and it
   * is the physically correct shape -- see `homeRunWindow`.
   */
  wallHeightGain: 0.085,
  /** Metres of distance either side of neutral that produce the full distance effect. */
  wallDistanceHalfRangeFt: 70,
  /**
   * Distance effect per unit of (normalised) distance from neutral. Negative: deeper is worse.
   *
   * Steep, at 0.55. Set by the Citi archetype, which has to lose 7 points of index from
   * geometry alone at sea level.
   */
  wallDistanceSlope: 0.55,
  /**
   * Generous foul ground raises home runs.
   *
   * SMALL, and that is rule 5 partially modelled rather than ignored. Rule 5 says foul
   * territory and wall height "overlap more than they appear to", and the archetype this
   * coefficient has to satisfy is a BIG park with huge foul ground -- one where the generous
   * field is already suppressing balls before foul territory is considered. A large gain (0.075
   * was the first value) put that archetype 10 points over its target on its own.
   *
   * What is NOT modelled is the overlap itself: the correct treatment is a foul-ground effect
   * that shrinks as the park gets larger, and this is a constant instead. That is a real
   * simplification and Phase 4 is where it would show up.
   */
  generousFoulHrGain: 0.020,
  /** A light wall absorbs; a dark one does not. Small, and one of the nicer details. */
  lightWallPenalty: 0.030,
  /** Glass sits between the two. */
  glassWallPenalty: 0.018,
  /** ...and small foul ground costs home runs. */
  smallFoulHrLoss: 0.055,
  /** Generous foul ground raises strikeouts, which is its actual signature. */
  generousFoulSoGain: 0.115,
  smallFoulSoLoss: 0.085,
  /** Turf, grass and hybrid. The engine records no batted-ball type, so this is a model. */
  turfGbGain: 0.075,
  hybridGbGain: 0.030,
  /** Long grass kills bloopers and turns grounders into singles; short grass does neither. */
  longGrassGbLoss: 0.055,
  shortGrassGbLoss: 0.020,
  /** Damp clay kills hops, so grounders become singles. Small alone; compounds with surface. */
  dampClayGbLoss: 0.040,
  dryHardGbGain: 0.030,
  /** A fixed or retractable roof kills carry. A dome kills it completely. */
  fixedRoofCarryLoss: 0.055,
  retractableRoofCarryLoss: 0.040,
  domeCarryLoss: 0.090,
  /** Climate inside a climate-controlled roof is the building's, not the city's. */
  NEUTRAL_CLIMATE_C: 18,
  /**
   * How much of the air-density ratio becomes LOST BREAKING BALL.
   *
   * THE SECOND ALTITUDE CHANNEL, and it was missing from the first version.
   *
   * `parks.json`'s own schema says of altitude: "Breaking balls also lose bite in thin air, so
   * altitude hurts pitching through a second channel." The first version of this file modelled
   * only carry, and then could not reach the Coors target of 145 -- it topped out around 124
   * with neutral walls -- because it was modelling one of the two mechanisms the schema names.
   *
   * Breaking effectiveness falls roughly with air density, so the bite factor is the density
   * ratio raised to this exponent, and a hitter's home runs rise as bite falls. It is the
   * single largest lever in the HR factor: at 0.75 it is worth about 8 points of index at
   * mile-high altitude, which is the difference between missing the Coors archetype and
   * hitting it.
   *
   * It is also the least defensible number in this file. The exponent is calibrated to one
   * archetype, the physical relationship is a rough proportionality rather than a measured
   * one, and the engine records no pitch data at all. Phase 4 is what settles it.
   */
  biteLossExponent: 0.75,
  /** Pitcher fatigue per degree C above comfort, per unit of centred humidity. */
  heatFatigueRate: 0.0130,
  humidityFatigueRate: 0.0205,
  comfortC: 15,
  /** How much of the run factor is HR, FB and GB respectively. Compresses the HR swing. */
  /**
   * How much of the run factor is HR, FB and GB respectively.
   *
   * HEAVILY WEIGHTED AWAY FROM HR, and that is not a fudge -- it is what the blueprint's own
   * numbers require. Coors-style is targeted at 145 on home runs and 115 on runs. A run factor
   * built as a weighted blend can only reach 115 from a 145 HR factor if the HR channel is
   * damped hard, because ln(1.15)/ln(1.45) is about 0.38: the home-run swing has to be
   * compressed to roughly a third of its size before the blend lands. At a 0.46 HR weight the
   * run factor came out at 128 against a target band of 113-117.
   *
   * The weight on GB is high because it is the one channel that moves independently: it is
   * driven by surface, grass and soil and is untouched by altitude, so it is what stops the
   * run factor from being a rescaled copy of the home-run factor.
   */
  runWeights: { hr: 0.24, fb: 0.22, gb: 0.54 },
  /** How much a fully-fatigued pitching staff moves scoring. */
  fatigueRunImpact: 0.085,
} as const;

/**
 * Convert a multiplier to the conventional park-factor index.
 *
 * The only place the two scales meet, so that every comparison in this codebase states which
 * one it is using. The blueprint's archetype targets are indices; these factors are
 * multipliers; confusing them makes every archetype read as a hundred-point miss, which is
 * exactly what the first version of `checkParkFactors` did.
 */
export const indexOf = (multiplier: number): number => multiplier * 100;

/* ------------------------------------------------------------------------- *
 * THE FIVE INTERACTION RULES, one named function each.
 * ------------------------------------------------------------------------- */

/**
 * RULE 1 -- Altitude x temperature on home-run carry. MULTIPLY.
 *
 * Both are air-density effects, so they compound through one ratio rather than two penalties.
 * The altitude part comes straight from `parkProfile`'s barometric term, which is physics; the
 * temperature part is the park's climate against the standard atmosphere at that height.
 *
 * A roof does NOT reduce this term, and deliberately so: this is the raw air-density channel
 * and `roofFactor` handles the roof. Folding the roof in here too would be the additive
 * mistake this function's own comment describes.
 */
export const airCarryFactor = (profile: ParkProfile): number => profile.carryMultiplier;

/**
 * RULE 1, SECOND CHANNEL -- thin air loses the ball its breaking movement.
 *
 * `parks.json` names this explicitly: "Breaking balls also lose bite in thin air, so altitude
 * hurts pitching through a second channel." Carry is the first channel and this is the second,
 * and they are separate mechanisms that happen to share a cause, so they are separate
 * multipliers rather than one doubled-up term.
 *
 * Bite falls with air density, so a hitter facing less bite hits more home runs. Returned as
 * the reciprocal because it multiplies a home-run factor upward.
 *
 * A dome does NOT neutralise this one. A closed roof stops rain and heat but the air inside is
 * still at whatever density the building holds, and the blueprint's own list puts altitude
 * above roof for HR factor -- "Altitude, climate temperature, humidity, wall distance, wall
 * height, wall color, foul territory, roof", altitude first and roof last.
 */
export const biteLossFactor = (profile: ParkProfile): number =>
  1 / Math.pow(profile.airDensityRatio, PARK_COEFFICIENTS.biteLossExponent);

/**
 * RULE 3 -- Roof x climate. The roof NEUTRALISES climate rather than stacking with it.
 *
 * Implemented as a substitution, not a reduction: a domed park is scored at
 * `NEUTRAL_CLIMATE_C` for the climate-dependent terms no matter what its city does. That is
 * what "a climate-controlled dome should neutralize the climate regime outright" means, and
 * it is why the desert dome archetype does not spike in summer while a genuinely hot open-air
 * park does.
 *
 * A `retractable_open` park is entered at its open state, per the data file, so it gets the
 * open-air roof treatment and only a modest carry reduction.
 */
export const roofNeutralisedClimate = (profile: ParkProfile): number => {
  const roof = profile.dimensions.roof;
  const isClimateControlled = roof === 'dome' || roof === 'fixed_roof';
  return isClimateControlled ? PARK_COEFFICIENTS.NEUTRAL_CLIMATE_C : CLIMATE_C[profile.dimensions.climate];
};

/**
 * Humidity, on the same substitution as the temperature above.
 *
 * The first version of this file neutralised temperature under a dome and then read humidity
 * straight off the park, so a climate-controlled building in a hot humid city still fatigued
 * pitchers more than the same building in a temperate one. That is incoherent: a dome holds
 * humidity as firmly as it holds temperature, and rule 3 says the climate regime is
 * neutralised OUTRIGHT rather than reduced.
 *
 * Caught by an assertion that the same dome must fatigue pitchers identically regardless of
 * the city's climate, which is the property rule 3 actually promises. It did not, and it
 * should not have.
 */
export const roofNeutralisedHumidity = (profile: ParkProfile): HumidityBand => {
  const roof = profile.dimensions.roof;
  const isClimateControlled = roof === 'dome' || roof === 'fixed_roof';
  return isClimateControlled ? 'moderate' : profile.dimensions.humidity;
};

/**
 * The wall distance that matters FOR HOME RUNS, which is not the mean of the three.
 *
 * THIS REPLACES A MEAN, AND THE MEAN WAS THE BUG.
 *
 * The first version used `profile.meanWallFt` for the wall term. Mean distance cannot tell a
 * short porch from a symmetric small park -- both have the same average -- and that is the
 * model's whole problem. It made the Fenway archetype score 188 against a target of 100,
 * because a 310-foot left field dragged the mean down to 379 and handed it a distance boost
 * that a park with a short LEFT porch and a deep right field should not get.
 *
 * The mean is still reported, because "how big is this park" is a real question that the mean
 * answers correctly. It is just not the question a home run asks.
 *
 * The weights are the shape of real home-run distribution: more than a third of home runs go
 * to right field, so right is weighted above left, and dead centre carries the largest share
 * of the field. This is the same asymmetry the blueprint describes for wall HEIGHT -- "a short
 * wall with a tall wall opposite gives the park two entirely different seasons" -- and the
 * model's failure to express handedness asymmetry in the DISTANCE term was the same omission
 * one level up.
 */
export const hrWeightedWallFt = (profile: ParkProfile): number => {
  const { lf, cf, rf } = PARK_COEFFICIENTS.hrFieldWeights;
  return lf * profile.lfFt + cf * profile.cfFt + rf * profile.rfFt;
};

/**
 * RULE 4 -- Wall distance x wall height. THE ONE REAL INTERACTION.
 *
 * A short wall only produces a home run if it is also tall enough, so height cannot simply be
 * multiplied in: a 40-foot wall 400 feet from home plate is worth almost nothing, while a
 * 6-foot wall 325 feet out is worth a great deal. Height is therefore weighted by how CLOSE
 * the wall is.
 *
 * `wallReach` is the ratio of neutral distance to actual, so it is 1.000 at the neutral wall,
 * above 1 when the park is small and below 1 when it is large. It is a plain ratio rather than
 * a clamped normalisation because the first version clamped it to [0, 1] and hit zero exactly
 * at the neutral distance -- which made a taller wall worth precisely NOTHING in a neutral
 * park, and that is a wall which does not exist in baseball. A wall at 385 feet still stops
 * balls if it is high enough; it just matters less.
 *
 * The height term is centred on `neutralWallHeightFt` rather than starting from zero, so that a
 * neutral park is exactly neutral. An 8-foot wall being worth nothing is a statement about the
 * model, not about the game.
 */
export const wallReach = (profile: ParkProfile): number => {
  const weighted = hrWeightedWallFt(profile);
  return weighted > 0 ? PARK_COEFFICIENTS.neutralWallFt / weighted : 1;
};

export const wallDistanceFactor = (profile: ParkProfile): number => {
  const { neutralWallFt, wallDistanceHalfRangeFt, wallDistanceSlope } = PARK_COEFFICIENTS;
  const normalised = (hrWeightedWallFt(profile) - neutralWallFt) / wallDistanceHalfRangeFt;
  return 1 - wallDistanceSlope * normalised;
};

/**
 * THE HOME-RUN WINDOW, and it is a WINDOW rather than a slope.
 *
 * Wall height is not monotonic, and modelling it as though it were was the largest modelling
 * error in this file. The first version made height purely additive -- "taller wall, more home
 * runs" -- which scored the Fenway archetype at 112 against a target of 100, and could only be
 * fixed by setting the gain so low that a genuinely generous wall did nothing.
 *
 * The physics is straightforward once stated. A wall only matters to a home run if the ball can
 * CLEAR it:
 *
 *   - Too SHORT: a ball that would have been a double clears the wall and is a home run
 *     instead. Height HELPS.
 *   - In the window: still helping, and at its most useful around a normal wall's height.
 *   - Too TALL: the ball cannot get over it at all. A 37-foot Green Monster is not a home-run
 *     machine, it is a double screen, and it SUPPRESSES home runs to left.
 *
 * So the term runs 0 at a neutral wall, up to +1 at `peakWallHeightFt`, back through 0 at
 * `closingWallHeightFt`, and on down to -1 at the tallest wall the data allows. A 37-foot wall
 * scores about -0.81, which is what turns Fenway from 112 into 100.
 *
 * The three breakpoints are CHOSEN. They are plausible rather than measured, and the engine
 * records no wall-clearance data at all -- there is no way to fit them from what is stored.
 */
export const homeRunWindow = (wallHeightFt: number): number => {
  const { neutralWallHeightFt: n, peakWallHeightFt: p, closingWallHeightFt: c } = PARK_COEFFICIENTS;
  const tallest = 40; // `parks.json` caps wallHeightFt at 40.
  if (wallHeightFt <= n) return 0;
  if (wallHeightFt <= p) return (wallHeightFt - n) / (p - n);
  if (wallHeightFt <= c) return 1 - (wallHeightFt - p) / (c - p);
  return -Math.min(1, (wallHeightFt - c) / (tallest - c));
};

/** The wall's height term, centred so an 8-foot wall at the neutral distance is exactly 1. */
export const wallHeightFactor = (profile: ParkProfile): number =>
  1 + PARK_COEFFICIENTS.wallHeightGain * wallReach(profile) * homeRunWindow(profile.dimensions.wallHeightFt);

/**
 * RULE 5 -- Foul territory. Composes with the wall rather than adding to it.
 *
 * Generous foul ground means fewer balls are caught foul, so more of them reach the wall at
 * all. The wall then decides whether a ball that arrives becomes a home run or a double. That
 * is a composition, so this is a multiplier applied to the wall term, not a term added to it.
 */
export const foulGroundFactor = (profile: ParkProfile): number => {
  const foul = profile.dimensions.foulGround;
  if (foul === 'generous') return 1 + PARK_COEFFICIENTS.generousFoulHrGain;
  if (foul === 'small') return 1 - PARK_COEFFICIENTS.smallFoulHrLoss;
  return 1;
};

/** Generous foul ground's other half: it raises strikeouts too, and that is its signature. */
export const foulGroundStrikeoutFactor = (profile: ParkProfile): number => {
  const foul = profile.dimensions.foulGround;
  if (foul === 'generous') return 1 + PARK_COEFFICIENTS.generousFoulSoGain;
  if (foul === 'small') return 1 - PARK_COEFFICIENTS.smallFoulSoLoss;
  return 1;
};

export const wallColorFactor = (profile: ParkProfile): number => {
  const colour = profile.dimensions.wallColor;
  if (colour === 'light') return 1 - PARK_COEFFICIENTS.lightWallPenalty;
  if (colour === 'glass') return 1 - PARK_COEFFICIENTS.glassWallPenalty;
  return 1;
};

export const roofCarryFactor = (profile: ParkProfile): number => {
  const roof = profile.dimensions.roof;
  const c = PARK_COEFFICIENTS;
  if (roof === 'dome') return 1 - c.domeCarryLoss;
  if (roof === 'fixed_roof') return 1 - c.fixedRoofCarryLoss;
  if (roof === 'retractable_open') return 1 - c.retractableRoofCarryLoss;
  return 1;
};

/**
 * RULE 2 -- Surface x grass length on ground balls. MULTIPLY.
 *
 * The blueprint is explicit that these are "the same outcome arriving through two doors", so
 * they are a product of two separate indices and are never summed. Soil is a third door into
 * the same outcome and is multiplied in here too, because `soilType` documents that damp clay
 * kills hops in the same way.
 */
export const surfaceFactor = (profile: ParkProfile): number => {
  const surface = profile.dimensions.surface;
  const c = PARK_COEFFICIENTS;
  if (surface === 'turf') return 1 + c.turfGbGain;
  if (surface === 'hybrid') return 1 + c.hybridGbGain;
  return 1;
};

export const grassFactor = (profile: ParkProfile): number => {
  const length = profile.dimensions.grassLength;
  const c = PARK_COEFFICIENTS;
  if (length === 'long') return 1 - c.longGrassGbLoss;
  if (length === 'short') return 1 - c.shortGrassGbLoss;
  return 1;
};

export const soilFactor = (profile: ParkProfile): number => {
  const soil = profile.dimensions.soilType;
  const c = PARK_COEFFICIENTS;
  if (soil === 'damp_heavy') return 1 - c.dampClayGbLoss;
  if (soil === 'dry_hard') return 1 + c.dryHardGbGain;
  return 1;
};

/**
 * Pitcher fatigue rate, from the climate the park is actually exposed to.
 *
 * Reads `roofNeutralisedClimate`, so a dome gets zero fatigue from a hot city. Humidity is
 * added to heat because the data holds them separately for a reason: one hot arid city and
 * one hot humid city at the same temperature are different places to pitch in.
 *
 * Zero means neutral, not "no fatigue" -- the engine already has its own fatigue model from
 * pitch counts, and this is an ENVIRONMENTAL multiplier on top of it, not a replacement.
 */
export const pitcherFatigueRate = (profile: ParkProfile): number => {
  const c = PARK_COEFFICIENTS;
  const effectiveC = roofNeutralisedClimate(profile);
  const heat = Math.max(0, effectiveC - c.comfortC);
  // Humidity is CENTRED on `moderate`, not on `arid`. The first version used arid as the zero
  // point, which left the reference park -- which is moderate, like most of a real league --
  // carrying a permanent 0.0088 fatigue it was supposed to score as exactly neutral.
  // Centring on the common case is also the more defensible choice: an arid park is not "no
  // humidity", it is less than average.
  const humidityIndex = roofNeutralisedHumidity(profile) === 'arid' ? -0.5
    : roofNeutralisedHumidity(profile) === 'moderate' ? 0 : 0.5;
  return heat * c.heatFatigueRate + Math.max(0, humidityIndex) * c.humidityFatigueRate;
};

/* ------------------------------------------------------------------------- *
 * THE FOUR OUTCOME FACTORS
 * ------------------------------------------------------------------------- */

export interface ParkFactors {
  teamId: string;
  /** 1.000 is the reference park. */
  hrFactor: number;
  fbFactor: number;
  gbFactor: number;
  runFactor: number;
  /** 0 is neutral. Multiplies the engine's own pitch-count fatigue. */
  pitcherFatigueRate: number;
  /** The terms that produced `hrFactor`, kept so the screen can show the working. */
  terms: {
    airCarry: number;
    biteLoss: number;
    wallDistance: number;
    wallHeight: number;
    wallColor: number;
    foulGround: number;
    roofCarry: number;
    surface: number;
    grass: number;
    soil: number;
  };
}

export const parkFactorsFor = (profile: ParkProfile): ParkFactors => {
  // RULE 1, both channels, and they multiply rather than add: one is how far the ball goes,
  // the other is how much it moves off the bat.
  const airCarry = airCarryFactor(profile);
  const biteLoss = biteLossFactor(profile);
  const roofCarry = roofCarryFactor(profile);
  const wallDistance = wallDistanceFactor(profile);
  const wallHeight = wallHeightFactor(profile);
  const wallColor = wallColorFactor(profile);
  // RULE 5 composing with RULE 4: foul ground changes how many balls arrive at a wall whose
  // own effect is already a function of its distance and its height.
  const wallCombined = wallDistance * wallHeight * wallColor * foulGroundFactor(profile);

  const hrFactor = airCarry * biteLoss * roofCarry * wallCombined;

  // Fly balls carry with the air and are killed by a roof, so FB is the most air-sensitive
  // channel. Distance matters less for a fly ball than for a home run, so the wall term is
  // applied at roughly half strength. Bite is NOT applied here: losing bite helps a home run
  // because the ball stays in the zone, which is an extra-base-hit effect, not a
  // home-run-or-nothing one.
  const fbFactor = airCarry * roofCarry * (1 + (wallCombined - 1) * 0.45);

  // RULE 2, all three doors multiplied.
  const gbFactor = surfaceFactor(profile) * grassFactor(profile) * soilFactor(profile);

  const fatigue = pitcherFatigueRate(profile);
  const w = PARK_COEFFICIENTS.runWeights;
  const runFactor =
    Math.pow(hrFactor, w.hr) *
    Math.pow(fbFactor, w.fb) *
    Math.pow(gbFactor, w.gb) *
    (1 + fatigue * PARK_COEFFICIENTS.fatigueRunImpact);

  return {
    teamId: profile.teamId,
    hrFactor,
    fbFactor,
    gbFactor,
    runFactor,
    pitcherFatigueRate: fatigue,
    terms: {
      airCarry, biteLoss, wallDistance, wallHeight, wallColor,
      foulGround: foulGroundFactor(profile), roofCarry,
      surface: surfaceFactor(profile), grass: grassFactor(profile), soil: soilFactor(profile),
    },
  };
};

/**
 * How a park's factors scale the engine's eight outcome weights.
 *
 * DELIBERATELY TAKES NO `isHomeBatting`. See the header: home-field advantage is a relative
 * edge and a park factor is an absolute environment, and the two must not be the same thing
 * applied twice. A signature that cannot see which team is batting cannot accidentally make a
 * park a home-team bonus. `gameEngine.ts` looks up the park from the HOME team and passes it
 * in, once per at-bat, and the verifier in `tools/checkParkWiring.ts` asserts that the
 * home/road split of every club's realised scoring tracks its own park.
 *
 * EXHAUSTIVE BY CONSTRUCTION. This is a `Record<AtBatOutcome, ...>` rather than a switch with
 * a default, so adding an outcome to the engine without deciding how a park affects it is a
 * compile error. The first version was a switch whose `default` quietly caught ERR, which is
 * the same silent-fallthrough shape this codebase has been bitten by more than once.
 *
 * Home runs and doubles are wall outcomes and take the HR factor. Singles and triples take
 * the FB factor. Outs, strikeouts, walks and errors take a weaker combined factor, because a
 * park that suppresses scoring does it mostly by turning balls into outs rather than by never
 * letting them be hit -- and errors need a ball to be hit at all.
 */
const OUTCOME_SCALES: Record<AtBatOutcome, (factors: ParkFactors) => number> = {
  HR: (f) => f.hrFactor,
  '2B': (f) => f.hrFactor,
  '1B': (f) => f.fbFactor,
  '3B': (f) => f.fbFactor,
  OUT: (f) => (f.runFactor + 1) / 2,
  SO: (f) => (f.runFactor + 1) / 2,
  BB: (f) => (f.runFactor + 1) / 2,
  ERR: (f) => (f.runFactor + 1) / 2,
};

export const outcomeWeightScales = (
  factors: ParkFactors,
  outcome: AtBatOutcome,
): number => OUTCOME_SCALES[outcome](factors);

/**
 * Scale a whole weight map by one park.
 *
 * Pure, and the ONLY thing the engine calls. It multiplies and nothing else -- no clamping,
 * no renormalising, no inspection of which team is at bat -- so the effect of a park on a
 * game is exactly the product of its four factors, and that can be checked by reading this
 * function rather than by simulating.
 *
 * NOT YET WIRED AT THE TIME OF WRITING; see the module header. This is where Phase 5 calls it.
 */
export const applyParkEnvironment = (
  weights: Record<AtBatOutcome, number>,
  factors: ParkFactors,
): Record<AtBatOutcome, number> => {
  const scaled = {} as Record<AtBatOutcome, number>;
  (Object.keys(weights) as AtBatOutcome[]).forEach((outcome) => {
    scaled[outcome] = weights[outcome] * outcomeWeightScales(factors, outcome);
  });
  return scaled;
};

/**
 * THE LEAGUE MEANS, and the reason the shipped factors are re-centred on them.
 *
 * FOUND BY A BETTING CHECK FAILING. `verifyBetting.ts` reported 64% of games finishing over
 * the posted totals line against an expected 46%. Re-running it with the park application
 * disabled gave 45.5%, which passes -- so the parks were inflating league scoring.
 *
 * The cause was not the size of any park. `parkFactorsFor` is ABSOLUTE: it is calibrated so
 * that an arbitrary NEUTRAL park -- 385-foot walls, sea level, temperate, 8-foot dark wall --
 * scores 1.000. The actual 32 clubs do not average to that park. Measured:
 *
 *     channel   league mean before re-centring   effect on league scoring
 *     HR                   124.8                  x1.248
 *     FB                   111.1                  x1.111
 *     GB                    99.8                  x0.998
 *     RUN                  108.1                  x1.081
 *     FATIGUE             0.0488                  every pitcher in the league fatigued
 *
 * Every game was being multiplied by 1.25 on home runs. A park system that is supposed to
 * DIFFERENTIATE between parks was instead acting as a league-wide scoring boost, and the first
 * thing it broke was a market.
 *
 * A published park factor is a RELATIVE measure: 100 is the league average, always, by
 * construction. Coors at 145 means "45% above the average park", not "45% above a hypothetical
 * park with a 385-foot wall". These parks are not that hypothetical park, so the factors are
 * re-centred on the league that actually exists.
 *
 * WHAT RE-CENTRING DOES AND DOES NOT CHANGE. It divides every park by the same constant per
 * channel, so the DIFFERENCES between parks survive exactly -- measured spread retention is
 * 80% for HR, 90% for FB, 100% for GB, 93% for RUN, and the shortfall is only because the
 * spread is re-expressed around a mean of 1.000 rather than around the neutral park. What
 * changes is that the average game is no longer multiplied by anything.
 *
 * `parkFactorsFor` is left ABSOLUTE, because the archetype check calibrates against absolute
 * targets and a check that silently rescaled its own inputs could not fail. Only the values the
 * ENGINE consumes are re-centred.
 */
const leagueMean = <T,>(values: T[], read: (v: T) => number): number =>
  values.reduce((a, v) => a + read(v), 0) / Math.max(1, values.length);

/** Every park's factors, keyed by team id, RE-CENTRED on the league. */
export const ALL_PARK_FACTORS: ReadonlyMap<string, ParkFactors> = (() => {
  const raw: Array<[string, ParkFactors]> = [];
  ALL_PARK_PROFILES.forEach((profile, teamId) => raw.push([teamId, parkFactorsFor(profile)]));

  const hrMean = leagueMean(raw.map(([, f]) => f), (f) => f.hrFactor);
  const fbMean = leagueMean(raw.map(([, f]) => f), (f) => f.fbFactor);
  const gbMean = leagueMean(raw.map(([, f]) => f), (f) => f.gbFactor);
  const runMean = leagueMean(raw.map(([, f]) => f), (f) => f.runFactor);
  const fatigueMean = leagueMean(raw.map(([, f]) => f), (f) => f.pitcherFatigueRate);

  // A degenerate mean would silently produce NaN factors for every park, and NaN propagates
  // through the outcome weights without ever throwing. Refuse instead.
  for (const [label, m] of [['hr', hrMean], ['fb', fbMean], ['gb', gbMean], ['run', runMean]] as const) {
    if (!Number.isFinite(m) || m === 0) {
      throw new Error(`cannot re-centre park factors: the league mean ${label} factor is ${m}`);
    }
  }

  return new Map(raw.map(([teamId, f]) => [
    teamId,
    {
      ...f,
      hrFactor: f.hrFactor / hrMean,
      fbFactor: f.fbFactor / fbMean,
      gbFactor: f.gbFactor / gbMean,
      runFactor: f.runFactor / runMean,
      // Fatigue is a RATE centred on zero, not an index, so it is shifted rather than scaled.
      // Scaling a signed rate about zero would invert the sign of half the league.
      pitcherFatigueRate: f.pitcherFatigueRate - fatigueMean,
      terms: { ...f.terms },
    },
  ]));
})();

/**
 * A club's factors by team id, or `null` when the club has no park.
 *
 * The `null` case is load-bearing rather than defensive. `parks.json` covers the 32 clubs in
 * `src/data/teams.ts`, and anything else -- a future league, a restored save, a test fixture
 * with two invented clubs -- has no park and must play in no park. Returning a default set of
 * factors instead would silently give an unknown club somebody else's park, which is the one
 * failure this whole module is structured to avoid.
 *
 * NAMING. `parkFactorsFor` takes a PROFILE, because it is a pure function from physical
 * dimensions to factors and is what the archetype check calls. This takes a TEAM ID. The first
 * version of the engine wiring called the profile version with a team id and the compiler
 * caught it, which is the only reason the two are now distinguished at all.
 */
export const parkFactorsForTeam = (teamId: string): ParkFactors | null =>
  ALL_PARK_FACTORS.get(teamId) ?? null;

/** Re-exported so a consumer can compute the neutral point without importing two modules. */
export { ALTITUDE_FT, CLIMATE_C, barometricDensityRatioAtHeight };