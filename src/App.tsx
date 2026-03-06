/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { INITIAL_TEAMS } from './data/teams';
import { addDaysToISODate, generateSchedule, getDefaultSeasonStartDate, recalculateTeamRatings, DEFAULT_SETTINGS } from './logic/simulation';
import {
  CompletedGameResult,
  LeaguePlayerState,
  PendingTradeProposal,
  PlayLogEvent,
  Team,
  TeamRosterSlot,
  Game,
  SeasonHistoryAwardWinner,
  SeasonHistoryDivisionWinner,
  SeasonHistoryEntry,
  SeasonHistoryTeamRecord,
  SimulationSettings,
  SimulationTarget,
} from './types';
import { formatHeaderDate } from './components/SeasonCalendarStrip';
import { TradeInterruptionModal } from './components/TradeInterruptionModal';
import { SeasonAwardsModal } from './components/SeasonAwardsModal';
import { SimulationFloatingPanel } from './components/SimulationFloatingPanel';
import { BroadcastTickerFooter } from './components/BroadcastTickerFooter';
import { MainNavigation, type AppView } from './components/MainNavigation';
import { AppViewRouter } from './components/AppViewRouter';
import { PreviousDateScoreStrip } from './components/PreviousDateScoreStrip';
import { Activity, Bell, Clock3 } from 'lucide-react';
import gpbLogo from './assets/gpb.png';
import { createGameSession, simulateGameToFinal, buildCompletedGameFromSession } from './logic/gameEngine';
import { buildGameParticipants } from './logic/gameParticipants';
import { generatePlayerPool } from './logic/playerGenerator';
import {
  applyPlayerGameStatDelta,
  resetPlayerSeasonStats,
} from './logic/playerStats';
import { repairRosterSlotsForTeams } from './logic/rosterManagement';
import { applyOffseasonFreeAgencyRollover, parseOffseasonMeta } from './logic/offseasonFreeAgency';
import { isPlayoffGame, isRegularSeasonGame } from './logic/playoffs';
import { isSupabaseConfigured } from './lib/supabaseClient';
import {
  clearLocalPlayerState,
  clearSupabasePlayerState,
  clearSupabaseSeasonHistory,
  saveLocalLeagueState,
  saveLocalPlayerState,
  saveSupabaseLeagueState,
  saveSupabasePlayerState,
} from './lib/storage';
import { useSimulationEngine } from './hooks/useSimulationEngine';
import { useBroadcastFlair } from './hooks/useBroadcastFlair';
import { useLeagueBootstrap } from './hooks/useLeagueBootstrap';
import { useDraftCenterActions, type DraftCenterState } from './hooks/useDraftCenterActions';
import { useRosterTransactions } from './hooks/useRosterTransactions';
import { useScheduleDerivedState } from './hooks/useScheduleDerivedState';
import { useSeasonLifecycle } from './hooks/useSeasonLifecycle';
import { buildOffseasonEventSchedule } from './logic/offseasonSchedule';

type NoticeLevel = 'info' | 'success' | 'warning' | 'error';

interface CommissionerNotice {
  id: string;
  message: string;
  level: NoticeLevel;
  createdAt: string;
}

interface TradeInterruptionPrompt {
  count: number;
  date: string;
}

interface SeasonResetStatus {
  isResetting: boolean;
  progress: number;
  label: string;
}

interface GameStatsSignature {
  keys: string[];
  values: Array<Game['stats'][string]>;
}

interface GameStatsSignatureCacheEntry {
  statsRef: Game['stats'];
  signature: GameStatsSignature;
}

const EXPECTED_TEAM_COUNT = 32;
const DRAFT_CENTER_STORAGE_KEY = 'gpb_draft_center_v1';
const SEASON_HISTORY_STORAGE_KEY = 'gpb_season_history_v1';
const OFFSEASON_WORKFLOW_STORAGE_KEY = 'gpb_offseason_workflow_v1';
const OFFSEASON_ROLLOVER_MARKERS_STORAGE_KEY = 'gpb_offseason_rollover_markers_v1';
const MAX_SEASON_HISTORY_ENTRIES = 60;
const IDLE_SEASON_RESET_STATUS: SeasonResetStatus = {
  isResetting: false,
  progress: 0,
  label: '',
};
const IDLE_OFFSEASON_WORKFLOW_STATE: OffseasonWorkflowState = {
  seasonYear: null,
  stage: 'idle',
};

type OffseasonStage = 'idle' | 'draft_lottery' | 'draft' | 'free_agency';

interface OffseasonWorkflowState {
  seasonYear: number | null;
  stage: OffseasonStage;
}

type BlockingOffseasonEventKey = 'awards' | 'lottery' | 'draft';

interface BlockingOffseasonEvent {
  key: BlockingOffseasonEventKey;
  date: string;
  label: string;
  view: AppView | null;
  isComplete: boolean;
}

const LEAGUE_ORDER: Team['league'][] = ['Platinum', 'Prestige'];
const DIVISION_ORDER: Team['division'][] = ['North', 'South', 'East', 'West'];

const isValidTeamShape = (value: unknown): value is Team => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const team = value as Partial<Team>;
  return (
    typeof team.id === 'string' &&
    typeof team.name === 'string' &&
    typeof team.city === 'string' &&
    (team.league === 'Prestige' || team.league === 'Platinum') &&
    (team.division === 'North' || team.division === 'South' || team.division === 'East' || team.division === 'West') &&
    typeof team.rating === 'number' &&
    typeof team.previousBaselineWins === 'number' &&
    typeof team.wins === 'number' &&
    typeof team.losses === 'number' &&
    typeof team.runsScored === 'number' &&
    typeof team.runsAllowed === 'number'
  );
};

const sanitizeTeams = (value: unknown): Team[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.length !== EXPECTED_TEAM_COUNT) {
    return null;
  }

  return value.every(isValidTeamShape) ? (value as Team[]) : null;
};

const isValidSettingsShape = (value: unknown): value is SimulationSettings => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as Partial<SimulationSettings>;
  return (
    typeof settings.continuityWeight === 'number' &&
    typeof settings.winLossVariance === 'number' &&
    typeof settings.homeFieldAdvantage === 'number' &&
    typeof settings.gameLuckFactor === 'number' &&
    typeof settings.leagueEnvironmentBalance === 'number' &&
    typeof settings.battingVarianceFactor === 'number'
  );
};

const isValidGameShape = (value: unknown): value is Game => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const game = value as Partial<Game>;
  return (
    typeof game.gameId === 'string' &&
    typeof game.date === 'string' &&
    typeof game.homeTeam === 'string' &&
    typeof game.awayTeam === 'string' &&
    (game.phase === 'regular_season' || game.phase === 'playoffs') &&
    (game.status === 'scheduled' || game.status === 'completed') &&
    Boolean(game.score) &&
    typeof game.score?.home === 'number' &&
    typeof game.score?.away === 'number' &&
    Boolean(game.stats) &&
    typeof game.stats === 'object'
  );
};

const sanitizeGames = (value: unknown): Game[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.every(isValidGameShape) ? (value as Game[]) : null;
};

const buildGameStatsSignature = (stats: Game['stats']): GameStatsSignature => {
  const keys = Object.keys(stats).sort();
  const values = keys.map((key) => stats[key]);
  return { keys, values };
};

const areGameStatsSignaturesEqual = (left: GameStatsSignature, right: GameStatsSignature): boolean => {
  if (left.keys.length !== right.keys.length) {
    return false;
  }

  for (let index = 0; index < left.keys.length; index += 1) {
    if (left.keys[index] !== right.keys[index]) {
      return false;
    }

    const leftValue = left.values[index];
    const rightValue = right.values[index];
    if (leftValue === rightValue) {
      continue;
    }

    if (
      typeof leftValue === 'number' &&
      typeof rightValue === 'number' &&
      Number.isNaN(leftValue) &&
      Number.isNaN(rightValue)
    ) {
      continue;
    }

    return false;
  }

  return true;
};

const EMPTY_PLAYER_STATE: LeaguePlayerState = {
  players: [],
  battingStats: [],
  pitchingStats: [],
  battingRatings: [],
  pitchingRatings: [],
  rosterSlots: [],
  transactions: [],
};

const resolveSeasonYear = (currentDate: string | null | undefined, seasonGames: Game[] = []): number => {
  const sourceDate = currentDate || seasonGames[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
  const year = Number(sourceDate?.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : new Date().getFullYear();
};

const getTeamWinPct = (team: Team): number => {
  const totalGames = team.wins + team.losses;
  return totalGames > 0 ? team.wins / totalGames : 0;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const toSeasonHistoryTeamRecord = (team: Team) => ({
  teamId: team.id,
  teamCity: team.city,
  teamName: team.name,
  wins: team.wins,
  losses: team.losses,
});

const buildFallbackDisplayTeam = (teamId: string, teamCity: string, teamName: string): Team => ({
  id: teamId,
  city: teamCity,
  name: teamName,
  league: 'Platinum',
  division: 'North',
  rating: 0,
  previousBaselineWins: 0,
  wins: 0,
  losses: 0,
  runsScored: 0,
  runsAllowed: 0,
});

const sortTeamsForDivisionRace = (left: Team, right: Team): number => {
  if (left.wins !== right.wins) {
    return right.wins - left.wins;
  }
  const leftRunDiff = left.runsScored - left.runsAllowed;
  const rightRunDiff = right.runsScored - right.runsAllowed;
  if (leftRunDiff !== rightRunDiff) {
    return rightRunDiff - leftRunDiff;
  }
  return left.id.localeCompare(right.id);
};

const computeDivisionWinnersSnapshot = (teams: Team[]): SeasonHistoryDivisionWinner[] => {
  const grouped = new Map<string, Team[]>();
  teams.forEach((team) => {
    const key = `${team.league}-${team.division}`;
    const current = grouped.get(key) ?? [];
    current.push(team);
    grouped.set(key, current);
  });

  const winners: SeasonHistoryDivisionWinner[] = [];
  LEAGUE_ORDER.forEach((league) => {
    DIVISION_ORDER.forEach((division) => {
      const key = `${league}-${division}`;
      const divisionTeams = grouped.get(key) ?? [];
      if (divisionTeams.length === 0) {
        return;
      }
      const winner = [...divisionTeams].sort(sortTeamsForDivisionRace)[0];
      winners.push({
        ...toSeasonHistoryTeamRecord(winner),
        league,
        division,
      });
    });
  });

  return winners;
};

const resolveWorldSeriesChampion = (games: Game[], teamsById: Map<string, Team>) => {
  const completedWorldSeriesGames = games
    .filter((game) => game.phase === 'playoffs' && game.playoff?.round === 'world_series' && game.status === 'completed')
    .sort(compareGamesByDateThenId);

  if (completedWorldSeriesGames.length === 0) {
    return null;
  }

  const winsByTeamId = new Map<string, number>();
  completedWorldSeriesGames.forEach((game) => {
    const winnerTeamId = game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
    winsByTeamId.set(winnerTeamId, (winsByTeamId.get(winnerTeamId) ?? 0) + 1);
  });

  const [championEntry] = [...winsByTeamId.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });

  if (!championEntry || championEntry[1] < 4) {
    return null;
  }

  const championTeam = teamsById.get(championEntry[0]) ?? null;
  if (!championTeam) {
    return null;
  }

  return toSeasonHistoryTeamRecord(championTeam);
};

const computeBattingMvpCandidates = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
  limit = 8,
): SeasonHistoryAwardWinner[] => {
  const teamsById = new Map<string, Team>(teams.map((team) => [team.id, team] as const));
  const battingStatsByPlayerId = new Map(
    playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const battingRatingsByPlayerId = new Map(
    playerState.battingRatings
      .filter((rating) => rating.seasonYear === seasonYear)
      .map((rating) => [rating.playerId, rating] as const),
  );

  const ranked = playerState.players.reduce<Array<{
    score: number;
    winner: SeasonHistoryAwardWinner;
  }>>((current, player) => {
    const stat = battingStatsByPlayerId.get(player.playerId);
    const rating = battingRatingsByPlayerId.get(player.playerId);
    if (!stat || !rating || stat.atBats < 120) {
      return current;
    }

    const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
    const winPctBonus = team ? getTeamWinPct(team) * 60 : 0;
    const score =
      stat.avg * 700 +
      stat.ops * 260 +
      stat.homeRuns * 4 +
      stat.rbi * 1.75 +
      stat.hits * 0.5 +
      stat.runsScored * 0.7 +
      rating.overall * 0.45 +
      winPctBonus;

    const winner: SeasonHistoryAwardWinner = {
      playerId: player.playerId,
      playerName: `${player.firstName} ${player.lastName}`,
      teamId: player.teamId,
      teamCity: team?.city ?? null,
      teamName: team?.name ?? null,
      summary: `${stat.avg.toFixed(3)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI`,
    };

    current.push({ score, winner });
    return current;
  }, []);

  return ranked
    .sort((left, right) => (left.score === right.score ? left.winner.playerName.localeCompare(right.winner.playerName) : right.score - left.score))
    .slice(0, limit)
    .map((entry) => entry.winner);
};

const computePitchingMvpCandidates = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
  limit = 8,
): SeasonHistoryAwardWinner[] => {
  const teamsById = new Map<string, Team>(teams.map((team) => [team.id, team] as const));
  const pitchingStatsByPlayerId = new Map(
    playerState.pitchingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const pitchingRatingsByPlayerId = new Map(
    playerState.pitchingRatings
      .filter((rating) => rating.seasonYear === seasonYear)
      .map((rating) => [rating.playerId, rating] as const),
  );

  const ranked = playerState.players.reduce<Array<{
    score: number;
    winner: SeasonHistoryAwardWinner;
  }>>((current, player) => {
    const stat = pitchingStatsByPlayerId.get(player.playerId);
    const rating = pitchingRatingsByPlayerId.get(player.playerId);
    if (!stat || !rating || (stat.inningsPitched < 50 && stat.saves < 12)) {
      return current;
    }

    const team = player.teamId ? teamsById.get(player.teamId) ?? null : null;
    const winPctBonus = team ? getTeamWinPct(team) * 55 : 0;
    const score =
      clamp(6 - stat.era, 0, 6) * 40 +
      clamp(2 - stat.whip, 0, 2) * 70 +
      stat.strikeouts * 0.9 +
      stat.wins * 4.5 +
      stat.saves * 2.25 +
      stat.inningsPitched * 1.1 +
      rating.overall * 0.45 +
      winPctBonus;

    const winner: SeasonHistoryAwardWinner = {
      playerId: player.playerId,
      playerName: `${player.firstName} ${player.lastName}`,
      teamId: player.teamId,
      teamCity: team?.city ?? null,
      teamName: team?.name ?? null,
      summary: `${stat.era.toFixed(2)} ERA | ${stat.strikeouts} K | ${stat.inningsPitched.toFixed(1)} IP`,
    };

    current.push({ score, winner });
    return current;
  }, []);

  return ranked
    .sort((left, right) => (left.score === right.score ? left.winner.playerName.localeCompare(right.winner.playerName) : right.score - left.score))
    .slice(0, limit)
    .map((entry) => entry.winner);
};

const parseStoredPlayLog = (game: Game): PlayLogEvent[] => {
  const raw = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as PlayLogEvent[];
  } catch {
    return [];
  }
};

interface WorldSeriesCandidateBundle {
  champion: SeasonHistoryTeamRecord | null;
  candidates: SeasonHistoryAwardWinner[];
  completedGames: number;
  startDate: string;
  endDate: string;
}

type ScoredAwardCandidate = {
  score: number;
  winner: SeasonHistoryAwardWinner;
};

const compareScoredAwardCandidates = (left: ScoredAwardCandidate, right: ScoredAwardCandidate) =>
  left.score === right.score
    ? left.winner.playerName.localeCompare(right.winner.playerName)
    : right.score - left.score;

const buildBalancedWorldSeriesCandidates = (
  battingEntries: ScoredAwardCandidate[],
  pitchingEntries: ScoredAwardCandidate[],
  limit: number,
): SeasonHistoryAwardWinner[] => {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return [];
  }

  const sortedBatting = [...battingEntries].sort(compareScoredAwardCandidates);
  const sortedPitching = [...pitchingEntries].sort(compareScoredAwardCandidates);
  const batterQuota = Math.min(Math.floor(safeLimit / 2), sortedBatting.length);
  const pitcherQuota = Math.min(safeLimit - batterQuota, sortedPitching.length);

  const selected: ScoredAwardCandidate[] = [
    ...sortedBatting.slice(0, batterQuota),
    ...sortedPitching.slice(0, pitcherQuota),
  ];
  const selectedIds = new Set(selected.map((entry) => entry.winner.playerId));
  const remaining = safeLimit - selected.length;

  if (remaining > 0) {
    const extras = [...sortedBatting.slice(batterQuota), ...sortedPitching.slice(pitcherQuota)]
      .filter((entry) => !selectedIds.has(entry.winner.playerId))
      .sort(compareScoredAwardCandidates)
      .slice(0, remaining);
    extras.forEach((entry) => selectedIds.add(entry.winner.playerId));
    selected.push(...extras);
  }

  return selected
    .sort(compareScoredAwardCandidates)
    .map((entry) => entry.winner);
};

