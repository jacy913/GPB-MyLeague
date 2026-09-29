/**
 * Player development and aging.
 *
 * Before this module, player ratings were written once at generation time and
 * never changed. A 39-year-old played exactly like a 24-year-old of the same
 * tier, forever, so dynasty arcs were impossible and a century-long universe
 * produced the same distribution every year.
 *
 * This module writes a fresh ratings row per player for each new season year.
 * The existing schema already supports multi-year history — `seasonYear` is on
 * every ratings row, and every consumer in the codebase already resolves
 * "latest" by sorting on it descending. The storage was built for this; the
 * writes were missing.
 *
 * Everything here is deterministic. Randomness is drawn from a stable hash of
 * (playerId, seasonYear, trait), so the same seed always produces the same
 * hundred years of player development. That is what makes it possible to change
 * one curve and re-run to see exactly what it did.
 */

import {
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PitcherPosition,
} from '../types';

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * FNV-1a hash to a float in [0, 1). Matches the scheme already used by
 * offseasonFreeAgency.ts so the two modules feel like one system.
 */
const stableRoll = (key: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
};

/** Stable roll centred on zero, in roughly [-1, 1]. */
const stableNoise = (key: string): number => stableRoll(key) * 2 - 1;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Matches clampRating in playerGenerator.ts so overalls stay on the same scale. */
const clampRating = (value: number): number => clamp(Math.round(value), 60, 100);

// ---------------------------------------------------------------------------
// Age curves
// ---------------------------------------------------------------------------

/**
 * Each attribute ages on its own schedule. Speed leaves first, arm and plate
 * discipline leave last. That asymmetry is the whole point — a flat overall
 * curve produces interchangeable players, and interchangeable players produce
 * a dead universe.
 */
interface AttributeCurve {
  /** Age at which this attribute stops improving. */
  peakAge: number;
  /** Points per year gained while still rising toward the peak. */
  riseSlope: number;
  /** Points per year lost after the peak. */
  fallSlope: number;
  /** Hard floor. Nobody's speed goes to zero. */
  floor: number;
}

const BATTING_CURVES = {
  contact: { peakAge: 29, riseSlope: 1.5, fallSlope: 0.85, floor: 52 },
  power: { peakAge: 29, riseSlope: 1.4, fallSlope: 1.0, floor: 52 },
  plateDiscipline: { peakAge: 30, riseSlope: 1.1, fallSlope: 0.65, floor: 52 },
  avoidStrikeout: { peakAge: 28, riseSlope: 1.25, fallSlope: 0.9, floor: 48 },
  speed: { peakAge: 25, riseSlope: 1.1, fallSlope: 1.85, floor: 42 },
  baserunning: { peakAge: 26, riseSlope: 1.0, fallSlope: 1.6, floor: 45 },
  fielding: { peakAge: 27, riseSlope: 1.0, fallSlope: 1.3, floor: 48 },
  arm: { peakAge: 29, riseSlope: 0.8, fallSlope: 0.6, floor: 48 },
} as const satisfies Record<string, AttributeCurve>;

const PITCHING_CURVES = {
  stuff: { peakAge: 27, riseSlope: 1.7, fallSlope: 1.4, floor: 48 },
  command: { peakAge: 29, riseSlope: 1.1, fallSlope: 0.7, floor: 48 },
  control: { peakAge: 28, riseSlope: 1.0, fallSlope: 0.7, floor: 48 },
  movement: { peakAge: 29, riseSlope: 0.9, fallSlope: 0.6, floor: 48 },
  stamina: { peakAge: 26, riseSlope: 1.0, fallSlope: 2.0, floor: 38 },
  holdRunners: { peakAge: 29, riseSlope: 0.8, fallSlope: 0.7, floor: 48 },
  fielding: { peakAge: 27, riseSlope: 0.9, fallSlope: 1.2, floor: 48 },
} as const satisfies Record<string, AttributeCurve>;

