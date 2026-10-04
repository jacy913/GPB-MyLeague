import React from 'react';
import { TeamLogo } from './ui';
import { Modal } from './ui/Modal';
import { Panel } from './ui/Panel';
import { RetroButton } from './ui/RetroButton';
import { formatHeaderDate } from './SeasonCalendarStrip';
import type {
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryLeagueWinner,
  SeasonHistoryTeamRecord,
  Team,
} from '../types';

/**
 * THE SEASON'S AWARDS, AS A RESULT TO READ.
 *
 * ============================================================================
 * WHAT THIS IS NOT ANY MORE
 * ============================================================================
 *
 * This was a ballot. It asked the manager to pick a Batting MVP, a Pitching MVP and a World Series
 * MVP, and pressing "Save Award Winners" is what wrote `seasonHistory` -- which is also what
 * settles award bets. So the click WAS the outcome: open the ballot, name the winner, then go to
 * MacroBet and back him at whatever the board priced. The market and the answer were the same act.
 *
 * The user's framing is the correction: "we bet because it is a discrete outcome that happens
 * outside of our control. we use analytics and media opinions to determine these."
 *
 * So the winners are now the top of each ranked candidate list, taken from the season that has
 * finished, and `useSeasonLifecycle` writes the archive the moment the season ends. There is nothing
 * to choose here, and no button that could reintroduce a choice.
 *
 * ============================================================================
 * WHY IT IS STILL WORTH SHOWING
 * ============================================================================
 *
 * Because a result you cannot check is a result you have to take on faith, and the whole point of
 * betting on an award is that you think you know who will win. This answers "who, and on what
 * evidence": the winner at the top of their own ranking, the runners-up below with the numbers that
 * put them second, and the gap between them.
 *
 * It is also the audit trail. If a bet on an award lost, this is where the reasoning that decided
 * it is on screen.
 *
 * ============================================================================
 * WHY IT STILL ADVANCES THE OFFSEASON
 * ============================================================================
 *
 * Reading a result is a reasonable thing to gate a checklist on. Deciding one is not, and those are
 * different: dismissing this advances 'awards' to 'retirements' and changes nothing about who won.
 *
 * ============================================================================
 * THE CHROME
 * ============================================================================
 *
 * Built on `Modal`, `Panel` and `RetroButton` rather than on a hand-rolled dialog, which is the whole
 * correction. The first version of this screen was written by copying the old ballot's markup, and
 * that markup is exactly the surface `docs/playoff-bracket-ui-enhancements.md` §5 exists to
 * eliminate: `font-mono` thirteen times, `font-headline` (a family that is never loaded and silently
 * falls back to Teko), five distinct large radii, two hardcoded hex gradients, hardcoded
 * `#d4bb6a`/`#d8c88b` text and borders, and an 80px blurred drop shadow. It was the old UI with new
 * copy on it, which is the worst of both -- it looked un-migrated while reading as finished.
 *
 * `Modal` also brings behaviour that a hand-rolled dialog has to remember and usually gets wrong:
 * Escape closes, focus moves in and returns to the opener, Tab is trapped, the page behind does not
 * scroll, and the dialog is portalled to `document.body` so it is not clipped by the scroll
 * containers the betting and media pages sit inside.
 */
export interface SeasonAwardsSummaryState {
  seasonYear: number;
  champion: SeasonHistoryTeamRecord | null;
  leagueChampions: SeasonHistoryLeagueWinner[];
  divisionWinners: SeasonHistoryDivisionWinner[];
  battingCandidates: SeasonHistoryAwardWinner[];
  pitchingCandidates: SeasonHistoryAwardWinner[];
  worldSeriesCandidates: SeasonHistoryAwardWinner[];
  worldSeriesCompletedGames: number;
  worldSeriesStartDate: string;
  worldSeriesEndDate: string;
}

interface SeasonAwardsSummaryProps {
  selection: SeasonAwardsSummaryState | null;
  /** False until the manager has read it, which is what opens the screen. */
  seen: boolean;
  resolveAwardCandidateTeam: (candidate: SeasonHistoryAwardWinner) => Team | null;
  onDismiss: () => void;
}

/**
 * One award: the winner, then the field behind them.
 *
 * The winner is pulled out of the list rather than marked in place, because "the top of this list"
 * is the entire reason they won, and a highlighted row among equals does not say that as plainly as
 * a row above a rule does.
 *
 * There is no "Winner" label beside the leader.
 *
 * That is the same judgement docs/playoff-bracket-ui-enhancements.md made on the bracket, where
 * "1 from 3", "Match point -- X needs one more" and "BO3" were deleted for restating figures
 * already printed directly above them. Here the leader is marked twice over already: the rank
 * prefix and the gold left-edge. A third signal for one fact is noise on a screen whose only
 * job is to state a result, and it was the loudest thing in the row.
 * The runners-up stay visible with their numbers, because "he won by 0.4" is the interesting fact
 * and hiding it would be the same mistake in the other direction.
 */
