import type { Game, Team } from '../types';
import type { AwardEntry } from './awardRace';
import { MEDIA_PROFILES, type MediaId } from '../data/media';
import {
  buildFieldMarket, buildLineMarket,
  type FieldMarket, type LineMarket,
} from './markets';

/**
 * Market builders.
 *
 * Every market here is a narrowing of the same three reads The Media already
 * publishes, so a forecaster cannot be well behaved in one market and badly
 * behaved in another without it showing. Futures and awards are near-free
 * because the read and the award race already exist; totals are the one market
 * that needs its own model.
 *
 * The leagues constant below is the measured run environment of this simulator,
 * not the real one. The lab puts a team-game at 3.83 runs against a real-MLB
 * 4.28, and bases convert below the real rate, so a game totals about 7.7 here.
 * Using the real figure would put every total in the league half a run light in
 * the same direction every time, which is a systematic, exploitable error
 * rather than noise.
 */
export const LEAGUE_RUNS_PER_TEAM_GAME = 3.83;

/**
 * Where a run total is actually even, as a fraction of its mean.
 *
 * A game total in this simulator is strongly right-skewed: the median game
 * totals 7 runs and the mean is nearer 7.7, because blowouts and walk-off
 * innings pull the average up. A betting line has to be posted where the two
 * sides are genuinely even, and for a skewed distribution that is well BELOW
 * the mean, not at it.
 *
 * Posting at the mean is not a small error. A line at the model's own mean goes
 * over roughly 39.9 per cent of the time across 4,800 settled games, which
 * hands the under a standing profit on essentially every game in the league --
 * a far larger leak than the margin itself.
 *
 * The value is 0.92, fitted by tools/fitHouseShading.ts, which sweeps the
 * fraction against the model's OWN total with the same half-run rounding the
 * board posts. At 0.92 with a 0.25 run margin the measured over rate is 0.4588
 * against a 0.46 target, 0.12 points off.
 *
 * An earlier fit gave 0.89 and looked defensible, but it had measured against a
 * baseline that already had this constant and the margin baked into it, so
 * every candidate was transformed twice. The tool now divides both back out
 * before sweeping, and 0.89 in the output reproduces exactly what ships.
 */
export const TOTAL_LINE_CENTRE = 0.92;

/**
 * Share of a game's runs that land in the first five innings.
 *
 * Measured, not assumed. The obvious prior is 0.48, on the reasoning that five
 * of nine innings is a little over half. Reading the persisted line score off
 * 4,814 completed games gives a mean of 0.5718 and a median of 0.60, so the
 * first five innings are worth closer to three fifths of a game's scoring in
 * this simulator. Using the intuitive 0.48 put every first-five price about
 * 0.7 runs out, in the same direction, every time.
 */
export const FIRST_HALF_SHARE = 0.5718;

/* ------------------------------------------------------------------ *
 * Futures -- division and league winner
 * ------------------------------------------------------------------ */

export interface FuturesInput {
  teams: Team[];
  /** Each forecaster's league-wide read, already computed. */
  indexBy: Record<MediaId, Map<string, number>>;
}

/**
 * Convert a forecaster's field index into a win probability for a group.
 *
 * A soft-max over the field rather than a fixed per-team number, so a race with
 * one clear favourite produces a decisive price and a tight one produces a
 * long shot list. The temperature is fitted per forecaster in the same way the
 * moneyline slope was: Hollis is near his own fitted value, Sharply is
 * deliberately steeper because being certain is his character.
 */
const FUTURES_TEMPERATURE: Record<MediaId, number> = {
  hollis: 0.42,
  glorest: 0.38,
  sharply: 0.62,
};

const softMaxProbabilities = (indices: number[], temperature: number): number[] => {
  const exps = indices.map((index) => Math.exp((index / 100) * temperature));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => (total > 0 ? value / total : 1 / exps.length));
};

const groupMarkets = (
  input: FuturesInput,
  kind: 'division' | 'league',
  groupsOf: (team: Team) => string,
  labelOf: (groupId: string) => string,
): FieldMarket[] => {
  const groups = new Map<string, Team[]>();
  input.teams.forEach((team) => {
    const key = groupsOf(team);
    const bucket = groups.get(key) ?? [];
    bucket.push(team);
    groups.set(key, bucket);
  });

  return [...groups.entries()]
    .map(([groupId, members]) => {
      const probability = {} as Record<MediaId, number>;
      MEDIA_PROFILES.forEach((profile) => {
        const indices = members.map((team) => input.indexBy[profile.id].get(team.id) ?? 50);
        const probabilities = softMaxProbabilities(indices, FUTURES_TEMPERATURE[profile.id]);
        const best = probabilities.indexOf(Math.max(...probabilities));
        probability[profile.id] = probabilities[best] ?? 0;
      });

      return buildFieldMarket({
        kind,
        key: `${kind}:${groupId}`,
        title: labelOf(groupId),
        subtitle: `${members.length} clubs`,
        entries: members.map((team) => ({
          key: team.id,
          label: team.city,
          sublabel: team.name,
          probability,
        })),
      });
    })
    .sort((a, b) => a.title.localeCompare(b.title));
};

