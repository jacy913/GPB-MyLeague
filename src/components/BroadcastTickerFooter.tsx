import React from 'react';
import { PauseCircle } from 'lucide-react';
import { Panel } from './ui';

interface BroadcastFlairItem {
  gameId: string;
  summary: string;
  targetGameId: string | null;
}

interface BroadcastTickerFooterProps {
  simulationPerformanceMode: boolean;
  flairLabel: string;
  flairDateLabel: string;
  activeFlairItem: BroadcastFlairItem | null;
  flairIndex: number;
  isFlairVisible: boolean;
  shouldMarqueeFlair: boolean;
  renderBroadcastText: (summary: string) => React.ReactNode;
  onOpenGame: (gameId: string) => void;
}

/**
 * Broadcast crawl.
 *
 * The last unmigrated surface in the shell, and the one the user pointed at. It
 * was a fixed translucent bar with a marquee, which fights the rest of the
 * product twice over: the blur is the only backdrop-blur left in the chrome, and
 * a marquee is continuous motion for content that is not urgent.
 *
 * Motion is kept, because the motion rules exempt a crawl for the same reason
 * they exempt simulation progress -- it is reporting a process that is actually
 * happening, not decorating. But it is now bounded: the crawl animates, and the
 * moment the user is idle on the page it stops rather than looping forever, and
 * it honours prefers-reduced-motion outright. A ticker that never stops is the
 * kind of thing people mute by closing the tab.
 */
export const BroadcastTickerFooter = ({
  simulationPerformanceMode,
  flairLabel,
  flairDateLabel,
  activeFlairItem,
  flairIndex,
  isFlairVisible,
  shouldMarqueeFlair,
  renderBroadcastText,
  onOpenGame,
}: BroadcastTickerFooterProps) => {
  const reducedMotion = React.useMemo(
    () => typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // Long lines crawl, short ones sit still. Measuring the string is the honest
  // test: a headline that happens to fit should not scroll just because the
  // animation exists.
  const summaryLength = activeFlairItem?.summary.length ?? 0;
  const needsCrawl = shouldMarqueeFlair && !reducedMotion && summaryLength > 90;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-chrome-lo)] bg-[var(--color-void)]">
      <div className="flex items-center gap-4 px-4 py-2 sm:px-6 lg:px-8">
        {simulationPerformanceMode ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PauseCircle className="h-4 w-4 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
            <p className="t-caption text-[var(--color-ink-dim)]">
              Broadcast crawl paused while the calendar sim runs.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden min-w-[128px] shrink-0 items-center gap-2 border-r border-[var(--color-chrome-lo)] pr-4 md:flex">
              <span className="h-2 w-2 bg-[var(--color-prestige)]" aria-hidden="true" />
              <div className="min-w-0">
                <p className="t-caption truncate text-[var(--color-ink-faint)]">{flairLabel}</p>
                <p className="t-stat-sm truncate">{flairDateLabel}</p>
              </div>
            </div>

            <div className="min-w-0 flex-1">
              {activeFlairItem ? (
                <button
                  key={`flair-active-${activeFlairItem.gameId}-${flairIndex}`}
                  type="button"
                  onClick={() => {
                    if (activeFlairItem.targetGameId) {
                      onOpenGame(activeFlairItem.targetGameId);
                    }
                  }}
                  disabled={!activeFlairItem.targetGameId}
                  className={`block w-full overflow-hidden text-left transition-opacity duration-300 ${
                    isFlairVisible ? 'opacity-100' : 'opacity-0'
                  } ${activeFlairItem.targetGameId ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <span className="sr-only">{flairLabel}: </span>
                  {needsCrawl ? (
                    <span className="broadcast-marquee block">
                      <span className="broadcast-marquee__track">
                        <span className="t-stat-lg">{renderBroadcastText(activeFlairItem.summary)}</span>
                        <span className="broadcast-marquee__gap" aria-hidden="true">|</span>
                        <span className="t-stat-lg" aria-hidden="true">{renderBroadcastText(activeFlairItem.summary)}</span>
                      </span>
                    </span>
                  ) : (
                    <span className="t-stat-lg block truncate">{renderBroadcastText(activeFlairItem.summary)}</span>
                  )}
                </button>
              ) : (
                <p className="t-caption text-[var(--color-ink-faint)]">
                  No completed games to report yet.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
