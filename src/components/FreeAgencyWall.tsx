import React, { useMemo } from 'react';
import { ArrowLeftRight, Handshake, UserMinus, UserPlus } from 'lucide-react';
import {
  collectOffseasonMoves,
  moveSummary,
  type MovePlayer,
  type OffseasonMove,
} from '../lib/offseasonMoves';
import type { LeaguePlayerState, Team } from '../types';
import { Panel, RetroButton, SectionTitle, TeamLogo } from './ui';

/**
 * WHO ARRIVED.
 *
 * ============================================================================
 * WHY THIS IS A RESULT AND NOT A MARKET
 * ============================================================================
 *
 * Free agency used to be shown as a feed you scrolled: a card per move, ordered by weight, with the
 * long tail dropped below a line. That is honest and it is not memorable -- nothing on the screen says
 * "this is what the winter bought you", because there is no moment where the answer appears. It is a
 * list you are already scrolling past.
 *
 * The draft wall already works the other way, and the retirements wall before it. Free agency now does
 * too: the eight biggest moves are the headline, and everything else is a name in a list. A manager
 * closing the offseason should be able to say what their club did without having read anything.
 *
 * ============================================================================
 * WHY THE TOP EIGHT ARE RANKED BY RATING
 * ============================================================================
 *
 * `collectOffseasonMoves` already weights each move by the player's current overall, and a swap is
 * weighted as its BIGGER half, because averaging a trade that sends a franchise player for a prospect
 * would systematically understate exactly the move worth reporting.
 *
 * So "top eight by rating" and "the eight most consequential moves" are the same list here, which is
 * only true because the weighting was done in one place. It is the reason the threshold-and-tail shape
 * the feed used could be replaced by a fixed count rather than by re-deciding what matters in a
 * component.
 *
 * ============================================================================
 * DERIVED, NOT STORED
 * ============================================================================
 *
 * Same property as the retirement and draft walls: the transaction log is already in the save, so the
 * tiers are computed at render and a refresh shows the same winter. Nothing is snapshotted at the moment
 * the stage ran, so there is nothing to lose.
 */

/** How many moves earn a card rather than a line of text. */
const HEADLINE_MOVES = 8;

interface FreeAgencyWallProps {
  playerState: LeaguePlayerState;
  teams: Team[];
  seasonYear: number;
  /** Inclusive lower bound on the window, so earlier winters stay out. */
  fromDate: string;
  isPending: boolean;
  onContinue: () => void;
  isComplete: boolean;
}

/** The crest a card leads with: the club he arrived at, or the club that let him go. */
const PrimaryTeamFor = (move: OffseasonMove): string | null =>
  move.kind === 'release' ? move.fromTeamId : move.toTeamId;

const glyphFor = (kind: OffseasonMove['kind']) => {
  if (kind === 'trade') return <ArrowLeftRight className="h-5 w-5 text-[var(--color-gold)]" aria-hidden="true" />;
  if (kind === 'release') return <UserMinus className="h-5 w-5 text-[var(--color-ink-faint)]" aria-hidden="true" />;
  return <UserPlus className="h-5 w-5 text-[var(--color-gold)]" aria-hidden="true" />;
};

