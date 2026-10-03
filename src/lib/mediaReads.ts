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
  /*
   * THE THREE ADDED FOR THE FIVE NEW FORECASTERS.
   *
   * Each exists because one of the new read functions genuinely cannot be written without it,
   * and inventing a weaker signal instead would have been a quieter way of shipping a stub.
   *
   *   meanAgeByTeam      Wardley. Organizational depth is an AGE curve. `Player` carries `age`,
   *                      `yearsPro` and `draftClassYear`, so this is measured rather than modelled.
   *   youngUpsideByTeam  Wardley. The upside is the best of a team's YOUNG players, not the best
   *                      of its roster -- which is the whole reason a rebuild club scores well on
   *                      his read and badly on everyone else's.
   *   leagueRunEnvironment
   *                      Mussad. The league-wide scoring rate. It is a constant across teams BY
   *                      DESIGN, which is what makes him beta, so it is computed once here rather
   *                      than per club.
   */
  meanAgeByTeam: Map<string, number>;
  youngUpsideByTeam: Map<string, number>;
  leagueRunEnvironment: number;
  /*
   * ADDED FOR SCINTILLA.
   *
   * `leagueMeanWinPct` is the league's win rate, computed once for the same reason
   * `leagueRunEnvironment` is: Scintilla's read is a comparison AGAINST the league, so the reference
   * value belongs here rather than being recomputed per club.
   *
   * It exists because Scintilla is the first forecaster whose subject is the GAP between expectation
   * and outcome. Every other read asks "how good is this club"; his asks "is the league expecting
   * the right thing of this club", and that is a different question needing a league-wide constant.
   */
  leagueMeanWinPct: number;
}

/**
 * The age at or below which a player counts as "not yet arrived", for Wardley's upside term.
 *
 * CHOSEN, and worth being honest that it is chosen. Baseball's conventional prospect band is
 * 22-24, and the midpoint is used so the term rewards depth rather than one very young player.
 * Step 5 re-fits; this is the shape of the signal, not its calibration.
 */
