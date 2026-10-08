/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { INITIAL_TEAMS } from './data/teams';
import { addDaysToISODate, generateSchedule, getDefaultSeasonStartDate, DEFAULT_SETTINGS } from './logic/simulation';
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
  SeasonHistoryLeagueWinner,
  SeasonHistoryEntry,
  SeasonHistoryTeamRecord,
  SimulationSettings,
  SimulationTarget,
} from './types';
import type { PriceSeries } from './lib/analytics/sharePrice';
import { clearFairLayerCache, latestClose, leaguePriceSeed, marketFloorFor, priceAndAppendDay, type PriceBoard } from './lib/analytics/priceBoard';
import { crowdEventShocksFor } from './lib/analytics/crowd';
import { formatHeaderDate } from './components/SeasonCalendarStrip';
import { TradeInterruptionModal } from './components/TradeInterruptionModal';
import { SeasonAwardsSummary } from './components/SeasonAwardsSummary';

import { SimCompletePanel } from './components/simulation/SimCompletePanel';
import { BroadcastTickerFooter } from './components/BroadcastTickerFooter';
import type { AppView } from './types';
import { AppViewRouter } from './components/AppViewRouter';
import { ViewBoundary } from './components/ui';
import { NoPlayersGate } from './components/NoPlayersGate';
import { resolveSeasonYear } from './lib/seasonYear';
import { leagueChampionsFromSeries } from './lib/futuresRisk';
import { buildAwardsForBoard } from './lib/awardRace';
import { PreviousDateScoreStrip } from './components/PreviousDateScoreStrip';
import { Activity, Bell, ChartNoAxesColumn, Clock3, Menu, Receipt } from 'lucide-react';
import { FolderNav } from './navigation/FolderNav';
import { MobileFolderMenu } from './navigation/MobileFolderMenu';
import gpbLogo from './assets/gpb.png';
import { createGameSession, simulateGameToFinal, buildCompletedGameFromSession } from './logic/gameEngine';
import { buildGameParticipants } from './logic/gameParticipants';
import { buildNewUniverse, DEFAULT_UNIVERSE_SEED } from './logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from './logic/teamStrength';
import type { BuildNewUniverseResult } from './logic/universeBootstrap';
import { normalizeSeed } from './lib/random';
import {
  applyPlayerGameStatDelta,
  resetPlayerSeasonStats,
} from './logic/playerStats';
import { auditRosterInvariants, repairRosterSlotsForTeams } from './logic/rosterManagement';
import { completeRosterVacancies } from './logic/rosterCompletion';
import { applyOffseasonFreeAgencyRollover, applyOffseasonRetirements, parseOffseasonMeta } from './logic/offseasonFreeAgency';
import { applyPlayerDevelopment } from './logic/playerDevelopment';
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
  saveSharePriceLedger,
} from './lib/storage';
import { useSimulationEngine } from './hooks/useSimulationEngine';
import { buildPowerRankings } from './lib/analytics/powerRankings';
import { useBettingSlip } from './hooks/useBettingSlip';
import { usePortfolio } from './hooks/usePortfolio';
import { useAltHold } from './hooks/useAltHold';
import { TeamLogoGrid } from './components/ui/TeamLogoGrid';
import { HxsePortfolioDrawer } from './components/markets/HxsePortfolioDrawer';
import { clearPowerRankMovement } from './components/home/powerRankMovement';
import { useKeyPress } from './hooks/useKeyPress';
import { getMilestones, nextSeasonStop } from './components/home/shared';
import { isPostseasonWindow } from './lib/seasonPhase';
import { BettingSlip } from './components/betting/BettingSlip';
import { useBroadcastFlair } from './hooks/useBroadcastFlair';
import { useLeagueBootstrap } from './hooks/useLeagueBootstrap';
import { useDraftCenterActions, type DraftCenterState } from './hooks/useDraftCenterActions';
import { useRosterTransactions } from './hooks/useRosterTransactions';
import { useScheduleDerivedState } from './hooks/useScheduleDerivedState';
import { useSeasonLifecycle } from './hooks/useSeasonLifecycle';
import { buildOffseasonEventSchedule } from './logic/offseasonSchedule';
import {
  createLocalUniverseBundle,
  readSharePriceLedger,
  LocalUniverseBundle,
  validateLocalUniverseBundle,
} from './logic/localUniverseState';
import { LocalOperationLock } from './logic/localOperationLock';

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
const PENDING_TRADES_STORAGE_KEY = 'gpb_pending_trades_v1';
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

type OffseasonStage = 'idle' | 'awards' | 'retirements' | 'draft_lottery' | 'draft' | 'free_agency' | 'start_next_season';

interface OffseasonWorkflowState {
  seasonYear: number | null;
  stage: OffseasonStage;
}

type BlockingOffseasonEventKey = 'awards' | 'lottery' | 'draft';
interface BlockingOffseasonEvent { key: BlockingOffseasonEventKey; date: string; label: string; view: AppView | null; isComplete: boolean; }


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

/**
 * League champions, from the completed league championship series.
 *
 * ============================================================================
 * WHY NOT FROM THE DIVISION WINNERS
 * ============================================================================
 *
 * The obvious cheap version -- take `computeDivisionWinnersSnapshot` and key each winner by its
 * league -- is wrong in a way that is easy to miss. There are two divisions per league, so that Map
 * gets the same key written twice, and a Map keeps the LAST write. The archived "league champion"
 * was therefore whichever division leader happened to come last in `DIVISION_ORDER`: not a seed,
 * not the better record, and not anything the playoffs decided.
 *
 * A league champion is the winner of a best-of-seven between the two divisional winners, so it is
 * not even guaranteed to be a division winner. It can only be read off played games, which is what
 * this does -- exactly as `resolveWorldSeriesChampion` already does for the title.
 *
 * `leagueChampionsFromSeries` is shared with `lockedRaces`, so the board deciding a league is over
 * and the archive naming its winner cannot disagree.
 *
 * A league whose series is unfinished contributes NO record, rather than a provisional one. That
 * absence is what makes those bets void instead of paying out to a club that has won nothing.
 */
