import {
  BATTING_POSITIONS,
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  CORE_ROSTER_SLOTS,
  CoreRosterSlotCode,
  LeaguePlayerState,
  PitcherPosition,
  Player,
  PlayerBattingRatings,
  PlayerPosition,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerStatus,
  RESERVE_ROSTER_SLOTS,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { generatePlayerBio } from './playerBio';
import namePools from '../data/expanded_name_pools.json';

/*
  NAME POOLS LIVE IN `data/expanded_name_pools.json`, not inline here.

  They used to be ten literals in this file, which made every added name a source edit rather
  than a data edit, and made the pool size a fact about this file rather than about the game.
  The JSON is a strict superset of the literals it replaced: no name was dropped in the move,
  only added, so a universe generated from either source keeps every name it had before.

  Destructured with defaults rather than asserted, because a MISSING pool and a pool of zero
  names fail the same way -- `sample` reads index 0 of an empty array and yields `undefined` --
  and a default array fails immediately and legibly instead. Asserting the shape would fail
  just as hard, but would also reject the pools being absent rather than merely empty, which is
  a distinction the generator has no way to honour.
*/
const {
  WESTERN_FIRST,
  WESTERN_LAST,
  HISPANIC_FIRST,
  HISPANIC_LAST,
  JAPANESE_FIRST,
  JAPANESE_LAST,
  KOREAN_FIRST,
  KOREAN_LAST,
  DUTCH_LAST,
  CHINESE_LAST,
} = namePools;

type RandomSource = () => number;
type AgeBucket = 'prospect' | 'peak' | 'veteran';
type OverallTierKey =
  | 'generational'
  | 'superstar'
  | 'all_star'
  | 'support'
  | 'utility'
  | 'journeyman'
  | 'replacement';

interface WeightedEntry<T> {
  value: T;
  weight: number;
}

interface OverallTier {
  key: OverallTierKey;
  min: number;
  max: number;
  weight: number;
}

interface PlayerBlueprint {
  status: PlayerStatus;
  ageBucket: AgeBucket;
  primaryPosition: PlayerPosition;
  teamId: string | null;
  slotCode: RosterSlotCode | null;
  /**
   * Overrides the age the ageBucket would have produced. Active rosters draw
   * from MLB_AGE_WEIGHTS so the league is born with a realistic age shape; the
   * bucket is still derived from the drawn age so potential and years of
   * service stay consistent with it.
   */
  age?: number;
}

const DEFAULT_RANDOM: RandomSource = () => Math.random();

export const DEFAULT_PLAYER_POOL_SIZE = 1320;
export const DEFAULT_DRAFT_CLASS_SIZE = 100;
export const DEFAULT_PLAYER_REPLENISHMENT_THRESHOLD = 1100;

const DEFAULT_SUPPLEMENTAL_POOL_SIZE = 392;
const DEFAULT_PROSPECT_POOL_SIZE = 200;
const RESERVE_BATTER_SLOTS_PER_TEAM = 6;
const SUPPLEMENTAL_BATTER_COUNT = 262;
const SUPPLEMENTAL_PITCHER_TARGETS: Record<PitcherPosition, number> = {
  SP: 20,
  RP: 97,
  CL: 13,
};

const HERITAGE_POOLS = [
  { weight: 50, firstNames: WESTERN_FIRST, lastNames: WESTERN_LAST, westernFirstMixChance: 0 },
  { weight: 29, firstNames: HISPANIC_FIRST, lastNames: HISPANIC_LAST, westernFirstMixChance: 0.3 },
  { weight: 10, firstNames: JAPANESE_FIRST, lastNames: JAPANESE_LAST, westernFirstMixChance: 0.3 },
  { weight: 5, firstNames: KOREAN_FIRST, lastNames: KOREAN_LAST, westernFirstMixChance: 0.3 },
  { weight: 5, firstNames: WESTERN_FIRST, lastNames: DUTCH_LAST, westernFirstMixChance: 0 },
  { weight: 1, firstNames: WESTERN_FIRST, lastNames: CHINESE_LAST, westernFirstMixChance: 0 },
] as const;

const FREE_AGENT_AGE_BUCKETS: Record<Exclude<AgeBucket, 'prospect'>, number> = {
  peak: 144,
  veteran: 48,
};

const SECONDARY_POSITION_MAP: Record<PlayerPosition, PlayerPosition[]> = {
  C: ['1B', 'DH'],
  '1B': ['DH', 'LF'],
  '2B': ['SS', '3B'],
  '3B': ['SS', '1B'],
  SS: ['2B', '3B'],
  LF: ['RF', 'CF', 'DH'],
  CF: ['LF', 'RF'],
  RF: ['LF', 'CF', 'DH'],
  DH: ['1B', 'LF', 'RF'],
  SP: ['RP'],
  RP: ['CL', 'SP'],
  CL: ['RP'],
};

const SLOT_TO_PRIMARY_POSITION: Record<CoreRosterSlotCode, PlayerPosition> = {
  C: 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  SS: 'SS',
  LF: 'LF',
  CF: 'CF',
  RF: 'RF',
  DH: 'DH',
  SP1: 'SP',
  SP2: 'SP',
  SP3: 'SP',
  SP4: 'SP',
  SP5: 'SP',
  RP1: 'RP',
  RP2: 'RP',
  RP3: 'RP',
  RP4: 'RP',
  CL: 'CL',
};

const RESERVE_PITCHER_POSITION_WEIGHTS: Array<WeightedEntry<PitcherPosition>> = [
  { value: 'SP', weight: 2 },
  { value: 'RP', weight: 3 },
  { value: 'CL', weight: 1 },
];

type BatterRatingsProfile = Omit<PlayerBattingRatings, 'playerId' | 'seasonYear'>;
type PitcherRatingsProfile = Omit<PlayerPitchingRatings, 'playerId' | 'seasonYear'>;

const createUuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `plr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

/**
 * Seeded player id.
 *
 * playerDevelopment keys every one of its deterministic rolls on playerId, so an
 * unseeded id here silently breaks reproducibility: two builds of the same seed
 * would draw the same sequence of ages, tiers and attributes but hand each player
 * a different id, and the development pass would then resolve different rolls for
 * all of them. The league would look identical in aggregate while no individual
 * player matched, which is exactly the drift an A/B comparison cannot detect.
 * Deriving the id from the seeded stream makes a seed reproduce the same players,
 * not merely a similar-looking league.
 */
const createSeededId = (rng: RandomSource): string => {
  const hex = (): string => Math.floor(rng() * 0x10000).toString(16).padStart(4, '0');
  return `plr-${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
};

const randomInt = (min: number, max: number, rng: RandomSource): number =>
  Math.floor(rng() * (max - min + 1)) + min;

const clampRating = (value: number): number => Math.max(60, Math.min(100, Math.round(value)));

const ACTIVE_OVERALL_TIERS: OverallTier[] = [
  { key: 'generational', min: 95, max: 100, weight: 1 },
  { key: 'superstar', min: 90, max: 94, weight: 12 },
  { key: 'all_star', min: 85, max: 89, weight: 18 },
  { key: 'support', min: 80, max: 84, weight: 22 },
  { key: 'utility', min: 75, max: 79, weight: 18 },
  { key: 'journeyman', min: 70, max: 74, weight: 14 },
  { key: 'replacement', min: 60, max: 69, weight: 15 },
];

/*
  NO LOCAL ALIAS HERE, and this used to have one.

  `type OverallTierKey = OverallTier['key']` sat here as well as the hand-written union at the top of
  this file -- the same name declared twice in one module scope, which is why tsc carried a "Duplicate
  identifier" error against both lines for as long as it did.

  It was circular rather than useful: `OverallTier.key` is itself typed AS `OverallTierKey`, so the
  derived alias resolved straight back to the union. Removing it changed no type anywhere.

  The union at the top is the one that has to stay, because it is what `OverallTier` derives from.

  WORTH KNOWING about the surviving union: it and `ACTIVE_OVERALL_TIERS` are two sources of truth for
  the same seven keys, and only one drift direction is caught. Adding a tier to the array fails the
  type check, because `OverallTier.key` only admits the union. REMOVING one does not -- the union keeps
  a key no array produces, and any code that switches exhaustively over it is quietly handling a case
  that cannot occur. Deriving the union from the array would close that, but the array is typed
  `OverallTier[]`, so the two would have to be untangled together. Left as-is with the direction
  written down, rather than discovered later.
*/
type PoolStatus = Exclude<PlayerStatus, 'retired'>;

type TierQuotaAllocation = {
  key: OverallTierKey;
  min: number;
  max: number;
  counts: Record<PoolStatus, number>;
};

const PLAYER_POOL_TIER_QUOTAS: TierQuotaAllocation[] = [
  { key: 'generational', min: 95, max: 100, counts: { active: 10, free_agent: 0, prospect: 0 } },
  { key: 'superstar', min: 90, max: 94, counts: { active: 31, free_agent: 0, prospect: 4 } },
  { key: 'all_star', min: 85, max: 89, counts: { active: 115, free_agent: 10, prospect: 20 } },
  { key: 'support', min: 80, max: 84, counts: { active: 200, free_agent: 25, prospect: 55 } },
  { key: 'utility', min: 75, max: 79, counts: { active: 170, free_agent: 40, prospect: 75 } },
  { key: 'journeyman', min: 70, max: 74, counts: { active: 60, free_agent: 54, prospect: 36 } },
  { key: 'replacement', min: 60, max: 69, counts: { active: 22, free_agent: 63, prospect: 10 } },
];

const FREE_AGENT_OVERALL_TIERS: OverallTier[] = [
  { key: 'all_star', min: 85, max: 89, weight: 2 },
  { key: 'support', min: 80, max: 84, weight: 10 },
  { key: 'utility', min: 75, max: 79, weight: 24 },
  { key: 'journeyman', min: 70, max: 74, weight: 28 },
  { key: 'replacement', min: 60, max: 69, weight: 36 },
];

const PROSPECT_OVERALL_TIERS: OverallTier[] = [
  { key: 'superstar', min: 90, max: 94, weight: 1 },
  { key: 'all_star', min: 85, max: 89, weight: 6 },
  { key: 'support', min: 80, max: 84, weight: 18 },
  { key: 'utility', min: 75, max: 79, weight: 32 },
  { key: 'journeyman', min: 70, max: 74, weight: 28 },
  { key: 'replacement', min: 60, max: 69, weight: 15 },
];

const weightedChoice = <T,>(entries: Array<WeightedEntry<T>>, rng: RandomSource): T => {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * totalWeight;

  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.value;
    }
  }

  return entries[entries.length - 1].value;
};

