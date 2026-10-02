/**
 * Playoff probability, by Monte Carlo over the remainder of the season.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILLS IN, AND WHY IT WAS THE BIG ONE
 * ---------------------------------------------------------------------------
 *
 * `teamValue.ts` lists `playoffProbability` as its fourth term and sets
 * `PLAYOFF_PROBABILITY_AVAILABLE = false`, so `buildHxseIndices` throws and refuses to publish
 * a composite. That refusal is the whole reason this file exists.
 *
 * The gap is real and it is not an oversight in the engine. `logic/playoffs.ts` computes
 * division winners, league champions and a GPB World Series -- but it computes them
 * RETROACTIVELY and DETERMINISTICALLY. `buildProjectedSeries` picks a winner by comparing
 * records (`compareSeededTeams`) and scores the series with `getProjectedSeriesScore`, a step
 * function on a strength margin. It answers "who is ahead", never "how likely is it". There is
 * no probability anywhere in it and no random draw in the whole 311-line module.
 *
 * So before this, a valuation term meant to capture postseason upside had nothing to read.
 *
 * ---------------------------------------------------------------------------
 * THREE DECISIONS WORTH ARGUING ABOUT
 * ---------------------------------------------------------------------------
 *
 * 1. THE RANDOMNESS IS INJECTED BY SWAPPING `Math.random` FOR A SEEDED STREAM, and this is the
 *    load-bearing choice in the file.
 *
 *    `simulateGame` is the engine's own game simulator and it is the right thing to sample --
 *    it already knows how this league decides a game, including park-adjusted run environment
 *    and home-field advantage. But `calculateWinProbability` is NOT exported from
 *    `logic/simulation.ts`, so the only way to use `simulateGame` here is to let it draw from
 *    the global `Math.random`.
 *
 *    The alternative was to reimplement the win probability here. That would have been tidier
 *    code and the wrong decision: a second copy of the engine's probability model is a model
 *    that will drift from the engine, and it would drift silently, producing a playoff
 *    probability that quietly disagrees with how games are actually simulated. Swapping the
 *    generator means this module cannot disagree with the engine about a single game.
 *
 *    The cost is that the swap is global and therefore not reentrant. It is scoped by
 *    `withSeededRandom`, restored in a `finally`, and the non-reentrancy is documented on that
 *    function rather than discovered later by whoever wires this into a render path.
 *
 * 2. THE BRACKET IS MIRRORED FROM `getLeagueProjection`, NOT INVENTED HERE.
 *
 *    Wild cards are 3v6 and 4v5; the wild-card winners are re-seeded by original seed number;
 *    the divisional pairings are 1v(lower surviving seed) and 2v(upper surviving seed); then a
 *    best-of-7 league series, then a best-of-7 GPB World Series between the two champions.
 *
 *    That bracket is duplicated deliberately -- `playoffs.ts` builds it inline and exports only
 *    the seeds -- but duplicating the real bracket is strictly better than writing a tidy new
 *    one. A Monte Carlo over the wrong bracket still returns plausible numbers, and plausible
 *    numbers are exactly what let a wrong answer survive review.
 *
 * 3. RUN DIFFERENTIAL IS SIMULATED, NOT ASSUMED ZERO.
 *
 *    Seeds are separated by wins, then run differential, then home record, then team id. Run
 *    differential is a live tiebreaker: two clubs tied on wins are separated by who scored more
 *    runs over the remaining schedule. Sampling real scores, rather than pretending every
 *    simulated game is decided by one run, is what makes a tied record resolve the way it would
 *    in the actual league.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS AND IS NOT SIMULATED
 * ---------------------------------------------------------------------------
 *
 * Simulated: every remaining regular-season game, its score, and its effect on records and run
 * differential; the seeding; every playoff series, game by game.
 *
 * NOT simulated: trades, injuries, fatigue, and any in-season roster change. A club's rating is
 * held constant across the remainder of the season.
 *
 * That is a real simplification, and it is biased in a known direction: no roster news means no
 * form change, which makes September baseball more predictable than it is, so these probabilities
 * are TIGHTER than they should be. It is stated here rather than smoothed over. Read them as
 * "given no roster news, how often does this club make the postseason" -- not as a forecast.
 *
 * ONE MORE OMISSION, SMALL BUT NOT NEGLIGIBLE
 *
 * Home record is a genuine seed tiebreaker, and the seeding call needs completed games to read
 * it from. At the point the seeds are computed, the remaining games have been played but not
 * turned back into `Game` objects, so only the REAL played games are passed in. The simulated
 * home record is therefore ignored. Inventing scores to feed the tiebreaker would mean running a
 * second, unreported set of simulated games; declining to is the better of the two.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANTS `checkPlayoffMonteCarlo` ASSERTS
 * ---------------------------------------------------------------------------
 *
 * Two are exact, and both follow from the bracket's structure rather than from tuning:
 *
 *   - Each league's `makePlayoff` probabilities must sum to exactly 6. Six of sixteen clubs
 *     make. If the seeding path ever produced a field of the wrong size, this breaks.
 *   - `championship` must sum to exactly 1 across all clubs. One champion.
 *
 * And one is the reason this module is deterministic at all: identical input plus identical seed
 * must produce identical output, because the caller caches by `(season, date)` and a cached
 * probability that shifted on every render would be a bug wearing the costume of noise.
 *
 * ---------------------------------------------------------------------------
 * COST
 * ---------------------------------------------------------------------------
 *
 * `DEFAULT_TRIALS` is 2000, which is the blueprint's figure rather than a tuned one. Each trial
 * replays every remaining regular-season game plus up to 19 playoff games, so a mid-season call
 * is on the order of a few hundred thousand `simulateGame` calls. That is the "single largest
 * new computation in the project" the plan warned about, and it is why the result is cached per
 * `(season, date)` instead of recomputed per render.
 */

