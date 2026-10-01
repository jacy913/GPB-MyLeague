/**
 * Team props: a team's own game, as a market.
 *
 * The expansion plan's 3.4 calls these "a first-class market family, not an
 * afterthought", and gives two reasons in order of importance. The first is
 * editorial -- a prop card showing the same players repeatedly is partly a selection
 * defect and partly a SUPPLY problem, and team props draw from a different pool (the
 * game's own output rather than a player's season rate) so an outlet's card can
 * legitimately mix player and team lines without repeating itself. The second is
 * that they are cheap: a team total is a LINE market, and the plumbing, the ladder and
 * the settlement shape all already exist.
 *
 * ---------------------------------------------------------------------------
 * SETTLEMENT COMES FROM THE PLAY LOG, AND THAT IS THE WHOLE SAFETY ARGUMENT
 * ---------------------------------------------------------------------------
 *
 * Every play-log event carries `battingTeamId`, so every team total here is summed
 * from the same persisted log the player props settle from. Not from `game.stats`,
 * which happens to carry `awayHits` and `homeRuns` but nothing else, and not from the
 * season aggregate.
 *
 * That matters because the alternative is a second definition of "team hits" -- one in
 * the settlement code and one in whatever wrote the stat -- and a bet settles against
 * whichever one the developer remembered. The engine already asserts that player hits
 * sum to team hits, so this reconstruction is cross-checkable against a number the
 * engine considers load-bearing, and `verifyTeamProps.ts` does exactly that.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY LINE IS FITTED RATHER THAN DERIVED
 * ---------------------------------------------------------------------------
 *
 * The plan's constraint 3 is blunt: "a team hits line guessed from the team batting
 * average will be mispriced -- team-level aggregates are smoother than player rates
 * and will look plausible while being wrong."
 *
 * That is not a hypothetical here. A team total is close to Poisson, so the same
 * model shape that fits a player's game total fits a team's rather better -- which is
 * precisely the problem. A smoother distribution means a narrower one, and a model
 * that is slightly too fat on a player's line is badly too fat on a team's, because
 * the team line sits in the body of the distribution where the tails matter most.
 *
 * So the constants are fitted per stat by `tools/fitTeamProps.ts` and gated by
 * `tools/verifyTeamProps.ts` on the same terms as the player props, including the
 * tradeability floor that catches a market that never pays.
 */

import { reconstructPlayerGameLines } from './playerProps';
import type { Game } from '../types';

export type TeamStatKey =
  | 'teamRuns'
  | 'teamHits'
  | 'teamWalks'
  | 'teamStrikeouts'
  | 'teamExtraBaseHits'
  | 'teamTotalBases';

export interface TeamStatConfig {
  key: TeamStatKey;
  singular: string;
  plural: string;
  /** The line market reads over/under this number, not over a player count. */
  settlementNote: string;
}

export const TEAM_STATS: Record<TeamStatKey, TeamStatConfig> = {
  teamRuns: {
    key: 'teamRuns', singular: 'Run', plural: 'Runs',
    settlementNote: 'scored by the club, summed from the play log',
  },
  teamHits: {
    key: 'teamHits', singular: 'Hit', plural: 'Hits',
    settlementNote: 'recorded by the club, summed from the play log',
  },
  teamWalks: {
    key: 'teamWalks', singular: 'Walk', plural: 'Walks',
    settlementNote: 'drawn by the club, summed from the play log',
  },
  teamStrikeouts: {
    key: 'teamStrikeouts', singular: 'Strikeout', plural: 'Strikeouts',
    settlementNote: 'committed by the club, summed from the play log',
  },
  teamExtraBaseHits: {
    key: 'teamExtraBaseHits', singular: 'Extra Base Hit', plural: 'Extra Base Hits',
    settlementNote: 'doubles + triples + home runs by the club, summed from the play log',
  },
  teamTotalBases: {
    key: 'teamTotalBases', singular: 'Total Base', plural: 'Total Bases',
    settlementNote: 'hits + doubles + 2x triples + 3x home runs by the club, from the play log',
  },
};

/**
 * One side's totals for one game, from the play log.
 *
 * The `home` flag is taken from the event's own `half` rather than from
 * `game.awayTeam`/`game.homeTeam`, because `half` is what the engine wrote at the
 * moment the play happened. Deriving it from the event rather than from the fixture
 * means a game played at a neutral site, or any future three-team arrangement, still
 * attributes each play to the side that actually batted.
 */
export interface TeamGameLine {
  teamId: string;
  runs: number;
  hits: number;
  walks: number;
  strikeouts: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  /** Runs in the first `firstHalfInnings` innings, for a first-inning market. */
  firstHalfRuns: number;
  extraBaseHits: number;
  totalBases: number;
}

const isHitOutcome = (outcome: string): boolean =>
  outcome === '1B' || outcome === '2B' || outcome === '3B' || outcome === 'HR';

