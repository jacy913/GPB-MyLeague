import React from 'react';
import type { Team } from '../../types';
import { fmtDiff, fmtPct, fmtRecord } from '../../logic/statFormatting';
import { TeamLogo } from './TeamLogo';
import { StatValue } from './StatValue';

export interface MatchupStripProps {
  away: Team | null;
  home: Team | null;
  /** Rendered above both sides. Optional. */
  label?: string;
  /** 'h' for heroes and the bracket, 'md' for dense list rows. */
  scale?: 'sm' | 'md' | 'h';
  className?: string;
}

/**
 * Crests run about a third larger than they did. They are the one piece of
 * artwork in the product and they were being reduced to 24px role-player in
 * dense rows, which is too small to read as a mark. sm stays under the 44px
 * default row height so a crest in a table never crowds its own row.
 */
const scales = {
  sm: { logo: 'h-8 w-8', city: 't-stat-sm', team: 't-caption', record: 't-caption' },
  md: { logo: 'h-12 w-12', city: 't-h3', team: 't-caption', record: 't-stat-sm' },
  h: { logo: 'h-20 w-20', city: 't-h2', team: 't-h3', record: 't-stat' },
} as const;

/**
 * MatchupStrip — two clubs, their records, and the run differential between
 * them. Appears on the front page, the playoff bracket and the score schedule,
 * which is why it is a primitive rather than three similar blocks.
 */
export const MatchupStrip: React.FC<MatchupStripProps> = ({ away, home, label, scale = 'md', className = '' }) => {
  const s = scales[scale];

  const side = (team: Team | null, align: 'left' | 'right') => {
    if (!team) {
      return (
        <div className={`flex min-w-0 flex-1 flex-col gap-1 ${align === 'right' ? 'items-end text-right' : 'items-start'}`}>
          <span className="h-10 w-10 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />
          <span className="t-caption text-[var(--color-ink-faint)]">TBD</span>
        </div>
      );
    }
    const diff = team.runsScored - team.runsAllowed;
    return (
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${align === 'right' ? 'items-end text-right' : 'items-start'}`}>
        <TeamLogo team={team} sizeClass={s.logo} />
        <p className={`${s.city} truncate ${align === 'right' ? 'text-right' : ''}`}>{team.city}</p>
        <p className={`${s.team} truncate text-[var(--color-ink-dim)] ${align === 'right' ? 'text-right' : ''}`}>{team.name}</p>
        <p className={`${s.record} text-[var(--color-ink-dim)]`}>{fmtRecord(team.wins, team.losses)}</p>
        <StatValue size="sm" variant={diff >= 0 ? 'pos' : 'neg'}>{fmtDiff(diff)}</StatValue>
      </div>
    );
  };

  return (
    <div className={className}>
      {label && <p className="t-caption mb-2 text-[var(--color-ink-faint)]">{label}</p>}
      <div className="flex items-start gap-4">
        {side(away, 'left')}
        <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
          <span className="t-h3 text-[var(--color-gold)]" aria-hidden="true">VS</span>
          {away && home && (
            <span className="t-caption text-[var(--color-ink-faint)]">
              {fmtPct(away.wins + away.losses > 0 ? away.wins / (away.wins + away.losses) : 0)}
            </span>
          )}
        </div>
        {side(home, 'right')}
      </div>
    </div>
  );
};