const YOUNG_AGE = 22;

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

  /*
   * AGE AND YOUNG UPSIDE, computed here rather than in the read function.
   *
   * Both are per-team aggregates over `players`, so computing them once per read is right: they
   * are properties of the roster, not of one club being priced. `youngUpside` is the BEST young
   * player's overall rather than an average, because a rebuild club's upside lives in one
   * teenager and averaging him against nine journeymen hides exactly the signal Wardley trades on.
   */
  const agesByTeam = new Map<string, number[]>();
  const youngByTeam = new Map<string, number>();
  for (const player of players) {
    if (!player.teamId) continue;
    const bucket = agesByTeam.get(player.teamId);
    if (bucket) bucket.push(player.age); else agesByTeam.set(player.teamId, [player.age]);

    if (player.age > YOUNG_AGE) continue;
    const batting = latestBatting.get(player.playerId);
    const pitching = latestPitching.get(player.playerId);
    const candidates = [batting?.overall, pitching?.overall].filter((v): v is number => typeof v === 'number');
    if (candidates.length === 0) continue;
    const best = Math.max(...candidates);
    const existing = youngByTeam.get(player.teamId);
    if (existing === undefined || best > existing) youngByTeam.set(player.teamId, best);
  }
  const meanAgeByTeam = new Map<string, number>();
  for (const [teamId, ages] of agesByTeam) {
    meanAgeByTeam.set(teamId, ages.reduce((a, b) => a + b, 0) / ages.length);
  }

  const gamesPlayed = teams.reduce((max, team) => Math.max(max, team.wins + team.losses), 0);

  /*
   * THE LEAGUE RUN ENVIRONMENT, as a 0-1 scale.
   *
   * Scored league-wide and stored as one number, because Mussad's whole character is that he
   * prices the league rather than the clubs: if this were computed per team it would stop being
   * beta and become a seventh way of rating teams. He is the reason the market has a market-wide
   * risk a bettor can observe.
   *
   * The early-season case returns the midpoint rather than a rate computed from three games,
   * which would be noise presented as an environment.
   */
  const totalRuns = teams.reduce((sum, team) => sum + team.runsScored, 0);
  const totalGames = teams.reduce((sum, team) => sum + team.wins + team.losses, 0) / 2;
  const runsPerGame = totalGames > 20 ? totalRuns / totalGames : 3.5;
  const leagueRunEnvironment = scale(runsPerGame, 3.5, 5);

  /*
    THE LEAGUE MEAN WIN PERCENTAGE, for Scintilla's expectation gap.

    Scintilla's read is a DEVIATION, so it needs a reference point rather than an absolute. Taken over
    teams that have actually played; in a league that has not started there is nothing to deviate
    from and the midpoint is the honest answer rather than a zero that would call every club an
    outlier.
  */
  const playedTeams = teams.filter((team) => team.wins + team.losses > 0);
  const leagueMeanWinPct = playedTeams.length > 0
    ? playedTeams.reduce((sum, team) => sum + team.wins / (team.wins + team.losses), 0) / playedTeams.length
    : 0.5;

  return {
    rosterStrength,
    bestOverallByTeam,
    winStreakByTeam: new Map<string, number>(),
    gamesPlayed,
    hasSeasonOutput: gamesPlayed > 0,
    meanAgeByTeam,
    youngUpsideByTeam: youngByTeam,
    leagueRunEnvironment,
    leagueMeanWinPct,
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
/* ------------------------------------------------------------------ *
 * The five added for the HXSE expansion
 *
 * Each is written from its profile's DECLARED weights, so the weights shown on the character
 * popup are the weights the read actually uses. That correspondence is the thing worth
 * protecting: a profile that lists "Farm system grade 0.35" while the read ignores farm systems
 * is a decoration, and the whole argument of this screen is that a forecaster you cannot audit
 * is not usable.
 * ------------------------------------------------------------------ */

/**
 * SALLOW -- the fitted base rate. Pythagorean expectation, which is a real statistic rather than
 * a mood: the win percentage a club's own scoring and run allowance imply, from the standard
 * exponent 1.83.
 *
 * His declared weights are Pythagorean 0.4, run differential 0.3, team rating 0.2, home field
 * 0.1, and this is that arithmetic literally.
 *
 * He is deliberately the LEAST interesting read in the league, because he is the control. With
 * one forecaster who has no editorial tilt, a gap between anyone and him is a signal rather than
 * one more disagreement.
 */
const sallowScore = (team: Team, derived: DerivedInputs): number => {
  const played = team.wins + team.losses;
  if (!derived.hasSeasonOutput || played === 0) return scale(team.rating, 70, 90);
  const rs = Math.max(1, team.runsScored);
  const ra = Math.max(1, team.runsAllowed);
  const rsPow = Math.pow(rs, 1.83);
  const raPow = Math.pow(ra, 1.83);
  const pythag = rsPow / (rsPow + raPow);
  const rdiffPerGame = (team.runsScored - team.runsAllowed) / played;
  return (
    scale(pythag, 0.38, 0.62) * 0.4 +
    scale(rdiffPerGame, -1.5, 1.5) * 0.3 +
    scale(team.rating, 70, 90) * 0.2 +
    0.1
  );
};

/**
 * JARDINS -- the contrarian. She reads the crowd and inverts it.
 *
 * Her declared weights are "what the market overprices" 0.4, roster quality 0.25, recent form
 * 0.2, home field 0.15. "What the market overprices" is implemented as ONE MINUS POPULARITY: she
 * is drawn to what the crowd is ignoring, not to a second opinion about what it is buying.
 *
 * THE MEASUREMENT CAVEAT IS NOT OPTIONAL and it lives on the profile too. This function inverts
 * the crowd BY CONSTRUCTION, so calibrating her against the other forecasters would score her
 * beautifully and prove nothing -- inverse-of-consensus is a strategy, not an edge. Step 5 fits
 * her against independently computed truth. Expect a small number. That is the correct outcome:
 * a contrarian who is reliably right is not a contrarian.
 */
const JARDINS_FADE = 0.55;

const jardinsScore = (team: Team, derived: DerivedInputs, rosterMean: number): number => {
  const crowd = popularityOf(team, derived);
  const quality = scale(
    derived.rosterStrength.get(team.id) ?? rosterMean,
    rosterMean - 6,
    rosterMean + 6,
  );
  const form = scale(recentForm(team, derived), 0.3, 0.7);

  /*
    A PARTIAL FADE, NOT A MIRROR. The first version inverted outright -- `1 - crowd` -- and
    measured WORSE THAN A COIN FLIP: best slope 0.05, Brier 0.2516.

    That is a real finding rather than a bad number, and it says something true: the crowd's
    signal is positively predictive, so an exact inverse of it is negatively predictive. A
    columnist who exactly mirrors the crowd is not contrarian, she is a broken calculator.

    What a real contrarian does is FADE -- she leans against the consensus without betting
    everything on the reversal, because being right about the crowd being wrong is a different
    and much rarer claim than being wrong. FADE is applied to the DEPARTURE from the middle
    rather than to the level, so her read still points the other way but does not claim the
    crowd is exactly inverted.

    The consequence is that she should land NEAR the coin flip rather than below it: slightly
    uninformative, occasionally spectacular, wrong in long stretches. That is the character the
    profile describes and it is the correct outcome -- the plan is explicit that a contrarian
    who is reliably right is not a contrarian, and that her fitted edge is expected to be SMALL.
   */
  const fade = (value: number): number => 0.5 + (0.5 - value) * JARDINS_FADE;
  return (
    fade(crowd) * 0.4 +
    fade(quality) * 0.25 +
    fade(form) * 0.2 +
    0.15
  );
};

/**
 * BOYLE'S BEAT -- which division he covers.
 *
 * PROVISIONAL AND ARBITRARY, and flagged as such rather than derived. Any of the four would be
 * defensible and the choice has no effect on whether the mechanic works; what matters is that it
 * is FIXED, so his inside/outside asymmetry is a property of the data rather than of a sort
 * order. The user picks this one.
 */
export const BOYLE_BEAT: Team['division'] = 'West';

/**
 * BOYLE -- deep on one division, near-blind outside it.
 *
 * The asymmetry is the whole point and it is not cosmetic: inside his beat he leans hard on the
 * two signals a beat reporter actually has (roster quality and current form), and outside it he
 * flattens almost to the league mean.
 *
 * OUTSIDE HIS BEAT HE IS NOT EXACTLY CONSTANT. A literal 0.5 for all twenty-four would be a
 * degenerate read -- every club tied, no ordering, and the outlier detector unable to find one.
 * He keeps a fifth of the signal instead of all of it, which makes him weak outside his beat
 * rather than absent, and that is both truer to "near-blind" and mechanically well-defined.
 */
const boyleScore = (team: Team, derived: DerivedInputs, rosterMean: number): number => {
  const quality = scale(
    derived.rosterStrength.get(team.id) ?? rosterMean,
    rosterMean - 6,
    rosterMean + 6,
  );
  const form = scale(recentForm(team, derived), 0.3, 0.7);
  const inBeat = team.division === BOYLE_BEAT;
  // 0.7/0.2 inside; 0.14/0.04 outside -- one fifth of the signal.
  const q = inBeat ? 0.7 : 0.14;
  const f = inBeat ? 0.2 : 0.04;
  return quality * q + form * f + (inBeat ? 0.1 : 0.42);
};

/**
 * MUSSAD -- the macro desk. He prices the league, not the clubs.
 *
 * THE TENSION IN THIS FUNCTION IS REAL AND IS NOT A BUG.
 *
 * A macro forecaster cannot produce a differentiated team ordering -- that is what "he does not
 * cover teams" means -- but the read pipeline normalises every outlet into a ranking, so a
 * perfectly flat read would be a degenerate one.
 *
 * What he gets instead is a league-wide term shared by every club (which IS beta, and is the
 * character), plus a deliberately tiny per-team tilt for how much a club EXPOSES to the run
 * environment he is pricing. The tilt is 6% of a team's scale span. It exists so his read is
 * well-defined rather than a divide-by-zero in the normaliser, and it is small enough that he
 * still reads as almost flat -- which is what a market-wide view should look like beside a
 * beat reporter's.
 *
 * Do not raise TILT to make his page look more interesting. That is the whole design.
 */
const MUSSAD_TILT = 0.06;
const mussadScore = (team: Team, derived: DerivedInputs): number => {
  const played = Math.max(1, team.wins + team.losses);
  // Offence-weighted clubs feel a rising run environment more than dead-banded ones do.
  const exposure = scale(team.runsScored / played, 3, 6);
  return 0.5 + (exposure - 0.5) * MUSSAD_TILT + (derived.leagueRunEnvironment - 0.5) * 0.02;
};

/**
 * WARDLEY -- organizational depth. Farm system grade 0.35, development trajectory 0.3, age
 * curve 0.2, current roster surplus 0.15.
 *
 * The two terms that make him different are `youngUpsideByTeam` (the best player a club has who
 * has not arrived yet) and `meanAgeByTeam`. Both come from `Player.age` and `Player.yearsPro`,
 * so this is measured from the roster rather than modelled.
 *
 * A rebuild club scores WELL here and badly on every other read in the league, which is the
 * asymmetry that makes him tradeable: he is the forecaster who will disagree violently during a
 * rebuild and be the only one who was right.
 */
const wardleyScore = (team: Team, derived: DerivedInputs, rosterMean: number): number => {
  const upside = derived.youngUpsideByTeam.get(team.id);
  // A club with no young player at all is not "neutral" on a farm-system read, it is BAD at it.
  // Defaulting to the floor rather than the midpoint is the difference between an opinion and
  // an absence, and this read is specifically about what a club has coming.
  const farmGrade = scale(upside ?? 0, 40, 85);
  const meanAge = derived.meanAgeByTeam.get(team.id) ?? 29;
  // Younger is better for upside, and the term is deliberately gentle: a very young club is
  // often a very bad club, and Wardley's weakness is exactly that he overrates the prospect.
  const ageCurve = scale(meanAge, 32, 25);
  const surplus = scale(
    derived.rosterStrength.get(team.id) ?? rosterMean,
    rosterMean - 6,
    rosterMean + 6,
  );
  return farmGrade * 0.35 + ageCurve * 0.3 + surplus * 0.2 + 0.15;
};

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

/**
 * SCINTILLA -- anomaly interrogation.
 *
 * A NEW METHOD, and the reason is worth stating because `systematic` was the tempting home for it.
 * Sallow's `systematic` is a fitted base rate: he PRODUCES the number. Scintilla does not produce
 * anything, he takes a number the rest of the desk has already agreed on and asks whether the
 * arithmetic behind it survives contact with the season. Same subject matter, opposite verbs, and the
 * two reads disagree in a way a bettor can see.
 *
 * ONLY TWO TERMS, AND THAT IS NOT A GAP TO BE FILLED LATER.
 *
 * The design called for four: sustained rate, expected versus actual, sequence and split, recency.
 * Two of those have no source in `MediaReadInput`.
 *
 *   - SEQUENCE AND SPLIT does not exist. `Team` carries no home/away split and `MediaReadInput`
 *     carries no game log, so there is nothing to compute a split from. Inventing one would mean
 *     modelling it, and a modelled split is a number that looks measured on a card that says
 *     "Sustained rate, Expected versus actual, Sequence and split".
 *   - RECENCY does not exist either, for the same reason: `recentForm` is built from the team's
 *     record, which is cumulative, and `winStreakByTeam` is returned EMPTY. Recency needs the last
 *     N games in order and there is no ordered log to read.
 *
 * So his `weights` list carries two entries, not four. A card showing a weight the read does not use
 * is a card lying about what produced the price, which is the one thing this layer is not allowed to
 * do. If split and game-log data arrive, the terms get added and the profile grows with them.
 *
 * What IS measurable, and is what he trades on:
 *
 *   - RUN-RATE DIFFERENTIAL, per game, scored against allowed. This is the sustained rate term.
 *   - EXPECTATION GAP, and this is the genuinely Scintilla one: `Team.previousBaselineWins` is the
 *     club's historical expectation, so actual wins minus expected wins is a measured deviation
 *     between what the league thought and what the club did. It is the only place in the media layer
 *     where a club's own record is compared against its own history rather than against the league.
 *
 * The early-season guard is not cosmetic. With three games played, both terms are noise, and a
 * forecaster whose whole character is over-reading small samples would be exactly the wrong person
 * left to over-read them. He sits at the midpoint until there is enough season to deviate from.
 */
const SCINTILLA_MIN_GAMES = 20;
const SCINTILLA_RUN_TILT = 0.10;
const SCINTILLA_GAP_TILT = 0.14;
const scintillaScore = (team: Team, derived: DerivedInputs): number => {
  const played = team.wins + team.losses;
  if (played < SCINTILLA_MIN_GAMES) return 0.5;

  const runDiff = scale((team.runsScored - team.runsAllowed) / played, -1.5, 1.5);
  const actualWinPct = team.wins / played;
  const gap = actualWinPct - derived.leagueMeanWinPct;

  return 0.5 + (runDiff - 0.5) * SCINTILLA_RUN_TILT + gap * SCINTILLA_GAP_TILT;
};

const SCORERS: Record<MediaMethod, (team: Team, derived: DerivedInputs, rosterMean: number) => number> = {
  advanced: hollisScore,
  conventional: (team, derived) => glorestScore(team, derived),
  attention: (team, derived) => {
    const raw = popularityOf(team, derived);
    return 0.5 + (raw - 0.5) * OVERCONFIDENCE;
  },
  systematic: (team, derived) => sallowScore(team, derived),
  contrarian: (team, derived, rosterMean) => jardinsScore(team, derived, rosterMean),
  beat: (team, derived, rosterMean) => boyleScore(team, derived, rosterMean),
  macro: (team, derived) => mussadScore(team, derived),
  scout: (team, derived, rosterMean) => wardleyScore(team, derived, rosterMean),
  analytical: (team, derived) => scintillaScore(team, derived),
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