const computeWorldSeriesMvpCandidates = (
  teams: Team[],
  games: Game[],
  playerState: LeaguePlayerState,
  seasonYear: number,
  limit = 10,
): WorldSeriesCandidateBundle => {
  const teamsById = new Map<string, Team>(teams.map((team) => [team.id, team] as const));
  const champion = resolveWorldSeriesChampion(games, teamsById);
  const completedWorldSeriesGames = games
    .filter((game) =>
      game.phase === 'playoffs' &&
      game.playoff?.round === 'world_series' &&
      game.status === 'completed' &&
      Number(game.date.slice(0, 4)) === seasonYear,
    )
    .sort(compareGamesByDateThenId);

  if (!champion?.teamId) {
    return {
      champion: null,
      candidates: [],
      completedGames: completedWorldSeriesGames.length,
      startDate: completedWorldSeriesGames[0]?.date ?? '',
      endDate: completedWorldSeriesGames[completedWorldSeriesGames.length - 1]?.date ?? '',
    };
  }

  const championTeamId = champion.teamId;
  if (!championTeamId) {
    return {
      champion: null,
      candidates: [],
      completedGames: completedWorldSeriesGames.length,
      startDate: completedWorldSeriesGames[0]?.date ?? '',
      endDate: completedWorldSeriesGames[completedWorldSeriesGames.length - 1]?.date ?? '',
    };
  }

  const playersById = new Map<string, LeaguePlayerState['players'][number]>(
    playerState.players.map((player) => [player.playerId, player] as const),
  );
  const championTeam = teamsById.get(championTeamId) ?? null;

  const battingLines = new Map<string, {
    games: Set<string>;
    plateAppearances: number;
    atBats: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    runs: number;
    rbi: number;
    walks: number;
    strikeouts: number;
  }>();
  const pitchingLines = new Map<string, {
    games: Set<string>;
    outsRecorded: number;
    hitsAllowed: number;
    runsAllowed: number;
    walks: number;
    strikeouts: number;
    wins: number;
    saves: number;
  }>();

  completedWorldSeriesGames.forEach((game) => {
    const logs = parseStoredPlayLog(game);
    logs.forEach((log) => {
      if (log.outcome === 'PITCHING_CHANGE' || log.outcome === 'HALF_END' || log.outcome === 'GAME_END') {
        return;
      }

      if (log.battingTeamId === championTeamId && log.batterId) {
        const battingLine = battingLines.get(log.batterId) ?? {
          games: new Set<string>(),
          plateAppearances: 0,
          atBats: 0,
          hits: 0,
          doubles: 0,
          triples: 0,
          homeRuns: 0,
          runs: 0,
          rbi: 0,
          walks: 0,
          strikeouts: 0,
        };
        battingLine.games.add(game.gameId);
        battingLine.plateAppearances += 1;
        if (log.outcome !== 'BB') {
          battingLine.atBats += 1;
        }
        if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
          battingLine.hits += 1;
        }
        if (log.outcome === '2B') {
          battingLine.doubles += 1;
        }
        if (log.outcome === '3B') {
          battingLine.triples += 1;
        }
        if (log.outcome === 'HR') {
          battingLine.homeRuns += 1;
        }
        if (log.outcome === 'BB') {
          battingLine.walks += 1;
        }
        if (log.outcome === 'SO') {
          battingLine.strikeouts += 1;
        }
        battingLine.rbi += Math.max(0, log.rbi);
        if (log.scoringPlayerIds.includes(log.batterId)) {
          battingLine.runs += 1;
        }
        battingLines.set(log.batterId, battingLine);
      }

      if (log.battingTeamId !== championTeamId && log.pitcherId) {
        const pitchingLine = pitchingLines.get(log.pitcherId) ?? {
          games: new Set<string>(),
          outsRecorded: 0,
          hitsAllowed: 0,
          runsAllowed: 0,
          walks: 0,
          strikeouts: 0,
          wins: 0,
          saves: 0,
        };
        pitchingLine.games.add(game.gameId);
        if (log.outcome === 'OUT' || log.outcome === 'SO') {
          pitchingLine.outsRecorded += 1;
        }
        if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
          pitchingLine.hitsAllowed += 1;
        }
        if (log.outcome === 'BB') {
          pitchingLine.walks += 1;
        }
        if (log.outcome === 'SO') {
          pitchingLine.strikeouts += 1;
        }
        pitchingLine.runsAllowed += Math.max(0, log.runsScored);
        pitchingLines.set(log.pitcherId, pitchingLine);
      }
    });

    const winningPitcherId = typeof game.stats.winningPitcherId === 'string' ? game.stats.winningPitcherId : '';
    if (winningPitcherId) {
      const player = playersById.get(winningPitcherId) ?? null;
      if (player?.teamId === championTeamId) {
        const line = pitchingLines.get(winningPitcherId) ?? {
          games: new Set<string>(),
          outsRecorded: 0,
          hitsAllowed: 0,
          runsAllowed: 0,
          walks: 0,
          strikeouts: 0,
          wins: 0,
          saves: 0,
        };
        line.games.add(game.gameId);
        line.wins += 1;
        pitchingLines.set(winningPitcherId, line);
      }
    }

    const savePitcherId = typeof game.stats.savePitcherId === 'string' ? game.stats.savePitcherId : '';
    if (savePitcherId) {
      const player = playersById.get(savePitcherId) ?? null;
      if (player?.teamId === championTeamId) {
        const line = pitchingLines.get(savePitcherId) ?? {
          games: new Set<string>(),
          outsRecorded: 0,
          hitsAllowed: 0,
          runsAllowed: 0,
          walks: 0,
          strikeouts: 0,
          wins: 0,
          saves: 0,
        };
        line.games.add(game.gameId);
        line.saves += 1;
        pitchingLines.set(savePitcherId, line);
      }
    }
  });

  const battingCandidates = playerState.players.reduce<ScoredAwardCandidate[]>((current, player) => {
    if (player.teamId !== championTeamId) {
      return current;
    }

    if (player.playerType !== 'batter') {
      return current;
    }

    const battingLine = battingLines.get(player.playerId) ?? null;
    if (!battingLine) {
      return current;
    }

    const singles = Math.max(0, battingLine.hits - battingLine.doubles - battingLine.triples - battingLine.homeRuns);
    const totalBases = singles + battingLine.doubles * 2 + battingLine.triples * 3 + battingLine.homeRuns * 4;
    const battingAverage = battingLine.atBats > 0 ? battingLine.hits / battingLine.atBats : 0;
    const onBasePct = battingLine.plateAppearances > 0 ? (battingLine.hits + battingLine.walks) / battingLine.plateAppearances : 0;
    const slugging = battingLine.atBats > 0 ? totalBases / battingLine.atBats : 0;
    const ops = onBasePct + slugging;
    const score = ops * 110 + battingLine.homeRuns * 8 + battingLine.rbi * 3.2 + battingLine.runs * 1.8 + battingLine.hits;

    current.push({
      score,
      winner: {
        playerId: player.playerId,
        playerName: `${player.firstName} ${player.lastName}`,
        teamId: player.teamId,
        teamCity: championTeam?.city ?? null,
        teamName: championTeam?.name ?? null,
        summary: `WS ${battingLine.games.size} G | ${battingAverage.toFixed(3)} AVG | ${battingLine.homeRuns} HR | ${battingLine.rbi} RBI`,
      },
    });
    return current;
  }, []);

  const pitchingCandidates = playerState.players.reduce<ScoredAwardCandidate[]>((current, player) => {
    if (player.teamId !== championTeamId) {
      return current;
    }

    if (player.playerType !== 'pitcher') {
      return current;
    }

    const pitchingLine = pitchingLines.get(player.playerId) ?? null;
    if (!pitchingLine) {
      return current;
    }

    const inningsPitched = pitchingLine.outsRecorded / 3;
    const era = inningsPitched > 0 ? (pitchingLine.runsAllowed * 9) / inningsPitched : 99;
    const whip = inningsPitched > 0 ? (pitchingLine.walks + pitchingLine.hitsAllowed) / inningsPitched : 99;
    const score =
      clamp(8 - era, 0, 8) * 52 +
      clamp(2.2 - whip, 0, 2.2) * 58 +
      pitchingLine.strikeouts * 2 +
      pitchingLine.wins * 10 +
      pitchingLine.saves * 8 +
      inningsPitched * 3;

    current.push({
      score,
      winner: {
        playerId: player.playerId,
        playerName: `${player.firstName} ${player.lastName}`,
        teamId: player.teamId,
        teamCity: championTeam?.city ?? null,
        teamName: championTeam?.name ?? null,
        summary: `WS ${pitchingLine.games.size} G | ${inningsPitched.toFixed(1)} IP | ${era.toFixed(2)} ERA | ${pitchingLine.strikeouts} K`,
      },
    });
    return current;
  }, []);

  const batterQuota = Math.floor(limit / 2);
  const pitcherQuota = limit - batterQuota;

  const needFallbackBatters = battingCandidates.length < batterQuota;
  const needFallbackPitchers = pitchingCandidates.length < pitcherQuota;

  if (needFallbackBatters || needFallbackPitchers) {
    const battingCandidateIds = new Set(battingCandidates.map((entry) => entry.winner.playerId));
    const pitchingCandidateIds = new Set(pitchingCandidates.map((entry) => entry.winner.playerId));

    if (needFallbackBatters) {
      playerState.battingStats
        .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'playoffs')
        .forEach((stat) => {
          const player = playersById.get(stat.playerId);
          if (!player || player.teamId !== championTeamId || player.playerType !== 'batter' || stat.atBats < 6 || battingCandidateIds.has(player.playerId)) {
            return;
          }

          battingCandidates.push({
            score: stat.avg * 120 + stat.ops * 90 + stat.homeRuns * 8 + stat.rbi * 3 + stat.hits,
            winner: {
              playerId: player.playerId,
              playerName: `${player.firstName} ${player.lastName}`,
              teamId: player.teamId,
              teamCity: championTeam?.city ?? null,
              teamName: championTeam?.name ?? null,
              summary: `Playoffs | ${stat.avg.toFixed(3)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI`,
            },
          });
          battingCandidateIds.add(player.playerId);
        });
    }

    if (needFallbackPitchers) {
      playerState.pitchingStats
        .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'playoffs')
        .forEach((stat) => {
          const player = playersById.get(stat.playerId);
          if (!player || player.teamId !== championTeamId || player.playerType !== 'pitcher' || stat.inningsPitched < 4 || pitchingCandidateIds.has(player.playerId)) {
            return;
          }

          pitchingCandidates.push({
            score:
              clamp(8 - stat.era, 0, 8) * 50 +
              clamp(2.2 - stat.whip, 0, 2.2) * 55 +
              stat.strikeouts * 2 +
              stat.wins * 8 +
              stat.saves * 7 +
              stat.inningsPitched * 3,
            winner: {
              playerId: player.playerId,
              playerName: `${player.firstName} ${player.lastName}`,
              teamId: player.teamId,
              teamCity: championTeam?.city ?? null,
              teamName: championTeam?.name ?? null,
              summary: `Playoffs | ${stat.inningsPitched.toFixed(1)} IP | ${stat.era.toFixed(2)} ERA | ${stat.strikeouts} K`,
            },
          });
          pitchingCandidateIds.add(player.playerId);
        });
    }
  }

  const rankedCandidates = buildBalancedWorldSeriesCandidates(
    battingCandidates,
    pitchingCandidates,
    limit,
  );

  return {
    champion,
    candidates: rankedCandidates
      .filter((candidate, index, all) => all.findIndex((entry) => entry.playerId === candidate.playerId) === index)
      .slice(0, limit),
    completedGames: completedWorldSeriesGames.length,
    startDate: completedWorldSeriesGames[0]?.date ?? '',
    endDate: completedWorldSeriesGames[completedWorldSeriesGames.length - 1]?.date ?? '',
  };
};

