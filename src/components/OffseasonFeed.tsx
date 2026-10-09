import React, { useMemo } from 'react';
import { ArrowLeftRight, MoveRight, Newspaper, UserMinus, UserPlus } from 'lucide-react';
import {
  blockbusters,
  collectOffseasonMoves,
  isHeadlineMove,
  moveHeadline,
  moveSummary,
  type MovePlayer,
  type OffseasonMove,
} from '../lib/offseasonMoves';
import type { LeaguePlayerState, Team } from '../types';
import { Panel, SectionTitle, TeamLogo } from './ui';

/**
 * THIS WINTER, IN BASEBALL.
 *
 * ============================================================================
 * THE CARD IS THE ARGUMENT
 * ============================================================================
 *
 * Two crests facing each other is not decoration; it is the only shape that states what a trade IS.
 * A trade rendered as two list rows reads as two unrelated facts, and a trade rendered as one line of
 * text reads as a footnote. Facing the crests makes the swap the subject, which is the whole content
 * of the event.
 *
 * ============================================================================
 * HEADLINES FIRST, THEN EVERYTHING ELSE
 * ============================================================================
 *
 * A 32-club winter produces hundreds of signings. Leading with all of them would assert that a
 * re-signed reserve and a franchise addition are the same size of news. So the feed leads with the
 * moves that cleared the bar and drops the rest into a compact tail -- same shape as the retirements
 * wall, same threshold constant, one idea applied twice.
 */

interface OffseasonFeedProps {
  playerState: LeaguePlayerState;
  teams: Team[];
  seasonYear: number;
  /** Inclusive lower bound on the window, so earlier winters stay out of the feed. */
  fromDate: string;
  isPending: boolean;
}

const MovePlayerBlock: React.FC<{
  subject: MovePlayer;
  team: Team | null;
  align: 'left' | 'right';
  emphasis: boolean;
}> = ({ subject, team, align, emphasis }) => (
  <div className={`flex min-w-0 flex-col gap-2 ${align === 'right' ? 'items-end text-right' : 'items-start'}`}>
    {team
      ? <TeamLogo team={team} sizeClass={emphasis ? 'h-14 w-14' : 'h-10 w-10'} />
      : <div
          className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-[var(--color-ink-faint)]"
          aria-hidden="true"
        >
          <UserMinus className="h-4 w-4 text-[var(--color-ink-faint)]" />
        </div>}
    <p className={`${emphasis ? 't-h3' : 't-label'} leading-tight text-[var(--color-ink)]`}>
      {subject.player.firstName} {subject.player.lastName}
    </p>
    <p className="t-caption text-[var(--color-ink-faint)]">
      {subject.player.primaryPosition}
      {subject.overall > 0 ? ` · ${subject.overall} OVR` : ''}
    </p>
  </div>
);

const TradeCard: React.FC<{
  move: OffseasonMove;
  fromTeam: Team | null;
  toTeam: Team | null;
  teamName: (teamId: string | null) => string;
  emphasis: boolean;
}> = ({ move, fromTeam, toTeam, teamName, emphasis }) => {
  const [first, second] = move.players;
  if (!first || !second) return null;

  return (
    <Panel variant={emphasis ? 'hero' : 'default'} className="overflow-hidden">
      <div className="chrome-bar flex items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
          <h3 className={emphasis ? 't-h2' : 't-h3'}>{moveHeadline(move, teamName)}</h3>
        </div>
        <span className="t-caption text-[var(--color-ink-faint)]">{move.effectiveDate}</span>
      </div>
      <div className="flex items-center justify-between gap-3 p-4">
        <MovePlayerBlock subject={first} team={fromTeam} align="left" emphasis={emphasis} />
        <div className="flex shrink-0 flex-col items-center gap-1 px-2">
          <span className="t-label text-[var(--color-ink-faint)]">FOR</span>
          <MoveRight className="h-5 w-5 text-[var(--color-gold)]" aria-hidden="true" />
        </div>
        <MovePlayerBlock subject={second} team={toTeam} align="right" emphasis={emphasis} />
      </div>
    </Panel>
  );
};

const OneWayCard: React.FC<{
  move: OffseasonMove;
  team: Team | null;
  teamName: (teamId: string | null) => string;
  emphasis: boolean;
}> = ({ move, team, teamName, emphasis }) => {
  const subject = move.players[0];
  if (!subject) return null;
  const Icon = move.kind === 'signing' ? UserPlus : UserMinus;

  return (
    <Panel variant={emphasis ? 'hero' : 'default'} className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-[var(--color-gold)]" aria-hidden="true" />
            <p className="t-caption text-[var(--color-ink-faint)]">
              {move.kind === 'signing' ? 'SIGNED' : 'RELEASED'} · {move.effectiveDate}
            </p>
          </div>
          <h3 className={`${emphasis ? 't-h2' : 't-h3'} leading-tight text-[var(--color-ink)]`}>
            {subject.player.firstName} {subject.player.lastName}
          </h3>
          <p className="t-body text-[var(--color-ink-dim)]">
            {moveHeadline(move, teamName)}
          </p>
        </div>
        {team
          ? <TeamLogo team={team} sizeClass={emphasis ? 'h-16 w-16' : 'h-12 w-12'} />
          : <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--color-ink-faint)]"
              aria-hidden="true"
            >
              <UserMinus className="h-5 w-5 text-[var(--color-ink-faint)]" />
            </div>}
      </div>
    </Panel>
  );
};

