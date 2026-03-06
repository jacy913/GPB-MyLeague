import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { formatHeaderDate } from '../components/SeasonCalendarStrip';
import { Game, LeaguePlayerState, PendingTradeProposal, PlayerTransaction, Team } from '../types';

export interface BroadcastFlairItem {
  gameId: string;
  summary: string;
  targetGameId: string | null;
}

type PregameRecordSnapshot = {
  awayWins: number;
  awayLosses: number;
  homeWins: number;
  homeLosses: number;
};

const TRANSACTION_BROADCAST_PRIORITY: Record<PlayerTransaction['eventType'], number> = {
  traded: 0,
  signed: 1,
  released: 2,
  promoted: 3,
  demoted: 4,
  drafted: 5,
  retired: 6,
};

interface UseBroadcastFlairArgs {
  games: Game[];
  teams: Team[];
  playerState: LeaguePlayerState;
  pendingTrades: PendingTradeProposal[];
  currentTimelineDate: string;
  allScheduleDates: string[];
  simulationPerformanceMode: boolean;
  teamLookup: Map<string, Team>;
  pregameRecordByGameId: Map<string, PregameRecordSnapshot>;
  resolveSeasonYear: (currentDate: string | null | undefined, seasonGames?: Game[]) => number;
}

interface UseBroadcastFlairResult {
  flairLabel: string;
  flairDateLabel: string;
  activeFlairItem: BroadcastFlairItem | null;
  flairIndex: number;
  isFlairVisible: boolean;
  shouldMarqueeFlair: boolean;
  renderBroadcastText: (summary: string) => React.ReactNode;
}

