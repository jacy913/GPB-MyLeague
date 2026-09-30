import React, { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { MediaId, MediaProfile } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import type { MediaDisagreement, MediaRead } from '../../lib/mediaReads';
import { Panel, StatTable, TeamLogo, type StatTableColumn, type StatTableRow } from '../ui';
import { MEDIA_MARKS_SQUARE } from './mediaImages';

/** Proportional bar for a 0-100 index. Reads the same value it prints. */
const IndexBar: React.FC<{ value: number; accent: string }> = ({ value, accent }) => (
  <span className="flex items-center gap-2">
    <span className="h-2 w-16 shrink-0 bg-[var(--color-sunken)]">
      <span
        className="block h-full"
        style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: `var(--color-media-${accent})` }}
      />
    </span>
    <span className="t-stat tabular-nums">{value}</span>
  </span>
);

/**
 * One forecaster's ranking of all thirty-two clubs.
 *
 * Sorted by that forecaster's own index rather than by the league table's order,
 * because the point of the view is where this outlet disagrees with the
 * consensus, and that is invisible if the rows are pre-sorted to agreement.
 */
export const MediaRanking: React.FC<{
  read: MediaRead;
  profile: MediaProfile;
}> = ({ read, profile }) => {
  const [sortKey, setSortKey] = useState<'index' | 'record'>('index');

  const columns = useMemo<StatTableColumn[]>(() => [
    { key: 'rank', header: '#', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'team', header: 'CLUB' },
    { key: 'index', header: 'INDEX', align: 'right', isNumeric: true, width: '16ch' },
    { key: 'record', header: 'RECORD', align: 'right', isNumeric: true, width: '8ch' },
  ], []);

  const rows = useMemo<StatTableRow[]>(() => {
    const ordered = [...read.rows].sort((a, b) => (
      sortKey === 'index'
        ? a.rank - b.rank
        : (b.team.wins + b.team.losses) - (a.team.wins + a.team.losses) || a.rank - b.rank
    ));
    return ordered.map((row) => ({
      id: row.team.id,
      cells: {
        rank: <span className="t-stat-sm tabular-nums">{row.rank}</span>,
        team: (
          <span className="flex min-w-0 items-center gap-2">
            <TeamLogo team={row.team} sizeClass="h-8 w-8" />
            <span className="truncate t-stat">
              {row.team.city} <span className="text-[var(--color-ink-dim)]">{row.team.name}</span>
            </span>
          </span>
        ),
        index: <IndexBar value={row.index} accent={profile.accent} />,
        record: <span className="t-stat-sm tabular-nums">{row.team.wins}-{row.team.losses}</span>,
      },
    }));
  }, [profile.accent, read.rows, sortKey]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="t-caption text-[var(--color-ink-faint)]">
          Ranked by this outlet's own index, not by league standing.
        </p>
        <button
          type="button"
          onClick={() => setSortKey((current) => (current === 'index' ? 'record' : 'index'))}
          className="inline-flex items-center gap-1.5 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-1 t-caption text-[var(--color-ink-dim)] transition-colors hover:border-[var(--color-chrome-hi)] hover:text-[var(--color-ink)]"
        >
          {sortKey === 'index' ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
          {sortKey === 'index' ? 'By index' : 'By record'}
        </button>
      </div>

      <StatTable
        columns={columns}
        rows={rows}
        density="default"
        aria-label={`${profile.outlet} club ranking`}
      />
    </div>
  );
};

/**
 * Where the three disagree.
 *
 * The most useful table on the page and the reason the three reads are kept
 * independent. A club the forecasters rank 3rd, 4th and 22nd is the row worth
 * reading, because that is where a published line would be most wrong -- and it
 * is the same spread that will make a betting line interesting later.
 *
 * "Outlier" is who sits furthest from the middle of the three, not simply the
 * most extreme: an outlet that is consistently high is not an outlier when all
 * three are.
 */
export const MediaDisagreementTable: React.FC<{ rows: MediaDisagreement[] }> = ({ rows }) => {
  const [sortKey, setSortKey] = useState<string>('spread');

  const columns = useMemo<StatTableColumn[]>(() => [
    { key: 'team', header: 'CLUB' },
    ...MEDIA_PROFILES.map((profile) => ({
      // Header is the outlet's mark, not its name. The name lives in the title
      // attribute and the card above; a nine-character word does not fit a 72px
      // column, and a logo identifies an outlet faster than an abbreviation
      // does once you know them.
      key: profile.id,
      header: '',
      headerNode: (
        <img
          src={MEDIA_MARKS_SQUARE[profile.id]}
          alt=""
          aria-hidden="true"
          className="mx-auto h-7 w-7 object-contain"
        />
      ),
      headerTitle: profile.outlet,
      align: 'right' as const,
      isNumeric: true,
      width: '7ch',
      sortKey: profile.id,
    })),
    { key: 'spread', header: 'SPREAD', align: 'right' as const, isNumeric: true, width: '7ch', sortKey: 'spread' },
  ], []);

  const ordered = useMemo(() => {
    const direction = sortKey === 'spread' ? -1 : 1;
    const key = sortKey;
    return [...rows].sort((a, b) => {
      if (key === 'spread') return (a.indexSpread - b.indexSpread) * direction;
      if (key === 'team') return a.team.city.localeCompare(b.team.city);
      const left = a.reads[key as MediaId]?.index ?? 0;
      const right = b.reads[key as MediaId]?.index ?? 0;
      return (left - right) * direction;
    });
  }, [rows, sortKey]);

  const tableRows = useMemo<StatTableRow[]>(() => ordered.map((entry) => ({
    id: entry.team.id,
    highlight: entry.indexSpread >= 60,
    cells: {
      team: (
        <span className="flex min-w-0 items-center gap-2">
          <TeamLogo team={entry.team} sizeClass="h-8 w-8" />
          <span className="truncate t-stat">
            {entry.team.city} <span className="text-[var(--color-ink-dim)]">{entry.team.name}</span>
          </span>
        </span>
      ),
      ...Object.fromEntries(MEDIA_PROFILES.map((profile) => {
        const read = entry.reads[profile.id];
        const isOutlier = entry.outlier === profile.id;
        return [profile.id, (
          <span
            className="t-stat-sm tabular-nums"
            style={{ color: isOutlier ? `var(--color-media-${profile.accent}-hi)` : undefined }}
            title={isOutlier ? `${profile.outlet}: furthest from the middle of the three` : undefined}
          >
            {read ? `#${read.rank}` : '--'}
          </span>
        )];
      })),
      spread: (
        <span className="t-stat tabular-nums" style={{ color: entry.indexSpread >= 60 ? 'var(--color-warn)' : undefined }}>
          {entry.indexSpread}
        </span>
      ),
    },
  })), [ordered]);

  return (
    <div>
      <p className="t-caption mb-2 text-[var(--color-ink-faint)]">
        Click an outlet to sort by where it ranks the club, or by how far it sits from the other two.
        The widest rows are the clubs the three cannot agree on.
      </p>
      <StatTable
        columns={columns}
        rows={tableRows}
        density="default"
        sortColumn={sortKey}
        onSort={setSortKey}
        aria-label="Forecaster disagreement by club"
      />
    </div>
  );
};

