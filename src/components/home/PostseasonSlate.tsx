import React, { useMemo } from 'react';
import type { Game, Team } from '../../types';
import { seriesStanding } from '../../lib/seriesStanding';
import { parkProfile } from '../../lib/analytics/parkProfile';
import { getScheduledGameTimeLabel } from '../../logic/gameTimes';
import { RetroButton, TeamLogo } from '../ui';

/**
 * The postseason slate: tonight's games, and a way to the bracket.
 *
 * WHY A PANEL AND NOT A CRAWL. A regular-season slate is 16 games and does not fit in anything you
 * can read; that is why the app carries a moving scoreboard crawl and a summary card that only counts
 * games. A postseason slate is four games -- measured, peak 4 scheduled on any date across a full
 * simulated season (`tools/spikePlayoffState.ts`) -- and four sit side by side in one row. This is
 * the first surface in the app that could be a static, scannable, clickable row instead of motion.
 *
 * THAT MEASUREMENT IS ALSO THE LAYOUT. The grid is four columns because four is the measured maximum,
 * not because four looks tidy. A fifth game wraps onto its own row rather than being dropped, because
 * dropping a playoff fixture is worse than an uneven grid.
 *
 * WHY NO HEADLINE AND NO PREVIOUS NIGHT. The page already has a headline, and during the postseason
 * the bracket masthead to the right of it says what period of the year this is. A second bar above
 * both saying "Postseason" was spending 38px to repeat a fact the reader had been told twice.
 *
 * Previous night's scores are gone rather than moved, deliberately. The broadcast ticker at the top
 * of every screen already carries completed games continuously, and its `playoff` flag marks them. A
 * second static rendering of the same numbers competes with it rather than adding anything, and the
 * row of upcoming fixtures is the part that is not already on screen.
 *
 * WHY THE STANDING LINE NAMES CLUBS AFTER ALL. An earlier version of this panel printed crests and
 * no names, on the reasoning that a slate is read by pattern and spelling out the same word eight
 * times is waste. That was wrong in a way the crests could not fix. A series tally is per CLUB and
 * the venues alternate, so "2-1" beside two crests is genuinely ambiguous about whose two it is --
 * and the only way to have removed that ambiguity was to write every line from a known crest, which
 * produced constructions like "AWAY LEADS 2-1" that are correct and mean nothing to a reader. A
 * club name on the standing line answers the question directly. The crests stay because a slate is
 * scanned by shape first and read second.
 */

export interface PostseasonSlateProps {
  /**
   * Every game in the league, any phase. Filtered to playoffs inside.
   *
   * Mutable rather than readonly because `getScheduledGameTimeLabel` takes `Game[]` -- it sorts the
   * day's games to work out a slot index, and sorting a readonly array in place would be a runtime
   * throw. Widening that helper to accept a readonly array is a one-line change and the better fix;
   * done here only because widening it means touching a function four other panels call.
   */
  games: Game[];
  /** The date the league is currently on. "Tonight" is this date's slate. */
  currentDate: string;
  teamsById: ReadonlyMap<string, Team>;
  onOpenGame: (gameId: string) => null | void;
  onOpenBracket: () => void;
}

/**
 * Peak simultaneous playoff games, measured over a full simulated season (`tools/spikePlayoffState.ts`).
 *
 * Not interpolated into the grid class -- see the note at the grid. It lives here so the number that
 * justifies four columns has somewhere to be stated, rather than being a bare `4` in a class string
 * that nobody reading it would think to question.
 */
const COLUMN_COUNT = 4;