/** Overall weights copied from playerGenerator.ts so recomputed overalls agree. */
const BATTING_OVERALL_WEIGHTS = {
  contact: 0.23,
  power: 0.2,
  plateDiscipline: 0.12,
  avoidStrikeout: 0.11,
  speed: 0.1,
  baserunning: 0.08,
  fielding: 0.1,
  arm: 0.06,
} as const;

const PITCHING_OVERALL_WEIGHTS = {
  stuff: 0.28,
  command: 0.19,
  control: 0.17,
  movement: 0.16,
  stamina: 0.12,
  holdRunners: 0.04,
  fielding: 0.04,
} as const;

// ---------------------------------------------------------------------------
// Per-player traits
// ---------------------------------------------------------------------------

interface PlayerTraits {
  /** Shifts the whole curve. Positive means a late bloomer. */
  bloomShift: number;
  /** Multiplies every fall slope. Below 1 is a long career. */
  durability: number;
  /** Scales how much headroom a young player can still reach. */
  ceilingReach: number;
  /** Extra noise on every yearly delta, in rating points. */
  volatility: number;
}

/**
 * Real careers are not averages. Some guys arrive ready, some figure it out at
 * 27, some fall apart early. These traits are fixed for a player's lifetime and
 * derived from their id, so they are stable across re-runs.
 */
const getTraits = (playerId: string): PlayerTraits => {
  const bloomRoll = stableRoll(`${playerId}:trait:bloom`);
  const durabilityRoll = stableRoll(`${playerId}:trait:durability`);
  const reachRoll = stableRoll(`${playerId}:trait:reach`);
  const volatilityRoll = stableRoll(`${playerId}:trait:volatility`);

  return {
    // Skewed so that late bloomers outnumber early bloomers, which matches
    // reality, but neither extreme is common.
    bloomShift: (bloomRoll * bloomRoll - 0.25) * 6,
    durability: 0.76 + durabilityRoll * 0.52,
    ceilingReach: 0.88 + reachRoll * 0.28,
    volatility: 0.3 + volatilityRoll * 0.9,
  };
};

// ---------------------------------------------------------------------------
// Positional wear
// ---------------------------------------------------------------------------

/**
 * Extra fall applied to specific attributes based on where a player plays.
 * A shortstop and a first baseman of identical ratings are not the same player
 * at 35, because the shortstop's job is built out of the things that go first.
 */
const BATTING_POSITION_WEAR: Partial<Record<string, Partial<Record<keyof typeof BATTING_CURVES, number>>>> = {
  C: { fielding: 0.7, arm: 0.3, speed: 0.25 },
  SS: { fielding: 0.6, speed: 0.4, baserunning: 0.3 },
  CF: { speed: 0.5, fielding: 0.4, baserunning: 0.3 },
  '2B': { fielding: 0.35, speed: 0.25 },
  '3B': { fielding: 0.3, arm: 0.2 },
  LF: {},
  RF: { arm: 0.15 },
  '1B': {},
  DH: { speed: 0.2 },
};

const PITCHER_POSITION_WEAR: Partial<Record<string, Partial<Record<keyof typeof PITCHING_CURVES, number>>>> = {
  SP: { stamina: 0.7 },
  RP: { stuff: 0.35, stamina: 0.2 },
  CL: { stuff: 0.45, stamina: 0.25 },
};

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * Playing time is the strongest single predictor of whether a young player
 * develops. A 23-year-old logging 550 plate appearances should out-develop a
 * teammate with the same ceiling logging 120.
 *
 * Returns a multiplier where ~1.0 is a full-time role.
 */
