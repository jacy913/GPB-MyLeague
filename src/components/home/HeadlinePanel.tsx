import React, { useEffect, useMemo, useState } from 'react';
import { Newspaper } from 'lucide-react';
import type { Game, Team } from '../../types';
import { isPlayoffGame } from '../../logic/playoffs';
import gpbLogo from '../../assets/gpb.png';
import { MEDIA_BY_ID } from '../../data/media';
import type { GameLine } from '../../lib/mediaOdds';
import { formatAmerican } from '../../lib/markets';
import { Panel, StatValue, StripeDivider, TeamLogo } from '../ui';
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
 * The deck already carries an ordered set of stories and the panel showed only the
 * first, with the rest demoted to a list underneath -- which is a page, not a
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
 *
 * The scoreline under the headline resolves its own clubs from the SAME active
 * slide. It used to take awayTeam and homeTeam as props, and the caller built
 * those from the PRIMARY headline only -- so on a six-story carousel the big
 * crest tracked whichever slide you were on while the score beside it stayed
 * frozen on the first one. The two contradicted each other from the second slide
 * onward, which is the bug this change fixes.
 */
export const HeadlinePanel: React.FC<{
  deck: HeadlineDeck;
  timelineDate: string;
  teamLookup: Map<string, Team>;
  onOpenGame: (gameId: string) => void;
}> = ({ deck, timelineDate, teamLookup, onOpenGame }) => {
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

  /*
   * The scoreline's own clubs, from the same slide as the crest above it.
   * Resolved here rather than passed in, so the two cannot disagree.
   */
  const scoreboard = useMemo(() => {
    if (!active.game) return null;
    return {
      away: teamLookup.get(active.game.awayTeam) ?? null,
      home: teamLookup.get(active.game.homeTeam) ?? null,
    };
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
        className="grid gap-5 p-5 lg:grid-cols-[300px_minmax(0,1fr)]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        {/*
          The mark, free-standing.
          240px, and no box. It was 176px inside a bordered, filled container,
          which made the crest read as an icon sitting in a well rather than as
          the subject of the story. Crests are cut against a transparent field
          and the panel is already a surface, so the frame was double-counting
          the same edge twice.
        */}
        <div className="flex items-center justify-center">
          {featuredTeam ? (
            <TeamLogo team={featuredTeam} sizeClass="h-60 w-60" />
          ) : (
            <img src={gpbLogo} alt="GPB" className="h-52 w-auto object-contain" />
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-center">
          <p className="t-caption text-[var(--color-gold)]">
            {featuredTeam ? `${featuredTeam.league} · ${featuredTeam.city} ${featuredTeam.name}` : 'League Office'}
          </p>
          <h1 className="t-display mt-2 text-[var(--color-gold-hi)]">{active.headline}</h1>
          <div className="mt-4 h-[3px] w-24 bg-[var(--color-gold)]" aria-hidden="true" />
          <p className="t-body mt-4 max-w-2xl text-[var(--color-ink-dim)]">{active.summary}</p>

          {active.game && scoreboard && (
            <button
              type="button"
              onClick={() => active.game && onOpenGame(active.game.gameId)}
              className="mt-5 flex w-fit items-center gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 text-left transition-colors hover:border-[var(--color-gold)]"
            >
              <span className="t-caption text-[var(--color-ink-faint)]">
                {isPlayoffGame(active.game) ? active.game.playoff?.seriesLabel ?? 'Playoff' : 'Latest Result'}
              </span>
              {scoreboard.away && <TeamLogo team={scoreboard.away} sizeClass="h-8 w-8" />}
              <StatValue variant="accent">
                {active.game.score.away}-{active.game.score.home}
              </StatValue>
              {scoreboard.home && <TeamLogo team={scoreboard.home} sizeClass="h-8 w-8" />}
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
};

/**
 * The featured matchup, priced.
 *
 * This used to show both clubs' records and the run differential between them,
 * which is a stat comparison and not a reason to care about tonight. It now
 * shows the house moneyline for the game instead, built by the same
 * buildGameLine the Betting page uses, so the two screens can never disagree
 * about what the house thinks.
 *
 * The club's nickname is gone and the city carries the side on its own. With
 * the record and the differential removed there was room for exactly one line
 * of identity, and the city is the one a manager recognises at a glance; the
 * nickname was the more decorative of the two.
 */
export const FeaturedGamePanel: React.FC<{
  gameId: string | null;
  angle: string | null;
  away: Team | null;
  home: Team | null;
  line: GameLine | null;
  date: string | null;
  onOpenGame: (gameId: string) => void;
}> = ({ gameId, angle, away, home, line, date, onOpenGame }) => {
  const hasGame = Boolean(gameId && away && home);

  const side = (team: Team | null, price: number, align: 'left' | 'right') => (
    <div className={`flex min-w-0 flex-1 flex-col items-center gap-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {team ? (
        <>
          <TeamLogo team={team} sizeClass="h-24 w-24" />
          <p className="t-h2 truncate">{team.city}</p>
          <p
            className={`t-stat-lg tabular-nums ${
              price < 0 ? 'text-[var(--color-gold-hi)]' : 'text-[var(--color-ink-dim)]'
            }`}
          >
            {formatAmerican(price)}
          </p>
        </>
      ) : (
        <>
          <span className="h-24 w-24 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />
          <span className="t-caption text-[var(--color-ink-faint)]">TBD</span>
        </>
      )}
    </div>
  );

  return (
    <HomePanel
      title="Featured Odds"
      aside={date ? <span className="t-caption text-[var(--color-ink-faint)]">{formatMiniDate(date)}</span> : undefined}
    >
      {hasGame && line ? (
        <button type="button" onClick={() => onOpenGame(gameId as string)} className="w-full text-left">
          {angle && <p className="t-caption mb-3 text-[var(--color-gold)]">{angle}</p>}
          <div className="flex items-center gap-3">
            {side(away, line.houseOdds, 'left')}
            <div className="flex shrink-0 flex-col items-center gap-1">
              <span className="t-h2 text-[var(--color-gold)]" aria-hidden="true">VS</span>
              <StripeDivider bars={3} height={4} depth={6} />
            </div>
            {side(home, line.homeOdds, 'right')}
          </div>
          {line.disagreement >= 0.10 && (
            <p className="t-caption mt-4 text-[var(--color-warn)]">
              {MEDIA_BY_ID[line.outlier].outlet} is {Math.round(line.disagreement * 100)} points
              away from the other two
            </p>
          )}
        </button>
      ) : (
        <p className="t-body text-[var(--color-ink-dim)]">
          No marquee matchup. Today's slate is light — check back once the next wave of games is scheduled.
        </p>
      )}
    </HomePanel>
  );
};
