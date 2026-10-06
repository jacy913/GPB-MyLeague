import React from 'react';
import { formatResolutionDate } from '../../lib/marketDates';
import type { GameLine } from '../../lib/mediaOdds';
import type { PlacedBet } from '../../lib/wallet';
import type { Game, Team } from '../../types';
import { TeamLogo } from '../ui';

/**
 * The minimum needed to draw a fixture.
 *
 * Narrower than `GameLine` on purpose. The betting page has priced lines and can pass
 * one; the betting SLIP is rendered from the shell, which has only the schedule and the
 * club list, and pricing a line in the shell to render a crest would be deriving a
 * market nobody there is going to bet. Identity is what both surfaces actually share.
 */
export interface FixtureIdentity {
  gameId: string;
  awayTeam: Team;
  homeTeam: Team;
}

/**
 * WHICH GAME A BET IS ABOUT, AND WHEN IT SETTLES.
 *
 * One component, because a bet's fixture and resolution date have to be stated in more
 * than one place and the two places disagreed.
 *
 * The open-bets panel on the betting page got this line first and the slip's own "Open"
 * list did not. That left a manager opening the slip -- the one surface that exists
 * precisely to hold what they have at risk -- with LESS information than the page
 * behind it: a bet's name and its market title, and nothing about which game to watch
 * or which night it settles.
 *
 * That is the same failure the whole feature was for. The original complaint was "I
 * placed a bet and could not tell which game to watch or when", and putting the answer
 * in one of two copies of the list left the complaint standing on the surface people
 * actually look at.
 *
 * The date comes from `bet.resolvesOn`, stored at placement rather than looked up, so
 * this is the day the board promised when it sold the bet. See `PlacedBet.resolvesOn`
 * for why it is not derived from the calendar at render time.
 *
 * A bet placed before the field existed has no date and says so. Printing today's date
 * on a bet taken in April would be a confident wrong answer on a real wager.
 */
export const BetFixtureLine: React.FC<{
  bet: PlacedBet;
  /**
   * The game this bet belongs to, when it can be resolved.
   *
   * Undefined for a futures or award bet, which is correct rather than a miss: those
   * are not about a fixture and must not be handed a crest. Also undefined for a game
   * bet whose game has rolled off the slate -- the date still renders, because the bet
   * still has one.
   */
  fixture: FixtureIdentity | undefined;
  /** Club lookup, so a prop bet can name whose player it is. */
  teamById?: Map<string, Team>;
  className?: string;
}> = ({ bet, fixture, teamById, className = '' }) => {
  /*
    WHOSE PLAYER IT IS, ON A PROP.

    A prop bet used to show the two clubs and the date and nothing else, which meant a reader looking
    at "Over 2.5 Hits Allowed, -115, Calukan at Reinland, Apr 12" had no way to tell whether the player
    was pitching for the away club or the home one. The complaint that produced this was "clicking open
    bet takes me to the game screen and I still do not know which player the team has" -- and the
    information was one field away the whole time, because `PropMarket` has carried `teamId` since the
    prop market was built.

    It is now STORED on the bet rather than looked up, so a mid-season trade cannot make the same bet
    read as two different players on two different screens.

    The player's club is repeated as text next to the crest rather than being left to the mark: this is
    a settled-wager record and a bare logo three months later is an ambiguous one.
  */
  const propTeam = bet.kind === 'prop' && bet.propTeamId && teamById
    ? teamById.get(bet.propTeamId)
    : undefined;

  /*
    AND WHETHER THE BET IS WAITING ON A GAME AT ALL.

    The fixture crests have always been here, and they have never said what they meant: a moneyline and
    a World Series champion both rendered a row of text and a date, and the only thing distinguishing
    them was whether a crest appeared. "Setts on tonight's game" and "settles whenever the season ends"
    are different promises and a reader should not have to infer one from the presence of an image.

    So the kind is named. Short, because it is a label and not a heading: GAME, SERIES or SEASON. It is
    omitted for a bet whose own kind already says it -- an award bet titled "Batting MVP" does not need
    the word SEASON stapled to it.
  */
  const settlesOn = isGameBet(bet) ? 'Game' : bet.kind === 'world_series' ? 'Series' : 'Season';
  const kindIsRedundant = bet.kind === 'award' || bet.kind === 'division' || bet.kind === 'league';

  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 t-caption text-[var(--color-ink-dim)] ${className}`}
    >
      {fixture && (
        <span className="flex items-center gap-1">
          <TeamLogo team={fixture.awayTeam} sizeClass="h-4 w-4" />
          <span className="text-[var(--color-ink-faint)]" aria-hidden="true">at</span>
          <TeamLogo team={fixture.homeTeam} sizeClass="h-4 w-4" />
          <span className="sr-only">{fixture.awayTeam.city} at {fixture.homeTeam.city}</span>
        </span>
      )}
      {propTeam && (
        <span className="flex items-center gap-1">
          <span className="text-[var(--color-ink-faint)]" aria-hidden="true">&middot;</span>
          <TeamLogo team={propTeam} sizeClass="h-4 w-4" />
          <span>{propTeam.city}</span>
        </span>
      )}
      {!kindIsRedundant && (
        <span className="rounded-sm bg-[var(--color-sunken)] px-1 text-[var(--color-ink-faint)]">
          settles on {settlesOn.toLowerCase()}
        </span>
      )}
      <span className="tabular-nums">
        {bet.resolvesOn ? formatResolutionDate(bet.resolvesOn) : 'No resolution date recorded'}
      </span>
    </p>
  );
};

/**
 * Is this bet about a single game?
 *
 * Moneyline, total, first five and prop all store the game id in `marketKey`. Futures
 * and awards store a group or a season key, which is deliberately NOT a game id, so a
 * lookup on those would find nothing. Asking first keeps a season-long bet from being
 * handed a crest belonging to some unrelated fixture.
 */
export const isGameBet = (bet: PlacedBet): boolean =>
  bet.kind === 'moneyline' || bet.kind === 'total' || bet.kind === 'first5' || bet.kind === 'prop';

/**
 * Game id to fixture, from the priced slate.
 *
 * For the betting page, which already has `GameLine`s carrying both teams.
 */
export const buildFixtureLookup = (moneyline: GameLine[]): Map<string, FixtureIdentity> =>
  new Map(moneyline.map((game) => [game.gameId, {
    gameId: game.gameId,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
  }]));

/**
 * Game id to fixture, from the raw schedule.
 *
 * For the slip, which is rendered from the shell and has games but no priced markets.
 *
 * A game is skipped when either club does not resolve, rather than rendered with a
 * placeholder. A crest that is not the club the bet is about is worse than no crest,
 * because it looks like an answer.
 */
export const buildFixtureLookupFromGames = (
  games: Game[],
  teamById: Map<string, Team>,
): Map<string, FixtureIdentity> => {
  const out = new Map<string, FixtureIdentity>();
  games.forEach((game) => {
    const awayTeam = teamById.get(game.awayTeam);
    const homeTeam = teamById.get(game.homeTeam);
    if (!awayTeam || !homeTeam) return;
    out.set(game.gameId, { gameId: game.gameId, awayTeam, homeTeam });
  });
  return out;
};

/** The fixture a bet is about, or undefined for a season-long bet or an unresolved game. */
export const fixtureForBet = (
  bet: PlacedBet,
  fixtureById: Map<string, FixtureIdentity>,
): FixtureIdentity | undefined => (isGameBet(bet) ? fixtureById.get(bet.marketKey) : undefined);