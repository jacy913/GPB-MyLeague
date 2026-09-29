import {
  ALL_ROSTER_SLOTS,
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { generateDraftClassBundle } from './draftLogic';
import { repairRosterSlotsForTeams } from './rosterManagement';
import { getLeagueMeanStrength, getTeamRosterStrength } from './teamStrength';

export interface RosterCompletionResult {
  playerState: LeaguePlayerState;
  freeAgentsSigned: number;
  rookiesAdded: number;
  agedOutFreeAgents: number;
  filledSlots: number;
  remainingOpenSlots: number;
}

/**
 * Free agents at or beyond this age leave the league if the market did not want
 * them. Retirement already covers the 30+ range on a probability curve, so this
 * is deliberately set high: it is a floor on the pool size, not a talent
 * judgement. A club will sign a 33-year-old; it will not sign a 35-year-old.
 */
const FREE_AGENT_AGE_OUT = 35;

/**
 * Removes players and every row that belongs to them. Ratings and stat rows are
 * pruned alongside the player so a long-running universe does not accumulate
 * orphans for players who no longer exist.
 */
const removePlayersFromState = (playerState: LeaguePlayerState, playerIds: Set<string>): LeaguePlayerState => ({
  ...playerState,
  players: playerState.players.filter((player) => !playerIds.has(player.playerId)),
  battingStats: playerState.battingStats.filter((row) => !playerIds.has(row.playerId)),
  pitchingStats: playerState.pitchingStats.filter((row) => !playerIds.has(row.playerId)),
  battingRatings: playerState.battingRatings.filter((row) => !playerIds.has(row.playerId)),
  pitchingRatings: playerState.pitchingRatings.filter((row) => !playerIds.has(row.playerId)),
  rosterSlots: playerState.rosterSlots.filter((slot) => !slot.playerId || !playerIds.has(slot.playerId)),
});

export type OpenSlot = {
  teamId: string;
  slotCode: RosterSlotCode;
};

const getLatestRatings = <T extends { playerId: string; seasonYear: number }>(ratings: T[]): Map<string, T> => {
  const next = new Map<string, T>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
    });
  return next;
};

const getOverall = (
  player: Player,
  battingRatings: Map<string, PlayerBattingRatings>,
  pitchingRatings: Map<string, PlayerPitchingRatings>,
): number => battingRatings.get(player.playerId)?.overall ?? pitchingRatings.get(player.playerId)?.overall ?? 0;

const isPitchingSlot = (slotCode: RosterSlotCode): boolean =>
  STARTING_PITCHER_SLOTS.includes(slotCode as typeof STARTING_PITCHER_SLOTS[number]) ||
  BULLPEN_ROSTER_SLOTS.includes(slotCode as typeof BULLPEN_ROSTER_SLOTS[number]);

const isEligibleForSlot = (player: Player, slotCode: RosterSlotCode): boolean => {
  if (slotCode === 'BN1' || slotCode.startsWith('BN')) return true;
  if (isPitchingSlot(slotCode)) return player.playerType === 'pitcher';
  return player.playerType === 'batter';
};

const getFitScore = (
  player: Player,
  slotCode: RosterSlotCode,
  teamStrengthEdge: number,
  battingRatings: Map<string, PlayerBattingRatings>,
  pitchingRatings: Map<string, PlayerPitchingRatings>,
): number => {
  if (!isEligibleForSlot(player, slotCode)) return Number.NEGATIVE_INFINITY;

  const overall = getOverall(player, battingRatings, pitchingRatings);
  let positionBonus = 0;
  if (slotCode.startsWith('SP')) {
    positionBonus = player.primaryPosition === 'SP' ? 180 : player.secondaryPosition === 'SP' ? 90 : player.primaryPosition === 'RP' ? 35 : 0;
  } else if (slotCode.startsWith('RP')) {
    positionBonus = player.primaryPosition === 'RP' ? 160 : player.primaryPosition === 'CL' ? 120 : player.secondaryPosition === 'RP' ? 80 : 0;
  } else if (slotCode === 'CL') {
    positionBonus = player.primaryPosition === 'CL' ? 180 : player.primaryPosition === 'RP' ? 120 : player.secondaryPosition === 'CL' ? 80 : 0;
  } else if (player.primaryPosition === slotCode) {
    positionBonus = 180;
  } else if (player.secondaryPosition === slotCode) {
    positionBonus = 90;
  } else if (slotCode === 'DH' && ['1B', 'LF', 'RF', '3B', 'C'].includes(player.primaryPosition)) {
    positionBonus = 45;
  }

  // The team term is a tiebreak between equally talented players, not a driver:
  // overall * 16 puts one rating point at 16, and this puts a full league-wide
  // spread of roster strength (about 6 rating points) at 9. It reads the edge
  // against the league mean rather than the raw rating, so it keeps its size
  // when the player generator's weights change the absolute scale.
  return overall * 16 + positionBonus + teamStrengthEdge * 1.5;
};

