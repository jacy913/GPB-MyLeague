import React, { useDeferredValue, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Play, RotateCcw, Search, ShieldAlert, SkipForward, Users } from 'lucide-react';
import { Team } from '../types';
import { DRAFT_LOTTERY_TEAM_COUNT, DraftClassState, DraftHistoryEntry } from '../logic/draftLogic';
import { Meter, Panel, RetroButton, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';

interface DraftHubProps {
  teams: Team[];
  currentDate: string;
  draftOpenDate: string;
  draftClass: DraftClassState | null;
  draftHistory: DraftHistoryEntry[];
  isDraftProcessing: boolean;
  isDraftOpen: boolean;
  onOpenLottery: () => void;
  onDraftNextPick: () => void;
  onAutoDraftRound: () => void;
  onAutoDraftAll: () => void;
  onStopAutoDraft: () => void;
  onResetDraftBoard: () => void;
}

const StatTile: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className={`t-stat mt-1 ${accent ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink)]'}`}>{value}</p>
  </div>
);

const prospectColumns: StatTableColumn[] = [
  { key: 'prospect', header: 'PROSPECT' },
  { key: 'pos', header: 'POS', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'age', header: 'AGE', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'pot', header: 'POT', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'archetype', header: 'ARCHETYPE' },
  { key: 'proj', header: 'PROJ', align: 'right', isNumeric: true, width: '4ch' },
];

