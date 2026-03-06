import React, { useDeferredValue, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Play, RotateCcw, Search, ShieldAlert, SkipForward, Users } from 'lucide-react';
import { Team } from '../types';
import { DRAFT_LOTTERY_TEAM_COUNT, DraftClassState, DraftHistoryEntry } from '../logic/draftLogic';
import { TeamLogo } from './TeamLogo';

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

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#242424,#101010)]';

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

  return (
    <section className="space-y-6">
      <article className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Draft Room</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Draft Center</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Four rounds, one board, and automatic roster management after each pick. The bottom {DRAFT_LOTTERY_TEAM_COUNT} teams enter a
              draft lottery, and all other teams keep pure record order.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200">Testing Mode</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-[#f3dea1]">Always On</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Current Date</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">{currentDate || 'Offseason'}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Draft History</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">{draftHistory.length} class{draftHistory.length === 1 ? '' : 'es'}</p>
            </div>
          </div>
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_420px]">
        <section className={`${sectionClass} p-6`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Draft Board</p>
              <p className="mt-1 font-headline text-4xl uppercase tracking-[0.06em] text-white">
                {draftClass ? `Season ${draftClass.seasonYear}` : 'No Active Class'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenLottery}
                className="rounded-2xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-[#f3dea1] disabled:opacity-50"
              >
                Open Lottery
              </button>
              <button
                type="button"
                onClick={onResetDraftBoard}
                disabled={draftIsViewOnly || isDraftProcessing || !draftClass}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-white disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Reset Board
                </span>
              </button>
            </div>
          </div>

          {!draftClass ? (
            <div className="mt-6 rounded-[1.75rem] border border-dashed border-white/10 bg-black/20 px-5 py-8 text-center">
              <Users className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="mt-4 font-headline text-3xl uppercase tracking-[0.08em] text-white">Run Lottery First</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                Use the Lottery screen to generate the class, lock draft order, and review projections before the first pick.
              </p>
              <button
                type="button"
                onClick={onOpenLottery}
                className="mt-4 rounded-2xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-[#f3dea1]"
              >
                Go To Lottery
              </button>
            </div>
          ) : (
            <>
              <div className="mt-6 rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">On The Clock</p>
                    <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-white">
                      {draftSummary?.onClockTeam ? `${draftSummary.onClockTeam.city} ${draftSummary.onClockTeam.name}` : 'Draft Complete'}
                    </p>
                    {draftSummary?.onClockTeam && (
                      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                        Round {draftSummary.currentRound} · Pick {draftSummary.pickInRound}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {draftSummary?.onClockTeam && <TeamLogo team={draftSummary.onClockTeam} sizeClass="h-14 w-14" />}
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Progress</p>
                      <p className="mt-1 font-headline text-2xl uppercase tracking-[0.06em] text-white">
                        {draftSummary ? `${draftSummary.completed}/${draftSummary.total}` : '0/0'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#d4bb6a,#f3e5aa,#30d7c1)] transition-[width] duration-300"
                    style={{
                      width: `${draftSummary && draftSummary.total > 0 ? Math.max(4, (draftSummary.completed / draftSummary.total) * 100) : 4}%`,
                    }}
                  />
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <button
                    type="button"
                    onClick={onDraftNextPick}
                    disabled={draftIsViewOnly || isDraftProcessing || draftClass.isComplete}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-white disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2"><SkipForward className="h-4 w-4" />Next Pick</span>
                  </button>
                  <button
                    type="button"
                    onClick={onAutoDraftRound}
                    disabled={draftIsViewOnly || isDraftProcessing || draftClass.isComplete}
                    className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-white disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2"><Play className="h-4 w-4" />Auto Round</span>
                  </button>
                  <button
                    type="button"
                    onClick={onAutoDraftAll}
                    disabled={draftIsViewOnly || isDraftProcessing || draftClass.isComplete}
                    className="rounded-2xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-[#f3dea1] disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" />Auto Full Draft</span>
                  </button>
                  <button
                    type="button"
                    onClick={onStopAutoDraft}
                    disabled={!isDraftProcessing}
                    className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-red-200 disabled:opacity-50"
                  >
                    Stop
                  </button>
                </div>

                {draftIsViewOnly && (
                  <div className="mt-4 rounded-2xl border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200">Draft Locked</p>
                    <p className="mt-2 text-sm text-zinc-300">Draft actions unlock on {draftOpenDate}. Until then this screen is view-only.</p>
                  </div>
                )}

                {isDraftProcessing && (
                  <div className="mt-4 rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">Draft Engine Running</p>
                    <p className="mt-2 text-sm text-cyan-100">Auto draft is processing picks in buffered batches to keep the UI responsive.</p>
                  </div>
                )}
              </div>

              <div className="mt-5">
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search prospects..."
                    className="w-full rounded-2xl border border-white/10 bg-black/20 py-2 pl-9 pr-4 font-mono text-sm text-white outline-none focus:border-white/25"
                  />
                </div>
              </div>

              <div className="mt-4 max-h-[56vh] overflow-auto rounded-[1.5rem] border border-white/10 bg-black/20">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-[#141414]">
                    <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      <th className="px-3 py-3 text-left">Prospect</th>
                      <th className="px-3 py-3 text-center">Pos</th>
                      <th className="px-3 py-3 text-center">Age</th>
                      <th className="px-3 py-3 text-center">OVR</th>
                      <th className="px-3 py-3 text-center">POT</th>
                      <th className="px-3 py-3 text-center">Archetype</th>
                      <th className="px-3 py-3 text-center">Proj</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredProspects.map((prospect) => (
                      <tr key={prospect.playerId} className="hover:bg-white/5">
                        <td className="px-3 py-3">
                          <p className="font-headline text-xl uppercase tracking-[0.06em] text-white">
                            {prospect.firstName} {prospect.lastName}
                          </p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{prospect.playerType}</p>
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-zinc-200">{prospect.primaryPosition}</td>
                        <td className="px-3 py-3 text-center font-mono text-zinc-200">{prospect.age}</td>
                        <td className="px-3 py-3 text-center font-headline text-2xl uppercase tracking-[0.06em] text-[#ecd693]">{prospect.overall}</td>
                        <td className="px-3 py-3 text-center font-headline text-2xl uppercase tracking-[0.06em] text-white">{prospect.potentialOverall}</td>
                        <td className="px-3 py-3 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">{prospect.archetype}</td>
                        <td className="px-3 py-3 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">R{prospect.projectedRound}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="space-y-6">
          <article className={`${sectionClass} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Pick Feed</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.06em] text-white">Latest Selections</p>
              </div>
              <ShieldAlert className="h-5 w-5 text-[#d4bb6a]" />
            </div>

            <div className="mt-4 space-y-3 max-h-[420px] overflow-y-auto pr-1 scrollbar-subtle">
              {pickFeed.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center">
                  <AlertTriangle className="mx-auto h-5 w-5 text-zinc-500" />
                  <p className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No picks yet</p>
                </div>
              ) : (
                pickFeed.map((pick) => {
                  const team = teamsById.get(pick.teamId) ?? null;
                  return (
                    <div key={`${pick.overallPick}-${pick.playerId}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                            Round {pick.round} · Pick {pick.pickInRound} · Overall {pick.overallPick}
                          </p>
                          <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">{pick.playerName}</p>
                          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                            {team ? `${team.city} ${team.name}` : pick.teamId.toUpperCase()} · {pick.primaryPosition} · {pick.overall} OVR
                          </p>
                          {pick.waivedPlayerName && (
                            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">
                              Waived: {pick.waivedPlayerName}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="min-w-[5.5rem] rounded-xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-3 py-2 text-center">
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f3dea1]">OVR</p>
                            <p className="mt-1 font-headline text-3xl uppercase tracking-[0.06em] text-[#f6e6ae]">{pick.overall}</p>
                          </div>
                          {team && <TeamLogo team={team} sizeClass="h-12 w-12" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </article>

          <article className={`${sectionClass} p-5`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Draft Archive</p>
            <p className="mt-1 font-headline text-3xl uppercase tracking-[0.06em] text-white">Historical Record</p>
            <div className="mt-4 space-y-3 max-h-[220px] overflow-y-auto pr-1 scrollbar-subtle">
              {draftHistory.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No completed drafts yet</p>
                </div>
              ) : (
                [...draftHistory]
                  .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
                  .map((entry) => (
                    <div key={entry.draftId} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                      <p className="font-headline text-2xl uppercase tracking-[0.06em] text-white">Season {entry.seasonYear}</p>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                        {entry.pickCount} picks · completed {new Date(entry.completedAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))
              )}
            </div>
          </article>
        </section>
      </div>
    </section>
  );
};
