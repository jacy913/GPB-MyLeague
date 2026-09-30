/**
 * Offline metric derivation for batting and pitching.
 *
 * Everything here is a pure function of INTEGER COUNTS. That is the whole
 * design constraint, and it comes from a measured property of the existing
 * accumulators rather than from preference:
 *
 *   playerStats.ts:125  avg  = Number(battingAverage.toFixed(3))
 *   playerStats.ts:126  ops  = Number((obp + slugging).toFixed(3))
 *   playerStats.ts:150  era  = Number(era.toFixed(2))
 *   playerStats.ts:151  whip = Number(whip.toFixed(2))
 *
 * So the season rows store PRE-ROUNDED rates. Recomposing ISO as
 * `slg - avg` from those two stored numbers would inherit up to +/-0.0005 of
 * rounding error in each, and a leaderboard that sorts by the stored `era`
 * would show two pitchers tied at 2.50 who are in truth 0.01 apart. Every rate
 * below is therefore recomputed from counts at full precision, and rounding
 * happens once, at display time.
 *
 * Definitions are transcribed from the engine rather than inferred, and each
 * one carries the line that makes it true. That matters because a later engine
 * change would silently invalidate a definition here, and the comment is what
 * makes it traceable:
 *
 *   gameEngine.ts:1283  every outcome increments plateAppearances
 *   gameEngine.ts:1288  OUT increments atBats
 *   gameEngine.ts:1290  SO  increments atBats and strikeouts
 *   gameEngine.ts:1302  BB  increments walks and NOT atBats
 *   gameEngine.ts:1314  1B increments atBats and hits
 *   gameEngine.ts:1313  ERR increments atBats but NOT hits
 *   gameEngine.ts:1340  2B increments atBats, hits, doubles
 *   gameEngine.ts:1351  3B increments atBats, hits, triples
 *   gameEngine.ts:1372  HR increments atBats, hits, homeRuns
 *
 * Three consequences fall out of that list and are load-bearing below:
 *
 *   1. atBats === plateAppearances - walks. A walk is a plate appearance
 *      without an at-bat, and no other outcome is a plate appearance without
 *      an at-bat, so the on-base denominator is EXACTLY plate appearances.
 *      That is why `obp` below is (hits + walks) / plateAppearances.
 *
 *   2. An error is an at-bat but NOT a hit. So a reach on an error is a ball
 *      in play, which is what real-baseball BABIP counts.
 *
 *   3. hits === singles + doubles + triples + homeRuns exactly, since hits are
 *      credited only on 1B/2B/3B/HR.
 *
 * KNOWN DEVIATIONS FROM REAL BASEBALL. These are the engine's rules, not
 * oversights in this module, and no metric here can recover from them:
 *
 *   - HBP does not exist anywhere in the simulation. There is no such outcome.
 *     So this OBP is (H + BB) / (AB + BB) rather than the real formula, and it
 *     is if anything slightly LOW: a real denominator would also carry hit
 *     batter-pitcher and sacrifice fly, both absent here.
 *   - BABIP's real formula divides hits-among-balls-in-play by
 *     at-bats-plus-sacrifice-flies. There are no sacrifice flies, so the
 *     denominator here is balls in play. The numerator is reduced by home runs,
 *     which is what makes this metric comparable to a real one.
 *   - On an error play the engine zeroes the play's RBI for EVERYONE
 *     (gameEngine.ts:1313) and suppresses the earned run
 *     (gameEngine.ts:846, 852). Real baseball credits an RBI to a runner who
 *     scores on the error, and charges the run to the pitcher. So RBI and
 *     earned runs are both understated here, and understated unevenly -- by
 *     more for teams that commit more errors.
 *   - There is no inherited-runner concept, so every run that scores is
 *     charged to the pitcher of record. ERA is internally consistent but is not
 *     the same quantity as a real-baseball ERA.
 *
 * Division by zero yields `null`, never 0. A player with no at-bats has an
 * UNDEFINED batting average, and reporting 0.000 would put them at the bottom
 * of an AVG leaderboard as though they had gone 0-for-0, which is a different
 * and false claim. `null` lets a leaderboard filter them out instead.
 *
 * WHAT IS DELIBERATELY MISSING, and why. Each of these was considered and
 * left out because the data to compute it correctly does not exist. None of
 * them can be recovered by a cleverer formula, and each is the kind of metric
 * that looks cheap to add and would then be quietly wrong:
 *
 *   - FIP, HR/9, and anything else needing home runs ALLOWED. The season
 *     pitching row has no home-runs-allowed field. It is derivable from the
 *     play log, but the play log is a bounded mirror holding one slate, so a
 *     season-long figure is not available (see below).
 *   - FIP specifically also needs HBP and IFFB. HBP has no outcome at all and
 *     IFFB needs batted-ball data that does not exist. Two of FIP's five inputs
 *     are unavailable, so a fitted FIP would be mostly invented.
 *   - Quality start. Needs run support, which is a team-level quantity, and a
 *     raw completion rate wearing that name would overstate what it measures.
 *   - BABIP's real denominator, which is AB + sacrifice flies. No sacrifice
 *     fly outcome exists, so the denominator is at-bats and the metric is if
 *     anything slightly generous.
 *   - Situational splits of any kind (go-to, with-RISP, vs LHP, count). These
 *     need base occupancy and handedness at the moment of the plate appearance,
 *     which lives only in the play log. The play log is a BOUNDED MIRROR: it
 *     retains whole slates newest-first and holds roughly one slate at season
 *     scale, measured at 14 of 14 games on the newest date of a 2,592-game
 *     season. So a season split computed from it would be a one-day split
 *     wearing a season label. Accumulating split counters as games are played
 *     would fix it, but that means changing src/logic/playerStats.ts, which is
 *     outside the presentation-only scope this work is held to.
 *   - Home/away splits. Measured, not assumed: the pooled home-minus-away run
 *     rate over 2,464 completed games is -0.141 R/G with a paired standard
 *     error of 0.081, and the sign is not stable across repeated runs
 *     (tools/probeHomeAwayFactors.ts). Home and away are noise-dominated here,
 *     so a home/away leaderboard would be ranking players by luck.
 */

