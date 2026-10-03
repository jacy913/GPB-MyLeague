import React from 'react';
import type { PriceSeries } from '../../lib/analytics/sharePrice';
import type { Team } from '../../types';
import { Panel, PanelHeader, TeamLogo } from '../ui';
import { axisCeilingFor } from '../ui/SharePriceChart';
import { ExchangeDesk } from './ExchangeDesk';
import { latestClose } from '../../lib/analytics/priceBoard';
import { SharePriceChart, type PricePoint } from '../ui/SharePriceChart';
import gpbMark from '../../assets/gpb.png';
import hxseMark from '../../assets/media/hxselogo.png';

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
  /**
   * The clubs in the league, in full.
   *
   * Whole `Team` objects rather than ids and a separate name map, because this page draws the club
   * crest and `TeamLogo` resolves a crest from the `Team` itself. Passing ids and names separately
   * would mean this page could label a club it could not identify, which is the shape of bug where
   * the fallback initials plate quietly appears next to a real team name.
   */
  teams: Team[];
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
 * Prices are FLOATS, and this page used to throw that away.
 *
 * `priceBoardForDay` returns unrounded values -- a club closes at 499.3712, not 499 -- and every
 * figure on this page was passed through `Math.round` for display. That is a rounding of a REAL
 * number to a value the market never quoted, on the one screen whose entire subject is what things
 * are worth to two decimals.
 *
 * So: currency symbol, two decimal places, and a thousands separator to match the axis labels in
 * `SharePriceChart`. Signed variants for the premium and the spread, which are differences and so
 * need to say which way round they are.
 */
const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const fmtPrice = (value: number): string => `$${groupThousands(value.toFixed(2))}`;
export const fmtSignedPrice = (value: number): string =>
  `${value >= 0 ? '+' : '-'}$${groupThousands(Math.abs(value).toFixed(2))}`;

/**
 * One club's row on the board: latest close, and how far it sits from its recorded fair value.
 *
 * Both come from the SLICED ledger, so a tile always describes the same window the chart above it
 * does. A board reading a 30-day window beside a chart reading "All" would be two different claims
 * about the same club on the same screen.
 */
interface BoardRow {
  team: Team;
  price: number;
  date: string;
  fair: number | null;
  stray: number | null;
  /** The club's own closes across the visible window, for the tile's sparkline. */
  spark: PricePoint[];
}

const buildBoard = (
  ledger: PriceSeries[] | undefined,
  teams: Team[],
  pricedIds: string[],
): BoardRow[] => {
  if (!ledger || ledger.length === 0) return [];
  const rows: BoardRow[] = [];
  for (const id of pricedIds) {
    const team = teams.find((t) => t.id === id);
    if (!team) continue;
    // Walk backwards for this club's own LAST close rather than assuming the ledger's final day has
    // one. A club absent from the last day would otherwise be dropped off the board entirely, which
    // is a much worse lie than showing it a day stale with the date printed beside it.
    for (let i = ledger.length - 1; i >= 0; i -= 1) {
      const day = ledger[i];
      const close = day.close[id];
      if (typeof close !== 'number' || !Number.isFinite(close)) continue;
      const fair = day.fair?.[id];
      const fairOk = typeof fair === 'number' && Number.isFinite(fair) && fair !== 0 ? fair : null;
      rows.push({
        team,
        price: close,
        date: day.date,
        fair: fairOk,
        stray: fairOk === null ? null : close / fairOk - 1,
        spark: (clubCloseSeries(ledger, id).filter((p) => p !== null) as PricePoint[]),
      });
      break;
    }
  }
  // RANKED BY PRICE, because this is a market board and the order a reader wants is the order the
  // market has put them in. A club that has climbed to the top of the league should be findable
  // without reading thirty-two numbers.
  return rows.sort((a, b) => b.price - a.price);
};