/**
 * How many innings the "first half" covers.
 *
 * The engine already splits at the half game for the `first5` market, and this
 * matches it rather than inventing a second definition of "early".
 */
export const FIRST_HALF_INNINGS = 5;

/**
 * Both sides' totals, reconstructed from the play log.
 *
 * EXACT, and the engine asserts the same invariant independently: it throws if player
 * hits do not sum to `awayHits + homeHits`, and if the line score does not sum to the
 * final score. So this reconstruction is cross-checked against numbers the engine
 * treats as load-bearing, which is what makes it trustworthy as a settlement source
 * rather than merely plausible.
 */
export const reconstructTeamGameLines = (game: Game): {
  away: TeamGameLine | null;
  home: TeamGameLine | null;
} => {
  const raw = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
  if (!raw) return { away: null, home: null };

  let events: Array<{
    half?: string;
    inning?: number;
    battingTeamId?: string | null;
    outcome?: string;
    scoreAway?: number;
    scoreHome?: number;
  }>;
  try {
    events = JSON.parse(raw);
  } catch {
    // A malformed log settles nothing rather than settling to zero. See the note on
    // `resultFor` in wallet.ts: VOID is for a market that can no longer be decided.
    return { away: null, home: null };
  }

  const blank = (teamId: string): TeamGameLine => ({
    teamId, runs: 0, hits: 0, walks: 0, strikeouts: 0,
    doubles: 0, triples: 0, homeRuns: 0, firstHalfRuns: 0,
    extraBaseHits: 0, totalBases: 0,
  });

  const away: TeamGameLine | null = { ...blank(game.awayTeam) };
  const home: TeamGameLine | null = { ...blank(game.homeTeam) };

  for (const event of events) {
    if (!event.battingTeamId || !event.outcome) continue;
    const isTop = event.half === 'top';
    // A play whose team is neither side is not ours to attribute, and dropping it
    // silently would be a settlement guess. The final score is the cross-check.
    const line = event.battingTeamId === game.awayTeam ? away
      : event.battingTeamId === game.homeTeam ? home
      : null;
    if (!line) continue;

    const outcome = event.outcome;
    if (isHitOutcome(outcome)) {
      line.hits += 1;
      if (outcome === '2B') line.doubles += 1;
      if (outcome === '3B') line.triples += 1;
      if (outcome === 'HR') line.homeRuns += 1;
    }
    if (outcome === 'BB') line.walks += 1;
    if (outcome === 'SO') line.strikeouts += 1;
  }

  /*
   * RUNS COME FROM `game.score`, and the first-half split from the LOG'S OWN RUNNING
   * TOTAL.
   *
   * An earlier version read `game.stats.lineScore` and got an empty array, because the
   * line score lives in the engine's session state and is never persisted to `stats`.
   * Every run total therefore came out as zero, `teamRuns` scored 0.000 realised on
   * every line, and its Brier came back at 0.36 -- worse than a coin flip, and a
   * number that read like a modelling result rather than a missing array. That is the
   * fifth time this session a tool has produced a clean figure from code that never
   * measured anything, and the reason the per-line realised column now exists.
   *
   * `game.score` is the right source anyway: it is the number the engine validates the
   * line score against, and it is the number a bettor watched. Taking a run total from
   * anywhere else is a second definition of who scored.
   *
   * The first-half split has no equivalent persisted field, but every play-log event
   * carries `inning` and the running `scoreAway`/`scoreHome`, so the score at the end
   * of the fifth inning is readable from the log itself.
   */
  if (away) away.runs = game.score.away;
  if (home) home.runs = game.score.home;

  for (const event of events) {
    const inning = event.inning ?? 0;
    if (inning >= FIRST_HALF_INNINGS) continue;
    const isTop = event.half === 'top';
    if (away && isTop) away.firstHalfRuns = event.scoreAway ?? away.firstHalfRuns;
    if (home && !isTop) home.firstHalfRuns = event.scoreHome ?? home.firstHalfRuns;
  }

  [away, home].forEach((line) => {
    if (!line) return;
    line.extraBaseHits = line.doubles + line.triples + line.homeRuns;
    line.totalBases = line.hits + line.doubles + 2 * line.triples + 3 * line.homeRuns;
  });

  return { away, home };
};

/** One team total out of a reconstructed line. */
export const teamActualStat = (
  line: TeamGameLine,
  stat: TeamStatKey,
): number => {
  switch (stat) {
    case 'teamRuns': return line.runs;
    case 'teamHits': return line.hits;
    case 'teamWalks': return line.walks;
    case 'teamStrikeouts': return line.strikeouts;
    case 'teamExtraBaseHits': return line.extraBaseHits;
    case 'teamTotalBases': return line.totalBases;
    default: return 0;
  }
};