export const DraftHub: React.FC<DraftHubProps> = ({
  teams,
  currentDate,
  draftOpenDate,
  draftClass,
  draftHistory,
  isDraftProcessing,
  isDraftOpen,
  onOpenLottery,
  onDraftNextPick,
  onAutoDraftRound,
  onAutoDraftAll,
  onStopAutoDraft,
  onResetDraftBoard,
}) => {
  const draftIsViewOnly = !isDraftOpen;
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const draftSummary = useMemo(() => {
    if (!draftClass || draftClass.draftOrder.length === 0) {
      return null;
    }

    const completed = draftClass.picks.length;
    const total = draftClass.totalPicks;
    const currentRound = Math.min(4, Math.floor(completed / draftClass.draftOrder.length) + 1);
    const pickIndex = completed % draftClass.draftOrder.length;
    const onClockTeamId = draftClass.isComplete ? null : draftClass.draftOrder[pickIndex] ?? null;
    const onClockTeam = onClockTeamId ? teamsById.get(onClockTeamId) ?? null : null;

    return {
      completed,
      total,
      currentRound,
      pickInRound: pickIndex + 1,
      onClockTeam,
    };
  }, [draftClass, teamsById]);

  const filteredProspects = useMemo(() => {
    if (!draftClass) {
      return [];
    }
    const normalizedQuery = deferredSearch.trim().toLowerCase();
    return draftClass.prospects
      .filter((prospect) =>
        normalizedQuery.length === 0 ||
        `${prospect.firstName} ${prospect.lastName}`.toLowerCase().includes(normalizedQuery) ||
        prospect.primaryPosition.toLowerCase().includes(normalizedQuery) ||
        prospect.playerType.toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 120);
  }, [deferredSearch, draftClass]);

  const pickFeed = useMemo(() => {
    if (!draftClass) {
      return [];
    }
    return [...draftClass.picks].slice(-20).reverse();
  }, [draftClass]);

  const prospectRows: StatTableRow[] = filteredProspects.map((prospect) => ({
    id: prospect.playerId,
    cells: {
      prospect: (
        <span className="block min-w-0">
          <span className="block truncate t-stat-sm">{prospect.firstName} {prospect.lastName}</span>
          <span className="block truncate t-caption text-[var(--color-ink-faint)]">{prospect.playerType}</span>
        </span>
      ),
      pos: prospect.primaryPosition,
      age: prospect.age,
      ovr: <StatValue size="sm" variant="accent">{prospect.overall}</StatValue>,
      pot: prospect.potentialOverall,
      archetype: <span className="truncate t-stat-sm text-[var(--color-ink-dim)]">{prospect.archetype}</span>,
      proj: <span className="t-stat-sm text-[var(--color-ink-dim)]">R{prospect.projectedRound}</span>,
    },
  }));

  const draftProgressPct = draftSummary && draftSummary.total > 0
    ? (draftSummary.completed / draftSummary.total) * 100
    : 0;

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">Draft Center</h1>
          <div className="flex flex-wrap gap-2">
            <RetroButton variant="primary" onClick={onOpenLottery}>
              Open Lottery
            </RetroButton>
            <RetroButton
              variant="default"
              onClick={onResetDraftBoard}
              disabled={draftIsViewOnly || isDraftProcessing || !draftClass}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" /> Reset Board
            </RetroButton>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="t-body max-w-2xl text-[var(--color-ink-dim)]">
            Four rounds, one board, and automatic roster management after each pick. The bottom{' '}
            {DRAFT_LOTTERY_TEAM_COUNT} teams enter a draft lottery, and all other teams keep pure record order.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Mode" value="ALWAYS ON" accent />
            <StatTile label="Date" value={currentDate || 'OFFSEASON'} />
            <StatTile label="History" value={`${draftHistory.length} CLASS${draftHistory.length === 1 ? '' : 'ES'}`} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_420px]">
        <Panel className="overflow-hidden">
          <div className="chrome-bar flex items-center justify-between gap-3 px-4">
            <h2 className="t-h3">Draft Board</h2>
            <span className="t-caption text-[var(--color-ink-faint)]">
              {draftClass ? `SEASON ${draftClass.seasonYear}` : 'NO ACTIVE CLASS'}
            </span>
          </div>

          {!draftClass ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <Users className="h-8 w-8 text-[var(--color-ink-faint)]" aria-hidden="true" />
              <p className="t-h3 text-[var(--color-ink)]">Run Lottery First</p>
              <p className="t-body max-w-md text-[var(--color-ink-dim)]">
                Use the Lottery screen to generate the class, lock draft order, and review projections
                before the first pick.
              </p>
              <RetroButton variant="primary" onClick={onOpenLottery} className="mt-2">
                Go To Lottery
              </RetroButton>
            </div>
          ) : (
            <>
              <Panel variant="sunken" className="m-4 flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="t-caption text-[var(--color-ink-faint)]">ON THE CLOCK</p>
                    <p className="t-h2 mt-1 truncate">
                      {draftSummary?.onClockTeam
                        ? `${draftSummary.onClockTeam.city} ${draftSummary.onClockTeam.name}`
                        : 'Draft Complete'}
                    </p>
                    {draftSummary?.onClockTeam && (
                      <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
                        Round {draftSummary.currentRound} · Pick {draftSummary.pickInRound}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {draftSummary?.onClockTeam && <TeamLogo team={draftSummary.onClockTeam} sizeClass="h-14 w-14" />}
                    <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-3 py-2 text-right">
                      <p className="t-caption text-[var(--color-ink-faint)]">PROGRESS</p>
                      <p className="t-stat-lg mt-0.5">{draftSummary ? `${draftSummary.completed}/${draftSummary.total}` : '0/0'}</p>
                    </div>
                  </div>
                </div>

                {/* A true percentage, so the segmented Meter is the right
                    instrument here -- unlike the MVP odds on Leaders, where the
                    field is split eight ways and 20 cells could not separate
                    the candidates. */}
                <Meter value={draftProgressPct} aria-label="Draft progress" />

                <div className="flex flex-wrap gap-2">
                  <RetroButton
                    variant="default"
                    onClick={onDraftNextPick}
                    disabled={draftIsViewOnly || isDraftProcessing || draftClass.isComplete}
                  >
                    <SkipForward className="h-4 w-4" aria-hidden="true" /> Next Pick
                  </RetroButton>
                  <RetroButton
                    variant="default"
                    onClick={onAutoDraftRound}
                    disabled={draftIsViewOnly || isDraftProcessing || draftClass.isComplete}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" /> Auto Round
                  </RetroButton>
                  <RetroButton
                    variant="primary"
                    onClick={onAutoDraftAll}
                    disabled={draftIsViewOnly || isDraftProcessing || draftClass.isComplete}
                  >
                    <Clock3 className="h-4 w-4" aria-hidden="true" /> Auto Full Draft
                  </RetroButton>
                  <RetroButton variant="danger" onClick={onStopAutoDraft} disabled={!isDraftProcessing}>
                    Stop
                  </RetroButton>
                </div>

                {draftIsViewOnly && (
                  <p className="t-caption border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2 text-[var(--color-ink-dim)]">
                    <span className="text-[var(--color-warn)]">DRAFT LOCKED.</span>{' '}
                    Draft actions unlock on {draftOpenDate}. Until then this screen is view-only.
                  </p>
                )}

                {isDraftProcessing && (
                  <p className="t-caption border-l-[3px] border-l-[var(--color-info)] bg-[var(--color-sunken)] px-3 py-2 text-[var(--color-ink-dim)]">
                    <span className="text-[var(--color-info)]">DRAFT ENGINE RUNNING.</span>{' '}
                    Auto draft is processing picks in buffered batches to keep the UI responsive.
                  </p>
                )}
              </Panel>

              <div className="px-4">
                <label className="relative block max-w-sm">
                  <Search
                    className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search prospects"
                    aria-label="Search prospects"
                    className="w-full border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] py-1.5 pl-8 pr-3 t-stat-sm text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
                  />
                </label>
              </div>

              <div className="mt-3">
                <StatTable
                  columns={prospectColumns}
                  rows={prospectRows}
                  density="dense"
                  aria-label="Draft prospects"
                  className="max-h-[56vh] overflow-y-auto"
                />
              </div>
            </>
          )}
        </Panel>

        <div className="flex flex-col gap-5">
          <Panel className="overflow-hidden">
            <div className="chrome-bar flex items-center justify-between gap-3 px-4">
              <h2 className="t-h3">Pick Feed</h2>
              <ShieldAlert className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            </div>
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto p-3">
              {pickFeed.length === 0 ? (
                <p className="p-4 text-center t-caption text-[var(--color-ink-faint)]">
                  <AlertTriangle className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
                  No picks yet
                </p>
              ) : (
                pickFeed.map((pick) => {
                  const team = teamsById.get(pick.teamId) ?? null;
                  return (
                    <div
                      key={`${pick.overallPick}-${pick.playerId}`}
                      className="flex items-center gap-3 border-l-[3px] border-l-[var(--color-gold)] bg-[var(--color-sunken)] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="t-caption text-[var(--color-ink-faint)]">
                          R{pick.round} · P{pick.pickInRound} · #{pick.overallPick}
                        </p>
                        <p className="truncate t-stat-sm">{pick.playerName}</p>
                        <p className="truncate t-caption text-[var(--color-ink-dim)]">
                          {team ? `${team.city} ${team.name}` : pick.teamId.toUpperCase()} · {pick.primaryPosition}
                        </p>
                        {pick.waivedPlayerName && (
                          <p className="truncate t-caption text-[var(--color-warn)]">Waived: {pick.waivedPlayerName}</p>
                        )}
                      </div>
                      <StatValue size="lg" variant="accent">{pick.overall}</StatValue>
                      {team && <TeamLogo team={team} sizeClass="h-9 w-9" />}
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="chrome-bar flex items-center justify-between gap-3 px-4">
              <h2 className="t-h3">Draft Archive</h2>
            </div>
            <div className="flex max-h-[220px] flex-col gap-1 overflow-y-auto p-3">
              {draftHistory.length === 0 ? (
                <p className="p-4 text-center t-caption text-[var(--color-ink-faint)]">No completed drafts yet</p>
              ) : (
                [...draftHistory]
                  .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
                  .map((entry) => (
                    <div key={entry.draftId} className="flex items-baseline justify-between gap-3 px-1 py-1">
                      <span className="t-stat-sm">Season {entry.seasonYear}</span>
                      <span className="t-caption text-[var(--color-ink-faint)]">
                        {entry.pickCount} picks · {new Date(entry.completedAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </section>
  );
};
