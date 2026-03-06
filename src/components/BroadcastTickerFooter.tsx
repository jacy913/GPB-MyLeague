import React from 'react';

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
}: BroadcastTickerFooterProps) => (
  <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0f0f0f]/95 backdrop-blur">
    <div className="flex items-center gap-4 px-4 sm:px-6 lg:px-8 py-3">
      {simulationPerformanceMode ? (
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#d8c88b]">Simulation active</p>
          <p className="mt-1 text-sm text-zinc-300">
            The calendar is updating day by day. Broadcast crawl is paused until the run stops.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden md:flex min-w-[132px] items-center gap-3 border-r border-white/10 pr-4">
            <div className="h-2 w-2 rounded-full bg-prestige" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{flairLabel}</p>
              <p className="font-mono text-xs text-zinc-200">{flairDateLabel}</p>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            {activeFlairItem ? (
              <button
                key={`flair-active-${activeFlairItem.gameId}-${flairIndex}`}
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
                {shouldMarqueeFlair ? (
                  <div className="broadcast-marquee">
                    <div className="broadcast-marquee__track">
                      <span className="text-base md:text-lg text-zinc-100">{renderBroadcastText(activeFlairItem.summary)}</span>
                      <span className="broadcast-marquee__gap" aria-hidden="true">|</span>
                      <span className="text-base md:text-lg text-zinc-100" aria-hidden="true">{renderBroadcastText(activeFlairItem.summary)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-base md:text-lg text-zinc-100 truncate">{renderBroadcastText(activeFlairItem.summary)}</p>
                )}
              </button>
            ) : (
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                No completed games to report yet.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  </div>
);
