import React, { useEffect, useMemo, useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { Game, Team } from '../../types';
import { isPlayoffGame } from '../../logic/playoffs';
import gpbLogo from '../../assets/gpb.png';
import { MatchupStrip, Panel, StatValue, TeamLogo } from '../ui';
import { HomePanel, formatHeadlineDate, formatMiniDate } from './shared';

/** How long a headline holds the screen before the deck advances. */
const SLIDE_INTERVAL_MS = 7000;

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
 * The lead story, as a carousel.
 *
 * The deck already carries an ordered set of stories and the panel showed only
 * the first, with the rest demoted to a list underneath -- which is a page, not a
 * headline. It rotates through them now, one story at a time at full weight.
 *
 * Each slide leads with a large crest of the club the story is about, resolved
 * from the game the story came from: the winner of that game, since every
 * generated headline is written from the winning side. A story with no game
 * behind it is a league note and has no club, so it shows the GPB mark instead
 * of leaving a hole.
 *
 * The featured club is derived here rather than added to HeadlineCard on
 * purpose. The engine is presentation-agnostic and already hands over the game
 * each story came from; threading a teamId through it would have put a
 * presentation concern into the story builder.
 */
export const HeadlinePanel: React.FC<{
  deck: HeadlineDeck;
  awayTeam: Team | null;
  homeTeam: Team | null;
  timelineDate: string;
  teamLookup: Map<string, Team>;
  onOpenGame: (gameId: string) => void;
}> = ({ deck, awayTeam, homeTeam, timelineDate, teamLookup, onOpenGame }) => {
  const { primary, secondary, sourceDate } = deck;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const slides = useMemo(() => [primary, ...secondary], [primary, secondary]);
  const slideCount = slides.length;
  const active = slides[Math.min(index, slideCount - 1)] ?? primary;

  useEffect(() => {
    setIndex(0);
  }, [primary.headline]);

  useEffect(() => {
    if (paused || slideCount <= 1) return undefined;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % slideCount);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, slideCount]);

  const featuredTeam = useMemo(() => {
    if (!active.game) return null;
    const { awayTeam: awayId, homeTeam: homeId, score } = active.game;
    return teamLookup.get(score.away > score.home ? awayId : homeId) ?? null;
  }, [active, teamLookup]);

  return (
    <Panel variant="hero" className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-label">Headline Of The Day</h2>
        </div>
        <div className="flex items-center gap-3">
          {slideCount > 1 && (
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Headlines">
              {slides.map((slide, slideIndex) => (
                <button
                  key={`${slide.headline}-${slideIndex}`}
                  type="button"
                  role="tab"
                  aria-selected={slideIndex === index}
                  aria-label={`Headline ${slideIndex + 1} of ${slideCount}`}
                  onClick={() => setIndex(slideIndex)}
                  className={`h-2 w-6 transition-colors ${
                    slideIndex === index
                      ? 'bg-[var(--color-gold)]'
                      : 'bg-[var(--color-chrome-lo)] hover:bg-[var(--color-chrome-hi)]'
                  }`}
                />
              ))}
            </div>
          )}
          <span className="t-caption text-[var(--color-ink-faint)]">
            {sourceDate ? formatHeadlineDate(sourceDate) : formatHeadlineDate(timelineDate)}
          </span>
        </div>
      </div>

      <div
        className="grid gap-5 p-5 lg:grid-cols-[260px_minmax(0,1fr)]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {/* The mark is the anchor for the slide. 200px so it reads as the subject
            of the story rather than as an icon next to a paragraph. */}
        <div className="flex items-center justify-center border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-4">
          {featuredTeam ? (
            <TeamLogo team={featuredTeam} sizeClass="h-44 w-44" />
          ) : (
            <img src={gpbLogo} alt="GPB" className="h-40 w-auto object-contain" />
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <p className="t-caption text-[var(--color-gold)]">
            {featuredTeam ? `${featuredTeam.league} · ${featuredTeam.city} ${featuredTeam.name}` : 'League Office'}
          </p>
          <h1 className="t-display mt-2 text-[var(--color-gold-hi)]">{active.headline}</h1>
          <div className="mt-4 h-[3px] w-24 bg-[var(--color-gold)]" aria-hidden="true" />
          <p className="t-body mt-4 max-w-2xl text-[var(--color-ink-dim)]">{active.summary}</p>

          {active.game && (
            <button
              type="button"
              onClick={() => active.game && onOpenGame(active.game.gameId)}
              className="mt-5 flex w-fit items-center gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 text-left transition-colors hover:border-[var(--color-gold)]"
            >
              <span className="t-caption text-[var(--color-ink-faint)]">
                {isPlayoffGame(active.game) ? active.game.playoff?.seriesLabel ?? 'Playoff' : 'Latest Result'}
              </span>
              {awayTeam && <TeamLogo team={awayTeam} sizeClass="h-8 w-8" />}
              <StatValue variant="accent">
                {active.game.score.away}-{active.game.score.home}
              </StatValue>
              {homeTeam && <TeamLogo team={homeTeam} sizeClass="h-8 w-8" />}
            </button>
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
