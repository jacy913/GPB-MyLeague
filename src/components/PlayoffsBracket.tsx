import React, { useMemo } from 'react';
import { CalendarDays, Crown, PauseCircle, Play, SkipForward } from 'lucide-react';
import { Game, PlayoffRoundKey, Team } from '../types';
import { SeededPlayoffTeam, compareSeededTeams, getLeaguePlayoffSeeds, getRoundBestOf, isPlayoffGame } from '../logic/playoffs';
import { addDaysToISODate } from '../logic/simulation';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { TeamLogo } from './TeamLogo';
import worldSeriesLogo from '../assets/worldserieslogo.png';
import gpbLogo from '../assets/gpb.png';
import playoffsLogo from '../assets/playoffs.png';

interface PlayoffsBracketProps {
  teams: Team[];
  games: Game[];
  seasonComplete: boolean;
  currentDate: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  isSimulating: boolean;
  onSimulateToDate: (targetDate: string) => void;
  onSimulateNextPlayoffGame: () => void;
  onSimulateToGame: (gameId: string) => void;
  onCancelSimulation: () => void;
}

type LeagueKey = Team['league'];
type AnyLeague = LeagueKey | 'GPB';

interface SeriesStateSnapshot {
  id: string;
  league: AnyLeague;
  round: PlayoffRoundKey;
  label: string;
  bestOf: number;
  topSeedTeamId: string;
  bottomSeedTeamId: string;
  topSeed: number;
  bottomSeed: number;
  topWins: number;
  bottomWins: number;
  winnerTeamId: string | null;
  nextGameDate: string | null;
  nextGameNumber: number | null;
  started: boolean;
}

interface BracketSeriesView {
  id: string;
  league: AnyLeague;
  round: PlayoffRoundKey;
  label: string;
  bestOf: number;
  topSeed: SeededPlayoffTeam | null;
  bottomSeed: SeededPlayoffTeam | null;
  topWins: number;
  bottomWins: number;
  winner: SeededPlayoffTeam | null;
  leader: SeededPlayoffTeam | null;
  statusLabel: string;
  statusValue: string;
}

interface LeagueBracketView {
  league: LeagueKey;
  seeds: SeededPlayoffTeam[];
  wildCard: [BracketSeriesView, BracketSeriesView];
  divisional: [BracketSeriesView, BracketSeriesView];
  leagueSeries: BracketSeriesView;
  champion: SeededPlayoffTeam | null;
}

interface PlayoffBracketView {
  bracketDate: string;
  platinum: LeagueBracketView;
  prestige: LeagueBracketView;
  worldSeries: BracketSeriesView;
  champion: SeededPlayoffTeam | null;
}

const compareGameOrder = (a: Game, b: Game): number => {
  if (a.date !== b.date) {
    return a.date.localeCompare(b.date);
  }
  return a.gameId.localeCompare(b.gameId);
};

