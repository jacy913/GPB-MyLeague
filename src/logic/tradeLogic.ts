import {
  BATTING_ROSTER_SLOTS,
  BULLPEN_ROSTER_SLOTS,
  CoreRosterSlotCode,
  LeaguePlayerState,
  PendingTradeCategory,
  PendingTradeProposal,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerPosition,
  RosterSlotCode,
  STARTING_PITCHER_SLOTS,
  Team,
  TeamRosterSlot,
} from '../types';
import { isRegularSeasonGame } from './playoffs';
import { repairRosterSlotsForTeams } from './rosterManagement';

type TradeCandidate = PendingTradeProposal & {
  score: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const getGamesPlayed = (team: Team): number => team.wins + team.losses;

const getWinPct = (team: Team): number => {
  const gamesPlayed = getGamesPlayed(team);
  return gamesPlayed > 0 ? team.wins / gamesPlayed : 0;
};

const getTeamOutlookScore = (team: Team): number =>
  team.previousBaselineWins + team.rating * 0.45 + (team.runsScored - team.runsAllowed) * 0.02;

const getLatestSeasonYear = (rosterSlots: TeamRosterSlot[]): number =>
  rosterSlots.length > 0 ? Math.max(...rosterSlots.map((slot) => slot.seasonYear)) : new Date().getUTCFullYear();

const getRegularSeasonProgress = (games: { date: string }[], currentDate: string): number => {
  const regularDates = Array.from(new Set(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));
  if (regularDates.length <= 1 || !currentDate) {
    return 0;
  }

  const boundedDate = regularDates.includes(currentDate)
    ? currentDate
    : regularDates.find((date) => date >= currentDate) ?? regularDates[regularDates.length - 1];
  const currentIndex = regularDates.indexOf(boundedDate);
  return clamp(currentIndex / Math.max(regularDates.length - 1, 1), 0, 1);
};

const getRegularSeasonDateIndex = (games: { date: string }[], currentDate: string): number => {
  const regularDates = Array.from(new Set(games.map((game) => game.date))).sort((left, right) => left.localeCompare(right));
  if (regularDates.length === 0 || !currentDate) {
    return -1;
  }

  const boundedDate = regularDates.includes(currentDate)
    ? currentDate
    : regularDates.find((date) => date >= currentDate) ?? regularDates[regularDates.length - 1];
  return regularDates.indexOf(boundedDate);
};

const createLatestBattingRatingsMap = (ratings: PlayerBattingRatings[]): Map<string, PlayerBattingRatings> => {
  const next = new Map<string, PlayerBattingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) {
        next.set(rating.playerId, rating);
      }
    });
  return next;
};

const createLatestPitchingRatingsMap = (ratings: PlayerPitchingRatings[]): Map<string, PlayerPitchingRatings> => {
  const next = new Map<string, PlayerPitchingRatings>();
  [...ratings]
    .sort((left, right) => right.seasonYear - left.seasonYear)
    .forEach((rating) => {
      if (!next.has(rating.playerId)) {
        next.set(rating.playerId, rating);
      }
    });
  return next;
};

