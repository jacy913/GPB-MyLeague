import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, Search } from 'lucide-react';
import {
  type Player,
  type PlayerBattingRatings,
  type PlayerPitchingRatings,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
  type Team,
  type TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { Panel, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';
import { ClubPanel, StatTile, overallVariant } from './teams/shared';
import { PlayerCard } from './teams/PlayerCard';

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

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'overall_desc', label: 'OVR' },
  { value: 'potential_desc', label: 'POT' },
  { value: 'name', label: 'NAME' },
  { value: 'age_asc', label: 'AGE UP' },
  { value: 'age_desc', label: 'AGE DN' },
  { value: 'team', label: 'CLUB' },
  { value: 'position', label: 'POS' },
];

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
  return years.length === 0 ? null : Math.max(...years);
};

const playerLabel = (player: Player): string => `${player.firstName} ${player.lastName}`;

const teamOf = (player: Player, teamsById: Map<string, Team>): Team | null =>
  player.teamId ? teamsById.get(player.teamId) ?? null : null;

const overallOf = (
  playerId: string,
  batting: Map<string, PlayerBattingRatings>,
  pitching: Map<string, PlayerPitchingRatings>,
): number => batting.get(playerId)?.overall ?? pitching.get(playerId)?.overall ?? 0;

const potentialOf = (
  playerId: string,
  batting: Map<string, PlayerBattingRatings>,
  pitching: Map<string, PlayerPitchingRatings>,
): number => batting.get(playerId)?.potentialOverall ?? pitching.get(playerId)?.potentialOverall ?? 0;

const selectClass =
  'w-full appearance-none bg-transparent pr-6 t-caption text-[var(--color-ink)] outline-none';

