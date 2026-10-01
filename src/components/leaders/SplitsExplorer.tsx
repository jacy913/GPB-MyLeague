/**
 * Splits explorer -- does this player hit the same everywhere?
 *
 * WHAT THIS PANEL IS FOR
 *
 * A leaderboard ranks a player on one season line, and that is the most common way a
 * sabermetrics screen lies by omission. A .900 hitter who hit .900 in one half of his
 * schedule and .400 in the other is a different player from a .900 hitter who was .900
 * everywhere, and a single season number cannot say which. This panel exists to say which.
 *
 * WHY A COMPARISON TABLE AND NOT A TOGGLE
 *
 * The plan called for a toggle across Season / Home / Road / vs L / vs R. A toggle was
 * rejected on the grounds that it hides the entire reason the panel exists: switching to
 * ROAD shows you the road numbers and no longer shows you that they differ from the season
 * numbers. The comparison is the content, so the comparison is the layout -- one row per
 * player, one column per split, and the reader's eye finds the splits by itself.
 *
 * REBASELINED PER COLUMN, WHICH IS THE WHOLE POINT
 *
 * Each column carries the mean of ITS OWN pool, not of the season pool. A .268 mean batting
 * average across the league is not the bar a road hitter is clearing, because a road pool is
 * a different set of players from a home pool and the two means genuinely differ. The plan's
 * line -- "a .900 road hitter and a .900 home hitter are different players" -- is the reason
 * every column is normalised against itself.
 *
 * THE TWO FLOORS ARE DIFFERENT ON PURPOSE, AND THIS IS THE MOST IMPORTANT THING HERE
 *
 * Who APPEARS on the board is the same test the tables use: 82 at-bats for the season. Who
 * gets a NUMBER in a given split column is a much weaker test, and the weakness is not
 * accidental.
 *
 * The season floor cannot be reused per split. A player with 82 season at-bats has roughly
 * 41 of them at home. Applying an 82-AB floor to the home column would therefore print a
 * dash for essentially the entire league and produce an empty panel that looks broken rather
 * than early. So the per-column floor is 20 at-bats, which is the same 20 the pitching boards
 * already use for innings pitched.
 *
 * Twenty at-bats is genuinely noisy: the standard error on a batting average at 20 AB is
 * about .087, so a split figure can sit two or three times that from its true value. That is
 * why the per-column count is printed in every column header. A reader is entitled to know
 * how many players cleared a column's floor before treating that column as a fact about the
 * league, and a column that silently hides its own sample size is how the .900/.400 hitter
 * gets believed.
 *
 * WHAT IS NOT HERE
 *
 * Leverage is absent, and its absence is deliberate rather than an omission. The published
 * definition is a function of runners, outs and inning and needs a run-expectancy table to
 * be right; this project has no such table. See `splits.ts`.
 */

import React, { useMemo, useState } from 'react';
import { SplitSquareVertical } from 'lucide-react';
import type { Game, Player } from '../../types';
import { battingMetrics } from '../../lib/analytics/metrics';
import { summarise, type Distribution } from '../../lib/analytics/percentile';
import {
  deriveSplits,
  platoonCoverage,
  SPLIT_KINDS,
  SPLIT_LABELS,
  type SplitKind,
  type SplitLine,
} from '../../lib/analytics/splits';
import { fmtAvg } from '../../logic/statFormatting';
import {
  Panel,
  SegmentedControl,
  StatTable,
  StatValue,
  type StatTableColumn,
  type StatTableRow,
} from '../ui';

/** The tables' floor. Decides who is ON the board, and is mirrored in LeadersHub. */
const SEASON_FLOOR_AB = 82;

/**
 * The floor for printing a figure in ONE split column.
 *
 * Deliberately a fifth of the season floor, and the reasoning is in the file header: a
 * player with 82 season at-bats has about 41 at home, so a per-split floor of 82 would blank
 * the whole league. Twenty is the same threshold the pitching boards use for innings pitched,
 * so the screen has one number for "enough to mean something" rather than two.
 */
const SPLIT_FLOOR_AB = 20;

const TOP_ROWS = 25;

type SplitStatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'iso';

interface SplitStat {
  key: SplitStatKey;
  label: string;
  /** Read from `battingMetrics` so the screen cannot hold a second definition of a rate. */
  read: (m: ReturnType<typeof battingMetrics>) => number | null;
  format: (v: number) => string;
  width: string;
}

const SPLIT_STATS: readonly SplitStat[] = [
  { key: 'avg', label: 'AVG', read: (m) => m.avg, format: (v) => fmtAvg(v), width: '6ch' },
  { key: 'obp', label: 'OBP', read: (m) => m.obp, format: (v) => fmtAvg(v), width: '6ch' },
  { key: 'slg', label: 'SLG', read: (m) => m.slg, format: (v) => fmtAvg(v), width: '6ch' },
  { key: 'ops', label: 'OPS', read: (m) => m.ops, format: (v) => v.toFixed(3), width: '6ch' },
  { key: 'iso', label: 'ISO', read: (m) => m.iso, format: (v) => fmtAvg(v), width: '6ch' },
];

