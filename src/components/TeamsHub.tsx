import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BarChart3, CalendarClock, ChevronDown, ChevronUp, Filter, Shield, Star, UserRound, Users } from 'lucide-react';
import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  Game,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { getScheduledGameTimeLabel } from '../logic/gameTimes';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { formatBattingAverage } from '../logic/statFormatting';
import { TeamLogo } from './TeamLogo';

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

const hashKey = (input: string): number => {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 2147483647;
  }
  return hash;
};

const getFallbackHits = (game: Game, side: 'away' | 'home'): number => {
  const runs = side === 'away' ? game.score.away : game.score.home;
  return runs + 3 + (hashKey(`${game.gameId}:${side}:team-hits`) % 5);
};

const getHitsForTeam = (teamId: string, games: Game[]): number =>
  games.reduce((total, game) => {
    if (game.status !== 'completed') {
      return total;
    }

    if (game.awayTeam === teamId) {
      const awayHits = game.stats.awayHits;
      return total + (typeof awayHits === 'number' && awayHits > 0 ? awayHits : getFallbackHits(game, 'away'));
    }

    if (game.homeTeam === teamId) {
      const homeHits = game.stats.homeHits;
      return total + (typeof homeHits === 'number' && homeHits > 0 ? homeHits : getFallbackHits(game, 'home'));
    }

    return total;
  }, 0);

const compareStandings = (left: Team, right: Team): number => {
  const leftGames = left.wins + left.losses;
  const rightGames = right.wins + right.losses;
  const leftPct = leftGames === 0 ? 0 : left.wins / leftGames;
  const rightPct = rightGames === 0 ? 0 : right.wins / rightGames;

  if (leftPct !== rightPct) {
    return rightPct - leftPct;
  }

  const leftDiff = left.runsScored - left.runsAllowed;
  const rightDiff = right.runsScored - right.runsAllowed;
  if (leftDiff !== rightDiff) {
    return rightDiff - leftDiff;
  }

  if (left.wins !== right.wins) {
    return right.wins - left.wins;
  }

  return left.city.localeCompare(right.city);
};

const formatRecord = (team: Team): string => `${team.wins}-${team.losses}`;

const formatPct = (team: Team): string => {
  const totalGames = team.wins + team.losses;
  return totalGames === 0 ? '.000' : (team.wins / totalGames).toFixed(3).replace(/^0/, '');
};

const formatGameLabel = (game: Game, selectedTeamId: string, teamsById: Map<string, Team>): string => {
  const opponentId = game.awayTeam === selectedTeamId ? game.homeTeam : game.awayTeam;
  const opponent = teamsById.get(opponentId);
  const marker = game.awayTeam === selectedTeamId ? '@' : 'vs';
  const opponentLabel = opponent ? `${opponent.city} ${opponent.name}` : opponentId.toUpperCase();
  return `${marker} ${opponentLabel}`;
};

const describeTeam = (team: Team, divisionRank: number, leagueRank: number): string => {
  const runDiff = team.runsScored - team.runsAllowed;
  const profile =
    runDiff >= 25
      ? 'driven by a high-output attack and clean run prevention'
      : runDiff <= -25
        ? 'still searching for traction on both sides of the ball'
        : 'staying competitive through tight game management';

  return `${team.city} ${team.name} compete in the ${team.division} Division of the ${team.league} League, currently sitting ${divisionRank}${divisionRank === 1 ? 'st' : divisionRank === 2 ? 'nd' : divisionRank === 3 ? 'rd' : 'th'} in the division and ${leagueRank}${leagueRank === 1 ? 'st' : leagueRank === 2 ? 'nd' : leagueRank === 3 ? 'rd' : 'th'} in the league, ${profile}.`;
};

const formatBattingLine = (stat: PlayerSeasonBatting | null): string => {
  if (!stat) {
    return 'No batting line';
  }

  return `${formatBattingAverage(stat.avg)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI`;
};

const formatPitchingLine = (stat: PlayerSeasonPitching | null): string => {
  if (!stat) {
    return 'No pitching line';
  }

  return `${stat.wins}-${stat.losses} | ${stat.era.toFixed(2)} ERA | ${stat.whip.toFixed(2)} WHIP`;
};