export const useBroadcastFlair = ({
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
}: UseBroadcastFlairArgs): UseBroadcastFlairResult => {
  const playersById = useMemo(
    () => new Map<string, LeaguePlayerState['players'][number]>(playerState.players.map((player) => [player.playerId, player] as const)),
    [playerState.players],
  );
  const battingRatingsByPlayerId = useMemo(
    () => new Map(playerState.battingRatings.map((rating) => [rating.playerId, rating])),
    [playerState.battingRatings],
  );
  const pitchingRatingsByPlayerId = useMemo(
    () => new Map(playerState.pitchingRatings.map((rating) => [rating.playerId, rating])),
    [playerState.pitchingRatings],
  );

  const getStatNumber = (game: Game, key: string): number => {
    const value = game.stats[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };

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

  const buildBroadcastSummary = useCallback((game: Game) => {
    const awayTeam = teamLookup.get(game.awayTeam);
    const homeTeam = teamLookup.get(game.homeTeam);
    const awayHitsRaw = getStatNumber(game, 'awayHits');
    const homeHitsRaw = getStatNumber(game, 'homeHits');
    const awayHits = awayHitsRaw > 0 ? awayHitsRaw : getFallbackHits(game, 'away');
    const homeHits = homeHitsRaw > 0 ? homeHitsRaw : getFallbackHits(game, 'home');
    const awayWon = game.score.away > game.score.home;
    const winnerTeam = awayWon ? awayTeam : homeTeam;
    const loserTeam = awayWon ? homeTeam : awayTeam;
    const winnerName = winnerTeam?.name ?? (awayWon ? game.awayTeam.toUpperCase() : game.homeTeam.toUpperCase());
    const winnerCity = winnerTeam?.city ?? (awayWon ? game.awayTeam.toUpperCase() : game.homeTeam.toUpperCase());
    const loserName = loserTeam?.name ?? (awayWon ? game.homeTeam.toUpperCase() : game.awayTeam.toUpperCase());
    const loserCity = loserTeam?.city ?? (awayWon ? game.homeTeam.toUpperCase() : game.awayTeam.toUpperCase());
    const winnerRuns = awayWon ? game.score.away : game.score.home;
    const loserRuns = awayWon ? game.score.home : game.score.away;
    const loserHits = awayWon ? homeHits : awayHits;
    const margin = Math.abs(game.score.away - game.score.home);
    const totalRuns = game.score.away + game.score.home;
    const totalHits = awayHits + homeHits;
    const winnerLeague = winnerTeam?.league ?? null;
    const loserLeague = loserTeam?.league ?? null;
    const homeVenue = homeTeam?.city ?? game.homeTeam.toUpperCase();
    const styleSeed = hashKey(`${game.gameId}:broadcast`) % 3;

    const winnerPrimary = styleSeed === 0 ? winnerName : winnerCity;
    const loserPrimary = styleSeed === 1 ? loserCity : loserName;

    if (loserRuns === 0 && loserHits <= 1) {
      return `${winnerPrimary} put ${loserPrimary} in total silence with a ${winnerRuns}-${loserRuns} masterpiece in ${homeVenue}.`;
    }

    if (loserRuns === 0) {
      return `${winnerPrimary} deliver a baseball masterclass, blanking ${loserPrimary} ${winnerRuns}-${loserRuns} in ${homeVenue}.`;
    }

    if (totalRuns <= 2) {
      return `${winnerPrimary} outlast ${loserPrimary} ${winnerRuns}-${loserRuns} in a pure pitching duel at ${homeVenue}.`;
    }

    if (margin >= 10) {
      return `${winnerPrimary} turn ${homeVenue} into a demolition derby, crushing ${loserPrimary} ${winnerRuns}-${loserRuns}.`;
    }

    if (winnerRuns >= 15) {
      return `${winnerPrimary} light up the scoreboard for ${winnerRuns} runs, leaving ${loserPrimary} chasing shadows in ${homeVenue}.`;
    }

    if (winnerRuns >= 8 && loserRuns >= 8) {
      return `${winnerPrimary} survive a full barnburner, beating ${loserPrimary} ${winnerRuns}-${loserRuns} after an all-night slugfest.`;
    }

    if (totalHits >= 25) {
      return `${winnerPrimary} win the track meet ${winnerRuns}-${loserRuns} as the bats stay loud all night against ${loserPrimary}.`;
    }

    if (margin === 1) {
      return `${winnerPrimary} sneak past ${loserPrimary} ${winnerRuns}-${loserRuns} in a one-run finish at ${homeVenue}.`;
    }

    if (winnerLeague && loserLeague && winnerLeague !== loserLeague) {
      return `${winnerPrimary} claim interleague bragging rights with a ${winnerRuns}-${loserRuns} result over ${loserPrimary}.`;
    }

    if (game.playoff) {
      return `${winnerPrimary} take a playoff step forward, handling ${loserPrimary} ${winnerRuns}-${loserRuns} in the ${game.playoff.seriesLabel}.`;
    }

    if (margin >= 5) {
      return `${winnerPrimary} make a statement in ${homeVenue}, taking down ${loserPrimary} ${winnerRuns}-${loserRuns}.`;
    }

    return `${winnerPrimary} defeat ${loserPrimary} ${winnerRuns}-${loserRuns} in ${homeVenue}.`;
  }, [getFallbackHits, teamLookup, hashKey]);

  const buildBroadcastTransactionSummary = useCallback((transaction: PlayerTransaction) => {
    const player = playersById.get(transaction.playerId);
    const team = transaction.toTeamId ? teamLookup.get(transaction.toTeamId) ?? null : null;
    const fromTeam = transaction.fromTeamId ? teamLookup.get(transaction.fromTeamId) ?? null : null;
    const playerName = player ? `${player.firstName} ${player.lastName}` : 'Unknown Player';
    const overall = player
      ? battingRatingsByPlayerId.get(player.playerId)?.overall ?? pitchingRatingsByPlayerId.get(player.playerId)?.overall ?? 0
      : 0;

    if (transaction.eventType === 'signed') {
      const descriptor = player?.primaryPosition ? `${player.primaryPosition} ` : '';
      return `SIGNING | ${team?.city ?? 'A contender'} add ${playerName}${overall > 0 ? ` (${overall} OVR)` : ''}${descriptor ? `, a ${descriptor}piece,` : ''} as roster upgrades continue.`;
    }

    if (transaction.eventType === 'released') {
      return `WAIVER WIRE | ${playerName} departs ${fromTeam?.city ?? 'his previous club'} and heads to free agency.`;
    }

    if (transaction.eventType === 'traded') {
      if (overall >= 86) {
        return `BLOCKBUSTER | ${team?.city ?? 'A contender'} land ${playerName}${overall > 0 ? ` (${overall} OVR)` : ''} in a league-shifting trade.`;
      }
      return `TRADE | ${playerName} moves from ${fromTeam?.city ?? 'one club'} to ${team?.city ?? 'another club'}.`;
    }

    if (transaction.eventType === 'drafted') {
      return `DRAFT | ${playerName} joins ${team?.city ?? 'a new club'} as front offices keep building for the future.`;
    }

    if (transaction.eventType === 'promoted') {
      return `ROSTER MOVE | ${team?.city ?? 'A club'} promote ${playerName} to the active roster.`;
    }

    if (transaction.eventType === 'demoted') {
      return `ROSTER MOVE | ${team?.city ?? 'A club'} option ${playerName} as depth charts shuffle.`;
    }

    if (transaction.eventType === 'retired') {
      return `RETIREMENT | ${playerName} calls time on his career.`;
    }

    return `${playerName} is back in the news as league movement continues.`;
  }, [battingRatingsByPlayerId, pitchingRatingsByPlayerId, playersById, teamLookup]);

  const buildBroadcastMatchupSummary = useCallback((game: Game) => {
    const awayTeam = teamLookup.get(game.awayTeam) ?? null;
    const homeTeam = teamLookup.get(game.homeTeam) ?? null;
    const awayLabel = awayTeam ? `${awayTeam.city} ${awayTeam.name}` : game.awayTeam.toUpperCase();
    const homeLabel = homeTeam ? `${homeTeam.city} ${homeTeam.name}` : game.homeTeam.toUpperCase();
    const pregame = pregameRecordByGameId.get(game.gameId);
    const awayRecord = pregame
      ? `${pregame.awayWins}-${pregame.awayLosses}`
      : awayTeam
        ? `${awayTeam.wins}-${awayTeam.losses}`
        : '0-0';
    const homeRecord = pregame
      ? `${pregame.homeWins}-${pregame.homeLosses}`
      : homeTeam
        ? `${homeTeam.wins}-${homeTeam.losses}`
        : '0-0';
    const matchupDate = formatHeaderDate(game.date);
    const sameDivision = Boolean(
      awayTeam &&
      homeTeam &&
      awayTeam.league === homeTeam.league &&
      awayTeam.division === homeTeam.division,
    );
    const combinedWins = (pregame?.awayWins ?? awayTeam?.wins ?? 0) + (pregame?.homeWins ?? homeTeam?.wins ?? 0);

    if (game.playoff) {
      const gameLabel = game.playoff.gameNumber > 0 ? ` Game ${game.playoff.gameNumber}` : '';
      return `UP NEXT | ${awayLabel} at ${homeLabel} in ${game.playoff.seriesLabel}${gameLabel} on ${matchupDate}.`;
    }

    if (sameDivision) {
      return `UP NEXT | Division rivals ${awayLabel} (${awayRecord}) and ${homeLabel} (${homeRecord}) meet on ${matchupDate}.`;
    }

    if (combinedWins >= 160) {
      return `UP NEXT | Heavyweight showdown: ${awayLabel} (${awayRecord}) vs ${homeLabel} (${homeRecord}) on ${matchupDate}.`;
    }

    return `UP NEXT | ${awayLabel} (${awayRecord}) travel to ${homeLabel} (${homeRecord}) on ${matchupDate}.`;
  }, [pregameRecordByGameId, teamLookup]);

  const transactionDates = useMemo(
    () => simulationPerformanceMode
      ? []
      : Array.from<string>(new Set(playerState.transactions.map((transaction) => transaction.effectiveDate))).sort((a, b) => a.localeCompare(b)),
    [playerState.transactions, simulationPerformanceMode],
  );
  const broadcastFlairDate = useMemo(() => {
    if (simulationPerformanceMode) {
      return '';
    }

    if (!currentTimelineDate && allScheduleDates.length === 0 && transactionDates.length === 0) {
      return '';
    }

    const todaysCompleted = games.some((game) => game.date === currentTimelineDate && game.status === 'completed');
    const todaysTransactions = playerState.transactions.some((transaction) => transaction.effectiveDate === currentTimelineDate);
    if (todaysCompleted || todaysTransactions) {
      return currentTimelineDate;
    }

    const currentIndex = allScheduleDates.indexOf(currentTimelineDate);
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      const candidateDate = allScheduleDates[index];
      if (
        games.some((game) => game.date === candidateDate && game.status === 'completed') ||
        playerState.transactions.some((transaction) => transaction.effectiveDate === candidateDate)
      ) {
        return candidateDate;
      }
    }

    const latestTransactionDate = transactionDates[transactionDates.length - 1] ?? '';
    if (latestTransactionDate) {
      return latestTransactionDate;
    }

    return currentTimelineDate;
  }, [allScheduleDates, currentTimelineDate, games, playerState.transactions, simulationPerformanceMode, transactionDates]);
  const flairGames = useMemo(
    () => simulationPerformanceMode
      ? []
      : games
          .filter((game) => game.date === broadcastFlairDate && game.status === 'completed')
          .sort((a, b) => a.gameId.localeCompare(b.gameId)),
    [broadcastFlairDate, games, simulationPerformanceMode],
  );
  const flairTransactions = useMemo(
    () => simulationPerformanceMode
      ? []
      : playerState.transactions
          .filter((transaction) => transaction.effectiveDate === broadcastFlairDate)
          .sort((left, right) => {
            const priorityDiff = (TRANSACTION_BROADCAST_PRIORITY[left.eventType] ?? 999) - (TRANSACTION_BROADCAST_PRIORITY[right.eventType] ?? 999);
            if (priorityDiff !== 0) {
              return priorityDiff;
            }
            return left.playerId.localeCompare(right.playerId);
          })
          .slice(0, 6),
    [broadcastFlairDate, playerState.transactions, simulationPerformanceMode],
  );
  const flairPlayerSpotlights = useMemo<BroadcastFlairItem[]>(() => {
    if (simulationPerformanceMode) {
      return [];
    }

    const seasonYear = resolveSeasonYear(currentTimelineDate || games[0]?.date, games);
    const battingEntries = playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => {
        const player = playersById.get(stat.playerId) ?? null;
        const team = player?.teamId ? teamLookup.get(player.teamId) ?? null : null;
        return { stat, player, team };
      })
      .filter((entry): entry is { stat: LeaguePlayerState['battingStats'][number]; player: LeaguePlayerState['players'][number]; team: Team | null } => Boolean(entry.player));

    const pitchingEntries = playerState.pitchingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
      .map((stat) => {
        const player = playersById.get(stat.playerId) ?? null;
        const team = player?.teamId ? teamLookup.get(player.teamId) ?? null : null;
        return { stat, player, team };
      })
      .filter((entry): entry is { stat: LeaguePlayerState['pitchingStats'][number]; player: LeaguePlayerState['players'][number]; team: Team | null } => Boolean(entry.player));

    const spotlightItems: BroadcastFlairItem[] = [];
    const usedPlayers = new Set<string>();
    const pushSpotlight = (playerId: string, summary: string) => {
      if (usedPlayers.has(playerId)) {
        return;
      }
      usedPlayers.add(playerId);
      spotlightItems.push({
        gameId: `spotlight-${playerId}-${seasonYear}`,
        summary,
        targetGameId: null,
      });
    };

    const battingAverageLeader = [...battingEntries]
      .filter((entry) => entry.stat.atBats >= 140)
      .sort((left, right) => right.stat.avg - left.stat.avg || right.stat.ops - left.stat.ops)[0];
    if (battingAverageLeader) {
      const teamLabel = battingAverageLeader.team ? `${battingAverageLeader.team.city}` : 'his club';
      pushSpotlight(
        battingAverageLeader.player.playerId,
        `PLAYER WATCH | ${battingAverageLeader.player.firstName} ${battingAverageLeader.player.lastName} is batting ${battingAverageLeader.stat.avg.toFixed(3)} with ${battingAverageLeader.stat.homeRuns} HR for ${teamLabel}.`,
      );
    }

    const homeRunLeader = [...battingEntries]
      .filter((entry) => entry.stat.atBats >= 100)
      .sort((left, right) => right.stat.homeRuns - left.stat.homeRuns || right.stat.rbi - left.stat.rbi)[0];
    if (homeRunLeader) {
      const teamLabel = homeRunLeader.team ? `${homeRunLeader.team.city}` : 'his club';
      pushSpotlight(
        homeRunLeader.player.playerId,
        `POWER SURGE | ${homeRunLeader.player.firstName} ${homeRunLeader.player.lastName} leads the league with ${homeRunLeader.stat.homeRuns} HR and ${homeRunLeader.stat.rbi} RBI for ${teamLabel}.`,
      );
    }

    const eraLeader = [...pitchingEntries]
      .filter((entry) => entry.stat.inningsPitched >= 70)
      .sort((left, right) => left.stat.era - right.stat.era || right.stat.strikeouts - left.stat.strikeouts)[0];
    if (eraLeader) {
      const teamLabel = eraLeader.team ? `${eraLeader.team.city}` : 'his club';
      pushSpotlight(
        eraLeader.player.playerId,
        `ACE REPORT | ${eraLeader.player.firstName} ${eraLeader.player.lastName} owns a ${eraLeader.stat.era.toFixed(2)} ERA with ${eraLeader.stat.strikeouts} K for ${teamLabel}.`,
      );
    }

    const strikeoutLeader = [...pitchingEntries]
      .filter((entry) => entry.stat.inningsPitched >= 60)
      .sort((left, right) => right.stat.strikeouts - left.stat.strikeouts || left.stat.era - right.stat.era)[0];
    if (strikeoutLeader) {
      const teamLabel = strikeoutLeader.team ? `${strikeoutLeader.team.city}` : 'his club';
      pushSpotlight(
        strikeoutLeader.player.playerId,
        `K LEADER | ${strikeoutLeader.player.firstName} ${strikeoutLeader.player.lastName} has piled up ${strikeoutLeader.stat.strikeouts} strikeouts for ${teamLabel}.`,
      );
    }

    return spotlightItems.slice(0, 4);
  }, [currentTimelineDate, games, playerState.battingStats, playerState.pitchingStats, playersById, simulationPerformanceMode, teamLookup, resolveSeasonYear]);
  const flairUpcomingGames = useMemo(
    () => simulationPerformanceMode
      ? []
      : games
          .filter((game) => game.status === 'scheduled' && game.date >= currentTimelineDate)
          .map((game) => {
            const awayTeam = teamLookup.get(game.awayTeam) ?? null;
            const homeTeam = teamLookup.get(game.homeTeam) ?? null;
            const pregame = pregameRecordByGameId.get(game.gameId);
            const awayWins = pregame?.awayWins ?? awayTeam?.wins ?? 0;
            const awayLosses = pregame?.awayLosses ?? awayTeam?.losses ?? 0;
            const homeWins = pregame?.homeWins ?? homeTeam?.wins ?? 0;
            const homeLosses = pregame?.homeLosses ?? homeTeam?.losses ?? 0;
            const awayPct = awayWins + awayLosses > 0 ? awayWins / (awayWins + awayLosses) : 0;
            const homePct = homeWins + homeLosses > 0 ? homeWins / (homeWins + homeLosses) : 0;
            const sameDivision = Boolean(
              awayTeam &&
              homeTeam &&
              awayTeam.league === homeTeam.league &&
              awayTeam.division === homeTeam.division,
            );
            const daysUntil = currentTimelineDate
              ? Math.max(
                0,
                Math.floor(
                  (new Date(`${game.date}T00:00:00Z`).getTime() - new Date(`${currentTimelineDate}T00:00:00Z`).getTime()) / 86400000,
                ),
              )
              : 0;
            const interestScore =
              (game.playoff ? 55 : 0) +
              (sameDivision ? 18 : 0) +
              (awayPct + homePct) * 45 +
              ((awayTeam?.rating ?? 75) + (homeTeam?.rating ?? 75)) / 4 +
              Math.max(0, 12 - daysUntil);

            return { game, interestScore };
          })
          .sort((left, right) =>
            left.interestScore === right.interestScore
              ? (left.game.date === right.game.date ? left.game.gameId.localeCompare(right.game.gameId) : left.game.date.localeCompare(right.game.date))
              : right.interestScore - left.interestScore,
          )
          .slice(0, 3)
          .map((entry) => entry.game),
    [currentTimelineDate, games, pregameRecordByGameId, simulationPerformanceMode, teamLookup],
  );
  const flairTradeRumors = useMemo<BroadcastFlairItem[]>(
    () => simulationPerformanceMode
      ? []
      : pendingTrades.slice(0, 2).map((proposal) => {
          const fromTeam = teamLookup.get(proposal.fromTeamId) ?? null;
          const toTeam = teamLookup.get(proposal.toTeamId) ?? null;
          const fromPlayer = playersById.get(proposal.fromPlayerId) ?? null;
          const toPlayer = playersById.get(proposal.toPlayerId) ?? null;
          const fromPlayerName = fromPlayer ? `${fromPlayer.firstName} ${fromPlayer.lastName}` : 'a key piece';
          const toPlayerName = toPlayer ? `${toPlayer.firstName} ${toPlayer.lastName}` : 'a key return';
          return {
            gameId: `rumor-${proposal.proposalId}`,
            targetGameId: null,
            summary: `TRADE WATCH | ${fromTeam?.city ?? 'One contender'} and ${toTeam?.city ?? 'another contender'} are discussing ${fromPlayerName} for ${toPlayerName}.`,
          };
        }),
    [pendingTrades, playersById, simulationPerformanceMode, teamLookup],
  );
  const flairLabel = simulationPerformanceMode ? 'Simulation' : broadcastFlairDate === currentTimelineDate ? 'Today' : 'Yesterday';
  const flairDateLabel = broadcastFlairDate ? formatHeaderDate(broadcastFlairDate) : 'No Results';
  const flairSummaries = useMemo<BroadcastFlairItem[]>(() => {
    const items: BroadcastFlairItem[] = [];
    const seen = new Set<string>();

    const pushUniqueItem = (item: BroadcastFlairItem) => {
      if (!item.summary || seen.has(item.summary)) {
        return;
      }
      seen.add(item.summary);
      items.push(item);
    };

    flairGames.forEach((game) => {
      pushUniqueItem({
        gameId: game.gameId,
        targetGameId: game.gameId,
        summary: `FINAL | ${buildBroadcastSummary(game)}`,
      });
    });

    flairTransactions.forEach((transaction) => {
      pushUniqueItem({
        gameId: `txn-${transaction.playerId}-${transaction.effectiveDate}-${transaction.eventType}`,
        targetGameId: null,
        summary: buildBroadcastTransactionSummary(transaction),
      });
    });

    flairPlayerSpotlights.forEach((item) => {
      pushUniqueItem(item);
    });

    flairUpcomingGames.forEach((game) => {
      pushUniqueItem({
        gameId: `upcoming-${game.gameId}`,
        targetGameId: game.gameId,
        summary: buildBroadcastMatchupSummary(game),
      });
    });

    flairTradeRumors.forEach((item) => {
      pushUniqueItem(item);
    });

    return items.slice(0, 18);
  }, [
    buildBroadcastMatchupSummary,
    buildBroadcastSummary,
    buildBroadcastTransactionSummary,
    flairGames,
    flairPlayerSpotlights,
    flairTradeRumors,
    flairTransactions,
    flairUpcomingGames,
  ]);
  const flairSignature = useMemo(
    () => flairSummaries.map((item) => `${item.gameId}:${item.summary}`).join('|'),
    [flairSummaries],
  );
  const [flairIndex, setFlairIndex] = useState(0);
  const [isFlairVisible, setIsFlairVisible] = useState(true);
  const activeFlairItem = flairSummaries[flairIndex] ?? null;
  const shouldMarqueeFlair = (activeFlairItem?.summary.length ?? 0) > 92;
  const broadcastHighlightTokens = useMemo(
    () =>
      Array.from(
        new Set<string>(
          teams.flatMap((team) => [team.name, team.city]).filter((value) => value && value.trim().length > 0),
        ),
      ).sort((left, right) => right.length - left.length),
    [teams],
  );

  const renderBroadcastText = useCallback((summary: string) => {
    const escapedTokens = broadcastHighlightTokens
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean);

    if (escapedTokens.length === 0) {
      return summary;
    }

    const pattern = new RegExp(`(${escapedTokens.join('|')})`, 'g');
    return summary.split(pattern).filter(Boolean).map((part, index) => {
      const isHighlight = broadcastHighlightTokens.includes(part);
      return (
        <span key={`${part}-${index}`} className={isHighlight ? 'font-semibold text-white' : undefined}>
          {part}
        </span>
      );
    });
  }, [broadcastHighlightTokens]);

  useEffect(() => {
    if (simulationPerformanceMode) {
      return;
    }

    setFlairIndex(0);
    setIsFlairVisible(true);
  }, [flairSignature, simulationPerformanceMode]);

  useEffect(() => {
    if (simulationPerformanceMode || flairSummaries.length <= 1) {
      return;
    }

    const holdTimer = globalThis.setTimeout(() => {
      setIsFlairVisible(false);
    }, 7000);

    const swapTimer = globalThis.setTimeout(() => {
      setFlairIndex((previous) => (previous + 1) % flairSummaries.length);
      setIsFlairVisible(true);
    }, 7450);

    return () => {
      globalThis.clearTimeout(holdTimer);
      globalThis.clearTimeout(swapTimer);
    };
  }, [flairIndex, flairSummaries, simulationPerformanceMode]);

  return {
    flairLabel,
    flairDateLabel,
    activeFlairItem,
    flairIndex,
    isFlairVisible,
    shouldMarqueeFlair,
    renderBroadcastText,
  };
};