/** One column's worth of resolved figures: who cleared the floor, and the pool's shape. */
interface Column {
  kind: SplitKind;
  /** playerId -> value, for players who cleared the split floor in that column. */
  values: Map<string, number>;
  distribution: Distribution | null;
  meanLabel: string;
  /** How many players cleared the floor. Printed in the header, per the note above. */
  qualified: number;
}

/**
 * The floor a COLUMN is held to.
 *
 * `season` uses the tables' 82 at-bats; every split column uses 20. This is not a detail --
 * the first version applied the 20-AB split floor to the season column as well, which meant
 * "82 at-bats to appear on this board" was false for everyone between 20 and 82. The floor is
 * a property of the column, and a single shared floor cannot express that.
 *
 * A useful consequence of `season` being held to 82: its mean is computed over exactly the
 * pool the leaders tables use, so the SEASON mean printed here is the same figure the tables
 * print beside it. That is a cheap cross-check between two screens and it is deliberate.
 */
const floorFor = (kind: SplitKind): number => (kind === 'season' ? SEASON_FLOOR_AB : SPLIT_FLOOR_AB);

const buildColumn = (
  kind: SplitKind,
  table: Map<string, Record<SplitKind, SplitLine>>,
  playersById: Map<string, Player>,
  stat: SplitStat,
): Column => {
  const floor = floorFor(kind);
  const values = new Map<string, number>();
  table.forEach((row, playerId) => {
    const line = row[kind];
    if (line.atBats < floor) return;
    if (!playersById.has(playerId)) return;
    const value = stat.read(battingMetrics(line));
    if (value === null || !Number.isFinite(value)) return;
    values.set(playerId, value);
  });

  const pool = [...values.values()];
  const distribution = pool.length > 0 ? summarise(pool, 'desc') : null;
  return {
    kind,
    values,
    distribution,
    meanLabel: distribution ? stat.format(distribution.mean) : '-',
    qualified: pool.length,
  };
};

export interface SplitsExplorerProps {
  games: readonly Game[];
  players: readonly Player[];
}

