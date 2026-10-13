import type {
  Game,
  LeaguePlayerState,
  Player,
  PlayerSeasonBatting,
  SeasonHistoryAwardWinner,
  SeasonHistoryStaffWinner,
  Team,
} from '../types';
import {
  AWARD_FIELD_SIZE,
  buildAwardsForBoard,
  type AwardCandidate,
  type AwardEntry,
  type AwardInputs,
  type MvpComponent,
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

/**
 * THE SEASON-END AWARDS AS LIVE RACES.
 *
 * Each of these was a single winner computed at the end of the season, so the awards page could show
 * two races and quietly imply that those two were the only ones. They are not: the season ends with
 * six honours, and the other four were invisible for the whole season and then appeared.
 *
 * THE RANKED FIELD IS THE SOURCE OF TRUTH AND THE WINNER IS `[0]`. That direction is the whole point
 * and it mirrors what `buildAwardsForBoard` already does for the MVP races. A manager watching the
 * Ultimate Slugger race all September and seeing one player lead it has to be able to assume that
 * player is the one the archive will name in October, and the only way to make that assumption safe
 * is to make it structurally true: the archive reads `ranked[0]` off the same array the page renders.
 * Re-deriving the winner with a second comparator is how those two drift apart, and the drift is
 * invisible -- both halves look correct and they disagree.
 */
export type SeasonAwardBoard =
  | 'ultimate_slugger'
  | 'batting_king'
  | 'strikeout_king'
  | 'rookie_of_the_year';

export interface SeasonAwardRaceSpec {
  board: SeasonAwardBoard;
  title: string;
  /** What `AwardEntry.total` IS for this award -- its own primary metric, not model points. */
  marginUnit: string;
  /**
   * The same metric as a plural NOUN, for the sentence on the card.
   *
   * Two fields because two grammars are needed. The unit labels the number in a column, where "HR"
   * and "K" are correct abbreviations; the noun has to read inside a sentence, where "leads by 2
   * home runs" works and "leads by 2 HR" does not, and where composing the noun from the unit
   * produced the literal "are level on K K" the first time this was written.
   */
  marginNoun: string;
  /** Printed under the leader's margin, because "leads by 3" means different units per award. */
  marginDecimals: number;
  /** The ordering, stated on the card, so the tie-breaks are not folklore. */
  note: string;
  /**
   * The FIRST tie-break, named.
   *
   * These awards rank lexicographically, so the top two are routinely dead level on the primary
   * metric and the race is decided underneath it. A panel that then prints "leads by 0 K" is stating
   * the most interesting fact on it in a way that reads as a broken number, so the first tie-break is
   * carried here to be named when the margin is level.
   */
  tieBreakLabel: string;
}

export const SEASON_AWARD_RACES: readonly SeasonAwardRaceSpec[] = [
  {
    board: 'ultimate_slugger',
    title: 'Ultimate Slugger',
    marginUnit: 'HR',
    marginNoun: 'home runs',
    marginDecimals: 0,
    note: 'Most home runs. Ties go to the better slugging percentage, then to the name.',
    tieBreakLabel: 'slugging',
  },
  {
    board: 'batting_king',
    title: 'Batting King',
    marginUnit: 'AVG',
    marginNoun: 'batting average',
    marginDecimals: 3,
    note: 'Highest batting average. Ties go to more hits, then to the better on-base percentage.',
    tieBreakLabel: 'hits',
  },
  {
    board: 'strikeout_king',
    title: 'Strikeout King',
    marginUnit: 'K',
    marginNoun: 'strikeouts',
    marginDecimals: 0,
    note: 'Most strikeouts. Ties go to the better K/9, then the better strikeout-to-walk ratio.',
    tieBreakLabel: 'K/9',
  },
  {
    board: 'rookie_of_the_year',
    title: 'Rookie of the Year',
    marginUnit: 'z',
    marginNoun: 'role score',
    marginDecimals: 2,
    note: 'Best role-standard score among first-year players, batters and pitchers in one race.',
    tieBreakLabel: 'the alphabetical order of their names',
  },
];

/**
 * Season-scoped `AwardInputs`, so the archive and the page rank the SAME season.
 *
 * The MVP races already assume this: `getPreferred*StatsByPlayerId` scopes to the newest season, and
 * the archive filters by `seasonYear`. Sharing one builder here means a new award cannot accidentally
 * rank all seasons at once while its neighbours rank one.
 */
const awardInputsFor = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): AwardInputs => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const scoped = <T extends { seasonYear: number; seasonPhase: string }>(rows: T[]) =>
    new Map(
      rows
        .filter((row) => row.seasonYear === seasonYear && row.seasonPhase === 'regular_season')
        .map((row) => [((row as unknown as { playerId: string }).playerId), row] as const),
    );
  return {
    players: playerState.players,
    teamsById,
    battingStats: scoped(playerState.battingStats),
    pitchingStats: scoped(playerState.pitchingStats),
    battingRatings: getBattingRatingsAsOfSeason(playerState.battingRatings, seasonYear),
    pitchingRatings: getPitchingRatingsAsOfSeason(playerState.pitchingRatings, seasonYear),
  };
};

