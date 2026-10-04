import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Game, SeasonHistoryEntry, PlayerBattingRatings, PlayerPitchingRatings,
} from '../../types';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID, MEDIA_PROFILES } from '../../data/media';
import { buildMediaReads, type MediaReadInput } from '../../lib/mediaReads';
import { buildGameLine, getNextSlateDate, type GameLine } from '../../lib/mediaOdds';
import {
  buildTotalMarkets, buildDivisionMarkets, buildLeagueMarkets, buildWorldSeriesMarkets, buildAwardMarket,
} from '../../lib/mediaMarkets';
import type { FieldMarket } from '../../lib/markets';
import { leagueSeriesLosers, playoffEliminations, lockedRaces, remainingRegularSeasonGames } from '../../lib/futuresRisk';
import { projectSeasonCalendar } from '../../lib/marketDates';
import { isPlayoffGame } from '../../logic/playoffs';
import { getTeamRosterStrength } from '../../logic/teamStrength';
import {
  getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId,
} from '../../logic/playerStats';
import { buildAwardsForBoard, type AwardEntry } from '../../lib/awardRace';
import { usePropBoard } from '../../hooks/usePropBoard';
import type { BettingSlipState } from '../../hooks/useBettingSlip';
import { BettingHub } from './BettingHub';
import { resolveSeasonYear } from '../../lib/seasonYear';

/**
 * The newest row per player, as a Map.
 *
 * awardRace reads Maps keyed by player id, while the app stores flat arrays.
 * HomeDashboard does this same conversion for the home page's award panel.
 * Passing an array where a Map is expected type-checks, because AwardInputs is
 * not exported and the inference stays loose, then throws at runtime on
 * "battingStats.get is not a function" and takes the entire screen down with it.
 */
const latestByPlayerId = <T extends { playerId: string; seasonYear: number }>(
  rows: T[],
): Map<string, T> => {
  const map = new Map<string, T>();
  for (const row of [...rows].sort((a, b) => a.seasonYear - b.seasonYear)) map.set(row.playerId, row);
  return map;
};

/**
 * Map<string, PlayerBattingRatings> without widening T to the bare constraint.
 *
 * An earlier version constrained the helper to just playerId and seasonYear,
 * which is enough to group the rows but erases every other property on the way
 * out, so the Map came back as Map<string, {playerId, seasonYear}> and the
 * award race lost the ratings it reads. The two explicit overloads keep T
 * intact for each concrete shape.
 */
const latestBattingRatings = (
  rows: PlayerBattingRatings[],
): Map<string, PlayerBattingRatings> => latestByPlayerId<PlayerBattingRatings>(rows);

const latestPitchingRatings = (
  rows: PlayerPitchingRatings[],
): Map<string, PlayerPitchingRatings> => latestByPlayerId<PlayerPitchingRatings>(rows);

interface BettingPageProps extends MediaReadInput {
  games: Game[];
  currentDate: string;
  /** The shell's slip, so the page and the panel cannot disagree. */
  slip: BettingSlipState;
  /*
   * NOTE: this used to take a `seasonComplete` prop, threaded down from the shell, and closed the
   * award races on it. That was five weeks late -- the award is decided by regular-season numbers,
   * none of which move once September is out -- and the prop is now gone rather than left in place.
   * A prop that is passed through two files and never read reads as the mechanism, and the mechanism
   * it named is not the one that runs.
   *
   * The award races key off `regularSeasonOver`, derived here from the same
   * `gamesRemainingByTeamId` that closes the division races.
   */
}

/**
 * Betting.
 *
 * This is where the three outlets' numbers become stakes. It reads exactly the
 * same read module The Media page reads, and the same three forecasters post
 * every price here, so a bettor can never be shown a number the media page does
 * not also show. The split is intentional: The Media is their opinion, this is
 * your stake against it.
 *
 * The wallet and the slip are NOT owned here. They belong to the shell, in
 * useBettingSlip, because a price added on this screen has to be reviewable
 * from any other screen, and because settlement has to keep running when the
 * manager has navigated away to watch a game finish.
 */