const formatMiniDate = (isoDate: string): string => {
  if (!isoDate) {
    return 'TBD';
  }

  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

const makeFallbackSeededTeam = (team: Team, seed: number): SeededPlayoffTeam => ({
  seed,
  clinchType: 'wildcard',
  team,
  wins: team.wins,
  losses: team.losses,
  runDiff: team.runsScored - team.runsAllowed,
  homeWins: 0,
  homeLosses: 0,
  homePct: 0,
});

const buildRegularSeasonSnapshot = (teams: Team[], games: Game[], snapshotDate: string): Team[] => {
  const snapshot = new Map<string, Team>(
    teams.map((team) => [
      team.id,
      {
        ...team,
        wins: 0,
        losses: 0,
        runsScored: 0,
        runsAllowed: 0,
      },
    ]),
  );

  games
    .filter((game) => !isPlayoffGame(game) && game.status === 'completed' && game.date <= snapshotDate)
    .sort(compareGameOrder)
    .forEach((game) => {
      const homeTeam = snapshot.get(game.homeTeam);
      const awayTeam = snapshot.get(game.awayTeam);
      if (!homeTeam || !awayTeam) {
        return;
      }

      homeTeam.runsScored += game.score.home;
      homeTeam.runsAllowed += game.score.away;
      awayTeam.runsScored += game.score.away;
      awayTeam.runsAllowed += game.score.home;

      if (game.score.home > game.score.away) {
        homeTeam.wins += 1;
        awayTeam.losses += 1;
      } else {
        awayTeam.wins += 1;
        homeTeam.losses += 1;
      }
    });

  return Array.from(snapshot.values());
};

const compareFallbackPlayoffTeams = (left: Team, right: Team): number => {
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

const buildSeriesStateMap = (
  games: Game[],
  bracketDate: string,
  teamsById?: Map<string, Team>,
): Map<string, SeriesStateSnapshot> => {
  const seriesMap = new Map<string, Game[]>();
  games
    .filter(isPlayoffGame)
    .forEach((game) => {
      const seriesId = game.playoff?.seriesId;
      if (!seriesId) {
        return;
      }

      const current = seriesMap.get(seriesId) ?? [];
      current.push(game);
      seriesMap.set(seriesId, current);
    });

  const result = new Map<string, SeriesStateSnapshot>();
  seriesMap.forEach((seriesGames, seriesId) => {
    const orderedGames = [...seriesGames].sort(compareGameOrder);
    const sample = orderedGames[0];
    const playoff = sample.playoff;
    if (!playoff) {
      return;
    }

    let topSeedTeamId = typeof sample.stats.topSeedTeamId === 'string' ? sample.stats.topSeedTeamId : '';
    let bottomSeedTeamId = typeof sample.stats.bottomSeedTeamId === 'string' ? sample.stats.bottomSeedTeamId : '';
    let topSeed = typeof sample.stats.topSeed === 'number' ? sample.stats.topSeed : 0;
    let bottomSeed = typeof sample.stats.bottomSeed === 'number' ? sample.stats.bottomSeed : 0;

    if ((!topSeedTeamId || !bottomSeedTeamId || topSeed <= 0 || bottomSeed <= 0) && teamsById) {
      const home = teamsById.get(sample.homeTeam) ?? null;
      const away = teamsById.get(sample.awayTeam) ?? null;
      if (home && away) {
        const sorted = [home, away].sort(compareFallbackPlayoffTeams);
        topSeedTeamId = sorted[0]?.id ?? topSeedTeamId;
        bottomSeedTeamId = sorted[1]?.id ?? bottomSeedTeamId;
        if (topSeed <= 0) {
          topSeed = 1;
        }
        if (bottomSeed <= 0) {
          bottomSeed = 2;
        }
      }
    }

    if (!topSeedTeamId || !bottomSeedTeamId) {
      return;
    }

    const completedGames = orderedGames.filter((game) => game.status === 'completed' && game.date <= bracketDate);
    let topWins = 0;
    let bottomWins = 0;
    completedGames.forEach((game) => {
      const winnerTeamId = game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
      if (winnerTeamId === topSeedTeamId) {
        topWins += 1;
      } else if (winnerTeamId === bottomSeedTeamId) {
        bottomWins += 1;
      }
    });

    const winsNeeded = Math.floor(playoff.bestOf / 2) + 1;
    const winnerTeamId = topWins >= winsNeeded ? topSeedTeamId : bottomWins >= winsNeeded ? bottomSeedTeamId : null;
    const nextGame = orderedGames
      .filter((game) => game.status === 'scheduled')
      .sort(compareGameOrder)[0];

    result.set(seriesId, {
      id: seriesId,
      league: playoff.league,
      round: playoff.round,
      label: playoff.seriesLabel,
      bestOf: playoff.bestOf,
      topSeedTeamId,
      bottomSeedTeamId,
      topSeed,
      bottomSeed,
      topWins,
      bottomWins,
      winnerTeamId,
      nextGameDate: nextGame?.date ?? null,
      nextGameNumber: nextGame?.playoff?.gameNumber ?? null,
      started: completedGames.length > 0,
    });
  });

  return result;
};

const getSeedLookup = (teams: SeededPlayoffTeam[]): Map<string, SeededPlayoffTeam> =>
  new Map(teams.map((team) => [team.team.id, team]));

const getSeriesLeader = (
  topSeed: SeededPlayoffTeam | null,
  bottomSeed: SeededPlayoffTeam | null,
  topWins: number,
  bottomWins: number,
): SeededPlayoffTeam | null => {
  if (topWins === bottomWins) {
    return null;
  }
  return topWins > bottomWins ? topSeed : bottomSeed;
};

const getResolvedWinner = (
  state: SeriesStateSnapshot | null,
  topSeed: SeededPlayoffTeam | null,
  bottomSeed: SeededPlayoffTeam | null,
): SeededPlayoffTeam | null => {
  if (!state?.winnerTeamId) {
    return null;
  }
  if (topSeed?.team.id === state.winnerTeamId) {
    return topSeed;
  }
  if (bottomSeed?.team.id === state.winnerTeamId) {
    return bottomSeed;
  }
  return null;
};

const buildSeriesStatus = (
  state: SeriesStateSnapshot | null,
  topSeed: SeededPlayoffTeam | null,
  bottomSeed: SeededPlayoffTeam | null,
  topWins: number,
  bottomWins: number,
): { label: string; value: string; leader: SeededPlayoffTeam | null; winner: SeededPlayoffTeam | null } => {
  const winner = getResolvedWinner(state, topSeed, bottomSeed);
  if (winner) {
    return {
      label: 'Series Winner',
      value: `${winner.team.city} ${winner.team.name}`,
      leader: winner,
      winner,
    };
  }

  const leader = getSeriesLeader(topSeed, bottomSeed, topWins, bottomWins);
  if (leader) {
    return {
      label: 'Series Leader',
      value: `${leader.team.name} ${Math.max(topWins, bottomWins)}-${Math.min(topWins, bottomWins)}`,
      leader,
      winner: null,
    };
  }

  if (topWins > 0 || bottomWins > 0) {
    return {
      label: 'Series Tied',
      value: `${topWins}-${bottomWins}`,
      leader: null,
      winner: null,
    };
  }

  if (state?.nextGameDate && topSeed && bottomSeed) {
    const gameLabel = state.nextGameNumber ? `Game ${state.nextGameNumber}` : 'Next Game';
    return {
      label: gameLabel,
      value: formatMiniDate(state.nextGameDate),
      leader: null,
      winner: null,
    };
  }

  if (topSeed && bottomSeed) {
    return {
      label: 'Awaiting Start',
      value: 'Series field set',
      leader: null,
      winner: null,
    };
  }

  return {
    label: 'Awaiting Matchup',
    value: 'TBD',
    leader: null,
    winner: null,
  };
};

const buildSeriesView = (
  round: PlayoffRoundKey,
  league: AnyLeague,
  id: string,
  label: string,
  topSeed: SeededPlayoffTeam | null,
  bottomSeed: SeededPlayoffTeam | null,
  state: SeriesStateSnapshot | null,
): BracketSeriesView => {
  const topWins = state?.topWins ?? 0;
  const bottomWins = state?.bottomWins ?? 0;
  const status = buildSeriesStatus(state, topSeed, bottomSeed, topWins, bottomWins);

  return {
    id,
    league,
    round,
    label,
    bestOf: state?.bestOf ?? getRoundBestOf(round),
    topSeed,
    bottomSeed,
    topWins,
    bottomWins,
    winner: status.winner,
    leader: status.leader,
    statusLabel: status.label,
    statusValue: status.value,
  };
};

const resolveParticipant = (
  participant: SeededPlayoffTeam | null,
  teamsById: Map<string, Team>,
  seed: number,
): SeededPlayoffTeam | null => {
  if (participant) {
    return participant;
  }

  if (seed <= 0) {
    return null;
  }

  const fallback = Array.from(teamsById.values()).find((team) => team.id === '');
  return fallback ? makeFallbackSeededTeam(fallback, seed) : null;
};

const buildLeagueBracketView = (
  league: LeagueKey,
  snapshotTeams: Team[],
  games: Game[],
  bracketDate: string,
  allTeamsById: Map<string, Team>,
): LeagueBracketView => {
  const leagueSeeds = getLeaguePlayoffSeeds(snapshotTeams, games.filter((game) => game.date <= bracketDate), league);
  const seedLookup = getSeedLookup(leagueSeeds);
  const seriesStates = buildSeriesStateMap(games, bracketDate, allTeamsById);

  const getSeedByNumber = (seedNumber: number): SeededPlayoffTeam | null => leagueSeeds.find((seed) => seed.seed === seedNumber) ?? null;
  const findSeries = (seriesId: string): SeriesStateSnapshot | null => seriesStates.get(seriesId) ?? null;
  const resolveSeededTeam = (teamId: string, seed: number): SeededPlayoffTeam | null => {
    const seeded = seedLookup.get(teamId) ?? null;
    if (seeded) {
      return seeded;
    }
    const fallbackTeam = allTeamsById.get(teamId) ?? null;
    return fallbackTeam ? makeFallbackSeededTeam(fallbackTeam, seed) : null;
  };

  const wildCardAState = findSeries(`${league}-wc-a`);
  const wildCardBState = findSeries(`${league}-wc-b`);

  const wildCardA = buildSeriesView(
    'wild_card',
    league,
    `${league}-wc-a`,
    `${league} Wild Card`,
    wildCardAState
      ? resolveSeededTeam(wildCardAState.topSeedTeamId, wildCardAState.topSeed)
      : getSeedByNumber(3),
    wildCardAState
      ? resolveSeededTeam(wildCardAState.bottomSeedTeamId, wildCardAState.bottomSeed)
      : getSeedByNumber(6),
    wildCardAState,
  );

  const wildCardB = buildSeriesView(
    'wild_card',
    league,
    `${league}-wc-b`,
    `${league} Wild Card`,
    wildCardBState
      ? resolveSeededTeam(wildCardBState.topSeedTeamId, wildCardBState.topSeed)
      : getSeedByNumber(4),
    wildCardBState
      ? resolveSeededTeam(wildCardBState.bottomSeedTeamId, wildCardBState.bottomSeed)
      : getSeedByNumber(5),
    wildCardBState,
  );

  const resolvedWildCardWinners = [wildCardA.winner, wildCardB.winner]
    .filter((team): team is SeededPlayoffTeam => Boolean(team))
    .sort((a, b) => b.seed - a.seed);

  const divisionalAState = findSeries(`${league}-ds-a`);
  const divisionalBState = findSeries(`${league}-ds-b`);

  const divisionalATop = divisionalAState
    ? resolveSeededTeam(divisionalAState.topSeedTeamId, divisionalAState.topSeed)
    : getSeedByNumber(1);
  const divisionalABottom = divisionalAState
    ? resolveSeededTeam(divisionalAState.bottomSeedTeamId, divisionalAState.bottomSeed)
    : resolvedWildCardWinners.length === 2
      ? resolvedWildCardWinners[0]
      : null;

  const divisionalBTop = divisionalBState
    ? resolveSeededTeam(divisionalBState.topSeedTeamId, divisionalBState.topSeed)
    : getSeedByNumber(2);
  const divisionalBBottom = divisionalBState
    ? resolveSeededTeam(divisionalBState.bottomSeedTeamId, divisionalBState.bottomSeed)
    : resolvedWildCardWinners.length === 2
      ? resolvedWildCardWinners[1]
      : null;

  const divisionalA = buildSeriesView('divisional', league, `${league}-ds-a`, `${league} Divisional`, divisionalATop, divisionalABottom, divisionalAState);
  const divisionalB = buildSeriesView('divisional', league, `${league}-ds-b`, `${league} Divisional`, divisionalBTop, divisionalBBottom, divisionalBState);

  const leagueSeriesState = findSeries(`${league}-cs`);
  const leagueSeriesParticipants = [divisionalA.winner, divisionalB.winner]
    .filter((team): team is SeededPlayoffTeam => Boolean(team))
    .sort(compareSeededTeams);

  const leagueSeriesTop = leagueSeriesState
    ? resolveSeededTeam(leagueSeriesState.topSeedTeamId, leagueSeriesState.topSeed)
    : leagueSeriesParticipants[0] ?? null;
  const leagueSeriesBottom = leagueSeriesState
    ? resolveSeededTeam(leagueSeriesState.bottomSeedTeamId, leagueSeriesState.bottomSeed)
    : leagueSeriesParticipants[1] ?? null;

  const leagueSeries = buildSeriesView(
    'league_series',
    league,
    `${league}-cs`,
    `${league} Series`,
    leagueSeriesTop,
    leagueSeriesBottom,
    leagueSeriesState,
  );

  return {
    league,
    seeds: leagueSeeds,
    wildCard: [wildCardA, wildCardB],
    divisional: [divisionalA, divisionalB],
    leagueSeries,
    champion: leagueSeries.winner,
  };
};

const buildPlayoffBracketView = (
  teams: Team[],
  games: Game[],
  currentDate: string,
  selectedDate: string,
): PlayoffBracketView => {
  const latestCompletedPlayoffDate = games
    .filter((game) => isPlayoffGame(game) && game.status === 'completed')
    .map((game) => game.date)
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? '';
  const baseDate = selectedDate && selectedDate <= currentDate ? selectedDate : currentDate || selectedDate || games[0]?.date || '';
  const bracketDate = latestCompletedPlayoffDate && latestCompletedPlayoffDate > baseDate ? latestCompletedPlayoffDate : baseDate;
  const snapshotTeams = buildRegularSeasonSnapshot(teams, games, bracketDate);
  const allTeamsById = new Map(snapshotTeams.map((team) => [team.id, team]));
  const platinum = buildLeagueBracketView('Platinum', snapshotTeams, games, bracketDate, allTeamsById);
  const prestige = buildLeagueBracketView('Prestige', snapshotTeams, games, bracketDate, allTeamsById);
  const worldSeriesState = buildSeriesStateMap(games, bracketDate, allTeamsById).get('GPB-world-series') ?? null;
  const worldSeriesParticipants = [platinum.champion, prestige.champion]
    .filter((team): team is SeededPlayoffTeam => Boolean(team))
    .sort(compareSeededTeams);
  const resolveWorldSeriesSeededTeam = (teamId: string, seed: number): SeededPlayoffTeam | null => {
    const seeded = platinum.seeds.find((entry) => entry.team.id === teamId)
      ?? prestige.seeds.find((entry) => entry.team.id === teamId)
      ?? null;
    if (seeded) {
      return seeded;
    }
    const fallbackTeam = allTeamsById.get(teamId) ?? null;
    return fallbackTeam ? makeFallbackSeededTeam(fallbackTeam, seed) : null;
  };

  const worldSeries = buildSeriesView(
    'world_series',
    'GPB',
    'GPB-world-series',
    'GPB World Series',
    worldSeriesState
      ? resolveWorldSeriesSeededTeam(worldSeriesState.topSeedTeamId, worldSeriesState.topSeed)
      : worldSeriesParticipants[0] ?? null,
    worldSeriesState
      ? resolveWorldSeriesSeededTeam(worldSeriesState.bottomSeedTeamId, worldSeriesState.bottomSeed)
      : worldSeriesParticipants[1] ?? null,
    worldSeriesState,
  );

  return {
    bracketDate,
    platinum,
    prestige,
    worldSeries,
    champion: worldSeries.winner,
  };
};

const roundTitles: Record<PlayoffRoundKey, string> = {
  wild_card: 'Wild Card',
  divisional: 'Divisional',
  league_series: 'League Series',
  world_series: 'World Series',
};

const pipsForSeries = (wins: number, bestOf: number, filledClass: string) =>
  Array.from({ length: Math.floor(bestOf / 2) + 1 }).map((_, index) => (
    <span
      key={index}
      className={`h-1.5 rounded-full ${index < wins ? filledClass : 'bg-white/10'} ${bestOf >= 7 ? 'w-8' : 'w-9'}`}
    />
  ));

const BracketTeamRow: React.FC<{
  participant: SeededPlayoffTeam | null;
  wins: number;
  bestOf: number;
  accentClass: string;
  filledClass: string;
  highlightClass: string;
  isEmphasized: boolean;
}> = ({ participant, wins, bestOf, accentClass, filledClass, highlightClass, isEmphasized }) => {
  if (!participant) {
    return (
      <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-3">
        <div className="h-11 w-11 rounded-lg bg-black/25 border border-white/10 flex items-center justify-center font-mono text-sm text-zinc-500">
          ?
        </div>
        <div className="min-w-0 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl border border-dashed border-white/10 bg-black/20 flex items-center justify-center font-mono text-lg text-zinc-600">
            TBD
          </div>
          <p className="font-display text-lg uppercase tracking-[0.08em] text-zinc-300 leading-none mt-3">Awaiting Matchup</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mt-1">Awaiting matchup</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-3 ${isEmphasized ? highlightClass : 'bg-white/[0.03]'}`}>
      <div className={`h-11 w-11 rounded-lg flex items-center justify-center font-mono text-sm font-bold ${isEmphasized ? 'bg-black/35 text-white' : 'bg-black/25 text-zinc-300'}`}>
        {participant.seed}
      </div>
      <div className="min-w-0 flex flex-col items-center text-center">
        <TeamLogo team={participant.team} sizeClass="w-16 h-16" />
        <p className={`font-display text-[1.15rem] uppercase tracking-[0.08em] leading-none break-words mt-3 ${isEmphasized ? accentClass : 'text-zinc-100'}`}>
          {participant.team.city}
        </p>
        <p className="font-display text-[0.8rem] uppercase tracking-[0.1em] text-zinc-400 mt-1 leading-none break-words">
          {participant.team.name}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-500 mt-2">
          {participant.wins}-{participant.losses}
        </p>
        <div className="mt-3 flex items-center gap-1.5">
          {pipsForSeries(wins, bestOf, isEmphasized ? filledClass : 'bg-zinc-100')}
        </div>
      </div>
    </div>
  );
};

const BracketSeriesCard: React.FC<{
  series: BracketSeriesView;
  accentClass: string;
  accentBorderClass: string;
  highlightClass: string;
  filledClass: string;
}> = ({ series, accentClass, accentBorderClass, highlightClass, filledClass }) => (
  <article className={`h-full rounded-2xl border ${accentBorderClass} bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-4 py-4 shadow-[0_18px_32px_rgba(0,0,0,0.32)] backdrop-blur-sm`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="font-display text-xl uppercase tracking-[0.14em] text-white">{roundTitles[series.round]}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-1">{series.label}</p>
      </div>
      <div className={`rounded-lg border ${accentBorderClass} bg-black/30 px-2.5 py-1 font-mono text-[10px] uppercase ${accentClass}`}>
        Best of {series.bestOf}
      </div>
    </div>

      <div className="space-y-3 mt-4">
        <BracketTeamRow
          participant={series.topSeed}
          wins={series.topWins}
          bestOf={series.bestOf}
          accentClass={accentClass}
          filledClass={filledClass}
          highlightClass={highlightClass}
          isEmphasized={series.winner?.team.id === series.topSeed?.team.id || series.leader?.team.id === series.topSeed?.team.id}
        />
        <div className="flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">vs</div>
        <BracketTeamRow
          participant={series.bottomSeed}
          wins={series.bottomWins}
          bestOf={series.bestOf}
          accentClass={accentClass}
          filledClass={filledClass}
          highlightClass={highlightClass}
          isEmphasized={series.winner?.team.id === series.bottomSeed?.team.id || series.leader?.team.id === series.bottomSeed?.team.id}
        />
      </div>

      {!series.winner && (
        <div className="mt-4 border-t border-white/8 pt-3 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">{series.statusLabel}</p>
          <p className={`mt-1 font-display text-[1rem] uppercase tracking-[0.06em] leading-tight break-words ${series.leader ? accentClass : 'text-zinc-200'}`}>
            {series.statusValue}
          </p>
        </div>
      )}
  </article>
);

const WorldSeriesTeamPanel: React.FC<{
  participant: SeededPlayoffTeam | null;
  wins: number;
  leagueLabel: string;
  accentClass: string;
  accentBorderClass: string;
  align: 'left' | 'right';
  isWinner: boolean;
}> = ({ participant, wins, leagueLabel, accentClass, accentBorderClass, align, isWinner }) => {
  const alignmentClass = align === 'left' ? 'items-start text-left' : 'items-end text-right';

  if (!participant) {
    return (
      <div className={`rounded-[2rem] border border-white/10 bg-black/20 px-6 py-8 md:px-8 md:py-10 ${alignmentClass}`}>
        <div className="rounded-full border border-white/10 bg-white/5 px-4 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          {leagueLabel}
        </div>
        <div className="mt-8 flex h-32 w-32 items-center justify-center rounded-[2rem] border border-dashed border-white/10 bg-white/[0.03] font-mono text-lg text-zinc-600 md:h-40 md:w-40">
          TBD
        </div>
        <p className="mt-6 font-display text-3xl uppercase tracking-[0.12em] text-zinc-200">Awaiting Winner</p>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">League title still in progress</p>
      </div>
    );
  }

  return (
    <div className={`rounded-[2rem] border px-6 py-8 md:px-8 md:py-10 ${isWinner ? accentBorderClass : 'border-white/10'} ${isWinner ? 'bg-white/[0.08] shadow-[0_28px_60px_rgba(255,255,255,0.08)]' : 'bg-black/20'} ${alignmentClass}`}>
      <div className={`rounded-full border px-4 py-1 font-mono text-[10px] uppercase tracking-[0.22em] ${isWinner ? `${accentBorderClass} ${accentClass} bg-white/5` : 'border-white/10 bg-white/5 text-zinc-400'}`}>
        {leagueLabel}
      </div>
      <div className={`mt-8 flex w-full ${align === 'left' ? 'justify-start' : 'justify-end'}`}>
        <TeamLogo team={participant.team} sizeClass="w-32 h-32 md:w-40 md:h-40" />
      </div>
      <p className={`mt-6 font-display text-4xl uppercase leading-none tracking-[0.12em] md:text-5xl ${isWinner ? accentClass : 'text-white'}`}>
        {participant.team.city}
      </p>
      <p className="mt-2 font-display text-xl uppercase tracking-[0.14em] text-zinc-300 md:text-2xl">
        {participant.team.name}
      </p>
      <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {participant.wins}-{participant.losses} | RD {participant.runDiff > 0 ? '+' : ''}{participant.runDiff}
      </p>
      <div className={`mt-8 flex w-full items-end gap-4 ${align === 'left' ? 'justify-start' : 'justify-end'}`}>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Series Wins</p>
          <p className="mt-2 font-display text-5xl uppercase leading-none text-white md:text-6xl">{wins}</p>
        </div>
      </div>
    </div>
  );
};

const WorldSeriesShowcase: React.FC<{
  series: BracketSeriesView;
  platinumChampion: SeededPlayoffTeam | null;
  prestigeChampion: SeededPlayoffTeam | null;
  overallChampion: SeededPlayoffTeam | null;
}> = ({ series, platinumChampion, prestigeChampion, overallChampion }) => {
  const platinumWins = platinumChampion
    ? series.topSeed?.team.id === platinumChampion.team.id
      ? series.topWins
      : series.bottomSeed?.team.id === platinumChampion.team.id
        ? series.bottomWins
        : 0
    : 0;
  const prestigeWins = prestigeChampion
    ? series.topSeed?.team.id === prestigeChampion.team.id
      ? series.topWins
      : series.bottomSeed?.team.id === prestigeChampion.team.id
        ? series.bottomWins
        : 0
    : 0;

  const platinumWinner = Boolean(overallChampion && platinumChampion && overallChampion.team.id === platinumChampion.team.id);
  const prestigeWinner = Boolean(overallChampion && prestigeChampion && overallChampion.team.id === prestigeChampion.team.id);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_26%),radial-gradient(circle_at_top_right,rgba(0,94,255,0.16),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(23,182,144,0.12),transparent_30%),linear-gradient(135deg,#151515,#202020 40%,#121212)] p-5 md:p-7">
      <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(90deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02),rgba(255,255,255,0.05))] px-4 py-4 md:px-6">
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)] xl:items-center">
          <WorldSeriesTeamPanel
            participant={platinumChampion}
            wins={platinumWins}
            leagueLabel="Platinum Champion"
            accentClass="text-platinum"
            accentBorderClass="border-platinum/35"
            align="left"
            isWinner={platinumWinner}
          />

          <div className="flex flex-col items-center justify-center px-2 py-4 text-center">
            <img
              src={gpbLogo}
              alt="GPB"
              className="h-20 w-20 object-contain drop-shadow-[0_16px_40px_rgba(255,255,255,0.16)] md:h-24 md:w-24"
            />
            <div className="rounded-full border border-white/10 bg-black/30 px-4 py-1 font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-500">
              Best of {series.bestOf}
            </div>
            <div className="mt-6 flex items-center gap-3 md:gap-4">
              <span className="font-display text-6xl uppercase leading-none text-white md:text-7xl">{platinumWins}</span>
              <span className="font-mono text-xs uppercase tracking-[0.28em] text-zinc-600">vs</span>
              <span className="font-display text-6xl uppercase leading-none text-white md:text-7xl">{prestigeWins}</span>
            </div>
            <div className="mt-6 flex items-center gap-2">
              {pipsForSeries(platinumWins, series.bestOf, 'bg-platinum')}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {pipsForSeries(prestigeWins, series.bestOf, 'bg-prestige')}
            </div>
            <div className="mt-8 rounded-[1.5rem] border border-white/10 bg-black/25 px-5 py-4">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-zinc-100" />
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">World Series Champion</p>
              </div>
              {overallChampion ? (
                <div className="mt-3 flex items-center justify-center gap-3">
                  <TeamLogo team={overallChampion.team} sizeClass="w-14 h-14" />
                  <div className="min-w-0 text-left">
                    <p className="font-display text-2xl uppercase tracking-[0.1em] text-white">{overallChampion.team.city}</p>
                    <p className="mt-1 font-display text-sm uppercase tracking-[0.14em] text-zinc-300">{overallChampion.team.name}</p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                  Winner crowns here once the final ends
                </p>
              )}
            </div>
            <img
              src={worldSeriesLogo}
              alt="GPB World Series"
              className="mt-6 h-16 w-auto object-contain drop-shadow-[0_18px_40px_rgba(210,178,92,0.3)] md:h-20"
            />
          </div>

          <WorldSeriesTeamPanel
            participant={prestigeChampion}
            wins={prestigeWins}
            leagueLabel="Prestige Champion"
            accentClass="text-prestige"
            accentBorderClass="border-prestige/35"
            align="right"
            isWinner={prestigeWinner}
          />
        </div>
      </div>
    </section>
  );
};

