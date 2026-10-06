import React from 'react';
import { Crown, Trophy } from 'lucide-react';
import type { AwardEntry } from '../../lib/awardRace';
import { formatAmerican, probabilityToAmerican } from '../../lib/markets';
import { SegmentedControl, StatValue, TeamLogo } from '../ui';
import { HomePanel } from './shared';

/** A top-three candidate, plus the house price for that candidate on the MacroBet board. */
export type MvpRaceRow = AwardEntry & {
  /**
   * The MacroBet consensus probability, 0-1, or null when there is no market for this race.
   *
   * Null rather than zero because the two mean opposite things: a price of zero is a certainty
   * nobody can sell, and "there is no race here" is what an empty field produces. Rendering them
   * the same way would print a confident 0.00 for a race that does not exist.
   */
  houseProbability: number | null;
};

/**
 * Front-page award race.
 *
 * Top three only. A front page should be a summary, and the full candidate table with the
 * component breakdown is one click away on the Leaders screen -- where it already lives and belongs.
 *
 * THE PRICE IS MACROBET'S, NOT THIS PANEL'S. It is the confidence-weighted consensus of the same
 * field the book is selling, taken from the same `buildAwardMarket` call, which is why the leader
 * reads here and on the MacroBet awards tab cannot disagree. `checkAwardRacePrice` asserts that
 * rather than trusting it, because the version of this panel that computed its own share could
 * produce a different number from the book on the same day and nothing would say so.
 */
export const MvpRacePanel: React.FC<{
  board: 'batting' | 'pitching';
  onBoardChange: (board: 'batting' | 'pitching') => void;
  entries: MvpRaceRow[];
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

        They were the second line of every row and they said nothing the mark did not. A reader
        scanning a leaderboard reads the crests first and the numbers second; the text line sat
        between the two, so the eye had to decode a string before it reached the figure that
        decides anything. It was also the widest element in the row, which is what set how narrow
        the odds bar and the score had to be.

        The club is still named -- in the logo's accessible name and in the row's tooltip -- so
        nothing became unreachable. What is gone is the duplication, not the information.
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
              className={`flex items-center gap-3 border-l-[3px] px-2 py-2 ${
                index === 0 ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]' : 'border-l-transparent'
              }`}
            >
              <span className="w-[2ch] shrink-0 text-right t-stat-sm text-[var(--color-ink-faint)]">{index + 1}</span>
              {entry.team ? (
                <TeamLogo team={entry.team} sizeClass="h-12 w-12 shrink-0" />
              ) : (
                <span className="h-12 w-12 shrink-0" aria-hidden="true" />
              )}
              {/*
                THE NAME AND THE CREST SHARE THE ROW ON THEIR OWN, because the bar that used to sit
                beneath them is gone. It was a full-width `OddsBar` -- an 8px track plus a `6ch`
                percentage -- carrying the same normalised share the MacroBet price now carries. Two
                renderings of one number, and the second one was the number a manager could actually
                bet. Removing it also removed the reason this row was two lines tall, which is what
                lets the crest go from 32px to 48px without the panel growing.

                The MVP score stays, because it is the only figure here that is not a probability.
                Points are the model's own arithmetic; the price is a market's opinion about it.
              */}
              <p
                className={`t-stat min-w-0 flex-1 truncate ${index === 0 ? 'text-[var(--color-gold-hi)]' : ''}`}
                title={entry.team ? `${entry.name} — ${entry.team.city} ${entry.team.name}` : `${entry.name} — Free agent`}
              >
                {entry.name}
              </p>
              <StatValue className="shrink-0 tabular-nums" title="MVP points">
                {entry.total.toFixed(1)}
              </StatValue>
              {/*
                THE HOUSE PRICE. Rendered in American for the same reason the featured game above it
                is: it is the number a reader would say out loud and the number they would see if
                they opened MacroBet. A dash, never a fabricated price, when there is no market.
              */}
              <span
                className="w-[6ch] shrink-0 text-right t-stat-sm tabular-nums text-[var(--color-gold-hi)]"
                title={entry.houseProbability === null
                  ? 'No MacroBet price on this race'
                  : `MacroBet house price — ${(entry.houseProbability * 100).toFixed(1)}% implied`}
              >
                {entry.houseProbability === null
                  ? '—'
                  : formatAmerican(probabilityToAmerican(entry.houseProbability))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </HomePanel>
  );
};
