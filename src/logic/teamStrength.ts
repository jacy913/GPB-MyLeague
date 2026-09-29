import { LeaguePlayerState, PlayerBattingRatings, PlayerPitchingRatings, Team } from '../types';

/**
 * Team strength derived from the players actually holding roster slots.
 *
 * This replaces a formula that read a team's rating off its own win total. That
 * was a feedback loop: winning raised the rating, the rating produced more wins,
 * and no amount of roster management could touch it. It was also only ever
 * called from the diagnostic harness, so in the shipped game team strength was
 * whatever the static value in data/teams.ts happened to be, frozen at universe
 * creation.
 *
 * The scale is deliberately the same one the players are rated on. The at-bat
 * engine multiplies the rating gap by TEAM_EDGE_WEIGHT and adds it to the same
 * edge sum as a batter-versus-pitcher attribute gap, so expressing team strength
 * on the player's own scale is what keeps those two comparable: a 7-point
 * roster-quality gap now produces the same edge magnitude as a 7-point gap
 * between a good and bad pitcher.
 */

/**
 * Coefficient applied to the rating gap at gameEngine.ts:483. Kept here so the
 * scale chosen for team ratings and the scale the engine consumes cannot drift
 * apart silently.
 */
export const TEAM_EDGE_WEIGHT = 0.65;

/**
 * Players with no usable rating row contribute this instead of zero. Zero would
 * drag a team's mean down on a single missing row and make an incomplete roster
 * look catastrophic; the league mean is the honest neutral value, because a
 * player of unknown quality is a player of average expected quality.
 */
const FALLBACK_OVERALL = 79;

const latestBattingByPlayer = (ratings: PlayerBattingRatings[]): Map<string, number> => {
  const next = new Map<string, { overall: number; seasonYear: number }>();
  for (const rating of ratings) {
    const held = next.get(rating.playerId);
    if (!held || rating.seasonYear > held.seasonYear) next.set(rating.playerId, { overall: rating.overall, seasonYear: rating.seasonYear });
  }
  return new Map([...next].map(([playerId, row]) => [playerId, row.overall]));
};

const latestPitchingByPlayer = (ratings: PlayerPitchingRatings[]): Map<string, number> => {
  const next = new Map<string, { overall: number; seasonYear: number }>();
  for (const rating of ratings) {
    const held = next.get(rating.playerId);
    if (!held || rating.seasonYear > held.seasonYear) next.set(rating.playerId, { overall: rating.overall, seasonYear: rating.seasonYear });
  }
  return new Map([...next].map(([playerId, row]) => [playerId, row.overall]));
};

/**
 * Mean latest overall of the players each team has under contract for a season.
 *
 * Exported on its own so the harness can report the spread it is grading on
 * without re-deriving the roster-shape rules.
 */
export const getTeamRosterStrength = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): Map<string, number> => {
  const battingOverall = latestBattingByPlayer(playerState.battingRatings);
  const pitchingOverall = latestPitchingByPlayer(playerState.pitchingRatings);

  // Mirrors getPlayerOverall in offseasonFreeAgency: a two-way player's batting
  // rating wins. Consistency matters because that same helper decides who retires
  // and who the market signs, and a team rated on a different definition than
  // the players in it would be internally inconsistent.
  const overallFor = (playerId: string): number =>
    battingOverall.get(playerId) ?? pitchingOverall.get(playerId) ?? FALLBACK_OVERALL;

  // Same rule repairRosterSlotsForTeams applies, for the same reason. A new
  // season has no slot rows until something repairs it, so grading strictly on
  // the requested year finds nothing and collapses every team onto the fallback.
  // The newest year that actually has rows is the honest roster to read.
  const latestSlotYear = playerState.rosterSlots.reduce(
    (latest, slot) => Math.max(latest, slot.seasonYear),
    0,
  );
  const ratingYear = Math.max(latestSlotYear, seasonYear);

  const rosteredPlayerIdsByTeam = new Map<string, string[]>();
  for (const slot of playerState.rosterSlots) {
    if (slot.seasonYear !== ratingYear) continue;
    const existing = rosteredPlayerIdsByTeam.get(slot.teamId);
    if (existing) existing.push(slot.playerId);
    else rosteredPlayerIdsByTeam.set(slot.teamId, [slot.playerId]);
  }

  const strength = new Map<string, number>();
  for (const team of teams) {
    const playerIds = rosteredPlayerIdsByTeam.get(team.id) ?? [];
    if (playerIds.length === 0) {
      strength.set(team.id, FALLBACK_OVERALL);
      continue;
    }
    const total = playerIds.reduce((sum, playerId) => sum + overallFor(playerId), 0);
    strength.set(team.id, total / playerIds.length);
  }
  return strength;
};

/**
 * Mean roster strength across the league, or FALLBACK_OVERALL when there is
 * nothing to average.
 */
export const getLeagueMeanStrength = (strength: Map<string, number>): number => {
  if (strength.size === 0) return FALLBACK_OVERALL;
  let total = 0;
  for (const value of strength.values()) total += value;
  return total / strength.size;
};

/**
 * A team's roster strength relative to the league average, in rating points.
 *
 * Every consumer that wants to know "is this a good team" should read this
 * rather than team.rating directly. The absolute value is a meaningless ~79-85
 * cluster; only the gap to the league mean carries information, and a consumer
 * that compares the raw rating against a hardcoded constant is silently reading
 * a scale that changes whenever the player generator's weights do.
 *
 * Positive means better than average, roughly in the range -4..+4.
 */
export const getTeamStrengthEdge = (team: Team, strength: Map<string, number>): number =>
  (strength.get(team.id) ?? FALLBACK_OVERALL) - getLeagueMeanStrength(strength);

/**
 * Rewrites team.rating from the roster. Returns new team objects; the input is
 * not mutated, because callers hold it in React state and elsewhere in the
 * season.
 *
 * A team with an empty roster is left alone rather than reset to the fallback:
 * an empty roster is a broken state, and overwriting the stored value would hide
 * that instead of surfacing it.
 */
export const recalculateTeamRatingsFromRosters = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): Team[] => {
  const strength = getTeamRosterStrength(teams, playerState, seasonYear);
  return teams.map((team) => {
    const rosterStrength = strength.get(team.id);
    if (rosterStrength === undefined || rosterStrength <= 0) return { ...team };
    return { ...team, rating: Math.round(rosterStrength * 10) / 10 };
  });
};