/**
 * Slots with no occupant for a season. Exported so a caller can measure the
 * vacancy count without re-deriving the roster shape; if this changes, both the
 * filler and any report of vacancies have to change together.
 */
export const getOpenSlots = (rosterSlots: TeamRosterSlot[], teams: Team[], seasonYear: number): OpenSlot[] => {
  const occupied = new Set(
    rosterSlots
      .filter((slot) => slot.seasonYear === seasonYear)
      .map((slot) => `${slot.teamId}:${slot.slotCode}`),
  );

  return teams.flatMap((team) =>
    ALL_ROSTER_SLOTS
      .filter((slotCode) => !occupied.has(`${team.id}:${slotCode}`))
      .map((slotCode) => ({ teamId: team.id, slotCode })),
  );
};

const chooseBestAssignment = (
  players: Player[],
  openSlots: OpenSlot[],
  teamStrengthEdgeByTeamId: Map<string, number>,
  battingRatings: Map<string, PlayerBattingRatings>,
  pitchingRatings: Map<string, PlayerPitchingRatings>,
): { player: Player; slot: OpenSlot } | null => {
  let best: { player: Player; slot: OpenSlot; score: number } | null = null;

  openSlots.forEach((slot) => {
    const teamStrengthEdge = teamStrengthEdgeByTeamId.get(slot.teamId);
    if (teamStrengthEdge === undefined) return;

    players.forEach((player) => {
      const score = getFitScore(player, slot.slotCode, teamStrengthEdge, battingRatings, pitchingRatings);
      if (score > (best?.score ?? Number.NEGATIVE_INFINITY)) {
        best = { player, slot, score };
      }
    });
  });

  return best ? { player: best.player, slot: best.slot } : null;
};

const assignPlayerToTeam = (
  playerState: LeaguePlayerState,
  player: Player,
  teamId: string,
  seasonYear: number,
  effectiveDate: string,
  eventType: 'signed' | 'drafted',
): LeaguePlayerState => {
  const players = playerState.players.map((candidate) =>
    candidate.playerId === player.playerId
      ? {
          ...candidate,
          teamId,
          status: 'active' as const,
          contractYearsLeft: Math.max(1, candidate.contractYearsLeft || 1),
        }
      : { ...candidate },
  );
  const repaired = repairRosterSlotsForTeams({ ...playerState, players }, [teamId], seasonYear);

  return {
    ...playerState,
    players,
    rosterSlots: repaired.rosterSlots,
    transactions: [
      {
        playerId: player.playerId,
        eventType,
        fromTeamId: null,
        toTeamId: teamId,
        effectiveDate,
        notes: eventType === 'drafted' ? 'Added during roster completion draft replenishment.' : 'Signed during roster completion.',
      },
      ...playerState.transactions,
    ],
  };
};

