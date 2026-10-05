import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import type { GameLine } from '../../lib/mediaOdds';
import { formatAmerican, HOUSE_MARGIN, isSplit, SPLIT_DISAGREEMENT } from '../../lib/mediaOdds';
import { MEDIA_MARKS_SQUARE } from './mediaImages';
import { Panel, SegmentedControl, TeamLogo } from '../ui';

/**
 * ============================================================================
 * THE COLUMN WIDTH IS BUILT FROM THE OUTLET COUNT, NOT WRITTEN AS `3`
 * ============================================================================
 *
 * The grid template used to be `[minmax(0,1fr)_repeat(3,72px)_minmax(120px,0.9fr)]` while the body
 * mapped over `MEDIA_PROFILES`. With three outlets that was correct. With nine it declared three
 * columns and rendered nine, so on desktop the last six outlet picks were laid out in the HOUSE cell
 * and clipped, and on mobile the `lg:hidden` fallback printed all nine inline with no header to
 * align them to. Nothing errored -- a grid silently overflowing its template is not a type error --
 * so it read as a styling complaint rather than as a layout bug.
 *
 * `OUTLET_COUNT` is the single number both the template and the header derive from, so a tenth
 * forecaster widens the table instead of silently losing six columns.
 *
 * ============================================================================
 * THE TABLE IS A BOARD OF OPINIONS, NOT A LIST OF PRICES
 * ============================================================================
 *
 * Each outlet cell used to print that outlet's posted price with the picked club beneath it, the
 * price in `t-stat` and the crest in a 16px `h-4` beneath it. It now prints the club alone, at 32px,
 * with the price on hover. The tab was renamed to "Who They're On" accordingly, and the mobile
 * fallback was changed to match, because a phone view and a desktop view saying different things
 * about one table is worse than either of them on its own.
 *
 * The house price stays in its own column and is now the only number left on the table that is not
 * somebody's opinion. It is derived from all of them rather than being one of them, which is the
 * whole argument for keeping it visually separate from the outlet columns.
 *
 * ============================================================================
 * THE CREST IS THE CELL, AND SWAPPING IS WHAT "MAKE IT BIGGER" MEANT
 * ============================================================================
 *
 * The request was to give the crest the vertical space. The reason it did not have any is worth
 * recording, because it is not a size problem: the price was the cell's subject and the crest was a
 * footnote to it. So the fix is to swap which of the two is primary, not to grow the image from 16px
 * to 20px and leave the number on top -- which would have kept the crest the smaller thing and
 * satisfied nothing.
 *
 * Nine marks in a header row is a grid of anonymous squares, so each column also carries the
 * reporter's first name. That costs one line ONCE per table rather than once per row.
 *
 * The OUTLIER RING survives, and it is why this is not purely decorative. `line.outlier` is the
 * outlet furthest from the rest on that game -- a per-column fact the house disagreement figure does
 * NOT carry, since that is a widest-pair gap and says nothing about which column produced it. Without
 * the ring the table loses its only per-outlet signal.
 *
 * ============================================================================
 * THE HOUSE LINE IS THE MEAN OF PROBABILITIES, NOT OF PRICES
 * ============================================================================
 *
 * Prices are not linear in probability, so an arithmetic mean of American odds is not the consensus of
 * anything -- it is the mean of nine numbers that each happened to be rounded for money.
 */
