import React, { useMemo } from 'react';
import { ChevronDown, Gavel, Sparkles } from 'lucide-react';
import type { DraftClassState, DraftProspect } from '../logic/draftLogic';
import type { Team } from '../types';
import { Panel, RetroButton, TeamLogo } from './ui';

/**
 * ON THE CLOCK.
 *
 * ============================================================================
 * A COMMISSIONER BROADCAST, NOT A USER'S DRAFT
 * ============================================================================
 *
 * There is no user-owned club in this league -- 32 teams, one commissioner, and every pick is
 * already the commissioner's to make. So nothing here is "your pick". What a draft is, for someone
 * running all of it, is a broadcast: who is up, what they take, and how good it is.
 *
 * That framing is why this panel leads with the club on the clock and its crest, and why the best
 * available is offered rather than assigned. A commissioner watching round one is deciding how the
 * class shapes up; showing them the top of the board as a choice respects that, and taking it
 * automatically is one click away in the controls above.
 *
 * ============================================================================
 * WHY THE SHORTLIST IS SIX, AND WHY IT IS EXPANDABLE
 * ============================================================================
 *
 * Six is enough to see the shape of a round and few enough to read without scrolling. But the class
 * is 700-odd prospects and there is a real argument for reaching past the sixth -- a reach pick on a
 * known need is a legitimate thing to want, and a panel that makes it impossible would be quietly
 * deciding what kind of commissioner this is.
 *
 * So the shortlist is the default and the whole remaining board is one click away. The full list is
 * RANKED BY THE SAME MEASURE as the shortlist, so expanding shows more of the same argument rather
 * than a different ordering.
 *
 * ============================================================================
 * THE PICK IS THE ONLY DECISION HERE, AND IT IS OPTIONAL
 * ============================================================================
 *
 * Every card makes the pick. "Take the best" is on the clock panel itself, because choosing nothing
 * is also a legitimate way to run a draft and forcing a click to express that would be a small
 * hostility. A reload mid-draft loses nothing: the board is persisted, and this panel renders from
 * it rather than from anything held here.
 */

/** How many prospects the shortlist offers before the full board is one click away. */
const SHORTLIST_SIZE = 6;

export interface DraftClock {
  teamId: string;
  round: number;
  pickInRound: number;
  overallPick: number;
  remaining: number;
}

interface DraftCeremonyProps {
  draftClass: DraftClassState | null;
  teamsById: Map<string, Team>;
  clock: DraftClock | null;
  /** Every pick made so far, newest first. */
  recentPicks: DraftClassState['picks'];
  isDraftProcessing: boolean;
  isDraftOpen: boolean;
  onTakeBest: () => void;
  onTakeProspect: (playerId: string) => void;
}

/**
 * THE ORDER THE SHORTLIST IS RANKED IN.
 *
 * Potential first, then current overall. Potential leads because a draft is a bet on a ceiling: the
 * club paying a 62-overall prospect for 91 upside is making a different decision from the club taking
 * the best player available, and putting potential in front is what makes that legible.
 *
 * Ties break on overall and then on age, so the panel has one stable order rather than whichever
 * comparison the sort happened to produce.
 */
const rankProspects = (prospects: DraftProspect[]): DraftProspect[] =>
  [...prospects].sort(
    (left, right) =>
      right.potentialOverall - left.potentialOverall
      || right.overall - left.overall
      || left.age - right.age,
  );

const ProspectCard: React.FC<{
  prospect: DraftProspect;
  rank: number;
  isBest: boolean;
  disabled: boolean;
  onTake: (playerId: string) => void;
}> = ({ prospect, rank, isBest, disabled, onTake }) => (
  <Panel variant={isBest ? 'hero' : 'default'} className={`h-full overflow-hidden ${isBest ? 'border-[var(--color-gold)]' : ''}`}>
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="t-label text-[var(--color-ink-faint)]">#{rank}</span>
        {isBest && (
          <span className="t-caption flex items-center gap-1 text-[var(--color-gold)]">
            <Sparkles className="h-3 w-3" aria-hidden="true" /> BEST AVAILABLE
          </span>
        )}
      </div>
      <p className={`${isBest ? 't-h2' : 't-h3'} leading-tight text-[var(--color-ink)]`}>
        {prospect.firstName} {prospect.lastName}
      </p>
      <p className="t-caption text-[var(--color-ink-faint)]">
        {prospect.playerType === 'batter' ? 'Batter' : 'Pitcher'} · {prospect.primaryPosition} ·{' '}
        {prospect.age}
      </p>
      <p className="t-caption text-[var(--color-ink-dim)]">{prospect.archetype}</p>
      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
        <span className="t-stat-sm text-[var(--color-ink-dim)]">
          {prospect.overall} OVR
        </span>
        <span className="t-stat text-[var(--color-gold)]">{prospect.potentialOverall} POT</span>
      </div>
      <RetroButton
        variant={isBest ? 'primary' : 'default'}
        onClick={() => onTake(prospect.playerId)}
        disabled={disabled}
      >
        <Gavel className="h-4 w-4" aria-hidden="true" /> Select
      </RetroButton>
    </div>
  </Panel>
);

