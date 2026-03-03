import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Crown, Shield, Target, Trophy } from 'lucide-react';
import {
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  Team,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { formatBattingAverage } from '../logic/statFormatting';
import { TeamLogo } from './TeamLogo';

interface LeadersHubProps {
  teams: Team[];
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
}

type LeadersMode = 'players' | 'teams';
type PlayerBoard = 'batting' | 'pitching' | 'awards';
type TeamStatKey = 'wins' | 'pct' | 'run_diff' | 'runs_scored' | 'runs_allowed';

type PlayerOddsEntry = {
  playerId: string;
  playerName: string;
  team: Team | null;
  odds: number;
  summary: string;
};

type LeaderRow = {
  playerId: string;
  playerName: string;
  team: Team | null;
  value: string;
  subvalue: string;
};

type LeaderBoard = {
  key: string;
  title: string;
  subtitle: string;
  rows: LeaderRow[];
};

type TeamLeaderRow = {
  team: Team;
  value: number;
  displayValue: string;
  note: string;
};

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

const formatPct = (value: number): string => value.toFixed(3).replace(/^0/, '');

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeOdds = (entries: Array<Omit<PlayerOddsEntry, 'odds'>>, rawScores: number[]): PlayerOddsEntry[] => {
  const positiveScores = rawScores.map((score) => Math.max(0.1, score));
  const total = positiveScores.reduce((sum, score) => sum + score, 0);
  return entries.map((entry, index) => ({
    ...entry,
    odds: total > 0 ? Number(((positiveScores[index] / total) * 100).toFixed(1)) : 0,
  }));
};

const sectionCardClass = 'rounded-[1.75rem] border border-white/10 bg-[linear-gradient(135deg,#171717,#202020,#111111)] p-5';

const PlayerLeaderboard: React.FC<{
  board: LeaderBoard;
  currentIndex: number;
  totalBoards: number;
  onPrevious: () => void;
  onNext: () => void;
}> = ({ board, currentIndex, totalBoards, onPrevious, onNext }) => (
  <section className={sectionCardClass}>
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">{board.subtitle}</p>
        <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">{board.title}</p>
      </div>
      <div className="flex items-center gap-2 self-start md:self-auto">
        <div className="rounded-full border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
          {currentIndex + 1} / {totalBoards}
        </div>
        <button
          type="button"
          onClick={onPrevious}
          className="rounded-full border border-white/10 bg-black/25 p-2 text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
          aria-label={`Previous ${board.title} leaderboard`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNext}
          className="rounded-full border border-white/10 bg-black/25 p-2 text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
          aria-label={`Next ${board.title} leaderboard`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>

    <div className="mt-4 flex flex-col gap-3 border-t border-white/5 pt-4 md:flex-row md:items-center md:justify-between">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {board.rows.length} players ranked
      </p>
      <div className="flex items-center gap-1">
        {Array.from({ length: totalBoards }, (_, index) => (
          <span
            key={`${board.key}-tick-${index}`}
            className={`h-1.5 rounded-full transition-all ${index === currentIndex ? 'w-8 bg-[#d4bb6a]' : 'w-3 bg-white/15'}`}
          />
        ))}
      </div>
    </div>

    <div className="mt-5 max-h-[860px] space-y-3 overflow-y-auto pr-2">
      {board.rows.map((row, index) => (
        <div key={`${row.playerId}-${board.key}`} className="grid grid-cols-[34px_48px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <span className="font-mono text-lg text-zinc-500">{index + 1}</span>
          {row.team ? <TeamLogo team={row.team} sizeClass="h-11 w-11" /> : <div className="h-11 w-11 rounded-xl border border-white/10 bg-white/[0.03]" />}
          <div className="min-w-0">
            <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white truncate">{row.playerName}</p>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 truncate">
              {row.team ? `${row.team.city} ${row.team.name}` : 'Free Agent'} | {row.subvalue}
            </p>
          </div>
          <p className="font-mono text-xl text-zinc-100">{row.value}</p>
        </div>
      ))}
    </div>
  </section>
);

export const LeadersHub: React.FC<LeadersHubProps> = ({
  teams,
  players,
  battingStats,
  pitchingStats,
  battingRatings,
  pitchingRatings,
}) => {
  const [mode, setMode] = useState<LeadersMode>('players');
  const [playerBoard, setPlayerBoard] = useState<PlayerBoard>('batting');
  const [teamStatKey, setTeamStatKey] = useState<TeamStatKey>('wins');
  const [battingBoardIndex, setBattingBoardIndex] = useState(0);
  const [pitchingBoardIndex, setPitchingBoardIndex] = useState(0);

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const battingByPlayerId = useMemo(() => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'), [battingStats]);
  const pitchingByPlayerId = useMemo(() => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'), [pitchingStats]);
  const battingRatingsByPlayerId = useMemo(() => new Map(battingRatings.map((rating) => [rating.playerId, rating])), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => new Map(pitchingRatings.map((rating) => [rating.playerId, rating])), [pitchingRatings]);

  const battingLeaderBoards = useMemo(() => {
    const allBatters = players
      .map((player) => {
        const stat = battingByPlayerId.get(player.playerId);
        if (!stat) {
          return null;
        }
        return { player, stat, team: player.teamId ? teamsById.get(player.teamId) ?? null : null };
      })
      .filter((entry): entry is { player: Player; stat: PlayerSeasonBatting; team: Team | null } => Boolean(entry));

    const qualifiedBatters = allBatters.filter((entry) => entry.stat.atBats >= 120);

    return [
      {
        key: 'avg',
        title: 'Batting Average',
        subtitle: 'Qualified Leaders',
        rows: [...qualifiedBatters]
          .sort((left, right) => right.stat.avg - left.stat.avg || right.stat.ops - left.stat.ops)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: formatBattingAverage(entry.stat.avg),
            subvalue: `${entry.stat.hits} H | ${entry.stat.atBats} AB`,
          })),
      },
      {
        key: 'ops',
        title: 'OPS',
        subtitle: 'Impact Bats',
        rows: [...qualifiedBatters]
          .sort((left, right) => right.stat.ops - left.stat.ops || right.stat.homeRuns - left.stat.homeRuns)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: entry.stat.ops.toFixed(3),
            subvalue: `${formatBattingAverage(entry.stat.avg)} AVG | ${entry.stat.homeRuns} HR`,
          })),
      },
      {
        key: 'home-runs',
        title: 'Home Runs',
        subtitle: 'Power Race',
        rows: [...allBatters]
          .sort((left, right) => right.stat.homeRuns - left.stat.homeRuns || right.stat.rbi - left.stat.rbi)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.homeRuns),
            subvalue: `${entry.stat.rbi} RBI | ${entry.stat.ops.toFixed(3)} OPS`,
          })),
      },
      {
        key: 'rbi',
        title: 'Runs Batted In',
        subtitle: 'Run Producers',
        rows: [...allBatters]
          .sort((left, right) => right.stat.rbi - left.stat.rbi || right.stat.homeRuns - left.stat.homeRuns)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.rbi),
            subvalue: `${entry.stat.homeRuns} HR | ${entry.stat.hits} H`,
          })),
      },
      {
        key: 'hits',
        title: 'Hits',
        subtitle: 'Pure Contact Volume',
        rows: [...allBatters]
          .sort((left, right) => right.stat.hits - left.stat.hits || right.stat.avg - left.stat.avg)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.hits),
            subvalue: `${entry.stat.atBats} AB | ${formatBattingAverage(entry.stat.avg)} AVG`,
          })),
      },
      {
        key: 'at-bats',
        title: 'At Bats',
        subtitle: 'Everyday Workload',
        rows: [...allBatters]
          .sort((left, right) => right.stat.atBats - left.stat.atBats || right.stat.gamesPlayed - left.stat.gamesPlayed)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.atBats),
            subvalue: `${entry.stat.gamesPlayed} G | ${entry.stat.hits} H`,
          })),
      },
    ] satisfies LeaderBoard[];
  }, [battingByPlayerId, players, teamsById]);

  const pitchingLeaderBoards = useMemo(() => {
    const allPitchers = players
      .map((player) => {
        const stat = pitchingByPlayerId.get(player.playerId);
        if (!stat) {
          return null;
        }
        return { player, stat, team: player.teamId ? teamsById.get(player.teamId) ?? null : null };
      })
      .filter((entry): entry is { player: Player; stat: PlayerSeasonPitching; team: Team | null } => Boolean(entry));

    const qualifiedPitchers = allPitchers.filter((entry) => entry.stat.inningsPitched >= 60);

    return [
      {
        key: 'era',
        title: 'Earned Run Average',
        subtitle: 'Qualified Arms',
        rows: [...qualifiedPitchers]
          .sort((left, right) => left.stat.era - right.stat.era || left.stat.whip - right.stat.whip)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: entry.stat.era.toFixed(2),
            subvalue: `${entry.stat.inningsPitched.toFixed(1)} IP | ${entry.stat.whip.toFixed(2)} WHIP`,
          })),
      },
      {
        key: 'whip',
        title: 'WHIP',
        subtitle: 'Traffic Control',
        rows: [...qualifiedPitchers]
          .sort((left, right) => left.stat.whip - right.stat.whip || left.stat.era - right.stat.era)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: entry.stat.whip.toFixed(2),
            subvalue: `${entry.stat.era.toFixed(2)} ERA | ${entry.stat.inningsPitched.toFixed(1)} IP`,
          })),
      },
      {
        key: 'strikeouts',
        title: 'Strikeouts',
        subtitle: 'Swing-And-Miss',
        rows: [...allPitchers]
          .sort((left, right) => right.stat.strikeouts - left.stat.strikeouts || right.stat.inningsPitched - left.stat.inningsPitched)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.strikeouts),
            subvalue: `${entry.stat.inningsPitched.toFixed(1)} IP | ${entry.stat.wins}-${entry.stat.losses}`,
          })),
      },
      {
        key: 'wins',
        title: 'Wins',
        subtitle: 'Pitcher Decisions',
        rows: [...allPitchers]
          .sort((left, right) => right.stat.wins - left.stat.wins || left.stat.era - right.stat.era)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.wins),
            subvalue: `${entry.stat.losses} L | ${entry.stat.era.toFixed(2)} ERA`,
          })),
      },
      {
        key: 'saves',
        title: 'Saves',
        subtitle: 'Closers',
        rows: [...allPitchers]
          .sort((left, right) => right.stat.saves - left.stat.saves || right.stat.strikeouts - left.stat.strikeouts)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: String(entry.stat.saves),
            subvalue: `${entry.stat.era.toFixed(2)} ERA | ${entry.stat.whip.toFixed(2)} WHIP`,
          })),
      },
      {
        key: 'innings',
        title: 'Innings Pitched',
        subtitle: 'Workhorse Load',
        rows: [...allPitchers]
          .sort((left, right) => right.stat.inningsPitched - left.stat.inningsPitched || right.stat.strikeouts - left.stat.strikeouts)
          .map((entry) => ({
            playerId: entry.player.playerId,
            playerName: `${entry.player.firstName} ${entry.player.lastName}`,
            team: entry.team,
            value: entry.stat.inningsPitched.toFixed(1),
            subvalue: `${entry.stat.strikeouts} K | ${entry.stat.wins}-${entry.stat.losses}`,
          })),
      },
    ] satisfies LeaderBoard[];
  }, [pitchingByPlayerId, players, teamsById]);

  const activeBattingBoard = battingLeaderBoards[battingBoardIndex] ?? battingLeaderBoards[0];
  const activePitchingBoard = pitchingLeaderBoards[pitchingBoardIndex] ?? pitchingLeaderBoards[0];

  const battingMvpOdds = useMemo(() => {
    const entries = players
      .map((player) => {
        const stat = battingByPlayerId.get(player.playerId);
        const rating = battingRatingsByPlayerId.get(player.playerId);
        if (!stat || !rating || stat.atBats < 120) {
          return null;
        }
        const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
        const winPctBonus = team ? getWinPct(team) * 60 : 0;
        const rawScore =
          stat.avg * 700 +
          stat.ops * 260 +
          stat.homeRuns * 4 +
          stat.rbi * 1.75 +
          stat.hits * 0.5 +
          stat.runsScored * 0.7 +
          rating.overall * 0.45 +
          winPctBonus;
        return {
          rawScore,
          entry: {
            playerId: player.playerId,
            playerName: `${player.firstName} ${player.lastName}`,
            team,
            summary: `${formatBattingAverage(stat.avg)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI | ${rating.overall} OVR`,
          },
        };
      })
      .filter((entry): entry is { rawScore: number; entry: Omit<PlayerOddsEntry, 'odds'> } => Boolean(entry))
      .sort((left, right) => right.rawScore - left.rawScore)
      .slice(0, 8);

    return normalizeOdds(entries.map((entry) => entry.entry), entries.map((entry) => entry.rawScore));
  }, [battingByPlayerId, battingRatingsByPlayerId, players, teamsById]);

  const pitchingMvpOdds = useMemo(() => {
    const entries = players
      .map((player) => {
        const stat = pitchingByPlayerId.get(player.playerId);
        const rating = pitchingRatingsByPlayerId.get(player.playerId);
        if (!stat || !rating || (stat.inningsPitched < 50 && stat.saves < 12)) {
          return null;
        }
        const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
        const winPctBonus = team ? getWinPct(team) * 55 : 0;
        const rawScore =
          clamp(6 - stat.era, 0, 6) * 40 +
          clamp(2 - stat.whip, 0, 2) * 70 +
          stat.strikeouts * 0.9 +
          stat.wins * 4.5 +
          stat.saves * 2.25 +
          stat.inningsPitched * 1.1 +
          rating.overall * 0.45 +
          winPctBonus;
        return {
          rawScore,
          entry: {
            playerId: player.playerId,
            playerName: `${player.firstName} ${player.lastName}`,
            team,
            summary: `${stat.era.toFixed(2)} ERA | ${stat.strikeouts} K | ${stat.inningsPitched.toFixed(1)} IP | ${rating.overall} OVR`,
          },
        };
      })
      .filter((entry): entry is { rawScore: number; entry: Omit<PlayerOddsEntry, 'odds'> } => Boolean(entry))
      .sort((left, right) => right.rawScore - left.rawScore)
      .slice(0, 8);

    return normalizeOdds(entries.map((entry) => entry.entry), entries.map((entry) => entry.rawScore));
  }, [pitchingByPlayerId, pitchingRatingsByPlayerId, players, teamsById]);

  const teamLeaderRows = useMemo(() => {
    const rows: TeamLeaderRow[] = teams.map((team) => {
      const runDiff = team.runsScored - team.runsAllowed;
      if (teamStatKey === 'wins') {
        return { team, value: team.wins, displayValue: String(team.wins), note: `${team.wins}-${team.losses}` };
      }
      if (teamStatKey === 'pct') {
        const pct = getWinPct(team);
        return { team, value: pct, displayValue: formatPct(pct), note: `${team.wins}-${team.losses}` };
      }
      if (teamStatKey === 'run_diff') {
        return { team, value: runDiff, displayValue: `${runDiff > 0 ? '+' : ''}${runDiff}`, note: `${team.runsScored} RS | ${team.runsAllowed} RA` };
      }
      if (teamStatKey === 'runs_scored') {
        return { team, value: team.runsScored, displayValue: String(team.runsScored), note: `${runDiff > 0 ? '+' : ''}${runDiff} RD` };
      }
      return { team, value: -team.runsAllowed, displayValue: String(team.runsAllowed), note: `${runDiff > 0 ? '+' : ''}${runDiff} RD` };
    });

    return rows.sort((left, right) => right.value - left.value || left.team.city.localeCompare(right.team.city));
  }, [teamStatKey, teams]);

  const teamStatLabel = teamStatKey === 'wins'
    ? 'Wins'
    : teamStatKey === 'pct'
      ? 'Win Pct'
      : teamStatKey === 'run_diff'
        ? 'Run Diff'
        : teamStatKey === 'runs_scored'
          ? 'Runs Scored'
          : 'Runs Allowed';

  return (
    <section className="space-y-6">
      <article className="rounded-[2rem] border border-[#d4bb6a]/20 bg-[linear-gradient(135deg,#171717,#232323,#101010)] p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">League Intelligence</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Leaders</p>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
              Track full player and team ranking boards across the league, then flip through stat categories without leaving the page.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-2xl border border-white/10 bg-black/25 p-1">
              <button
                onClick={() => setMode('players')}
                className={`rounded-xl px-4 py-2 font-headline text-xl uppercase tracking-[0.08em] transition-colors ${mode === 'players' ? 'bg-white text-black' : 'text-zinc-300'}`}
              >
                Players
              </button>
              <button
                onClick={() => setMode('teams')}
                className={`rounded-xl px-4 py-2 font-headline text-xl uppercase tracking-[0.08em] transition-colors ${mode === 'teams' ? 'bg-white text-black' : 'text-zinc-300'}`}
              >
                Teams
              </button>
            </div>

            {mode === 'players' ? (
              <div className="inline-flex rounded-2xl border border-white/10 bg-black/25 p-1">
                <button onClick={() => setPlayerBoard('batting')} className={`rounded-xl px-4 py-2 font-headline text-lg uppercase tracking-[0.08em] ${playerBoard === 'batting' ? 'bg-prestige text-black' : 'text-zinc-300'}`}>Batting</button>
                <button onClick={() => setPlayerBoard('pitching')} className={`rounded-xl px-4 py-2 font-headline text-lg uppercase tracking-[0.08em] ${playerBoard === 'pitching' ? 'bg-platinum text-black' : 'text-zinc-300'}`}>Pitching</button>
                <button onClick={() => setPlayerBoard('awards')} className={`rounded-xl px-4 py-2 font-headline text-lg uppercase tracking-[0.08em] ${playerBoard === 'awards' ? 'bg-[#d4bb6a] text-black' : 'text-zinc-300'}`}>Awards</button>
              </div>
            ) : (
              <select
                value={teamStatKey}
                onChange={(event) => setTeamStatKey(event.target.value as TeamStatKey)}
                className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm uppercase tracking-[0.12em] text-white outline-none"
              >
                <option value="wins">Wins</option>
                <option value="pct">Win Pct</option>
                <option value="run_diff">Run Diff</option>
                <option value="runs_scored">Runs Scored</option>
                <option value="runs_allowed">Runs Allowed</option>
              </select>
            )}
          </div>
        </div>
      </article>

      {mode === 'players' && playerBoard === 'batting' && activeBattingBoard && (
        <PlayerLeaderboard
          board={activeBattingBoard}
          currentIndex={battingBoardIndex}
          totalBoards={battingLeaderBoards.length}
          onPrevious={() => setBattingBoardIndex((current) => (current - 1 + battingLeaderBoards.length) % battingLeaderBoards.length)}
          onNext={() => setBattingBoardIndex((current) => (current + 1) % battingLeaderBoards.length)}
        />
      )}

      {mode === 'players' && playerBoard === 'pitching' && activePitchingBoard && (
        <PlayerLeaderboard
          board={activePitchingBoard}
          currentIndex={pitchingBoardIndex}
          totalBoards={pitchingLeaderBoards.length}
          onPrevious={() => setPitchingBoardIndex((current) => (current - 1 + pitchingLeaderBoards.length) % pitchingLeaderBoards.length)}
          onNext={() => setPitchingBoardIndex((current) => (current + 1) % pitchingLeaderBoards.length)}
        />
      )}

      {mode === 'players' && playerBoard === 'awards' && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className={sectionCardClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Award Race</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">Batting MVP Odds</p>
              </div>
              <Crown className="h-5 w-5 text-[#d4bb6a]" />
            </div>
            <div className="mt-5 space-y-3">
              {battingMvpOdds.map((entry, index) => (
                <div key={entry.playerId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-lg text-zinc-500">{index + 1}</span>
                      {entry.team ? <TeamLogo team={entry.team} sizeClass="h-12 w-12" /> : <div className="h-12 w-12 rounded-xl border border-white/10 bg-white/[0.03]" />}
                      <div className="min-w-0">
                        <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white truncate">{entry.playerName}</p>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 truncate">{entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free Agent'}</p>
                      </div>
                    </div>
                    <p className="font-mono text-xl text-[#ecd693]">{entry.odds.toFixed(1)}%</p>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#d4bb6a,#f0e4b1)]" style={{ width: `${Math.max(8, entry.odds)}%` }} />
                  </div>
                  <p className="mt-3 text-sm text-zinc-400">{entry.summary}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={sectionCardClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Award Race</p>
                <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">Pitching MVP Odds</p>
              </div>
              <Trophy className="h-5 w-5 text-platinum" />
            </div>
            <div className="mt-5 space-y-3">
              {pitchingMvpOdds.map((entry, index) => (
                <div key={entry.playerId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-lg text-zinc-500">{index + 1}</span>
                      {entry.team ? <TeamLogo team={entry.team} sizeClass="h-12 w-12" /> : <div className="h-12 w-12 rounded-xl border border-white/10 bg-white/[0.03]" />}
                      <div className="min-w-0">
                        <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white truncate">{entry.playerName}</p>
                        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 truncate">{entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free Agent'}</p>
                      </div>
                    </div>
                    <p className="font-mono text-xl text-platinum">{entry.odds.toFixed(1)}%</p>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#0fe7d5,#9ff5ec)]" style={{ width: `${Math.max(8, entry.odds)}%` }} />
                  </div>
                  <p className="mt-3 text-sm text-zinc-400">{entry.summary}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {mode === 'teams' && (
        <section className={sectionCardClass}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Club Rankings</p>
              <p className="mt-1 font-headline text-3xl uppercase tracking-[0.08em] text-white">{teamStatLabel}</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-300">
              <BarChart3 className="h-4 w-4" />
              32 Club Board
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {teamLeaderRows.map((row, index) => (
              <div key={`${row.team.id}-${teamStatKey}`} className="grid grid-cols-[34px_56px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <span className="font-mono text-lg text-zinc-500">{index + 1}</span>
                <TeamLogo team={row.team} sizeClass="h-14 w-14" />
                <div className="min-w-0">
                  <p className="font-headline text-2xl uppercase tracking-[0.08em] text-white truncate">{row.team.city}</p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 truncate">
                    {row.team.name} | {row.team.league} {row.team.division}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl text-zinc-100">{row.displayValue}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{row.note}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-prestige" />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Best record</p>
              </div>
              <p className="mt-3 font-headline text-2xl uppercase tracking-[0.08em] text-white">
                {teamLeaderRows[0] ? `${teamLeaderRows[0].team.city} ${teamLeaderRows[0].team.name}` : 'TBD'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-platinum" />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Highest scoring</p>
              </div>
              <p className="mt-3 font-headline text-2xl uppercase tracking-[0.08em] text-white">
                {teams.slice().sort((left, right) => right.runsScored - left.runsScored)[0]
                  ? `${teams.slice().sort((left, right) => right.runsScored - left.runsScored)[0].city} ${teams.slice().sort((left, right) => right.runsScored - left.runsScored)[0].name}`
                  : 'TBD'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2">
                <Trophy className="h-4 w-4 text-[#d4bb6a]" />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Best prevention</p>
              </div>
              <p className="mt-3 font-headline text-2xl uppercase tracking-[0.08em] text-white">
                {teams.slice().sort((left, right) => left.runsAllowed - right.runsAllowed)[0]
                  ? `${teams.slice().sort((left, right) => left.runsAllowed - right.runsAllowed)[0].city} ${teams.slice().sort((left, right) => left.runsAllowed - right.runsAllowed)[0].name}`
                  : 'TBD'}
              </p>
            </div>
          </div>
        </section>
      )}
    </section>
  );
};
