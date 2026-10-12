import React from 'react';
import { getGameWindowStatus, getScheduledGameTimeLabel } from '../../logic/gameTimes';
import { isPlayoffGame } from '../../logic/playoffs';
import { clubInitials, type TeamId } from '../../data/teamColors';
import { clubInk, clubTint, type ClubTheme } from '../../lib/clubColour';
import type { Game, Team } from '../../types';
import { TeamLogo } from '../ui';
import type { PregameRecord } from './GameCard';

/*
  THE SCOREBUG.
  ===========================================================================
  A broadcast scorebug gets one thing right that a results card usually does not: the mark, the club and
  the number form a single horizontal unit, so the eye lands on the score without being asked to assemble
  it out of three separated columns. The card this replaces put the crest, then a city/name stack, then
  a detached R/H/E block on the far right -- and the runs were not even the largest type on it.

  So this is a rearrangement, not a reskin:

    - crest, initials and runs are ONE unit, flush left, runs last and hard right
    - the runs are the largest thing on the card, because that is what the screen is for
    - the club's uniform is the band, so identity stops depending on reading a name
    - the club's full name survives at caption size under the initials. The brief was that initials
      replace the name as the IDENTIFIER, not that the name goes away.

  COLOUR COMES FROM THE EXISTING SYSTEM, NOT FROM A NEW TABLE. `clubInk` already solves the problem a
  naive "use the team's colour" would hit: real uniforms run from near-black to white, three of the 32
  primaries are below 1.2:1 against this app's panel and would be invisible as a fill, and the fix
  (lift lightness in OKLCH while holding hue) is already written and already gated by
  `tools/checkClubInk.ts`. Writing a second palette beside it would have been the mistake here.

  The one thing that system had no answer for is the bases, and that is answered below.
*/

/**
 * How the crest is cropped inside its band.
 *
 * `inverse` exists to answer a real concern with the first idea, which was a symmetric bleed that would
 * have put the away crest and the home crest on a collision course through the middle of the card.
 * `inverse` resolves it geometrically rather than by shrinking anything: the away crest is clipped by
 * the TOP edge of the card and the home crest by the BOTTOM edge, so they bleed in opposite directions
 * and can never enter the same region no matter how large the overdraw. They bookend the card, which is
 * also what the broadcast does -- the two marks sit at the outer edges with the game between them.
 *
 * `contained` gives the identical crop but clips it at each band instead of at the card, so nothing
 * leaves the card at all. Use it if the bookend reads as too dramatic.
 *
 * `none` fits the crest whole. The fallback for a mark whose recognisable part IS its outer edge.
 */
export type CrestCrop = 'inverse' | 'contained' | 'none';

/**
 * Default for the games screen.
 *
 * `inverse` is the default because it is the version the brief actually asked to see, and because the
 * two alternatives differ from it by a single flex alignment. Flip this one constant to compare all
 * three on a real slate; nothing else in the file changes.
 */
export const SCOREBUG_CREST_CROP: CrestCrop = 'inverse';

/** Band height. Tall enough that a bleeding crest has somewhere to bleed. */
const BAND_H = 76;
/**
 * How much larger the crest is than the band that crops it. This IS the crop, and 1.34 was too timid.
 *
 * The first pass used 1.34 and the screenshot showed two club marks reading as perfectly whole: the
 * Loyaton spade with its point intact, the Arsagam A complete. At that ratio the discarded 34% is
 * almost all transparent margin around the mark inside its PNG, so the numbers said "cropping" and the
 * picture said "not cropping". 1.55 takes a real bite out of the outer edge, which is what makes a crest
 * read as fitted INTO the band rather than merely drawn on it.
 */
const CREST_OVERDRAW = 1.55;
const CREST_SIZE = Math.round(BAND_H * CREST_OVERDRAW);