const getUsageMultiplier = (player: Player, batting: PlayerSeasonBatting | null, pitching: PlayerSeasonPitching | null): number => {
  if (player.playerType === 'batter') {
    const pa = batting?.plateAppearances ?? 0;
    if (pa <= 0) return 0.45;
    // 550 PA is a full-time bat, 150 is a bench role.
    return clamp(0.55 + (pa / 550) * 0.6, 0.4, 1.35);
  }

  const ip = pitching?.inningsPitched ?? 0;
  if (ip <= 0) return 0.55;
  // 200 IP is a full rotation slot, 40 is occasional relief.
  return clamp(0.6 + (ip / 200) * 0.55, 0.45, 1.3);
};

// ---------------------------------------------------------------------------
// Injury
// ---------------------------------------------------------------------------

/**
 * Injuries are modelled as a one- or two-year ratings penalty rather than a
 * schema field, so nothing downstream needs to learn about a new concept. The
 * penalty decays, which is roughly how a player coming off a serious injury
 * actually looks — diminished for a while, then back.
 */
interface InjuryState {
  severity: number;
  yearsRemaining: number;
}

const rollInjury = (player: Player, seasonYear: number): InjuryState | null => {
  if (player.status === 'retired' || player.status === 'prospect') return null;

  // Pitchers break more. It is not close in the real data.
  const baseChance = player.playerType === 'pitcher' ? 0.075 : 0.03;
  const ageRisk = player.age >= 33 ? 0.02 : 0;

  if (stableRoll(`${player.playerId}:${seasonYear}:injury`) > baseChance + ageRisk) return null;

  const severity = 2 + stableRoll(`${player.playerId}:${seasonYear}:injury:severity`) * 5;
  const years = severity > 5 ? 2 : 1;
  return { severity, yearsRemaining: years };
};

const getInjuryPenalty = (player: Player, seasonYear: number): number => {
  // An injury struck N seasons ago still bites, but less each year.
  for (let back = 0; back < 2; back += 1) {
    const struckYear = seasonYear - 1 - back;
    if (struckYear < 1) break;
    const severityRoll = stableRoll(`${player.playerId}:${struckYear}:injury:severity`);
    const baseChance = player.playerType === 'pitcher' ? 0.075 : 0.03;
    const ageRisk = player.age - back >= 33 ? 0.02 : 0;
    if (stableRoll(`${player.playerId}:${struckYear}:injury`) > baseChance + ageRisk) continue;

    const severity = 2 + severityRoll * 5;
    return severity * (back === 0 ? 1 : 0.5);
  }
  return 0;
};

// ---------------------------------------------------------------------------
// Core curve projection
// ---------------------------------------------------------------------------

/**
 * The yearly delta for one attribute. Exported so it can be unit tested and so
 * the league lab can plot a curve without mutating any state.
 */
export const projectAttributeDelta = (
  attribute: keyof typeof BATTING_CURVES | keyof typeof PITCHING_CURVES,
  age: number,
  current: number,
  potential: number,
  traits: PlayerTraits,
  wear: number,
  usageMultiplier: number,
  seasonKey: string,
): number => {
  const curve = (BATTING_CURVES as Record<string, AttributeCurve>)[attribute]
    ?? (PITCHING_CURVES as Record<string, AttributeCurve>)[attribute];
  if (!curve) return 0;

  const peakAge = curve.peakAge + traits.bloomShift;
  let delta = age < peakAge
    ? (peakAge - age) * curve.riseSlope
    : -(age - peakAge) * curve.fallSlope * traits.durability;

  // Positional wear only ever hurts, and only after the peak.
  if (wear > 0 && age >= peakAge) {
    delta -= (age - peakAge) * wear;
  }

  // Playing time amplifies development and cushions decline.
  delta *= delta >= 0 ? usageMultiplier : clamp(1.5 - usageMultiplier, 0.7, 1.15);

  // Headroom. A 23-year-old at 70 with an 88 ceiling has room; a 23-year-old
  // already at his ceiling does not.
  if (delta > 0) {
    const headroom = Math.max(0, potential - current);
    if (headroom <= 0) return 0;
    const proximity = clamp(headroom / 12, 0.12, 1);
    delta *= proximity * traits.ceilingReach;
  }

  // Career noise. Late-career decline gets extra variance because that is when
  // real players fall off cliffs rather than slopes.
  const noiseScale = delta < 0 && age > 32 ? traits.volatility * 1.3 : traits.volatility;
  delta += stableNoise(seasonKey) * noiseScale;

  return delta;
};

