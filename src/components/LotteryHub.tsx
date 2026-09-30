import React, { useMemo } from 'react';
import { ArrowRight, ListOrdered, Sparkles, Ticket } from 'lucide-react';
import { Team } from '../types';
import { DRAFT_ROUNDS, DraftClassState, DraftPickRecord } from '../logic/draftLogic';
import { Panel, RetroButton, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';

type OffseasonStage = 'idle' | 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';

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

  const draftProgress = draftClass ? `${draftClass.picks.length}/${draftClass.totalPicks}` : '0/0';

  const orderColumns: StatTableColumn[] = [
    { key: 'round', header: 'RND', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'pick', header: 'PICK', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'overall', header: 'OVERALL', align: 'right', isNumeric: true, width: '7ch' },
    { key: 'team', header: 'TEAM' },
    { key: 'result', header: 'RESULT' },
  ];

  const orderTableRows: StatTableRow[] = orderRows.map((row) => {
    const team = teamsById.get(row.teamId) ?? null;
    // The lottery itself reorders only the first round's top slots, so those rows
    // are the ones the user came to this screen to see. Marking them is
    // informational only; it does not change the order.
    const isLotteryWindow = row.round === 1 && row.pickInRound <= 14;
    return {
      id: `${row.round}-${row.pickInRound}`,
      className: isLotteryWindow ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
      cells: {
        round: row.round,
        pick: row.pickInRound,
        overall: <StatValue size="sm" variant={isLotteryWindow ? 'accent' : 'default'}>{row.overallPick}</StatValue>,
        team: (
          <span className="flex items-center gap-2">
            {team && <TeamLogo team={team} sizeClass="h-8 w-8" />}
            <span className="truncate t-stat-sm">{team ? `${team.city} ${team.name}` : row.teamId.toUpperCase()}</span>
          </span>
        ),
        result: row.pickRecord
          ? <span className="truncate t-stat-sm text-[var(--color-ink-dim)]">{row.pickRecord.playerName} · {row.pickRecord.primaryPosition} · {row.pickRecord.overall} OVR</span>
          : <span className="t-stat-sm text-[var(--color-ink-faint)]">PENDING</span>,
      },
    };
  });

  const projectionColumns: StatTableColumn[] = [
    { key: 'pick', header: 'PICK', align: 'right', isNumeric: true, width: '5ch' },
    { key: 'player', header: 'PROSPECT' },
    { key: 'pos', header: 'POS', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'team', header: 'DESTINATION' },
    { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'pot', header: 'POT', align: 'right', isNumeric: true, width: '4ch' },
  ];

  const projectionRows: StatTableRow[] = projectedPicks.map((projection) => {
    const team = teamsById.get(projection.teamId) ?? null;
    return {
      id: `proj-${projection.overallPick}`,
      cells: {
        pick: projection.overallPick,
        player: <span className="truncate t-stat-sm">{projection.playerName}</span>,
        pos: projection.position,
        team: <span className="truncate t-stat-sm text-[var(--color-ink-dim)]">{team ? `${team.city} ${team.name}` : projection.teamId.toUpperCase()}</span>,
        ovr: projection.overall,
        pot: <StatValue size="sm" variant="accent">{projection.potential}</StatValue>,
      },
    };
  });

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">Lottery</h1>
          <div className="flex flex-wrap gap-2">
            <RetroButton
              variant={lotteryIsViewOnly ? 'ghost' : 'primary'}
              onClick={onGenerateDraftClass}
              disabled={!canRunLottery}
            >
              <Ticket className="h-4 w-4" aria-hidden="true" />
              {lotteryIsViewOnly ? 'Lottery Locked' : 'Run Lottery'}
            </RetroButton>
            <RetroButton variant="default" onClick={onOpenDraft} disabled={!draftClass}>
              Open Draft
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </RetroButton>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="t-body max-w-2xl text-[var(--color-ink-dim)]">
            Run the draft lottery and generate the class here. After that this board doubles as the
            draft-order tracker and prediction screen.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Lottery" value={draftClass ? 'COMPLETED' : 'PENDING'} accent={!draftClass} />
            <StatTile label="Date" value={currentDate || 'OFFSEASON'} />
            <StatTile label="Progress" value={draftProgress} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <Panel className="overflow-hidden">
          <div className="chrome-bar flex items-center justify-between gap-3 px-4">
            <h2 className="t-h3">Draft Order</h2>
            <span className="t-caption text-[var(--color-ink-faint)]">
              {draftClass ? `SEASON ${draftClass.seasonYear}` : 'NOT RUN'}
            </span>
          </div>
          {!draftClass ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <ListOrdered className="h-8 w-8 text-[var(--color-ink-faint)]" aria-hidden="true" />
              <p className="t-h3 text-[var(--color-ink)]">No Lottery Results Yet</p>
              <p className="t-body max-w-md text-[var(--color-ink-dim)]">
                {!lotteryDateReached
                  ? `Lottery unlocks on ${lotteryOpenDate}.`
                  : offseasonStage === 'draft_lottery'
                    ? 'Run the lottery to lock the full draft order and generate the next class of prospects.'
                    : 'Lottery generation is only available during the Draft Lottery offseason stage.'}
              </p>
            </div>
          ) : (
            <StatTable
              columns={orderColumns}
              rows={orderTableRows}
              density="dense"
              aria-label="Draft order"
              className="max-h-[64vh] overflow-y-auto"
            />
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <div className="chrome-bar flex items-center justify-between gap-3 px-4">
            <h2 className="t-h3">Projected Picks</h2>
            <Sparkles className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          </div>
          {projectedPicks.length === 0 ? (
            <p className="p-6 text-center t-caption text-[var(--color-ink-faint)]">Run lottery to unlock projections</p>
          ) : (
            <StatTable
              columns={projectionColumns}
              rows={projectionRows}
              density="dense"
              aria-label="Projected draft picks"
              className="max-h-[64vh] overflow-y-auto"
            />
          )}
        </Panel>
      </div>
    </section>
  );
};

const StatTile: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className={`t-stat mt-1 ${accent ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink)]'}`}>{value}</p>
  </div>
);