const sample = <T,>(items: T[], rng: RandomSource): T => items[Math.floor(rng() * items.length)];

const shuffle = <T,>(items: T[], rng: RandomSource): T[] => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
};

const distributeEvenly = <T extends string>(values: T[], total: number): Record<T, number> => {
  const base = Math.floor(total / values.length);
  let remainder = total % values.length;

  return values.reduce((result, value) => {
    result[value] = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
    return result;
  }, {} as Record<T, number>);
};

/*
    Repeat each key `count` times, so a bucket count becomes the players in that bucket.

    `Object.entries` was the original, and it cannot typecheck against a `Record<T, number>`: the keys
    of a mapped type are `T`, but `Object.entries` only knows `string`, so its overload resolution
    lands on the `ArrayLike<unknown>` signature and `count` comes back `unknown`. That is the whole of
    this diagnostic, which is why it sat untriaged for so long -- it needs one narrow fact, not an
    investigation.

    The fact is that the keys of a `Record<T, _>` ARE `T`, and this is the one place in the codebase
    that has to be told so. `Object.keys` rather than `Object.entries` keeps the count lookup typed,
    so the `as T[]` above is the only assertion in the function -- and it is a statement about the
    keys, which is true by construction of the parameter.
  */
const buildBucketPool = <T extends string>(counts: Record<T, number>): T[] => {
  const pool: T[] = [];
  (Object.keys(counts) as T[]).forEach((key) => {
    for (let index = 0; index < counts[key]; index += 1) pool.push(key);
  });
  return pool;
};

