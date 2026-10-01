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
export const MediaPropBoard: React.FC<{
  markets: PropMarket[];
  mediaId: MediaId;
  slateDate: string | null;
  /** Game id to its "Away at Home" label, in slate order. */
  matchupLabel: (gameId: string) => string;
  /** Team id to the club itself, for the crest on each card. */
  teamOf: (teamId: string) => Team | undefined;
  onOpen: (propId: string, mediaId: MediaId) => void;
}> = ({ markets, mediaId, slateDate, matchupLabel, teamOf, onOpen }) => {
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
      {[...byGame.entries()].map(([gameId, group]) => (
        <div key={gameId}>
          {/*
            THE DATE, ON THE GROUP HEADER.

            The board is already grouped by game, so "which fixture" was answered by
            this header. "When" was not answered anywhere: a card said a player, a stat
            and a line, and a reader had no way to tell which night any of it resolved
            on. `PropMarket.date` has been on the market since the family was built and
            was simply never painted.

            It goes here rather than on all fifteen cards because it is a fact about the
            game, so one date per group says it fifteen times over at a fifteenth of the
            cost. A prop resolves the moment its game is played, which makes this the
            other half of what a prop bet IS.
          */}
          <div className="chrome-bar mb-2 flex items-center justify-between gap-3 px-3">
            <span className="t-label truncate">{matchupLabel(gameId)}</span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="t-caption tabular-nums text-[var(--color-ink-dim)]">
                {group[0] ? formatResolutionDate(group[0].date) : ''}
              </span>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {group.length} {group.length === 1 ? 'prop' : 'props'}
              </span>
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
      ))}
    </div>
  );
};
