import React from 'react';
import { Newspaper } from 'lucide-react';
import type { Game, Team } from '../../types';
import { isPlayoffGame } from '../../logic/playoffs';
import { MatchupStrip, Panel, StatValue, TeamLogo } from '../ui';
import { HomePanel, formatHeadlineDate, formatMiniDate } from './shared';

type HeadlineCard = {
  headline: string;
  summary: string;
  game: Game | null;
};

type HeadlineDeck = {
  primary: HeadlineCard;
  secondary: HeadlineCard[];
  sourceDate: string | null;
};

/**
 * The lead story.
 *
 * Rebuilt after the first full-season playthrough, where this read as a task
 * list: a display headline, a paragraph, and then a three-column grid of small
 * bordered cards with a date stamp on each. The secondary stories were styled
 * as peers of the lead -- same border, same padding, same weight -- so nothing
 * said which one mattered, and the eye had three candidates to choose from
 * before it found the story.
 *
 * The lead is now unambiguously the lead: display type, a rule under it, and
 * the summary set larger. The runners-up are demoted to a single ruled list with
 * no boxes at all, so they read as index entries under the story rather than as
 * competing cards. Boxes are for things you choose between; a ranked list is for
 * things you read in order.
 */
export const HeadlinePanel: React.FC<{
  deck: HeadlineDeck;
  awayTeam: Team | null;
  homeTeam: Team | null;
  timelineDate: string;
  onOpenGame: (gameId: string) => void;
}> = ({ deck, awayTeam, homeTeam, timelineDate, onOpenGame }) => {
  const { primary, secondary, sourceDate } = deck;

  return (
    <Panel variant="hero" className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-label">Headline Of The Day</h2>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {sourceDate ? formatHeadlineDate(sourceDate) : formatHeadlineDate(timelineDate)}
        </span>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.4fr)_300px]">
        <div className="min-w-0">
          <h1 className="t-display text-[var(--color-gold-hi)]">{primary.headline}</h1>
          <div className="mt-4 h-[3px] w-24 bg-[var(--color-gold)]" aria-hidden="true" />
          <p className="t-body mt-4 max-w-2xl text-[var(--color-ink-dim)]">{primary.summary}</p>

          {secondary.length > 0 && (
            <>
              <p className="t-label mt-6 border-t border-[var(--color-chrome-lo)] pt-4 text-[var(--color-ink-faint)]">
                Also Today
              </p>
              <ol className="mt-1">
                {secondary.map((card, index) => (
                  <li key={`${card.headline}-${card.game?.gameId ?? index}`}>
                    <button
                      type="button"
                      onClick={() => card.game && onOpenGame(card.game.gameId)}
                      disabled={!card.game}
                      className="flex w-full items-baseline gap-4 border-b border-[var(--color-chrome-lo)] py-2.5 text-left transition-colors hover:bg-[var(--color-panel-2)] disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="t-caption w-[6ch] shrink-0 tabular-nums text-[var(--color-gold)]">
                        {card.game ? formatMiniDate(card.game.date) : 'NOTE'}
                      </span>
                      <span className="t-stat-sm min-w-0 flex-1 truncate">{card.headline}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {primary.game ? (
            <button
              type="button"
              onClick={() => primary.game && onOpenGame(primary.game.gameId)}
              className="flex flex-col gap-3 border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] p-4 text-left transition-colors hover:bg-[var(--color-panel-2)]"
            >
              <p className="t-caption text-[var(--color-ink-faint)]">
                {isPlayoffGame(primary.game) ? primary.game.playoff?.seriesLabel ?? 'Playoff Spotlight' : 'Latest Result'}
              </p>
              <div className="flex items-center gap-3">
                {awayTeam && <TeamLogo team={awayTeam} sizeClass="h-12 w-12" />}
                <StatValue size="lg" variant="accent">
                  {primary.game.score.away}-{primary.game.score.home}
                </StatValue>
                {homeTeam && <TeamLogo team={homeTeam} sizeClass="h-12 w-12" />}
              </div>
            </button>
          ) : (
            <div className="border-l-[3px] border-l-transparent bg-[var(--color-sunken)] p-4">
              <p className="t-caption text-[var(--color-ink-faint)]">No game in play</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
};

export const FeaturedGamePanel: React.FC<{
  gameId: string | null;
  angle: string | null;
  lore: string | null;
  away: Team | null;
  home: Team | null;
  date: string | null;
  onOpenGame: (gameId: string) => void;
}> = ({ gameId, angle, lore, away, home, date, onOpenGame }) => {
  const hasGame = Boolean(gameId && angle && away && home);

  return (
    <HomePanel
      title="Featured Matchup"
      eyebrow="Today's Featured Game"
      aside={date ? <span className="t-caption text-[var(--color-ink-faint)]">{formatMiniDate(date)}</span> : undefined}
    >
      {hasGame ? (
        <button
          type="button"
          onClick={() => onOpenGame(gameId as string)}
          className="w-full text-left"
        >
          {angle && <p className="t-caption mb-2 text-[var(--color-gold)]">{angle}</p>}
          <MatchupStrip away={away} home={home} scale="md" />
          {lore && <p className="t-caption mt-3 text-[var(--color-ink-dim)]">{lore}</p>}
        </button>
      ) : (
        <p className="t-body text-[var(--color-ink-dim)]">
          No marquee matchup. Today's slate is light — check back once the next wave of games is scheduled.
        </p>
      )}
    </HomePanel>
  );
};
