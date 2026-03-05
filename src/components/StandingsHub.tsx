import React, { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, Layers3, Shield } from 'lucide-react';
import {
  BATTING_ROSTER_SLOTS,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { TeamLogo } from './TeamLogo';

type StandingsViewMode = 'league' | 'division';
type StandingsRankKey = 'record' | 'win_pct' | 'run_diff' | 'runs_scored' | 'runs_allowed' | 'team_era' | 'team_rbi' | 'roster_strength' | 'team_whip';

interface StandingsHubProps {
  teams: Team[];
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  rosterSlots: TeamRosterSlot[];
  onSelectTeam: (teamId: string) => void;
}

interface TeamStandingRow {
  team: Team;
  gamesPlayed: number;
  winPct: number;
  runDiff: number;
  teamEra: number | null;
  teamWhip: number | null;
  teamRbi: number;
  runsScored: number;
  runsAllowed: number;
  rosterStrength: number | null;
  rosterStrengthCoverage: number;
}

const sectionClass = 'rounded-3xl border border-white/10 bg-[linear-gradient(135deg,#121212,#1e1e1e,#101010)]';
const rosterStrengthSlots = [...BATTING_ROSTER_SLOTS, ...STARTING_PITCHER_SLOTS];

const RANK_OPTIONS: Array<{ key: StandingsRankKey; label: string }> = [
  { key: 'record', label: 'Record' },
  { key: 'win_pct', label: 'Win %' },
  { key: 'run_diff', label: 'Run Differential' },
  { key: 'team_era', label: 'Team ERA' },
  { key: 'team_rbi', label: 'Team RBI' },
  { key: 'roster_strength', label: 'Roster Strength' },
  { key: 'team_whip', label: 'Team WHIP' },
  { key: 'runs_scored', label: 'Runs Scored' },
  { key: 'runs_allowed', label: 'Runs Allowed' },
];

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

const formatPct = (pct: number): string => pct.toFixed(3).replace(/^0/, '.');
const formatEra = (value: number | null): string => (value === null ? '--' : value.toFixed(2));
const formatWhip = (value: number | null): string => (value === null ? '--' : value.toFixed(2));

const compareNullableNumber = (left: number | null, right: number | null, direction: 'asc' | 'desc'): number => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === 'asc' ? left - right : right - left;
};

const compareRecord = (left: TeamStandingRow, right: TeamStandingRow): number => {
  if (right.winPct !== left.winPct) return right.winPct - left.winPct;
  if (right.team.wins !== left.team.wins) return right.team.wins - left.team.wins;
  if (right.runDiff !== left.runDiff) return right.runDiff - left.runDiff;
  return left.team.city.localeCompare(right.team.city);
};

const sortRowsByKey = (rows: TeamStandingRow[], rankKey: StandingsRankKey): TeamStandingRow[] => {
  const next = [...rows];
  next.sort((left, right) => {
    if (rankKey === 'record') {
      return compareRecord(left, right);
    }
    if (rankKey === 'win_pct') {
      if (right.winPct !== left.winPct) return right.winPct - left.winPct;
      return compareRecord(left, right);
    }
    if (rankKey === 'run_diff') {
      if (right.runDiff !== left.runDiff) return right.runDiff - left.runDiff;
      return compareRecord(left, right);
    }
    if (rankKey === 'runs_scored') {
      if (right.runsScored !== left.runsScored) return right.runsScored - left.runsScored;
      return compareRecord(left, right);
    }
    if (rankKey === 'runs_allowed') {
      if (left.runsAllowed !== right.runsAllowed) return left.runsAllowed - right.runsAllowed;
      return compareRecord(left, right);
    }
    if (rankKey === 'team_era') {
      const eraDelta = compareNullableNumber(left.teamEra, right.teamEra, 'asc');
      return eraDelta !== 0 ? eraDelta : compareRecord(left, right);
    }
    if (rankKey === 'team_whip') {
      const whipDelta = compareNullableNumber(left.teamWhip, right.teamWhip, 'asc');
      return whipDelta !== 0 ? whipDelta : compareRecord(left, right);
    }
    if (rankKey === 'team_rbi') {
      if (right.teamRbi !== left.teamRbi) return right.teamRbi - left.teamRbi;
      return compareRecord(left, right);
    }

    const strengthDelta = compareNullableNumber(left.rosterStrength, right.rosterStrength, 'desc');
    return strengthDelta !== 0 ? strengthDelta : compareRecord(left, right);
  });
  return next;
};