/**
 * Share of MLB roster spots held by players of each age, used to seed a new
 * universe. The old behaviour split active rosters 75/25 between a flat 23-32
 * "peak" band and a flat 33-39 "veteran" band, which put a quarter of every
 * roster (232 players league-wide) in the tail of a career and left no player
 * under 23 on any active roster at all. A new league has to be born with a
 * young cohort feeding it, or it starts at the end of its own pipeline.
 *
 * These weights are shaped like a real MLB roster: a mode at 26-27, a long
 * right tail, and a thin but real band of 22-year-old call-ups.
 */
const MLB_AGE_WEIGHTS: Array<{ value: number; weight: number }> = [
  { value: 22, weight: 25 },
  { value: 23, weight: 50 },
  { value: 24, weight: 80 },
  { value: 25, weight: 105 },
  { value: 26, weight: 110 },
  { value: 27, weight: 105 },
  { value: 28, weight: 95 },
  { value: 29, weight: 85 },
  { value: 30, weight: 75 },
  { value: 31, weight: 65 },
  { value: 32, weight: 55 },
  { value: 33, weight: 45 },
  { value: 34, weight: 35 },
  { value: 35, weight: 25 },
  { value: 36, weight: 15 },
  { value: 37, weight: 10 },
  { value: 38, weight: 7 },
  { value: 39, weight: 4 },
  { value: 40, weight: 2 },
];

/** Peak under 30, so it can drive potential and service the same way the old bands did. */
const ageBucketForAge = (age: number): Exclude<AgeBucket, 'prospect'> => (age <= 29 ? 'peak' : 'veteran');

const getAgeForBucket = (bucket: AgeBucket, rng: RandomSource): number => {
  if (bucket === 'prospect') {
    return randomInt(18, 22, rng);
  }
  if (bucket === 'peak') {
    return randomInt(23, 32, rng);
  }
  return randomInt(33, 39, rng);
};

/** Draws a roster age from MLB_AGE_WEIGHTS, so a new universe is born on a real age curve. */
const getRosterAge = (rng: RandomSource): number => weightedChoice(MLB_AGE_WEIGHTS, rng);

const getPotential = (status: PlayerStatus, bucket: AgeBucket, rng: RandomSource): number => {
  if (status === 'prospect') {
    return Number((0.62 + rng() * 0.35).toFixed(3));
  }
  if (bucket === 'peak') {
    return Number((0.42 + rng() * 0.46).toFixed(3));
  }
  return Number((0.22 + rng() * 0.38).toFixed(3));
};

