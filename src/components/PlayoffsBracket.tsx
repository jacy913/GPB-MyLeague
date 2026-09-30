import React, { useMemo } from 'react';
import { CalendarDays, PauseCircle, Play, SkipForward } from 'lucide-react';
import { Game, PlayoffRoundKey, Team } from '../types';
import { SeededPlayoffTeam, compareSeededTeams, getLeaguePlayoffSeeds, getRoundBestOf, isPlayoffGame } from '../logic/playoffs';
import { addDaysToISODate } from '../logic/simulation';
import { fmtDiff, fmtRecord } from '../logic/statFormatting';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { Panel, RetroButton, StatValue, TeamLogo } from './ui';
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

/**
 * Best-of pips, drawn as diamonds.
 *
 * A rotated square is the period's answer to a circular progress ring, and it
 * costs nothing at this size. Filled is a win, hollow is a loss.
 */
const SeriesPips: React.FC<{ wins: number; bestOf: number; fill: string; size?: 'sm' | 'md' }> = ({
  wins,
  bestOf,
  fill,
  size = 'sm',
}) => {
  const total = Math.floor(bestOf / 2) + 1;
  const box = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5';
  return (
    <div className="flex items-center gap-1" aria-label={`${wins} of ${bestOf - 1} series wins`}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`${box} inline-block rotate-45 ${
            index < wins ? fill : 'border border-[var(--color-chrome-lo)] bg-transparent'
          }`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
};

/**
 * Seed badge -- skewed chip. 1 and 2 carry the gold because a top-two seed is
 * the only seeding distinction that means something postseason; 3+ falls back
 * to the league identity fill so the badge still reads as belonging to a league.
 */
const SeedBadge: React.FC<{ seed: number; league: AnyLeague; dimmed?: boolean }> = ({ seed, league, dimmed }) => {
  const isTopSeed = seed <= 2;
  const leagueFill = league === 'Prestige' ? 'bg-[var(--color-prestige)]' : 'bg-[var(--color-platinum)]';
  const fill = isTopSeed ? 'bg-[var(--color-gold)]' : leagueFill;
  return (
    <span
      className={`skew-shadow inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center ${
        dimmed ? 'bg-[var(--color-panel-2)] text-[var(--color-ink-faint)]' : `${fill} text-[var(--color-ink-invert)]`
      }`}
      aria-label={`Seed ${seed}`}
    >
      <span className="relative z-10 t-stat-sm">{seed}</span>
    </span>
  );
};

const BracketTeamRow: React.FC<{
  participant: SeededPlayoffTeam | null;
  wins: number;
  bestOf: number;
  league: AnyLeague;
  isLeader: boolean;
  pipFill: string;
}> = ({ participant, wins, bestOf, league, isLeader, pipFill }) => {
  if (!participant) {
    return (
      <div className="flex items-center gap-2 border border-dashed border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-2">
        <span className="h-6 w-6 shrink-0 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="t-caption text-[var(--color-ink-faint)]">TBD</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 border-l-[3px] px-2 py-2 ${
        isLeader ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]' : 'border-l-transparent'
      }`}
    >
      <SeedBadge seed={participant.seed} league={league} dimmed={!isLeader} />
      <TeamLogo team={participant.team} sizeClass="h-9 w-9" />
      <div className="min-w-0 flex-1">
        <p className={`truncate t-h3 ${isLeader ? 'text-[var(--color-gold-hi)]' : 'text-[var(--color-ink)]'}`}>
          {participant.team.city}
        </p>
        <p className="truncate t-caption text-[var(--color-ink-faint)]">
          {participant.team.name} · {fmtRecord(participant.wins, participant.losses)}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatValue size="lg" variant={isLeader ? 'accent' : 'default'}>{wins}</StatValue>
        <SeriesPips wins={wins} bestOf={bestOf} fill={pipFill} />
      </div>
    </div>
  );
};

/**
 * Series card.
 *
 * A series is "live" when it has been decided in at least one game but not
 * finished. That is derived from the view model rather than passed in, so the
 * live treatment cannot drift from the data that justifies it.
 */
const BracketSeriesCard: React.FC<{
  series: BracketSeriesView;
  cardRef?: React.Ref<HTMLDivElement>;
  league: AnyLeague;
  pipFill: string;
}> = ({ series, cardRef, league, pipFill }) => {
  const isLive = !series.winner && (series.topWins > 0 || series.bottomWins > 0);
  const topLeading = series.leader?.team.id === series.topSeed?.team.id;
  const bottomLeading = series.leader?.team.id === series.bottomSeed?.team.id;

  return (
    <div ref={cardRef} className="relative">
      <Panel className={`relative overflow-hidden ${isLive ? 'border-[var(--color-gold)]' : ''}`}>
        {isLive && (
          <>
            <div className="h-[2px] w-full" style={{ background: 'var(--texture-hazard)' }} aria-hidden="true" />
            <span className="skew-shadow absolute right-0 top-1 inline-flex h-[18px] items-center bg-[var(--color-gold)] px-2">
              <span className="relative z-10 t-caption text-[var(--color-ink-invert)]">NEXT</span>
            </span>
          </>
        )}

        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-chrome-lo)] px-3 py-2">
          <h3 className="t-label">{roundTitles[series.round]}</h3>
          <span className="t-caption text-[var(--color-ink-faint)]">BO{series.bestOf}</span>
        </div>

        <div className="flex flex-col gap-1 p-2">
          <BracketTeamRow
            participant={series.topSeed}
            wins={series.topWins}
            bestOf={series.bestOf}
            league={league}
            isLeader={topLeading}
            pipFill={pipFill}
          />
          <BracketTeamRow
            participant={series.bottomSeed}
            wins={series.bottomWins}
            bestOf={series.bestOf}
            league={league}
            isLeader={bottomLeading}
            pipFill={pipFill}
          />
        </div>

        {!series.winner && (
          <p className="border-t border-[var(--color-chrome-lo)] px-3 py-2 text-right t-caption text-[var(--color-ink-dim)]">
            {series.statusValue}
          </p>
        )}
      </Panel>
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Connector layer
 *
 * A single SVG beneath the cards, rather than a dozen positioned divs. The
 * round geometry is non-trivial enough that the connector path has to live in
 * one readable place.
 *
 * Positions are measured rather than assumed, because the cards are a grid with
 * vertical offsets whose exact pixel layout depends on content height. A
 * measured path stays attached to the cards if their content reflows; a
 * hard-coded one silently detaches.
 * ------------------------------------------------------------------ */

interface ConnectorSpec {
  fromId: string;
  toId: string;
  active: boolean;
}

/** Orthogonal three-bend path between two card edges, in either direction. */
const buildConnectorPath = (
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): string => {
  const fromMidY = from.y + from.height / 2;
  const toMidY = to.y + to.height / 2;
  const rightward = to.x > from.x;
  const startX = rightward ? from.x + from.width : from.x;
  const endX = rightward ? to.x : to.x + to.width;
  const midX = (startX + endX) / 2;
  return `M ${startX} ${fromMidY} L ${midX} ${fromMidY} L ${midX} ${toMidY} L ${endX} ${toMidY}`;
};

const BracketConnectors: React.FC<{
  containerRef: React.RefObject<HTMLDivElement | null>;
  cardRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  specs: ConnectorSpec[];
}> = ({ containerRef, cardRefs, specs }) => {
  const [paths, setPaths] = React.useState<Array<{ d: string; active: boolean }>>([]);
  const [box, setBox] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const containerBox = container.getBoundingClientRect();
      setBox({ width: containerBox.width, height: containerBox.height });

      const next = specs.flatMap((spec) => {
        const fromEl = cardRefs.current[spec.fromId];
        const toEl = cardRefs.current[spec.toId];
        if (!fromEl || !toEl) return [];
        const fromBox = fromEl.getBoundingClientRect();
        const toBox = toEl.getBoundingClientRect();
        return [{
          d: buildConnectorPath(
            { x: fromBox.left - containerBox.left, y: fromBox.top - containerBox.top, width: fromBox.width, height: fromBox.height },
            { x: toBox.left - containerBox.left, y: toBox.top - containerBox.top, width: toBox.width, height: toBox.height },
          ),
          active: spec.active,
        }];
      });
      setPaths(next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef, cardRefs, specs]);

  if (box.width === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-0"
      width={box.width}
      height={box.height}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path) => (
        <path
          key={path.d}
          d={path.d}
          fill="none"
          stroke={path.active ? 'var(--color-gold)' : 'var(--color-chrome-lo)'}
          strokeWidth="1"
          shapeRendering="crispEdges"
        />
      ))}
    </svg>
  );
};

const LeagueBracketDesktop: React.FC<{ bracket: LeagueBracketView; league: AnyLeague; pipFill: string }> = ({
  bracket,
  league,
  pipFill,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const cardRefs = React.useRef<Record<string, HTMLDivElement | null>>({});

  // Wild card feeds the divisional, both divisionals feed the league series.
  // The right-hand side mirrors the left, so the paths run inward.
  const specs = React.useMemo<ConnectorSpec[]>(() => [
    { fromId: bracket.wildCard[0].id, toId: bracket.divisional[0].id, active: Boolean(bracket.wildCard[0].winner) },
    { fromId: bracket.wildCard[1].id, toId: bracket.divisional[1].id, active: Boolean(bracket.wildCard[1].winner) },
    { fromId: bracket.divisional[0].id, toId: bracket.leagueSeries.id, active: Boolean(bracket.divisional[0].winner) },
    { fromId: bracket.divisional[1].id, toId: bracket.leagueSeries.id, active: Boolean(bracket.divisional[1].winner) },
  ], [bracket]);

  const card = (series: BracketSeriesView, offset: string) => (
    <div className={offset} style={{ position: 'relative', zIndex: 1 }}>
      <BracketSeriesCard
        series={series}
        league={league}
        pipFill={pipFill}
        cardRef={(node) => { cardRefs.current[series.id] = node; }}
      />
    </div>
  );

  return (
    <div ref={containerRef} className="relative hidden xl:block">
      <BracketConnectors containerRef={containerRef} cardRefs={cardRefs} specs={specs} />
      <div className="relative grid grid-cols-5 gap-6">
        {card(bracket.wildCard[0], '')}
        {card(bracket.divisional[0], 'pt-16')}
        {card(bracket.leagueSeries, 'pt-32')}
        {card(bracket.divisional[1], 'pt-16')}
        {card(bracket.wildCard[1], '')}
      </div>
    </div>
  );
};

/**
 * Below xl the bracket loses its columns. The connector layer is dropped rather
 * than compressed, because a five-round horizontal path has nowhere to go on a
 * narrow screen -- the same reason the design proposal drops skew below 1024px.
 * Rounds become labelled groups instead.
 */
const LeagueBracketStacked: React.FC<{ bracket: LeagueBracketView; league: AnyLeague; pipFill: string }> = ({
  bracket,
  league,
  pipFill,
}) => {
  const groups: Array<{ title: string; series: BracketSeriesView[] }> = [
    { title: 'Wild Card', series: [...bracket.wildCard] },
    { title: 'Divisional', series: [...bracket.divisional] },
    { title: 'League Series', series: [bracket.leagueSeries] },
  ];

  return (
    <div className="flex flex-col gap-4 xl:hidden">
      {groups.map((group) => (
        <div key={group.title}>
          <p className="t-label mb-2 text-[var(--color-ink-dim)]">{group.title}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.series.map((series) => (
              <BracketSeriesCard key={series.id} series={series} league={league} pipFill={pipFill} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

const LeagueSection: React.FC<{ bracket: LeagueBracketView; league: AnyLeague; pipFill: string }> = ({
  bracket,
  league,
  pipFill,
}) => {
  const topSeed = bracket.seeds[0];
  const pipFillVar = league === 'Prestige' ? 'bg-[var(--color-prestige)]' : 'bg-[var(--color-platinum)]';

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex flex-wrap items-end justify-between gap-3 px-4">
        <h2 className="t-h2">{bracket.league} League</h2>
        <div className="text-right">
          <p className="t-caption text-[var(--color-ink-faint)]">TOP SEED</p>
          <p className="t-stat text-[var(--color-gold)]">
            {topSeed ? `${topSeed.team.city} ${topSeed.team.name}` : 'TBD'}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-5 p-4">
        <LeagueBracketDesktop bracket={bracket} league={league} pipFill={pipFillVar} />
        <LeagueBracketStacked bracket={bracket} league={league} pipFill={pipFillVar} />
      </div>
    </Panel>
  );
};

const WorldSeriesTeamPanel: React.FC<{
  participant: SeededPlayoffTeam | null;
  wins: number;
  bestOf: number;
  leagueLabel: string;
  align: 'left' | 'right';
  isWinner: boolean;
  pipFill: string;
}> = ({ participant, wins, bestOf, leagueLabel, align, isWinner, pipFill }) => {
  const alignment = align === 'left' ? 'items-start text-left' : 'items-end text-right';

  if (!participant) {
    return (
      <Panel variant="sunken" className={`flex flex-col gap-4 p-6 ${alignment}`}>
        <p className="t-caption text-[var(--color-ink-faint)]">{leagueLabel}</p>
        <div className="h-24 w-24 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />
        <p className="t-h2 text-[var(--color-ink-dim)]">Awaiting Winner</p>
      </Panel>
    );
  }

  return (
    <Panel
      variant={isWinner ? 'hero' : 'default'}
      className={`flex flex-col gap-4 p-6 ${alignment} ${isWinner ? 'border-[var(--color-gold)]' : ''}`}
    >
      <span className={`t-label ${isWinner ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-dim)]'}`}>
        {leagueLabel}
      </span>
      <TeamLogo team={participant.team} sizeClass="h-28 w-28" />
      <div>
        <p className={`t-h1 ${isWinner ? 'text-[var(--color-gold-hi)]' : ''}`}>{participant.team.city}</p>
        <p className="t-h3 mt-1 text-[var(--color-ink-dim)]">{participant.team.name}</p>
        <p className="t-caption mt-2 text-[var(--color-ink-faint)]">
          {fmtRecord(participant.wins, participant.losses)} · RD {fmtDiff(participant.runDiff)}
        </p>
      </div>
      <div className={`flex items-end gap-4 ${align === 'left' ? 'justify-start' : 'justify-end'}`}>
        <StatValue size="lg" variant={isWinner ? 'accent' : 'default'}>{wins}</StatValue>
        <SeriesPips wins={wins} bestOf={bestOf} fill={pipFill} size="md" />
      </div>
    </Panel>
  );
};

