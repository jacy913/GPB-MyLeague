import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  BATTING_ROSTER_SLOTS,
  type Player,
  type PlayerBattingRatings,
  type PlayerPitchingRatings,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
  STARTING_PITCHER_SLOTS,
  type Team,
  type TeamRosterSlot,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { fmtDiff, fmtEra, fmtGb, fmtPct, fmtRecord, fmtWhip } from '../logic/statFormatting';
import { Panel, SegmentedControl, SkewedPanel, StatTable, type StatTableColumn, type StatTableRow } from './ui';
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
  winPct: number;
  runDiff: number;
  teamEra: number | null;
  teamWhip: number | null;
  teamRbi: number;
  runsScored: number;
  runsAllowed: number;
  rosterStrength: number | null;
}

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

const getLatestBattingRatingsMap = (ratings: PlayerBattingRatings[]) => {
  const result = new Map<string, PlayerBattingRatings>();
  [...ratings].sort((a, b) => b.seasonYear - a.seasonYear).forEach((rating) => {
    if (!result.has(rating.playerId)) result.set(rating.playerId, rating);
  });
  return result;
};

const getLatestPitchingRatingsMap = (ratings: PlayerPitchingRatings[]) => {
  const result = new Map<string, PlayerPitchingRatings>();
  [...ratings].sort((a, b) => b.seasonYear - a.seasonYear).forEach((rating) => {
    if (!result.has(rating.playerId)) result.set(rating.playerId, rating);
  });
  return result;
};

const compareNullable = (left: number | null, right: number | null, direction: 'asc' | 'desc') => {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === 'asc' ? left - right : right - left;
};

const compareRecord = (left: TeamStandingRow, right: TeamStandingRow) =>
  right.winPct - left.winPct || right.team.wins - left.team.wins || right.runDiff - left.runDiff || left.team.city.localeCompare(right.team.city);

const sortRows = (rows: TeamStandingRow[], rankKey: StandingsRankKey) => [...rows].sort((left, right) => {
  if (rankKey === 'record') return compareRecord(left, right);
  if (rankKey === 'win_pct') return right.winPct - left.winPct || compareRecord(left, right);
  if (rankKey === 'run_diff') return right.runDiff - left.runDiff || compareRecord(left, right);
  if (rankKey === 'runs_scored') return right.runsScored - left.runsScored || compareRecord(left, right);
  if (rankKey === 'runs_allowed') return left.runsAllowed - right.runsAllowed || compareRecord(left, right);
  if (rankKey === 'team_era') return compareNullable(left.teamEra, right.teamEra, 'asc') || compareRecord(left, right);
  if (rankKey === 'team_whip') return compareNullable(left.teamWhip, right.teamWhip, 'asc') || compareRecord(left, right);
  if (rankKey === 'team_rbi') return right.teamRbi - left.teamRbi || compareRecord(left, right);
  return compareNullable(left.rosterStrength, right.rosterStrength, 'desc') || compareRecord(left, right);
});

const getMetricLabel = (rankKey: StandingsRankKey) => RANK_OPTIONS.find((option) => option.key === rankKey)?.label ?? 'Record';

const getMetricValue = (row: TeamStandingRow, rankKey: StandingsRankKey) => {
  if (rankKey === 'record') return fmtRecord(row.team.wins, row.team.losses);
  if (rankKey === 'win_pct') return fmtPct(row.winPct);
  if (rankKey === 'run_diff') return fmtDiff(row.runDiff);
  if (rankKey === 'runs_scored') return String(row.runsScored);
  if (rankKey === 'runs_allowed') return String(row.runsAllowed);
  if (rankKey === 'team_era') return row.teamEra === null ? '—' : fmtEra(row.teamEra);
  if (rankKey === 'team_whip') return row.teamWhip === null ? '—' : fmtWhip(row.teamWhip);
  if (rankKey === 'team_rbi') return String(row.teamRbi);
  return row.rosterStrength === null ? '—' : String(row.rosterStrength);
};

const getGamesBack = (leader: TeamStandingRow, row: TeamStandingRow) =>
  fmtGb(((leader.team.wins - row.team.wins) + (row.team.losses - leader.team.losses)) / 2);

interface StandingsPanelProps {
  title: string;
  rows: TeamStandingRow[];
  rankKey: StandingsRankKey;
  onSelectTeam: (teamId: string) => void;
  playoffLineIndex: number;
  wildCardLineIndex?: number;
}

