import React, { useCallback, useMemo, useState } from 'react';
import { BarChart3, Users } from 'lucide-react';
import type { Game } from '../../types';
import type { MediaId } from '../../data/media';
import { MEDIA_BY_ID, MEDIA_PROFILES } from '../../data/media';
import { buildMediaReads, type MediaReadInput } from '../../lib/mediaReads';
import { buildGameLine, getNextSlateDate, HOUSE_MARGIN, type GameLine } from '../../lib/mediaOdds';
import { usePropBoard } from '../../hooks/usePropBoard';
import type { PropFocus } from '../../hooks/useBettingSlip';
import { Panel, SegmentedControl } from '../ui';
import { MediaCards } from './MediaCard';
import { MediaDisagreementTable, MediaRanking } from './MediaTables';
import { MediaOddsSlate } from './MediaOddsSlate';
import { MediaPropBoard } from './MediaPropCards';
import { MediaDetailsModal } from './MediaDetailsModal';

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
  const [tableView, setTableView] = useState<'read' | 'split'>('split');
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
        const scoreFor = (teamId: string) => ({
          hollis: scores.hollis.get(teamId) ?? 0.5,
          glorest: scores.glorest.get(teamId) ?? 0.5,
          sharply: scores.sharply.get(teamId) ?? 0.5,
        });
        return buildGameLine({ game, away, home, awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread });
      })
      .filter((line): line is GameLine => line !== null)
      .sort((a, b) => a.awayTeam.city.localeCompare(b.awayTeam.city));
  }, [games, input.teams, scores, slateDate, spread]);

  const hasSeasonOutput = input.teams.some((team) => team.wins + team.losses > 0);

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
          Three outlets read the same league three different ways, and none of them is adjusted for
          the others. What they disagree about is the interesting part.
        </p>
        {!hasSeasonOutput && (
          <p className="t-caption mt-3 border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-sunken)] px-3 py-2 text-[var(--color-warn)]">
            No season has been played yet. Glorest Press has nothing observed to read, so it is
            currently rating the field on pre-season ratings rather than on results.
          </p>
        )}
      </Panel>

      <MediaCards
        selectedId={selectedId}
        onSelect={handleSelect}
        onOpenDetails={setDetailsMediaId}
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

      <MediaOddsSlate lines={lines} slateDate={slateDate} />

      {/*
        The selected outlet's props, on the page rather than only in the popup.
        The popup is the per-outlet view; this is the one you land on. Props are
        the part of a betting board most read as a list and acted on quickly, and
        making them reachable only through a dialog would put five cards behind a
        click and a dismissal for no gain.
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

      <Panel className="overflow-hidden">
        <div className="chrome-bar flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            {tableView === 'split'
              ? <BarChart3 className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
              : <Users className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />}
            <h2 className="t-h3">
              {tableView === 'split' ? 'Where They Disagree' : `${profile.outlet} Club Ranking`}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="t-caption text-[var(--color-ink-faint)]">
              {tableView === 'split' ? 'All three, sortable' : `${reads[selectedId].rows.length} clubs`}
            </span>
            <SegmentedControl
              aria-label="Club table"
              mode="fill"
              value={tableView}
              onChange={(value) => setTableView(value as 'read' | 'split')}
              options={[
                { value: 'split', label: 'Comparison' },
                { value: 'read', label: profile.outlet },
              ]}
            />
          </div>
        </div>
        <div className="p-2">
          {tableView === 'split'
            ? <MediaDisagreementTable rows={disagreements} />
            : <MediaRanking read={reads[selectedId]} profile={profile} />}
        </div>
      </Panel>

      <p className="t-caption px-1 text-[var(--color-ink-faint)]">
        The house line shown above is the mean of the three posted probabilities with a{' '}
        {Math.round(HOUSE_MARGIN * 100)}% margin, not the mean of the three prices. Nothing is
        wagered here yet; these are the numbers the betting layer will read.
      </p>

      <MediaDetailsModal
        isOpen={detailsMediaId !== null}
        onClose={() => setDetailsMediaId(null)}
        mediaId={detailsMediaId ?? selectedId}
        onGoToBetting={() => { setDetailsMediaId(null); onNavigateToBetting?.(); }}
      />
    </section>
  );
};
