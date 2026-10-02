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

export const ExchangeView: React.FC<ExchangeViewProps> = ({ priceLedger, teamIds }) => {
  const points = averageCloseSeries(priceLedger);
  const latest = points[points.length - 1];
  const first = points[0];

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
              width={720}
              height={140}
              showBand
              aria-label={
                `Average club share price over ${points.length} simulated days, `
                + `${Math.round(points[0].value)} to ${Math.round(latest?.value ?? 0)} on a 0 to 1000 scale.`
              }
            />
          </div>
        )}
      </Panel>
    </div>
  );
};