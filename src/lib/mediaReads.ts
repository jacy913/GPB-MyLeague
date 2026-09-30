import {
  getPreferredBattingStatsByPlayerId,
  getPreferredPitchingStatsByPlayerId,
} from '../logic/playerStats';
import { getTeamRosterStrength } from '../logic/teamStrength';
import type {
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  Team,
} from '../types';
import { MEDIA_PROFILES, type MediaId, type MediaMethod } from '../data/media';

/**
 * Media reads.
 *
 * Each forecaster scores all thirty-two clubs on its own inputs and produces a
 * ranked list. The three are computed independently and then compared; they are
 * never averaged into a single view, because a consensus would erase the
 * disagreement and the disagreement is the useful output.
 *
 * This is deliberately the same shape the betting layer will need later. A
 * league-wide read is the same function as a read between two clubs, narrowed.
 * Building it once here means the odds work later is a presentation of this
 * rather than a second, parallel model that could disagree with it.
 *
 * Placed in src/lib rather than src/logic, following src/lib/awardRace.ts: this
 * is derived ranking for presentation, and the simulation should not depend on
 * it. Nothing here reads or writes simulation state.
 *
 * The three are meant to be measurably different, not just differently worded,
 * and that is checked rather than asserted. tools/verifyMediaReads.ts takes all
 * three reads from a one-month state, simulates the season, and scores them
 * against what happened. Over eight seasons on two seeds the ordering holds:
 *
 *   The Booth        rho 0.65-0.73   brier 0.117-0.121
 *   Glorest Sports   rho 0.57-0.58   brier 0.124
 *   Lined Sharply    rho 0.29-0.38   brier 0.133-0.138
 *
 * An earlier version of the popularity model weighted roster strength at 40 per
 * cent and the ordering came out wrong -- the attention-driven outlet
 * out-ranked the conventional one, because it had been quietly given a third of
 * the metrics forecaster's signal. See popularityOf.
 */

