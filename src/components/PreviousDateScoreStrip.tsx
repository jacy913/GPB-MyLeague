import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, PauseCircle } from 'lucide-react';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { Panel, RetroButton, TeamLogo } from './ui';
import { isPlayoffGame } from '../logic/playoffs';
import { Game, Team } from '../types';

interface PreviousDateScoreStripProps {
  simulationPerformanceMode: boolean;
  bannerDate: string;
  currentTimelineDate: string;
  gamesForBannerDate: Game[];
  teamLookup: Map<string, Team>;
  onOpenGame: (gameId: string) => void;
}

const CARD_WIDTH = 208;
const GAP = 8;

/**
 * Score bar.
 *
 * Was a three-line card per game -- a status row above two stacked team rows,
 * in a rounded box -- which made the bar about 100px tall to say one number.
 * It is now a single line per game: crest, score, score, crest. The user is
 * glancing at this constantly while simming, so it earns its vertical space
 * only by being thin, and the detail lives one click away in the game screen.
 *
 * Carousel rather than free scroll. A day has up to 16 games, which is far more
 * than fits, and a scrollbar gives no sense of how much is off screen. Paging is
 * by visible width rather than by card count so it survives a resize, and the
 * buttons disable at the ends instead of wrapping, so the page readout is never
 * a lie.
 */