const pickOverallTier = (player: Player, rng: RandomSource): OverallTier => {
  const tiers =
    player.status === 'active'
      ? ACTIVE_OVERALL_TIERS
      : player.status === 'prospect'
        ? PROSPECT_OVERALL_TIERS
        : FREE_AGENT_OVERALL_TIERS;

  return weightedChoice(
    tiers.map((tier) => ({
      value: tier,
      weight: tier.weight,
    })),
    rng,
  );
};

const getCurrentOverallBaseline = (player: Player, rng: RandomSource): number => {
  const tier = pickOverallTier(player, rng);
  const base = randomInt(tier.min, tier.max, rng);
  const ageCurve =
    player.age <= 21 ? -2
      : player.age <= 24 ? 0
        : player.age <= 29 ? 2
          : player.age <= 32 ? 1
            : player.age <= 35 ? -1
              : -3;
  const potentialLift = Math.round((player.potential - 0.5) * 8);
  return clampRating(base + ageCurve + potentialLift);
};

const getPotentialOverall = (player: Player, currentOverall: number, rng: RandomSource): number => {
  const growthWindow =
    player.age <= 20 ? randomInt(8, 16, rng)
      : player.age <= 24 ? randomInt(5, 11, rng)
        : player.age <= 28 ? randomInt(2, 7, rng)
          : player.age <= 32 ? randomInt(0, 4, rng)
            : randomInt(-3, 2, rng);
  const potentialBias = Math.round((player.potential - 0.5) * 10);
  return clampRating(currentOverall + growthWindow + potentialBias);
};

const varyAttribute = (base: number, spread: number, rng: RandomSource): number =>
  clampRating(base + randomInt(-spread, spread, rng));

const sampleTierOverall = (min: number, max: number, rng: RandomSource): number => {
  const triangular = (rng() + rng() + rng()) / 3;
  return clampRating(min + triangular * (max - min));
};

const alignBatterProfileOverall = (
  profile: Omit<BatterRatingsProfile, 'overall' | 'potentialOverall'>,
  targetOverall: number,
): Omit<BatterRatingsProfile, 'overall' | 'potentialOverall'> => {
  const adjusted = { ...profile };
  for (let index = 0; index < 8; index += 1) {
    const current = getBatterOverall(adjusted);
    const delta = targetOverall - current;
    if (Math.abs(delta) <= 1) {
      break;
    }
    const step = Math.sign(delta) * Math.max(1, Math.ceil(Math.abs(delta) / 2));
    adjusted.contact = clampRating(adjusted.contact + step);
    adjusted.power = clampRating(adjusted.power + step);
    adjusted.plateDiscipline = clampRating(adjusted.plateDiscipline + step);
    adjusted.avoidStrikeout = clampRating(adjusted.avoidStrikeout + step);
    adjusted.speed = clampRating(adjusted.speed + Math.sign(delta));
    adjusted.baserunning = clampRating(adjusted.baserunning + Math.sign(delta));
    adjusted.fielding = clampRating(adjusted.fielding + Math.sign(delta));
    adjusted.arm = clampRating(adjusted.arm + Math.sign(delta));
  }
  return adjusted;
};

const alignPitcherProfileOverall = (
  profile: Omit<PitcherRatingsProfile, 'overall' | 'potentialOverall'>,
  targetOverall: number,
): Omit<PitcherRatingsProfile, 'overall' | 'potentialOverall'> => {
  const adjusted = { ...profile };
  for (let index = 0; index < 8; index += 1) {
    const current = getPitcherOverall(adjusted);
    const delta = targetOverall - current;
    if (Math.abs(delta) <= 1) {
      break;
    }
    const step = Math.sign(delta) * Math.max(1, Math.ceil(Math.abs(delta) / 2));
    adjusted.stuff = clampRating(adjusted.stuff + step);
    adjusted.command = clampRating(adjusted.command + step);
    adjusted.control = clampRating(adjusted.control + step);
    adjusted.movement = clampRating(adjusted.movement + step);
    adjusted.stamina = clampRating(adjusted.stamina + Math.sign(delta));
    adjusted.holdRunners = clampRating(adjusted.holdRunners + Math.sign(delta));
    adjusted.fielding = clampRating(adjusted.fielding + Math.sign(delta));
  }
  return adjusted;
};

