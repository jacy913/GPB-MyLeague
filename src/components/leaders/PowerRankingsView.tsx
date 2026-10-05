/**
 * POWER RANKINGS -- the League Office's board.
 *
 * Reads `buildPowerRankings`, which reads the same fair layer the HXSE prices from. There is no
 * second valuation anywhere on this screen, and that is the point: two valuations of one club is a
 * disagreement a manager finds within a single screen.
 *
 * Two things this screen deliberately does NOT do:
 *
 *   1. It does not rank on championship probability, even though that is the more interesting number
 *      and it is displayed. At 250 Monte Carlo trials a 10% probability carries about 1.9 points of
 *      standard error, so adjacent clubs are indistinguishable -- measured, ranking by it put the
 *      strongest club in a pristine league at number 14. See `rankBasis` in `powerRankings.ts`.
 *
 *   2. It does not fold division strength into the rank. The Monte Carlo already knows who each club
 *      has to beat, so a weak division is inside the title probability. Adding it again would count
 *      it twice, invisibly. The tag is there to TELL you about the division, not to score it.
 */

import React from 'react';
import { TrendingUp } from 'lucide-react';
import type { Team } from '../../types';
import type { DivisionStrengthTag, PowerRankings } from '../../lib/analytics/powerRankings';
import { Panel, StatValue, TeamLogo } from '../ui';

/** soft | even | deep, coloured so the strongest division reads at a glance. */
const TAG_STYLE: Record<DivisionStrengthTag, string> = {
  deep: 'text-[var(--color-neg)]',
  even: 'text-[var(--color-ink-faint)]',
  soft: 'text-[var(--color-info)]',
};

const TAG_COPY: Record<DivisionStrengthTag, string> = {
  deep: 'deep division -- hard road to the pennant',
  even: 'even division',
  soft: 'soft division -- the easier path',
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Division tag as a short badge. Colour carries the meaning; the title attribute carries the sentence. */
const DivisionTag: React.FC<{ tag: DivisionStrengthTag }> = ({ tag }) => (
  <span className={`t-caption uppercase tracking-wider ${TAG_STYLE[tag]}`} title={TAG_COPY[tag]}>
    {tag}
  </span>
);

export interface PowerRankingsViewProps {
  rankings: PowerRankings;
  teamsById: Map<string, Team>;
  onSelectTeamId: (teamId: string) => void;
}

/**
 * A crest + city + rank, in that reading order.
 *
 * The crest is 8px on a 40px row rather than the 96px the Exchange uses per club. Thirty-two rows at
 * that size is a scroll of nothing but faces; the ranking is the information here and the crest is
 * only there to make the row findable.
 */
const ClubCell: React.FC<{
  team: Team | undefined;
  fallbackId: string;
  onSelect: () => void;
}> = ({ team, fallbackId, onSelect }) => (
  <button
    type="button"
    onClick={onSelect}
    className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
  >
    {team
      ? <TeamLogo team={team} sizeClass="h-8 w-8 shrink-0" />
      : <span className="h-8 w-8 shrink-0 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />}
    <span className="min-w-0">
      <span className="t-body block truncate">{team?.city ?? fallbackId}</span>
      <span className="t-caption block truncate text-[var(--color-ink-faint)]">{team?.name ?? ''}</span>
    </span>
  </button>
);

export const PowerRankingsView: React.FC<PowerRankingsViewProps> = ({
  rankings,
  teamsById,
  onSelectTeamId,
}) => {
  const { rows, divisions, asOf, rankBasis } = rankings;

  return (
    <div className="space-y-4">
      <Panel variant="hero" className="overflow-hidden">
        <div className="chrome-bar flex items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            <h1 className="t-h3">League Office Power Rankings</h1>
          </div>
          <span className="t-caption text-[var(--color-ink-faint)]">as of {asOf}</span>
        </div>
        <div className="space-y-3 p-4">
          <p className="t-body max-w-3xl text-[var(--color-ink-dim)]">
            Every club, ordered by the League Office's own valuation -- the forecaster consensus, the
            roster measured against the record, and a simulation of the remaining season. The title
            odds beside each club come from that same simulation.
          </p>
          {/*
            WHY IT SAYS WHAT IT SORTS ON.

            A board that ranks on a number without naming it is asking the reader to assume the
            obvious one, and the obvious one here is title probability -- which is NOT what this sorts
            on. So the basis is stated rather than implied.
          */}
          <p className="t-caption text-[var(--color-ink-faint)]">
            Ranked on {rankBasis === 'championship' ? 'title probability' : 'club valuation'}. Title
            odds are shown, not used to order: at {rankings.mcTrials} simulation trials the gap between
            neighbouring clubs is smaller than the simulation's own noise, so ordering by it would be
            ordering by the dice.
          </p>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="overflow-hidden">
          <div className="chrome-bar flex items-center justify-between px-4">
            <h2 className="t-label">All Clubs</h2>
            <span className="t-caption text-[var(--color-ink-faint)]">{rows.length} ranked</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-chrome-lo)]">
                <th scope="col" className="t-caption px-4 py-2 text-left font-normal">#</th>
                <th scope="col" className="t-caption px-2 py-2 text-left font-normal">Club</th>
                <th scope="col" className="t-caption px-2 py-2 text-left font-normal">Division</th>
                <th scope="col" className="t-caption px-2 py-2 text-right font-normal">Valuation</th>
                <th scope="col" className="t-caption px-2 py-2 text-right font-normal">Fair</th>
                <th scope="col" className="t-caption px-2 py-2 text-right font-normal">Make</th>
                <th scope="col" className="t-caption px-4 py-2 text-right font-normal">Title</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teamId} className="border-b border-[var(--color-chrome-lo)]/40 last:border-0">
                  <td className="px-4 py-2">
                    <span className="t-stat tabular-nums">{row.rank}</span>
                  </td>
                  <td className="px-2 py-2">
                    <ClubCell
                      team={teamsById.get(row.teamId)}
                      fallbackId={row.teamId}
                      onSelect={() => onSelectTeamId(row.teamId)}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <span className="t-caption block text-[var(--color-ink-dim)]">
                      {row.league} {row.division}
                    </span>
                    <DivisionTag tag={row.divisionTag} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <StatValue>{row.valuation.toFixed(1)}</StatValue>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span className="t-body tabular-nums">${row.fairPrice.toFixed(0)}</span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <span className="t-body tabular-nums text-[var(--color-ink-dim)]">
                      {pct(row.makePlayoffPct)}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="t-body tabular-nums text-[var(--color-gold-hi)]">
                      {pct(row.championshipPct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/*
          THE DIVISION BREAKDOWN.

          Present because the tag on each row needs somewhere to resolve to. A row saying "soft" is
          only useful if the reader can see which division is soft and by how much -- and the z-score
          is what makes the tag honest, since it is measured against the spread of the other seven
          divisions rather than against a fixed number.
        */}
        <Panel className="h-fit overflow-hidden">
          <div className="chrome-bar px-4">
            <h2 className="t-label">Divisions</h2>
          </div>
          <div className="divide-y divide-[var(--color-chrome-lo)]/40">
            {divisions.map((division) => (
              <div key={`${division.league}-${division.division}`} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="t-body">{division.division}</span>
                  <span className="t-caption text-[var(--color-ink-faint)]">{division.league}</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="t-stat tabular-nums">{division.meanValuation.toFixed(1)}</span>
                  <DivisionTag tag={division.tag} />
                </div>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-chrome-lo)]">
                  <div
                    className="h-full bg-[var(--color-gold)]"
                    style={{ width: `${Math.max(0, Math.min(100, division.meanValuation))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
};