/**
 * One line describing the state of a series.
 *
 * Written from the LEADING side, which is what makes "Smokies lead 1-0" unambiguous: the number
 * after "lead" is always the leader's, and the number after the hyphen is always the other's. A line
 * anchored to the away club instead would read "2-1" the same whether the away side or the home side
 * is ahead, which is the failure this whole line exists to prevent.
 *
 * The four cases, and why each is a separate branch rather than one formatting function:
 *
 *   - Game n            nothing has been played, so there is no standing to report at all. Printing
 *                       "0-0" would state a fact about a series that has not started.
 *   - Win or Go Home n-n  the record is level and the game number is the last one, so whichever club
 *                       loses is out. This is checked BEFORE the tied case on purpose, because the
 *                       deciding game is always a tie on paper -- 3-3 in a best-of-seven, 2-2 in a
 *                       best-of-five, 1-1 in a best-of-three -- and "Series tied 3-3" on the last game
 *                       of a series is the single least useful thing this panel could say.
 *   - Series tied n-n   level, with games still to play. No leader, so no name to lead with.
 *   - <Club> lead n-m   someone is ahead, so name them.
 *
 * `gameNumber === bestOf` is the test for the deciding game rather than a check on the record, because
 * it is the only form that is true for every series length without a table. A series that reaches its
 * last scheduled game is level by construction -- an unbalanced record would have ended it earlier --
 * so the two agree, and the game-number form cannot disagree with the schedule.
 */
const standingLine = (
  game: Game,
  completedGames: readonly Game[],
  teamsById: ReadonlyMap<string, Team>,
): string => {
  if (!game.playoff) return '';
  const standing = seriesStanding(game.playoff, completedGames);

  const tally = (teamId: string): number => standing.winsByTeamId.get(teamId) ?? 0;
  const awayWins = tally(game.awayTeam);
  const homeWins = tally(game.homeTeam);

  const nameOf = (teamId: string): string => teamsById.get(teamId)?.name ?? '';

  // A finished series. Not reachable from the scheduled-games filter in normal play -- a decided
  // series has no further games -- but named anyway rather than left blank, because a blank standing
  // line on a fixture box is indistinguishable from a rendering fault.
  if (standing.winnerId) {
    const winnerWins = tally(standing.winnerId);
    const loserWins = standing.loserId ? tally(standing.loserId) : 0;
    return `${nameOf(standing.winnerId)} advancing ${winnerWins}-${loserWins}`;
  }

  if (awayWins + homeWins === 0) return `Game ${game.playoff.gameNumber}`;

  if (game.playoff.gameNumber === game.playoff.bestOf) {
    return `Win or Go Home ${awayWins}-${homeWins}`;
  }

  if (awayWins === homeWins) return `Series tied ${awayWins}-${homeWins}`;

  // Level is handled above, so exactly one of these two is true. The name goes first either way, so
  // the line reads the same whichever club is in front.
  const leaderId = awayWins > homeWins ? game.awayTeam : game.homeTeam;
  const leaderWins = Math.max(awayWins, homeWins);
  return `${nameOf(leaderId)} lead ${leaderWins}-${Math.min(awayWins, homeWins)}`;
};

const GameBox: React.FC<{
  game: Game;
  completedGames: readonly Game[];
  teamsById: ReadonlyMap<string, Team>;
  onOpenGame: (gameId: string) => null | void;
  timeLabel: string;
}> = ({ game, completedGames, teamsById, onOpenGame, timeLabel }) => {
  const away = teamsById.get(game.awayTeam);
  const home = teamsById.get(game.homeTeam);
  if (!away || !home) return null;

  // The HOME club's park, because that is where the game is played. `parkCity` is required in the
  // data and asserted by `checkParks`, but optional in the type, so the fallback is real and not
  // defensive noise.
  const park = parkProfile(home.id);
  const venue = park?.parkCity ?? home.city;

  return (
    <button
      type="button"
      onClick={() => onOpenGame(game.gameId)}
      className="flex min-w-0 flex-col items-center gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-3 text-center transition-colors hover:border-[var(--color-gold-lo)] hover:bg-[var(--color-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo team={away} sizeClass="h-9 w-9" />
        <span className="t-caption text-[var(--color-ink-faint)]">@</span>
        <TeamLogo team={home} sizeClass="h-9 w-9" />
      </span>

      {/*
        The standing line is truncated, not wrapped. A club name plus a tally is about twenty
        characters; the box is roughly a quarter of a 1600px page, and a two-line standing would
        push the venue and time out of alignment with the boxes either side of it. Truncating loses
        the tail of a long name, which is a worse failure than a ragged row.
      */}
      <span className="t-caption w-full truncate font-semibold text-[var(--color-ink)]">
        {standingLine(game, completedGames, teamsById)}
      </span>

      <span className="t-caption min-w-0 truncate text-[var(--color-ink-faint)]">
        {venue} <span className="px-1 text-[var(--color-chrome-hi)]">|</span> {timeLabel}
      </span>
    </button>
  );
};

