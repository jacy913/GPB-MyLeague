import type {
  Game,
  LeaguePlayerState,
  SeasonHistoryAwardWinner,
  SeasonHistoryStaffWinner,
  Team,
} from '../types';
import {
  buildAwardsForBoard,
  type AwardEntry,
  type AwardInputs,
} from './awardRace';
import { getBattingRatingsAsOfSeason, getPitchingRatingsAsOfSeason } from '../logic/playerStats';
import { isRegularSeasonGame } from '../logic/playoffs';

export const SEASON_AWARDS_VERSION = 2;
export const AWARD_MIN_BATTING_AT_BATS = 120;
export const AWARD_MIN_PITCHER_STARTS = 8;
export const AWARD_MIN_CLOSER_SAVES = 25;
export const STAFF_PRIOR_WINS_WEIGHT = 0.15;
export const STAFF_PRIOR_WINS_REGRESSION = 0.5;

const getSluggingPercentage = (stat: LeaguePlayerState['battingStats'][number]): number => {
  if (stat.atBats <= 0) return 0;
  const singles = Math.max(0, stat.hits - stat.doubles - stat.triples - stat.homeRuns);
  const totalBases = singles + stat.doubles * 2 + stat.triples * 3 + stat.homeRuns * 4;
  return totalBases / stat.atBats;
};

const getOnBasePercentage = (stat: LeaguePlayerState['battingStats'][number]): number => {
  const plateAppearances = stat.atBats + stat.walks;
  return plateAppearances > 0 ? (stat.hits + stat.walks) / plateAppearances : 0;
};

const compareName = (left: { firstName: string; lastName: string; playerId: string }, right: { firstName: string; lastName: string; playerId: string }): number =>
  `${left.firstName} ${left.lastName}`.localeCompare(`${right.firstName} ${right.lastName}`) || left.playerId.localeCompare(right.playerId);

export const calculateUltimateSlugger = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): SeasonHistoryAwardWinner | null => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const statsByPlayerId = new Map(
    playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season' && stat.atBats >= AWARD_MIN_BATTING_AT_BATS)
      .map((stat) => [stat.playerId, stat] as const),
  );
  const candidates = playerState.players.flatMap((player) => {
    const stat = statsByPlayerId.get(player.playerId);
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    return player.playerType === 'batter' && stat && team ? [{ player, stat, team }] : [];
  });
  const winner = candidates.sort((left, right) =>
    right.stat.homeRuns - left.stat.homeRuns ||
    getSluggingPercentage(right.stat) - getSluggingPercentage(left.stat) ||
    compareName(left.player, right.player),
  )[0];

  if (!winner) return null;
  return {
    playerId: winner.player.playerId,
    playerName: `${winner.player.firstName} ${winner.player.lastName}`,
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    summary: `${winner.stat.homeRuns} HR | ${getSluggingPercentage(winner.stat).toFixed(3)} SLG | ${winner.stat.atBats} AB`,
  };
};

export const calculateBattingKing = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): SeasonHistoryAwardWinner | null => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const statsByPlayerId = new Map(
    playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season' && stat.atBats >= AWARD_MIN_BATTING_AT_BATS)
      .map((stat) => [stat.playerId, stat] as const),
  );
  const candidates = playerState.players.flatMap((player) => {
    const stat = statsByPlayerId.get(player.playerId);
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    return player.playerType === 'batter' && stat && team ? [{ player, stat, team }] : [];
  });
  const winner = candidates.sort((left, right) =>
    right.stat.hits / right.stat.atBats - left.stat.hits / left.stat.atBats ||
    right.stat.hits - left.stat.hits ||
    getOnBasePercentage(right.stat) - getOnBasePercentage(left.stat) ||
    compareName(left.player, right.player),
  )[0];

  if (!winner) return null;
  return {
    playerId: winner.player.playerId,
    playerName: `${winner.player.firstName} ${winner.player.lastName}`,
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    summary: `${(winner.stat.hits / winner.stat.atBats).toFixed(3)} AVG | ${winner.stat.hits} H | ${getOnBasePercentage(winner.stat).toFixed(3)} OBP`,
  };
};

/**
 * K/9, the first tie-break for the Strikeout King.
 *
 * Zero innings reads as zero rather than as a missing rate. The candidate filter has already
 * required a strikeout, so anyone reaching this has thrown, and a stored 0-inning line with a
 * strikeout on it is a fixture, not a season -- 0/0 is not a measurement worth preserving.
 */
const getStrikeoutsPerNine = (stat: LeaguePlayerState['pitchingStats'][number]): number =>
  stat.inningsPitched > 0 ? (stat.strikeouts * 9) / stat.inningsPitched : 0;

/**
 * K/BB, the second tie-break for the Strikeout King.
 *
 * ZERO WALKS IS THE BEST POSSIBLE RATIO HERE, NOT AN UNDEFINED ONE. A pitcher who walked nobody
 * cannot be beaten on this measure, so it returns Infinity and sorts above every finite ratio
 * rather than being excluded from the comparison. That is the only infinite value this file uses,
 * and it is used because it is the true ordering.
 */
