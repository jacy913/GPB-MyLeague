import type { Game, Team } from '../types';
import type { AwardEntry } from './awardRace';
import { MEDIA_PROFILES, type MediaId } from '../data/media';
import {
  WORLD_SERIES_MARKET_KEY, buildFieldMarket, buildLineMarket,
  type FieldMarket, type LineMarket, type LockedRace,
} from './markets';
import { titleContenders } from './futuresRisk';
import { BOYLE_BEAT } from './mediaReads';

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
  /**
   * Clubs knocked out of the postseason by a decided series, in ANY round.
   *
   * `eliminatedFromLeague` is only league-series losers, which is the right answer for a division
   * board and the wrong answer for every other one. During the playoffs a club that won its division
   * and lost the wild card is out of its league race and out of the championship race, while the
   * standings arithmetic -- which is frozen once the regular season ends, because playoff games never
   * touch `team.wins` -- still calls it a contender. That is what left a club eliminated in the
   * first round sellable throughout the league championship series.
   *
   * Single elimination is why this needs nothing else: before any playoff game nothing is in the set
   * and the board behaves exactly as it did, so there is no "has the postseason started" flag.
   *
   * NOT applied to the division boards. A wild-card loser is still its division champion, and saying
   * otherwise there would be a false claim on the one market where the club genuinely did win.
   */
  eliminatedFromPlayoff?: ReadonlySet<string>;
  /**
   * Races that already have a winner, keyed by MARKET KEY, from `lockedRaces`.
   *
   * Passed in rather than recomputed per builder, because the three builders are called separately
   * and a closure derived inside each of them is three implementations that agree today and drift
   * the first time one is edited. One map, built once, read three times.
   *
   * The keys match what the builders themselves emit: `division:<league> <division>`,
   * `league:<league>`, and `world_series:champion`. A miss is a lookup returning undefined, which
   * leaves the market OPEN -- the safe direction, since a guessed closure freezes a live race, while
   * a missed one only leaves a decided race briefly sellable, which `placeBet` then refuses.
   */
  lockedRaces?: ReadonlyMap<string, LockedRace>;
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
  /*
   * Nobody moves a futures temperature, which is why all eight are identical and why that is
   * a fact rather than a default. A forecaster with an opinion about how warm the postseason
   * feels would be modelling something no one in this league has an edge on.
   */
  sallow: 8.0,
  jardins: 8.0,
  boyle: 8.0,
  mussad: 8.0,
  wardley: 8.0,
  // Scintilla gets 8.0 too. Nobody moves a temperature, and his score spread is his own to earn.
  scintilla: 8.0,
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

  /*
   * WHO IS STILL IN IT, for every grouped race rather than only the championship.
   *
   * `titleContenders` answers one question -- can this club still win its own division -- and
   * that single answer is correct for BOTH grouped kinds, which is why one computed set serves
   * both and no per-kind logic is needed:
   *
   *   DIVISION  you must win your division.
   *   LEAGUE    the league champion is decided between division champions, so you must win your
   *             division first.
   *
   * So the same set that drives the championship's live field also drives both of these. It was
   * computed only for the championship, which is why a club the schedule had already put out of
   * its division still showed a price and a Back button on every other futures tab.
   *
   * Guarded on `gamesRemainingByTeamId` for the same reason the championship is: with no
   * standings there is nothing to decide from, and asserting a club is eliminated when nobody
   * checked is worse than showing it in contention.
   *
   * Computed once per board rather than per group, because the answer is per-CLUB, not per-group.
   */
  /*
   * `eliminatedFromLeague` for a DIVISION, `eliminatedFromPlayoff` for a LEAGUE.
   *
   * Not a stylistic split. A division is won in September and a league championship in October, so
   * the question each board asks is a different question:
   *
   *   DIVISION  can this club still win its division?  Standings, plus nothing else. A club knocked
   *             out of the wild card is still the division champion.
   *   LEAGUE    can this club still be league champion? It has to survive the playoffs to get there,
   *             so a decided wild-card or divisional loss ends it -- which the standings cannot
   *             know, because the standings stopped moving when the regular season did.
   *
   * Passing the postseason set to a division board was the alternative, and it would have been
   * wrong in the loud direction: the division champion greyed out with "can no longer win".
   */
  const knockedOut = kind === 'league'
    ? input.eliminatedFromPlayoff ?? input.eliminatedFromLeague
    : input.eliminatedFromLeague;

  const contenders = input.gamesRemainingByTeamId
    ? titleContenders({
      teams: input.teams,
      gamesRemainingByTeamId: input.gamesRemainingByTeamId,
      knockedOut,
    })
    : null;

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

      /*
       * The live field for THIS group, which is not the size of the contenders set: contenders
       * spans both leagues, and a four-club division keeps only the ones inside it.
       */
      const liveInGroup = contenders
        ? members.filter((team) => contenders.has(team.id)).length
        : undefined;

      return buildFieldMarket({
        kind,
        key: `${kind}:${groupId}`,
        title: labelOf(groupId),
        /*
         * A grouped race is small enough that the plain club count says nothing. "4 clubs" in
         * September when one of them is out of the race is the sentence the subtitle exists to
         * replace, so it becomes "1 of 4 in it" the moment there is a standings basis for it.
         */
        subtitle: contenders && liveInGroup !== undefined
          ? `${liveInGroup} of ${members.length} in it`
          : `${members.length} clubs`,
        liveOutcomesOverride: liveInGroup,
        /*
         * The closure for THIS group, looked up by the key this builder is about to emit.
         *
         * Read from the shared map rather than derived, so a division that is already won cannot be
         * reported as live by one builder and closed by another. The key is assembled from the same
         * `kind` and `groupId` that produce `market.key` directly above it, so the two cannot drift.
         */
        locked: input.lockedRaces?.get(`${kind}:${groupId}`),
        entries: members.map((team) => ({
          key: team.id,
          teamId: team.id,
          label: team.city,
          sublabel: team.name,
          probability: probabilityBy.get(team.id) ?? ({} as Record<MediaId, number>),
          /*
           * Prices are NOT touched. An eliminated club keeps its probability and its price,
           * because the probability is what the forecasters believe and the elimination is
           * what the schedule permits. Overwriting one with the other would be inventing a
           * forecast to match a fact, which is the thing this layer is built not to do.
           */
          eliminated: contenders ? !contenders.has(team.id) : undefined,
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
  /*
   * The championship race is a bracket, so the postseason eliminations are the whole answer once
   * the postseason starts: in a single-elimination bracket a club that has not lost a decided series
   * can still win it, whatever the standings say. Before the first playoff game the set is empty and
   * this is the standings arithmetic exactly as before.
   */
  const contenders = input.gamesRemainingByTeamId
    ? titleContenders({
        teams: input.teams,
        gamesRemainingByTeamId: input.gamesRemainingByTeamId,
        knockedOut: input.eliminatedFromPlayoff ?? input.eliminatedFromLeague,
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
      /*
       * The title closes on a completed World Series and on nothing else.
       *
       * No amount of standings arithmetic can produce a champion, because the champion is the club
       * that took four games in the final. Win totals say nothing about that, which is why the title
       * board stayed sellable for the whole playoffs before this.
       */
      locked: input.lockedRaces?.get(WORLD_SERIES_MARKET_KEY),
      entries: input.teams.map((team) => ({
        key: team.id,
        teamId: team.id,
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
  /*
   * How much a forecaster trusts SEASON TOTAL against season context, per run.
   *
   * PROVISIONAL for the five. Sharply's 0.05 is the meaningful end of the scale and it is
   * measured: he barely regresses at all, which is why he overrates a hot season. Sallow sits
   * highest among the new because a pure fitted read regresses hardest. Jardins is low
   * because she inverts. Step 5 fits them.
   */
  sallow: 0.40,
  jardins: 0.18,
  boyle: 0.25,
  mussad: 0.30,
  wardley: 0.35,
  /*
   * Scintilla regresses HARD, and this is a measurement of his stated weakness rather than a shrug.
   * He commits to a number and stops counting, so he is the forecaster in this layer most likely to
   * be carried by a hot season. 0.42 is above every fitted forecaster here and above Sallow's 0.40,
   * which is the encoding. Provisional like the five above it; step 5 fits it.
   */
  scintilla: 0.42,
};

/**
 * ONE race, keyed and titled in one place, because two call sites were inventing them separately and
 * that is a silent way to publish two different prices for one player.
 *
 * The dashboard and MacroBet both need the batting and pitching MVP races. Each built its own:
 *
 *   - `BettingPage` hardcoded `['batting_mvp', 'Batting MVP', buildAwardsForBoard(..., 8)]` and
 *     hardcoded the `8`.
 *   - `HomeDashboard` called `buildAwardsForBoard(board, inputs, 3)` for its three visible rows.
 *
 * Nothing threw. The dashboard simply posted the leader at ~34% where the book posted him at ~13%,
 * because `buildAwardMarket` normalises over whatever field it is handed -- and a normalised share
 * is exactly the kind of number that looks right. `tools/checkAwardRacePrice.ts` measures that gap:
 * 21.1 percentage points on the same day, from the same players.
 *
 * So the field size, the key and the title now live here, and the only remaining difference between
 * the two surfaces is `decided` -- which sets sellability and never touches the price.
 */
export const AWARD_RACE_SPECS = {
  batting: { key: 'batting_mvp', title: 'Batting MVP' },
  pitching: { key: 'pitching_mvp', title: 'Pitching MVP' },
} as const;

export const buildAwardMarket = (
  key: string,
  title: string,
  entries: AwardEntry[],
  options: {
    /**
     * True once the season's awards have been decided and archived.
     *
     * This is the `voting_open` closure, and it is the only closure in the codebase that is not
     * arithmetic. A division is out-run and a series is won; an MVP is out-run by nobody -- it is
     * simply the top of a ranked list once the season is over, and the moment that list is archived
     * is the moment the race is over.
     *
     * Which is exactly why this market was an exploit twice over. Before the season began archiving
     * itself, the "winner" was whoever the manager chose in a ballot, so the bet and the decision
     * were the same act. And with no closure at all, the board stayed open after the archive was
     * written -- long enough to back the player who had just been named.
     *
     * The trigger is deliberately the ARCHIVE, not the awards date on the calendar. The two can
     * disagree: the calendar projects a ceremony, while the archive is what actually settles the bet.
     * Locking on the archive closes the board at precisely the moment the money is decided, so
     * there is no window where a market is closed and unsettled, or settled and still open.
     *
     * Optional and defaulting to OPEN, matching every other closure in this codebase. An award
     * market built without it is a live race as far as anyone can tell.
     */
    decided?: boolean;
  } = {},
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

  /*
   * THE WINNER IS `entries[0]`, THE SAME INDEX THE ARCHIVE WRITES.
   *
   * `archiveSeasonAwards` records `candidates[0]` for each award, and `buildAwardsForBoard` is what
   * ranks those candidates, so index 0 is the player who will be named. That is the whole reason an
   * award race stops being a market the moment the season ends: the winner and the price the board
   * was quoting come out of the same ranking.
   *
   * Stated rather than assumed, because the alternative -- a closure with no winner -- is worse than
   * useless. A refusal that cannot name the player leaves the manager no way to tell whether the
   * board is wrong or they are, and `settleWallet` would have nothing to compare the bet against.
   *
   * Guarded on `entries.length > 0` so an empty field closes to nothing rather than to a winnerKey
   * of the empty string, which would match no outcome and settle no bet.
   */
  const decided = options.decided === true && entries.length > 0;

  return buildFieldMarket({
    kind: 'award',
    key: `award:${key}`,
    title,
    ...(decided
      ? { locked: { winnerKey: entries[0]?.playerId ?? '', reason: 'voting_open' as const } }
      : {}),
    entries: entries.map((entry) => ({
      key: entry.playerId,
      teamId: entry.team?.id,
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

/** z-score of a club's latent strength, the shared primitive for the metrics-driven reads. */
const strengthZ = (id: string, input: RunEnvironmentInput): number =>
  ((input.strength.get(id) ?? input.strengthMean) - input.strengthMean)
  / Math.max(1, input.strengthSd);

/**
 * SALLOW -- the fitted base rate, on scoring.
 *
 * A deliberate BALANCE of the two signals the other three pick a side on: latent strength and
 * observed output, weighted evenly. That is what "no editorial tilt" means operationally -- he
 * is the one outlet here who does not believe one of those numbers is more trustworthy than the
 * other, and his run numbers are the reference the other seven are measured against.
 */
const sallowFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  if (!input.hasSeasonOutput) return hollisFactors(team, opponent, input);
  const off = observedScoring(team);
  const oppAllowed = observedAllowed(opponent);
  const clamp = (v: number | null): number | null =>
    v === null ? null : Math.max(0.55, Math.min(1.75, v / LEAGUE_RUNS_PER_TEAM_GAME));
  const fittedOff = 1 + 0.34 * strengthZ(team.id, input);
  const fittedDef = 1 - 0.34 * strengthZ(opponent.id, input);
  const obsOff = clamp(off);
  const obsDef = clamp(oppAllowed);
  return {
    off: obsOff === null ? fittedOff : (fittedOff + obsOff) / 2,
    def: obsDef === null ? fittedDef : (fittedDef + obsDef) / 2,
  };
};

/**
 * JARDINS -- the contrarian, on scoring.
 *
 * She inverts the OBSERVED signal rather than the fitted one. A club that has been scoring is
 * the thing the market is pricing, and her whole position is that what is being priced is
 * already in the number -- so she credits a hot club LESS than a metrics read does, and a cold
 * one more.
 *
 * NOTE THE DIRECTION, because it reads like a bug and is not: this makes her totals run COLD
 * when a club is hot. That is her character expressed on the run channel, and it is why fading
 * her when she fades everyone is a real play rather than a slogan.
 */
const jardinsFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  if (!input.hasSeasonOutput) return hollisFactors(team, opponent, input);
  const off = observedScoring(team);
  const oppAllowed = observedAllowed(opponent);
  const invert = (v: number | null): number =>
    v === null ? 1 : 2 - Math.max(0.55, Math.min(1.75, v / LEAGUE_RUNS_PER_TEAM_GAME));
  return { off: invert(off), def: invert(oppAllowed) };
};

/**
 * BOYLE -- the beat, on scoring.
 *
 * Inside his division he is a metrics reader with conviction; outside it he is nearly flat. The
 * beat constant is IMPORTED from `mediaReads.ts` rather than restated, because a forecaster who
 * covers the West on the ranking page and the East on the totals page would be a bug that
 * compiles perfectly and surfaces only as an inexplicable price.
 */
const boyleFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  const inBeat = team.division === BOYLE_BEAT;
  const z = 0.34 * (inBeat ? 1 : 0.2);
  return { off: 1 + z * strengthZ(team.id, input), def: 1 - z * strengthZ(opponent.id, input) };
};

/**
 * MUSSAD -- the macro desk, on scoring.
 *
 * A LEAGUE-WIDE factor, not a club one. His terms are the same for both sides of the matchup,
 * because he is not pricing the teams -- he is pricing the environment they play in. A tiny
 * strength tilt keeps the read well-defined; without any tilt his total would be constant and
 * the over/under price would not respond to anything at all.
 *
 * MUSSAD_RUN_TILT is deliberately small. Raising it would make his page more interesting and his
 * character less true, which is the wrong trade.
 */
const MUSSAD_RUN_TILT = 0.05;
const mussadFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  const tide = input.hasSeasonOutput ? 1 : 1.05;
  const z = strengthZ(team.id, input) * MUSSAD_RUN_TILT;
  return { off: tide + z, def: tide - z * 0.5 };
};

/**
 * WARDLEY -- organisational depth, on scoring.
 *
 * A WEAKER read than his ranking, and that is honest rather than a shortcut: `RunEnvironmentInput`
 * carries latent strength and observed output and NOTHING about age, so his farm-system edge --
 * which is what makes him interesting -- cannot be expressed on tomorrow's run total at all.
 *
 * He therefore reads at a fraction of the metrics weight, and the reason is stated here rather
 * than left to be discovered later as "why is the scout the least differentiated number on the
 * board". His edge is on ORDERING and on a two-year horizon; the ranking read carries it
 * properly because that path has the roster data.
 *
 * This is a known gap rather than a hidden one. `RunEnvironmentInput` gaining an age term would
 * close it, and it is the right fix when someone builds the valuation index.
 */
const WARDLEY_RUN_WEIGHT = 0.45;
const wardleyFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  const z = 0.34 * WARDLEY_RUN_WEIGHT * strengthZ(team.id, input);
  return { off: 1 + z, def: 1 - z };
};

/**
 * SCINTILLA'S RUN FACTORS, and the run weight is deliberately the smallest in the league.
 *
 * He interrogates a number rather than producing one, so on a single game's run total he has less
 * to say than anybody -- and his stated weakness is over-reading a small sample, which is exactly
 * the failure a single game invites. `0.18` is a floor chosen BEFORE measuring, consistent with his
 * 0.10 moneyline confidence, and `tools/fitMediaOdds.ts` is what decides whether it stands.
 */
const SCINTILLA_RUN_WEIGHT = 0.18;
const scintillaFactors = (team: Team, opponent: Team, input: RunEnvironmentInput): RunFactors => {
  const z = 0.34 * SCINTILLA_RUN_WEIGHT * strengthZ(team.id, input);
  return { off: 1 + z, def: 1 - z };
};

const FACTORS: Record<MediaId, (team: Team, opponent: Team, input: RunEnvironmentInput) => RunFactors> = {
  hollis: hollisFactors,
  glorest: glorestFactors,
  sharply: sharplyFactors,
  sallow: sallowFactors,
  jardins: jardinsFactors,
  boyle: boyleFactors,
  mussad: mussadFactors,
  wardley: wardleyFactors,
    scintilla: scintillaFactors,
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
  /*
   * PROVISIONAL for the five. Mussad is the notable one and it is not a shrug: a macro desk
   * that covers the league rather than the clubs is ACTIVELY UNHELPFUL on a single game's
   * run total, and his own stated weakness says so -- right about October, useless on a
   * Tuesday. A flat 0.35 encodes that instead of pretending he has a next-Tuesday read.
   */
  sallow: 0.50,
  jardins: 0.55,
  boyle: 0.50,
  mussad: 0.35,
  wardley: 0.45,
  /*
   * Scintilla is the flattest on a run total, and for the same reason Mussad is: he has almost
   * nothing to say about one game. His entire read is a comparison between expectation and outcome
   * across a season, and a single game has no expectation to deviate from. 0.38 encodes "little
   * opinion" instead of manufacturing one. Provisional; step 5 fits it.
   */
  scintilla: 0.38,
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
      slope: { hollis: 0.7, glorest: 0.65, sharply: 1.1, sallow: 0.7, jardins: 0.7, boyle: 0.65, mussad: 0.5, wardley: 0.65, scintilla: 0.6 },
    });
  });