const MoveCard: React.FC<{
  move: OffseasonMove;
  teamsById: Map<string, Team>;
  teamName: (teamId: string | null) => string;
}> = ({ move, teamsById, teamName }) => {
  const emphasis = isHeadlineMove(move);
  if (move.kind === 'trade') {
    return (
      <TradeCard
        move={move}
        fromTeam={move.fromTeamId ? teamsById.get(move.fromTeamId) ?? null : null}
        toTeam={move.toTeamId ? teamsById.get(move.toTeamId) ?? null : null}
        teamName={teamName}
        emphasis={emphasis}
      />
    );
  }
  const clubId = move.kind === 'signing' ? move.toTeamId : move.fromTeamId;
  return (
    <OneWayCard
      move={move}
      team={clubId ? teamsById.get(clubId) ?? null : null}
      teamName={teamName}
      emphasis={emphasis}
    />
  );
};

export const OffseasonFeed: React.FC<OffseasonFeedProps> = ({
  playerState,
  teams,
  seasonYear,
  fromDate,
  isPending,
}) => {
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);

  const teamName = useMemo(
    () => (teamId: string | null) => (teamId ? teamsById.get(teamId)?.city ?? teamId.toUpperCase() : 'the league'),
    [teamsById],
  );

  // Derived at render from the persisted log, exactly like the retirements wall -- so the winter
  // reads the same after a reload as it did before one.
  const { headlines, tail, total, departedPlayerRows } = useMemo(() => {
    const { moves, departedPlayerRows: departed } = collectOffseasonMoves(playerState, fromDate);
    return {
      headlines: blockbusters(moves),
      tail: moves.filter((move) => !isHeadlineMove(move)),
      total: moves.length,
      departedPlayerRows: departed,
    };
  }, [playerState, fromDate]);

  if (isPending) {
    return (
      <Panel className="p-6 text-center">
        <p className="t-h3 text-[var(--color-ink)]">The winter has not moved anyone yet</p>
        <p className="t-body mt-2 text-[var(--color-ink-dim)]">
          Trades and signings appear here once the market is open.
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
            <h2 className="t-display mt-1">This Offseason, Baseball Changed</h2>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              {total === 0
                ? 'No clubs moved. The league you finished is the league you open with.'
                : `${total} ${total === 1 ? 'move' : 'moves'} recorded, ${headlines.length} of them big enough to lead the feed.`}
            </p>
            {/* Moves whose player row has since been pruned -- a free agent aged out of the
                league keeps their transaction but loses their record. Saying so is honest; leaving
                them out would make this count disagree with the archive without saying why. */}
            {departedPlayerRows > 0 && (
              <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
                {departedPlayerRows} further {departedPlayerRows === 1 ? 'move' : 'moves'} in the
                archive {departedPlayerRows === 1 ? 'refers' : 'refer'} to{' '}
                {departedPlayerRows === 1 ? 'a player who has' : 'players who have'} since left the
                league, and cannot be shown here.
              </p>
            )}
          </div>
        </div>
      </Panel>

      {headlines.length > 0 && (
        <section className="space-y-3">
          <SectionTitle secondary={<Newspaper className="h-3.5 w-3.5" aria-hidden="true" />}>
            The Headlines
          </SectionTitle>
          <div className="space-y-3">
            {headlines.map((move) => (
              <MoveCard key={move.id} move={move} teamsById={teamsById} teamName={teamName} />
            ))}
          </div>
        </section>
      )}

      {tail.length > 0 && (
        <Panel variant="sunken" className="p-4">
          <p className="t-label text-[var(--color-ink-dim)]">
            The Rest <span className="text-[var(--color-ink-faint)]">({tail.length})</span>
          </p>
          <ul className="mt-3 space-y-1">
            {tail.map((move) => (
              <li key={move.id} className="t-caption text-[var(--color-ink-dim)]">
                <span className="text-[var(--color-ink-faint)]">{move.effectiveDate}</span>{' '}
                {moveSummary(move)}{' '}
                <span className="text-[var(--color-ink-faint)]">
                  · {teamName(move.kind === 'signing' ? move.toTeamId : move.fromTeamId)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {total === 0 && (
        <Panel variant="sunken" className="p-4">
          <p className="t-body text-[var(--color-ink-dim)]">
            A quiet winter. Not a club in the league signed anyone or completed a trade.
          </p>
        </Panel>
      )}
    </div>
  );
};