import type { PlayerSeasonBatting, PlayerSeasonPitching } from '../../types';

/**
 * A rate that is a proportion of a known count, carrying the evidence behind
 * it. Leaderboards filter on `standardError` rather than on an arbitrary
 * minimum sample, so the guard is a statement about precision instead of a
 * number nobody can justify.
 */
export interface ProportionEstimate {
  value: number;
  /** The count the proportion is taken over. Zero means undefined, not 0. */
  denominator: number;
  /** Binomial standard error sqrt(p(1-p)/n). Null when n is 0. */
  standardError: number | null;
}

export interface BattingCounts {
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  runsScored: number;
  rbi: number;
}

export interface PitchingCounts {
  games: number;
  gamesStarted: number;
  saves: number;
  /** Decimal innings, so outs === inningsPitched * 3. See the file header. */
  inningsPitched: number;
  hitsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
}

/**
 * Integer totals, and rates as `number | null`.
 *
 * The totals are carried alongside the rates on purpose: a rate without its
 * count cannot be weighed, and every one of these can be made to look
 * impressive with a tiny sample. A caller that wants a real leaderboard reads
 * the count.
 */
export interface BattingMetrics {
  // Totals
  singles: number;
  extraBaseHits: number;
  totalBases: number;
  ballsInPlay: number;
  /** At-bats plus walks. Identical to plateAppearances in this engine. */
  onBaseOpportunities: number;

  // Rates
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  babip: ProportionEstimate | null;
  bbPct: ProportionEstimate | null;
  kPct: ProportionEstimate | null;
  kMinusBbPct: number | null;
  /** Walks per strikeout. Undefined with zero strikeouts. */
  bbPerStrikeout: number | null;

  runsPerGame: number | null;
  rbiPerGame: number | null;
}

export interface PitchingMetrics {
  /** Outs, derived from decimal innings. */
  outs: number;
  /** K/9, the standard strikeout rate. */
  kPer9: number | null;
  bbPer9: number | null;
  /** (K - BB) / 9. The one rate stat here with no pre-rounded counterpart. */
  kMinusBbPer9: number | null;
  hitsPer9: number | null;
  /** (K + BB) / IP. The standard "power" companion to WHIP. */
  kbb: number | null;
  era: number | null;
  whip: number | null;
  /** Saves per 9 innings, so a reliever and a starter are on one scale. */
  savesPer9: number | null;
  /** Games pitched out of the bullpen, i.e. appearances minus starts. */
  reliefAppearances: number;
  inningsPerStart: number | null;
}

/**
 * A proportion, with its binomial standard error, or null when the count is
 * zero. The standard error is what a leaderboard filters on, so it is computed
 * here from the observed proportion rather than assumed from a table.
 */
const proportion = (numerator: number, denominator: number): ProportionEstimate | null => {
  if (!(denominator > 0)) {
    return null;
  }
  const value = numerator / denominator;
  return {
    value,
    denominator,
    standardError: Math.sqrt((value * (1 - value)) / denominator),
  };
};

/** A plain ratio, or null when the denominator is zero. */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

