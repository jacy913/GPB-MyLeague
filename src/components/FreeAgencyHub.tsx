import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Star } from 'lucide-react';
import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerTransaction,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { buildFreeAgencyMarketEntries, FreeAgentMarketEntry, FreeAgencyOfferCard } from '../logic/freeAgencyLogic';
import { TeamLogo } from './TeamLogo';

interface FreeAgencyHubProps {
  teams: Team[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  rosterSlots: TeamRosterSlot[];
  transactions: PlayerTransaction[];
  currentDate: string;
  freeAgencyOpenDate: string;
  isMarketOpen: boolean;
  marketStatusMessage: string;
  seasonComplete: boolean;
  onAssignPlayer: (assignment: {
    playerId: string;
    teamId: string;
    slotCode: RosterSlotCode;
    contractYearsLeft: number;
    isQualifyingOffer?: boolean;
  }) => void;
  onExit: () => void;
}

type OfferCard = FreeAgencyOfferCard;
type FreeAgentEntry = FreeAgentMarketEntry;

type PreviewSlot = {
  slotCode: RosterSlotCode;
  displayLabel: string;
  playerName: string;
  overall: number | null;
  highlighted: boolean;
  dropped: boolean;
};

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#242424,#101010)]';

const getLatestSeasonYear = (rosterSlots: TeamRosterSlot[]): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : new Date().getUTCFullYear();

const getLatestBattingRatings = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const next = new Map<string, PlayerBattingRatings>();
  [...ratings].sort((left, right) => right.seasonYear - left.seasonYear).forEach((rating) => {
    if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
  });
  return next;
};

const getLatestPitchingRatings = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const next = new Map<string, PlayerPitchingRatings>();
  [...ratings].sort((left, right) => right.seasonYear - left.seasonYear).forEach((rating) => {
    if (!next.has(rating.playerId)) next.set(rating.playerId, rating);
  });
  return next;
};

const getPreviewOrder = (slotCode: RosterSlotCode): RosterSlotCode[] => {
  if (slotCode.startsWith('SP')) return [...STARTING_PITCHER_SLOTS];
  if (slotCode === 'CL' || slotCode.startsWith('RP')) return [...BULLPEN_ROSTER_SLOTS];
  return [...BATTING_ROSTER_SLOTS];
};

const buildPreviewSlots = (
  order: RosterSlotCode[],
  teamId: string,
  offer: OfferCard,
  freeAgent: FreeAgentEntry,
  activeRosterSlots: TeamRosterSlot[],
  playersById: Map<string, Player>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): PreviewSlot[] =>
  order.map((slotCode) => {
    const slot = activeRosterSlots.find((entry) => entry.teamId === teamId && entry.slotCode === slotCode) ?? null;
    const isTargetSlot = slotCode === offer.slotCode;
    const incumbent = slot ? playersById.get(slot.playerId) ?? null : null;
    const displayedPlayer = isTargetSlot ? freeAgent.player : incumbent;
    const overall = displayedPlayer
      ? battingRatingsByPlayerId.get(displayedPlayer.playerId)?.overall ?? pitchingRatingsByPlayerId.get(displayedPlayer.playerId)?.overall ?? null
      : null;

    return {
      slotCode,
      displayLabel: slotCode,
      playerName: displayedPlayer ? `${displayedPlayer.firstName} ${displayedPlayer.lastName}` : 'Open slot',
      overall,
      highlighted: isTargetSlot,
      dropped: Boolean(isTargetSlot && incumbent),
    };
  });

