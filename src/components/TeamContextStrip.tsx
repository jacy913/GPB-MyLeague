import React from 'react';
import type { Team } from '../types';
import { fmtRecord } from '../logic/statFormatting';
import { LeagueBadge, StatValue } from './ui';
import { TeamLogo } from './TeamLogo';

interface TeamContextStripProps {
  team: Team | null;
  onOpenTeam: () => void;
}

/** Persistent shell-level reminder of the club currently in focus. */
export const TeamContextStrip: React.FC<TeamContextStripProps> = ({ team, onOpenTeam }) => {
  if (!team) {
    return (
      <div className="border-b border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-4 py-2 sm:px-6 lg:px-8">
        <p className="t-caption text-[var(--color-ink-dim)]">No team selected</p>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-4 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenTeam}
        className="flex min-h-10 w-full items-center gap-3 py-1 text-left hover:bg-[var(--color-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-void)]"
        aria-label={`Open ${team.city} ${team.name} roster`}
      >
        <TeamLogo team={team} sizeClass="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <span className="block t-caption text-[var(--color-ink-faint)]">Selected team</span>
          <span className="block truncate t-h3 text-[var(--color-ink)]">{team.city} {team.name}</span>
        </div>
        <LeagueBadge variant={team.league.toLowerCase() as 'prestige' | 'platinum'} size="sm" className="hidden sm:inline-flex" />
        <div className="hidden items-baseline gap-2 sm:flex">
          <span className="t-caption text-[var(--color-ink-faint)]">RECORD</span>
          <StatValue size="sm">{fmtRecord(team.wins, team.losses)}</StatValue>
        </div>
        <div className="hidden items-baseline gap-2 md:flex">
          <span className="t-caption text-[var(--color-ink-faint)]">RATING</span>
          <StatValue size="sm" variant="accent">{team.rating}</StatValue>
        </div>
      </button>
    </div>
  );
};