export const DraftCeremony: React.FC<DraftCeremonyProps> = ({
  draftClass,
  teamsById,
  clock,
  recentPicks,
  isDraftProcessing,
  isDraftOpen,
  onTakeBest,
  onTakeProspect,
}) => {
  const onClockTeam = clock ? teamsById.get(clock.teamId) ?? null : null;

  const ranked = useMemo(
    () => (draftClass ? rankProspects(draftClass.prospects) : []),
    [draftClass],
  );
  const shortlist = ranked.slice(0, SHORTLIST_SIZE);

  if (!draftClass) {
    return (
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-col items-center gap-2 p-8 text-center">
          <p className="t-h2 text-[var(--color-ink)]">No Board Drawn</p>
          <p className="t-body max-w-lg text-[var(--color-ink-dim)]">
            The lottery sets the order. Once it runs, this panel calls each club to the microphone and
            records what they take.
          </p>
        </div>
      </Panel>
    );
  }

  const latest = [...recentPicks].reverse().slice(0, 5);

  return (
    <div className="space-y-4">
      {/* -- the clock ------------------------------------------------------------------- */}
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="t-label text-[var(--color-gold)]">
              {clock
                ? `Round ${clock.round} · Pick ${clock.pickInRound} · Overall #${clock.overallPick}`
                : draftClass.isComplete
                  ? `${draftClass.picks.length} picks made`
                  : 'No club on the clock'}
            </p>
            <h2 className="t-display mt-1 truncate">
              {onClockTeam
                ? `${onClockTeam.city} ${onClockTeam.name}`
                : draftClass.isComplete
                  ? 'Draft Complete'
                  : 'Draft Board Empty'}
            </h2>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              {clock
                ? `${clock.remaining} ${clock.remaining === 1 ? 'pick' : 'picks'} left in this class.`
                : draftClass.isComplete
                  ? `${draftClass.picks.length} prospects were drafted.`
                  : 'No club is on the clock.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            {onClockTeam && <TeamLogo team={onClockTeam} sizeClass="h-20 w-20" />}
            {clock && (
              <RetroButton
                variant="primary"
                onClick={onTakeBest}
                disabled={isDraftProcessing || !isDraftOpen}
              >
                Take the Best
              </RetroButton>
            )}
          </div>
        </div>
      </Panel>

      {/* -- the board ------------------------------------------------------------------ */}
      {shortlist.length === 0 ? (
        <Panel variant="sunken" className="p-4">
          <p className="t-body text-[var(--color-ink-dim)]">
            The board is empty. Everyone available has been drafted.
          </p>
        </Panel>
      ) : (
        <section className="space-y-3">
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shortlist.map((prospect, index) => (
              <li key={prospect.playerId}>
                <ProspectCard
                  prospect={prospect}
                  rank={index + 1}
                  isBest={index === 0}
                  disabled={isDraftProcessing || !isDraftOpen || !clock}
                  onTake={onTakeProspect}
                />
              </li>
            ))}
          </ol>

          {/* The full board, ranked by the same measure. A reach pick has to be reachable or the
              panel is deciding what kind of commissioner this is. */}
          {ranked.length > SHORTLIST_SIZE && (
            <details className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)]">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 t-caption text-[var(--color-ink-dim)]">
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                All {ranked.length} remaining prospects, same order
              </summary>
              <ol className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
                {ranked.slice(SHORTLIST_SIZE).map((prospect, index) => (
                  <li
                    key={prospect.playerId}
                    className="flex items-center justify-between gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-base-2)] px-3 py-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="t-caption block truncate text-[var(--color-ink-faint)]">
                        #{index + SHORTLIST_SIZE + 1}
                      </span>
                      <span className="t-stat-sm block truncate text-[var(--color-ink)]">
                        {prospect.firstName} {prospect.lastName}
                      </span>
                      <span className="t-caption block text-[var(--color-ink-faint)]">
                        {prospect.primaryPosition} · {prospect.overall} OVR ·{' '}
                        <span className="text-[var(--color-gold)]">{prospect.potentialOverall} POT</span>
                      </span>
                    </span>
                    <RetroButton
                      variant="ghost"
                      onClick={() => onTakeProspect(prospect.playerId)}
                      disabled={isDraftProcessing || !isDraftOpen || !clock}
                    >
                      Select
                    </RetroButton>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}

      {/* -- what just happened ---------------------------------------------------------- */}
      {latest.length > 0 && (
        <Panel variant="sunken" className="p-4">
          <p className="t-label text-[var(--color-ink-dim)]">Just drafted</p>
          <ul className="mt-2 space-y-1">
            {latest.map((pick) => {
              const team = teamsById.get(pick.teamId);
              return (
                <li key={`${pick.overallPick}-${pick.playerId}`} className="t-caption text-[var(--color-ink-dim)]">
                  <span className="text-[var(--color-ink-faint)]">
                    R{pick.round} P{pick.pickInRound} ·{' '}
                  </span>
                  <span className="text-[var(--color-ink)]">{pick.playerName}</span>{' '}
                  <span className="text-[var(--color-ink-faint)]">
                    ({pick.primaryPosition}, {pick.overall} OVR / {pick.potentialOverall} POT) to{' '}
                    {team ? `${team.city} ${team.name}` : pick.teamId.toUpperCase()}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
};