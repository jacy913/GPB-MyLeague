import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Crown, Medal, Receipt, Trophy } from 'lucide-react';
import {
  type Player,
  type PlayerBattingRatings,
  type PlayerPitchingRatings,
  type PlayerSeasonBatting,
  type PlayerSeasonPitching,
  type Team,
} from '../../types';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId, getLatestBattingRatings, getLatestPitchingRatings } from '../../logic/playerStats';
import { buildAwardsForBoard, type AwardEntry, type AwardInputs, type MvpBoard } from '../../lib/awardRace';
import { rankSeasonAwardRace, SEASON_AWARD_RACES, type SeasonAwardBoard } from '../../lib/seasonAwards';
import { AWARD_RACE_SPECS, buildAwardMarket } from '../../lib/mediaMarkets';
import { formatAmerican, probabilityToAmerican } from '../../lib/markets';
import mvpBeltImage from '../../assets/mvpbelt.png';
import {
  CLUB_BAND_EDGE_WIDTH,
  clubBandPalette,
  CroppedCrest,
  OddsBar,
  Panel,
  RetroButton,
  SegmentedControl,
  StatValue,
  TeamLogo,
} from '../ui';
import type { TeamId } from '../../data/teamColors';

export interface AwardsPageProps {
  teams: Team[];
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  /**
   * Opens MacroBet, whose awards tab is where this race is priced and sold.
   *
   * A callback rather than a second button that reaches into the betting store, for the reason the
   * dashboards split off Leaders: this screen owns no market and must not decide anything about one.
   * It links to the book; the book decides the price.
   */
  onOpenBetting: () => void;
  /** Opens the standings, so the race and the thing the TEAM term is measuring sit side by side. */
  onOpenStandings: () => void;
}

/** A candidate plus the MacroBet consensus on him, read off the full field. */
type RacedEntry = AwardEntry & {
  /**
   * The house probability, 0-1, or null when this candidate is absent from the market.
   *
   * Null rather than zero for the same reason as everywhere else it appears: zero is a certainty
   * nobody can sell, and "not on the board" is a different fact that must not print as a confident 0.
   */
  houseProbability: number | null;
};

/**
 * HOW DEEP THE SCORE BREAKDOWN OPENS.
 *
 * Three. The leader, the runner-up and third are the race -- the gap between them is the entire
 * question a reader opens this page to answer, and a full-page panel has the vertical room to show
 * the arithmetic that produced those scores. The rest of the field (to eight) is context: it says
 * who is still in contention, and clicking any of them opens the same breakdown. Defaulting the whole
 * field to open is what made the old version unreadable -- eight candidates each carrying an
 * eight-cell scoring grid, two races side by side, with the leader's actual margin buried in it.
 *
 * Exported so the depth is one number, changed in one place, rather than a literal retyped per row.
 */
const EXPANDED_DEPTH = 3;

/**
 * The award row's height, in px. The crest is cropped to it -- drawn larger and clipped back -- so
 * the row takes no vertical padding: the crest IS the row height, and padding around it would leave
 * a strip of club colour above and below the mark. The name and the figures centre against it.
 */
const AWARD_ROW_H = 64;

/**
 * ONE TERM OF THE SCORE, SHOWN.
 *
 * This is the transparency the old page had and this one has to keep: the points figure on the right
 * of each row is an opaque sum unless the reader can see what went into it. What changed is that each
 * chip now carries only the STATISTIC -- `AVG .272` -- and not the `+190.4` it contributed.
 *
 * The contributions were dropped because they are the wrong number to print beside a stat. They are
 * points on a scale only the model uses, and the same 120 at-bats that made them large for one player
 * and small for another, so a `+190.4` next to a `.272` average invited being read as a baseball
 * quantity. They survive on the chip's tooltip, so the arithmetic stays inspectable for anyone who
 * asks for it without competing with the figure that is actually about the sport.
 */
