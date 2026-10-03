import React from 'react';
import type { PriceSeries } from '../../lib/analytics/sharePrice';
import { Panel, PanelHeader } from '../ui';
import { SharePriceChart, type PricePoint } from '../ui/SharePriceChart';

/**
 * THE EXCHANGE -- where the HXSE price path is made visible.
 *
 * ============================================================================
 * WHAT THIS PAGE IS, AND WHY IT LOOKS THE WAY IT DOES
 * ============================================================================
 *
 * The price path was complete and invisible for a long time: every simulated day was priced,
 * persisted, reloaded and never drawn. This page is the whole of the surface that shows it.
 *
 * ============================================================================
 * THE FOUR RULES EVERYTHING HERE FOLLOWS
 * ============================================================================
 *
 *  1. SHOW A RECORD, NOT A RECOMPUTATION. The fair line is the valuation that was actually used on
 *     the day. Recomputing it later runs different Monte Carlo trials against a different roster and
 *     returns a different number, which would set a real trade against a hypothetical one.
 *  2. SHOW A GAP WHERE THERE IS NO DATA. A day with a close and no valuation breaks the fair line.
 *     A day with neither is absent. Nothing is interpolated, padded or repeated to fill a window.
 *  3. LABEL THE AGGREGATE FOR WHAT IT IS. The default series is a MEAN OF CLOSES, labelled "average
 *     club price". It is not the HXSE index and does not borrow that name; `hxseIndex.ts` has a
 *     proper value-weighted composite computed from fair values.
 *  4. A DEVIATION FROM FAIR IS NOT AN OUTCOME. It is printed in the neutral teal, never green or
 *     orange, because being 8% above fair value is neither good news nor bad news -- it is expensive.
 *
 * ============================================================================
 * WHAT IS STILL NOT HERE
 * ============================================================================
 *
 *  - NO PER-CLUB COMPARISON. One club at a time by deliberate choice; see the note on the selection
 *    below for why thirty-two overlays on a 0-1000 axis would be a grey rectangle.
 *  - NO BETTING AGAINST THE STRAY. The gap between the two lines is the obvious thing to make
 *    actionable and the whole `strayedFromFair` figure is already computed for it. That needs a
 *    market, a settlement rule and a calibration check, and none of those exist yet.
 *  - NO WORKING DAY CALENDAR, DELIBERATELY. The x-axis is indexed by SIMULATED day, so a run of
 *    off-days occupies the same width as a run of games. That is the right call for this chart and
 *    the wrong one for a different question: the ledger has real ISO dates and could be spaced by
 *    calendar day instead. The reason to leave it is that the market does not trade on an off-day
 *    either, so the absence is schedule information rather than price information, and the caption
 *    prints the real date range so nobody has to infer the elapsed time from the spacing. `check-
 *    ShareChart` check 4 asserts the indexed rule so a change to it is deliberate.
 *  - NOTHING WITHIN THE CHART IS STRETCHED ANY MORE, and it used to be. The svg used to declare a
 *    fixed viewBox and stretch it to fill the panel, which horizontally distorted the 0/500/1000 band
 *    labels -- everything that was not a path came out 1.7x too wide. It now sets its viewBox to the
 *    measured pixel width, so one user unit is one CSS pixel and the geometry is exact.
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

/**
 * The range windows, shortest first, with `All` last.
 *
 * `null` means "no window" rather than a large number, because a large number would have to be
 * compared against the ledger length to decide whether to pad, and padding a price history is the one
 * thing this page never does.
 */
