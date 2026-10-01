/**
 * GPB MyLeague — Navigation Folder Configuration
 *
 * 19 flat AppView values → 7 hierarchical folders.
 * Two levels maximum. The entire map is always visible.
 *
 * §7.1 Target Model:
 * HOME → SCORES → LEAGUE → TEAMS → PLAYOFFS → COMMISSIONER → SYSTEM
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
  | 'home'
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
    id: 'home',
    label: 'HOME',
    icon: LayoutDashboard,
    leaves: [
      { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      // Offseason lives here whether or not it is unlocked. The user asked for
      // it under Home on the grounds that a locked phase is still something a
      // manager wants to look at and plan towards, rather than a destination
      // that should be hidden until the calendar happens to reach it.
      { view: 'offseason', label: 'Offseason', icon: CalendarRange },
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
    id: 'league',
    label: 'LEAGUE',
    icon: Table2,
    leaves: [
      { view: 'league_standings', label: 'Standings', icon: Table2 },
      { view: 'leaders', label: 'Leaders', icon: BarChart3 },
      { view: 'history', label: 'History', icon: ScrollText },
      { view: 'media', label: 'The Media', icon: Megaphone, mobileLabel: 'Media' },
      /*
        MACROBET, not "Betting".

        The page renamed itself, and the nav is how a manager gets there -- a leaf still
        reading "Betting" beside a screen headed with the MacroBet wordmark is two names for
        one destination. `mobileLabel` is left short because the leaf also renders in the
        mobile rail where eight characters is what fits.
      */
      { view: 'betting', label: 'MacroBet', icon: Receipt, mobileLabel: 'MacroBet' },
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
  dashboard: 'home',
  games_schedule: 'scores',
  team_calendar: 'scores',
  league_standings: 'league',
  leaders: 'league',
  history: 'league',
  media: 'league',
  betting: 'league',
  /*
   * The record has no leaf on purpose.
   *
   * VIEW_TO_FOLDER only decides which folder auto-expands, so naming the folder
   * here is enough to make the rail behave if the view is ever set directly --
   * while the absence of an entry in the `leaves` array above is what keeps the
   * button off the screen. The record is reached from the slip and nowhere
   * else, so a screen most managers open twice a season does not get a
   * permanent place in a twenty-item sidebar.
   */
  betting_record: 'league',
  leaders_dashboards: 'league',
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
  'home',
  'scores',
  'league',
  'teams',
  'playoffs',
  'commissioner',
  'system',
];
