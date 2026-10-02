/**
 * GPB MyLeague — Navigation Folder Configuration
 *
 * 19 flat AppView values → 7 hierarchical folders.
 * Two levels maximum. The entire map is always visible.
 *
 * §7.1 Target Model:
 * PLAY → SCORES → LEAGUE → TEAMS → PLAYOFFS → COMMISSIONER → SYSTEM
 */

import type { ComponentType } from 'react';
import type { AppView } from '../types';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  Clock3,
  LayoutDashboard,
  Map as MapIcon,
  Megaphone,
  Play,
  Receipt,
  ScrollText,
  Settings,
  Shuffle,
  Table2,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';

/** Folder identifier — not a destination itself */
export type FolderId =
  | 'play'
  | 'scores'
  | 'league'
  | 'teams'
  | 'playoffs'
  | 'commissioner'
  | 'system';

/** Leaf navigation item — maps 1:1 to an AppView */
export interface NavLeaf {
  view: AppView;
  label: string;
  mobileLabel?: string;
  icon: ComponentType<{ className?: string }>;
}

/** Folder containing leaves — not a destination */
export interface NavFolder {
  id: FolderId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  leaves: NavLeaf[];
  /** COMMISSIONER gets gold edge accent to signal weight */
  accent?: 'gold';
}

/**
 * Complete navigation tree — single source of truth.
 *
 * Order is by how often the folder is opened, not by theme. COMMISSIONER moved
 * up to second because it holds Simulate, which is a daily action, and it used
 * to sit sixth of seven where it was genuinely hard to find -- the user had to
 * scroll the rail to reach the screen they use every day. SYSTEM goes last
 * because the engine book, the logs and settings are all occasional.
 */
