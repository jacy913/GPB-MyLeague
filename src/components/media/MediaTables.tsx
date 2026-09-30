import React, { useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import type { MediaProfile } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import type { MediaDisagreement, MediaRead } from '../../lib/mediaReads';
import { Panel, StatTable, TeamLogo, type StatTableColumn, type StatTableRow } from '../ui';

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
  const columns = useMemo<StatTableColumn[]>(() => [
    { key: 'team', header: 'CLUB' },
    ...MEDIA_PROFILES.map((profile) => ({
      key: profile.id,
      header: profile.outlet.toUpperCase(),
      align: 'right' as const,
      isNumeric: true,
      width: '6ch',
    })),
    { key: 'spread', header: 'SPREAD', align: 'right' as const, isNumeric: true, width: '7ch' },
  ], []);

  const tableRows = useMemo<StatTableRow[]>(() => rows.map((entry) => ({
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
            title={isOutlier ? 'Furthest from the middle of the three' : undefined}
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
  })), [rows]);

  return (
    <div>
      <p className="t-caption mb-2 text-[var(--color-ink-faint)]">
        Spread is the widest index gap between any two forecasters. The widest rows are the
        clubs they cannot agree on.
      </p>
      <StatTable
        columns={columns}
        rows={tableRows}
        density="default"
        aria-label="Forecaster disagreement by club"
      />
    </div>
  );
};

/** Page wrapper for the two data surfaces. */
export const MediaDataPanels: React.FC<{
  read: MediaRead;
  profile: MediaProfile;
  disagreements: MediaDisagreement[];
}> = ({ read, profile, disagreements }) => (
  <>
    <Panel>
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <h2 className="t-h3" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
          {profile.outlet} Club Ranking
        </h2>
        <span className="t-caption text-[var(--color-ink-faint)]">{read.rows.length} clubs</span>
      </div>
      <div className="p-2">
        <MediaRanking read={read} profile={profile} />
      </div>
    </Panel>

    <Panel>
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <h2 className="t-h3">Where They Disagree</h2>
        <span className="t-caption text-[var(--color-ink-faint)]">All three forecasters</span>
      </div>
      <div className="p-2">
        <MediaDisagreementTable rows={disagreements} />
      </div>
    </Panel>
  </>
);