const getMetricLabel = (rankKey: StandingsRankKey): string => RANK_OPTIONS.find((option) => option.key === rankKey)?.label ?? 'Record';

const getMetricValue = (row: TeamStandingRow, rankKey: StandingsRankKey): string => {
  if (rankKey === 'record') return `${row.team.wins}-${row.team.losses}`;
  if (rankKey === 'win_pct') return formatPct(row.winPct);
  if (rankKey === 'run_diff') return `${row.runDiff > 0 ? '+' : ''}${row.runDiff}`;
  if (rankKey === 'runs_scored') return String(row.runsScored);
  if (rankKey === 'runs_allowed') return String(row.runsAllowed);
  if (rankKey === 'team_era') return formatEra(row.teamEra);
  if (rankKey === 'team_whip') return formatWhip(row.teamWhip);
  if (rankKey === 'team_rbi') return String(row.teamRbi);
  return row.rosterStrength === null ? '--' : String(row.rosterStrength);
};

const getGamesBack = (leader: TeamStandingRow | null, row: TeamStandingRow): string => {
  if (!leader || leader.team.id === row.team.id) {
    return '-';
  }
  const gb = ((leader.team.wins - row.team.wins) + (row.team.losses - leader.team.losses)) / 2;
  return gb.toFixed(1);
};

