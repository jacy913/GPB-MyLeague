import React, { useEffect } from 'react';
import { Team } from '../../types';
import { TeamLogo } from './TeamLogo';

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
      <div className="relative z-10 w-full max-w-5xl px-4">
        <div className="grid grid-cols-8 gap-3">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                onSelectTeam(team.id);
                onClose();
              }}
              className="group aspect-square relative bg-[var(--color-panel)] border border-[var(--color-chrome-lo)] rounded-[var(--radius-panel)] hover:border-[var(--color-gold)] hover:shadow-[var(--shadow-bev-lg)] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
              aria-label={`${team.city} ${team.name}`}
            >
              <TeamLogo team={team} sizeClass="h-full w-full" />
              {/* Subtle gold accent on hover */}
              <div className="absolute inset-0 border-2 border-transparent rounded-[var(--radius-panel)] group-hover:border-[var(--color-gold)] transition-colors pointer-events-none" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
