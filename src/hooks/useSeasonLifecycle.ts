import { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type SeasonAwardsSelectionState } from '../components/SeasonAwardsModal';
import {
  Game,
  LeaguePlayerState,
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryEntry,
  SeasonHistoryTeamRecord,
  Team,
} from '../types';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';
type OffseasonStage = 'idle' | 'draft_lottery' | 'draft' | 'free_agency';

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
  pushNotice: (message: string, level?: NoticeLevel) => void;
  resolveSeasonYear: (currentDate: string | null | undefined, seasonGames?: Game[]) => number;
  computeDivisionWinnersSnapshot: (teams: Team[]) => SeasonHistoryDivisionWinner[];
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
}

interface UseSeasonLifecycleResult {
  seasonAwardsSelection: SeasonAwardsSelectionState | null;
  setSeasonAwardsSelection: Dispatch<SetStateAction<SeasonAwardsSelectionState | null>>;
  saveSeasonAwardsSelection: (selection: SeasonAwardsSelectionState) => void;
  applyAutoSeasonAwards: () => void;
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
  pushNotice,
  resolveSeasonYear,
  computeDivisionWinnersSnapshot,
  computeBattingMvpCandidates,
  computePitchingMvpCandidates,
  computeWorldSeriesMvpCandidates,
  onOpenDraftView,
  onOpenFreeAgencyView,
}: UseSeasonLifecycleArgs): UseSeasonLifecycleResult => {
  const [seasonAwardsSelection, setSeasonAwardsSelection] = useState<SeasonAwardsSelectionState | null>(null);
  const previousSeasonCompleteRef = useRef(false);

  const buildSeasonAwardsSelection = useCallback((): SeasonAwardsSelectionState | null => {
    const seasonYear = resolveSeasonYear(currentDate || games[games.length - 1]?.date || games[0]?.date, games);
    if (seasonHistory.some((entry) => entry.seasonYear === seasonYear)) {
      return null;
    }

    const divisionWinners = computeDivisionWinnersSnapshot(teams);
    const battingCandidates = computeBattingMvpCandidates(teams, playerState, seasonYear, 10);
    const pitchingCandidates = computePitchingMvpCandidates(teams, playerState, seasonYear, 10);
    const worldSeriesBundle = computeWorldSeriesMvpCandidates(teams, games, playerState, seasonYear, 8);
    const champion = worldSeriesBundle.champion;

    return {
      seasonYear,
      champion,
      divisionWinners,
      battingCandidates,
      pitchingCandidates,
      worldSeriesCandidates: worldSeriesBundle.candidates,
      worldSeriesCompletedGames: worldSeriesBundle.completedGames,
      worldSeriesStartDate: worldSeriesBundle.startDate,
      worldSeriesEndDate: worldSeriesBundle.endDate,
      selectedBattingPlayerId: battingCandidates[0]?.playerId ?? null,
      selectedPitchingPlayerId: pitchingCandidates[0]?.playerId ?? null,
      selectedWorldSeriesPlayerId: worldSeriesBundle.candidates[0]?.playerId ?? null,
    };
  }, [
    computeBattingMvpCandidates,
    computeDivisionWinnersSnapshot,
    computePitchingMvpCandidates,
    computeWorldSeriesMvpCandidates,
    currentDate,
    games,
    playerState,
    resolveSeasonYear,
    seasonHistory,
    teams,
  ]);

  const saveSeasonAwardsSelection = useCallback((selection: SeasonAwardsSelectionState) => {
    const pickWinner = (
      candidates: SeasonHistoryAwardWinner[],
      selectedPlayerId: string | null,
    ): SeasonHistoryAwardWinner | null => {
      if (candidates.length === 0) {
        return null;
      }
      if (!selectedPlayerId) {
        return candidates[0] ?? null;
      }
      return candidates.find((candidate) => candidate.playerId === selectedPlayerId) ?? candidates[0] ?? null;
    };

    const snapshot: SeasonHistoryEntry = {
      seasonYear: selection.seasonYear,
      completedAt: new Date().toISOString(),
      champion: selection.champion,
      divisionWinners: selection.divisionWinners,
      battingMvp: pickWinner(selection.battingCandidates, selection.selectedBattingPlayerId),
      pitchingMvp: pickWinner(selection.pitchingCandidates, selection.selectedPitchingPlayerId),
      worldSeriesMvp: pickWinner(selection.worldSeriesCandidates, selection.selectedWorldSeriesPlayerId),
    };

    setSeasonHistory((current) => {
      if (current.some((entry) => entry.seasonYear === selection.seasonYear)) {
        return current;
      }
      return [snapshot, ...current]
        .sort((left, right) => right.seasonYear - left.seasonYear)
        .slice(0, maxSeasonHistoryEntries);
    });
    setSeasonAwardsSelection(null);
    pushNotice(`Season ${selection.seasonYear} awards saved to History.`, 'success');
  }, [maxSeasonHistoryEntries, pushNotice, setSeasonHistory]);

  const applyAutoSeasonAwards = useCallback(() => {
    if (!seasonAwardsSelection) {
      return;
    }
    saveSeasonAwardsSelection({
      ...seasonAwardsSelection,
      selectedBattingPlayerId: seasonAwardsSelection.battingCandidates[0]?.playerId ?? null,
      selectedPitchingPlayerId: seasonAwardsSelection.pitchingCandidates[0]?.playerId ?? null,
      selectedWorldSeriesPlayerId: seasonAwardsSelection.worldSeriesCandidates[0]?.playerId ?? null,
    });
  }, [saveSeasonAwardsSelection, seasonAwardsSelection]);

  const offseasonStage: OffseasonStage = useMemo(
    () => (seasonComplete
      ? (offseasonWorkflow.stage === 'idle' ? 'draft_lottery' : offseasonWorkflow.stage)
      : 'idle'),
    [offseasonWorkflow.stage, seasonComplete],
  );

  useEffect(() => {
    const justEnteredOffseason = seasonComplete && !previousSeasonCompleteRef.current;
    if (justEnteredOffseason) {
      const selection = buildSeasonAwardsSelection();
      if (selection) {
        setSeasonAwardsSelection(selection);
      }

      if (offseasonWorkflow.stage === 'idle') {
        setOffseasonWorkflow({
          seasonYear: resolveSeasonYear(currentDate || games[games.length - 1]?.date || games[0]?.date, games),
          stage: 'draft_lottery',
        });
        pushNotice('Offseason sequence started: Draft Lottery -> Draft -> Free Agency.', 'info');
      }

      if (offseasonWorkflow.stage === 'free_agency') {
        onOpenFreeAgencyView();
      } else {
        onOpenDraftView();
      }
    }
    previousSeasonCompleteRef.current = seasonComplete;
  }, [
    buildSeasonAwardsSelection,
    currentDate,
    games,
    offseasonWorkflow.stage,
    onOpenDraftView,
    onOpenFreeAgencyView,
    pushNotice,
    resolveSeasonYear,
    seasonComplete,
    setOffseasonWorkflow,
  ]);

  useEffect(() => {
    if (!seasonComplete && offseasonWorkflow.stage !== 'idle') {
      setOffseasonWorkflow(idleOffseasonWorkflowState);
    }
  }, [idleOffseasonWorkflowState, offseasonWorkflow.stage, seasonComplete, setOffseasonWorkflow]);

  useEffect(() => {
    if (!seasonComplete && seasonAwardsSelection) {
      setSeasonAwardsSelection(null);
    }
  }, [seasonAwardsSelection, seasonComplete]);

  return {
    seasonAwardsSelection,
    setSeasonAwardsSelection,
    saveSeasonAwardsSelection,
    applyAutoSeasonAwards,
    offseasonStage,
  };
};
