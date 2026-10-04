import type { FieldMarket } from '../../lib/markets';

/**
 * The Season Futures tab model.
 *
 * WHY TABS AND NOT SECTIONS
 *
 * The futures tab concatenates eleven markets into one flat array: one championship, two league
 * races and eight division races. `FieldMarketsView` already buckets those into three labelled
 * sections, which fixed the "a league title looks like a division title" complaint -- but it left
 * the eight division races stacked in a single section. A manager who wants the North race has to
 * scroll past seven others to reach it.
 *
 * Tabs are the right shape here because every one of the eleven markets is the SAME KIND OF THING
 * with a different subject. There is nothing to compare across them and nothing to group. One
 * market per tab is the exact fit, and it means a race is never more than one click away no matter
 * how far down the old list it sat.
 *
 * WHY THE ORDER IS FIXED RATHER THAN DERIVED
 *
 * The input array arrives in whatever order `BettingPage` concatenated the three builders, and the
 * league race order follows object key iteration rather than a decision. Sorting here instead means
 * the tab strip reads the same on every load: the broadest competition first, then each league,
 * then that league's divisions in a fixed compass order. A tab strip whose contents reshuffle
 * between renders is a tab strip you cannot learn.
 */

/** The four divisions, in the order they appear on a tab strip. */
const DIVISION_ORDER: ReadonlyArray<FieldMarket['outcomes'][number] extends never ? never : string> = [
  'North',
  'South',
  'East',
  'West',
];

/** League races, broadest-reading league first. */
const LEAGUE_ORDER = ['Platinum', 'Prestige'] as const;

/**
 * One tab, and the single market it shows.
 *
 * `market` is carried rather than looked up by id so a tab can never point at a market that is not
 * in the array it was built from.
 */
export interface FutureTab {
  /** Stable across renders, and safe as a React key and a DOM id. */
  id: string;
  /** Full label. Used wherever there is room. */
  label: string;
  /** Compact label for narrow widths. */
  short: string;
  /** Which competition this tab represents, for grouping and copy. */
  kind: FieldMarket['kind'];
  market: FieldMarket;
}

/**
 * The championship tab's label.
 *
 * The market's own title is "Championship Winner", which reads as a heading rather than as a tab.
 * A tab strip wants the subject, not the proposition.
 */
const CHAMPIONSHIP_LABEL = 'World Series';

/** "Platinum League" reads as a heading; "Platinum Champion" reads as a tab. */
const leagueLabel = (league: string): string => `${league} Champion`;

/**
 * Division order within a market title.
 *
 * `buildDivisionMarkets` titles these `${league} ${division}`, so the division name is the last
 * token. Splitting on the last space rather than on a fixed offset keeps this correct if a league
 * name ever gains a space.
 */
const divisionOf = (title: string): string => {
  const lastSpace = title.lastIndexOf(' ');
  return lastSpace === -1 ? '' : title.slice(lastSpace + 1);
};

/** Stable position of a division on the strip, or a large number so unknown titles sort last. */
const divisionRank = (title: string): number => {
  const index = DIVISION_ORDER.indexOf(divisionOf(title));
  return index === -1 ? DIVISION_ORDER.length : index;
};

export const buildFutureTabs = (markets: readonly FieldMarket[]): FutureTab[] => {
  const championship = markets.filter((market) => market.kind === 'world_series');
  const leagues = markets.filter((market) => market.kind === 'league');
  const divisions = markets.filter((market) => market.kind === 'division');

  // Anything that is not one of the three futures kinds is not a futures tab. Awards and moneylines
  // share the FieldMarket type with this board, so filtering by kind is what keeps them off.
  const toTab = (market: FieldMarket, id: string, label: string, short: string): FutureTab => ({
    id,
    label,
    short,
    kind: market.kind,
    market,
  });

  const championshipTabs = championship.map((market) =>
    toTab(market, 'world_series', CHAMPIONSHIP_LABEL, 'WS'),
  );

  const leagueTabs = [...leagues]
    .sort((left, right) => {
      const leftRank = LEAGUE_ORDER.indexOf(left.title.split(' ')[0] as (typeof LEAGUE_ORDER)[number]);
      const rightRank = LEAGUE_ORDER.indexOf(right.title.split(' ')[0] as (typeof LEAGUE_ORDER)[number]);
      if (leftRank !== rightRank) return (leftRank === -1 ? LEAGUE_ORDER.length : leftRank)
        - (rightRank === -1 ? LEAGUE_ORDER.length : rightRank);
      return left.title.localeCompare(right.title);
    })
    .map((market) => {
      const league = market.title.split(' ')[0];
      return toTab(market, `league:${league}`, leagueLabel(league), league.slice(0, 4));
    });

  const divisionTabs = [...divisions]
    .sort((left, right) => {
      const leftLeague = left.title.split(' ')[0];
      const rightLeague = right.title.split(' ')[0];
      const leftRank = LEAGUE_ORDER.indexOf(leftLeague as (typeof LEAGUE_ORDER)[number]);
      const rightRank = LEAGUE_ORDER.indexOf(rightLeague as (typeof LEAGUE_ORDER)[number]);
      if (leftRank !== rightRank) return (leftRank === -1 ? LEAGUE_ORDER.length : leftRank)
        - (rightRank === -1 ? LEAGUE_ORDER.length : rightRank);
      const byDivision = divisionRank(left.title) - divisionRank(right.title);
      if (byDivision !== 0) return byDivision;
      return left.title.localeCompare(right.title);
    })
    .map((market) => toTab(market, `division:${market.title}`, market.title, divisionOf(market.title)));

  return [...championshipTabs, ...leagueTabs, ...divisionTabs];
};

/**
 * The tab that should open selected.
 *
 * The championship when there is one, because it is the broadest question on the board and it is
 * the only market that spans both leagues. Otherwise the first league race, then the first
 * division -- which is the same order the strip itself renders in.
 */
export const defaultFutureTabId = (tabs: readonly FutureTab[]): string | null =>
  tabs[0]?.id ?? null;