import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { MediaId } from '../../data/media';
import { MEDIA_PROFILES } from '../../data/media';
import type { GameLine } from '../../lib/mediaOdds';
import { formatAmerican, HOUSE_MARGIN } from '../../lib/mediaOdds';
import { MEDIA_MARKS_SQUARE } from './mediaImages';
import { Panel, TeamLogo } from '../ui';

/**
 * ===========================================================================
 * THE COLUMN WIDTH IS BUILT FROM THE OUTLET COUNT, NOT WRITTEN AS `3`
 * ===========================================================================
 *
 * The grid template used to be `[minmax(0,1fr)_repeat(3,72px)_minmax(120px,0.9fr)]` while the
 * body mapped over `MEDIA_PROFILES`. With three outlets that was correct. With nine it declared three
 * columns and rendered nine, so on desktop the last six outlet prices were laid out in the HOUSE
 * cell and clipped, and on mobile the `lg:hidden` fallback printed all nine inline with no header to
 * align them to. Nothing errored -- a grid silently overflowing its template is not a type error --
 * so it read as a styling complaint rather than as a layout bug.
 *
 * `OUTLET_COUNT` is the single number both the template and the header derive from, so a tenth
 * forecaster widens the table instead of silently losing six columns.
 *
 * ===========================================================================
 * THE PICK CREST LIVES IN THE CELL, NOT THE HEADER
 * ===========================================================================
 *
 * The request, and it is right: nine columns of bare prices with nine identical marks above them asks
 * the reader to hold a mark-to-column association across a whole screen.
 *
 * The answer is not a crest in the header. A header row spans every game on the slate, so it has no
 * single club to name -- an early draft here claimed it did, which is a comment describing a component
 * that cannot exist. The crest goes UNDER each price instead, where it is the club for that specific
 * game: Sharply is found by looking for the club he is on in the row you care about, not by tracing a
 * row back to a mark. Per-cell also means the association is never wrong, because there is no shared
 * header left to disagree with.
 *
 * The crest is `awayTeam` above a half and `homeTeam` below it -- the same `probability` the price is
 * converted from, so a cell cannot show a pick its own price contradicts.
 *
 * ===========================================================================
 * THE HOUSE LINE STAYS IN ITS OWN COLUMN, SEPARATE FROM THE OUTLETS
 * ===========================================================================
 *
 * The house price is the mean of the outlet PROBABILITIES with a margin, not the mean of the prices,
* so it is not one more opinion in the row. Putting it last and outside the outlet columns keeps that
* visible: the outlets are nine independent reads, the house is a derived number over all of them.
*
* Prices are not linear in probability, so an arithmetic mean of American odds is not the consensus of
* anything -- it is the mean of nine numbers that each happened to be rounded for money.
 */