const ScoreBreakdown: React.FC<{ entry: AwardEntry }> = ({ entry }) => (
  <dl className="flex flex-wrap gap-1.5 pt-2">
    {entry.components.map((component) => (
      <div
        key={component.label}
        className="flex min-w-0 items-baseline gap-1.5 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-1"
        title={
          /*
            THE CONTRIBUTION IS PRINTED ONLY WHEN THERE IS ONE.
            A zero contribution means this chip is a RANKING FACTOR, not a term in a weighted sum --
            the Ultimate Slugger ranks on home runs and then slugging, so "HR: 38 -- +0.0 of the 38.0
            points" would be a fabricated number dressed as arithmetic. Those awards set the
            contribution to zero deliberately, and this is where that decision becomes visible.
          */
          component.contribution === 0
            ? `${component.label}: ${component.detail} (ranking factor -- these awards rank in order, they are not summed)`
            : `${component.label}: ${component.detail} — ${component.contribution.toFixed(1)} of the ${entry.total.toFixed(1)} points`
        }
      >
        <dt className="t-caption shrink-0 text-[var(--color-ink-faint)]">{component.label}</dt>
        <dd className="t-stat-sm shrink-0 text-[var(--color-ink)]">{component.detail}</dd>
      </div>
    ))}
  </dl>
);

/**
 * ONE CANDIDATE.
 *
 * The crest is the largest thing on the row and the name is the second-largest, with the numbers to
 * the right of them. That ordering is the whole point of the redesign: a leaderboard is read
 * crest-and-name first and figures second, and the previous layout put a scoring grid between the
 * two -- so the eye had to decode eight cells of arithmetic to reach the margin that decides the race.
 *
 * The price is the HOUSE's, read from the same market build as MacroBet and the front page, never
 * computed here. `tools/checkAwardRacePrice.ts` is what proves the three surfaces agree; this file is
 * one of the surfaces it proves.
 */
