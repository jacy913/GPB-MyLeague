import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type SeasonAwardsSummaryState } from '../components/SeasonAwardsSummary';
import {
  Game,
  LeaguePlayerState,
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryEntry,
  SeasonHistoryLeagueWinner,
  SeasonHistoryTeamRecord,
  Team,
} from '../types';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';
type OffseasonStage = 'idle' | 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';

interface OffseasonWorkflowLike {
  seasonYear: number | null;
  stage: OffseasonStage;
}

interface WorldSeriesCandidateBundleLike {
  champion: SeasonHistoryTeamRecord | null;
  candidates: SeasonHistoryAwardWinner[];
  completedGames: number;
  startDate: string;
  endDate: string;
}

interface UseSeasonLifecycleArgs {
  seasonComplete: boolean;
  currentDate: string;
  games: Game[];
  teams: Team[];
  playerState: LeaguePlayerState;
  seasonHistory: SeasonHistoryEntry[];
  setSeasonHistory: Dispatch<SetStateAction<SeasonHistoryEntry[]>>;
  offseasonWorkflow: OffseasonWorkflowLike;
  setOffseasonWorkflow: Dispatch<SetStateAction<OffseasonWorkflowLike>>;
  idleOffseasonWorkflowState: OffseasonWorkflowLike;
  maxSeasonHistoryEntries: number;
  /**
 * Whether the roster and its ratings are actually in memory yet.
 *
 * The archive is written from this data, so writing it before this is true writes a season's awards
 * from nothing. See the archive effect below for what that costs.
 */
  isPlayerStateLoaded: boolean;
  pushNotice: (message: string, level?: NoticeLevel) => void;
  resolveSeasonYear: (currentDate: string | null | undefined, seasonGames?: Game[]) => number;
  computeDivisionWinnersSnapshot: (teams: Team[]) => SeasonHistoryDivisionWinner[];
  /**
   * League champions as archive records, one per league with a completed league series.
   *
   * Passed in beside `computeDivisionWinnersSnapshot` and for the same reason: the
   * `SeasonHistoryTeamRecord` shape lives in `App.tsx`, and assembling it here as well would be a
   * second copy of a format the archive already has to read back.
   */
  computeLeagueChampionsSnapshot: (games: Game[], teams: Team[]) => SeasonHistoryLeagueWinner[];
  computeBattingMvpCandidates: (
    teams: Team[],
    playerState: LeaguePlayerState,
    seasonYear: number,
    limit?: number,
  ) => SeasonHistoryAwardWinner[];
  computePitchingMvpCandidates: (
    teams: Team[],
    playerState: LeaguePlayerState,
    seasonYear: number,
    limit?: number,
  ) => SeasonHistoryAwardWinner[];
  computeWorldSeriesMvpCandidates: (
    teams: Team[],
    games: Game[],
    playerState: LeaguePlayerState,
    seasonYear: number,
    limit?: number,
  ) => WorldSeriesCandidateBundleLike;
  onOpenDraftView: () => void;
  onOpenFreeAgencyView: () => void;
  onOpenOffseasonView: () => void;
}

interface UseSeasonLifecycleResult {
  /**
   * The finished season's awards, kept so the summary screen can render them.
   *
   * No longer a form in progress: there is nothing to choose on it. It holds the champion, the
   * league and division winners, and the ranked candidate lists the winners were taken from.
   */
  seasonAwardsSummary: SeasonAwardsSummaryState | null;
  /** False until the manager has read the summary. Dismissal is not deletion. */
  seasonAwardsSeen: boolean;
  /** Acknowledge the summary, which advances the offseason past 'awards'. */
  dismissSeasonAwardsSummary: () => void;
  /** Reopen the results screen from the offseason timeline. */
  reviewSeasonAwards: () => void;
  /** Forget the finished season entirely: the summary and its read flag. Used by the hard resets. */
  clearSeasonAwardsSummary: () => void;
  offseasonStage: OffseasonStage;
}

