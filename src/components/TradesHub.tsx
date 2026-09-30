import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, RefreshCcw, ShieldAlert, UserRound, X } from 'lucide-react';
import {
  PendingTradeProposal,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerTransaction,
  Team,
} from '../types';
import { Panel, RetroButton, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';

interface TradesHubProps {
  teams: Team[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  pendingTrades: PendingTradeProposal[];
  transactions: PlayerTransaction[];
  currentDate: string;
  onApproveTrade: (proposalId: string) => void | Promise<void>;
  onVetoTrade: (proposalId: string) => void | Promise<void>;
  onRefreshBoard: () => void;
}

type EnrichedTradeProposal = {
  proposal: PendingTradeProposal;
  fromTeam: Team | null;
  toTeam: Team | null;
  fromPlayer: Player | null;
  toPlayer: Player | null;
  fromOverall: number;
  toOverall: number;
  fromPotential: number;
  toPotential: number;
};

type TradeHistoryEntry = {
  id: string;
  effectiveDate: string;
  headline: string;
  detail: string;
};

const ACTION_FLASH_MS = 260;
const CARD_INTRINSIC_SIZE = '760px';
const TRADE_HISTORY_LIMIT = 18;

const getCategoryLabel = (category: PendingTradeProposal['category']): string => {
  switch (category) {
    case 'blockbuster':
      return 'Blockbuster';
    case 'deadline_push':
      return 'Deadline Push';
    case 'prospect_swap':
      return 'Prospect Swap';
    default:
      return 'Contender Push';
  }
};

const getLatestBattingRatingsMap = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const next = new Map<string, PlayerBattingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) {
        next.set(rating.playerId, rating);
      }
    });
  return next;
};

const getLatestPitchingRatingsMap = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const next = new Map<string, PlayerPitchingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) {
        next.set(rating.playerId, rating);
      }
    });
  return next;
};

