import React from 'react';
import { Crown, Trophy } from 'lucide-react';
import type { AwardEntry } from '../../lib/awardRace';
import { OddsBar, SegmentedControl, StatValue, TeamLogo } from '../ui';
import { HomePanel } from './shared';

/**
 * Front-page award race.
 *
 * Top three only. A front page should be a summary, and the full eight-candidate
 * table with the complete component breakdown is one click away on the Leaders
 * screen -- where it already lives and belongs.
 *
 * Odds are still normalised across the full field of eight before the top three
 * are taken, so the figures here are each racer's true share of the whole field
 * and the three do not sum to 100. That is correct, not a rounding artefact.
 */
export const MvpRacePanel: React.FC<{
  board: 'batting' | 'pitching';
  onBoardChange: (board: 'batting' | 'pitching') => void;
  entries: AwardEntry[];
}> = ({ board, onBoardChange, entries }) => {
  const leader = entries[0];
  const runnerUp = entries[1];
  const gap = leader && runnerUp ? leader.total - runnerUp.total : 0;

  return (
    <HomePanel
      title="Award Race"
      aside={board === 'batting'
        ? <Crown className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
        : <Trophy className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />}
      bodyClassName="p-3"
    >
      <SegmentedControl
        aria-label="Award race"
        mode="fill"
        value={board}
        onChange={(value) => onBoardChange(value as 'batting' | 'pitching')}
        options={[{ value: 'batting', label: 'Batting' }, { value: 'pitching', label: 'Pitching' }]}
      />

      {/*
        THE CREST ONLY -- the club's city and nickname are gone from each row.

        They were the second line of every row and they said nothing the mark did not.
        A reader scanning a leaderboard reads the crests first and the numbers second;
        the text line sat between the two, so the eye had to decode a string before it
        reached the figure that decides anything. It was also the widest element in the
        row, which is what set how narrow the odds bar and the score had to be.

        The crest grew from 28px to 32px to take up the space the text vacated, and the
        club is still named -- in the logo's accessible name and in the row's tooltip
        -- so nothing became unreachable. What is gone is the duplication, not the
        information.
      */}

      {leader && runnerUp && (
        <p className="t-caption mt-2 text-[var(--color-ink-dim)]">
          Lead over second: <StatValue size="sm" variant="accent">{gap.toFixed(1)}</StatValue> points
        </p>
      )}

      {entries.length === 0 ? (
        <p className="t-body mt-3 text-[var(--color-ink-dim)]">
          MVP candidates appear once enough regular-season data exists.
        </p>
      ) : (
        <ol className="mt-2 flex flex-col">
          {entries.map((entry, index) => (
            <li
              key={entry.playerId}
              className={`flex flex-col gap-2 border-l-[3px] px-2 py-2 ${
                index === 0 ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]' : 'border-l-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
                {entry.team ? (
                  <TeamLogo team={entry.team} sizeClass="h-8 w-8 shrink-0" />
                ) : (
                  <span className="h-8 w-8 shrink-0" aria-hidden="true" />
                )}
                <p
                  className={`min-w-0 flex-1 truncate t-stat-sm ${index === 0 ? 'text-[var(--color-gold-hi)]' : ''}`}
                  title={entry.team ? `${entry.name} — ${entry.team.city} ${entry.team.name}` : `${entry.name} — Free agent`}
                >
                  {entry.name}
                </p>
                <StatValue variant="accent">{entry.total.toFixed(1)}</StatValue>
              </div>
              <OddsBar odds={entry.odds} label={entry.name} />
            </li>
          ))}
        </ol>
      )}
    </HomePanel>
  );
};
