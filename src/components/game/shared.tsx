import React from 'react';
import type { GameSessionState, Team } from '../../types';
import { Panel, StatValue, TeamLogo } from '../ui';

/**
 * Shared pieces for the game screen.
 *
 * The batting and pitching side panels were byte-identical apart from which
 * team and which half of the inning they showed, so they are one component.
 * The line score and the base diamond are the two forms this product most
 * wants to get right; both are dense ruled grids with real numbers, so both are
 * built as real grids rather than as flex rows of divs.
 */

export const BaseDiamond: React.FC<{ first: boolean; second: boolean; third: boolean }> = ({ first, second, third }) => {
  const bag = (filled: boolean, position: React.CSSProperties) => (
    <span
      className={`absolute h-4 w-4 rotate-45 border ${
        filled ? 'border-[var(--color-gold)] bg-[var(--color-gold)]' : 'border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]'
      }`}
      style={position}
      aria-hidden="true"
    />
  );

  return (
    <div className="relative mx-auto h-36 w-36" role="img" aria-label={`Bases: first ${first ? 'occupied' : 'empty'}, second ${second ? 'occupied' : 'empty'}, third ${third ? 'occupied' : 'empty'}`}>
      <span className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)]" aria-hidden="true" />
      {bag(first, { bottom: '8px', left: '50%', marginLeft: '-8px' })}
      {bag(third, { top: '50%', left: '8px', marginTop: '-8px' })}
      {bag(second, { top: '50%', right: '8px', marginTop: '-8px' })}
      <span className="absolute left-1/2 top-4 h-4 w-4 -translate-x-1/2 rotate-45 border border-[var(--color-chrome-lo)] bg-[var(--color-panel)]" aria-hidden="true" />
    </div>
  );
};

/**
 * Line score.
 *
 * The inning-by-inning grid is the most recognisable artifact in the sport, so
 * it is a real ruled table with tabular figures rather than a flex row of
 * boxes. Totals sit in a heavier rule, and the half currently in progress
 * shows its outs in the trailing column.
 */
export const LineScore: React.FC<{
  awayTeam: Team;
  homeTeam: Team;
  lineScore: GameSessionState['lineScore'];
  away: { runs: number; hits: number; errors: number };
  home: { runs: number; hits: number; errors: number };
  half: 'top' | 'bottom';
  outs: number;
}> = ({ awayTeam, homeTeam, lineScore, away, home, half, outs }) => {
  const innings = Math.max(9, lineScore.length);
  const cell = 'px-2 py-1.5 text-center t-stat-sm tabular-nums';
  const head = 'px-2 py-1 text-center t-caption text-[var(--color-ink-faint)]';

  const row = (label: string, side: 'away' | 'home', totals: { runs: number; hits: number; errors: number }) => (
    <tr className="border-b border-[var(--color-chrome-lo)] last:border-b-0">
      <th scope="row" className="border-r border-[var(--color-chrome-lo)] px-2 py-1.5 text-left t-stat-sm">{label}</th>
      {Array.from({ length: innings }, (_, index) => (
        <td key={index} className={`${cell} ${index >= 9 ? 'border-l-2 border-l-[var(--color-gold-dim)]' : ''}`}>
          {lineScore[index]?.[side] ?? ''}
        </td>
      ))}
      <td className={`${cell} border-l-2 border-l-[var(--color-gold-dim)]`}>{totals.runs}</td>
      <td className={cell}>{totals.hits}</td>
      <td className={cell}>{totals.errors}</td>
      {/*
        THE OUTS COLUMN, and the comparison it actually needed.

        This was `half === side ? outs : ''` -- comparing `'top' | 'bottom'` against `'away' | 'home'`,
        two disjoint unions. It could never be true, so the trailing column was permanently blank in
        every state of every game, which is the same failure as those icon `depth` props: something
        that looks meaningful, gets dropped, and leaves no trace.

        The intent was already written down in the doc comment above -- "the half currently in progress
        shows its outs in the trailing column" -- and it is still true; only the encoding was wrong.
        The top half is the away club batting and the bottom half the home club, so the mapping is the
        missing half of the expression rather than something to cast.

        Written as the comparison it means. Casting `half` into a side would have silenced the error
        and left the column blank, which is the fix that satisfies the compiler and not the reader.
      */}
      <td className={cell}>{(half === 'top' ? 'away' : 'home') === side ? outs : ''}</td>
    </tr>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <caption className="sr-only">Inning by inning line score</caption>
        <thead>
          <tr className="chrome-bar">
            <th scope="col" className="px-2 py-1 text-left t-caption">TEAM</th>
            {Array.from({ length: innings }, (_, index) => (
              <th key={index} scope="col" className={head}>{index + 1}</th>
            ))}
            <th scope="col" className={`${head} border-l-2 border-l-[var(--color-gold-dim)]`}>R</th>
            <th scope="col" className={head}>H</th>
            <th scope="col" className={head}>E</th>
            <th scope="col" className={head}>O</th>
          </tr>
        </thead>
        <tbody>
          {row(awayTeam.id.toUpperCase(), 'away', away)}
          {row(homeTeam.id.toUpperCase(), 'home', home)}
        </tbody>
      </table>
    </div>
  );
};

export const SidePanel: React.FC<{
  role: string;
  team: Team;
  runs: number;
  hits: number;
  errors: number;
}> = ({ role, team, runs, hits, errors }) => (
  <Panel variant="sunken" className="flex flex-col gap-3 p-3">
    <p className="t-caption text-[var(--color-ink-faint)]">{role}</p>
    <div className="flex items-center gap-3">
      <TeamLogo team={team} sizeClass="h-16 w-16" />
      <div className="min-w-0">
        <p className="truncate t-h2">{team.city}</p>
        <p className="truncate t-caption text-[var(--color-ink-dim)]">{team.name}</p>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-1">
      {([['R', runs], ['H', hits], ['E', errors]] as Array<[string, number]>).map(([label, value]) => (
        <div key={label} className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-2 py-1.5 text-center">
          <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
          <p className="t-stat-lg">{value}</p>
        </div>
      ))}
    </div>
  </Panel>
);

export const CountTile: React.FC<{ label: string; children: React.ReactNode; accent?: boolean }> = ({ label, children, accent }) => (
  <div className="border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-3 py-2">
    <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
    <div className="mt-1">{accent ? <StatValue size="sm" variant="accent">{children}</StatValue> : children}</div>
  </div>
);
