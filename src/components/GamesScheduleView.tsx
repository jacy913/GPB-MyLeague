import React, { useCallback, useEffect, useRef } from 'react';
import { CalendarDays, Crosshair, Flag } from 'lucide-react';
import { Game, Team } from '../types';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { Panel, RetroButton } from './ui';
import { GameCard, type PregameRecord } from './game/GameCard';

interface SeasonProgressSummary {
  completedGames: number;
  totalGames: number;
  remainingGames: number;
  progress: number;
}

interface DaySummary {
  total: number;
  completed: number;
  scheduled: number;
  playoff: number;
}

interface GamesScheduleViewProps {
  seasonProgressSummary: SeasonProgressSummary;
  seasonComplete: boolean;
  activeDateHasPlayoffs: boolean;
  currentDate: string;
  activeDate: string;
  allScheduleDates: string[];
  calendarSummaryByDate: Map<string, DaySummary>;
  lastRegularSeasonDate: string;
  gamesForActiveDate: Game[];
  games: Game[];
  teamLookup: Map<string, Team>;
  pregameRecordByGameId: Map<string, PregameRecord>;
  getStatNumber: (game: Game, key: string) => number;
  getFallbackHits: (game: Game, side: 'away' | 'home') => number;
  onSelectDate: (date: string) => void;
  onOpenGame: (gameId: string) => void;
}

const StatTile: React.FC<{ label: string; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className={`t-stat-lg mt-1 truncate ${accent ? 'text-[var(--color-gold)]' : ''}`}>{value}</p>
  </div>
);

/**
 * Score and schedule.
 *
 * Was 424 lines of raw hex and gradient panels, with a hero block whose radial
 * gradients and 40px rounded corners belonged to the pre-token surface. Two
 * halves here: a season header carrying progress, the date rail and the jump
 * controls, then the slate for the selected day.
 *
 * The date rail keeps its own horizontal scroll and its scroll-into-view, which
 * is a genuine interaction rather than decoration: selecting a date anywhere in
 * the app has to bring the rail with it, or the selection is invisible. That
 * logic is unchanged.
 */