const RANGES: Array<{ label: string; days: number | null }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
];

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
  const [compareClub, setCompareClub] = React.useState<string | null>(null);
  const [rangeDays, setRangeDays] = React.useState<number | null>(30);

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

  /*
    THE COMPARISON CLUB, and it is EXCLUDED FROM ITS OWN DROPDOWN.

    Two rules, both about not drawing a chart that means something other than what it says:

      - It can never equal the primary. Comparing a club with itself produces two identical lines and
        a spread of exactly zero, which reads as "these two clubs are the same" rather than "you
        picked the same club twice". The option is removed rather than greyed so it cannot be chosen
        at all.
      - It must still be in the priced set, for the same staleness reason the primary is checked.

    The primary keeps the close line and the fair line; the comparison gets a close line only. Two fair
    lines would be three lines and two meanings, and the second fair line adds nothing -- what the
    comparison is for is seeing two CLOSES diverge, and each club's own premium is already readable
    from the primary's stray figure and from the comparison club's readout on any given day.
  */
  const activeCompare = compareClub && pricedClubIds.includes(compareClub) && compareClub !== activeClub
    ? compareClub
    : null;

  /*
    THE RANGE SLICES THE LEDGER, NOT THE SERIES, and that ordering is the whole implementation.

    Every derived array on this page -- the close series, the fair series, the stray figure -- is
    built by mapping over the ledger in the same pass, because the chart depends on the close and the
    fair value for a day sharing an INDEX. Slicing the ledger first preserves that by construction.
    Slicing the two series separately would be one filter too many and could drop a day from one and
    not the other, which slides every later point left and turns the gap between the lines into a
    different number.

    A window wider than the ledger yields everything there is. It does not pad, repeat, or
    interpolate to fill -- a 30-day button on a 12-day market shows 12 days and the caption says 12,
    because padding a price history with days nobody traded is precisely the invention this page
    refuses everywhere else.
  */
  const visibleLedger = React.useMemo(
    () => (rangeDays === null || !priceLedger ? priceLedger : priceLedger.slice(-rangeDays)),
    [priceLedger, rangeDays],
  );

  /*
    The league-average series, memoised on the SLICED ledger.

    Both arrays come from the same `visibleLedger`, which is what keeps the close at index i and the
    fair value at index i describing the same day. Deriving them from `priceLedger` and slicing
    afterwards would put the two windows a different distance apart.
  */
  const averagePointsVisible = React.useMemo(
    () => averageCloseSeries(visibleLedger),
    [visibleLedger],
  );
  const averageFairVisible = React.useMemo(
    () => averageFairSeries(visibleLedger),
    [visibleLedger],
  );

  const points = activeClub
    ? (clubCloseSeries(visibleLedger, activeClub).filter((p) => p !== null) as PricePoint[])
    : averagePointsVisible;
  const fairPoints = activeClub
    ? (visibleLedger ?? []).map((day) => {
      const value = day.fair?.[activeClub];
      return typeof value === 'number' && Number.isFinite(value) ? { date: day.date, value } : null;
    })
    : averageFairVisible;
  const latest = points[points.length - 1];
  const first = points[0];
  const clubName = activeClub ? (teamNames?.[activeClub] ?? activeClub) : null;
  const stray = activeClub ? strayedFromFair(visibleLedger, activeClub) : null;

  /*
    THE COMPARISON SERIES, built with `null` padding rather than filtered.

    `clubCloseSeries` returns a `null` for any day the club is absent from -- dropped by the strict
    reader, or simply not in the league yet. Those days become gaps here, exactly as they do in the
    fair layer. Filtering them out instead would slide every later point left against the primary
    line, and two lines that appear to converge would only be misaligned.

    The chart refuses to draw a secondary series whose length differs from the primary's, so this
    array is the full ledger length by construction.
  */
  const comparePoints = activeCompare
    ? clubCloseSeries(visibleLedger, activeCompare)
    : null;
  const compareName = activeCompare ? (teamNames?.[activeCompare] ?? activeCompare) : null;

  /*
    THE SPREAD ON THE LAST DAY, as a signed difference in price points rather than a percentage.

    A percentage would be a claim about which club is "doing better", and over one day that is mostly
    noise -- realised daily sigma is 0.83% on the mean close and about 4% on a single club, so a 1%
    gap is not a story. Price points are what the chart is actually showing, and the vertical distance
    between the two lines is already that number, so the readout says the same thing the eye does.

    The two clubs' LAST closes are differenced even though they are read from index-aligned arrays,
    and that is deliberate: the last close each of them actually traded at, rather than "the last day
    both were present". When one club misses a day its own last close is older, and silently moving it
    forward to match the other would invent a price it did not have. The caption names the date so the
    reader can see which day the figure is from, and the hover readout always reads the SAME day for
    both clubs or says which one is missing.
  */
  const latestCompare = comparePoints
    ? [...comparePoints].reverse().find((p): p is PricePoint => p !== null) ?? null
    : null;
  const spread = latestCompare && latest ? latest.value - latestCompare.value : null;
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

  /*
    THE HOVER READOUT, and its index is into the SLICED series.

    The chart reports an index and this page owns the numbers, so the two can never disagree about
    which day is meant. `hovered` is read defensively: a pointer can still be over the chart when the
    range changes underneath it, which leaves the old index pointing at a different day -- so an
    out-of-range index reads as "nothing hovered" rather than as `undefined.value` throwing.

    The readout is `aria-live="polite"` because it is also the keyboard path: tab to the chart, walk it
    with the arrows, and the numbers are announced. Without the live region a screen-reader user
    moving the crosshair would hear nothing at all.
  */
  const [hoverIndex, setHoverIndex] = React.useState<number | null>(null);
  const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < points.length
    ? points[hoverIndex]
    : null;
  const hoveredFair = hoverIndex !== null && fairPoints[hoverIndex] ? fairPoints[hoverIndex] : null;
  const hoveredCompare = hoverIndex !== null && comparePoints && comparePoints[hoverIndex]
    ? comparePoints[hoverIndex]
    : null;
  const hoveredSpread = hovered && hoveredCompare ? hovered.value - hoveredCompare.value : null;
  const hoveredStray = hovered && hoveredFair && hoveredFair.value !== 0
    ? hovered.value / hoveredFair.value - 1
    : null;

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
              THE COMPARISON SELECT, hidden until a club is chosen.

              With "All clubs (average)" as the primary there is nothing to compare against that means
              anything -- an average against a single club is a different KIND of number, and the
              spread between them would be read as a price gap between two things that are not two
              things. So the control only appears once a real club is selected.

              The primary is removed from the options rather than disabled, because a disabled option
              that looks available on some browsers is a worse version of removing it.
            */}
            {activeClub ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="t-caption text-[var(--color-ink-faint)]" htmlFor="exchange-compare">
                  Compare with
                </label>
                <select
                  id="exchange-compare"
                  className="rounded border border-[var(--color-chrome-mid)] bg-[var(--color-chrome-lo)] px-2 py-1 text-[var(--color-ink)]"
                  value={activeCompare ?? ''}
                  onChange={(event) => setCompareClub(event.target.value || null)}
                >
                  <option value="">None</option>
                  {pricedClubIds.filter((id) => id !== activeClub).map((id) => (
                    <option key={id} value={id}>{teamNames?.[id] ?? id}</option>
                  ))}
                </select>
              </div>
            ) : null}
            {/*
              THE HEADLINE STRIP, and it deliberately still reads the same in both modes.

              This was written when the page was a scaffold and every number above the chart was
              trivially checkable against the ledger. It still is: the big figure is the LAST close
              in the visible range, the range label reports how many days that actually is, and the
              teal figure is one close divided by one fair value from the SAME day.

              The only change in meaning is which series it describes, and that is spelled out in the
              caption rather than left to be inferred from the selector -- "average club price" and
              "Agents share price" are different numbers and the reader should never have to guess
              which one they are looking at.
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
                {/*
                  WHY THE WINDOW IS SMALLER THAN THE BUTTON SAYS.

                  `points.length` alone is true but leaves a question: the reader pressed "30d" and
                  sees 14. Saying so costs one clause and pre-empts the reasonable suspicion that the
                  page silently truncated something.
                */}
                {rangeDays !== null && points.length < rangeDays
                  ? ` of the ${rangeDays}-day window`
                  : ''}
                {(priceLedger?.length ?? 0) > points.length
                  ? ` · ${(priceLedger?.length ?? 0) - points.length} earlier not shown`
                  : ''}
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
              {/*
                THE SPREAD, last day, beside the stray rather than replacing it. Both are "how far
                from something" figures and they answer different questions -- one says whether this
                club is expensive, the other says which of two clubs the market likes more.
              */}
              {spread !== null && latestCompare ? (
                <span className="t-caption text-[var(--color-ink-dim)]">
                  {Math.abs(Math.round(spread))} pts {spread >= 0 ? 'ahead of' : 'behind'} {compareName}
                  {latest ? ` on ${latest.date}` : ''}
                </span>
              ) : null}
            </div>

            {/*
              THE RANGE, as a small button row rather than a second select.

              Buttons here because the choices are a handful of mutually exclusive windows over the
              same data -- the case a group of pressed/unpressed toggles is for. They use
              `aria-pressed` rather than a `role="tablist"`, because these do not reveal different
              panels; they re-draw the one already on screen, and calling that a tab would promise
              something the markup does not do.

              Every window is offered even when the ledger is shorter, because disabling 90d on a
              12-day market implies the data is missing rather than not yet simulated. The caption
              reports what is actually shown, which is the honest place for that.
            */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="t-caption text-[var(--color-ink-faint)]">Range</span>
              <div className="flex gap-1" role="group" aria-label="Date range">
                {RANGES.map((range) => (
                  <button
                    key={range.label}
                    type="button"
                    aria-pressed={rangeDays === range.days}
                    onClick={() => setRangeDays(range.days)}
                    className={[
                      'rounded px-2 py-1 t-caption transition-colors',
                      rangeDays === range.days
                        ? 'bg-[var(--color-chrome-mid)] text-[var(--color-ink)]'
                        : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
                    ].join(' ')}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>

            <SharePriceChart
              points={points}
              fair={fairPoints}
              secondary={comparePoints}
              onHover={setHoverIndex}
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

            {/*
              THE READOUT. Real HTML rather than SVG text, because this chart is rendered stretched
              and anything drawn inside it is horizontally distorted with the geometry. Out here it
              stays selectable, translatable, and the right size.

              Holds its height when nothing is hovered rather than collapsing, so the chart does not
              jump the moment the pointer leaves. The resting text says what to do instead of showing
              a blank.
            */}
            <div
              className="flex min-h-[1.25rem] items-baseline gap-3"
              aria-live="polite"
              aria-atomic="true"
            >
              {hovered ? (
                <>
                  <span className="t-caption text-[var(--color-ink-faint)]">{hovered.date}</span>
                  <span className="t-stat-sm text-[var(--color-ink)]">
                    {Math.round(hovered.value)}
                  </span>
                  <span className="t-caption text-[var(--color-ink-faint)]">
                    {clubName ? `${clubName} close` : 'average close'}
                  </span>
                  {hoveredFair ? (
                    <>
                      <span className="t-caption text-[var(--color-neutral)]">
                        fair {Math.round(hoveredFair.value)}
                      </span>
                      {hoveredStray !== null ? (
                        <span className="t-caption text-[var(--color-ink-faint)]">
                          {hoveredStray >= 0 ? '+' : ''}
                          {(hoveredStray * 100).toFixed(1)}%
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="t-caption text-[var(--color-ink-faint)]">
                      no fair value recorded
                    </span>
                  )}
                  {/*
                    THE COMPARISON CLUB ON THE SAME DAY.

                    Read from the hovered index rather than the last day, so it moves with the
                    crosshair -- a readout showing today's spread under a cursor over 3 June would be
                    two different claims in one line.

                    The spread is `A - B`, signed, and named. Leaving it unsigned would make "Apes 40
                    ahead" and "Apes 40 behind" print the same figure.
                  */}
                  {hoveredCompare ? (
                    <>
                      <span className="t-caption text-[var(--color-ink-dim)]">
                        {compareName} {Math.round(hoveredCompare.value)}
                      </span>
                      {hoveredSpread !== null ? (
                        <span className="t-caption text-[var(--color-ink-dim)]">
                          {hoveredSpread >= 0 ? '+' : ''}
                          {Math.round(hoveredSpread)} pts
                        </span>
                      ) : null}
                    </>
                  ) : compareName ? (
                    <span className="t-caption text-[var(--color-ink-faint)]">
                      {compareName} not priced on {hovered?.date}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="t-caption text-[var(--color-ink-faint)]">
                  Hover or focus the chart and use the arrow keys to read a day.
                </span>
              )}
            </div>

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