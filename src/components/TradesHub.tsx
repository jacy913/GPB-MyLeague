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
import { TeamLogo } from './TeamLogo';

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

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#232323,#0f0f0f)]';
const ACTION_FLASH_MS = 260;
const CARD_INTRINSIC_SIZE = '980px';
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
  const cardTone = isApproving
    ? 'border-emerald-400/45 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),#232323,#0f0f0f)]'
    : isVetoing
      ? 'border-rose-400/45 bg-[linear-gradient(135deg,rgba(244,63,94,0.16),#232323,#0f0f0f)]'
      : sectionClass;

  return (
    <article
      className={`${cardTone} overflow-hidden p-6 transition-[border-color,background] duration-300`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: CARD_INTRINSIC_SIZE }}
    >
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
              proposal.isBlockbuster
                ? 'border-[#d4bb6a]/35 bg-[#d4bb6a]/12 text-[#ecd693]'
                : 'border-white/10 bg-black/20 text-zinc-300'
            }`}>
              {getCategoryLabel(proposal.category)}
            </span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              Need: {proposal.needSlot}
            </span>
          </div>
          <p className="mt-3 font-headline text-4xl uppercase tracking-[0.06em] text-white">{proposal.summary}</p>
        </div>

        <div className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Synergy</p>
          <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-[#ecd693]">{proposal.synergy}%</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
        <section className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              {fromTeam ? <TeamLogo team={fromTeam} sizeClass="h-16 w-16" /> : <UserRound className="h-16 w-16 text-zinc-500" />}
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Seller Sends</p>
              <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">
                {fromTeam ? `${fromTeam.city} ${fromTeam.name}` : 'Unknown Team'}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-[120px_minmax(0,1fr)]">
            <div className="flex items-center justify-center rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-[#242424] to-[#111111] p-5">
              <UserRound className="h-16 w-16 text-zinc-500" />
            </div>
            <div>
              <p className="font-headline text-4xl uppercase tracking-[0.06em] text-white">
                {fromPlayer ? `${fromPlayer.firstName} ${fromPlayer.lastName}` : 'Unknown Player'}
              </p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                {fromPlayer ? `${fromPlayer.primaryPosition} | Age ${fromPlayer.age} | ${fromPlayer.bats}/${fromPlayer.throws}` : 'Roster data unavailable'}
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">OVR</p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{fromOverall}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Potential</p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{fromPotential}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Years Left</p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{fromPlayer?.contractYearsLeft ?? '--'}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-300">{proposal.fromTeamReason}</p>
            </div>
          </div>
        </section>

        <section className="flex flex-col items-center justify-center gap-5 rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(212,187,106,0.18),transparent_45%),rgba(0,0,0,0.22)] p-5">
          <div className="w-full rounded-full border border-white/10 bg-black/30 p-2">
            <div className="h-4 rounded-full bg-[linear-gradient(90deg,#ef4444_0%,#d4bb6a_55%,#10b981_100%)]" style={{ width: `${proposal.synergy}%` }} />
          </div>
          <div className="grid w-full gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Seller Ease</p>
              <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">{proposal.fromTeamInterest}%</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Buyer Ease</p>
              <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">{proposal.toTeamInterest}%</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void triggerTradeAction('approve');
            }}
            disabled={isActionLocked}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] transition-all ${
              isApproving
                ? 'border-emerald-400/55 bg-emerald-500/20 text-emerald-100'
                : approveArmed
                  ? 'border-emerald-400/45 bg-emerald-500/14 text-emerald-100'
                  : 'border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.25),rgba(212,187,106,0.09))] text-white hover:border-[#d4bb6a]/55'
            } disabled:cursor-not-allowed disabled:opacity-80`}
          >
            <Check className="h-5 w-5" />
            {isApproving ? 'Approved' : approveArmed ? 'Confirm Approve' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => {
              void triggerTradeAction('veto');
            }}
            disabled={isActionLocked}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] transition-all ${
              isVetoing
                ? 'border-rose-400/55 bg-rose-500/20 text-rose-100'
                : vetoArmed
                  ? 'border-rose-400/35 bg-rose-500/10 text-rose-100'
                  : 'border-white/10 bg-black/20 text-zinc-300 hover:border-white/20 hover:text-white'
            } disabled:cursor-not-allowed disabled:opacity-80`}
          >
            <X className="h-5 w-5" />
            {isVetoing ? 'Vetoed' : vetoArmed ? 'Confirm Veto' : 'Veto'}
          </button>
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center">
            <ShieldAlert className="mx-auto h-5 w-5 text-[#ecd693]" />
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Commissioner Call</p>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
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
        </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
          <div className="flex items-center gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              {toTeam ? <TeamLogo team={toTeam} sizeClass="h-16 w-16" /> : <UserRound className="h-16 w-16 text-zinc-500" />}
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Buyer Sends</p>
              <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">
                {toTeam ? `${toTeam.city} ${toTeam.name}` : 'Unknown Team'}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-[120px_minmax(0,1fr)]">
            <div className="flex items-center justify-center rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-[#242424] to-[#111111] p-5">
              <UserRound className="h-16 w-16 text-zinc-500" />
            </div>
            <div>
              <p className="font-headline text-4xl uppercase tracking-[0.06em] text-white">
                {toPlayer ? `${toPlayer.firstName} ${toPlayer.lastName}` : 'Unknown Player'}
              </p>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                {toPlayer ? `${toPlayer.primaryPosition} | Age ${toPlayer.age} | ${toPlayer.bats}/${toPlayer.throws}` : 'Roster data unavailable'}
              </p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">OVR</p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{toOverall}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Potential</p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{toPotential}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Years Left</p>
                  <p className="mt-2 font-headline text-3xl uppercase tracking-[0.08em] text-white">{toPlayer?.contractYearsLeft ?? '--'}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-zinc-300">{proposal.toTeamReason}</p>
            </div>
          </div>
        </section>
      </div>
    </article>
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
    <section className="space-y-6">
      <article className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Desk</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Trades</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              This board is for approvals only. Clubs float one-for-one deals, the market heats up toward the deadline, and you decide which swaps actually reshape the league.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
              {currentDate || 'League Office'}
            </div>
            <button
              type="button"
              onClick={onRefreshBoard}
              className="inline-flex items-center gap-2 rounded-full border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#ecd693] transition-colors hover:border-[#d4bb6a]/45"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh Board
            </button>
          </div>
        </div>
      </article>

      <section className="grid gap-4 md:grid-cols-3">
        <div className={`${sectionClass} p-5`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Pending Deals</p>
          <p className="mt-2 font-headline text-4xl uppercase tracking-[0.08em] text-white">{pendingTrades.length}</p>
        </div>
        <div className={`${sectionClass} p-5`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Blockbusters</p>
          <p className="mt-2 font-headline text-4xl uppercase tracking-[0.08em] text-[#ecd693]">{blockbusterCount}</p>
        </div>
        <div className={`${sectionClass} p-5`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Commissioner Notes</p>
          <p className="mt-2 text-sm leading-6 text-zinc-300">Buyers chase upgrades. Sellers chase upside. Stars only move when the market pressure is real.</p>
        </div>
      </section>

      {enrichedTrades.length === 0 ? (
        <section className={`${sectionClass} p-10 text-center`}>
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-black/20">
            <ArrowLeftRight className="h-9 w-9 text-[#ecd693]" />
          </div>
          <p className="mt-6 font-headline text-4xl uppercase tracking-[0.06em] text-white">Quiet Trade Market</p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            No clubs have reached the commissioner with a strong enough one-for-one proposal right now. That is normal early in the season.
          </p>
        </section>
      ) : (
        <div className="space-y-6">
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

      <section className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-2 border-b border-white/10 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Recent Ledger</p>
            <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">Trade History</p>
          </div>
          <p className="text-sm leading-6 text-zinc-400">Approved swaps are logged here so you can review the market without leaving the desk.</p>
        </div>

        {tradeHistory.length === 0 ? (
          <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-6 text-sm leading-6 text-zinc-400">
            No trades have been approved yet. Once a deal goes through, it will appear here.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {tradeHistory.map((entry) => (
              <article key={entry.id} className="rounded-[1.5rem] border border-white/10 bg-black/20 px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-headline text-2xl uppercase tracking-[0.05em] text-white">{entry.headline}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">{entry.detail}</p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-300">
                    {formatTradeDate(entry.effectiveDate)}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
};
