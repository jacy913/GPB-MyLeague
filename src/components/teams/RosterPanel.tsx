import React from 'react';
import { UserRound, Users } from 'lucide-react';
import type { Team } from '../../types';
import { RESERVE_ROSTER_SLOTS, TEAM_ACTIVE_ROSTER_SIZE } from '../../types';
import type { LeagueBaseline } from '../../lib/analytics/wrcPlus';
import { Panel, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from '../ui';
import { PlayerCard } from './PlayerCard';
import {
  ClubPanel,
  EMPTY,
  formatRosterSlotLabel,
  overallVariant,
  type TeamRosterEntry,
} from './shared';

export const RosterPanel: React.FC<{
  team: Team;
  entries: TeamRosterEntry[];
  bySlotCount: number;
  backups: TeamRosterEntry[];
  backupBatters: number;
  backupPitchers: number;
  activeRosterSeasonYear: number | null;
  selected: TeamRosterEntry | null;
  selectedOverall: number | null;
  attributePoints: Array<{ label: string; value: number }>;
  /**
   * League-relative run value baseline. Passed down rather than derived here,
   * because a league average has to come from the whole league's batting rows and
   * this panel only holds one club's roster. TeamsHub builds it from the same
   * preferred-stat map the entry rows come from.
   */
  leagueBaseline: LeagueBaseline | null;
  onSelectPlayer: (playerId: string) => void;
}> = ({
  team, entries, bySlotCount, backups, backupBatters, backupPitchers,
  activeRosterSeasonYear, selected, selectedOverall, attributePoints, leagueBaseline, onSelectPlayer,
}) => {
  const columns: StatTableColumn[] = [
    { key: 'slot', header: 'SLOT', align: 'right', isNumeric: true, width: '8ch' },
    { key: 'name', header: 'PLAYER' },
    { key: 'pos', header: 'POS', align: 'right', isNumeric: true, width: '6ch' },
    { key: 'age', header: 'AGE', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'pot', header: 'POT', align: 'right', isNumeric: true, width: '4ch' },
  ];

  const rows: StatTableRow[] = entries.map((entry) => ({
    id: entry.player.playerId,
    cells: {
      slot: formatRosterSlotLabel(entry.slotCode),
      // No crest on each row. This list is every player at one club, so the crest
      // was the same thirty times over and cost 32px of width on the only column
      // that varies. The club is in the header; the card beside the list already
      // carries the mark.
      name: (
        <span className="truncate t-stat">{entry.player.firstName} {entry.player.lastName}</span>
      ),
      pos: (
        <span className="truncate t-stat-sm text-[var(--color-ink-dim)]">
          {entry.player.primaryPosition}
          {entry.player.secondaryPosition ? ` / ${entry.player.secondaryPosition}` : ''}
        </span>
      ),
      age: entry.player.age,
      // OVR is the number a manager sorts this list by, so it is the one figure
      // in the row that is set larger than everything beside it.
      ovr: <StatValue variant={overallVariant(entry.overall || null)}>{entry.overall || EMPTY}</StatValue>,
      pot: <StatValue size="sm" variant="default">{entry.potentialOverall || EMPTY}</StatValue>,
    },
  }));

  return (
    <ClubPanel
      title="Roster"
      aside={
        <span className="t-caption text-[var(--color-ink-faint)]">
          {bySlotCount}/{TEAM_ACTIVE_ROSTER_SIZE} assigned · {backups.length}/{RESERVE_ROSTER_SLOTS.length} backups
          {activeRosterSeasonYear !== null ? ` · ${activeRosterSeasonYear}` : ''}
        </span>
      }
      bodyClassName="p-0"
    >
      <div className="grid gap-0 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]">
        <aside className="flex flex-col border-b border-[var(--color-chrome-lo)] p-4 xl:border-b-0 xl:border-r">
          <PlayerCard
            player={selected?.player ?? null}
            team={team}
            overall={selectedOverall}
            attributePoints={attributePoints}
            battingStat={selected?.battingStat ?? null}
            pitchingStat={selected?.pitchingStat ?? null}
            leagueBaseline={leagueBaseline}
            title={selected ? `${selected.player.firstName} ${selected.player.lastName}` : 'Roster Pending'}
            subline={selected
              ? `${formatRosterSlotLabel(selected.slotCode)} · ${selected.player.primaryPosition}${selected.player.secondaryPosition ? ` / ${selected.player.secondaryPosition}` : ''} · ${selected.player.status.replace('_', ' ')}`
              : 'No rostered players loaded yet.'}
            emptyAttributes="No ratings loaded for this player yet."
          />
        </aside>

        <div className="flex flex-col gap-3 p-4">
          <Panel variant="sunken" className="p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="t-label text-[var(--color-ink-dim)]">Bench Unit</p>
              <p className="t-caption text-[var(--color-ink-faint)]">
                {backupBatters} batters · {backupPitchers} pitchers
              </p>
            </div>
            {backups.length === 0 ? (
              <p className="t-caption mt-2 text-[var(--color-ink-faint)]">No backup players assigned yet.</p>
            ) : (
              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                {backups.map((entry) => (
                  <button
                    key={`bench-${entry.player.playerId}`}
                    type="button"
                    onClick={() => onSelectPlayer(entry.player.playerId)}
                    className="flex items-center gap-2 border-l-[3px] border-l-transparent bg-[var(--color-base-2)] px-2 py-1 text-left transition-colors hover:border-l-[var(--color-gold)]"
                  >
                    <span className="w-[7ch] shrink-0 t-caption text-[var(--color-ink-faint)]">
                      {formatRosterSlotLabel(entry.slotCode)}
                    </span>
                    <span className="truncate t-stat-sm">{entry.player.lastName}</span>
                    <span className="ml-auto">
                      <StatValue size="sm" variant={overallVariant(entry.overall || null)}>{entry.overall || EMPTY}</StatValue>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <div className="flex items-center justify-between gap-3">
            <p className="t-label flex items-center gap-2 text-[var(--color-ink-dim)]">
              <Users className="h-4 w-4" aria-hidden="true" /> Player List
            </p>
            <span className="t-caption text-[var(--color-ink-faint)]">{entries.length} TOTAL</span>
          </div>

          {rows.length === 0 ? (
            <Panel variant="sunken" className="flex flex-col items-center gap-2 p-8 text-center">
              <UserRound className="h-6 w-6 text-[var(--color-ink-faint)]" aria-hidden="true" />
              <p className="t-h3 text-[var(--color-ink)]">No Players Loaded</p>
              <p className="t-caption text-[var(--color-ink-faint)]">
                Generate or assign players to populate this club roster.
              </p>
            </Panel>
          ) : (
            <StatTable
              columns={columns}
              rows={rows}
              density="default"
              onRowSelect={(id) => onSelectPlayer(String(id))}
              selectedRowId={selected?.player.playerId ?? null}
              aria-label="Roster player list"
              className="max-h-[720px] overflow-y-auto"
            />
          )}
        </div>
      </div>
    </ClubPanel>
  );
};