export const MediaOddsSlate: React.FC<{
  lines: GameLine[];
  slateDate: string | null;
}> = ({ lines, slateDate }) => {
  const gridTemplate = OUTLET_COLUMNS[OUTLET_COUNT] ?? OUTLET_COLUMNS[9];

  return (
    <Panel className="overflow-hidden">
      {/*
        NO CHROME BAR HERE, deliberately, and this used to be a `bare` prop.

        The table renders inside the tab panel, which already carries a title and a count for whatever
        tab is showing. With a bar of its own, "Published Lines" appeared twice within 40px of itself
        and the second copy carried the same date and game count as the first -- which reads as two
        components disagreeing rather than as a heading.

        It was a prop for a while because the component was exported and might be used standalone. It
        is not, and has exactly one call site, so the other branch was unreachable: a flag whose only
        passing value is `true` is not configuration, it is a second code path nothing tests. Deleted
        rather than defaulted. The slate date still shows, in the footnote, where it is still useful.
      */}
      {lines.length === 0 ? (
        <p className="p-6 t-body text-[var(--color-ink-dim)]">
          {slateDate
            ? 'No games are scheduled on that date.'
            : 'No further games are scheduled this season.'}
        </p>
      ) : (
        <div className="p-3">
          {/*
            HEADER, ONCE, so the outlet columns line up with the rows. Below `lg` it is hidden and each
            row prints its own prices inline, because a nine-column table cannot fit a phone.
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

          {lines.map((line) => (
            <GameOddsRow key={line.gameId} line={line} gridTemplate={gridTemplate} />
          ))}

          <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
            Prices are for the away club, so the club under each outlet's mark is what they are backing
            to win outright. The house line is the mean of the nine probabilities with a{' '}
            {Math.round(HOUSE_MARGIN * 100)}% margin applied, then converted back to a price.
            Disagreement is the widest gap between any two outlets on the same game.
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
 * to update when a forecaster is added, which is the failure this whole section is about.
 */
const OUTLET_COUNT = MEDIA_PROFILES.length;

/**
 * Grid templates by outlet count, because Tailwind only emits classes it can see literally.
 *
 * Widths tighten as outlets are added: three outlets can afford 88px columns, nine cannot, and at
 * nine the matchup column has to give ground or the table overflows a 1280px screen. Selected by
 * `OUTLET_COUNT`, with the nine-outlet template as the fallback for any count not listed -- an outlet
 * count that grows past what is declared gets the narrowest layout, which is degraded but never
 * broken. A silently-wrong column count is what this replaces.
 */
const OUTLET_COLUMNS: Record<number, string> = {
  3: 'grid-cols-[minmax(0,1fr)_repeat(3,88px)_minmax(140px,0.9fr)]',
  4: 'grid-cols-[minmax(0,1fr)_repeat(4,84px)_minmax(140px,0.9fr)]',
  5: 'grid-cols-[minmax(0,1fr)_repeat(5,78px)_minmax(140px,0.9fr)]',
  6: 'grid-cols-[minmax(0,1fr)_repeat(6,72px)_minmax(130px,0.9fr)]',
  7: 'grid-cols-[minmax(0,1fr)_repeat(7,68px)_minmax(130px,0.9fr)]',
  8: 'grid-cols-[minmax(0,1fr)_repeat(8,64px)_minmax(124px,0.85fr)]',
  9: 'grid-cols-[minmax(0,1fr)_repeat(9,60px)_minmax(120px,0.8fr)]',
};

/**
 * One outlet's column head: the mark, and the reporter's first name beneath it.
 *
 * The name is there because nine identical marks in a row is a grid of anonymous squares. "QUINCY"
 * costs one line of height once per table and makes a column findable by reading rather than by
 * tracing -- which matters more at nine columns, not less, since the eye has more chances to land on
 * the wrong one.
 *
 * There is deliberately NO crest here. An earlier version of this comment claimed the header carried
 * the club each outlet was backing, which is not a thing a header can do: the pick is per GAME, and
 * one header row sits above fourteen of them. The crest belongs in the cell, where it can be the club
 * for that specific row -- which is where it ended up, under each price.
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
  const split = line.disagreement >= 0.12;

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

      {/*
        THE OUTLET COLUMNS: price, with the picked club beneath it.

        The price tints when this outlet is the row's outlier -- the furthest from the median of the
        nine -- which is the whole diagnostic value of the column. The crest under it is the pick, so
        the column answers "what does this outlet think, and on whom" without the reader cross-
        referencing the header.
      */}
      {MEDIA_PROFILES.map((profile) => {
        const isOutlier = line.outlier === profile.id;
        const backingAway = line.probability[profile.id] > 0.5;
        const backed = backingAway ? line.awayTeam : line.homeTeam;
        return (
          <div
            key={profile.id}
            className="hidden min-w-0 flex-col items-center gap-0.5 lg:flex"
            title={`${profile.outlet} · ${formatAmerican(line.odds[profile.id])} · backing ${backed.city}`}
          >
            <span className="flex items-center gap-1">
              <span
                className="t-stat tabular-nums"
                style={{ color: isOutlier ? `var(--color-media-${profile.accent}-hi)` : undefined }}
              >
                {formatAmerican(line.odds[profile.id])}
              </span>
              {isOutlier && (
                <span
                  className="h-1.5 w-1.5"
                  style={{ background: `var(--color-media-${profile.accent})` }}
                  aria-hidden="true"
                />
              )}
            </span>
            <TeamLogo team={backed} sizeClass="h-4 w-4" />
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

      {/* Mobile: the nine prices inline, each labelled, since the header row is hidden. */}
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-chrome-lo)] pt-2 lg:hidden">
        {MEDIA_PROFILES.map((profile) => (
          <span key={profile.id} className="flex items-center gap-1">
            <img
              src={MEDIA_MARKS_SQUARE[profile.id]}
              alt=""
              aria-hidden="true"
              className="h-3.5 w-3.5 object-contain"
            />
            <span className="t-stat-sm tabular-nums">{formatAmerican(line.odds[profile.id])}</span>
          </span>
        ))}
        <span className="t-caption text-[var(--color-ink-faint)]">
          house {formatAmerican(line.houseOdds)}
        </span>
      </div>
    </div>
  );
};