const getBatterPositionBias = (position: PlayerPosition) => {
  switch (position) {
    case 'C':
      return { contact: 0, power: -2, plateDiscipline: 1, avoidStrikeout: 0, speed: -10, baserunning: -8, fielding: 8, arm: 9 };
    case '1B':
      return { contact: 2, power: 8, plateDiscipline: 1, avoidStrikeout: -1, speed: -10, baserunning: -7, fielding: -1, arm: -2 };
    case '2B':
      return { contact: 4, power: -2, plateDiscipline: 2, avoidStrikeout: 3, speed: 5, baserunning: 4, fielding: 6, arm: 1 };
    case '3B':
      return { contact: 1, power: 6, plateDiscipline: 0, avoidStrikeout: -1, speed: -2, baserunning: -2, fielding: 3, arm: 8 };
    case 'SS':
      return { contact: 3, power: -1, plateDiscipline: 1, avoidStrikeout: 2, speed: 6, baserunning: 5, fielding: 9, arm: 6 };
    case 'LF':
      return { contact: 1, power: 4, plateDiscipline: 0, avoidStrikeout: -1, speed: 0, baserunning: 0, fielding: -1, arm: 1 };
    case 'CF':
      return { contact: 2, power: -2, plateDiscipline: 1, avoidStrikeout: 1, speed: 9, baserunning: 7, fielding: 8, arm: 3 };
    case 'RF':
      return { contact: 1, power: 5, plateDiscipline: 0, avoidStrikeout: -1, speed: 1, baserunning: 0, fielding: 1, arm: 8 };
    case 'DH':
      return { contact: 4, power: 8, plateDiscipline: 3, avoidStrikeout: 1, speed: -12, baserunning: -10, fielding: -14, arm: -10 };
    default:
      return { contact: 0, power: 0, plateDiscipline: 0, avoidStrikeout: 0, speed: 0, baserunning: 0, fielding: 0, arm: 0 };
  }
};

const getPitcherPositionBias = (position: PlayerPosition) => {
  switch (position) {
    case 'SP':
      return { stuff: 2, command: 3, control: 3, movement: 1, stamina: 12, holdRunners: 1, fielding: 1 };
    case 'RP':
      return { stuff: 6, command: 1, control: 0, movement: 3, stamina: -10, holdRunners: 1, fielding: 0 };
    case 'CL':
      return { stuff: 8, command: 4, control: 1, movement: 4, stamina: -14, holdRunners: 2, fielding: 0 };
    default:
      return { stuff: 0, command: 0, control: 0, movement: 0, stamina: 0, holdRunners: 0, fielding: 0 };
  }
};

const getBatterOverall = (profile: Omit<BatterRatingsProfile, 'overall' | 'potentialOverall'>): number =>
  clampRating(
    profile.contact * 0.23 +
      profile.power * 0.2 +
      profile.plateDiscipline * 0.12 +
      profile.avoidStrikeout * 0.11 +
      profile.speed * 0.1 +
      profile.baserunning * 0.08 +
      profile.fielding * 0.1 +
      profile.arm * 0.06,
  );

const getPitcherOverall = (profile: Omit<PitcherRatingsProfile, 'overall' | 'potentialOverall'>): number =>
  clampRating(
    profile.stuff * 0.28 +
      profile.command * 0.19 +
      profile.control * 0.17 +
      profile.movement * 0.16 +
      profile.stamina * 0.12 +
      profile.holdRunners * 0.04 +
      profile.fielding * 0.04,
  );

const createBattingRatingsProfile = (player: Player, targetOverall: number, rng: RandomSource): BatterRatingsProfile => {
  const currentOverall = targetOverall;
  const potentialOverall = getPotentialOverall(player, currentOverall, rng);
  const bias = getBatterPositionBias(player.primaryPosition);
  const spread = player.status === 'prospect' ? 10 : 7;

  const rawProfile = alignBatterProfileOverall({
    contact: varyAttribute(currentOverall + bias.contact, spread, rng),
    power: varyAttribute(currentOverall + bias.power, spread, rng),
    plateDiscipline: varyAttribute(currentOverall + bias.plateDiscipline, spread, rng),
    avoidStrikeout: varyAttribute(currentOverall + bias.avoidStrikeout, spread, rng),
    speed: varyAttribute(currentOverall + bias.speed, spread, rng),
    baserunning: varyAttribute(currentOverall + bias.baserunning, spread, rng),
    fielding: varyAttribute(currentOverall + bias.fielding, spread, rng),
    arm: varyAttribute(currentOverall + bias.arm, spread, rng),
  }, currentOverall);

  return {
    ...rawProfile,
    overall: getBatterOverall(rawProfile),
    potentialOverall: Math.max(getBatterOverall(rawProfile), potentialOverall),
  };
};

const createPitchingRatingsProfile = (player: Player, targetOverall: number, rng: RandomSource): PitcherRatingsProfile => {
  const currentOverall = targetOverall;
  const potentialOverall = getPotentialOverall(player, currentOverall, rng);
  const bias = getPitcherPositionBias(player.primaryPosition);
  const spread = player.status === 'prospect' ? 10 : 7;

  const rawProfile = alignPitcherProfileOverall({
    stuff: varyAttribute(currentOverall + bias.stuff, spread, rng),
    command: varyAttribute(currentOverall + bias.command, spread, rng),
    control: varyAttribute(currentOverall + bias.control, spread, rng),
    movement: varyAttribute(currentOverall + bias.movement, spread, rng),
    stamina: varyAttribute(currentOverall + bias.stamina, spread, rng),
    holdRunners: varyAttribute(currentOverall + bias.holdRunners, spread, rng),
    fielding: varyAttribute(currentOverall + bias.fielding, spread, rng),
  }, currentOverall);

  return {
    ...rawProfile,
    overall: getPitcherOverall(rawProfile),
    potentialOverall: Math.max(getPitcherOverall(rawProfile), potentialOverall),
  };
};