/**
 * `total` for these races is the award's own primary metric, and `components` are its ranking
 * factors with a ZERO contribution.
 *
 * NOT a fabricated weighting. The MVP races sum weighted contributions because that is genuinely how
 * their scores are built; these awards rank lexicographically -- home runs first, slugging only to
 * break a tie -- so a weighted sum would be a DIFFERENT award that merely looks similar. Printing
 * "+38.0 of the 38.0 points" beside a home-run chip would be a made-up number, so the contribution
 * is zero and `ScoreBreakdown` shows the statistic alone when it sees one.
 *
 * The `total` is still meaningful: it is the number the award is won on, which is what makes "leads
 * by 3" read as "leads by three home runs" rather than as an unexplained gap.
 */
const factor = (label: string, detail: string): MvpComponent => ({ label, detail, contribution: 0 });

/** The eligibility gate every one of these shares: a real season's line, on a real club. */
const qualifiedBatter = (player: Player, stat: PlayerSeasonBatting | undefined, team: Team | undefined) =>
  player.playerType === 'batter' && stat && stat.atBats >= AWARD_MIN_BATTING_AT_BATS && team
    ? { player, stat, team }
    : null;

export const rankUltimateSlugger = (
  inputs: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => {
  const { players, teamsById, battingStats } = inputs;
  const candidates = players.flatMap((player) => {
    const stat = battingStats.get(player.playerId);
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    const ok = qualifiedBatter(player, stat, team);
    return ok ? [{ player, stat: ok.stat, team: ok.team }] : [];
  });

  const ranked = candidates
    .sort((left, right) =>
      right.stat.homeRuns - left.stat.homeRuns ||
      getSluggingPercentage(right.stat) - getSluggingPercentage(left.stat) ||
      compareName(left.player, right.player))
    .map<RankableCandidate>(({ player, stat, team }) => ({
      playerId: player.playerId,
      name: `${player.firstName} ${player.lastName}`,
      team,
      total: stat.homeRuns,
      components: [
        factor('HR', String(stat.homeRuns)),
        factor('SLG', getSluggingPercentage(stat).toFixed(3)),
        factor('AB', String(stat.atBats)),
      ],
    }));

  return finalizeRace(ranked, take);
};

export const rankBattingKing = (
  inputs: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => {
  const { players, teamsById, battingStats } = inputs;
  const candidates = players.flatMap((player) => {
    const stat = battingStats.get(player.playerId);
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    const ok = qualifiedBatter(player, stat, team);
    return ok ? [{ player, stat: ok.stat, team: ok.team }] : [];
  });

  const ranked = candidates
    .sort((left, right) =>
      (right.stat.hits / right.stat.atBats) - (left.stat.hits / left.stat.atBats) ||
      right.stat.hits - left.stat.hits ||
      getOnBasePercentage(right.stat) - getOnBasePercentage(left.stat) ||
      compareName(left.player, right.player))
    .map<RankableCandidate>(({ player, stat, team }) => ({
      playerId: player.playerId,
      name: `${player.firstName} ${player.lastName}`,
      team,
      total: stat.hits / stat.atBats,
      components: [
        factor('AVG', (stat.hits / stat.atBats).toFixed(3)),
        factor('H', String(stat.hits)),
        factor('OBP', getOnBasePercentage(stat).toFixed(3)),
      ],
    }));

  return finalizeRace(ranked, take);
};

export const rankStrikeoutKing = (
  inputs: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => {
  const { players, teamsById, pitchingStats } = inputs;
  const candidates = players.flatMap((player) => {
    const stat = pitchingStats.get(player.playerId);
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    // No innings floor, by instruction. The `strikeouts > 0` half is what makes that safe: without
    // it, a season in which nobody pitched still produces candidates and `candidates[0]` names somebody.
    if (player.playerType !== 'pitcher' || !stat || !team || stat.strikeouts <= 0) return [];
    return [{ player, stat, team }];
  });

  const ranked = candidates
    .sort((left, right) =>
      right.stat.strikeouts - left.stat.strikeouts ||
      getStrikeoutsPerNine(right.stat) - getStrikeoutsPerNine(left.stat) ||
      getStrikeoutWalkRatio(right.stat) - getStrikeoutWalkRatio(left.stat) ||
      compareName(left.player, right.player))
    .map<RankableCandidate>(({ player, stat, team }) => ({
      playerId: player.playerId,
      name: `${player.firstName} ${player.lastName}`,
      team,
      total: stat.strikeouts,
      components: [
        factor('K', String(stat.strikeouts)),
        factor('K/9', getStrikeoutsPerNine(stat).toFixed(2)),
        factor('BB', String(stat.walks)),
      ],
    }));

  return finalizeRace(ranked, take);
};

export const rankRookieOfTheYear = (
  inputs: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => {
  const { players, teamsById } = inputs;
  const battingField = buildRoleAwardEntries('batting', inputs);
  const pitchingField = buildRoleAwardEntries('pitching', inputs);
  const battingZ = zScoresByPlayerId(battingField);
  const pitchingZ = zScoresByPlayerId(pitchingField);
  const entriesByPlayerId = new Map(
    [...battingField, ...pitchingField].map((entry) => [entry.playerId, entry] as const),
  );

  const candidates = players.flatMap((player) => {
    const isRookie = player.status !== 'retired' && player.yearsPro === 0 && player.draftRound !== null;
    const team = player.teamId ? teamsById.get(player.teamId) : undefined;
    const entry = entriesByPlayerId.get(player.playerId);
    if (!isRookie || !team || !entry) return [];
    const zScore = (player.playerType === 'pitcher' ? pitchingZ : battingZ).get(player.playerId) ?? 0;
    return [{ player, entry, team, zScore }];
  });

  const ranked = candidates
    .sort((left, right) =>
      right.zScore - left.zScore ||
      left.entry.name.localeCompare(right.entry.name) ||
      left.player.playerId.localeCompare(right.player.playerId))
    .map<RankableCandidate>(({ player, entry, team, zScore }) => ({
      playerId: player.playerId,
      name: entry.name,
      team,
      total: zScore,
      // The MVP components are kept because they are how the role score was built, and the z-score
      // that actually decides the race is appended so the reader can see the number being compared.
      components: [...entry.components, factor('ROLE z', zScore.toFixed(2))],
    }));

  return finalizeRace(ranked, take);
};

/**
 * The four season-end races, keyed. One switch so a surface cannot name a board that has no builder.
 */
export const rankSeasonAwardRace = (
  board: SeasonAwardBoard,
  inputs: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => {
  if (board === 'ultimate_slugger') return rankUltimateSlugger(inputs, take);
  if (board === 'batting_king') return rankBattingKing(inputs, take);
  if (board === 'strikeout_king') return rankStrikeoutKing(inputs, take);
  return rankRookieOfTheYear(inputs, take);
};

/**
 * A candidate plus THE NUMBER THIS AWARD IS WON ON, which is not model points.
 *
 * Mirrors `buildAwards`' odds arithmetic so the two rank the same way, with one difference: the MVP
 * races sum weighted contributions because a weighted sum is genuinely how their scores are built,
 * whereas these awards rank lexicographically -- home runs first, slugging only to break a tie -- so a
 * weighted sum would be a DIFFERENT award that merely looks similar. Printing "+38.0 of the 38.0
 * points" beside a home-run chip would be a made-up number, so the contribution is zero and the
 * breakdown shows the statistic alone when it sees one.
 *
 * `total` is still the honest number: it is the metric the award is won on, which is what makes "leads
 * by 3" read as three home runs rather than as an unexplained gap.
 */
type RankableCandidate = AwardCandidate & { total: number };

/** Odds over exactly the field returned, so a short field does not silently price over a hidden one. */
const finalizeRace = (ranked: RankableCandidate[], take: number): AwardEntry[] => {
  const trimmed = ranked.slice(0, Math.max(1, take));
  const floored = trimmed.map((entry) => Math.max(0.1, entry.total));
  const sum = floored.reduce((acc, value) => acc + value, 0);
  return trimmed.map((entry, index) => ({
    ...entry,
    odds: sum > 0 ? Number(((floored[index] / sum) * 100).toFixed(1)) : 0,
  }));
};

export const calculateUltimateSlugger = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): SeasonHistoryAwardWinner | null => {
  const inputs = awardInputsFor(teams, playerState, seasonYear);
  const winner = rankUltimateSlugger(inputs, 1)[0];
  if (!winner || !winner.team) return null;
  const stat = inputs.battingStats.get(winner.playerId);
  if (!stat) return null;
  return {
    playerId: winner.playerId,
    playerName: winner.name,
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    summary: `${stat.homeRuns} HR | ${getSluggingPercentage(stat).toFixed(3)} SLG | ${stat.atBats} AB`,
  };
};

export const calculateBattingKing = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
): SeasonHistoryAwardWinner | null => {
  const inputs = awardInputsFor(teams, playerState, seasonYear);
  const winner = rankBattingKing(inputs, 1)[0];
  const stat = winner ? inputs.battingStats.get(winner.playerId) : undefined;
  if (!winner || !winner.team || !stat) return null;
  return {
    playerId: winner.playerId,
    playerName: winner.name,
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    summary: `${(stat.hits / stat.atBats).toFixed(3)} AVG | ${stat.hits} H | ${getOnBasePercentage(stat).toFixed(3)} OBP`,
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
  const inputs = awardInputsFor(teams, playerState, seasonYear);
  const winner = rankStrikeoutKing(inputs, 1)[0];
  const stat = winner ? inputs.pitchingStats.get(winner.playerId) : undefined;
  if (!winner || !winner.team || !stat) return null;
  return {
    playerId: winner.playerId,
    playerName: winner.name,
    teamId: winner.team.id,
    teamCity: winner.team.city,
    teamName: winner.team.name,
    summary: `${stat.strikeouts} K | ${getStrikeoutsPerNine(stat).toFixed(2)} K/9 | ${formatStrikeoutWalk(stat)}`,
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
  const inputs = awardInputsFor(teams, playerState, seasonYear);
  const winner = rankRookieOfTheYear(inputs, 1)[0];
  const team = winner?.team ?? null;
  const player = winner ? inputs.players.find((p) => p.playerId === winner.playerId) : undefined;
  const isBatter = player?.playerType === 'batter';
  const battingStat = isBatter ? inputs.battingStats.get(winner?.playerId ?? '') : undefined;
  const pitchingStat = !isBatter ? inputs.pitchingStats.get(winner?.playerId ?? '') : undefined;
  const roleSummary = battingStat
    ? `${battingStat.avg.toFixed(3)} AVG | ${battingStat.homeRuns} HR | ${battingStat.rbi} RBI`
    : pitchingStat
      ? `${pitchingStat.era.toFixed(2)} ERA | ${pitchingStat.strikeouts} K | ${pitchingStat.inningsPitched.toFixed(1)} IP`
      : '';
  if (!winner || !team) return null;

  /*
   * Split by role BEFORE reading stats.
   *
   * `battingStats.get(...)` and `pitchingStats.get(...)` return different record types, so a
   * single `stat` picked by a ternary is a union and the compiler cannot correlate the branch
   * with the shape. The role guard is what makes the runtime safe; handling each role in its own
   * branch is what makes the type provable rather than merely true.
   */
  return {
    playerId: winner.playerId,
    playerName: winner.name,
    teamId: team.id,
    teamCity: team.city,
    teamName: team.name,
    summary: `${isBatter ? 'Batter' : 'Pitcher'} | ${roleSummary} | ${winner.total.toFixed(2)} role SD`,
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