/**
 * The range windows, shortest first, with `All` last.
 *
 * `null` means "no window" rather than a large number, because a large number would have to be
 * compared against the ledger length to decide whether to pad, and padding a price history is the one
 * thing this page never does.
 */
/**
 * The chart's drawn height, in pixels.
 *
 * Named rather than inlined because this is a LAYOUT decision with a measured justification, and
 * an unexplained `480` in a prop list is the kind of number nobody dares change for two years.
 *
 * 680 -> 480, on the measurement in the call site's comment. The axis was raised to a 1300 ceiling
 * in the same pass that made it 680, and that ceiling spends 23% of the height on room above a
 * price no club has ever printed: across all 256 closes of a real save, the range is 249 to 993.
 * So the taller chart was not showing more market, it was showing more empty panel.
 *
 * Height is the lever precisely because it is the only one that costs nothing. Narrowing the axis
 * would fill the plot and also make a quiet week look like a crash, which is what
 * `checkShareChart` check 2 forbids. Trading a little apparent variance for a page that is not
 * mostly void is the right way round.
 */
const CHART_VIEW_HEIGHT = 480;

const RANGES: Array<{ label: string; days: number | null }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
];

export const ExchangeView: React.FC<ExchangeViewProps> = ({ priceLedger, teams }) => {
  const teamIds = React.useMemo(() => teams.map((t) => t.id), [teams]);
  const teamNames = React.useMemo(
    () => Object.fromEntries(teams.map((t) => [t.id, `${t.city} ${t.name}`])),
    [teams],
  );
  const teamById = React.useMemo(
    () => new Map(teams.map((t) => [t.id, t] as const)),
    [teams],
  );
  /*
    ONE CLUB AT A TIME, and never all of them at once.

    Thirty-two overlays on one 0-1000 axis is not a drill-down, it is a grey rectangle: the lines
    land within a few tens of points of each other because the market prices them all near 500, and
    a chart nobody can read is not a feature. Selecting a single club keeps the axis doing real work
    and makes the fair gap legible, which is the thing worth looking at.

    `null` means the league average, which is where the page starts.
  */
  const [selectedClub, setSelectedClub] = React.useState<string | null>(null);
  const [selectionTouched, setSelectionTouched] = React.useState(false);
  const [compareClub, setCompareClub] = React.useState<string | null>(null);
  const [rangeDays, setRangeDays] = React.useState<number | null>(30);

  /*
    EVERY SELECTION GOES THROUGH ONE HELPER, because "has the reader chosen yet" is a real piece of
    state and three bare `setSelectedClub` calls in three handlers would each have to remember to set
    it. Missing one would let the default silently re-assert itself over the reader's choice.
  */
  const chooseClub = React.useCallback((id: string | null): void => {
    setSelectedClub(id);
    setSelectionTouched(true);
  }, []);

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
    ONE AXIS CEILING FOR THE WHOLE PAGE, computed from every close in the visible ledger.

    Not per chart. Two clubs are only comparable if they are drawn on the same scale, so this is
    derived from all thirty-two clubs rather than from the selected one -- otherwise the Leopards at
    $993 and a $400 club would be drawn on different axes and the gap between them would be an artefact
    of the drawing rather than a fact about the prices.

    It moves only when a price crosses one of `AXIS_STEPS`, so a quiet week cannot rescale the chart
    and make itself look dramatic. That property is the reason the axis steps rather than fitting the
    data, and it is what `checkShareChart` check 2 now guards.

    It is computed from `visibleLedger` rather than the whole ledger so changing the range to 7 days
    does not leave a ceiling set by a price from three months ago.
  */
  const axisCeiling = React.useMemo(() => {
    const everyClose: number[] = [];
    for (const day of visibleLedger ?? []) {
      for (const value of Object.values(day.close)) {
        if (typeof value === 'number' && Number.isFinite(value)) everyClose.push(value);
      }
    }
    return axisCeilingFor(everyClose);
  }, [visibleLedger]);

  const board = React.useMemo(
    () => buildBoard(visibleLedger, teams, pricedClubIds),
    [visibleLedger, teams, pricedClubIds],
  );

  /*
    THE DESK'S PRICE SOURCE: the last day in the WHOLE ledger, not the last day of the visible range.

    These are different things and using the visible one is a quiet lie. Narrow the range to 7 days
    and a position opened last month would be marked to a close from three days ago, so the book
    would appear to gain or lose money every time the range buttons were pressed. A mark has to be
    against the most recent price the market actually printed.
  */
  const latestCloses = React.useMemo(
    () => latestClose(priceLedger) ?? {},
    [priceLedger],
  );
  const latestDate = priceLedger && priceLedger.length > 0
    ? priceLedger[priceLedger.length - 1].date
    : null;

  /*
    THE PAGE OPENS ON A CLUB, not on the league average, and the measurement is why.

    The average of thirty-two clubs is a genuinely FLAT series, not a badly-drawn one: averaging
    cancels the idiosyncratic moves, and the realised daily sigma of the mean close is 0.83% against
    roughly 4% for a single club. Measured on the same ledger at the same chart height, the average
    moves 6.8px vertically and a club moves 154.9px.

    So the default view was the one chart on this page that could not show a price doing anything,
    and it was what loaded first. Rank 1 is the default now: the most expensive club in the league,
    which is also the most interesting one to open a market on.

    The effect waits for the board because the ledger is loaded asynchronously -- there is nothing to
    rank on the first render -- and it stops the moment the reader touches a selector, so the default
    never reasserts itself over a deliberate choice.
  */
  React.useEffect(() => {
    if (selectionTouched || board.length === 0) return;
    setSelectedClub(board[0].team.id);
  }, [board, selectionTouched]);

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
    /*
      THE TWO COLUMNS, AND WHY THE LEFT ONE STICKS.

      2/3 chart, 1/3 roster. The grid is `items-start` so the sticky child is not stretched to its
      grid area -- without it a sticky element inside a stretched parent pins to the BOTTOM of that
      parent and never moves, which looks like the sticky silently failing.

      The left column sticks because the roster is unavoidably taller than the chart: thirty-two
      crests at four across is eight rows, and no amount of shrinking makes that shorter than a
      chart you can actually read. So the alternative is either a page you scroll half a season to
      get through, or a nested scrollbar on the roster. Pinning the chart means the price path stays
      on screen the whole way down the list, which is the thing you are reading the list FOR.

      ONLY THE CHART STICKS, AND THE DESK SITS OUTSIDE IT.

      The sticky wrapper used to be the whole left column. Adding the trading desk below the chart
      made that column taller than the viewport, and a sticky element taller than the viewport does
      not slide -- it simply sits there while its own overflow runs off the bottom. So the chart
      panel alone is wrapped, and the desk is a sibling below it. The desk is the thing you scroll
      TO, so pinning it would fight the reader.
    */
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
      <div className="lg:sticky lg:top-4">
      <Panel className="overflow-hidden">
        <PanelHeader
          title="The Exchange"
          tagline="powered by the Hanax Stock Exchange"
          leading={(
            /*
              THE HXSE WORDMARK, at 34px.

              The artwork is a shield ABOVE an "HXSE" lockup, so it cannot be sized like a crest. At
              26px -- the first guess -- the four letters were sub-pixel and the whole thing read as a
              grey smudge beside the title, which is worse than no mark at all. 34px is the smallest
              height at which the shield is unmistakably a shield AND the wordmark is still a
              wordmark. Sized by its own proportions with `w-auto` so it is never squeezed.
            */
            <img
              src={hxseMark}
              alt=""
              aria-hidden="true"
              className="h-[34px] w-auto shrink-0 object-contain"
            />
          )}
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
                onChange={(event) => chooseClub(event.target.value || null)}
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
            <div className="flex items-start gap-5">
              {/*
                THE CREST, 96px, and the league mark stands in for the league.

                On "All clubs (average)" there is no club to draw, and drawing no crest would leave the
                figure floating with nothing identifying what it is a price OF. The GPB mark is the
                league's own and is the honest stand-in: it says "this is the league", which is what the
                average is.

                THE TWO MARKS ARE NOT THE SAME SHAPE and the box has to admit that. A club crest is
                square and fills its box. `gpb.png` is 2560x1184 -- 2.16 wide -- so forced into a
                square it letterboxed down to about 22px of visible artwork in a 48px hole and read as
                a rendering fault rather than a logo. It is sized by HEIGHT alone and given its natural
                width, which is what actually matches the optical weight of the number beside it.

                96px rather than 400px is the correction the last pass asked for: the crest is how you
                recognise the club, and at four hundred it was the largest object on the page by a
                wide margin while the PRICE -- the thing the page is for -- sat underneath it in
                caption weight.
              */}
              {activeClub && teamById.has(activeClub) ? (
                <TeamLogo team={teamById.get(activeClub) as Team} sizeClass="w-24 h-24 shrink-0" />
              ) : (
                <img
                  src={gpbMark}
                  alt=""
                  aria-hidden="true"
                  className="h-16 w-auto shrink-0 object-contain"
                />
              )}

              {/*
                STACKED, NOT ONE WRAPPING ROW. The crest is 96px, the price is 56px, and there are five
                more figures behind them -- caption, date range, day count, premium, spread. On one
                `flex-wrap` baseline row they collide, and the row that wrapped put the crest on a
                line of its own like a section heading.

                Three lines by rank instead: what it costs, which club and over what window, then how
                it sits against fair and against the comparison. Each line is independently
                `flex-wrap`, so a long caption degrades to a second line of its own rather than
                shoving the crest out of place.

                `min-w-0` on the column so it can shrink inside the flex parent -- without it the
                widest child sets the intrinsic width and the whole column refuses to fit.
              */}
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="t-stat-xl text-[var(--color-ink)]">
                    {latest ? fmtPrice(latest.value) : '--'}
                  </span>
                  <span className="t-caption text-[var(--color-ink-dim)]">
                    {clubName ? `${clubName} share price` : 'average club price'}
                  </span>
                </div>

                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 t-caption text-[var(--color-ink-faint)]">
                  <span>
                    {first && latest ? `${first.date} to ${latest.date}` : ''}
                  </span>
                  <span>
                    {points.length} {points.length === 1 ? 'day' : 'days'}
                    {/*
                      WHY THE WINDOW IS SMALLER THAN THE BUTTON SAYS.

                      `points.length` alone is true but leaves a question: the reader pressed "30d" and
                      sees 14. Saying so costs one clause and pre-empts the reasonable suspicion that
                      the page silently truncated something.
                    */}
                    {rangeDays !== null && points.length < rangeDays
                      ? ` of the ${rangeDays}-day window`
                      : ''}
                    {(priceLedger?.length ?? 0) > points.length
                      ? ` · ${(priceLedger?.length ?? 0) - points.length} earlier not shown`
                      : ''}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  {/*
                    THE PREMIUM, and it only appears for a single club.

                    On the average it would be a real number and a useless one -- the mean of every
                    club's deviation is not a statement about anything, and showing it would invite the
                    reader to treat "the league is 2% rich" as a finding.

                    Teal, not green or orange. A deviation from fair is not an outcome: being 8% above
                    fair is neither good news nor bad news, it is expensive.
                  */}
                  {stray ? (
                    <span className="t-caption text-[var(--color-neutral)]">
                      {stray.fraction >= 0 ? '+' : ''}
                      {(stray.fraction * 100).toFixed(1)}% vs fair on {stray.date}
                    </span>
                  ) : null}

                  {/*
                    THE SPREAD, last day, beside the premium rather than replacing it. Both are "how
                    far from something" figures and they answer different questions -- one says whether
                    this club is expensive, the other says which of two clubs the market likes more.
                  */}
                  {spread !== null && latestCompare ? (
                    <span className="flex items-center gap-2">
                      {activeCompare && teamById.has(activeCompare) ? (
                        <TeamLogo team={teamById.get(activeCompare) as Team} sizeClass="w-5 h-5 shrink-0" />
                      ) : null}
                      <span className="t-caption text-[var(--color-ink-dim)]">
                        {/*
                      The direction is already in the words, so the figure is unsigned -- printing
                      "+$203.14 ahead of" states the sign twice and "$203.14 behind" would read as a
                      contradiction. `fmtPrice` on the absolute value keeps it to dollars and cents.
                    */}
                    {fmtPrice(Math.abs(spread))} {spread >= 0 ? 'ahead of' : 'behind'} {compareName}
                        {latest ? ` on ${latest.date}` : ''}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
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
              height={CHART_VIEW_HEIGHT}
              ceiling={axisCeiling}
              showBand
              /*
                480px, DOWN FROM 680px, AND THE REASON IS A MEASUREMENT OF THE DATA.

                680px was chosen so a typical day showed visible movement: the mean day-over-day move
                is 22.2 points and the largest is 107.1, which are 2.2% and 10.7% of the band. At the
                original 140px that was 3px and 15px -- a flat rule.

                But the same pass raised the axis to a 1300 ceiling, and that spent 23% of the height
                on headroom above a price nobody has reached. Measured across all 256 closes in a
                real save: prices run 249 to 993, the median is 485, and NOT ONE close has ever
                printed above 1000. So at 680px roughly 60% of the plot was carrying nothing.

                The band stays honest and the axis is NOT narrowed to buy the appearance back --
                `checkShareChart` check 2 exists precisely to stop that, since fitting a band to the
                data makes a quiet week look like a crash. Height is the only lever, because height
                costs no accuracy: 480px still renders the mean daily move at about 11px and the
                largest at about 52px, which reads as movement rather than as a rule.

                It also rebalances the page. The rail stands about 1400px tall; at 680px the left
                column overran it, and at 480px the two columns finish within about 100px.

                
              */
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
                    {fmtPrice(hovered.value)}
                  </span>
                  <span className="t-caption text-[var(--color-ink-faint)]">
                    {clubName ? `${clubName} close` : 'average close'}
                  </span>
                  {hoveredFair ? (
                    <>
                      <span className="t-caption text-[var(--color-neutral)]">
                        fair {fmtPrice(hoveredFair.value)}
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
                        {compareName} {fmtPrice(hoveredCompare.value)}
                      </span>
                      {hoveredSpread !== null ? (
                        <span className="t-caption text-[var(--color-ink-dim)]">
                          {fmtPrice(Math.abs(hoveredSpread))} gap
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

            {/*
              THE LEGEND, and it replaces the one-line caption rather than joining it.

              Three series can be on this chart and none of them was labelled: the close, the recorded
              fair layer, and the comparison club. "Which line is which" was genuinely answerable only
              by matching colours, and the fair line's teal is also the colour every premium figure on
              the page uses, so the swatch was doing double duty.

              Each entry is built from what is ACTUALLY DRAWN, so a legend can never list a series
              that is not there: no fair row without `hasFair`, no comparison row without
              `activeCompare`. The dashed swatches are drawn with the same dash pattern as the stroke
              they stand for, because a solid swatch next to a dashed line is a legend that lies about
              its own chart.
            */}
            <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-[3px] w-5"
                  style={{ background: 'var(--color-media-glorest)' }}
                />
                <span className="t-caption text-[var(--color-ink-dim)]">
                  {clubName ? `${clubName} close` : 'average club close'}
                </span>
              </span>

              {hasFair ? (
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-0 w-5 border-t-2 border-dashed"
                    style={{ borderColor: 'var(--color-neutral)' }}
                  />
                  <span className="t-caption text-[var(--color-ink-dim)]">
                    fair value, as recorded on the day
                    {fairDays < points.length
                      ? ` · ${points.length - fairDays} ${points.length - fairDays === 1 ? 'day' : 'days'} unrecorded, drawn as a break`
                      : ''}
                  </span>
                </span>
              ) : null}

              {activeCompare ? (
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="inline-block h-[2px] w-5"
                    style={{ background: 'var(--color-ink-faint)' }}
                  />
                  <span className="t-caption text-[var(--color-ink-dim)]">
                    {compareName} close
                  </span>
                </span>
              ) : null}

              {clubName && hasFair ? (
                <span className="t-caption text-[var(--color-ink-faint)]">
                  the gap between the two lines is this club&apos;s premium or discount
                </span>
              ) : null}
            </div>
          </div>
        )}
      </Panel>
      </div>

      {/*
        THE DESK, below the chart and inside the left column.

        It takes the chart's width rather than spanning the page because every number in it is
        about the club the chart is currently showing -- its price, its cap, whether you hold it.
        A full-width strip would put the trade buttons a thousand pixels from the line they price.

        `latestCloses` is the LAST day's closes, not the visible range's, because a mark has to be
        against the most recent price the market actually printed. Marking against the last day of a
        shortened window would revalue the book to a stale close the moment the range narrowed.
      */}
      <ExchangeDesk
        teams={teams}
        closes={latestCloses}
        markedOn={latestDate}
        selectedClub={activeClub}
      />
      </div>

      {/* The roster rail. Beside the chart on wide screens, below it on narrow ones. */}
      <div className="flex flex-col gap-5 lg:col-span-1">

      {/*
        THE BOARD.

        Thirty-two crests at 400px is not a gallery of pictures, it is the league's price list, and
        it is built as one: every tile carries the club's latest close, the day it was taken, and its
        distance from its own recorded fair value, ranked by price. A grid of logos with no numbers
        would be wallpaper; the numbers are the reason to look at it.

        CLICKING A TILE SELECTS THAT CLUB, reusing the selection the chart already has. One selection
        model for the whole page means the chart, the crest in the headline, the fair line and these
        tiles can never disagree about which club is being looked at.

        LAZY, and it is not optional at this size. The sources run from 500px to 5016px square; a
        single 5016px PNG decodes to roughly 100 MB of bitmap, so thirty-two eagerly decoded is a tab
        that dies rather than a page that is slow. `loading="lazy"` keeps only the tiles near the
        viewport resident, which is what makes 400px affordable at all.

        `min-w-0` on the tile so the price figures cannot force the grid wider than its columns, and
        `overflow-hidden` on the crest box because several of these logos are square artwork with
        detail that runs to the very edge.
      */}
      {board.length > 0 ? (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="All clubs"
            tagline={`${board.length} listed, ranked by price`}
            leading={(
              <img
                src={gpbMark}
                alt=""
                aria-hidden="true"
                className="h-[26px] w-auto shrink-0 object-contain"
              />
            )}
          />
<div className="grid grid-cols-4 gap-2 px-3 py-3">
            {board.map((row, index) => {
              const isPrimary = row.team.id === activeClub;
              const isCompare = row.team.id === activeCompare;
              return (
                <button
                  key={row.team.id}
                  type="button"
                  onClick={() => chooseClub(isPrimary ? null : row.team.id)}
                  aria-pressed={isPrimary}
                  className={[
                    'group relative flex min-w-0 flex-col items-center gap-1 rounded p-1.5 text-center transition-colors',
                    'border',
                    isPrimary
                      ? 'border-[var(--color-neutral)] bg-[var(--color-panel-2)]'
                      : isCompare
                        ? 'border-[var(--color-chrome-mid)] bg-[var(--color-panel-2)]'
                        : 'border-[var(--color-chrome-lo)] bg-[var(--color-panel)] hover:border-[var(--color-chrome-mid)] hover:bg-[var(--color-panel-2)]',
                  ].join(' ')}
                >
                  {/*
                    THE RANK, because the board is sorted by price and nothing else on the tile says
                    so. A reader who wants "who is on top" should not have to infer it from reading
                    order, and a number is quieter than a "1st" badge.

                    Teal rather than gold: nothing here is a winner, it is a position in a price list.
                  */}
                  <span className="absolute left-1.5 top-1 t-caption text-[var(--color-ink-faint)]">
                    {index + 1}
                  </span>
                  {isCompare ? (
                    <span className="absolute right-1.5 top-1 t-caption text-[var(--color-ink-dim)]">
                      vs
                    </span>
                  ) : null}

                  {/*
                    THE CREST, IN AN INSET WELL.

                    The wells exist because the source artwork is inconsistent: some crests are drawn to
                    fill their square and some carry wide transparent margins, so at a fixed 400px box
                    one club fills it and the next floats in the middle of a hole twice its size. A
                    shared, slightly recessed well gives all thirty-two the same visual ground, and
                    the difference you see left over is the difference in the ART rather than in the
                    padding somebody happened to export.
                  */}
                  <span className="flex w-full items-center justify-center rounded bg-[var(--color-base-2)] p-1"
                    style={{ border: '1px solid var(--color-chrome-lo)' }}>
                    <TeamLogo
                      team={row.team}
                      sizeClass="w-full h-[72px] overflow-hidden"
                      lazy
                    />
                  </span>

                  {/*
                    NAME AND PRICE, STACKED AND TRUNCATED, because at four across there is about 88px
                    of cell and a full "Alcondale Aerials" does not fit on one line at any readable
                    size. The MASCOT alone is the distinctive part -- the city is shared vocabulary
                    for anyone who knows the league -- so that is what leads, and the title attribute
                    carries the full name for hover and for a screen reader.
                  */}
                  <span className="w-full min-w-0 truncate t-caption text-[var(--color-ink)]" title={`${row.team.city} ${row.team.name}`}>
                    {row.team.name}
                  </span>
                  <span className="t-stat-sm text-[var(--color-ink)]">
                    {fmtPrice(row.price)}
                  </span>

                  {/*
                    THE PREMIUM, kept because it is the one number on this page that is not a price.
                    Bare signed percentage rather than a bordered chip: at 88px wide a chip around
                    "+36.8% vs fair" wraps, and thirty-two wrapping tiles is the busy layout this rail
                    exists to avoid. The colour still carries the meaning -- teal, never green or
                    orange, because a premium is an expense rather than an outcome.
                  */}
                  {row.stray !== null ? (
                    /*
                      RED FOR A DISCOUNT, TEAL FOR A PREMIUM.

                      This is the one place on the page where a signed figure is coloured by its sign,
                      and it is the trading convention rather than the app's: a club priced below its
                      own fair value is the losing side of the trade and reads as such at a glance
                      across thirty-two tiles. Teal is the neutral and stays on the positive side --
                      which also keeps the premium's colour meaning the same thing here as it does in
                      the headline and the hover readout.

                      It is deliberately NOT green. Green plus teal plus red across one screen is three
                      colours carrying two meanings, and green would read as "good" on a figure whose
                      whole content is that the club is expensive.
                    */
                    <span className={`t-caption ${row.stray < 0 ? 'text-[var(--color-media-glorest)]' : 'text-[var(--color-neutral)]'}`}>
                      {row.stray >= 0 ? '+' : ''}
                      {(row.stray * 100).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="t-caption text-[var(--color-ink-faint)]">&mdash;</span>
                  )}
                </button>
              );
            })}
          </div>
        </Panel>
      ) : null}
      </div>
    </div>
  );
};