const createBattingRatings = (player: Player, seasonYear: number, targetOverall: number, rng: RandomSource): PlayerBattingRatings => ({
  playerId: player.playerId,
  seasonYear,
  ...createBattingRatingsProfile(player, targetOverall, rng),
});

const createPitchingRatings = (player: Player, seasonYear: number, targetOverall: number, rng: RandomSource): PlayerPitchingRatings => ({
  playerId: player.playerId,
  seasonYear,
  ...createPitchingRatingsProfile(player, targetOverall, rng),
});

const getThrowHand = (primaryPosition: PlayerPosition, rng: RandomSource): 'L' | 'R' => {
  if (primaryPosition === 'SP' || primaryPosition === 'RP' || primaryPosition === 'CL') {
    return rng() < 0.28 ? 'L' : 'R';
  }
  return rng() < 0.12 ? 'L' : 'R';
};

const getBatHand = (primaryPosition: PlayerPosition, throws: 'L' | 'R', rng: RandomSource): 'L' | 'R' | 'S' => {
  if (primaryPosition === 'SP' || primaryPosition === 'RP' || primaryPosition === 'CL') {
    if (throws === 'L') {
      return rng() < 0.68 ? 'L' : 'R';
    }
    return rng() < 0.2 ? 'L' : 'R';
  }

  const roll = rng();
  if (roll < 0.1) {
    return 'S';
  }
  if (roll < 0.36) {
    return 'L';
  }
  return 'R';
};

const getSecondaryPosition = (primaryPosition: PlayerPosition, rng: RandomSource): PlayerPosition | null => {
  const options = SECONDARY_POSITION_MAP[primaryPosition] ?? [];
  if (options.length === 0 || rng() > 0.38) {
    return null;
  }
  return sample(options, rng);
};

const getYearsPro = (age: number, status: PlayerStatus, rng: RandomSource): number => {
  if (status === 'prospect') {
    return 0;
  }

  const baseline = Math.max(1, age - 21);
  const variance = randomInt(-2, 2, rng);
  return Math.max(1, baseline + variance);
};

const buildUniqueName = (
  usedFullNames: Set<string>,
  rng: RandomSource,
): { firstName: string; lastName: string } => {
  for (let attempt = 0; attempt < 5000; attempt += 1) {
    const pool = weightedChoice(
      HERITAGE_POOLS.map((entry) => ({ value: entry, weight: entry.weight })),
      rng,
    );
    const useWesternFirst = pool.westernFirstMixChance > 0 && rng() < pool.westernFirstMixChance;
    const firstName = sample(useWesternFirst ? WESTERN_FIRST : [...pool.firstNames], rng);
    const lastName = sample([...pool.lastNames], rng);
    const fullName = `${firstName} ${lastName}`;

    if (!usedFullNames.has(fullName)) {
      usedFullNames.add(fullName);
      return { firstName, lastName };
    }
  }

  throw new Error('Failed to generate a unique player name.');
};

const createPlayerFromBlueprint = (
  blueprint: PlayerBlueprint,
  seasonYear: number,
  usedFullNames: Set<string>,
  rng: RandomSource,
): Player => {
  const age = blueprint.age ?? getAgeForBucket(blueprint.ageBucket, rng);
  const yearsPro = getYearsPro(age, blueprint.status, rng);
  const draftClassYear = blueprint.status === 'prospect' ? seasonYear : Math.max(seasonYear - yearsPro, seasonYear - Math.max(age - 18, 1));
  const names = buildUniqueName(usedFullNames, rng);
  const throws = getThrowHand(blueprint.primaryPosition, rng);
  const bats = getBatHand(blueprint.primaryPosition, throws, rng);
  const bio = generatePlayerBio(blueprint.primaryPosition, blueprint.status, age, rng);

  return {
    playerId: createSeededId(rng),
    teamId: blueprint.teamId,
    firstName: names.firstName,
    lastName: names.lastName,
    playerType: blueprint.primaryPosition === 'SP' || blueprint.primaryPosition === 'RP' || blueprint.primaryPosition === 'CL' ? 'pitcher' : 'batter',
    primaryPosition: blueprint.primaryPosition,
    secondaryPosition: getSecondaryPosition(blueprint.primaryPosition, rng),
    bats,
    throws,
    age,
    height: bio.height,
    weightLbs: bio.weightLbs,
    potential: getPotential(blueprint.status, blueprint.ageBucket, rng),
    status: blueprint.status,
    contractYearsLeft: bio.contractYearsLeft,
    draftClassYear,
    draftRound: blueprint.status === 'prospect' ? null : randomInt(1, 20, rng),
    yearsPro,
    retirementYear: null,
  };
};

const createEmptyBattingStat = (playerId: string, seasonYear: number): PlayerSeasonBatting => ({
  playerId,
  seasonYear,
  seasonPhase: 'regular_season',
  gamesPlayed: 0,
  plateAppearances: 0,
  atBats: 0,
  runsScored: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  rbi: 0,
  avg: 0,
  ops: 0,
});

