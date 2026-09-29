/**
 * New Universe bootstrap.
 *
 * There used to be two unrelated controls for making a player pool. "Terminate
 * Universe" rebuilt teams, settings, schedule, history, draft center and the
 * offseason markers. "Generate Players" swapped playerState and left every one
 * of those in place, so pressing it in 2030 produced a year-one-shaped pool
 * stamped 2030 sitting on 2030 standings with stale offseason markers. Both
 * also stopped at generatePlayerPool, which is a single-shot snapshot: it never
 * ran development and never filled rosters, so the model only engaged a full
 * simulated year later.
 *
 * This module is the one path both controls now call. It runs the same chain
 * the offseason runs -- generate, develop, fill -- so a universe is coherent
 * the moment it exists, and it takes a seed so the same universe can be rebuilt
 * for a clean before/after against a model change.
 */

import { generatePlayerPool } from './playerGenerator';
import { applyPlayerDevelopment } from './playerDevelopment';
import { completeRosterVacancies } from './rosterCompletion';
import { createSeededRandom } from '../lib/random';
import { repairRosterSlotsForTeams } from './rosterManagement';
import { ALL_ROSTER_SLOTS } from '../types';
import type { LeaguePlayerState, PlayerStatus, Team } from '../types';

export const DEFAULT_UNIVERSE_SEED = 1337;

/** Minimum cohort size before an age is allowed to claim the league's peak. */
const PEAK_MIN_SAMPLE = 20;

const OVERALL_TIERS: Array<{ label: string; min: number; max: number }> = [
  { label: '95+ generational', min: 95, max: 201 },
  { label: '90-94 superstar', min: 90, max: 95 },
  { label: '85-89 all-star', min: 85, max: 90 },
  { label: '80-84 above avg', min: 80, max: 85 },
  { label: '75-79 average', min: 75, max: 80 },
  { label: '70-74 journeyman', min: 70, max: 75 },
  { label: 'below 70', min: 0, max: 70 },
];

const tierLabelFor = (overall: number): string =>
  OVERALL_TIERS.find((tier) => overall >= tier.min && overall < tier.max)?.label ?? 'below 70';

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

export interface UniverseAgeRow {
  age: number;
  count: number;
  medianOverall: number;
}

export interface UniverseDiagnostics {
  seasonYear: number;
  seed: number;
  playerCount: number;
  activeCount: number;
  freeAgentCount: number;
  prospectCount: number;
  expectedRosterSlots: number;
  filledRosterSlots: number;
  averageOverall: number;
  medianOverall: number;
  peakAge: number;
  /** Roster spots held by players young enough to still be improving. */
  callUpCount: number;
  age35PlusCount: number;
  ageRows: UniverseAgeRow[];
  tierRows: Array<{ label: string; count: number }>;
  retiredByAgeOut: number;
  elapsedMs: number;
}

export interface BuildNewUniverseResult {
  playerState: LeaguePlayerState;
  diagnostics: UniverseDiagnostics;
}

const countByStatus = (playerState: LeaguePlayerState, status: PlayerStatus): number =>
  playerState.players.filter((player) => player.status === status).length;

/**
 * Latest `overall` per player, batting preferred, matching the resolution the
 * offseason uses so the numbers here describe the same thing the game acts on.
 */
const buildOverallMap = (playerState: LeaguePlayerState): Map<string, number> => {
  const overalls = new Map<string, number>();
  const consider = (rows: Array<{ playerId: string; seasonYear: number; overall: number }>): void => {
    for (const row of [...rows].sort((left, right) => right.seasonYear - left.seasonYear)) {
      if (!overalls.has(row.playerId)) {
        overalls.set(row.playerId, row.overall);
      }
    }
  };
  consider(playerState.battingRatings);
  consider(playerState.pitchingRatings);
  return overalls;
};