export const MediaOddsSlate: React.FC<{
  lines: GameLine[];
  slateDate: string | null;
}> = ({ lines, slateDate }) => {
  const gridTemplate = OUTLET_COLUMNS[OUTLET_COUNT] ?? OUTLET_COLUMNS[9];

  /*
    THE FULL BOARD AND THE SPLIT GAMES, BOTH REACHABLE.

    All games is the default, and it has to be. The nine columns are the product -- the outlier ring
    is only meaningful against the set it is an outlier OF, and a column shown beside four others that
    agree with each other says much less than the same column shown beside eight. Filtering to the
    splits is a reading convenience on top of that, not a replacement for it, so it is a toggle and
    not a default.

    The threshold is `isSplit`, the same predicate that colours the house price in each row, and that
    is the entire reason for extracting it into `mediaOdds`. If the filter used its own number the
    filtered view would quietly disagree with the colour coding in the unfiltered one, and the reader
    would see a table of rows all marked "split" and have no idea why any row ever was not.

    The count is stated rather than left to be inferred from a shorter list, because "9 games"
    becoming "3 games" with no explanation reads as the slate having shrunk.
  */
  const [onlySplit, setOnlySplit] = React.useState(false);
  const visible = onlySplit ? lines.filter((line) => isSplit(line.disagreement)) : lines;
  const splitCount = lines.reduce((n, line) => n + (isSplit(line.disagreement) ? 1 : 0), 0);

  return (
    <Panel className="overflow-hidden">
      {/*
        NO CHROME BAR HERE, deliberately, and this used to be a `bare` prop.

        The table renders inside the tab panel, which already carries a title and a count for whatever
        tab is showing. With a bar of its own, the heading appeared twice within 40px of itself and the
        second copy carried the same date and game count as the first -- which reads as two components
        disagreeing rather than as a heading.

        It was a prop for a while because the component was exported and might be used standalone. It
        is not, and has exactly one call site, so the other branch was unreachable: a flag whose only
        passing value is `true` is not configuration, it is a second code path nothing tests. Deleted
        rather than defaulted. The slate date still shows, in the filter bar, where it is still useful.
      */}

      {/*
        THE FILTER, and it stays enabled when the filtered result is EMPTY.

        A control that hides itself at the moment it has nothing to show is a control that disappears
        exactly when the reader most wants to know why -- "there are no split games" and "there is no
        toggle" look identical once the toggle is gone, and it cannot be switched back. So it renders
        regardless, and the empty state below says why in words.
      */}
      {lines.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-chrome-lo)] px-3 py-2">
          <SegmentedControl
            aria-label="Line filter"
            value={onlySplit ? 'split' : 'all'}
            onChange={(value) => setOnlySplit(value === 'split')}
            options={[
              { value: 'all', label: `All ${lines.length}` },
              { value: 'split', label: `Split ${splitCount}` },
            ]}
          />
          <span className="t-caption text-[var(--color-ink-faint)]">
            {onlySplit
              ? `${visible.length} of ${lines.length} games · the ${OUTLET_COUNT} outlets are more than `
                + `${Math.round(SPLIT_DISAGREEMENT * 100)} points apart`
              : `${lines.length} ${lines.length === 1 ? 'game' : 'games'}`
                + (slateDate ? ` · ${slateDate}` : '')}
          </span>
        </div>
      )}

      {lines.length === 0 ? (
        <p className="p-6 t-body text-[var(--color-ink-dim)]">
          {slateDate
            ? 'No games are scheduled on that date.'
            : 'No further games are scheduled this season.'}
        </p>
      ) : visible.length === 0 ? (
        <p className="p-6 t-body text-[var(--color-ink-dim)]">
          The {OUTLET_COUNT} outlets agree on every game tonight -- none is more than{' '}
          {Math.round(SPLIT_DISAGREEMENT * 100)} points apart, so there is nothing to disagree about.
          Switch to All to see the full board.
        </p>
      ) : (
        <div className="p-3">
          {/*
            HEADER, ONCE, so the outlet columns line up with the rows. Below `lg` it is hidden and each
            row prints its own marks inline, because a nine-column table cannot fit a phone.
          */}
          <div
            className={`hidden items-end gap-2 border-b border-[var(--color-chrome-lo)] pb-2 lg:grid ${gridTemplate}`}
          >
            <span className="t-caption text-[var(--color-ink-faint)]">GAME</span>
            {MEDIA_PROFILES.map((profile) => (
              <OutletColumnHeader key={profile.id} mediaId={profile.id} />
            ))}
            <span className="t-caption text-right text-[var(--color-ink-faint)]">HOUSE</span>
          </div>

          {visible.map((line) => (
            <GameOddsRow key={line.gameId} line={line} gridTemplate={gridTemplate} />
          ))}

          <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
            Each column is one outlet and each crest is the club they are backing on that game -- the
            side their own price favoured, so the ring and the crest can never contradict a number. A
            ringed crest marks the outlet furthest from the rest. The house price is the mean of the{' '}
            {OUTLET_COUNT} probabilities with a {Math.round(HOUSE_MARGIN * 100)}% margin applied, and
            the figure beside it is the widest gap between any two of them. Individual outlet prices are
            not printed here; they are on every card in MacroBet.
          </p>
        </div>
      )}
    </Panel>
  );
};

/**
 * The one number the grid template and the header are both derived from, so they cannot disagree.
 *
 * NOT exported. It was, alongside an `outletIds()` helper that nothing called -- both were speculative
 * API surface invented during this change and used by nobody. The count is derived from
 * `MEDIA_PROFILES` at the point of use; a second export of the same value is a third place to forget
 * to update when a forecaster is added, which is the failure this whole header is about.
 */
const OUTLET_COUNT = MEDIA_PROFILES.length;

/**
 * Grid templates by outlet count, because Tailwind only emits classes it can see literally.
 *
 * Widths are set by the CREST, not by the price it replaced. A cell used to hold "+145" beside a 16px
 * crest and needed 60px to stop the digits touching; it now holds one 32px crest with a 2px outlier
 * ring, so 44px is generous and the difference across nine columns goes back to the matchup column,
 * which is the only column whose content is a length nobody chose.
 *
 * Narrowing them is a side effect of the redesign rather than its goal, but a 32px crest floating in
 * 60px of cell with 28px of dead air either side looks like an alignment accident, which is the read
 * worth avoiding. Selected by `OUTLET_COUNT`, with the nine-outlet template as the fallback for any
 * count not listed -- an outlet count that grows past what is declared gets the narrowest layout,
 * which is degraded but never broken.
 */