export const FreeAgencyHub: React.FC<FreeAgencyHubProps> = ({
  teams,
  players,
  battingRatings,
  pitchingRatings,
  battingStats,
  pitchingStats,
  rosterSlots,
  transactions,
  currentDate,
  freeAgencyOpenDate,
  isMarketOpen,
  marketStatusMessage,
  seasonComplete,
  onAssignPlayer,
  onExit,
}) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingOffer, setPendingOffer] = useState<OfferCard | null>(null);

  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const battingRatingsByPlayerId = useMemo(() => getLatestBattingRatings(battingRatings), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => getLatestPitchingRatings(pitchingRatings), [pitchingRatings]);
  const latestSeasonYear = useMemo(() => getLatestSeasonYear(rosterSlots), [rosterSlots]);
  const activeRosterSlots = useMemo(() => rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear), [latestSeasonYear, rosterSlots]);

  const freeAgents = useMemo<FreeAgentEntry[]>(
    () =>
      buildFreeAgencyMarketEntries(
        teams,
        players,
        battingRatings,
        pitchingRatings,
        battingStats,
        pitchingStats,
        rosterSlots,
        transactions,
      ),
    [battingRatings, battingStats, pitchingRatings, pitchingStats, players, rosterSlots, teams, transactions],
  );

  useEffect(() => {
    if (freeAgents.length === 0) {
      setSelectedPlayerId(null);
      setPendingOffer(null);
      return;
    }
    const hasSelectedPlayer = selectedPlayerId ? freeAgents.some((entry) => entry.player.playerId === selectedPlayerId) : false;
    if (!hasSelectedPlayer) setSelectedPlayerId(freeAgents[0].player.playerId);
  }, [freeAgents, selectedPlayerId]);

  const selectedFreeAgent = useMemo(
    () => freeAgents.find((entry) => entry.player.playerId === selectedPlayerId) ?? freeAgents[0] ?? null,
    [freeAgents, selectedPlayerId],
  );

  useEffect(() => {
    if (!pendingOffer || !selectedFreeAgent) return;
    const stillValid = selectedFreeAgent.offers.some((offer) => offer.team.id === pendingOffer.team.id && offer.slotCode === pendingOffer.slotCode);
    if (!stillValid) setPendingOffer(null);
  }, [pendingOffer, selectedFreeAgent]);

  const previewSlots = useMemo(() => {
    if (!pendingOffer || !selectedFreeAgent) return [];
    return buildPreviewSlots(
      getPreviewOrder(pendingOffer.slotCode),
      pendingOffer.team.id,
      pendingOffer,
      selectedFreeAgent,
      activeRosterSlots,
      playersById,
      battingRatingsByPlayerId,
      pitchingRatingsByPlayerId,
    );
  }, [activeRosterSlots, battingRatingsByPlayerId, pendingOffer, pitchingRatingsByPlayerId, playersById, selectedFreeAgent]);

  const displacedPlayer = useMemo(() => {
    if (!pendingOffer) return null;
    const slot = activeRosterSlots.find((entry) => entry.teamId === pendingOffer.team.id && entry.slotCode === pendingOffer.slotCode) ?? null;
    return slot ? playersById.get(slot.playerId) ?? null : null;
  }, [activeRosterSlots, pendingOffer, playersById]);

  return (
    <section className="space-y-6">
      <article className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Desk</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Free Agency</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Run the market from one board. Valuable free agents draw real interest, fringe names wait, and every signing forces a roster cut at the target slot.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#e8d79d]">
              {seasonComplete ? 'Open Market Window' : 'Commissioner Access'}
            </div>
            <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
              {currentDate || 'Offseason'}
            </div>
            <button
              onClick={onExit}
              className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
            >
              Exit Hub
            </button>
          </div>
        </div>
      </article>

      {selectedFreeAgent ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(540px,1.1fr)_minmax(400px,0.9fr)]">
          <section className={`${sectionClass} overflow-hidden`}>
            <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(212,187,106,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(15,231,213,0.14),transparent_36%)] px-6 py-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">Open Market Board</p>
                  <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">Available Free Agents</p>
                </div>
                <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                  {freeAgents.length} on market
                </div>
              </div>
            </div>

            <div className="max-h-[72vh] overflow-x-auto overflow-y-auto p-4 scrollbar-subtle">
              <table className="min-w-full border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-left">
                    <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Player</th>
                    <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Pos</th>
                    <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">OVR</th>
                    <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Offer Interest</th>
                  </tr>
                </thead>
                <tbody>
                  {freeAgents.map((entry) => {
                    const selected = entry.player.playerId === selectedFreeAgent.player.playerId;
                    const offerTeams: Team[] = Array.from(
                      new Map<string, Team>(entry.offers.map((offer) => [offer.team.id, offer.team] as const)).values(),
                    );
                    const visibleOfferTeams = offerTeams.slice(0, 6);
                    const hiddenOfferTeamCount = Math.max(offerTeams.length - visibleOfferTeams.length, 0);

                    return (
                      <tr
                        key={entry.player.playerId}
                        className={`cursor-pointer rounded-2xl border transition-colors ${
                          selected ? 'border-[#d4bb6a]/40 bg-[#d4bb6a]/10' : 'border-white/10 bg-black/20 hover:border-white/20'
                        }`}
                        onClick={() => {
                          setSelectedPlayerId(entry.player.playerId);
                          setPendingOffer(null);
                        }}
                      >
                        <td className="rounded-l-2xl px-4 py-4">
                          <p className="font-headline text-2xl uppercase tracking-[0.06em] text-white">
                            {entry.player.firstName} {entry.player.lastName}
                          </p>
                          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                            Age {entry.player.age} | {entry.player.bats}/{entry.player.throws}
                          </p>
                        </td>
                        <td className="px-4 py-4 font-mono text-sm uppercase tracking-[0.16em] text-zinc-300">{entry.player.primaryPosition}</td>
                        <td className="px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-[#ecd693]">{entry.overall}</td>
                        <td className="rounded-r-2xl px-4 py-4">
                          {offerTeams.length === 0 ? (
                            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">No offers</p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              {visibleOfferTeams.map((team) => (
                                <div
                                  key={`${entry.player.playerId}-${team.id}`}
                                  className="rounded-xl border border-white/10 bg-white/[0.03] p-1.5"
                                  title={`${team.city} ${team.name}`}
                                >
                                  <TeamLogo team={team} sizeClass="h-7 w-7" />
                                </div>
                              ))}
                              {hiddenOfferTeamCount > 0 && (
                                <div className="rounded-full border border-[#d4bb6a]/30 bg-[#d4bb6a]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#ecd693]">
                                  +{hiddenOfferTeamCount}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${sectionClass} p-6`}>
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Offer Board</p>
                  <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">Interested Teams</p>
                </div>
                <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                  Up to 6 bids
                </div>
              </div>

              <div className="mt-6 max-h-[58vh] space-y-4 overflow-y-auto pr-1 scrollbar-subtle">
                {selectedFreeAgent.offers.length === 0 ? (
                  <div className="rounded-[1.75rem] border border-dashed border-white/10 bg-black/20 p-8 text-center">
                    <p className="font-headline text-3xl uppercase tracking-[0.08em] text-white">No viable bidders</p>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">
                      This player is not valuable enough to force an active signing right now.
                    </p>
                  </div>
                ) : (
                  selectedFreeAgent.offers.map((offer, index) => (
                    <article key={`${offer.team.id}-${offer.slotCode}`} className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5 transition-colors hover:border-[#d4bb6a]/35">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                            <TeamLogo team={offer.team} sizeClass="h-16 w-16" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Offer {index + 1}</p>
                            <p className="mt-1 truncate font-headline text-3xl uppercase tracking-[0.08em] text-white">
                              {offer.team.city} {offer.team.name}
                            </p>
                            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                              {offer.team.league} {offer.team.division} | {offer.slotCode} | {offer.slotLabel}
                            </p>
                            {offer.isQualifyingOffer && (
                              <p className="mt-2 inline-flex rounded-full border border-cyan-300/35 bg-cyan-500/15 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-100">
                                Qualifying Offer
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-headline text-3xl uppercase tracking-[0.08em] text-[#ecd693]">
                            {offer.contractYears}
                          </p>
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                            Year{offer.contractYears === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div className="space-y-3">
                          <p className="text-sm leading-6 text-zinc-300">{offer.note}</p>
                          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                            {offer.incumbentName
                              ? `Cut candidate: ${offer.incumbentName}${offer.incumbentOverall ? ` | ${offer.incumbentOverall} OVR` : ''}`
                              : 'Cut candidate: open roster spot'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingOffer(offer)}
                          disabled={!isMarketOpen}
                          className="inline-flex items-center gap-2 rounded-2xl border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.22),rgba(212,187,106,0.08))] px-5 py-3 font-headline text-xl uppercase tracking-[0.08em] text-white transition-colors hover:border-[#d4bb6a]/60 hover:bg-[linear-gradient(135deg,rgba(212,187,106,0.3),rgba(212,187,106,0.12))] disabled:opacity-50"
                        >
                          Sign
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className={`${sectionClass} p-10 text-center`}>
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-black/20">
            <BriefcaseBusiness className="h-9 w-9 text-[#ecd693]" />
          </div>
          <p className="mt-6 font-headline text-4xl uppercase tracking-[0.06em] text-white">No free agents available</p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            The market is empty right now. Re-enter when new players are released or when the offseason opens.
          </p>
        </section>
      )}

      {pendingOffer && selectedFreeAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-[2rem] border border-white/10 bg-[linear-gradient(145deg,#111111,#191919,#0b0b0b)] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Signing Preview</p>
                <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">
                  {pendingOffer.team.city} {pendingOffer.team.name}
                </p>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                  {selectedFreeAgent.player.firstName} {selectedFreeAgent.player.lastName} to {pendingOffer.slotCode}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                  {pendingOffer.contractYears} year{pendingOffer.contractYears === 1 ? '' : 's'}
                </div>
                <button
                  type="button"
                  onClick={() => setPendingOffer(null)}
                  className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                      {pendingOffer.slotCode.startsWith('SP')
                        ? 'Projected Rotation'
                        : pendingOffer.slotCode === 'CL' || pendingOffer.slotCode.startsWith('RP')
                          ? 'Projected Bullpen'
                          : 'Projected Batting Order'}
                    </p>
                    <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-white">Post-Signing Depth</p>
                  </div>
                  <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                    {pendingOffer.slotCode}
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  {previewSlots.map((slot) => (
                    <div
                      key={slot.slotCode}
                      className={`grid gap-3 rounded-2xl border px-4 py-4 md:grid-cols-[80px_minmax(0,1fr)_auto] md:items-center ${
                        slot.highlighted ? 'border-[#d4bb6a]/45 bg-[#d4bb6a]/10' : 'border-white/10 bg-white/[0.03]'
                      }`}
                    >
                      <div className="font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">{slot.displayLabel}</div>
                      <div>
                        <p className="font-headline text-2xl uppercase tracking-[0.06em] text-white">{slot.playerName}</p>
                        {slot.dropped && (
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#f59e0b]">This move cuts the current occupant.</p>
                        )}
                      </div>
                      <div className="font-headline text-2xl uppercase tracking-[0.06em] text-[#ecd693]">{slot.overall ?? '--'}</div>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="space-y-4">
                <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
                  <div className="flex items-center gap-3">
                    <TeamLogo team={pendingOffer.team} sizeClass="h-14 w-14" />
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Signing Team</p>
                      <p className="mt-1 font-headline text-2xl uppercase tracking-[0.06em] text-white">
                        {pendingOffer.team.city} {pendingOffer.team.name}
                      </p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-zinc-300">{pendingOffer.note}</p>
                  {pendingOffer.isQualifyingOffer && (
                    <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-200">
                      This is a qualifying-offer reunion path.
                    </p>
                  )}
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    Proposed term: {pendingOffer.contractYears} year{pendingOffer.contractYears === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="rounded-[1.75rem] border border-white/10 bg-black/20 p-5">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Roster Fallout</p>
                  <p className="mt-3 font-headline text-2xl uppercase tracking-[0.06em] text-white">
                    {displacedPlayer ? `${displacedPlayer.firstName} ${displacedPlayer.lastName}` : 'No cut required'}
                  </p>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    {displacedPlayer
                      ? `${pendingOffer.slotCode} spot will be cleared immediately${pendingOffer.incumbentOverall ? ` | ${pendingOffer.incumbentOverall} OVR waived` : ''}`
                      : 'Open slot available'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onAssignPlayer({
                      playerId: selectedFreeAgent.player.playerId,
                      teamId: pendingOffer.team.id,
                      slotCode: pendingOffer.slotCode,
                      contractYearsLeft: pendingOffer.contractYears,
                      isQualifyingOffer: pendingOffer.isQualifyingOffer,
                    });
                    setPendingOffer(null);
                  }}
                  disabled={!isMarketOpen}
                  className="flex w-full items-center justify-center gap-2 rounded-[1.5rem] border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.26),rgba(212,187,106,0.1))] px-5 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-white transition-colors hover:border-[#d4bb6a]/60 hover:bg-[linear-gradient(135deg,rgba(212,187,106,0.34),rgba(212,187,106,0.14))] disabled:opacity-50"
                >
                  Sign Player
                  <ArrowRight className="h-5 w-5" />
                </button>
              </aside>
            </div>
          </div>
        </div>
      )}

      {!isMarketOpen && (
        <section className={`${sectionClass} p-5`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Market Status</p>
          <p className="mt-2 font-headline text-2xl uppercase tracking-[0.06em] text-white">Free Agency Locked</p>
          <p className="mt-3 text-sm leading-6 text-zinc-400">
            {marketStatusMessage || `Free agency opens on ${freeAgencyOpenDate}. This screen is view-only until then.`}
          </p>
        </section>
      )}

      {freeAgents.length > 0 && (
        <section className={`${sectionClass} p-5`}>
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-prestige" />
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Market Summary</p>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Active Bidders</p>
              <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-white">
                {freeAgents.filter((entry) => entry.offers.length > 0).length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Players Waiting</p>
              <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-white">
                {freeAgents.filter((entry) => entry.offers.length === 0).length}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Total Offers</p>
              <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-[#ecd693]">
                {freeAgents.reduce((total, entry) => total + entry.offers.length, 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Top Free Agent</p>
              <p className="mt-2 font-headline text-3xl uppercase tracking-[0.06em] text-white">
                {freeAgents[0] ? `${freeAgents[0].player.lastName}` : '--'}
              </p>
            </div>
          </div>
        </section>
      )}
    </section>
  );
};