import { getLeaguePlayoffSeeds, type SeededPlayoffTeam } from '../../logic/playoffs';
import { simulateGame } from '../../logic/simulation';
import type { Game, SimulationSettings, Team } from '../../types';

/** Number of simulated seasons. The blueprint's figure, not a tuned one. */
export const DEFAULT_TRIALS = 2000;

/**
 * How many of each league's clubs make the postseason.
 *
 * Asserted rather than assumed: `checkPlayoffMonteCarlo` requires the per-league `makePlayoff`
 * probabilities to sum to exactly this. Six comes from `getLeaguePlayoffSeeds` -- four division
 * winners plus the top two second-place clubs.
 */
export const PLAYOFF_FIELD_SIZE = 6;

export interface MonteCarloInput {
  /** Every club in the league, carrying current ratings and records. */
  teams: Team[];
  /** Regular-season games already completed. These seed the starting records. */
  playedGames: Game[];
  /** Scheduled regular-season games not yet played. This is what gets simulated. */
  remainingGames: Game[];
  settings: SimulationSettings;
  /** Override the trial count. `checkPlayoffMonteCarlo` uses small values to stay quick. */
  trials?: number;
  /**
   * Determinism seed. Two calls with identical inputs and seed return identical probabilities --
   * a tested property, not an aspiration, and the thing that makes the `(season, date)` cache
   * legitimate rather than a source of flicker.
   */
  seed?: number;
}

/** Three tiers, because "makes the playoffs" and "wins the title" are not the same question. */
export interface PlayoffOdds {
  teamId: string;
  /** Probability of reaching the postseason at all. */
  makePlayoff: number;
  /** Probability of taking the division and the league championship. */
  winLeague: number;
  /** Probability of winning the GPB World Series. */
  championship: number;
}

export interface PlayoffMonteCarloResult {
  odds: PlayoffOdds[];
  trials: number;
  seed: number;
  /** Games simulated per trial. Zero means the season is over and nothing was left to sample. */
  gamesSimulatedPerTrial: number;
  /** True when there were no remaining games, so every trial was identical and odds are 0 or 1. */
  exhausted: boolean;
}

/**
 * A small, fast, seedable PRNG (mulberry32).
 *
 * Chosen over `Math.random` for reproducibility and over a cryptographic source for speed -- this
 * runs a few hundred thousand times per call. Seeded explicitly and never from the clock, so a
 * given `(season, date, seed)` always yields the same answer.
 */
const seededRandom = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Run `fn` with the global `Math.random` replaced by a seeded stream.
 *
 * Restored in a `finally`, so an exception mid-simulation cannot leave the whole application
 * drawing from a dead generator -- a corruption far worse than the original exception.
 *
 * NOT REENTRANT. Two overlapping calls would fight over the global, and the loser would get a
 * mangled stream. This is safe in the simulation worker because the worker handles one request at
 * a time. It must NOT be called from a React render path that can overlap itself, which is the
 * reason `playoffMonteCarlo` is worker-only.
 *
 * Exported so its restoration guarantee can be tested, including the throw path. Testing that
 * "the global is put back even when the body raises" otherwise needs a test-only hook, and a
 * test-only hook is worse than an honest export of the thing whose safety matters.
 */
