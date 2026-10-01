/**
 * Risk tiers and live field size for futures markets.
 *
 * The user asked for "a hail mary bet of who will win the world series, high risk
 * high reward at the start of the season and it gets safer as the season draws to a
 * closer". Most of that already happens and none of it is visible.
 *
 * THE RISK CURVE IS NOT SOMETHING THIS FILE CREATES. A thirty-two-way field in April
 * compresses to four by October with nobody writing code for it, because the model
 * reads a shrinking set of live clubs. What was missing was the display, and this
 * module is that display.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THIS MODULE EXISTS TO PROTECT
 * ---------------------------------------------------------------------------
 *
 * THERE IS NO `VALUE` TIER, AND THERE CANNOT BE ONE.
 *
 * Every market in this layer is priced from a fitted, calibrated model plus a
 * margin. `HOUSE_MARGIN = 0.045` and `HOUSE_SHADE = 0.20`, the latter fitted to the
 * explicit criterion that "a bettor with no edge at all, betting one side
 * relentlessly, must not print money". By construction every bet here is
 * expected-value NEGATIVE. A long shot at +1200 is not a smart bet; it is a
 * high-variance ticket that loses about 95 per cent of the time.
 *
 * So if this file offered a tier called VALUE, or if a caller labelled one that way,
 * the UI would be telling the player that a 3 per cent shot is a good bet -- and
 * every hour of calibration work behind the whole layer becomes a lie to them. The
 * genuinely +EV thing in this layer is fading an OUTLIER, and that is a different
 * idea with a different name.
 *
 * The type below encodes this: `FuturesRiskTier` is a closed union whose variants
 * all describe RISK, none of which can be read as endorsement. Adding a member to
 * that union is a deliberate act someone has to write out, which is the point.
 * `assertNoValueTier` exists so a verifier can prove the union has not been widened
 * by accident.
 */

/**
 * How risky a futures outcome is.
 *
 * `hail_mary` is the top of the range and `favourite` the bottom, so the ordering
 * runs from worst to best and a sort on the enum is a sort on risk.
 *
 * The labels are the important part and they are constrained on purpose. None of
 * them says the bet is good, smart, or worth taking. `HAIL MARY` describes variance
 * appetite; `FAVOURITE` describes the field, not an instruction.
 */
export type FuturesRiskTier =
  | 'hail_mary'     // < 5%   -- a lottery ticket
  | 'long_shot'     // 5-15% -- a punt
  | 'contender'     // 15-40%
  | 'favourite';    // > 40%

export const FUTURES_RISK_TIERS: readonly FuturesRiskTier[] = [
  'hail_mary', 'long_shot', 'contender', 'favourite',
];

/**
 * Upper bound of each tier, in consensus probability.
 *
 * Ascending, and checked against the union by `assertNoValueTier` so the table and
 * the type cannot drift apart. A fourth entry here with a name like `value` would be
 * a pricing claim this layer has not earned.
 */
const TIER_CEILINGS: ReadonlyArray<{ tier: FuturesRiskTier; below: number }> = [
  { tier: 'hail_mary', below: 0.05 },
  { tier: 'long_shot', below: 0.15 },
  { tier: 'contender', below: 0.40 },
  { tier: 'favourite', below: 1.01 },
];

/** What each tier is called on screen. Never `VALUE`. */
const TIER_LABELS: Readonly<Record<FuturesRiskTier, string>> = {
  hail_mary: 'HAIL MARY',
  long_shot: 'LONG SHOT',
  contender: 'CONTENDER',
  favourite: 'FAVOURITE',
};

export const futuresRiskLabel = (tier: FuturesRiskTier): string => TIER_LABELS[tier];

/**
 * The tier for one consensus probability.
 *
 * Boundaries are on the tier's own side, so exactly 0.05 is a LONG SHOT rather than
 * a HAIL MARY. That is a coin-flip convention and the two are the same thing to a
 * bettor, but the alternative -- a boundary that reads as inclusive on the low side
 * -- makes 0.05 a hail mary, which is a slightly worse label to attach to something
 * a forecaster genuinely rates.
 */
export const futuresRiskTier = (consensusProbability: number): FuturesRiskTier => {
  const entry = TIER_CEILINGS.find((row) => consensusProbability < row.below);
  return entry?.tier ?? 'favourite';
};

