import React, { useEffect, useMemo, useRef } from 'react';
import { Game } from '../types';
import { isPlayoffGame, isRegularSeasonGame } from '../logic/playoffs';

interface SeasonCalendarStripProps {
  games: Game[];
  currentDate: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  title?: string;
  currentDateLabel?: string;
}

const formatDateLabel = (isoDate: string): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const formatHeaderDate = (isoDate: string): string => {
  if (!isoDate) {
    return 'No Date';
  }

  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const SeasonCalendarStrip: React.FC<SeasonCalendarStripProps> = ({
  games,
  currentDate,
  selectedDate,
  onSelectDate,
  title = 'Season Calendar',
  currentDateLabel = 'Current Sim Date',
}) => {
  const uniqueDates = useMemo(
    () => Array.from(new Set(games.map((game) => game.date))).sort((a, b) => a.localeCompare(b)),
    [games],
  );
  const calendarRowRef = useRef<HTMLDivElement | null>(null);
  const dateButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const activeDate = selectedDate || uniqueDates[0] || currentDate;
  const gameCountByDate = useMemo(() => {
    const counts = new Map<string, { scheduled: number; completed: number; playoff: number; regular: number }>();
    games.forEach((game) => {
      const current = counts.get(game.date) ?? { scheduled: 0, completed: 0, playoff: 0, regular: 0 };
      if (game.status === 'completed') {
        current.completed += 1;
      } else {
        current.scheduled += 1;
      }
      if (isPlayoffGame(game)) {
        current.playoff += 1;
      } else {
        current.regular += 1;
      }
      counts.set(game.date, current);
    });
    return counts;
  }, [games]);

  const lastRegularSeasonDate = useMemo(() => {
    const regularDates = games
      .filter((game) => isRegularSeasonGame(game))
      .map((game) => game.date)
      .sort((a, b) => a.localeCompare(b));
    return regularDates[regularDates.length - 1] ?? '';
  }, [games]);

  useEffect(() => {
    const targetDate = currentDate || activeDate;
    if (!targetDate) return;

    const container = calendarRowRef.current;
    const targetButton = dateButtonRefs.current.get(targetDate);
    if (!container || !targetButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = targetButton.getBoundingClientRect();
    const centeredLeft =
      container.scrollLeft + (buttonRect.left - containerRect.left) - (containerRect.width / 2) + (buttonRect.width / 2);

    container.scrollTo({
      left: Math.max(centeredLeft, 0),
      behavior: 'smooth',
    });
  }, [activeDate, currentDate, uniqueDates]);

  return (
    <div className="bg-black/30 border border-white/10 rounded-xl p-3">
      <div className="flex items-center justify-between mb-2 gap-3">
        <h4 className="font-display uppercase tracking-widest text-zinc-300">{title}</h4>
        <span className="font-mono text-xs text-zinc-500">
          {currentDateLabel}: {currentDate || activeDate}
        </span>
      </div>

      <div ref={calendarRowRef} className="flex gap-2 overflow-x-auto pb-2">
        {uniqueDates.map((date) => {
          const dayCounts = gameCountByDate.get(date) ?? { scheduled: 0, completed: 0, playoff: 0, regular: 0 };
          const isActive = date === activeDate;
          const isCurrent = date === currentDate;
          const isPlayoffDate = dayCounts.playoff > 0;

          return (
            <button
              key={date}
              ref={(element) => {
                if (element) {
                  dateButtonRefs.current.set(date, element);
                } else {
                  dateButtonRefs.current.delete(date);
                }
              }}
              onClick={() => onSelectDate(date)}
              className={`min-w-[92px] px-2 py-2 rounded-lg border text-left transition-colors ${
                isActive
                  ? isPlayoffDate
                    ? 'border-zinc-200 bg-zinc-200/12'
                    : 'border-platinum bg-platinum/15'
                  : isCurrent
                    ? isPlayoffDate
                      ? 'border-zinc-300/70 bg-zinc-100/8'
                      : 'border-prestige/70 bg-prestige/10'
                    : isPlayoffDate
                      ? 'border-[#d6d3c4]/20 bg-[#d6d3c4]/8 hover:border-[#d6d3c4]/35'
                      : 'border-white/10 bg-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-xs text-zinc-200">{formatDateLabel(date)}</div>
                {isPlayoffDate && (
                  <span className="font-mono text-[9px] uppercase tracking-wide text-zinc-300">PL</span>
                )}
              </div>
              <div className="font-mono text-[10px] text-zinc-400 mt-1">
                F {dayCounts.completed} | S {dayCounts.scheduled}
              </div>
              {date === lastRegularSeasonDate && (
                <div className="font-mono text-[9px] uppercase tracking-wide text-prestige mt-1">Reg End</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
