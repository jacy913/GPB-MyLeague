import React, { useMemo, useState } from 'react';
import { Crown, Trophy } from 'lucide-react';
import {
  type Player,
  type PlayerBattingRatings,
  type PlayerPitchingRatings,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
  type Team,
} from '../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../logic/playerStats';
import { fmtAvg, fmtDiff, fmtEra, fmtIp, fmtPct, fmtRecord, fmtWhip } from '../logic/statFormatting';
import { battingMetrics, pitchingMetrics, toBattingCounts, toPitchingCounts } from '../lib/analytics/metrics';
import { buildBattingAwards, buildPitchingAwards, type AwardEntry } from '../lib/awardRace';
import { OddsBar, Panel, SegmentedControl, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';

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

const TOP_ROWS = 10;

const getWinPct = (team: Team): number => {
  const gamesPlayed = team.wins + team.losses;
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Slugging percentage and on-base percentage, delegated to the metric layer.
 *
 * These used to be recomputed here, with a comment claiming the formula was
 * copied from playerStats.ts "so a leaderboard can never disagree with the OPS
 * it sits beside". It was not the same expression. playerStats.ts:116-117
 * computes
 *
 *     singles = hits - doubles - triples - homeRuns
 *     totalBases = singles + 2*d + 3*t + 4*h
 *
 * which expands to hits + 1*d + 2*t + 3*h, while this file had
 * hits + 2*d + 3*t + 3*h. That overstates total bases by exactly
 * (doubles + triples).
 *
 * Measured over a 30-day season with tools/probeTotalBases.ts: the
 * accumulator's formula reproduced the persisted OPS for every player, and this
 * one did so for none of the 307 players who had a double or a triple. The
 * largest overstatement was 0.250 in slugging, where one player read .906
 * against a true .757. The SLG board and the SLG figure printed beside OPS were
 * both wrong, and in the same direction for every player, so the board was
 * systematically inflating extra-base hitters.
 *
 * The shared module is now the single definition, so this class of drift is
 * closed rather than patched: the board cannot disagree with OPS because there
 * is only one SLG.
 */
/**
 * At-bats required for a rate board. Derived, not chosen: 0.282 is the measured
 * league BABIP, and 0.282 * (1 - 0.282) / 0.05^2 is the sample size at which a
 * binomial proportion's standard error reaches 0.05. Rounded up to 82.
 * tools/verifyMetrics.ts recomputes this and prints it.
 */
const BATTING_QUALIFYING_AT_BATS = 82;

/**
 * Outs required for a pitching rate board, i.e. five innings. This one is a
 * convention rather than a derived figure, and is labelled as such so nobody
 * later mistakes it for a fitted constant.
 */
const PITCHING_QUALIFYING_OUTS = 20;

const slugging = (stat: PlayerSeasonBatting): number => battingMetrics(toBattingCounts(stat)).slg ?? 0;

interface CategoryBoard {
  key: string;
  title: string;
  /** 'desc' sorts the highest value first; 'asc' for ERA and WHIP. */
  direction: 'desc' | 'asc';
  qualified: boolean;
  columns: StatTableColumn[];
  rows: StatTableRow[];
  count: number;
}

interface StatEntry {
  playerId: string;
  name: string;
  team: Team | null;
  stat: PlayerSeasonBatting | PlayerSeasonPitching;
}

const nameCell = (entry: StatEntry, index: number): React.ReactNode => (
  <button
    type="button"
    className="flex w-full items-center gap-2 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
    title={entry.name}
  >
    <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
    {entry.team ? <TeamLogo team={entry.team} sizeClass="h-6 w-6" /> : null}
    <span className="truncate t-stat-sm">{entry.name}</span>
  </button>
);

/**
 * Category panel -- the unit of the dense board.
 *
 * A rank column, a name with logo, the primary figure in gold, and one or two
 * secondary figures in ink-dim. Top three ranks carry a 3px gold left edge, the
 * period convention, restrained to three.
 */
const CategoryPanel: React.FC<{
  board: CategoryBoard;
  selected: boolean;
  onSelect: () => void;
}> = ({ board, selected, onSelect }) => (
  <Panel className="flex flex-col overflow-hidden">
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`chrome-bar flex w-full items-center justify-between gap-2 px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-gold)] ${selected ? 'bg-[var(--color-panel-3)]' : ''}`}
    >
      <span className={`t-label truncate ${selected ? 'text-[var(--color-gold)]' : ''}`}>{board.title}</span>
      <span className="t-caption shrink-0 text-[var(--color-ink-faint)]">{board.count}</span>
    </button>
    <StatTable
      columns={board.columns}
      rows={board.rows}
      density="dense"
      aria-label={`${board.title} leaders`}
      className="flex-1"
    />
  </Panel>
);

/* MVP scoring lives in lib/awardRace, shared with the front page. The weights
   are the live formula, unchanged; the comment there explains why it is not
   duplicated per screen. */

const AwardRace: React.FC<{
  title: string;
  entries: AwardEntry[];
  accent: 'gold' | 'platinum';
  icon: React.ReactNode;
}> = ({ title, entries, accent, icon }) => {
  const leader = entries[0];
  const runnerUp = entries[1];
  const gap = leader && runnerUp ? leader.total - runnerUp.total : 0;

  return (
    <Panel className="flex flex-col overflow-hidden">
      <div className="chrome-bar flex items-center justify-between gap-3 px-4">
        <h2 className="t-h3">{title}</h2>
        <span className={accent === 'gold' ? 'text-[var(--color-gold)]' : 'text-[var(--color-platinum)]'}>{icon}</span>
      </div>

      {leader && runnerUp && (
        <p className="t-caption border-b border-[var(--color-chrome-lo)] px-4 py-2 text-[var(--color-ink-dim)]">
          Lead over second: <StatValue size="sm" variant="accent">{gap.toFixed(1)}</StatValue> points
        </p>
      )}

      <ol className="flex flex-col divide-y divide-[var(--color-chrome-lo)]">
        {entries.map((entry, index) => {
          const isLeader = index === 0;
          return (
            <li
              key={entry.playerId}
              className={`border-l-[3px] px-4 py-3 ${isLeader ? 'border-l-[var(--color-gold)]' : 'border-l-transparent'}`}
            >
              <div className="flex items-center gap-3">
                <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
                {entry.team ? <TeamLogo team={entry.team} sizeClass="h-8 w-8" /> : null}
                <div className="min-w-0 flex-1">
                  <p className={`truncate t-stat-sm ${isLeader ? 'text-[var(--color-gold-hi)]' : ''}`}>
                    {entry.name}
                  </p>
                  <p className="truncate t-caption text-[var(--color-ink-faint)]">
                    {entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free Agent'}
                  </p>
                </div>
                <div className="text-right">
                  <StatValue variant="accent">{entry.total.toFixed(1)}</StatValue>
                  <p className="t-caption text-[var(--color-ink-faint)]">SCORE</p>
                </div>
              </div>

              {/* The scoring function, shown. Every term that produced the total
                  above appears here with the value it was computed from. */}
              <dl className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1 sm:grid-cols-8">
                {entry.components.map((component) => (
                  <div key={component.label} className="min-w-0">
                    <dt className="t-caption truncate text-[var(--color-ink-faint)]">{component.label}</dt>
                    <dd className="t-stat-sm truncate text-[var(--color-ink-dim)]">{component.detail}</dd>
                    <dd className="t-stat-sm text-[var(--color-gold)]">+{component.contribution.toFixed(1)}</dd>
                  </div>
                ))}
              </dl>

              <OddsBar odds={entry.odds} label={entry.name} className="mt-3" />
            </li>
          );
        })}
      </ol>
    </Panel>
  );
};

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
  const [selectedBatting, setSelectedBatting] = useState<string>('avg');
  const [selectedPitching, setSelectedPitching] = useState<string>('era');
  const [selectedTeam, setSelectedTeam] = useState<string>('wins');

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const battingByPlayerId = useMemo(() => getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'), [battingStats]);
  const pitchingByPlayerId = useMemo(() => getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'), [pitchingStats]);
  const battingRatingsByPlayerId = useMemo(
    () => new Map(battingRatings.map((rating) => [rating.playerId, rating])),
    [battingRatings],
  );
  const pitchingRatingsByPlayerId = useMemo(
    () => new Map(pitchingRatings.map((rating) => [rating.playerId, rating])),
    [pitchingRatings],
  );

  const displayName = (player: Player) => `${player.firstName} ${player.lastName}`;

  const battingEntries = useMemo<StatEntry[]>(() => players
    .map((player) => {
      const stat = battingByPlayerId.get(player.playerId);
      if (!stat) return null;
      return { playerId: player.playerId, name: displayName(player), team: player.teamId ? teamsById.get(player.teamId) ?? null : null, stat };
    })
    .filter((entry): entry is StatEntry => Boolean(entry)), [battingByPlayerId, players, teamsById]);

  const pitchingEntries = useMemo<StatEntry[]>(() => players
    .map((player) => {
      const stat = pitchingByPlayerId.get(player.playerId);
      if (!stat) return null;
      return { playerId: player.playerId, name: displayName(player), team: player.teamId ? teamsById.get(player.teamId) ?? null : null, stat };
    })
    .filter((entry): entry is StatEntry => Boolean(entry)), [pitchingByPlayerId, players, teamsById]);

  // -- batting categories ------------------------------------------------
  // The design proposal lists SB among the default batting categories. There is
  // no stolen-bases field on PlayerSeasonBatting, nor anywhere else in the
  // simulation, so an SB board would have to be invented from nothing. OBP
  // replaces it: fully derivable from fields that are stored, and more
  // informative alongside OPS.
  // Qualification floors.
  //
  // BATTING_QUALIFYING_AT_BATS is the at-bat count at which the standard error
  // of a league-average rate falls to 0.05, derived in tools/verifyMetrics.ts
  // from the measured league BABIP of 0.282. It is a stated design choice about
  // what counts as a meaningful sample, not a measured constant, and it was
  // previously an unexplained 120. PITCHING_QUALIFYING_OUTS is the equivalent
  // thought in outs: 20 outs is five innings, a conventional minimum, and is
  // labelled as a convention rather than a fitted figure.
  const battingCategories = useMemo<Array<Omit<CategoryBoard, 'rows' | 'columns'>>>(() => [
    { key: 'avg', title: 'Batting Average', direction: 'desc', qualified: true, count: battingEntries.filter((e) => (e.stat as PlayerSeasonBatting).atBats >= BATTING_QUALIFYING_AT_BATS).length },
    { key: 'hr', title: 'Home Runs', direction: 'desc', qualified: false, count: battingEntries.length },
    { key: 'rbi', title: 'RBI', direction: 'desc', qualified: false, count: battingEntries.length },
    { key: 'ops', title: 'OPS', direction: 'desc', qualified: true, count: battingEntries.filter((e) => (e.stat as PlayerSeasonBatting).atBats >= BATTING_QUALIFYING_AT_BATS).length },
    { key: 'slg', title: 'Slugging', direction: 'desc', qualified: true, count: battingEntries.filter((e) => (e.stat as PlayerSeasonBatting).atBats >= BATTING_QUALIFYING_AT_BATS).length },
    { key: 'obp', title: 'On-Base', direction: 'desc', qualified: true, count: battingEntries.filter((e) => (e.stat as PlayerSeasonBatting).atBats >= BATTING_QUALIFYING_AT_BATS).length },
  ], [battingEntries]);

  const battingBoards = useMemo<CategoryBoard[]>(() => battingCategories.map((category) => {
    const pool = category.qualified
      ? battingEntries.filter((entry) => (entry.stat as PlayerSeasonBatting).atBats >= BATTING_QUALIFYING_AT_BATS)
      : battingEntries;

    // AVG and OPS are recomputed rather than read off the row, because the row
    // stores both rounded to 3dp (playerStats.ts:125-126). Sorting on the stored
    // value would tie players who differ by up to 0.001. The stored figure is
    // still what gets displayed, so a displayed value cannot disagree with what
    // the player card shows; only the ordering is computed at full precision.
    const metricsOf = (stat: PlayerSeasonBatting) => battingMetrics(toBattingCounts(stat));
    const valueOf = (entry: StatEntry): number => {
      const stat = entry.stat as PlayerSeasonBatting;
      if (category.key === 'hr') return stat.homeRuns;
      if (category.key === 'rbi') return stat.rbi;
      const m = metricsOf(stat);
      if (category.key === 'avg') return m.avg ?? 0;
      if (category.key === 'ops') return m.ops ?? 0;
      if (category.key === 'slg') return m.slg ?? 0;
      return m.obp ?? 0;
    };
    const detailOf = (entry: StatEntry): string => {
      const stat = entry.stat as PlayerSeasonBatting;
      if (category.key === 'avg') return `${stat.hits} H / ${stat.atBats} AB`;
      if (category.key === 'hr') return `${stat.rbi} RBI`;
      if (category.key === 'rbi') return `${stat.homeRuns} HR`;
      if (category.key === 'ops') return `${slugging(stat).toFixed(3)} SLG`;
      if (category.key === 'slg') return `${stat.ops.toFixed(3)} OPS`;
      if (category.key === 'obp') return `${slugging(stat).toFixed(3)} SLG`;
      return `${stat.walks} BB`;
    };
    const formatValue = (entry: StatEntry): string => {
      const stat = entry.stat as PlayerSeasonBatting;
      if (category.key === 'avg') return fmtAvg(stat.avg);
      if (category.key === 'hr') return String(stat.homeRuns);
      if (category.key === 'rbi') return String(stat.rbi);
      if (category.key === 'ops') return stat.ops.toFixed(3);
      if (category.key === 'slg') return slugging(stat).toFixed(3);
      // A qualified board guarantees at-bats, so OBP is defined. The `?? 0`
      // is unreachable here and is written as a fallback rather than a claim
      // that a zero on-base percentage is a real measurement.
      return (battingMetrics(toBattingCounts(stat)).obp ?? 0).toFixed(3);
    };

    const sorted = [...pool].sort((left, right) => {
      const delta = valueOf(left) - valueOf(right);
      return (category.direction === 'desc' ? -delta : delta) || (left.stat as PlayerSeasonBatting).avg - (right.stat as PlayerSeasonBatting).avg;
    });

    const columns: StatTableColumn[] = [
      { key: 'name', header: 'PLAYER' },
      { key: 'value', header: category.title.split(' ').pop()?.toUpperCase() ?? 'VAL', align: 'right', isNumeric: true, width: '5ch' },
      { key: 'detail', header: '', align: 'right', isNumeric: false, width: '8ch' },
    ];

    return {
      ...category,
      columns,
      rows: sorted.slice(0, TOP_ROWS).map((entry, index) => ({
        id: entry.playerId,
        className: index < 3 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
        cells: {
          name: nameCell(entry, index),
          value: <StatValue size="sm" variant="accent">{formatValue(entry)}</StatValue>,
          detail: <span className="t-stat-sm text-[var(--color-ink-faint)]">{detailOf(entry)}</span>,
        },
      })),
    };
  }), [battingCategories, battingEntries]);

  // -- pitching categories -----------------------------------------------
  const pitchingCategories = useMemo<Array<Omit<CategoryBoard, 'rows' | 'columns'>>>(() => {
    const qualified = pitchingEntries.filter(
      (entry) => (entry.stat as PlayerSeasonPitching).inningsPitched * 3 >= PITCHING_QUALIFYING_OUTS,
    );
    return [
      { key: 'wins', title: 'Wins', direction: 'desc', qualified: false, count: pitchingEntries.length },
      { key: 'k', title: 'Strikeouts', direction: 'desc', qualified: false, count: pitchingEntries.length },
      { key: 'era', title: 'ERA', direction: 'asc', qualified: true, count: qualified.length },
      { key: 'whip', title: 'WHIP', direction: 'asc', qualified: true, count: qualified.length },
      { key: 'ip', title: 'Innings', direction: 'desc', qualified: false, count: pitchingEntries.length },
      { key: 'k9', title: 'K/9', direction: 'desc', qualified: true, count: qualified.length },
    ];
  }, [pitchingEntries]);

  const pitchingBoards = useMemo<CategoryBoard[]>(() => pitchingCategories.map((category) => {
    const pool = category.qualified
      ? pitchingEntries.filter((entry) => (entry.stat as PlayerSeasonPitching).inningsPitched * 3 >= PITCHING_QUALIFYING_OUTS)
      : pitchingEntries;

    // Era, WHIP and K/9 are recomputed from counts rather than read off the
    // stat row, because the row stores them pre-rounded to 2dp
    // (playerStats.ts:150-151). Sorting ERA by the stored value would tie two
    // pitchers at 2.50 who are in truth 0.01 apart, and the stored WHIP cannot
    // be reconciled with a displayed count at all.
    const metricsOf = (stat: PlayerSeasonPitching) => pitchingMetrics(toPitchingCounts(stat));
    const valueOf = (entry: StatEntry): number => {
      const stat = entry.stat as PlayerSeasonPitching;
      if (category.key === 'wins') return stat.wins;
      if (category.key === 'k') return stat.strikeouts;
      if (category.key === 'ip') return stat.inningsPitched;
      const m = metricsOf(stat);
      if (category.key === 'era') return m.era ?? 0;
      if (category.key === 'whip') return m.whip ?? 0;
      return m.kPer9 ?? 0;
    };
    const formatValue = (entry: StatEntry): string => {
      const stat = entry.stat as PlayerSeasonPitching;
      if (category.key === 'wins') return String(stat.wins);
      if (category.key === 'k') return String(stat.strikeouts);
      if (category.key === 'ip') return fmtIp(stat.inningsPitched);
      const m = metricsOf(stat);
      if (category.key === 'era') return fmtEra(m.era ?? 0);
      if (category.key === 'whip') return fmtWhip(m.whip ?? 0);
      return (m.kPer9 ?? 0).toFixed(2);
    };
    const detailOf = (entry: StatEntry): string => {
      const stat = entry.stat as PlayerSeasonPitching;
      if (category.key === 'era') return fmtIp(stat.inningsPitched);
      if (category.key === 'whip') return `${stat.hitsAllowed + stat.walks} baserunners`;
      if (category.key === 'ip') return `${stat.strikeouts} K`;
      if (category.key === 'k9') return `${stat.strikeouts} K`;
      return fmtRecord(stat.wins, stat.losses);
    };

    const sorted = [...pool].sort((left, right) => {
      const delta = valueOf(left) - valueOf(right);
      return (category.direction === 'desc' ? -delta : delta) || left.name.localeCompare(right.name);
    });

    const columns: StatTableColumn[] = [
      { key: 'name', header: 'PLAYER' },
      { key: 'value', header: category.key === 'k9' ? 'K/9' : category.title.toUpperCase(), align: 'right', isNumeric: true, width: '5ch' },
      { key: 'detail', header: '', align: 'right', isNumeric: false, width: '8ch' },
    ];

    return {
      ...category,
      columns,
      rows: sorted.slice(0, TOP_ROWS).map((entry, index) => ({
        id: entry.playerId,
        className: index < 3 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
        cells: {
          name: nameCell(entry, index),
          value: <StatValue size="sm" variant="accent">{formatValue(entry)}</StatValue>,
          detail: <span className="t-stat-sm text-[var(--color-ink-faint)]">{detailOf(entry)}</span>,
        },
      })),
    };
  }), [pitchingCategories, pitchingEntries]);

  // -- team categories ----------------------------------------------------
  const teamCategories = useMemo<Array<Omit<CategoryBoard, 'rows' | 'columns'>>>(() => [
    { key: 'wins', title: 'Wins', direction: 'desc', qualified: false, count: teams.length },
    { key: 'pct', title: 'Win Pct', direction: 'desc', qualified: false, count: teams.length },
    { key: 'diff', title: 'Run Diff', direction: 'desc', qualified: false, count: teams.length },
    { key: 'rs', title: 'Runs Scored', direction: 'desc', qualified: false, count: teams.length },
    { key: 'ra', title: 'Runs Allowed', direction: 'asc', qualified: false, count: teams.length },
  ], [teams]);

  const teamBoards = useMemo<CategoryBoard[]>(() => teamCategories.map((category) => {
    const valueOf = (team: Team): number => {
      if (category.key === 'wins') return team.wins;
      if (category.key === 'pct') return getWinPct(team);
      if (category.key === 'diff') return team.runsScored - team.runsAllowed;
      if (category.key === 'rs') return team.runsScored;
      return team.runsAllowed;
    };
    const formatValue = (team: Team): string => {
      if (category.key === 'wins') return String(team.wins);
      if (category.key === 'pct') return fmtPct(getWinPct(team));
      if (category.key === 'diff') return fmtDiff(team.runsScored - team.runsAllowed);
      if (category.key === 'rs') return String(team.runsScored);
      return String(team.runsAllowed);
    };
    const detailOf = (team: Team): string => (
      category.key === 'ra' ? `${team.runsScored} RS` : fmtRecord(team.wins, team.losses)
    );

    const sorted = [...teams].sort((left, right) => {
      const delta = valueOf(left) - valueOf(right);
      return (category.direction === 'desc' ? -delta : delta) || left.city.localeCompare(right.city);
    });

    return {
      ...category,
      columns: [
        { key: 'name', header: 'TEAM' },
        { key: 'value', header: category.key === 'pct' ? 'PCT' : category.key === 'diff' ? 'DIFF' : category.title.toUpperCase().slice(0, 4), align: 'right', isNumeric: true, width: '5ch' },
        { key: 'detail', header: '', align: 'right', isNumeric: false, width: '8ch' },
      ],
      rows: sorted.slice(0, TOP_ROWS).map((team, index) => ({
        id: team.id,
        className: index < 3 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
        cells: {
          name: (
            <span className="flex w-full items-center gap-2 overflow-hidden">
              <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
              <TeamLogo team={team} sizeClass="h-6 w-6" />
              <span className="truncate t-stat-sm">{team.city} {team.name}</span>
            </span>
          ),
          value: <StatValue size="sm" variant="accent">{formatValue(team)}</StatValue>,
          detail: <span className="t-stat-sm text-[var(--color-ink-faint)]">{detailOf(team)}</span>,
        },
      })),
    };
  }), [teamCategories, teams]);

  // -- award races --------------------------------------------------------
  // Scoring lives in lib/awardRace so the front page and this board cannot
  // disagree about who leads the race.
  const awardInputs = useMemo(() => ({
    players,
    teamsById,
    battingStats: battingByPlayerId,
    pitchingStats: pitchingByPlayerId,
    battingRatings: battingRatingsByPlayerId,
    pitchingRatings: pitchingRatingsByPlayerId,
  }), [battingByPlayerId, battingRatingsByPlayerId, pitchingByPlayerId, pitchingRatingsByPlayerId, players, teamsById]);

  const battingAwards = useMemo<AwardEntry[]>(() => buildBattingAwards(awardInputs), [awardInputs]);
  const pitchingAwards = useMemo<AwardEntry[]>(() => buildPitchingAwards(awardInputs), [awardInputs]);

  const activeBoards = mode === 'teams' ? teamBoards : playerBoard === 'pitching' ? pitchingBoards : battingBoards;
  const selectedKey = mode === 'teams' ? selectedTeam : playerBoard === 'pitching' ? selectedPitching : selectedBatting;
  const setSelectedKey = mode === 'teams' ? setSelectedTeam : playerBoard === 'pitching' ? setSelectedPitching : setSelectedBatting;
  const expanded = activeBoards.find((board) => board.key === selectedKey) ?? activeBoards[0];

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <h1 className="t-h2">Leaders</h1>
          <SegmentedControl
            aria-label="Leader scope"
            value={mode}
            onChange={(value) => setMode(value as LeadersMode)}
            options={[{ value: 'players', label: 'Players' }, { value: 'teams', label: 'Teams' }]}
          />
        </div>
        {mode === 'players' && (
          <div className="border-t border-[var(--color-chrome-lo)] px-4 py-3">
            <SegmentedControl
              aria-label="Leader board"
              value={playerBoard}
              onChange={(value) => setPlayerBoard(value as PlayerBoard)}
              options={[
                { value: 'batting', label: 'Batting' },
                { value: 'pitching', label: 'Pitching' },
                { value: 'awards', label: 'Awards' },
              ]}
            />
          </div>
        )}
      </Panel>

      {mode === 'players' && playerBoard === 'awards' ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <AwardRace title="Batting MVP" entries={battingAwards} accent="gold" icon={<Crown className="h-4 w-4" />} />
          <AwardRace title="Pitching MVP" entries={pitchingAwards} accent="platinum" icon={<Trophy className="h-4 w-4" />} />
        </div>
      ) : (
        <>
          {/* Expand one, browse many: the selected category at full width, the
              rest as a dense grid where six are visible at once. */}
          {expanded && (
            <Panel className="overflow-hidden">
              <div className="chrome-bar flex items-center justify-between gap-3 px-4">
                <h2 className="t-h3">{expanded.title}</h2>
                <span className="t-caption text-[var(--color-ink-faint)]">{expanded.count} QUALIFIED</span>
              </div>
              <StatTable
                columns={expanded.columns}
                rows={expanded.rows}
                density="default"
                aria-label={`${expanded.title} full board`}
              />
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {activeBoards.map((board) => (
              <CategoryPanel
                key={board.key}
                board={board}
                selected={board.key === selectedKey}
                onSelect={() => setSelectedKey(board.key)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
};
