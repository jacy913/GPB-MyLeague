import React from 'react';
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
  type LucideIcon,
} from 'lucide-react';

export type AppView =
  | 'dashboard'
  | 'games_schedule'
  | 'team_calendar'
  | 'simulation'
  | 'league_standings'
  | 'leaders'
  | 'history'
  | 'teams'
  | 'players'
  | 'trades'
  | 'lottery'
  | 'draft'
  | 'map'
  | 'free_agency'
  | 'playoffs'
  | 'gpb_book'
  | 'notifications'
  | 'settings'
  | 'game_screen';

interface NavigationItem {
  view: AppView;
  label: string;
  mobileLabel?: string;
  icon: LucideIcon;
  desktopActiveClass: string;
  mobileActiveClass: string;
  onClickAction?: 'random_team';
}

interface MainNavigationProps {
  view: AppView;
  onSetView: (nextView: AppView) => void;
  onOpenRandomTeamPage: () => void;
}

const DESKTOP_BASE_CLASS =
  'w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left transition-colors';
const DESKTOP_INACTIVE_CLASS = 'bg-[#1e1e1e] text-zinc-300 hover:bg-[#282828]';

const MOBILE_BASE_CLASS =
  'px-3 py-2 rounded-lg text-sm font-display uppercase tracking-wide';
const MOBILE_INACTIVE_CLASS = 'bg-[#202020] text-zinc-300';

const NAV_ITEMS: NavigationItem[] = [
  {
    view: 'dashboard',
    label: 'Home',
    icon: LayoutDashboard,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'games_schedule',
    label: 'Scores',
    icon: CalendarDays,
    desktopActiveClass: 'bg-prestige text-black',
    mobileActiveClass: 'bg-prestige text-black',
  },
  {
    view: 'league_standings',
    label: 'Standings',
    icon: Table2,
    desktopActiveClass: 'bg-platinum text-black',
    mobileActiveClass: 'bg-platinum text-black',
  },
  {
    view: 'team_calendar',
    label: 'Schedule',
    icon: CalendarRange,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'simulation',
    label: 'Simulate',
    icon: Activity,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'playoffs',
    label: 'Playoffs',
    icon: Trophy,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'teams',
    label: 'Rosters',
    icon: Users,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
    onClickAction: 'random_team',
  },
  {
    view: 'players',
    label: 'Players',
    icon: UserRound,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'free_agency',
    label: 'Free Agents',
    icon: BriefcaseBusiness,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'trades',
    label: 'Trades',
    icon: ArrowLeftRight,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'leaders',
    label: 'Leaders',
    icon: BarChart3,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'history',
    label: 'History',
    icon: ScrollText,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'lottery',
    label: 'Lottery',
    icon: Shuffle,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'draft',
    label: 'Draft',
    icon: Clock3,
    desktopActiveClass: 'bg-[#d4bb6a] text-black',
    mobileActiveClass: 'bg-[#d4bb6a] text-black',
  },
  {
    view: 'map',
    label: 'Map',
    icon: MapIcon,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'gpb_book',
    label: 'GPB Engine',
    mobileLabel: 'Engine',
    icon: BookOpen,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'notifications',
    label: 'System Logs',
    mobileLabel: 'Logs',
    icon: Bell,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
  {
    view: 'settings',
    label: 'Settings',
    icon: Settings,
    desktopActiveClass: 'bg-white text-black',
    mobileActiveClass: 'bg-white text-black',
  },
];

export const MainNavigation: React.FC<MainNavigationProps> = ({
  view,
  onSetView,
  onOpenRandomTeamPage,
}) => {
  const runItemAction = (item: NavigationItem) => {
    if (item.onClickAction === 'random_team') {
      onOpenRandomTeamPage();
      return;
    }
    onSetView(item.view);
  };

  return (
    <>
      <aside className="hidden lg:block w-64 border-r border-white/10 bg-[#161616]/80 backdrop-blur sticky top-[136px] h-[calc(100vh-136px)]">
        <div className="p-4 space-y-2">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.view === view;
            return (
              <button
                key={item.view}
                onClick={() => runItemAction(item)}
                className={`${DESKTOP_BASE_CLASS} ${isActive ? item.desktopActiveClass : DESKTOP_INACTIVE_CLASS}`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-display text-lg uppercase tracking-wide">{item.label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="lg:hidden grid grid-cols-2 gap-2 mb-6">
        {NAV_ITEMS.map((item) => {
          const isActive = item.view === view;
          return (
            <button
              key={`mobile-${item.view}`}
              onClick={() => runItemAction(item)}
              className={`${MOBILE_BASE_CLASS} ${isActive ? item.mobileActiveClass : MOBILE_INACTIVE_CLASS}`}
            >
              {item.mobileLabel ?? item.label}
            </button>
          );
        })}
      </div>
    </>
  );
};
