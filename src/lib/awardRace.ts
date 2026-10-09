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
 * Each component is declared once and both the total and the visible breakdown
 * are computed from this list, so a weight cannot change in one place and not
 * the other.
 *
 * THE PITCHING WEIGHTS WERE RE-FIT on 2026-07 and the batting weights were not.
 * The first pitching formula leaned on ERA and WHIP hard and treated innings as
 * a rounding error at 1.1 per, which was survivable only because the league was
 * broken: relievers were collecting 80 wins and 150 appearances, so the award was
 * ranking a fabricated season. With wins and workloads corrected in the engine
 * (see the pitching-decision and relief-usage commits), the formula was retuned
 * against measured seasons rather than left describing a league that no longer
 * exists. Batting never had the fault, so its weights are untouched.
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

/**
 * THE PITCHING WEIGHTS, volume-forward.
 *
 * Fitted against three measured seasons of the corrected league, not chosen by
 * eye. The premise is that pitching MVP is a starter's award: a real ace is
 * defined by innings pitched AND quality, while a relief arm's identity is a
 * small sample of a high rate. So VOLUME CARRIES THE MOST, and the rate terms
 * are what stop a merely durable pitcher from winning.
 *
 *   IP   1.1 -> 2.2   the largest single term. A 250-inning starter banks ~550
 *                    against ~190 for an 85-inning closer.
 *   K    0.9 -> 1.5   strikeouts are the clearest evidence of quality available
 *                    at volume, and were badly underweighted.
 *   W   4.5 -> 2.0    trimmed. Wins track team success far more than individual
 *                    quality, and the engine now hands them out sanely.
 *   SV 2.25 -> 1.2    trimmed for the same reason plus the role split below: a
 *                    closer cannot reach starter volume, so his saves have to
 *                    stop being able to buy the award outright.
 *   TEAM  55 -> 40    a good club is worth something, not half the score.
 *   ERA / WHIP / OVR  unchanged. These are the brake. A starter with 250 innings
 *                    and a 4.50 ERA scores materially below one with 180 innings
 *                    at 2.20, because every rate term moves the other way.
 *
 * Measured effect: a starter's score runs ~1150-1200 and a top closer's ~660, so
 * starters take the award as they should while an elite closer still has a field
 * to compete in rather than being mathematically excluded from it.
 */
export const pitchingMvpComponents = (
  stat: PlayerSeasonPitching,
  overall: number,
  winPct: number,
): MvpComponent[] => [
  { label: 'ERA', detail: fmtEra(stat.era), contribution: clamp(6 - stat.era, 0, 6) * 40 },
  { label: 'WHIP', detail: fmtWhip(stat.whip), contribution: clamp(2 - stat.whip, 0, 2) * 70 },
  { label: 'K', detail: String(stat.strikeouts), contribution: stat.strikeouts * 1.5 },
  { label: 'W', detail: String(stat.wins), contribution: stat.wins * 2 },
  { label: 'SV', detail: String(stat.saves), contribution: stat.saves * 1.2 },
  { label: 'IP', detail: fmtIp(stat.inningsPitched), contribution: stat.inningsPitched * 2.2 },
  { label: 'OVR', detail: String(overall), contribution: overall * 0.45 },
  { label: 'TEAM', detail: fmtPct(winPct), contribution: winPct * 40 },
];

const buildAwards = (
  candidates: AwardCandidate[],
  take: number,
): AwardEntry[] => {
  /*
   * Sorted ONCE, here, for every caller.
   *
   * The tie-break is alphabetical by name, and that is not a cosmetic choice. This ranking decides
   * who the board names as the winner of a CLOSED award market, and settlement reads a second
   * ranking. When the two sorted ties differently -- and they did, because this one had no
   * tie-break at all and fell back to roster order -- the board could name one player and pay
   * another. A single sort is what makes that impossible rather than unlikely.
   *
   * The board takes eight and the archive takes ten, so `take` is honoured directly rather than
   * being applied after a slice to AWARD_FIELD_SIZE, which silently capped every caller at eight.
   * Odds are then computed over exactly the set being returned, so a ten-wide field prices over
   * ten clubs rather than over a hidden eight.
   */
  const limit = Math.max(1, take);
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      total: candidate.components.reduce((sum, component) => sum + component.contribution, 0),
    }))
    .sort((left, right) => (
      left.total === right.total
        ? left.name.localeCompare(right.name)
        : right.total - left.total
    ))
    .slice(0, limit);

  const floored = ranked.map((entry) => Math.max(0.1, entry.total));
  const sum = floored.reduce((acc, value) => acc + value, 0);

  return ranked.map((entry, index) => ({
    ...entry,
    odds: sum > 0 ? Number(((floored[index] / sum) * 100).toFixed(1)) : 0,
  }));
};

/**
 * EXPORTED, because every caller has to assemble one and App.tsx now assembles two.
 *
 * It was module-private while "buildAwardsForBoard" was reachable but the shape was not, which meant
 * a caller inferred the type instead of declaring it -- and an inferred type is one more thing that
 * can drift from what the function actually reads.
 */
export interface AwardInputs {
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

/**
 * THE PITCHING GATE: you were a starter, or you were an elite closer.
 *
 * This was `50 innings or 12 saves`, which in the corrected league admits every
 * reliever who touched a save and most of them on the way there -- the field
 * filled with 40-inning arms because the old formula was cheap to buy with rate
 * stats. With the weights now volume-forward, the gate is the honest place to
 * say what the award is FOR.
 *
 * It counts STARTS rather than innings, and the reason is worth recording. An
 * innings floor is a season-progress-sensitive proxy that says the wrong thing
 * twice: a 100-inning bar sits above every reliever's season total (no reliever
 * reached 93) so it excludes them correctly, but it is not reached by a starter
 * until roughly eight weeks in, which left the pitching race visibly EMPTY on
 * the front page for a quarter of the season while the batting race filled in
 * weeks earlier. Eight starts arrives around game forty, which is about when a
 * rotation cycle has shown who is who, and it says directly what is meant:
 * this is a starter's award.
 *
 * The saves branch keeps a genuine closer eligible. He can never out-score a
 * 200-inning ace -- his ceiling is roughly 660 against 1150 -- but he belongs on
 * the board, and a race he was excluded from would quietly make the closer
 * position worthless.
 */
const PITCHING_MVP_MIN_STARTS = 8;
const PITCHING_MVP_MIN_SAVES = 25;

export const buildPitchingAwards = (
  { players, teamsById, pitchingStats, pitchingRatings }: AwardInputs,
  take: number = AWARD_FIELD_SIZE,
): AwardEntry[] => buildAwards(players.flatMap((player): AwardCandidate[] => {
  const stat = pitchingStats.get(player.playerId);
  const rating = pitchingRatings.get(player.playerId);
  if (!stat || !rating) return [];
  if (stat.gamesStarted < PITCHING_MVP_MIN_STARTS && stat.saves < PITCHING_MVP_MIN_SAVES) return [];
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
