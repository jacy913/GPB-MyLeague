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
 * The lead story. This is the only place on the front page permitted display
 * type, and it stays unique -- every other section is t-h3. The previous
 * version ran three competing headline scales (5xl, 4xl, 3xl) across sibling
 * sections, so nothing on the page had a clear entry point.
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

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_260px]">
        <div className="min-w-0">
          <h1 className="t-display text-[var(--color-gold-hi)]">{primary.headline}</h1>
          <p className="t-body mt-3 max-w-2xl text-[var(--color-ink-dim)]">{primary.summary}</p>

          {secondary.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {secondary.map((card, index) => (
                <button
                  key={`${card.headline}-${card.game?.gameId ?? index}`}
                  type="button"
                  onClick={() => card.game && onOpenGame(card.game.gameId)}
                  disabled={!card.game}
                  className="border-l-[3px] border-l-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 text-left transition-colors hover:border-l-[var(--color-gold)] disabled:cursor-default"
                >
                  <p className="t-caption text-[var(--color-ink-faint)]">
                    {card.game ? formatMiniDate(card.game.date) : 'LEAGUE NOTE'}
                  </p>
                  <p className="mt-1 t-stat-sm truncate">{card.headline}</p>
                  <p className="t-caption mt-1 line-clamp-2 text-[var(--color-ink-dim)]">{card.summary}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {primary.game ? (
            <button
              type="button"
              onClick={() => primary.game && onOpenGame(primary.game.gameId)}
              className="flex flex-col gap-3 border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] p-3 text-left transition-colors hover:bg-[var(--color-panel-2)]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="t-caption text-[var(--color-ink-faint)]">
                  {isPlayoffGame(primary.game) ? primary.game.playoff?.seriesLabel ?? 'PLAYOFF SPOTLIGHT' : 'LATEST RESULT'}
                </p>
                <div className="flex items-center gap-1">
                  {awayTeam && <TeamLogo team={awayTeam} sizeClass="h-5 w-5" />}
                  {homeTeam && <TeamLogo team={homeTeam} sizeClass="h-5 w-5" />}
                </div>
              </div>
              <StatValue size="lg" variant="accent">
                {primary.game.score.away}-{primary.game.score.home}
              </StatValue>
            </button>
          ) : (
            <div className="border-l-[3px] border-l-transparent bg-[var(--color-sunken)] p-3">
              <p className="t-caption text-[var(--color-ink-faint)]">NO GAME IN PLAY</p>
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