type TeamRosterEntry = {
  slotCode: string;
  overall: number;
  potentialOverall: number;
  player: Player;
  battingStat: PlayerSeasonBatting | null;
  pitchingStat: PlayerSeasonPitching | null;
  battingRatings: PlayerBattingRatings | null;
  pitchingRatings: PlayerPitchingRatings | null;
};

const scoreBattingOrderEntry = (entry: TeamRosterEntry, slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): number => {
  const ratings = entry.battingRatings;
  if (!ratings) {
    return -1;
  }

  if (slot === 3) {
    return ratings.contact * 0.5 + ratings.power * 0.5;
  }
  if (slot === 4) {
    return ratings.power * 0.7 + ratings.contact * 0.3;
  }
  if (slot === 1) {
    return ratings.speed * 0.4 + ratings.plateDiscipline * 0.3 + ratings.contact * 0.3;
  }
  if (slot === 2) {
    return ratings.contact * 0.5 + ratings.avoidStrikeout * 0.3 + ratings.speed * 0.2;
  }
  if (slot === 5) {
    return ratings.power * 0.6 + ratings.contact * 0.4;
  }

  return ratings.contact + ratings.power + ratings.plateDiscipline;
};

const generateBattingOrder = (startingNine: TeamRosterEntry[]): TeamRosterEntry[] => {
  const available = [...startingNine].filter((entry) => entry.battingRatings);
  const ordered: Array<TeamRosterEntry | null> = Array(9).fill(null);

  const prioritySlots: Array<1 | 2 | 3 | 4 | 5> = [3, 4, 1, 2, 5];
  prioritySlots.forEach((slot) => {
    if (available.length === 0) {
      return;
    }

    let bestIndex = 0;
    let bestScore = scoreBattingOrderEntry(available[0], slot);
    for (let index = 1; index < available.length; index += 1) {
      const candidateScore = scoreBattingOrderEntry(available[index], slot);
      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestIndex = index;
      }
    }

    const [chosen] = available.splice(bestIndex, 1);
    ordered[slot - 1] = chosen;
  });

  available
    .sort((left, right) => scoreBattingOrderEntry(right, 6) - scoreBattingOrderEntry(left, 6) || right.overall - left.overall)
    .forEach((entry, index) => {
      const slotIndex = 5 + index;
      if (slotIndex < ordered.length) {
        ordered[slotIndex] = entry;
      }
    });

  return ordered.filter((entry): entry is TeamRosterEntry => entry !== null);
};