/**
 * One maple leaf, inline SVG, used as a watermark behind the row.
 *
 * It was in the panel header, which no longer exists. A single low-opacity leaf keeps the autumn
 * signal on the panel itself without spending a chrome-bar on the word "Postseason".
 *
 * SVG and not an image file because the handover records this project shipping ~22 MB of
 * unreferenced PNGs three times over; `src/assets` is 122 MB and every one of those was a defect.
 */
const MapleLeaf: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    width="120"
    height="120"
    aria-hidden="true"
    className="pointer-events-none absolute -right-2 -top-3 text-[var(--color-gold-dim)] opacity-25"
  >
    <path
      fill="currentColor"
      d="M12 1.5l1.6 4.2 2.9-2.1-.7 3.9 4.2-1.1-2.6 3.4 3.3 1.2-3.6 2.2 1.4 3.4-3.7-1.1.3 3.9-2.8-2.3-.3 4.4h-1.4l-.3-4.4-2.8 2.3.3-3.9-3.7 1.1L6 16.6 2.4 14.4l3.3-1.2L3.1 9.8l4.2 1.1-.7-3.9 2.9 2.1z"
    />
  </svg>
);

export const PostseasonSlate: React.FC<PostseasonSlateProps> = ({
  games,
  currentDate,
  teamsById,
  onOpenGame,
  onOpenBracket,
}) => {
  const { tonight, completedGames } = useMemo(() => {
    const playoff = games.filter((game) => game.phase === 'playoffs');
    return {
      tonight: playoff.filter((game) => game.date === currentDate && game.status === 'scheduled'),
      completedGames: playoff.filter((game) => game.status === 'completed'),
    };
  }, [currentDate, games]);

  return (
    <section className="panel relative overflow-hidden">
      <MapleLeaf />
      <div className="relative p-4">
        {tonight.length === 0 ? (
          <p className="t-caption text-[var(--color-ink-faint)]">
            No games scheduled. Play a day to bring the bracket on.
          </p>
        ) : (
          /*
            The bracket button sits BESIDE the row, not in it.

            As a grid cell it was a fifth column competing for width with four fixtures, and on a
            three-game day it wrapped onto a row of its own and read as a section break. Outside the
            grid, at a fixed width, it is always immediately right of the rightmost fixture: a
            destination for the row rather than another thing in it.
          */
          <div className="flex items-stretch gap-3">
            {/*
              `xl:grid-cols-4` is written out rather than interpolated from COLUMN_COUNT. Tailwind
              scans source text for complete class names, so `grid-cols-${COLUMN_COUNT}` is not a
              class it can find and the rule silently never ships -- the grid would fall back to two
              columns and the peak four-game day would wrap to two rows with no error anywhere. The
              constant is kept above as the measurement it documents; the class string is the copy.
            */}
            <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {tonight.map((game) => (
                <GameBox
                  key={game.gameId}
                  game={game}
                  completedGames={completedGames}
                  teamsById={teamsById}
                  onOpenGame={onOpenGame}
                  timeLabel={getScheduledGameTimeLabel(game, games)}
                />
              ))}
            </div>

            {/*
              A BOX, not a chevron.

              A chevron is the app's signal for "this is the primary action", and the standing
              instruction on RetroButton is that a pointed action means exactly that. A route link
              beside four fixtures is not more important than the fixtures -- it is the way to the
              page those fixtures are on.
            */}
            <div className="flex w-[168px] shrink-0 items-stretch">
              <RetroButton
                variant="primary"
                size="md"
                shape="rect"
                onClick={onOpenBracket}
                className="h-full w-full justify-center"
              >
                Go to Bracket
              </RetroButton>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};