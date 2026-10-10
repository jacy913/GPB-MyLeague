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
 * of each row is an opaque sum unless the reader can see what went into it. What changed is the
 * presentation -- a label, the figure it was computed from, and the points it contributed, laid out as
 * chips that wrap, instead of a fixed 8-column grid that forced every term into a narrow cell whether
 * or not the term needed the room.
 */
const ScoreBreakdown: React.FC<{ entry: AwardEntry }> = ({ entry }) => (
  <dl className="flex flex-wrap gap-1.5 pt-2">
    {entry.components.map((component) => (
      <div
        key={component.label}
        className="flex min-w-0 items-baseline gap-1.5 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-1"
        title={`${component.label}: ${component.detail} contributed ${component.contribution.toFixed(1)} of ${entry.total.toFixed(1)} points`}
      >
        <dt className="t-caption shrink-0 text-[var(--color-ink-faint)]">{component.label}</dt>
        <dd className="t-stat-sm shrink-0 text-[var(--color-ink)]">{component.detail}</dd>
        <dd className="t-stat-sm shrink-0 text-[var(--color-gold)]">+{component.contribution.toFixed(1)}</dd>
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
  gapToLeader: number;
}> = ({ entry, rank, isExpanded, onToggle, gapToLeader }) => {
  const isLeader = rank === 1;
  const price = entry.houseProbability === null
    ? '—'
    : formatAmerican(probabilityToAmerican(entry.houseProbability));

  return (
    <li
      className={`border-l-[3px] px-3 py-3 md:px-4 ${
        isLeader ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]' : 'border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={`w-[2ch] shrink-0 text-right t-stat ${isLeader ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-faint)]'}`}>
          {rank}
        </span>

        {entry.team ? (
          <TeamLogo team={entry.team} sizeClass="h-12 w-12 shrink-0" />
        ) : (
          <span className="h-12 w-12 shrink-0" aria-hidden="true" />
        )}

        <div className="min-w-0 flex-1">
          <p
            className={`truncate t-h3 ${isLeader ? 'text-[var(--color-gold-hi)]' : ''}`}
            title={entry.team ? `${entry.name} — ${entry.team.city} ${entry.team.name}` : `${entry.name} — Free agent`}
          >
            {entry.name}
          </p>
          <p className="truncate t-caption text-[var(--color-ink-faint)]">
            {/*
              The club, always -- on every row including the leader.

              A first cut of this showed the gap-to-lead on the non-leader rows and the club on the
              leader's, which meant the club name was invisible on exactly the rows where a reader is
              weighing a challenger against the incumbent and most wants to know who he plays for. The
              crest is on every row regardless, but a mark is not a name. The gap is still the more
              useful half of the answer for the top few, so it rides alongside the club rather than
              replacing it.
            */}
            {entry.team ? `${entry.team.city} ${entry.team.name}` : 'Free Agent'}
            {!isLeader && gapToLeader > 0 && (
              <span className="text-[var(--color-gold)]"> · {gapToLeader.toFixed(1)} off the lead</span>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <StatValue variant={isLeader ? 'accent' : 'default'}>{entry.total.toFixed(1)}</StatValue>
          <p className="t-caption text-[var(--color-ink-faint)]">POINTS</p>
        </div>

        {/*
          THE HOUSE PRICE. American, because that is the number a reader would say out loud and the
          number they would see if they opened MacroBet. A dash, never a fabricated price, when the
          candidate is not on the board.
        */}
        <div className="w-[6ch] shrink-0 text-right">
          <span
            className="t-stat-sm text-[var(--color-gold-hi)]"
            title={entry.houseProbability === null
              ? 'No MacroBet price on this race'
              : `MacroBet house price — ${(entry.houseProbability * 100).toFixed(1)}% implied`}
          >
            {price}
          </span>
          <p className="t-caption text-[var(--color-ink-faint)]">PRICE</p>
        </div>

        {/*
          THE EXPAND TOGGLE, on every row.

          Uniform rather than conditional: every candidate carries the same eight scoring components,
          so there is never a row with "nothing to open", and a control that appears on some rows and
          not others makes the reader hunt for the next one. `aria-expanded` keeps it a real disclosure
          for anyone navigating by keyboard or screen reader, and the sr-only label names the player so
          the eight identical chevrons are distinguishable when read out of context.
        */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="shrink-0 p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
        >
          {isExpanded
            ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
            : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          <span className="sr-only">
            {isExpanded ? 'Hide' : 'Show'} the scoring breakdown for {entry.name}
          </span>
        </button>
      </div>

      {isExpanded && (
        <>
          <ScoreBreakdown entry={entry} />
          {/* The share of the field, kept as a proportion. The PRICE above is the book's opinion in
              American; this is the model's own normalised share, and the two are different numbers
              about different things -- a leader can hold a smaller share of the field than the market
              gives him, because the market pulls toward the field. */}
          <OddsBar odds={entry.odds} label={entry.name} className="mt-2" />
        </>
      )}
    </li>
  );
};

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
                gapToLeader={leader ? leader.total - entry.total : 0}
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