const sanitizeSeasonHistory = (value: unknown): SeasonHistoryEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is SeasonHistoryEntry => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const candidate = entry as Partial<SeasonHistoryEntry>;
      return typeof candidate.seasonYear === 'number' && Number.isFinite(candidate.seasonYear);
    })
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .slice(0, MAX_SEASON_HISTORY_ENTRIES);
};

const getSortedUniqueDates = (games: Game[]): string[] =>
  Array.from(new Set<string>(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));

const compareGamesByDateThenId = (left: Game, right: Game): number =>
  left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date);

const resolveEffectiveActionDate = (currentDate: string, selectedDate: string, games: Game[]): string =>
  currentDate || selectedDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());

const loadOffseasonRolloverMarkers = (): number[] => {
  try {
    const serialized = localStorage.getItem(OFFSEASON_ROLLOVER_MARKERS_STORAGE_KEY);
    if (!serialized) {
      return [];
    }
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((value) => Number(value))
      .filter((value): value is number => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value));
  } catch (error) {
    console.error('Failed to read offseason rollover markers:', error);
    return [];
  }
};

const saveOffseasonRolloverMarkers = (markers: number[]): void => {
  try {
    const uniqueSorted = Array.from(new Set(markers.map((value) => Math.round(value))))
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    localStorage.setItem(OFFSEASON_ROLLOVER_MARKERS_STORAGE_KEY, JSON.stringify(uniqueSorted));
  } catch (error) {
    console.error('Failed to save offseason rollover markers:', error);
  }
};

const removePlayersFromStateByIdSet = (
  playerState: LeaguePlayerState,
  playerIdsToRemove: Set<string>,
): LeaguePlayerState => {
  if (playerIdsToRemove.size === 0) {
    return playerState;
  }

  return {
    ...playerState,
    players: playerState.players.filter((player) => !playerIdsToRemove.has(player.playerId)),
    battingStats: playerState.battingStats.filter((stat) => !playerIdsToRemove.has(stat.playerId)),
    pitchingStats: playerState.pitchingStats.filter((stat) => !playerIdsToRemove.has(stat.playerId)),
    battingRatings: playerState.battingRatings.filter((ratings) => !playerIdsToRemove.has(ratings.playerId)),
    pitchingRatings: playerState.pitchingRatings.filter((ratings) => !playerIdsToRemove.has(ratings.playerId)),
    rosterSlots: playerState.rosterSlots.filter((slot) => !playerIdsToRemove.has(slot.playerId)),
    transactions: playerState.transactions.filter((transaction) => !playerIdsToRemove.has(transaction.playerId)),
  };
};

const getSimulationScopeLabel = (target: SimulationTarget): string => {
  if (target.scope === 'day') return 'Simulating day';
  if (target.scope === 'week') return 'Simulating week';
  if (target.scope === 'month') return 'Simulating month';
  if (target.scope === 'regular_season') return 'Simulating regular season';
  if (target.scope === 'season') return 'Simulating full season';
  if (target.scope === 'next_game') return 'Simulating next team game';
  if (target.scope === 'next_playoff_game') return 'Simulating next playoff game';
  if (target.scope === 'to_game') return 'Simulating to selected game';
  return 'Simulating selected range';
};

const getSimulationTargetLabel = (target: SimulationTarget, teams: Team[], targetDate: string): string => {
  if (target.scope === 'day') return 'Single Day';
  if (target.scope === 'week') return 'One Week';
  if (target.scope === 'month') return 'One Month';
  if (target.scope === 'regular_season') return 'Regular Season Finish';
  if (target.scope === 'season') return 'Full Season';
  if (target.scope === 'next_game') {
    const team = teams.find((entry) => entry.id === target.teamId) ?? null;
    return team ? `${team.city} Next Game` : 'Next Team Game';
  }
  if (target.scope === 'next_playoff_game') return 'Next Playoff Game';
  if (target.scope === 'to_game') return target.targetGameId ? `To Game ${target.targetGameId.toUpperCase()}` : 'To Selected Game';
  return targetDate ? `To ${targetDate}` : 'Selected Date';
};

const buildSimulationDatePlan = (games: Game[], currentDate: string, target: SimulationTarget): { dates: string[]; targetDate: string } => {
  const uniqueDates = getSortedUniqueDates(games);
  if (uniqueDates.length === 0) {
    return { dates: [], targetDate: currentDate };
  }

  const startDate = uniqueDates.includes(currentDate)
    ? currentDate
    : uniqueDates.find((date) => date >= currentDate) ?? currentDate;

  const buildCalendarRange = (endDate: string): string[] => {
    if (endDate <= startDate) {
      return [startDate];
    }
    const range: string[] = [];
    let cursor = startDate;
    while (cursor <= endDate) {
      range.push(cursor);
      cursor = addDaysToISODate(cursor, 1);
    }
    return range;
  };

  if (target.scope === 'day') {
    return { dates: [startDate], targetDate: startDate };
  }

  if (target.scope === 'week') {
    const targetDate = addDaysToISODate(startDate, 6);
    return { dates: buildCalendarRange(targetDate), targetDate };
  }

  if (target.scope === 'month') {
    const targetDate = addDaysToISODate(startDate, 29);
    return { dates: buildCalendarRange(targetDate), targetDate };
  }

  if (target.scope === 'to_date') {
    const requestedTarget = target.targetDate ?? startDate;
    const targetDate = requestedTarget > startDate ? requestedTarget : startDate;
    return { dates: buildCalendarRange(targetDate), targetDate };
  }

  if (target.scope === 'next_playoff_game') {
    return { dates: [startDate], targetDate: startDate };
  }

  if (target.scope === 'to_game') {
    const targetGame = games.find((game) => game.gameId === target.targetGameId) ?? null;
    const targetDate = targetGame?.date ?? startDate;
    return { dates: [startDate], targetDate };
  }

  if (target.scope === 'regular_season') {
    const regularDates = getSortedUniqueDates(games.filter(isRegularSeasonGame));
    const targetDate = regularDates[regularDates.length - 1] ?? startDate;
    const dates = regularDates.filter((date) => date >= startDate);
    return { dates: dates.length > 0 ? dates : [startDate], targetDate };
  }

  if (target.scope === 'season') {
    const regularDates = getSortedUniqueDates(games.filter(isRegularSeasonGame));
    const regularSeasonEnd = regularDates[regularDates.length - 1] ?? uniqueDates[uniqueDates.length - 1] ?? startDate;
    const targetDate = addDaysToISODate(regularSeasonEnd, 70);
    return { dates: buildCalendarRange(targetDate), targetDate };
  }

  const nextTeamGame = games
    .filter((game) => game.status === 'scheduled' && game.date >= startDate && (game.homeTeam === target.teamId || game.awayTeam === target.teamId))
    .sort(compareGamesByDateThenId)[0];
  const targetDate = nextTeamGame?.date ?? startDate;
  return { dates: buildCalendarRange(targetDate), targetDate };
};

const PLAYOFF_ROUND_LIMITS = [
  { round: 'wild_card', seriesCount: 4, bestOf: 3 },
  { round: 'divisional', seriesCount: 4, bestOf: 5 },
  { round: 'league_series', seriesCount: 2, bestOf: 7 },
  { round: 'world_series', seriesCount: 1, bestOf: 7 },
] as const;

const getProjectedSeasonSummary = (seasonGames: Game[]) => {
  if (seasonGames.length === 0) {
    return {
      completedGames: 0,
      totalGames: 0,
      remainingGames: 0,
      progress: 0,
    };
  }

  const completedGames = seasonGames.filter((game) => game.status === 'completed').length;
  const regularSeasonGames = seasonGames.filter((game) => !isPlayoffGame(game)).length;
  const playoffGames = seasonGames.filter(isPlayoffGame);
  const playoffSeriesMap = new Map<string, Game[]>();
  const roundSeriesCounts = new Map<string, Set<string>>();

  PLAYOFF_ROUND_LIMITS.forEach(({ round }) => {
    roundSeriesCounts.set(round, new Set<string>());
  });

  playoffGames.forEach((game) => {
    const seriesId = game.playoff?.seriesId;
    const round = game.playoff?.round;
    if (!seriesId || !round) {
      return;
    }

    const existing = playoffSeriesMap.get(seriesId) ?? [];
    existing.push(game);
    playoffSeriesMap.set(seriesId, existing);
    roundSeriesCounts.get(round)?.add(seriesId);
  });

  let projectedPlayoffGames = 0;
  playoffSeriesMap.forEach((seriesGames) => {
    const orderedGames = [...seriesGames].sort(compareGamesByDateThenId);
    const sample = orderedGames[0];
    const playoff = sample.playoff;
    if (!playoff) {
      return;
    }

    const completedSeriesGames = orderedGames.filter((game) => game.status === 'completed');
    const winsNeeded = Math.floor(playoff.bestOf / 2) + 1;
    const topSeedTeamId = typeof sample.stats.topSeedTeamId === 'string' ? sample.stats.topSeedTeamId : '';
    const bottomSeedTeamId = typeof sample.stats.bottomSeedTeamId === 'string' ? sample.stats.bottomSeedTeamId : '';
    let topWins = 0;
    let bottomWins = 0;

    completedSeriesGames.forEach((game) => {
      const winnerTeamId = game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
      if (winnerTeamId === topSeedTeamId) {
        topWins += 1;
      } else if (winnerTeamId === bottomSeedTeamId) {
        bottomWins += 1;
      }
    });

    const clinched = topWins >= winsNeeded || bottomWins >= winsNeeded;
    projectedPlayoffGames += orderedGames.length;

    if (!clinched) {
      projectedPlayoffGames += Math.max(playoff.bestOf - orderedGames.length, 0);
    }
  });

  PLAYOFF_ROUND_LIMITS.forEach(({ round, seriesCount, bestOf }) => {
    const existingSeriesCount = roundSeriesCounts.get(round)?.size ?? 0;
    projectedPlayoffGames += Math.max(seriesCount - existingSeriesCount, 0) * bestOf;
  });

  const totalGames = regularSeasonGames + projectedPlayoffGames;
  const remainingGames = Math.max(totalGames - completedGames, 0);
  const progress = totalGames > 0 ? (completedGames / totalGames) * 100 : 0;

  return {
    completedGames,
    totalGames,
    remainingGames,
    progress,
  };
};

const buildRosterSlotSignature = (slot: TeamRosterSlot): string =>
  `${slot.seasonYear}|${slot.teamId}|${slot.slotCode}|${slot.playerId}`;