export const NAV_FOLDERS: NavFolder[] = [
  {
    /*
     * PLAY, and it holds the three screens you READ rather than the ones you administer.
     *
     * The user asked for Dashboard, Media and MacroBet together, which is the right grouping
     * even before the renaming: all three are the surfaces that tell you something about the
     * league without asking you to do anything -- your own summary, the press's read, and the
     * market's. Everything that asks a manager to ACT is in COMMISSIONER, and everything that
     * records what happened is in LEAGUE. The line is "read / do / record".
     *
     * Media and MacroBet used to sit in LEAGUE beside the standings and the map, and that was
     * the wrong company: a forecaster's opinion and a price are not properties of the
     * competition, they are things people are telling you about it.
     *
     * The identifier was renamed 'home' -> 'play' to match, rather than leaving a folder called
     * PLAY with an id of 'home'. Nothing persists the id -- `expandedFolders` is React state
     * seeded from the active view, and `VIEW_TO_FOLDER` is a compile-time record -- so the
     * rename costs nothing at runtime.
     *
     * ICON: `Play`, which also removes a duplication. The folder was `LayoutDashboard` and so
     * was its only leaf called Dashboard, so the rail showed the same glyph twice in a row,
     * which reads as a rendering fault rather than a hierarchy.
     */
    id: 'play',
    label: 'PLAY',
    icon: Play,
    leaves: [
      { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { view: 'media', label: 'The Media', icon: Megaphone, mobileLabel: 'Media' },
      /*
        MACROBET, not "Betting".

        The page renamed itself, and the nav is how a manager gets there -- a leaf still
        reading "Betting" beside a screen headed with the MacroBet wordmark is two names for
        one destination. `mobileLabel` is left short because the leaf also renders in the
        mobile rail where eight characters is what fits.
      */
      { view: 'betting', label: 'MacroBet', icon: Receipt, mobileLabel: 'MacroBet' },
    /*
      THE HXSE, next to MacroBet and not inside it.

      MacroBet stacks four sub-views already -- slate, props, futures, awards -- and every one of
      them is something you can stake on. A share price is not a stake; it is the thing being
      priced. Putting this page under MacroBet would have made the market a tab of the bookmaker,
      which is the wrong relationship between the two: the bookmaker quotes the exchange.

      `mobileLabel` is 'HXSE' because the mobile rail is narrow and "Exchange" is nine characters.
      The two names are for the same place and the full one is on the desktop leaf.
    */
    { view: 'exchange', label: 'Exchange', icon: ArrowLeftRight, mobileLabel: 'HXSE' },
    ],
  },
  {
    id: 'commissioner',
    label: 'COMMISSIONER',
    icon: Activity,
    accent: 'gold',
    leaves: [
      { view: 'simulation', label: 'Simulate', icon: Activity },
      { view: 'trades', label: 'Trades', icon: ArrowLeftRight },
      { view: 'free_agency', label: 'Free Agents', icon: BriefcaseBusiness },
      { view: 'draft', label: 'Draft', icon: Clock3 },
      { view: 'lottery', label: 'Lottery', icon: Shuffle },
      /*
        OFFSEASON, and it is here now because it is a set of ACTIONS.

        It used to sit under HOME with a comment arguing that a locked phase is still
        something a manager wants to look at and plan towards. That reasoning was sound and the
        user has overridden it anyway, which is their right: offseason is a calendar of things
        you DO -- the draft, free agency, the roster moves -- and putting it with the screens
        you merely read dilutes that. It also sits next to Draft and Lottery, which are the
        other two places a manager goes to pull a lever on a rebuild.
      */
      { view: 'offseason', label: 'Offseason', icon: CalendarRange },
    ],
  },
  {
    id: 'scores',
    label: 'SCORES',
    icon: CalendarDays,
    leaves: [
      { view: 'games_schedule', label: 'Scores', icon: CalendarDays },
      { view: 'team_calendar', label: 'Schedule', icon: CalendarRange },
    ],
  },
  {
    /*
     * LEAGUE is now only what the RECORD says.
     *
     * Standings, leaders, history and the map are all facts about the competition. Media and
     * MacroBet moved out to PLAY, which leaves this folder coherent: nothing here is anybody's
     * opinion, and nothing here can be acted on.
     */
    id: 'league',
    label: 'LEAGUE',
    icon: Table2,
    leaves: [
      { view: 'league_standings', label: 'Standings', icon: Table2 },
      { view: 'leaders', label: 'Leaders', icon: BarChart3 },
      { view: 'history', label: 'History', icon: ScrollText },
      { view: 'map', label: 'Map', icon: MapIcon },
    ],
  },
  {
    id: 'teams',
    label: 'TEAMS',
    icon: Users,
    leaves: [
      { view: 'teams', label: 'Rosters', icon: Users },
      { view: 'players', label: 'Players', icon: UserRound },
    ],
  },
  {
    id: 'playoffs',
    label: 'PLAYOFFS',
    icon: Trophy,
    leaves: [
      { view: 'playoffs', label: 'Bracket', icon: Trophy },
    ],
  },
  {
    id: 'system',
    label: 'SYSTEM',
    icon: Settings,
    leaves: [
      { view: 'gpb_book', label: 'GPB Engine', icon: BookOpen, mobileLabel: 'Engine' },
      { view: 'notifications', label: 'System Logs', icon: Bell, mobileLabel: 'Logs' },
      { view: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

/** Flat array of all leaves for quick lookups */
export const ALL_LEAVES: NavLeaf[] = NAV_FOLDERS.flatMap((f) => f.leaves);

/** Reverse lookup: AppView → FolderId */
export const VIEW_TO_FOLDER: Record<AppView, FolderId> = {
  /*
   * The record has no leaf on purpose.
   *
   * VIEW_TO_FOLDER only decides which folder auto-expands, so naming the folder
   * here is enough to make the rail behave if the view is ever set directly --
   * while the absence of an entry in the `leaves` array above is what keeps the
   * button off the screen. The record is reached from the slip and nowhere
   * else, so a screen most managers open twice a season does not get a
   * permanent place in a twenty-item sidebar.
   *
   * It points at `play` rather than `league` because it is part of MacroBet, which
   * moved. Setting the view directly used to be a guess about which folder would
   * open; it should follow the screen it belongs to.
   */
  betting_record: 'play',
  dashboard: 'play',
  media: 'play',
  betting: 'play',
  exchange: 'play',
  games_schedule: 'scores',
  team_calendar: 'scores',
  league_standings: 'league',
  leaders: 'league',
  leaders_dashboards: 'league',
  history: 'league',
  map: 'league',
  teams: 'teams',
  players: 'teams',
  playoffs: 'playoffs',
  simulation: 'commissioner',
  offseason: 'commissioner',
  trades: 'commissioner',
  free_agency: 'commissioner',
  draft: 'commissioner',
  lottery: 'commissioner',
  gpb_book: 'system',
  notifications: 'system',
  settings: 'system',
  game_screen: 'commissioner', // unrouted sub-view, grouped with commissioner tools
  ui_kit: 'system', // development-only route, deliberately excluded from navigation
};

/** Folder order for rendering */
export const FOLDER_ORDER: FolderId[] = [
  'play',
  'scores',
  'league',
  'teams',
  'playoffs',
  'commissioner',
  'system',
];
