import React, { useMemo } from 'react';
import { Award, ChevronDown, Sparkles } from 'lucide-react';
import type { DraftClassState, DraftPickRecord } from '../logic/draftLogic';
import type { Team } from '../types';
import { Panel, RetroButton, SectionTitle, TeamLogo } from './ui';

/**
 * THE CLASS THAT WAS TAKEN.
 *
 * ============================================================================
 * WHY THIS IS A RESULT AND NOT A CEREMONY
 * ============================================================================
 *
 * The draft ran pick by pick on screen: a club on the clock, six cards of prospects, a Select button on
 * each, and a "Just drafted" ticker underneath. That is a good way to *run* a draft and a poor way to
 * *read* one. Nobody finishes a draft and thinks "I want to know who pick 214 went to" -- they want to
 * know what the class produced, and they want it as a thing that happened rather than as a queue that
 * is still going.
 *
 * So the draft is now a single action: run it, and this is what came back. The board stays available
 * mid-draft for anyone who wants to make a pick by hand, but a finished draft reads as a finished draft.
 *
 * ============================================================================
 * WHY IT RENDERS THE SAME AFTER A RELOAD
 * ============================================================================
 *
 * It reads `draftClass.picks`, which is already in the save, and derives the tiers at render. There is
 * no snapshot taken when the draft completes, so there is nothing to lose -- a manager who refreshes
 * this screen sees the same class. Same property as the retirements wall, and for the same reason: a
 * presentation that only exists in React memory is a presentation that disappears.
 *
 * ============================================================================
 * WHY THE HEADLINES ARE RANKED BY POTENTIAL, NOT BY OVERALL
 * ============================================================================
 *
 * The same measure the draft board itself ranks by. A draft is a bet on a ceiling: the club taking a
 * 62-overall prospect with 91 upside is making a different decision from the club taking the best player
 * available, and ranking the finished class by current ability would quietly grade that bet on the one
 * axis it was not made on.
 *
 * It is also what makes the top of the class interesting. Ranked by overall, the top eight are eight
 * similar players; ranked by potential, they are the eight biggest swings the winter took. Ties break
 * on overall and then on age, so the ordering is one stable answer rather than whichever comparison the
 * sort happened to produce.
 */

/** How many picks earn a card rather than a line of text. */
const HEADLINE_PICKS = 8;

interface DraftResultsWallProps {
  draftClass: DraftClassState;
  teamsById: Map<string, Team>;
  /** The draft has not been simulated yet, so there is nothing to show. */
  isPending: boolean;
  onContinue: () => void;
  isComplete: boolean;
}

const rankPicks = (picks: DraftPickRecord[]): DraftPickRecord[] =>
  [...picks].sort(
    (left, right) =>
      right.potentialOverall - left.potentialOverall
      || right.overall - left.overall
      || left.age - right.age,
  );

const DraftedCard: React.FC<{
  pick: DraftPickRecord;
  team: Team | null;
  rank: number;
}> = ({ pick, team, rank }) => (
  <Panel variant="hero" className="overflow-hidden">
    <div className="flex items-start gap-4 p-4">
      {team
        ? <TeamLogo team={team} sizeClass="h-16 w-16" />
        : <div
            className="flex h-16 w-16 shrink-0 items-center justify-center border border-dashed border-[var(--color-ink-faint)]"
            aria-hidden="true"
          >
            <span className="t-caption text-[var(--color-ink-faint)]">#{pick.overallPick}</span>
          </div>}
      <div className="min-w-0 flex-1">
        {/* The name is the event. Set at display size, because a pick rendered at the same size as its
            own metadata has decided the metadata is the news. */}
        <h3 className="t-display truncate">{pick.playerName}</h3>
        <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
          {pick.playerType === 'batter' ? 'Batter' : 'Pitcher'} · {pick.primaryPosition} · {pick.age} years old
        </p>
        <p className="t-body mt-2 text-[var(--color-ink)]">
          {team
            ? `${team.city} ${team.name} took him at ${pick.overallPick}`
            : `Selected at ${pick.overallPick}`}
        </p>
        <p className="t-caption mt-1 text-[var(--color-ink-faint)]">
          Round {pick.round}, pick {pick.pickInRound} of the {pick.seasonYear} class
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="t-label text-[var(--color-ink-faint)]">OVR</p>
        <p className="t-h3 text-[var(--color-ink)]">{pick.overall}</p>
        <p className="t-label mt-1 text-[var(--color-ink-faint)]">POT</p>
        <p className="t-h2 text-[var(--color-gold)]">{pick.potentialOverall}</p>
        <p className="sr-only">Ranked {rank} in the class by potential</p>
      </div>
    </div>
  </Panel>
);

