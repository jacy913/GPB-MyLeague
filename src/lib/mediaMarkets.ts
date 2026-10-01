import type { Game, Team } from '../types';
import type { AwardEntry } from './awardRace';
import { MEDIA_PROFILES, type MediaId } from '../data/media';
import {
  WORLD_SERIES_MARKET_KEY, buildFieldMarket, buildLineMarket,
  type FieldMarket, type LineMarket,
} from './markets';
import { titleContenders } from './futuresRisk';

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
  /**
   * Each forecaster's UN-NORMALISED score per club.
   *
   * Not the index. The index is a rank rescaled 0-100, so inside a sixteen-team
   * division it always spans exactly 100 points whether the clubs are miles
   * apart or level -- it has thrown the underlying strength gap away by
   * construction. mediaReads says as much about itself.
   */
  scoreBy: Record<MediaId, Map<string, number>>;
  /**
   * Regular-season games each club has left, for title-contention purposes.
   *
   * OPTIONAL, and the board behaves differently without it. With no standings the
   * live field falls back to counting outcomes above a probability floor, which
   * measures 32 every day of the season and is therefore not worth displaying as a
   * curve. With standings the field is arithmetic.
   */
  gamesRemainingByTeamId?: ReadonlyMap<string, number>;
  /** Clubs whose league championship is already decided against them. */
  eliminatedFromLeague?: ReadonlySet<string>;
}

/**
 * How fast a forecaster's score converts into win probability.
 *
 * Multiplier on the exponent, per unit of raw score, so a bigger value means a
 * steeper read.
 *
 * These are SCORE units, not rank units, and the difference is roughly two
 * orders of magnitude. tools/fitFuturesScale.ts measures the score spread inside
 * a division: about 0.30 for Hollis, 0.50 for Glorest, 0.15 for Sharply. The
 * shipped values were 0.42 / 0.38 / 0.62, which against a spread of 0.3 moved
 * a probability by well under a point -- so every club in a division was posted
 * at the same price, and the board opened at +143 across the field.
 *
 * The behaviour comes from tools/fitFuturesTemperature.ts, which plays seasons
 * out and checks how often each read names the actual division winner: 62.5 per
 * cent against 25 per cent for a blind pick, on four-team divisions. A read
 * that good means the leader genuinely deserves somewhere near 55-60 per cent,
 * which is what 8.0 produces for Hollis here.
 *
 * The three differ without being hand-tuned, because their score spreads
 * differ. At this temperature Hollis posts a leader near -133, Glorest near
 * -285 because his raw scores are spread nearly twice as wide, and Sharply
 * near +144 because his are half as wide. Glorest being the most decisive is
 * consistent with what the media page already shows about him.
 */
const FUTURES_TEMPERATURE: Record<MediaId, number> = {
  hollis: 8.0,
  glorest: 8.0,
  sharply: 8.0,
};

/**
 * A soft-max fitted on a four-team division cannot be reused on a sixteen-team
 * league.
 *
 * The temperature sets the log-odds between neighbouring clubs, so it produces
 * a fixed RATIO between first and second. Over four clubs a leader at 57 per
 * cent is a strong read. Over sixteen, the same ratio leaves the leader near 90
 * per cent and the bottom of the field under 1 per cent -- which is not a
 * sharper forecast, it is the same forecast spread over four times as many
 * outcomes, and the tail prices become meaningless longshots that all crowd
 * against the same cap.
 *
 * The correction is the standard one: a log-odds model over N outcomes needs
 * the exponent divided by the square root of N, which holds the top-two ratio
 * roughly constant as the field grows. Four clubs is the reference, so the
 * divisor is sqrt(N / 4).
 */
const temperatureFor = (base: number, fieldSize: number): number =>
  base / Math.sqrt(Math.max(1, fieldSize) / 4);

