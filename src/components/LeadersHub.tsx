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
import {
  formatPercentile,
  percentileOf,
  summarise,
  type Distribution,
} from '../lib/analytics/percentile';
import { buildBattingAwards, buildPitchingAwards, type AwardEntry } from '../lib/awardRace';
import { OddsBar, Panel, SegmentedControl, StatTable, StatValue, TeamLogo, type StatTableColumn, type StatTableRow } from './ui';

interface LeadersHubProps {
  teams: Team[];
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  /**
   * Opens the dashboards half of the screen.
   *
   * A callback rather than a view switch inside this component, because Dashboards is a
   * sibling route (`leaders_dashboards`) rather than a third mode here. This screen
   * already stacks two segmented controls -- scope, then board -- and the dashboards need
   * their own again for which plot and which split. Three nested controls would be a
   * navigation problem wearing a layout costume.
   *
   * Required rather than optional so that every caller has to decide where the switch
   * goes. A screen that can be reached with no way onward is the failure this split has
   * to avoid, and an optional prop would make it a compile-time possibility.
   */
  onOpenDashboards: () => void;
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

/**
 * The batting boards, in display order.
 *
 * These four were deferred to last by explicit choice and are the reason this list
 * is declarative rather than branching. All four are already computed and verified
 * in `src/lib/analytics/metrics.ts`; nothing here re-derives a rate.
 *
 * THE FLOOR IS ONE NUMBER FOR ALL QUALIFIED BOARDS, and that is a deliberate
 * simplification worth knowing about. 82 at-bats was derived from the measured
 * league BABIP of 0.282 and a target standard error of 0.05, so it is exactly the
 * right floor for BABIP. The other three ride on it because a per-stat floor would
 * be a per-stat argument to defend, and 82 is conservative for all of them rather
 * than permissive: ISO is a difference of two positively correlated proportions,
 * so its standard error is smaller than the sum of the two parts would suggest, and
 * K-BB% rests on walk and strikeout counts that are large and well behaved.
 */
const BATTING_CATEGORIES: readonly BattingCategory[] = [
  {
    key: 'avg',
    title: 'Batting Average',
    direction: 'desc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).avg ?? 0,
    // The stored figure is what gets displayed, so a displayed average cannot
    // disagree with the player card; only the ordering is computed at full precision.
    format: (stat) => fmtAvg(stat.avg),
    meanFormat: (v) => fmtAvg(v),
    detail: (stat) => `${stat.hits} H / ${stat.atBats} AB`,
  },
  {
    key: 'hr',
    title: 'Home Runs',
    direction: 'desc',
    qualified: false,
    value: (stat) => stat.homeRuns,
    format: (stat) => String(stat.homeRuns),
    meanFormat: (v) => v.toFixed(1),
    detail: (stat) => `${stat.rbi} RBI`,
  },
  {
    key: 'rbi',
    title: 'RBI',
    direction: 'desc',
    qualified: false,
    value: (stat) => stat.rbi,
    format: (stat) => String(stat.rbi),
    meanFormat: (v) => v.toFixed(1),
    detail: (stat) => `${stat.homeRuns} HR`,
  },
  {
    key: 'ops',
    title: 'OPS',
    direction: 'desc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).ops ?? 0,
    format: (stat) => stat.ops.toFixed(3),
    meanFormat: (v) => v.toFixed(3),
    detail: (stat) => `${slugging(stat).toFixed(3)} SLG`,
  },
  {
    key: 'slg',
    title: 'Slugging',
    direction: 'desc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).slg ?? 0,
    format: (stat) => slugging(stat).toFixed(3),
    meanFormat: (v) => v.toFixed(3),
    detail: (stat) => `${stat.ops.toFixed(3)} OPS`,
  },
  {
    key: 'obp',
    title: 'On-Base',
    direction: 'desc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).obp ?? 0,
    format: (stat) => battingMetrics(toBattingCounts(stat)).obp?.toFixed(3) ?? '-',
    meanFormat: (v) => v.toFixed(3),
    detail: (stat) => `${slugging(stat).toFixed(3)} SLG`,
  },
  {
    // BABIP is hits among balls in play over balls in play, NOT hits over at-bats.
    // The two differ by strikeouts and home runs, and metrics.ts records the
    // 0.768-versus-0.277 bug that came from confusing them. Reached through
    // `metrics.babip` so that definition cannot be re-litigated in a screen.
    key: 'babip',
    title: 'BABIP',
    direction: 'desc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).babip?.value ?? 0,
    format: (stat) => {
      const babip = battingMetrics(toBattingCounts(stat)).babip;
      return babip ? fmtAvg(babip.value) : '—';
    },
    meanFormat: (v) => fmtAvg(v),
    detail: (stat) => {
      const m = battingMetrics(toBattingCounts(stat));
      // Hits among balls in play, which is total hits less home runs. `hits` is a
      // count on the stat row rather than on BattingMetrics, which carries only
      // the derived totals.
      return `${stat.hits - stat.homeRuns} H / ${m.ballsInPlay} BIP`;
    },
  },
  {
    key: 'iso',
    title: 'Isolated Power',
    direction: 'desc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).iso ?? 0,
    // Formatted like every other rate board, without a leading plus. ISO cannot be
    // negative in this engine (metrics.ts: totalBases >= hits always), so a sign
    // would be decoration, and it would break visual consistency with the .384
    // and .368 beside it.
    format: (stat) => {
      const iso = battingMetrics(toBattingCounts(stat)).iso;
      return iso === null ? '-' : fmtAvg(iso);
    },
    meanFormat: (v) => fmtAvg(v),
    detail: (stat) => `${stat.doubles + stat.triples + stat.homeRuns} XBH`,
  },
  {
    // K minus BB% is one board rather than two because it is the figure that
    // actually separates hitters, and a leaderboard has one value column. The
    // detail cell carries both counts so neither rate is lost.
    //
    // 'asc' is load-bearing and was wrong on the first pass. Every other batting
    // category sorts descending, and K-BB% is the one where LOW is good, so a
    // descending sort leads the board with the league's worst plate discipline.
    // Caught in the browser, not by reading it: the first render put a player
    // with 42 K against 7 BB at rank 1.
    key: 'kbb',
    title: 'K − BB%',
    direction: 'asc',
    qualified: true,
    value: (stat) => battingMetrics(toBattingCounts(stat)).kMinusBbPct ?? 0,
    format: (stat) => {
      const diff = battingMetrics(toBattingCounts(stat)).kMinusBbPct;
      if (diff === null) return '—';
      // Percentage points with an explicit sign, because unlike ISO this one is
      // routinely positive in this league and the sign is the point: the leaders
      // sit near zero or below.
      return `${diff >= 0 ? '+' : '-'}${Math.abs(diff * 100).toFixed(1)}`;
    },
    meanFormat: (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v * 100).toFixed(1)}`,
    detail: (stat) => `${stat.strikeouts} K / ${stat.walks} BB`,
  },
  {
    key: 'xbh',
    title: 'Extra-Base Hits',
    direction: 'desc',
    qualified: false,
    value: (stat) => stat.doubles + stat.triples + stat.homeRuns,
    format: (stat) => String(stat.doubles + stat.triples + stat.homeRuns),
    meanFormat: (v) => v.toFixed(1),
    detail: (stat) => `${stat.doubles} 2B / ${stat.triples} 3B / ${stat.homeRuns} HR`,
  },
];

interface CategoryBoard {
  key: string;
  title: string;
  /** 'desc' sorts the highest value first; 'asc' for ERA and WHIP. */
  direction: 'desc' | 'asc';
  qualified: boolean;
  columns: StatTableColumn[];
  rows: StatTableRow[];
  count: number;
  /**
   * The pool these percentiles were computed against, and its mean.
   *
   * ON THE BOARD RATHER THAN IN A ROW, because it is a property of the league and not
   * of a player. Putting "MEAN .268" in the header means every row below it is legible
   * against it without repeating the number ten times, and it means the figure cannot
   * be misread as belonging to whoever happens to be in row one.
   *
   * Null when the pool was too small to summarise honestly.
   */
  distribution: Distribution | null;
  /** The mean, formatted to the precision this stat is normally shown at. */
  meanLabel: string;
  /**
   * Why this board is short, when it is.
   *
   * The qualifying floor is the honest version of "this league has not started yet".
   * On day one nobody clears 82 at-bats, so a qualified board is empty, and an empty
   * board with no explanation reads as a bug rather than as a league that has played
   * four games. Stating the count and the floor says both, and it is the reason the
   * screen does not silently top the board up with unqualified players.
   */
  shortNote: string | null;
}

/**
 * A batting category, declared once with everything it needs to render.
 *
 * This used to be three parallel if-chains on `category.key` -- one for the sort
 * value, one for the detail cell, one for the display string -- each ending in a
 * fallthrough to On-Base. A fallthrough is the problem: a mistyped key, or a
 * category added to the list without touching all three chains, rendered a
 * perfectly plausible-looking On-Base board instead of failing. A category here
 * carries its own accessors, so the compiler enforces that it has them and there
 * is no default to fall into.
 *
 * Every rate is read from `battingMetrics`, which recomputes from integer counts.
 * The stored row is pre-rounded (3dp for avg/ops, per playerStats.ts:125-126), so
 * sorting on it would tie players who are not tied.
 */
interface BattingCategory {
  key: string;
  title: string;
  direction: 'desc' | 'asc';
  /** Whether the at-bat floor applies. Counting stats say no. */
  qualified: boolean;
  /** Sort value. Higher is better unless `direction` is 'asc'. */
  value: (stat: PlayerSeasonBatting) => number;
  /** Secondary figure in the third column. */
  detail: (stat: PlayerSeasonBatting) => string;
  /** The primary figure, as displayed. */
  format: (stat: PlayerSeasonBatting) => string;
  /**
   * How the pool's MEAN is displayed.
   *
   * A separate accessor, for the same reason `format` is one: the header mean is a
   * different quantity from a row's value, so it needs its own formatting rather than a
   * chain keyed on `category.key` with a fallthrough. Three decimals on a mean batting
   * average, one on a mean home-run count, and a signed figure on K-BB% -- reusing the
   * row's format for the mean would print a mean rate to the wrong precision on half the
   * boards, and a reader would have no way to tell a rounded mean from a precise one.
   */
  meanFormat: (value: number) => string;
}

interface StatEntry {
  playerId: string;
  name: string;
  team: Team | null;
  stat: PlayerSeasonBatting | PlayerSeasonPitching;
}

/**
 * The percentile cell, and why it is a separate column.
 *
 * This board used to be PLAYER / VALUE / detail. Rank was implied by the row order and
 * nothing else was said about where the number sat in the league. Adding the percentile
 * as a FOURTH column rather than folding it into the detail cell is deliberate: the
 * detail cell holds a supporting count ("22 HR", "48 K") that varies by stat, so a
 * percentile sharing it would change column meaning from one board to the next, and a
 * column whose contents mean different things per row is not a column.
 *
 * The percentile is computed against the board's own pool, so a rate board is compared
 * with the players who actually qualified and a counting board with everyone. Mixing
 * the two would let a 12-game rookie's three home runs land in a percentile derived from
 * 600-game hitters, which is a real number and a meaningless one.
 *
 * Blank rather than 0 when there is no pool to measure against. Zero is a claim.
 */
const percentileCell = (value: number, distribution: Distribution | null): React.ReactNode => {
  if (!distribution || distribution.size === 0) {
    return <span className="t-stat-sm text-[var(--color-ink-faint)]">-</span>;
  }
  const percentile = percentileOf(value, distribution);
  return (
    <span
      className="t-stat-sm tabular-nums text-[var(--color-ink-dim)]"
      title={`${percentile.toFixed(1)}th percentile of ${distribution.size} players in this pool`}
    >
      {formatPercentile(percentile)}
    </span>
  );
};

/** The narrow percentile column, identical on all three board types. */
const PERCENTILE_COLUMN: StatTableColumn = {
  key: 'pct',
  header: 'PCT',
  align: 'right',
  isNumeric: true,
  width: '4ch',
};

/**
 * Why a board is short, when it is.
 *
 * The qualifying floors are what stop a four-game league producing a confident-looking
 * leaderboard of noise. When the pool is smaller than a full board that is not a bug and
 * not something to hide by topping the list up with unqualified players -- it is the
 * honest state, and saying so is the whole point. A board that quietly filled itself
 * from the unqualified pool would be publishing rankings on eight at-bats while looking
 * identical to a board built on a full season.
 */
const shortBoardNote = (
  poolSize: number,
  qualified: boolean,
  floor: number,
  floorLabel: string,
): string | null => {
  if (!qualified) return null;
  if (poolSize === 0) {
    return `Nobody clears the ${floor} ${floorLabel} floor yet.`;
  }
  if (poolSize < TOP_ROWS) {
    return `Only ${poolSize} ${poolSize === 1 ? 'player' : 'players'} clear the ${floor} ${floorLabel} floor so far.`;
  }
  return null;
};

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
 * A rank column, a name with logo, the primary figure in gold, its percentile, and one
 * or two secondary figures in ink-dim. Top three ranks carry a 3px gold left edge, the
 * period convention, restrained to three.
 *
 * The header now carries the pool's mean and, where the board is short, why. Both are
 * header furniture rather than rows: they describe the league, and repeating them
 * per-row would both crowd the table and imply they were properties of the player.
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
      {board.distribution && (
        <span
          className="t-caption shrink-0 tabular-nums text-[var(--color-ink-faint)]"
          title={`Mean of the ${board.distribution.size} player-level ${board.title.toLowerCase()} figures in this pool. Not a league aggregate -- the two differ because a part-season player counts the same here. Percentiles are against this same pool.`}
        >
          MEAN {board.meanLabel}
        </span>
      )}
      <span className="t-caption shrink-0 text-[var(--color-ink-faint)]">{board.count}</span>
    </button>
    {board.shortNote && (
      <p className="border-b border-[var(--color-chrome-lo)] px-3 py-1 t-caption text-[var(--color-ink-faint)]">
        {board.shortNote}
      </p>
    )}
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
  onOpenDashboards,
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
  //
  // Qualification floors.
  //
  // BATTING_QUALIFYING_AT_BATS is the at-bat count at which the standard error
  // of a league-average rate falls to 0.05, derived in tools/verifyMetrics.ts
  // from the measured league BABIP of 0.282. It is a stated design choice about
  // what counts as a meaningful sample, not a measured constant, and it was
  // previously an unexplained 120. PITCHING_QUALIFYING_OUTS is the equivalent
  // thought in outs: 20 outs is five innings, a conventional minimum, and is
  // labelled as a convention rather than a fitted figure.
  const battingBoards = useMemo<CategoryBoard[]>(() => BATTING_CATEGORIES.map((category): CategoryBoard => {
    const pool = category.qualified
      ? battingEntries.filter((entry) => (entry.stat as PlayerSeasonBatting).atBats >= BATTING_QUALIFYING_AT_BATS)
      : battingEntries;

    // Ties break on average, which is the broadest single skill measure available
    // on every row. Using it as a tiebreaker rather than a sort key means two
    // players who are genuinely level on a board still appear in a stable order
    // rather than in whatever order the array happened to arrive in.
    const sorted = [...pool].sort((left, right) => {
      const delta =
        category.value(left.stat as PlayerSeasonBatting) -
        category.value(right.stat as PlayerSeasonBatting);
      if (delta !== 0) {
        return category.direction === 'desc' ? -delta : delta;
      }
      return (left.stat as PlayerSeasonBatting).avg - (right.stat as PlayerSeasonBatting).avg;
    });

    const columns: StatTableColumn[] = [
      { key: 'name', header: 'PLAYER' },
      { key: 'value', header: category.title.split(' ').pop()?.toUpperCase() ?? 'VAL', align: 'right', isNumeric: true, width: '5ch' },
      PERCENTILE_COLUMN,
      { key: 'detail', header: '', align: 'right', isNumeric: false, width: '8ch' },
    ];

    /*
     * The percentile pool.
     *
     * Computed from the SAME array the board ranks, not from all players in the league.
     * A rate board is therefore compared only with the players who cleared the floor
     * alongside it, which is the population the reader is implicitly comparing against;
     * a counting board is compared with everybody, because a part-season rookie's three
     * home runs is a real fact about a counting board and a meaningless one about a rate
     * board.
     */
    const distribution = summarise(
      pool.map((entry) => category.value(entry.stat as PlayerSeasonBatting)),
      category.direction === 'asc' ? 'asc' : 'desc',
    );

    return {
      key: category.key,
      title: category.title,
      direction: category.direction,
      qualified: category.qualified,
      count: pool.length,
      columns,
      distribution: distribution.size > 0 ? distribution : null,
      meanLabel: distribution.size > 0 ? category.meanFormat(distribution.mean) : '-',
      shortNote: shortBoardNote(pool.length, category.qualified, BATTING_QUALIFYING_AT_BATS, 'AB'),
      rows: sorted.slice(0, TOP_ROWS).map((entry, index) => {
        const stat = entry.stat as PlayerSeasonBatting;
        return {
          id: entry.playerId,
          className: index < 3 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
          cells: {
            name: nameCell(entry, index),
            value: <StatValue size="sm" variant="accent">{category.format(stat)}</StatValue>,
            pct: percentileCell(category.value(stat), distribution.size > 0 ? distribution : null),
            detail: <span className="t-stat-sm text-[var(--color-ink-faint)]">{category.detail(stat)}</span>,
          },
        };
      }),
    };
  }), [battingEntries]);

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

  const pitchingBoards = useMemo<CategoryBoard[]>(() => pitchingCategories.map((category): CategoryBoard => {
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
      PERCENTILE_COLUMN,
      { key: 'detail', header: '', align: 'right', isNumeric: false, width: '8ch' },
    ];

    /*
     * The percentile pool, from the same array the board ranks.
     *
     * `valueOf` is reused rather than the stored stat, for the reason ERA and WHIP need
     * it above: the stored row is pre-rounded, so two pitchers genuinely a hundredth
     * apart would tie, tie on percentile too, and a percentile that ties when the
     * underlying numbers do not is a worse lie than a rounded figure.
     */
    const distribution = summarise(
      pool.map(valueOf),
      category.direction === 'asc' ? 'asc' : 'desc',
    );
    /** The mean, at the precision this stat is normally shown at. */
    const meanFormat = (v: number): string => {
      if (category.key === 'era') return fmtEra(v);
      if (category.key === 'whip') return fmtWhip(v);
      if (category.key === 'k9') return v.toFixed(2);
      if (category.key === 'ip') return fmtIp(v);
      return v.toFixed(1);
    };

    return {
      ...category,
      columns,
      distribution: distribution.size > 0 ? distribution : null,
      meanLabel: distribution.size > 0 ? meanFormat(distribution.mean) : '-',
      shortNote: shortBoardNote(
        pool.length,
        category.qualified,
        PITCHING_QUALIFYING_OUTS,
        'outs',
      ),
      rows: sorted.slice(0, TOP_ROWS).map((entry, index) => ({
        id: entry.playerId,
        className: index < 3 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
        cells: {
          name: nameCell(entry, index),
          value: <StatValue size="sm" variant="accent">{formatValue(entry)}</StatValue>,
          pct: percentileCell(valueOf(entry), distribution.size > 0 ? distribution : null),
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

  const teamBoards = useMemo<CategoryBoard[]>(() => teamCategories.map((category): CategoryBoard => {
    // Distribution and mean are computed from all clubs, since every club is in every
    // pool and there is no qualifying floor on a team board.
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

    const teamDistribution = summarise(teams.map(valueOf), category.direction === 'asc' ? 'asc' : 'desc');
    const teamMeanLabel = (() => {
      if (teamDistribution.size === 0) return '-';
      const v = teamDistribution.mean;
      if (category.key === 'pct') return fmtPct(v);
      if (category.key === 'diff') return fmtDiff(v);
      return v.toFixed(1);
    })();

    return {
      ...category,
      columns: [
        { key: 'name', header: 'TEAM' },
        { key: 'value', header: category.key === 'pct' ? 'PCT' : category.key === 'diff' ? 'DIFF' : category.title.toUpperCase().slice(0, 4), align: 'right', isNumeric: true, width: '5ch' },
        PERCENTILE_COLUMN,
        { key: 'detail', header: '', align: 'right', isNumeric: false, width: '8ch' },
      ],
      // A team board is thirty-two entries, so there is no sample-size story to tell and
      // no floor to fall under. Every club is in every pool.
      distribution: teamDistribution,
      meanLabel: teamMeanLabel,
      shortNote: null,
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
          pct: percentileCell(valueOf(team), teamDistribution),
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
          {/*
            THE HALF-SCREEN SWITCH.

            Present on both halves at the same height, so "which am I on" is never
            something a reader has to infer from layout. The control beside it is the
            SCOPE control and is deliberately a separate one rather than another segment
            in this: scope and screen are different questions, and nesting them would
            mean a reader reaching for Teams lands on a different screen instead.
          */}
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              aria-label="Leader scope"
              value={mode}
              onChange={(value) => setMode(value as LeadersMode)}
              options={[{ value: 'players', label: 'Players' }, { value: 'teams', label: 'Teams' }]}
            />
            <SegmentedControl
              aria-label="Leaders view"
              mode="fill"
              value="tables"
              onChange={(value) => { if (value === 'dashboards') onOpenDashboards(); }}
              options={[
                { value: 'tables', label: 'Tables' },
                { value: 'dashboards', label: 'Dashboards' },
              ]}
            />
          </div>
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
              rest as a dense grid that wraps to three or four across. */}
          {expanded && (
            <Panel className="overflow-hidden">
              <div className="chrome-bar flex items-center justify-between gap-3 px-4">
                <h2 className="t-h3">{expanded.title}</h2>
                <span className="t-caption text-[var(--color-ink-faint)]">
                    {expanded.count} {expanded.qualified ? 'QUALIFIED' : 'PLAYERS'}
                  </span>
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
