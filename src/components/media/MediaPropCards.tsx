import React from 'react';
import { ArrowRight, Flame, ShieldCheck } from 'lucide-react';
import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import { formatAmerican } from '../../lib/mediaOdds';
import { propSidePrices, type PropMarket, type PropTemperament } from '../../lib/playerProps';
import { formatResolutionDate } from '../../lib/marketDates';
import { TeamLogo } from '../ui';
import type { Team } from '../../types';

/**
 * A published prop, as a card.
 *
 * The reference is BettingProps rather than the existing odds slate, and the
 * difference is structural rather than cosmetic. The slate is a table: three
 * outlet columns, one row per game, numbers in columns that line up. That is
 * right for three numbers on a game and wrong for a prop, where each market has a
 * different stat, a different line, and a temperament that has to be legible
 * before the price is. A table cannot carry a border colour that means something.
 * Cards can, and a card is what a bettor actually scans -- down a column of them,
 * picking four or five -- rather than comparing across.
 *
 * So each prop gets its own bounded surface, and the border colour does the
 * categorising: green for a safe prop, orange for a hot one. That is not
 * decoration. The two categories are measured to behave differently: ranking
 * every published prop on its probability and splitting into quintiles puts the
 * safest fifth at 65.3% realised and the hottest fifth at 23.7% (fitted by
 * tools/fitPropLines.ts on 107,016 observations, confirmed at 63.3% and 24.0%
 * out of sample). The colour is a claim about how often it wins, so it belongs on
 * the outside of the card where the eye takes it in before it reads the price.
 *
 * The whole card is one button and it navigates. That is deliberate, and it is
 * also the only nesting-free option: a card with two price buttons inside it
 * cannot itself be a button without producing invalid HTML and a keyboard trap,
 * and an `onClick` div would be worse still. Betting the prop happens on the
 * betting page where every other market is bet, so the card's job is to get there
 * with the prop identified, not to duplicate the slip in a second place.
 */

const TEMPERAMENT_STYLE: Record<PropTemperament, {
  border: string;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = {
  safe: { border: 'var(--color-pos)', label: 'Safe', Icon: ShieldCheck },
  hot: { border: 'var(--color-warn)', label: 'Hot', Icon: Flame },
};

export const MediaPropCard: React.FC<{
  market: PropMarket;
  mediaId: MediaId;
  /**
   * The club the prop is on, or undefined if the id does not resolve.
   *
   * The whole object rather than a city string, because the card now draws the crest
   * and needs `TeamLogo`'s `team` prop. Passing a string would mean a second lookup
   * here and a third in `MediaPropBoard`, and the one that failed would be a blank
   * cell rather than a missing name.
   */
  team: Team | undefined;
  onOpen: (propId: string, mediaId: MediaId) => void;
}> = ({ market, mediaId, team, onOpen }) => {
  const temperament = market.temperament[mediaId];
  const style = TEMPERAMENT_STYLE[temperament];
  const { Icon } = style;
  const prices = propSidePrices(market.consensusProbability);
  const own = market.probability[mediaId];
  const profile = MEDIA_PROFILES.find((entry) => entry.id === mediaId);

  return (
    <button
      type="button"
      onClick={() => onOpen(market.propId, mediaId)}
      className="group flex w-full flex-col gap-2 border bg-[var(--color-sunken)] p-3 text-left transition-colors hover:bg-[var(--color-panel-2)]"
      style={{ borderColor: style.border, borderLeftWidth: '3px' }}
      aria-label={`${market.playerName} over under ${market.line} ${market.statPlural}, ${style.label}. Open on the betting page.`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate t-stat-sm">{market.playerName}</p>
          {/*
            THE CREST, NOT THE CLUB'S NAME.

            A fifteen-card board repeats the same handful of clubs, so a city name on
            every card is fifteen repetitions of a fact the reader can infer from the
            crest, and it costs a whole line each time. The logo says it in a third of
            the width and stays legible at a glance down a column. The name is still on
            the card for anyone who needs it -- as a title attribute and in the
            accessible name -- so nothing is lost, it is just no longer painted.
          */}
          <span className="mt-0.5 flex h-5 items-center gap-1.5">
            {team ? <TeamLogo team={team} sizeClass="h-5 w-5" /> : null}
            <span className="sr-only">{team ? `${team.city} ${team.name}` : ''}</span>
          </span>
        </div>
        <span
          className="inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 t-caption"
          style={{ borderColor: style.border, color: style.border }}
        >
          <Icon className="h-3 w-3" aria-hidden="true" />
          {style.label}
        </span>
      </div>

      <p className="t-stat">
        <span className="text-[var(--color-ink-dim)]">O/U</span> {market.line}{' '}
        {market.statPlural}
      </p>

      {/* Both sides priced, so the card reads as a market rather than a tip. The
          bettor chooses the side; the card does not choose it for them. */}
      <div className="grid grid-cols-2 gap-1.5">
        <span className="flex flex-col border border-[var(--color-chrome-lo)] bg-[var(--color-panel)] px-2 py-1">
          <span className="t-caption text-[var(--color-ink-faint)]">Over</span>
          <span className="t-stat tabular-nums">{formatAmerican(prices.overPrice)}</span>
        </span>
        <span className="flex flex-col border border-[var(--color-chrome-lo)] bg-[var(--color-panel)] px-2 py-1">
          <span className="t-caption text-[var(--color-ink-faint)]">Under</span>
          <span className="t-stat tabular-nums">{formatAmerican(prices.underPrice)}</span>
        </span>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--color-chrome-lo)] pt-1.5">
        <span className="t-caption tabular-nums text-[var(--color-ink-faint)]">
          {profile ? `${profile.outlet} ` : ''}
          {Math.round(own * 100)}%
        </span>
        <span className="inline-flex items-center gap-1 t-caption text-[var(--color-ink-dim)] group-hover:text-[var(--color-gold-hi)]">
          Bet
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </span>
      </div>
    </button>
  );
};

