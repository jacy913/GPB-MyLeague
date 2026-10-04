import { getRoundBestOf } from '../logic/playoffs';
import { WORLD_SERIES_MARKET_KEY, type LockedRace } from './markets';
import type { PlayoffLeague, PlayoffRoundKey, Team } from '../types';

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
/**
 * Clubs that have LOST a decided league championship series.
 *
 * ============================================================================
 * WHAT WAS WRONG, AND WHY IT NEVER FIRED
 * ============================================================================
 *
 * The previous version tallied `homeWins` / `awayWins` and then eliminated `row.away` when the
 * home counter led. But `row.home` is whichever club hosted game 1, while `homeWins` counts
 * whoever was home in each game -- and a best-of-seven alternates venues. A club's wins were
 * split across the two counters, so:
 *
 *   a 2-0 sweep read 1-1, and a 4-2 read 2-2.
 *
 * Level on wins is "undecided" here, so the function returned an EMPTY set for almost every
 * real series. `eliminatedFromLeague` was therefore empty in practice, which is why a club that
 * had lost its league championship series was still being offered prices on its league board and
 * on the championship board.
 *
 * It is now a filter over the shared tally rather than a tally of its own, so there is one place
 * in this file that knows how to count a series.
 */
export const leagueSeriesLosers = (games: ReadonlyArray<LockedRaceGame>): Set<string> => {
  const eliminated = new Set<string>();
  decidedFrom(seriesTallies(games, ['league_series'])).forEach((row) => {
    const outcome = seriesOutcome(row);
    if (outcome) eliminated.add(outcome.loserKey);
  });
  return eliminated;
};

/**
 * Clubs knocked out of the postseason by PLAYED GAMES, across every round.
 *
 * ============================================================================
 * WHY THIS IS SEPARATE FROM `lockedRaces`
 * ============================================================================
 *
 * `lockedRaces` answers "does this MARKET have a winner". This answers "is this CLUB still in
 * it". They are different questions on the same schedule, and only the second one is about an
 * individual row on a board that is still open.
 *
 * Single elimination is what makes this simple. Once the postseason begins, a club that has not
 * lost a decided series can still win the whole thing, whatever the standings say. So the live
 * field for the league and championship boards is exactly the set of clubs that are still alive,
 * intersected with the standings set that already handles the regular season.
 *
 * Before any playoff game, nothing is eliminated and the intersection is a no-op -- which is why
 * this needs no "has the postseason started" flag of its own.
 */