const StandingsPanel: React.FC<StandingsPanelProps> = ({ title, rows, rankKey, onSelectTeam, playoffLineIndex, wildCardLineIndex }) => {
  const rankedRows = useMemo(() => sortRows(rows, rankKey), [rankKey, rows]);
  const recordLeader = useMemo(() => sortRows(rows, 'record')[0], [rows]);
  const divisionLeaders = useMemo(() => new Map(
    [...new Set(rows.map((row) => row.team.division))].map((division) => [
      division,
      sortRows(rows.filter((row) => row.team.division === division), 'record')[0],
    ]),
  ), [rows]);

  const columns = useMemo<StatTableColumn[]>(() => [
    { key: 'team', header: 'TEAM' },
    { key: 'wins', header: 'W', align: 'right', isNumeric: true, width: '3ch' },
    { key: 'losses', header: 'L', align: 'right', isNumeric: true, width: '3ch' },
    { key: 'pct', header: 'PCT', align: 'right', isNumeric: true, width: '5ch' },
    { key: 'gb', header: 'GB', align: 'right', isNumeric: true, width: '4ch' },
    { key: 'diff', header: 'DIFF', align: 'right', isNumeric: true, width: '5ch' },
    { key: 'metric', header: getMetricLabel(rankKey).toUpperCase(), align: 'right', isNumeric: true, width: '7ch', sortKey: 'metric' },
  ], [rankKey]);

  const tableRows = useMemo<StatTableRow[]>(() => rankedRows.map((row, index) => {
    const divisionLeader = divisionLeaders.get(row.team.division);
    const isDivisionWinner = divisionLeader?.team.id === row.team.id;
    return {
      id: row.team.id,
      cells: {
        team: (
          <button type="button" onClick={() => onSelectTeam(row.team.id)} className="flex w-full items-center gap-2 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]" aria-label={`Open ${row.team.city} ${row.team.name} roster`}>
            <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
            <TeamLogo team={row.team} sizeClass="h-5 w-5" />
            <span className={`truncate t-stat-sm ${isDivisionWinner ? 'text-[var(--color-gold-hi)]' : 'text-[var(--color-ink)]'}`}>
              {isDivisionWinner && <span className="mr-1 text-[var(--color-gold)]" aria-label="Division leader">◆</span>}
              {row.team.city} {row.team.name}
            </span>
          </button>
        ),
        wins: row.team.wins,
        losses: row.team.losses,
        pct: fmtPct(row.winPct),
        gb: divisionLeader ? getGamesBack(divisionLeader, row) : '—',
        diff: <span className={row.runDiff >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}>{fmtDiff(row.runDiff)}</span>,
        metric: getMetricValue(row, rankKey),
      },
    };
  }), [divisionLeaders, onSelectTeam, rankKey, rankedRows]);

  return (
    <SkewedPanel direction="skew-r" panelVariant="default">
      <div className="-m-4">
        <div className="chrome-bar flex items-center justify-between gap-3 px-4">
          <h2 className="t-h3">{title}</h2>
          <span className="t-stat text-[var(--color-gold)]">{recordLeader ? fmtRecord(recordLeader.team.wins, recordLeader.team.losses) : '—'}</span>
        </div>
        <StatTable columns={columns} rows={tableRows} density="default" sortColumn="metric" playoffLineIndex={playoffLineIndex} wildCardLineIndex={wildCardLineIndex} aria-label={`${title} standings`} />
      </div>
    </SkewedPanel>
  );
};