/**
 * Soft-max over a group, in the forecaster's own score units.
 *
 * A soft-max rather than a fixed per-club number, so a race with one clear
 * favourite produces a decisive price and a tight one produces a long shot list.
 * The scores are centred on the group mean before the exponential, so a division
 * where everyone is strong is not priced differently from one where everyone is
 * weak.
 */
const softMaxProbabilities = (scores: number[], temperature: number): number[] => {
  if (scores.length === 0) return [];
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const exps = scores.map((score) => Math.exp((score - mean) * temperature));
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
      /*
       * Each forecaster's own probability for EACH club.
       *
       * This used to compute the full soft-max per forecaster, take the maximum,
       * and then hand that single number to every club in the division. So all
       * sixteen clubs were posted at the favourite's price -- a division market
       * where the last-place team and the leader cost the same.
       *
       * The soft-max is already a distribution over the field, so every club
       * simply gets its own element of it.
       */
      const probabilityBy = new Map<string, Record<MediaId, number>>();
      MEDIA_PROFILES.forEach((profile) => {
        const scores = members.map((team) => input.scoreBy[profile.id].get(team.id) ?? 0);
        const probabilities = softMaxProbabilities(
          scores, temperatureFor(FUTURES_TEMPERATURE[profile.id], members.length),
        );
        members.forEach((team, position) => {
          const existing = probabilityBy.get(team.id) ?? {} as Record<MediaId, number>;
          existing[profile.id] = probabilities[position] ?? 0;
          probabilityBy.set(team.id, existing);
        });
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
          probability: probabilityBy.get(team.id) ?? ({} as Record<MediaId, number>),
        })),
      });
    })
    .sort((a, b) => a.title.localeCompare(b.title));
};

export const buildDivisionMarkets = (input: FuturesInput): FieldMarket[] =>
  groupMarkets(input, 'division', (team) => `${team.league} ${team.division}`, (groupId) => groupId);

export const buildLeagueMarkets = (input: FuturesInput): FieldMarket[] =>
  groupMarkets(input, 'league', (team) => team.league, (league) => `${league} League`);

/**
 * The championship futures board: who wins the title, out of every club in the league.
 *
 * This is the market the original request was actually about -- "a hail mary bet of
 * who will win the world series, high risk high reward at the start of the season
 * and it gets safer as the season draws to a closer" -- and it was the flagship
 * season-long bet that did not exist. `groupMarkets` could not build it, because it
 * partitions clubs into groups and a title is precisely the ONE market that spans
 * every group: a Prestige club and a Platinum club compete for the same thing.
 *
 * WHICH IS EXACTLY WHY THE RISK CURVE IS FREE HERE. A thirty-two-way field in April
 * compresses to four by October with no code at all, because the soft-max reads a
 * shrinking set of live clubs. The tiers in futuresRisk.ts surface that; they do not
 * create it.
 *
 * THE FIELD IS NOT THE LEAGUE FIELD.
 *
 * A league-title market is a race between the eight or so clubs in one league, and
 * its temperature is already fitted for that. This is a race between every club in
 * BOTH leagues, so the same fitted temperature would post a near-certain champion
 * in April and put nine teams under one per cent. `temperatureFor` divides by
 * sqrt(fieldSize / 4) precisely to hold the top-two ratio steady as a field grows, so
 * passing the true field size is the whole correction and it is the same one the
 * existing markets already rely on.
 *
 * A title decided by a playoff series is genuinely harder to forecast than a
 * division won on the season record, and this soft-max does not model a series. It
 * is a season-long strength read, and it is priced as one. That is a real
 * simplification rather than a hidden one, and it is why a champion at 40 per cent
 * in April is a statement about strength rather than a claim about the series.
 */