/**
 * The live floor, as a FALLBACK.
 *
 * 0.001 is one in a thousand, inside the precision the prices are quoted to -- a club
 * posted below it is a rounding artefact rather than a live price.
 *
 * BUT IT IS A BACKSTOP, NOT THE REAL ANSWER, and that is the most important thing
 * measured while building this.
 *
 * The plan assumed the risk curve was free: a thirty-two-way April field would
 * "compress to 4 by October without anyone writing code for it, because the model is
 * reading a shrinking set of live teams". Measured over a real season it does not.
 * The leader sat between 4.5 and 6.0 per cent for all 165 days and every one of the
 * 32 clubs stayed above the floor -- because the forecasters' scores are ROSTER-driven
 * and barely move once a season is under way. One forecaster's spread across the
 * field actually SHRANK from 0.32 to 0.13 over the year. A near-uniform 32-way
 * distribution contains no elimination, so a probability floor has nothing to catch.
 *
 * The field is therefore computed from ACTUAL PLAYOFF POSITION. See
 * `titleContenders`. The floor remains for a board built without standings, and it is
 * reported alongside the real count rather than quietly standing in for it.
 */
export const LIVE_OUTCOME_FLOOR = 0.001;

/**
 * Clubs that can still win the title, from division position.
 *
 * THIS IS WHERE THE RISK CURVE ACTUALLY COMES FROM, and it is a fact about the
 * season rather than a property of a probability.
 *
 * The title is decided by `[platinum.champion, prestige.champion]` -- two clubs, one
 * from each league (see `playoffs.ts`). A club can only be a league champion by
 * winning its division, so a club that can no longer win its division cannot win the
 * title, and neither can one whose league championship is decided against it.
 *
 * So the live field is a nested elimination:
 *
 *   32 clubs in April
 *     -> those that can still win a division
 *       -> those whose league championship is still open
 *         -> the actual championship participants
 *
 * The middle step is where most of the compression lives, and it is arithmetic
 * rather than forecasting: a club is out of its division once its wins plus its
 * remaining games fall short of the division leader's current wins. That is a
 * schedule fact, and it is why the board genuinely tightens as October arrives.
 *
 * A club is NOT eliminated merely for trailing. Trailing with games in hand is the
 * normal state of a division in April, and treating that as elimination would empty
 * the board in the first week.
 */
/**
 * Clubs knocked out by their own LEAGUE championship series.
 *
 * The second and tighter half of the elimination, and it only matters once the
 * playoffs begin: a club that has lost its league series cannot be the league
 * champion, and the title is decided between the two league champions.
 *
 * Identified by reading completed `league_series` games rather than by asking the
 * simulation manager, whose seed maps are private. A club counts as eliminated once
 * it has lost a series it is still playing in -- the same "cannot catch up" test the
 * division arithmetic uses, applied to a best-of series rather than a season record.
 */
export const leagueSeriesLosers = (games: ReadonlyArray<{
  homeTeam: string;
  awayTeam: string;
  status: string;
  score: { home: number; away: number };
  playoff?: { round?: string; league?: string; seriesId?: string } | null;
}>): Set<string> => {
  const series = new Map<string, { home: string; away: string; homeWins: number; awayWins: number }>();
  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (game.playoff?.round !== 'league_series') continue;
    const id = game.playoff.seriesId ?? `${game.homeTeam}-${game.awayTeam}`;
    const row = series.get(id) ?? {
      home: game.homeTeam, away: game.awayTeam, homeWins: 0, awayWins: 0,
    };
    if (game.score.home > game.score.away) row.homeWins += 1;
    else if (game.score.away > game.score.home) row.awayWins += 1;
    series.set(id, row);
  }

  const eliminated = new Set<string>();
  series.forEach((row) => {
    // A tie on wins is undecided rather than eliminated -- a series that is level
    // with games to come keeps both clubs alive, and guessing would be inventing a
    // result the schedule has not produced.
    if (row.homeWins > row.awayWins) eliminated.add(row.away);
    else if (row.awayWins > row.homeWins) eliminated.add(row.home);
  });
  return eliminated;
};