// ---------------------------------------------------------------------------
// Rating row projection
// ---------------------------------------------------------------------------

const projectBattingRatings = (
  player: Player,
  current: PlayerBattingRatings,
  traits: PlayerTraits,
  usageMultiplier: number,
  injuryPenalty: number,
  nextSeasonYear: number,
): PlayerBattingRatings => {
  const wear = BATTING_POSITION_WEAR[player.primaryPosition] ?? {};
  const potential = current.potentialOverall;

  const next = { ...current, seasonYear: nextSeasonYear };

  (Object.keys(BATTING_CURVES) as Array<keyof typeof BATTING_CURVES>).forEach((attribute) => {
    const curve = BATTING_CURVES[attribute];
    const positionWear = wear[attribute] ?? 0;

    // Contact, power and discipline define a hitter's identity, so injuries
    // and wear barely touch them. Everything else moves more freely.
    const identityWeight = attribute === 'contact' || attribute === 'power' || attribute === 'plateDiscipline' ? 0.4 : 1;

    const delta = projectAttributeDelta(
      attribute,
      player.age,
      current[attribute],
      potential,
      traits,
      positionWear,
      usageMultiplier,
      `${player.playerId}:${nextSeasonYear}:bat:${attribute}`,
    );

    const injured = injuryPenalty * identityWeight;
    next[attribute] = clampRating(current[attribute] + delta - injured);
    // Re-apply the floor after rounding, since a rounded value can dip below.
    next[attribute] = Math.max(curve.floor, next[attribute]);
  });

  const overall = (Object.keys(BATTING_OVERALL_WEIGHTS) as Array<keyof typeof BATTING_OVERALL_WEIGHTS>).reduce(
    (sum, attribute) => sum + next[attribute] * BATTING_OVERALL_WEIGHTS[attribute],
    0,
  );
  next.overall = clampRating(overall);
  next.potentialOverall = clampRating(projectPotential(potential, player, traits, nextSeasonYear));

  return next;
};

const projectPitchingRatings = (
  player: Player,
  current: PlayerPitchingRatings,
  traits: PlayerTraits,
  usageMultiplier: number,
  injuryPenalty: number,
  nextSeasonYear: number,
): PlayerPitchingRatings => {
  const wear = PITCHER_POSITION_WEAR[player.primaryPosition as PitcherPosition] ?? {};
  const potential = current.potentialOverall;

  const next = { ...current, seasonYear: nextSeasonYear };

  (Object.keys(PITCHING_CURVES) as Array<keyof typeof PITCHING_CURVES>).forEach((attribute) => {
    const curve = PITCHING_CURVES[attribute];
    const positionWear = wear[attribute] ?? 0;

    // Stuff is the identity of a pitcher and the hardest thing to replace.
    const identityWeight = attribute === 'stuff' ? 0.35 : 1;

    const delta = projectAttributeDelta(
      attribute,
      player.age,
      current[attribute],
      potential,
      traits,
      positionWear,
      usageMultiplier,
      `${player.playerId}:${nextSeasonYear}:pit:${attribute}`,
    );

    const injured = injuryPenalty * identityWeight;
    next[attribute] = clampRating(current[attribute] + delta - injured);
    next[attribute] = Math.max(curve.floor, next[attribute]);
  });

  const overall = (Object.keys(PITCHING_OVERALL_WEIGHTS) as Array<keyof typeof PITCHING_OVERALL_WEIGHTS>).reduce(
    (sum, attribute) => sum + next[attribute] * PITCHING_OVERALL_WEIGHTS[attribute],
    0,
  );
  next.overall = clampRating(overall);
  next.potentialOverall = clampRating(projectPotential(potential, player, traits, nextSeasonYear));

  return next;
};