const createEmptyPitchingStat = (playerId: string, seasonYear: number): PlayerSeasonPitching => ({
  playerId,
  seasonYear,
  seasonPhase: 'regular_season',
  wins: 0,
  losses: 0,
  saves: 0,
  games: 0,
  gamesStarted: 0,
  inningsPitched: 0,
  hitsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
  era: 0,
  whip: 0,
});

const getReservePrimaryPosition = (reserveIndex: number, rng: RandomSource): PlayerPosition =>
  reserveIndex < RESERVE_BATTER_SLOTS_PER_TEAM
    ? sample(BATTING_POSITIONS, rng)
    : weightedChoice(RESERVE_PITCHER_POSITION_WEIGHTS, rng);

const getActiveRosterBlueprints = (teams: Team[], rng: RandomSource): PlayerBlueprint[] =>
  teams.flatMap((team) =>
    [
      ...CORE_ROSTER_SLOTS.map((slotCode) => {
        const age = getRosterAge(rng);
        return {
          status: 'active' as const,
          ageBucket: ageBucketForAge(age),
          age,
          primaryPosition: SLOT_TO_PRIMARY_POSITION[slotCode],
          teamId: team.id,
          slotCode,
        };
      }),
      ...RESERVE_ROSTER_SLOTS.map((slotCode, reserveIndex) => {
        const age = getRosterAge(rng);
        return {
          status: 'active' as const,
          ageBucket: ageBucketForAge(age),
          age,
          primaryPosition: getReservePrimaryPosition(reserveIndex, rng),
          teamId: team.id,
          slotCode,
        };
      }),
    ],
  );

const getTargetPositionCounts = (activeBlueprints: PlayerBlueprint[]): Record<PlayerPosition, number> => {
  const batterTargets = distributeEvenly(BATTING_POSITIONS, SUPPLEMENTAL_BATTER_COUNT);
  const activeCounts = activeBlueprints.reduce(
    (counts, blueprint) => {
      counts[blueprint.primaryPosition] += 1;
      return counts;
    },
    {
      C: 0,
      '1B': 0,
      '2B': 0,
      '3B': 0,
      SS: 0,
      LF: 0,
      CF: 0,
      RF: 0,
      DH: 0,
      SP: 0,
      RP: 0,
      CL: 0,
    } as Record<PlayerPosition, number>,
  );

  return {
    C: activeCounts.C + batterTargets.C,
    '1B': activeCounts['1B'] + batterTargets['1B'],
    '2B': activeCounts['2B'] + batterTargets['2B'],
    '3B': activeCounts['3B'] + batterTargets['3B'],
    SS: activeCounts.SS + batterTargets.SS,
    LF: activeCounts.LF + batterTargets.LF,
    CF: activeCounts.CF + batterTargets.CF,
    RF: activeCounts.RF + batterTargets.RF,
    DH: activeCounts.DH + batterTargets.DH,
    SP: activeCounts.SP + SUPPLEMENTAL_PITCHER_TARGETS.SP,
    RP: activeCounts.RP + SUPPLEMENTAL_PITCHER_TARGETS.RP,
    CL: activeCounts.CL + SUPPLEMENTAL_PITCHER_TARGETS.CL,
  };
};

const getRemainingPositionPool = (activeBlueprints: PlayerBlueprint[], rng: RandomSource): PlayerPosition[] => {
  const targetCounts = getTargetPositionCounts(activeBlueprints);

  activeBlueprints.forEach((blueprint) => {
    targetCounts[blueprint.primaryPosition] -= 1;
  });

  return shuffle(
    (Object.entries(targetCounts) as Array<[PlayerPosition, number]>).flatMap(([position, count]) =>
      Array.from({ length: count }, () => position),
    ),
    rng,
  );
};

const getSupplementalBlueprints = (activeBlueprints: PlayerBlueprint[], rng: RandomSource): PlayerBlueprint[] => {
  const remainingPositions = getRemainingPositionPool(activeBlueprints, rng);
  const prospectPositions = remainingPositions.slice(0, DEFAULT_PROSPECT_POOL_SIZE);
  const freeAgentPositions = remainingPositions.slice(DEFAULT_PROSPECT_POOL_SIZE, DEFAULT_SUPPLEMENTAL_POOL_SIZE);
  const freeAgentAgeBuckets = shuffle(buildBucketPool(FREE_AGENT_AGE_BUCKETS), rng);

  const prospectBlueprints: PlayerBlueprint[] = prospectPositions.map((position) => ({
    status: 'prospect',
    ageBucket: 'prospect',
    primaryPosition: position,
    teamId: null,
    slotCode: null,
  }));

  const freeAgentBlueprints: PlayerBlueprint[] = freeAgentPositions.map((position, index) => ({
    status: 'free_agent',
    ageBucket: freeAgentAgeBuckets[index] ?? 'peak',
    primaryPosition: position,
    teamId: null,
    slotCode: null,
  }));

  return [...prospectBlueprints, ...freeAgentBlueprints];
};

