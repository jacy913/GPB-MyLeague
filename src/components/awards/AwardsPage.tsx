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
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../../logic/playerStats';
import { buildAwardsForBoard, type AwardEntry, type AwardInputs, type MvpBoard } from '../../lib/awardRace';
import { AWARD_RACE_SPECS, buildAwardMarket } from '../../lib/mediaMarkets';
import { formatAmerican, probabilityToAmerican } from '../../lib/markets';
import mvpBeltImage from '../../assets/mvpbelt.png';
import {
  OddsBar,
  Panel,
  RetroButton,
  SegmentedControl,
  StatValue,
  TeamLogo,
} from '../ui';

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
        title={`${component.label}: ${component.detail} — ${component.contribution.toFixed(1)} of the ${entry.total.toFixed(1)} points`}
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
}> = ({ entry, rank, isExpanded, onToggle }) => {
  const isLeader = rank === 1;
  const price = entry.houseProbability === null
    ? '—'
    : formatAmerican(probabilityToAmerican(entry.houseProbability));
  const panelId = `award-breakdown-${entry.playerId}`;

  return (
    <li
      className={`border-l-[3px] ${
        isLeader ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]' : 'border-l-transparent'
      }`}
    >
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
        className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-[var(--color-panel-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-gold)] md:px-4"
      >
        <span className={`w-[2ch] shrink-0 text-right t-stat ${isLeader ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-faint)]'}`}>
          {rank}
        </span>

        {entry.team ? (
          /*
            `display: contents` on the wrapper, so the crest is a direct flex item of the button while
            the element actually in the DOM is a span. `TeamLogo` renders a div, and a div inside a
            button is not phrasing content -- browsers tolerate it, but it is invalid and the
            difference between valid and tolerated is exactly the kind of thing that breaks silently
            somewhere later.
          */
          <span className="contents">
            <TeamLogo team={entry.team} sizeClass="h-12 w-12 shrink-0" />
          </span>
        ) : (
          <span className="h-12 w-12 shrink-0" aria-hidden="true" />
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
          <StatValue variant={isLeader ? 'accent' : 'default'}>{entry.total.toFixed(1)}</StatValue>
          <span className="block t-caption text-[var(--color-ink-faint)]">POINTS</span>
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
 */
const RacePanel: React.FC<{
  board: MvpBoard;
  entries: RacedEntry[];
}> = ({ board, entries }) => {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(entries.slice(0, EXPANDED_DEPTH).map((entry) => entry.playerId)),
  );

  const spec = AWARD_RACE_SPECS[board];
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
          {board === 'batting'
            ? <Crown className="mr-2 inline h-5 w-5 text-[var(--color-gold)]" aria-hidden="true" />
            : <Trophy className="mr-2 inline h-5 w-5 text-[var(--color-platinum)]" aria-hidden="true" />}
          {spec.title}
        </h2>
        <span className="t-caption text-[var(--color-ink-faint)]">
          {entries.length} {entries.length === 1 ? 'CANDIDATE' : 'CANDIDATES'}
        </span>
      </div>

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
          */}
          {leader && runnerUp && (
            <p className="border-b border-[var(--color-chrome-lo)] px-4 py-2 t-caption text-[var(--color-ink-dim)]">
              {leader.name} leads {runnerUp.name} by{' '}
              <StatValue size="sm" variant="accent">{lead.toFixed(1)}</StatValue> points
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
              />
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
};

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
  const [board, setBoard] = useState<MvpBoard>('batting');

  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const awardInputs = useMemo<AwardInputs>(() => ({
    players,
    teamsById,
    battingStats: getPreferredBattingStatsByPlayerId(battingStats, 'regular_season'),
    pitchingStats: getPreferredPitchingStatsByPlayerId(pitchingStats, 'regular_season'),
    battingRatings: new Map(battingRatings.map((rating) => [rating.playerId, rating])),
    pitchingRatings: new Map(pitchingRatings.map((rating) => [rating.playerId, rating])),
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
    const spec = AWARD_RACE_SPECS[board];
    const field = buildAwardsForBoard(board, awardInputs);
    if (field.length === 0) return [];
    const market = buildAwardMarket(spec.key, spec.title, field);
    // Keyed by playerId, the same as the market outcomes, and the same reason: matching on a display
    // name would silently drop a player whose club changed mid-season -- the one moment a race is
    // most worth reading.
    const priceBy = new Map(market.outcomes.map((outcome) => [outcome.key, outcome.consensusProbability]));
    return field.map((entry) => ({
      ...entry,
      houseProbability: priceBy.get(entry.playerId) ?? null,
    }));
  }, [awardInputs, board]);

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
              The season&apos;s most valuable players, and the arithmetic behind every score. Points
              are the model&apos;s own; the price beside them is MacroBet&apos;s, read from the same
              board the book is selling.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              aria-label="Award race"
              mode="fill"
              value={board}
              onChange={(value) => setBoard(value as MvpBoard)}
              options={[
                { value: 'batting', label: AWARD_RACE_SPECS.batting.title },
                { value: 'pitching', label: AWARD_RACE_SPECS.pitching.title },
              ]}
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
      <PrizeBanner title={AWARD_RACE_SPECS[board].title} leader={entries[0]} />

      <RacePanel key={board} board={board} entries={entries} />

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