const MoveCard: React.FC<{ move: OffseasonMove; teamsById: Map<string, Team> }> = ({ move, teamsById }) => {
  const primary = teamsById.get(PrimaryTeamFor(move) ?? '') ?? null;
  const secondary = move.kind === 'trade'
    ? teamsById.get((move.fromTeamId === primary?.id ? move.toTeamId : move.fromTeamId) ?? '') ?? null
    : null;
  const [first, second] = move.players;

  const label = (subject: MovePlayer | undefined): string =>
    subject ? `${subject.player.firstName} ${subject.player.lastName}` : '';

  return (
    <Panel variant="hero" className="overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        <div className="flex shrink-0 items-center gap-1">
          {primary ? <TeamLogo team={primary} sizeClass="h-16 w-16" /> : (
            <div className="flex h-16 w-16 items-center justify-center border border-dashed border-[var(--color-ink-faint)]" aria-hidden="true">
              <Handshake className="h-5 w-5 text-[var(--color-ink-faint)]" />
            </div>
          )}
          {secondary ? <TeamLogo team={secondary} sizeClass="h-12 w-12" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          {/* The name is the event. */}
          <h3 className="t-display truncate">
            {first ? label(first) : ''}{second ? <span className="text-[var(--color-gold)]"> ↔ {label(second)}</span> : null}
          </h3>
          <p className="t-caption mt-1 flex items-center gap-1.5 text-[var(--color-ink-faint)]">
            {glyphFor(move.kind)}
            {move.kind === 'trade'
              ? `${primary ? primary.city : 'Unknown'} acquire ${second ? label(second) : ''} for ${first ? label(first) : ''}`
              : move.kind === 'signing'
                ? `${primary ? `${primary.city} ${primary.name}` : 'A club'} sign ${first ? label(first) : ''}`
                : `${primary ? `${primary.city} ${primary.name}` : 'A club'} release ${first ? label(first) : ''}`}
          </p>
          <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
            {[first, second]
              .filter(Boolean)
              .map((subject) => `${subject!.player.primaryPosition} · ${subject!.overall} OVR`)
              .join('   ')}
          </p>
        </div>
      </div>
    </Panel>
  );
};

export const FreeAgencyWall: React.FC<FreeAgencyWallProps> = ({
  playerState,
  teams,
  seasonYear,
  fromDate,
  isPending,
  onContinue,
  isComplete,
}) => {
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const { headline, rest, total } = useMemo(() => {
    const { moves } = collectOffseasonMoves(playerState, fromDate);
    return {
      headline: moves.slice(0, HEADLINE_MOVES),
      rest: moves.slice(HEADLINE_MOVES),
      total: moves.length,
    };
  }, [playerState, fromDate]);

  if (isPending) {
    return (
      <Panel className="p-6 text-center">
        <p className="t-h3 text-[var(--color-ink)]">Free agency has not run yet</p>
        <p className="t-body mt-2 text-[var(--color-ink-dim)]">
          The league signs its free agents when this step runs. Nothing has moved so far this winter.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div>
            <p className="t-label text-[var(--color-gold)]">{seasonYear} Winter</p>
            <h2 className="t-display mt-1">Who Arrived</h2>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              {total === 0
                ? 'Nobody changed clubs this winter.'
                : `${total} ${total === 1 ? 'move' : 'moves'} across the league — the eight biggest first.`}
            </p>
          </div>
          {onContinue && (
            <RetroButton variant="primary" onClick={onContinue} disabled={isComplete}>
              {isComplete ? 'Continue' : 'Start the Next Season'}
            </RetroButton>
          )}
        </div>
      </Panel>

      {headline.length > 0 && (
        <section className="space-y-3">
          <SectionTitle secondary={headline.length}>The Biggest Names</SectionTitle>
          <div className="space-y-3">
            {headline.map((move) => (
              <MoveCard key={move.id} move={move} teamsById={teamsById} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <Panel variant="sunken" className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <p className="t-label text-[var(--color-ink-dim)]">Everything else that moved</p>
            <span className="t-caption text-[var(--color-ink-faint)]">{rest.length}</span>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {rest.map((move) => (
              <li key={move.id} className="t-caption text-[var(--color-ink-dim)]">
                {moveSummary(move)}
                <span className="text-[var(--color-ink-faint)]">
                  {' '}· {PrimaryTeamFor(move) ? teamsById.get(PrimaryTeamFor(move)!)?.city : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {headline.length === 0 && rest.length === 0 && (
        <Panel variant="sunken" className="p-4">
          <p className="t-body text-[var(--color-ink-dim)]">
            A quiet market. Nobody changed clubs this winter.
          </p>
        </Panel>
      )}
    </div>
  );
};