/** The long tail, as names rather than cards. */
const RestOfClass: React.FC<{
  picks: DraftPickRecord[];
  teamsById: Map<string, Team>;
}> = ({ picks, teamsById }) => (
  <Panel variant="sunken" className="p-4">
    <div className="mb-3 flex items-center gap-2">
      <ChevronDown className="h-4 w-4 text-[var(--color-ink-faint)]" aria-hidden="true" />
      <p className="t-label text-[var(--color-ink-dim)]">The rest of the class</p>
      <span className="t-caption text-[var(--color-ink-faint)]">{picks.length}</span>
    </div>
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {picks.map((pick) => {
        const team = teamsById.get(pick.teamId);
        return (
          <li key={`${pick.overallPick}-${pick.playerId}`} className="t-caption text-[var(--color-ink-dim)]">
            {pick.playerName}
            {team ? <span className="text-[var(--color-ink-faint)]"> · {team.city}</span> : null}
          </li>
        );
      })}
    </ul>
  </Panel>
);

export const DraftResultsWall: React.FC<DraftResultsWallProps> = ({
  draftClass,
  teamsById,
  isPending,
  onContinue,
  isComplete,
}) => {
  const { headline, rest, total } = useMemo(() => {
    const ranked = rankPicks(draftClass.picks);
    return {
      headline: ranked.slice(0, HEADLINE_PICKS),
      rest: ranked.slice(HEADLINE_PICKS),
      total: ranked.length,
    };
  }, [draftClass.picks]);

  if (isPending) {
    return (
      <Panel className="p-6 text-center">
        <p className="t-h3 text-[var(--color-ink)]">No class has been drafted yet</p>
        <p className="t-body mt-2 text-[var(--color-ink-dim)]">
          The lottery sets the order. Run the draft and this screen will show what the clubs took.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      <Panel variant="hero" className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5">
          <div>
            <p className="t-label text-[var(--color-gold)]">{draftClass.seasonYear} Class</p>
            <h2 className="t-display mt-1">The Class That Was Taken</h2>
            <p className="t-body mt-2 text-[var(--color-ink-dim)]">
              {total === 0
                ? 'Nobody was drafted.'
                : `${total} ${total === 1 ? 'player' : 'players'} selected across ${draftClass.totalPicks} picks.`}
            </p>
          </div>
          {onContinue && (
            <RetroButton variant="primary" onClick={onContinue} disabled={isComplete}>
              {isComplete ? 'Continue' : 'Continue to Free Agency'}
            </RetroButton>
          )}
        </div>
      </Panel>

      {headline.length > 0 && (
        <section className="space-y-3">
          <SectionTitle secondary={(
            <span className="flex items-center gap-1">
              <Award className="h-3.5 w-3.5" aria-hidden="true" />{headline.length}
            </span>
          )}>
            Top of the Class
          </SectionTitle>
          <div className="space-y-3">
            {headline.map((pick, index) => (
              <DraftedCard
                key={`${pick.overallPick}-${pick.playerId}`}
                pick={pick}
                team={teamsById.get(pick.teamId) ?? null}
                rank={index + 1}
              />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && <RestOfClass picks={rest} teamsById={teamsById} />}

      {headline.length === 0 && rest.length === 0 && (
        <Panel variant="sunken" className="p-4">
          <p className="t-body text-[var(--color-ink-dim)]">
            The draft ran and nobody was taken. The board is drawn but empty.
          </p>
        </Panel>
      )}

      {/* A named prospect with the SPARKLES mark was taken by hand rather than by the board, which is
          the one distinction in a 160-pick class worth surfacing. */}
      {headline.some((pick) => pick.waivedPlayerId) && (
        <p className="t-caption flex items-center gap-1.5 text-[var(--color-ink-faint)]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {headline.filter((pick) => pick.waivedPlayerId).length} of these picks waived somebody to get
          a name they wanted.
        </p>
      )}
    </div>
  );
};