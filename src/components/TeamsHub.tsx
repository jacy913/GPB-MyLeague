import React, { useEffect, useMemo, useState } from 'react';
import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  type Game,
  type Player,
  type PlayerBattingRatings,
  type PlayerPitchingRatings,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
  RESERVE_ROSTER_SLOTS,
  STARTING_PITCHER_SLOTS,
  type Team,
  type TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { ClubHero, ClubSnapshot, DepthChart, SchedulePanel, TeamDirectory } from './teams/ClubPanels';
import { RosterPanel } from './teams/RosterPanel';
import {
  ROSTER_DISPLAY_ORDER,
  ROSTER_STRENGTH_SLOT_COUNT,
  compareStandings,
  generateBattingOrder,
  getHitsForTeam,
  runValueBaseline,
  type TeamRosterEntry,
} from './teams/shared';

interface TeamsHubProps {
  teams: Team[];
  games: Game[];
  players: Player[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  rosterSlots: TeamRosterSlot[];
  currentDate: string;
  selectedTeamId: string;
  onSelectTeamId: (teamId: string) => void;
  onOpenGame: (gameId: string) => void;
}

/**
 * Club screens. Orchestration only.
 *
 * This was 1,206 lines holding six panels, two inline SVG dials and the whole
 * roster computation. It is now composition over components/teams/ plus a
 * RatingRing primitive. Every computation is carried over from the previous
 * version: the hits roll-up, the three rank orderings, the batting-order
 * generator with its per-slot scoring, the depth chart ordering, the roster
 * strength average over lineup and rotation only, and the selection effects.
 */
export const TeamsHub: React.FC<TeamsHubProps> = ({
  teams,
  games,
  players,
  battingRatings,
  pitchingRatings,
  battingStats,
  pitchingStats,
  rosterSlots,
  currentDate,
  selectedTeamId,
  onSelectTeamId,
  onOpenGame,
}) => {
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
  const [selectedRosterPlayerId, setSelectedRosterPlayerId] = useState<string | null>(null);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null,
    [teams, selectedTeamId],
  );

  const latestBattingStatsByPlayerId = useMemo(
    () => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'),
    [battingStats],
  );