/**
 * Potential is not permanent. A 26-year-old with a 90 ceiling still has one; a
 * 36-year-old's ceiling is basically the player he currently is, which is what
 * stops late bloomers from being a 38-year-old becoming a 92-overall player.
 */
const projectPotential = (
  potential: number,
  player: Player,
  traits: PlayerTraits,
  nextSeasonYear: number,
): number => {
  if (player.age <= 27) {
    // Young players can still reveal a little more ceiling than expected.
    const upside = stableNoise(`${player.playerId}:${nextSeasonYear}:potential:upside`) * 1.2;
    return potential + Math.max(0, upside);
  }
  if (player.age <= 31) return potential;
  return potential - (player.age - 31) * (0.9 * (2 - traits.durability));
};

// ---------------------------------------------------------------------------
// Latest-row resolution
// ---------------------------------------------------------------------------

const getLatestBattingRatings = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const byPlayer = new Map<string, PlayerBattingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!byPlayer.has(rating.playerId)) byPlayer.set(rating.playerId, rating);
    });
  return byPlayer;
};

const getLatestPitchingRatings = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const byPlayer = new Map<string, PlayerPitchingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!byPlayer.has(rating.playerId)) byPlayer.set(rating.playerId, rating);
    });
  return byPlayer;
};

const getLatestBattingStats = (stats: PlayerSeasonBatting[], seasonYear: number): Map<string, PlayerSeasonBatting> => {
  const byPlayer = new Map<string, PlayerSeasonBatting>();
  [...stats]
    .filter((stat) => stat.seasonYear <= seasonYear)
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((stat) => {
      if (!byPlayer.has(stat.playerId)) byPlayer.set(stat.playerId, stat);
    });
  return byPlayer;
};

