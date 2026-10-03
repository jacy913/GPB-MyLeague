import React from 'react';
import type { PriceSeries } from '../../lib/analytics/sharePrice';
import { Panel, PanelHeader } from '../ui';
import { SharePriceChart, type PricePoint } from '../ui/SharePriceChart';

/**
 * THE EXCHANGE -- scaffolded, not finished.
 *
 * ============================================================================
 * WHY THIS IS A HOUSE WITHOUT FURNITURE
 * ============================================================================
 *
 * The price path has been complete and invisible since it was wired into the day loop: every
 * simulated day is priced, persisted, reloaded, and never drawn. This page exists so that gap is
 * visible in the product rather than only in a git log.
 *
 * It is deliberately thin. What is here is the one thing worth proving end-to-end -- that a season of
 * computed closes can be turned into a readable chart -- and nothing else. Every addition below this
 * line is a decision that should be made against something on screen, not in advance.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE YET
 * ============================================================================
 *
 *  - FAIR VALUE AS A SECOND LINE. `PriceSeries` persists closes only. Fair prices are an assessment
 *    made on the day, not a record of it, so drawing them means either recomputing the whole season
 *    on open or adding a second persisted field. That is a schema decision, not a layout one.
 *  - PER-CLUB DRILL-DOWN. Needs a selection model and a way to keep 32 series legible.
 *  - ANY INTERACTION. No hover readout, no range control. A chart you can only read whole is the
 *    honest first version.
 */

export interface ExchangeViewProps {
  /** Every priced day so far, oldest first. Absent on a league that has never been simulated. */
  priceLedger?: PriceSeries[];
  /** The team ids currently in the league, for labelling a club series later. */
  teamIds: string[];
  /** id -> display name. A ledger stores ids; a chart a player reads has to show names. */
  teamNames?: Record<string, string>;
}

/**
 * The league index, from the closes the ledger already holds.
 *
 * MEAN OF CLOSES, not a weighted index, and the difference is stated rather than hidden: `hxseIndex.ts`
 * has a proper value-weighted composite, but it is computed from fair values, which this page does not
 * have. A mean of closes is a real, computable, honest number -- and it is a different number from the
 * HXSE index, so it must not borrow that name. Labelled "average club price" until the fair layer is
 * available.
 */
const averageCloseSeries = (ledger: PriceSeries[] | undefined): PricePoint[] => {
  if (!ledger || ledger.length === 0) return [];
  return ledger.map((day) => {
    const values = Object.values(day.close).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return { date: day.date, value: 0 };
    return {
      date: day.date,
      value: values.reduce((sum, v) => sum + v, 0) / values.length,
    };
  });
};

/**
 * The recorded fair layer, averaged the same way the closes are and INDEX-ALIGNED with them.
 *
 * A `null` for a day whose fair layer was dropped, which is what makes the chart break its second
 * line there instead of drawing through a day nobody recorded a valuation for. The alignment is
 * computed in the same `map` over `ledger` as the closes precisely so the two cannot drift: a
 * separate filter that dropped a bad close day but kept its fair day would silently offset every
 * later point and turn the gap between the lines into nonsense.
 *
 * `null` for a day that HAS fair values is not possible -- `readRecordedFair` only returns a `fair`
 * key when at least one value survived -- but it is handled anyway rather than assumed, because a
 * 0 plotted as a valuation would draw the fair line along the floor of the band.
 */
const averageFairSeries = (ledger: PriceSeries[] | undefined): (PricePoint | null)[] => {
  if (!ledger || ledger.length === 0) return [];
  return ledger.map((day) => {
    if (!day.fair) return null;
    const values = Object.values(day.fair).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    return {
      date: day.date,
      value: values.reduce((sum, v) => sum + v, 0) / values.length,
    };
  });
};

/**
 * One club's close series, INDEX-ALIGNED with the fair series and `null` where the ledger has no
 * close for it.
 *
 * The alignment is the whole reason this is a `map` over `ledger` rather than a filter over the
 * days that happen to carry the club. A club can be missing from a day -- dropped by the strict
 * reader, or absent because it was not in the league yet -- and filtering would slide every later
 * point left against the fair line and the gap between them would mean nothing.
 */
const clubCloseSeries = (ledger: PriceSeries[] | undefined, clubId: string): (PricePoint | null)[] => {
  if (!ledger || ledger.length === 0) return [];
  return ledger.map((day) => {
    const value = day.close[clubId];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return { date: day.date, value };
  });
};