export const withSeededRandom = <T>(rng: () => number, fn: () => T): T => {
  const original = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
};

interface SeasonRecord {
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
}

const blankRecords = (): SeasonRecord => ({ wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 });

/**
 * Replay one simulated remainder of the season and return every club's final record.
 *
 * Games are accumulated onto clones of the input clubs rather than mutating them, so the caller's
 * `teams` array is untouched. That matters: the caller holds the live league state, and a Monte
 * Carlo that quietly mutated it would corrupt the very season it was forecasting.
 */
const simulateRemainder = (input: MonteCarloInput): Team[] => {
  const byId = new Map(input.teams.map((t) => [t.id, t]));
  const records = new Map<string, SeasonRecord>();
  input.teams.forEach((t) => records.set(t.id, blankRecords()));

  // Seed from what has actually happened. This league has no ties, so `home > away` with an else
  // branch is exact rather than an approximation.
  for (const game of input.playedGames) {
    if (game.status !== 'completed' || game.phase !== 'regular_season') continue;
    const home = records.get(game.homeTeam);
    const away = records.get(game.awayTeam);
    if (!home || !away) continue;
    home.runsScored += game.score.home;
    home.runsAllowed += game.score.away;
    away.runsScored += game.score.away;
    away.runsAllowed += game.score.home;
    if (game.score.home > game.score.away) {
      home.wins += 1;
      away.losses += 1;
    } else {
      away.wins += 1;
      home.losses += 1;
    }
  }

  for (const game of input.remainingGames) {
    const homeTeam = byId.get(game.homeTeam);
    const awayTeam = byId.get(game.awayTeam);
    if (!homeTeam || !awayTeam) continue;
    const result = simulateGame(homeTeam, awayTeam, input.settings);
    const home = records.get(game.homeTeam) as SeasonRecord;
    const away = records.get(game.awayTeam) as SeasonRecord;
    home.runsScored += result.homeScore;
    home.runsAllowed += result.awayScore;
    away.runsScored += result.awayScore;
    away.runsAllowed += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.wins += 1;
      away.losses += 1;
    } else {
      away.wins += 1;
      home.losses += 1;
    }
  }

  return input.teams.map((team) => {
    const r = records.get(team.id) as SeasonRecord;
    return {
      ...team,
      wins: r.wins,
      losses: r.losses,
      runsScored: r.runsScored,
      runsAllowed: r.runsAllowed,
    };
  });
};

/**
 * Simulate one best-of-N series between two clubs.
 *
 * Home field alternates with the higher seed at home first, the standard arrangement and the
 * one `simulateGame` expects. Games are played through `simulateGame`, so a playoff series is
 * decided by exactly the model that decides a regular-season game -- no separate postseason model
 * to drift out of step with the engine.
 *
 * The `bestOf + 2` guard on the loop is unreachable given the win condition, and is there because
 * a Monte Carlo that can loop forever is a hang that looks like slowness.
 */
const simulateSeries = (
  topTeam: Team,
  bottomTeam: Team,
  bestOf: number,
  settings: SimulationSettings,
): Team => {
  const winsNeeded = Math.floor(bestOf / 2) + 1;
  let topWins = 0;
  let bottomWins = 0;
  let gameNumber = 0;
  while (topWins < winsNeeded && bottomWins < winsNeeded && gameNumber < bestOf + 2) {
    gameNumber += 1;
    const topIsHome = gameNumber % 2 === 1;
    const result = simulateGame(topIsHome ? topTeam : bottomTeam, topIsHome ? bottomTeam : topTeam, settings);
    const homeWon = result.homeScore > result.awayScore;
    if (homeWon === topIsHome) topWins += 1;
    else bottomWins += 1;
  }
  return topWins >= bottomWins ? topTeam : bottomTeam;
};

/**
 * Run one league's bracket on a finished set of records and return its champion.
 *
 * The pairing structure is copied from `getLeagueProjection` in `logic/playoffs.ts`. The WIN
 * CONDITION differs -- that function projects deterministically, this one plays the games out.
 */
