import React, { useEffect, useMemo, useState } from 'react';
import { PenLine } from 'lucide-react';
import { ACCENT_VAR, HEADLINER_BY_ID, type HeadlineCandidate } from '../../logic/headliners';
import { Panel } from '../ui';
import { HeadlinerPortrait } from '../ui/HeadlinerPortrait';
import { formatHeadlineDate } from './shared';

/** Matches the headline carousel above it, so the two read as one desk. */
const SLIDE_INTERVAL_MS = 7000;

/**
 * The bylined newsroom.
 *
 * A SEPARATE SECTION, not a change to the headline carousel. The headline panel is a
 * finished thing that works, and this sits beneath it: different authors, different
 * opinions, same grammar. Nothing about the existing deck changes, which is the whole
 * reason this was built additively -- a missed consumer in a type migration is a
 * runtime `undefined` in the news feed rather than a compile error, and there was no
 * reason to accept that risk for a feature that can live next door.
 *
 * CAROUSEL, NOT A GRID. The brief was that the carousel is king, and it is right for
 * this: six cards stacked would push the standings and the rest of the front page
 * below the fold, and the point of the section is a line of opinion you read, not an
 * index you scan.
 *
 * THE EMPTY STATE IS THE FEATURE. The stalemate rule means a thin day ships fewer
 * cards, and a day where nobody qualifies ships none. Padding that with filler would
 * undo the entire premise -- a newsroom that always has something to say is a
 * newsroom you stop reading.
 */
export const HeadlinerPanel: React.FC<{
  cards: readonly HeadlineCandidate[];
  /** The date the cards describe, so both panels describe the same day. */
  sourceDate: string | null;
  timelineDate: string;
  /** Impressions spent, surfaced because the scarcity is the joke. */
  impressionsSpent: number;
  impressionCap: number;
}> = ({ cards, sourceDate, timelineDate, impressionsSpent, impressionCap }) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const slideCount = cards.length;
  const active = cards[Math.min(index, Math.max(0, slideCount - 1))] ?? null;

  // Reset when the day changes. Keyed on the date rather than the card, so a re-order
  // within one day does not throw the reader back to the first card.
  useEffect(() => {
    setIndex(0);
  }, [sourceDate ?? timelineDate]);

  useEffect(() => {
    if (paused || slideCount <= 1) return undefined;
    const timer = window.setTimeout(() => {
      setIndex((current) => (current + 1) % slideCount);
    }, SLIDE_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, slideCount]);

  const dateLabel = useMemo(
    () => (sourceDate ? formatHeadlineDate(sourceDate) : formatHeadlineDate(timelineDate)),
    [sourceDate, timelineDate],
  );

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <PenLine className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h2 className="t-label">Byline</h2>
        </div>
        <div className="flex items-center gap-3">
          {slideCount > 1 && (
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Columns">
              {cards.map((card, cardIndex) => (
                <button
                  key={`${card.byline}-${cardIndex}`}
                  type="button"
                  role="tab"
                  aria-selected={cardIndex === index}
                  aria-label={`${HEADLINER_BY_ID[card.byline].displayName}, column ${cardIndex + 1} of ${slideCount}`}
                  onClick={() => setIndex(cardIndex)}
                  className={`h-2 w-6 transition-colors ${
                    cardIndex === index
                      ? 'bg-[var(--color-gold)]'
                      : 'bg-[var(--color-chrome-lo)] hover:bg-[var(--color-chrome-hi)]'
                  }`}
                />
              ))}
            </div>
          )}
          <span className="t-caption text-[var(--color-ink-faint)]">{dateLabel}</span>
        </div>
      </div>

      {active ? (
        <div
          className="flex flex-col gap-4 p-5 md:flex-row md:items-start"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {/* The byline is the point of the section, so it gets the portrait at the
              largest of the three sizes and its own column rather than a caption. */}
          <div className="flex shrink-0 items-center gap-3 md:w-[190px] md:flex-col md:items-start">
            <HeadlinerPortrait id={active.byline} size="lg" />
            <div className="min-w-0">
              <p
                className="t-h3 truncate"
                style={{ color: ACCENT_VAR[active.accentToken] }}
              >
                {HEADLINER_BY_ID[active.byline].displayName}
              </p>
              <p className="t-caption text-[var(--color-ink-faint)]">
                {HEADLINER_BY_ID[active.byline].role}
              </p>
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="t-h1 break-words text-[var(--color-ink)]">{active.title}</h3>
            <div className="mt-3 h-[3px] w-16 bg-[var(--color-gold)]" aria-hidden="true" />
            {/* Two lines, because a deck is supporting text and a third becomes a
                wall. `line-clamp` rather than a fixed height so the panel does not
                jump when a short deck is followed by a long one. */}
            <p className="t-body mt-3 line-clamp-2 max-w-3xl text-[var(--color-ink-dim)]">
              {active.deck}
            </p>
          </div>

          {/* The byline conflict strip: how many other reporters filed on this same
              event. A single event with three columns is the feature working, and
              saying so is more interesting than the fact of it. */}
          {slideCount > 1 && (
            <p className="t-caption shrink-0 text-[var(--color-ink-faint)] md:text-right">
              {cards.filter((card) => card.event.game?.gameId === active.event.game?.gameId).length} on this game
            </p>
          )}
        </div>
      ) : (
        // The stalemate rule made visible. Centred, faint, and deliberately plain.
        <div className="flex flex-col items-center justify-center gap-1 px-5 py-10 text-center">
          <p className="t-label text-[var(--color-ink-dim)]">No Stories Filed Today</p>
          <p className="t-caption text-[var(--color-ink-faint)]">
            Nobody had a piece worth printing. That happens.
          </p>
        </div>
      )}

      {/* The columnist's tally. Visible because the scarcity is the character -- a
          counter nobody sees is just a number in a save file. */}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--color-chrome-lo)] px-4 py-2">
        <span className="t-caption text-[var(--color-ink-faint)]">
          {cards.length === 0
            ? 'No columns today'
            : `${cards.length} column${cards.length === 1 ? '' : 's'} filed`}
        </span>
        <span className="t-caption text-[var(--color-ink-faint)]">
          Tombuccelli impressions {impressionsSpent}/{impressionCap}
        </span>
      </div>
    </Panel>
  );
};