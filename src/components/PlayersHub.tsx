import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, Search, Shield, UserRound } from 'lucide-react';
import {
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  Team,
  TeamRosterSlot,
} from '../types';
import { TeamLogo } from './TeamLogo';

interface PlayersHubProps {
  teams: Team[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  rosterSlots: TeamRosterSlot[];
}

type TeamPresenceFilter = 'all' | 'assigned' | 'unassigned';
type SortKey = 'overall_desc' | 'name' | 'age_asc' | 'age_desc' | 'team' | 'position' | 'potential_desc';
type TeamScopeFilter = 'all' | 'free_agents' | 'retired' | string;

const selectClassName =
  'w-full appearance-none bg-transparent pr-7 text-sm uppercase tracking-[0.08em] text-zinc-100 outline-none [&>option]:bg-[#111111] [&>option]:text-zinc-100';

const getLatestSeasonYear = (
  battingStats: PlayerSeasonBatting[],
  pitchingStats: PlayerSeasonPitching[],
  rosterSlots: TeamRosterSlot[],
): number | null => {
  const years = [
    ...battingStats.map((stat) => stat.seasonYear),
    ...pitchingStats.map((stat) => stat.seasonYear),
    ...rosterSlots.map((slot) => slot.seasonYear),
  ];

  if (years.length === 0) {
    return null;
  }

  return Math.max(...years);
};

const formatPlayerLabel = (player: Player): string => `${player.firstName} ${player.lastName}`;

const getPlayerTeam = (player: Player, teamsById: Map<string, Team>): Team | null =>
  player.teamId ? teamsById.get(player.teamId) ?? null : null;

const getPlayerOverall = (
  playerId: string,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number =>
  battingRatingsByPlayerId.get(playerId)?.overall ??
  pitchingRatingsByPlayerId.get(playerId)?.overall ??
  0;

const OVR_RING_RADIUS = 34;
const OVR_RING_CIRCUMFERENCE = 2 * Math.PI * OVR_RING_RADIUS;
const getOverallRingOffset = (overall: number | null): number => {
  const normalized = overall === null ? 0 : Math.max(60, Math.min(100, overall));
  const progress = normalized === 0 ? 0 : (Math.max(60, Math.min(100, normalized)) - 60) / 40;
  return OVR_RING_CIRCUMFERENCE * (1 - progress);
};
const getOverallTextClass = (overall: number | null): string => {
  if (overall === null) {
    return 'text-zinc-300';
  }
  if (overall >= 90) {
    return 'text-amber-300';
  }
  if (overall >= 80) {
    return 'text-white';
  }
  return 'text-zinc-300';
};

const getPlayerPotentialOverall = (
  playerId: string,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number =>
  battingRatingsByPlayerId.get(playerId)?.potentialOverall ??
  pitchingRatingsByPlayerId.get(playerId)?.potentialOverall ??
  0;

export const PlayersHub: React.FC<PlayersHubProps> = ({
  teams,
  players,
  battingRatings,
  pitchingRatings,
  battingStats,
  pitchingStats,
  rosterSlots,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState<TeamScopeFilter>('all');
  const [positionFilter, setPositionFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Player['status']>('all');
  const [presenceFilter, setPresenceFilter] = useState<TeamPresenceFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('overall_desc');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(players[0]?.playerId ?? null);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const latestSeasonYear = useMemo(
    () => getLatestSeasonYear(battingStats, pitchingStats, rosterSlots),
    [battingStats, pitchingStats, rosterSlots],
  );

  const latestRosterSlots = useMemo(() => {
    if (!latestSeasonYear) {
      return [];
    }
    return rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear);
  }, [latestSeasonYear, rosterSlots]);

  const rosterSlotByPlayerId = useMemo(() => {
    const map = new Map<string, TeamRosterSlot>();
    latestRosterSlots.forEach((slot) => {
      map.set(slot.playerId, slot);
    });
    return map;
  }, [latestRosterSlots]);

  const latestBattingStatByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerSeasonBatting>();
    [...battingStats]
      .sort((left, right) => {
        if (left.seasonYear !== right.seasonYear) {
          return right.seasonYear - left.seasonYear;
        }
        return left.seasonPhase === right.seasonPhase ? 0 : left.seasonPhase === 'playoffs' ? -1 : 1;
      })
      .forEach((stat) => {
        if (!map.has(stat.playerId)) {
          map.set(stat.playerId, stat);
        }
      });
    return map;
  }, [battingStats]);

  const latestBattingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerBattingRatings>();
    [...battingRatings]
      .sort((left, right) => right.seasonYear - left.seasonYear)
      .forEach((ratings) => {
        if (!map.has(ratings.playerId)) {
          map.set(ratings.playerId, ratings);
        }
      });
    return map;
  }, [battingRatings]);