const OVR_RING_RADIUS = 34;
const OVR_RING_CIRCUMFERENCE = 2 * Math.PI * OVR_RING_RADIUS;
const getOverallRingOffset = (overall: number | null): number => {
  const normalized = overall === null ? 0 : Math.max(60, Math.min(100, overall));
  const progress = normalized === 0 ? 0 : (normalized - 60) / 40;
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

  const latestBattingStatsByPlayerId = useMemo(() => {
    return getPreferredBattingStatsByPlayerId(battingStats, 'regular_season');
  }, [battingStats]);

  const latestBattingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerBattingRatings>();
    battingRatings.forEach((ratings) => {
      const existing = map.get(ratings.playerId);
      if (!existing || ratings.seasonYear > existing.seasonYear) {
        map.set(ratings.playerId, ratings);
      }
    });
    return map;
  }, [battingRatings]);

  const latestPitchingStatsByPlayerId = useMemo(() => {
    return getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season');
  }, [pitchingStats]);

  const latestPitchingRatingsByPlayerId = useMemo(() => {
    const map = new Map<string, PlayerPitchingRatings>();
    pitchingRatings.forEach((ratings) => {
      const existing = map.get(ratings.playerId);
      if (!existing || ratings.seasonYear > existing.seasonYear) {
        map.set(ratings.playerId, ratings);
      }
    });
    return map;
  }, [pitchingRatings]);

  const hitsByTeamId = useMemo(() => {
    const map = new Map<string, number>();
    teams.forEach((team) => {
      map.set(team.id, getHitsForTeam(team.id, games));
    });
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
      const divisionTeams = teams.filter((candidate) => candidate.league === team.league && candidate.division === team.division).sort(compareStandings);
      buckets.set(key, divisionTeams);
    });
    return buckets;
  }, [teams]);

  const runRanks = useMemo(() => {
    const ordered = [...teams].sort((left, right) => {
      if (left.runsScored !== right.runsScored) {
        return right.runsScored - left.runsScored;
      }
      return compareStandings(left, right);
    });
    return new Map(ordered.map((team, index) => [team.id, index + 1]));
  }, [teams]);

  const hitRanks = useMemo(() => {
    const ordered = [...teams].sort((left, right) => {
      const leftHits = hitsByTeamId.get(left.id) ?? 0;
      const rightHits = hitsByTeamId.get(right.id) ?? 0;
      if (leftHits !== rightHits) {
        return rightHits - leftHits;
      }
      return compareStandings(left, right);
    });
    return new Map(ordered.map((team, index) => [team.id, index + 1]));
  }, [hitsByTeamId, teams]);

  const nextGame = useMemo(() => {
    if (!selectedTeam) {
      return null;
    }

    return games
      .filter(
        (game) =>
          game.status === 'scheduled' &&
          (game.awayTeam === selectedTeam.id || game.homeTeam === selectedTeam.id) &&
          game.date >= currentDate,
      )
      .sort((left, right) => (left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date)))[0] ?? null;
  }, [currentDate, games, selectedTeam]);

  const lastFiveGames = useMemo(() => {
    if (!selectedTeam) {
      return [];
    }

    return games
      .filter(
        (game) =>
          game.status === 'completed' &&
          (game.awayTeam === selectedTeam.id || game.homeTeam === selectedTeam.id),
      )
      .sort((left, right) => (left.date === right.date ? right.gameId.localeCompare(left.gameId) : right.date.localeCompare(left.date)))
      .slice(0, 5);
  }, [games, selectedTeam]);

  if (!selectedTeam) {
    return null;
  }

  const divisionKey = `${selectedTeam.league}:${selectedTeam.division}`;
  const divisionRank = (sortedDivisionTeams.get(divisionKey)?.findIndex((team) => team.id === selectedTeam.id) ?? 0) + 1;
  const leagueRank = (sortedLeagueTeams.get(selectedTeam.league)?.findIndex((team) => team.id === selectedTeam.id) ?? 0) + 1;
  const teamHits = hitsByTeamId.get(selectedTeam.id) ?? 0;
  const teamRunDiff = selectedTeam.runsScored - selectedTeam.runsAllowed;
  const lastFiveRecord = lastFiveGames.reduce(
    (accumulator, game) => {
      const didWin = (game.awayTeam === selectedTeam.id && game.score.away > game.score.home) || (game.homeTeam === selectedTeam.id && game.score.home > game.score.away);
      if (didWin) {
        accumulator.wins += 1;
      } else {
        accumulator.losses += 1;
      }
      return accumulator;
    },
    { wins: 0, losses: 0 },
  );
  const sortedTeamsByLeague = useMemo(
    () =>
      (['Platinum', 'Prestige'] as const).map((league) => ({
        league,
        teams: teams
          .filter((team) => team.league === league)
          .sort((left, right) => left.city.localeCompare(right.city)),
      })),
    [teams],
  );

  const activeRosterSeasonYear = useMemo(() => {
    if (!selectedTeam) {
      return null;
    }

    const teamRosterYears = rosterSlots
      .filter((slot) => slot.teamId === selectedTeam.id)
      .map((slot) => slot.seasonYear);

    if (teamRosterYears.length === 0) {
      return null;
    }

    return Math.max(...teamRosterYears);
  }, [rosterSlots, selectedTeam]);

  const selectedTeamRosterBySlot = useMemo(() => {
    const map = new Map<string, {
      player: Player;
      battingStat: PlayerSeasonBatting | null;
      pitchingStat: PlayerSeasonPitching | null;
      battingRatings: PlayerBattingRatings | null;
      pitchingRatings: PlayerPitchingRatings | null;
    }>();

    if (!selectedTeam || activeRosterSeasonYear === null) {
      return map;
    }

    rosterSlots
      .filter((slot) => slot.teamId === selectedTeam.id && slot.seasonYear === activeRosterSeasonYear)
      .forEach((slot) => {
        const player = playersById.get(slot.playerId);
        if (!player) {
          return;
        }

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
    latestBattingStatsByPlayerId,
    latestBattingRatingsByPlayerId,
    latestPitchingStatsByPlayerId,
    latestPitchingRatingsByPlayerId,
    playersById,
    rosterSlots,
    selectedTeam,
  ]);

  const teamRosterPlayers = useMemo(() => {
    const slotOrder = [...BATTING_ROSTER_SLOTS, ...STARTING_PITCHER_SLOTS, ...BULLPEN_ROSTER_SLOTS];
    return slotOrder
      .map((slotCode) => {
        const entry = selectedTeamRosterBySlot.get(slotCode);
        if (!entry) {
          return null;
        }
        const overall = entry.battingRatings?.overall ?? entry.pitchingRatings?.overall ?? 0;
        const potentialOverall = entry.battingRatings?.potentialOverall ?? entry.pitchingRatings?.potentialOverall ?? 0;
        return {
          slotCode,
          overall,
          potentialOverall,
          ...entry,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => right.overall - left.overall || left.player.lastName.localeCompare(right.player.lastName));
  }, [selectedTeamRosterBySlot]);
  const battingOrder = useMemo(
    () =>
      generateBattingOrder(
        BATTING_ROSTER_SLOTS.map((slotCode) => teamRosterPlayers.find((entry) => entry.slotCode === slotCode) ?? null).filter(
          (entry): entry is TeamRosterEntry => entry !== null,
        ),
      ),
    [teamRosterPlayers],
  );
  const startingRotation = useMemo(
    () =>
      STARTING_PITCHER_SLOTS.map((slotCode) => teamRosterPlayers.find((entry) => entry.slotCode === slotCode) ?? null).filter(
        (entry): entry is TeamRosterEntry => entry !== null,
      ),
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
  const selectedRosterPotentialOverall =
    selectedRosterPlayer?.battingRatings?.potentialOverall ?? selectedRosterPlayer?.pitchingRatings?.potentialOverall ?? null;

  return (
    <section className="space-y-6">
      <section className="rounded-3xl border border-white/10 bg-[linear-gradient(180deg,#1a1a1a,#131313)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Team Directory</p>
            <h2 className="font-display text-3xl uppercase tracking-[0.12em] text-white mt-1">Teams</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
              <TeamLogo team={selectedTeam} sizeClass="h-12 w-12" />
              <div>
                <p className="font-display text-2xl uppercase tracking-[0.08em] text-white leading-none">
                  {selectedTeam.city}
                </p>
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500 mt-1">
                  {selectedTeam.name} | {formatRecord(selectedTeam)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsDirectoryOpen((previous) => !previous)}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-display text-lg uppercase tracking-[0.12em] text-white hover:border-white/20"
            >
              Choose Team
              {isDirectoryOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {isDirectoryOpen && (
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4 rounded-3xl border border-white/10 bg-black/20 p-4 max-h-[480px] overflow-y-auto scrollbar-subtle">
            {sortedTeamsByLeague.map(({ league, teams: leagueTeams }) => (
              <div key={league}>
                <div className="mb-3 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${league === 'Platinum' ? 'bg-platinum' : 'bg-prestige'}`} />
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{league}</p>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {leagueTeams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => {
                        onSelectTeamId(team.id);
                        setIsDirectoryOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                        selectedTeam.id === team.id
                          ? 'border-white/20 bg-white/10'
                          : 'border-white/10 bg-black/20 hover:border-white/20'
                      }`}
                    >
                      <TeamLogo team={team} sizeClass="h-12 w-12" />
                      <div className="min-w-0">
                        <p className="font-display text-xl uppercase tracking-[0.08em] text-white leading-none truncate">{team.city}</p>
                        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500 mt-1 truncate">
                          {team.name} | {formatRecord(team)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-6">
        <section className="rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),linear-gradient(135deg,#181818,#242424,#171717)] p-6">
          <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_160px] gap-6 items-start">
            <div className="rounded-3xl border border-white/10 bg-black/25 p-5 flex flex-col items-center justify-center text-center">
              <TeamLogo team={selectedTeam} sizeClass="h-36 w-36" />
              <p className="mt-4 font-display text-4xl uppercase tracking-[0.14em] text-white">{selectedTeam.city}</p>
              <p className="font-display text-2xl uppercase tracking-[0.12em] text-zinc-400">{selectedTeam.name}</p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{selectedTeam.league} {selectedTeam.division}</p>
                  <h1 className="font-display text-5xl uppercase tracking-[0.14em] text-white mt-1">
                    {selectedTeam.city} {selectedTeam.name}
                  </h1>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current Record</p>
                  <p className="font-display text-4xl uppercase tracking-[0.1em] text-white mt-1">{formatRecord(selectedTeam)}</p>
                  <p className="font-mono text-xs text-zinc-400 mt-1">{formatPct(selectedTeam)} pct</p>
                </div>
              </div>

              <p className="max-w-4xl text-zinc-300 leading-relaxed">
                {describeTeam(selectedTeam, divisionRank, leagueRank)}
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Runs Rank</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">#{runRanks.get(selectedTeam.id) ?? 0}</p>
                  <p className="font-mono text-xs text-zinc-400 mt-1">{selectedTeam.runsScored} RS</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Hits Rank</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">#{hitRanks.get(selectedTeam.id) ?? 0}</p>
                  <p className="font-mono text-xs text-zinc-400 mt-1">{teamHits} H</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Division Rank</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">#{divisionRank}</p>
                  <p className="font-mono text-xs text-zinc-400 mt-1">{selectedTeam.division} Division</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">League Rank</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">#{leagueRank}</p>
                  <p className="font-mono text-xs text-zinc-400 mt-1">{selectedTeam.league}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current Record</p>
                <p className="font-display text-4xl uppercase tracking-[0.08em] text-white mt-2">{formatRecord(selectedTeam)}</p>
                <p className="font-mono text-xs text-zinc-400 mt-1">{formatPct(selectedTeam)} pct</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#151515] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Run Differential</p>
                <p className="font-display text-4xl uppercase tracking-[0.08em] text-white mt-2">
                  {teamRunDiff >= 0 ? '+' : ''}{teamRunDiff}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="rounded-3xl border border-white/10 bg-[#171717] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Lineup Logic</p>
                <h2 className="font-display text-3xl uppercase tracking-[0.12em] text-white mt-1">Batting Order</h2>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Weighted Assignment</p>
            </div>
            <div className="mt-4 space-y-3">
              {battingOrder.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-10 text-center">
                  <p className="font-display text-2xl uppercase tracking-[0.1em] text-zinc-300">Lineup Unavailable</p>
                  <p className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                    This team needs all nine batting slots populated to build the order.
                  </p>
                </div>
              ) : (
                battingOrder.map((entry, index) => (
                  <button
                    key={`batting-order-${entry.player.playerId}`}
                    onClick={() => setSelectedRosterPlayerId(entry.player.playerId)}
                    className={`grid w-full grid-cols-[48px_minmax(0,1fr)_88px] items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors ${
                      selectedRosterPlayerId === entry.player.playerId
                        ? 'border-white/20 bg-white/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20'
                    }`}
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                      <span className="font-display text-2xl uppercase tracking-[0.08em] text-white">{index + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-2xl uppercase tracking-[0.08em] text-white truncate">
                        {entry.player.firstName} {entry.player.lastName}
                      </p>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500 truncate">
                        {entry.player.primaryPosition}
                        {entry.player.secondaryPosition ? ` / ${entry.player.secondaryPosition}` : ''} | {entry.slotCode}
                      </p>
                      <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-zinc-400 truncate">
                        {entry.battingRatings
                          ? `Con ${entry.battingRatings.contact} | Pow ${entry.battingRatings.power} | Disc ${entry.battingRatings.plateDiscipline} | Spd ${entry.battingRatings.speed}`
                          : 'Ratings unavailable'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">OVR</p>
                      <p className={`mt-1 font-display text-3xl font-bold uppercase tracking-[0.08em] ${getOverallTextClass(entry.overall)}`}>{entry.overall}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#171717] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Pitching Staff</p>
                <h2 className="font-display text-3xl uppercase tracking-[0.12em] text-white mt-1">Starting Rotation</h2>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">SP1 through SP5</p>
            </div>
            <div className="mt-4 space-y-3">
              {startingRotation.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-10 text-center">
                  <p className="font-display text-2xl uppercase tracking-[0.1em] text-zinc-300">Rotation Unavailable</p>
                  <p className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                    Populate the five starter slots to show the rotation order.
                  </p>
                </div>
              ) : (
                startingRotation.map((entry, index) => (
                  <button
                    key={`rotation-${entry.player.playerId}`}
                    onClick={() => setSelectedRosterPlayerId(entry.player.playerId)}
                    className={`grid w-full grid-cols-[56px_minmax(0,1fr)_96px] items-center gap-4 rounded-2xl border px-4 py-4 text-left transition-colors ${
                      selectedRosterPlayerId === entry.player.playerId
                        ? 'border-white/20 bg-white/10'
                        : 'border-white/10 bg-black/20 hover:border-white/20'
                    }`}
                  >
                    <div className="flex h-12 min-w-[56px] items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                      <span className="font-display text-xl uppercase tracking-[0.08em] text-white">#{index + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-2xl uppercase tracking-[0.08em] text-white truncate">
                        {entry.player.firstName} {entry.player.lastName}
                      </p>
                      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500 truncate">
                        {entry.slotCode} | {entry.player.throws}HP
                        {entry.player.secondaryPosition ? ` | ${entry.player.primaryPosition}/${entry.player.secondaryPosition}` : ` | ${entry.player.primaryPosition}`}
                      </p>
                      <p className="mt-2 font-mono text-xs uppercase tracking-[0.14em] text-zinc-400 truncate">
                        {entry.pitchingRatings
                          ? `Stuff ${entry.pitchingRatings.stuff} | Cmd ${entry.pitchingRatings.command} | Ctl ${entry.pitchingRatings.control} | Sta ${entry.pitchingRatings.stamina}`
                          : 'Ratings unavailable'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">OVR</p>
                      <p className={`mt-1 font-display text-3xl font-bold uppercase tracking-[0.08em] ${getOverallTextClass(entry.overall)}`}>{entry.overall}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        </section>

        <section className="rounded-3xl border border-white/10 bg-[#171717] p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-zinc-400" />
              <h2 className="font-display text-3xl uppercase tracking-[0.12em] text-white">Roster</h2>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              {selectedTeamRosterBySlot.size}/19 assigned{activeRosterSeasonYear !== null ? ` | ${activeRosterSeasonYear}` : ''}
            </p>
          </div>
          <div className="mt-4 grid grid-cols-1 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] gap-6">
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
                    {selectedTeam ? `${selectedTeam.city} ${selectedTeam.name}` : 'Roster Card'}
                  </p>
                  <h2 className="font-display text-4xl uppercase tracking-[0.12em] text-white mt-2 break-words">
                    {selectedRosterPlayer ? `${selectedRosterPlayer.player.firstName} ${selectedRosterPlayer.player.lastName}` : 'Roster Pending'}
                  </h2>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400 mt-2">
                    {selectedRosterPlayer
                      ? `${selectedRosterPlayer.player.primaryPosition}${selectedRosterPlayer.player.secondaryPosition ? ` / ${selectedRosterPlayer.player.secondaryPosition}` : ''} | ${selectedRosterPlayer.player.status.replace('_', ' ')}`
                      : 'No rostered players loaded yet.'}
                  </p>
                  <p className="text-sm text-zinc-300 mt-4">
                    {selectedRosterPlayer
                      ? `Age ${selectedRosterPlayer.player.age}. Bats ${selectedRosterPlayer.player.bats}, throws ${selectedRosterPlayer.player.throws}. Currently attached to the ${selectedTeam.city} organization.`
                      : 'This panel will show the currently selected player on the team roster.'}
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
                        strokeDashoffset={getOverallRingOffset(selectedRosterOverall)}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">OVR</span>
                      <span className={`font-display text-4xl font-bold uppercase tracking-[0.06em] leading-none mt-1 ${getOverallTextClass(selectedRosterOverall)}`}>
                        {selectedRosterOverall ?? '---'}
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
                    {selectedRosterPlayer?.player.primaryPosition ?? '---'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Roster Slot</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                    {selectedRosterPlayer?.slotCode ?? '---'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Age</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                    {selectedRosterPlayer?.player.age ?? '---'}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Potential</p>
                  <p className="font-display text-3xl uppercase tracking-[0.08em] text-white mt-2">
                    {selectedRosterPotentialOverall ?? '---'}
                  </p>
                </div>
              </div>

              <section className="rounded-2xl border border-white/10 bg-black/20 p-4 mt-5">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-zinc-300" />
                  <h3 className="font-display text-xl uppercase tracking-[0.1em] text-white">Attributes</h3>
                </div>
                {selectedRosterPlayer ? (
                  selectedRosterPlayer.player.playerType === 'batter' && selectedRosterPlayer.battingRatings ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-sm">
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Contact</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.contact}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Power</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.power}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Discipline</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.plateDiscipline}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Avoid K</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.avoidStrikeout}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Speed</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.speed}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Baserun</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.baserunning}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Fielding</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.fielding}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Arm</span><span className="text-zinc-100">{selectedRosterPlayer.battingRatings.arm}</span></div>
                    </div>
                  ) : selectedRosterPlayer.player.playerType === 'pitcher' && selectedRosterPlayer.pitchingRatings ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono text-sm">
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Stuff</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.stuff}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Command</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.command}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Control</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.control}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Movement</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.movement}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Stamina</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.stamina}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Hold</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.holdRunners}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Fielding</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.fielding}</span></div>
                      <div className="flex justify-between gap-3"><span className="text-zinc-500">Pot OVR</span><span className="text-zinc-100">{selectedRosterPlayer.pitchingRatings.potentialOverall}</span></div>
                    </div>
                  ) : (
                    <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No ratings loaded for this player yet.</p>
                  )
                ) : (
                  <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">No rostered players loaded yet.</p>
                )}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
                <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="h-4 w-4 text-platinum" />
                    <h3 className="font-display text-xl uppercase tracking-[0.1em] text-white">Batting Stats</h3>
                  </div>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">AVG</span><span className="text-zinc-100">{selectedRosterPlayer?.battingStat ? formatBattingAverage(selectedRosterPlayer.battingStat.avg) : '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">OPS</span><span className="text-zinc-100">{selectedRosterPlayer?.battingStat ? selectedRosterPlayer.battingStat.ops.toFixed(3) : '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">AB</span><span className="text-zinc-100">{selectedRosterPlayer?.battingStat?.atBats ?? '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">H</span><span className="text-zinc-100">{selectedRosterPlayer?.battingStat?.hits ?? '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">HR</span><span className="text-zinc-100">{selectedRosterPlayer?.battingStat?.homeRuns ?? '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">RBI</span><span className="text-zinc-100">{selectedRosterPlayer?.battingStat?.rbi ?? '---'}</span></div>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="h-4 w-4 text-prestige" />
                    <h3 className="font-display text-xl uppercase tracking-[0.1em] text-white">Pitching Stats</h3>
                  </div>
                  <div className="space-y-2 font-mono text-sm">
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">ERA</span><span className="text-zinc-100">{selectedRosterPlayer?.pitchingStat ? selectedRosterPlayer.pitchingStat.era.toFixed(2) : '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">WHIP</span><span className="text-zinc-100">{selectedRosterPlayer?.pitchingStat ? selectedRosterPlayer.pitchingStat.whip.toFixed(2) : '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">W-L</span><span className="text-zinc-100">{selectedRosterPlayer?.pitchingStat ? `${selectedRosterPlayer.pitchingStat.wins}-${selectedRosterPlayer.pitchingStat.losses}` : '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">K</span><span className="text-zinc-100">{selectedRosterPlayer?.pitchingStat?.strikeouts ?? '---'}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-zinc-500">IP</span><span className="text-zinc-100">{selectedRosterPlayer?.pitchingStat?.inningsPitched ?? '---'}</span></div>
                  </div>
                </section>
              </div>
            </aside>

            <section className="order-2 xl:order-2 rounded-3xl border border-white/10 bg-[#171717] p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-zinc-400" />
                  <h3 className="font-display text-2xl uppercase tracking-[0.12em] text-white">Player List</h3>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  {teamRosterPlayers.length} results
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
                  {teamRosterPlayers.length === 0 ? (
                    <div className="px-4 py-12 text-center">
                      <p className="font-display text-3xl uppercase tracking-[0.12em] text-zinc-300">No Players Loaded</p>
                      <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500 mt-3">
                        Generate or assign players to populate this club roster.
                      </p>
                    </div>
                  ) : (
                    teamRosterPlayers.map((entry) => {
                      const isSelected = entry.player.playerId === selectedRosterPlayerId;
                      return (
                        <button
                          key={entry.player.playerId}
                          onClick={() => setSelectedRosterPlayerId(entry.player.playerId)}
                          className={`grid w-full grid-cols-[56px_minmax(0,1.7fr)_84px_84px_84px_84px] gap-3 px-4 py-3 text-left transition-colors ${
                            isSelected ? 'bg-white/10' : 'bg-transparent hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center">
                            <TeamLogo team={selectedTeam} sizeClass="h-11 w-11" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-display text-xl uppercase tracking-[0.08em] text-white truncate">
                              {entry.player.firstName} {entry.player.lastName}
                            </p>
                          </div>
                          <span className="font-display text-xl uppercase tracking-[0.06em] text-zinc-100">{entry.player.primaryPosition}</span>
                          <span className="font-display text-xl uppercase tracking-[0.06em] text-zinc-100">{entry.player.age}</span>
                          <span className={`font-display text-xl font-bold uppercase tracking-[0.06em] ${getOverallTextClass(entry.overall || null)}`}>
                            {entry.overall || '---'}
                          </span>
                          <span className="font-display text-xl font-bold uppercase tracking-[0.06em] text-zinc-100">{entry.potentialOverall || '---'}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </section>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-6">
          <div className="rounded-3xl border border-white/10 bg-[#171717] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Schedule Outlook</p>
                <h2 className="font-display text-3xl uppercase tracking-[0.12em] text-white mt-1">Next Game</h2>
              </div>
              <CalendarClock className="h-6 w-6 text-zinc-400" />
            </div>

            {nextGame ? (
              <button
                onClick={() => onOpenGame(nextGame.gameId)}
                className="mt-4 w-full rounded-3xl border border-white/10 bg-black/20 px-5 py-5 text-left transition-colors hover:border-white/20"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-display text-3xl uppercase tracking-[0.1em] text-white">
                      {formatGameLabel(nextGame, selectedTeam.id, teamsById)}
                    </p>
                    <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                      {nextGame.date} | {getScheduledGameTimeLabel(nextGame, games)}
                    </p>
                    {nextGame.playoff && (
                      <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-zinc-400">
                        {nextGame.playoff.seriesLabel} | Game {nextGame.playoff.gameNumber}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-6 w-6 text-zinc-400" />
                </div>
              </button>
            ) : (
              <div className="mt-4 rounded-3xl border border-white/10 bg-black/20 px-5 py-8 text-center">
                <p className="font-display text-3xl uppercase tracking-[0.1em] text-zinc-300">No Scheduled Game</p>
                <p className="font-mono text-xs uppercase tracking-[0.16em] text-zinc-500 mt-2">This team has finished its current slate.</p>
              </div>
            )}

            <div className="mt-6">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-zinc-400" />
                <h3 className="font-display text-2xl uppercase tracking-[0.12em] text-white">Last 5 Games</h3>
              </div>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                {lastFiveGames.length === 0 ? (
                  <div className="md:col-span-2 xl:col-span-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-8 text-center font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
                    No completed games yet.
                  </div>
                ) : (
                  lastFiveGames.map((game) => {
                    const didWin =
                      (game.awayTeam === selectedTeam.id && game.score.away > game.score.home) ||
                      (game.homeTeam === selectedTeam.id && game.score.home > game.score.away);
                    const opponentLabel = formatGameLabel(game, selectedTeam.id, teamsById);
                    return (
                      <button
                        key={game.gameId}
                        onClick={() => onOpenGame(game.gameId)}
                        className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-left transition-colors hover:border-white/20"
                      >
                        <p className={`font-display text-3xl uppercase tracking-[0.1em] ${didWin ? 'text-platinum' : 'text-prestige'}`}>
                          {didWin ? 'W' : 'L'}
                        </p>
                        <p className="mt-2 font-display text-xl uppercase tracking-[0.08em] text-white">{game.score.away}-{game.score.home}</p>
                        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">{game.date}</p>
                        <p className="mt-2 text-sm text-zinc-300 leading-snug">{opponentLabel}</p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-[#171717] p-5">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-zinc-400" />
              <h2 className="font-display text-3xl uppercase tracking-[0.12em] text-white">Club Snapshot</h2>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Last 5</p>
                <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{lastFiveRecord.wins}-{lastFiveRecord.losses}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Baseline Wins</p>
                <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{selectedTeam.previousBaselineWins}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Offense</p>
                <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{selectedTeam.runsScored} Runs</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Contact</p>
                <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{teamHits} Hits</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Prevention</p>
                <p className="mt-2 font-display text-3xl uppercase tracking-[0.08em] text-white">{selectedTeam.runsAllowed} RA</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};