const CandidateRow: React.FC<{
  entry: RacedEntry;
  rank: number;
  isExpanded: boolean;
  onToggle: () => void;
  /** What `total` measures on THIS board, and how to print it. See `RacePanel`. */
  totalLabel: string;
  totalDecimals: number;
}> = ({ entry, rank, isExpanded, onToggle, totalLabel, totalDecimals }) => {
  const isLeader = rank === 1;
  const price = entry.houseProbability === null
    ? '—'
    : formatAmerican(probabilityToAmerican(entry.houseProbability));
  const panelId = `award-breakdown-${entry.playerId}`;

  // The candidate's club band, resolved for the panel this list is drawn on. The row used to mark
  // the leader with a gold 3px border and a lifted background; the club's edge now owns that border
  // (and club colour may never carry meaning), so the leader is marked where it still reads -- the
  // ordinal and the name in gold, the same convention the dashboard's award race uses.
  const band = clubBandPalette((entry.team?.id ?? null) as TeamId | null);

  return (
    <li className="relative overflow-hidden" style={{ background: band.fill }}>
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0"
        style={{ width: CLUB_BAND_EDGE_WIDTH, background: band.edge }}
      />
      {/*
        THE WHOLE ROW IS THE DISCLOSURE.

        It was a 16px chevron in the corner, and that turned out to be the wrong target for the one
        thing a reader does on this page: eight near-identical rows, each with a tiny control at the far
        right of a wide row, and a hit area measured in a couple of dozen pixels against a row a foot
        wide. It also read as "this part of the row is interactive", which is the wrong signal when the
        entire row is.

        So the row is one button. The chevron stays as the affordance that says it, but it is decoration
        rather than the target -- `aria-hidden`, because a screen reader is told about the control once,
        by the button's own name, instead of twice by a nested control saying the same thing.

        It is a real disclosure: `aria-expanded` and `aria-controls` name the panel it opens, so the
        relationship survives without sight of the layout.
      */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-3 text-left hover:bg-[color:color-mix(in_srgb,var(--color-ink)_6%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-gold)] md:px-4"
      >
        <span className={`w-[2ch] shrink-0 text-right t-stat ${isLeader ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-faint)]'}`}>
          {rank}
        </span>

        {entry.team ? (
          /*
            `display: contents` on the wrapper, so the crest is a direct flex item of the button while
            the element actually in the DOM is a span. `CroppedCrest` renders a div, and a div inside a
            button is not phrasing content -- browsers tolerate it, but it is invalid and the
            difference between valid and tolerated is exactly the kind of thing that breaks silently
            somewhere later.
          */
          <span className="contents">
            <CroppedCrest team={entry.team} height={AWARD_ROW_H} />
          </span>
        ) : (
          <span className="shrink-0" style={{ height: AWARD_ROW_H, width: Math.round(AWARD_ROW_H * 1.45) }} aria-hidden="true" />
        )}

        <span className="min-w-0 flex-1">
          <span
            className={`block truncate t-h3 ${isLeader ? 'text-[var(--color-gold-hi)]' : ''}`}
          >
            {entry.name}
          </span>
          {/*
            The club, and only the club.

            This line once read `Festor Mustangs · 33.6 off the lead`. The margin was dropped because
            the page already states it once, in the panel header, where it belongs: repeating a derived
            points figure on every row put eight versions of one number on screen, and each one competed
            with the club name sitting beside it -- which is the fact a reader actually needs to weigh a
            challenger against the incumbent.
          */}
          <span className="block truncate t-caption text-[var(--color-ink-faint)]">
            {entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free Agent'}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <StatValue variant={isLeader ? 'accent' : 'default'}>
            {entry.total.toFixed(totalDecimals)}
          </StatValue>
          <span className="block t-caption text-[var(--color-ink-faint)]">{totalLabel}</span>
        </span>

        {/*
          THE HOUSE PRICE. American, because that is the number a reader would say out loud and the
          number they would see if they opened MacroBet. A dash, never a fabricated price, when the
          candidate is not on the board.
        */}
        <span className="w-[6ch] shrink-0 text-right">
          <span
            className="block t-stat-sm text-[var(--color-gold-hi)]"
            title={entry.houseProbability === null
              ? 'No MacroBet price on this race'
              : `MacroBet house price — ${(entry.houseProbability * 100).toFixed(1)}% implied`}
          >
            {price}
          </span>
          <span className="block t-caption text-[var(--color-ink-faint)]">PRICE</span>
        </span>

        <span className="shrink-0 text-[var(--color-ink-faint)]" aria-hidden="true">
          {isExpanded
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />}
        </span>

        {/* The button's accessible name. Without it a reader hears eight buttons called "button". */}
        <span className="sr-only">
          {isExpanded ? 'Hide' : 'Show'} the scoring breakdown for {entry.name}
          {entry.team ? `, ${entry.team.city} ${entry.team.name}` : ''}
        </span>
      </button>

      <div id={panelId} hidden={!isExpanded}>
        {isExpanded && (
          <div className="px-3 pb-3 md:px-4">
            <ScoreBreakdown entry={entry} />
            {/* The share of the field, kept as a proportion. The PRICE above is the book's opinion in
                American; this is the model's own normalised share, and the two are different numbers
                about different things -- a leader can hold a smaller share of the field than the market
                gives him, because the market pulls toward the field. */}
            <OddsBar odds={entry.odds} label={entry.name} className="mt-2" />
          </div>
        )}
      </div>
    </li>
  );
};

/**
 * THE PRIZE.
 *
 * The belt was already an asset in the product -- `HistoryHub` shows it beside every past MVP -- and it
 * was missing from the one screen where it is most alive. History shows a belt to someone who already
 * knows who won; this page is watched while the race is still running, and the belt is the thing they
 * are all watching to see who gets it.
 *
 * So it is the largest object on the page rather than a thumbnail in a header, and it carries the
 * CURRENT holder of the race on screen -- switching the segmented control switches who is holding it.
 * That is also what stops it being decoration: the belt is the actual prize on this page, and naming
 * the man currently in front of it is the whole point of the race.
 *
 * It deliberately does NOT state the margin. That number already appears once, in the race panel's own
 * header, directly above the table it describes -- and this page had eight copies of it removed from the
 * rows for competing with the club names. Reprinting it here to make the banner feel bigger would be the
 * same mistake one level up. The banner answers "who has the belt"; the header answers "by how much".
 *
 * `object-contain` on a deliberately oversized image, because the belt is very wide (roughly 2.2:1) and
 * `object-cover` would crop the two side plates off the ends -- which is where PLATINUM and PRESTIGE
 * are marked, and those are the parts that make it a championship belt rather than a belt-shaped blob.
 */
const PrizeBanner: React.FC<{
  title: string;
  leader: RacedEntry | undefined;
}> = ({ title, leader }) => (
  <Panel className="relative overflow-hidden">
    {/*
      A gold wash behind the plate rather than a border around it. The belt is gold on black, so an
      outline fought it; the wash is the cabinet light a trophy sits under.
    */}
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.16]"
      style={{ background: 'radial-gradient(60% 120% at 50% 0%, var(--color-gold) 0%, transparent 70%)' }}
      aria-hidden="true"
    />
    <div className="relative flex flex-col items-center gap-4 px-4 py-6 md:flex-row md:gap-8 md:px-8 md:py-8">
      <img
        src={mvpBeltImage}
        alt={`The ${title} championship belt`}
        className="order-1 h-24 w-auto object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.5)] sm:h-32 lg:h-40"
      />
      <div className="order-2 min-w-0 text-center md:order-3 md:text-left">
        <p className="t-caption text-[var(--color-ink-faint)]">{title}</p>
        {leader ? (
          <>
            {/*
              A div, not a p. `TeamLogo` renders a div, and a div inside a p is invalid nesting --
              React throws on it in development and it ships anyway, which is the worst combination.
            */}
            <div className="mt-1 flex items-center justify-center gap-2 md:justify-start">
              {leader.team ? (
                <span className="contents">
                  <TeamLogo team={leader.team} sizeClass="h-9 w-9 shrink-0" />
                </span>
              ) : null}
              <span className="t-h1 truncate text-[var(--color-gold-hi)]">{leader.name}</span>
            </div>
            <p className="t-body mt-1 text-[var(--color-ink-dim)]">
              {leader.team ? `${leader.team.city} ${leader.team.name}` : 'Free Agent'}
            </p>
          </>
        ) : (
          <p className="mt-1 t-h2 text-[var(--color-ink-dim)]">Nobody holds it yet</p>
        )}
      </div>
    </div>
  </Panel>
);

/**
 * ONE RACE, FULL WIDTH.
 *
 * It was half a screen before, sitting beside the other race in a two-column grid. Both at once is
 * why the old page felt cramped: each race got half the width, so every candidate row had to be thin,
 * and the scoring grid underneath had nowhere to go. One race per screen gives each row the full
 * measure, which is what lets the leader's numbers sit at a readable size rather than a squeezed one.
 *
 * IT NOW SERVES SIX RACES, not two, and that is why it takes a `RaceDescriptor` instead of a board
 * key. The four season-end awards do not have a `MvpBoard`, do not have a market, and do not measure
 * the same thing: `total` is MODEL POINTS for the MVP races and the award's own primary metric
 * everywhere else. Printing "38.0 POINTS" beside a home-run leader, or "leads by 0.011 points"
 * where the margin is an average, would be a confident wrong number on every row of the panel -- so
 * the unit is carried on the descriptor and printed from it.
 */
interface RaceBase {
  key: string;
  title: string;
  /** What `AwardEntry.total` IS on this board. */
  totalLabel: string;
  /** The same metric as a plural noun, for the sentence. "2 home runs", not "2 HR". */
  totalNoun: string;
  totalDecimals: number;
  /** The ordering, stated on the card so the tie-breaks are not folklore. Null on the MVP races. */
  note: string | null;
  /**
   * The FIRST tie-break, named so a level margin can say what decided the race.
   *
   * Null on the MVP races, which rank on a continuous weighted score and so are not level on their
   * primary metric by construction.
   */
  tieBreakLabel: string | null;
}

/**
 * A race, discriminated on whether MacroBet sells it.
 *
 * TWO NAMED INTERFACES rather than one shape with two optional fields, or a single
 * `RaceBase & ({...} | {...})` intersection. The optional version let a `MvpBoard | undefined` reach
 * `rankSeasonAwardRace`, and the intersection version would not narrow at all -- the compiler kept
 * the whole union and rejected `race.seasonBoard`. A union of two interfaces discriminates on the
 * literal `hasMarket` tag, which is the property that decides which builder runs and which unit is
 * printed, so the compiler answers the only question that matters here.
 */
interface MarketRace extends RaceBase {
  hasMarket: true;
  board: MvpBoard;
}

interface SeasonRace extends RaceBase {
  hasMarket: false;
  seasonBoard: SeasonAwardBoard;
}

type RaceEntry = MarketRace | SeasonRace;

/**
 * An explicit predicate, because implicit narrowing did not fire inside the `useMemo` closure --
 * `race` stayed the whole union at the call site and `race.seasonBoard` was rejected. A predicate
 * names the narrowing rather than hoping for it, and it is the one construct that works regardless of
 * where the variable was declared.
 */
const isSeasonRace = (race: RaceEntry): race is SeasonRace => !race.hasMarket;

type RaceKey = MvpBoard | SeasonAwardBoard;

const RACES: readonly RaceEntry[] = [
  {
    key: 'batting', board: 'batting', hasMarket: true,
    title: AWARD_RACE_SPECS.batting.title, totalLabel: 'POINTS', totalNoun: 'points',
    totalDecimals: 1, note: null, tieBreakLabel: null,
  },
  {
    key: 'pitching', board: 'pitching', hasMarket: true,
    title: AWARD_RACE_SPECS.pitching.title, totalLabel: 'POINTS', totalNoun: 'points',
    totalDecimals: 1, note: null, tieBreakLabel: null,
  },
  ...SEASON_AWARD_RACES.map((spec): RaceEntry => ({
    key: spec.board,
    seasonBoard: spec.board,
    hasMarket: false,
    title: spec.title,
    totalLabel: spec.marginUnit,
    totalNoun: spec.marginNoun,
    totalDecimals: spec.marginDecimals,
    note: spec.note,
    tieBreakLabel: spec.tieBreakLabel,
  })),
];

const RacePanel: React.FC<{
  race: RaceEntry;
  entries: RacedEntry[];
}> = ({ race, entries }) => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(entries.slice(0, EXPANDED_DEPTH).map((entry) => entry.playerId)),
  );

  const leader = entries[0];
  const runnerUp = entries[1];
  const lead = leader && runnerUp ? leader.total - runnerUp.total : 0;

  const toggle = (playerId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  };

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex items-center justify-between gap-3 px-4 py-2.5">
        <h2 className="t-h2">
          {race.hasMarket
            ? <Trophy className="mr-2 inline h-5 w-5 text-[var(--color-platinum)]" aria-hidden="true" />
            : <Crown className="mr-2 inline h-5 w-5 text-[var(--color-gold)]" aria-hidden="true" />}
          {race.title}
        </h2>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {entries.length} {entries.length === 1 ? 'CANDIDATE' : 'CANDIDATES'}
        </span>
      </div>

      {race.note && (
        <p className="border-b border-[var(--color-chrome-lo)] px-4 py-2 text-[var(--color-ink-dim)] t-caption">
          {race.note}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="p-4 t-body text-[var(--color-ink-dim)]">
          Nobody has cleared the qualifying floor yet. The race opens once enough regular-season
          games are in the book.
        </p>
      ) : (
        <>
          {/*
            THE MARGIN, once, above the field rather than on every row.

            Lead over second is the single number a reader comes to this page for, and it was
            previously buried in a caption under a panel header while the rows below it competed for
            attention with eight-cell scoring grids. It is the race; everything else on the screen is
            evidence for it.

            The unit comes from the descriptor, so it reads "3 HOME RUNS" or "0.011 AVG" rather than
            the unitless "3.0 points" that only ever made sense for a weighted score.
          */}
          {leader && runnerUp && (
            /*
              A LEAD OF ZERO IS NOT A BUG, AND SAYING "LEADS BY 0 K" SAYS IT AS IF IT WERE.

              These four awards rank lexicographically, so the top two are frequently dead level on
              the primary metric and the race is decided on the tie-break underneath it -- two
              pitchers with the same strikeouts separated by K/9, two batters with the same home runs
              separated by slugging. Printing the raw difference then gives "leads by 0 K", which a
              reader takes for a broken number rather than for the most interesting thing on the
              panel.

              So a zero margin prints what actually decided it, naming the first tie-break from the
              board's own spec rather than a generic word.
            */
            <p className="border-b border-[var(--color-chrome-lo)] px-4 py-2 t-caption text-[var(--color-ink-dim)]">
              {lead === 0 && race.tieBreakLabel
                ? <>
                  {leader.name} and {runnerUp.name} are level on {race.totalNoun}
                  {' '}— {race.tieBreakLabel} takes it
                </>
                : <>
                  {leader.name} leads {runnerUp.name} by{' '}
                  <StatValue size="sm" variant="accent">
                    {lead.toFixed(race.totalDecimals)}
                  </StatValue>{' '}
                  {race.totalNoun}
                </>}
            </p>
          )}

          <ol className="flex flex-col divide-y divide-[var(--color-chrome-lo)]">
            {entries.map((entry, index) => (
              <CandidateRow
                key={entry.playerId}
                entry={entry}
                rank={index + 1}
                isExpanded={expanded.has(entry.playerId)}
                onToggle={() => toggle(entry.playerId)}
                totalLabel={race.totalLabel}
                totalDecimals={race.totalDecimals}
              />
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
};

/**
 * EVERY RACE ON THE PAGE, in one table.
 *
 * The two MVP races come first because they are the ones with a market behind them and the ones the
 * page was built for; the four season-end awards follow, in the order the season ends in.
 *
 * The season-end rows are declared from `SEASON_AWARD_RACES` rather than hand-written, so the title,
 * the unit and the stated ordering have exactly one definition. A race that is added to that list
 * and forgotten here is a season award that silently stays invisible all season, which is the exact
 * failure this change was made to fix.
 */
export const AwardsPage: React.FC<AwardsPageProps> = ({
  teams,
  players,
  battingStats,
  pitchingStats,
  battingRatings,
  pitchingRatings,
  onOpenBetting,
  onOpenStandings,
}) => {
  const [board, setBoard] = useState<RaceKey>('batting');

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team] as const)), [teams]);

  const awardInputs = useMemo<AwardInputs>(() => ({
    players,
    teamsById,
    battingStats: getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'),
    pitchingStats: getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'),
    /*
      The NEWEST rating per player, not the last one in the array.

      This was `new Map(battingRatings.map((r) => [r.playerId, r]))`, which keeps whichever row comes
      last in array order. That is the newest rating only if the array is sorted by season year, and
      nothing guarantees it -- the rows accumulate across universe builds, drafts and rookie promotions,
      and a rebuilt universe or an imported save reorders them. Unsorted, the race scores players against
      a stale `overall`, which produces a plausible scoreboard rather than an error.
    */
    battingRatings: getLatestBattingRatings(battingRatings),
    pitchingRatings: getLatestPitchingRatings(pitchingRatings),
  }), [battingRatings, battingStats, pitchingRatings, pitchingStats, players, teamsById]);

  /*
    THE FULL FIELD IS BUILT HERE AND THEN DISPLAYED DOWN TO THREE.

    Not `buildAwardsForBoard(board, inputs, 3)` with the market built from what is left. `buildAwardMarket`
    normalises over whatever field it is handed, so pricing a top-three posts the leader near 85% -- a
    confident, plausible, wrong number that nothing anywhere would flag. Building the whole field of
    eight and then choosing what to show is what makes the price on this page the SAME price the book
    is selling, which is the only reason for putting one here at all.

    `decided` is deliberately not passed: it sets `locked`, the sellability flag, and never touches the
    probability, so omitting it cannot move the price. This page does not sell the market; MacroBet
    does, with the real closure computed there from the archive.
  */
  const entries = useMemo<RacedEntry[]>(() => {
    const race = RACES.find((candidate) => candidate.key === board);
    if (!race) return [];

    /*
      THE TWO KINDS OF RACE, AND WHY THEY BRANCH HERE.

      The MVP races have a MacroBet market, so the field is priced from the full board and the price
      is read off that build. The season-end races have NO market -- opening four new wagering markets
      is a product decision that has not been made, and `checkAwardRacePrice` prices only what
      `AWARD_RACE_SPECS` declares -- so their price column prints the dash `CandidateRow` already
      renders for a null probability, which is the honest reading of "not on the board".

      The season branch RETURNS and the market branch falls through. Both orders are the same at
      runtime; this one puts the narrowing on the predicate above, which is what the compiler will
      actually honour inside a `useMemo` closure.
    */
    if (isSeasonRace(race)) {
      const field = rankSeasonAwardRace(race.seasonBoard, awardInputs);
      return field.map((entry) => ({ ...entry, houseProbability: null }));
    }

    const spec = AWARD_RACE_SPECS[race.board];
      const field = buildAwardsForBoard(race.board, awardInputs);
      if (field.length === 0) return [];
      const market = buildAwardMarket(spec.key, spec.title, field);
      // Keyed by playerId, the same as the market outcomes, and the same reason: matching on a
      // display name would silently drop a player whose club changed mid-season -- the one moment a
      // race is most worth reading.
      const priceBy = new Map(market.outcomes.map((outcome) => [outcome.key, outcome.consensusProbability]));
      return field.map((entry) => ({
        ...entry,
        houseProbability: priceBy.get(entry.playerId) ?? null,
      }));
  }, [awardInputs, board]);

  const race = RACES.find((candidate) => candidate.key === board) ?? RACES[0];

  return (
    <section className="space-y-5">
      <Panel variant="hero" className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="t-h1">
              <Medal className="mr-2 inline h-6 w-6 text-[var(--color-gold)]" aria-hidden="true" />
              Awards
            </h1>
            <p className="t-body mt-2 max-w-3xl text-[var(--color-ink-dim)]">
              Six races for the season&apos;s honours. The two MVP races are scored in model
              points and priced by MacroBet; the other four are won outright on a counting or
              rate figure, so their margin is stated in that figure and they carry no price yet.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              aria-label="Award race"
              mode="fill"
              value={board}
              onChange={(value) => setBoard(value as RaceKey)}
              options={RACES.map((candidate) => ({
                value: candidate.key,
                label: candidate.title,
              }))}
            />
            <RetroButton variant="ghost" size="sm" onClick={onOpenBetting}>
              <Receipt className="mr-2 h-4 w-4" aria-hidden="true" />
              See the market
            </RetroButton>
          </div>
        </div>
      </Panel>

      {/*
        `key={board}` rather than an effect inside `RacePanel`.

        The expanded set holds player ids from whichever race is on screen, so switching races would
        otherwise leave a batter's id in a set that the pitching field never matches: every row closed,
        with nothing on screen to say why. Remounting on the board change re-runs the initializer
        against the new race's own top three, which is the correct state to land in.

        Keyed on the BOARD, not on the field. The field's identity changes every time a game is
        simulated, and remounting on that would collapse a reader's open breakdowns under them
        mid-read -- while a stale id is harmless here anyway, because it simply matches no row.
      */}
      <PrizeBanner title={race.title} leader={entries[0]} />

      <RacePanel key={board} race={race} entries={entries} />

      <p className="t-caption text-[var(--color-ink-faint)]">
        {/*
          The TEAM term in every score is the club&apos;s win percentage, so the race cannot be read
          without the standings. This is the honest caveat of the scoring function and it belongs
          where the scores are, not in a comment nobody reading the page will see.
        */}
        Scores include a term for the club&apos;s record. See the standings for where that record
        stands. <button
          type="button"
          onClick={onOpenStandings}
          className="underline hover:text-[var(--color-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
        >
          Open standings
        </button>.
      </p>
    </section>
  );
};