import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PauseCircle } from 'lucide-react';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { Panel, TeamLogo } from './ui';
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

/** Horizontal step between items, applied as margin so every item occupies the same period. */
const ITEM_STEP = 8;
/**
 * Crawl speed in px per second. A constant speed is what makes it read as a
 * board. Halved twice on request, from 55 to 18 to 9.
 */
const CRAWL_SPEED = 9;
const MIN_DURATION = 18;
/**
 * Raised from 110s alongside each speed change. Duration is travel / speed, so
 * a 16-game slate at 9px/s wants a 384 second lap; the old ceiling would have
 * clamped it back to an effective 31px/s, which is faster than the speed just
 * asked for. The clamp is still worth having, so a pathologically long slate
 * cannot produce a lap longer than a coffee break.
 */
const MAX_DURATION = 420;
/** How long the crawl stays frozen after the pointer leaves, before it resumes. */
const RESUME_DELAY_MS = 3000;

interface CrawlEntry {
  gameId: string;
  awayTeam: Team | null;
  homeTeam: Team | null;
  final: boolean;
  playoff: boolean;
  awayRuns: number | null;
  homeRuns: number | null;
  statusLabel: string;
}

/**
 * Score crawl, global.
 *
 * A scoreboard ticker in the sense a stadium uses one: results move steadily
 * right to left, forever, with no control surface at all. It replaces the
 * dashboard's own headline crawl, which was the same motion in the wrong place,
 * and the pagination this bar used to carry, which made a strip that changes on
 * its own behave like a document the reader had to drive.
 *
 * The loop is seamless because of two details that are easy to get wrong. The
 * step between items is margin on each item rather than gap on the container, so
 * every item occupies exactly the same width and the last item in a group is not
 * short by one gap. And the number of rendered items is forced to a whole
 * multiple of the item count, so translating by half the track lands on item
 * index 0 again rather than somewhere in the middle of the sequence. With gap on
 * the container, or with a ragged count, the seam is visible once per loop.
 *
 * How many copies are rendered is measured rather than assumed, so the bar is
 * full at any viewport width, and the duration is derived from the measured
 * width at a constant speed, so a sixteen-game slate does not whip past and a
 * two-game slate does not crawl for a minute.
 *
 * Scoreboard motion is exempt from the standing motion limit for the same reason
 * simulation progress is -- it reports something actually happening. It pauses on
 * hover and keyboard focus and stops entirely under prefers-reduced-motion,
 * because a full-width crawl is the one thing on the page a user cannot scroll
 * away from.
 */