const BettingPage: React.FC<BettingPageProps> = ({
  games, currentDate, slip: slipState, ...input
}) => {
  const { wallet, openBets, summary, select, isOpen, open, close, focusedProp } = slipState;
  const [view, setView] = useState<'slate' | 'props' | 'futures' | 'awards'>('slate');

  const readInput = input as MediaReadInput;
  const { scores, spread } = useMemo(() => buildMediaReads(readInput), [readInput]);
  const seasonYear = useMemo(
    () => resolveSeasonYear(currentDate, games),
    [currentDate, games],
  );

  const slateDate = useMemo(() => getNextSlateDate(games, currentDate), [currentDate, games]);
  const teamById = useMemo(() => new Map(input.teams.map((t) => [t.id, t])), [input.teams]);

  /**
   * The prop board, shared with The Media through the same hook.
   *
   * The point of the shared builder is that a prop staked here is the same prop
   * shown there, at the same line and the same price. Two independent builds
   * would agree until the inputs drifted, and the drift would be invisible: the
   * manager would have a receipt for a line that no longer appears anywhere.
   */
  /*
   * Win percentage per club, shared with the media page.
   *
   * THE SAME FUNCTION, because the guarantee this page is built on is that a bettor
   * is never shown a number The Media does not also show. `teamWinPct` feeds the
   * prop board's editorial selection, so a betting page that computed it any
   * differently from the media page would show a different SET of props for the
   * same slate -- and that is precisely the drift the shared `usePropBoard` hook
   * exists to prevent.
   */
  const teamWinPct = useCallback(
    (teamId: string): number | null => {
      const team = input.teams.find((entry) => entry.id === teamId);
      if (!team) return null;
      const played = team.wins + team.losses;
      return played > 0 ? team.wins / played : null;
    },
    [input.teams],
  );

  const { byOutlet: propBoards } = usePropBoard({
    games,
    playerState: input.playerState,
    slateDate,
    teamScores: scores,
    scoreSpread: spread,
    teamWinPct,
  });

  /**
   * Arriving at a prop puts the props in front of you.
   *
   * The media page hands over a prop reference and nothing else, because the page
   * was already mounted and could not take an argument. Landing on the moneyline
   * view with a highlight somewhere below it would be technically present and
   * practically not, so the view follows the arrival.
   *
   * Keyed on the whole reference rather than on "is it set", so returning to a
   * prop you have already looked at does not yank the view away from wherever you
   * have since wandered. That is why the reference is cleared on interaction in
   * useBettingSlip rather than here -- a stale non-null check would undo a
   * deliberate switch of view on the next render of anything.
   */
  useEffect(() => {
    if (focusedProp) setView('props');
  }, [focusedProp]);

  /* ---------------- slate: moneyline and run totals ---------------- */

  const moneyline = useMemo<GameLine[]>(() => {
    if (!slateDate) return [];
    return games
      .filter((game) => game.date === slateDate)
      .map((game) => {
        const away = teamById.get(game.awayTeam);
        const home = teamById.get(game.homeTeam);
        if (!away || !home) return null;
  /*
   * DERIVED FROM THE PROFILE LIST, NOT THREE HARDCODED KEYS.
   *
   * This was a literal with three entries, and adding five forecasters broke it at compile
   * time -- which is the type system doing precisely the job it is there for. Iterating
   * MEDIA_PROFILES means the ninth forecaster needs no change here at all, and a scorer that
   * forgets an outlet gets a neutral 0.5 rather than a missing key.
   */
  const scoreFor = (teamId: string): Record<MediaId, number> =>
    Object.fromEntries(
      MEDIA_PROFILES.map((profile) => [profile.id, scores[profile.id].get(teamId) ?? 0.5]),
    ) as Record<MediaId, number>;
        return buildGameLine({
          game, away, home,
          awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread,
        });
      })
      .filter((line): line is GameLine => line !== null)
      .sort((a, b) => a.awayTeam.city.localeCompare(b.awayTeam.city));
  }, [games, scores, slateDate, spread, teamById]);

  const lines = useMemo(() => {
    if (!slateDate) return [];
    // The latent factors are z-scored against the league, so the spread has to be
    // measured rather than assumed. Passing a mean of zero and a spread of one
    // would silently turn a z-score into a raw roster rating, which is a
    // different and much larger number.
    const strength = getTeamRosterStrength(input.teams, input.playerState, seasonYear);
    const values = [...strength.values()];
    const strengthMean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
    const strengthSd = Math.sqrt(
      values.reduce((sum, value) => sum + (value - strengthMean) ** 2, 0) / Math.max(1, values.length),
    );

    return buildTotalMarkets(
      games.filter((game) => game.date === slateDate && game.status !== 'completed'),
      {
        teams: input.teams,
        strength, strengthMean, strengthSd,
        hasSeasonOutput: input.teams.some((team) => team.wins + team.losses > 0),
      },
      teamById,
    );
  }, [games, input.playerState, input.teams, seasonYear, slateDate, teamById]);

  /* ---------------- futures: division, league, awards ---------------- */

  /*
   * Futures read the RAW scores, not the 0-100 index.
   *
   * The index is a rank rescaled 0-100, so inside a sixteen-team division it
   * spans exactly 100 points whether the clubs are miles apart or dead level.
   * A price built on it cannot recover the underlying strength gap, and the
   * symptom was every club in a division posted at the same +143. mediaReads
   * says as much about its own index in the comment above MediaScores.
   */
  const scoreBy = useMemo(() => scores, [scores]);

  /*
   * Games left per club, and who is still in the title.
   *
   * THIS IS WHAT MAKES THE RISK CURVE REAL. The forecasters' scores are
   * roster-driven and barely move during a season -- measured, one forecaster's
   * spread across the field actually shrank over the year -- so the probabilities on
   * a 32-club title board are near-uniform and never eliminate anybody. Elimination
   * is arithmetic instead: a club that can no longer win its division cannot win a
   * title that is decided between two league champions.
   */
  const gamesRemainingByTeamId = useMemo(
    () => remainingRegularSeasonGames(games, isPlayoffGame),
    [games],
  );

  /*
   * HAS THE REGULAR SEASON BEEN PLAYED OUT?
   *
   * Every club on zero, which is the same signal that closes the division races -- deliberately one
   * signal rather than two, so the futures board cannot decide "the season is over" differently
   * depending on which tab you are looking at.
   *
   * Guarded on a NON-EMPTY map, because `[].every(...)` is true. An empty schedule means nothing is
   * known about the season, not that the season is finished, and reading it the other way would close
   * both MVP races on a universe that had not played a game.
   *
   * This is what the AWARD races key their closure on. It is not `seasonComplete`, which is five
   * weeks later.
   */
  const regularSeasonOver = useMemo(
    () => gamesRemainingByTeamId.size > 0
      && [...gamesRemainingByTeamId.values()].every((left) => left <= 0),
    [gamesRemainingByTeamId],
  );

  /*
   * THE SEASON CALENDAR, derived once and passed down.
   *
   * Every market on the board says when it resolves, and every one of those dates comes
   * from here. Derived rather than hardcoded because the plan is right that computing
   * dates from `SEASON_CALENDAR_DAYS` "produces plausible numbers that drift the moment
   * the schedule changes" -- and this is the only place in the app that knows the
   * whole schedule, so it is the only correct place to derive it.
   *
   * Memoised on the games, so it recomputes when the schedule changes and not on every
   * render. Measured slack between the last possible championship game and the awards
   * ceremony is 81 days, so the dates are comfortable rather than marginal.
   */
  const calendar = useMemo(
    () => projectSeasonCalendar(games, resolveSeasonYear(currentDate)),
    [currentDate, games],
  );

  /*
   * The second, tighter half of the elimination: a club that has lost its league
   * championship series cannot be a league champion, and the title is decided
   * between the two league champions.
   *
   * Empty until the playoffs produce a completed league series, which is the correct
   * behaviour -- `titleContenders` treats an absent set as "no league elimination
   * yet" rather than as "nobody is eliminated".
   */
  const eliminatedFromLeague = useMemo(() => leagueSeriesLosers(games), [games]);

  /*
   * EVERY club knocked out by a decided series, in any round.
   *
   * `eliminatedFromLeague` above is league-series losers only, and it feeds the DIVISION boards,
   * where it is the right question. This feeds the league and championship boards, where it is the
   * right question too -- and it is a superset, because a club can lose the wild card and never
   * reach a league series at all, which is precisely the club that was still being offered prices.
   *
   * Both are computed here rather than inside the builders for the same reason `lockedRaces` is:
   * three separate call sites would be three implementations that agree today and drift the first
   * time one of them is edited.
   */
  const eliminatedFromPlayoff = useMemo(() => playoffEliminations(games), [games]);

  /*
   * RACES THAT ALREADY HAVE A WINNER, computed once for all three builders.
   *
   * Built here rather than inside each of `buildWorldSeriesMarkets`, `buildLeagueMarkets` and
   * `buildDivisionMarkets`, because those are three separate calls: a closure derived inside each
   * would be three implementations that agree today and drift the first time one of them is edited.
   *
   * `games` is passed because of the league and title races. Standings decide the DIVISIONS and
   * cannot decide the other two at all -- a league champion and a world champion are both decided by
   * games won in a series, and no win total produces either. A board built from standings alone
   * therefore stayed sellable for the whole playoffs, which was the second half of the exploit.
   */
  const locked = useMemo(
    () => lockedRaces({ teams: input.teams, gamesRemainingByTeamId, games }),
    [input.teams, gamesRemainingByTeamId, games],
  );

  const futures = useMemo<FieldMarket[]>(() => [
    // The title FIRST, because it is the one season-long bet a manager actually
    // wants and it was missing entirely. Everything below it is a narrower race.
    ...buildWorldSeriesMarkets({
      teams: input.teams, scoreBy, gamesRemainingByTeamId,
      eliminatedFromLeague, eliminatedFromPlayoff, lockedRaces: locked,
    }),
    /*
     * BOTH CALLS NEED THE STANDINGS.
     *
     * `buildWorldSeriesMarkets` was passed `gamesRemainingByTeamId` and `eliminatedFromLeague`;
     * the two grouped builders were not. That is not a cosmetic difference: `groupMarkets` computes
     * its contender set ONLY when `gamesRemainingByTeamId` is present, because with no standings
     * there is nothing to decide elimination from. Omitting it left every division and league race
     * with `contenders === null`, so `eliminated` was `undefined` on every outcome and every club
     * stayed bettable -- which is exactly what the championship tab had already fixed.
     *
     * Passing them here is what makes the three kinds agree with each other.
     */
    ...buildLeagueMarkets({ teams: input.teams, scoreBy, gamesRemainingByTeamId, eliminatedFromLeague, eliminatedFromPlayoff, lockedRaces: locked }),
    ...buildDivisionMarkets({ teams: input.teams, scoreBy, gamesRemainingByTeamId, eliminatedFromLeague, lockedRaces: locked }),
  ], [input.teams, scoreBy, gamesRemainingByTeamId, eliminatedFromLeague, eliminatedFromPlayoff, locked]);

  const awards = useMemo<FieldMarket[]>(() => {
    const awardInputs = {
      players: input.playerState.players,
      teamsById: teamById,
      battingStats: getPreferredBattingStatsByPlayerId(input.playerState.battingStats),
      pitchingStats: getPreferredPitchingStatsByPlayerId(input.playerState.pitchingStats),
      battingRatings: latestBattingRatings(input.playerState.battingRatings),
      pitchingRatings: latestPitchingRatings(input.playerState.pitchingRatings),
    };
    const built: Array<[string, string, AwardEntry[]]> = [
      ['batting_mvp', 'Batting MVP', buildAwardsForBoard('batting', awardInputs, 8)],
      ['pitching_mvp', 'Pitching MVP', buildAwardsForBoard('pitching', awardInputs, 8)],
    ];
    /*
     * `decided` is the whole point of computing `regularSeasonOver` above.
     *
     * Two closures ago this board carried none at all, so the race stayed open after the MVP had been
     * named and archived -- the same exploit as the ballot, arriving by the back door.
     *
     * It then closed on `seasonComplete`, which was five weeks late for the same reason: an award is
     * decided by regular-season numbers, and none of them move once the regular season is over. So it
     * closes on `regularSeasonOver` instead.
     *
     * The CLOSE and the PAYMENT are deliberately different moments and the board only advertises the
     * second. The race shuts in September; the archive that settles it is written when the season
     * ends, because the archive is the single record both the summary and settlement read, and a
     * second copy of the ranking is what this file already had to be rescued from once today.
     */
    return built
      .filter(([, , entries]) => entries.length > 0)
      .map(([key, title, entries]) => buildAwardMarket(key, title, entries, { decided: regularSeasonOver }));
  }, [input.playerState, regularSeasonOver, teamById]);

  return (
    <section className="space-y-5">
      <BettingHub
        view={view}
        onView={setView}
        lines={lines}
        moneyline={moneyline}
        propBoards={propBoards}
        focusedProp={focusedProp}
        futures={futures}
    calendar={calendar}
        awards={awards}
        slateDate={slateDate}
        teams={input.teams}
        bets={wallet.bets}
        balance={wallet.balance}
        onPlace={select}
      />

      {/*
        A standing reminder that something is waiting, with the running figure on
        it. The slip itself lives in the shell now, so this is the only place on
        this screen that says a bet is pending -- and it stays quiet until there
        is something to report.
      */}
      {openBets.length > 0 && (
        <button
          type="button"
          onClick={() => (isOpen ? close() : open())}
          className="gold-sweep gold-edge flex w-full items-center justify-between gap-3 border border-[var(--color-chrome-lo)] border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-4 py-3 text-left hover:border-[var(--color-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
        >
          <span className="t-stat-sm">
            {openBets.length} open {openBets.length === 1 ? 'bet' : 'bets'} ·{' '}
            ${openBets.reduce((s, b) => s + b.stake, 0)} at risk
          </span>
          <span className="t-caption text-[var(--color-gold)]">
            {isOpen ? 'Hide slip' : 'Open slip'} ·
            {summary.profit > 0 ? '+' : summary.profit < 0 ? '-' : ''}${Math.abs(Math.round(summary.profit))}
          </span>
        </button>
      )}
    </section>
  );
};

export type { BettingPageProps };
export { BettingPage };