/**
 * World Series -- the climax of the screen and the one element permitted to
 * break the bracket's column symmetry. Full width, centred, spanning the final.
 */
const WorldSeriesShowcase: React.FC<{
  series: BracketSeriesView;
  platinumChampion: SeededPlayoffTeam | null;
  prestigeChampion: SeededPlayoffTeam | null;
  overallChampion: SeededPlayoffTeam | null;
}> = ({ series, platinumChampion, prestigeChampion, overallChampion }) => {
  const winsFor = (champion: SeededPlayoffTeam | null): number => {
    if (!champion) return 0;
    if (series.topSeed?.team.id === champion.team.id) return series.topWins;
    if (series.bottomSeed?.team.id === champion.team.id) return series.bottomWins;
    return 0;
  };

  const platinumWins = winsFor(platinumChampion);
  const prestigeWins = winsFor(prestigeChampion);
  const platinumWinner = Boolean(overallChampion && platinumChampion && overallChampion.team.id === platinumChampion.team.id);
  const prestigeWinner = Boolean(overallChampion && prestigeChampion && overallChampion.team.id === prestigeChampion.team.id);

  return (
    <Panel className="overflow-hidden">
      <div className="chrome-bar flex items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-3">
          <h2 className="t-h2">GPB World Series</h2>
          <span className="t-caption text-[var(--color-ink-faint)]">BEST OF {series.bestOf}</span>
        </div>
        <img src={worldSeriesLogo} alt="" className="h-8 w-auto object-contain" aria-hidden="true" />
      </div>

      <div className="grid gap-4 p-4 xl:grid-cols-2">
        <WorldSeriesTeamPanel
          participant={platinumChampion}
          wins={platinumWins}
          bestOf={series.bestOf}
          leagueLabel="Platinum Champion"
          align="left"
          isWinner={platinumWinner}
          pipFill="bg-[var(--color-platinum)]"
        />
        <WorldSeriesTeamPanel
          participant={prestigeChampion}
          wins={prestigeWins}
          bestOf={series.bestOf}
          leagueLabel="Prestige Champion"
          align="right"
          isWinner={prestigeWinner}
          pipFill="bg-[var(--color-prestige)]"
        />
      </div>

      <div className="border-t border-[var(--color-chrome-lo)] px-4 py-6">
        <div className="flex flex-col items-center gap-4 text-center">
          {overallChampion ? (
            <>
              <p className="t-label text-[var(--color-ink-dim)]">World Series Champion</p>
              <TeamLogo team={overallChampion.team} sizeClass="h-20 w-20" />
              <p className="t-display text-[var(--color-gold-hi)]">{overallChampion.team.city}</p>
              <p className="t-h2 text-[var(--color-gold)]">{overallChampion.team.name}</p>
            </>
          ) : (
            <>
              <img src={gpbLogo} alt="" className="h-20 w-auto object-contain opacity-80" aria-hidden="true" />
              <p className="t-h2 text-[var(--color-ink-dim)]">Champion Crowns Here</p>
              <p className="t-caption text-[var(--color-ink-faint)]">Winner is decided once the final ends</p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
};

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
    [playbackAnchorDate, playoffGames],
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
  const firstScheduledPlayoffDate = useMemo(
    () => playoffGames
      .filter((game) => game.status === 'scheduled')
      .map((game) => game.date as string)
      .sort((left, right) => left.localeCompare(right))[0] ?? null,
    [playoffGames],
  );
  const completedPlayoffGames = useMemo(
    () => playoffGames.filter((game) => game.status === 'completed' && game.date <= bracket.bracketDate).length,
    [bracket.bracketDate, playoffGames],
  );
  const bracketStatusCopy = useMemo(() => {
    if (bracket.champion) return `Bracket completed through ${formatHeaderDate(bracket.bracketDate)}.`;
    if (completedPlayoffGames > 0) return `Bracket live through ${formatHeaderDate(bracket.bracketDate)}.`;
    if (firstScheduledPlayoffDate) return `Playoffs scheduled to open ${formatHeaderDate(firstScheduledPlayoffDate)}.`;
    return seasonComplete
      ? 'Regular season complete. Generate or schedule playoff games to start the bracket.'
      : 'Playoff field projected. Simulate forward to begin bracket games.';
  }, [bracket.bracketDate, bracket.champion, completedPlayoffGames, firstScheduledPlayoffDate, seasonComplete]);
  const simControlsLocked = isSimulating;

  return (
    <section className="space-y-5">
      <Panel className="overflow-hidden">
        {/* The logos get their own band rather than a chrome bar. A chrome bar is
            32px tall by definition, so anything of real presence has to sit
            below it -- cramming them into the bar is what made them read as
            decoration instead of masthead. */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-4 py-4">
          <div className="flex items-center gap-4">
            <img src={gpbLogo} alt="" className="h-16 w-auto object-contain md:h-20" aria-hidden="true" />
            <span className="h-16 w-px self-stretch bg-[var(--color-chrome-lo)] md:h-20" aria-hidden="true" />
            <img src={playoffsLogo} alt="" className="h-16 w-auto object-contain md:h-20" aria-hidden="true" />
            <div>
              <h1 className="t-h1">Playoffs</h1>
              <p className="t-caption mt-1 text-[var(--color-ink-faint)]">{bracketStatusCopy}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="t-caption text-[var(--color-ink-faint)]">NEXT PLAYOFF DATE</p>
            <p className="t-stat-lg text-[var(--color-gold)]">
              {nextPlayoffDate ? formatHeaderDate(nextPlayoffDate) : 'NONE SCHEDULED'}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:flex-wrap lg:items-end">
          <label className="flex flex-col gap-1">
            <span className="t-caption text-[var(--color-ink-faint)]">SIM TARGET DATE</span>
            <input
              type="date"
              value={activeTargetDate}
              min={allScheduleDates[0]}
              max={maxSelectableDate}
              onChange={(event) => onSelectDate(event.target.value)}
              className="border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-2 py-1.5 t-stat-sm text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
            />
          </label>

          <RetroButton variant="default" onClick={onSimulateNextPlayoffGame} disabled={simControlsLocked}>
            <Play className="h-4 w-4" /> Sim Next Game
          </RetroButton>
          <RetroButton
            variant="primary"
            onClick={() => onSimulateToDate(activeTargetDate)}
            disabled={simControlsLocked || !canSimToTargetDate}
          >
            <CalendarDays className="h-4 w-4" /> Sim To Date
          </RetroButton>
          <RetroButton
            variant="default"
            onClick={() => nextPlayoffDate && onSimulateToDate(nextPlayoffDate)}
            disabled={simControlsLocked || !nextPlayoffDate}
          >
            <SkipForward className="h-4 w-4" /> Next Playoff Day
          </RetroButton>
          <RetroButton variant="ghost" onClick={onCancelSimulation} disabled={!isSimulating}>
            <PauseCircle className="h-4 w-4" /> Stop
          </RetroButton>
        </div>

        <div className="border-t border-[var(--color-chrome-lo)] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="t-caption text-[var(--color-ink-faint)]">PLAYOFF GAME QUEUE</p>
            <p className="t-caption text-[var(--color-ink-faint)]">{upcomingPlayoffGames.length} SCHEDULED</p>
          </div>
          {gameQueue.length > 0 ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {gameQueue.map((game) => {
                const awayTeam = teamsById.get(game.awayTeam) ?? null;
                const homeTeam = teamsById.get(game.homeTeam) ?? null;
                return (
                  <button
                    key={game.gameId}
                    type="button"
                    onClick={() => onSimulateToGame(game.gameId)}
                    disabled={simControlsLocked}
                    className="min-w-[200px] shrink-0 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-panel-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
                  >
                    <p className="t-caption text-[var(--color-ink-faint)]">
                      {formatHeaderDate(game.date)} · G{game.playoff?.gameNumber ?? '?'}
                    </p>
                    <p className="mt-1 truncate t-label text-[var(--color-gold)]">
                      {game.playoff?.seriesLabel ?? 'Playoff'}
                    </p>
                    <p className="mt-1 truncate t-stat-sm">
                      {(awayTeam?.city ?? game.awayTeam)} @ {(homeTeam?.city ?? game.homeTeam)}
                    </p>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 t-caption text-[var(--color-ink-faint)]">No playoff games are currently scheduled.</p>
          )}
        </div>
      </Panel>

      {/* Full width rather than side by side. Two five-round brackets abreast
          would leave roughly 150px per series card, which cannot hold a logo, a
          city name and a series record -- and the connector layer is the reason
          the bracket is worth building this way in the first place. */}
      <LeagueSection bracket={bracket.platinum} league="Platinum" pipFill="bg-[var(--color-platinum)]" />

      <LeagueSection bracket={bracket.prestige} league="Prestige" pipFill="bg-[var(--color-prestige)]" />

      <WorldSeriesShowcase
        series={bracket.worldSeries}
        platinumChampion={bracket.platinum.champion}
        prestigeChampion={bracket.prestige.champion}
        overallChampion={bracket.champion}
      />
    </section>
  );
};