export const titleContenders = (input: {
  teams: ReadonlyArray<{ id: string; league: string; division: string; wins: number }>;
  /**
   * Regular-season games each club has left, keyed by team id.
   *
   * Counted from the schedule rather than assumed, because an assumed 162-game
   * season keeps the board looking open for a month after the last game.
   */
  gamesRemainingByTeamId: ReadonlyMap<string, number>;
  /** Clubs whose league championship is already decided against them. */
  eliminatedFromLeague?: ReadonlySet<string>;
}): Set<string> => {
  const leadersByDivision = new Map<string, number>();
  input.teams.forEach((team) => {
    const key = `${team.league} ${team.division}`;
    leadersByDivision.set(key, Math.max(leadersByDivision.get(key) ?? 0, team.wins));
  });

  const contenders = new Set<string>();
  input.teams.forEach((team) => {
    if (input.eliminatedFromLeague?.has(team.id)) return;
    const leaderWins = leadersByDivision.get(`${team.league} ${team.division}`) ?? team.wins;
    const remaining = input.gamesRemainingByTeamId.get(team.id) ?? 0;
    // Can still catch the leader on the games that are left. A tie does not
    // eliminate: a tiebreaker decides a tied division, so a club level with the
    // leader is still in it.
    if (team.wins + remaining >= leaderWins) contenders.add(team.id);
  });
  return contenders;
};

/**
 * How many regular-season games each club has left.
 *
 * Counts UNFINISHED games on the schedule, so a game already played does not count
 * and a playoff game never does.
 */
export const remainingRegularSeasonGames = (
  games: ReadonlyArray<{ homeTeam: string; awayTeam: string; status: string }>,
  isPlayoff: (game: { playoff?: unknown }) => boolean,
): Map<string, number> => {
  const remaining = new Map<string, number>();
  for (const game of games) {
    if (game.status === 'completed') continue;
    if (isPlayoff(game as { playoff?: unknown })) continue;
    remaining.set(game.homeTeam, (remaining.get(game.homeTeam) ?? 0) + 1);
    remaining.set(game.awayTeam, (remaining.get(game.awayTeam) ?? 0) + 1);
  }
  return remaining;
};

export const liveOutcomeCount = (
  outcomes: ReadonlyArray<{ consensusProbability: number }>,
): number => outcomes.filter((outcome) => outcome.consensusProbability > LIVE_OUTCOME_FLOOR).length;

/**
 * The risk read for one market, as a row would show it.
 *
 * `remaining` is about the FIELD, not about this outcome: a hail mary in a
 * thirty-two-way field in April and a hail mary in a four-way field in October are
 * the same probability and a very different bet, and the field size is what tells
 * them apart.
 */
export interface FuturesRiskRead {
  tier: FuturesRiskTier;
  label: string;
  remaining: number;
  /** True when this outcome has dropped to or below the live floor. */
  eliminated: boolean;
}

export const futuresRiskRead = (
  outcomes: ReadonlyArray<{ consensusProbability: number }>,
  consensusProbability: number,
): FuturesRiskRead => ({
  tier: futuresRiskTier(consensusProbability),
  label: TIER_LABELS[futuresRiskTier(consensusProbability)],
  remaining: liveOutcomeCount(outcomes),
  eliminated: consensusProbability <= LIVE_OUTCOME_FLOOR,
});

/**
 * Prove the tier union has not been widened into a recommendation.
 *
 * A verifier calls this so that "there is no VALUE tier anywhere" is a checked
 * property rather than a convention that decays. It also checks the ceiling table
 * covers every tier, because a tier with no band would silently fall through to
 * `favourite` and quietly relabel a long shot as a pick.
 *
 * Returns the problems found, empty when the invariant holds.
 */
export const assertNoValueTier = (): string[] => {
  const problems: string[] = [];
  FORBIDDEN_TIER_WORDS.forEach((word) => {
    if (FUTURES_RISK_TIERS.some((tier) => tier.includes(word))) {
      problems.push(`a risk tier is named "${word}", which reads as a recommendation`);
    }
  });
  // Both directions, because either one alone is a silent bug: a tier with no band
  // falls through to `favourite` and quietly relabels a long shot as a pick, and a
  // band with no tier is dead configuration that looks like coverage.
  FUTURES_RISK_TIERS.forEach((tier) => {
    if (!TIER_CEILINGS.some((row) => row.tier === tier)) {
      problems.push(`tier "${tier}" has no probability band and would fall through to favourite`);
    }
  });
  TIER_CEILINGS.forEach((row) => {
    if (!FUTURES_RISK_TIERS.includes(row.tier)) {
      problems.push(`band "${row.tier}" exists in the table but not in the tier union`);
    }
  });
  return problems;
};

/**
 * Words no tier may contain.
 *
 * A substring check on the tier identifier, so `value`, `smart`, `edge`, `good` and
 * `take` are all refused. Cheap to enforce and the whole point: the failure mode
 * this guards against is someone adding a fifth tier that reads as advice, which
 * would be a one-line change without this.
 */
const FORBIDDEN_TIER_WORDS: readonly string[] = ['value', 'smart', 'edge', 'good', 'take'];
