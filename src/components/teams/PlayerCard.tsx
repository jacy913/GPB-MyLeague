import React from 'react';
import { Shield } from 'lucide-react';
import type { Player, PlayerSeasonBatting, PlayerSeasonPitching, Team } from '../../types';
import { AttributeRadar } from '../AttributeRadar';
import { Panel, RatingRing, TeamLogo } from '../ui';
import { EMPTY, StatList, battingLineRows, pitchingLineRows } from './shared';

/**
 * Player card.
 *
 * The roster screen and the player database each had their own copy of this
 * block -- the same four vitals, the same OVR dial, the same attribute radar and
 * the same two stat lists. They were already drifting: one showed a dash for a
 * missing player, the other showed a different sentence.
 */
export const PlayerCard: React.FC<{
  player: Player | null;
  team: Team | null;
  overall: number | null;
  attributePoints: Array<{ label: string; value: number }>;
  battingStat: PlayerSeasonBatting | null;
  pitchingStat: PlayerSeasonPitching | null;
  eyebrow: string;
  title: string;
  subline: string;
  emptyAttributes: string;
}> = ({ player, team, overall, attributePoints, battingStat, pitchingStat, eyebrow, title, subline, emptyAttributes }) => (
  <div className="flex flex-col gap-3">
    <div className="flex items-start gap-3">
      {team
        ? <TeamLogo team={team} sizeClass="h-20 w-20" />
        : (
          <div className="flex h-20 w-20 items-center justify-center border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true">
            <span className="t-caption text-[var(--color-ink-faint)]">FA</span>
          </div>
        )}
      <div className="min-w-0 flex-1">
        <p className="t-caption text-[var(--color-ink-faint)]">{eyebrow}</p>
        <h2 className="t-h2 mt-1 break-words">{title}</h2>
        <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{subline}</p>
        <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
          {player
            ? `Bats ${player.bats} · Throws ${player.throws} · ${player.contractYearsLeft} yr left`
            : 'Bats -- · Throws -- · Years Left --'}
        </p>
      </div>
      <RatingRing value={overall} label="OVR" size={80} strokeWidth={6} caption="Impact Grade" />
    </div>

    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {([
        ['Primary', player?.primaryPosition ?? EMPTY],
        ['Height', player?.height ?? EMPTY],
        ['Age', player?.age ?? EMPTY],
        ['Weight', player ? `${player.weightLbs} lbs` : EMPTY],
      ] as Array<[string, string]>).map(([label, value]) => (
        <div key={label} className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2">
          <p className="t-caption text-[var(--color-ink-faint)]">{label}</p>
          <p className="t-stat mt-1 truncate">{value}</p>
        </div>
      ))}
    </div>

    <Panel variant="sunken" className="p-3">
      <p className="t-label mb-2 flex items-center gap-2 text-[var(--color-ink-dim)]">
        <Shield className="h-4 w-4" aria-hidden="true" /> Attributes
      </p>
      {player && attributePoints.length > 0
        ? <AttributeRadar points={attributePoints} />
        : <p className="t-caption text-[var(--color-ink-faint)]">{emptyAttributes}</p>}
    </Panel>

    <div className="grid gap-2 md:grid-cols-2">
      <Panel variant="sunken" className="p-3">
        <p className="t-label mb-1 text-[var(--color-ink-dim)]">Batting</p>
        <StatList rows={battingLineRows(battingStat)} />
      </Panel>
      <Panel variant="sunken" className="p-3">
        <p className="t-label mb-1 text-[var(--color-ink-dim)]">Pitching</p>
        <StatList rows={pitchingLineRows(pitchingStat)} />
      </Panel>
    </div>
  </div>
);