const LeagueBracketDesktop: React.FC<{
  bracket: LeagueBracketView;
  accentClass: string;
  accentBorderClass: string;
  highlightClass: string;
  filledClass: string;
}> = ({ bracket, accentClass, accentBorderClass, highlightClass, filledClass }) => (
  <div className="hidden xl:grid grid-cols-5 gap-5 items-start">
    <div className="pt-8">
      <BracketSeriesCard
        series={bracket.wildCard[0]}
        accentClass={accentClass}
        accentBorderClass={accentBorderClass}
        highlightClass={highlightClass}
        filledClass={filledClass}
      />
    </div>
    <div className="pt-24">
      <BracketSeriesCard
        series={bracket.divisional[0]}
        accentClass={accentClass}
        accentBorderClass={accentBorderClass}
        highlightClass={highlightClass}
        filledClass={filledClass}
      />
    </div>
    <div className="pt-40">
      <BracketSeriesCard
        series={bracket.leagueSeries}
        accentClass={accentClass}
        accentBorderClass={accentBorderClass}
        highlightClass={highlightClass}
        filledClass={filledClass}
      />
    </div>
    <div className="pt-24">
      <BracketSeriesCard
        series={bracket.divisional[1]}
        accentClass={accentClass}
        accentBorderClass={accentBorderClass}
        highlightClass={highlightClass}
        filledClass={filledClass}
      />
    </div>
    <div className="pt-8">
      <BracketSeriesCard
        series={bracket.wildCard[1]}
        accentClass={accentClass}
        accentBorderClass={accentBorderClass}
        highlightClass={highlightClass}
        filledClass={filledClass}
      />
    </div>
  </div>
);