/**
 * The line each team stat is offered around, as a fraction of the club's own rate.
 *
 * PLACEHOLDERS pending the fit, and marked as such for the same reason the player
 * prop constants are: a team line guessed from a team batting average is the specific
 * mispricing the plan warns about. Shaped low because a "safe" team line is the point
 * -- a team total is far more predictable than a player's, which is exactly why it
 * needs its own fit rather than the player's.
 */
export const TEAM_LINE_RANGE: Record<TeamStatKey, {
  offset: number; step: number; span: number; min: number; max: number;
}> = {
  teamRuns: { offset: -1.5, step: 0.5, span: 2.0, min: 0.5, max: 8.5 },
  teamHits: { offset: -2.0, step: 0.5, span: 2.0, min: 1.5, max: 12.5 },
  teamWalks: { offset: -1.0, step: 0.5, span: 1.5, min: 0.5, max: 6.5 },
  teamStrikeouts: { offset: -1.5, step: 0.5, span: 2.0, min: 0.5, max: 9.5 },
  teamExtraBaseHits: { offset: -0.5, step: 0.5, span: 1.0, min: 0.5, max: 4.5 },
  teamTotalBases: { offset: -2.5, step: 0.5, span: 2.5, min: 2.5, max: 16.5 },
};

/**
 * Prior games and dispersion per team stat.
 *
 * PLACEHOLDERS, AND NOT SHIPPABLE. The family is NOT wired into the board, because
 * five of the six stats fail the fit outright:
 *
 *   teamRuns   Brier 0.2076   fits
 *   teamWalks  Brier 0.2821   worse than a coin flip
 *   teamHits   Brier 0.3503   worse than a coin flip
 *
 * A Brier at or above 0.2500 is worse than calling every market 50/50, so these are
 * not prices a bettor should be asked to take. The expansion plan's claim that team
 * props are cheap -- "there is no new mathematics" -- is true of the SETTLEMENT and
 * not of the PRICING, which needs a model that has not been found yet.
 *
 * WHAT WAS RULED OUT, so the next attempt does not repeat it:
 *
 *   - The inputs are correct. The play-log reconstruction agrees with the engine's own
 *     game records to three decimals (team hits: 8.974 both ways), and the season
 *     aggregate agrees with both. So this is not another mapping bug.
 *   - The distribution is not narrower than Poisson. Measured team hits are mean
 *     8.974 with sd 3.457, where a Poisson at that mean gives 2.996. It is WIDER, so
 *     the plan's "team aggregates are smoother" does not describe this engine.
 *   - Between-team variation is almost nil. The per-club season rate has sd 0.557
 *     around a mean of 8.974, so a team prop has very little team-specific signal to
 *     price and is close to a league-average bet.
 *   - Replacing the logistic shortcut with an accurate normal CDF made every stat
 *     worse, so the shortcut's tail compression was hiding a bias rather than causing
 *     one. The underlying bias is still unidentified.
 *
 * `reconstructTeamGameLines` is sound and is the part worth keeping: it is exact, it
 * is cross-checked against a number the engine treats as load-bearing, and it is the
 * settlement source any future team market would use.
 */
export const TEAM_MODEL_CONSTANTS: Record<TeamStatKey, { priorGames: number; dispersion: number }> = {
  teamRuns: { priorGames: 40, dispersion: 1.0 },
  teamHits: { priorGames: 40, dispersion: 1.0 },
  teamWalks: { priorGames: 40, dispersion: 1.0 },
  teamStrikeouts: { priorGames: 40, dispersion: 1.0 },
  teamExtraBaseHits: { priorGames: 40, dispersion: 1.0 },
  teamTotalBases: { priorGames: 40, dispersion: 1.0 },
};

/**
 * Which team stats exist in the catalogue.
 *
 * EMPTY ON PURPOSE. The family is built, measured and NOT enabled -- five of the six
 * stats score worse than a coin flip, and the plan's rule is that a Brier at or above
 * 0.2500 must not ship. See the note on `TEAM_MODEL_CONSTANTS` for what was measured
 * and what was ruled out.
 *
 * `teamRuns` does fit at 0.2076. It is withheld too, because a one-stat "team" family
 * is not the feature the plan asked for, and because shipping the single stat that
 * happened to work is how a family gets half-built and quietly forgotten. The honest
 * state is the whole family off until a model exists for all of it.
 */
export const TEAM_PROP_STATS: TeamStatKey[] = [];

/** `combo_total` is deliberately absent; see the note in the header. */
export const DEFERRED_TEAM_STATS = [
  'combo_total (needs a fitted JOINT distribution; multiplying two marginals is arithmetically invalid)',
  'btts and first_score (binary, and a cleaner job once the line family is proven)',
  'first_inning (a distinct distribution that needs its own fit rather than a slice of the full game)',
] as const;