const OUTLET_COLUMNS: Record<number, string> = {
  3: 'grid-cols-[minmax(0,1fr)_repeat(3,56px)_minmax(150px,0.9fr)]',
  4: 'grid-cols-[minmax(0,1fr)_repeat(4,52px)_minmax(150px,0.9fr)]',
  5: 'grid-cols-[minmax(0,1fr)_repeat(5,48px)_minmax(150px,0.9fr)]',
  6: 'grid-cols-[minmax(0,1fr)_repeat(6,46px)_minmax(140px,0.9fr)]',
  7: 'grid-cols-[minmax(0,1fr)_repeat(7,44px)_minmax(140px,0.9fr)]',
  8: 'grid-cols-[minmax(0,1fr)_repeat(8,44px)_minmax(134px,0.85fr)]',
  9: 'grid-cols-[minmax(0,1fr)_repeat(9,44px)_minmax(130px,0.8fr)]',
};

/**
 * One outlet's column head: the mark, and the reporter's first name beneath it.
 *
 * There is deliberately NO crest in the header. An earlier draft of this file put one there and the
 * comment claimed the header carried "the club they are backing" -- which is not a thing a header can
 * do, since it spans every game on the slate and has no single club to name. The crest belongs in the
 * cell, where it is the club for that specific row. That is where it is, and it is the whole cell.
 */
const OutletColumnHeader: React.FC<{ mediaId: MediaId }> = ({ mediaId }) => {
  const profile = MEDIA_PROFILES.find((entry) => entry.id === mediaId);
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5">
      <img
        src={MEDIA_MARKS_SQUARE[mediaId]}
        alt={profile?.outlet ?? mediaId}
        title={profile?.outlet}
        className="h-6 w-6 object-contain"
      />
      <span className="text-[9px] uppercase leading-none tracking-wide text-[var(--color-ink-faint)]">
        {profile?.name?.split(' ')[0] ?? mediaId}
      </span>
    </div>
  );
};

const GameOddsRow: React.FC<{ line: GameLine; gridTemplate: string }> = ({ line, gridTemplate }) => {
  const split = isSplit(line.disagreement);

  return (
    <div
      className={`mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 lg:gap-2 ${gridTemplate}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <TeamLogo team={line.awayTeam} sizeClass="h-8 w-8" />
        <span className="truncate t-stat-sm">{line.awayTeam.city}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true" />
        <TeamLogo team={line.homeTeam} sizeClass="h-8 w-8" />
        <span className="truncate t-stat-sm">{line.homeTeam.city}</span>
      </div>

      {MEDIA_PROFILES.map((profile) => {
        const isOutlier = line.outlier === profile.id;
        const backingAway = line.probability[profile.id] > 0.5;
        const backed = backingAway ? line.awayTeam : line.homeTeam;
        return (
          <div
            key={profile.id}
            className="hidden min-w-0 items-center justify-center lg:flex"
            title={`${profile.outlet} · ${formatAmerican(line.odds[profile.id])} · backing ${backed.city}`}
          >
            <div className="relative">
              <TeamLogo team={backed} sizeClass="h-8 w-8" />
              {isOutlier && (
                <span
                  className="pointer-events-none absolute inset-0 rounded-sm"
                  style={{ boxShadow: `inset 0 0 0 2px var(--color-media-${profile.accent})` }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2">
        <span
          className="t-stat-lg tabular-nums"
          style={{ color: split ? 'var(--color-warn)' : 'var(--color-gold-hi)' }}
        >
          {formatAmerican(line.houseOdds)}
        </span>
        <span className="w-[6ch] text-right t-caption tabular-nums text-[var(--color-ink-faint)]">
          {Math.round(line.disagreement * 100)}pt
        </span>
      </div>

      {/*
        MOBILE: mark then crest, matching the desktop cell.

        This printed the price before, so the phone view and the desktop view were saying different
        things about the same table. It now carries the same information in the same form, at 20px
        rather than 32px because nine of them have to wrap inside a phone. The house price stays, being
        the one number here that is not an outlet's opinion.

        No tooltip exists on a touch screen, so the price is genuinely unreachable in this view.
        Accepted: the odds are on every MacroBet card, and this view exists to say WHO is on.
      */}
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--color-chrome-lo)] pt-2 lg:hidden">
        {MEDIA_PROFILES.map((profile) => {
          const backingAway = line.probability[profile.id] > 0.5;
          const backed = backingAway ? line.awayTeam : line.homeTeam;
          return (
            <span key={profile.id} className="flex items-center gap-1">
              <img
                src={MEDIA_MARKS_SQUARE[profile.id]}
                alt=""
                aria-hidden="true"
                className="h-3.5 w-3.5 object-contain"
              />
              <TeamLogo team={backed} sizeClass="h-5 w-5" />
            </span>
          );
        })}
        <span className="t-caption text-[var(--color-ink-faint)]">
          house {formatAmerican(line.houseOdds)}
        </span>
      </div>
    </div>
  );
};