import React, { useMemo, useState } from 'react';
import { Mic } from 'lucide-react';
import { ClubBandRow, Panel, SegmentedControl } from '../ui';
import type { Game, Team } from '../../types';
import {
  type BoothBoard,
  type BoothBoardId,
  deriveBoothBoards,
} from '../../lib/analytics/boothMetrics';
import type { TeamId } from '../../data/teamColors';
import garySallowPortrait from '../../assets/media/garysallow.png';
import baseballPersonified from '../../assets/baseballpersonified.jpg';

/**
 * ============================================================================
 * BOOTH METRICS
 * ============================================================================
 *
 * Eight ranked boards on the things a box score cannot hold, presented from the
 * booth rather than from the league office. It is a LEAGUE leaf, sitting between
 * Leaders and Awards: a ranked reading of the league, in the same run as both,
 * found on the way down from the tables to the season honours.
 *
 * WHY THE BYLINE IS PART OF THE PAGE, NOT DECORATION
 *
 * Every other board in this app is the league's own arithmetic. These are not:
 * they are one observer's cut at a question the numbers only partly answer, and
 * attributing them to Gary Sallow is what keeps that honest. A ranking with a
 * name on it is a claimed read, not a fact, and the header says so.
 *
 * THE ARITHMETIC LIVES IN `lib/analytics/boothMetrics`, NOT HERE.
 *
 * This file is presentation: it derives the eight boards once per input change and
 * draws them. Every definition, tie-break and empty-sample rule is in the module,
 * where `tools/checkBoothMetrics.ts` can build games by hand and assert the exact
 * answer. A second implementation of any board's rule would be a second definition
 * waiting to disagree with the first.
 *
 * ROWS WEAR THE CLUB'S COLOUR, THE WAY THE RESULTS CARD DOES.
 *
 * A ranked row is drawn like one band of the SCORES -> Results scorebug: the club's
 * colour as the row's fill, its full-strength ink as the leading edge, and the crest
 * large in front of the figures. The fill is `clubTint`, not the raw palette primary,
 * for the reason `clubColour.ts` exists: three of the 32 primaries are effectively
 * invisible against this app's panel and would render a row you could not see. The
 * tint lifts while holding hue, so all 32 clubs get the same treatment and none of
 * them is the one club whose colour happens to be bright enough. Same helper, same
 * 0.22 share, as `ScorebugCard`'s band -- one definition of "this club's colour"
 * rather than two that can disagree.
 *
 * EIGHT BOARDS BECOME FOUR TABS, TWO APART.
 *
 * Stacked end to end the eight boards are a long scroll, and a reader who came for
 * the weather boards should not have to pass six others to reach them. The tabs are
 * grouped by the question, not by the order the module happens to return them in:
 * what a team scores, whether it wins, how it wins the close ones, and how it wins
 * in the weather. Each tab is a coherent read and holds at most two boards, so one
 * screenful is one idea.
 */

export interface BoothMetricsProps {
  /** Every club, for the crest and the colour on each row. */
  teams: Team[];
  /** Every game the app holds. Only completed regular-season games are read. */
  games: Game[];
  /**
   * The season the screen is showing. Passed so a board can never read two seasons at once; the app
   * holds one at a time, but the module makes the scope explicit rather than assumed.
   */
  seasonYear?: number;
}

/**
 * Gary Sallow's byline portrait.
 *
 * The image is the byline, so it is drawn at the size of a person rather than of an icon: the
 * circular plate this used to sit in made it read as an avatar badge and shrank the art inside it,
 * which is exactly what the brief asked to stop doing. It is not mask-cropped at all -- the source
 * is a square, and presenting the whole square large is what makes it look like a portrait rather
 * than like a chip. The initials remain only as the load-failure fallback, and they too are plain
 * text rather than a plate.
 */
