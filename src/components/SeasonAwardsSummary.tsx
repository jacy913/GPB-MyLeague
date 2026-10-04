import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { TeamLogo } from './ui';
import { formatHeaderDate } from './SeasonCalendarStrip';
import {
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
 * betting on an award is that you think you know who will win. The screen answers "who, and on what
 * evidence" -- the winner at the top of their own ranking, the runners-up below with the numbers
 * that put them second, and the gap to the winner so the margin is legible.
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
 * is the entire reason they won and a highlighted row among equals does not say that as plainly as
 * a row above a rule does. The runners-up stay visible with their numbers, because "he won by
 * 0.4" is the interesting fact and hiding it would be the same mistake in the other direction.
 */
const AwardResult: React.FC<{
  title: string;
  eyebrow: string;
  footnote?: string;
  candidates: SeasonHistoryAwardWinner[];
  resolveTeam: (candidate: SeasonHistoryAwardWinner) => Team | null;
}> = ({ title, eyebrow, footnote, candidates, resolveTeam }) => {
  const [winner, ...rest] = candidates;
  return (
    <section className="rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{eyebrow}</p>
          <h3 className="mt-1 font-headline text-2xl uppercase tracking-[0.08em] text-white">{title}</h3>
        </div>
        {winner && (
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#d8c88b]">
            {candidates.length} ranked · decided on the numbers
          </p>
        )}
      </div>

      {footnote && (
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">{footnote}</p>
      )}

      {candidates.length === 0 ? (
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.16em] text-zinc-500">
          No eligible candidates
        </p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {candidates.map((candidate, index) => {
            const candidateTeam = resolveTeam(candidate);
            const isWinner = index === 0;
            return (
              <div
                key={`${title}-${candidate.playerId}`}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3 ${
                  isWinner
                    ? 'border-[#d4bb6a]/55 bg-[#d4bb6a]/10'
                    : 'border-white/10 bg-black/25'
                }`}
              >
                {candidateTeam ? (
                  <TeamLogo team={candidateTeam} sizeClass="h-14 w-14" />
                ) : (
                  <div className="h-12 w-12 rounded-lg border border-white/10 bg-black/30" />
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-2xl uppercase tracking-[0.06em] text-white">
                    {isWinner && <span className="mr-2 text-[#d8c88b]">#{index + 1}</span>}
                    {candidate.playerName}
                  </p>
                  <p className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                    {candidate.teamCity && candidate.teamName
                      ? `${candidate.teamCity} ${candidate.teamName}`
                      : 'No Team'}
                  </p>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-platinum">
                    {candidate.summary}
                  </p>
                </div>
                {isWinner && (
                  <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-[#d8c88b]">
                    Winner
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export const SeasonAwardsSummary: React.FC<SeasonAwardsSummaryProps> = ({
  selection,
  seen,
  resolveAwardCandidateTeam,
  onDismiss,
}) => (
  <AnimatePresence>
    {/*
     * Renders on `selection && !seen`.
     *
     * Both halves matter. `selection` alone would re-open the summary every time the manager
     * navigated back to the screen that holds it, and `!seen` alone would render an empty dialog on
     * first load before the season has finished.
     */}
    {selection && !seen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[86] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          className="max-h-[88vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-[#d4bb6a]/30 bg-[linear-gradient(145deg,#101010,#181818,#0b0b0b)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.65)] md:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#d8c88b]">
                Season Awards · {selection.seasonYear}
              </p>
              <h2 className="mt-2 font-headline text-4xl uppercase tracking-[0.08em] text-white">
                The Results
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-zinc-300">
                Decided from the season that was played, by the same ranking the awards board prices.
                Nothing here was chosen by hand — the top of each list won it, and the archive has
                already been written.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Champion</p>
              <p className="mt-1 font-display text-xl uppercase tracking-[0.08em] text-white">
                {selection.champion
                  ? `${selection.champion.teamCity} ${selection.champion.teamName}`
                  : 'TBD'}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                {selection.worldSeriesCompletedGames > 0
                  ? `${selection.worldSeriesCompletedGames} World Series games`
                  : 'World Series not completed'}
              </p>
            </div>
          </div>

          {/*
            WHO ELSE WON, AND WHY IT MATTERS FOR A BET THAT LOST.

            The league champions are here because they are the other thing a futures bet was on, and
            because a season summary that omits them reads as though only the awards happened.
          */}
          {(selection.leagueChampions.length > 0 || selection.divisionWinners.length > 0) && (
            <section className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Playoffs
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {selection.leagueChampions.map((winner) => (
                  <div
                    key={`league-${winner.teamId}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2"
                  >
                    <span className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                      {winner.league} Champion
                    </span>
                    <span className="truncate font-display text-lg uppercase tracking-[0.06em] text-white">
                      {winner.teamCity}
                    </span>
                  </div>
                ))}
                {selection.divisionWinners.map((winner) => (
                  <div
                    key={`division-${winner.league}-${winner.division}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2"
                  >
                    <span className="truncate font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
                      {winner.league} {winner.division}
                    </span>
                    <span className="truncate font-display text-lg uppercase tracking-[0.06em] text-white">
                      {winner.teamCity}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="mt-4 space-y-4">
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
                  ? `Stats from ${formatHeaderDate(selection.worldSeriesStartDate)} to ${formatHeaderDate(selection.worldSeriesEndDate)} (${selection.worldSeriesCompletedGames} games).`
                  : 'No completed World Series games found yet.'
              }
              candidates={selection.worldSeriesCandidates}
              resolveTeam={resolveAwardCandidateTeam}
            />
          </div>

          <div className="mt-5 grid gap-3">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-2xl border border-[#d4bb6a]/35 bg-[linear-gradient(135deg,rgba(212,187,106,0.28),rgba(212,187,106,0.1))] px-4 py-4 font-headline text-2xl uppercase tracking-[0.08em] text-white"
            >
              {/*
                "Continue", not "Save".

                There is nothing left to save -- the archive was written when the season ended. The
                old label was accurate when this was a form and it is actively wrong now, because a
                button that says Save invites the reader to believe the results are provisional until
                they press it.
              */}
              Continue
            </button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
