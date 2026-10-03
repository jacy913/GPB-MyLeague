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

export const ExchangeView: React.FC<ExchangeViewProps> = ({ priceLedger, teamIds }) => {
  const points = averageCloseSeries(priceLedger);
  const fairPoints = averageFairSeries(priceLedger);
  const latest = points[points.length - 1];
  const first = points[0];
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
              SCAFFOLDING NOTE, deliberately visible.

              One series, one chart, no controls. The numbers above it are the only derived values
              here and both are trivially checkable against the ledger, which is the point: when the
              per-club and fair-value work lands, this strip is the baseline it has to stay
              consistent with.
            */}
            <div className="flex items-baseline gap-4">
              <span className="t-stat-lg text-[var(--color-ink)]">
                {latest ? Math.round(latest.value) : '--'}
              </span>
              <span className="t-caption text-[var(--color-ink-faint)]">
                average club price
                {first && latest && first.date !== latest.date
                  ? ` · ${first.date} to ${latest.date}`
                  : ''}
              </span>
              <span className="t-caption text-[var(--color-ink-faint)]">
                {points.length} {points.length === 1 ? 'day' : 'days'}
              </span>
            </div>

            <SharePriceChart
              points={points}
              fair={fairPoints}
              width={720}
              height={140}
              showBand
              aria-label={
                `Average club share price over ${points.length} simulated days, `
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
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  );
};