  const latestPitchingStatByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerSeasonPitching>();
    [...pitchingStats]
      .sort((left, right) => {
        if (left.seasonYear !== right.seasonYear) {
          return right.seasonYear - left.seasonYear;
        }
        return left.seasonPhase === right.seasonPhase ? 0 : left.seasonPhase === 'playoffs' ? -1 : 1;
      })
      .forEach((stat) => {
        if (!map.has(stat.playerId)) {
          map.set(stat.playerId, stat);
        }
      });
    return map;
  }, [pitchingStats]);

  const latestPitchingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerPitchingRatings>();
    [...pitchingRatings]
      .sort((left, right) => right.seasonYear - left.seasonYear)
      .forEach((ratings) => {
        if (!map.has(ratings.playerId)) {
          map.set(ratings.playerId, ratings);
        }
      });
    return map;
  }, [pitchingRatings]);

  const availablePositions = useMemo(
    () => Array.from(new Set(players.flatMap((player) => [player.primaryPosition, player.secondaryPosition].filter(Boolean) as string[]))).sort(),
    [players],
  );

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const nextPlayers = players.filter((player) => {
      const fullName = formatPlayerLabel(player).toLowerCase();
      const team = getPlayerTeam(player, teamsById);
      const matchesQuery =
        normalizedQuery.length === 0 ||
        fullName.includes(normalizedQuery) ||
        player.lastName.toLowerCase().includes(normalizedQuery) ||
        player.firstName.toLowerCase().includes(normalizedQuery) ||
        player.primaryPosition.toLowerCase().includes(normalizedQuery) ||
        team?.city.toLowerCase().includes(normalizedQuery) ||
        team?.name.toLowerCase().includes(normalizedQuery);

      const matchesTeam =
        teamFilter === 'all' ||
        (teamFilter === 'free_agents' && player.status === 'free_agent') ||
        (teamFilter === 'retired' && player.status === 'retired') ||
        (teamFilter !== 'free_agents' && teamFilter !== 'retired' && player.teamId === teamFilter);
      const matchesPosition =
        positionFilter === 'all' ||
        player.primaryPosition === positionFilter ||
        player.secondaryPosition === positionFilter;
      const matchesStatus = statusFilter === 'all' || player.status === statusFilter;
      const matchesPresence =
        presenceFilter === 'all' ||
        (presenceFilter === 'assigned' && player.teamId !== null) ||
        (presenceFilter === 'unassigned' && player.teamId === null);

      return matchesQuery && matchesTeam && matchesPosition && matchesStatus && matchesPresence;
    });

    nextPlayers.sort((left, right) => {
      if (sortKey === 'age_asc') {
        return left.age - right.age || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'age_desc') {
        return right.age - left.age || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'team') {
        const leftTeam = getPlayerTeam(left, teamsById);
        const rightTeam = getPlayerTeam(right, teamsById);
        const leftLabel = leftTeam ? `${leftTeam.city} ${leftTeam.name}` : 'Free Agent';
        const rightLabel = rightTeam ? `${rightTeam.city} ${rightTeam.name}` : 'Free Agent';
        return leftLabel.localeCompare(rightLabel) || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'position') {
        return left.primaryPosition.localeCompare(right.primaryPosition) || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'potential_desc') {
        const leftPotential = getPlayerPotentialOverall(left.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
        const rightPotential = getPlayerPotentialOverall(right.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
        return rightPotential - leftPotential || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'overall_desc') {
        const leftOverall = getPlayerOverall(left.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
        const rightOverall = getPlayerOverall(right.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
        return rightOverall - leftOverall || left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName);
      }
      return left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName);
    });

    return nextPlayers;
  }, [
    latestBattingRatingsByPlayerId,
    latestPitchingRatingsByPlayerId,
    players,
    positionFilter,
    presenceFilter,
    searchQuery,
    sortKey,
    statusFilter,
    teamFilter,
    teamsById,
  ]);

  useEffect(() => {
    if (filteredPlayers.length === 0) {
      setSelectedPlayerId(null);
      return;
    }

    if (!filteredPlayers.some((player) => player.playerId === selectedPlayerId)) {
      setSelectedPlayerId(filteredPlayers[0].playerId);
    }
  }, [filteredPlayers, selectedPlayerId]);

  const selectedPlayer = useMemo(
    () => filteredPlayers.find((player) => player.playerId === selectedPlayerId) ?? null,
    [filteredPlayers, selectedPlayerId],
  );

  const selectedTeam = selectedPlayer ? getPlayerTeam(selectedPlayer, teamsById) : null;
  const selectedRosterSlot = selectedPlayer ? rosterSlotByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedBattingStats = selectedPlayer ? latestBattingStatByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedPitchingStats = selectedPlayer ? latestPitchingStatByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedBattingRatings = selectedPlayer ? latestBattingRatingsByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedPitchingRatings = selectedPlayer ? latestPitchingRatingsByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedOverall = selectedBattingRatings?.overall ?? selectedPitchingRatings?.overall ?? null;
  const selectedPotentialOverall = selectedBattingRatings?.potentialOverall ?? selectedPitchingRatings?.potentialOverall ?? null;

  const headerTitle = selectedPlayer ? formatPlayerLabel(selectedPlayer) : 'Player Pool Pending';
  const headerSubline = selectedPlayer
    ? `${selectedPlayer.primaryPosition}${selectedPlayer.secondaryPosition ? ` / ${selectedPlayer.secondaryPosition}` : ''} | ${selectedPlayer.status.replace('_', ' ')}`
    : 'No players have been generated yet.';

  return (
    <section className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Roster Database</p>
          <h2 className="font-display text-3xl uppercase tracking-[0.14em] text-white mt-1">Rosters</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 min-w-[280px]">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Loaded</p>
            <p className="font-display text-2xl uppercase tracking-[0.08em] text-white mt-1">{players.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Filtered</p>
            <p className="font-display text-2xl uppercase tracking-[0.08em] text-white mt-1">{filteredPlayers.length}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">With Team</p>
            <p className="font-display text-2xl uppercase tracking-[0.08em] text-white mt-1">
              {players.filter((player) => player.teamId).length}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Season</p>
            <p className="font-display text-2xl uppercase tracking-[0.08em] text-white mt-1">{latestSeasonYear ?? '---'}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#171717] p-4">
        <div className="flex gap-2 overflow-x-auto scrollbar-subtle pb-1">
            <button
              onClick={() => setTeamFilter('all')}
              className={`min-w-[110px] rounded-2xl border px-3 py-3 text-center transition-colors ${
                teamFilter === 'all'
                  ? 'border-white/25 bg-white/10'
                  : 'border-white/10 bg-[#151515] hover:border-white/20'
              }`}
            >
              <p className="font-display text-lg uppercase tracking-[0.1em] text-white">All</p>
            </button>

            <button
              onClick={() => setTeamFilter('free_agents')}
              className={`min-w-[132px] rounded-2xl border px-3 py-3 text-center transition-colors ${
                teamFilter === 'free_agents'
                  ? 'border-white/25 bg-white/10'
                  : 'border-white/10 bg-[#151515] hover:border-white/20'
              }`}
            >
              <p className="font-display text-lg uppercase tracking-[0.1em] text-white">Free Agents</p>
            </button>

            <button
              onClick={() => setTeamFilter('retired')}
              className={`min-w-[110px] rounded-2xl border px-3 py-3 text-center transition-colors ${
                teamFilter === 'retired'
                  ? 'border-white/25 bg-white/10'
                  : 'border-white/10 bg-[#151515] hover:border-white/20'
              }`}
            >
              <p className="font-display text-lg uppercase tracking-[0.1em] text-white">Retired</p>
            </button>

            {teams
              .slice()
              .sort((left, right) => left.city.localeCompare(right.city))
              .map((team) => {
                const isSelected = teamFilter === team.id;

                return (
                  <button
                    key={team.id}
                    onClick={() => setTeamFilter(team.id)}
                    className={`min-w-[92px] rounded-2xl border px-3 py-3 transition-colors ${
                      isSelected
                        ? 'border-white/25 bg-white/10'
                        : 'border-white/10 bg-[#151515] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-center">
                      <TeamLogo team={team} sizeClass="h-12 w-12" />
                    </div>
                  </button>
                );
              })}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#171717] px-5 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_110px_130px_120px] gap-3 items-end">
          <label className="border-b border-white/10 px-1 py-2">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-500" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search name, club, pos"
                className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:font-mono placeholder:text-xs placeholder:uppercase placeholder:tracking-[0.16em] placeholder:text-zinc-600"
              />
            </div>
          </label>

          <label className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="relative">
              <select
                value={positionFilter}
                onChange={(event) => setPositionFilter(event.target.value)}
                className={selectClassName}
              >
                <option value="all">POS</option>
                {availablePositions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            </div>
          </label>

          <label className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | Player['status'])}
                className={selectClassName}
              >
                <option value="all">STATUS</option>
                <option value="active">ACTIVE</option>
                <option value="free_agent">FA</option>
                <option value="prospect">PROS</option>
                <option value="retired">RET</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            </div>
          </label>

          <label className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="relative">
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className={selectClassName}
              >
                <option value="overall_desc">OVR</option>
                <option value="name">NAME</option>
                <option value="age_asc">AGE UP</option>
                <option value="age_desc">AGE DN</option>
                <option value="team">CLUB</option>
                <option value="position">POS</option>
                <option value="potential_desc">POT</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            </div>
          </label>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] gap-6">
        <section className="order-2 xl:order-2 rounded-3xl border border-white/10 bg-[#171717] p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <Filter className="h-5 w-5 text-zinc-400" />
              <h3 className="font-display text-2xl uppercase tracking-[0.12em] text-white">Player List</h3>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              {filteredPlayers.length} results
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-[56px_minmax(0,1.7fr)_84px_84px_84px_84px] gap-3 bg-white/5 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              <span>Club</span>
              <span>Name</span>
              <span>Pos</span>
              <span>Age</span>
              <span>Ovr</span>
              <span>Pot</span>
            </div>

            <div className="max-h-[720px] overflow-y-auto scrollbar-subtle divide-y divide-white/5">
              {filteredPlayers.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  <p className="font-display text-3xl uppercase tracking-[0.12em] text-zinc-300">No Players Loaded</p>
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500 mt-3">
                    Generate or import a player pool to populate this page.
                  </p>
                </div>
              ) : (
                filteredPlayers.map((player) => {
                  const team = getPlayerTeam(player, teamsById);
                  const overall = getPlayerOverall(player.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
                  const potentialOverall = getPlayerPotentialOverall(player.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
                  const isSelected = player.playerId === selectedPlayerId;
                  return (
                    <button
                      key={player.playerId}
                      onClick={() => setSelectedPlayerId(player.playerId)}
                      className={`grid w-full grid-cols-[56px_minmax(0,1.7fr)_84px_84px_84px_84px] gap-3 px-4 py-3 text-left transition-colors ${
                        isSelected ? 'bg-white/10' : 'bg-transparent hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center">
                        {team ? (
                          <TeamLogo team={team} sizeClass="h-11 w-11" />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/20">
                            <span className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">-</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-display text-xl uppercase tracking-[0.08em] text-white truncate">{formatPlayerLabel(player)}</p>
                      </div>
                      <span className="font-display text-xl uppercase tracking-[0.06em] text-zinc-100">{player.primaryPosition}</span>
                      <span className="font-display text-xl uppercase tracking-[0.06em] text-zinc-100">{player.age}</span>
                      <span className={`font-display text-xl font-bold uppercase tracking-[0.06em] ${getOverallTextClass(overall || null)}`}>
                        {overall || '---'}
                      </span>
                      <span className="font-display text-xl font-bold uppercase tracking-[0.06em] text-zinc-100">{potentialOverall || '---'}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <aside className="order-1 xl:order-1 rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_30%),linear-gradient(135deg,#181818,#242424,#161616)] p-5">
          <div className="grid grid-cols-[132px_minmax(0,1fr)_120px] gap-5 items-start">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-4 flex items-center justify-center min-h-[160px]">
              {selectedTeam ? (
                <TeamLogo team={selectedTeam} sizeClass="h-24 w-24" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/25">
                  <UserRound className="h-10 w-10 text-zinc-600" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {selectedTeam ? `${selectedTeam.city} ${selectedTeam.name}` : 'Player Card'}
              </p>
              <h2 className="font-display text-4xl uppercase tracking-[0.12em] text-white mt-2 break-words">
                {headerTitle}
              </h2>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 mt-2">
                {headerSubline}
              </p>
              <p className="text-sm text-zinc-300 mt-4">
                {selectedPlayer
                  ? `Age ${selectedPlayer.age}. Bats ${selectedPlayer.bats}, throws ${selectedPlayer.throws}. ${selectedPlayer.teamId ? 'Currently attached to an active organization.' : 'Currently unattached to a club.'}`
                  : 'This panel will show player details, ratings, and season production once the player pool has been generated.'}
              </p>
            </div>

            <div className="flex flex-col items-center rounded-3xl border border-white/10 bg-black/25 px-4 py-5">
              <div className="relative flex h-24 w-24 items-center justify-center">
                <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r={OVR_RING_RADIUS} className="fill-none stroke-white/10" strokeWidth="6" />
                  <circle
                    cx="40"
                    cy="40"
                    r={OVR_RING_RADIUS}
                    className="fill-none stroke-platinum"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={OVR_RING_CIRCUMFERENCE}
                    strokeDashoffset={getOverallRingOffset(selectedOverall)}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">OVR</span>
                  <span className={`font-display text-4xl font-bold uppercase tracking-[0.06em] leading-none mt-1 ${getOverallTextClass(selectedOverall)}`}>
                    {selectedOverall ?? '---'}
                  </span>
                </div>
              </div>
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">Impact Grade</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-5">
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Primary</p>
              <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                {selectedPlayer?.primaryPosition ?? '---'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Roster Slot</p>
              <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                {selectedRosterSlot?.slotCode ?? '---'}
              </p>
            </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Age</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                  {selectedPlayer?.age ?? '---'}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Potential</p>
                <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                  {selectedPotentialOverall ?? (selectedPlayer ? Math.round(selectedPlayer.potential * 100) : '---')}
                </p>
              </div>
            </div>

          <section className="rounded-2xl border border-white/10 bg-black/20 p-4 mt-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-zinc-300" />
              <h3 className="font-display text-xl uppercase tracking-[0.1em] text-white">Attributes</h3>
            </div>
            {selectedPlayer ? (
              selectedPlayer.playerType === 'batter' && selectedBattingRatings ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-sm">
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Contact</span><span className="text-zinc-100">{selectedBattingRatings.contact}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Power</span><span className="text-zinc-100">{selectedBattingRatings.power}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Discipline</span><span className="text-zinc-100">{selectedBattingRatings.plateDiscipline}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Avoid K</span><span className="text-zinc-100">{selectedBattingRatings.avoidStrikeout}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Speed</span><span className="text-zinc-100">{selectedBattingRatings.speed}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Baserun</span><span className="text-zinc-100">{selectedBattingRatings.baserunning}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Fielding</span><span className="text-zinc-100">{selectedBattingRatings.fielding}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Arm</span><span className="text-zinc-100">{selectedBattingRatings.arm}</span></div>
                </div>
              ) : selectedPlayer.playerType === 'pitcher' && selectedPitchingRatings ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-sm">
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Stuff</span><span className="text-zinc-100">{selectedPitchingRatings.stuff}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Command</span><span className="text-zinc-100">{selectedPitchingRatings.command}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Control</span><span className="text-zinc-100">{selectedPitchingRatings.control}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Movement</span><span className="text-zinc-100">{selectedPitchingRatings.movement}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Stamina</span><span className="text-zinc-100">{selectedPitchingRatings.stamina}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Hold</span><span className="text-zinc-100">{selectedPitchingRatings.holdRunners}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Fielding</span><span className="text-zinc-100">{selectedPitchingRatings.fielding}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-zinc-500">Pot OVR</span><span className="text-zinc-100">{selectedPitchingRatings.potentialOverall}</span></div>
                </div>
              ) : (
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No ratings loaded for this player yet.</p>
              )
            ) : (
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">Generate players to inspect their attribute profile.</p>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-platinum" />
                <h3 className="font-display text-xl uppercase tracking-[0.1em] text-white">Batting Stats</h3>
              </div>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex justify-between gap-3"><span className="text-zinc-500">AVG</span><span className="text-zinc-100">{selectedBattingStats ? selectedBattingStats.avg.toFixed(3).replace(/^0/, '.') : '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">OPS</span><span className="text-zinc-100">{selectedBattingStats ? selectedBattingStats.ops.toFixed(3) : '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">H</span><span className="text-zinc-100">{selectedBattingStats?.hits ?? '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">HR</span><span className="text-zinc-100">{selectedBattingStats?.homeRuns ?? '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">RBI</span><span className="text-zinc-100">{selectedBattingStats?.rbi ?? '---'}</span></div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-prestige" />
                <h3 className="font-display text-xl uppercase tracking-[0.1em] text-white">Pitching Stats</h3>
              </div>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex justify-between gap-3"><span className="text-zinc-500">ERA</span><span className="text-zinc-100">{selectedPitchingStats ? selectedPitchingStats.era.toFixed(2) : '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">WHIP</span><span className="text-zinc-100">{selectedPitchingStats ? selectedPitchingStats.whip.toFixed(2) : '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">W-L</span><span className="text-zinc-100">{selectedPitchingStats ? `${selectedPitchingStats.wins}-${selectedPitchingStats.losses}` : '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">K</span><span className="text-zinc-100">{selectedPitchingStats?.strikeouts ?? '---'}</span></div>
                <div className="flex justify-between gap-3"><span className="text-zinc-500">IP</span><span className="text-zinc-100">{selectedPitchingStats?.inningsPitched ?? '---'}</span></div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </section>
  );
};