export const playoffEliminations = (games: ReadonlyArray<LockedRaceGame>): Set<string> => {
  const eliminated = new Set<string>();
  decidedFrom(seriesTallies(games, ALL_PLAYOFF_ROUNDS)).forEach((row) => {
    const outcome = seriesOutcome(row);
    if (outcome) eliminated.add(outcome.loserKey);
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
  /*
   * Clubs knocked out of the postseason, however that happened.
   *
   * `knockedOut` rather than the old `eliminatedFromLeague`, because the set that arrives depends on
   * the board: the division boards pass league-series losers, while the league and championship boards
   * pass EVERY decided series including the wild card and the divisional round. One name for two
   * different sets is a name that will eventually be read as the wrong one.
   */
  knockedOut?: ReadonlySet<string>;
}): Set<string> => {
  const leadersByDivision = new Map<string, number>();
  input.teams.forEach((team) => {
    const key = `${team.league} ${team.division}`;
    leadersByDivision.set(key, Math.max(leadersByDivision.get(key) ?? 0, team.wins));
  });

  const contenders = new Set<string>();
  input.teams.forEach((team) => {
    if (input.knockedOut?.has(team.id)) return;
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

/* ------------------------------------------------------------------ *
 * Locked races
 * ------------------------------------------------------------------ */

/** A completed or scheduled playoff game, as much of one as a closure needs. */
export interface LockedRaceGame {
  homeTeam: string;
  awayTeam: string;
  status: string;
  score: { home: number; away: number };
  playoff?: { round?: string; league?: PlayoffLeague; seriesId?: string } | null;
}

/** The running score of one series, as it stands from completed games. */
interface SeriesScore {
  round: string;
  /**
   * The league this series belongs to, or '' when the schedule did not say.
   *
   * `PlayoffLeague` rather than `string` because that is what the playoff payload actually carries,
   * and typing it precisely is what lets `leagueChampionsFromSeries` return a
   * `Map<Team['league'], string>` instead of casting its way out of a string. The World Series
   * carries the sentinel 'GPB', which is why the league champion resolver filters it out rather than
   * trusting it.
   */
  league: PlayoffLeague | '';
  /**
   * Wins by TEAM ID, not by home and away side.
   *
   * This was originally tallied as `homeWins` / `awayWins` off the first game's homeTeam and
   * awayTeam, on the assumption that a team keeps the same side for a whole series. It does not: a
   * seven-game series alternates venues, so game three has the opposite assignment from game one, and
   * the tally credited every win to whichever side happened to host first.
   *
   * Measured consequence, on a real 4-2: it reported 6-0 and called it a sweep. On 3-2 -- a series
   * nobody has won yet -- it reported 5-0 and locked the market. `tools/checkLockedRaces.ts` caught
   * both by asserting the margin, and neither was visible on screen, because the winner's NAME came
   * out right and only the number beside it was nonsense.
   *
   * Keyed by id, so the venue schedule cannot influence the result.
   */
  wins: Map<string, number>;
  /** Everyone who appeared, so the loser's total can be read. */
  participants: Set<string>;
  winsNeeded: number;
}

/**
 * Wins required to take a series.
 *
 * Derived from the playoff table rather than written down, because a hand-copied 4 here is a 4 that
 * silently stops being true the day someone changes `getRoundBestOf`. `playoffs.ts` imports only
 * from `types`, so importing it here introduces no cycle.
 */
const winsNeededFor = (round: string): number => {
  const bestOf = getRoundBestOf(round as PlayoffRoundKey);
  return Math.floor(bestOf / 2) + 1;
};

/**
 * Every series that has been decided, read off completed playoff games.
 *
 * By round and league, because "the platinum championship series" and "the prestige championship
 * series" are different races and a `league_series` key does not say which. `seriesId` is preferred
 * where the schedule supplies it, and the round/league pair is the fallback, which is the same
 * precedence `leagueSeriesLosers` uses.
 *
 * A series is decided when somebody reaches `winsNeeded`, NOT when the last scheduled game of it
 * has been played. That distinction is the whole point: a best-of-seven finished 4-2 is decided on
 * the night of the fifth win, and treating it as open until game seven would leave the market
 * sellable for two games after it was already over.
 */
const ALL_PLAYOFF_ROUNDS: PlayoffRoundKey[] = ['wild_card', 'divisional', 'league_series', 'world_series'];

/**
 * Series win tallies, by CLUB, for the rounds asked for.
 *
 * ============================================================================
 * WHY THE ROUNDS ARE A PARAMETER AND NOT A CONSTANT
 * ============================================================================
 *
 * Two callers need two different scopes, and they are not the same scope:
 *
 *   MARKET CLOSURES want the two championship rounds only. A wild-card series decides who reaches
 *   a league series; it does not win anything the board is selling, so it closes nothing.
 *
 *   PER-CLUB ELIMINATION wants every round. A club that loses the wild card is out of its league
 *   race and out of the championship race, and the board was still selling both to it.
 *
 * The crediting below is the part that must never be duplicated, so it is written once and scoped
 * by the caller. Credited to the team that actually won, which is not the one at home -- a
 * best-of-seven alternates venues, and the earlier second tally that counted home/away sides read a
 * real 4-2 as 2-2, so it eliminated nobody at all.
 */
const seriesTallies = (
  games: ReadonlyArray<LockedRaceGame>,
  rounds: readonly PlayoffRoundKey[],
): Map<string, SeriesScore> => {
  const series = new Map<string, SeriesScore>();
  for (const game of games) {
    if (game.status !== 'completed') continue;
    const round = game.playoff?.round;
    // The narrow type is `PlayoffRoundKey`; `LockedRaceGame` declares it as `string` because
    // the schedule is read defensively off persisted saves. `winsNeededFor` casts for the same reason.
    if (!round || !rounds.includes(round as PlayoffRoundKey)) continue;

    const key = `${round}:${game.playoff?.league ?? ''}:${game.playoff?.seriesId ?? `${game.homeTeam}-${game.awayTeam}`}`;
    const row = series.get(key) ?? {
      round,
      league: game.playoff?.league ?? '',
      wins: new Map<string, number>(),
      participants: new Set<string>(),
      winsNeeded: winsNeededFor(round),
    };

    row.participants.add(game.homeTeam);
    row.participants.add(game.awayTeam);
    // Credited to the team that actually won, which is not necessarily the one at home.
    if (game.score.home > game.score.away) {
      row.wins.set(game.homeTeam, (row.wins.get(game.homeTeam) ?? 0) + 1);
    } else if (game.score.away > game.score.home) {
      row.wins.set(game.awayTeam, (row.wins.get(game.awayTeam) ?? 0) + 1);
    }
    series.set(key, row);
  }

  return series;
};

/** The subset of `seriesTallies` somebody has already won. */
const decidedFrom = (series: Map<string, SeriesScore>): Map<string, SeriesScore> => {
  const decided = new Map<string, SeriesScore>();
  series.forEach((row, key) => {
    const reached = [...row.participants].some((team) => (row.wins.get(team) ?? 0) >= row.winsNeeded);
    if (reached) decided.set(key, row);
  });
  return decided;
};

/** Decided CHAMPIONSHIP series, which is what a futures race can be decided by. */
const decidedSeries = (games: ReadonlyArray<LockedRaceGame>): Map<string, SeriesScore> =>
  decidedFrom(seriesTallies(games, ['league_series', 'world_series']));

/** The winner of a decided series, and how many games clear they took it by. */
const seriesOutcome = (series: SeriesScore): { winnerKey: string; loserKey: string; margin: number } | null => {
  let winnerKey: string | null = null;
  let winnerWins = 0;
  series.participants.forEach((team) => {
    const wins = series.wins.get(team) ?? 0;
    if (wins >= series.winsNeeded && wins > winnerWins) {
      winnerKey = team;
      winnerWins = wins;
    }
  });
  if (!winnerKey) return null;

  /*
   * The loser, and how far behind they finished.
   *
   * The loser is named rather than inferred as "the only other participant", because the two are
   * the same thing for a two-club series and this is also the field per-club elimination reads. A
   * best-of-seven is always two clubs, but naming it explicitly means a malformed series with three
   * participants cannot silently eliminate whichever one happened to come last in the Set.
   */
  // Seeded at -1, NOT 0.
  //
  // A sweep puts the loser on zero wins, so a `>` against a 0 seed never records them: a clean 4-0
  // closed no market, and a 2-0 wild card eliminated nobody. Same shape as the home/away bug above,
  // and the pre-existing "four wins closes the series immediately" fixture is what caught it.
  let loserKey: string | null = null;
  let loserWins = -1;
  series.participants.forEach((team) => {
    if (team === winnerKey) return;
    const wins = series.wins.get(team) ?? 0;
    if (wins > loserWins) {
      loserKey = team;
      loserWins = wins;
    }
  });
  if (!loserKey) return null;

  return { winnerKey, loserKey, margin: winnerWins - loserWins };
};

/**
 * League champions, read off completed league series. Keyed by league, valued by club id.
 *
 * ============================================================================
 * WHY THIS EXISTS, AND WHY IT IS NOT A NEW IDEA
 * ============================================================================
 *
 * Settlement used to decide a league champion by standings: it took the division winners, mapped
 * every one of them onto its league, and put them in a `Map`. With two divisions per league that
 * writes the same key twice, and a Map keeps the LAST write -- so the "league champion" was the
 * leader of whichever division happened to be listed last in `DIVISION_ORDER`. Not a seed, not the
 * better record, just an arbitrary one of the two.
 *
 * The league champion is the winner of the league championship series: a best-of-seven between the
 * winners of the two divisional series, played before the World Series. It may not even be a
 * division winner, which is precisely why no amount of standings arithmetic can produce it.
 *
 * This delegates to the same `decidedSeries` that `lockedRaces` uses, deliberately. Two independent
 * implementations of "who won this series" would agree on the obvious cases and disagree at the
 * boundaries -- a series decided on its fourth win rather than its seventh, venues alternating --
 * and a disagreement there means the board closes a race on one answer while settlement pays out on
 * another. One implementation, two callers.
 *
 * A league with no completed series is ABSENT rather than present-and-null, and absent means nobody
 * has won it, which settles those bets void instead of paying the wrong club.
 */
export const leagueChampionsFromSeries = (
  games: ReadonlyArray<LockedRaceGame>,
): Map<Team['league'], string> => {
  const champions = new Map<Team['league'], string>();
  for (const series of decidedSeries(games).values()) {
    // 'GPB' is the World Series' sentinel league, never a real one, and an unnamed series belongs to
    // nobody. Neither is a league champion, and admitting either would key a league that does not
    // exist -- which then settles bets against a club that won nothing.
    if (series.round !== 'league_series' || series.league === '' || series.league === 'GPB') continue;
    const outcome = seriesOutcome(series);
    if (outcome) champions.set(series.league, outcome.winnerKey);
  }
  return champions;
};

/**
 * Every futures race that already has a winner, keyed by MARKET KEY.
 *
 * ============================================================================
 * THE EXPLOIT THIS CLOSES
 * ============================================================================
 *
 * A division whose leader is ten games up with three to play has already been won, and before this
 * nothing in the model could say so. `titleContenders` asks whether a club CAN still win, and a
 * club nobody can catch satisfies that -- so the locked leader stayed in contention, kept a live
 * price, and kept a working button. Taking it was free money at a stale number.
 *
 * The same held one level up. The platinum and prestige champions are decided by a seven-game
 * series, and standings arithmetic never closes them at all -- the win totals say nothing about who
 * won four games. So the league and title boards stayed open for the entire playoffs.
 *
 * ============================================================================
 * WHY TWO SEPARATE RULES
 * ============================================================================
 *
 * Because "decided" genuinely means two different things at the two levels, and the existing code
 * already reflects that:
 *
 *   DIVISION and, where a league champion is settled on records, by STANDINGS. Nobody can catch the
 *     leader, so nobody else can win.
 *
 *   LEAGUE and TITLE, by a COMPLETED SERIES. Four games to none is a fact about games played, and
 *     no amount of win-total arithmetic produces it.
 *
 * Trying to express the series case with standings would mean reading playoff results out of a
 * season record, which is the kind of second implementation that disagrees with the first on exactly
 * the boundary cases.
 *
 * ============================================================================
 * WHY A TIE DOES NOT LOCK A DIVISION
 * ============================================================================
 *
 * `titleContenders` deliberately keeps a club level with the leader alive, on the grounds that a
 * tiebreaker decides a tied division. This agrees with it, and has to: a rule that locked a tie
 * would report a division decided a game early, and the two functions would then disagree about
 * whether the same club is in the race. A closed board on a tie would be worse than a wrong price.
 */
export const lockedRaces = (input: {
  teams: ReadonlyArray<{ id: string; league: string; division: string; wins: number }>;
  /**
   * Regular-season games each club has left.
   *
   * Optional, and a division with no standings basis is never locked. Guessing a closure would close
   * a live board; the reverse costs a decided division a few days of being sellable, which slice 3
   * then prevents at the point of sale.
   */
  gamesRemainingByTeamId?: ReadonlyMap<string, number>;
  /** The schedule, read for completed playoff series. */
  games?: ReadonlyArray<LockedRaceGame>;
}): Map<string, LockedRace> => {
  const locked = new Map<string, LockedRace>();

  // --- divisions, by standings -----------------------------------------------------------------
  if (input.gamesRemainingByTeamId) {
    const divisions = new Map<string, Array<typeof input.teams[number]>>();
    for (const team of input.teams) {
      const key = `${team.league} ${team.division}`;
      const bucket = divisions.get(key) ?? [];
      bucket.push(team);
      divisions.set(key, bucket);
    }

    divisions.forEach((members, divisionId) => {
      if (members.length < 2) return;
      const ranked = [...members].sort((a, b) => b.wins - a.wins);
      const leader = ranked[0];

      /*
       * The ceiling is the best any RIVAL could still finish on. It is not `leader.wins + remaining`:
       * a club cannot out-score itself, and using its own games on both sides would make every
       * division look closer than it is.
       */
      const bestRivalCeiling = ranked
        .slice(1)
        .reduce((best, rival) => {
          const ceiling = rival.wins + (input.gamesRemainingByTeamId?.get(rival.id) ?? 0);
          return Math.max(best, ceiling);
        }, Number.NEGATIVE_INFINITY);

      // Strictly greater. Equality means a tiebreaker decides it, which is not "decided".
      if (leader.wins > bestRivalCeiling) {
        locked.set(`division:${divisionId}`, {
          winnerKey: leader.id,
          reason: 'unreachable_lead',
          margin: leader.wins - bestRivalCeiling,
        });
      }
    });
  }

  // --- leagues and the title, by completed series ----------------------------------------------
  // `.values()`, because `for...of` over a Map yields `[key, value]` pairs rather than the values.
  for (const series of decidedSeries(input.games ?? []).values()) {
    const outcome = seriesOutcome(series);
    if (!outcome) continue;

    if (series.round === 'world_series') {
      locked.set(WORLD_SERIES_MARKET_KEY, {
        winnerKey: outcome.winnerKey,
        reason: 'series_won',
        margin: outcome.margin,
      });
      continue;
    }

    /*
     * A league race is keyed by league alone, which matches `groupMarkets(input, 'league', team =>
     * team.league, ...)`. The series' `league` field is that same string, so the two agree without
     * a lookup table.
     *
     * 'GPB' is the World Series' sentinel league rather than a real one, and an unnamed series
     * belongs to nobody. Either would key a league that does not exist, and a market closed against a
     * non-existent league is a LIVE race frozen shut -- the one direction that loses the board rather
     * than merely the sale. Skipped rather than guessed at.
     */
    if (series.league === '' || series.league === 'GPB') continue;
    locked.set(`league:${series.league}`, {
      winnerKey: outcome.winnerKey,
      reason: 'series_won',
      margin: outcome.margin,
    });
  }

  return locked;
};

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