export const StandingsHub: React.FC<StandingsHubProps> = ({ teams, players, battingStats, pitchingStats, battingRatings, pitchingRatings, rosterSlots, onSelectTeam }) => {
  const [viewMode, setViewMode] = useState<StandingsViewMode>('league');
  const [rankKey, setRankKey] = useState<StandingsRankKey>('record');
  const playersById = useMemo(() => new Map(players.map((player) => [player.playerId, player])), [players]);
  const preferredBattingByPlayerId = useMemo(() => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'), [battingStats]);
  const preferredPitchingByPlayerId = useMemo(() => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'), [pitchingStats]);
  const battingRatingsByPlayerId = useMemo(() => getLatestBattingRatingsMap(battingRatings), [battingRatings]);
  const pitchingRatingsByPlayerId = useMemo(() => getLatestPitchingRatingsMap(pitchingRatings), [pitchingRatings]);

  const standingsRows = useMemo<TeamStandingRow[]>(() => {
    const rbiByTeam = new Map<string, number>();
    preferredBattingByPlayerId.forEach((stat, playerId) => {
      const teamId = playersById.get(playerId)?.teamId;
      if (teamId) rbiByTeam.set(teamId, (rbiByTeam.get(teamId) ?? 0) + stat.rbi);
    });
    const pitchingByTeam = new Map<string, { earnedRuns: number; innings: number; walks: number; hitsAllowed: number }>();
    preferredPitchingByPlayerId.forEach((stat, playerId) => {
      const teamId = playersById.get(playerId)?.teamId;
      if (!teamId) return;
      const totals = pitchingByTeam.get(teamId) ?? { earnedRuns: 0, innings: 0, walks: 0, hitsAllowed: 0 };
      totals.earnedRuns += stat.earnedRuns;
      totals.innings += stat.inningsPitched;
      totals.walks += stat.walks;
      totals.hitsAllowed += stat.hitsAllowed;
      pitchingByTeam.set(teamId, totals);
    });
    const latestRosterYear = new Map<string, number>();
    rosterSlots.forEach((slot) => {
      const knownYear = latestRosterYear.get(slot.teamId);
      if (knownYear === undefined || slot.seasonYear > knownYear) latestRosterYear.set(slot.teamId, slot.seasonYear);
    });
    const playerByTeamSlot = new Map<string, string>();
    rosterSlots.forEach((slot) => {
      if (latestRosterYear.get(slot.teamId) === slot.seasonYear) playerByTeamSlot.set(`${slot.teamId}:${slot.slotCode}`, slot.playerId);
    });

    return teams.map((team) => {
      const gamesPlayed = team.wins + team.losses;
      const pitching = pitchingByTeam.get(team.id) ?? { earnedRuns: 0, innings: 0, walks: 0, hitsAllowed: 0 };
      let strengthTotal = 0;
      let strengthCount = 0;
      rosterStrengthSlots.forEach((slotCode) => {
        const playerId = playerByTeamSlot.get(`${team.id}:${slotCode}`);
        const overall = playerId ? battingRatingsByPlayerId.get(playerId)?.overall ?? pitchingRatingsByPlayerId.get(playerId)?.overall ?? 0 : 0;
        if (overall > 0) { strengthTotal += overall; strengthCount += 1; }
      });
      return {
        team,
        winPct: gamesPlayed ? team.wins / gamesPlayed : 0,
        runDiff: team.runsScored - team.runsAllowed,
        teamEra: pitching.innings ? Number(((pitching.earnedRuns * 9) / pitching.innings).toFixed(2)) : null,
        teamWhip: pitching.innings ? Number(((pitching.walks + pitching.hitsAllowed) / pitching.innings).toFixed(2)) : null,
        teamRbi: rbiByTeam.get(team.id) ?? 0,
        runsScored: team.runsScored,
        runsAllowed: team.runsAllowed,
        rosterStrength: strengthCount ? Math.round(strengthTotal / strengthCount) : null,
      };
    });
  }, [battingRatingsByPlayerId, pitchingRatingsByPlayerId, playersById, preferredBattingByPlayerId, preferredPitchingByPlayerId, rosterSlots, teams]);

  const leagueRows = useMemo(() => (['Prestige', 'Platinum'] as const).map((league) => ({ league, rows: standingsRows.filter((row) => row.team.league === league) })), [standingsRows]);
  const divisionRows = useMemo(() => (['Prestige', 'Platinum'] as const).flatMap((league) =>
    (['North', 'South', 'East', 'West'] as const).map((division) => ({ league, division, rows: standingsRows.filter((row) => row.team.league === league && row.team.division === division) })),
  ), [standingsRows]);

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">League Standings</h1>
          <label className="relative flex items-center gap-2 t-caption text-[var(--color-ink-dim)]">
            <span>SORT</span>
            <select value={rankKey} onChange={(event) => setRankKey(event.target.value as StandingsRankKey)} className="appearance-none bg-[var(--color-sunken)] py-1 pl-2 pr-7 t-caption text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]" aria-label="Sort standings by">
              {RANK_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1 h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          </label>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="t-display">Standings</p>
            <p className="t-body text-[var(--color-ink-dim)]">Core race metrics stay visible while the active sort metric receives its own highlighted column.</p>
          </div>
          <SegmentedControl aria-label="Standings view" value={viewMode} onChange={(value) => setViewMode(value as StandingsViewMode)} options={[{ value: 'league', label: 'League' }, { value: 'division', label: 'Division' }]} />
        </div>
      </Panel>

      {viewMode === 'league' ? (
        <div className="grid gap-5 md:grid-cols-2">
          {leagueRows.map(({ league, rows }) => <StandingsPanel key={league} title={`${league} League`} rows={rows} rankKey={rankKey} onSelectTeam={onSelectTeam} playoffLineIndex={4} wildCardLineIndex={6} />)}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
          {divisionRows.map(({ league, division, rows }) => <StandingsPanel key={`${league}-${division}`} title={`${league} ${division}`} rows={rows} rankKey={rankKey} onSelectTeam={onSelectTeam} playoffLineIndex={1} wildCardLineIndex={2} />)}
        </div>
      )}
    </section>
  );
};