const buildDiagnostics = (
  playerState: LeaguePlayerState,
  teams: Team[],
  seasonYear: number,
  seed: number,
  retiredByAgeOut: number,
  startedAt: number,
): UniverseDiagnostics => {
  const overalls = buildOverallMap(playerState);
  const overallValues = [...overalls.values()];

  const ageGroups = new Map<number, number[]>();
  for (const player of playerState.players) {
    if (player.status === 'retired') continue;
    const overall = overalls.get(player.playerId) ?? 0;
    const bucket = ageGroups.get(player.age) ?? [];
    bucket.push(overall);
    ageGroups.set(player.age, bucket);
  }

  const ageRows: UniverseAgeRow[] = [...ageGroups.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([age, values]) => ({ age, count: values.length, medianOverall: median(values) }));

  const peak = ageRows
    // A median over six players is noise: a single 40-year-old can out-rank a
    // 27-year-old cohort purely by luck. Only ages with a real sample get a vote.
    .filter((row) => row.count >= PEAK_MIN_SAMPLE)
    .reduce<UniverseAgeRow | null>(
      (best, row) => (best === null || row.medianOverall > best.medianOverall ? row : best),
      null,
    );

  const tierCounts = new Map<string, number>();
  for (const overall of overallValues) {
    const label = tierLabelFor(overall);
    tierCounts.set(label, (tierCounts.get(label) ?? 0) + 1);
  }

  const rosterSlots = repairRosterSlotsForTeams(playerState, teams.map((team) => team.id), seasonYear).rosterSlots;
  const filledSlots = rosterSlots.filter((slot) => slot.seasonYear === seasonYear && slot.playerId).length;

  return {
    seasonYear,
    seed,
    playerCount: playerState.players.length,
    activeCount: countByStatus(playerState, 'active'),
    freeAgentCount: countByStatus(playerState, 'free_agent'),
    prospectCount: countByStatus(playerState, 'prospect'),
    expectedRosterSlots: teams.length * ALL_ROSTER_SLOTS.length,
    filledRosterSlots: filledSlots,
    averageOverall: overallValues.length ? overallValues.reduce((sum, value) => sum + value, 0) / overallValues.length : 0,
    medianOverall: median(overallValues),
    peakAge: peak?.age ?? 0,
    callUpCount: ageRows.filter((row) => row.age <= 23).reduce((sum, row) => sum + row.count, 0),
    age35PlusCount: ageRows.filter((row) => row.age >= 35).reduce((sum, row) => sum + row.count, 0),
    ageRows,
    tierRows: OVERALL_TIERS.map((tier) => ({ label: tier.label, count: tierCounts.get(tier.label) ?? 0 })),
    retiredByAgeOut,
    elapsedMs: Date.now() - startedAt,
  };
};

/**
 * Builds a complete, immediately-playable universe.
 *
 * The chain is the offseason's, in the same order, for the same reason: ratings
 * have to be written before rosters are filled, or free agency evaluates talent
 * that does not exist yet and the roster repair sees the wrong number of
 * occupied slots.
 */
export const buildNewUniverse = ({
  teams,
  seasonYear,
  seed = DEFAULT_UNIVERSE_SEED,
  effectiveDate,
  retainRatingYears,
}: {
  teams: Team[];
  seasonYear: number;
  seed?: number;
  effectiveDate?: string;
  retainRatingYears?: number;
}): BuildNewUniverseResult => {
  const startedAt = Date.now();
  const rng = createSeededRandom(seed);
  const date = effectiveDate ?? `${seasonYear}-12-15`;

  const generated = generatePlayerPool(teams, seasonYear, rng);

  // Development first: a new pool is raw talent, and rosters have to be filled
  // from the ratings that result, not the ones the generator happened to write.
  const development = applyPlayerDevelopment({
    playerState: generated,
    seasonYear,
    effectiveDate: date,
    ...(retainRatingYears === undefined ? {} : { retainRatingYears }),
  });

  const completed = completeRosterVacancies(teams, development.nextPlayerState, seasonYear, date);

  return {
    playerState: completed.playerState,
    diagnostics: buildDiagnostics(completed.playerState, teams, seasonYear, seed, completed.agedOutFreeAgents, startedAt),
  };
};
