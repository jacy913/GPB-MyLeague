import React from 'react';
import type { FutureTab } from './futureTabs';

/**
 * The Season Futures tab strip.
 *
 * TWO ROWS, AND THE SECOND ONE EXISTS BECAUSE THE FIRST ONE WAS AMBIGUOUS
 *
 * Eleven options on one row is roughly 90px each at laptop width, which either wraps the labels or
 * needs a shortened label that throws away the league. Shortening is what produced the real defect:
 * `NORTH  SOUTH  EAST  WEST  NORTH  SOUTH  EAST  WEST`, with two `NORTH` tabs ninety pixels apart and
 * nothing on either saying which league it belonged to. The division name alone is not unique --
 * there are four names for eight races.
 *
 * Splitting by KIND rather than by count fixes both problems at once. Row one carries the
 * championship and the two league races -- three tabs, broadly scoped, each label meaningful on its
 * own. Row two carries the eight division races, which at four-per-group are wide enough to carry
 * the full `Platinum North` label rather than a truncated one, so the duplicate division names are
 * never ambiguous. The league prefix is doing real work in row two and only there.
 *
 * It also means no scrolling: everything is visible, which a single scrolling row could not promise
 * once the labels grew.
 *
 * ONE tablist, TWO ROWS
 *
 * The rows are presentational children of a single `tablist` rather than two separate ones. Two
 * tablists would claim two independent sets of tabs, which is wrong -- these are one control with a
 * visual break in it, and a screen reader should not announce them as unrelated groups.
 *
 * WHY role="tablist" AND NOT NAVIGATION
 *
 * These tabs switch panels on one screen and do not navigate. `tablist`/`tab`/`tabpanel` is the
 * role that describes exactly that, and it is what a screen reader will expect once arrow-key
 * navigation is wired in slice 6.
 */

interface FutureTabStripProps {
  tabs: readonly FutureTab[];
  activeId: string;
  onSelect: (id: string) => void;
}

const isDivision = (tab: FutureTab): boolean => tab.kind === 'division';

export const FutureTabStrip: React.FC<FutureTabStripProps> = ({ tabs, activeId, onSelect }) => {
  if (tabs.length === 0) return null;

  const rows: Array<readonly FutureTab[]> = [
    tabs.filter((tab) => !isDivision(tab)),
    tabs.filter(isDivision),
  ];

  const renderTab = (tab: FutureTab) => {
    const active = tab.id === activeId;
    return (
      <button
        key={tab.id}
        role="tab"
        id={`future-tab-${tab.id}`}
        aria-selected={active}
        aria-controls={`future-panel-${tab.id}`}
        tabIndex={active ? 0 : -1}
        onClick={() => onSelect(tab.id)}
        title={tab.label}
        className={[
          'shrink-0 border px-3 py-1.5 transition-colors duration-[var(--dur-fast)]',
          't-label whitespace-nowrap',
          active
            ? 'border-[var(--color-gold)] bg-[var(--color-gold)] text-[var(--color-ink-invert)]'
            : 'border-[var(--color-chrome-lo)] bg-[var(--color-panel-2)] text-[var(--color-ink-dim)] hover:border-[var(--color-chrome-hi)] hover:text-[var(--color-ink)]',
        ].join(' ')}
      >
        {tab.label}
      </button>
    );
  };

  return (
    <div className="border-b border-[var(--color-chrome-lo)] bg-[var(--color-void)]">
      <div
        role="tablist"
        aria-label="Season futures markets"
        className="grid gap-1 px-2 py-2"
      >
        {rows.map((row, rowIndex) => (
          row.length > 0 && (
            <div key={rowIndex} className="flex flex-wrap gap-px">
              {row.map(renderTab)}
            </div>
          )
        ))}
      </div>
    </div>
  );
};

/**
 * The active tab's market, or nothing.
 *
 * Returning null rather than an empty panel is deliberate. A tab strip whose selected tab is
 * always the championship would render a blank row on every other tab, which reads as a failed load
 * rather than as a tab that has not been visited yet.
 */
export const FutureTabPanel: React.FC<{
  tabs: readonly FutureTab[];
  activeId: string;
  children: (tab: FutureTab) => React.ReactNode;
}> = ({ tabs, activeId, children }) => {
  const tab = tabs.find((candidate) => candidate.id === activeId);
  if (!tab) return null;

  return (
    <div role="tabpanel" id={`future-panel-${tab.id}`} aria-labelledby={`future-tab-${tab.id}`}>
      {children(tab)}
    </div>
  );
};