const AwardResult: React.FC<{
  title: string;
  eyebrow: string;
  footnote?: string;
  candidates: SeasonHistoryAwardWinner[];
  resolveTeam: (candidate: SeasonHistoryAwardWinner) => Team | null;
}> = ({ title, eyebrow, footnote, candidates, resolveTeam }) => {
  const winner = candidates[0];

  return (
    <Panel variant="sunken" className="p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="t-label text-[var(--color-ink-faint)]">{eyebrow}</span>
          <span className="t-label text-[var(--color-gold-hi)]">{title}</span>
        </div>
        {winner && (
          <span className="t-caption text-[var(--color-ink-faint)]">
            {candidates.length} ranked &middot; decided on the numbers
          </span>
        )}
      </div>

      {footnote && (
        <p className="mt-1 text-[var(--color-ink-faint)] t-caption">{footnote}</p>
      )}

      {candidates.length === 0 ? (
        <p className="mt-3 text-[var(--color-ink-faint)] t-caption">No eligible candidates</p>
      ) : (
        <ol className="mt-3 grid gap-2 md:grid-cols-2">
          {candidates.map((candidate, index) => {
            const candidateTeam = resolveTeam(candidate);
            const isWinner = index === 0;

            return (
              <li
                key={`${title}-${candidate.playerId}`}
                className={`flex items-center gap-3 border-l-[3px] px-2 py-2 ${
                  isWinner
                    ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-2)]'
                    : 'border-l-[var(--color-chrome-lo)]'
                }`}
              >
                {candidateTeam ? (
                  <TeamLogo team={candidateTeam} sizeClass="h-14 w-14" />
                ) : (
                  <div className="h-14 w-14 shrink-0 border border-[var(--color-chrome-lo)] bg-[var(--color-panel-2)]" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate t-h3">
                    {isWinner && <span className="mr-1.5 text-[var(--color-gold-hi)]">#1</span>}
                    {candidate.playerName}
                  </p>
                  <p className="truncate text-[var(--color-ink-dim)] t-caption">
                    {candidate.teamCity && candidate.teamName
                      ? `${candidate.teamCity} ${candidate.teamName}`
                      : 'No Team'}
                  </p>
                  {candidate.summary && (
                    <p className="mt-0.5 truncate text-[var(--color-ink-faint)] t-caption">
                      {candidate.summary}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
};

export const SeasonAwardsSummary: React.FC<SeasonAwardsSummaryProps> = ({
  selection,
  seen,
  resolveAwardCandidateTeam,
  onDismiss,
}) => (
  <Modal
    /*
     * Renders on `selection && !seen`.
     *
     * Both halves matter. `selection` alone would re-open the summary every time the manager
     * navigated back to the screen holding it, and `!seen` alone would render an empty dialog on
     * first load before the season has finished.
     */
    isOpen={Boolean(selection) && !seen}
    onClose={onDismiss}
    title={selection ? `Season Awards ${selection.seasonYear}` : 'Season Awards'}
    widthClass="max-w-5xl"
    barRight={
      selection ? (
        <span className="t-caption text-[var(--color-ink-faint)]">
          {selection.champion
            ? `Champion ${selection.champion.teamCity}`
            : 'No champion'}
        </span>
      ) : null
    }
  >
    {selection && (
      <div className="space-y-4">
        <p className="max-w-3xl text-[var(--color-ink-dim)] t-body">
          Decided from the season that was played, by the same ranking the awards board prices.
          Nothing here was chosen by hand &mdash; the top of each list won it, and the archive was
          already written when the season ended.
        </p>

        {/*
          WHO ELSE WON, AND WHY IT MATTERS FOR A BET THAT LOST.

          The league champions are here because they are the other thing a futures bet was on, and
          because a season summary that omits them reads as though only the awards happened.
        */}
        {(selection.leagueChampions.length > 0 || selection.divisionWinners.length > 0) && (
          <Panel variant="sunken" className="p-3">
            <p className="t-label text-[var(--color-ink-faint)]">Playoffs</p>
            <dl className="mt-2 grid gap-x-4 gap-y-1 md:grid-cols-2">
              {selection.leagueChampions.map((winner) => (
                <div key={`league-${winner.teamId}`} className="flex items-baseline justify-between gap-3">
                  <dt className="truncate text-[var(--color-ink-dim)] t-caption">
                    {winner.league} Champion
                  </dt>
                  <dd className="shrink-0 t-h3">{winner.teamCity}</dd>
                </div>
              ))}
              {selection.divisionWinners.map((winner) => (
                <div
                  key={`division-${winner.league}-${winner.division}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="truncate text-[var(--color-ink-dim)] t-caption">
                    {winner.league} {winner.division}
                  </dt>
                  <dd className="shrink-0 t-h3">{winner.teamCity}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        )}

        <AwardResult
          title="Batting MVP"
          eyebrow="Regular Season"
          candidates={selection.battingCandidates}
          resolveTeam={resolveAwardCandidateTeam}
        />
        <AwardResult
          title="Pitching MVP"
          eyebrow="Regular Season"
          candidates={selection.pitchingCandidates}
          resolveTeam={resolveAwardCandidateTeam}
        />
        <AwardResult
          title="World Series MVP"
          eyebrow="World Series"
          footnote={
            selection.worldSeriesCompletedGames > 0
              ? `Stats from ${formatHeaderDate(selection.worldSeriesStartDate)} to ${formatHeaderDate(selection.worldSeriesEndDate)} across ${selection.worldSeriesCompletedGames} games.`
              : 'No completed World Series games found.'
          }
          candidates={selection.worldSeriesCandidates}
          resolveTeam={resolveAwardCandidateTeam}
        />

        <div className="flex justify-end pt-1">
          {/*
            "Continue", not "Save".

            There is nothing left to save -- the archive was written when the season ended. The old
            label was accurate when this was a form and it is actively wrong now, because a button
            that says Save invites the reader to believe the results are provisional until they
            press it.
          */}
          <RetroButton variant="primary" onClick={onDismiss}>
            Continue
          </RetroButton>
        </div>
      </div>
    )}
  </Modal>
);
