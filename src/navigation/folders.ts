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

/** Complete navigation tree — single source of truth */
export const NAV_FOLDERS: NavFolder[] = [
  {
    id: 'home',
    label: 'HOME',
    icon: LayoutDashboard,
    leaves: [
      { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
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
    id: 'commissioner',
    label: 'COMMISSIONER',
    icon: Activity,
    accent: 'gold',
    leaves: [
      { view: 'simulation', label: 'Simulate', icon: Activity },
      { view: 'offseason', label: 'Offseason', icon: CalendarRange },
      { view: 'trades', label: 'Trades', icon: ArrowLeftRight },
      { view: 'free_agency', label: 'Free Agents', icon: BriefcaseBusiness },
      { view: 'draft', label: 'Draft', icon: Clock3 },
      { view: 'lottery', label: 'Lottery', icon: Shuffle },
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
