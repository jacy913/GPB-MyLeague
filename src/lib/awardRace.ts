import type {
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  Team,
} from '../types';
import { fmtAvg, fmtEra, fmtIp, fmtPct, fmtWhip } from '../logic/statFormatting';

/**
 * Shared award-race scoring.
 *
 * This existed twice -- once in LeadersHub, once in HomeDashboard -- with the
 * same weights and diverging presentation. Two copies of a scoring function is
 * two chances for the front page and the leaderboard to disagree about who is
 * leading the MVP race, which is the exact drift the central statFormatting
 * module was created to prevent.
 *
 * The weights are the live formula, unchanged. Each component is declared once
 * and both the total and the visible breakdown are computed from this list, so
 * a weight cannot change in one place and not the other.
 */

export type MvpComponent = {
  label: string;
  detail: string;
  contribution: number;
};

export type AwardCandidate = {
  playerId: string;
  name: string;
  team: Team | null;
  components: MvpComponent[];
};

export type AwardEntry = AwardCandidate & {
  total: number;
  odds: number;
};

export type MvpBoard = 'batting' | 'pitching';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Candidates are ranked over this many, then odds are shown. */
export const AWARD_FIELD_SIZE = 8;

export const battingMvpComponents = (
  stat: PlayerSeasonBatting,
  overall: number,
  winPct: number,
): MvpComponent[] => [
  { label: 'AVG', detail: fmtAvg(stat.avg), contribution: stat.avg * 700 },
  { label: 'OPS', detail: stat.ops.toFixed(3), contribution: stat.ops * 260 },
  { label: 'HR', detail: String(stat.homeRuns), contribution: stat.homeRuns * 4 },
  { label: 'RBI', detail: String(stat.rbi), contribution: stat.rbi * 1.75 },
  { label: 'H', detail: String(stat.hits), contribution: stat.hits * 0.5 },
  { label: 'R', detail: String(stat.runsScored), contribution: stat.runsScored * 0.7 },
  { label: 'OVR', detail: String(overall), contribution: overall * 0.45 },
  { label: 'TEAM', detail: fmtPct(winPct), contribution: winPct * 60 },
];

export const pitchingMvpComponents = (
  stat: PlayerSeasonPitching,
  overall: number,
  winPct: number,
): MvpComponent[] => [
  { label: 'ERA', detail: fmtEra(stat.era), contribution: clamp(6 - stat.era, 0, 6) * 40 },
  { label: 'WHIP', detail: fmtWhip(stat.whip), contribution: clamp(2 - stat.whip, 0, 2) * 70 },
  { label: 'K', detail: String(stat.strikeouts), contribution: stat.strikeouts * 0.9 },
  { label: 'W', detail: String(stat.wins), contribution: stat.wins * 4.5 },
  { label: 'SV', detail: String(stat.saves), contribution: stat.saves * 2.25 },
  { label: 'IP', detail: fmtIp(stat.inningsPitched), contribution: stat.inningsPitched * 1.1 },
  { label: 'OVR', detail: String(overall), contribution: overall * 0.45 },
  { label: 'TEAM', detail: fmtPct(winPct), contribution: winPct * 55 },
];

const buildAwards = (
  candidates: AwardCandidate[],
  take: number,
): AwardEntry[] => {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      total: candidate.components.reduce((sum, component) => sum + component.contribution, 0),
    }))
    .sort((left, right) => right.total - left.total)
    .slice(0, AWARD_FIELD_SIZE);

  const floored = ranked.map((entry) => Math.max(0.1, entry.total));
  const sum = floored.reduce((acc, value) => acc + value, 0);

  return ranked.slice(0, take).map((entry, index) => ({
    ...entry,
    odds: sum > 0 ? Number(((floored[index] / sum) * 100).toFixed(1)) : 0,
  }));
};

interface AwardInputs {
  players: Player[];
  teamsById: Map<string, Team>;
  battingStats: Map<string, PlayerSeasonBatting>;
  pitchingStats: Map<string, PlayerSeasonPitching>;
  battingRatings: Map<string, PlayerBattingRatings>;
  pitchingRatings: Map<string, PlayerPitchingRatings>;
}

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

/**
 * `take` controls how many are returned for display, but odds are always
 * normalised across the full field of eight first. A top-three summary
 * therefore reports each racer's true share of the whole field, and the three
 * do not sum to 100 -- which is correct. Renormalising the displayed subset
 * would inflate the leader's odds and overstate the race.
 */
export const buildBattingAwards = (
  { players, teamsById, battingStats, battingRatings }: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => buildAwards(players.flatMap((player): AwardCandidate[] => {
  const stat = battingStats.get(player.playerId);
  const rating = battingRatings.get(player.playerId);
  if (!stat || !rating || stat.atBats < 120) return [];
  const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
  return [{
    playerId: player.playerId,
    name: `${player.firstName} ${player.lastName}`,
    team,
    components: battingMvpComponents(stat, rating.overall, team ? getWinPct(team) : 0),
  }];
}), take);

export const buildPitchingAwards = (
  { players, teamsById, pitchingStats, pitchingRatings }: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => buildAwards(players.flatMap((player): AwardCandidate[] => {
  const stat = pitchingStats.get(player.playerId);
  const rating = pitchingRatings.get(player.playerId);
  if (!stat || !rating || (stat.inningsPitched < 50 && stat.saves < 12)) return [];
  const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
  return [{
    playerId: player.playerId,
    name: `${player.firstName} ${player.lastName}`,
    team,
    components: pitchingMvpComponents(stat, rating.overall, team ? getWinPct(team) : 0),
  }];
}), take);

export const buildAwardsForBoard = (board: MvpBoard, inputs: AwardInputs, take?: number): AwardEntry[] =>
  board === 'batting' ? buildBattingAwards(inputs, take) : buildPitchingAwards(inputs, take);