const buildOverallBaselineMap = (players: Player[], rng: RandomSource): Map<string, number> => {
  const playersByStatus: Record<PoolStatus, Player[]> = {
    active: shuffle(players.filter((player) => player.status === 'active'), rng),
    free_agent: shuffle(players.filter((player) => player.status === 'free_agent'), rng),
    prospect: shuffle(players.filter((player) => player.status === 'prospect'), rng),
  };
  const statusIndexes: Record<PoolStatus, number> = {
    active: 0,
    free_agent: 0,
    prospect: 0,
  };
  const baselineMap = new Map<string, number>();

  PLAYER_POOL_TIER_QUOTAS.forEach((quota) => {
    (Object.keys(quota.counts) as PoolStatus[]).forEach((status) => {
      const count = quota.counts[status];
      for (let index = 0; index < count; index += 1) {
        const player = playersByStatus[status][statusIndexes[status]];
        statusIndexes[status] += 1;
        if (!player) {
          continue;
        }
        baselineMap.set(player.playerId, sampleTierOverall(quota.min, quota.max, rng));
      }
    });
  });

  players.forEach((player) => {
    if (!baselineMap.has(player.playerId)) {
      const fallbackTier = pickOverallTier(player, rng);
      baselineMap.set(player.playerId, sampleTierOverall(fallbackTier.min, fallbackTier.max, rng));
    }
  });

  return baselineMap;
};

export const generatePlayerPool = (
  teams: Team[],
  seasonYear: number,
  rng: RandomSource = DEFAULT_RANDOM,
): LeaguePlayerState => {
  const activeBlueprints = getActiveRosterBlueprints(teams, rng);
  const supplementalBlueprints = getSupplementalBlueprints(activeBlueprints, rng);
  const usedFullNames = new Set<string>();
  const allPlayers = [...activeBlueprints, ...supplementalBlueprints].map((blueprint) =>
    createPlayerFromBlueprint(blueprint, seasonYear, usedFullNames, rng),
  );
  const overallBaselineMap = buildOverallBaselineMap(allPlayers, rng);

  const rosterSlots: TeamRosterSlot[] = allPlayers
    .filter((player, index) => activeBlueprints[index]?.slotCode)
    .map((player, index) => ({
      seasonYear,
      teamId: activeBlueprints[index].teamId as string,
      slotCode: activeBlueprints[index].slotCode as RosterSlotCode,
      playerId: player.playerId,
    }));

  const battingStats: PlayerSeasonBatting[] = allPlayers
    .filter((player) => player.playerType === 'batter')
    .map((player) => createEmptyBattingStat(player.playerId, seasonYear));

  const pitchingStats: PlayerSeasonPitching[] = allPlayers
    .filter((player) => player.playerType === 'pitcher')
    .map((player) => createEmptyPitchingStat(player.playerId, seasonYear));

  const battingRatings: PlayerBattingRatings[] = allPlayers
    .filter((player) => player.playerType === 'batter')
    .map((player) => createBattingRatings(player, seasonYear, overallBaselineMap.get(player.playerId) ?? 75, rng));

  const pitchingRatings: PlayerPitchingRatings[] = allPlayers
    .filter((player) => player.playerType === 'pitcher')
    .map((player) => createPitchingRatings(player, seasonYear, overallBaselineMap.get(player.playerId) ?? 75, rng));

  return {
    players: allPlayers,
    battingStats,
    pitchingStats,
    battingRatings,
    pitchingRatings,
    rosterSlots,
    transactions: [],
  };
};

export const shouldGenerateDraftClass = (
  players: Player[],
  threshold = DEFAULT_PLAYER_REPLENISHMENT_THRESHOLD,
): boolean =>
  players.filter((player) => player.status === 'active' || player.status === 'free_agent').length < threshold;

export const generateDraftClass = (
  seasonYear: number,
  count = DEFAULT_DRAFT_CLASS_SIZE,
  rng: RandomSource = DEFAULT_RANDOM,
): Player[] => {
  const targetCounts: Record<PlayerPosition, number> = {
    ...distributeEvenly(BATTING_POSITIONS, SUPPLEMENTAL_BATTER_COUNT),
    ...SUPPLEMENTAL_PITCHER_TARGETS,
  };
  const usedFullNames = new Set<string>();
  const weightedPositions: Array<WeightedEntry<PlayerPosition>> = [
    ...Object.entries(targetCounts).map(([position, weight]) => ({
      value: position as PlayerPosition,
      weight,
    })),
  ];

  return Array.from({ length: count }, () => {
    const player = createPlayerFromBlueprint(
      {
        status: 'prospect',
        ageBucket: 'prospect',
        primaryPosition: weightedChoice(weightedPositions, rng),
        teamId: null,
        slotCode: null,
      },
      seasonYear,
      usedFullNames,
      rng,
    );

    return {
      ...player,
      age: randomInt(18, 20, rng),
      yearsPro: 0,
      draftClassYear: seasonYear,
    };
  });
};