export const GamesScheduleView: React.FC<GamesScheduleViewProps> = ({
  seasonProgressSummary,
  seasonComplete,
  activeDateHasPlayoffs,
  currentDate,
  activeDate,
  allScheduleDates,
  calendarSummaryByDate,
  lastRegularSeasonDate,
  gamesForActiveDate,
  games,
  teamLookup,
  pregameRecordByGameId,
  getStatNumber,
  getFallbackHits,
  onSelectDate,
  onOpenGame,
}) => {
  const calendarStripRef = useRef<HTMLDivElement | null>(null);
  const dateButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const scrollCalendarDateIntoView = useCallback((targetDate: string, behavior: ScrollBehavior = 'smooth') => {
    const calendarStrip = calendarStripRef.current;
    const targetButton = dateButtonRefs.current.get(targetDate);
    if (!calendarStrip || !targetButton) {
      return;
    }

    const containerRect = calendarStrip.getBoundingClientRect();
    const buttonRect = targetButton.getBoundingClientRect();
    const centeredLeft =
      calendarStrip.scrollLeft + (buttonRect.left - containerRect.left) - (containerRect.width / 2) + (buttonRect.width / 2);

    calendarStrip.scrollTo({
      left: Math.max(centeredLeft, 0),
      behavior,
    });
  }, []);

  const handleJumpToCurrentDate = useCallback(() => {
    const targetDate = currentDate || activeDate || allScheduleDates[0];
    if (!targetDate) {
      return;
    }

    onSelectDate(targetDate);
    requestAnimationFrame(() => {
      scrollCalendarDateIntoView(targetDate);
    });
  }, [activeDate, allScheduleDates, currentDate, onSelectDate, scrollCalendarDateIntoView]);

  useEffect(() => {
    if (!activeDate) {
      return;
    }

    scrollCalendarDateIntoView(activeDate, 'auto');
  }, [activeDate, scrollCalendarDateIntoView]);

  const progress = Math.max(0, Math.min(100, seasonProgressSummary.progress));
  const phaseLabel = seasonComplete
    ? 'Season complete'
    : activeDateHasPlayoffs
      ? 'Playoff race live'
      : 'Regular season in progress';

  return (
    <div className="space-y-5">
      <Panel variant="hero" className="flex flex-col gap-5 p-4 md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0">
            <p className="t-caption text-[var(--color-ink-faint)]">Season Progress</p>
            <p className="t-h1 mt-1">{Math.round(progress)}% Complete</p>
            <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{phaseLabel}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[520px]">
            <StatTile label="Played" value={seasonProgressSummary.completedGames} />
            <StatTile label="Remaining" value={seasonProgressSummary.remainingGames} />
            <StatTile label="Season Scope" value={seasonProgressSummary.totalGames} />
            <StatTile label="Sim Date" value={formatHeaderDate(currentDate || activeDate)} accent />
          </div>
        </div>

        <div>
          <div
            className="h-2.5 w-full border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Season completion"
          >
            <div
              className="h-full bg-[var(--color-gold)] transition-[width] duration-500 ease-[var(--ease-snap)]"
              style={{ width: `${Math.max(1, progress)}%` }}
            />
          </div>
          <p className="t-caption mt-1 tabular-nums text-[var(--color-ink-faint)]">
            {seasonProgressSummary.completedGames} of {seasonProgressSummary.totalGames} games played
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--color-chrome-lo)] pt-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="t-h2">Season Calendar</h2>
            <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
              Select a day to change the scoreboard slate
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <StatTile label="Selected Slate" value={formatHeaderDate(activeDate)} accent />
            <RetroButton
              variant="primary"
              onClick={handleJumpToCurrentDate}
              disabled={!currentDate}
              className="flex-col items-start gap-1"
            >
              <span className="t-caption">
                <Crosshair className="mr-1 inline h-3 w-3" aria-hidden="true" />
                Jump to Current
              </span>
              <span className="t-stat">{currentDate ? formatHeaderDate(currentDate) : 'Unavailable'}</span>
            </RetroButton>
            <label className="flex flex-col gap-1 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
              <span className="t-caption text-[var(--color-ink-faint)]">
                <CalendarDays className="mr-1 inline h-3 w-3" aria-hidden="true" />
                Jump To Date
              </span>
              <input
                type="date"
                value={activeDate}
                min={allScheduleDates[0]}
                max={allScheduleDates[allScheduleDates.length - 1]}
                onChange={(event) => onSelectDate(event.target.value)}
                className="t-stat-sm text-[var(--color-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
              />
            </label>
          </div>
        </div>

        <div ref={calendarStripRef} className="overflow-x-auto pb-1">
          <div className="flex w-max gap-2">
            {allScheduleDates.map((date) => {
              const daySummary = calendarSummaryByDate.get(date) ?? { total: 0, completed: 0, scheduled: 0, playoff: 0 };
              const isSelected = date === activeDate;
              const isCurrent = date === currentDate;
              const isPlayoffDate = daySummary.playoff > 0;
              const isFinale = date === lastRegularSeasonDate;

              // Edge carries slate type, fill carries selection, pip carries
              // "today". Three different meanings, three different channels, so
              // none of them is the only signal for its own state.
              const edge = isPlayoffDate
                ? 'border-l-[var(--color-gold)]'
                : isCurrent
                  ? 'border-l-[var(--color-platinum)]'
                  : 'border-l-transparent';
              const fill = isSelected
                ? 'bg-[var(--color-panel-3)]'
                : 'bg-[var(--color-sunken)]';

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
                  type="button"
                  onClick={() => onSelectDate(date)}
                  aria-current={isSelected ? 'date' : undefined}
                  aria-label={`${formatHeaderDate(date)}, ${daySummary.total} games, ${daySummary.completed} final`}
                  className={`w-[168px] shrink-0 border border-[var(--color-chrome-lo)] border-l-[3px] ${edge} ${fill} px-3 py-2 text-left transition-colors ${
                    isSelected ? 'border-[var(--color-gold-hi)]' : 'hover:border-[var(--color-chrome-hi)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`t-stat ${isSelected ? 'text-[var(--color-gold)]' : ''}`}>
                      {new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    {isPlayoffDate ? (
                      <span className="t-caption text-[var(--color-gold)]">PL</span>
                    ) : isCurrent ? (
                      <span className="t-caption text-[var(--color-platinum)]">TODAY</span>
                    ) : null}
                  </div>

                  <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
                    {isPlayoffDate ? 'Playoff slate' : isFinale ? 'Reg. finale' : 'Regular season'}
                  </p>
                  <p className="t-caption mt-1 tabular-nums text-[var(--color-ink-dim)]">
                    {daySummary.total} {daySummary.total === 1 ? 'game' : 'games'} · {daySummary.completed} final
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <Flag className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            <h2 className="t-h3">Game Schedule</h2>
          </div>
          <div className="flex items-center gap-2">
            {activeDateHasPlayoffs && (
              <span className="border border-[var(--color-gold)] px-2 py-0.5 t-caption text-[var(--color-gold)]">
                Playoff Window
              </span>
            )}
            <span className="t-stat-sm tabular-nums text-[var(--color-ink-dim)]">
              {formatHeaderDate(activeDate)} · {gamesForActiveDate.length} {gamesForActiveDate.length === 1 ? 'game' : 'games'}
            </span>
          </div>
        </div>

        <div className="grid gap-3 p-4 xl:grid-cols-2">
          {gamesForActiveDate.length === 0 ? (
            <p className="t-body text-[var(--color-ink-faint)] xl:col-span-2">
              No games scheduled for this date.
            </p>
          ) : (
            gamesForActiveDate.map((game) => (
              <GameCard
                key={game.gameId}
                game={game}
                games={games}
                currentDate={currentDate}
                awayTeam={teamLookup.get(game.awayTeam) ?? null}
                homeTeam={teamLookup.get(game.homeTeam) ?? null}
                pregame={pregameRecordByGameId.get(game.gameId) ?? {
                  awayWins: 0, awayLosses: 0, homeWins: 0, homeLosses: 0,
                }}
                getStatNumber={getStatNumber}
                getFallbackHits={getFallbackHits}
                onOpenGame={onOpenGame}
              />
            ))
          )}
        </div>
      </Panel>
    </div>
  );
};