export const useSeasonLifecycle = ({
  seasonComplete,
  currentDate,
  games,
  teams,
  playerState,
  seasonHistory,
  setSeasonHistory,
  offseasonWorkflow,
  setOffseasonWorkflow,
  idleOffseasonWorkflowState,
  maxSeasonHistoryEntries,
  isPlayerStateLoaded,
  pushNotice,
  resolveSeasonYear,
  computeDivisionWinnersSnapshot,
  computeBattingMvpCandidates,
  computeLeagueChampionsSnapshot,
  computePitchingMvpCandidates,
  computeWorldSeriesMvpCandidates,
  onOpenDraftView,
  onOpenFreeAgencyView,
  onOpenOffseasonView,
}: UseSeasonLifecycleArgs): UseSeasonLifecycleResult => {
  const [seasonAwardsSummary, setSeasonAwardsSummary] = useState<SeasonAwardsSummaryState | null>(null);
  /*
   * Whether the manager has READ the summary.
   *
   * Separate from the selection itself so that dismissing the screen does not throw away the
   * season's awards. Before this, dismissing meant `setSeasonAwardsSummary(null)`, which was
   * correct when the selection was a form being abandoned and is wrong now that it is a result:
   * closing the screen would delete the only record of who won anything.
   */
  const [seasonAwardsSeen, setSeasonAwardsSeen] = useState(true);
  const previousSeasonCompleteRef = useRef(false);

  const buildSeasonAwardsSummary = useCallback((): SeasonAwardsSummaryState | null => {
    const seasonYear = resolveSeasonYear(currentDate || games[games.length - 1]?.date || games[0]?.date, games);

    /*
     * NO "ALREADY ARCHIVED" GUARD HERE. THIS IS THE OFFSEASON SOFTLOCK FIX, AND IT IS A DELETE.
     *
     * This used to `return null` as soon as `seasonHistory` held the season. The guard was
     * protecting the ARCHIVE -- but `archiveSeasonAwards` already dedupes on its own, two lines
     * of it away, and needs this guard for nothing. What the guard actually protected was the
     * RESULTS from being rebuilt, and that is what made the offseason unrecoverable.
     *
     * The failure it caused, in order:
     *
     *   1. The season ends. The archive is written immediately, and the awards screen is staged
     *      in React state (`seasonAwardsSummary`, `seen=false`).
     *   2. The manager reads it. The ONLY handler that advances the checklist past 'awards' is
     *      the modal's own dismiss, which calls `dismissSeasonAwardsSummary`.
     *   3. The page reloads -- a dev-server edit, a crash, a closed laptop. React state is gone.
     *      `seasonHistory` is not.
     *   4. The restore path below calls this builder, gets `null`, and leaves the manager with
     *      no awards screen at all. The checklist's Awards step is meanwhile marked complete,
     *      because that is measured off `seasonHistory` -- so its button is disabled.
     *
     * No modal, no enabled button, and `runSimulationTarget` refuses to advance the date
     * because the offseason gate still has an incomplete event. That is a game you cannot
     * leave without resetting it.
     *
     * Rebuilding a read-only summary from a season that has already finished is safe and
     * idempotent: the same finished-season numbers produce the same winners, and the archive
     * it might try to write is a no-op. So the builder builds, unconditionally, and the
     * dedupe that was here lives in the one place it is actually needed.
     */

    const divisionWinners = computeDivisionWinnersSnapshot(teams);
    const battingCandidates = computeBattingMvpCandidates(teams, playerState, seasonYear, 10);
    const pitchingCandidates = computePitchingMvpCandidates(teams, playerState, seasonYear, 10);
    const worldSeriesBundle = computeWorldSeriesMvpCandidates(teams, games, playerState, seasonYear, 8);
    const champion = worldSeriesBundle.champion;

    /*
     * LEAGUE CHAMPIONS, FROM THE SERIES.
     *
     * `champion` is already read off completed World Series games rather than standings, and the
     * league champions have to be read the same way for the same reason: a league champion is the
     * winner of a best-of-seven between two divisional winners, so it is not a thing standings can
     * name. Deriving it from `divisionWinners` is what produced the bug -- two divisions mapped onto
     * one league key, last write winning -- and a league bet then paid out to a club that had not
     * won anything.
     *
     * `leagueChampionsFromSeries` shares its arithmetic with `lockedRaces`, so the board closing a
     * league and settlement paying it out cannot disagree about who won.
     *
     * `computeLeagueChampionsSnapshot` is passed in rather than built here for the same reason
     * `computeDivisionWinnersSnapshot` is: the `SeasonHistoryTeamRecord` shape is assembled in
     * `App.tsx`, and a second copy of that assembly is a second thing to keep in step.
     */
    const leagueChampions = computeLeagueChampionsSnapshot(games, teams);

    return {
      seasonYear,
      champion,
      leagueChampions,
      divisionWinners,
      battingCandidates,
      pitchingCandidates,
      worldSeriesCandidates: worldSeriesBundle.candidates,
      worldSeriesCompletedGames: worldSeriesBundle.completedGames,
      worldSeriesStartDate: worldSeriesBundle.startDate,
      worldSeriesEndDate: worldSeriesBundle.endDate,
    };
  }, [
    computeBattingMvpCandidates,
    computeDivisionWinnersSnapshot,
    computeLeagueChampionsSnapshot,
    computePitchingMvpCandidates,
    computeWorldSeriesMvpCandidates,
    currentDate,
    games,
    playerState,
    resolveSeasonYear,
    teams,
  ]);

  /*
   * ARCHIVE THE SEASON.
   *
   * ============================================================================
   * WHY THERE IS NO CHOICE ANY MORE
   * ============================================================================
   *
   * This used to take a selection and let the manager pick three MVPs, which made award betting an
   * exploit rather than a market: open the modal, name the winner, then go to MacroBet and back him
   * at whatever the board priced. The click WAS the outcome.
   *
   * The user put it plainly: "we bet because it is a discrete outcome that happens outside of our
   * control. we use analytics and media opinions to determine these."
   *
   * So the winners are the top of each ranked candidate list -- the same scoring the board prices
   * from, applied to a season that has finished -- and there is no second path to them. Note the
   * consequence honestly: the winner is knowable ONCE THE SEASON IS OVER, not in July. That is what
   * makes this a market rather than a cheat, and it is why enforcement still matters at the end of
   * the year.
   *
   * `pickWinner` keeps its candidates[0] fallback and loses its selection parameter, so the shape
   * of the archive record is unchanged and `candidates[0]` is the only thing that can ever be
   * written.
   */
  const archiveSeasonAwards = useCallback((selection: SeasonAwardsSummaryState) => {
    const pickWinner = (
      candidates: SeasonHistoryAwardWinner[],
    ): SeasonHistoryAwardWinner | null => candidates[0] ?? null;

    const snapshot: SeasonHistoryEntry = {
      seasonYear: selection.seasonYear,
      completedAt: new Date().toISOString(),
      champion: selection.champion,
      leagueWinners: selection.leagueChampions,
      divisionWinners: selection.divisionWinners,
      battingMvp: pickWinner(selection.battingCandidates),
      pitchingMvp: pickWinner(selection.pitchingCandidates),
      worldSeriesMvp: pickWinner(selection.worldSeriesCandidates),
    };

    setSeasonHistory((current) => {
      const existingIndex = current.findIndex((entry) => entry.seasonYear === selection.seasonYear);

      /*
       * A SEASON WITH NO CHAMPION IS NOT ARCHIVABLE.
       *
       * Not a rare case to be defensive about: the season-complete flag is set from the schedule, and
       * a schedule whose World Series has not finished is still "complete" by that measure in the
       * middle of a postseason. Archiving then would write an entry that has to be overwritten later.
       */
      if (!snapshot.champion) {
        return current;
      }

      /*
       * THE EMPTY-CANDIDATE GUARD, AND IT IS NOT OPTIMISM.
       *
       * A finished 32-team season always has hundreds of players with 120+ at-bats and dozens of
       * pitchers with 8+ starts. Zero candidates in both races means the roster and its ratings were
       * not in memory when this ran -- not that the season produced no MVP.
       *
       * The asymmetry is what made this so visible: `computeWorldSeriesMvpCandidates` reads the
       * champion and the stored play logs out of `games`, while the batting and pitching candidates
       * come from `playerState`. So an archive written from an unloaded roster produces an entry with
       * a real World Series MVP and two nulls, which is exactly what a manager reported.
       *
       * Refusing to write is not enough on its own, because the dedupe below made a bad archive
       * PERMANENT: the year was present, so no later pass could correct it. Hence the repair.
       */
      const hasChampionAndRace = Boolean(snapshot.champion)
        && snapshot.battingMvp !== null
        && snapshot.pitchingMvp !== null;

      if (existingIndex >= 0) {
        const existing = current[existingIndex];
        if (!hasChampionAndRace) {
          // Nothing worth writing yet. Leave whatever is on file alone.
          return current;
        }
        /*
         * REPAIR, DO NOT REFUSE.
         *
         * An entry written from an unloaded roster is missing its two season MVPs. Those are pure
         * functions of a season that has finished, so they are recomputable for as long as the
         * season's stats exist -- and the year being present used to make them permanently
         * unrecoverable. Filling the gaps is safe precisely because the winner is `candidates[0]`:
         * there is no second path to it, so a recomputation can only be the same answer.
         */
        const repaired: SeasonHistoryEntry = {
          ...existing,
          champion: existing.champion ?? snapshot.champion,
          leagueWinners: existing.leagueWinners.length > 0 ? existing.leagueWinners : snapshot.leagueWinners,
          divisionWinners: existing.divisionWinners.length > 0 ? existing.divisionWinners : snapshot.divisionWinners,
          battingMvp: existing.battingMvp ?? snapshot.battingMvp,
          pitchingMvp: existing.pitchingMvp ?? snapshot.pitchingMvp,
          worldSeriesMvp: existing.worldSeriesMvp ?? snapshot.worldSeriesMvp,
        };
        if (repaired === existing) {
          return current;
        }
        const next = [...current];
        next[existingIndex] = repaired;
        pushNotice(`Season ${selection.seasonYear} awards repaired from the completed season.`, 'success');
        return next;
      }

      if (!hasChampionAndRace) {
        return current;
      }

      return [snapshot, ...current]
        .sort((left, right) => right.seasonYear - left.seasonYear)
        .slice(0, maxSeasonHistoryEntries);
    });
    /*
     * The selection is KEPT, not nulled, because it is now the SUMMARY rather than a form in
     * progress: it holds the candidate lists and the computed winners the summary screen renders.
     * Nulling it here meant the only way to see the season's awards was to be in the middle of
     * choosing them.
     *
     * Dismissal is separate state, so a dismissed summary is not a deleted one.
     *
     * REPORTED ONLY WHEN SOMETHING WAS WRITTEN. A refusal -- no champion, or a roster that was not
     * loaded -- is the guards doing their job, and announcing it as "archived" would claim an
     * outcome that did not happen. The repair path reports its own write above.
     */
    if (selection.champion && selection.battingCandidates.length > 0 && selection.pitchingCandidates.length > 0) {
      pushNotice(`Season ${selection.seasonYear} archived: awards decided from the season's own numbers.`, 'success');
    }
  }, [maxSeasonHistoryEntries, pushNotice, setSeasonHistory]);

  /*
   * ACKNOWLEDGE THE SUMMARY.
   *
   * Reading the season's result is a fine thing to gate the offseason on; deciding it is not. This
   * marks the summary read and steps the checklist past 'awards' so the manager is not held on a
   * screen they have already acknowledged.
   */
  /**
   * FORGET THE FINISHED SEASON.
   *
   * Used by the hard resets -- new season, cleared history, terminated universe -- where the
   * finished season is no longer part of this save and its awards should go with it.
   *
   * Exported rather than a raw `setSeasonAwardsSummary(null)` from App, because nulling the
   * summary and resetting `seen` are one action here and two at the call site, and a caller that
   * forgets the second leaves the NEXT season's awards pre-read. That is the same trap as
   * `dismissSeasonAwardsSummary` closing the screen by deleting the record, in miniature.
   */
  const clearSeasonAwardsSummary = useCallback(() => {
    setSeasonAwardsSummary(null);
    setSeasonAwardsSeen(true);
  }, []);

  const dismissSeasonAwardsSummary = useCallback(() => {
    setSeasonAwardsSeen(true);
    setOffseasonWorkflow((current) => (current.stage === 'awards'
      ? { ...current, stage: 'retirements' }
      : current));
  }, [setOffseasonWorkflow]);

  /**
   * REOPEN THE SUMMARY FROM THE OFFSEASON TIMELINE.
   *
   * The "Awards" step used to open a ballot to be filled in. It now opens the RESULTS, which is
   * useful for a different reason: the award markets have settled by then, and a manager who backed
   * somebody else wants to see the ranking that decided it.
   *
   * So this re-arms the same screen rather than adding a second one. Two screens showing the same
   * awards is one more place for them to disagree.
   */
  const reviewSeasonAwards = useCallback(() => {
    /*
     * REBUILDS THE RESULTS INSTEAD OF DOING NOTHING WHEN NONE ARE IN MEMORY.
     *
     * This used to read `seasonAwardsSummary`, and if that was null -- which is exactly the state
     * a reloaded page is in -- it did nothing at all and reported nothing. Clicking "Awards" on a
     * freshly-loaded checklist appeared to be a dead button. It now builds the summary from the
     * finished season if it has to, so the one action that shows the results always shows them.
     *
     * The step in the state updater that it replaces also called `setSeasonAwardsSeen` from inside
     * the reducer. A reducer must stay pure: React is entitled to call it twice in StrictMode, and
     * `seasonAwardsSeen` is exactly the flag that decides whether the dialog is open. Reading the
     * value directly is both simpler and correct.
     */
    if (seasonAwardsSummary) {
      setSeasonAwardsSeen(false);
      return;
    }

    const rebuilt = buildSeasonAwardsSummary();
    if (!rebuilt) {
      return;
    }
    setSeasonAwardsSummary(rebuilt);
    setSeasonAwardsSeen(false);
  }, [buildSeasonAwardsSummary, seasonAwardsSummary]);

  const offseasonStage: OffseasonStage = useMemo(
    () => (seasonComplete
      ? (offseasonWorkflow.stage === 'idle' ? 'awards' : offseasonWorkflow.stage)
      : 'idle'),
    [offseasonWorkflow.stage, seasonComplete],
  );

  useEffect(() => {
    const justEnteredOffseason = seasonComplete && !previousSeasonCompleteRef.current;
    if (justEnteredOffseason) {
      /*
       * THE SEASON ARCHIVES ITSELF THE MOMENT IT ENDS.
       *
       * There used to be a ballot here: the manager named three MVPs and pressed Save, and that
       * press is what wrote `seasonHistory` -- which is also what settles award bets. So the click
       * was the outcome, and betting an award meant betting on a decision the bettor was about to
       * make.
       *
       * Now the winners are the top of each ranked candidate list, taken from the season that has
       * just finished, and the archive is written here. Nothing is chosen and nothing is waited for,
       * so the offseason cannot be stuck behind a modal and the awards cannot be gamed.
       *
       * The stage is left on 'awards' so the SUMMARY is the first thing on screen when the offseason
       * opens; dismissing it advances to retirements. A screen to read is a fine thing to gate on.
       * Deciding the season's outcome is not.
       *
       * ---------------------------------------------------------------------------
       * AND IT WAITS FOR THE ROSTER, WHICH IS THE FIX FOR THE TRUNCATED MVPs
       * ---------------------------------------------------------------------------
       *
       * "The moment it ends" is the wrong moment on a reload. `seasonComplete` is restored from the
       * save while the roster and its season ratings are still being fetched, and this effect fires on
       * that transition. The season's MVPs are computed from `playerState`; the World Series MVP is
       * computed from `games`. So an archive written in that window keeps a real World Series MVP and
       * records two nulls for batting and pitching -- which is precisely what was reported.
       *
       * And because the archive dedupes on the season year, that entry was then PERMANENT: the year
       * was on file, so no later pass could correct it, and the season ended the year with no batting
       * or pitching MVP recorded at all.
       *
       * So the effect waits for the roster. `previousSeasonCompleteRef` is deliberately NOT advanced
       * while waiting, which means the effect re-runs and archives as soon as the data lands, rather
       * than needing a second trigger.
       */
      if (isPlayerStateLoaded) {
        const selection = buildSeasonAwardsSummary();
        if (selection) {
          setSeasonAwardsSummary(selection);
          setSeasonAwardsSeen(false);
          archiveSeasonAwards(selection);
        }

        if (offseasonWorkflow.stage === 'idle') {
          setOffseasonWorkflow({
            seasonYear: resolveSeasonYear(currentDate || games[games.length - 1]?.date || games[0]?.date, games),
            stage: 'awards',
          });
          pushNotice('Offseason checklist started: Awards -> Retirements -> Lottery -> Draft -> Free Agency.', 'info');
        }

        onOpenOffseasonView();
      }
    }
    previousSeasonCompleteRef.current = seasonComplete;
  }, [
    archiveSeasonAwards,
    buildSeasonAwardsSummary,
    currentDate,
    games,
    isPlayerStateLoaded,
    offseasonWorkflow.stage,
    onOpenOffseasonView,
    pushNotice,
    resolveSeasonYear,
    seasonComplete,
    setSeasonAwardsSummary,
    setSeasonAwardsSeen,
    setOffseasonWorkflow,
  ]);

  useEffect(() => {
    if (!seasonComplete || seasonAwardsSummary) {
      return;
    }

    const selection = buildSeasonAwardsSummary();
    if (!selection) {
      return;
    }

    /*
     * RESTORING A FINISHED SEASON, NOT OPENING A BALLOT.
     *
     * This path fires when the app loads with a season already complete and no summary in memory --
     * a save reloaded, not a season that has just ended. The archive is already written, so there is
     * nothing to decide and nothing to save; the summary is rebuilt only so the manager can still
     * read the reasoning behind the awards their bets settled against.
     *
     * `seen` is deliberately NOT forced false here. A restored result is not a fresh reveal, and
     * throwing the dialog open every time the app loaded would be its own bug.
     */
    setSeasonAwardsSummary(selection);
    pushNotice('Season awards restored. Open the Awards step to review the results.', 'info');
  }, [
    buildSeasonAwardsSummary,
    currentDate,
    pushNotice,
    seasonAwardsSummary,
    seasonComplete,
  ]);

  useEffect(() => {
    if (!seasonComplete && offseasonWorkflow.stage !== 'idle') {
      setOffseasonWorkflow(idleOffseasonWorkflowState);
    }
  }, [idleOffseasonWorkflowState, offseasonWorkflow.stage, seasonComplete, setOffseasonWorkflow]);

  useEffect(() => {
    if (!seasonComplete && seasonAwardsSummary) {
      setSeasonAwardsSummary(null);
      // Reset "read" alongside the summary itself: a new season's awards are a new result, and
      // carrying the previous season's acknowledgement over would skip the screen.
      setSeasonAwardsSeen(true);
    }
  }, [seasonAwardsSummary, seasonComplete]);

  return {
    seasonAwardsSummary,
    seasonAwardsSeen,
    dismissSeasonAwardsSummary,
    reviewSeasonAwards,
    clearSeasonAwardsSummary,
    offseasonStage,
  };
};
