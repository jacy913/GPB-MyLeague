import React from 'react';
import { ClubBandRow } from './ui';
import { Modal } from './ui/Modal';
import { Panel } from './ui/Panel';
import { RetroButton } from './ui/RetroButton';
import { formatHeaderDate } from './SeasonCalendarStrip';
import type { TeamId } from '../data/teamColors';
import type {
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryLeagueWinner,
  SeasonHistoryStaffWinner,
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
  ultimateSlugger: SeasonHistoryAwardWinner | null;
  battingKing: SeasonHistoryAwardWinner | null;
  rookieOfTheYear: SeasonHistoryAwardWinner | null;
  strikeoutKing: SeasonHistoryAwardWinner | null;
  staffOfTheYear: SeasonHistoryStaffWinner | null;
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
 * The award row's height, in px. Matches the Awards page because these rows hold the same three
 * lines -- name, club, summary -- and the crest is cropped to the row, so a shorter row than the
 * content would float the mark with a strip of club colour above and below it.
 */
const AWARD_TILE_ROW_H = 64;

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

            /*
             * The row wears the candidate's club band -- the same fill, leading edge and cropped
             * crest as a Booth board, the standings tables and the dashboard Award Race, so an award
             * winner reads the same as every other club row in the app.
             *
             * The leader used to be marked with a gold left border and a lifted background. The
             * club's edge now owns that border, and club colour may never carry meaning, so the
             * marker moved to the two places it still reads: the ordinal and the name, both gold.
             * That is the dashboard Award Race's convention, and matching it is the point -- one
             * rule for "who leads this board", not one per screen.
             *
             * The old `#1` prefix is gone rather than kept. The ordinal now carries the rank, so a
             * second numeral in front of the name restates it, and this file already argues that a
             * third signal for one fact is noise on a screen whose only job is to state a result.
             *
             * `name` is deliberately NOT passed to `ClubBandRow`. That prop exists for rows that
             * DROP the visible name and keep it `sr-only`; these rows print the name, and passing it
             * as well would announce every candidate twice.
             */
            return (
              <ClubBandRow
                key={`${title}-${candidate.playerId}`}
                team={candidateTeam}
                teamId={(candidateTeam?.id ?? null) as TeamId | null}
                height={AWARD_TILE_ROW_H}
                rank={index + 1}
                rankClassName={isWinner ? 'text-[var(--color-gold)]' : undefined}
              >
                <div className="min-w-0 flex-1">
                  <p className={`truncate t-h3 ${isWinner ? 'text-[var(--color-gold-hi)]' : ''}`}>
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
              </ClubBandRow>
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
          THE PLAYOFFS RECAP USED TO SIT HERE -- the league champions and the division winners,
          "because a season summary that omits them reads as though only the awards happened."

          Removed on the manager's instruction: this screen's job is the awards, and the champion
          is already in the modal's own header bar ("Champion <city>"), so the recap was partly
          saying the same thing twice and wholly saying a different thing than the screen is for.
          Division and league champions are NOT lost -- HistoryHub still lists both, which is
          where a manager looks for how a season's teams finished. This screen is where you look
          for who won the awards.
        */}

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
          title="Ultimate Slugger"
          eyebrow="Regular Season"
          candidates={selection.ultimateSlugger ? [selection.ultimateSlugger] : []}
          resolveTeam={resolveAwardCandidateTeam}
        />
        <AwardResult
          title="Batting King"
          eyebrow="Regular Season"
          candidates={selection.battingKing ? [selection.battingKing] : []}
          resolveTeam={resolveAwardCandidateTeam}
        />
        <AwardResult
          title="Rookie of the Year"
          eyebrow="Regular Season"
          candidates={selection.rookieOfTheYear ? [selection.rookieOfTheYear] : []}
          resolveTeam={resolveAwardCandidateTeam}
        />
        <AwardResult
          title="Strikeout King"
          eyebrow="Regular Season"
          footnote="Most strikeouts. Ties go to the better K/9, then the better strikeout-to-walk ratio."
          candidates={selection.strikeoutKing ? [selection.strikeoutKing] : []}
          resolveTeam={resolveAwardCandidateTeam}
        />
        {selection.staffOfTheYear && (
          <Panel variant="sunken" className="p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="t-label text-[var(--color-gold-hi)]">Staff of the Year</span>
              <span className="t-caption text-[var(--color-ink-faint)]">Regular Season</span>
            </div>
            <p className="mt-2 t-h3">{selection.staffOfTheYear.teamCity} {selection.staffOfTheYear.teamName}</p>
            <p className="mt-1 t-caption text-[var(--color-ink-dim)]">
              {selection.staffOfTheYear.wins}-{selection.staffOfTheYear.losses} record | {selection.staffOfTheYear.expectedWins.toFixed(1)} expected wins | {selection.staffOfTheYear.winsAboveExpectation >= 0 ? '+' : ''}{selection.staffOfTheYear.winsAboveExpectation.toFixed(1)} over expectation
            </p>
          </Panel>
        )}
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
