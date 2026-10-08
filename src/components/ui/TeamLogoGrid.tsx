import React, { useEffect, useMemo } from 'react';
import { Team } from '../../types';
import { TeamLogo } from './TeamLogo';

const DIVISION_ORDER: Team['division'][] = ['North', 'South', 'East', 'West'];
const LEAGUE_ORDER: Team['league'][] = ['Platinum', 'Prestige'];

interface TeamLogoGridProps {
  teams: Team[];
  isOpen: boolean;
  onClose: () => void;
  onSelectTeam: (teamId: string) => void;
}

export const TeamLogoGrid: React.FC<TeamLogoGridProps> = ({
  teams,
  isOpen,
  onClose,
  onSelectTeam,
}) => {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Sort teams: Platinum first (by division), then Prestige (by division)
  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      const leagueA = LEAGUE_ORDER.indexOf(a.league);
      const leagueB = LEAGUE_ORDER.indexOf(b.league);
      if (leagueA !== leagueB) return leagueA - leagueB;
      const divA = DIVISION_ORDER.indexOf(a.division);
      const divB = DIVISION_ORDER.indexOf(b.division);
      if (divA !== divB) return divA - divB;
      return a.city.localeCompare(b.city);
    });
  }, [teams]);

  // Split into Platinum (left 4 cols) and Prestige (right 4 cols)
  const platinumTeams = sortedTeams.filter((t) => t.league === 'Platinum');
  const prestigeTeams = sortedTeams.filter((t) => t.league === 'Prestige');

  const renderTeam = (team: Team) => {
    const isPlatinum = team.league === 'Platinum';
    const glowColor = isPlatinum
      ? 'rgba(23,182,144,0.6)'    // --color-platinum
      : 'rgba(200,166,94,0.6)';    // --color-prestige
    const focusRingColor = isPlatinum
      ? 'var(--color-platinum)'
      : 'var(--color-prestige)';

    return (
      <button
        key={team.id}
        type="button"
        onClick={() => {
          onSelectTeam(team.id);
          onClose();
        }}
        className="group aspect-square relative hover:scale-[1.05] transition-transform duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)]"
        style={{ '--focus-ring': focusRingColor } as React.CSSProperties}
        aria-label={`${team.city} ${team.name}`}
      >
        <div
          className="h-full w-full drop-shadow-[0_0_0_transparent] group-hover:drop-shadow-[0_0_24px_var(--glow)] transition-all duration-300"
          style={{ '--glow': glowColor } as React.CSSProperties}
        >
          <TeamLogo team={team} sizeClass="h-full w-full" lazy />
        </div>
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Select a team"
    >
      {/* Darkened backdrop */}
      <div
        className="absolute inset-0 bg-[var(--color-void)]/90 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* ESC hint */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none">
        <kbd className="px-2 py-1 text-[10px] font-mono text-[var(--color-ink-faint)] bg-[var(--color-panel)] border border-[var(--color-chrome-lo)] rounded">
          ESC
        </kbd>
      </div>

      {/* Logo grid */}
      <div className="relative z-10 w-full max-w-6xl px-4">
        <div className="grid grid-cols-8 gap-4">
          {/* Platinum: left 4 columns */}
          {platinumTeams.map(renderTeam)}
          {/* Prestige: right 4 columns */}
          {prestigeTeams.map(renderTeam)}
        </div>
      </div>
    </div>
  );
};