export function PreviousDateScoreStrip({
  simulationPerformanceMode,
  bannerDate,
  currentTimelineDate,
  gamesForBannerDate,
  teamLookup,
  onOpenGame,
}: PreviousDateScoreStripProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState({ scrollLeft: 0, maxScroll: 0, viewport: 0 });

  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setMetrics({
      scrollLeft: track.scrollLeft,
      maxScroll: Math.max(0, track.scrollWidth - track.clientWidth),
      viewport: track.clientWidth,
    });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    track.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(track);

    return () => {
      track.removeEventListener('scroll', onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure]);

  // A new slate means a different number of cards; start at the left edge
  // rather than leaving the track parked at a scroll offset it no longer has.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: 0, behavior: 'auto' });
    measure();
  }, [gamesForBannerDate, measure]);

  const pageWidth = Math.max(CARD_WIDTH + GAP, metrics.viewport);
  const pageCount = Math.max(1, Math.ceil(metrics.maxScroll / pageWidth) + 1);
  const page = metrics.maxScroll <= 1 ? 0 : Math.round(metrics.scrollLeft / pageWidth);
  const canPrev = metrics.scrollLeft > 2;
  const canNext = metrics.scrollLeft < metrics.maxScroll - 2;

  const goToPage = useCallback((next: number) => {
    const track = trackRef.current;
    if (!track) return;
    const width = Math.max(CARD_WIDTH + GAP, track.clientWidth);
    const max = Math.max(0, track.scrollWidth - track.clientWidth);
    track.scrollTo({ left: Math.max(0, Math.min(next * width, max)), behavior: 'smooth' });
  }, []);

  const finalCount = useMemo(
    () => gamesForBannerDate.filter((game) => game.status === 'completed').length,
    [gamesForBannerDate],
  );

  if (simulationPerformanceMode) {
    return (
      <div className="px-3 py-3 sm:px-5 lg:px-8">
        <Panel className="border-l-[3px] border-l-[var(--color-warn)] px-4 py-3">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
            <p className="t-label text-[var(--color-warn)]">Simulation Focus Mode</p>
          </div>
          <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
            Live score banners and ticker updates are paused while the calendar sim runs.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-chrome-lo)] bg-[var(--color-base)] px-3 py-2 sm:px-5 lg:px-8">
      <div className="hidden shrink-0 items-center gap-2 border-r border-[var(--color-chrome-lo)] pr-4 md:flex">
        <span className="h-2 w-2 bg-[var(--color-platinum)]" aria-hidden="true" />
        <div>
          <p className="t-caption text-[var(--color-ink-faint)]">Yesterday</p>
          <p className="t-stat-sm">{formatHeaderDate(bannerDate || currentTimelineDate)}</p>
        </div>
      </div>

      {gamesForBannerDate.length === 0 ? (
        <p className="flex-1 t-caption text-[var(--color-ink-faint)]">
          No games on the previous sim date.
        </p>
      ) : (
        <>
          <div
            ref={trackRef}
            role="region"
            aria-label="Previous date scores"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') { event.preventDefault(); goToPage(page + 1); }
              if (event.key === 'ArrowLeft') { event.preventDefault(); goToPage(page - 1); }
            }}
            className="min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
          >
            <div className="flex w-max gap-2 pb-0.5">
              {gamesForBannerDate.map((game) => {
                const awayTeam = teamLookup.get(game.awayTeam) ?? null;
                const homeTeam = teamLookup.get(game.homeTeam) ?? null;
                const final = game.status === 'completed';
                const playoff = isPlayoffGame(game);
                // Undetermined is drawn as a dash. Showing 0-0 for a game that
                // has not been played states a score nobody earned.
                const awayRuns = final ? game.score.away : null;
                const homeRuns = final ? game.score.home : null;

                // The edge says one thing only: played or not. Playoff identity
                // is the text chip, so it stays legible without colour. Gold was
                // briefly reused for "not yet played", which collided with the
                // playoff chip and made a scheduled playoff game doubly gold.
                const edge = final ? 'border-l-[var(--color-pos)]' : 'border-l-[var(--color-chrome-lo)]';
                const statusLabel = playoff ? 'Playoff' : final ? 'Final' : 'Scheduled';

                return (
                  <button
                    key={`banner-${game.gameId}`}
                    type="button"
                    onClick={() => onOpenGame(game.gameId)}
                    aria-label={`${awayTeam?.name ?? game.awayTeam} at ${homeTeam?.name ?? game.homeTeam}, ${statusLabel}`}
                    className={`flex w-[208px] shrink-0 snap-start items-center gap-2 border border-[var(--color-chrome-lo)] ${edge} border-l-[3px] bg-[var(--color-panel)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-panel-2)]`}
                  >
                    {awayTeam
                      ? <TeamLogo team={awayTeam} sizeClass="h-7 w-7" />
                      : <span className="h-7 w-7 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}

                    <span className="ml-auto flex items-center gap-1.5 tabular-nums">
                      <span className={`t-stat ${awayRuns === null ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>
                        {awayRuns ?? '–'}
                      </span>
                      <span className="text-[var(--color-ink-faint)]" aria-hidden="true">–</span>
                      <span className={`t-stat ${homeRuns === null ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'}`}>
                        {homeRuns ?? '–'}
                      </span>
                    </span>

                    {homeTeam
                      ? <TeamLogo team={homeTeam} sizeClass="h-7 w-7" />
                      : <span className="h-7 w-7 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}

                    <span
                      className={`ml-0.5 w-[4ch] shrink-0 text-right t-caption ${
                        playoff ? 'text-[var(--color-gold)]' : final ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink-faint)]'
                      }`}
                    >
                      {playoff ? 'PL' : final ? 'F' : 'SCH'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <RetroButton
              variant="ghost"
              size="sm"
              aria-label="Previous scores"
              disabled={!canPrev}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </RetroButton>
            <span className="t-caption tabular-nums text-[var(--color-ink-faint)]">
              {page + 1}/{pageCount}
            </span>
            <RetroButton
              variant="ghost"
              size="sm"
              aria-label="Next scores"
              disabled={!canNext}
              onClick={() => goToPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </RetroButton>
          </div>
        </>
      )}

      <span className="hidden shrink-0 t-caption tabular-nums text-[var(--color-ink-faint)] lg:inline">
        {finalCount}/{gamesForBannerDate.length} final
      </span>
    </div>
  );
}
