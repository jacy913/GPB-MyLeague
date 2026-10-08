import React, { useEffect, useMemo, useState } from 'react';

import { ACCENT_VAR, HEADLINER_BY_ID, eventSeed, type HeadlineCandidate, type HeadlinerId } from '../../logic/headliners';
import { pickBeat } from '../../logic/headlinerVoices';
import { HeadlinerDetailsModal } from '../media/HeadlinerDetailsModal';
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
}> = ({ cards, sourceDate, timelineDate }) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /*
    Which reporter's dossier is open, or null. `null` rather than a boolean plus an id, because "no
    dossier" and "a dossier whose reporter is missing" are the same state and one field cannot
    disagree with itself.
  */
  const [dossierFor, setDossierFor] = useState<HeadlinerId | null>(null);

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
    <>
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
        <h2 className="t-label">Sideline Reports</h2>
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
              largest size and its own column rather than a caption.

              The column widened from 190px to 208px to take the 72px plate without the
              name beside it being squeezed to a truncation. The portrait was 40px,
              which is a byline BADGE -- the same size the outlet marks use on the
              betting screen -- while the crests in the headline of the day directly
              above run at 96px and 240px. A reporter you are asked to attribute an
              opinion to was the smallest image on the front page.

              72px rather than 96px because the shipped portrait is 95x95: rendering it
              at 96 is 1:1 and softens on any 2x display. See `SIZE_PX` in
              HeadlinerPortrait for the full note. */}
          <div className="relative flex shrink-0 items-center gap-3 md:w-[208px] md:flex-col md:items-start">
            {/*
              NO WALLPAPER HERE, and that is a measured decision rather than a retreat.

              This column is 208px wide and about 147px tall, and a reporter's backdrop behind it was
              tried and screenshotted. It fails twice over. The crop of a 1376x768 photograph into
              208x147 is an arbitrary slice -- on Perez's it landed on a face -- and any scrim light
              enough to show that face washes the name out to "SIM / DAT / COR" fragments, while any
              scrim dark enough to read the name erases the photograph entirely. There is no setting
              in between, which is the forecaster registry's own point about wallpapers arriving full
              strength in the wrong place.

              So the artwork lives in the dossier, which has room for it and nothing numeric over it,
              and this column stays a byline. That also means the five wallpapers are not being loaded
              on every dashboard paint, which is the only thing that justified paying for them here.
            */}
            <div className="relative flex w-full items-start gap-3 md:flex-col md:items-start">
            <HeadlinerPortrait id={active.byline} size="xl" />
            <div className="min-w-0">
              <p
                className="t-h3"
                style={{ color: ACCENT_VAR[active.accentToken] }}
              >
                {HEADLINER_BY_ID[active.byline].displayName}
              </p>
              <p className="t-caption text-[var(--color-ink-faint)]">
                {HEADLINER_BY_ID[active.byline].role}
              </p>
              {/*
                THE BEAT: what this writer walks in with, before the story.

                This is the lore surface, and it is deliberately ABOVE the headline rather
                than below the deck. A deck is about tonight's game and is different every
                night; a beat is what the writer believes and says regardless, so putting
                it first means the reader knows whose position they are reading before
                they read the claim, which is the whole point of a byline.

                Italic and one step down from the role, because it is an aside the writer
                is muttering rather than the lede. It is the writer's words, not the
                paper's, so it does not take the accent colour -- that belongs to the
                headline's own voice.
              */}
              <p className="mt-1.5 border-l-2 border-[var(--color-chrome-lo)] pl-2 t-caption italic text-[var(--color-ink-dim)]">
                {pickBeat(HEADLINER_BY_ID[active.byline], eventSeed(active.event))}
              </p>
            </div>
            </div>
            {/*
              A STRETCHED BUTTON across the whole column, rather than wrapping the column in one. The
              column is a flex stack of portrait and text, and a <button> cannot be that flex
              container without changing the layout. So the button is an overlay: it takes the click
              and the focus ring, and the visible content stays plain text. This is what makes the
              byline the entry point to the dossier, which is the only route a reporter has -- they
              have no page of their own to be browsed from.

              Added at the END of the column so that in DOM order it follows the name and role, which
              is the order a screen reader should meet them in.
            */}
            <button
              type="button"
              onClick={() => setDossierFor(active.byline)}
              aria-label={`Open the ${HEADLINER_BY_ID[active.byline].displayName} dossier`}
              className="absolute inset-0 z-10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
            />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="t-h1 break-words text-[var(--color-ink)]">{active.title}</h3>
            <div className="mt-3 h-[3px] w-16 bg-[var(--color-gold)]" aria-hidden="true" />
            {/*
              THE DECK RUNS TO WHATEVER LENGTH IT IS, NOT TO TWO LINES.

              This was `line-clamp-2`, and it was the wrong call. A deck is the summary
              of the piece -- the sentence that says what the column is actually about
              -- and clamping it to two lines meant the panel routinely ended on a half
              sentence with an ellipsis and no way to see the rest. There was no
              expander and no title attribute, so the missing words were simply not
              there. The original justification was that "a third line becomes a
              wall", which is true of a panel that must not grow, and false of one that
              scrolls: the reader who cares reads four lines, and the reader who does
              not was never going to read two.
            */}
            <p className="t-body mt-3 max-w-3xl text-[var(--color-ink-dim)]">
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

      {/*
        NO FOOTER, AND THAT IS THE RIGHT CALL.

        This used to carry two counters along the bottom: how many stories are in
        today's edition, and how many of the columnist's rare praises he has spent
        against a cap of two. Both are gone.

        The story count went because it is not news. It is the length of the carousel
        above it -- the same fact as the number of dots in the header -- printed a
        second time in words, and it made the footer look like it was reporting
        something when it was counting the widget.

        The impression budget went because it is permanently 0/2. Nothing anywhere
        increments `tombuccelliImpressions`: the dashboard reads it from the save
        bundle and never writes back, and `readHeadlinerLedger` only ever turns a
        missing or corrupt value into a zero. So the pipeline's cap was always
        compared against zero, the columnist's rare praise was never actually
        rationed, and this line reported a budget that had never been spent.

        The argument for showing it anyway was that the scarcity is the character, and
        a counter nobody sees is just a number in a save file. That argument is right
        about the MECHANIC and wrong about this readout: the mechanic is currently
        inert, so the visible half of it advertises a feature that is not running.
        Displaying it does not make the scarcity legible -- it makes a broken thing
        look deliberate.

        What should bring it back is the write path, which is the thing that was
        actually missing. `headlinerLedger` is still threaded into this panel's
        caller and still feeds `buildPersonaDeck`, where the cap is enforced -- it is
        just no longer painted. Wiring the ledger so the number means something is a
        save-path change and it is not a presentation one.
      */}
    </Panel>
      <HeadlinerDetailsModal
        isOpen={dossierFor !== null}
        onClose={() => setDossierFor(null)}
        headlinerId={dossierFor}
      />
    </>
  );
};