import React, { useMemo } from 'react';
import { ArrowRight, Users } from 'lucide-react';
import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import type { GameLine } from '../../lib/mediaOdds';
import { formatAmerican, HOUSE_MARGIN } from '../../lib/mediaOdds';
import { MEDIA_MARKS_SQUARE } from './mediaImages';
import { Panel, TeamLogo } from '../ui';

/**
 * Published prices for the next slate.
 *
 * One row per game, the three outlet prices across it and the house line called
 * out separately. The disagreement figure is the point of the panel: a game the
 * three outlets agree on is one where the line carries no information, and a
 * game they split on is where the information is.
 *
 * The house line is the mean of the three probabilities and not the mean of the
 * three prices. Prices are not linear in probability, so an arithmetic mean of
 * American odds is not the consensus of anything.
 */
export const MediaOddsSlate: React.FC<{
  lines: GameLine[];
  slateDate: string | null;
}> = ({ lines, slateDate }) => {
  const totalGames = lines.length;

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-h3">Published Lines</h2>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {slateDate ? `${slateDate} · ${totalGames} ${totalGames === 1 ? 'game' : 'games'}` : 'No slate ahead'}
        </span>
      </div>

      {lines.length === 0 ? (
        <p className="p-6 t-body text-[var(--color-ink-dim)]">
          {slateDate
            ? 'No games are scheduled on that date.'
            : 'No further games are scheduled this season.'}
        </p>
      ) : (
        <div className="grid gap-2 p-3">
          {/* Header, once, so the outlet columns line up with the rows below. */}
          <div className="hidden grid-cols-[minmax(0,1fr)_repeat(3,72px)_minmax(120px,0.9fr)] items-center gap-2 border-b border-[var(--color-chrome-lo)] pb-2 lg:grid">
            <span className="t-caption text-[var(--color-ink-faint)]">GAME</span>
            {MEDIA_PROFILES.map((profile) => (
              <img
                key={profile.id}
                src={MEDIA_MARKS_SQUARE[profile.id]}
                alt={profile.outlet}
                title={profile.outlet}
                className="mx-auto h-7 w-7 object-contain"
              />
            ))}
            <span className="t-caption text-right text-[var(--color-ink-faint)]">HOUSE</span>
          </div>

          {lines.map((line) => (
            <GameOddsRow key={line.gameId} line={line} />
          ))}

          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
            Prices are for the away club. The house line is the mean of the three probabilities with a{' '}
            {Math.round(HOUSE_MARGIN * 100)}% margin applied, then converted back to a price.
            Disagreement is the widest gap between any two outlets on the same game.
          </p>
        </div>
      )}
    </Panel>
  );
};

const GameOddsRow: React.FC<{ line: GameLine }> = ({ line }) => {
  const awayWins = line.consensusProbability >= 0.5;
  const split = line.disagreement >= 0.12;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 lg:grid-cols-[minmax(0,1fr)_repeat(3,72px)_minmax(120px,0.9fr)] lg:gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <TeamLogo team={line.awayTeam} sizeClass="h-8 w-8" />
        <span className="truncate t-stat-sm">{line.awayTeam.city}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />
        <TeamLogo team={line.homeTeam} sizeClass="h-8 w-8" />
        <span className="truncate t-stat-sm">{line.homeTeam.city}</span>
      </div>

      {/* Outlet prices. The one furthest from the other two is tinted, which is
          the whole diagnostic value of the row. */}
      {MEDIA_PROFILES.map((profile) => {
        const isOutlier = line.outlier === profile.id;
        return (
          <span
            key={profile.id}
            className="hidden items-center justify-center gap-1.5 lg:flex"
            title={`${profile.outlet} · ${Math.round(line.probability[profile.id] * 100)}%`}
          >
            <span
              className="t-stat tabular-nums"
              style={{ color: isOutlier ? `var(--color-media-${profile.accent}-hi)` : undefined }}
            >
              {formatAmerican(line.odds[profile.id])}
            </span>
            {isOutlier && <span className="h-1.5 w-1.5" style={{ background: `var(--color-media-${profile.accent})` }} aria-hidden="true" />}
          </span>
        );
      })}

      <div className="flex items-center justify-end gap-2">
        <span
          className="t-stat-lg tabular-nums"
          style={{ color: split ? 'var(--color-warn)' : 'var(--color-gold-hi)' }}
        >
          {formatAmerican(line.houseOdds)}
        </span>
        <span className="w-[6ch] text-right t-caption tabular-nums text-[var(--color-ink-faint)]">
          {Math.round(line.disagreement * 100)}pt
        </span>
      </div>

      {/* Mobile gets the three prices inline, since the header row is hidden. */}
      <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-[var(--color-chrome-lo)] pt-2 lg:hidden">
        {MEDIA_PROFILES.map((profile) => (
          <span key={profile.id} className="flex items-center gap-1">
            <img
              src={MEDIA_MARKS_SQUARE[profile.id]}
              alt=""
              aria-hidden="true"
              className="h-4 w-4 object-contain"
            />
            <span className="t-stat-sm tabular-nums">{formatAmerican(line.odds[profile.id])}</span>
          </span>
        ))}
        <span className="t-caption text-[var(--color-ink-faint)]">
          house {formatAmerican(line.houseOdds)} · {awayWins ? 'away favoured' : 'home favoured'}
        </span>
      </div>
    </div>
  );
};

/** Shared helper so the header and the rows cannot disagree about column count. */
export const OUTLET_COUNT = MEDIA_PROFILES.length;
export const outletIds = (): MediaId[] => MEDIA_PROFILES.map((profile) => profile.id);

export const useDisagreementSummary = (lines: GameLine[]) => useMemo(() => {
  if (lines.length === 0) return null;
  const mean = lines.reduce((sum, line) => sum + line.disagreement, 0) / lines.length;
  const widest = [...lines].sort((a, b) => b.disagreement - a.disagreement)[0];
  return { mean, widest };
}, [lines]);