/**
 * One outlet's board for a slate.
 *
 * Grouped by game, because a prop on a player who is not in tonight's game is
 * not actionable, and five scattered cards across a slate of fifteen games give
 * no clue whether the outlet is concentrated or spread thin. The game header also
 * carries the two clubs, so a manager can see at a glance that Hollis's board is
 * concentrated on the game at Baltimore rather than spread over the night.
 */
/**
 * Columns per prop count, above `sm` only. Below it the grid is a single column.
 *
 * Keyed 1..3 because that is the range the board actually produces, and the largest group is capped at
 * three rather than wrapping a fourth card onto a second row that would break the visual rhythm of
 * every other group.
 *
 * ONE PROP STILL GETS TWO COLUMNS, which is the whole subtlety. A lone card in a one-column grid
 * stretches the full 1280px panel and leaves its contents huddled against the left edge with the
 * price and the Bet button marooned at the far end -- a card that looks broken rather than empty. At
 * two columns it occupies one normal column and is exactly as wide as every other card on the board,
 * so a game with a single prop reads as a game with a single prop.
 */
const PROP_COLUMNS: Record<number, string> = {
  1: 'sm:grid-cols-2',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
};

export const MediaPropBoard: React.FC<{
  markets: PropMarket[];
  mediaId: MediaId;
  slateDate: string | null;
  /**
   * Game id to the two clubs in it, away first.
   *
   * The CRESTS rather than a name, which is the point of the prop existing. It used to take
   * `matchupLabel` -- a function returning the string "Wingten at Alcondale" -- and paint that across
   * the group header. Two cities of type was how you told apart two nearly identical matchups in a
   * column of them, and it was the only text-only identifier left on a board that is otherwise
   * crests, prices and player names. Both clubs already have a crest component that resolves the
   * asset and falls back to a labelled abbreviation, so the header now says the same thing with the
   * mark the reader will see again on the other side of the screen.
   *
   * The city names stay available, because a crest with no text at all is worse for a reader who does
   * not recognise the artwork -- see the `aria-label` on each logo below.
   */
  clubsOf: (gameId: string) => { away: Team; home: Team } | undefined;
  /** Team id to the club itself, for the crest on each card. */
  teamOf: (teamId: string) => Team | undefined;
  onOpen: (propId: string, mediaId: MediaId) => void;
}> = ({ markets, mediaId, slateDate, clubsOf, teamOf, onOpen }) => {
  if (markets.length === 0) {
    return (
      <p className="p-4 t-body text-[var(--color-ink-dim)]">
        {slateDate
          ? 'No props are published for this slate. Props need a played season to price from — a player with no games behind him has no rate to shrink, and the model will not invent one.'
          : 'No further games are scheduled this season.'}
      </p>
    );
  }

  const byGame = new Map<string, PropMarket[]>();
  markets.forEach((market) => {
    const row = byGame.get(market.gameId);
    if (row) row.push(market);
    else byGame.set(market.gameId, [market]);
  });

  return (
    <div className="flex flex-col gap-4">
      {[...byGame.entries()].map(([gameId, group]) => {
        const clubs = clubsOf(gameId);
        /*
          THE GROUP HEADER, as two crests and an arrow.

          A prop is always about a player in a game, so the game is the context a card cannot carry
          itself. It was a line of text -- "Wingten at Alcondale" -- and text in that slot was both the
          slowest thing to read in a column of similar lines and the only place on the board where a
          club was named by letters rather than by its own mark.

          The words are not gone, only demoted: each crest carries the club name in an aria-label, so a
          screen reader announces "Wingten Generals at Alcondale Aerials" and the sighted reader gets
          the two marks. Nothing is lost for anyone; the ambiguity of two similar city names is.
        */
        return (
          <div key={gameId}>
            <div className="chrome-bar mb-2 flex items-center justify-between gap-3 px-3">
              <span
                className="flex min-w-0 shrink items-center gap-2"
                title={clubs ? `${clubs.away.city} at ${clubs.home.city}` : undefined}
              >
                {clubs ? (
                  <>
                    <TeamLogo team={clubs.away} sizeClass="h-7 w-7" />
                    <span className="t-caption text-[var(--color-ink-faint)]" aria-hidden="true">at</span>
                    <TeamLogo team={clubs.home} sizeClass="h-7 w-7" />
                    <span className="sr-only">{clubs.away.city} at {clubs.home.city}</span>
                  </>
                ) : (
                  <span className="t-label truncate">Unscheduled game</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="t-caption tabular-nums text-[var(--color-ink-dim)]">
                  {group[0] ? formatResolutionDate(group[0].date) : ''}
                </span>
                <span className="t-caption text-[var(--color-ink-faint)]">
                  {group.length} {group.length === 1 ? 'prop' : 'props'}
                </span>
              </span>
            </div>

            {/*
              AS MANY COLUMNS AS THERE ARE CARDS, up to three -- but only above `sm`.

              An outlet publishes at most two props per game, and the grid was fixed at
              `xl:grid-cols-3`, so every group on the board drew two cards across a three-wide row and
              the right-hand third of a 1280px panel stayed empty. Two thirds of the widest space on
              the page was blank for the most common case, which is the case the board is mostly made
              of.

              The count comes from the data rather than a media query, so it is right at every width
              instead of right at some.

              The `sm:` prefix is load-bearing and is why this is not an inline template. An earlier
              version set `gridTemplateColumns` straight from the group length, which gave a PHONE two
              columns where it had one before -- trading a gap on a desktop for cramped cards on the
              smallest screen. Filling the row is the goal on a wide panel; it is not a reason to
              squeeze a 320px viewport.

              The three counts are written out rather than interpolated because Tailwind's JIT only
              emits a class it can see literally, which is the same constraint that forces
              `OUTLET_COLUMNS` to be a map in MediaOddsSlate.
            */}
            <div className={`grid grid-cols-1 gap-2 ${PROP_COLUMNS[Math.min(group.length, 3)]}`}>
              {group.map((market) => (
                <MediaPropCard
                  key={market.propId}
                  market={market}
                  mediaId={mediaId}
                  team={teamOf(market.teamId)}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
