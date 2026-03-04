import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Check, RefreshCcw, ShieldAlert, UserRound, X } from 'lucide-react';
import {
  PendingTradeProposal,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  Team,
} from '../types';
import { TeamLogo } from './TeamLogo';

interface TradesHubProps {
  teams: Team[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  pendingTrades: PendingTradeProposal[];
  currentDate: string;
  onApproveTrade: (proposalId: string) => void | Promise<void>;
  onVetoTrade: (proposalId: string) => void | Promise<void>;
  onRefreshBoard: () => void;
}

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#232323,#0f0f0f)]';
const ACTION_FLASH_MS = 260;

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
      if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
    });
  return next;
};

const getLatestPitchingRatingsMap = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const next = new Map<string, PlayerPitchingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
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

export const TradesHub: React.FC<TradesHubProps> = ({
  teams,
  players,
  battingRatings,
  pitchingRatings,
  pendingTrades,
  currentDate,
  onApproveTrade,
  onVetoTrade,
  onRefreshBoard,
}) => {
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const battingRatingsByPlayerId = useMemo(() => getLatestBattingRatingsMap(battingRatings), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => getLatestPitchingRatingsMap(pitchingRatings), [pitchingRatings]);
  const blockbusterCount = pendingTrades.filter((proposal) => proposal.isBlockbuster).length;
  const [armedAction, setArmedAction] = useState<{ proposalId: string; action: 'approve' | 'veto' } | null>(null);
  const [resolvingAction, setResolvingAction] = useState<{ proposalId: string; action: 'approve' | 'veto' } | null>(null);

  useEffect(() => {
    if (!armedAction) {
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      setArmedAction((current) => (
        current?.proposalId === armedAction.proposalId && current.action === armedAction.action
          ? null
          : current
      ));
    }, 2200);

    return () => globalThis.clearTimeout(timeout);
  }, [armedAction]);

  useEffect(() => {
    const proposalIds = new Set(pendingTrades.map((proposal) => proposal.proposalId));
    if (armedAction && !proposalIds.has(armedAction.proposalId)) {
      setArmedAction(null);
    }
    if (resolvingAction && !proposalIds.has(resolvingAction.proposalId)) {
      setResolvingAction(null);
    }
  }, [armedAction, pendingTrades, resolvingAction]);

  const triggerTradeAction = async (proposalId: string, action: 'approve' | 'veto') => {
    if (resolvingAction) {
      return;
    }

    if (armedAction?.proposalId !== proposalId || armedAction.action !== action) {
      setArmedAction({ proposalId, action });
      return;
    }

    setArmedAction(null);
    setResolvingAction({ proposalId, action });

    await new Promise((resolve) => globalThis.setTimeout(resolve, ACTION_FLASH_MS));
    try {
      await Promise.resolve(action === 'approve' ? onApproveTrade(proposalId) : onVetoTrade(proposalId));
    } finally {
      setResolvingAction((current) => (current?.proposalId === proposalId ? null : current));
    }
  };

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

      {pendingTrades.length === 0 ? (
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
          {pendingTrades.map((proposal) => {
            const fromTeam = teamsById.get(proposal.fromTeamId) ?? null;
            const toTeam = teamsById.get(proposal.toTeamId) ?? null;
            const fromPlayer = playersById.get(proposal.fromPlayerId) ?? null;
            const toPlayer = playersById.get(proposal.toPlayerId) ?? null;
            const fromOverall = getPlayerOverall(fromPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
            const toOverall = getPlayerOverall(toPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
            const fromPotential = getPlayerPotential(fromPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
            const toPotential = getPlayerPotential(toPlayer, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
            const isApproving = resolvingAction?.proposalId === proposal.proposalId && resolvingAction.action === 'approve';
            const isVetoing = resolvingAction?.proposalId === proposal.proposalId && resolvingAction.action === 'veto';
            const isActionLocked = resolvingAction?.proposalId === proposal.proposalId;
            const approveArmed = armedAction?.proposalId === proposal.proposalId && armedAction.action === 'approve';
            const vetoArmed = armedAction?.proposalId === proposal.proposalId && armedAction.action === 'veto';
            const cardTone = isApproving
              ? 'border-emerald-400/45 bg-[linear-gradient(135deg,rgba(16,185,129,0.18),#232323,#0f0f0f)]'
              : isVetoing
                ? 'border-rose-400/45 bg-[linear-gradient(135deg,rgba(244,63,94,0.16),#232323,#0f0f0f)]'
                : sectionClass;

            return (
              <article key={proposal.proposalId} className={`${cardTone} overflow-hidden p-6 transition-[border-color,background] duration-300`}>
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
                        void triggerTradeAction(proposal.proposalId, 'approve');
                      }}
                      disabled={Boolean(resolvingAction)}
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
                        void triggerTradeAction(proposal.proposalId, 'veto');
                      }}
                      disabled={Boolean(resolvingAction)}
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
          })}
        </div>
      )}
    </section>
  );
};
