import React, { useCallback, useMemo, useState } from 'react';
import { BarChart3, Table2, Users } from 'lucide-react';
import type { Game, Team } from '../../types';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID, MEDIA_PROFILES } from '../../data/media';
import { buildMediaReads, type MediaReadInput } from '../../lib/mediaReads';
import { buildGameLine, getNextSlateDate, HOUSE_MARGIN, type GameLine } from '../../lib/mediaOdds';
import { usePropBoard } from '../../hooks/usePropBoard';
import type { PropFocus } from '../../hooks/useBettingSlip';
import { Panel, SegmentedControl } from '../ui';
import { MediaRail } from './MediaCard';
import { MediaDisagreementTable, MediaRanking } from './MediaTables';
import { MediaOddsSlate } from './MediaOddsSlate';
import { MediaPropBoard } from './MediaPropCards';
import { MediaDetailsModal } from './MediaDetailsModal';

/**
 * Which reference table is showing.
 *
 * Three named stops rather than a boolean `read`/`split`. A two-way switch cannot give the
 * disagreement table its own tab without either losing the per-outlet ranking or making the control
 * mean different things per position -- which is what it used to do, and why the disagreement view was
 * reachable only by putting the ranking behind the same switch.
 */
type TableView = 'lines' | 'ranking' | 'disagree';

interface MediaHubProps extends MediaReadInput {
  games: Game[];
  currentDate: string;
  /** Navigate to the betting page. */
  onNavigateToBetting?: () => void;
  /**
   * Identify a prop on the betting page.
   *
   * Separate from `onNavigateToBetting` because the two can disagree about
   * order, and the page has to be mounted before the id is meaningful -- a prop
   * id handed to a page that is not rendered yet has nothing to highlight and is
   * silently lost. So navigation happens first, and the reference travels
   * separately.
   *
   * An object, not two positional arguments, and that is not a style choice. The
   * project's tsconfig does not enable strictFunctionTypes, so parameters are
   * checked bivariantly: a two-argument function assigned to a one-argument slot
   * type-checks fine and then silently discards the second argument at runtime.
   * That is exactly what happened here. The outlet was passed as a second
   * positional argument into focusProp, which takes a single object, so
   * focusedProp received a bare prop id string with no outlet on it -- and the
   * betting page, which keys its rows by outlet and prop, matched no row at all.
   * Nothing failed: no type error, no console error, no crash. The highlight
   * simply never appeared. As a single object the same mistake is a missing or
   * misspelled property, which is reported in either strictness mode.
   */
  onPropFocus?: (focus: PropFocus) => void;
}

/**
 * The Media.
 *
 * Three forecasters, each with a live read on all thirty-two clubs, the prices
 * they are posting for the next slate, and the table showing where the three
 * cannot agree.
 *
 * The two club tables are one surface with a switcher rather than two stacked.
 * Thirty-two rows twice is the entire page twice over, and the two views answer
 * different questions about the same data: one asks what a single outlet thinks,
 * the other asks where the three part company. Choosing between them by position
 * on the page forces a scroll to answer either.
 *
 * There is deliberately no track record. Nothing has settled yet, so any
 * accuracy figure would be invented. What is shown is the basis of each read --
 * the actual weights -- which is auditable, and each outlet's stated weakness,
 * which is what a manager needs in order to know when to believe it and when to
 * fade it. Brier score arrives free once settlement exists.
 */
