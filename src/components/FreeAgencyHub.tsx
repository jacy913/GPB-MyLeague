import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, ShieldAlert, Sparkles, Star } from 'lucide-react';
import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { formatBattingAverage } from '../logic/statFormatting';
import { TeamLogo } from './TeamLogo';

interface FreeAgencyHubProps {
  teams: Team[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  rosterSlots: TeamRosterSlot[];
  currentDate: string;
  seasonComplete: boolean;
  onAssignPlayer: (assignment: { playerId: string; teamId: string; slotCode: RosterSlotCode; contractYearsLeft: number }) => void;
  onExit: () => void;
}

type OfferCard = {
  team: Team;
  slotCode: RosterSlotCode;
  slotLabel: string;
  interest: number;
  contractYears: number;
  incumbentName: string | null;
  incumbentOverall: number | null;
  note: string;
};

type FreeAgentEntry = {
  player: Player;
  overall: number;
  batting: PlayerBattingRatings | null;
  pitching: PlayerPitchingRatings | null;
  battingStat: PlayerSeasonBatting | null;
  pitchingStat: PlayerSeasonPitching | null;
  marketValue: number;
  offers: OfferCard[];
};

type PreviewSlot = {
  slotCode: RosterSlotCode;
  displayLabel: string;
  playerName: string;
  overall: number | null;
  highlighted: boolean;
  dropped: boolean;
};

const sectionClass = 'rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#242424,#101010)]';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const getLatestSeasonYear = (rosterSlots: TeamRosterSlot[]): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : new Date().getUTCFullYear();

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

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

const formatPitchingLine = (stat: PlayerSeasonPitching | null): string =>
  stat ? `${stat.era.toFixed(2)} ERA | ${stat.whip.toFixed(2)} WHIP | ${stat.strikeouts} K` : 'No pro line yet';

const formatBattingLine = (stat: PlayerSeasonBatting | null): string =>
  stat ? `${formatBattingAverage(stat.avg)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI` : 'No pro line yet';

const getRosterSlotLabel = (slotCode: RosterSlotCode): string => {
  if (slotCode.startsWith('SP')) return 'Rotation';
  if (slotCode.startsWith('RP')) return 'Bullpen';
  if (slotCode === 'CL') return 'Closer';
  return `${slotCode} lineup`;
};

const getBattingFormValue = (stat: PlayerSeasonBatting | null): number => {
  if (!stat || stat.atBats < 25) return 0;
  const avgBoost = clamp((stat.avg - 0.245) * 220, -10, 14);
  const opsBoost = clamp((stat.ops - 0.72) * 30, -8, 12);
  const powerBoost = clamp(stat.homeRuns * 0.35, 0, 8);
  return avgBoost + opsBoost + powerBoost;
};

const getPitchingFormValue = (stat: PlayerSeasonPitching | null): number => {
  if (!stat || stat.inningsPitched < 12) return 0;
  const eraBoost = clamp((4.15 - stat.era) * 3.2, -10, 14);
  const whipBoost = clamp((1.28 - stat.whip) * 16, -8, 10);
  const strikeoutBoost = clamp(stat.strikeouts / Math.max(stat.inningsPitched, 1) * 6 - 4.5, -4, 6);
  return eraBoost + whipBoost + strikeoutBoost;
};

const getMarketValue = (entry: Omit<FreeAgentEntry, 'marketValue' | 'offers'>): number =>
  entry.player.playerType === 'pitcher'
    ? entry.overall + getPitchingFormValue(entry.pitchingStat) - Math.max(entry.player.age - 32, 0) * 0.6
    : entry.overall + getBattingFormValue(entry.battingStat) - Math.max(entry.player.age - 33, 0) * 0.55;

const getPreviewOrder = (slotCode: RosterSlotCode): RosterSlotCode[] => {
  if (slotCode.startsWith('SP')) return [...STARTING_PITCHER_SLOTS];
  if (slotCode === 'CL' || slotCode.startsWith('RP')) return [...BULLPEN_ROSTER_SLOTS];
  return [...BATTING_ROSTER_SLOTS];
};

const getOfferContractYears = (player: Player, overall: number): number => {
  if (player.age <= 24) return overall >= 80 ? 5 : 4;
  if (player.age <= 27) return overall >= 78 ? 5 : 4;
  if (player.age <= 30) return overall >= 82 ? 4 : 3;
  if (player.age <= 33) return overall >= 80 ? 3 : 2;
  if (player.age <= 36) return 2;
  return 1;
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

const buildOfferBoard = (
  freeAgent: Omit<FreeAgentEntry, 'marketValue' | 'offers'> & { marketValue: number },
  teams: Team[],
  activeRosterSlots: TeamRosterSlot[],
  playersById: Map<string, Player>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): OfferCard[] => {
  if (freeAgent.marketValue < 72 || freeAgent.overall < 68) return [];

  const candidateSlots =
    freeAgent.player.primaryPosition === 'SP'
      ? STARTING_PITCHER_SLOTS
      : freeAgent.player.primaryPosition === 'RP'
        ? BULLPEN_ROSTER_SLOTS.filter((slot) => slot !== 'CL')
        : freeAgent.player.primaryPosition === 'CL'
          ? ['CL']
          : [freeAgent.player.primaryPosition];

  const results: OfferCard[] = [];

  teams.forEach((team) => {
    let bestOffer: OfferCard | null = null;

    candidateSlots.forEach((slotCode) => {
      const slot = activeRosterSlots.find((entry) => entry.teamId === team.id && entry.slotCode === slotCode) ?? null;
      const incumbent = slot ? playersById.get(slot.playerId) ?? null : null;
      const incumbentOverall = incumbent
        ? battingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? pitchingRatingsByPlayerId.get(incumbent.playerId)?.overall ?? 0
        : 0;
      const vacancyBonus = slot ? 0 : 26;
      const weaknessBonus = Math.max(0, 76 - incumbentOverall) * 1.7;
      const upgradeBonus = Math.max(0, freeAgent.overall - incumbentOverall) * 2.35;
      const marketBonus = Math.max(0, freeAgent.marketValue - 72) * 1.25;
      const competitiveBonus = getWinPct(team) * 12;
      const score = vacancyBonus + weaknessBonus + upgradeBonus + marketBonus + competitiveBonus;

      if (score < 34) return;

      const interest = clamp(Math.round(28 + score * 0.82), 0, 99);
      const note = vacancyBonus > 0
        ? `${team.city} have an open ${getRosterSlotLabel(slotCode).toLowerCase()} and can move immediately.`
        : incumbentOverall <= 70
          ? `${team.city} see a weak spot at ${slotCode} and would cut the current option for an upgrade.`
          : `${team.city} view ${freeAgent.player.lastName} as a meaningful talent bump over ${incumbent?.lastName ?? 'their current option'} at ${slotCode}.`;

      const candidate: OfferCard = {
        team,
        slotCode,
        slotLabel: getRosterSlotLabel(slotCode),
        interest,
        contractYears: getOfferContractYears(freeAgent.player, freeAgent.overall),
        incumbentName: incumbent ? `${incumbent.firstName} ${incumbent.lastName}` : null,
        incumbentOverall: incumbent ? incumbentOverall : null,
        note,
      };

      if (!bestOffer || candidate.interest > bestOffer.interest) bestOffer = candidate;
    });

    if (bestOffer) results.push(bestOffer);
  });

  return results.sort((left, right) => right.interest - left.interest).slice(0, 6);
};

export const FreeAgencyHub: React.FC<FreeAgencyHubProps> = ({
  teams,
  players,
  battingRatings,
  pitchingRatings,
  battingStats,
  pitchingStats,
  rosterSlots,
  currentDate,
  seasonComplete,
  onAssignPlayer,
  onExit,
}) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pendingOffer, setPendingOffer] = useState<OfferCard | null>(null);

  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const battingRatingsByPlayerId = useMemo(() => getLatestBattingRatings(battingRatings), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => getLatestPitchingRatings(pitchingRatings), [pitchingRatings]);
  const battingStatsByPlayerId = useMemo(() => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'), [battingStats]);
  const pitchingStatsByPlayerId = useMemo(() => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'), [pitchingStats]);
  const latestSeasonYear = useMemo(() => getLatestSeasonYear(rosterSlots), [rosterSlots]);
  const activeRosterSlots = useMemo(() => rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear), [latestSeasonYear, rosterSlots]);

  const freeAgents = useMemo<FreeAgentEntry[]>(() => {
    const baseEntries = players.filter((player) => player.status === 'free_agent').map((player) => {
      const batting = battingRatingsByPlayerId.get(player.playerId) ?? null;
      const pitching = pitchingRatingsByPlayerId.get(player.playerId) ?? null;
      const overall = batting?.overall ?? pitching?.overall ?? 0;
      const battingStat = battingStatsByPlayerId.get(player.playerId) ?? null;
      const pitchingStat = pitchingStatsByPlayerId.get(player.playerId) ?? null;
      return { player, overall, batting, pitching, battingStat, pitchingStat };
    });

    return baseEntries.map((entry) => {
      const marketValue = getMarketValue(entry);
      return {
        ...entry,
        marketValue,
        offers: buildOfferBoard({ ...entry, marketValue }, teams, activeRosterSlots, playersById, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
      };
    }).sort((left, right) => {
      const offerGap = right.offers.length - left.offers.length;
      if (offerGap !== 0) return offerGap;
      return right.overall - left.overall || left.player.lastName.localeCompare(right.player.lastName);
    });
  }, [activeRosterSlots, battingRatingsByPlayerId, battingStatsByPlayerId, pitchingRatingsByPlayerId, pitchingStatsByPlayerId, players, playersById, teams]);

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
                    <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Season Line</th>
                    <th className="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Offers</th>
                  </tr>
                </thead>
                <tbody>
                  {freeAgents.map((entry) => {
                    const selected = entry.player.playerId === selectedFreeAgent.player.playerId;

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
                        <td className="px-4 py-4 font-mono text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                          {entry.player.playerType === 'pitcher' ? formatPitchingLine(entry.pitchingStat) : formatBattingLine(entry.battingStat)}
                        </td>
                        <td className="rounded-r-2xl px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-white">
                          {entry.offers.length}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={`${sectionClass} p-6`}>
            <div className="rounded-[1.75rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(212,187,106,0.22),transparent_42%),rgba(0,0,0,0.18)] p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">Selected Free Agent</p>
                  <p className="mt-3 font-headline text-5xl uppercase tracking-[0.06em] text-white">
                    {selectedFreeAgent.player.firstName} {selectedFreeAgent.player.lastName}
                  </p>
                  <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-zinc-400">
                    {selectedFreeAgent.player.primaryPosition} | {selectedFreeAgent.player.playerType} | Age {selectedFreeAgent.player.age} | {selectedFreeAgent.player.bats}/{selectedFreeAgent.player.throws}
                  </p>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-black/30 px-5 py-4 text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Market Grade</p>
                  <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-[#ecd693]">{selectedFreeAgent.overall}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Overall</p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Season Line</p>
                  <p className="mt-3 font-mono text-sm uppercase tracking-[0.12em] text-zinc-200">
                    {selectedFreeAgent.player.playerType === 'pitcher'
                      ? formatPitchingLine(selectedFreeAgent.pitchingStat)
                      : formatBattingLine(selectedFreeAgent.battingStat)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Market Value</p>
                  <p className="mt-3 font-headline text-2xl uppercase tracking-[0.08em] text-white">{Math.round(selectedFreeAgent.marketValue)}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Decision Pressure</p>
                  <p className="mt-3 flex items-center gap-2 font-headline text-2xl uppercase tracking-[0.08em] text-[#ecd693]">
                    <Sparkles className="h-5 w-5" />
                    {selectedFreeAgent.offers.length} offers
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-black/20 p-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-prestige" />
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Market Read</p>
                </div>
                <p className="mt-3 text-sm leading-7 text-zinc-300">
                  {selectedFreeAgent.offers.length > 0
                    ? `${selectedFreeAgent.player.lastName} has a live market. The teams below see enough value to cut into an existing slot right now.`
                    : `${selectedFreeAgent.player.lastName} is not drawing active bids right now. Fringe market players will stay unsigned until a clearer roster need opens.`}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Offer Board</p>
                  <p className="mt-2 font-headline text-4xl uppercase tracking-[0.06em] text-white">Interested Teams</p>
                </div>
                <div className="rounded-full border border-white/10 bg-black/25 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
                  Up to 6 bids
                </div>
              </div>

              <div className="mt-6 space-y-4">
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
                          className="inline-flex items-center gap-2 rounded-2xl border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.22),rgba(212,187,106,0.08))] px-5 py-3 font-headline text-xl uppercase tracking-[0.08em] text-white transition-colors hover:border-[#d4bb6a]/60 hover:bg-[linear-gradient(135deg,rgba(212,187,106,0.3),rgba(212,187,106,0.12))]"
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
                    });
                    setPendingOffer(null);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-[1.5rem] border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.26),rgba(212,187,106,0.1))] px-5 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-white transition-colors hover:border-[#d4bb6a]/60 hover:bg-[linear-gradient(135deg,rgba(212,187,106,0.34),rgba(212,187,106,0.14))]"
                >
                  Sign Player
                  <ArrowRight className="h-5 w-5" />
                </button>
              </aside>
            </div>
          </div>
        </div>
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