export const completeRosterVacancies = (
  teams: Team[],
  inputPlayerState: LeaguePlayerState,
  seasonYear: number,
  effectiveDate: string,
): RosterCompletionResult => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  // Fit scoring needs each team's roster strength relative to the league mean,
  // not its raw rating. Computing it here means the whole market is graded
  // against one consistent baseline rather than each call recomputing it.
  const strength = getTeamRosterStrength(teams, inputPlayerState, seasonYear);
  const leagueMean = getLeagueMeanStrength(strength);
  const teamStrengthEdgeByTeamId = new Map(teams.map((team) => [team.id, (strength.get(team.id) ?? leagueMean) - leagueMean]));
  let battingRatings = getLatestRatings(inputPlayerState.battingRatings);
  let pitchingRatings = getLatestRatings(inputPlayerState.pitchingRatings);
  let playerState = {
    ...inputPlayerState,
    players: inputPlayerState.players.map((player) => ({ ...player })),
    rosterSlots: inputPlayerState.rosterSlots.map((slot) => ({ ...slot })),
    transactions: inputPlayerState.transactions.map((transaction) => ({ ...transaction })),
  };
  let freeAgentsSigned = 0;
  let rookiesAdded = 0;

  playerState = {
    ...playerState,
    rosterSlots: repairRosterSlotsForTeams(playerState, teams.map((team) => team.id), seasonYear).rosterSlots,
  };

  const assignAvailablePlayers = (candidates: Player[], eventType: 'signed' | 'drafted'): number => {
    let assigned = 0;
    let openSlots = getOpenSlots(playerState.rosterSlots, teams, seasonYear);
    const available = [...candidates];

    while (available.length > 0 && openSlots.length > 0) {
      const assignment = chooseBestAssignment(available, openSlots, teamStrengthEdgeByTeamId, battingRatings, pitchingRatings);
      if (!assignment) break;
      playerState = assignPlayerToTeam(playerState, assignment.player, assignment.slot.teamId, seasonYear, effectiveDate, eventType);
      const playerIndex = available.findIndex((player) => player.playerId === assignment.player.playerId);
      if (playerIndex >= 0) available.splice(playerIndex, 1);
      openSlots = getOpenSlots(playerState.rosterSlots, teams, seasonYear);
      assigned += 1;
    }

    return assigned;
  };

  freeAgentsSigned = assignAvailablePlayers(
    playerState.players.filter((player) => player.status === 'free_agent'),
    'signed',
  );

  let openSlots = getOpenSlots(playerState.rosterSlots, teams, seasonYear);
  if (openSlots.length > 0) {
    // Generate close to what is actually needed. The old `Math.max(32, openSlots * 2)`
    // produced a large surplus even for a single vacancy, and every surplus
    // player stayed in the league forever because prospects are exempt from
    // retirement. A modest cushion still gives the fit scorer real competition
    // without generating an army of players nobody will ever sign.
    const targetRookies = Math.min(
      Math.max(openSlots.length + Math.ceil(openSlots.length * 0.25), 12),
      ALL_ROSTER_SLOTS.length * teams.length,
    );
    const rookieBundle = generateDraftClassBundle(seasonYear, targetRookies);
    const rookieIds = new Set(rookieBundle.players.map((rookie) => rookie.playerId));
    const existingIds = new Set(playerState.players.map((player) => player.playerId));
    playerState = {
      ...playerState,
      players: [
        ...playerState.players,
        ...rookieBundle.players.filter((player) => !existingIds.has(player.playerId)),
      ],
      battingStats: [...playerState.battingStats, ...rookieBundle.battingStats],
      pitchingStats: [...playerState.pitchingStats, ...rookieBundle.pitchingStats],
      battingRatings: [...playerState.battingRatings, ...rookieBundle.battingRatings],
      pitchingRatings: [...playerState.pitchingRatings, ...rookieBundle.pitchingRatings],
    };
    battingRatings = getLatestRatings(playerState.battingRatings);
    pitchingRatings = getLatestRatings(playerState.pitchingRatings);
    rookiesAdded = assignAvailablePlayers(
      playerState.players.filter((player) => rookieIds.has(player.playerId)),
      'drafted',
    );

    // Anyone the fit scorer did not place takes the open road and re-enters the
    // market as a free agent, which is what happens to an unsigned player in
    // real baseball. Leaving them as 'prospect' was the leak: getRetirementChance
    // returns 0 for prospects, so they never age out and the pool grew forever.
    playerState = {
      ...playerState,
      players: playerState.players.map((player) =>
        player.status === 'prospect' && rookieIds.has(player.playerId)
          ? { ...player, status: 'free_agent' as const, contractYearsLeft: 0 }
          : player,
      ),
    };
  }

  // Hard backstop for free agents the market never wanted. Retirement already
  // covers the 30+ range, so this only catches players who linger past the
  // point where any club would sign them. Without a floor like this, the free
  // agent pool simply becomes the place the old prospect leak goes instead.
  const staleFreeAgents = playerState.players.filter(
    (player) => player.status === 'free_agent' && player.age >= FREE_AGENT_AGE_OUT,
  );

  openSlots = getOpenSlots(playerState.rosterSlots, teams, seasonYear);
  const finalPlayerState = staleFreeAgents.length > 0
    ? removePlayersFromState(playerState, new Set(staleFreeAgents.map((player) => player.playerId)))
    : playerState;

  return {
    playerState: finalPlayerState,
    freeAgentsSigned,
    rookiesAdded,
    agedOutFreeAgents: staleFreeAgents.length,
    filledSlots: freeAgentsSigned + rookiesAdded,
    remainingOpenSlots: openSlots.length,
  };
};