export const toBattingCounts = (stat: PlayerSeasonBatting): BattingCounts => ({
  gamesPlayed: stat.gamesPlayed,
  plateAppearances: stat.plateAppearances,
  atBats: stat.atBats,
  hits: stat.hits,
  doubles: stat.doubles,
  triples: stat.triples,
  homeRuns: stat.homeRuns,
  walks: stat.walks,
  strikeouts: stat.strikeouts,
  runsScored: stat.runsScored,
  rbi: stat.rbi,
});

export const toPitchingCounts = (stat: PlayerSeasonPitching): PitchingCounts => ({
  games: stat.games,
  gamesStarted: stat.gamesStarted,
  saves: stat.saves,
  inningsPitched: stat.inningsPitched,
  hitsAllowed: stat.hitsAllowed,
  earnedRuns: stat.earnedRuns,
  walks: stat.walks,
  strikeouts: stat.strikeouts,
});

/**
 * Same construction the accumulator uses at playerStats.ts:116-117, so a
 * metric computed here agrees with the stored `avg` and `ops` to within their
 * stored rounding and no further. `singles` is floored at zero because the
 * accumulator floors it, and a floor that differed between the two would make
 * them disagree on well-formed input.
 */
export const battingMetrics = (counts: BattingCounts): BattingMetrics => {
  const {
    gamesPlayed,
    plateAppearances,
    atBats,
    hits,
    doubles,
    triples,
    homeRuns,
    walks,
    strikeouts,
    runsScored,
    rbi,
  } = counts;

  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const totalBases = singles + doubles * 2 + triples * 3 + homeRuns * 4;
  const extraBaseHits = doubles + triples + homeRuns;
  // Every at-bat is either a strikeout, a home run, or a ball put in play. A
  // reach on an error is a ball in play, so errors are not subtracted here.
  const ballsInPlay = atBats - strikeouts - homeRuns;
  // BABIP asks what share of balls in play became HITS. Home runs are balls in
  // play but are never fielded, so they leave the denominator as well as the
  // numerator, and an error is a ball in play that is not a hit, so it stays in
  // the denominator while contributing nothing above.
  //
  // This is hits-among-balls-in-play, NOT balls-in-play-among-at-bats. Dividing
  // ballsInPlay by atBats instead answers a different question and yields
  // 0.768 in this league where the correct answer is 0.277. An earlier version
  // of this file made exactly that substitution, and the impossible value is
  // what caught it.
  const hitsAmongBallsInPlay = hits - homeRuns;
  const onBaseOpportunities = atBats + walks;

  const avg = ratio(hits, atBats);
  const slg = ratio(totalBases, atBats);
  const obp = ratio(hits + walks, onBaseOpportunities);
  const kPctValue = proportion(strikeouts, plateAppearances)?.value ?? null;
  const bbPctValue = proportion(walks, plateAppearances)?.value ?? null;

  return {
    singles,
    extraBaseHits,
    totalBases,
    ballsInPlay,
    onBaseOpportunities,

    avg,
    obp,
    slg,
    ops: obp !== null && slg !== null ? obp + slg : null,
    // Isolated power: total bases earned beyond the one per hit that AVG
    // already counts. Cannot go negative, because totalBases >= hits always.
    iso: avg !== null && slg !== null ? slg - avg : null,
    babip: proportion(hitsAmongBallsInPlay, ballsInPlay),
    bbPct: proportion(walks, plateAppearances),
    kPct: proportion(strikeouts, plateAppearances),
    kMinusBbPct: kPctValue !== null && bbPctValue !== null ? kPctValue - bbPctValue : null,
    bbPerStrikeout: ratio(walks, strikeouts),

    runsPerGame: ratio(runsScored, gamesPlayed),
    rbiPerGame: ratio(rbi, gamesPlayed),
  };
};

export const pitchingMetrics = (counts: PitchingCounts): PitchingMetrics => {
  const { games, gamesStarted, inningsPitched, hitsAllowed, earnedRuns, walks, strikeouts, saves } = counts;
  // Decimal innings, so outs are exact multiples of 1/3.
  const outs = Math.round(inningsPitched * 3);
  const per9 = (total: number): number | null => (inningsPitched > 0 ? (total * 9) / inningsPitched : null);

  return {
    outs,
    kPer9: per9(strikeouts),
    bbPer9: per9(walks),
    kMinusBbPer9: inningsPitched > 0 ? ((strikeouts - walks) * 9) / inningsPitched : null,
    hitsPer9: per9(hitsAllowed),
    kbb: ratio(strikeouts + walks, inningsPitched),
    era: ratio(earnedRuns * 9, inningsPitched),
    whip: ratio(hitsAllowed + walks, inningsPitched),
    savesPer9: per9(saves),
    reliefAppearances: Math.max(0, games - gamesStarted),
    inningsPerStart: ratio(inningsPitched, gamesStarted),
  };
};
