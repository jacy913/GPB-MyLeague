import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Game,
  SeasonHistoryEntry,
  SeasonHistoryTeamRecord,
  Team,
} from '../types';
import { CLUB_BAND_EDGE_WIDTH, CroppedCrest, Panel, RetroButton, TeamLogo } from './ui';
import { clubInk, contrastRatio } from '../lib/clubColour';
import type { TeamId } from '../data/teamColors';
import mvpBeltImage from '../assets/mvpbelt.png';
import trophyImage from '../assets/trophy.png';
import worldSeriesMvpImage from '../assets/worldseriesmvp.png';

interface HistoryHubProps {
  seasonHistory: SeasonHistoryEntry[];
  teams: Team[];
  /**
   * Every completed game, which is where the World Series RESULT comes from.
   *
   * The archive stores the champion but not the series, so "def. Niyoli Reefs 4-1" has to be
   * read back off the games. They are persisted alongside the archive, so this works for seasons
   * that finished long ago as well as the one that finished last night -- which an archive-only
   * field would not, since older entries predate it.
   */
  games: Game[];
}

const formatCompletedAt = (isoValue: string): string => {
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) {
    return 'Archived';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const buildFallbackTeam = (
  teamId: string,
  teamCity: string,
  teamName: string,
): Team => ({
  id: teamId,
  city: teamCity,
  name: teamName,
  league: 'Platinum',
  division: 'North',
  rating: 0,
  previousBaselineWins: 0,
  wins: 0,
  losses: 0,
  runsScored: 0,
  runsAllowed: 0,
});

const resolveTeamFromWinner = (
  winner: {
    teamId: string | null;
    teamCity: string | null;
    teamName: string | null;
  } | null,
  teamsById: Map<string, Team>,
): Team | null => {
  if (!winner?.teamId) {
    return null;
  }
  const liveTeam = teamsById.get(winner.teamId);
  if (liveTeam) {
    return liveTeam;
  }
  if (!winner.teamCity || !winner.teamName) {
    return null;
  }
  return buildFallbackTeam(winner.teamId, winner.teamCity, winner.teamName);
};

/**
 * The championship series, read back off the games: who the champion beat, and in how many games.
 *
 * Scoped by BOTH the season year and the champion, because either alone is wrong. Year alone mixes
 * every series in that calendar year together, and a club can win the World Series more than once,
 * so a champion-scoped lookup would return the wrong year. Requiring exactly one distinct opponent
 * is the real assertion: if the champion's games in that window were against two clubs, this was not
 * one series and the honest answer is nothing rather than a number invented from half of it.
 */
const worldSeriesResult = (
  games: Game[],
  seasonYear: number,
  championTeamId: string,
): { runnerUpId: string; championWins: number; runnerUpWins: number } | null => {
  const seriesGames = games.filter(
    (game) =>
      game.status === 'completed'
      && game.phase === 'playoffs'
      && game.playoff?.round === 'world_series'
      && game.date.slice(0, 4) === String(seasonYear),
  );
  const championGames = seriesGames.filter(
    (game) => game.homeTeam === championTeamId || game.awayTeam === championTeamId,
  );
  if (championGames.length === 0) return null;

  const opponents = new Set(
    championGames.map((game) => (game.homeTeam === championTeamId ? game.awayTeam : game.homeTeam)),
  );
  if (opponents.size !== 1) return null;
  const runnerUpId = [...opponents][0];

  const championWon = (game: Game): boolean => (game.homeTeam === championTeamId
    ? game.score.home > game.score.away
    : game.score.away > game.score.home);
  const championWins = championGames.filter(championWon).length;
  return { runnerUpId, championWins, runnerUpWins: championGames.length - championWins };
};

/**
 * The card's background, and the ink that has to be readable on top of it.
 *
 * THE BACKGROUND IS THE CLUB'S OWN PRIMARY, via `clubInk`. Not `clubTint` -- this card is the one
 * place on the page that is allowed to say "this is the champion" in the club's own colour rather
 * than in a tint of it. `clubInk` is still what resolves it, and it hands back the primary
 * untouched for the eighteen clubs whose uniform is already visible on the panel, lifting only the
 * handful that would otherwise vanish (three primaries sit under 1.2:1 against the panel). So the
 * card is the club's real colour, and it is never invisible.
 *
 * THE INK IS CHOSEN AGAINST THE BACKGROUND, NOT THE PAGE. `--color-ink` and `--color-gold` are
 * panel-relative tokens: readable on the dark navy, unreadable on a pale club. With the background
 * decided by the club, the text colour has to be decided by the background, so it is picked by
 * measured contrast between the two inks the palette already uses. That is why the card text is not
 * gold: on a bright club's card gold is the first thing to disappear, and a champion's name that
 * cannot be read is worse than a card that is not gold.
 */
const championCardColours = (teamId: string): { background: string; ink: string; dim: string } => {
  const background = clubInk(teamId as TeamId, 'panel')?.hex ?? 'var(--color-panel)';
  const onDark = '#f2f5ff';   // --color-ink
  const onLight = '#05070d';  // --color-ink-invert
  const light = contrastRatio(background, onDark) >= contrastRatio(background, onLight);
  return {
    background,
    ink: light ? onDark : onLight,
    // The secondary line has to clear text contrast too, so it is a step off the ink rather than a
    // fixed dim token that only reads on the panel.
    dim: light ? 'rgba(242,245,255,0.78)' : 'rgba(5,7,13,0.74)',
  };
};

/**
 * A row of the honour list: the club's colour, its edge, its crest, and the award.
 *
 * THIS IS THE CLUB BAND, IN ITS SOLID FORM.
 *
 * The documented standard (`docs/team-band-row.md`) fills a band row with `clubTint` -- 22% of the
 * club colour mixed into the panel -- because a *tint* is what makes a long list readable and what
 * keeps a near-black primary from vanishing. This page deliberately does not do that. The manager
 * asked for the club's primary as the background, and on the season archive that is the right call
 * for a reason the standard could not have anticipated: there are only NINE rows here, one per
 * honour, and each one IS a different club. A list of nine nearly-identical dark tints is a list
 * you cannot scan; a list of nine saturated club colours is the fastest read on the page. The
 * standard governs lists of thirty-two, where the tint is load-bearing. It does not govern this.
 *
 * `clubInk` still resolves the colour rather than the raw palette primary: eighteen clubs get their
 * own primary untouched, and the handful whose primary would be invisible against the panel get
 * lifted instead. So the row is the club's real colour and is never missing.
 *
 * THE INK IS DERIVED FROM THE BACKGROUND, NOT FROM THE PAGE. `--color-ink` and `--color-gold` are
 * panel-relative and unreadable on a bright club. With the fill decided by the club, the text has to
 * be decided by the fill, so it is picked by measured contrast between the two inks the palette
 * already uses. A gold award title on a gold club's row is the first thing to disappear.
 */
const honorRowColours = (teamId: string | null): { fill: string; edge: string; ink: string; dim: string } => {
  if (!teamId) {
    return { fill: 'var(--color-panel-2)', edge: 'var(--color-chrome-hi)', ink: '#f2f5ff', dim: 'rgba(242,245,255,0.72)' };
  }
  const background = clubInk(teamId as TeamId, 'panel')?.hex ?? 'var(--color-panel)';
  const onDark = '#f2f5ff';
  const onLight = '#05070d';
  const light = contrastRatio(background, onDark) >= contrastRatio(background, onLight);
  return {
    fill: background,
    edge: background,
    ink: light ? onDark : onLight,
    dim: light ? 'rgba(242,245,255,0.80)' : 'rgba(5,7,13,0.76)',
  };
};

/**
 * The award artwork, cropped to the row the way a crest is.
 *
 * A window of the row's height at the trailing edge, with the image `object-cover`ed inside it, so
 * every row's artwork is exactly as tall as its row and the trailing edge is a straight line down
 * the whole list. The MVP belt is wide and almost gets there on its own; the trophy is tall and gets
 * cropped top and bottom to fit the same window, which leaves the plate and the barrel of it -- the
 * part that reads as the object.
 *
 * The belt is the reason this exists rather than a plain `h-full` image: at a 56px row a
 * `h-16 object-contain` belt is a 27px letterbox floating in the row, and a row of those looks like
 * a list of icons that lost their labels.
 */
const RowArtwork: React.FC<{ src: string; alt: string; height: number }> = ({ src, alt, height }) => (
  <div
    aria-hidden="true"
    className="flex shrink-0 items-center justify-center overflow-hidden"
    style={{ height, width: Math.round(height * 1.9) }}
  >
    <img src={src} alt={alt} className="h-full w-full object-cover" />
  </div>
);

const HONOR_ROW_H = 56;

/**
 * One honour: a club band row carrying the crest, the award, the winner and the figures.
 *
 * No "Regular Season" / "Playoffs" eyebrow and no club name. Both were dropped on the manager's
 * instruction and both are information the row already carries another way -- the eyebrow is on
 * nothing else the row needs, and with the crest and the club's own colour filling the row, the
 * name beside it was restating the mark. What is left is the award, who won it, and the line that
 * decided it.
 */
const HonorRow: React.FC<{
  title: string;
  detail: string | null;
  summary: string | null;
  team: Team | null;
  imageSrc: string;
  imageAlt: string;
  title2?: string;
}> = ({ title, detail, summary, team, imageSrc, imageAlt, title2 }) => {
  const { fill, edge, ink, dim } = honorRowColours(team?.id ?? null);
  return (
    <div
      className="relative flex items-center gap-3 overflow-hidden"
      style={{ background: fill, minHeight: HONOR_ROW_H }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0"
        style={{ width: CLUB_BAND_EDGE_WIDTH, background: edge }}
      />

      {team
        ? <CroppedCrest team={team} height={HONOR_ROW_H} />
        : <span className="shrink-0" style={{ height: HONOR_ROW_H, width: Math.round(HONOR_ROW_H * 1.45) }} aria-hidden="true" />}

      <div className="min-w-0 flex-1 pl-1">
        <p className="truncate t-label" style={{ color: ink }}>{title}</p>
        {detail
          ? <p className="truncate t-h3" style={{ color: ink }}>{detail}</p>
          /*
            THE EMPTY STATE, which the old card got from its eyebrow. "Regular Season" above a
            blank body used to be the only hint that nobody won it; with the eyebrow gone, a title
            with nothing under it reads as a rendering failure rather than as an award nobody won.

            Keyed on the row having NO content at all -- not on `detail`. A league champion and the
            Staff of the Year carry no player name and were briefly printing "No winner this season"
            over a club that had in fact won one, because they use `summary`/`title2` instead. The
            empty state is "nothing in the row", not "no name in the row".
          */
          : !summary && !title2
            ? <p className="truncate t-caption" style={{ color: dim }}>No winner this season</p>
            : null}
        {title2 && <p className="truncate text-[11px]" style={{ color: dim }}>{title2}</p>}
      </div>

      {summary && (
        <p className="hidden shrink-0 text-right t-caption tabular-nums sm:block" style={{ color: ink }}>
          {summary}
        </p>
      )}

      <RowArtwork src={imageSrc} alt={imageAlt} height={HONOR_ROW_H} />
    </div>
  );
};

export const HistoryHub: React.FC<HistoryHubProps> = ({ seasonHistory, teams, games }) => {
  const teamsById = useMemo(() => new Map<string, Team>(teams.map((team) => [team.id, team] as const)), [teams]);
  const orderedHistory = useMemo(
    () => [...seasonHistory].sort((left, right) => right.seasonYear - left.seasonYear),
    [seasonHistory],
  );
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (orderedHistory.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((current) => Math.min(current, orderedHistory.length - 1));
  }, [orderedHistory.length]);

  if (orderedHistory.length === 0) {
    return (
      <Panel variant="hero" className="p-6 md:p-8">
        <h1 className="t-h1">No Seasons Archived</h1>
        <p className="t-body mt-3 max-w-2xl text-[var(--color-ink-dim)]">
          Complete a full season and this page will automatically save its champion and every award.
        </p>
      </Panel>
    );
  }

  const entry = orderedHistory[activeIndex];
  const champion = entry.champion;
  const championTeam = champion
    ? (teamsById.get(champion.teamId) ?? buildFallbackTeam(champion.teamId, champion.teamCity, champion.teamName))
    : null;
  const battingMvpTeam = resolveTeamFromWinner(entry.battingMvp, teamsById);
  const pitchingMvpTeam = resolveTeamFromWinner(entry.pitchingMvp, teamsById);
  const worldSeriesMvpTeam = resolveTeamFromWinner(entry.worldSeriesMvp, teamsById);
  const ultimateSluggerTeam = resolveTeamFromWinner(entry.ultimateSlugger ?? null, teamsById);
  const battingKingTeam = resolveTeamFromWinner(entry.battingKing ?? null, teamsById);
  const rookieOfTheYearTeam = resolveTeamFromWinner(entry.rookieOfTheYear ?? null, teamsById);
  const strikeoutKingTeam = resolveTeamFromWinner(entry.strikeoutKing ?? null, teamsById);
  const staffOfTheYearTeam = entry.staffOfTheYear
    ? (teamsById.get(entry.staffOfTheYear.teamId) ?? buildFallbackTeam(entry.staffOfTheYear.teamId, entry.staffOfTheYear.teamCity, entry.staffOfTheYear.teamName))
    : null;

  /*
   * The series the champion won, and the ink that reads on their card.
   *
   * `championCardColours` takes the team id rather than the resolved `Team`, because the background
   * is the club's PALETTE entry and a fallback team built for a saved-but-unknown id has no palette
   * of its own. `clubInk` returns null for that case and the card falls back to the panel.
   */
  const series = champion ? worldSeriesResult(games, entry.seasonYear, champion.teamId) : null;
  /*
   * The runner-up is resolved from the live roster only.
   *
   * NOT from `leagueWinners`: that list holds league champions, and the losing finalist is not
   * necessarily one of them -- the runner-up is whichever league champion lost the deciding
   * series. A club that has since left the league has no name stored anywhere on this entry, so
   * the line degrades to "def. the runner-up" rather than inventing one.
   */
  const runnerUpTeam = series ? teamsById.get(series.runnerUpId) ?? null : null;
  const card = champion ? championCardColours(champion.teamId) : null;

  return (
    <section className="space-y-4">
      <Panel variant="hero" className="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5">
        <div>
          <h1 className="t-h1">Season {entry.seasonYear}</h1>
          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">Saved {formatCompletedAt(entry.completedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <RetroButton
            variant="ghost"
            size="sm"
            onClick={() => setActiveIndex((current) => Math.max(0, current - 1))}
            disabled={activeIndex === 0}
            aria-label="Previous season snapshot"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </RetroButton>
          <span className="t-stat-sm tabular-nums text-[var(--color-ink-dim)]">
            {activeIndex + 1} / {orderedHistory.length}
          </span>
          <RetroButton
            variant="ghost"
            size="sm"
            onClick={() => setActiveIndex((current) => Math.min(orderedHistory.length - 1, current + 1))}
            disabled={activeIndex >= orderedHistory.length - 1}
            aria-label="Next season snapshot"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </RetroButton>
        </div>
      </Panel>

      {/*
        THE CHAMPION CARD. The one card on this page that is about a single achievement rather
        than a list, and the only place the league accent is allowed to read as celebration.

        IT IS NARROWER, not shorter, and that is the whole trick. The crest and the trophy both got
        bigger, which only fits if the card got tighter rather than shorter -- so the grid gives the
        honours column the wider share (1.18fr to 1fr) and the trophy is anchored to the bottom of a
        card that is tall enough to hold it without clipping its top.

        `self-start` is load-bearing. Without it the article is a grid item and stretches to the
        height of the honours column beside it, which after the awards moved in is 1600+px -- a
        half-empty orange rectangle with the crest at the top and the trophy a mile below it.
        Capped to its own height, and made `sticky`, it stays put as you scroll the award list, so
        the column it shares with is never just blank space.
      */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.18fr)] lg:items-start">
        <article
          className="relative min-h-[440px] self-start overflow-hidden border border-[var(--color-gold-dim)] p-4 md:min-h-[560px] md:p-5 lg:sticky lg:top-4"
          style={{ background: card?.background, color: card?.ink }}
        >
          <p className="t-caption" style={{ color: card?.dim }}>World Series Champion</p>
          <img
            src={trophyImage}
            alt="Championship trophy"
            className="pointer-events-none absolute bottom-0 right-2 h-[300px] w-auto object-contain drop-shadow-[0_24px_44px_rgba(0,0,0,0.55)] md:right-3 md:h-[480px]"
          />
          {/*
        THE SERIES RESULT. It was here before this pass, at 11px in the secondary ink on the club's
        own colour -- which measured as present and read as absent. Two mistakes compounded: 11px is
        below the size the app uses for anything it expects to be read, and the secondary ink is a
        fixed translucent step, so on a mid-tone club the contrast fell through a floor nobody
        measured.

        So it is a real caption at the app's own caption size, in the FULL-strength ink rather than
        the dim step, and it sits directly under the club name where the eye lands after the name
        rather than at the bottom of a stack.
      */}
          {champion && championTeam ? (
            <div className="relative z-10 mt-4 max-w-[68%]">
              <TeamLogo team={championTeam} sizeClass="h-40 w-40 md:h-48 md:w-48" />
              <p className="t-h1 mt-3" style={{ color: card?.ink }}>{champion.teamCity}</p>
              <p className="t-h2" style={{ color: card?.ink, opacity: 0.85 }}>{champion.teamName}</p>
              <p className="t-caption mt-2 font-semibold" style={{ color: card?.ink }}>
                {series
                  ? `def. ${runnerUpTeam ? `${runnerUpTeam.city} ${runnerUpTeam.name}` : 'the runner-up'} ${series.championWins}-${series.runnerUpWins}`
                  : 'Series result unavailable'}
              </p>
            </div>
          ) : (
            <p className="relative z-10 mt-4 text-[11px]" style={{ color: card?.dim }}>Champion unavailable</p>
          )}
        </article>

        {/*
          THE HONOUR LIST. One column of club band rows and nothing else.

          The "Team Honors" heading, the trophy icon, and the "Awards / Regular-season honors and
          postseason performance" subheading are all gone. Every row is already labelled by its own
          award name and already coloured by its own club, so a heading above nine of them labelled
          the list with a word ("Awards") that every row was already spelling out.

          League champions, Staff of the Year and the player awards are one continuous list on
          purpose. The distinction the headings drew -- team honours versus player honours -- is
          carried by what is in the row instead: a team honour names a club and its record, an
          award names a player and the line that decided it. A reader who cares which is which can
          see it; a reader scanning for "who won what" gets one list to scan.

          Division winners are not here either. They were six rows of "Platinum North: Huidor, 95-59"
          on a page whose subject is how a season finished at the top, and that record is still one
          click away on the standings. The data is NOT deleted: `divisionWinners` is still computed
          and still written to the archive, so this only stops displaying it.
        */}
        <div className="flex flex-col gap-2">
          {(entry.leagueWinners ?? []).map((winner: SeasonHistoryTeamRecord & { league: Team['league'] }) => (
            <HonorRow
              key={`${entry.seasonYear}-league-${winner.league}`}
              title={`${winner.league} Champion`}
              detail={null}
              summary={`${winner.wins}-${winner.losses}`}
              team={teamsById.get(winner.teamId) ?? buildFallbackTeam(winner.teamId, winner.teamCity, winner.teamName)}
              imageSrc={trophyImage}
              imageAlt={`${winner.league} championship trophy`}
            />
          ))}

          {entry.staffOfTheYear && (
            <HonorRow
              title="Staff of the Year"
              detail={null}
              summary={null}
              title2={
                `${entry.staffOfTheYear.wins}-${entry.staffOfTheYear.losses}`
                + ` | ${entry.staffOfTheYear.expectedWins.toFixed(1)} expected`
                + ` | ${entry.staffOfTheYear.winsAboveExpectation >= 0 ? '+' : ''}${entry.staffOfTheYear.winsAboveExpectation.toFixed(1)}`
                + ` | roster ${entry.staffOfTheYear.rosterStrength.toFixed(1)}`
              }
              team={staffOfTheYearTeam}
              imageSrc={trophyImage}
              imageAlt="Staff of the Year trophy"
            />
          )}

          <HonorRow
            title="Batting MVP"
            detail={entry.battingMvp?.playerName ?? null}
            summary={entry.battingMvp?.summary ?? null}
            team={battingMvpTeam}
            imageSrc={mvpBeltImage}
            imageAlt="MVP belt"
          />
          <HonorRow
            title="Pitching MVP"
            detail={entry.pitchingMvp?.playerName ?? null}
            summary={entry.pitchingMvp?.summary ?? null}
            team={pitchingMvpTeam}
            imageSrc={mvpBeltImage}
            imageAlt="MVP belt"
          />
          <HonorRow
            title="Ultimate Slugger"
            detail={entry.ultimateSlugger?.playerName ?? null}
            summary={entry.ultimateSlugger?.summary ?? null}
            team={ultimateSluggerTeam}
            imageSrc={mvpBeltImage}
            imageAlt="Batting award belt"
          />
          <HonorRow
            title="Batting King"
            detail={entry.battingKing?.playerName ?? null}
            summary={entry.battingKing?.summary ?? null}
            team={battingKingTeam}
            imageSrc={mvpBeltImage}
            imageAlt="Batting award belt"
          />
          <HonorRow
            title="Strikeout King"
            detail={entry.strikeoutKing?.playerName ?? null}
            summary={entry.strikeoutKing?.summary ?? null}
            team={strikeoutKingTeam}
            imageSrc={trophyImage}
            imageAlt="Strikeout King trophy"
          />
          <HonorRow
            title="Rookie of the Year"
            detail={entry.rookieOfTheYear?.playerName ?? null}
            summary={entry.rookieOfTheYear?.summary ?? null}
            team={rookieOfTheYearTeam}
            imageSrc={trophyImage}
            imageAlt="Rookie of the Year trophy"
          />
          <HonorRow
            title="World Series MVP"
            detail={entry.worldSeriesMvp?.playerName ?? null}
            summary={entry.worldSeriesMvp?.summary ?? null}
            team={worldSeriesMvpTeam}
            imageSrc={worldSeriesMvpImage}
            imageAlt="World Series MVP award"
          />
        </div>
      </div>
    </section>
  );
};