export const SplitsExplorer: React.FC<SplitsExplorerProps> = ({ games, players }) => {
  const [statKey, setStatKey] = useState<SplitStatKey>('avg');

  /*
   * The derivation is module-level cached and incremental, so this memo recomputing on
   * every new game is the point rather than a problem: a newly completed game costs 0.20ms
   * to fold in and nothing already derived is re-parsed. Measured, not assumed -- see
   * `tools/measureSplitCost.ts`, which also records the 8.42s that this replaced as a
   * measurement bug where the timer wrapped the simulation.
   *
   * It runs on mount of this panel rather than at app start, which is the laziness that
   * makes 0.29s acceptable. The plan's 6.1 originally called this "the largest cost in the
   * plan"; it is not, and the correction is recorded there.
   */
  const table = useMemo(() => deriveSplits(games, players), [games, players]);

  const stat = SPLIT_STATS.find((s) => s.key === statKey) ?? SPLIT_STATS[0];
  const playersById = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players]);

  const columns = useMemo(
    () => SPLIT_KINDS.map((kind) => buildColumn(kind, table, playersById, stat)),
    [table, playersById, stat],
  );

  /*
   * WHO IS ON THE BOARD.
   *
   * The season floor, from the tables, so this panel and the leaders table beside it agree
   * about who is a player. Ranked by the season figure of the selected stat, which means the
   * ordering does not change when a reader switches splits -- the reader moves the numbers
   * under their eyes without the list reordering underneath them, which is the whole
   * comparison this panel exists to support.
   */
  const seasonColumn = columns.find((c) => c.kind === 'season');
  const ranked = useMemo(() => {
    if (!seasonColumn) return [];
    return [...seasonColumn.values.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_ROWS);
  }, [seasonColumn]);

  const tableColumns = useMemo<StatTableColumn[]>(() => [
    { key: 'name', header: 'PLAYER', align: 'left' },
    ...columns.map((c) => ({
      key: c.kind,
      header: SPLIT_LABELS[c.kind].short,
      headerTitle: c.distribution
        ? `Mean of the ${c.qualified} players with at least ${floorFor(c.kind)} at-bats in this split: `
          + `${c.meanLabel}. Rebaselined per split, not against the season pool.`
        : `No player cleared ${floorFor(c.kind)} at-bats in this split.`,
      align: 'right' as const,
      width: stat.width,
      isNumeric: true,
    })),
  ], [columns, stat.width]);

  const rows = useMemo<StatTableRow[]>(() => ranked.map(([playerId], index) => {
    const player = playersById.get(playerId);
    const cells: Record<string, React.ReactNode> = {
      name: (
        <span className="flex items-baseline gap-2">
          <span className="t-stat-sm w-5 shrink-0 tabular-nums text-[var(--color-ink-faint)]">{index + 1}</span>
          <span className="truncate">{player ? `${player.firstName} ${player.lastName}` : playerId}</span>
        </span>
      ),
    };

    for (const column of columns) {
      const value = column.values.get(playerId);
      cells[column.kind] = value === undefined
        ? <span className="t-stat-sm text-[var(--color-ink-faint)]">-</span>
        : (
          <StatValue size="sm" variant={column.kind === 'season' ? 'accent' : undefined}>
            {stat.format(value)}
          </StatValue>
        );
    }
    // Every figure on the row comes from the SAME derived column map, including the season
    // one. Reading the season figure from the engine's stored aggregate instead would mean a
    // row could show a dash in SEASON beside a number beside it, and the two would be
    // answering different questions about the same player.
    return {
      id: playerId,
      className: index < 3 ? 'border-l-[3px] border-l-[var(--color-gold)]' : '',
      cells,
    };
  }), [ranked, columns, playersById, stat]);

  const coverage = useMemo(() => platoonCoverage(table), [table]);
  const coverageLabel = coverage.total > 0
    ? `${Math.round((coverage.classified / coverage.total) * 100)}%`
    : '-';

  const thinest = columns.reduce(
    (worst, c) => (c.qualified < worst.qualified ? c : worst),
    columns[0] ?? { kind: 'season' as SplitKind, qualified: Number.MAX_SAFE_INTEGER },
  );

  return (
    <section className="space-y-3">
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <span className="flex items-center gap-2 t-label">
            <SplitSquareVertical className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            Splits &middot; {stat.label}
          </span>
          <SegmentedControl
            aria-label="Split stat"
            value={statKey}
            onChange={(value) => setStatKey(value as SplitStatKey)}
            options={SPLIT_STATS.map((s) => ({ value: s.key, label: s.label }))}
          />
        </div>

        {/*
          THE PER-COLUMN COUNTS, and the reason the panel is not lying by omission.

          Every column's header states how many players cleared that column's own floor. The
          columns are NOT the same size -- early in a season the home and road columns are
          much shorter than the season column -- and a table whose columns silently hold
          different numbers of players invites reading across them as though they did not.

          The platoon coverage line is here for the same reason, and for a specific one: vs LHP
          and vs RHP are a subset of the season line, not a partition of it. A plate appearance
          with an unresolvable pitcher lands in neither bucket, so the coverage figure is a
          fact about the data rather than a property of the code, and it is reported rather
          than assumed to be 100%.
        */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-chrome-lo)] px-4 py-2 t-caption text-[var(--color-ink-faint)]">
          <span>
            MEAN&nbsp;
            {columns.map((c) => (
              <span key={c.kind} className="mr-3">
                {SPLIT_LABELS[c.kind].short}&nbsp;{c.meanLabel}
                <span className="text-[var(--color-ink-faint)]">&nbsp;({c.qualified})</span>
              </span>
            ))}
          </span>
          <span className="ml-auto">PLATOON COVERAGE&nbsp;{coverageLabel}</span>
        </div>

        <StatTable
          columns={tableColumns}
          rows={rows}
          density="dense"
          aria-label={`${stat.label} by split`}
        />

        {/*
          THE FLOOR NOTE, and the thin-column warning.

          `thinest` is reported rather than hidden. If one split column has cleared its floor
          with only a handful of players, that column's mean is a mean of a few people and the
          reader should know before treating a gap in it as meaningful. Suppressing this would
          be the same class of error as printing the figure without its sample size.
        */}
        <p className="border-t border-[var(--color-chrome-lo)] px-4 py-2 t-caption text-[var(--color-ink-faint)]">
          {ranked.length === 0
            ? `No player has ${SEASON_FLOOR_AB} at-bats yet, so there is nobody to split. `
              + `A cell needs ${SPLIT_FLOOR_AB} at-bats in its own split; the season figure needs ${SEASON_FLOOR_AB}.`
            : `Listed by ${SPLIT_LABELS.season.label} ${stat.label}, top ${ranked.length}, each with `
              + `${SEASON_FLOOR_AB}+ at-bats for the season. A dash means under ${SPLIT_FLOOR_AB} at-bats `
              + `in that split, which is normal this early and is not a zero. `
              + `Thinnest column: ${SPLIT_LABELS[thinest.kind].label} at ${thinest.qualified}.`
              + ` vs LHP and vs RHP are a subset of the season line, not a partition of it.`}
        </p>
      </Panel>
    </section>
  );
};

export default SplitsExplorer;