const getLatestPitchingStats = (stats: PlayerSeasonPitching[], seasonYear: number): Map<string, PlayerSeasonPitching> => {
  const byPlayer = new Map<string, PlayerSeasonPitching>();
  [...stats]
    .filter((stat) => stat.seasonYear <= seasonYear)
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((stat) => {
      if (!byPlayer.has(stat.playerId)) byPlayer.set(stat.playerId, stat);
    });
  return byPlayer;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PlayerDevelopmentSummary {
  seasonYear: number;
  playersDeveloped: number;
  bigGains: number;
  bigDeclines: number;
  injuredPlayers: number;
  averageOverall: number;
}

export interface PlayerDevelopmentResult {
  nextPlayerState: LeaguePlayerState;
  summary: PlayerDevelopmentSummary;
}

export interface ApplyPlayerDevelopmentArgs {
  playerState: LeaguePlayerState;
  /** The season being developed into. Players must already be aged to this year. */
  seasonYear: number;
  effectiveDate: string;
  /**
   * Keep only this many seasons of ratings history. Omit or pass null to keep
   * everything. Ratings rows grow by roughly one per player per year, so a
   * hundred-year run adds ~130k rows; trimming keeps long runs cheap.
   */
  retainRatingYears?: number | null;
}

/**
 * Writes a new ratings row for every active player for the coming season.
 *
 * Call this after players have been aged and retirements resolved, and before
 * the draft and free agency run, so that roster filling evaluates current
 * talent rather than a stale snapshot.
 */
export const applyPlayerDevelopment = ({
  playerState,
  seasonYear,
  effectiveDate,
  retainRatingYears = null,
}: ApplyPlayerDevelopmentArgs): PlayerDevelopmentResult => {
  void effectiveDate;

  const battingByPlayer = getLatestBattingRatings(playerState.battingRatings);
  const pitchingByPlayer = getLatestPitchingRatings(playerState.pitchingRatings);
  const battingStatsByPlayer = getLatestBattingStats(playerState.battingStats, seasonYear - 1);
  const pitchingStatsByPlayer = getLatestPitchingStats(playerState.pitchingStats, seasonYear - 1);

  const newBattingRatings: PlayerBattingRatings[] = [];
  const newPitchingRatings: PlayerPitchingRatings[] = [];

  let playersDeveloped = 0;
  let bigGains = 0;
  let bigDeclines = 0;
  let injuredPlayers = 0;
  let overallTotal = 0;

  playerState.players.forEach((player) => {
    if (player.status === 'retired') return;

    const traits = getTraits(player.playerId);
    const battingStats = battingStatsByPlayer.get(player.playerId) ?? null;
    const pitchingStats = pitchingStatsByPlayer.get(player.playerId) ?? null;
    const usageMultiplier = getUsageMultiplier(player, battingStats, pitchingStats);
    const injuryPenalty = getInjuryPenalty(player, seasonYear);
    if (injuryPenalty > 0) injuredPlayers += 1;

    const currentBatting = battingByPlayer.get(player.playerId) ?? null;
    const currentPitching = pitchingByPlayer.get(player.playerId) ?? null;

    if (currentBatting) {
      const projected = projectBattingRatings(player, currentBatting, traits, usageMultiplier, injuryPenalty, seasonYear);
      newBattingRatings.push(projected);
      overallTotal += projected.overall;
      const change = projected.overall - currentBatting.overall;
      if (change >= 4) bigGains += 1;
      if (change <= -4) bigDeclines += 1;
      playersDeveloped += 1;
    }

    if (currentPitching) {
      const projected = projectPitchingRatings(player, currentPitching, traits, usageMultiplier, injuryPenalty, seasonYear);
      newPitchingRatings.push(projected);
      overallTotal += projected.overall;
      const change = projected.overall - currentPitching.overall;
      if (change >= 4) bigGains += 1;
      if (change <= -4) bigDeclines += 1;
      playersDeveloped += 1;
    }
  });

  let battingRatings = [...playerState.battingRatings, ...newBattingRatings];
  let pitchingRatings = [...playerState.pitchingRatings, ...newPitchingRatings];

  if (retainRatingYears !== null && Number.isFinite(retainRatingYears) && retainRatingYears > 0) {
    const cutoff = seasonYear - Math.floor(retainRatingYears) + 1;
    battingRatings = battingRatings.filter((rating) => rating.seasonYear >= cutoff);
    pitchingRatings = pitchingRatings.filter((rating) => rating.seasonYear >= cutoff);
  }

  return {
    nextPlayerState: {
      ...playerState,
      battingRatings,
      pitchingRatings,
    },
    summary: {
      seasonYear,
      playersDeveloped,
      bigGains,
      bigDeclines,
      injuredPlayers,
      averageOverall: playersDeveloped > 0 ? overallTotal / playersDeveloped : 0,
    },
  };
};

/**
 * Rolling projection of a player's overall at each future age, ignoring usage
 * and injury. Used by the league lab to plot what the curve looks like.
 */
export const projectOverallCurve = (startingAge: number, startingOverall: number, potentialOverall: number, years: number): Array<{ age: number; overall: number }> => {
  const traits: PlayerTraits = { bloomShift: 0, durability: 1, ceilingReach: 1, volatility: 0 };
  const curve: Array<{ age: number; overall: number }> = [];
  let overall = startingOverall;

  for (let offset = 0; offset <= years; offset += 1) {
    const age = startingAge + offset;
    const attribute = 'contact';
    overall = clampRating(
      overall + projectAttributeDelta(
        attribute,
        age,
        overall,
        potentialOverall,
        traits,
        0,
        1,
        `projection:${age}:${attribute}`,
      ),
    );
    curve.push({ age, overall });
  }

  return curve;
};
