import React from 'react';

export type StatTableDensity = 'default' | 'dense' | 'large';

/**
 * Row heights.
 *
 * A global tightening pass, after the rows read as congested across every list
 * in the product: rosters, players, free agents, the draft board, the trade
 * queue. `default` is the workhorse and was 30px, which forced two-line cells
 * and truncated names. It now sits just under the standings board, which is the
 * densest list anyone actually wants to read and reads well at 48px with a
 * 32px crest.
 *
 * `dense` is kept for the two places that genuinely stack a second line of
 * content under the primary figure -- the home page's matchup panels and the
 * trade queue -- and is still tightened rather than raised, because those two
 * are read by comparison rather than scanned.
 */
const ROW_HEIGHT: Record<StatTableDensity, string> = {
  dense: '34px',
  default: '50px',
  // 58 rather than 52: a standings crest is 40px and the figures beside it are
  // t-stat at 17px, so the row has to clear both plus the rules.
  large: '58px',
};

export interface StatTableColumn {
  key: string;
  header: string;
  /**
   * Replaces the header text when the label will not fit the column -- an icon
   * or a mark. The header text stays required and is used for the accessible
   * name and the tooltip, so a column is never identified by a picture alone.
   */
  headerNode?: React.ReactNode;
  headerTitle?: string;
  align?: 'left' | 'right';
  width?: string; // ch units, e.g., '5ch'
  isNumeric?: boolean;
  sortKey?: string; // if sortable, the key to pass to onSort
}

export interface StatTableRow {
  id: string | number;
  cells: Record<string, React.ReactNode>;
  highlight?: boolean;
  className?: string;
}

interface StatTableProps {
  columns: StatTableColumn[];
  rows: StatTableRow[];
  density?: StatTableDensity;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  /**
   * Makes every row a selectable target. A master-detail board -- pick a player,
   * see their offers -- cannot be expressed by a plain table, and a separate
   * list of divs would forfeit the column alignment this primitive exists to
   * provide. Rows become real buttons for keyboard and screen-reader users
   * rather than clickable table rows.
   */
  onRowSelect?: (id: string | number) => void;
  selectedRowId?: string | number;
  playoffLineIndex?: number; // index after which to draw the playoff line
  wildCardLineIndex?: number; // index for wild card cut (dashed)
  className?: string;
  'aria-label'?: string;
}

/**
 * StatTable — Table shell with chrome thead, hairline row rules, zebra striping,
 * fixed numeric column widths, horizontal scroll on overflow.
 *
 * Specifying requirements (§6.2):
 * - Numeric columns right-aligned, labels left-aligned (enforced internally)
 * - Fixed ch-based widths for numeric columns
 * - Row rules: 1px --color-chrome-lo at 40% opacity
 * - Zebra: --color-sunken at 50% opacity
 * - Active sort column header tinted --color-gold, values --color-gold-hi
 * - Below 640px: overflow-x: auto, minimum column width, no reflow/stack
 */
export const StatTable: React.FC<StatTableProps> = ({
  columns,
  rows,
  density = 'default',
  sortColumn,
  sortDirection = 'desc',
  onSort,
  onRowSelect,
  selectedRowId,
  playoffLineIndex,
  wildCardLineIndex,
  className = '',
  'aria-label': ariaLabel,
}) => {
  const rowHeight = ROW_HEIGHT[density];
  // Tracks the row height so the header does not read as a cramped strip above
  // a roomy body.
  const headerHeight = density === 'dense' ? '34px' : '40px';

  const isNumericColumn = (col: StatTableColumn) =>
    col.isNumeric ?? col.align === 'right';

  const getCellAlign = (col: StatTableColumn) =>
    isNumericColumn(col) ? 'text-right' : 'text-left';

  const getCellClass = (col: StatTableColumn, row: StatTableRow) => {
    const classes = [
      'px-2',
      getCellAlign(col),
      isNumericColumn(col) ? 't-stat tabular-nums' : 't-body',
    ];

    if (sortColumn === col.sortKey) {
      classes.push('text-[var(--color-gold-hi)]');
    }

    return classes.join(' ');
  };

  const getHeaderClass = (col: StatTableColumn) => {
    const classes = [
      'px-2',
      getCellAlign(col),
      't-label',
    ];

    if (sortColumn === col.sortKey) {
      classes.push('text-[var(--color-gold)] bg-[var(--color-panel-3)]');
    }

    return classes.join(' ');
  };

  const hasPlayoffLine = playoffLineIndex !== undefined && playoffLineIndex >= 0 && playoffLineIndex < rows.length;
  const hasWildCardLine = wildCardLineIndex !== undefined && wildCardLineIndex >= 0 && wildCardLineIndex < rows.length;

  return (
    <div className={`overflow-x-auto ${className}`} role="table" aria-label={ariaLabel}>
      <table className="w-full border-collapse" style={{ minWidth: 'max-content' }}>
        <thead>
          <tr className="chrome-bar" style={{ height: headerHeight }}>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={getHeaderClass(col)}
                style={{ width: col.width ? `${col.width}` : undefined, minWidth: col.width ? `${col.width}` : undefined }}
                onClick={() => col.sortKey && onSort?.(col.sortKey)}
                aria-sort={sortColumn === col.sortKey ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <div className="flex items-center justify-between gap-2">
                  {col.headerNode ? (
                    <span className="flex w-full items-center justify-center" title={col.headerTitle ?? col.header}>
                      {/* The label stays in the DOM for screen readers even when
                          a mark is drawn, so the column is never identified by a
                          picture alone. */}
                      <span className="sr-only">{col.headerTitle ?? col.header}</span>
                      {col.headerNode}
                    </span>
                  ) : (
                    <span>{col.header}</span>
                  )}
                  {col.sortKey && onSort && (
                    <span className="inline-flex items-center" aria-hidden="true">
                      {sortColumn === col.sortKey ? (
                        sortDirection === 'asc' ? '▲' : '▼'
                      ) : (
                        '⇅'
                      )}
                    </span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <React.Fragment key={row.id}>
              <tr
                className={`border-b border-[color:color-mix(in_srgb,var(--color-chrome-lo)_40%,transparent)] ${row.className ?? ''} ${
                  onRowSelect ? 'cursor-pointer transition-colors hover:bg-[var(--color-panel-2)]' : ''
                }`}
                style={{
                  height: rowHeight,
                  backgroundColor: selectedRowId === row.id
                    ? 'var(--color-panel-3)'
                    : rowIndex % 2 === 1 ? 'rgba(11,17,32,0.5)' : 'transparent',
                }}
                onClick={onRowSelect ? () => onRowSelect(row.id) : undefined}
                onKeyDown={onRowSelect ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowSelect(row.id);
                  }
                } : undefined}
                tabIndex={onRowSelect ? 0 : undefined}
                role={onRowSelect ? 'button' : undefined}
                aria-pressed={onRowSelect ? selectedRowId === row.id : undefined}
                aria-selected={onRowSelect ? selectedRowId === row.id : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={getCellClass(col, row)}
                    style={{ width: col.width ? `${col.width}` : undefined, minWidth: col.width ? `${col.width}` : undefined }}
                  >
                    {row.cells[col.key]}
                  </td>
                ))}
              </tr>
              {hasPlayoffLine && rowIndex === playoffLineIndex - 1 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} className="border-t-2 border-[var(--color-gold)] p-0" />
                </tr>
              )}
              {hasWildCardLine && rowIndex === wildCardLineIndex - 1 && (
                <tr aria-hidden="true">
                  <td colSpan={columns.length} className="border-t border-dashed border-[var(--color-ink-faint)]/40 p-0" />
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
