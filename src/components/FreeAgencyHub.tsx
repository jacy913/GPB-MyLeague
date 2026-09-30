import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Shuffle, Star, X } from 'lucide-react';
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
import { Panel, RetroButton, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';

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
  onShakeUp: () => void;
  onCompleteMarket?: () => void;
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

const StatTile: React.FC<{ label: string; value: string | number; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <p className={`t-stat-lg mt-0.5 truncate ${accent ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink)]'}`}>{value}</p>
  </div>
);

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

const faColumns: StatTableColumn[] = [
  { key: 'player', header: 'PLAYER' },
  { key: 'pos', header: 'POS', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'age', header: 'AGE', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'bat', header: 'B/T', align: 'right', isNumeric: true, width: '5ch' },
  { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '4ch' },
  { key: 'offers', header: 'OFFER INTEREST' },
];

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
  onShakeUp,
  onCompleteMarket,
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

  const faRows: StatTableRow[] = freeAgents.map((entry) => {
    const offerTeams: Team[] = Array.from(
      new Map<string, Team>(entry.offers.map((offer) => [offer.team.id, offer.team] as const)).values(),
    );
    const visibleOfferTeams = offerTeams.slice(0, 6);
    const hiddenOfferTeamCount = Math.max(offerTeams.length - visibleOfferTeams.length, 0);

    return {
      id: entry.player.playerId,
      cells: {
        player: (
          // No playerType subtitle. It restated what the POS column two cells
          // along already says, and it was the only reason this list needed a
          // two-line cell -- which is what made it the most cramped table in
          // the product. The name gets the full row height instead.
          <span className="block min-w-0 truncate t-stat">
            {entry.player.firstName} {entry.player.lastName}
          </span>
        ),
        pos: entry.player.primaryPosition,
        age: entry.player.age,
        bat: <span className="t-stat-sm text-[var(--color-ink-dim)]">{entry.player.bats}/{entry.player.throws}</span>,
        ovr: <StatValue size="sm" variant="accent">{entry.overall}</StatValue>,
        offers: offerTeams.length === 0 ? (
          <span className="t-stat-sm text-[var(--color-ink-faint)]">NO OFFERS</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {visibleOfferTeams.map((team) => (
              <TeamLogo key={`${entry.player.playerId}-${team.id}`} team={team} sizeClass="h-8 w-8" />
            ))}
            {hiddenOfferTeamCount > 0 && (
              <span className="t-caption text-[var(--color-gold)]">+{hiddenOfferTeamCount}</span>
            )}
          </span>
        ),
      },
    };
  });

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">Free Agency</h1>
          <div className="flex flex-wrap items-center gap-2">
            <RetroButton variant="primary" onClick={onShakeUp} disabled={!isMarketOpen || freeAgents.length === 0}
              title="Sign the best available upgrades, then allow released players to cascade to weaker rosters.">
              <Shuffle className="h-4 w-4" aria-hidden="true" /> Shake Up
            </RetroButton>
            {onCompleteMarket && (
              <RetroButton variant="default" onClick={onCompleteMarket}>
                Complete Free Agency
              </RetroButton>
            )}
            <RetroButton variant="ghost" onClick={onExit}>
              Exit Hub
            </RetroButton>
          </div>
        </div>
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <p className="t-body max-w-2xl text-[var(--color-ink-dim)]">
            Run the market from one board. Valuable free agents draw real interest, fringe names
            wait, and every signing forces a roster cut at the target slot.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Window" value={seasonComplete ? 'OPEN' : 'COMMISSIONER'} accent={isMarketOpen} />
            <StatTile label="Date" value={currentDate || 'OFFSEASON'} />
            <StatTile label="On Market" value={freeAgents.length} />
          </div>
        </div>
      </Panel>

      {selectedFreeAgent ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(540px,1.1fr)_minmax(400px,0.9fr)]">
          <Panel className="overflow-hidden">
            <div className="chrome-bar flex items-center justify-between gap-3 px-4">
              <h2 className="t-h3">Available Free Agents</h2>
              <span className="t-caption text-[var(--color-ink-faint)]">{freeAgents.length} ON MARKET</span>
            </div>
            <StatTable
              columns={faColumns}
              rows={faRows}
              density="dense"
              onRowSelect={(id) => {
                setSelectedPlayerId(String(id));
                setPendingOffer(null);
              }}
              selectedRowId={selectedFreeAgent.player.playerId}
              aria-label="Available free agents"
              className="max-h-[72vh] overflow-y-auto"
            />
          </Panel>

          <Panel className="overflow-hidden">
            <div className="chrome-bar flex items-center justify-between gap-3 px-4">
              <h2 className="t-h3">Interested Teams</h2>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {selectedFreeAgent.player.firstName} {selectedFreeAgent.player.lastName}
              </span>
            </div>
            <div className="flex max-h-[72vh] flex-col gap-2 overflow-y-auto p-3">
              {selectedFreeAgent.offers.length === 0 ? (
                <p className="t-body p-6 text-center text-[var(--color-ink-dim)]">
                  No viable bidders. This player is not valuable enough to force an active signing right now.
                </p>
              ) : (
                selectedFreeAgent.offers.map((offer, index) => (
                  <div
                    key={`${offer.team.id}-${offer.slotCode}`}
                    className="flex flex-col gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-3 transition-colors hover:border-[var(--color-gold)]"
                  >
                    <div className="flex items-start gap-3">
                      <TeamLogo team={offer.team} sizeClass="h-14 w-14" />
                      <div className="min-w-0 flex-1">
                        <p className="t-caption text-[var(--color-ink-faint)]">OFFER {index + 1}</p>
                        <p className="truncate t-h3">{offer.team.city} {offer.team.name}</p>
                        <p className="truncate t-caption text-[var(--color-ink-dim)]">
                          {offer.team.league} {offer.team.division} · {offer.slotCode} · {offer.slotLabel}
                        </p>
                        {offer.isQualifyingOffer && (
                          <span className="mt-1 inline-block border border-[var(--color-info)] bg-[var(--color-sunken)] px-2 py-0.5 t-caption text-[var(--color-info)]">
                            QUALIFYING OFFER
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <StatValue size="lg" variant="accent">{offer.contractYears}</StatValue>
                        <p className="t-caption text-[var(--color-ink-faint)]">
                          YEAR{offer.contractYears === 1 ? '' : 'S'}
                        </p>
                      </div>
                    </div>

                    <p className="t-caption text-[var(--color-ink-dim)]">{offer.note}</p>
                    <p className="t-caption text-[var(--color-ink-faint)]">
                      {offer.incumbentName
                        ? `Cut candidate: ${offer.incumbentName}${offer.incumbentOverall ? ` | ${offer.incumbentOverall} OVR` : ''}`
                        : 'Cut candidate: open roster spot'}
                    </p>

                    <RetroButton
                      variant="primary"
                      onClick={() => setPendingOffer(offer)}
                      disabled={!isMarketOpen}
                      className="self-start"
                    >
                      Sign <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </RetroButton>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <Panel className="flex flex-col items-center gap-3 p-10 text-center">
          <BriefcaseBusiness className="h-9 w-9 text-[var(--color-gold)]" aria-hidden="true" />
          <p className="t-h2">No free agents available</p>
          <p className="t-body max-w-md text-[var(--color-ink-dim)]">
            The market is empty right now. Re-enter when new players are released or when the
            offseason opens.
          </p>
        </Panel>
      )}

      {pendingOffer && selectedFreeAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color:color-mix(in_srgb,var(--color-void)_85%,transparent)] px-4 py-8">
          <div role="dialog" aria-modal="true" aria-label="Signing preview" className="max-h-[92vh] w-full max-w-5xl overflow-auto">
            <Panel variant="hero" className="overflow-hidden">
              <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
                <div className="min-w-0">
                  <h2 className="t-h2 truncate">
                    {pendingOffer.team.city} {pendingOffer.team.name}
                  </h2>
                  <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
                    {selectedFreeAgent.player.firstName} {selectedFreeAgent.player.lastName} to {pendingOffer.slotCode}
                    {' · '}
                    {pendingOffer.contractYears} year{pendingOffer.contractYears === 1 ? '' : 's'}
                  </p>
                </div>
                <RetroButton variant="ghost" onClick={() => setPendingOffer(null)}>
                  <X className="h-4 w-4" aria-hidden="true" /> Close
                </RetroButton>
              </div>

              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <Panel variant="sunken" className="overflow-hidden">
                  <div className="border-b border-[var(--color-chrome-lo)] px-3 py-2">
                    <p className="t-label">
                      {pendingOffer.slotCode.startsWith('SP')
                        ? 'Projected Rotation'
                        : pendingOffer.slotCode === 'CL' || pendingOffer.slotCode.startsWith('RP')
                          ? 'Projected Bullpen'
                          : 'Projected Batting Order'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 p-2">
                    {previewSlots.map((slot) => (
                      <div
                        key={slot.slotCode}
                        className={`flex items-center gap-3 border-l-[3px] px-3 py-2 ${
                          slot.highlighted
                            ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]'
                            : 'border-l-transparent'
                        }`}
                      >
                        <span className="w-[6ch] shrink-0 t-caption text-[var(--color-ink-faint)]">{slot.displayLabel}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate t-stat-sm">{slot.playerName}</p>
                          {slot.dropped && (
                            <p className="truncate t-caption text-[var(--color-warn)]">
                              This move cuts the current occupant
                            </p>
                          )}
                        </div>
                        <StatValue size="sm" variant={slot.highlighted ? 'accent' : 'default'}>
                          {slot.overall ?? '--'}
                        </StatValue>
                      </div>
                    ))}
                  </div>
                </Panel>

                <div className="flex flex-col gap-3">
                  <Panel variant="sunken" className="flex flex-col gap-2 p-3">
                    <div className="flex items-center gap-3">
                      <TeamLogo team={pendingOffer.team} sizeClass="h-14 w-14" />
                      <div className="min-w-0">
                        <p className="t-caption text-[var(--color-ink-faint)]">SIGNING TEAM</p>
                        <p className="truncate t-h3">{pendingOffer.team.city} {pendingOffer.team.name}</p>
                      </div>
                    </div>
                    <p className="t-caption text-[var(--color-ink-dim)]">{pendingOffer.note}</p>
                    {pendingOffer.isQualifyingOffer && (
                      <p className="t-caption text-[var(--color-info)]">This is a qualifying-offer reunion path.</p>
                    )}
                    <p className="t-caption text-[var(--color-ink-faint)]">
                      Proposed term: {pendingOffer.contractYears} year{pendingOffer.contractYears === 1 ? '' : 's'}
                    </p>
                  </Panel>

                  <Panel variant="sunken" className="flex flex-col gap-1 p-3">
                    <p className="t-caption text-[var(--color-ink-faint)]">ROSTER FALLOUT</p>
                    <p className="t-h3">
                      {displacedPlayer ? `${displacedPlayer.firstName} ${displacedPlayer.lastName}` : 'No cut required'}
                    </p>
                    <p className="t-caption text-[var(--color-ink-dim)]">
                      {displacedPlayer
                        ? `${pendingOffer.slotCode} spot will be cleared immediately${pendingOffer.incumbentOverall ? ` | ${pendingOffer.incumbentOverall} OVR waived` : ''}`
                        : 'Open slot available'}
                    </p>
                  </Panel>

                  <RetroButton
                    variant="primary"
                    size="lg"
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
                  >
                    Sign Player <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </RetroButton>
                </div>
              </div>
            </Panel>
          </div>
        </div>
      )}

      {!isMarketOpen && (
        <Panel variant="sunken" className="flex flex-col gap-1 p-4">
          <p className="t-label text-[var(--color-ink-dim)]">Market Locked</p>
          <p className="t-body text-[var(--color-ink-dim)]">
            {marketStatusMessage || `Free agency opens on ${freeAgencyOpenDate}. This screen is view-only until then.`}
          </p>
        </Panel>
      )}

      {freeAgents.length > 0 && (
        <Panel className="overflow-hidden">
          <div className="chrome-bar flex items-center gap-2 px-4">
            <Star className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            <h2 className="t-h3">Market Summary</h2>
          </div>
          <div className="grid gap-2 p-4 md:grid-cols-4">
            <StatTile label="Active Bidders" value={freeAgents.filter((entry) => entry.offers.length > 0).length} />
            <StatTile label="Players Waiting" value={freeAgents.filter((entry) => entry.offers.length === 0).length} />
            <StatTile label="Total Offers" value={freeAgents.reduce((total, entry) => total + entry.offers.length, 0)} accent />
            <StatTile label="Top Free Agent" value={freeAgents[0] ? freeAgents[0].player.lastName : '--'} />
          </div>
        </Panel>
      )}
    </section>
  );
};