const GaryPortrait: React.FC = () => {
  const [failed, setFailed] = useState(false);

  return (
    <span className="inline-flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden md:h-28 md:w-28">
      {failed ? (
        <span
          aria-hidden="true"
          className="font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-faint)]"
          style={{ fontSize: 34 }}
        >
          GS
        </span>
      ) : (
        <img
          src={garySallowPortrait}
          alt="Gary Sallow"
          width={112}
          height={112}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
};

/**
 * The tabs, in the order they appear. Ids come from the module so a renamed board is a compile error
 * here rather than a tab that silently draws nothing.
 */
const BOARD_TABS: ReadonlyArray<{
  id: string;
  label: string;
  boardIds: [BoothBoardId, BoothBoardId];
}> = [
  { id: 'scoring', label: 'Scoring', boardIds: ['second_half_kings', 'fence_leapers'] },
  { id: 'winning', label: 'Winning', boardIds: ['giant_slayers', 'comeback_kids'] },
  { id: 'close', label: 'Close Games', boardIds: ['one_run_specialists', 'shutout_wins'] },
  { id: 'weather', label: 'Weather', boardIds: ['heat_seeking_missiles', 'cold_blooded_killers'] },
];

/**
 * THE ROW HEIGHT IS THE DESIGN'S ONLY FREE NUMBER HERE.
 *
 * 72px is the Booth's chosen row height. Everything else about the band -- the fill, the edge and
 * the crest crop -- is the shared `ClubBandRow` primitive, so the answer to "what does a club row
 * look like" is written once in `ui/ClubBand.tsx` rather than twice.
 */
const ROW_MIN_H = 72;

/**
 * One ranked row: the rank, the club's crest cropped into the club's own colour, and the figures.
 *
 * The city and the club name are deliberately gone from view. The row already says who it is three
 * other ways -- the colour, the crest, and the ordinal -- and the name was the slowest of the four to
 * read at arm's length. What is kept is what the board is actually ranking: the supporting figures
 * and the primary value. The name survives for a screen reader and a hover tooltip, so dropping it
 * from the page has not dropped it from the accessible name.
 */
const BoardRow: React.FC<{ rank: number; row: BoothBoard['rows'][number]; team: Team | null }> = ({
  rank,
  row,
  team,
}) => {
  // The row carries city/name even when the team lookup fails; the crest and the colour are the only
  // things that need a real `Team`, and their absence must not hide the row.
  const teamId = (team?.id ?? row.teamId) as TeamId;
  const city = team?.city ?? row.teamCity;
  const name = team?.name ?? row.teamName;

  return (
    <ClubBandRow team={team} teamId={teamId} height={ROW_MIN_H} rank={rank} name={`${city} ${name}`}>
      <p className="min-w-0 flex-1 truncate t-caption text-[var(--color-ink-dim)]">
        {row.support.map((stat) => `${stat.value} ${stat.label}`).join('  ·  ')}
      </p>

      <span className="shrink-0 t-stat-lg text-[var(--color-gold)]">{row.primaryDisplay}</span>
    </ClubBandRow>
  );
};

/**
 * One board. The title and the question are the whole header -- no chrome bar and no board number.
 * The chrome bar dimmed the title against its bevel and the ordinal ("02", "03") was counting the
 * boards rather than ranking the teams, which is not what a reader came for: the title says what the
 * board is and the question says what it measures. The body is the ranked rows, or an explicit
 * reason there are none. A board is never padded to eight.
 */
const BoardPanel: React.FC<{ board: BoothBoard; teamById: Map<string, Team> }> = ({ board, teamById }) => (
  <Panel className="flex flex-col overflow-hidden">
    <div className="border-b border-[var(--color-chrome-lo)] px-4 py-3">
      <h2 className="t-h3">{board.title}</h2>
      <p className="t-caption mt-1 text-[var(--color-ink-dim)]">{board.question}</p>
    </div>

    {board.rows.length > 0 ? (
      <ul className="flex flex-col divide-y divide-[var(--color-chrome-lo)]">
        {board.rows.map((row, index) => (
          <BoardRow key={row.teamId} rank={index + 1} row={row} team={teamById.get(row.teamId) ?? null} />
        ))}
      </ul>
    ) : (
      <p className="px-4 py-6 t-body text-[var(--color-ink-faint)]">
        {board.emptyReason ?? 'No data yet.'}
      </p>
    )}

    {board.note ? (
      <p className="border-t border-[var(--color-chrome-lo)] px-4 py-2 t-caption text-[var(--color-ink-faint)]">
        {board.note}
      </p>
    ) : null}
  </Panel>
);

export const BoothMetrics: React.FC<BoothMetricsProps> = ({ teams, games, seasonYear }) => {
  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const boards = useMemo(
    () => deriveBoothBoards(teams, games, seasonYear),
    // `teams` and `games` are the only inputs that change the answer; `seasonYear` is derived from
    // them upstream but is passed explicitly and so is a dependency in its own right.
    [teams, games, seasonYear],
  );

  const boardById = useMemo(() => new Map(boards.map((board) => [board.id, board])), [boards]);
  const [activeTab, setActiveTab] = useState(BOARD_TABS[0].id);

  const active = BOARD_TABS.find((tab) => tab.id === activeTab) ?? BOARD_TABS[0];
  // Filtered, not asserted: a board that somehow went missing should thin the tab, never throw.
  const visibleBoards = active.boardIds
    .map((id) => boardById.get(id))
    .filter((board): board is BoothBoard => board !== undefined);

  return (
    <section className="space-y-5">
      <Panel variant="hero" className="p-4 md:p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-1 basis-72">
            <p className="t-label text-[var(--color-ink-faint)]">
              <Mic className="mr-2 inline h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
              Booth Metrics
            </p>
            <h1 className="t-h1 mt-1">What The Numbers Don&apos;t Tell You</h1>
            <p className="t-body mt-2 max-w-2xl text-[var(--color-ink-dim)]">
              Eight boards that rank the league by the things a box score never prints.
            </p>

            <figure className="mt-5 flex items-center gap-3">
              <GaryPortrait />
              <figcaption>
                <span className="block t-caption text-[var(--color-ink-faint)]">Brought to you by</span>
                <span className="block t-label text-[var(--color-ink)]">Gary Sallow</span>
              </figcaption>
            </figure>
          </div>

          {/*
            THE PAGE'S THUMBNAIL.

            The feature is a magazine piece -- a named columnist's read on the season -- so it gets a
            cover. It is the artwork rather than a chart: `baseballpersonified.jpg` is the cover of the
            column's publication, and it sits at the masthead where a cover belongs. The 3:4 source is
            kept at 3:4 rather than cropped to a square, because a cover that has been squared off stops
            reading as a cover.
          */}
          <figure className="shrink-0">
            <img
              src={baseballPersonified}
              alt="Baseball Personified magazine cover"
              width={1792}
              height={2400}
              loading="lazy"
              decoding="async"
              className="aspect-[3/4] w-32 border border-[var(--color-chrome-lo)] object-cover shadow-lg md:w-36"
            />
          </figure>
        </div>
      </Panel>

      {/*
        The tab strip scrolls rather than wraps on a narrow screen: four two-word labels do not fit a
        phone at a readable size, and a tab bar that reflows to two rows stops reading as one control.
      */}
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <SegmentedControl
          mode="fill"
          className="min-w-[28rem]"
          aria-label="Booth board groups"
          options={BOARD_TABS.map((tab) => ({ value: tab.id, label: tab.label }))}
          value={active.id}
          onChange={setActiveTab}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {visibleBoards.map((board) => (
          <BoardPanel key={board.id} board={board} teamById={teamById} />
        ))}
      </div>
    </section>
  );
};