export const buildDivisionMarkets = (input: FuturesInput): FieldMarket[] =>
  groupMarkets(input, 'division', (team) => `${team.league} ${team.division}`, (groupId) => groupId);

export const buildLeagueMarkets = (input: FuturesInput): FieldMarket[] =>
  groupMarkets(input, 'league', (team) => team.league, (league) => `${league} League`);

/* ------------------------------------------------------------------ *
 * Awards
 * ------------------------------------------------------------------ */

/**
 * How hard each forecaster regresses a hot start toward the field.
 *
 * The award race in src/lib/awardRace.ts is one shared scoring function, and it
 * should be: there is one set of numbers. What differs is how much a forecaster
 * trusts them this early. A metrics-first correspondent treats a six-week lead
 * as partly luck and pulls it back; a narrative-driven one rides it. That
 * produces genuinely divergent prices early in the season which converge as the
 * sample grows, which is both realistic and the right shape for a price.
 */
const AWARD_REGRESSION: Record<MediaId, number> = {
  hollis: 0.45,
  glorest: 0.25,
  sharply: 0.05,
};

export const buildAwardMarket = (
  key: string,
  title: string,
  entries: AwardEntry[],
): FieldMarket => {
  const totals = entries.map((entry) => entry.total);
  const mean = totals.reduce((sum, value) => sum + value, 0) / Math.max(1, totals.length);

  const probability = {} as Record<MediaId, number>;
  MEDIA_PROFILES.forEach((profile) => {
    const shrunk = entries.map((entry) => {
      const total = entry.total;
      return mean + (total - mean) * (1 - AWARD_REGRESSION[profile.id]);
    });
    const floored = shrunk.map((value) => Math.max(0.1, value));
    const sum = floored.reduce((acc, value) => acc + value, 0);
    const best = floored.indexOf(Math.max(...floored));
    probability[profile.id] = sum > 0 ? (floored[best] ?? 0) / sum : 1 / floored.length;
  });

  return buildFieldMarket({
    kind: 'award',
    key: `award:${key}`,
    title,
    entries: entries.map((entry) => ({
      key: entry.playerId,
      label: entry.name,
      sublabel: entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free agent',
      probability,
    })),
  });
};

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

export interface RunEnvironmentInput {
  teams: Team[];
  /** Roster-derived strength and its league spread. */
  strength: Map<string, number>;
  strengthMean: number;
  strengthSd: number;
  hasSeasonOutput: boolean;
}

const observedScoring = (team: Team): number | null => {
  const played = team.wins + team.losses;
  if (played < 5) return null;
  return team.runsScored / played;
};

const observedAllowed = (team: Team): number | null => {
  const played = team.wins + team.losses;
  if (played < 5) return null;
  return team.runsAllowed / played;
};

/**
 * Per-unit offensive and defensive factors, around 1.0.
 *
 * Expected runs are baseline times this club's attack times its opponent's
 * defence, which is the multiplicative form the at-bat engine actually works in
 * and avoids the additive model that would let a good attack and a good defence
 * cancel into a league-average expectation.
 */
interface RunFactors { off: number; def: number }

const hollisFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  const z = (id: string): number =>
    ((input.strength.get(id) ?? input.strengthMean) - input.strengthMean) / Math.max(1, input.strengthSd);
  return { off: 1 + 0.34 * z(team.id), def: 1 - 0.34 * z(opponent.id) };
};

const glorestFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  if (!input.hasSeasonOutput) return hollisFactors(team, opponent, input);
  const off = observedScoring(team);
  const oppAllowed = observedAllowed(opponent);
  return {
    off: off === null ? 1 : Math.max(0.55, Math.min(1.75, off / LEAGUE_RUNS_PER_TEAM_GAME)),
    def: oppAllowed === null ? 1 : Math.max(0.55, Math.min(1.75, oppAllowed / LEAGUE_RUNS_PER_TEAM_GAME)),
  };
};

/**
 * The attention-driven read on scoring.
 *
 * Squares its own factor, so a club scoring well is credited far more than a
 * metrics read would credit it. This is the same overconfidence the moneyline
 * carries, expressed on the number rather than the probability, and it is why
 * Sharply's totals run hot when a club is on a scoring run and the only
 * genuinely different number on the board.
 */
const sharplyFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  if (!input.hasSeasonOutput) return hollisFactors(team, opponent, input);
  const off = observedScoring(team);
  const oppAllowed = observedAllowed(opponent);
  const square = (value: number): number => {
    if (value <= 0) return 1;
    return Math.max(0.45, Math.min(2.4, 1 + (value - 1) * 1.85));
  };
  return {
    off: off === null ? 1 : square(off / LEAGUE_RUNS_PER_TEAM_GAME),
    def: oppAllowed === null ? 1 : 1 / square(oppAllowed / LEAGUE_RUNS_PER_TEAM_GAME),
  };
};

const FACTORS: Record<MediaId, (team: Team, opponent: Team, input: RunEnvironmentInput) => RunFactors> = {
  hollis: hollisFactors,
  glorest: glorestFactors,
  sharply: sharplyFactors,
};

/**
 * Over/under probability slope, per run.
 *
 * A game total has a standard deviation near three runs, so a one-run move from
 * fair is about a third of a standard deviation and should flip the side roughly
 * 37/63. That gives a slope near 0.53 for a well-calibrated forecaster. Sharply
 * is steeper for the same reason his moneyline is.
 */
const TOTAL_SLOPE: Record<MediaId, number> = {
  hollis: 0.55,
  glorest: 0.50,
  sharply: 0.90,
};

const expectedTotal = (away: Team, home: Team, mediaId: MediaId, input: RunEnvironmentInput): number => {
  const factor = FACTORS[mediaId];
  const awayRun = LEAGUE_RUNS_PER_TEAM_GAME * factor(away, home, input).off * factor(home, away, input).def;
  const homeRun = LEAGUE_RUNS_PER_TEAM_GAME * factor(home, away, input).off * factor(away, home, input).def;
  return awayRun + homeRun;
};

export const buildTotalMarkets = (
  games: Game[],
  input: RunEnvironmentInput,
  teamById: Map<string, Team>,
): LineMarket[] => {
  const priced = games
    .map((game) => {
      const away = teamById.get(game.awayTeam);
      const home = teamById.get(game.homeTeam);
      if (!away || !home) return null;
      return { game, away, home };
    })
    .filter((entry): entry is { game: Game; away: Team; home: Team } => entry !== null);

  if (priced.length === 0) return [];

  /**
   * Level correction, per forecaster.
   *
   * The multiplicative form deflates the league mean before any of it is
   * interesting: the expected product of two factors that vary around 1 is less
   * than 1, so a model built this way prices every total about a run light.
   * Measured, Hollis was coming out 0.92 runs under across the slate.
   *
   * Each forecaster's own slate mean is therefore rescaled back to twice the
   * league baseline, which removes the level error without touching the spread.
   * That distinction matters: overconfidence should show as a forecaster pricing
   * the extremes too hard, not as a forecaster who thinks every game is a
   * shootout. Sharply was running 0.69 runs hot purely from the squaring, which
   * is a bug rather than a personality.
   */
  const baseline = LEAGUE_RUNS_PER_TEAM_GAME * 2;
  const correction = {} as Record<MediaId, number>;
  MEDIA_PROFILES.forEach((profile) => {
    const mean = priced.reduce((sum, entry) => sum + expectedTotal(entry.away, entry.home, profile.id, input), 0)
      / priced.length;
    correction[profile.id] = mean > 0.05 ? baseline / mean : 1;
  });

  return priced.map(({ game, away, home }) => {
    const fair = {} as Record<MediaId, number>;
    MEDIA_PROFILES.forEach((profile) => {
      fair[profile.id] = expectedTotal(away, home, profile.id, input) * correction[profile.id];
    });

    return buildLineMarket({
      kind: 'total',
      key: `total:${game.gameId}`,
      title: `${away.city} at ${home.city}`,
      subtitle: game.date,
      // Centred where the two sides are even rather than at the mean. A game
      // total is right-skewed, so the mean sits above the even-money point and
      // posting there gives the under a standing profit. See TOTAL_LINE_CENTRE.
      fair: MEDIA_PROFILES.reduce((acc, profile) => {
        acc[profile.id] = fair[profile.id] * TOTAL_LINE_CENTRE;
        return acc;
      }, {} as Record<MediaId, number>),
      slope: TOTAL_SLOPE,
    });
  });
};

export const buildFirstHalfMarkets = (totalMarkets: LineMarket[]): LineMarket[] =>
  totalMarkets.map((market) => {
    const fair = {} as Record<MediaId, number>;
    MEDIA_PROFILES.forEach((profile) => { fair[profile.id] = market.fair[profile.id] * FIRST_HALF_SHARE; });
    return buildLineMarket({
      kind: 'first5',
      key: market.key.replace('total:', 'first5:'),
      title: market.title,
      subtitle: market.subtitle,
      fair,
      slope: { hollis: 0.7, glorest: 0.65, sharply: 1.1 },
    });
  });
