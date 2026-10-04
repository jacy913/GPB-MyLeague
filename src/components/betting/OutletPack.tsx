import React from 'react';
import { MEDIA_BY_ID, type MediaId } from '../../data/media';
import { formatAmerican } from '../../lib/markets';
import { MEDIA_MARKS_SQUARE } from '../media/mediaImages';

/**
 * Every forecaster's own price on one club, for the `Pack` popover.
 *
 * ============================================================================
 * WHAT THIS ANSWERS
 * ============================================================================
 *
 * The cell on the board shows ONE number -- the house line, the confidence-weighted consensus of
 * all nine forecasters. That is the right number to lead with, because it is the number being
 * offered. This is where the nine numbers behind it are shown, so the house price is explainable
 * rather than merely asserted: a manager can see that Hollis says 4% and Sharply says 7%, and
 * therefore understand why the house says 5%.
 *
 * ============================================================================
 * WIDEST DISAGREEMENT FIRST, ALWAYS
 * ============================================================================
 *
 * Not registry order. Registry order answers "what does everyone say", which is a worse question
 * than the one being asked, and it buries the interesting row under eight agreeable ones. Sorted
 * by distance from the house line, the row a manager actually wants -- "who disagrees, and by how
 * much" -- is the first thing in the panel, every time.
 *
 * ============================================================================
 * THE FURTHEST ONE IS NAMED
 * ============================================================================
 *
 * Because "furthest from the pack" is the fact that made the manager open this. Without it they
 * would have to compare nine prices against a tenth by eye to find the number that justified the
 * click.
 *
 * NOTE ON IDENTITY. Three of the nine forecasters currently share the display name "The Booth",
 * and two pairs share the others, so this list can show the same masthead twice with different
 * prices beside it. That is a data problem in `src/data/media.ts` rather than a rendering one --
 * the MARKS are distinct per forecaster and are always shown here, so no two rows are visually
 * identical even while the names collide.
 */
export interface OutletPackProps {
  /** What these prices are about -- a club on the futures board, the away side of a game. */
  subject: string;
  /** Each forecaster's own price, for one side. */
  odds: Record<MediaId, number>;
  /** The house's probability for that same side, which every gap is measured against. */
  consensusProbability: number;
  /** The forecaster furthest from the house. */
  outlier: MediaId;
  /**
   * The house's own price for that side.
   *
   * Optional because the futures board's house price IS the subject of the card and has no second
   * one to quote alongside it, while a slate game does -- and stating it is what turns the
   * forecaster column from decoration into an explanation of the number being offered.
   */
  houseOdds?: number;
  /** One clause naming the field these prices belong to. */
  footnote?: string;
}

/** One forecaster's price, paired with how far it sits from the house line. */
interface OutletRow {
  mediaId: MediaId;
  odds: number;
  gap: number;
}

const rowsFor = (odds: Record<MediaId, number>, consensus: number): OutletRow[] =>
  (Object.entries(odds) as [MediaId, number][])
    .map(([mediaId, price]) => ({
      mediaId,
      odds: price,
      gap: Math.abs(price - consensus),
    }))
    .sort((left, right) => right.gap - left.gap);

export const OutletPack: React.FC<OutletPackProps> = ({
  subject,
  odds,
  consensusProbability,
  outlier,
  houseOdds,
  footnote,
}) => {
  const rows = rowsFor(odds, consensusProbability);

  return (
    <>
      <p className="t-caption text-[var(--color-ink-dim)]">
        The house reads {Math.round(consensusProbability * 100)}%
        {houseOdds !== undefined && ` and prices ${formatAmerican(houseOdds)}`} on {subject}.
      </p>

      <ul className="flex flex-col">
        {rows.map((row) => {
          const profile = MEDIA_BY_ID[row.mediaId];
          const isFurthest = row.mediaId === outlier;
          return (
            <li
              key={row.mediaId}
              className="flex items-center gap-2 border-t border-[var(--color-chrome-lo)] py-1"
            >
              <img
                src={MEDIA_MARKS_SQUARE[row.mediaId]}
                alt=""
                aria-hidden="true"
                className="h-5 w-5 shrink-0 object-contain"
              />
              {/*
                THE PERSON FIRST, THEN THE MASTHEAD, AS SEPARATE CELLS.

                Three of the nine publish as "The Booth" and two more pairs share an outlet, so a row
                labelled by masthead rendered three identical words beside three different prices --
                exactly the ambiguity this panel exists to resolve. The name is unique across all nine;
                the outlet is not, and cannot be made to be.

                Separate elements rather than one string so the gap is the flex `gap-2` and is
                therefore real. Concatenating them inside a single span put the two words flush against
                each other, because `innerText` and a screen reader both report inline margins as
                nothing -- the name has to be its own box to be legibly its own word.

                The outlet is skipped when it is the name, which is Scintilla's case: he publishes
                under his own name, so printing it twice reads as a stutter rather than as a byline.

                HE, not she. Every other mention in the codebase -- media.ts, mediaReads.ts,
                mediaMarkets.ts -- has him as "he", and an earlier version of this comment said
                "she". A comment is not a rendering bug, but a codebase that misgenders a character
                in one file and not the other is a codebase where the next person cannot tell which
                one is right.
              */}
              <span
                className="min-w-0 truncate t-caption"
                style={{ color: `var(--color-media-${profile.accent}-hi)` }}
                title={`${profile.name} -- ${profile.role}`}
              >
                {profile.name}
              </span>
              {profile.outlet !== profile.name && (
                <span className="shrink-0 truncate t-caption text-[var(--color-ink-faint)]">
                  {profile.outlet}
                </span>
              )}
              <span className="ml-auto shrink-0 t-caption tabular-nums text-[var(--color-ink)]">
                {formatAmerican(row.odds)}
              </span>
              {isFurthest && (
                <span className="shrink-0 t-caption text-[var(--color-warn)]">
                  furthest, {Math.round(row.gap * 100)}pt
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {/*
        WHAT THE HOUSE PRICE IS, said plainly.

        The popover's whole justification is that the house number is explainable, so it ends by
        explaining it rather than leaving the reader to infer that nine numbers produced one. The
        `market` prop is used only for the tab's name in that sentence -- which market these prices
        belong to, when the panel is floating free of the grid and no longer inherits its heading.
      */}
      <p className="t-caption text-[var(--color-ink-faint)]">
        House prices are the confidence-weighted consensus of all {rows.length} of these, plus the
        margin.
        {footnote ? ` ${footnote}` : ''}
      </p>
    </>
  );
};
