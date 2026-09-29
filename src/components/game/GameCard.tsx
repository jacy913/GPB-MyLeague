import React from 'react';
import { getGameWindowStatus, getScheduledGameTimeLabel } from '../../logic/gameTimes';
import { isPlayoffGame } from '../../logic/playoffs';
import type { Game, Team } from '../../types';
import { TeamLogo } from '../ui';
export interface PregameRecord {
  awayWins: number;
  awayLosses: number;
  homeWins: number;
  homeLosses: number;
}

interface GameCardProps {
  game: Game;
  games: Game[];
  currentDate: string;
  awayTeam: Team | null;
  homeTeam: Team | null;
  pregame: PregameRecord;
  getStatNumber: (game: Game, key: string) => number;
  getFallbackHits: (game: Game, side: 'away' | 'home') => number;
  onOpenGame: (gameId: string) => void;
}

/**
 * Schedule game card.
 *
 * The score is the largest thing on the card because that is what the user
 * opens the screen to read; the R/H/E line is tabular underneath it, aligned to
 * the crests so the figures sit under the club they belong to rather than in a
 * detached grid. Winner's figures take the accent, which is the one piece of
 * colour on the card and is therefore not doing any other job.
 *
 * The whole card is a button. It was a div with an onClick, so it was
 * unreachable by keyboard and announced to a screen reader as a plain group.
 */
export const GameCard: React.FC<GameCardProps> = ({
  game,
  games,
  currentDate,
  awayTeam,
  homeTeam,
  pregame,
  getStatNumber,
  getFallbackHits,
  onOpenGame,
}) => {
  const final = game.status === 'completed';
  const playoff = isPlayoffGame(game);
  const windowStatus = getGameWindowStatus(game, games, currentDate);
  const statusLabel = windowStatus === 'final' ? 'Final' : windowStatus === 'live_window' ? 'Live Window' : 'Scheduled';
  const timeLabel = getScheduledGameTimeLabel(game, games);
  const playoffLabel = playoff && game.playoff ? `${game.playoff.seriesLabel} · Game ${game.playoff.gameNumber}` : null;

  const awayRuns = final ? game.score.away : null;
  const homeRuns = final ? game.score.home : null;
  const awayWins = final && awayRuns !== null && homeRuns !== null && awayRuns > homeRuns;
  const homeWins = final && awayRuns !== null && homeRuns !== null && homeRuns > awayRuns;

  // Games recorded before per-team hit totals existed report zero. The caller's
  // fallback supplies a deterministic substitute, so only prefer it when the
  // stored figure is genuinely absent.
  const hits = (side: 'away' | 'home') => {
    if (!final) return 0;
    const stored = getStatNumber(game, `${side}Hits`);
    return stored > 0 ? stored : getFallbackHits(game, side);
  };
  const errors = (side: 'away' | 'home') => (final ? getStatNumber(game, `${side}Errors`) : 0);

  const awayHits = hits('away');
  const homeHits = hits('home');
  const awayErrors = errors('away');
  const homeErrors = errors('home');

  const crest = (team: Team | null, fallbackId: string, align: 'left' | 'right') => (
    team
      ? <TeamLogo team={team} sizeClass="h-14 w-14" />
      : (
        <span
          className="flex h-14 w-14 items-center justify-center border border-dashed border-[var(--color-chrome-lo)] t-caption"
          aria-hidden="true"
        >
          {fallbackId.slice(0, 2)}
        </span>
      )
  );

  const side = (
    team: Team | null,
    fallbackId: string,
    align: 'left' | 'right',
    wins: number,
    losses: number,
    runs: number | null,
    hitsCount: number,
    errorCount: number,
  ) => {
    const alignRight = align === 'right';
    return (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {alignRight ? null : crest(team, fallbackId, align)}
        <div className={`min-w-0 ${alignRight ? 'text-right' : ''}`}>
          <p className={`truncate t-stat ${wins ? 'text-[var(--color-gold-hi)]' : ''}`}>
            {team ? team.city : fallbackId.toUpperCase()}
          </p>
          <p className="truncate t-caption text-[var(--color-ink-dim)]">{team ? team.name : 'Unknown'}</p>
          <p className="t-caption tabular-nums text-[var(--color-ink-faint)]">{wins}-{losses}</p>
        </div>
        {alignRight ? crest(team, fallbackId, align) : null}
        <dl className="ml-auto flex shrink-0 gap-2">
          {([['R', runs], ['H', hitsCount], ['E', errorCount]] as Array<[string, number | null]>).map(([label, value]) => (
            <div key={label} className="text-center">
              <dt className="t-caption text-[var(--color-ink-faint)]">{label}</dt>
              <dd className={`t-stat-sm tabular-nums ${label === 'R' && wins ? 'text-[var(--color-gold)]' : ''}`}>
                {value ?? '–'}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    );
  };

  return (
    <button
      type="button"
      onClick={() => onOpenGame(game.gameId)}
      aria-label={`Open ${awayTeam?.name ?? game.awayTeam} at ${homeTeam?.name ?? game.homeTeam}, ${statusLabel}`}
      className="flex w-full flex-col gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-panel)] p-4 text-left transition-colors hover:border-[var(--color-chrome-hi)] hover:bg-[var(--color-panel-2)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-chrome-lo)] pb-2">
        <div className="flex items-center gap-2">
          <span
            className={`t-caption ${
              windowStatus === 'final'
                ? 'text-[var(--color-pos)]'
                : windowStatus === 'live_window'
                  ? 'text-[var(--color-warn)]'
                  : 'text-[var(--color-ink-faint)]'
            }`}
          >
            {statusLabel}
          </span>
          <span className="t-caption text-[var(--color-ink-faint)]">{timeLabel}</span>
          {playoff && (
            <span className="border border-[var(--color-gold)] px-1 t-caption text-[var(--color-gold)]">PL</span>
          )}
        </div>
        {playoffLabel && <span className="t-caption text-[var(--color-ink-dim)]">{playoffLabel}</span>}
      </div>

      {side(awayTeam, game.awayTeam, 'left', pregame.awayWins, pregame.awayLosses, awayRuns, awayHits, awayErrors)}

      <div className="h-px bg-[var(--color-chrome-lo)]" aria-hidden="true" />

      {side(homeTeam, game.homeTeam, 'right', pregame.homeWins, pregame.homeLosses, homeRuns, homeHits, homeErrors)}
    </button>
  );
};
