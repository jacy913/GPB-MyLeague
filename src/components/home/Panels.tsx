import React from 'react';
import { ArrowRightLeft, Users, X } from 'lucide-react';
import type { Player, Team } from '../../types';
import { Panel, RetroButton, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from '../ui';
import { DivisionSnapshot as DivisionSnapshotType, HomePanel, Milestone, formatHeadlineDate, recordOf, winPctOf } from './shared';

/**
 * Season cycle.
 *
 * Was seven cards of equal weight, so the current point in the season did not
 * stand out from opening day or the draft. Now the live milestone carries a
 * gold edge and a raised date, and everything past or future sits back.
 */
export const MilestoneTimeline: React.FC<{
  milestones: Milestone[];
  timelineDate: string;
  nextMilestone: Milestone | null;
  isSimulating: boolean;
  onOpenSimulation: (date: string) => void;
}> = ({ milestones, timelineDate, nextMilestone, isSimulating, onOpenSimulation }) => (
  <HomePanel
    title="Season Cycle"
    aside={
      <div className="flex flex-wrap items-center gap-2">
        <span className="t-caption text-[var(--color-ink-faint)]">
          {timelineDate ? formatHeadlineDate(timelineDate) : 'TBD'}
        </span>
        <RetroButton
          variant="primary"
          size="sm"
          onClick={() => nextMilestone && onOpenSimulation(nextMilestone.date)}
          disabled={isSimulating || !nextMilestone}
        >
          Open Next Event
        </RetroButton>
      </div>
    }
  >
    <ol className="grid gap-2 md:grid-cols-4 xl:grid-cols-7">
      {milestones.map((milestone) => {
        const isCurrent = milestone.date === timelineDate;
        const isPast = milestone.date < timelineDate;
        return (
          <li
            key={milestone.key}
            aria-current={isCurrent ? 'step' : undefined}
            className={`border-l-[3px] px-3 py-2 ${
              isCurrent
                ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]'
                : isPast
                  ? 'border-l-[var(--color-chrome-lo)] opacity-60'
                  : 'border-l-transparent bg-[var(--color-sunken)]'
            }`}
          >
            <p className="t-caption text-[var(--color-ink-faint)]">{milestone.phase}</p>
            <p className="t-stat-sm mt-1 truncate">{milestone.label}</p>
            <p className={`t-caption mt-1 ${isCurrent ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-dim)]'}`}>
              {formatHeadlineDate(milestone.date)}
            </p>
          </li>
        );
      })}
    </ol>
  </HomePanel>
);

const ActionTile: React.FC<{ title: string; subtitle: string; value?: string; onClick: () => void }> = ({
  title,
  subtitle,
  value,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="border-l-[3px] border-l-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-3 text-left transition-colors hover:border-l-[var(--color-gold)]"
  >
    <p className="t-stat-sm">{title}</p>
    <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{subtitle}</p>
    {value && <p className="t-caption mt-2 text-[var(--color-ink-faint)]">{value}</p>}
  </button>
);

export const ActionCenter: React.FC<{
  onProposeTrade: () => void;
  onOpenFreeAgency: () => void;
  onOpenTeams: () => void;
  onOpenStandings: () => void;
  freeAgentCount: number;
  selectedTeam: Team | null;
}> = ({ onProposeTrade, onOpenFreeAgency, onOpenTeams, onOpenStandings, freeAgentCount, selectedTeam }) => (
  <HomePanel title="Action Center" eyebrow="Front Office" aside={<Users className="h-4 w-4 text-[var(--color-ink-faint)]" aria-hidden="true" />}>
    <div className="grid gap-2 md:grid-cols-2">
      <ActionTile
        title="Propose Trade"
        subtitle="Swap active players between two clubs."
        value="COMMISSIONER AUTHORITY"
        onClick={onProposeTrade}
      />
      <ActionTile
        title="Free Agency Pool"
        subtitle="Decide where unsigned talent lands."
        value={`${freeAgentCount} FREE AGENTS`}
        onClick={onOpenFreeAgency}
      />
      <ActionTile
        title="Team Rosters"
        subtitle="Roster database and depth charts."
        value="32 TEAMS"
        onClick={onOpenTeams}
      />
      <ActionTile
        title="League Standings"
        subtitle="Division, league, and playoff races."
        value={selectedTeam ? `${selectedTeam.league} ${selectedTeam.division}` : 'LEAGUE BOARD'}
        onClick={onOpenStandings}
      />
    </div>
  </HomePanel>
);

const divisionColumns: StatTableColumn[] = [
  { key: 'team', header: 'CLUB' },
  { key: 'record', header: 'RECORD', align: 'right', isNumeric: true, width: '7ch' },
  { key: 'pct', header: 'PCT', align: 'right', isNumeric: true, width: '5ch' },
  { key: 'diff', header: 'DIFF', align: 'right', isNumeric: true, width: '5ch' },
];

export const DivisionSnapshotPanel: React.FC<{
  snapshots: DivisionSnapshotType[];
  activeIndex: number;
  onSelect: (index: number) => void;
}> = ({ snapshots, activeIndex, onSelect }) => {
  const active = snapshots[activeIndex] ?? null;

  const rows: StatTableRow[] = (active?.teams ?? []).map((team, index) => ({
    id: team.id,
    className: index < 2 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
    cells: {
      team: (
        <span className="flex items-center gap-2">
          <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
          <TeamLogo team={team} sizeClass="h-6 w-6" />
          <span className="truncate t-stat-sm">{team.city} {team.name}</span>
        </span>
      ),
      record: recordOf(team),
      pct: winPctOf(team),
      diff: (
        <StatValue size="sm" variant={team.runsScored - team.runsAllowed >= 0 ? 'pos' : 'neg'}>
          {team.runsScored - team.runsAllowed >= 0 ? '+' : ''}{team.runsScored - team.runsAllowed}
        </StatValue>
      ),
    },
  }));

  return (
    <HomePanel
      title="Division Snapshot"
      eyebrow="Club Focus"
      aside={
        <div className="flex items-center gap-1">
          {snapshots.map((snapshot, index) => (
            <button
              key={snapshot.key}
              type="button"
              onClick={() => onSelect(index)}
              aria-label={`Show ${snapshot.league} ${snapshot.division}`}
              aria-pressed={index === activeIndex}
              className={`h-2 transition-all ${
                index === activeIndex ? 'w-6 bg-[var(--color-gold)]' : 'w-2 bg-[var(--color-chrome-lo)] hover:bg-[var(--color-chrome-hi)]'
              }`}
            />
          ))}
        </div>
      }
      bodyClassName="p-0"
    >
      {active ? (
        <>
          <p className="t-caption border-b border-[var(--color-chrome-lo)] px-4 py-2 text-[var(--color-ink-faint)]">
            {active.league} {active.division}
          </p>
          <StatTable columns={divisionColumns} rows={rows} density="dense" aria-label={`${active.league} ${active.division} leaders`} />
        </>
      ) : (
        <p className="p-4 t-body text-[var(--color-ink-dim)]">Awaiting clubs.</p>
      )}
    </HomePanel>
  );
};

const selectClass =
  'mt-2 w-full border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 t-stat-sm text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]';

export const TradeDeskModal: React.FC<{
  teams: Team[];
  fromTeamId: string;
  toTeamId: string;
  fromPlayerId: string;
  toPlayerId: string;
  fromPlayers: Player[];
  toPlayers: Player[];
  onFromTeam: (id: string) => void;
  onToTeam: (id: string) => void;
  onFromPlayer: (id: string) => void;
  onToPlayer: (id: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}> = ({
  teams, fromTeamId, toTeamId, fromPlayerId, toPlayerId,
  fromPlayers, toPlayers, onFromTeam, onToTeam, onFromPlayer, onToPlayer, onClose, onSubmit,
}) => {
  const canSubmit = Boolean(fromPlayerId && toPlayerId && fromTeamId && toTeamId);

  const side = (
    label: string,
    teamId: string,
    playerId: string,
    onTeam: (id: string) => void,
    onPlayer: (id: string) => void,
    options: Player[],
    excludeTeam: boolean,
  ) => (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="t-label text-[var(--color-ink-dim)]">{label}</span>
        <select
          value={teamId}
          onChange={(event) => onTeam(event.target.value)}
          className={selectClass}
        >
          {teams.filter((team) => (excludeTeam ? team.id !== toTeamId : true)).map((team) => (
            <option key={team.id} value={team.id}>{team.city} {team.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="t-label text-[var(--color-ink-dim)]">Player</span>
        <select
          value={playerId}
          onChange={(event) => onPlayer(event.target.value)}
          className={selectClass}
          disabled={options.length === 0}
        >
          {options.length === 0 && <option value="">No active players</option>}
          {options.map((player) => (
            <option key={player.playerId} value={player.playerId}>
              {player.firstName} {player.lastName} | {player.primaryPosition}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[color:color-mix(in_srgb,var(--color-void)_85%,transparent)] px-4 py-8">
      <div role="dialog" aria-modal="true" aria-label="Propose trade" className="w-full max-w-3xl">
        <Panel variant="hero" className="overflow-hidden">
          <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
            <h2 className="t-h3">Commissioner Trade Desk</h2>
            <RetroButton variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" /> Close
            </RetroButton>
          </div>

          <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-start">
            {side('Club A', fromTeamId, fromPlayerId, onFromTeam, onFromPlayer, fromPlayers, false)}
            <div className="flex items-center justify-center self-stretch py-2">
              <span className="flex h-10 w-10 items-center justify-center border border-[var(--color-gold)] bg-[var(--color-sunken)]">
                <ArrowRightLeft className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
              </span>
            </div>
            {side('Club B', toTeamId, toPlayerId, onToTeam, onToPlayer, toPlayers, true)}
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--color-chrome-lo)] p-4">
            <RetroButton variant="ghost" onClick={onClose}>Cancel</RetroButton>
            <RetroButton variant="primary" onClick={onSubmit} disabled={!canSubmit}>
              Execute Swap
            </RetroButton>
          </div>
        </Panel>
      </div>
    </div>
  );
};