  // The league the roster card's wRC+ is measured against. Same map the entry rows
  // are drawn from, so a card is never scored against a league it is not shown in.
  const leagueRunValueBaseline = useMemo(
    () => runValueBaseline(latestBattingStatsByPlayerId),
    [latestBattingStatsByPlayerId],
  );
  const latestBattingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerBattingRatings>();
    battingRatings.forEach((ratings) => {
      const existing = map.get(ratings.playerId);
      if (!existing || ratings.seasonYear > existing.seasonYear) map.set(ratings.playerId, ratings);
    });
    return map;
  }, [battingRatings]);
  const latestPitchingStatsByPlayerId = useMemo(
    () => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'),
    [pitchingStats],
  );
  const latestPitchingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerPitchingRatings>();
    pitchingRatings.forEach((ratings) => {
      const existing = map.get(ratings.playerId);
      if (!existing || ratings.seasonYear > existing.seasonYear) map.set(ratings.playerId, ratings);
    });
    return map;
  }, [pitchingRatings]);

  const hitsByTeamId = useMemo(() => {
    const map = new Map<string, number>();
    teams.forEach((team) => map.set(team.id, getHitsForTeam(team.id, games)));
    return map;
  }, [games, teams]);

  const sortedLeagueTeams = useMemo(() => {
    const buckets = new Map<Team['league'], Team[]>();
    (['Platinum', 'Prestige'] as const).forEach((league) => {
      buckets.set(league, teams.filter((team) => team.league === league).sort(compareStandings));
    });
    return buckets;
  }, [teams]);

  const sortedDivisionTeams = useMemo(() => {
    const buckets = new Map<string, Team[]>();
    teams.forEach((team) => {
      const key = `${team.league}:${team.division}`;
      const divisionTeams = buckets.get(key) ?? [];
      divisionTeams.push(team);
      buckets.set(key, divisionTeams);
    });
    buckets.forEach((divisionTeams) => divisionTeams.sort(compareStandings));
    return buckets;
  }, [teams]);

  const runRanks = useMemo(() => {
    const ordered = [...teams].sort((left, right) =>
      left.runsScored !== right.runsScored ? right.runsScored - left.runsScored : compareStandings(left, right));
    return new Map(ordered.map((team, index) => [team.id, index + 1]));
  }, [teams]);

  const hitRanks = useMemo(() => {
    const ordered = [...teams].sort((left, right) => {
      const leftHits = hitsByTeamId.get(left.id) ?? 0;
      const rightHits = hitsByTeamId.get(right.id) ?? 0;
      return leftHits !== rightHits ? rightHits - leftHits : compareStandings(left, right);
    });
    return new Map(ordered.map((team, index) => [team.id, index + 1]));
  }, [hitsByTeamId, teams]);

  const nextGame = useMemo(() => {
    if (!selectedTeam) return null;
    return games
      .filter((game) =>
        game.status === 'scheduled'
        && (game.awayTeam === selectedTeam.id || game.homeTeam === selectedTeam.id)
        && game.date >= currentDate)
      .sort((left, right) => (left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date)))[0] ?? null;
  }, [currentDate, games, selectedTeam]);

  const lastFiveGames = useMemo(() => {
    if (!selectedTeam) return [];
    return games
      .filter((game) =>
        game.status === 'completed'
        && (game.awayTeam === selectedTeam.id || game.homeTeam === selectedTeam.id))
      .sort((left, right) => (left.date === right.date ? right.gameId.localeCompare(left.gameId) : right.date.localeCompare(left.date)))
      .slice(0, 5);
  }, [games, selectedTeam]);

  const sortedTeamsByLeague = useMemo(
    () => (['Platinum', 'Prestige'] as const).map((league) => ({
      league,
      teams: teams.filter((team) => team.league === league).sort((left, right) => left.city.localeCompare(right.city)),
    })),
    [teams],
  );

  const activeRosterSeasonYear = useMemo(() => {
    if (!selectedTeam) return null;
    const years = rosterSlots.filter((slot) => slot.teamId === selectedTeam.id).map((slot) => slot.seasonYear);
    return years.length === 0 ? null : Math.max(...years);
  }, [rosterSlots, selectedTeam]);

  const selectedTeamRosterBySlot = useMemo(() => {
    const map = new Map<string, Omit<TeamRosterEntry, 'slotCode' | 'overall' | 'potentialOverall'>>();
    if (!selectedTeam || activeRosterSeasonYear === null) return map;

    rosterSlots
      .filter((slot) => slot.teamId === selectedTeam.id && slot.seasonYear === activeRosterSeasonYear)
      .forEach((slot) => {
        const player = playersById.get(slot.playerId);
        if (!player) return;
        map.set(slot.slotCode, {
          player,
          battingStat: latestBattingStatsByPlayerId.get(player.playerId) ?? null,
          pitchingStat: latestPitchingStatsByPlayerId.get(player.playerId) ?? null,
          battingRatings: latestBattingRatingsByPlayerId.get(player.playerId) ?? null,
          pitchingRatings: latestPitchingRatingsByPlayerId.get(player.playerId) ?? null,
        });
      });
    return map;
  }, [
    activeRosterSeasonYear,
    latestBattingRatingsByPlayerId, latestBattingStatsByPlayerId,
    latestPitchingRatingsByPlayerId, latestPitchingStatsByPlayerId,
    playersById, rosterSlots, selectedTeam,
  ]);

  const teamRosterPlayers = useMemo(() => {
    return ROSTER_DISPLAY_ORDER
      .map((slotCode) => {
        const entry = selectedTeamRosterBySlot.get(slotCode);
        if (!entry) return null;
        const overall = entry.battingRatings?.overall ?? entry.pitchingRatings?.overall ?? 0;
        const potentialOverall = entry.battingRatings?.potentialOverall ?? entry.pitchingRatings?.potentialOverall ?? 0;
        return { slotCode, overall, potentialOverall, ...entry };
      })
      .filter((entry): entry is TeamRosterEntry => entry !== null)
      .sort((left, right) => right.overall - left.overall || left.player.lastName.localeCompare(right.player.lastName));
  }, [selectedTeamRosterBySlot]);

  const teamRosterBySlot = useMemo(
    () => [...teamRosterPlayers].sort((left, right) => {
      const leftOrder = ROSTER_DISPLAY_ORDER.indexOf(left.slotCode as typeof ROSTER_DISPLAY_ORDER[number]);
      const rightOrder = ROSTER_DISPLAY_ORDER.indexOf(right.slotCode as typeof ROSTER_DISPLAY_ORDER[number]);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return right.overall - left.overall || left.player.lastName.localeCompare(right.player.lastName);
    }),
    [teamRosterPlayers],
  );

  const backupPlayers = useMemo(
    () => teamRosterBySlot.filter((entry) =>
      RESERVE_ROSTER_SLOTS.includes(entry.slotCode as typeof RESERVE_ROSTER_SLOTS[number])),
    [teamRosterBySlot],
  );
  const backupBattersCount = useMemo(
    () => backupPlayers.filter((entry) => entry.player.playerType === 'batter').length,
    [backupPlayers],
  );
  const backupPitchersCount = useMemo(
    () => backupPlayers.filter((entry) => entry.player.playerType === 'pitcher').length,
    [backupPlayers],
  );

  const battingOrder = useMemo(
    () => generateBattingOrder(
      BATTING_ROSTER_SLOTS
        .map((slotCode) => teamRosterPlayers.find((entry) => entry.slotCode === slotCode) ?? null)
        .filter((entry): entry is TeamRosterEntry => entry !== null),
    ),
    [teamRosterPlayers],
  );

  const startingRotation = useMemo(
    () => STARTING_PITCHER_SLOTS
      .map((slotCode) => teamRosterPlayers.find((entry) => entry.slotCode === slotCode) ?? null)
      .filter((entry): entry is TeamRosterEntry => entry !== null),
    [teamRosterPlayers],
  );

  useEffect(() => {
    if (teamRosterPlayers.length === 0) {
      setSelectedRosterPlayerId(null);
      return;
    }
    if (!teamRosterPlayers.some((entry) => entry.player.playerId === selectedRosterPlayerId)) {
      setSelectedRosterPlayerId(teamRosterPlayers[0].player.playerId);
    }
  }, [selectedRosterPlayerId, teamRosterPlayers]);

  const selectedRosterPlayer = useMemo(
    () => teamRosterPlayers.find((entry) => entry.player.playerId === selectedRosterPlayerId) ?? null,
    [selectedRosterPlayerId, teamRosterPlayers],
  );
  const selectedRosterOverall = selectedRosterPlayer?.battingRatings?.overall ?? selectedRosterPlayer?.pitchingRatings?.overall ?? null;

  const rosterStrength = useMemo(() => {
    const contributors = [...battingOrder, ...startingRotation];
    if (contributors.length === 0) return { overall: null as number | null, filledSlots: 0 };
    const totalOverall = contributors.reduce((sum, entry) => sum + entry.overall, 0);
    return { overall: Math.round(totalOverall / contributors.length), filledSlots: contributors.length };
  }, [battingOrder, startingRotation]);

  const selectedRosterAttributePoints = useMemo(() => {
    if (selectedRosterPlayer?.player.playerType === 'batter' && selectedRosterPlayer.battingRatings) {
      const r = selectedRosterPlayer.battingRatings;
      return [
        { label: 'Contact', value: r.contact },
        { label: 'Power', value: r.power },
        { label: 'Discipline', value: r.plateDiscipline },
        { label: 'Avoid K', value: r.avoidStrikeout },
        { label: 'Speed', value: r.speed },
        { label: 'Fielding', value: r.fielding },
      ];
    }
    if (selectedRosterPlayer?.player.playerType === 'pitcher' && selectedRosterPlayer.pitchingRatings) {
      const r = selectedRosterPlayer.pitchingRatings;
      return [
        { label: 'Stuff', value: r.stuff },
        { label: 'Command', value: r.command },
        { label: 'Control', value: r.control },
        { label: 'Movement', value: r.movement },
        { label: 'Stamina', value: r.stamina },
        { label: 'Fielding', value: r.fielding },
      ];
    }
    return [];
  }, [selectedRosterPlayer]);

  if (!selectedTeam) {
    return null;
  }

  const divisionKey = `${selectedTeam.league}:${selectedTeam.division}`;
  const divisionRank = (sortedDivisionTeams.get(divisionKey)?.findIndex((team) => team.id === selectedTeam.id) ?? 0) + 1;
  const leagueRank = (sortedLeagueTeams.get(selectedTeam.league)?.findIndex((team) => team.id === selectedTeam.id) ?? 0) + 1;
  const teamHits = hitsByTeamId.get(selectedTeam.id) ?? 0;
  const lastFiveRecord = lastFiveGames.reduce(
    (accumulator, game) => {
      const won =
        (game.awayTeam === selectedTeam.id && game.score.away > game.score.home) ||
        (game.homeTeam === selectedTeam.id && game.score.home > game.score.away);
      if (won) accumulator.wins += 1;
      else accumulator.losses += 1;
      return accumulator;
    },
    { wins: 0, losses: 0 },
  );

  return (
    <section className="space-y-5">
      <TeamDirectory
        selectedTeam={selectedTeam}
        byLeague={sortedTeamsByLeague}
        isOpen={isDirectoryOpen}
        onToggle={() => setIsDirectoryOpen((previous) => !previous)}
        onSelect={(teamId) => {
          onSelectTeamId(teamId);
          setIsDirectoryOpen(false);
        }}
      />

      <ClubHero
        team={selectedTeam}
        divisionRank={divisionRank}
        leagueRank={leagueRank}
        runRank={runRanks.get(selectedTeam.id) ?? 0}
        hitRank={hitRanks.get(selectedTeam.id) ?? 0}
        teamHits={teamHits}
        rosterStrength={rosterStrength}
      />

      <DepthChart
        battingOrder={battingOrder}
        startingRotation={startingRotation}
        team={selectedTeam}
        selectedPlayerId={selectedRosterPlayerId}
        onSelectPlayer={setSelectedRosterPlayerId}
      />

      <RosterPanel
        team={selectedTeam}
        entries={teamRosterBySlot}
        bySlotCount={selectedTeamRosterBySlot.size}
        backups={backupPlayers}
        backupBatters={backupBattersCount}
        backupPitchers={backupPitchersCount}
        activeRosterSeasonYear={activeRosterSeasonYear}
        selected={selectedRosterPlayer}
        selectedOverall={selectedRosterOverall}
        attributePoints={selectedRosterAttributePoints}
        leagueBaseline={leagueRunValueBaseline}
        onSelectPlayer={setSelectedRosterPlayerId}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <SchedulePanel
          team={selectedTeam}
          nextGame={nextGame}
          lastFive={lastFiveGames}
          teamsById={teamsById}
          games={games}
          onOpenGame={onOpenGame}
        />
        <ClubSnapshot team={selectedTeam} teamHits={teamHits} lastFiveRecord={lastFiveRecord} />
      </div>
    </section>
  );
};