export function PreviousDateScoreStrip({
  simulationPerformanceMode,
  bannerDate,
  currentTimelineDate,
  gamesForBannerDate,
  teamLookup,
  onOpenGame,
}: PreviousDateScoreStripProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const singleCopyRef = useRef<HTMLDivElement | null>(null);
  const [copyWidth, setCopyWidth] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const resumeTimerRef = useRef<number | null>(null);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  /**
   * Hover freezes the crawl where it is, and leaving it does not send the belt
   * back to the start.
   *
   * The bug this fixes: the style used to set `animation` to undefined while
   * paused. Removing a CSS animation does not freeze it, it destroys it, so the
   * element snapped back to its untransformed position on every hover and the
   * lap began again from zero. That is why a result further down the belt could
   * never be reached -- the crawl restarted faster each time the pointer crossed
   * it, so the effective speed was the base speed divided by the number of
   * crossings.
   *
   * The animation is now always present and only animationPlayState is toggled,
   * which holds the playhead where it is. Re-entering cancels the pending
   * resume; leaving waits out RESUME_DELAY_MS so the pointer can be moved away
   * without the belt lurching the instant the cursor clears it.
   */
  const handlePointerEnter = useCallback(() => {
    clearResumeTimer();
    setPaused(true);
  }, [clearResumeTimer]);

  const handlePointerLeave = useCallback(() => {
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      setPaused(false);
    }, RESUME_DELAY_MS);
  }, [clearResumeTimer]);

  useEffect(() => clearResumeTimer, [clearResumeTimer]);

  const entries = useMemo<CrawlEntry[]>(
    () => gamesForBannerDate.map((game) => {
      const final = game.status === 'completed';
      const playoff = isPlayoffGame(game);
      return {
        gameId: game.gameId,
        awayTeam: teamLookup.get(game.awayTeam) ?? null,
        homeTeam: teamLookup.get(game.homeTeam) ?? null,
        final,
        playoff,
        awayRuns: final ? game.score.away : null,
        homeRuns: final ? game.score.home : null,
        statusLabel: playoff ? 'Playoff' : final ? 'Final' : 'Scheduled',
      };
    }),
    [gamesForBannerDate, teamLookup],
  );

  const itemCount = entries.length;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const singleCopy = singleCopyRef.current;
    if (!viewport || !singleCopy) {
      return undefined;
    }

    const measure = () => {
      const width = singleCopy.scrollWidth;
      if (width <= 0) {
        return;
      }
      setCopyWidth(width);
      setViewportWidth(viewport.clientWidth);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(singleCopy);
    return () => observer.disconnect();
  }, [entries]);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // The crawl travels exactly half the track, and the visible window at the end
  // of that travel is translate + viewport. So the half-track has to be at least
  // one viewport wide, or the bar shows bare background at the end of every lap.
  //
  // Deriving the count from the full copy width instead only guarantees
  // viewport/itemCount, which left a visible gap on a two- or three-game slate --
  // small slates, which are exactly when a single result is most worth reading.
  // Verified over 1 to 16 items at 360 to 1920px.
  const period = itemCount > 0 && copyWidth > 0 ? copyWidth / itemCount : 0;
  const halfItems = period > 0 && viewportWidth > 0
    ? Math.ceil(Math.max(2, Math.ceil(viewportWidth / period)) / itemCount) * itemCount
    : 0;
  const renderCount = halfItems * 2;
  const travel = halfItems * period;
  const duration = travel > 0
    ? Math.max(MIN_DURATION, Math.min(MAX_DURATION, travel / CRAWL_SPEED))
    : MIN_DURATION;

  const renderItem = useCallback((entry: CrawlEntry, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => onOpenGame(entry.gameId)}
      aria-label={`${entry.awayTeam?.name ?? 'Away'} at ${entry.homeTeam?.name ?? 'Home'}, ${entry.statusLabel}`}
      style={{ marginRight: ITEM_STEP }}
      className="flex shrink-0 items-center gap-2 border border-[var(--color-chrome-lo)] border-l-[3px] border-l-[var(--color-chrome-lo)] bg-[var(--color-panel)] px-2 py-1 transition-colors hover:bg-[var(--color-panel-2)]"
    >
      {entry.awayTeam
        ? <TeamLogo team={entry.awayTeam} sizeClass="h-8 w-8" />
        : <span className="h-6 w-6 shrink-0 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}

      <span className="flex items-center gap-1.5 tabular-nums">
        {entry.final ? (
          <>
            <span className="t-stat-sm">{entry.awayRuns}</span>
            <span className="text-[var(--color-ink-faint)]" aria-hidden="true">–</span>
            <span className="t-stat-sm">{entry.homeRuns}</span>
          </>
        ) : (
          <span className="t-stat-sm text-[var(--color-ink-faint)]">–</span>
        )}
      </span>

      {entry.homeTeam
        ? <TeamLogo team={entry.homeTeam} sizeClass="h-8 w-8" />
        : <span className="h-6 w-6 shrink-0 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}

      <span className={`w-[4ch] shrink-0 text-right t-caption ${entry.playoff ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-faint)]'}`}>
        {entry.playoff ? 'PL' : entry.final ? 'F' : 'SCH'}
      </span>
    </button>
  ), [onOpenGame]);

  if (simulationPerformanceMode) {
    return (
      <div className="px-3 py-3 sm:px-5 lg:px-8">
        <Panel className="border-l-[3px] border-l-[var(--color-warn)] px-4 py-3">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
            <p className="t-label text-[var(--color-warn)]">Simulation Focus Mode</p>
          </div>
          <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
            The score crawl is paused while the calendar sim runs.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-chrome-lo)] bg-[var(--color-base)] px-3 py-1.5 sm:px-5 lg:px-8">
      <div className="hidden shrink-0 items-center gap-2 border-r border-[var(--color-chrome-lo)] pr-4 md:flex">
        <span className="h-2 w-2 bg-[var(--color-platinum)]" aria-hidden="true" />
        <div>
          <p className="t-caption text-[var(--color-ink-faint)]">Yesterday</p>
          <p className="t-stat-sm">{formatHeaderDate(bannerDate || currentTimelineDate)}</p>
        </div>
      </div>

      {itemCount === 0 ? (
        <p className="flex-1 t-caption text-[var(--color-ink-faint)]">
          No games on the previous sim date.
        </p>
      ) : (
        <div
          ref={viewportRef}
          role="region"
          aria-label="Previous date scores"
          onMouseEnter={handlePointerEnter}
          onMouseLeave={handlePointerLeave}
          onFocus={handlePointerEnter}
          onBlur={handlePointerLeave}
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{
            maskImage: 'linear-gradient(90deg, transparent, #000 20px, #000 calc(100% - 20px), transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 20px, #000 calc(100% - 20px), transparent)',
          }}
        >
          {/* Hidden and inert: establishes the single-copy width that both the
              copy count and the duration are derived from, without putting an
              unmeasured duplicate on screen. */}
          <div ref={singleCopyRef} aria-hidden="true" className="pointer-events-none absolute -top-[9999px] left-0 h-0 w-max overflow-hidden opacity-0">
            {entries.map((entry, index) => renderItem(entry, `measure-${index}`))}
          </div>

          <div
            className="flex w-max"
            style={{
              /*
                LONGHAND ONLY, and always every property present.

                `animationPlayState` has to exist to hold the playhead -- removing it, or removing the
                animation, resets the crawl to zero -- so this is not a case of setting one and
                clearing the other. But it CANNOT be written as the `animation` shorthand alongside
                `animationPlayState`, because React treats that as the documented hazard: updating a
                longhand while a shorthand for the same value is being set warns on every single
                hover-pause, and the residue it guards against is a playhead stranded mid-crawl.
                Eight warnings on the Media page before this; the animated crawl in the top strip
                sits above every page, so this was never a Media bug.

                Every value below is present in both states -- 'none' and a zeroed iteration count
                rather than undefined -- so React's managed property list is identical either way and
                there is nothing to leak across a rerender.
              */
              animationName: reducedMotion ? 'none' : 'score-crawl',
              animationDuration: reducedMotion ? '0s' : `${duration}s`,
              animationTimingFunction: 'linear',
              animationIterationCount: reducedMotion ? '1' : 'infinite',
              animationPlayState: reducedMotion ? 'paused' : paused ? 'paused' : 'running',
            }}
          >
            {Array.from({ length: renderCount }, (_, index) => (
              renderItem(entries[index % itemCount], `crawl-${index}`)
            ))}
          </div>
        </div>
      )}

      <span className="hidden shrink-0 t-caption tabular-nums text-[var(--color-ink-faint)] lg:inline">
        {entries.filter((entry) => entry.final).length}/{itemCount} final
      </span>
    </div>
  );
}
