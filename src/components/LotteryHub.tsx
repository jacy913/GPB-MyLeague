import React, { useMemo } from 'react';
import { ArrowRight, ListOrdered, Sparkles, Ticket } from 'lucide-react';
import { Team } from '../types';
import { DRAFT_ROUNDS, DraftClassState, DraftPickRecord } from '../logic/draftLogic';
import { TeamLogo } from './TeamLogo';

type OffseasonStage = 'idle' | 'draft_lottery' | 'draft' | 'free_agency';

interface LotteryHubProps {
  teams: Team[];
  currentDate: string;
  offseasonStage: OffseasonStage;
  lotteryOpenDate: string;
  draftClass: DraftClassState | null;
  isDraftProcessing: boolean;
  onGenerateDraftClass: () => void;
  onOpenDraft: () => void;
}

interface DraftOrderRow {
  round: number;
  pickInRound: number;
  overallPick: number;
  teamId: string;
  pickRecord: DraftPickRecord | null;
}

interface ProjectedPick {
  round: number;
  pickInRound: number;
  overallPick: number;
  teamId: string;
  playerName: string;
  playerType: string;
  position: string;
  overall: number;
  potential: number;
}

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#242424,#101010)]';

export const LotteryHub: React.FC<LotteryHubProps> = ({
  teams,
  currentDate,
  offseasonStage,
  lotteryOpenDate,
  draftClass,
  isDraftProcessing,
  onGenerateDraftClass,
  onOpenDraft,
}) => {
  const lotteryDateReached = currentDate >= lotteryOpenDate;
  const lotteryIsViewOnly = draftClass !== null || offseasonStage !== 'draft_lottery' || !lotteryDateReached;
  const canRunLottery = !lotteryIsViewOnly && !isDraftProcessing;
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const orderRows = useMemo<DraftOrderRow[]>(() => {
    if (!draftClass || draftClass.draftOrder.length === 0) {
      return [];
    }

    const pickBySlot = new Map<string, DraftPickRecord>();
    draftClass.picks.forEach((pick) => {
      pickBySlot.set(`${pick.round}:${pick.pickInRound}`, pick);
    });

    const rows: DraftOrderRow[] = [];
    for (let round = 1; round <= DRAFT_ROUNDS; round += 1) {
      draftClass.draftOrder.forEach((teamId, pickIndex) => {
        const pickInRound = pickIndex + 1;
        rows.push({
          round,
          pickInRound,
          overallPick: (round - 1) * draftClass.draftOrder.length + pickInRound,
          teamId,
          pickRecord: pickBySlot.get(`${round}:${pickInRound}`) ?? null,
        });
      });
    }
    return rows;
  }, [draftClass]);

  const projectedPicks = useMemo<ProjectedPick[]>(() => {
    if (!draftClass || draftClass.draftOrder.length === 0 || draftClass.prospects.length === 0) {
      return [];
    }

    const remainingPicks = Math.max(0, draftClass.totalPicks - draftClass.picks.length);
    const projectionCount = Math.min(24, remainingPicks, draftClass.prospects.length);

    return Array.from({ length: projectionCount }, (_, offset) => {
      const overallPick = draftClass.picks.length + offset + 1;
      const round = Math.floor((overallPick - 1) / draftClass.draftOrder.length) + 1;
      const pickInRound = ((overallPick - 1) % draftClass.draftOrder.length) + 1;
      const teamId = draftClass.draftOrder[pickInRound - 1] ?? '';
      const prospect = draftClass.prospects[offset];

      return {
        round,
        pickInRound,
        overallPick,
        teamId,
        playerName: `${prospect.firstName} ${prospect.lastName}`,
        playerType: prospect.playerType,
        position: prospect.primaryPosition,
        overall: prospect.overall,
        potential: prospect.potentialOverall,
      };
    });
  }, [draftClass]);

  const draftProgress = draftClass
    ? `${draftClass.picks.length}/${draftClass.totalPicks}`
    : '0/0';

  return (
    <section className="space-y-6">
      <article className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Lottery Desk</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Lottery</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Run the draft lottery and generate the class here. After that, this board doubles as the draft-order tracker and prediction screen.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1.5rem] border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-200">Lottery Status</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-[#f3dea1]">
                {draftClass ? 'Completed' : 'Pending'}
              </p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Current Date</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">{currentDate || 'Offseason'}</p>
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Draft Progress</p>
              <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">{draftProgress}</p>
            </div>
          </div>
        </div>
      </article>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <section className={`${sectionClass} p-6`}>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Draft Lottery Board</p>
              <p className="mt-1 font-headline text-4xl uppercase tracking-[0.06em] text-white">
                {draftClass ? `Season ${draftClass.seasonYear} Order` : 'Run Lottery'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onGenerateDraftClass}
                disabled={!canRunLottery}
                className="rounded-2xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-[#f3dea1] disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Ticket className="h-4 w-4" />
                  {lotteryIsViewOnly ? 'Lottery Locked' : 'Run Lottery'}
                </span>
              </button>
              <button
                type="button"
                onClick={onOpenDraft}
                disabled={!draftClass}
                className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-headline text-lg uppercase tracking-[0.08em] text-white disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  Open Draft
                  <ArrowRight className="h-4 w-4" />
                </span>
              </button>
            </div>
          </div>

          {!draftClass ? (
            <div className="mt-6 rounded-[1.75rem] border border-dashed border-white/10 bg-black/20 px-5 py-8 text-center">
              <ListOrdered className="mx-auto h-8 w-8 text-zinc-500" />
              <p className="mt-4 font-headline text-3xl uppercase tracking-[0.08em] text-white">No Lottery Results Yet</p>
              <p className="mt-3 text-sm leading-6 text-zinc-400">
                {!lotteryDateReached
                  ? `Lottery unlocks on ${lotteryOpenDate}.`
                  : offseasonStage === 'draft_lottery'
                  ? 'Run the lottery to lock the full draft order and generate the next class of prospects.'
                  : 'Lottery generation is only available during the Draft Lottery offseason stage.'}
              </p>
            </div>
          ) : (
            <div className="mt-4 max-h-[64vh] overflow-auto rounded-[1.5rem] border border-white/10 bg-black/20">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-[#141414]">
                  <tr className="border-b border-white/10 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                    <th className="px-3 py-3 text-center">Rnd</th>
                    <th className="px-3 py-3 text-center">Pick</th>
                    <th className="px-3 py-3 text-center">Overall</th>
                    <th className="px-3 py-3 text-left">Team</th>
                    <th className="px-3 py-3 text-left">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {orderRows.map((row) => {
                    const team = teamsById.get(row.teamId) ?? null;
                    return (
                      <tr key={`${row.round}-${row.pickInRound}`} className="hover:bg-white/5">
                        <td className="px-3 py-3 text-center font-mono text-zinc-200">{row.round}</td>
                        <td className="px-3 py-3 text-center font-mono text-zinc-200">{row.pickInRound}</td>
                        <td className="px-3 py-3 text-center font-mono text-[#ecd693]">{row.overallPick}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            {team && <TeamLogo team={team} sizeClass="h-8 w-8" />}
                            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-200">
                              {team ? `${team.city} ${team.name}` : row.teamId.toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                          {row.pickRecord
                            ? `${row.pickRecord.playerName} | ${row.pickRecord.primaryPosition} | ${row.pickRecord.overall} OVR`
                            : 'Pending'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <article className={`${sectionClass} p-5`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Draft Predictions</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.06em] text-white">Projected Next Picks</p>
              </div>
              <Sparkles className="h-5 w-5 text-[#d4bb6a]" />
            </div>

            <div className="mt-4 space-y-3 max-h-[500px] overflow-y-auto pr-1 scrollbar-subtle">
              {projectedPicks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center">
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">Run lottery to unlock projections</p>
                </div>
              ) : (
                projectedPicks.map((projection) => {
                  const team = teamsById.get(projection.teamId) ?? null;
                  return (
                    <div key={`proj-${projection.overallPick}`} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        Round {projection.round} | Pick {projection.pickInRound} | Overall {projection.overallPick}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-headline text-2xl uppercase tracking-[0.06em] text-white">{projection.playerName}</p>
                          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                            {team ? `${team.city} ${team.name}` : projection.teamId.toUpperCase()} | {projection.position} | {projection.playerType}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#d4bb6a]/35 bg-[#d4bb6a]/10 px-3 py-2 text-center">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#f3dea1]">OVR/POT</p>
                          <p className="mt-1 font-headline text-2xl uppercase tracking-[0.06em] text-[#f6e6ae]">
                            {projection.overall}/{projection.potential}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </article>
        </section>
      </div>
    </section>
  );
};