const LeagueBracketMobile: React.FC<{
  bracket: LeagueBracketView;
  accentClass: string;
  accentBorderClass: string;
  highlightClass: string;
  filledClass: string;
}> = ({ bracket, accentClass, accentBorderClass, highlightClass, filledClass }) => (
  <div className="xl:hidden space-y-4">
    <div>
      <p className="font-display text-lg uppercase tracking-widest text-zinc-100 mb-2">Wild Card</p>
      <div className="space-y-3">
        {bracket.wildCard.map((series) => (
          <BracketSeriesCard
            key={series.id}
            series={series}
            accentClass={accentClass}
            accentBorderClass={accentBorderClass}
            highlightClass={highlightClass}
            filledClass={filledClass}
          />
        ))}
      </div>
    </div>
    <div>
      <p className="font-display text-lg uppercase tracking-widest text-zinc-100 mb-2">Divisional</p>
      <div className="space-y-3">
        {bracket.divisional.map((series) => (
          <BracketSeriesCard
            key={series.id}
            series={series}
            accentClass={accentClass}
            accentBorderClass={accentBorderClass}
            highlightClass={highlightClass}
            filledClass={filledClass}
          />
        ))}
      </div>
    </div>
    <div>
      <p className="font-display text-lg uppercase tracking-widest text-zinc-100 mb-2">League Series</p>
      <BracketSeriesCard
        series={bracket.leagueSeries}
        accentClass={accentClass}
        accentBorderClass={accentBorderClass}
        highlightClass={highlightClass}
        filledClass={filledClass}
      />
    </div>
  </div>
);