const getPlayerOverall = (
  player: Player,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number =>
  battingRatingsByPlayerId.get(player.playerId)?.overall ??
  pitchingRatingsByPlayerId.get(player.playerId)?.overall ??
  0;

const getPlayerPotential = (
  player: Player,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): number =>
  Math.max(
    player.potential,
    battingRatingsByPlayerId.get(player.playerId)?.potentialOverall ?? 0,
    pitchingRatingsByPlayerId.get(player.playerId)?.potentialOverall ?? 0,
  );

const getRosterPlayerForSlot = (
  teamId: string,
  slotCode: RosterSlotCode,
  activeRosterSlots: TeamRosterSlot[],
  playersById: Map<string, Player>,
): Player | null => {
  const slot = activeRosterSlots.find((entry) => entry.teamId === teamId && entry.slotCode === slotCode) ?? null;
  return slot ? playersById.get(slot.playerId) ?? null : null;
};

const getNeedSlotsForTeam = (
  team: Team,
  activeRosterSlots: TeamRosterSlot[],
  playersById: Map<string, Player>,
  battingRatingsByPlayerId: Map<string, PlayerBattingRatings>,
  pitchingRatingsByPlayerId: Map<string, PlayerPitchingRatings>,
): Array<{ slotCode: CoreRosterSlotCode; player: Player | null; overall: number }> => {
  const slots: CoreRosterSlotCode[] = [...BATTING_ROSTER_SLOTS, ...STARTING_PITCHER_SLOTS, ...BULLPEN_ROSTER_SLOTS];

  return slots
    .map((slotCode) => {
      const player = getRosterPlayerForSlot(team.id, slotCode, activeRosterSlots, playersById);
      const overall = player ? getPlayerOverall(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId) : 0;
      return { slotCode, player, overall };
    })
    .filter((entry) => entry.overall < 75);
};

const getTargetPositionForSlot = (slotCode: CoreRosterSlotCode): PlayerPosition => {
  if (slotCode.startsWith('SP')) {
    return 'SP';
  }
  if (slotCode === 'CL') {
    return 'CL';
  }
  if (slotCode.startsWith('RP')) {
    return 'RP';
  }
  return slotCode;
};

const isTradeChipProspect = (
  player: Player,
  overall: number,
  potential: number,
): boolean =>
  player.status === 'active' &&
  player.age >= 18 &&
  player.age <= 22 &&
  potential >= 80 &&
  overall <= Math.max(82, potential - 3);

const getTradeWindowChance = (progress: number): number => {
  if (progress < 0.12) return 0.05;
  if (progress < 0.28) return 0.1;
  if (progress < 0.48) return 0.16;
  if (progress < 0.66) return 0.24;
  if (progress <= 0.82) return 0.4;
  return 0;
};

const getTradeDayChance = (progress: number): number => {
  if (progress < 0.12) return 0.16;
  if (progress < 0.28) return 0.24;
  if (progress < 0.48) return 0.31;
  if (progress < 0.66) return 0.42;
  if (progress <= 0.82) return 0.72;
  return 0.08;
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash;
};

const getRoll = (value: string): number => (hashString(value) % 1000) / 1000;

const getCategory = (incomingOverall: number, progress: number, assetAge: number): PendingTradeCategory => {
  if (incomingOverall > 85) return 'blockbuster';
  if (progress >= 0.62) return 'deadline_push';
  if (assetAge <= 22) return 'prospect_swap';
  return 'contender_push';
};

const getSummary = (category: PendingTradeCategory, buyerTeam: Team, sellerTeam: Team, incomingPlayer: Player): string => {
  switch (category) {
    case 'blockbuster':
      return `${buyerTeam.city} want a major swing and ${sellerTeam.city} may finally listen on ${incomingPlayer.lastName}.`;
    case 'deadline_push':
      return `${buyerTeam.city} are pressing for October and ${sellerTeam.city} have a movable veteran fit.`;
    case 'prospect_swap':
      return `${buyerTeam.city} are dangling upside while ${sellerTeam.city} pivot toward the future.`;
    default:
      return `${buyerTeam.city} see a direct upgrade and ${sellerTeam.city} can cash out for younger talent.`;
  }
};

const getDailyTradeCap = (progress: number, dayVolumeRoll: number, isOpeningDayMarket: boolean): number => {
  if (isOpeningDayMarket) {
    return dayVolumeRoll > 0.8 ? 3 : dayVolumeRoll > 0.35 ? 2 : 1;
  }
  if (progress < 0.12) {
    return dayVolumeRoll > 0.72 ? 2 : 1;
  }
  if (progress < 0.28) {
    return dayVolumeRoll > 0.84 ? 3 : dayVolumeRoll > 0.45 ? 2 : 1;
  }
  if (progress < 0.48) {
    return dayVolumeRoll > 0.82 ? 4 : dayVolumeRoll > 0.48 ? 3 : dayVolumeRoll > 0.16 ? 2 : 1;
  }
  if (progress < 0.66) {
    return dayVolumeRoll > 0.82 ? 6 : dayVolumeRoll > 0.5 ? 4 : 2;
  }
  if (progress <= 0.82) {
    return 4 + Math.floor(dayVolumeRoll * 9);
  }
  return dayVolumeRoll > 0.9 ? 2 : 1;
};

const getMarketTeams = (
  teams: Team[],
  progress: number,
  sortedTeamsByOutlook: Team[],
): { contenders: Team[]; sellers: Team[] } => {
  const bucketSize = clamp(progress < 0.18 ? 6 : progress < 0.5 ? 8 : 10, 6, Math.max(6, Math.floor(teams.length / 2)));
  const strictContenders = teams.filter((team) => getWinPct(team) > 0.55);
  const strictSellers = teams.filter((team) => getWinPct(team) < 0.45);

  return {
    contenders: strictContenders.length >= 4 ? strictContenders : sortedTeamsByOutlook.slice(0, bucketSize),
    sellers: strictSellers.length >= 4 ? strictSellers : [...sortedTeamsByOutlook].reverse().slice(0, bucketSize),
  };
};

const playerFitsTargetPosition = (player: Player, targetPosition: PlayerPosition): boolean => {
  if (targetPosition === 'DH') {
    return player.playerType === 'batter';
  }

  if (targetPosition === 'SP') {
    return player.primaryPosition === 'SP' || player.secondaryPosition === 'SP';
  }

  if (targetPosition === 'RP') {
    return player.primaryPosition === 'RP' || player.primaryPosition === 'CL' || player.secondaryPosition === 'RP';
  }

  if (targetPosition === 'CL') {
    return player.primaryPosition === 'CL' || player.primaryPosition === 'RP' || player.secondaryPosition === 'CL';
  }

  return player.primaryPosition === targetPosition || player.secondaryPosition === targetPosition;
};

const canTeamsKeepBattingCoverageAfterTrade = (
  playerState: LeaguePlayerState,
  latestSeasonYear: number,
  buyerTeamId: string,
  sellerTeamId: string,
  incomingPlayerId: string,
  outgoingPlayerId: string,
): boolean => {
  const tradedPlayerIds = new Set([incomingPlayerId, outgoingPlayerId]);
  const teamsInvolved = [buyerTeamId, sellerTeamId];
  const swapPlayers = playerState.players.map((player) => {
    if (player.playerId === incomingPlayerId) {
      return { ...player, teamId: buyerTeamId, status: 'active' as const };
    }
    if (player.playerId === outgoingPlayerId) {
      return { ...player, teamId: sellerTeamId, status: 'active' as const };
    }
    return player;
  });
  const swapRosterSlots = playerState.rosterSlots.map((slot) => {
    if (slot.seasonYear !== latestSeasonYear) {
      return slot;
    }
    if (slot.playerId === incomingPlayerId) {
      return { ...slot, playerId: outgoingPlayerId };
    }
    if (slot.playerId === outgoingPlayerId) {
      return { ...slot, playerId: incomingPlayerId };
    }
    return slot;
  });
  const shouldCheckBattingCoverage = playerState.players.some(
    (player) => tradedPlayerIds.has(player.playerId) && player.playerType === 'batter',
  );

  if (!shouldCheckBattingCoverage) {
    return true;
  }

  const repairedRoster = repairRosterSlotsForTeams(
    {
      ...playerState,
      players: swapPlayers,
      rosterSlots: swapRosterSlots,
    },
    teamsInvolved,
    latestSeasonYear,
  );

  return teamsInvolved.every(
    (teamId) => (repairedRoster.battingCoverageByTeamId[teamId] ?? 0) >= BATTING_ROSTER_SLOTS.length,
  );
};

export const generatePendingTradeProposals = (
  teams: Team[],
  playerState: LeaguePlayerState,
  games: { date: string; status: string }[],
  currentDate: string,
): PendingTradeProposal[] => {
  if (!currentDate || teams.length === 0 || playerState.players.length === 0) {
    return [];
  }

  const regularSeasonGames = games.filter((game): game is { date: string; status: string } => game.status !== undefined);
  const completedRegularSeasonGames = regularSeasonGames.filter((game) => game.status === 'completed').length;
  const currentRegularSeasonDateIndex = getRegularSeasonDateIndex(
    regularSeasonGames.map((game) => ({ date: game.date })),
    currentDate,
  );
  const progress = getRegularSeasonProgress(
    regularSeasonGames.filter((game) => true).map((game) => ({ date: game.date })),
    currentDate,
  );
  const isOpeningDayMarket =
    completedRegularSeasonGames === 0 &&
    teams.every((team) => getGamesPlayed(team) === 0) &&
    currentRegularSeasonDateIndex === 0;
  const sortedTeamsByOutlook = [...teams].sort(
    (left, right) =>
      getTeamOutlookScore(right) - getTeamOutlookScore(left) ||
      right.previousBaselineWins - left.previousBaselineWins ||
      right.rating - left.rating,
  );
  const openingDayBucketSize = clamp(Math.floor(teams.length * 0.22), 4, 6);
  const tradeWindowChance = isOpeningDayMarket ? 0.18 : getTradeWindowChance(progress);
  if (tradeWindowChance <= 0) {
    return [];
  }
  const dayTradeChance = isOpeningDayMarket ? 0.32 : getTradeDayChance(progress);
  const dayTradeRoll = getRoll(`trade-day:${currentDate}`);
  if (dayTradeRoll > dayTradeChance) {
    return [];
  }
  const dayVolumeRoll = getRoll(`trade-volume:${currentDate}`);

  const latestSeasonYear = getLatestSeasonYear(playerState.rosterSlots);
  const activeRosterSlots = playerState.rosterSlots.filter((slot) => slot.seasonYear === latestSeasonYear);
  const playersById = new Map(playerState.players.map((player) => [player.playerId, player]));
  const battingRatingsByPlayerId = createLatestBattingRatingsMap(playerState.battingRatings);
  const pitchingRatingsByPlayerId = createLatestPitchingRatingsMap(playerState.pitchingRatings);

  const fallbackMarket = getMarketTeams(teams, progress, sortedTeamsByOutlook);
  const contenders = isOpeningDayMarket
    ? sortedTeamsByOutlook.slice(0, openingDayBucketSize)
    : fallbackMarket.contenders;
  const sellers = isOpeningDayMarket
    ? [...sortedTeamsByOutlook].reverse().slice(0, openingDayBucketSize)
    : fallbackMarket.sellers;
  const maxProposals = getDailyTradeCap(progress, dayVolumeRoll, isOpeningDayMarket);
  const candidates: TradeCandidate[] = [];

  contenders.forEach((buyerTeam, buyerIndex) => {
    const weakSlots = getNeedSlotsForTeam(
      buyerTeam,
      activeRosterSlots,
      playersById,
      battingRatingsByPlayerId,
      pitchingRatingsByPlayerId,
    );
    if (weakSlots.length === 0) {
      return;
    }

    const buyerRoster = playerState.players.filter((player) => player.teamId === buyerTeam.id && player.status === 'active');
    const buyerProspects = buyerRoster
      .map((player) => {
        const overall = getPlayerOverall(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
        const potential = getPlayerPotential(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId);
        return { player, overall, potential };
      })
      .filter((entry) =>
        isOpeningDayMarket
          ? entry.player.status === 'active' &&
            entry.player.age >= 18 &&
            entry.player.age <= 24 &&
            entry.potential >= 78 &&
            entry.overall <= Math.max(83, entry.potential - 2)
          : isTradeChipProspect(entry.player, entry.overall, entry.potential) ||
            (
              entry.player.status === 'active' &&
              entry.player.age <= 25 &&
              entry.potential >= 76 &&
              entry.overall <= Math.max(84, entry.potential)
            ),
      )
      .sort(
        (left, right) =>
          right.potential - left.potential ||
          left.overall - right.overall ||
          left.player.age - right.player.age,
      );

    if (buyerProspects.length === 0) {
      return;
    }

    sellers.forEach((sellerTeam, sellerIndex) => {
      if (sellerTeam.id === buyerTeam.id) {
        return;
      }

      weakSlots.forEach((need, needIndex) => {
        const targetPosition = getTargetPositionForSlot(need.slotCode);
        const sellerRoster = playerState.players
          .filter((player) => player.teamId === sellerTeam.id && player.status === 'active')
          .map((player) => ({
            player,
            overall: getPlayerOverall(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
            potential: getPlayerPotential(player, battingRatingsByPlayerId, pitchingRatingsByPlayerId),
          }))
          .filter((entry) => playerFitsTargetPosition(entry.player, targetPosition));

        const sellerTargets = sellerRoster
          .filter((entry) => {
            const minOverall = isOpeningDayMarket ? 77 : progress < 0.22 ? 76 : 78;
            const minAge = isOpeningDayMarket ? 26 : progress < 0.22 ? 25 : 27;
            const maxAge = isOpeningDayMarket ? 34 : 34;
            if (entry.overall < minOverall || entry.player.age < minAge || entry.player.age > maxAge) {
              return false;
            }
            if (!isOpeningDayMarket && entry.overall > 85) {
              return getWinPct(sellerTeam) < 0.42 && progress >= 0.58;
            }
            return true;
          })
          .sort((left, right) => right.overall - left.overall || right.player.age - left.player.age);

        const incomingOptions = isOpeningDayMarket ? sellerTargets.slice(0, 2) : sellerTargets.slice(0, 1);
        const outgoingOptions = isOpeningDayMarket ? buyerProspects.slice(0, 3) : buyerProspects.slice(0, 1);
        if (incomingOptions.length === 0 || outgoingOptions.length === 0) {
          return;
        }

        incomingOptions.forEach((incoming, incomingIndex) => {
          const outgoing = isOpeningDayMarket
            ? outgoingOptions[(buyerIndex + sellerIndex + needIndex + incomingIndex) % outgoingOptions.length]
            : outgoingOptions[0];
          if (!outgoing) {
            return;
          }

          const upgrade = incoming.overall - need.overall;
          const requiredUpgrade = isOpeningDayMarket ? 5 : 6;
          if (upgrade < requiredUpgrade && incoming.overall <= 85) {
            return;
          }

          if (
            !canTeamsKeepBattingCoverageAfterTrade(
              playerState,
              latestSeasonYear,
              buyerTeam.id,
              sellerTeam.id,
              incoming.player.playerId,
              outgoing.player.playerId,
            )
          ) {
            return;
          }

          const buyerInterest = clamp(
            Math.round(
              52 +
              Math.max(0, upgrade) * 2.2 +
              (progress * 20) +
              (isOpeningDayMarket
                ? (getTeamOutlookScore(buyerTeam) - 82) * 0.7
                : (getWinPct(buyerTeam) - 0.55) * 60),
            ),
            50,
            99,
          );
          const sellerInterest = clamp(
            Math.round(
              50 +
              Math.max(0, outgoing.potential - incoming.overall) * 1.35 +
              Math.max(0, incoming.player.age - 28) * 2.8 +
              (isOpeningDayMarket ? 3 : 0),
            ),
            50,
            99,
          );
          const synergy = clamp(Math.round((buyerInterest + sellerInterest) / 2), 50, 100);
          const roll = getRoll(`${currentDate}:${buyerTeam.id}:${sellerTeam.id}:${need.slotCode}:${incoming.player.playerId}`);
          const minimumSynergy = isOpeningDayMarket ? 60 : 58;
          if (roll > tradeWindowChance || synergy < minimumSynergy) {
            return;
          }

          const category = getCategory(incoming.overall, progress, outgoing.player.age);
          const summary = getSummary(category, buyerTeam, sellerTeam, incoming.player);
          const candidate: TradeCandidate = {
            proposalId: `trade:${currentDate}:${buyerTeam.id}:${sellerTeam.id}:${need.slotCode}:${incoming.player.playerId}:${outgoing.player.playerId}`,
            createdDate: currentDate,
            fromTeamId: sellerTeam.id,
            toTeamId: buyerTeam.id,
            fromPlayerId: incoming.player.playerId,
            toPlayerId: outgoing.player.playerId,
            fromTeamInterest: sellerInterest,
            toTeamInterest: buyerInterest,
            synergy,
            category,
            needSlot: need.slotCode,
            summary,
            fromTeamReason: isOpeningDayMarket
              ? `${sellerTeam.city} open the season willing to flip veteran talent for a younger upside return.`
              : `${sellerTeam.city} are below .450 and would rather turn veteran value into a younger upside piece.`,
            toTeamReason: isOpeningDayMarket
              ? `${buyerTeam.city} entered the year targeting a stronger ${targetPosition} solution and can deal from prospect depth.`
              : `${buyerTeam.city} need a stronger ${targetPosition} answer right now and see a clear upgrade for the stretch run.`,
            isBlockbuster: incoming.overall > 85,
            score: synergy + upgrade + (incoming.overall > 85 ? 18 : 0),
          };

          candidates.push(candidate);
        });
      });
    });
  });

  const seenTeams = new Set<string>();
  const seenPlayers = new Set<string>();

  return candidates
    .sort((left, right) => right.score - left.score || right.synergy - left.synergy)
    .filter((candidate) => {
      const pairKey = `${candidate.fromTeamId}:${candidate.toTeamId}`;
      if (seenTeams.has(pairKey) || seenPlayers.has(candidate.fromPlayerId) || seenPlayers.has(candidate.toPlayerId)) {
        return false;
      }
      seenTeams.add(pairKey);
      seenPlayers.add(candidate.fromPlayerId);
      seenPlayers.add(candidate.toPlayerId);
      return true;
    })
    .slice(0, maxProposals)
    .map(({ score: _score, ...proposal }) => proposal);
};