const areRosterSlotsEquivalent = (left: TeamRosterSlot[], right: TeamRosterSlot[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const leftSignatures = left.map(buildRosterSlotSignature).sort((a, b) => a.localeCompare(b));
  const rightSignatures = right.map(buildRosterSlotSignature).sort((a, b) => a.localeCompare(b));

  for (let index = 0; index < leftSignatures.length; index += 1) {
    if (leftSignatures[index] !== rightSignatures[index]) {
      return false;
    }
  }
  return true;
};

function App() {
  const [teams, setTeams] = useState<Team[]>(INITIAL_TEAMS);
  const [games, setGames] = useState<Game[]>([]);
  const [progress, setProgress] = useState(0);
  const [seasonComplete, setSeasonComplete] = useState(false);
  const [view, setView] = useState<AppView>('dashboard');
  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SETTINGS);
  const [playerState, setPlayerState] = useState<LeaguePlayerState>(EMPTY_PLAYER_STATE);
  const [pendingTrades, setPendingTrades] = useState<PendingTradeProposal[]>([]);
  const [tradeBoardDate, setTradeBoardDate] = useState('');
  const [tradeInterruptionPrompt, setTradeInterruptionPrompt] = useState<TradeInterruptionPrompt | null>(null);
  const [currentDate, setCurrentDate] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTeamId, setSelectedTeamId] = useState<string>(INITIAL_TEAMS[0]?.id ?? '');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [dataSource, setDataSource] = useState<'supabase' | 'local'>('local');
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isWipingPlayers, setIsWipingPlayers] = useState(false);
  const [isTerminatingUniverse, setIsTerminatingUniverse] = useState(false);
  const [isGeneratingPlayers, setIsGeneratingPlayers] = useState(false);
  const [seasonResetStatus, setSeasonResetStatus] = useState<SeasonResetStatus>(IDLE_SEASON_RESET_STATUS);
  const [draftCenter, setDraftCenter] = useState<DraftCenterState>({ activeClass: null, history: [] });
  const [seasonHistory, setSeasonHistory] = useState<SeasonHistoryEntry[]>([]);
  const [isSeasonHistoryLoaded, setIsSeasonHistoryLoaded] = useState(false);
  const [offseasonWorkflow, setOffseasonWorkflow] = useState<OffseasonWorkflowState>(IDLE_OFFSEASON_WORKFLOW_STATE);
  const [isDraftProcessing, setIsDraftProcessing] = useState(false);
  const [playerGenerationPreview, setPlayerGenerationPreview] = useState<LeaguePlayerState | null>(null);
  const [commissionerNotices, setCommissionerNotices] = useState<CommissionerNotice[]>([]);
  const draftCenterRef = useRef<DraftCenterState>({ activeClass: null, history: [] });
  const playerStateRef = useRef<LeaguePlayerState>(EMPTY_PLAYER_STATE);
  const rosterAutoOptimizedRef = useRef(false);
  const offseasonRolloverAppliedRef = useRef<Set<number>>(new Set());
  const gameStatsSignatureCacheRef = useRef<Map<string, GameStatsSignatureCacheEntry>>(new Map());

  const getCachedGameStatsSignature = useCallback((game: Game): GameStatsSignature => {
    const existing = gameStatsSignatureCacheRef.current.get(game.gameId);
    if (existing && existing.statsRef === game.stats) {
      return existing.signature;
    }

    const signature = buildGameStatsSignature(game.stats);
    gameStatsSignatureCacheRef.current.set(game.gameId, {
      statsRef: game.stats,
      signature,
    });
    return signature;
  }, []);

  const pushNotice = useCallback((message: string, level: NoticeLevel = 'info') => {
    const createdAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setCommissionerNotices((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message,
        level,
        createdAt,
      },
      ...prev,
    ].slice(0, 30));
  }, []);

  const saveLocalPlayerStateSafely = useCallback((nextPlayerState: LeaguePlayerState) => {
    try {
      saveLocalPlayerState(nextPlayerState);
      return true;
    } catch (error) {
      console.error('Failed to save player state to local storage:', error);
      return false;
    }
  }, []);

  const saveLocalLeagueStateSafely = useCallback((
    nextTeams: Team[],
    nextSettings: SimulationSettings,
    nextGames: Game[],
    nextCurrentDate: string,
    nextProgress: number,
    nextSeasonComplete: boolean,
  ) => {
    try {
      saveLocalLeagueState(nextTeams, nextSettings, nextGames, nextCurrentDate, nextProgress, nextSeasonComplete);
      return true;
    } catch (error) {
      console.error('Failed to save league state to local storage:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    playerStateRef.current = playerState;
  }, [playerState]);

  useEffect(() => {
    const activeGameIds = new Set(games.map((game) => game.gameId));
    const cache = gameStatsSignatureCacheRef.current;
    for (const gameId of cache.keys()) {
      if (!activeGameIds.has(gameId)) {
        cache.delete(gameId);
      }
    }
  }, [games]);

  useEffect(() => {
    if (isBootstrapping || rosterAutoOptimizedRef.current || teams.length === 0 || playerState.players.length === 0) {
      return;
    }

    rosterAutoOptimizedRef.current = true;
    const fallbackSeasonYear = resolveSeasonYear(
      currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getUTCFullYear()),
      games,
    );
    const repairedRoster = repairRosterSlotsForTeams(
      playerState,
      teams.map((team) => team.id),
      fallbackSeasonYear,
    );

    if (areRosterSlotsEquivalent(playerState.rosterSlots, repairedRoster.rosterSlots)) {
      return;
    }

    const optimizedPlayerState: LeaguePlayerState = {
      ...playerState,
      rosterSlots: repairedRoster.rosterSlots,
    };

    setPlayerState(optimizedPlayerState);
    playerStateRef.current = optimizedPlayerState;
    saveLocalPlayerStateSafely(optimizedPlayerState);
    pushNotice('Auto-optimized team lineups and rotations by overall ratings.', 'info');
  }, [currentDate, games, isBootstrapping, playerState, pushNotice, saveLocalPlayerStateSafely, teams]);

  useEffect(() => {
    draftCenterRef.current = draftCenter;
  }, [draftCenter]);

  useEffect(() => {
    try {
      const serialized = localStorage.getItem(DRAFT_CENTER_STORAGE_KEY);
      if (!serialized) {
        return;
      }
      const parsed = JSON.parse(serialized) as DraftCenterState;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      setDraftCenter({
        activeClass: parsed.activeClass ?? null,
        history: Array.isArray(parsed.history) ? parsed.history : [],
      });
    } catch (error) {
      console.error('Failed to load draft center state:', error);
    }
  }, []);

  useEffect(() => {
    try {
      const serialized = localStorage.getItem(SEASON_HISTORY_STORAGE_KEY);
      if (!serialized) {
        return;
      }
      const parsed = JSON.parse(serialized) as unknown;
      setSeasonHistory(sanitizeSeasonHistory(parsed));
    } catch (error) {
      console.error('Failed to load season history state:', error);
    } finally {
      setIsSeasonHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    try {
      const serialized = localStorage.getItem(OFFSEASON_WORKFLOW_STORAGE_KEY);
      if (!serialized) {
        return;
      }
      const parsed = JSON.parse(serialized) as Partial<OffseasonWorkflowState> | null;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      const stage = parsed.stage;
      if (stage !== 'idle' && stage !== 'draft_lottery' && stage !== 'draft' && stage !== 'free_agency') {
        return;
      }
      const seasonYear = typeof parsed.seasonYear === 'number' && Number.isFinite(parsed.seasonYear)
        ? parsed.seasonYear
        : null;
      setOffseasonWorkflow({
        seasonYear,
        stage,
      });
    } catch (error) {
      console.error('Failed to load offseason workflow state:', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_CENTER_STORAGE_KEY, JSON.stringify(draftCenter));
    } catch (error) {
      console.error('Failed to persist draft center state:', error);
    }
  }, [draftCenter]);

  useEffect(() => {
    try {
      localStorage.setItem(SEASON_HISTORY_STORAGE_KEY, JSON.stringify(seasonHistory.slice(0, MAX_SEASON_HISTORY_ENTRIES)));
    } catch (error) {
      console.error('Failed to persist season history state:', error);
    }
  }, [seasonHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(OFFSEASON_WORKFLOW_STORAGE_KEY, JSON.stringify(offseasonWorkflow));
    } catch (error) {
      console.error('Failed to persist offseason workflow state:', error);
    }
  }, [offseasonWorkflow]);

  useEffect(() => {
    if (!draftCenter.activeClass) {
      return;
    }
    const playerIds = new Set(playerState.players.map((player) => player.playerId));
    const hasMissingProspect = draftCenter.activeClass.prospects.some((prospect) => !playerIds.has(prospect.playerId));
    if (!hasMissingProspect) {
      return;
    }

    setDraftCenter((current) => ({
      ...current,
      activeClass: null,
    }));
    pushNotice('Draft board cleared because the active class no longer matches the current player pool.', 'warning');
  }, [draftCenter.activeClass, playerState.players, pushNotice]);

  const getProgressFromGames = useCallback((seasonGames: Game[]): number => {
    if (seasonGames.length === 0) {
      return 0;
    }
    const completed = seasonGames.filter((game) => game.status === 'completed').length;
    return (completed / seasonGames.length) * 100;
  }, []);

  const buildFreshSeasonTeams = useCallback((teamsToReset: Team[], settingsToUse: SimulationSettings): Team[] => {
    const zeroedTeams = teamsToReset.map((team) => ({
      ...team,
      wins: 0,
      losses: 0,
      runsScored: 0,
      runsAllowed: 0,
    }));

    return recalculateTeamRatings(zeroedTeams, settingsToUse);
  }, []);

  const createMasterSchedule = useCallback((seasonTeams: Team[], seasonYear?: number): Game[] => {
    const normalizedSeasonYear = typeof seasonYear === 'number' && Number.isFinite(seasonYear) && seasonYear > 0
      ? Math.round(seasonYear)
      : new Date().getFullYear();
    const seasonStartDate = getDefaultSeasonStartDate(normalizedSeasonYear);
    return generateSchedule(seasonTeams, { seasonStartDate, seasonDays: 180 });
  }, []);

  const persistLeagueState = useCallback(async (
    nextTeams: Team[],
    nextSettings: SimulationSettings,
    nextGames: Game[],
    nextCurrentDate: string,
    nextProgress: number,
    nextSeasonComplete: boolean,
    options?: {
      pruneMissingGames?: boolean;
      supabaseGamesOverride?: Game[];
    },
  ) => {
    const localSaved = saveLocalLeagueStateSafely(
      nextTeams,
      nextSettings,
      nextGames,
      nextCurrentDate,
      nextProgress,
      nextSeasonComplete,
    );

    if (!isSupabaseConfigured) {
      if (!localSaved) {
        throw new Error('Local storage save failed and Supabase is not configured.');
      }
      return;
    }

    try {
      await saveSupabaseLeagueState(
        nextTeams,
        nextSettings,
        options?.supabaseGamesOverride ?? nextGames,
        nextCurrentDate,
        nextProgress,
        nextSeasonComplete,
        {
          pruneMissingGames: options?.pruneMissingGames ?? false,
        },
      );
      setDataSource('supabase');
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      const normalizedMessage = message.toLowerCase();
      const isStatementTimeout = normalizedMessage.includes('statement timeout') || normalizedMessage.includes('"code":"57014"');
      if (isStatementTimeout) {
        console.warn(
          localSaved
            ? 'Supabase league-state sync timed out. Using local league state fallback.'
            : 'Supabase league-state sync timed out. Keeping in-memory league state.',
          error,
        );
        if (localSaved) {
          setDataSource('local');
        }
        return;
      }
      throw error;
    }
  }, [saveLocalLeagueStateSafely]);

  useLeagueBootstrap({
    isSupabaseConfigured,
    sanitizeTeams,
    sanitizeGames,
    isValidSettingsShape,
    getProgressFromGames,
    saveLocalPlayerStateSafely,
    saveLocalLeagueStateSafely,
    pushNotice,
    setIsBootstrapping,
    setPlayerState,
    setTeams,
    setSettings,
    setGames,
    setCurrentDate,
    setSelectedDate,
    setProgress,
    setSeasonComplete,
    setDataSource,
  });

  const latestArchivedSeasonYear = useMemo(
    () => seasonHistory.reduce((latest, entry) => Math.max(latest, entry.seasonYear), 0),
    [seasonHistory],
  );

  // Initialize schedule on mount (or when teams change structure, but we handle that in save)
  useEffect(() => {
    if (!isBootstrapping && isSeasonHistoryLoaded && games.length === 0) {
      const fallbackSeasonYear = resolveSeasonYear(currentDate, games);
      const inferredSeasonYear = latestArchivedSeasonYear > 0
        ? Math.max(fallbackSeasonYear, latestArchivedSeasonYear + 1)
        : fallbackSeasonYear;
      const schedule = createMasterSchedule(teams, inferredSeasonYear);
      const firstDate = schedule[0]?.date ?? getDefaultSeasonStartDate(inferredSeasonYear);
      setGames(schedule);
      setCurrentDate(firstDate);
      setSelectedDate(firstDate);
      setSeasonComplete(false);
      setProgress(0);

      void (async () => {
        try {
          await persistLeagueState(teams, settings, schedule, firstDate, 0, false, { pruneMissingGames: true });
        } catch (error) {
          console.error('Failed to persist initialized schedule:', error);
        }
      })();
    }
  }, [
    teams,
    settings,
    games,
    games.length,
    isBootstrapping,
    isSeasonHistoryLoaded,
    currentDate,
    latestArchivedSeasonYear,
    createMasterSchedule,
    persistLeagueState,
  ]);

  useEffect(() => {
    if (teams.length === 0) {
      return;
    }

    if (!teams.some((team) => team.id === selectedTeamId)) {
      setSelectedTeamId(teams[0].id);
    }
  }, [teams, selectedTeamId]);

  useEffect(() => {
    if (pendingTrades.length === 0 || view === 'trades') {
      setTradeInterruptionPrompt(null);
    }
  }, [pendingTrades.length, view]);

  const offseasonEventSeasonYear = useMemo(() => (
    seasonComplete
      ? (offseasonWorkflow.seasonYear ?? resolveSeasonYear(currentDate, games))
      : resolveSeasonYear(currentDate, games)
  ), [currentDate, games, offseasonWorkflow.seasonYear, seasonComplete]);

  const offseasonEventSchedule = useMemo(
    () => buildOffseasonEventSchedule(offseasonEventSeasonYear),
    [offseasonEventSeasonYear],
  );
  const awardsUnlockDate = offseasonEventSchedule.awardsDate;
  const lotteryOpenDate = offseasonEventSchedule.lotteryDate;
  const draftOpenDate = offseasonEventSchedule.draftDate;
  const freeAgencyOpenDate = offseasonEventSchedule.freeAgencyDate;

  const {
    seasonAwardsSelection,
    setSeasonAwardsSelection,
    saveSeasonAwardsSelection,
    applyAutoSeasonAwards,
    offseasonStage,
  } = useSeasonLifecycle({
    seasonComplete,
    currentDate,
    awardsUnlockDate,
    games,
    teams,
    playerState,
    seasonHistory,
    setSeasonHistory,
    offseasonWorkflow,
    setOffseasonWorkflow,
    idleOffseasonWorkflowState: IDLE_OFFSEASON_WORKFLOW_STATE,
    maxSeasonHistoryEntries: MAX_SEASON_HISTORY_ENTRIES,
    pushNotice,
    resolveSeasonYear,
    computeDivisionWinnersSnapshot,
    computeBattingMvpCandidates,
    computePitchingMvpCandidates,
    computeWorldSeriesMvpCandidates,
    onOpenDraftView: () => {
      setView('lottery');
    },
    onOpenFreeAgencyView: () => {
      setView('free_agency');
    },
  });

  const {
    isSimulating,
    isFinalizingSimulation,
    simulationSaveStatus,
    simulationProgress,
    simulationRunState,
    runSimulationTarget: runSimulationTargetEngine,
    cancelSimulationRun,
    resetSimulationState,
  } = useSimulationEngine({
    teams,
    games,
    playerState,
    settings,
    currentDate,
    isSupabaseConfigured,
    isDraftProcessing,
    seasonResetInProgress: seasonResetStatus.isResetting,
    getDefaultSeasonStartDate,
    getSimulationScopeLabel,
    getSimulationTargetLabel,
    buildSimulationDatePlan,
    pushNotice,
    onOpenSimulationView: () => {
      setView('simulation');
    },
    onOpenFreeAgencyView: () => {
      setView('free_agency');
    },
    onTradeInterruption: (nextPendingTrades, date, count) => {
      setPendingTrades(nextPendingTrades);
      setTradeBoardDate(date);
      setTradeInterruptionPrompt({ count, date });
    },
    persistSimulationSnapshot,
    applySimulationFullState,
  });

  const {
    stopDraftAutoRun,
    handleGenerateDraftClass,
    handleDraftNextPick,
    runDraftAuto,
    handleResetDraftBoard,
  } = useDraftCenterActions({
    currentDate,
    selectedDate,
    games,
    teams,
    seasonComplete,
    offseasonStage,
    lotteryOpenDate,
    draftOpenDate,
    isSimulating,
    isFinalizingSimulation,
    isSupabaseConfigured,
    isDraftProcessing,
    setIsDraftProcessing,
    draftCenterRef,
    playerStateRef,
    setPlayerState,
    setDraftCenter,
    saveLocalPlayerStateSafely,
    saveSupabasePlayerState,
    pushNotice,
    resolveEffectiveActionDate,
    resolveSeasonYear,
    removePlayersFromStateByIdSet,
    onAdvanceOffseasonToDraft: (seasonYear) => {
      setOffseasonWorkflow({
        seasonYear,
        stage: 'draft',
      });
    },
  });

  const awardsSavedForCurrentOffseason = useMemo(
    () => seasonHistory.some((entry) => entry.seasonYear === offseasonEventSeasonYear),
    [offseasonEventSeasonYear, seasonHistory],
  );
  const regularSeasonDates = useMemo(
    () => getSortedUniqueDates(games.filter((game) => isRegularSeasonGame(game))),
    [games],
  );
  const regularSeasonFinaleDate = regularSeasonDates[regularSeasonDates.length - 1] ?? '';
  const isFreeAgencyFreezeWindow = Boolean(currentDate)
    && Boolean(regularSeasonFinaleDate)
    && currentDate >= regularSeasonFinaleDate
    && currentDate < freeAgencyOpenDate;
  const lotteryCompletedForCurrentOffseason = Boolean(draftCenter.activeClass);
  const draftCompletedForCurrentOffseason = Boolean(draftCenter.activeClass?.isComplete);
  const isDraftOpen = seasonComplete && offseasonStage === 'draft' && currentDate >= draftOpenDate;
  const isFreeAgencyMarketOpen = Boolean(currentDate) && !isFreeAgencyFreezeWindow;
  const freeAgencyMarketStatusMessage = isFreeAgencyFreezeWindow
    ? `Free agency is closed from the regular-season finale through ${freeAgencyOpenDate}.`
    : `Free agency is currently unavailable.`;

  const blockingOffseasonEvents = useMemo<BlockingOffseasonEvent[]>(() => {
    if (!seasonComplete) {
      return [];
    }

    return [
      {
        key: 'awards',
        date: awardsUnlockDate,
        label: 'Awards',
        view: null,
        isComplete: awardsSavedForCurrentOffseason,
      },
      {
        key: 'lottery',
        date: lotteryOpenDate,
        label: 'Lottery',
        view: 'lottery',
        isComplete: lotteryCompletedForCurrentOffseason,
      },
      {
        key: 'draft',
        date: draftOpenDate,
        label: 'Draft',
        view: 'draft',
        isComplete: draftCompletedForCurrentOffseason,
      },
    ];
  }, [
    awardsSavedForCurrentOffseason,
    awardsUnlockDate,
    draftCompletedForCurrentOffseason,
    draftOpenDate,
    lotteryCompletedForCurrentOffseason,
    lotteryOpenDate,
    seasonComplete,
  ]);

  const nextBlockingOffseasonEvent = useMemo(
    () => blockingOffseasonEvents.find((event) => !event.isComplete) ?? null,
    [blockingOffseasonEvents],
  );

  useEffect(() => {
    if (!seasonComplete || offseasonWorkflow.stage !== 'draft') {
      return;
    }

    if (!draftCenter.activeClass?.isComplete) {
      return;
    }

    if (currentDate < freeAgencyOpenDate) {
      return;
    }

    setOffseasonWorkflow((current) => {
      if (current.stage !== 'draft') {
        return current;
      }
      return {
        seasonYear: current.seasonYear ?? draftCenter.activeClass?.seasonYear ?? null,
        stage: 'free_agency',
      };
    });
    pushNotice('Draft complete. Free agency is now open.', 'info');
  }, [
    currentDate,
    draftCenter.activeClass?.isComplete,
    draftCenter.activeClass?.seasonYear,
    freeAgencyOpenDate,
    offseasonWorkflow.stage,
    pushNotice,
    seasonComplete,
    setOffseasonWorkflow,
  ]);

  useEffect(() => {
    if (!seasonComplete || offseasonStage !== 'free_agency') {
      return;
    }

    if (currentDate < freeAgencyOpenDate) {
      return;
    }

    const rolloverSeasonYear = offseasonWorkflow.seasonYear ?? resolveSeasonYear(currentDate, games);
    if (!Number.isFinite(rolloverSeasonYear) || rolloverSeasonYear <= 0) {
      return;
    }

    if (offseasonRolloverAppliedRef.current.has(rolloverSeasonYear)) {
      return;
    }

    const existingMarkers = loadOffseasonRolloverMarkers();
    if (existingMarkers.includes(rolloverSeasonYear)) {
      offseasonRolloverAppliedRef.current.add(rolloverSeasonYear);
      return;
    }

    const rolloutRecordedInTransactions = playerState.transactions.some((transaction) => {
      const meta = parseOffseasonMeta(transaction.notes);
      return meta?.seasonYear === rolloverSeasonYear;
    });
    if (rolloutRecordedInTransactions) {
      offseasonRolloverAppliedRef.current.add(rolloverSeasonYear);
      saveOffseasonRolloverMarkers([...existingMarkers, rolloverSeasonYear]);
      return;
    }

    const effectiveDate = resolveEffectiveActionDate(currentDate, selectedDate, games);
    const result = applyOffseasonFreeAgencyRollover({
      playerState,
      teams,
      seasonYear: rolloverSeasonYear,
      effectiveDate,
    });

    offseasonRolloverAppliedRef.current.add(rolloverSeasonYear);
    saveOffseasonRolloverMarkers([...existingMarkers, rolloverSeasonYear]);
    setPlayerState(result.nextPlayerState);
    playerStateRef.current = result.nextPlayerState;
    saveLocalPlayerStateSafely(result.nextPlayerState);

    void (async () => {
      try {
        if (isSupabaseConfigured) {
          await saveSupabasePlayerState(result.nextPlayerState);
        }
      } catch (error) {
        console.error('Failed to persist offseason free-agency rollover:', error);
        pushNotice('Offseason rollover applied locally, but Supabase sync failed.', 'warning');
      }
    })();

    const qoSummary = result.summary.qualifyingOffersMade > 0
      ? `${result.summary.qualifyingOffersMade} qualifying offers made (${result.summary.qualifyingOffersAccepted} accepted, ${result.summary.qualifyingOffersDeclined} declined).`
      : 'No qualifying offers were made.';
    pushNotice(
      `Free agency opened for ${result.summary.seasonYear}: ${result.summary.decrementedContracts} contracts rolled over, ${result.summary.releasedToMarket} players reached the market. ${qoSummary}`,
      'info',
    );
  }, [
    currentDate,
    freeAgencyOpenDate,
    games,
    isSupabaseConfigured,
    offseasonStage,
    offseasonWorkflow.seasonYear,
    playerState,
    pushNotice,
    saveSupabasePlayerState,
    saveLocalPlayerStateSafely,
    seasonComplete,
    selectedDate,
    setPlayerState,
    teams,
  ]);

  const resetSeason = useCallback(async (teamsToReset = teams, settingsToUse = settings) => {
    if (seasonResetStatus.isResetting) {
      return;
    }

    if (isSimulating || isFinalizingSimulation) {
      pushNotice('Stop the active simulation run before resetting the season.', 'warning');
      return;
    }

    if (seasonComplete && offseasonStage !== 'free_agency') {
      const nextStepMessage = offseasonStage === 'draft_lottery'
        ? 'Run the draft lottery first.'
        : 'Finish the draft before moving to free agency.';
      pushNotice(`${nextStepMessage} Offseason order is Draft Lottery -> Draft -> Free Agency.`, 'warning');
      setView(offseasonStage === 'draft_lottery' ? 'lottery' : 'draft');
      return;
    }

    const updateResetProgress = (progressValue: number, label: string) => {
      setSeasonResetStatus({
        isResetting: true,
        progress: progressValue,
        label,
      });
    };

    updateResetProgress(8, 'Preparing season reset');

    try {
      resetSimulationState();
      stopDraftAutoRun();
      const clearedDraftCenter: DraftCenterState = {
        activeClass: null,
        history: draftCenterRef.current.history,
      };
      setDraftCenter(clearedDraftCenter);
      draftCenterRef.current = clearedDraftCenter;

      updateResetProgress(24, 'Building clean schedule and records');

      const freshTeams = buildFreshSeasonTeams(teamsToReset, settingsToUse);
      const activeSeasonYear = resolveSeasonYear(currentDate, games);
      const latestKnownSeasonYear = Math.max(activeSeasonYear, latestArchivedSeasonYear || activeSeasonYear);
      const nextSeasonYear = seasonComplete ? latestKnownSeasonYear + 1 : latestKnownSeasonYear;
      const schedule = createMasterSchedule(freshTeams, nextSeasonYear);
      const firstDate = schedule[0]?.date ?? getDefaultSeasonStartDate(nextSeasonYear);
      const resetSeasonYear = resolveSeasonYear(firstDate, schedule);
      const seasonResetPlayerState = resetPlayerSeasonStats(playerState, resetSeasonYear);
      const nextPlayerState: LeaguePlayerState = {
        ...seasonResetPlayerState,
        transactions: [],
      };

      updateResetProgress(46, 'Applying reset locally');

      React.startTransition(() => {
        setTeams(freshTeams);
        setGames(schedule);
        setPlayerState(nextPlayerState);
        setCurrentDate(firstDate);
        setSelectedDate(firstDate);
        setProgress(0);
        setSeasonComplete(false);
        setPendingTrades([]);
        setTradeBoardDate('');
        setTradeInterruptionPrompt(null);
        setSeasonAwardsSelection(null);
        setOffseasonWorkflow(IDLE_OFFSEASON_WORKFLOW_STATE);
        setSelectedGameId(null);
      });

      offseasonRolloverAppliedRef.current.clear();

      try {
        localStorage.removeItem(OFFSEASON_ROLLOVER_MARKERS_STORAGE_KEY);
      } catch (error) {
        console.error('Failed to clear offseason rollover markers during reset:', error);
      }

      saveLocalPlayerStateSafely(nextPlayerState);
      saveLocalLeagueStateSafely(freshTeams, settingsToUse, schedule, firstDate, 0, false);

      updateResetProgress(66, 'Syncing league state');

      try {
        await persistLeagueState(freshTeams, settingsToUse, schedule, firstDate, 0, false, { pruneMissingGames: true });

        if (isSupabaseConfigured) {
          updateResetProgress(84, 'Syncing player state');
          await saveSupabasePlayerState(nextPlayerState);
        }

        updateResetProgress(100, 'Season reset complete');
        pushNotice(
          isSupabaseConfigured
            ? 'Season fully reset and synced to Supabase.'
            : 'Season fully reset locally.',
          'success',
        );
      } catch (error) {
        console.error('Failed to persist reset season state:', error);
        pushNotice('Season reset locally, but Supabase sync failed.', 'warning');
      }
    } finally {
      globalThis.setTimeout(() => {
        setSeasonResetStatus(IDLE_SEASON_RESET_STATUS);
      }, 500);
    }
  }, [
    teams,
    settings,
    seasonResetStatus.isResetting,
    isSimulating,
    isFinalizingSimulation,
    seasonComplete,
    offseasonStage,
    currentDate,
    games,
    latestArchivedSeasonYear,
    pushNotice,
    buildFreshSeasonTeams,
    createMasterSchedule,
    playerState,
    saveLocalPlayerStateSafely,
    saveLocalLeagueStateSafely,
    persistLeagueState,
    resetSimulationState,
    stopDraftAutoRun,
  ]);

  const handleSaveSettings = (newTeams: Team[], newSettings: SimulationSettings) => {
    setSettings(newSettings);
    void resetSeason(newTeams, newSettings);
    pushNotice(
      isSupabaseConfigured ? 'League settings updated. Season reset started.' : 'League settings updated locally. Season reset started.',
      'success',
    );
    setView('games_schedule');
  };

  const handleClearHistoricalData = useCallback(async () => {
    setIsClearingHistory(true);
    try {
      setSeasonHistory([]);
      setSeasonAwardsSelection(null);
      localStorage.removeItem(SEASON_HISTORY_STORAGE_KEY);

      if (!isSupabaseConfigured) {
        pushNotice('Cleared local season history snapshots.', 'success');
        return;
      }

      const deletedRuns = await clearSupabaseSeasonHistory();
      if (deletedRuns > 0) {
        pushNotice(`Cleared local history and ${deletedRuns} Supabase season runs.`, 'success');
      } else {
        pushNotice('Cleared local history. No Supabase season runs were found.', 'info');
      }
    } catch (error) {
      console.error('Failed to clear historical season data:', error);
      pushNotice('Failed to clear historical season data from Supabase.', 'error');
    } finally {
      setIsClearingHistory(false);
    }
  }, [pushNotice]);

  const handleHardWipePlayers = useCallback(async () => {
    setIsWipingPlayers(true);

    try {
      clearLocalPlayerState();
      setPlayerState(EMPTY_PLAYER_STATE);

      if (isSupabaseConfigured) {
        const deletedPlayers = await clearSupabasePlayerState();
        pushNotice(
          deletedPlayers > 0
            ? `Hard-wiped ${deletedPlayers} players from Supabase.`
            : 'No player rows were found in Supabase.',
          'success',
        );
        setDataSource('supabase');
      } else {
        pushNotice('Supabase is not configured. Cleared local player data only.', 'warning');
      }
    } catch (error) {
      console.error('Failed to hard-wipe player data:', error);
      pushNotice('Failed to hard-wipe player data.', 'error');
    } finally {
      setIsWipingPlayers(false);
    }
  }, [pushNotice]);

  const handleTerminateUniverse = useCallback(async () => {
    if (isTerminatingUniverse || seasonResetStatus.isResetting) {
      return;
    }

    if (isSimulating || isFinalizingSimulation) {
      pushNotice('Stop the active simulation run before terminating the universe.', 'warning');
      return;
    }

    setIsTerminatingUniverse(true);

    try {
      resetSimulationState();
      stopDraftAutoRun();
      offseasonRolloverAppliedRef.current.clear();

      const baselineTeams = INITIAL_TEAMS.map((team) => ({ ...team }));
      const baselineSettings = { ...DEFAULT_SETTINGS };
      const baselineSeasonYear = resolveSeasonYear(
        currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear()),
        games,
      );
      const baselineSchedule = createMasterSchedule(baselineTeams, baselineSeasonYear);
      const firstDate = baselineSchedule[0]?.date ?? getDefaultSeasonStartDate(baselineSeasonYear);
      const wipedPlayerState: LeaguePlayerState = {
        players: [],
        battingStats: [],
        pitchingStats: [],
        battingRatings: [],
        pitchingRatings: [],
        rosterSlots: [],
        transactions: [],
      };

      React.startTransition(() => {
        setTeams(baselineTeams);
        setSettings(baselineSettings);
        setGames(baselineSchedule);
        setCurrentDate(firstDate);
        setSelectedDate(firstDate);
        setProgress(0);
        setSeasonComplete(false);
        setPlayerState(wipedPlayerState);
        setPendingTrades([]);
        setTradeBoardDate('');
        setTradeInterruptionPrompt(null);
        setSeasonAwardsSelection(null);
        setSeasonHistory([]);
        setDraftCenter({ activeClass: null, history: [] });
        setOffseasonWorkflow(IDLE_OFFSEASON_WORKFLOW_STATE);
        setSelectedGameId(null);
        setPlayerGenerationPreview(null);
      });

      clearLocalPlayerState();
      saveLocalPlayerStateSafely(wipedPlayerState);
      saveLocalLeagueStateSafely(baselineTeams, baselineSettings, baselineSchedule, firstDate, 0, false);

      localStorage.removeItem(SEASON_HISTORY_STORAGE_KEY);
      localStorage.removeItem(DRAFT_CENTER_STORAGE_KEY);
      localStorage.removeItem(OFFSEASON_WORKFLOW_STORAGE_KEY);
      localStorage.removeItem(OFFSEASON_ROLLOVER_MARKERS_STORAGE_KEY);
      setIsSeasonHistoryLoaded(true);

      if (isSupabaseConfigured) {
        await clearSupabasePlayerState();
        await clearSupabaseSeasonHistory();
        await persistLeagueState(
          baselineTeams,
          baselineSettings,
          baselineSchedule,
          firstDate,
          0,
          false,
          { pruneMissingGames: true },
        );
        await saveSupabasePlayerState(wipedPlayerState);
        setDataSource('supabase');
        pushNotice('Universe terminated. League, players, and history were fully reset.', 'success');
      } else {
        setDataSource('local');
        pushNotice('Universe terminated locally. Supabase is not configured.', 'warning');
      }
    } catch (error) {
      console.error('Failed to terminate universe:', error);
      pushNotice('Terminate Universe failed. Some data may still be present.', 'error');
    } finally {
      setIsTerminatingUniverse(false);
    }
  }, [
    createMasterSchedule,
    currentDate,
    games,
    isFinalizingSimulation,
    isSimulating,
    isTerminatingUniverse,
    persistLeagueState,
    pushNotice,
    resetSimulationState,
    saveLocalLeagueStateSafely,
    saveLocalPlayerStateSafely,
    seasonResetStatus.isResetting,
    stopDraftAutoRun,
  ]);

  const handlePreviewGeneratePlayers = useCallback(() => {
    const seasonYear = resolveSeasonYear(currentDate, games);
    const generatedPlayerState = generatePlayerPool(teams, seasonYear);
    setPlayerGenerationPreview(generatedPlayerState);
  }, [currentDate, games, teams]);

  const handleDismissPlayerPreview = useCallback(() => {
    setPlayerGenerationPreview(null);
  }, []);

  const handleGeneratePlayers = useCallback(async () => {
    setIsGeneratingPlayers(true);

    try {
      const generatedPlayerState = playerGenerationPreview ?? generatePlayerPool(teams, resolveSeasonYear(currentDate, games));

      clearLocalPlayerState();
      saveLocalPlayerStateSafely(generatedPlayerState);
      setPlayerState(generatedPlayerState);

      if (isSupabaseConfigured) {
        await clearSupabasePlayerState();
        await saveSupabasePlayerState(generatedPlayerState);
        setDataSource('supabase');
        pushNotice(`Generated ${generatedPlayerState.players.length} players and uploaded them to Supabase.`, 'success');
      } else {
        pushNotice(`Generated ${generatedPlayerState.players.length} players locally. Supabase is not configured.`, 'warning');
      }

      setPlayerGenerationPreview(null);
    } catch (error) {
      console.error('Failed to generate player data:', error);
      pushNotice('Failed to generate player data.', 'error');
    } finally {
      setIsGeneratingPlayers(false);
    }
  }, [currentDate, games, playerGenerationPreview, pushNotice, teams]);

  async function persistSimulationSnapshot(
    nextTeams: Team[],
    nextGames: Game[],
    nextPlayerState: LeaguePlayerState,
    nextCurrentDate: string,
    nextSeasonComplete: boolean,
    onProgress?: (progress: number, label: string) => void,
  ) {
    const emitSaveProgress = (nextSaveProgress: number, nextLabel: string) => {
      if (!onProgress) {
        return;
      }
      onProgress(Math.max(0, Math.min(100, nextSaveProgress)), nextLabel);
    };

    emitSaveProgress(12, 'Writing local player snapshot');
    const nextProgress = getProgressFromGames(nextGames);
    saveLocalPlayerStateSafely(nextPlayerState);
    emitSaveProgress(26, 'Diffing game results');
    const currentGamesById = new Map<string, Game>(games.map((game) => [game.gameId, game] as const));
    const changedGames = nextGames.filter((game) => {
      const previous = currentGamesById.get(game.gameId);
      if (!previous) {
        return true;
      }

      if (previous.status !== game.status) {
        return true;
      }

      if (previous.date !== game.date || previous.phase !== game.phase) {
        return true;
      }

      if (previous.score.home !== game.score.home || previous.score.away !== game.score.away) {
        return true;
      }

      const previousStatsSignature = getCachedGameStatsSignature(previous);
      const nextStatsSignature = getCachedGameStatsSignature(game);
      return !areGameStatsSignaturesEqual(previousStatsSignature, nextStatsSignature);
    });

    emitSaveProgress(42, 'Saving league state');
    try {
      await persistLeagueState(
        nextTeams,
        settings,
        nextGames,
        nextCurrentDate,
        nextProgress,
        nextSeasonComplete,
        {
          supabaseGamesOverride: changedGames,
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      const lowerMessage = message.toLowerCase();
      const isStatementTimeout = lowerMessage.includes('statement timeout') || lowerMessage.includes('"code":"57014"');
      if (isStatementTimeout) {
        console.warn('League-state save timed out after simulation snapshot. Keeping in-memory snapshot.', error);
        emitSaveProgress(72, 'League save timed out; keeping in-memory state');
      } else {
        throw new Error(`League state save failed: ${message}`);
      }
    }

    if (isSupabaseConfigured) {
      emitSaveProgress(82, 'Saving player state');
      try {
        await saveSupabasePlayerState(nextPlayerState);
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        throw new Error(`Player state save failed: ${message}`);
      }
    }

    emitSaveProgress(90, isSupabaseConfigured ? 'Player state saved' : 'Snapshot saved locally');
    return nextProgress;
  }

  function applySimulationFullState(
    nextTeams: Team[],
    nextGames: Game[],
    nextPlayerState: LeaguePlayerState,
    nextCurrentDate: string,
    nextProgress: number,
    nextSeasonComplete: boolean,
  ) {
    React.startTransition(() => {
      setTeams(nextTeams);
      setGames(nextGames);
      setPlayerState(nextPlayerState);
      setCurrentDate(nextCurrentDate);
      setSelectedDate(nextCurrentDate);
      setProgress(nextProgress);
      setSeasonComplete(nextSeasonComplete);
    });
  }

  const runSimulationTarget = useCallback(async (
    target: SimulationTarget,
    options?: { keepCurrentView?: boolean },
  ) => {
    const startingDate = currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
    const plan = buildSimulationDatePlan(games, startingDate, target);

    if (seasonComplete && nextBlockingOffseasonEvent) {
      if (startingDate >= nextBlockingOffseasonEvent.date) {
        pushNotice(
          `${nextBlockingOffseasonEvent.label} must be completed before advancing beyond ${nextBlockingOffseasonEvent.date}.`,
          'warning',
        );
        if (!options?.keepCurrentView && nextBlockingOffseasonEvent.view) {
          setView(nextBlockingOffseasonEvent.view);
        }
        return;
      }

      if (plan.targetDate > nextBlockingOffseasonEvent.date) {
        pushNotice(
          `Simulation capped at ${nextBlockingOffseasonEvent.date} for ${nextBlockingOffseasonEvent.label}.`,
          'info',
        );
        await runSimulationTargetEngine(
          { scope: 'to_date', targetDate: nextBlockingOffseasonEvent.date },
          options,
        );
        return;
      }
    }

    await runSimulationTargetEngine(target, options);
  }, [
    buildSimulationDatePlan,
    currentDate,
    games,
    getDefaultSeasonStartDate,
    nextBlockingOffseasonEvent,
    pushNotice,
    runSimulationTargetEngine,
    seasonComplete,
    setView,
  ]);

  const simulateToSelectedDate = useCallback(() => {
    if (!selectedDate) {
      return;
    }
    void runSimulationTarget({ scope: 'to_date', targetDate: selectedDate });
  }, [selectedDate, runSimulationTarget]);

  const simulateDay = useCallback(() => {
    void runSimulationTarget({ scope: 'day' });
  }, [runSimulationTarget]);

  const simulateToEndOfRegularSeason = useCallback(() => {
    void runSimulationTarget({ scope: 'regular_season' });
  }, [runSimulationTarget]);

  const simulateWeek = useCallback(() => {
    void runSimulationTarget({ scope: 'week' });
  }, [runSimulationTarget]);

  const simulateMonth = useCallback(() => {
    void runSimulationTarget({ scope: 'month' });
  }, [runSimulationTarget]);

  const simulateNextTeamGame = useCallback(() => {
    if (!selectedTeamId) {
      pushNotice('Select a team before running "Simulate Next Game".', 'warning');
      return;
    }
    void runSimulationTarget({ scope: 'next_game', teamId: selectedTeamId });
  }, [selectedTeamId, runSimulationTarget, pushNotice]);

  const quickSimSeason = useCallback(() => {
    void runSimulationTarget({ scope: 'season' });
  }, [runSimulationTarget]);

  const simulateInlineToDate = useCallback((targetDate: string) => {
    if (!targetDate) {
      return;
    }
    void runSimulationTarget({ scope: 'to_date', targetDate }, { keepCurrentView: true });
  }, [runSimulationTarget]);

  const simulateNextPlayoffGameInline = useCallback(() => {
    void runSimulationTarget({ scope: 'next_playoff_game' }, { keepCurrentView: true });
  }, [runSimulationTarget]);

  const simulateToGameInline = useCallback((targetGameId: string) => {
    if (!targetGameId) {
      return;
    }
    void runSimulationTarget({ scope: 'to_game', targetGameId }, { keepCurrentView: true });
  }, [runSimulationTarget]);

  const simulateToDate = useCallback((targetDate: string) => {
    if (!targetDate) {
      return;
    }

    setSelectedDate(targetDate);
    setView('simulation');
  }, []);

  const {
    handleTradeProposal,
    handleApprovePendingTrade,
    handleVetoPendingTrade,
    handleFreeAgencyAssignment,
  } = useRosterTransactions({
    currentDate,
    selectedDate,
    games,
    teams,
    playerState,
    pendingTrades,
    freeAgencyOpenDate,
    isFreeAgencyMarketOpen,
    freeAgencyMarketStatusMessage,
    isSupabaseConfigured,
    setPlayerState,
    setSelectedTeamId,
    setPendingTrades,
    saveLocalPlayerStateSafely,
    saveSupabasePlayerState,
    pushNotice,
    resolveEffectiveActionDate,
    resolveSeasonYear,
  });

  const applyCompletedGameResults = useCallback(async (completedResults: CompletedGameResult[]) => {
    if (completedResults.length === 0) {
      return;
    }

    const orderedResults = [...completedResults].sort((left, right) => compareGamesByDateThenId(left.game, right.game));
    const nextTeamsMap = new Map<string, Team>(teams.map((team) => [team.id, { ...team }]));
    const nextGamesMap = new Map<string, Game>(
      games.map((game) => [
        game.gameId,
        {
          ...game,
          score: { ...game.score },
          stats: { ...game.stats },
          playoff: game.playoff ? { ...game.playoff } : null,
        },
      ]),
    );
    let nextPlayerState = playerState;

    orderedResults.forEach((resolvedResult) => {
      const resolvedGame = resolvedResult.game;
      const existing = nextGamesMap.get(resolvedGame.gameId);
      if (!existing) {
        return;
      }

      if (existing.status !== 'completed' && isRegularSeasonGame(existing)) {
        const homeTeam = nextTeamsMap.get(existing.homeTeam);
        const awayTeam = nextTeamsMap.get(existing.awayTeam);
        if (homeTeam && awayTeam) {
          homeTeam.runsScored += resolvedGame.score.home;
          homeTeam.runsAllowed += resolvedGame.score.away;
          awayTeam.runsScored += resolvedGame.score.away;
          awayTeam.runsAllowed += resolvedGame.score.home;

          if (resolvedGame.score.home > resolvedGame.score.away) {
            homeTeam.wins += 1;
            awayTeam.losses += 1;
          } else {
            awayTeam.wins += 1;
            homeTeam.losses += 1;
          }
        }
      }

      nextGamesMap.set(resolvedGame.gameId, {
        ...resolvedGame,
        score: { ...resolvedGame.score },
        stats: { ...resolvedGame.stats },
        playoff: resolvedGame.playoff ? { ...resolvedGame.playoff } : null,
      });

      nextPlayerState = applyPlayerGameStatDelta(
        nextPlayerState,
        resolvedResult.playerStatDelta,
        resolveSeasonYear(resolvedGame.date, games),
        resolvedGame.phase,
      );
    });

    const nextGames = Array.from(nextGamesMap.values()).sort(compareGamesByDateThenId);
    const nextSeasonComplete = nextGames.every((game) => game.status === 'completed');
    const nextTeams = Array.from(nextTeamsMap.values()).map((team) =>
      nextSeasonComplete ? { ...team, previousBaselineWins: team.wins } : team,
    );
    const latestCompletedDate = orderedResults[orderedResults.length - 1]?.game.date ?? currentDate;
    const nextCurrentDate = latestCompletedDate > currentDate ? latestCompletedDate : currentDate;
    const nextProgress = getProgressFromGames(nextGames);

    setTeams(nextTeams);
    setGames(nextGames);
    setPlayerState(nextPlayerState);
    setCurrentDate(nextCurrentDate);
    setSelectedDate(orderedResults[orderedResults.length - 1]?.game.date ?? selectedDate);
    setProgress(nextProgress);
    setSeasonComplete(nextSeasonComplete);
    saveLocalPlayerStateSafely(nextPlayerState);

    try {
      await persistLeagueState(nextTeams, settings, nextGames, nextCurrentDate, nextProgress, nextSeasonComplete);
      if (isSupabaseConfigured) {
        await saveSupabasePlayerState(nextPlayerState);
      }
    } catch (error) {
      console.error('Failed to persist interactive game results:', error);
      pushNotice('Game simulation completed, but saving failed.', 'warning');
      return;
    }

    pushNotice(
      orderedResults.length === 1
        ? `Simulated ${orderedResults[0].game.awayTeam.toUpperCase()} @ ${orderedResults[0].game.homeTeam.toUpperCase()}.`
        : `Simulated ${orderedResults.length} earlier games and updated the slate.`,
      'info',
    );
  }, [teams, games, playerState, currentDate, selectedDate, getProgressFromGames, persistLeagueState, settings, pushNotice]);

  const openGameScreen = useCallback((gameId: string) => {
    const targetGame = games.find((game) => game.gameId === gameId);
    if (!targetGame) {
      return;
    }

    setSelectedGameId(gameId);
    setSelectedDate(targetGame.date);
    setView('game_screen');
  }, [games]);

  const openRandomTeamPage = useCallback(() => {
    if (teams.length === 0) {
      setView('teams');
      return;
    }

    const eligibleTeams = teams.length > 1 ? teams.filter((team) => team.id !== selectedTeamId) : teams;
    const randomIndex = Math.floor(Math.random() * eligibleTeams.length);
    const nextTeam = eligibleTeams[randomIndex] ?? teams[0];
    setSelectedTeamId(nextTeam.id);
    setView('teams');
  }, [teams, selectedTeamId]);

  const openTeamPage = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
    setView('teams');
  }, []);

  const openSimulationCenter = useCallback((targetDate?: string) => {
    if (targetDate) {
      setSelectedDate(targetDate);
    }
    setView('simulation');
  }, []);

  const {
    activeDate,
    currentTimelineDate,
    simulationPerformanceMode,
    refreshTradeBoard,
    allScheduleDates,
    bannerDate,
    gamesForBannerDate,
    gamesForActiveDate,
    seasonProgressSummary,
    calendarSummaryByDate,
    lastRegularSeasonDate,
    teamLookup,
    pregameRecordByGameId,
    activeDateHasPlayoffs,
    currentTimelineTimeLabel,
  } = useScheduleDerivedState({
    view,
    isSimulating,
    isFinalizingSimulation,
    selectedDate,
    currentDate,
    games,
    teams,
    playerState,
    pendingTrades,
    tradeBoardDate,
    setPendingTrades,
    setTradeBoardDate,
    getProjectedSeasonSummary,
  });

  const resolveAwardCandidateTeam = useCallback((candidate: SeasonHistoryAwardWinner): Team | null => {
    if (!candidate.teamId) {
      return null;
    }
    const liveTeam = teamLookup.get(candidate.teamId) ?? null;
    if (liveTeam) {
      return liveTeam;
    }
    if (!candidate.teamCity || !candidate.teamName) {
      return null;
    }
    return buildFallbackDisplayTeam(candidate.teamId, candidate.teamCity, candidate.teamName);
  }, [teamLookup]);
  const getStatNumber = useCallback((game: Game, key: string): number => {
    const value = game.stats[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }, []);

  const hashKey = useCallback((input: string): number => {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash * 31 + input.charCodeAt(i)) % 2147483647;
    }
    return hash;
  }, []);

  const getFallbackHits = useCallback((game: Game, side: 'away' | 'home'): number => {
    const runs = side === 'away' ? game.score.away : game.score.home;
    return runs + 3 + (hashKey(`${game.gameId}:${side}:h`) % 5);
  }, [hashKey]);

  const {
    flairLabel,
    flairDateLabel,
    activeFlairItem,
    flairIndex,
    isFlairVisible,
    shouldMarqueeFlair,
    renderBroadcastText,
  } = useBroadcastFlair({
    games,
    teams,
    playerState,
    pendingTrades,
    currentTimelineDate,
    allScheduleDates,
    simulationPerformanceMode,
    teamLookup,
    pregameRecordByGameId,
    resolveSeasonYear,
  });
  const selectedGame = useMemo(
    () => (selectedGameId ? games.find((game) => game.gameId === selectedGameId) ?? null : null),
    [games, selectedGameId],
  );
  const blockingGamesForSelected = useMemo(() => {
    if (!selectedGame || selectedGame.status === 'completed') {
      return [];
    }

    return games
      .filter((game) => game.date === selectedGame.date && game.status === 'scheduled' && game.gameId.localeCompare(selectedGame.gameId) < 0)
      .sort((a, b) => a.gameId.localeCompare(b.gameId));
  }, [games, selectedGame]);

  const simulateBlockingGamesForSelected = useCallback(async () => {
    if (!selectedGame || blockingGamesForSelected.length === 0) {
      return;
    }

    const teamMap = new Map<string, Team>(teams.map((team) => [team.id, team]));
    const resolvedGames = blockingGamesForSelected
      .map((blockingGame: Game) => {
        const awayTeam = teamMap.get(blockingGame.awayTeam);
        const homeTeam = teamMap.get(blockingGame.homeTeam);
        if (!awayTeam || !homeTeam) {
          return null;
        }

        const participants = buildGameParticipants(blockingGame, games, playerState);
        const session = simulateGameToFinal(createGameSession(blockingGame, participants), awayTeam, homeTeam, settings);
        return buildCompletedGameFromSession(blockingGame, session);
      })
      .filter((game): game is CompletedGameResult => Boolean(game));

    await applyCompletedGameResults(resolvedGames);
  }, [selectedGame, blockingGamesForSelected, teams, games, playerState, settings, applyCompletedGameResults]);

  const startSimulationFromRouter = useCallback((target: SimulationTarget) => {
    void runSimulationTarget(target);
  }, [runSimulationTarget]);

  const resetSeasonFromRouter = useCallback(() => {
    void resetSeason();
  }, [resetSeason]);

  const proposeTradeFromRouter = useCallback((trade: Parameters<typeof handleTradeProposal>[0]) => {
    void handleTradeProposal(trade);
  }, [handleTradeProposal]);

  const approvePendingTradeFromRouter = useCallback((proposalId: string) => {
    void handleApprovePendingTrade(proposalId);
  }, [handleApprovePendingTrade]);

  const assignFreeAgentFromRouter = useCallback((assignment: Parameters<typeof handleFreeAgencyAssignment>[0]) => {
    void handleFreeAgencyAssignment(assignment);
  }, [handleFreeAgencyAssignment]);

  const generateDraftClassFromRouter = useCallback(() => {
    void handleGenerateDraftClass();
  }, [handleGenerateDraftClass]);

  const draftNextPickFromRouter = useCallback(() => {
    void handleDraftNextPick();
  }, [handleDraftNextPick]);

  const autoDraftRoundFromRouter = useCallback(() => {
    runDraftAuto('round');
  }, [runDraftAuto]);

  const autoDraftAllFromRouter = useCallback(() => {
    runDraftAuto('full');
  }, [runDraftAuto]);

  const resetDraftBoardFromRouter = useCallback(() => {
    void handleResetDraftBoard();
  }, [handleResetDraftBoard]);

  const simulateBlockingGamesFromRouter = useCallback(() => {
    void simulateBlockingGamesForSelected();
  }, [simulateBlockingGamesForSelected]);

  const completeGameFromRouter = useCallback((completedResult: CompletedGameResult) => {
    void applyCompletedGameResults([completedResult]);
  }, [applyCompletedGameResults]);

  const clearNotificationsFromRouter = useCallback(() => {
    setCommissionerNotices([]);
  }, []);

  const clearHistoricalDataFromRouter = useCallback(() => {
    void handleClearHistoricalData();
  }, [handleClearHistoricalData]);

  const generatePlayersFromRouter = useCallback(() => {
    void handleGeneratePlayers();
  }, [handleGeneratePlayers]);

  const hardWipePlayersFromRouter = useCallback(() => {
    void handleHardWipePlayers();
  }, [handleHardWipePlayers]);

  const terminateUniverseFromRouter = useCallback(() => {
    void handleTerminateUniverse();
  }, [handleTerminateUniverse]);

  const routerActions = useMemo(() => ({
    onSetView: setView,
    onSetSelectedDate: setSelectedDate,
    onSetSelectedTeamId: setSelectedTeamId,
    onOpenGame: openGameScreen,
    onOpenSimulationCenter: openSimulationCenter,
    onStartSimulation: startSimulationFromRouter,
    onCancelSimulation: cancelSimulationRun,
    onSimulateToSelectedDate: simulateToSelectedDate,
    onSimulateToEndOfRegularSeason: simulateToEndOfRegularSeason,
    onSimulateDay: simulateDay,
    onSimulateWeek: simulateWeek,
    onSimulateMonth: simulateMonth,
    onSimulateNextTeamGame: simulateNextTeamGame,
    onQuickSimSeason: quickSimSeason,
    onResetSeason: resetSeasonFromRouter,
    onTerminateUniverse: terminateUniverseFromRouter,
    onSimulateToDate: simulateToDate,
    onProposeTrade: proposeTradeFromRouter,
    onApprovePendingTrade: approvePendingTradeFromRouter,
    onVetoPendingTrade: handleVetoPendingTrade,
    onRefreshTradeBoard: refreshTradeBoard,
    onAssignFreeAgent: assignFreeAgentFromRouter,
    onGenerateDraftClass: generateDraftClassFromRouter,
    onDraftNextPick: draftNextPickFromRouter,
    onAutoDraftRound: autoDraftRoundFromRouter,
    onAutoDraftAll: autoDraftAllFromRouter,
    onStopAutoDraft: stopDraftAutoRun,
    onResetDraftBoard: resetDraftBoardFromRouter,
    onSimulateBlockingGames: simulateBlockingGamesFromRouter,
    onCompleteGame: completeGameFromRouter,
    onSelectStandingsTeam: openTeamPage,
    onSimulateInlineToDate: simulateInlineToDate,
    onSimulateNextPlayoffGameInline: simulateNextPlayoffGameInline,
    onSimulateToGameInline: simulateToGameInline,
    onClearNotifications: clearNotificationsFromRouter,
    onSaveSettings: handleSaveSettings,
    onClearHistoricalData: clearHistoricalDataFromRouter,
    onPreviewGeneratePlayers: handlePreviewGeneratePlayers,
    onGeneratePlayers: generatePlayersFromRouter,
    onHardWipePlayers: hardWipePlayersFromRouter,
    onDismissPlayerPreview: handleDismissPlayerPreview,
  }), [
    approvePendingTradeFromRouter,
    assignFreeAgentFromRouter,
    autoDraftAllFromRouter,
    autoDraftRoundFromRouter,
    cancelSimulationRun,
    clearHistoricalDataFromRouter,
    clearNotificationsFromRouter,
    completeGameFromRouter,
    draftNextPickFromRouter,
    generateDraftClassFromRouter,
    generatePlayersFromRouter,
    handleDismissPlayerPreview,
    handlePreviewGeneratePlayers,
    handleSaveSettings,
    handleVetoPendingTrade,
    hardWipePlayersFromRouter,
    terminateUniverseFromRouter,
    openGameScreen,
    openSimulationCenter,
    openTeamPage,
    proposeTradeFromRouter,
    quickSimSeason,
    refreshTradeBoard,
    resetDraftBoardFromRouter,
    resetSeasonFromRouter,
    setSelectedDate,
    setSelectedTeamId,
    setView,
    simulateBlockingGamesFromRouter,
    simulateDay,
    simulateInlineToDate,
    simulateMonth,
    simulateNextPlayoffGameInline,
    simulateNextTeamGame,
    simulateToDate,
    simulateToEndOfRegularSeason,
    simulateToGameInline,
    simulateToSelectedDate,
    simulateWeek,
    startSimulationFromRouter,
    stopDraftAutoRun,
  ]);

  if (isBootstrapping) {
    return (
      <div className="min-h-screen bg-[#181818] text-white font-sans flex items-center justify-center">
        <div className="text-center space-y-2">
          <img src={gpbLogo} alt="GPB" className="mx-auto h-24 w-24 object-contain drop-shadow-[0_4px_8px_rgba(0,0,0,0.45)]" />
          <p className="text-slate-400 font-mono text-sm">Loading league data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans selection:bg-white/20 relative overflow-x-hidden pb-20">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-40 -left-24 w-[420px] h-[420px] rounded-full bg-prestige/15 blur-3xl" />
        <div className="absolute top-[28%] -right-20 w-[360px] h-[360px] rounded-full bg-platinum/15 blur-3xl" />
        <div className="absolute bottom-0 left-[32%] w-[520px] h-[240px] bg-gradient-to-r from-transparent via-white/5 to-transparent blur-2xl" />
      </div>

      <div className="sticky top-0 z-50">
        <div className="border-b border-white/10 bg-[#111111]/96 backdrop-blur">
          <PreviousDateScoreStrip
            simulationPerformanceMode={simulationPerformanceMode}
            bannerDate={bannerDate}
            currentTimelineDate={currentTimelineDate}
            gamesForBannerDate={gamesForBannerDate}
            teamLookup={teamLookup}
            onOpenGame={openGameScreen}
          />
        </div>

        <header className="bg-[#151515]/95 backdrop-blur border-b border-white/10">
          <div className="px-4 sm:px-6 lg:px-8 h-[88px] flex items-center justify-between">
            <button className="flex items-center gap-3" onClick={() => setView('dashboard')}>
              <img src={gpbLogo} alt="GPB home" className="h-[68px] w-[68px] object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)]" />
              <span className="font-logo text-3xl sm:text-4xl uppercase leading-none tracking-[0.06em] text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">
                My League
              </span>
            </button>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
                <Activity className="w-4 h-4 text-prestige" />
                <span className="font-mono">{formatHeaderDate(currentTimelineDate)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
                <Clock3 className="w-4 h-4 text-platinum" />
                <span className="font-mono">{currentTimelineTimeLabel}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400 hidden md:flex">
                <span className={`w-2 h-2 rounded-full ${dataSource === 'supabase' ? 'bg-platinum' : 'bg-prestige'}`} />
                <span className="font-mono">{dataSource === 'supabase' ? 'SUPABASE' : 'LOCAL'}</span>
              </div>
              <button
                onClick={() => setView('notifications')}
                className={`relative p-2 rounded-lg transition-colors ${view === 'notifications' ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-[#323232]'}`}
                title="Commissioner Notifications"
              >
                <Bell className="w-5 h-5" />
                {commissionerNotices.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-platinum text-black text-[10px] font-mono flex items-center justify-center">
                    {commissionerNotices.length > 9 ? '9+' : commissionerNotices.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </header>
      </div>

      <div className="relative z-10 flex">
        <MainNavigation
          view={view}
          onSetView={setView}
          onOpenRandomTeamPage={openRandomTeamPage}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
          <AppViewRouter
            view={view}
            teams={teams}
            games={games}
            playerState={playerState}
            currentDate={currentDate}
            selectedDate={selectedDate}
            selectedTeamId={selectedTeamId}
            seasonComplete={seasonComplete}
            offseasonStage={offseasonStage}
            hasPendingSeasonAwards={Boolean(seasonAwardsSelection)}
            awardsUnlockDate={awardsUnlockDate}
            lotteryOpenDate={lotteryOpenDate}
            draftOpenDate={draftOpenDate}
            freeAgencyOpenDate={freeAgencyOpenDate}
            isDraftOpen={isDraftOpen}
            isFreeAgencyMarketOpen={isFreeAgencyMarketOpen}
            freeAgencyMarketStatusMessage={freeAgencyMarketStatusMessage}
            isSimulating={isSimulating}
            isFinalizingSimulation={isFinalizingSimulation}
            simulationProgress={simulationProgress}
            simulationRunState={simulationRunState}
            simulationSaveStatus={simulationSaveStatus}
            seasonResetStatus={seasonResetStatus}
            isTerminatingUniverse={isTerminatingUniverse}
            selectedGame={selectedGame}
            blockingGamesForSelected={blockingGamesForSelected}
            activeDateHasPlayoffs={activeDateHasPlayoffs}
            activeDate={activeDate}
            allScheduleDates={allScheduleDates}
            calendarSummaryByDate={calendarSummaryByDate}
            gamesForActiveDate={gamesForActiveDate}
            teamLookup={teamLookup}
            pregameRecordByGameId={pregameRecordByGameId}
            seasonProgressSummary={seasonProgressSummary}
            lastRegularSeasonDate={lastRegularSeasonDate}
            pendingTrades={pendingTrades}
            tradeBoardDate={tradeBoardDate}
            currentTimelineDate={currentTimelineDate}
            draftClass={draftCenter.activeClass}
            draftHistory={draftCenter.history}
            isDraftProcessing={isDraftProcessing}
            seasonHistory={seasonHistory}
            settings={settings}
            dataSource={dataSource}
            playerGenerationPreview={playerGenerationPreview}
            isClearingHistoricalData={isClearingHistory}
            isGeneratingPlayers={isGeneratingPlayers}
            isWipingPlayers={isWipingPlayers}
            commissionerNotices={commissionerNotices}
            isSupabaseEnabled={isSupabaseConfigured}
            getStatNumber={getStatNumber}
            getFallbackHits={getFallbackHits}
            {...routerActions}
          />
        </main>
      </div>

      <TradeInterruptionModal
        prompt={tradeInterruptionPrompt}
        onDismiss={() => setTradeInterruptionPrompt(null)}
        onOpenTradeDesk={() => {
          setTradeInterruptionPrompt(null);
          setView('trades');
        }}
      />

      <SeasonAwardsModal
        selection={seasonAwardsSelection}
        resolveAwardCandidateTeam={resolveAwardCandidateTeam}
        onSelectBattingPlayer={(playerId) => {
          setSeasonAwardsSelection((current) => current ? { ...current, selectedBattingPlayerId: playerId } : current);
        }}
        onSelectPitchingPlayer={(playerId) => {
          setSeasonAwardsSelection((current) => current ? { ...current, selectedPitchingPlayerId: playerId } : current);
        }}
        onSelectWorldSeriesPlayer={(playerId) => {
          setSeasonAwardsSelection((current) => current ? { ...current, selectedWorldSeriesPlayerId: playerId } : current);
        }}
        onAutoPickLeaders={applyAutoSeasonAwards}
        onSaveAwardWinners={saveSeasonAwardsSelection}
      />

      <SimulationFloatingPanel
        isVisible={view !== 'simulation' && isSimulating}
        simulationProgress={simulationProgress}
        currentDate={currentDate}
        onOpenSimulation={() => setView('simulation')}
        onCancelSimulation={cancelSimulationRun}
      />

      <BroadcastTickerFooter
        simulationPerformanceMode={simulationPerformanceMode}
        flairLabel={flairLabel}
        flairDateLabel={flairDateLabel}
        activeFlairItem={activeFlairItem}
        flairIndex={flairIndex}
        isFlairVisible={isFlairVisible}
        shouldMarqueeFlair={shouldMarqueeFlair}
        renderBroadcastText={renderBroadcastText}
        onOpenGame={openGameScreen}
      />
    </div>
  );
}

export default App;