const getStrikeoutWalkRatio = (stat: LeaguePlayerState['pitchingStats'][number]): number =>
  stat.walks > 0 ? stat.strikeouts / stat.walks : Number.POSITIVE_INFINITY;

/**
 * K/BB for printing, which refuses the infinite value the comparator needs.
 *
 * The rest of the codebase's stance on this is recorded in `LeadersHub.tsx`: `0.00` and `Infinity`
 * are each a fabricated measurement rather than an absent one, so both print as a dash. Here the
 * ratio is genuinely unbounded, but a card reading "∞ K/BB" states the arithmetic and not the
 * fact, and the fact is simply that he walked nobody.
 */
const formatStrikeoutWalk = (stat: LeaguePlayerState['pitchingStats'][number]): string =>
  stat.walks > 0 ? `${(stat.strikeouts / stat.walks).toFixed(2)} K/BB` : 'no walks';

/**
 * STRIKEOUT KING -- the most strikeouts, then the best K/9, then the best K/BB, then the name.
 *
 * A raw COUNT as the primary key, deliberately, which is the opposite of every other award here:
 * the MVP scores, the Batting King ranks on an exact average, and this one just counts. So the
 * rate does not get to decide anything -- it is a tie-break, and it only ever speaks when two
 * pitchers struck out the same number of batters. That is the point of the ordering: a reliever
 * with a magnificent 14.0 K/9 and a starter with 190 strikeouts are not close, and an award that
 * ranked on the rate would pick the reliever.
 *
 * THERE IS NO ELIGIBILITY FLOOR, which is unusual for an award in this file and is the caller's
 * explicit instruction. The consequence is real and is handled rather than wished away: with no
 * innings requirement, a season in which nobody pitched would still have candidates, and the
 * final `compareName` would crown an alphabetical winner with zero strikeouts. So the candidate
 * filter requires a strikeout, and a season where nobody struck anybody out names nobody. That
 * guard is not defensive padding -- it is what makes the missing floor safe.
 *
 * The team requirement is the same one every other award here carries ("no club, no candidacy",
 * see `buildBattingAwards`): the archived record has to be able to name a club, and a released
 * pitcher is not a season's Strikeout King.
 */
export const calculateStrikeoutKing = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): SeasonHistoryAwardWinner | null => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const statsByPlayerId = new Map(
    playerState.pitchingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const candidates = playerState.players.flatMap((player) => {
    const stat = statsByPlayerId.get(player.playerId);
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    return player.playerType === 'pitcher' && stat && team && stat.strikeouts > 0
      ? [{ player, stat, team }]
      : [];
  });
  const winner = candidates.sort((left, right) =>
    right.stat.strikeouts - left.stat.strikeouts ||
    getStrikeoutsPerNine(right.stat) - getStrikeoutsPerNine(left.stat) ||
    getStrikeoutWalkRatio(right.stat) - getStrikeoutWalkRatio(left.stat) ||
    compareName(left.player, right.player),
  )[0];

  if (!winner) return null;
  return {
    playerId: winner.player.playerId,
    playerName: `${winner.player.firstName} ${winner.player.lastName}`,
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    summary: `${winner.stat.strikeouts} K | ${getStrikeoutsPerNine(winner.stat).toFixed(2)} K/9 | ${formatStrikeoutWalk(winner.stat)}`,
  };
};

const buildRoleAwardEntries = (
  role: 'batting' | 'pitching',
  inputs: AwardInputs,
): AwardEntry[] => buildAwardsForBoard(role, inputs, inputs.players.length);

const zScoresByPlayerId = (entries: AwardEntry[]): Map<string, number> => {
  if (entries.length === 0) return new Map();
  const mean = entries.reduce((total, entry) => total + entry.total, 0) / entries.length;
  const variance = entries.reduce((total, entry) => total + (entry.total - mean) ** 2, 0) / entries.length;
  const deviation = Math.sqrt(variance);
  return new Map(entries.map((entry) => [entry.playerId, deviation > 0 ? (entry.total - mean) / deviation : 0]));
};