const StandingsPanel: React.FC<{
  title: string;
  subtitle: string;
  rows: TeamStandingRow[];
  rankKey: StandingsRankKey;
  accentClass: string;
  onSelectTeam: (teamId: string) => void;
}> = ({ title, subtitle, rows, rankKey, accentClass, onSelectTeam }) => {
  const rankedRows = useMemo(() => sortRowsByKey(rows, rankKey), [rankKey, rows]);
  const recordLeader = useMemo(() => sortRowsByKey(rows, 'record')[0] ?? null, [rows]);

  return (
    <article className={`${sectionClass} overflow-hidden p-4`}>
      <div className="mb-3 flex items-end justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <p className={`font-display text-2xl uppercase tracking-[0.1em] ${accentClass}`}>{title}</p>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{subtitle}</p>
        </div>
        <div className="rounded-full border border-white/10 bg-black/25 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-300">
          Rank: {getMetricLabel(rankKey)}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            <tr className="border-b border-white/10">
              <th className="px-2 py-2 text-center">#</th>
              <th className="px-2 py-2 text-left">Team</th>
              <th className="px-2 py-2 text-center">Metric</th>
              <th className="px-2 py-2 text-center">W-L</th>
              <th className="px-2 py-2 text-center">PCT</th>
              <th className="px-2 py-2 text-center">GB</th>
              <th className="px-2 py-2 text-center">RD</th>
              <th className="px-2 py-2 text-center">ERA</th>
              <th className="px-2 py-2 text-center">RBI</th>
              <th className="px-2 py-2 text-center">STR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rankedRows.map((row, index) => (
              <tr key={row.team.id} className="hover:bg-white/5">
                <td className="px-2 py-2 text-center font-mono text-zinc-400">{index + 1}</td>
                <td className="px-2 py-2">
                  <button type="button" onClick={() => onSelectTeam(row.team.id)} className="flex w-full items-center gap-2 text-left">
                    <TeamLogo team={row.team} sizeClass="h-10 w-10" />
                    <div className="min-w-0">
                      <p className="truncate font-display text-lg uppercase tracking-[0.06em] text-white">{row.team.city} {row.team.name}</p>
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                        {row.team.league} {row.team.division}
                      </p>
                    </div>
                  </button>
                </td>
                <td className="px-2 py-2 text-center font-display text-lg uppercase tracking-[0.06em] text-[#f3dea1]">
                  {getMetricValue(row, rankKey)}
                </td>
                <td className="px-2 py-2 text-center font-mono text-zinc-200">{row.team.wins}-{row.team.losses}</td>
                <td className="px-2 py-2 text-center font-mono text-zinc-300">{formatPct(row.winPct)}</td>
                <td className="px-2 py-2 text-center font-mono text-zinc-500">{getGamesBack(recordLeader, row)}</td>
                <td className={`px-2 py-2 text-center font-mono ${row.runDiff >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {row.runDiff > 0 ? '+' : ''}{row.runDiff}
                </td>
                <td className="px-2 py-2 text-center font-mono text-zinc-200">{formatEra(row.teamEra)}</td>
                <td className="px-2 py-2 text-center font-mono text-zinc-200">{row.teamRbi}</td>
                <td className="px-2 py-2 text-center font-mono text-zinc-200">{row.rosterStrength ?? '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
};

export const StandingsHub: React.FC<StandingsHubProps> = ({
  teams,
  players,
  battingStats,
  pitchingStats,
  battingRatings,
  pitchingRatings,
  rosterSlots,
  onSelectTeam,
}) => {
  const [viewMode, setViewMode] = useState<StandingsViewMode>('league');
  const [rankKey, setRankKey] = useState<StandingsRankKey>('record');

  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const preferredBattingByPlayerId = useMemo(() => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'), [battingStats]);
  const preferredPitchingByPlayerId = useMemo(() => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'), [pitchingStats]);
  const battingRatingsByPlayerId = useMemo(() => getLatestBattingRatingsMap(battingRatings), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => getLatestPitchingRatingsMap(pitchingRatings), [pitchingRatings]);

  const standingsRows = useMemo<TeamStandingRow[]>(() => {
    const battingTotalsByTeamId = new Map<string, { rbi: number }>();
    preferredBattingByPlayerId.forEach((stat, playerId) => {
      const player = playersById.get(playerId);
      if (!player?.teamId) return;
      const current = battingTotalsByTeamId.get(player.teamId) ?? { rbi: 0 };
      current.rbi += stat.rbi;
      battingTotalsByTeamId.set(player.teamId, current);
    });

    const pitchingTotalsByTeamId = new Map<string, { earnedRuns: number; innings: number; walks: number; hitsAllowed: number }>();
    preferredPitchingByPlayerId.forEach((stat, playerId) => {
      const player = playersById.get(playerId);
      if (!player?.teamId) return;
      const current = pitchingTotalsByTeamId.get(player.teamId) ?? { earnedRuns: 0, innings: 0, walks: 0, hitsAllowed: 0 };
      current.earnedRuns += stat.earnedRuns;
      current.innings += stat.inningsPitched;
      current.walks += stat.walks;
      current.hitsAllowed += stat.hitsAllowed;
      pitchingTotalsByTeamId.set(player.teamId, current);
    });

    const latestRosterYearByTeamId = new Map<string, number>();
    rosterSlots.forEach((slot) => {
      const current = latestRosterYearByTeamId.get(slot.teamId) ?? slot.seasonYear;
      if (slot.seasonYear > current) {
        latestRosterYearByTeamId.set(slot.teamId, slot.seasonYear);
      } else if (!latestRosterYearByTeamId.has(slot.teamId)) {
        latestRosterYearByTeamId.set(slot.teamId, slot.seasonYear);
      }
    });

    const rosterPlayerByTeamSlot = new Map<string, string>();
    rosterSlots.forEach((slot) => {
      const latestYear = latestRosterYearByTeamId.get(slot.teamId);
      if (latestYear === undefined || latestYear !== slot.seasonYear) {
        return;
      }
      rosterPlayerByTeamSlot.set(`${slot.teamId}:${slot.slotCode}`, slot.playerId);
    });

    return teams.map((team) => {
      const gamesPlayed = team.wins + team.losses;
      const winPct = gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
      const runDiff = team.runsScored - team.runsAllowed;

      const pitchingTotals = pitchingTotalsByTeamId.get(team.id) ?? { earnedRuns: 0, innings: 0, walks: 0, hitsAllowed: 0 };
      const teamEra = pitchingTotals.innings > 0 ? Number(((pitchingTotals.earnedRuns * 9) / pitchingTotals.innings).toFixed(2)) : null;
      const teamWhip = pitchingTotals.innings > 0 ? Number(((pitchingTotals.walks + pitchingTotals.hitsAllowed) / pitchingTotals.innings).toFixed(2)) : null;

      let rosterStrengthCoverage = 0;
      let rosterStrengthTotal = 0;
      rosterStrengthSlots.forEach((slotCode) => {
        const playerId = rosterPlayerByTeamSlot.get(`${team.id}:${slotCode}`);
        if (!playerId) return;
        const overall = battingRatingsByPlayerId.get(playerId)?.overall ?? pitchingRatingsByPlayerId.get(playerId)?.overall ?? 0;
        if (overall <= 0) return;
        rosterStrengthCoverage += 1;
        rosterStrengthTotal += overall;
      });
      const rosterStrength = rosterStrengthCoverage > 0 ? Math.round(rosterStrengthTotal / rosterStrengthCoverage) : null;

      return {
        team,
        gamesPlayed,
        winPct,
        runDiff,
        teamEra,
        teamWhip,
        teamRbi: battingTotalsByTeamId.get(team.id)?.rbi ?? 0,
        runsScored: team.runsScored,
        runsAllowed: team.runsAllowed,
        rosterStrength,
        rosterStrengthCoverage,
      };
    });
  }, [battingRatingsByPlayerId, pitchingRatingsByPlayerId, playersById, preferredBattingByPlayerId, preferredPitchingByPlayerId, rosterSlots, teams]);

  const rowsByLeague = useMemo(
    () => ({
      Prestige: standingsRows.filter((row) => row.team.league === 'Prestige'),
      Platinum: standingsRows.filter((row) => row.team.league === 'Platinum'),
    }),
    [standingsRows],
  );

  const topByRankMetric = useMemo(() => sortRowsByKey(standingsRows, rankKey)[0] ?? null, [rankKey, standingsRows]);
  const bestEra = useMemo(() => sortRowsByKey(standingsRows, 'team_era')[0] ?? null, [standingsRows]);
  const mostRbi = useMemo(() => sortRowsByKey(standingsRows, 'team_rbi')[0] ?? null, [standingsRows]);
  const strongestRoster = useMemo(() => sortRowsByKey(standingsRows, 'roster_strength')[0] ?? null, [standingsRows]);

  return (
    <section className="space-y-6">
      <article className={`${sectionClass} p-6`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">Commissioner Standings Matrix</p>
            <p className="mt-2 font-headline text-5xl uppercase tracking-[0.06em] text-white">Standings</p>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-400">
              Start from the full league race, then pivot to divisional slices. Rank clubs by performance and roster quality using live team and player data.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-1">
              <button
                type="button"
                onClick={() => setViewMode('league')}
                className={`px-4 py-2 rounded-lg font-display text-sm uppercase tracking-widest transition-colors ${
                  viewMode === 'league' ? 'bg-white text-black' : 'text-zinc-300 hover:text-white'
                }`}
              >
                League View
              </button>
              <button
                type="button"
                onClick={() => setViewMode('division')}
                className={`px-4 py-2 rounded-lg font-display text-sm uppercase tracking-widest transition-colors ${
                  viewMode === 'division' ? 'bg-white text-black' : 'text-zinc-300 hover:text-white'
                }`}
              >
                Division View
              </button>
            </div>

            <label className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
              <BarChart3 className="h-4 w-4 text-zinc-400" />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Rank By</span>
              <select
                value={rankKey}
                onChange={(event) => setRankKey(event.target.value as StandingsRankKey)}
                className="bg-transparent font-mono text-xs uppercase tracking-[0.16em] text-zinc-200 outline-none"
              >
                {RANK_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key} className="bg-[#141414] text-zinc-100">
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
            </label>
          </div>
        </div>
      </article>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className={`${sectionClass} p-4`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Current Rank Leader</p>
          <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">
            {topByRankMetric ? `${topByRankMetric.team.city} ${topByRankMetric.team.name}` : 'No Data'}
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ecd693]">
            {getMetricLabel(rankKey)}: {topByRankMetric ? getMetricValue(topByRankMetric, rankKey) : '--'}
          </p>
        </article>
        <article className={`${sectionClass} p-4`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Best Team ERA</p>
          <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">
            {bestEra ? `${bestEra.team.city} ${bestEra.team.name}` : 'No Data'}
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ecd693]">{bestEra ? formatEra(bestEra.teamEra) : '--'} ERA</p>
        </article>
        <article className={`${sectionClass} p-4`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Most Team RBI</p>
          <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">
            {mostRbi ? `${mostRbi.team.city} ${mostRbi.team.name}` : 'No Data'}
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ecd693]">{mostRbi ? mostRbi.teamRbi : '--'} RBI</p>
        </article>
        <article className={`${sectionClass} p-4`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Strongest Core</p>
          <p className="mt-2 font-display text-2xl uppercase tracking-[0.08em] text-white">
            {strongestRoster ? `${strongestRoster.team.city} ${strongestRoster.team.name}` : 'No Data'}
          </p>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#ecd693]">
            {strongestRoster?.rosterStrength ?? '--'} OVR | {strongestRoster?.rosterStrengthCoverage ?? 0}/{rosterStrengthSlots.length}
          </p>
        </article>
      </section>

      {viewMode === 'league' ? (
        <section className="grid gap-6 xl:grid-cols-2">
          <StandingsPanel
            title="Prestige League"
            subtitle="All clubs ranked by selected metric"
            rows={rowsByLeague.Prestige}
            rankKey={rankKey}
            accentClass="text-prestige"
            onSelectTeam={onSelectTeam}
          />
          <StandingsPanel
            title="Platinum League"
            subtitle="All clubs ranked by selected metric"
            rows={rowsByLeague.Platinum}
            rankKey={rankKey}
            accentClass="text-platinum"
            onSelectTeam={onSelectTeam}
          />
        </section>
      ) : (
        <section className="space-y-6">
          {(['Prestige', 'Platinum'] as const).map((league) => (
            <div key={league} className="space-y-3">
              <div className="flex items-center gap-3">
                <Layers3 className={`h-4 w-4 ${league === 'Prestige' ? 'text-prestige' : 'text-platinum'}`} />
                <p className={`font-display text-2xl uppercase tracking-[0.08em] ${league === 'Prestige' ? 'text-prestige' : 'text-platinum'}`}>
                  {league} Division Race
                </p>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {(['North', 'South', 'East', 'West'] as const).map((division) => (
                  <StandingsPanel
                    key={`${league}-${division}`}
                    title={`${division} Division`}
                    subtitle={`${league} clubs only`}
                    rows={standingsRows.filter((row) => row.team.league === league && row.team.division === division)}
                    rankKey={rankKey}
                    accentClass={league === 'Prestige' ? 'text-prestige' : 'text-platinum'}
                    onSelectTeam={onSelectTeam}
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <article className={`${sectionClass} p-4`}>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-zinc-400" />
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">How Team Metrics Are Built</p>
        </div>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          ERA and WHIP are aggregated from active roster pitchers&apos; current regular-season stat lines. RBI totals use current regular-season batting lines. Roster Strength is the average overall of core lineup and starting-rotation slots only, excluding backups.
        </p>
      </article>
    </section>
  );
};