const LeagueSection: React.FC<{
  bracket: LeagueBracketView;
  accentClass: string;
  accentBorderClass: string;
  highlightClass: string;
  filledClass: string;
}> = ({ bracket, accentClass, accentBorderClass, highlightClass, filledClass }) => (
  <section className="rounded-2xl border border-white/10 bg-[linear-gradient(135deg,#191919,#212121,#171717)] p-4 md:p-5">
    <div className="flex items-end justify-between gap-3 mb-5">
      <div>
        <p className={`font-display text-4xl uppercase tracking-[0.18em] ${accentClass}`}>{bracket.league}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mt-1">Bracket state updates from played playoff games</p>
      </div>
      <div className="text-right">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Top Seed</p>
        <p className={`font-display text-lg uppercase tracking-[0.08em] ${accentClass}`}>
          {bracket.seeds[0] ? `${bracket.seeds[0].team.city} ${bracket.seeds[0].team.name}` : 'TBD'}
        </p>
      </div>
    </div>

    <LeagueBracketDesktop
      bracket={bracket}
      accentClass={accentClass}
      accentBorderClass={accentBorderClass}
      highlightClass={highlightClass}
      filledClass={filledClass}
    />
    <LeagueBracketMobile
      bracket={bracket}
      accentClass={accentClass}
      accentBorderClass={accentBorderClass}
      highlightClass={highlightClass}
      filledClass={filledClass}
    />
  </section>
);