export const calculateRookieOfTheYear = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): SeasonHistoryAwardWinner | null => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const battingStats = new Map(
    playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const pitchingStats = new Map(
    playerState.pitchingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const battingRatings = getBattingRatingsAsOfSeason(playerState.battingRatings, seasonYear);
  const pitchingRatings = getPitchingRatingsAsOfSeason(playerState.pitchingRatings, seasonYear);
  const inputs: AwardInputs = { players: playerState.players, teamsById, battingStats, pitchingStats, battingRatings, pitchingRatings };
  const battingField = buildRoleAwardEntries('batting', inputs);
  const pitchingField = buildRoleAwardEntries('pitching', inputs);
  const battingZ = zScoresByPlayerId(battingField);
  const pitchingZ = zScoresByPlayerId(pitchingField);
  const entriesByPlayerId = new Map([...battingField, ...pitchingField].map((entry) => [entry.playerId, entry] as const));

  const candidates = playerState.players.flatMap((player) => {
    const isRookie = player.status !== 'retired' && player.yearsPro === 0 && player.draftRound !== null;
    if (!isRookie || !player.teamId || !teamsById.has(player.teamId)) return [];
    const entry = entriesByPlayerId.get(player.playerId);
    if (!entry) return [];
    const role = player.playerType === 'batter' ? 'batting' : 'pitching';
    const zScore = (role === 'batting' ? battingZ : pitchingZ).get(player.playerId) ?? 0;
    return [{ player, entry, role, zScore }];
  });

  const winner = candidates.sort((left, right) =>
    right.zScore - left.zScore ||
    left.entry.name.localeCompare(right.entry.name) ||
    left.player.playerId.localeCompare(right.player.playerId),
  )[0];
  if (!winner) return null;

  /*
   * Split by role BEFORE reading stats.
   *
   * `battingStats.get(...)` and `pitchingStats.get(...)` return different record types, so a
   * single `stat` picked by a ternary is a union and the compiler cannot correlate the branch
   * with the shape. The role guard is what makes the runtime safe; handling each role in its own
   * branch is what makes the type provable rather than merely true.
   */
  const team = teamsById.get(winner.player.teamId!);
  const battingStat = winner.role === 'batting' ? battingStats.get(winner.player.playerId) : undefined;
  const pitchingStat = winner.role === 'pitching' ? pitchingStats.get(winner.player.playerId) : undefined;
  const roleSummary = battingStat
    ? `${battingStat.avg.toFixed(3)} AVG | ${battingStat.homeRuns} HR | ${battingStat.rbi} RBI`
    : pitchingStat
      ? `${pitchingStat.era.toFixed(2)} ERA | ${pitchingStat.strikeouts} K | ${pitchingStat.inningsPitched.toFixed(1)} IP`
      : '';

  return {
    playerId: winner.player.playerId,
    playerName: winner.entry.name,
    teamId: team?.id ?? null,
    teamCity: team?.city ?? null,
    teamName: team?.name ?? null,
    summary: `${winner.role === 'batting' ? 'Batter' : 'Pitcher'} | ${roleSummary} | ${winner.zScore.toFixed(2)} role SD`,
  };
};

export const calculateStaffOfTheYear = (
  teams: Team[],
  games: Game[],
  homeFieldAdvantage: number,
): SeasonHistoryStaffWinner | null => {
  const regularSeasonGames = games.filter(isRegularSeasonGame);
  if (regularSeasonGames.length === 0) return null;
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const expectedWinsByTeamId = new Map(teams.map((team) => [team.id, 0]));

  for (const game of regularSeasonGames) {
    const home = teamsById.get(game.homeTeam);
    const away = teamsById.get(game.awayTeam);
    if (!home || !away) continue;
    const exponent = ((away.rating - home.rating) * 8) / 500;
    const homeProbability = Math.max(0.01, Math.min(0.99, 1 / (1 + 10 ** exponent) + homeFieldAdvantage));
    expectedWinsByTeamId.set(home.id, (expectedWinsByTeamId.get(home.id) ?? 0) + homeProbability);
    expectedWinsByTeamId.set(away.id, (expectedWinsByTeamId.get(away.id) ?? 0) + 1 - homeProbability);
  }

  const averageWins = regularSeasonGames.length / teams.length;
  const candidates = teams.map((team) => {
    const scheduleExpected = expectedWinsByTeamId.get(team.id) ?? averageWins;
    const priorWins = Number.isFinite(team.previousBaselineWins) ? team.previousBaselineWins : averageWins;
    const regressedPriorWins = averageWins + (priorWins - averageWins) * STAFF_PRIOR_WINS_REGRESSION;
    const expectedWins = scheduleExpected * (1 - STAFF_PRIOR_WINS_WEIGHT) + regressedPriorWins * STAFF_PRIOR_WINS_WEIGHT;
    return { team, expectedWins, winsAboveExpectation: team.wins - expectedWins, priorWins };
  });

  const winner = candidates.sort((left, right) =>
    right.winsAboveExpectation - left.winsAboveExpectation ||
    right.team.wins - left.team.wins ||
    (right.team.runsScored - right.team.runsAllowed) - (left.team.runsScored - left.team.runsAllowed) ||
    left.team.id.localeCompare(right.team.id),
  )[0];
  if (!winner) return null;

  return {
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    wins: winner.team.wins,
    losses: winner.team.losses,
    expectedWins: Number(winner.expectedWins.toFixed(1)),
    winsAboveExpectation: Number(winner.winsAboveExpectation.toFixed(1)),
    rosterStrength: winner.team.rating,
    priorWins: winner.priorWins,
  };
};