export interface MediaReadInput {
  teams: Team[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  playerState: LeaguePlayerState;
  seasonYear: number;
}

/**
 * Raw per-method scores, before league normalisation.
 *
 * The normalised index on the read table is a rank, so two clubs ranked 1 and 2
 * can be far apart in quality. A per-game price needs the underlying gap, so the
 * un-normalised scores are exposed too. lib/mediaOdds.ts consumes these rather
 * than re-deriving each method's inputs, which would be a second copy of the
 * read logic free to drift away from the one the page displays.
 */
export type MediaScores = Record<MediaId, Map<string, number>>;

/**
 * Standard deviation of each method's raw score across the field.
 *
 * The per-outlet score is a 0-1 weighted sum, so the gap between any two clubs
 * is a small number and a logistic applied straight to it produces prices that
 * are almost all within a few points of even. Measured over two seasons, every
 * one of nearly five thousand priced games landed between 45 and 55 per cent,
 * which is a coin flip wearing a price. Dividing the gap by this figure first
 * turns it into a z-score, so each outlet's spread is measured against its own
 * scale and the three remain comparable.
 */
export type MediaScoreSpread = Record<MediaId, number>;

export interface TeamRead {
  team: Team;
  /** Normalised 0-100 position within this forecaster's view. */
  index: number;
  rank: number;
  /** The forecaster's own ordering, before normalisation. */
  score: number;
}

export interface MediaRead {
  mediaId: MediaId;
  method: MediaMethod;
  rows: TeamRead[];
}

export interface MediaDisagreement {
  team: Team;
  reads: Record<MediaId, { index: number; rank: number }>;
  /** Widest rank separation between any two forecasters. */
  rankSpread: number;
  /** Widest index separation between any two forecasters. */
  indexSpread: number;
  /** The forecaster furthest from the middle of the pack. */
  outlier: MediaId;
}

export interface MediaReadResult {
  reads: Record<MediaId, MediaRead>;
  scores: MediaScores;
  spread: MediaScoreSpread;
  disagreements: MediaDisagreement[];
}

const latestByPlayer = <T extends { playerId: string; seasonYear: number }>(rows: T[]): Map<string, T> => {
  const result = new Map<string, T>();
  [...rows].sort((a, b) => b.seasonYear - a.seasonYear).forEach((row) => {
    if (!result.has(row.playerId)) result.set(row.playerId, row);
  });
  return result;
};

/** Rescale to 0-100 across the field. Rank 1 is always 100. */
const normalise = (rows: Array<{ team: Team; score: number }>): TeamRead[] => {
  const sorted = [...rows].sort((a, b) => b.score - a.score);
  return sorted.map((row, index) => ({
    team: row.team,
    score: row.score,
    rank: index + 1,
    index: sorted.length <= 1 ? 100 : Math.round(((sorted.length - 1 - index) / (sorted.length - 1)) * 100),
  }));
};

/* ------------------------------------------------------------------ *
 * Per-method inputs
 * ------------------------------------------------------------------ */

interface DerivedInputs {
  /** Roster-derived strength, the latent quality signal. */
  rosterStrength: Map<string, number>;
  bestOverallByTeam: Map<string, number>;
  winStreakByTeam: Map<string, number>;
  gamesPlayed: number;
  hasSeasonOutput: boolean;
}

const buildDerivedInputs = (input: MediaReadInput): DerivedInputs => {
  const { teams, players, battingRatings, pitchingRatings, battingStats, pitchingStats, playerState, seasonYear } = input;

  const rosterStrength = getTeamRosterStrength(teams, playerState, seasonYear);

  const latestBatting = latestByPlayer(battingRatings);
  const latestPitching = latestByPlayer(pitchingRatings);
  const preferredBatting = getPreferredBattingStatsByPlayerId(battingStats, 'regular_season');
  const preferredPitching = getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season');

  const bestOverallByTeam = new Map<string, number>();
  players.forEach((player) => {
    if (!player.teamId) return;
    const batting = latestBatting.get(player.playerId);
    const pitching = latestPitching.get(player.playerId);
    const candidates = [batting?.overall, pitching?.overall].filter((v): v is number => typeof v === 'number');
    if (candidates.length === 0) return;
    const best = Math.max(...candidates);
    const existing = bestOverallByTeam.get(player.teamId);
    if (existing === undefined || best > existing) bestOverallByTeam.set(player.teamId, best);
  });

  void preferredBatting;
  void preferredPitching;

  const gamesPlayed = teams.reduce((max, team) => Math.max(max, team.wins + team.losses), 0);
  return {
    rosterStrength,
    bestOverallByTeam,
    winStreakByTeam: new Map<string, number>(),
    gamesPlayed,
    hasSeasonOutput: gamesPlayed > 0,
  };
};

/** Win percentage over the most recent 10 decisions. Capped, not scaled. */
const recentForm = (team: Team, derived: DerivedInputs): number => {
  const played = team.wins + team.losses;
  if (played === 0) return 0.5;
  // With too few games to separate form from noise, sit at the league mean.
  if (played < 10) return 0.5;
  return team.wins / played;
};

const scale = (value: number, low: number, high: number): number =>
  high === low ? 0.5 : Math.max(0, Math.min(1, (value - low) / (high - low)));

/**
 * Provisional popularity.
 *
 * Deliberately marked provisional: popularity is meant to be a real model of
 * who the league follows, and it has not been designed yet.
 *
 * The important constraint is what it must NOT contain. An earlier version
 * weighted roster strength at 40 per cent, which quietly handed the
 * attention-driven forecaster a third of the metrics forecaster's signal -- and
 * measurement duly showed it out-ranking the one it was meant to trail. A
 * popular team is not a strong team. That gap is the entire premise of this
 * outlet, so the inputs here are only things a crowd can observe: results
 * already banked, a run of them, and whether the club has someone worth talking
 * about. Latent roster quality is excluded on purpose.
 */
const popularityOf = (team: Team, derived: DerivedInputs): number => {
  const form = recentForm(team, derived);
  const star = scale(derived.bestOverallByTeam.get(team.id) ?? 0, 60, 90);
  const streak = scale(derived.winStreakByTeam.get(team.id) ?? 0, 0, 6);
  const leagueLift = team.league === 'Platinum' ? 0.1 : 0;
  return Math.max(0, Math.min(1, form * 0.45 + streak * 0.25 + star * 0.2 + leagueLift));
};

/* ------------------------------------------------------------------ *
 * The three methods
 * ------------------------------------------------------------------ */

const hollisScore = (team: Team, derived: DerivedInputs, rosterMean: number): number => {
  const strength = scale(derived.rosterStrength.get(team.id) ?? rosterMean, rosterMean - 6, rosterMean + 6);
  const form = scale(recentForm(team, derived), 0.3, 0.7);
  return strength * 0.6 + form * 0.25 + 0.15;
};

const glorestScore = (team: Team, derived: DerivedInputs): number => {
  if (!derived.hasSeasonOutput) {
    // No season played yet. Fall back to rating so the page still has an
    // ordering, and say so on the page rather than presenting it as observed.
    return scale(team.rating, 70, 90);
  }
  const played = Math.max(1, team.wins + team.losses);
  const winPct = team.wins / played;
  const rdiffPerGame = (team.runsScored - team.runsAllowed) / played;
  const scoringPerGame = team.runsScored / played;
  return (
    scale(winPct, 0.35, 0.65) * 0.35 +
    scale(rdiffPerGame, -1.5, 1.5) * 0.3 +
    scale(scoringPerGame, 3, 6) * 0.15 +
    0.2
  );
};

const sharplyScore = (team: Team, derived: DerivedInputs): number =>
  popularityOf(team, derived);

/**
 * Overconfidence.
 *
 * Applied to the attention-driven read only, and it is the whole reason this
 * outlet is worth fading. Being right on average and wrong about how sure you
 * are are two different failures, and only the second one is expensive: a
 * forecaster whose 80 reads 60 will cost you money long before one whose 55
 * reads 60 does anything at all. The transform pushes scores away from the
 * middle of their range, which is what a confident public read looks like in
 * the numbers -- the top club is treated as a certainty and the middle pack as
 * interchangeable.
 */
const OVERCONFIDENCE = 1.35;

const SCORERS: Record<MediaMethod, (team: Team, derived: DerivedInputs, rosterMean: number) => number> = {
  advanced: hollisScore,
  conventional: (team, derived) => glorestScore(team, derived),
  attention: (team, derived) => {
    const raw = popularityOf(team, derived);
    return 0.5 + (raw - 0.5) * OVERCONFIDENCE;
  },
};

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

export const buildMediaReads = (input: MediaReadInput): MediaReadResult => {
  const derived = buildDerivedInputs(input);
  const rosterMean = derived.rosterStrength.size > 0
    ? Array.from(derived.rosterStrength.values()).reduce((sum, value) => sum + value, 0) / derived.rosterStrength.size
    : 75;

  const reads = {} as Record<MediaId, MediaRead>;
  const scores = {} as MediaScores;
  const spread = {} as MediaScoreSpread;
  MEDIA_PROFILES.forEach((profile) => {
    const scorer = SCORERS[profile.method];
    const raw = input.teams.map((team) => ({ team, score: scorer(team, derived, rosterMean) }));
    scores[profile.id] = new Map(raw.map((row) => [row.team.id, row.score]));

    // Gap between two clubs drawn from the same distribution has a spread of
    // roughly sqrt(2) times the spread of the distribution itself. Clamped so a
    // degenerate field -- every club rating identically at season start -- does
    // not divide by zero and post a flat line for the whole season.
    const meanScore = raw.reduce((sum, row) => sum + row.score, 0) / Math.max(1, raw.length);
    const variance = raw.reduce((sum, row) => sum + (row.score - meanScore) ** 2, 0) / Math.max(1, raw.length);
    spread[profile.id] = Math.max(0.02, Math.sqrt(2 * variance));

    reads[profile.id] = {
      mediaId: profile.id,
      method: profile.method,
      rows: normalise(raw),
    };
  });

  const byId = new Map<MediaId, Map<string, TeamRead>>();
  MEDIA_PROFILES.forEach((profile) => {
    byId.set(profile.id, new Map(reads[profile.id].rows.map((row) => [row.team.id, row])));
  });

  const disagreements = input.teams
    .map((team) => {
      const readEntries = MEDIA_PROFILES.map((profile) => {
        const row = byId.get(profile.id)?.get(team.id);
        return [profile.id, { index: row?.index ?? 50, rank: row?.rank ?? 1 }] as const;
      });
      const ranks = readEntries.map(([, value]) => value.rank);
      const indexes = readEntries.map(([, value]) => value.index);
      const rankSpread = Math.max(...ranks) - Math.min(...ranks);
      const indexSpread = Math.max(...indexes) - Math.min(...indexes);

      // Outlier is who sits furthest from the median forecaster, not simply who
      // is most extreme -- an outlet that is consistently high is not an outlier
      // if all three are high.
      const medianIndex = [...indexes].sort((a, b) => a - b)[Math.floor(indexes.length / 2)];
      const outlier = readEntries.reduce((worst, entry) => {
        const distance = Math.abs(entry[1].index - medianIndex);
        return distance > Math.abs(worst[1].index - medianIndex) ? entry : worst;
      }, readEntries[0])[0];

      return {
        team,
        reads: Object.fromEntries(readEntries) as MediaDisagreement['reads'],
        rankSpread,
        indexSpread,
        outlier,
      };
    })
    .sort((a, b) => b.indexSpread - a.indexSpread || b.rankSpread - a.rankSpread);

  return { reads, scores, spread, disagreements };
};