export const PlayoffsBracket: React.FC<PlayoffsBracketProps> = ({
  teams,
  games,
  seasonComplete,
  currentDate,
  selectedDate,
  onSelectDate,
  isSimulating,
  onSimulateToDate,
  onSimulateNextPlayoffGame,
  onSimulateToGame,
  onCancelSimulation,
}) => {
  const bracket = useMemo(
    () => buildPlayoffBracketView(teams, games, currentDate, selectedDate),
    [teams, games, currentDate, selectedDate],
  );
  const teamsById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const playoffGames = useMemo(() => games.filter((game) => isPlayoffGame(game)).sort(compareGameOrder), [games]);
  const playbackAnchorDate = useMemo(() => {
    const latestCompletedPlayoffDate = playoffGames
      .filter((game) => game.status === 'completed')
      .map((game) => game.date)
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ?? '';
    if (!currentDate) {
      return latestCompletedPlayoffDate || selectedDate || '';
    }
    return latestCompletedPlayoffDate && latestCompletedPlayoffDate > currentDate ? latestCompletedPlayoffDate : currentDate;
  }, [currentDate, playoffGames, selectedDate]);
  const upcomingPlayoffGames = useMemo(
    () => playoffGames.filter((game) => game.status === 'scheduled' && (!playbackAnchorDate || game.date >= playbackAnchorDate)),
    [playoffGames, playbackAnchorDate],
  );
  const allScheduleDates = useMemo<string[]>(() => {
    const dates: string[] = games.map((game) => game.date);
    return Array.from<string>(new Set(dates)).sort((left: string, right: string) => left.localeCompare(right));
  }, [games]);
  const maxSelectableDate = useMemo(() => {
    const existingMax = allScheduleDates[allScheduleDates.length - 1] ?? '';
    const horizonBase = playbackAnchorDate || bracket.bracketDate || existingMax;
    if (!horizonBase) {
      return existingMax;
    }

    const horizon = addDaysToISODate(horizonBase, 70);
    if (!existingMax) {
      return horizon;
    }
    return horizon > existingMax ? horizon : existingMax;
  }, [allScheduleDates, bracket.bracketDate, playbackAnchorDate]);
  const activeTargetDate = selectedDate || playbackAnchorDate || bracket.bracketDate || allScheduleDates[0] || '';
  const canSimToTargetDate = Boolean(activeTargetDate) && (!playbackAnchorDate || activeTargetDate >= playbackAnchorDate);
  const nextPlayoffDate = upcomingPlayoffGames[0]?.date ?? null;
  const gameQueue = upcomingPlayoffGames.slice(0, 12);
  const firstScheduledPlayoffDate = useMemo(() => {
    return (
      playoffGames
        .filter((game) => game.status === 'scheduled')
        .map((game) => game.date as string)
        .sort((left: string, right: string) => left.localeCompare(right))[0] ?? null
    );
  }, [playoffGames]);
  const completedPlayoffGames = useMemo(
    () => playoffGames.filter((game) => game.status === 'completed' && game.date <= bracket.bracketDate).length,
    [playoffGames, bracket.bracketDate],
  );
  const bracketStatusCopy = useMemo(() => {
    if (bracket.champion) {
      return `Bracket completed through ${formatHeaderDate(bracket.bracketDate)}.`;
    }

    if (completedPlayoffGames > 0) {
      return `Bracket live through ${formatHeaderDate(bracket.bracketDate)}.`;
    }

    if (firstScheduledPlayoffDate) {
      return `Playoffs scheduled to open ${formatHeaderDate(firstScheduledPlayoffDate)}.`;
    }

    return seasonComplete
      ? 'Regular season complete. Generate or schedule playoff games to start the bracket.'
      : 'Playoff field projected. Simulate forward to begin bracket games.';
  }, [bracket.champion, bracket.bracketDate, completedPlayoffGames, firstScheduledPlayoffDate, seasonComplete]);
  const simControlsLocked = isSimulating;

  return (
    <section className="space-y-8">
      <article className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(23,182,144,0.12),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(167,155,0,0.12),transparent_32%),linear-gradient(135deg,#1a1a1a,#232323,#171717)] p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <img src={gpbLogo} alt="GPB" className="h-10 w-auto object-contain md:h-12" />
              <img src={playoffsLogo} alt="Playoffs" className="h-12 w-auto object-contain md:h-16" />
            </div>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-400">
              {bracketStatusCopy}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Next playoff date</p>
            <p className="mt-1 font-display text-xl uppercase tracking-[0.08em] text-zinc-100">
              {nextPlayoffDate ? formatHeaderDate(nextPlayoffDate) : 'None Scheduled'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
          <label className="rounded-xl border border-white/10 bg-black/25 px-4 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Sim target date</span>
            <input
              type="date"
              value={activeTargetDate}
              min={allScheduleDates[0]}
              max={maxSelectableDate}
              onChange={(event) => onSelectDate(event.target.value)}
              className="mt-2 block w-full bg-transparent font-mono text-sm text-white outline-none"
            />
          </label>

          <button
            onClick={onSimulateNextPlayoffGame}
            disabled={simControlsLocked}
            className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-left transition-colors hover:border-white/20 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-prestige" />
              <p className="font-headline text-xl uppercase tracking-[0.08em] text-white">Sim Next Game</p>
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Advance one playoff game</p>
          </button>

          <button
            onClick={() => onSimulateToDate(activeTargetDate)}
            disabled={simControlsLocked || !canSimToTargetDate}
            className="rounded-xl border border-prestige/25 bg-prestige/10 px-4 py-3 text-left transition-colors hover:border-prestige/40 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-prestige" />
              <p className="font-headline text-xl uppercase tracking-[0.08em] text-prestige">Sim To Date</p>
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {activeTargetDate ? formatHeaderDate(activeTargetDate) : 'Select a target'}
            </p>
          </button>

          <button
            onClick={() => nextPlayoffDate && onSimulateToDate(nextPlayoffDate)}
            disabled={simControlsLocked || !nextPlayoffDate}
            className="rounded-xl border border-[#d4bb6a]/25 bg-[#d4bb6a]/10 px-4 py-3 text-left transition-colors hover:border-[#d4bb6a]/40 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <SkipForward className="h-4 w-4 text-[#ecd693]" />
              <p className="font-headline text-xl uppercase tracking-[0.08em] text-[#ecd693]">Next Playoff Day</p>
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {nextPlayoffDate ? formatHeaderDate(nextPlayoffDate) : 'No upcoming playoff date'}
            </p>
          </button>

          <button
            onClick={onCancelSimulation}
            disabled={!isSimulating}
            className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-left transition-colors hover:border-white/20 disabled:opacity-50"
          >
            <div className="flex items-center gap-2">
              <PauseCircle className="h-4 w-4 text-zinc-300" />
              <p className="font-headline text-xl uppercase tracking-[0.08em] text-zinc-100">Stop</p>
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {isSimulating ? 'Stop after active day' : 'Idle'}
            </p>
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Playoff game queue</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {upcomingPlayoffGames.length} scheduled
            </p>
          </div>
          {gameQueue.length > 0 ? (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1 scrollbar-subtle">
              {gameQueue.map((game) => {
                const awayTeam = teamsById.get(game.awayTeam) ?? null;
                const homeTeam = teamsById.get(game.homeTeam) ?? null;
                const seriesLabel = game.playoff?.seriesLabel ?? 'Playoff';
                const gameNumberLabel = game.playoff?.gameNumber ? `G${game.playoff.gameNumber}` : 'G?';
                return (
                  <button
                    key={game.gameId}
                    type="button"
                    onClick={() => onSimulateToGame(game.gameId)}
                    disabled={simControlsLocked}
                    className="min-w-[240px] rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-left transition-colors hover:border-white/20 disabled:opacity-50"
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                      {formatHeaderDate(game.date)} | {gameNumberLabel}
                    </p>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#d8c88b]">{seriesLabel}</p>
                    <p className="mt-2 font-headline text-xl uppercase tracking-[0.06em] text-white">
                      {(awayTeam?.city ?? game.awayTeam)} @ {(homeTeam?.city ?? game.homeTeam)}
                    </p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">Sim Through This Game</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              No playoff games are currently scheduled.
            </p>
          )}
        </div>
      </article>

      <LeagueSection
        bracket={bracket.platinum}
        accentClass="text-platinum"
        accentBorderClass="border-platinum/35"
        highlightClass="bg-platinum/14"
        filledClass="bg-platinum"
      />

      <WorldSeriesShowcase
        series={bracket.worldSeries}
        platinumChampion={bracket.platinum.champion}
        prestigeChampion={bracket.prestige.champion}
        overallChampion={bracket.champion}
      />

      <LeagueSection
        bracket={bracket.prestige}
        accentClass="text-prestige"
        accentBorderClass="border-prestige/35"
        highlightClass="bg-prestige/14"
        filledClass="bg-prestige"
      />
    </section>
  );
};