export const MediaHub: React.FC<MediaHubProps> = ({
  games, currentDate, onNavigateToBetting, onPropFocus, ...input
}) => {
  const [selectedId, setSelectedId] = useState<MediaId>('hollis');
  const [tableView, setTableView] = useState<TableView>('lines');
  /**
   * Whether the selected outlet's detail panel is open.
   *
   * Clicking a character collapses their details box, which means the click is a
   * toggle rather than a selection -- the same control both picks the outlet and
   * shows or hides its argument. Selecting without toggling would make the
   * collapse unreachable, because there is no other affordance for it, and
   * burying the collapse inside the panel it collapses is a circular way to reach
   * a control.
   *
   * One panel for all three, not one per outlet: the point of the box is to
   * expand whichever character was clicked, and three collapsed rows stacked
   * would be the same page it is now with more furniture.
   */
  /** Which outlet's popup is open, or null. */
  const [detailsMediaId, setDetailsMediaId] = useState<MediaId | null>(null);
  const profile = MEDIA_BY_ID[selectedId];

  const readInput = input as MediaReadInput;
  const { reads, scores, spread, disagreements } = useMemo(() => buildMediaReads(readInput), [readInput]);

  const slateDate = useMemo(() => getNextSlateDate(games, currentDate), [currentDate, games]);

  const lines = useMemo<GameLine[]>(() => {
    if (!slateDate) return [];
    return games
      .filter((game) => game.date === slateDate)
      .map((game) => {
        const away = input.teams.find((team) => team.id === game.awayTeam);
        const home = input.teams.find((team) => team.id === game.homeTeam);
        if (!away || !home) return null;
  /*
   * DERIVED FROM THE PROFILE LIST, NOT THREE HARDCODED KEYS.
   *
   * This was a literal with three entries, and adding five forecasters broke it at compile
   * time -- which is the type system doing precisely the job it is there for. Iterating
   * MEDIA_PROFILES means the ninth forecaster needs no change here at all, and a scorer that
   * forgets an outlet gets a neutral 0.5 rather than a missing key.
   */
  const scoreFor = (teamId: string): Record<MediaId, number> =>
    Object.fromEntries(
      MEDIA_PROFILES.map((profile) => [profile.id, scores[profile.id].get(teamId) ?? 0.5]),
    ) as Record<MediaId, number>;
        return buildGameLine({ game, away, home, awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread });
      })
      .filter((line): line is GameLine => line !== null)
      .sort((a, b) => a.awayTeam.city.localeCompare(b.awayTeam.city));
  }, [games, input.teams, scores, slateDate, spread]);

  const hasSeasonOutput = input.teams.some((team) => team.wins + team.losses > 0);

  /*
    THE PICK EACH OUTLET IS CURRENTLY BACKING, for the rail.

    One rule, and it is the simplest one that answers the question a crest implies: an outlet's pick is
    the club it is most confident about tonight -- the single game on the slate where its own price is
    furthest from a coin flip, and the side that price is on.

    Derived from `lines`, the same array the Published Lines table renders, so a crest on a rail tile
    and the price in that column cannot disagree about the same outlet's opinion. Deriving it a second
    time from `scores` would be a second source of truth for one question, which is the class of bug
    this page has collected once already.

    A vote-counting version was written first and was worse: an outlet with four 51/49 calls and one
    80/20 call "wins" on vote count, which is the opposite of what a manager asking who this reporter
    likes is asking. Confidence wins instead.

    An outlet with no games on the slate is simply absent from the map and renders no crest --
    deliberately, since a dashed placeholder in a 100px tile reads as a broken image rather than as
    "nothing scheduled".
  */
  const picksByMediaId = useMemo(() => {
    const best = new Map<MediaId, { lean: number; teamId: string }>();
    for (const line of lines) {
      for (const profile of MEDIA_PROFILES) {
        const p = line.probability[profile.id];
        const lean = Math.abs(p - 0.5) * 2;
        const current = best.get(profile.id);
        if (!current || lean > current.lean) {
          best.set(profile.id, { lean, teamId: p > 0.5 ? line.awayTeam.id : line.homeTeam.id });
        }
      }
    }
    const out: Partial<Record<MediaId, Team>> = {};
    best.forEach((entry, mediaId) => {
      const team = input.teams.find((t) => t.id === entry.teamId);
      if (team) out[mediaId] = team;
    });
    return out;
  }, [lines, input.teams]);

  /*
   * The prop board.
   *
   * Shared with the betting page through usePropBoard rather than built here.
   * That is the only way the guarantee the betting page makes in its own header
   * -- that a bettor can never be shown a number The Media does not also show --
   * can hold for props. The board is tilted by the outlets' score spreads and
   * shrunk off season aggregates, so two independent builds would agree only for
   * as long as two independent calls to buildMediaReads agreed, and the first
   * divergence would be invisible: the same prop, priced two ways, on two
   * screens, with no way for a manager to tell which one they had staked against.
   */
  /*
   * Win percentage per club, for `selectionAffinity`.
   *
   * Returns null until a club has actually played, which the prop board treats as
   * "no signal" rather than as 0.500. That distinction matters in April: a term that
   * read an unplayed club as average would quietly reward the worst teams on the
   * board, and a term that read it as zero would reward none of them.
   */
  const teamWinPct = useCallback(
    (teamId: string): number | null => {
      const team = input.teams.find((entry) => entry.id === teamId);
      if (!team) return null;
      const played = team.wins + team.losses;
      return played > 0 ? team.wins / played : null;
    },
    [input.teams],
  );

  const { byOutlet: outletProps } = usePropBoard({
    games,
    playerState: readInput.playerState,
    slateDate,
    teamScores: scores,
    scoreSpread: spread,
    teamWinPct,
  });

  const teamCity = useCallback(
    (teamId: string) => input.teams.find((team) => team.id === teamId)?.city ?? '-',
    [input.teams],
  );
  /*
   * The club itself, for the crest on a prop card.
   *
   * `teamCity` stays for the matchup label, which genuinely wants a readable city and
   * is the one place a name is clearer than a crest. The cards want the opposite: a
   * fifteen-card board repeats the same handful of clubs, so a name on every card is
   * fifteen repetitions of something the crest already says, and it costs a line.
   */
  const teamOf = useCallback(
    (teamId: string) => input.teams.find((team) => team.id === teamId),
    [input.teams],
  );

  const matchupLabel = useCallback(
    (gameId: string) => {
      const game = games.find((entry) => entry.gameId === gameId);
      if (!game) return '—';
      return `${teamCity(game.awayTeam)} at ${teamCity(game.homeTeam)}`;
    },
    [games, teamCity],
  );

  const openProp = useCallback(
    (propId: string, mediaId: MediaId) => {
      /*
       * Navigate first, then hand over the reference.
       *
       * A prop id given to a betting page that is not mounted yet has nothing to
       * highlight, and the id is not recoverable afterwards -- it is derived from
       * the game, the player, the stat and the line, none of which the next
       * render knows. So the page is switched first and the reference travels as
       * a separate call, and the popup is closed as part of the same action so it
       * does not reappear over the page that was navigated to.
       */
      setDetailsMediaId(null);
      onNavigateToBetting?.();
      onPropFocus?.({ propId, mediaId });
    },
    [onNavigateToBetting, onPropFocus],
  );

  /**
   * Selecting an outlet.
   *
   * This used to be a toggle -- a second click on the same card collapsed its
   * character box -- because the box lived on the page and needed a way shut. The box
   * is gone; the character is in the details popup, which has a close control and does
   * not need the card to double as one. So selecting is now selecting, and a repeat
   * click does nothing, which is what a selection should do.
   */
  const handleSelect = useCallback((id: MediaId) => {
    setSelectedId(id);
  }, []);

  return (
    <section className="space-y-5">
      <Panel variant="hero" className="p-4 md:p-5">
        <h1 className="t-h1">The Media</h1>
        <p className="t-body mt-2 max-w-3xl text-[var(--color-ink-dim)]">
          Every outlet reads the same league differently, and none of them is adjusted for the others.
          What they disagree about is the interesting part.
        </p>
        {!hasSeasonOutput && (
          <p className="t-caption mt-3 border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2 text-[var(--color-warn)]">
            No season has been played yet. Glorest Press has nothing observed to read, so it is
            currently rating the field on pre-season ratings rather than on results.
          </p>
        )}
      </Panel>

      {/*
        THE OUTLET RAIL, above everything.

        Replaces a three-column grid built for three outlets and fed nine, which wrapped into three
        rows of mastheads and consumed most of a screen before any price appeared. Nine tiles across
        in one row instead: every outlet visible at once, no scrolling, and the props board moved up
        into the space the grid was wasting.
      */}
      <MediaRail
        selectedId={selectedId}
        onSelect={handleSelect}
        onOpenDetails={setDetailsMediaId}
        picksByMediaId={picksByMediaId}
        hasSlate={lines.length > 0}
      />

      {/*
        NO CHARACTER PANEL HERE ANY MORE.

        The thesis, the weights, the stated weakness and the voice samples used to sit
        in a collapsible panel directly under the cards, and the per-outlet detail
        popup repeated all of it. Two copies of the same argument, one of them behind
        a click, and the copy on the page occupying the width of the screen to say
        something a reader had no reason to read before looking at the prices.

        It is now only in the details popup, where it is the entire subject rather than
        a section of a market page. The space it held goes to the props board, which
        is what a manager actually came to this screen to act on.
      */}

      {/*
        THE PROPS BOARD, FIRST.

        Promoted above the tables, and the argument is not only that it looks good. It is the only
        thing on this page a manager can ACT on: the lines say what the outlets think and the
        disagreement table says where they split, but the props are the prices you can take. A screen
        whose purpose is to inform a wager should lead with the wagerable thing.

        It is also the outlet's own view, so it sits directly under the rail that selects the outlet
        rather than three panels further down.
      */}
      <Panel className="overflow-hidden">
        <div
          className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4"
          style={{ borderLeft: `3px solid var(--color-media-${profile.accent})` }}
        >
          <h2 className="t-h3" style={{ color: `var(--color-media-${profile.accent}-hi)` }}>
            {profile.outlet} Props
          </h2>
          <span className="t-caption text-[var(--color-ink-faint)]">
            {outletProps.get(selectedId)?.length ?? 0} published
            {slateDate ? ` · ${slateDate}` : ''}
          </span>
        </div>
        <div className="p-3">
          <MediaPropBoard
            markets={outletProps.get(selectedId) ?? []}
            mediaId={selectedId}
            slateDate={slateDate}
            matchupLabel={matchupLabel}
            teamOf={teamOf}
            onOpen={openProp}
          />
        </div>
      </Panel>

      {/*
        THE THREE REFERENCE TABLES, BEHIND TABS.

        Three panels stacked were three screens of scrolling past two of them to reach the third, and
        each is a reference rather than a headline -- you go to one deliberately. Tabs also let the
        disagreement table become its own stop, which it could not be while it was one arm of a
        two-way switch against a single-outlet ranking.

        The three are the whole slate, the selected outlet's view of all thirty-two clubs, and where
        the nine cannot agree. Nothing is lost by showing one at a time; the outlet is already chosen
        on the rail above, and the tab labels say which outlet the middle one is speaking for.
      */}
      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
              {tableView === 'disagree'
                ? <BarChart3 className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
                : tableView === 'lines'
                  ? <Users className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
                  : <Table2 className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />}
              <h2 className="t-h3">
                {tableView === 'disagree'
                  ? 'Where They Disagree'
                  : tableView === 'lines'
                    ? 'Published Lines'
                    : `${profile.outlet} Club Ranking`}
              </h2>
            </div>
            <span className="t-caption text-[var(--color-ink-faint)]">
              {tableView === 'disagree'
                ? `All ${MEDIA_PROFILES.length}, sortable`
                : tableView === 'lines'
                  ? `${lines.length} ${lines.length === 1 ? 'game' : 'games'}`
                  : `${reads[selectedId].rows.length} clubs`}
            </span>
          </div>

        {/*
          THREE TABS, AND PROPS IS NOT ONE OF THEM.

          An earlier pass had four, with props first. That duplicated the panel sitting directly
          above: the same five cards rendered twice on one screen, once as the page's lead and once
          as a tab away. Props is the forefront, so it is the forefront -- the tabs are for the
          reference material it outranks.
        */}
        <div className="border-b border-[var(--color-chrome-lo)] px-4 py-2">
          <SegmentedControl
            aria-label="Reference table"
            mode="fill"
            value={tableView}
            onChange={(value) => setTableView(value as TableView)}
            options={[
              { value: 'lines', label: 'Published Lines' },
              { value: 'ranking', label: `${profile.outlet} Ranking` },
              { value: 'disagree', label: 'Disagreement' },
            ]}
          />
        </div>

        <div className="p-2">
          {tableView === 'lines' && <MediaOddsSlate lines={lines} slateDate={slateDate} />}
          {tableView === 'ranking' && <MediaRanking read={reads[selectedId]} profile={profile} />}
          {tableView === 'disagree' && <MediaDisagreementTable rows={disagreements} />}
        </div>
      </Panel>

      {/*
        The house-line footnote.

        It said "the mean of the three posted probabilities" and sat below a panel that may not even be
        showing -- with the lines table behind a tab, the note referred to something off-screen. It now
        lives inside the table it explains, and counts the outlets from the data rather than naming a
        number that was correct when there were three of them and wrong from the fourth onward.
      */}

      <MediaDetailsModal
        isOpen={detailsMediaId !== null}
        onClose={() => setDetailsMediaId(null)}
        mediaId={detailsMediaId ?? selectedId}
        onGoToBetting={() => { setDetailsMediaId(null); onNavigateToBetting?.(); }}
      />
    </section>
  );
};