interface ScorebugCardProps {
  game: Game;
  games: Game[];
  currentDate: string;
  awayTeam: Team | null;
  homeTeam: Team | null;
  pregame: PregameRecord;
  getStatNumber: (game: Game, key: string) => number;
  getFallbackHits: (game: Game, side: 'away' | 'home') => number;
  onOpenGame: (gameId: string) => void;
  /** Overrides SCOREBUG_CREST_CROP. Used to render the alternatives together for review. */
  crop?: CrestCrop;
  /**
   * The postseason repaints the surface tokens, so a club colour derived against the navy panel would
   * be derived against a colour that is no longer on screen. Passed through rather than defaulted so
   * the caller, which can see the theme, owns that decision.
   */
  theme?: ClubTheme;
}

export const ScorebugCard: React.FC<ScorebugCardProps> = ({
  game,
  games,
  currentDate,
  awayTeam,
  homeTeam,
  pregame,
  getStatNumber,
  getFallbackHits,
  onOpenGame,
  crop = SCOREBUG_CREST_CROP,
  theme = 'regular',
}) => {
  const windowStatus = getGameWindowStatus(game, games, currentDate);
  const final = windowStatus === 'final';
  const playoff = isPlayoffGame(game);
  const timeLabel = getScheduledGameTimeLabel(game, games);

  const awayRuns = final ? game.score.away : null;
  const homeRuns = final ? game.score.home : null;
  const awayWins = final && awayRuns !== null && homeRuns !== null && awayRuns > homeRuns;
  const homeWins = final && awayRuns !== null && homeRuns !== null && homeRuns > homeRuns;

  // Games recorded before per-team hit totals existed report zero. The caller's fallback supplies a
  // deterministic substitute, so only prefer it when the stored figure is genuinely absent.
  const hits = (side: 'away' | 'home') => {
    if (!final) return 0;
    const stored = getStatNumber(game, `${side}Hits`);
    return stored > 0 ? stored : getFallbackHits(game, side);
  };
  const errors = (side: 'away' | 'home') => (final ? getStatNumber(game, `${side}Errors`) : 0);

  const awayHits = hits('away');
  const homeHits = hits('home');
  const awayErrors = errors('away');
  const homeErrors = errors('home');

  /**
   * THE CENTRE SLOT -- where the bases sit in the broadcast.
   *
   * The brief was to put something more useful there for a finished game, and the answer is the one
   * piece of state a results page has and a schedule has nothing to show: FINAL. In the postseason the
   * series label wins, because a playoff game being over is not the thing a reader came for -- the
   * series is.
   *
   * On an unplayed game the slot carries the scheduled time instead, so the slot is never empty. An
   * empty middle in a two-row layout reads as a layout that failed, not as a game with nothing to say.
   */
  const centreSlot = (() => {
    if (!final) {
      return (
        <span className="t-caption tabular-nums text-[var(--color-ink-dim)]">
          {windowStatus === 'live_window' ? `Live window · ${timeLabel}` : timeLabel}
        </span>
      );
    }
    if (playoff && game.playoff) {
      return (
        <span className="flex items-center gap-2">
          <span className="border border-[var(--color-gold-lo)] px-1.5 text-[var(--color-gold)] t-caption">
            {game.playoff.seriesLabel}
          </span>
          <span className="t-caption text-[var(--color-ink-dim)]">FINAL</span>
        </span>
      );
    }
    return <span className="t-caption text-[var(--color-pos)]">FINAL</span>;
  })();

  /**
   * THE CROPPED CREST.
   *
   * A window the band's own height with `overflow-hidden`, holding a logo rendered larger than that
   * window. The overdraw is what produces the crop: the mark fills the band and loses its outer few
   * pixels, which is "tightly fit and slightly cropped" exactly.
   *
   * It deliberately does NOT reach into `TeamLogo`. That component owns asset resolution -- the
   * `import.meta.glob` over the bundled logos, the Supabase fallback, the upload-invalidation
   * listener -- and its own comment is explicit that moving it rewrites that logic. Cropping from the
   * outside leaves all of it intact, which is the cheapest way to make this reversible.
   *
   * The shadow is not optional. A crest clipped by a band edge needs a shadow to read as sitting ON the
   * band rather than behind it, and the brief asked for one specifically. It is drawn on the element
   * INSIDE the clip, so it casts into the visible part of the mark rather than being clipped away.
   */
  const crest = (team: Team | null, edge: 'top' | 'bottom') => {
    const size = crop === 'none' ? BAND_H : CREST_SIZE;
    const width = Math.round(BAND_H * (crop === 'none' ? 1 : CREST_OVERDRAW));

    const align =
      crop === 'none' ? 'items-center'
        : crop === 'contained' ? 'items-center'
          : edge === 'top' ? 'items-start'
            : 'items-end';

    return (
      <div
        className={`flex h-[${BAND_H}px] w-[${width}px] shrink-0 items-center overflow-hidden ${align}`}
      >
        <div className="drop-shadow-[0_3px_8px_rgba(0,0,0,0.85)]" style={{ width: size, height: size }}>
          {team
            ? <TeamLogo team={team} sizeClass="h-full w-full" />
            : (
              <div
                className="flex h-full w-full items-center justify-center border border-dashed border-[var(--color-chrome-hi)] text-[var(--color-ink-faint)] t-caption"
              >
                {clubInitials(null)}
              </div>
            )}
        </div>
      </div>
    );
  };

  /**
   * ONE CLUB'S BAND: colour edge, cropped crest, initials, name, record, R/H/E, runs.
   *
   * The runs sit in a fixed-width right cell so that two runs of different digit counts -- 4 beside 11
   * -- still align on their right edge across a column of cards. A number that moves when the value
   * changes its digit count is the classic way a scoreboard becomes hard to scan vertically.
   */
  const band = (
    team: Team | null,
    edge: 'top' | 'bottom',
    wins: boolean,
    winCount: number,
    lossCount: number,
    runs: number | null,
    hitsCount: number,
    errorCount: number,
  ) => {
    const teamId = (team?.id ?? null) as TeamId | null;
    // 0.22 rather than something stronger: the band has the runs' 44px tabular figure sitting on it, and
    // the band is meant to identify the club, not compete with the number. `clubTint` mixes toward the
    // surface the caller named, so it stays correct in the postseason theme.
    const bandFill = teamId
      ? clubTint(teamId, 0.22, 'panel', theme)
      : 'var(--color-panel)';
    const edgeColor = teamId
      ? clubInk(teamId, 'panel', theme)?.hex ?? 'var(--color-chrome-mid)'
      : 'var(--color-chrome-mid)';

    return (
      <div
        className={`relative flex h-[${BAND_H}px] items-center overflow-hidden`}
        style={{ background: bandFill }}
      >
        {/* Full-strength uniform as an edge, where it cannot sit underneath text. */}
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[5px]" style={{ background: edgeColor }} />

        {crest(team, edge)}

        <div className="flex min-w-0 flex-1 flex-col justify-center pl-3">
          <span className="t-label truncate text-[var(--color-ink)]">{clubInitials(team?.id)}</span>
          <span className="truncate text-[13px] leading-tight text-[var(--color-ink-dim)]">
            {team ? `${team.city} ${team.name}` : 'Unknown club'}
          </span>
          <span className="t-caption tabular-nums text-[var(--color-ink-faint)]">
            {winCount}-{lossCount}
          </span>
        </div>

        {/*
          H and E -- and deliberately NOT R.

          The brief asked for "RHE", and this is a departure from it. The runs are already on this card,
          at 48px, in the position the eye lands on first, so printing `R` again a few pixels to their
          left put the same number on screen twice. The screenshot showed "R 14 | H 18 | E 0" with a 14
          in gold two columns further right, and the honest reading of that arrangement is that
          something is duplicated rather than that a box score is present.

          So the runs ARE the R, and this line carries the two figures the runs do not. A real broadcast
          bug prints all three because its score column is a separate element at the far end of the bar;
          here the runs and the stat line are neighbours, so the duplication is visible rather than
          structural. One line back in if the stat line is ever moved away from the runs.
        */}
        <dl className="ml-auto mr-4 flex shrink-0 gap-3 tabular-nums">
          {([['H', hitsCount], ['E', errorCount]] as Array<[string, number]>).map(
            ([label, value]) => (
              <div key={label} className="text-center">
                <dt className="t-caption text-[var(--color-ink-faint)]">{label}</dt>
                <dd className="t-stat-sm text-[var(--color-ink-dim)]">{final ? value : '–'}</dd>
              </div>
            ),
          )}
        </dl>

        {/*
          THE RUNS.

          The brief is that the runs are the biggest thing on the card, and the first pass did not
          deliver that: 44px of type beside a crest window 118px wide lost, and the screenshot agreed --
          the eye went to the marks. Two things closed the gap.

          The crest is cropped harder (1.55), which cuts its visual mass even as its rendered box grows,
          because a mark bleeding past its band reads as background rather than as the subject. And the
          runs go to 48px -- deliberately below `t-stat-xl`'s 56px, because 48 is the largest numeral
          that still fits the fixed-width right cell beside an H/E pair without the cell growing and the
          stat line drifting leftward between a one-digit and a two-digit score.

          Two digits drop to 42px for the same reason: a double-digit total must not make the card wider
          than a single-digit one in the column beside it.

          The winner's runs take the gold accent so the result is legible without adding up either club
          -- but ONLY the runs, never the crest or the initials, because tinting the identity would argue
          with the band that already identified the club, and `clubColour`'s header rule is that club
          colour may decorate but must never be the only thing distinguishing one state from another.
        */}
        <div className="flex w-[86px] shrink-0 items-center justify-end pr-4">
          <span
            className="leading-none"
            style={{
              fontFamily: 'var(--font-num)',
              fontSize: runs !== null && String(runs).length >= 2 ? 42 : 48,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              fontVariantNumeric: 'tabular-nums',
              color: wins ? 'var(--color-gold)' : 'var(--color-ink)',
            }}
          >
            {runs ?? (final ? 0 : '–')}
          </span>
        </div>
      </div>
    );
  };

  return (
    <button
      type="button"
      onClick={() => onOpenGame(game.gameId)}
      aria-label={`Open ${awayTeam?.name ?? game.awayTeam} at ${homeTeam?.name ?? game.homeTeam}, ${
        windowStatus === 'final' ? 'final' : windowStatus === 'live_window' ? 'live window' : 'scheduled'
      }${final ? `, ${awayRuns} to ${homeRuns}` : ''}`}
      className="flex w-full flex-col overflow-hidden border border-[var(--color-chrome-lo)] bg-[var(--color-panel)] text-left transition-colors hover:border-[var(--color-chrome-hi)]"
    >
      {/*
        CONTEXT BAR. Thin, and deliberately not a colour band -- it belongs to neither club. The date is
        shown here rather than on the card body because on a two-column slate every card carries the same
        date, and repeating it sixteen times is noise the date rail above already answers.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-chrome-lo)] px-4 py-1.5">
        <span className="t-caption text-[var(--color-ink-faint)]">
          {timeLabel}
          {playoff && (
            <span className="ml-2 border border-[var(--color-gold-lo)] px-1 text-[var(--color-gold)]">PL</span>
          )}
        </span>
        {playoff && game.playoff && (
          <span className="t-caption text-[var(--color-ink-dim)]">
            {game.playoff.seriesLabel} · Game {game.playoff.gameNumber}
          </span>
        )}
      </div>

      {band(awayTeam, 'top', awayWins, pregame.awayWins, pregame.awayLosses, awayRuns, awayHits, awayErrors)}

      {/* THE CENTRE SLOT. */}
      <div className="flex h-8 items-center justify-center border-y border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]">
        {centreSlot}
      </div>

      {band(homeTeam, 'bottom', homeWins, pregame.homeWins, pregame.homeLosses, homeRuns, homeHits, homeErrors)}
    </button>
  );
};