/**
 * League player database. Filtering, sorting and selection are unchanged; the
 * presentation is rebuilt on the shared primitives.
 */
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
    if (!latestSeasonYear) return [];
    return rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear);
  }, [latestSeasonYear, rosterSlots]);

  // Retained for the season-year readout; presence filtering reads player.teamId
  // rather than slot occupancy, which is what the previous implementation did.

  const latestBattingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerBattingRatings>();
    battingRatings.forEach((ratings) => {
      const existing = map.get(ratings.playerId);
      if (!existing || ratings.seasonYear > existing.seasonYear) map.set(ratings.playerId, ratings);
    });
    return map;
  }, [battingRatings]);

  const latestPitchingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerPitchingRatings>();
    pitchingRatings.forEach((ratings) => {
      const existing = map.get(ratings.playerId);
      if (!existing || ratings.seasonYear > existing.seasonYear) map.set(ratings.playerId, ratings);
    });
    return map;
  }, [pitchingRatings]);

  const latestBattingStatByPlayerId = useMemo(
    () => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'),
    [battingStats],
  );
  const latestPitchingStatByPlayerId = useMemo(
    () => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'),
    [pitchingStats],
  );

  const availablePositions = useMemo(
    () => Array.from(new Set(players.map((player) => player.primaryPosition))).sort(),
    [players],
  );

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const nextPlayers = players.filter((player) => {
      const team = teamOf(player, teamsById);
      const matchesQuery =
        normalizedQuery.length === 0
        || playerLabel(player).toLowerCase().includes(normalizedQuery)
        || player.primaryPosition.toLowerCase().includes(normalizedQuery)
        || (team ? `${team.city} ${team.name}`.toLowerCase().includes(normalizedQuery) : false);
      const matchesTeam =
        teamFilter === 'all'
        || (teamFilter === 'free_agents' && player.status === 'free_agent')
        || (teamFilter === 'retired' && player.status === 'retired')
        || player.teamId === teamFilter;
      // Secondary position counts. A player who can play a slot only as a
      // reserve belongs in that position's results; filtering on the primary
      // position alone hid them.
      const matchesPosition =
        positionFilter === 'all'
        || player.primaryPosition === positionFilter
        || player.secondaryPosition === positionFilter;
      const matchesStatus = statusFilter === 'all' || player.status === statusFilter;
      const matchesPresence =
        presenceFilter === 'all'
        || (presenceFilter === 'assigned' && player.teamId !== null)
        || (presenceFilter === 'unassigned' && player.teamId === null);
      return matchesQuery && matchesTeam && matchesPosition && matchesStatus && matchesPresence;
    });

    nextPlayers.sort((left, right) => {
      if (sortKey === 'age_asc') return left.age - right.age || left.lastName.localeCompare(right.lastName);
      if (sortKey === 'age_desc') return right.age - left.age || left.lastName.localeCompare(right.lastName);
      if (sortKey === 'team') {
        const l = teamOf(left, teamsById);
        const r = teamOf(right, teamsById);
        return `${l?.city ?? 'Free Agent'}`.localeCompare(`${r?.city ?? 'Free Agent'}`) || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'position') return left.primaryPosition.localeCompare(right.primaryPosition) || left.lastName.localeCompare(right.lastName);
      if (sortKey === 'potential_desc') {
        return potentialOf(right.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId)
          - potentialOf(left.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId)
          || left.lastName.localeCompare(right.lastName);
      }
      if (sortKey === 'overall_desc') {
        return overallOf(right.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId)
          - overallOf(left.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId)
          || left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName);
      }
      return left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName);
    });

    return nextPlayers;
  }, [
    latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId,
    players, positionFilter, presenceFilter, searchQuery, sortKey, statusFilter, teamFilter, teamsById,
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

  const selectedTeam = selectedPlayer ? teamOf(selectedPlayer, teamsById) : null;
  const selectedBattingStats = selectedPlayer ? latestBattingStatByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedPitchingStats = selectedPlayer ? latestPitchingStatByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedBattingRatings = selectedPlayer ? latestBattingRatingsByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedPitchingRatings = selectedPlayer ? latestPitchingRatingsByPlayerId.get(selectedPlayer.playerId) ?? null : null;
  const selectedOverall = selectedBattingRatings?.overall ?? selectedPitchingRatings?.overall ?? null;

  const selectedAttributePoints = useMemo(() => {
    if (selectedPlayer?.playerType === 'batter' && selectedBattingRatings) {
      const r = selectedBattingRatings;
      return [
        { label: 'Contact', value: r.contact }, { label: 'Power', value: r.power },
        { label: 'Discipline', value: r.plateDiscipline }, { label: 'Avoid K', value: r.avoidStrikeout },
        { label: 'Speed', value: r.speed }, { label: 'Fielding', value: r.fielding },
      ];
    }
    if (selectedPlayer?.playerType === 'pitcher' && selectedPitchingRatings) {
      const r = selectedPitchingRatings;
      return [
        { label: 'Stuff', value: r.stuff }, { label: 'Command', value: r.command },
        { label: 'Control', value: r.control }, { label: 'Movement', value: r.movement },
        { label: 'Stamina', value: r.stamina }, { label: 'Fielding', value: r.fielding },
      ];
    }
    return [];
  }, [selectedBattingRatings, selectedPitchingRatings, selectedPlayer]);

  const columns: StatTableColumn[] = [
    { key: 'club', header: 'CLUB', width: '6ch' },
    { key: 'name', header: 'NAME' },
    { key: 'pos', header: 'POS', align: 'right', isNumeric: true, width: '6ch' },
    { key: 'age', header: 'AGE', align: 'right', isNumeric: true, width: '5ch' },
    { key: 'ovr', header: 'OVR', align: 'right', isNumeric: true, width: '5ch' },
    { key: 'pot', header: 'POT', align: 'right', isNumeric: true, width: '5ch' },
  ];

  const rows: StatTableRow[] = filteredPlayers.map((player) => {
    const team = teamOf(player, teamsById);
    const overall = overallOf(player.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId);
    return {
      id: player.playerId,
      cells: {
        // Abbreviation rather than the crest. Unlike the roster list, club
        // membership actually varies row to row here, so the column cannot just
        // be dropped -- but a 32px mark on every row made the name column the
        // narrowest thing on the screen, and the abbreviation carries the same
        // information in a third of the width.
        club: team
          ? <span className="t-stat-sm text-[var(--color-ink-dim)]">{team.id.toUpperCase()}</span>
          : <span className="t-caption text-[var(--color-ink-faint)]">--</span>,
        name: <span className="truncate t-stat">{playerLabel(player)}</span>,
        pos: player.primaryPosition,
        age: player.age,
        // OVR is the figure this list exists to rank, so it is set larger than
        // every other value in the row.
        ovr: <StatValue variant={overallVariant(overall || null)}>{overall || '---'}</StatValue>,
        pot: (
          <StatValue size="sm" variant="default">
            {potentialOf(player.playerId, latestBattingRatingsByPlayerId, latestPitchingRatingsByPlayerId) || '---'}
          </StatValue>
        ),
      },
    };
  });

  const scopeButton = (value: string, label: string) => {
    const active = teamFilter === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setTeamFilter(value)}
        aria-pressed={active}
        className={`min-w-[96px] shrink-0 border px-3 py-2 t-label transition-colors ${
          active
            ? 'border-[var(--color-gold)] bg-[var(--color-gold)] text-[var(--color-ink-invert)]'
            : 'border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] text-[var(--color-ink-dim)] hover:border-[var(--color-chrome-hi)]'
        }`}
      >
        {label}
      </button>
    );
  };

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">Rosters</h1>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <StatTile label="Loaded" value={players.length} />
            <StatTile label="Filtered" value={filteredPlayers.length} />
            <StatTile label="With Team" value={players.filter((player) => player.teamId).length} />
            <StatTile label="Season" value={latestSeasonYear ?? '---'} />
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto p-3">
          {scopeButton('all', 'ALL')}
          {scopeButton('free_agents', 'FREE AGENTS')}
          {scopeButton('retired', 'RETIRED')}
          {[...teams]
            .sort((left, right) => left.city.localeCompare(right.city))
            .map((team) => {
              const active = teamFilter === team.id;
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => setTeamFilter(team.id)}
                  aria-pressed={active}
                  aria-label={`Filter to ${team.city} ${team.name}`}
                  className={`shrink-0 border p-2 transition-colors ${
                    active
                      ? 'border-[var(--color-gold)]'
                      : 'border-transparent hover:border-[var(--color-chrome-lo)]'
                  }`}
                >
                  <TeamLogo team={team} sizeClass="h-11 w-11" />
                </button>
              );
            })}
        </div>
      </Panel>

      <Panel className="p-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_110px_130px_120px]">
          <label className="flex items-center gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />
            <span className="sr-only">Search players</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search name, club, pos"
              className="w-full bg-transparent t-stat-sm text-[var(--color-ink)] outline-none placeholder:t-caption placeholder:text-[var(--color-ink-faint)]"
            />
          </label>

          {([
            { label: 'POSITION', value: positionFilter, options: [['all', 'POS'], ...availablePositions.map((p) => [p, p])], onChange: (v: string) => setPositionFilter(v) },
            { label: 'STATUS', value: statusFilter, options: [['all', 'STATUS'], ['active', 'ACTIVE'], ['free_agent', 'FA'], ['prospect', 'PROS'], ['retired', 'RET']], onChange: (v: string) => setStatusFilter(v as 'all' | Player['status']) },
            { label: 'SORT', value: sortKey, options: SORT_OPTIONS.map((o) => [o.value, o.label] as [string, string]), onChange: (v: string) => setSortKey(v as SortKey) },
          ]).map((control) => (
            <label key={control.label} className="relative flex flex-col gap-0.5 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-1.5">
              <span className="t-caption text-[var(--color-ink-faint)]">{control.label}</span>
              <select value={control.value} onChange={(event) => control.onChange(event.target.value)} className={selectClass}>
                {control.options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 text-[var(--color-gold)]" aria-hidden="true" />
            </label>
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)]">
        <aside className="order-1 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] p-4 xl:order-1">
          <PlayerCard
            player={selectedPlayer}
            team={selectedTeam}
            overall={selectedOverall}
            attributePoints={selectedAttributePoints}
            battingStat={selectedBattingStats}
            pitchingStat={selectedPitchingStats}
            title={selectedPlayer ? playerLabel(selectedPlayer) : 'Player Pool Pending'}
            subline={selectedPlayer
              ? `${selectedPlayer.primaryPosition}${selectedPlayer.secondaryPosition ? ` / ${selectedPlayer.secondaryPosition}` : ''} · ${selectedPlayer.status.replace('_', ' ')}`
              : 'No players have been generated yet.'}
            emptyAttributes="Generate players to inspect their attribute profile."
          />
        </aside>

        <ClubPanel
          title="Player List"
          aside={<span className="t-caption text-[var(--color-ink-faint)]">{filteredPlayers.length} RESULTS</span>}
          bodyClassName="p-0"
        >
          {rows.length === 0 ? (
            <p className="flex flex-col items-center gap-2 p-8 text-center">
              <Filter className="h-6 w-6 text-[var(--color-ink-faint)]" aria-hidden="true" />
              <span className="t-h3 text-[var(--color-ink)]">No Players Loaded</span>
              <span className="t-caption text-[var(--color-ink-faint)]">Generate or import a player pool to populate this page.</span>
            </p>
          ) : (
            <StatTable
              columns={columns}
              rows={rows}
              density="default"
              onRowSelect={(id) => setSelectedPlayerId(String(id))}
              selectedRowId={selectedPlayerId}
              aria-label="League player database"
              className="max-h-[720px] overflow-y-auto"
            />
          )}
        </ClubPanel>
      </div>
    </section>
  );
};