export const buildWorldSeriesMarkets = (input: FuturesInput): FieldMarket[] => {
  if (input.teams.length === 0) return [];

  /*
   * WHO IS STILL IN IT, from division position rather than from a price.
   *
   * The soft-max over all 32 clubs is nearly uniform, because the forecasters'
   * scores are roster-driven and barely move once a season starts -- measured, one
   * forecaster's spread across the field actually shrank over the year. A
   * near-uniform 32-way distribution has no elimination in it, so the risk curve the
   * request asks for does not appear on its own.
   *
   * What DOES eliminate is arithmetic: a club that can no longer win its division
   * cannot win the title, because the title is decided between two league
   * champions. So the live field is computed from the schedule, and this is where
   * "31 REMAINING" in April and "2 REMAINING" in October come from.
   *
   * Prices are NOT touched. An eliminated club keeps its probability and its price,
   * because the probability is what the forecasters believe and the elimination is
   * what the schedule permits. Overwriting one with the other would be inventing a
   * forecast to match a fact, which is the thing this layer is built not to do.
   */
  const contenders = input.gamesRemainingByTeamId
    ? titleContenders({
        teams: input.teams,
        gamesRemainingByTeamId: input.gamesRemainingByTeamId,
        eliminatedFromLeague: input.eliminatedFromLeague,
      })
    : null;
  const liveOutcomes = contenders ? contenders.size : undefined;

  const probabilityBy = new Map<string, Record<MediaId, number>>();
  MEDIA_PROFILES.forEach((profile) => {
    const scores = input.teams.map((team) => input.scoreBy[profile.id].get(team.id) ?? 0);
    const probabilities = softMaxProbabilities(
      scores, temperatureFor(FUTURES_TEMPERATURE[profile.id], input.teams.length),
    );
    input.teams.forEach((team, position) => {
      const row = probabilityBy.get(team.id) ?? {} as Record<MediaId, number>;
      row[profile.id] = probabilities[position] ?? 0;
      probabilityBy.set(team.id, row);
    });
  });

  return [
    buildFieldMarket({
      kind: 'world_series',
      key: WORLD_SERIES_MARKET_KEY,
      title: 'Championship Winner',
      subtitle: contenders ? `${contenders.size} of ${input.teams.length} in it` : `${input.teams.length} clubs`,
      // Overrides the probability-derived count, because the probability-derived one
      // is 32 all season and therefore says nothing. See the note above.
      liveOutcomesOverride: liveOutcomes,
      entries: input.teams.map((team) => ({
        key: team.id,
        label: team.city,
        sublabel: team.name,
        probability: probabilityBy.get(team.id) ?? ({} as Record<MediaId, number>),
        eliminated: contenders ? !contenders.has(team.id) : undefined,
      })),
    }),
  ];
};

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

  /*
   * Each candidate's own share of the field, per forecaster.
   *
   * This had the same shape of bug as the futures builder: the normalised share
   * of the LEADING candidate was computed and then handed to all eight
   * candidates, so every player in the race was posted at the same price. A
   * 20-to-1 outsider and the front-runner both went on the board at whatever
   * the leader's share was worth.
   *
   * The regression is applied to the whole field before normalising, which is
   * the point of it: pulling the leaders back toward the mean redistributes
   * probability across the field, and the longshots are what end up holding it.
   */
  const probabilityBy = new Map<string, Record<MediaId, number>>();
  MEDIA_PROFILES.forEach((profile) => {
    const shrunk = entries.map((entry) => mean + (entry.total - mean) * (1 - AWARD_REGRESSION[profile.id]));
    const floored = shrunk.map((value) => Math.max(0.1, value));
    const sum = floored.reduce((acc, value) => acc + value, 0);
    entries.forEach((entry, position) => {
      const share = sum > 0 ? (floored[position] ?? 0) / sum : 1 / floored.length;
      const existing = probabilityBy.get(entry.playerId) ?? {} as Record<MediaId, number>;
      existing[profile.id] = share;
      probabilityBy.set(entry.playerId, existing);
    });
  });

  return buildFieldMarket({
    kind: 'award',
    key: `award:${key}`,
    title,
    entries: entries.map((entry) => ({
      key: entry.playerId,
      label: entry.name,
      sublabel: entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free agent',
      probability: probabilityBy.get(entry.playerId) ?? ({} as Record<MediaId, number>),
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