const simulateLeagueBracket = (
  seeds: SeededPlayoffTeam[],
  byId: Map<string, Team>,
  settings: SimulationSettings,
): Team => {
  const club = (seed: SeededPlayoffTeam): Team => byId.get(seed.team.id) as Team;

  const wcA = simulateSeries(club(seeds[2]), club(seeds[5]), 3, settings);
  const wcB = simulateSeries(club(seeds[3]), club(seeds[4]), 3, settings);

  // Surviving wild cards are re-seeded by the seed they ENTERED with, as `getLeagueProjection`
  // does. Sorting by the round won instead would reshuffle them and change the divisional
  // matchups, which would be a different bracket than the one the league actually plays.
  const seedOf = new Map(seeds.map((s) => [s.team.id, s.seed]));
  const survivors = [wcA, wcB].sort((a, b) => (seedOf.get(a.id) as number) - (seedOf.get(b.id) as number));

  const divA = simulateSeries(club(seeds[0]), survivors[1], 5, settings);
  const divB = simulateSeries(club(seeds[1]), survivors[0], 5, settings);
  return simulateSeries(divA, divB, 7, settings);
};

/**
 * The whole computation: one row per club, probabilities as raw trial fractions.
 *
 * No smoothing and no shrinkage toward a prior. At 2000 trials the sampling error on a
 * probability near 0.5 is about 1.1 points of a standard error, sqrt(0.25 / 2000). That is the
 * honest resolution of this method and should not be mistaken for precision -- the check reports
 * it rather than the module pretending to a number it does not have.
 */
export const playoffMonteCarlo = (input: MonteCarloInput): PlayoffMonteCarloResult => {
  const trials = input.trials ?? DEFAULT_TRIALS;
  const seed = input.seed ?? 1;
  const usableRemaining = input.remainingGames.filter((g) => g.phase === 'regular_season');

  const totals = new Map<string, { make: number; league: number; title: number }>();
  input.teams.forEach((t) => totals.set(t.id, { make: 0, league: 0, title: 0 }));

  withSeededRandom(seededRandom(seed), () => {
    for (let trial = 0; trial < trials; trial += 1) {
      const finished = simulateRemainder(input);
      const byId = new Map(finished.map((t) => [t.id, t]));

      let platinumChampion: Team | null = null;
      let prestigeChampion: Team | null = null;

      for (const league of ['Platinum', 'Prestige'] as const) {
        const seeds = getLeaguePlayoffSeeds(finished, input.playedGames, league);
        seeds.forEach((s) => {
          const row = totals.get(s.team.id);
          if (row) row.make += 1;
        });
        const champion = simulateLeagueBracket(seeds, byId, input.settings);
        const row = totals.get(champion.id);
        if (row) row.league += 1;
        if (league === 'Platinum') platinumChampion = champion;
        else prestigeChampion = champion;
      }

      if (platinumChampion && prestigeChampion) {
        const winner = simulateSeries(platinumChampion, prestigeChampion, 7, input.settings);
        const row = totals.get(winner.id);
        if (row) row.title += 1;
      }
    }
  });

  return {
    odds: input.teams.map((t) => {
      const row = totals.get(t.id) as { make: number; league: number; title: number };
      return {
        teamId: t.id,
        makePlayoff: row.make / trials,
        winLeague: row.league / trials,
        championship: row.title / trials,
      };
    }),
    trials,
    seed,
    gamesSimulatedPerTrial: usableRemaining.length,
    exhausted: usableRemaining.length === 0,
  };
};

/**
 * A display-safe reader, for callers that must not emit an out-of-range or non-monotonic number.
 *
 * It enforces two structural facts of the bracket: a club cannot be likelier to win the title
 * than to win its league, nor to win its league than to make the postseason. `checkPlayoffMonteCarlo`
 * asserts BOTH as properties of the raw output -- if they hold there, this function is a no-op,
 * and if they ever fail there, the failure is reported rather than hidden.
 *
 * It deliberately does NOT shrink toward the prior or smooth anything else. Every adjustment to a
 * Monte Carlo estimate ought to be visible and separately justified; a correction baked into the
 * reader is precisely the kind of number nobody can account for a year later.
 */
export const sanitisedPlayoffOdds = (odds: PlayoffOdds): PlayoffOdds => ({
  teamId: odds.teamId,
  makePlayoff: Math.max(0, Math.min(1, odds.makePlayoff)),
  winLeague: Math.max(0, Math.min(odds.makePlayoff, odds.winLeague)),
  championship: Math.max(0, Math.min(odds.winLeague, odds.championship)),
});