/**
 * How far a club has strayed from its recorded fair value, as a fraction.
 *
 * Null unless both numbers exist for the SAME day. Comparing a close against a fair value from a
 * different day is the tempting shortcut and it is meaningless: it would report a club as overvalued
 * by the amount the league itself moved that day, which says nothing about the club.
 *
 * The sign is a deviation, not an outcome, so it is not coloured as one.
 */
const strayedFromFair = (
  ledger: PriceSeries[] | undefined,
  clubId: string,
): { date: string; fraction: number } | null => {
  if (!ledger) return null;
  for (let i = ledger.length - 1; i >= 0; i -= 1) {
    const day = ledger[i];
    const close = day.close[clubId];
    const fair = day.fair?.[clubId];
    if (typeof close !== 'number' || typeof fair !== 'number') continue;
    if (!Number.isFinite(close) || !Number.isFinite(fair) || fair === 0) continue;
    return { date: day.date, fraction: close / fair - 1 };
  }
  return null;
};

export const ExchangeView: React.FC<ExchangeViewProps> = ({ priceLedger, teamIds, teamNames }) => {
  /*
    ONE CLUB AT A TIME, and never all of them at once.

    Thirty-two overlays on one 0-1000 axis is not a drill-down, it is a grey rectangle: the lines
    land within a few tens of points of each other because the market prices them all near 500, and
    a chart nobody can read is not a feature. Selecting a single club keeps the axis doing real work
    and makes the fair gap legible, which is the thing worth looking at.

    `null` means the league average, which is where the page starts.
  */
  const [selectedClub, setSelectedClub] = React.useState<string | null>(null);
  const averagePoints = averageCloseSeries(priceLedger);
  const averageFair = averageFairSeries(priceLedger);

  // Only clubs with at least one recorded close can be selected; offering the rest would let a
  // player pick a chart that cannot be drawn.
  const pricedClubIds = React.useMemo(() => {
    const ids = new Set<string>();
    priceLedger?.forEach((day) => Object.keys(day.close).forEach((id) => ids.add(id)));
    return teamIds.filter((id) => ids.has(id)).sort(
      (a, b) => (teamNames?.[a] ?? a).localeCompare(teamNames?.[b] ?? b),
    );
  }, [priceLedger, teamIds, teamNames]);

  // A club can disappear between renders -- a trade, a reset, a new league. Falling back to the
  // average rather than rendering an empty chart is the only honest option, since a stale
  // selection would otherwise draw someone else's price path.
  const activeClub = selectedClub && pricedClubIds.includes(selectedClub) ? selectedClub : null;

  const points = activeClub
    ? (clubCloseSeries(priceLedger, activeClub).filter((p) => p !== null) as PricePoint[])
    : averagePoints;
  const fairPoints = activeClub
    ? (priceLedger ?? []).map((day) => {
      const value = day.fair?.[activeClub];
      return typeof value === 'number' && Number.isFinite(value) ? { date: day.date, value } : null;
    })
    : averageFair;
  const latest = points[points.length - 1];
  const first = points[0];
  const clubName = activeClub ? (teamNames?.[activeClub] ?? activeClub) : null;
  const stray = activeClub ? strayedFromFair(priceLedger, activeClub) : null;
  /*
    Whether to draw the second line at all, and how much of it survived.

    Keyed on the number of days that actually have a valuation rather than on the field being
    present, because a ledger can carry `fair` on every day and still have nothing worth drawing if
    every value in it failed validation. And the count is surfaced in the caption, because a fair
    line that silently covers only part of the range is a chart making a partial claim without saying
    so.
  */
  const fairDays = fairPoints.filter((p) => p !== null).length;
  const hasFair = fairDays >= 2;

  return (
    <div className="flex flex-col gap-5">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="The Exchange"
          subtitle="Club shares, priced daily"
        />

        {points.length === 0 ? (
          /*
            THE EMPTY STATE IS THE HONEST ONE, and it is not a placeholder.

            There is no price path until a day has been simulated, so the page says exactly that
            rather than drawing a flat line at 500 that would read as "the market has been stable".
            A chart of nothing is a claim about nothing.
          */
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="t-h3 text-[var(--color-ink)]">No prices yet</p>
            <p className="t-caption text-[var(--color-ink-faint)]">
              The exchange opens once a day has been simulated. Simulate from the Dashboard, or use
              Simulate in the Commissioner folder.
            </p>
            <p className="t-caption text-[var(--color-ink-faint)]">
              {teamIds.length} clubs are listed and waiting.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-5 py-4">
            {/*
              THE SELECTOR, and why it is a native select rather than 32 chips.

              A chip row is the thing you build when there are five options. At thirty-two it is a
              wall of buttons that pushes the chart off the panel, and the eye has to read all of them
              to find one. A native select collapses to the current selection and is keyboard- and
              screen-reader-correct for free, which a div-and-onclick list is not.

              The average is the first option and the default, because it is what the page was showing
              before drill-down existed and it is the series the fair line was written against.
            */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="t-caption text-[var(--color-ink-faint)]" htmlFor="exchange-club">
                Club
              </label>
              <select
                id="exchange-club"
                className="rounded border border-[var(--color-chrome-mid)] bg-[var(--color-chrome-lo)] px-2 py-1 text-[var(--color-ink)]"
                value={activeClub ?? ''}
                onChange={(event) => setSelectedClub(event.target.value || null)}
              >
                <option value="">All clubs (average)</option>
                {pricedClubIds.map((id) => (
                  <option key={id} value={id}>{teamNames?.[id] ?? id}</option>
                ))}
              </select>
              {pricedClubIds.length < teamIds.length ? (
                <span className="t-caption text-[var(--color-ink-faint)]">
                  {teamIds.length - pricedClubIds.length} clubs not yet priced
                </span>
              ) : null}
            </div>
            {/*
              SCAFFOLDING NOTE, deliberately visible.

              One series, one chart, no controls. The numbers above it are the only derived values
              here and both are trivially checkable against the ledger, which is the point: when the
              per-club and fair-value work lands, this strip is the baseline it has to stay
              consistent with.
            */}
            <div className="flex flex-wrap items-baseline gap-4">
              <span className="t-stat-lg text-[var(--color-ink)]">
                {latest ? Math.round(latest.value) : '--'}
              </span>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {clubName ? `${clubName} share price` : 'average club price'}
                {first && latest && first.date !== latest.date
                  ? ` · ${first.date} to ${latest.date}`
                  : ''}
              </span>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {points.length} {points.length === 1 ? 'day' : 'days'}
              </span>
              {/*
                THE STRAY FIGURE, and it only appears for a single club.

                On the average it would be a real number and a useless one -- the mean of every club's
                deviation is not a statement about anything, and showing it would invite the reader to
                treat "the league is 2% rich" as a finding.

                Teal, not green or orange. A deviation from fair is not an outcome: being 8% above fair
                is neither good news nor bad news, it is expensive.
              */}
              {stray ? (
                <span className="t-caption text-[var(--color-neutral)]">
                  {stray.fraction >= 0 ? '+' : ''}
                  {(stray.fraction * 100).toFixed(1)}% vs fair on {stray.date}
                </span>
              ) : null}
            </div>

            <SharePriceChart
              points={points}
              fair={fairPoints}
              width={720}
              height={140}
              showBand
              /*
                FILLS THE PANEL RATHER THAN SITTING AT ITS 720px VIEWBOX.

                The viewBox stays 720x140 -- that is the coordinate system every geometry function
                computes in, and `checkShareChart` asserts against it. `preserveAspectRatio="none"`
                plus a full-width class stretches the X axis only, and `vectorEffect="non-scaling-
                stroke"` on both strokes is what keeps the lines one pixel wide afterwards. Without it
                a stretched fair line comes out visibly thicker than the close line, which reads as a
                difference in the data.
              */
              className="w-full"
              aria-label={
                `${clubName ? `${clubName} share price` : 'Average club share price'} over `
                + `${points.length} simulated days, `
                + `${Math.round(points[0].value)} to ${Math.round(latest?.value ?? 0)} on a 0 to 1000 scale.`
                + (hasFair
                  ? ` Dashed teal is the fair value recorded on each of those days.`
                  : '')
              }
            />

            {hasFair ? (
              <div className="mt-1 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-0 w-4 border-t border-dashed"
                  style={{ borderColor: 'var(--color-neutral)' }}
                />
                <span className="t-caption text-[var(--color-ink-faint)]">
                  fair value, as recorded on the day
                  {fairDays < points.length
                    ? ` · ${points.length - fairDays} ${points.length - fairDays === 1 ? 'day' : 'days'} unrecorded, drawn as a break`
                    : ''}
                </span>
                {clubName ? (
                  <span className="t-caption text-[var(--color-ink-faint)]">
                    the gap between the two lines is this club&apos;s premium or discount
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
};