const getPlayerOverall = (
  player: Player | null,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number =>
  player
    ? battingRatingsByPlayerId.get(player.playerId)?.overall ?? pitchingRatingsByPlayerId.get(player.playerId)?.overall ?? 0
    : 0;

const getPlayerPotential = (
  player: Player | null,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number =>
  player
    ? Math.max(
        player.potential,
        battingRatingsByPlayerId.get(player.playerId)?.potentialOverall ?? 0,
        pitchingRatingsByPlayerId.get(player.playerId)?.potentialOverall ?? 0,
      )
    : 0;

const formatTradeDate = (date: string): string => {
  if (!date) {
    return 'League Office';
  }

  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) {
    return date;
  }

  return value.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getPlayerLabel = (player: Player | null): string => (player ? `${player.firstName} ${player.lastName}` : 'Unknown Player');

const getTeamLabel = (team: Team | null, fallback: string | null): string => {
  if (team) {
    return team.city;
  }

  return fallback ?? 'League Office';
};

const stripSwapPrefix = (notes: string | null): string | null => {
  if (!notes?.startsWith('Swap return: ')) {
    return null;
  }

  return notes.slice('Swap return: '.length).trim() || null;
};

const playerColumns: StatTableColumn[] = [
  { key: 'player', header: 'PLAYER' },
  { key: 'pos', header: 'POS', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'age', header: 'AGE', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'pot', header: 'POT', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'yrs', header: 'YRS', align: 'right', isNumeric: true, width: '4ch' },
];

const SidePanel: React.FC<{
  role: string;
  team: Team | null;
  player: Player | null;
  overall: number;
  potential: number;
  reason: string;
}> = ({ role, team, player, overall, potential, reason }) => {
  const rows: StatTableRow[] = [{
    id: player?.playerId ?? 'unknown',
    cells: {
      player: player
        ? <span className="truncate t-stat-sm">{player.firstName} {player.lastName}</span>
        : <span className="t-stat-sm text-[var(--color-ink-faint)]">Roster data unavailable</span>,
      pos: player?.primaryPosition ?? '--',
      age: player?.age ?? '--',
      ovr: <StatValue size="sm" variant="accent">{overall}</StatValue>,
      pot: potential,
      yrs: player?.contractYearsLeft ?? '--',
    },
  }];

  return (
    <Panel variant="sunken" className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        {team
          ? <TeamLogo team={team} sizeClass="h-14 w-14" />
          : <span className="flex h-12 w-12 items-center justify-center border border-dashed border-[var(--color-chrome-lo)]">
              <UserRound className="h-5 w-5 text-[var(--color-ink-faint)]" aria-hidden="true" />
            </span>}
        <div className="min-w-0">
          <p className="t-caption text-[var(--color-ink-faint)]">{role}</p>
          <p className="truncate t-h3">{team ? `${team.city} ${team.name}` : 'Unknown Team'}</p>
        </div>
      </div>
      <StatTable columns={playerColumns} rows={rows} density="dense" aria-label={`${role} player`} />
      <p className="t-caption text-[var(--color-ink-dim)]">
        {player ? `${player.bats}/${player.throws} · Age ${player.age}` : 'No active roster player.'}
      </p>
      <p className="t-caption text-[var(--color-ink-faint)]">{reason}</p>
    </Panel>
  );
};

const TradeProposalCard = React.memo(({
  trade,
  onApproveTrade,
  onVetoTrade,
}: {
  trade: EnrichedTradeProposal;
  onApproveTrade: (proposalId: string) => void | Promise<void>;
  onVetoTrade: (proposalId: string) => void | Promise<void>;
}) => {
  const [armedAction, setArmedAction] = useState<'approve' | 'veto' | null>(null);
  const [resolvingAction, setResolvingAction] = useState<'approve' | 'veto' | null>(null);
  const { proposal, fromTeam, toTeam, fromPlayer, toPlayer, fromOverall, toOverall, fromPotential, toPotential } = trade;

  useEffect(() => {
    if (!armedAction) {
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      setArmedAction((current) => (current === armedAction ? null : current));
    }, 2200);

    return () => globalThis.clearTimeout(timeout);
  }, [armedAction]);

  const triggerTradeAction = useCallback(async (action: 'approve' | 'veto') => {
    if (resolvingAction) {
      return;
    }

    if (armedAction !== action) {
      setArmedAction(action);
      return;
    }

    setArmedAction(null);
    setResolvingAction(action);

    await new Promise((resolve) => globalThis.setTimeout(resolve, ACTION_FLASH_MS));
    try {
      await Promise.resolve(action === 'approve' ? onApproveTrade(proposal.proposalId) : onVetoTrade(proposal.proposalId));
    } finally {
      setResolvingAction(null);
    }
  }, [armedAction, onApproveTrade, onVetoTrade, proposal.proposalId, resolvingAction]);

  const isApproving = resolvingAction === 'approve';
  const isVetoing = resolvingAction === 'veto';
  const isActionLocked = resolvingAction !== null;
  const approveArmed = armedAction === 'approve';
  const vetoArmed = armedAction === 'veto';

  const tone = isApproving
    ? 'border-[var(--color-pos)]'
    : isVetoing
      ? 'border-[var(--color-neg)]'
      : '';

  return (
    <Panel
      className={`overflow-hidden ${tone}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: CARD_INTRINSIC_SIZE }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-chrome-lo)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`border px-2 py-0.5 t-caption ${
              proposal.isBlockbuster
                ? 'border-[var(--color-gold)] bg-[var(--color-gold)] text-[var(--color-ink-invert)]'
                : 'border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] text-[var(--color-ink-dim)]'
            }`}>
              {getCategoryLabel(proposal.category)}
            </span>
            <span className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-0.5 t-caption text-[var(--color-ink-faint)]">
              NEED {proposal.needSlot}
            </span>
          </div>
          <h2 className="t-h2 mt-1 truncate">{proposal.summary}</h2>
        </div>
        <div className="shrink-0 text-right">
          <p className="t-caption text-[var(--color-ink-faint)]">SYNERGY</p>
          <StatValue size="lg" variant="accent">{proposal.synergy}%</StatValue>
        </div>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_240px_minmax(0,1fr)]">
        <SidePanel
          role="SELLER SENDS"
          team={fromTeam}
          player={fromPlayer}
          overall={fromOverall}
          potential={fromPotential}
          reason={proposal.fromTeamReason}
        />

        <Panel variant="sunken" className="flex flex-col gap-3 p-3">
          {/* Proportional bar rather than the segmented Meter. The exact figure
              is set beside it in display type, so a 20-cell gauge would add a
              coarse second reading of a number already given to the point. */}
          <div
            className="h-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]"
            role="img"
            aria-label={`Trade synergy ${proposal.synergy} percent`}
          >
            <div
              className="h-full bg-[var(--color-gold)] transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-snap)]"
              style={{ width: `${proposal.synergy}%` }}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] p-2 text-center">
              <p className="t-caption text-[var(--color-ink-faint)]">SELLER EASE</p>
              <StatValue size="sm">{proposal.fromTeamInterest}%</StatValue>
            </div>
            <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] p-2 text-center">
              <p className="t-caption text-[var(--color-ink-faint)]">BUYER EASE</p>
              <StatValue size="sm">{proposal.toTeamInterest}%</StatValue>
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-2">
            <RetroButton
              variant={approveArmed || isApproving ? 'primary' : 'default'}
              onClick={() => { void triggerTradeAction('approve'); }}
              disabled={isActionLocked}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {isApproving ? 'Approved' : approveArmed ? 'Confirm Approve' : 'Approve'}
            </RetroButton>
            <RetroButton
              variant={vetoArmed || isVetoing ? 'danger' : 'ghost'}
              onClick={() => { void triggerTradeAction('veto'); }}
              disabled={isActionLocked}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              {isVetoing ? 'Vetoed' : vetoArmed ? 'Confirm Veto' : 'Veto'}
            </RetroButton>
          </div>

          <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] p-2 text-center">
            <ShieldAlert className="mx-auto h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            <p className="mt-1 t-caption text-[var(--color-ink-faint)]">COMMISSIONER CALL</p>
            <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
              {isActionLocked
                ? 'Decision locked in. Finalizing the trade call now.'
                : approveArmed
                  ? 'Approval is armed. Click approve again to confirm.'
                  : vetoArmed
                    ? 'Veto is armed. Click veto again to confirm.'
                    : proposal.synergy >= 85
                      ? 'Both clubs are aligned.'
                      : proposal.synergy >= 70
                        ? 'A realistic deal with some tension.'
                        : 'Both sides are reluctant, but still listening.'}
            </p>
          </div>
        </Panel>

        <SidePanel
          role="BUYER SENDS"
          team={toTeam}
          player={toPlayer}
          overall={toOverall}
          potential={toPotential}
          reason={proposal.toTeamReason}
        />
      </div>
    </Panel>
  );
});

TradeProposalCard.displayName = 'TradeProposalCard';

export const TradesHub: React.FC<TradesHubProps> = ({
  teams,
  players,
  battingRatings,
  pitchingRatings,
  pendingTrades,
  transactions,
  currentDate,
  onApproveTrade,
  onVetoTrade,
  onRefreshBoard,
}) => {
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const battingRatingsByPlayerId = useMemo(() => getLatestBattingRatingsMap(battingRatings), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => getLatestPitchingRatingsMap(pitchingRatings), [pitchingRatings]);
  const enrichedTrades = useMemo<EnrichedTradeProposal[]>(
    () =>
      pendingTrades.map((proposal) => {
        const fromPlayer = playersById.get(proposal.fromPlayerId) ?? null;
        const toPlayer = playersById.get(proposal.toPlayerId) ?? null;
        return {
          proposal,
          fromTeam: teamsById.get(proposal.fromTeamId) ?? null,
          toTeam: teamsById.get(proposal.toTeamId) ?? null,
          fromPlayer,
          toPlayer,
          fromOverall: getPlayerOverall(fromPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
          toOverall: getPlayerOverall(toPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
          fromPotential: getPlayerPotential(fromPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
          toPotential: getPlayerPotential(toPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
        };
      }),
    [battingRatingsByPlayerId, pendingTrades, pitchingRatingsByPlayerId, playersById, teamsById],
  );
  const blockbusterCount = useMemo(
    () => pendingTrades.reduce((count, proposal) => count + (proposal.isBlockbuster ? 1 : 0), 0),
    [pendingTrades],
  );
  const tradeHistory = useMemo<TradeHistoryEntry[]>(() => {
    const tradeTransactions = transactions
      .filter((transaction) => transaction.eventType === 'traded')
      .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate));

    const usedIndexes = new Set<number>();
    const entries: TradeHistoryEntry[] = [];

    for (let index = 0; index < tradeTransactions.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue;
      }

      const transaction = tradeTransactions[index];
      const player = playersById.get(transaction.playerId) ?? null;
      const playerLabel = getPlayerLabel(player);
      const fromTeam = transaction.fromTeamId ? teamsById.get(transaction.fromTeamId) ?? null : null;
      const toTeam = transaction.toTeamId ? teamsById.get(transaction.toTeamId) ?? null : null;
      const expectedReturn = stripSwapPrefix(transaction.notes);

      let partnerIndex = -1;
      for (let candidateIndex = index + 1; candidateIndex < tradeTransactions.length; candidateIndex += 1) {
        if (usedIndexes.has(candidateIndex)) {
          continue;
        }

        const candidate = tradeTransactions[candidateIndex];
        if (
          candidate.effectiveDate !== transaction.effectiveDate
          || candidate.fromTeamId !== transaction.toTeamId
          || candidate.toTeamId !== transaction.fromTeamId
        ) {
          continue;
        }

        const candidatePlayer = playersById.get(candidate.playerId) ?? null;
        const candidateLabel = getPlayerLabel(candidatePlayer);
        const candidateExpectedReturn = stripSwapPrefix(candidate.notes);
        const matchesNotes = (!expectedReturn || expectedReturn === candidateLabel) && (!candidateExpectedReturn || candidateExpectedReturn === playerLabel);

        if (matchesNotes) {
          partnerIndex = candidateIndex;
          break;
        }
      }

      usedIndexes.add(index);

      if (partnerIndex >= 0) {
        usedIndexes.add(partnerIndex);
        const partner = tradeTransactions[partnerIndex];
        const partnerPlayer = playersById.get(partner.playerId) ?? null;
        const fromLabel = getTeamLabel(fromTeam, transaction.fromTeamId);
        const toLabel = getTeamLabel(toTeam, transaction.toTeamId);

        entries.push({
          id: `${transaction.effectiveDate}:${transaction.playerId}:${partner.playerId}`,
          effectiveDate: transaction.effectiveDate,
          headline: `${fromLabel} traded ${playerLabel} to ${toLabel} for ${getPlayerLabel(partnerPlayer)}`,
          detail: `${fromLabel} and ${toLabel} completed a one-for-one swap.`,
        });
      } else {
        entries.push({
          id: `${transaction.effectiveDate}:${transaction.playerId}:${index}`,
          effectiveDate: transaction.effectiveDate,
          headline: `${playerLabel} moved from ${getTeamLabel(fromTeam, transaction.fromTeamId)} to ${getTeamLabel(toTeam, transaction.toTeamId)}`,
          detail: transaction.notes ?? 'Trade approved by the commissioner.',
        });
      }

      if (entries.length >= TRADE_HISTORY_LIMIT) {
        break;
      }
    }

    return entries;
  }, [playersById, teamsById, transactions]);

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">Trades</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-caption text-[var(--color-ink-dim)]">{currentDate || 'LEAGUE OFFICE'}</span>
            <RetroButton variant="primary" onClick={onRefreshBoard}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Refresh Board
            </RetroButton>
          </div>
        </div>
        <p className="p-4 t-body text-[var(--color-ink-dim)]">
          This board is for approvals only. Clubs float one-for-one deals, the market heats up
          toward the deadline, and you decide which swaps actually reshape the league.
        </p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-3">
        <Panel className="p-4">
          <p className="t-caption text-[var(--color-ink-faint)]">PENDING DEALS</p>
          <StatValue size="lg" className="mt-1 block">{pendingTrades.length}</StatValue>
        </Panel>
        <Panel className="p-4">
          <p className="t-caption text-[var(--color-ink-faint)]">BLOCKBUSTERS</p>
          <StatValue size="lg" variant="accent" className="mt-1 block">{blockbusterCount}</StatValue>
        </Panel>
        <Panel className="p-4">
          <p className="t-caption text-[var(--color-ink-faint)]">COMMISSIONER NOTES</p>
          <p className="t-caption mt-1 text-[var(--color-ink-dim)]">
            Buyers chase upgrades. Sellers chase upside. Stars only move when the market pressure is real.
          </p>
        </Panel>
      </div>

      {enrichedTrades.length === 0 ? (
        <Panel className="flex flex-col items-center gap-3 p-10 text-center">
          <ArrowLeftRight className="h-9 w-9 text-[var(--color-gold)]" aria-hidden="true" />
          <p className="t-h2">Quiet Trade Market</p>
          <p className="t-body max-w-md text-[var(--color-ink-dim)]">
            No clubs have reached the commissioner with a strong enough one-for-one proposal right
            now. That is normal early in the season.
          </p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {enrichedTrades.map((trade) => (
            <TradeProposalCard
              key={trade.proposal.proposalId}
              trade={trade}
              onApproveTrade={onApproveTrade}
              onVetoTrade={onVetoTrade}
            />
          ))}
        </div>
      )}

      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-end justify-between gap-3 px-4">
          <h2 className="t-h3">Trade History</h2>
          <p className="t-caption text-[var(--color-ink-faint)]">
            Approved swaps are logged here so you can review the market without leaving the desk.
          </p>
        </div>
        {tradeHistory.length === 0 ? (
          <p className="p-4 t-body text-[var(--color-ink-dim)]">
            No trades have been approved yet. Once a deal goes through, it will appear here.
          </p>
        ) : (
          <div className="flex flex-col gap-1 p-3">
            {tradeHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-chrome-lo)] px-2 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="t-stat-sm">{entry.headline}</p>
                  <p className="t-caption text-[var(--color-ink-faint)]">{entry.detail}</p>
                </div>
                <span className="t-caption shrink-0 text-[var(--color-ink-dim)]">{formatTradeDate(entry.effectiveDate)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </section>
  );
};