const computeLeagueChampionsSnapshot = (games: Game[], teams: Team[]): SeasonHistoryLeagueWinner[] => {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  return [...leagueChampionsFromSeries(games)].flatMap(([league, teamId]) => {
    const team = teamsById.get(teamId);
    return team ? [{ ...toSeasonHistoryTeamRecord(team), league }] : [];
  });
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

/*
 * THE AWARD RANKING LIVES IN `awardRace.ts`, ONCE.
 *
 * ============================================================================
 * WHY THIS USED TO BE A SECOND COPY
 * ============================================================================
 *
 * These two functions and `buildAwardsForBoard` all computed the same MVP from the same weights.
 * They had to: the board PRICES from one ranking and the archive SETTLES from the other, so any
 * divergence means the board names an MVP and then refuses to pay that bet. That is the league
 * champion bug again -- a settlement reading a different answer from the board -- one layer up.
 *
 * They agreed on every weight and on the qualifying threshold, and still disagreed where it
 * counted: the archive broke ties alphabetically by player name, the board had no tie-break and
 * inherited roster order. Two copies that agree by convention are not one copy.
 *
 * So they are delegations now. `buildAwardsForBoard` owns the weights, the qualifiers, the sort
 * and the tie-break; this only reshapes the result into the archive record. The summary line is
 * rebuilt from the same filtered stats the ranking used, rather than being carried on the entry,
 * because the board has no reason to carry archive formatting.
 */
const computeBattingMvpCandidates = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
  limit = 8,
): SeasonHistoryAwardWinner[] => {
  const teamsById = new Map<string, Team>(teams.map((team) => [team.id, team] as const));
  const battingStats = new Map(
    playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const battingRatings = new Map(
    playerState.battingRatings
      .filter((rating) => rating.seasonYear === seasonYear)
      .map((rating) => [rating.playerId, rating] as const),
  );

  return buildAwardsForBoard(
    'batting',
    { players: playerState.players, teamsById, battingStats, pitchingStats: new Map(), pitchingRatings: new Map(), battingRatings },
    limit,
  ).map((entry) => {
    const stat = battingStats.get(entry.playerId);
    return {
      playerId: entry.playerId,
      playerName: entry.name,
      teamId: entry.team?.id ?? null,
      teamCity: entry.team?.city ?? null,
      teamName: entry.team?.name ?? null,
      summary: stat
        ? `${stat.avg.toFixed(3)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI`
        : `${entry.total.toFixed(1)} RATING`,
    };
  });
};

/** The pitching mirror of the above. Same single ranking, same tie-break, same reshuffle. */
const computePitchingMvpCandidates = (
  teams: Team[],
  playerState: LeaguePlayerState,
  seasonYear: number,
  limit = 8,
): SeasonHistoryAwardWinner[] => {
  const teamsById = new Map<string, Team>(teams.map((team) => [team.id, team] as const));
  const pitchingStats = new Map(
    playerState.pitchingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => [stat.playerId, stat] as const),
  );
  const pitchingRatings = new Map(
    playerState.pitchingRatings
      .filter((rating) => rating.seasonYear === seasonYear)
      .map((rating) => [rating.playerId, rating] as const),
  );

  return buildAwardsForBoard(
    'pitching',
    { players: playerState.players, teamsById, pitchingStats, pitchingRatings, battingStats: new Map(), battingRatings: new Map() },
    limit,
  ).map((entry) => {
    const stat = pitchingStats.get(entry.playerId);
    return {
      playerId: entry.playerId,
      playerName: entry.name,
      teamId: entry.team?.id ?? null,
      teamCity: entry.team?.city ?? null,
      teamName: entry.team?.name ?? null,
      summary: stat
        ? `${stat.era.toFixed(2)} ERA | ${stat.strikeouts} K | ${stat.inningsPitched.toFixed(1)} IP`
        : `${entry.total.toFixed(1)} RATING`,
    };
  });
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

/**
 * What a finished simulation run did.
 *
 * Every field here is a number something actually counted. `days` comes from the
 * date plan handed to the worker, `gamesPlayed` from the worker's own tally, and
 * `signings` from the market refresh that now runs before every run. Nothing
 * here is inferred from the scope a manager picked -- "One Week" is not assumed
 * to mean seven days, it is measured off the plan.
 */
interface SimReport {
  days: number;
  targetDate: string;
  gamesPlayed: number;
  signings: number;
  signingRounds: number;
  label: string;
}

const getSimulationScopeLabel = (target: SimulationTarget): string => {
  if (target.scope === 'day') return 'Simulating day';
  if (target.scope === 'week') return 'Simulating week';
  if (target.scope === 'month') return 'Simulating month';
  if (target.scope === 'regular_season') return 'Simulating regular season';
  if (target.scope === 'to_milestone') return 'Simulating to next milestone';
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
  // Named for where it stops rather than for its length, because the whole point of the scope is
  // that the destination is the information. "Quick Sim" said how fast, not how far.
  if (target.scope === 'to_milestone') return targetDate ? `To ${targetDate}` : 'To Next Milestone';
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

  /**
   * Stop at the next season milestone strictly after the current date.
   *
   * The candidate list is the three regular-season events a manager is actually waiting on, in
   * schedule order, derived from the real game dates rather than from day counts -- `getMilestones`
   * already does that for the front-page timeline and this reuses it rather than recomputing, so
   * there is one answer to "when is the trade deadline" in the app.
   *
   * Strictly after, not at-or-after. A milestone landing on the current date has already been
   * reached: pressing the button should advance the league, not re-report where it is.
   *
   * Past the finale there is nothing left to stop at, so it falls back to the end of the regular
   * season. That is the honest floor: it stops rather than running on into the postseason.
   */
  if (target.scope === 'to_milestone') {
    const regularDates = getSortedUniqueDates(games.filter(isRegularSeasonGame));
    const finale = regularDates[regularDates.length - 1] ?? startDate;
    const stop = nextSeasonStop(games, startDate);
    // Past the finale there is nothing to stop at, so the honest floor is the end of the regular
    // season rather than running on into the postseason. That is what the removed behaviour did.
    const resolved = stop?.date && stop.date > startDate ? stop.date : finale;
    return { dates: buildCalendarRange(resolved), targetDate: resolved };
  }

  if (target.scope === 'season') {
    const regularDates = getSortedUniqueDates(games.filter(isRegularSeasonGame));
    const regularSeasonEnd = regularDates[regularDates.length - 1] ?? uniqueDates[uniqueDates.length - 1] ?? startDate;
    const targetDate = addDaysToISODate(regularSeasonEnd, 70);
    return { dates: buildCalendarRange(targetDate), targetDate };
  }

  /*
   * The selected club's next game.
   *
   * Unchanged, and deliberately so. This reads `>= startDate`, which means that on an ordinary day
   * -- when every club has a fixture on the current slate -- the plan collapses to a single date and
   * the scope behaves exactly like `day`. That was the defect behind "Next Game seems to just sim
   * the day", and the dashboard's copy of the button has been removed rather than repaired.
   *
   * The semantics were NOT changed here, because this scope is also reachable from the Simulation
   * screen's "Next Team Game" and from the bracket, and silently re-pointing those is a change to
   * two other screens that was not asked for. Whether "Next Team Game" should include today's slate
   * or step past it is a real question about that screen, and it is still open.
   */
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

  /**
   * The HXSE share-price closes, replaced wholesale by each simulation run.
   *
   * `undefined` means the market has never been priced in this session; `[]` means it was priced and
   * there was nothing to record. The distinction is preserved all the way into the save, because
   * coercing the first into the second would claim a league that never traded never traded.
   */
  const [priceLedger, setPriceLedger] = useState<PriceSeries[] | undefined>(undefined);
  /*
    THE LEDGER IS SAVED BY ITS OWN EFFECT, not through `persistLeagueState`.

    The first attempt added it as a seventh argument to the league save, and it silently wrote
    nothing. The league save has five call sites and the simulation path sets the ledger inside
    `applySimulationFullState`, which does not itself save -- so the ledger was read before it existed.
    A ref carrying it fixed the timing and still left the result dependent on which call site ran.

    A ledger is a few kilobytes and changes on its own schedule. Coupling it to a multi-megabyte save
    invoked from five places, one of which runs before the data exists, is the wrong shape. This
    effect fires whenever the ledger changes and writes it on its own, which is also why a quota
    failure here costs a chart rather than a season.
  */
  useEffect(() => {
    /*
      `undefined` means NOT YET KNOWN, not "empty". This effect runs once on mount, before the async
      loader has restored anything -- writing `?? []` here would delete the saved key on every single
      reload and the market would never survive one. An empty array is the only thing that clears it.
    */
    if (!priceLedger) {
      return;
    }
    saveSharePriceLedger(priceLedger);
  }, [priceLedger]);
  const [lastPriceBoard, setLastPriceBoard] = useState<PriceBoard | null>(null);

  /*
    THE HXSE BOOK LIVES HERE, NOT IN THE EXCHANGE VIEW.

    The book is owned at App level so the header drawer and the Exchange desk read the same state, and
    so it survives navigation between views. It no longer settles at a season boundary: positions and
    cash carry across seasons, so there is no rollover event that has to fire whether or not a page is
    open.

    `latestLedgerClose` is the marking source for the same reason it is for the desk: a mark belongs
    against the most recent printed close, not the last day of whatever range the view happens to be
    showing.
  */
  const latestLedgerClose = useMemo(() => latestClose(priceLedger ?? []) ?? {}, [priceLedger]);
  const latestLedgerDate = priceLedger && priceLedger.length > 0
    ? priceLedger[priceLedger.length - 1].date
    : null;

  /*
    THE ONE PIECE OF EXCHANGE STATE THE DRAWER NEEDS, lifted rather than duplicated.

    The club selection lives inside ExchangeView because that is where the chart is. The drawer's
    rows are buttons, so it has to be able to send the reader to a specific club -- and duplicating
    the selection here would give the chart and the drawer two truths. So this is a PENDING request
    rather than a second source of truth: ExchangeView consumes it, selects the club, and clears it,
    so the chart keeps sole ownership of what is on screen.
  */
  const [hxseClubSelection, setHxseClubSelection] = useState<string | null>(null);
  const book = usePortfolio(latestLedgerClose);
  const [hxsePortfolioOpen, setHxsePortfolioOpen] = useState(false);
  const [view, setView] = useState<AppView>('dashboard');

  /*
   * The betting slip lives here rather than on the Betting screen.
   *
   * It is the one piece of state that has to outlive a page: a price added in
   * one view must still be reviewable in another, and a bet has to settle while
   * the manager is somewhere else entirely watching the game finish. The screen
   * reads this same state, so the two cannot disagree about what is in it.
   *
   * Declared after the league state it settles against, below.
   */
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isLogoGridOpen, setIsLogoGridOpen] = useState(false);
  const tPressed = useKeyPress('t');
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
  const [terminateProgress, setTerminateProgress] = useState<{ progress: number; label: string } | null>(null);
  const [isGeneratingPlayers, setIsGeneratingPlayers] = useState(false);
  const [seasonResetStatus, setSeasonResetStatus] = useState<SeasonResetStatus>(IDLE_SEASON_RESET_STATUS);
  const [draftCenter, setDraftCenter] = useState<DraftCenterState>({ activeClass: null, history: [] });
  const [seasonHistory, setSeasonHistory] = useState<SeasonHistoryEntry[]>([]);

  // Declared here, after the state it settles against. See the note above.
  const bettingSlip = useBettingSlip();
const { resetWallet } = bettingSlip;
  const { openBets: openBetList, wallet: bettingWallet, settle: settleBets } = bettingSlip;
  const openBetCount = openBetList.length;

  /*
   * Settlement runs from the shell, not from the Betting page.
   *
   * A bet settles when its game finishes, and a manager who placed it will have
   * navigated somewhere else by then. Keyed on the game list, so a bulk "sim to
   * end of month" that settles forty games at once is caught in one pass rather
   * than one effect per game.
   */
  useEffect(() => {
    if (openBetList.length === 0) return;
    settleBets({ games, teams, currentDate, seasonHistory });
  }, [currentDate, games, openBetList.length, seasonHistory, settleBets, teams]);

  // Sync logo grid with 't' key press
  useEffect(() => {
    setIsLogoGridOpen(tPressed);
  }, [tPressed]);

  /*
    THE AUTUMN PALETTE, SET ON THE DOCUMENT ELEMENT.

    One attribute, and it is on `documentElement` rather than on a wrapper for a reason that is easy
    to get wrong: the header, the navigation rail and the broadcast score ticker all sit OUTSIDE the
    routed view. A class on <main> would repaint the content and leave three surfaces navy on an
    autumn page -- which reads as a bug, not as a scope decision.

    `html[data-season='postseason']` also beats the `@theme` block's `:root` on specificity --
    (0,1,1) against (0,1,0) -- which is why the tokens in index.css override rather than merge.

    The REMOVAL in the cleanup is not decoration. Under React 18 StrictMode an effect runs, cleans up
    and runs again in development, so an effect that sets the attribute but never removes it would
    leave the app autumn forever after one postseason, with no way to get back. The gate itself is
    keyed on SCHEDULED playoff games (see `src/lib/seasonPhase.ts`), which is what makes the window
    close on its own once the last one is played.

    Measured on a real simulated season: opens on day 179, closes on day 201.
  */
  const isPostseason = useMemo(() => isPostseasonWindow(games), [games]);
  useEffect(() => {
    const root = document.documentElement;
    if (isPostseason) {
      root.setAttribute('data-season', 'postseason');
    } else {
      root.removeAttribute('data-season');
    }
    return () => root.removeAttribute('data-season');
  }, [isPostseason]);

  const [isSeasonHistoryLoaded, setIsSeasonHistoryLoaded] = useState(false);
  const [offseasonWorkflow, setOffseasonWorkflow] = useState<OffseasonWorkflowState>(IDLE_OFFSEASON_WORKFLOW_STATE);
  const [isDraftProcessing, setIsDraftProcessing] = useState(false);
  const [newUniversePreview, setNewUniversePreview] = useState<BuildNewUniverseResult | null>(null);
  const [universeSeedInput, setUniverseSeedInput] = useState(String(DEFAULT_UNIVERSE_SEED));
  const [commissionerNotices, setCommissionerNotices] = useState<CommissionerNotice[]>([]);
  const draftCenterRef = useRef<DraftCenterState>({ activeClass: null, history: [] });
  const playerStateRef = useRef<LeaguePlayerState>(EMPTY_PLAYER_STATE);
  const rosterAutoOptimizedRef = useRef(false);
  const offseasonRolloverAppliedRef = useRef<Set<number>>(new Set());
  const gameStatsSignatureCacheRef = useRef<Map<string, GameStatsSignatureCacheEntry>>(new Map());
  const localOperationLockRef = useRef(new LocalOperationLock());

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

  const acquireLocalOperation = useCallback((operation: Exclude<Parameters<LocalOperationLock['acquire']>[0], 'idle'>): boolean => {
    if (localOperationLockRef.current.acquire(operation)) {
      return true;
    }

    pushNotice(`Another local operation is already running (${localOperationLockRef.current.current}).`, 'warning');
    return false;
  }, [pushNotice]);

  const auditRosterState = useCallback((nextPlayerState: LeaguePlayerState, seasonYear: number, context: string) => {
    const audit = auditRosterInvariants(nextPlayerState, teams, seasonYear);
    if (audit.isValid) {
      pushNotice(`${context}: roster audit passed for all ${audit.teams.length} teams.`, 'info');
    } else {
      const teamsWithMissingSlots = audit.teams.filter((team) => team.missingSlots.length > 0).length;
      pushNotice(
        `${context}: ${audit.totalViolations} roster invariant violation${audit.totalViolations === 1 ? '' : 's'} across ${teamsWithMissingSlots} team${teamsWithMissingSlots === 1 ? '' : 's'}.`,
        'warning',
      );
    }
    return audit;
  }, [pushNotice, teams]);

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

  /*
   * THREE KEYS, ONE GATE.
   *
   * Draft center, season history and the offseason workflow were each a load effect followed by an
   * ungated persist effect, and all three lost their contents on every reload in development for the
   * same reason: on mount the load queues a state update while the writer persists the value from
   * the render that just committed -- the initial empty value. So the empty value lands in
   * localStorage while the real contents sit unused in a variable. Under StrictMode the effects then
   * run again immediately and the load RE-READS what the first pass just overwrote.
   *
   * Measured, three seasons seeded and then reloaded:
   *
   *     StrictMode on, ungated   [2023,2024,2025] -> []                n=3 -> n=0
   *     StrictMode off, ungated  [2023,2024,2025] -> [2025,2024,2023] n=3 -> n=3
   *     StrictMode on, gated     [2023,2024,2025] -> [2025,2024,2023] n=3 -> n=3
   *
   * In production the ungated version self-corrects, because the re-render re-runs the writer with
   * the loaded value and puts it back. That is why this read as a dev-only ghost rather than a bug.
   *
   * ONE FLAG, NOT THREE -- and that is a tidiness choice, not a correctness one. This comment used
   * to argue the opposite: that the loads being adjacent and independent meant a per-key flag could
   * unblock a writer on its own load finishing while a sibling in the same commit was still in
   * flight. That reasoning does not hold. All three loads are declared before all three writers, so
   * every read completes inside the same effect flush that runs the writers, and a writer gated on
   * its own read is already satisfied by the time it runs. `tools/proveSeasonHistoryReloadGuard.mjs`
   * injects the per-key scheme and requires it to keep the data, precisely because that claim was
   * never measured.
   *
   * The history flag already existed (`isSeasonHistoryLoaded`, `119fc53`, the day after the load
   * landed) and gated two other things; it was simply never wired to the writer, which was the whole
   * defect.
   *
   * `gpb_season_history_v1` is the one that mattered: three archived seasons to none, every reload,
   * which reads as "it only remembers the last season". The other two lose an accumulated draft-class
   * list, and the offseason checklist position.
   *
   * The offseason one is worth qualifying, since the harness found it. Losing the stage there is not
   * only the writer clobbering it: `useSeasonLifecycle.ts:385` resets any non-idle stage back to idle
   * whenever the season is not complete, which is the app being right -- you cannot be at the lottery
   * with an unfinished season. So the gate is real, but a manager partway through an offseason is in
   * a completed season, where that repair does not fire and the gate is what holds the stage.
   *
   * The rule, for the next key: do not write a key you have not read.
   */
  const [isLocalKeysLoaded, setIsLocalKeysLoaded] = useState(false);

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
      if (stage !== 'idle' && stage !== 'awards' && stage !== 'retirements' && stage !== 'draft_lottery' && stage !== 'draft' && stage !== 'free_agency' && stage !== 'start_next_season') {
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
    } finally {
      setIsLocalKeysLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isLocalKeysLoaded) {
      return;
    }
    try {
      localStorage.setItem(DRAFT_CENTER_STORAGE_KEY, JSON.stringify(draftCenter));
    } catch (error) {
      console.error('Failed to persist draft center state:', error);
    }
  }, [draftCenter, isLocalKeysLoaded]);

  /*
   * PERSIST SEASON HISTORY -- but never before the load has finished.
   *
   * The reasoning, and the measurement behind it, are on `isLocalKeysLoaded` above. This is the key
   * that lost real data: three archived seasons were being reduced to none on every reload in dev,
   * which is what a manager sees as "it only remembers the last season".
   */
  useEffect(() => {
    if (!isLocalKeysLoaded) {
      return;
    }
    try {
      localStorage.setItem(SEASON_HISTORY_STORAGE_KEY, JSON.stringify(seasonHistory.slice(0, MAX_SEASON_HISTORY_ENTRIES)));
    } catch (error) {
      console.error('Failed to persist season history state:', error);
    }
  }, [isLocalKeysLoaded, seasonHistory]);

  useEffect(() => {
    if (!isLocalKeysLoaded) {
      return;
    }
    try {
      localStorage.setItem(OFFSEASON_WORKFLOW_STORAGE_KEY, JSON.stringify(offseasonWorkflow));
    } catch (error) {
      console.error('Failed to persist offseason workflow state:', error);
    }
  }, [isLocalKeysLoaded, offseasonWorkflow]);

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

  /**
   * Clears the season record for a new year. Rating is deliberately left alone:
   * it is derived from the roster, and the roster is re-rated at the end of the
   * offseason once free agency and the draft have settled. Re-deriving it here
   * from wins would reintroduce the feedback loop this replaced -- a strong
   * record would set a high rating, the high rating would produce the record,
   * and roster management would have no purchase on either.
   */
  const buildFreshSeasonTeams = useCallback((teamsToReset: Team[]): Team[] =>
    teamsToReset.map((team) => ({
      ...team,
      wins: 0,
      losses: 0,
      runsScored: 0,
      runsAllowed: 0,
    })), []);

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
    /*
      The HXSE closes come back from the save through this. It is the last link in the chain that makes
      the market survive a reload: computed in the worker, carried on the snapshot, saved to
      `glb_share_price_ledger`, read back by the loader, handed to the page here.
    */
    onRestorePriceLedger: setPriceLedger,
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
    seasonAwardsSummary,
    seasonAwardsSeen,
    dismissSeasonAwardsSummary,
    reviewSeasonAwards,
    clearSeasonAwardsSummary,
    offseasonStage,
  } = useSeasonLifecycle({
    seasonComplete,
    currentDate,
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
    computeLeagueChampionsSnapshot,
    computeBattingMvpCandidates,
    computePitchingMvpCandidates,
    computeWorldSeriesMvpCandidates,
    onOpenDraftView: () => {
      setView('lottery');
    },
    onOpenFreeAgencyView: () => {
      setView('free_agency');
    },
    onOpenOffseasonView: () => {
      setView('offseason');
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
    priceLedger,
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
    onDraftCompleted: (nextPlayerState, seasonYear) => {
      auditRosterState(nextPlayerState, seasonYear, 'Draft completed');
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
  const isFreeAgencyMarketOpen = seasonComplete ? offseasonStage === 'free_agency' : Boolean(currentDate) && !isFreeAgencyFreezeWindow;
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
      skipAgeAndRetirements: true,
    });

    offseasonRolloverAppliedRef.current.add(rolloverSeasonYear);
    saveOffseasonRolloverMarkers([...existingMarkers, rolloverSeasonYear]);
    setPlayerState(result.nextPlayerState);
    playerStateRef.current = result.nextPlayerState;
    auditRosterState(result.nextPlayerState, rolloverSeasonYear, 'Retirements completed');
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

  const simulateRetirements = useCallback(async () => {
    if (!seasonComplete || offseasonStage !== 'retirements') {
      pushNotice('Retirements are not the active offseason event.', 'warning');
      return;
    }
    const seasonYear = offseasonWorkflow.seasonYear ?? resolveSeasonYear(currentDate, games);
    const effectiveDate = resolveEffectiveActionDate(currentDate, selectedDate, games);
    const result = applyOffseasonRetirements({
      playerState,
      seasonYear,
      effectiveDate,
    });

    // Players are now aged to the coming year, so write their new ratings
    // before the draft and free agency run. Otherwise the rest of the offseason
    // evaluates a stale snapshot and nobody ever improves or declines.
    const development = applyPlayerDevelopment({
      playerState: result.nextPlayerState,
      seasonYear: seasonYear + 1,
      effectiveDate,
    });

    setPlayerState(development.nextPlayerState);
    playerStateRef.current = development.nextPlayerState;
    saveLocalPlayerStateSafely(development.nextPlayerState);
    setOffseasonWorkflow({ seasonYear, stage: 'draft_lottery' });
    try {
      if (isSupabaseConfigured) await saveSupabasePlayerState(development.nextPlayerState);
      pushNotice(
        `Aging complete: ${result.retiredPlayers} retired, ${development.summary.playersDeveloped} players developed for ${seasonYear + 1} (avg ${development.summary.averageOverall.toFixed(1)}). ` +
        `${development.summary.bigGains} breakout / ${development.summary.bigDeclines} steep decline, ${development.summary.injuredPlayers} injured.`,
        'success',
      );
    } catch (error) {
      console.error('Failed to persist retirement event:', error);
      pushNotice('Retirements completed locally, but syncing player data failed.', 'warning');
    }
  }, [currentDate, games, isSupabaseConfigured, offseasonStage, offseasonWorkflow.seasonYear, playerState, pushNotice, resolveEffectiveActionDate, saveLocalPlayerStateSafely, saveSupabasePlayerState, seasonComplete, selectedDate, setPlayerState]);

  const completeFreeAgency = useCallback(() => {
    if (!seasonComplete || offseasonStage !== 'free_agency') return;
    const seasonYear = offseasonWorkflow.seasonYear ?? resolveSeasonYear(currentDate, games);
    const effectiveDate = resolveEffectiveActionDate(currentDate, selectedDate, games);
    const completion = completeRosterVacancies(teams, playerState, seasonYear, effectiveDate);
    setPlayerState(completion.playerState);
    playerStateRef.current = completion.playerState;
    saveLocalPlayerStateSafely(completion.playerState);
    auditRosterState(completion.playerState, seasonYear, 'Free agency finalized');

    // Re-rate from the rosters the offseason just settled. This is the same
    // call the diagnostic harness makes at the same point, so a league measured
    // in the lab and a league played in the app agree on team strength.
    const ratedTeams = recalculateTeamRatingsFromRosters(teams, completion.playerState, seasonYear);
    setTeams(ratedTeams);

    if (isSupabaseConfigured) {
      void saveSupabasePlayerState(completion.playerState).catch((error) => {
        console.error('Failed to persist completed roster state:', error);
        pushNotice('Roster completion applied locally, but Supabase sync failed.', 'warning');
      });
    }
    setOffseasonWorkflow((current) => ({ ...current, stage: 'start_next_season' }));
    pushNotice(
      `Free agency finalized: ${completion.freeAgentsSigned} free agents signed and ${completion.rookiesAdded} rookies added. ${completion.remainingOpenSlots} open roster slots remain.`,
      completion.remainingOpenSlots === 0 ? 'success' : 'warning',
    );
  }, [auditRosterState, currentDate, games, isSupabaseConfigured, offseasonStage, offseasonWorkflow.seasonYear, playerState, pushNotice, resolveEffectiveActionDate, resolveSeasonYear, saveLocalPlayerStateSafely, saveSupabasePlayerState, seasonComplete, selectedDate, setOffseasonWorkflow, setPlayerState, teams]);

  const resetSeason = useCallback(async (teamsToReset = teams, settingsToUse = settings) => {
    if (seasonResetStatus.isResetting) {
      return;
    }

    if (isSimulating || isFinalizingSimulation) {
      pushNotice('Stop the active simulation run before resetting the season.', 'warning');
      return;
    }

    if (seasonComplete && !awardsSavedForCurrentOffseason) {
      pushNotice('Save the season award winners before resetting. History is only archived after awards are saved.', 'warning');
      return;
    }

    if (seasonComplete && offseasonStage !== 'start_next_season') {
      pushNotice('Complete the active item in the Offseason Checklist before starting the next season.', 'warning');
      setView('offseason');
      return;
    }

    if (!acquireLocalOperation('season_reset')) {
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

      const activeSeasonYear = resolveSeasonYear(currentDate, games);
      const latestKnownSeasonYear = Math.max(activeSeasonYear, latestArchivedSeasonYear || activeSeasonYear);
      const nextSeasonYear = seasonComplete ? latestKnownSeasonYear + 1 : latestKnownSeasonYear;
      // Rate for nextSeasonYear, the year the schedule is about to be built for.
      // Ratings are already roster-derived by this point -- the offseason re-rates
      // at the end of free agency -- so this covers the case where a reset happens
      // without one, and guarantees the season never starts on a stale rating.
      const ratedTeams = recalculateTeamRatingsFromRosters(teamsToReset, playerState, nextSeasonYear);
      const freshTeams = buildFreshSeasonTeams(ratedTeams);
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
        clearSeasonAwardsSummary();
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
      localOperationLockRef.current.release('season_reset');
      globalThis.setTimeout(() => {
        setSeasonResetStatus(IDLE_SEASON_RESET_STATUS);
      }, 500);
    }
  }, [
    clearSeasonAwardsSummary,
    acquireLocalOperation,
    teams,
    settings,
    seasonResetStatus.isResetting,
    isSimulating,
    isFinalizingSimulation,
    seasonComplete,
    awardsSavedForCurrentOffseason,
    offseasonStage,
    currentDate,
    games,
    latestArchivedSeasonYear,
    pushNotice,
    buildFreshSeasonTeams,
    playerState,
 createMasterSchedule,
    playerState,
    saveLocalPlayerStateSafely,
    saveLocalLeagueStateSafely,
    persistLeagueState,
    resetSimulationState,
    stopDraftAutoRun,
  ]);

  const handleSaveSettings = (newTeams: Team[], newSettings: SimulationSettings) => {
    if (seasonComplete && !awardsSavedForCurrentOffseason) {
      pushNotice('Save the season award winners before resetting. History is only archived after awards are saved.', 'warning');
      return;
    }

    if (seasonComplete && offseasonStage !== 'start_next_season') {
      pushNotice('Complete the active item in the Offseason Checklist before starting the next season.', 'warning');
      setView('offseason');
      return;
    }

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
      clearSeasonAwardsSummary();
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
    if (!acquireLocalOperation('player_generation')) {
      return;
    }
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
      localOperationLockRef.current.release('player_generation');
    }
  }, [acquireLocalOperation, pushNotice]);

  const handleTerminateUniverse = useCallback(async () => {
    if (isTerminatingUniverse || seasonResetStatus.isResetting) {
      return;
    }

    if (isSimulating || isFinalizingSimulation) {
      pushNotice('Stop the active simulation run before terminating the universe.', 'warning');
      return;
    }

    if (!acquireLocalOperation('universe_termination')) {
      return;
    }

    setIsTerminatingUniverse(true);
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const updateProgress = (progressValue: number, label: string) => {
      setTerminateProgress({ progress: Math.max(0, Math.min(100, progressValue)), label });
    };
    updateProgress(5, 'Preparing termination');
    watchdogTimer = setTimeout(() => {
      console.error('Terminate universe timed out after 20s');
      setIsTerminatingUniverse(false);
      setTerminateProgress(null);
      pushNotice('Terminate Universe timed out. The operation was aborted.', 'error');
      localOperationLockRef.current.release('universe_termination');
    }, 20000);

    /*
      YIELD A FRAME BEFORE THE WORK, OR THE OVERLAY NEVER EXISTS.

      `buildNewUniverse` is a long SYNCHRONOUS chain, and it used to start on the same tick that set
      `isTerminatingUniverse`. React batches the whole tick, so it rendered once with the flag already
      back to false -- the overlay was written, mounted, and never painted. Measured, not assumed:
      the probe reported "overlay NOT shown" on every run while the termination itself worked.

      Two frames, not one: the first lets React commit the overlay, the second lets the browser
      actually paint it before the main thread is blocked. Without the second the frame is committed
      but never shown, which looks identical to not having tried.

      This costs ~32ms and is the entire difference between a transformation and a freeze. It cannot
      loop and cannot hang -- it is two awaited frames, and the watchdog above still bounds the work.
      No early return after the yield: the lock is released in `finally`, so bailing out here would
      strand it and leave every later universe operation permanently blocked.
    */
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const normalizedSeed = normalizeSeed(universeSeedInput);

    try {
      updateProgress(15, 'Clearing simulation state');
      resetSimulationState();
      stopDraftAutoRun();
      offseasonRolloverAppliedRef.current.clear();

      const baselineTeams = INITIAL_TEAMS.map((team) => ({ ...team }));
      const baselineSettings = { ...DEFAULT_SETTINGS };
      const baselineSeasonYear = new Date().getFullYear();
      const baselineSchedule = createMasterSchedule(baselineTeams, baselineSeasonYear);
      const firstDate = baselineSchedule[0]?.date ?? getDefaultSeasonStartDate(baselineSeasonYear);
      // A new universe begins immediately playable and immediately coherent:
      // buildNewUniverse runs generate -> develop -> fill rosters, the same
      // chain the offseason runs, so the development model and the roster
      // repair are already in force on day one instead of a season later.
      // Seeding it means the same universe can be rebuilt to A/B a model change.
      // Termination is exempt from year inheritance; it must always start fresh in the current year.
      const built = buildNewUniverse({
        teams: baselineTeams,
        seasonYear: baselineSeasonYear,
        seed: normalizedSeed,
        effectiveDate: `${baselineSeasonYear}-12-15`,
      });
      const regeneratedPlayerState = built.playerState;

      // Team strength is derived from the roster, so it can only be rated once
      // the rosters exist. Without this the universe would start on the static
      // ratings in data/teams.ts and never be re-rated, which is what made team
      // management cosmetic in the shipped game.
      const ratedBaselineTeams = recalculateTeamRatingsFromRosters(
        baselineTeams,
        regeneratedPlayerState,
        baselineSeasonYear,
      );

      React.startTransition(() => {
        setTeams(ratedBaselineTeams);
        setSettings(baselineSettings);
        setGames(baselineSchedule);
        setCurrentDate(firstDate);
        setSelectedDate(firstDate);
        setProgress(0);
        setSeasonComplete(false);
        setPlayerState(regeneratedPlayerState);
        setPendingTrades([]);
        setTradeBoardDate('');
        setTradeInterruptionPrompt(null);
        clearSeasonAwardsSummary();
        setSeasonHistory([]);
        setDraftCenter({ activeClass: null, history: [] });
        setOffseasonWorkflow(IDLE_OFFSEASON_WORKFLOW_STATE);
        setSelectedGameId(null);
        setNewUniversePreview(null);
      });
      playerStateRef.current = regeneratedPlayerState;

      clearLocalPlayerState();
      saveLocalPlayerStateSafely(regeneratedPlayerState);
      saveLocalLeagueStateSafely(ratedBaselineTeams, baselineSettings, baselineSchedule, firstDate, 0, false);

      localStorage.removeItem(SEASON_HISTORY_STORAGE_KEY);
      localStorage.removeItem(DRAFT_CENTER_STORAGE_KEY);
      localStorage.removeItem(OFFSEASON_WORKFLOW_STORAGE_KEY);
      localStorage.removeItem(OFFSEASON_ROLLOVER_MARKERS_STORAGE_KEY);
      setIsSeasonHistoryLoaded(true);
      updateProgress(70, 'Resetting market state');
      setNewUniversePreview(null);
      /*
        THE HXSE GOES WITH THE UNIVERSE.

        Terminate predates the exchange, so everything it cleared was league-shaped and the market
        was never audited into it. Three things had to go, and setting React state alone was not
        enough for any of them:

        - `priceLedger` to `undefined`, not `[]`. `[]` would claim the new universe had traded and
          produced nothing.
        - `lastPriceBoard`, because the crowd prices a stepped day from the previous day's FAIR
          values. A board left over from the old universe would have the new league's first day
          priced against an assessment of a league that no longer exists.
        - the portfolio, via `book.reset()`, or a "new universe" opens holding the last one's
          positions and lifetime realised record.
        - the power-ranking movement snapshot, via `clearPowerRankMovement()`. The strip measures a
          club against the last board it stored, and a rebuilt league shares its team ids with the
          one it replaced -- without this, the new universe would open with the old league's arrows
          pointing at clubs that are only nominally the same.
        - the fair-layer cache in `priceBoard.ts`, via `clearFairLayerCache()`. That Map is keyed by
          the caller's `fairCacheKey`, and the dashboard's is `rankings|<seasonHistory.length>|<date>`
          -- which carries no universe identity at all. Terminate part-way through a first season and
          the rebuilt league has the same `seasonHistory.length` (0); play it forward to the same date
          and the key matches, so the new league is served power rankings, fair prices and playoff
          odds computed from rosters that no longer exist. Two universes cannot share a process-local
          cache, so the cache goes with the universe like everything else here.

        THE STORED LEDGER IS CLEARED THROUGH `saveSharePriceLedger([])`, not a bare removeItem,
        because it lives in BOTH stores and `loadLocalLeagueStateAsync` reads IndexedDB first. A
        localStorage-only delete leaves the IndexedDB copy, so the old prices return on the next
        reload. Measured, not assumed: the first version of this fix deleted localStorage directly
        and the probe still read 1061 bytes of the old ledger after a successful termination. That
        function already clears both and treats an empty ledger as absent rather than as an empty
        price history, which is the claim we want.
      */
      saveSharePriceLedger([]);
      setPriceLedger(undefined);
      setLastPriceBoard(null);
      book.reset();
      clearPowerRankMovement();
      clearFairLayerCache();
      /*
        AND THE BETTING WALLET, which was the one thing this list left out.

        `book.reset()` covers the exchange portfolio and always did. The money you stake at MacroBet
        lives in a different hook entirely, on the same shape, and nothing here touched it -- so a
        terminated universe came back with whatever balance you happened to be holding and a betting
        record full of wagers on players that no longer exist. `resetWallet` clears both, and clears
        the slip with them so a half-assembled wager cannot be confirmed against a balance that has
        just been restored.
      */
      resetWallet();
      updateProgress(85, 'Persisting new universe');
      // Land on the dashboard rather than wherever the manager happened to be standing. The screen
      // they were on belonged to the universe that just ended -- the old Simulate board, the old
      // standings -- so staying put shows a page describing a league that no longer exists.
      setView('dashboard');

      if (isSupabaseConfigured) {
        await clearSupabasePlayerState();
        await clearSupabaseSeasonHistory();
        await persistLeagueState(
          ratedBaselineTeams,
          baselineSettings,
          baselineSchedule,
          firstDate,
          0,
          false,
          { pruneMissingGames: true },
        );
        await saveSupabasePlayerState(regeneratedPlayerState);
        setDataSource('supabase');
        pushNotice(`Universe terminated and rebuilt with ${regeneratedPlayerState.players.length} players (seed ${normalizedSeed}).`, 'success');
      } else {
        setDataSource('local');
        pushNotice(`Universe terminated locally and rebuilt with ${regeneratedPlayerState.players.length} players (seed ${normalizedSeed}).`, 'success');
      }
    } catch (error) {
      console.error('Failed to terminate universe:', error);
      pushNotice('Terminate Universe failed. Some data may still be present.', 'error');
    } finally {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      setTerminateProgress(null);
      setIsTerminatingUniverse(false);
      localOperationLockRef.current.release('universe_termination');
    }
  }, [
    clearSeasonAwardsSummary,
    acquireLocalOperation,
    createMasterSchedule,
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
    universeSeedInput,
    book,
    resetWallet,
  ]);

  // One path for making a universe, and one preview. "Generate Players" used to
  // be a second, partial version of this that swapped playerState and left the
  // schedule, standings, history and offseason markers behind, which could
  // leave a live league holding a year-one-shaped pool. Both controls now build
  // the same thing through buildNewUniverse.
  const handlePreviewNewUniverse = useCallback(() => {
    const seasonYear = resolveSeasonYear(currentDate, games);
    const built = buildNewUniverse({
      teams,
      seasonYear,
      seed: normalizeSeed(universeSeedInput),
      effectiveDate: `${seasonYear}-12-15`,
    });
    setNewUniversePreview(built);
  }, [currentDate, games, teams, universeSeedInput]);

  const handleDismissPlayerPreview = useCallback(() => {
    setNewUniversePreview(null);
  }, []);

  const handleGeneratePlayers = useCallback(async () => {
    if (!acquireLocalOperation('player_generation')) {
      return;
    }
    setIsGeneratingPlayers(true);

    try {
      const seasonYear = resolveSeasonYear(currentDate, games);
      const generatedPlayerState = newUniversePreview?.playerState ?? buildNewUniverse({
        teams,
        seasonYear,
        seed: normalizeSeed(universeSeedInput),
        effectiveDate: `${seasonYear}-12-15`,
      }).playerState;

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

      setNewUniversePreview(null);
    } catch (error) {
      console.error('Failed to generate player data:', error);
      pushNotice('Failed to generate player data.', 'error');
    } finally {
      setIsGeneratingPlayers(false);
      localOperationLockRef.current.release('player_generation');
    }
  }, [acquireLocalOperation, currentDate, games, isSupabaseConfigured, newUniversePreview, pushNotice, teams, universeSeedInput]);

  const exportLocalUniverseBackup = useCallback(async (): Promise<LocalUniverseBundle> => (
    createLocalUniverseBundle({
      league: {
        teams,
        settings,
        games,
        currentDate,
        progress,
        seasonComplete,
      },
      players: playerState,
      seasonHistory,
      offseasonWorkflow,
      draftCenter,
      pendingTrades,
        sharePriceLedger: priceLedger,
    })
  /*
    `priceLedger` WAS MISSING FROM THIS DEPENDENCY LIST, so the backup callback captured whatever the
    ledger was when the callback was last rebuilt -- `undefined` on a fresh load -- and exported an
    empty price history. Found by building the Exchange page and asking why it showed "no prices yet"
    against a league with forty-five simulated days behind it.
  */
  ), [currentDate, draftCenter, games, offseasonWorkflow, pendingTrades, playerState, priceLedger, progress, seasonComplete, seasonHistory, settings, teams]);

  const importLocalUniverseBackup = useCallback(async (payload: unknown): Promise<void> => {
    if (!acquireLocalOperation('backup_import')) {
      throw new Error('Another local operation is already running.');
    }

    try {
    const validation = validateLocalUniverseBundle(payload);
    if (!validation.valid) {
      throw new Error(`Backup validation failed: ${validation.errors.slice(0, 3).join(' ')}`);
    }

    const bundle = payload as LocalUniverseBundle;
    resetSimulationState();
    stopDraftAutoRun();

    saveLocalLeagueStateSafely(
      bundle.league.teams,
      bundle.league.settings,
      bundle.league.games,
      bundle.league.currentDate,
      bundle.league.progress,
      bundle.league.seasonComplete,
    );
    saveLocalPlayerStateSafely(bundle.players);
    localStorage.setItem(SEASON_HISTORY_STORAGE_KEY, JSON.stringify(bundle.seasonHistory));
    localStorage.setItem(OFFSEASON_WORKFLOW_STORAGE_KEY, JSON.stringify(bundle.offseasonWorkflow));
    localStorage.setItem(DRAFT_CENTER_STORAGE_KEY, JSON.stringify(bundle.draftCenter));
    localStorage.setItem(PENDING_TRADES_STORAGE_KEY, JSON.stringify(bundle.pendingTrades));

    React.startTransition(() => {
      setTeams(bundle.league.teams);
      setSettings(bundle.league.settings);
      setGames(bundle.league.games);
      setCurrentDate(bundle.league.currentDate);
      setSelectedDate(bundle.league.currentDate);
      setProgress(bundle.league.progress);
      setSeasonComplete(bundle.league.seasonComplete);

    // The price ledger is read through its defensive reader even though `bundle` has already been
    // validated, because that reader is the one place that knows what a corrupt day looks like. An
    // absent ledger means the save predates the market and the league starts with none -- which is
    // different from a ledger of zero days, and is not the same claim.
    setPriceLedger(readSharePriceLedger(bundle.sharePriceLedger));
      /*
       * A save carries closes, not fair values, so there is no board to restore -- and the board in
       * memory at this moment belongs to whatever league was open BEFORE this one. It has to be
       * dropped, or the first stepped day after a load would have the crowd trading against another
       * universe's fair prices. One day without a crowd is the correct price for that; a day with
       * the wrong crowd is not.
       */
      setLastPriceBoard(null);
      /*
       * And the fair-layer cache goes with it. Its key is the caller's `fairCacheKey` -- a date and
       * a season count -- not an identity of the imported universe, so an entry left behind by the
       * league that was open before this import can answer for the one being imported. Same defect,
       * same fix as termination.
       */
      clearFairLayerCache();
      setPlayerState(bundle.players);
      setSeasonHistory(bundle.seasonHistory);
      setOffseasonWorkflow(bundle.offseasonWorkflow);
      setDraftCenter(bundle.draftCenter);
      setPendingTrades(bundle.pendingTrades);
      setTradeBoardDate('');
      setTradeInterruptionPrompt(null);
      setSelectedGameId(null);
      setNewUniversePreview(null);
      setDataSource('local');
    });
    playerStateRef.current = bundle.players;
    draftCenterRef.current = bundle.draftCenter;
    offseasonRolloverAppliedRef.current.clear();
    setIsSeasonHistoryLoaded(true);
    pushNotice('Local universe backup imported and applied successfully.', 'success');
    } finally {
      localOperationLockRef.current.release('backup_import');
    }
  }, [acquireLocalOperation, pushNotice, resetSimulationState, saveLocalLeagueStateSafely, saveLocalPlayerStateSafely, stopDraftAutoRun]);

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
      /**
       * The HXSE share-price closes the worker accumulated this run.
       *
       * Optional because the worker snapshot field postdates older builds. Not defaulted to `[]`,
       * because undefined and empty are different claims and the save records the difference.
       */
      nextPriceLedger?: PriceSeries[],
    /**
     * The last board the worker priced.
     *
     * REPLACED, never merged and never left stale. The crowd prices a single stepped day from the
     * previous day's fair values, so a board left over from before a bulk run would have the crowd
     * trading against an assessment of a league state that no longer exists.
     */
    nextPriceBoard?: PriceBoard | null,
  ) {
    React.startTransition(() => {
      setTeams(nextTeams);
      setGames(nextGames);
      setPlayerState(nextPlayerState);
      setCurrentDate(nextCurrentDate);
      setSelectedDate(nextCurrentDate);
      setProgress(nextProgress);
      setSeasonComplete(nextSeasonComplete);
        // Only ever replaced, never appended to. The worker already returns the whole ledger for
        // the run, so merging here would double-count every day the run covered.
        setPriceLedger(nextPriceLedger);
      setLastPriceBoard(nextPriceBoard ?? null);
    });
  }

  const {
    handleTradeProposal,
    handleApprovePendingTrade,
    handleVetoPendingTrade,
    handleFreeAgencyAssignment,
    handleFreeAgencyShakeUp,
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

  /* ------------------------------------------------------------------ *
   * Simulation entry points
   *
   * These live below useRosterTransactions, not above it, because the funnel
   * needs the shake-up. Every simulation in the product goes through
   * runSimulationTarget, which is the one place the market can be refreshed
   * before the days are played.
   * ------------------------------------------------------------------ */

  /**
   * What a finished run did, for the completion panel.
   *
   * Held in a ref rather than state because it is written at the moment a run
   * is requested and read when it finishes, and neither of those is a render.
   */
  const pendingRunRef = useRef<{
    days: number;
    target: SimulationTarget;
    keepCurrentView: boolean;
    signings: number;
    signingRounds: number;
  } | null>(null);

  /*
   * The receipt itself.
   *
   * Declared up here, ahead of runSimulationTarget, which clears it when a new
   * run starts. Placing it after the funnel worked at runtime -- the setter is
   * only ever called from a callback body, well after render has finished -- but
   * it read as though the funnel referenced a binding that did not exist yet,
   * and that is the kind of thing that breaks the moment someone moves a line.
   */
  const [simReport, setSimReport] = useState<SimReport | null>(null);

  /**
   * Run every simulation through here.
   *
   * The free-agency market is refreshed first, once per run, including for a
   * single day. It used to be a button a manager had to remember to press, which
   * meant the league quietly filled up with unsigned talent while games were
   * played against static rosters -- and because it was manual, nobody could
   * tell from a save whether the market had been run that week at all.
   *
   * The shake-up's player state is handed to the engine as an override rather
   * than written with setState. React state is async, so the engine's closure
   * would still hold the pre-shake-up rosters, the days would be played against
   * them, and the closing snapshot would overwrite the shake-up with no error
   * anywhere. See SimulationRunOptions.playerStateOverride.
   *
   * A run that is blocked by an offseason gate does not shake up. Nothing is
   * simulated in that case, so changing rosters would be a change to a league
   * that did not move.
   */
  const runSimulationTarget = useCallback(async (
    target: SimulationTarget,
    options?: { keepCurrentView?: boolean },
  ) => {
    const startingDate = currentDate || games[0]?.date || getDefaultSeasonStartDate(new Date().getFullYear());
    const plan = buildSimulationDatePlan(games, startingDate, target);

    const isBlockedByOffseasonGate = Boolean(
      seasonComplete
      && nextBlockingOffseasonEvent
      && startingDate >= nextBlockingOffseasonEvent.date,
    );

    if (isBlockedByOffseasonGate && nextBlockingOffseasonEvent) {
      pushNotice(
        `${nextBlockingOffseasonEvent.label} must be completed before advancing beyond ${nextBlockingOffseasonEvent.date}.`,
        'warning',
      );
      if (!options?.keepCurrentView && nextBlockingOffseasonEvent.view) {
        setView(nextBlockingOffseasonEvent.view);
      }
      return;
    }

    // Silent on purpose: see ShakeUpOptions. The signing count is carried into
    // the completion panel instead of arriving as a toast before the run starts.
    const shakeUp = await handleFreeAgencyShakeUp({ silent: true });

    /*
     * Retire the previous receipt now that a new run is starting.
     *
     * Without this the old panel sits on screen through the whole next run,
     * showing the previous run's day count and signing figure over a league
     * that has already moved on. The numbers are not wrong, they are about a
     * simulation that is no longer the one running -- which is worse, because
     * they still look authoritative.
     */
    setSimReport(null);

    pendingRunRef.current = {
      // Counted from the plan, which is the calendar the worker was actually
      // given. Not a guess about how many days "week" means.
      days: plan.dates.length,
      target,
      keepCurrentView: Boolean(options?.keepCurrentView),
      signings: shakeUp?.signings ?? 0,
      signingRounds: shakeUp?.rounds ?? 0,
    };

    const runOptions = {
      ...options,
      playerStateOverride: shakeUp?.playerState,
    };

    if (seasonComplete && nextBlockingOffseasonEvent && plan.targetDate > nextBlockingOffseasonEvent.date) {
      pushNotice(
        `Simulation capped at ${nextBlockingOffseasonEvent.date} for ${nextBlockingOffseasonEvent.label}.`,
        'info',
      );
      await runSimulationTargetEngine(
        { scope: 'to_date', targetDate: nextBlockingOffseasonEvent.date },
        runOptions,
      );
      return;
    }

    await runSimulationTargetEngine(target, runOptions);
  }, [
    buildSimulationDatePlan,
    currentDate,
    games,
    getDefaultSeasonStartDate,
    handleFreeAgencyShakeUp,
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

  /**
   * Advance to the next season milestone.
   *
   * Was `{ scope: 'season' }`, which is regular-season end plus seventy days -- the whole postseason
   * and into the offseason, from one button press, with nothing on screen saying how far it would
   * go. This is the replacement, and it stops at the All-Star break, the trade deadline or the
   * regular-season finale.
   *
   * `season` still exists and is still reachable from the Simulation screen as an explicit "Full
   * Season" choice. The difference is that the dashboard's one-click button no longer runs a whole
   * season unattended, and the button names its destination instead of being called "Quick".
   */
  const simulateToNextMilestone = useCallback(() => {
    void runSimulationTarget({ scope: 'to_milestone' });
  }, [runSimulationTarget]);

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

  /*
   * Report a finished run.
   *
   * Fires on the transition INTO 'complete', not on every render where the
   * status happens to be 'complete'. The run state is replaced with a new object
   * on each update, so keying the effect on the object alone would fire the
   * panel again on every subsequent state write; the previous status is what
   * distinguishes an arrival from a continuation.
   */
  const previousRunStatusRef = useRef<string | null>(null);

  useEffect(() => {
    const status = simulationRunState?.status ?? null;
    const previous = previousRunStatusRef.current;
    previousRunStatusRef.current = status;

    if (status !== 'complete' || previous === 'complete') {
      return;
    }

    const pending = pendingRunRef.current;
    pendingRunRef.current = null;

    if (!pending) {
      return;
    }

    setSimReport({
      days: pending.days,
      targetDate: simulationRunState?.targetDate ?? currentDate,
      gamesPlayed: simulationRunState?.simulatedGameCount ?? 0,
      signings: pending.signings,
      signingRounds: pending.signingRounds,
      label: getSimulationScopeLabel(pending.target),
    });

    /*
     * Back to the dashboard, except when the caller asked to stay.
     *
     * The inline paths -- play the next game, advance to this date, play this
     * playoff game -- are opened from a game screen or a bracket and pass
     * keepCurrentView precisely so they do not yank you away from the thing you
     * asked about. Honouring the dashboard jump for those would strand a manager
     * on the dashboard mid-bracket, which is worse than the extra click.
     */
    if (!pending.keepCurrentView) {
      setView('dashboard');
    }
  }, [currentDate, setView, simulationRunState]);

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

      /*
        PRICE THE DAY ON THE INTERACTIVE PATH TOO.

        This path advances a game without going through the worker, so before it was added the
        market went stale relative to `currentDate` whenever a game was stepped individually -- the
        ledger sat on an older day while the league moved on.

        SAFE ON THE MAIN THREAD, and this corrects something asserted earlier in this project.
        `playoffMonteCarlo` is not reentrant because it swaps the global `Math.random`, and that was
        the stated reason the price path could not live in a render path. That reasoning was about
        CONCURRENT calls. The function is synchronous and JavaScript is single-threaded, so an event
        handler cannot reenter it -- the swap is set and cleared inside one turn of the event loop.
        The worker was the right home for LONG runs so they do not block the UI; it was never the only
        place the swap is safe.

        Only the final date is priced. `priceBoardForDay` appends exactly one day, so a multi-date
        jump would leave the intervening days unpriced rather than backfilling them. `appendPriceDay`
        replaces an existing entry for a date, so re-stepping the same day overwrites rather than
        duplicating -- which is the property that makes this safe to call repeatedly.
      */
      const floor = marketFloorFor(lastPriceBoard, nextTeams, nextPlayerState, resolveSeasonYear(nextCurrentDate, nextGames));
      const priced = priceAndAppendDay(priceLedger, {
        teams: nextTeams,
        games: nextGames,
        date: nextCurrentDate,
        playerState: nextPlayerState,
        seasonYear: resolveSeasonYear(nextCurrentDate, nextGames),
        seed: leaguePriceSeed(nextTeams),
        previousClose: latestClose(priceLedger ?? []),
        settings,
        regime: 'in_season',
        eventShocks: floor ? crowdEventShocksFor({
          teams: nextTeams,
          games: nextGames,
          date: nextCurrentDate,
          ledger: priceLedger ?? [],
          fair: floor.fair,
          plain: floor.plain,
          plainLeagueMean: floor.leagueMean,
        }) : undefined,
      });
      setPriceLedger(priced.ledger);
      /*
       * Yesterday's board, kept so the crowd on this path reads a fair price from the day BEFORE.
       * Without it the interactive path would price without a crowd at all, and the same day stepped
       * through the worker would price with one -- two markets from one league.
       */
      setLastPriceBoard(priced.board);
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
  }, [teams, games, playerState, currentDate, selectedDate, getProgressFromGames, persistLeagueState, settings, pushNotice, priceLedger, lastPriceBoard]);

  const openGameScreen = useCallback((gameId: string) => {
    const targetGame = games.find((game) => game.gameId === gameId);
    if (!targetGame) {
      return;
    }

    setSelectedGameId(gameId);
    setSelectedDate(targetGame.date);
    setView('game_screen');
  }, [games]);

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

  /*
    THE POWER RANKINGS, built ONCE here and read by three surfaces.

    The dashboard strip, the full LEAGUE board and the newsroom's rankings story all read this one
    object. That is not tidiness -- `buildPowerRankings` runs a Monte Carlo over the remaining season,
    so building it per-surface would run the expensive term three times and, worse, let the three
    surfaces disagree about a club. The Exchange prices from the same fair layer, so the rankings and
    the market cannot drift apart either.

    MEMOISED, and the key is the state that actually changes the answer: rosters, the date the board is
    read at, and the teams. `currentDate` rather than the timeline date, because the fair layer filters
    games by date and a board that moved when the manager merely scrolled back would be answering a
    question nobody asked.

    `leagueHasNoPlayers` short-circuits it: with an empty pool there is no roster to value, and
    `fairLayerFor` would spend a full-season simulation discovering that.
  */
  const powerRankings = useMemo(() => {
    if (!currentDate || teams.length === 0 || playerState.players.length === 0) {
      return null;
    }
    try {
      return buildPowerRankings({
        teams,
        games,
        playerState,
        seasonYear: resolveSeasonYear(currentDate, games),
        date: currentDate,
        settings,
        fairCacheKey: `rankings|${seasonHistory.length}|${currentDate}`,
      });
    } catch (error) {
      /*
        A FAILED BOARD MUST NOT TAKE THE DASHBOARD WITH IT.

        This runs inside a render, and an exception here would blank the whole page rather than one
        panel. The honest degradation is no rankings, which is exactly the state the strip already
        handles by rendering nothing.
      */
      console.error('Failed to build power rankings:', error);
      return null;
    }
  }, [currentDate, games, playerState, seasonHistory.length, settings, teams]);

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

  const shakeUpFreeAgencyFromRouter = useCallback(() => {
    void handleFreeAgencyShakeUp();
  }, [handleFreeAgencyShakeUp]);

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

  const clearHistoricalDataFromRouter = useCallback(() => handleClearHistoricalData(), [handleClearHistoricalData]);

  const generatePlayersFromRouter = useCallback(() => {
    void handleGeneratePlayers();
  }, [handleGeneratePlayers]);

  /*
    These return the underlying promise rather than discarding it with `void`, which is what the
    neighbouring `exportLocalBackupFromRouter` already does. Both handlers are genuinely async, and
    the settings page that receives them declares them `() => Promise<void>` and fires them with
    `void` -- so nothing awaits them either way and no behaviour changes. What changes is that the
    router's own prop types can describe what these actually are instead of narrowing them to
    `() => void` on the way through and erroring at the far end.
  */
  const hardWipePlayersFromRouter = useCallback(() => handleHardWipePlayers(), [handleHardWipePlayers]);

  const exportLocalBackupFromRouter = useCallback(() => exportLocalUniverseBackup(), [exportLocalUniverseBackup]);

  const importLocalBackupFromRouter = useCallback(
    (payload: unknown) => importLocalUniverseBackup(payload),
    [importLocalUniverseBackup],
  );

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
    onSimulateToNextMilestone: simulateToNextMilestone,
    onResetSeason: resetSeasonFromRouter,
    onTerminateUniverse: terminateUniverseFromRouter,
    onSimulateToDate: simulateToDate,
    onProposeTrade: proposeTradeFromRouter,
    onApprovePendingTrade: approvePendingTradeFromRouter,
    onVetoPendingTrade: handleVetoPendingTrade,
    onRefreshTradeBoard: refreshTradeBoard,
    onAssignFreeAgent: assignFreeAgentFromRouter,
    onShakeUpFreeAgency: shakeUpFreeAgencyFromRouter,
    /*
     * The offseason timeline's "Awards" step.

     * It used to run the auto-pick -- choosing the three MVPs for the manager. There is nothing to
     * pick now, so it opens the RESULTS instead. Same step, honest meaning: this is the point in
     * the year where the award markets have settled and the reasoning behind them is worth reading.
     */
    onAutoSelectAwards: reviewSeasonAwards,
    onSimulateRetirements: simulateRetirements,
    onCompleteFreeAgency: completeFreeAgency,
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
    onPreviewGeneratePlayers: handlePreviewNewUniverse,
    onGeneratePlayers: generatePlayersFromRouter,
    universeSeedInput,
    onSetUniverseSeedInput: setUniverseSeedInput,
    onHardWipePlayers: hardWipePlayersFromRouter,
    onExportLocalBackup: exportLocalBackupFromRouter,
    onImportLocalBackup: importLocalBackupFromRouter,
    onDismissPlayerPreview: handleDismissPlayerPreview,
  }), [
    approvePendingTradeFromRouter,
    assignFreeAgentFromRouter,
    reviewSeasonAwards,
    completeFreeAgency,
    autoDraftAllFromRouter,
    autoDraftRoundFromRouter,
    cancelSimulationRun,
    clearHistoricalDataFromRouter,
    clearNotificationsFromRouter,
    completeGameFromRouter,
    draftNextPickFromRouter,
    generateDraftClassFromRouter,
    generatePlayersFromRouter,
    exportLocalBackupFromRouter,
    handleDismissPlayerPreview,
    handlePreviewNewUniverse,
    handleSaveSettings,
    handleVetoPendingTrade,
    hardWipePlayersFromRouter,
    importLocalBackupFromRouter,
    terminateUniverseFromRouter,
    openGameScreen,
    openSimulationCenter,
    openTeamPage,
    proposeTradeFromRouter,
    quickSimSeason,
    refreshTradeBoard,
    resetDraftBoardFromRouter,
    resetSeasonFromRouter,
    simulateRetirements,
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

  // A universe with no players is unplayable and, before NoPlayersGate, had no
  // way back: the schedule self-heals on boot (see the games.length === 0 effect)
  // but the player pool did not, and handleGeneratePlayers had no consumer in
  // the UI. Reachable by refreshing while Terminate Universe is mid-build, which
  // clears the pool before the replacement is generated.
  const leagueHasNoPlayers = !isBootstrapping && playerState.players.length === 0;

  // The folder nav is sticky and has to park directly under the header, which is
  // itself sticky and is three bands tall (score strip, masthead, and whatever
  // else is added to it later). This used to be a hand-written top-[176px], which
  // silently desynchronised the moment the header changed -- removing the team
  // strip left the nav floating with a gap. Measuring it instead means the two
  // cannot drift apart, and it survives a viewport narrower than the score strip's
  // own breakpoint.
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null);
  const [stickyHeaderHeight, setStickyHeaderHeight] = useState(0);

  useEffect(() => {
    const header = stickyHeaderRef.current;
    if (!header) {
      return undefined;
    }

    const measure = () => setStickyHeaderHeight(Math.ceil(header.getBoundingClientRect().height));
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, [leagueHasNoPlayers]);

  if (isBootstrapping || isTerminatingUniverse) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-base)] text-[var(--color-ink)] font-[family-name:var(--font-body)]">
        <div className="text-center space-y-3 px-4">
          <img src={gpbLogo} alt="GPB" className="mx-auto h-24 w-24 object-contain" />
          <p className="t-body text-[var(--color-ink)]">
            {isTerminatingUniverse ? 'Terminating universe...' : 'Loading league data...'}
          </p>
          {isTerminatingUniverse && terminateProgress && (
            <div className="mx-auto max-w-xs space-y-2">
              <p className="t-caption text-[var(--color-ink-dim)]">{terminateProgress.label}</p>
              <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-chrome-lo)]">
                <div
                  className="h-full bg-[var(--color-gold)] transition-all duration-300"
                  style={{ width: `${terminateProgress.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (leagueHasNoPlayers) {
    return (
      <NoPlayersGate
        seed={universeSeedInput}
        teamCount={teams.length}
        isRepairing={isGeneratingPlayers || isTerminatingUniverse}
        onRepair={() => void handleGeneratePlayers()}
        onTerminate={() => void handleTerminateUniverse()}
      />
    );
  }

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[var(--color-base)] pb-20 text-[var(--color-ink)] font-[family-name:var(--font-body)] selection:bg-[var(--color-gold-dim)]">
      <div ref={stickyHeaderRef} className="sticky top-0 z-50">
        <div className="border-b border-[var(--color-chrome-lo)] bg-[var(--color-void)]">
          <PreviousDateScoreStrip
            simulationPerformanceMode={simulationPerformanceMode}
            bannerDate={bannerDate}
            currentTimelineDate={currentTimelineDate}
            gamesForBannerDate={gamesForBannerDate}
            teamLookup={teamLookup}
            onOpenGame={openGameScreen}
          />
        </div>

        <header className="border-b border-[var(--color-chrome-lo)] bg-[var(--color-base-2)]">
          <div className="px-4 sm:px-6 lg:px-8 h-[88px] flex items-center justify-between">
            <button className="flex items-center gap-3" onClick={() => setView('dashboard')}>
              <img src={gpbLogo} alt="GPB home" className="h-[68px] w-[68px] object-contain" />
              <span className="t-h1 uppercase text-[var(--color-ink)]">
                My League
              </span>
            </button>

            <div className="flex items-center gap-3 sm:gap-6">
              <div className="hidden items-center gap-2 text-[var(--color-ink-dim)] md:flex">
                <Activity className="h-4 w-4 text-[var(--color-info)]" />
                <span className="t-caption">{formatHeaderDate(currentTimelineDate)}</span>
              </div>
              <div className="hidden items-center gap-2 text-[var(--color-ink-dim)] md:flex">
                <Clock3 className="h-4 w-4 text-[var(--color-platinum)]" />
                <span className="t-caption">{currentTimelineTimeLabel}</span>
              </div>
              {/*
                * WAGERS, AND THE NAME WAS WRONG.
                *
                * This button said "Parlays" and there are no parlays. It opens the betting slip, whose
                * own header comment says it is "deliberately NOT a parlay" -- parlays were rejected on
                * measured grounds, because multiplying legs against three forecasters whose calibration
                * has been fitted makes the combined bet strictly worse value than the same money flat.
                *
                * The button's own `aria-label` has always said "Betting slip", so it has been
                * contradicting itself in the DOM for as long as it has existed, and a reader who took
                * the visible word at face value would have gone looking for a parlay builder that does
                * not exist.
                *
                * The accessible name is now "Wagers slip" rather than "Betting slip", so both names
                * lead with the same word. A richer accessible name is normally good practice, but two
                * different names for one control is not richness -- a sighted reader and a screen
                * reader were being told two different things about what pressing it does. `tools/
                * checkSlipButtonName` asserts the first word matches, and it caught this.
                *
                * "Wagers" names what the badge actually counts -- money at risk -- and it sits correctly
                * beside "Portfolio", which counts positions. "Betting" would have collided with
                * MacroBet, the bookmaker, which is a different thing in the nav.
                *
                * The position itself still earns its place, for the reason the old comment gave and
                * which is unchanged: it replaced a notification bell and a storage-mode readout, and it
                * carries a count, and the count is money.
              */}
              <button
                type="button"
                onClick={bettingSlip.toggle}
                aria-label="Wagers slip"
                aria-expanded={bettingSlip.isOpen}
                className={`gold-sweep gold-edge relative flex items-center gap-2 border-l-[3px] px-3 py-2 t-caption uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] ${
                  bettingSlip.isOpen
                    ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)] text-[var(--color-gold-hi)]'
                    : 'border-l-transparent text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)]'
                }`}
              >
                <Receipt className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Wagers</span>
                {openBetCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center bg-[var(--color-gold)] px-1 tabular-nums text-[var(--color-ink-invert)]">
                    {openBetCount}
                  </span>
                )}
              </button>
              {/*
                THE HXSE BOOK, beside the parlays and for the same reason.

                Once shares are tradeable, "what am I holding and what is it worth" is not an Exchange
                question -- it is a question you ask while looking at a box score, and answering it
                meant navigating to a market and reading a table. The badge carries the number of open
                positions, which is the same argument the parlays badge makes: the thing that changes
                what you would do next belongs where you can see it without asking.

                It wears the same gold chrome as its neighbour rather than an HXSE colour. Every accent
                in this app belongs to a named outlet or to a bet outcome, and the HXSE's colour on the
                Exchange page is red -- the close line -- which here would read as a loss.
              */}
              <button
                type="button"
                onClick={() => setHxsePortfolioOpen(true)}
                aria-label="HXSE portfolio"
                aria-expanded={hxsePortfolioOpen}
                className={`gold-sweep gold-edge relative flex items-center gap-2 border-l-[3px] px-3 py-2 t-caption uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] ${
                  hxsePortfolioOpen
                    ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)] text-[var(--color-gold-hi)]'
                    : 'border-l-transparent text-[var(--color-ink-dim)] hover:text-[var(--color-gold-hi)]'
                }`}
              >
                <ChartNoAxesColumn className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Portfolio</span>
                {book.portfolio.positions.length > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center bg-[var(--color-gold)] px-1 tabular-nums text-[var(--color-ink-invert)]">
                    {book.portfolio.positions.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsMobileNavOpen(true)}
                aria-label="Open navigation"
                className="inline-flex h-10 w-10 items-center justify-center text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)] lg:hidden"
              >
                <Menu className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
      </div>

      <div className="relative z-10 flex">
        <FolderNav
          view={view}
          onSetView={setView}
          className="sticky"
          // Published as a variable as well as applied inline: the nav's own
          // height calc reads it, so one measurement drives both the offset and
          // the length of the scrollable column.
          style={{
            top: stickyHeaderHeight,
            ['--sticky-header-h' as string]: `${stickyHeaderHeight}px`,
          }}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-6">
          {/*
            THE RENDER-THROW BOUNDARY, and its placement is the whole design.

            Inside <main>, around the routed view and nothing else. The nav rail, the score ticker and
            the header all sit outside it, which is the point: a throw in any single view now costs
            that view rather than the application, and the reader keeps a working sidebar to navigate
            away with. Wrapped one level higher it would catch exactly the same errors and still blank
            the screen.

            `resetKey={view}` is what stops the failure screen following the reader around. A React
            error boundary does NOT retry when its children change -- it holds the fallback until it
            is unmounted or explicitly reset -- so without this, breaking one view would leave every
            view after it dead as well, which is a worse outcome than the blank page it replaces.

            `onGoHome` calls App's own `setView` rather than the router's `onSetView`, because the
            router is inside the boundary and is one of the things that may have thrown.

            What this does not catch: errors in event handlers, timers, and promises. Two defects this
            session were exactly that -- a Preview button calling an undefined prop, a backup button
            awaiting one the router dropped -- and neither this boundary nor any other would have
            reported them. `tools/qaClicks.mjs` finds those, because finding them means clicking them.
          */}
          <ViewBoundary
            resetKey={view}
            viewLabel={view}
            onGoHome={() => setView('dashboard')}
          >
            <AppViewRouter
              view={view}
            teams={teams}
            games={games}
            playerState={playerState}
            currentDate={currentDate}
            selectedDate={selectedDate}
            bettingSlip={bettingSlip}
            setViewFallback={() => setView('betting')}
            selectedTeamId={selectedTeamId}
            seasonComplete={seasonComplete}
          priceLedger={priceLedger}
      rankings={powerRankings}
      book={book}
      pendingClub={hxseClubSelection}
      onPendingClubConsumed={() => setHxseClubSelection(null)}
            offseasonStage={offseasonStage}
            offseasonSeasonYear={offseasonEventSeasonYear}
            offseasonChampionLabel={seasonAwardsSummary?.champion?.teamName ?? seasonHistory.find((entry) => entry.seasonYear === offseasonEventSeasonYear)?.champion?.teamName ?? 'To be crowned'}
            /*
           * "Pending" now means UNREAD rather than UNARCHIVED.
           *
           * Before this it meant "the ballot is open and the season cannot be archived until
           * somebody presses Save" -- which was the exploit: the archive, and therefore the award
           * settlement, waited on a click the bettor controlled. The archive is now written the
           * moment the season ends, so what remains is reading the result, and that is what gates
           * the timeline.
           */
          hasPendingSeasonAwards={Boolean(seasonAwardsSummary) && !seasonAwardsSeen}
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
            newUniversePreview={newUniversePreview}
            onPreviewNewUniverse={handlePreviewNewUniverse}
            isClearingHistoricalData={isClearingHistory}
            isGeneratingPlayers={isGeneratingPlayers}
            isWipingPlayers={isWipingPlayers}
            commissionerNotices={commissionerNotices}
            isSupabaseEnabled={isSupabaseConfigured}
            getStatNumber={getStatNumber}
              getFallbackHits={getFallbackHits}
              {...routerActions}
            />
          </ViewBoundary>
        </main>
      </div>

      <MobileFolderMenu
        isOpen={isMobileNavOpen}
        view={view}
        onSetView={setView}
        onClose={() => setIsMobileNavOpen(false)}
      />

      <TradeInterruptionModal
        prompt={tradeInterruptionPrompt}
        onDismiss={() => setTradeInterruptionPrompt(null)}
        onOpenTradeDesk={() => {
          setTradeInterruptionPrompt(null);
          setView('trades');
        }}
      />

      {/*
        The slip, over whatever screen is showing. Mounted at the shell rather
        than inside Betting so it survives navigation, and opened automatically
        when a price is pressed -- the e-commerce convention, and the reason the
        state had to be lifted in the first place.
      */}
      <BettingSlip
        isOpen={bettingSlip.isOpen}
        onClose={bettingSlip.close}
        onOpenRecord={() => { bettingSlip.close(); setView('betting_record'); }}
        entry={bettingSlip.slip}
        stake={bettingSlip.stake}
        onStake={bettingSlip.setStake}
        onConfirm={() => bettingSlip.confirm(currentDate || currentTimelineDate)}
        onClear={bettingSlip.clear}
        notice={bettingSlip.notice}
        balance={bettingWallet.balance}
        openBets={openBetList}
        settledBets={bettingWallet.bets.filter((bet) => bet.status !== 'open')}
        summary={bettingSlip.summary}
        games={games}
        teams={teams}
      />

      {/*
        THE HXSE BOOK DRAWER. Placed beside the betting slip in the tree because they are
        siblings in every sense that matters: same chrome, same gesture, same Escape, and the
        reader learns one behaviour and gets both.

        `onOpenClub` sends the reader to the Exchange with that club already selected, which is
        the whole point of making the rows buttons -- the drawer answers "what am I holding" and
        its next useful act is "go trade it".
      */}
      <HxsePortfolioDrawer
        isOpen={hxsePortfolioOpen}
        onClose={() => setHxsePortfolioOpen(false)}
        onOpenClub={(teamId) => {
          setView('exchange');
          setHxseClubSelection(teamId);
        }}
        teams={teams}
        closes={latestLedgerClose}
        portfolio={book.portfolio}
        markedOn={latestLedgerDate}
      />

      {/* Team Logo Grid — 't' key to open */}
      <TeamLogoGrid
        teams={teams}
        isOpen={isLogoGridOpen}
        onClose={() => setIsLogoGridOpen(false)}
        onSelectTeam={(teamId) => {
          setView('teams');
          setSelectedTeamId(teamId);
        }}
      />

      {/*
        THE SEASON'S AWARDS, AS A RESULT TO READ.

        This replaced a ballot that asked the manager to pick three MVPs. Because pressing
        Save is what wrote the season archive, and the archive is what settles award bets,
        the click WAS the outcome -- so betting an award meant betting on a decision the
        bettor was about to make.

        The winners are now the top of each ranked candidate list, and the archive is
        written the moment the season ends, so there is nothing here to choose. The screen
        exists to show the reasoning that decided it, which is the part a manager who backed
        somebody else needs.
      */}
      <SeasonAwardsSummary
        selection={seasonAwardsSummary}
        seen={seasonAwardsSeen}
        resolveAwardCandidateTeam={resolveAwardCandidateTeam}
        onDismiss={dismissSeasonAwardsSummary}
      />

      {/*
        SimulationFloatingPanel is deliberately NOT mounted.

        It was the last unmigrated surface in the shell and the only component still written
        against the pre-token stylesheet: `font-mono`, `font-headline` (a family that was never
        loaded and silently fell back to Teko), `rounded-[1.75rem]`, a hardcoded
        `bg-[linear-gradient(135deg,#121212,#1b1b1b,#101010)]` and a `rounded-full` progress bar.
        Every one of those is a §12 acceptance-gate violation, and it sat on top of the bracket
        during exactly the runs a manager is watching -- which is why it was noticed.

        The modern replacement is `SimulationHub`, which carries the same three facts (label,
        active date, games completed) on the tokens, and is reachable from the COMMISSIONER rail
        and from the completion receipt. Removing the mount rather than deleting the file keeps
        this reversible; the component is now unreferenced and can be dropped when nothing wants it
        back.

        `isSimulating`, `simulationProgress` and `cancelSimulationRun` all still have callers -- the
        hub and the receipt both consume them -- so nothing above this goes dead with it.
      */}

      {/*
        The completion receipt. Below the slip's z-index (70/71) and its own at
        69, so a bet being reviewed while a run finishes cannot have the run
        panel stacked over the confirm button.
      */}
      <SimCompletePanel report={simReport} onDismiss={() => setSimReport(null)} />

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
