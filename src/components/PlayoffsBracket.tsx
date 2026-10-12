import React, { useMemo } from 'react';
import { PauseCircle, SkipForward } from 'lucide-react';
import { Game, PlayoffRoundKey, Team } from '../types';
import { SeededPlayoffTeam, compareSeededTeams, getLeaguePlayoffSeeds, getRoundBestOf, isPlayoffGame } from '../logic/playoffs';
import { addDaysToISODate } from '../logic/simulation';
import { fmtDiff, fmtRecord } from '../logic/statFormatting';
import { formatHeaderDate } from './SeasonCalendarStrip';
import { LeagueBadge, Panel, RetroButton, StatValue, TeamLogo } from './ui';
import worldSeriesLogo from '../assets/worldserieslogo.png';
import gpbLogo from '../assets/gpb.png';
import playoffsLogo from '../assets/playoffs.png';
import trophyImage from '../assets/trophy.png';

interface PlayoffsBracketProps {
  teams: Team[];
  games: Game[];
  currentDate: string;
  selectedDate: string;
  isSimulating: boolean;
  onSimulateToDate: (targetDate: string) => void;
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
 * Seed badge -- skewed chip, ALWAYS in the league's own colour.
 *
 * This used to force seeds 1 and 2 to gold on the reasoning that "a top-two seed is the only
 * seeding distinction that means something postseason". That was wrong for a bracket with two
 * leagues: a seed-1 in Prestige and a seed-1 in Platinum were both gold, so the two best clubs in
 * the league were the one pair a reader could not tell apart. League colour now comes first, and gold
 * is reserved for LEADING a series -- the distinction that actually changes what happens next. The
 * leader is marked on the ROW (gold left edge, `panel-3` fill, gold city), not on the seed.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COLOUR IS ON AN INNER ELEMENT AND NOT ON THE CHIP
 * ---------------------------------------------------------------------------
 * This chip was invisible for a leading team and nobody caught it in review, because the markup reads
 * correctly: a coloured chip with a digit on it. It is `skew-shadow` that breaks it.
 *
 * `skew-shadow` is a WRAPPER pattern. Its `::before` is a positioned, zero-inset child box filled with
 * `--color-void` and offset 4px, and its intent is the hard offset shadow the whole app uses. The
 * catch is paint order: a positioned child box paints ABOVE its parent's own background. Put the league
 * colour on the same element as `skew-shadow` and that colour is covered by the shadow -- what is left
 * is a 4px fringe along the top and left, and a void interior.
 *
 * Worse, the leading digit was `--color-ink-invert`, which is `#05070d`, and `--color-void` is
 * `#05070d`. Measured on a live bracket with a series in progress: 8 of 24 chips, every one of them a
 * leading team, painted their digit at **1.00:1** against the surface covering them. The trailing chips
 * happened to survive on `ink-dim` at 7.75:1, which is why the defect looked like it only struck the
 * teams in front.
 *
 * So the colour goes on an inner element that fills the wrapper, which is exactly how `SkewedTab` and
 * `SkewedPanel` use the same utility. With the league colour genuinely painted, `ink-invert` is the
 * right digit ink for both leagues -- 7.80:1 on platinum teal, 8.70:1 on prestige brass -- and it is the
 * same ink `LeagueBadge` uses on the identical colours, so a seed chip and a league chip agree.
 *
 * The old `dimmed` prop is gone rather than re-tuned. It existed only to change the digit's ink, and on
 * these two chip colours there is no second ink that is both dimmer and still readable: `ink-dim` measures
 * 1.01:1 on teal and 1.12:1 on brass. A seed is a fact about the club, not a status, so it should not
 * change colour with the series.
 */
const SeedBadge: React.FC<{ seed: number; league: AnyLeague }> = ({ seed, league }) => {
  const fill = league === 'Prestige' ? 'bg-[var(--color-prestige)]' : 'bg-[var(--color-platinum)]';
  return (
    <span
      className="skew-shadow relative inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center"
      aria-label={`Seed ${seed}`}
    >
      <span
        className={`relative z-10 inline-flex h-full w-full items-center justify-center ${fill} text-[var(--color-ink-invert)]`}
      >
        <span className="t-stat">{seed}</span>
      </span>
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
        <span className="h-12 w-12 shrink-0 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="t-caption text-[var(--color-ink-faint)]">TBD</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 border-l-[3px] px-2 py-2 ${
        isLeader
          ? 'border-l-[var(--color-gold)] bg-[var(--color-panel-3)]'
          : 'border-l-transparent'
      }`}
    >
      <SeedBadge seed={participant.seed} league={league} />
      <TeamLogo team={participant.team} sizeClass="h-12 w-12" />
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
 *
 * The live treatment is now only the gold left edge, the leading row's gold left
 * edge, and the IN PROGRESS label in the header. It used to also print a stakes
 * footer -- "Match point - X needs one more", "leads 2-1, first to 4", and
 * "{City} eliminated" -- plus a "1 from 3" tag beside each club's win count.
 *
 * All of that was a restatement of two numbers already on the card. The wins are
 * printed, and the series length is drawn as one diamond per game, so a reader
 * deriving "2-1 with three diamonds" needs no prose to know a team is one win
 * from ending it. The prose was redundant on a card whose entire job is to be
 * scanned, and it crowded out the increment the card is actually for.
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
      <Panel
        className={`relative overflow-hidden ${
          isLive ? 'border-l-[3px] border-l-[var(--color-gold)]' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-chrome-lo)] px-3 py-2">
          <h3 className="t-label">{roundTitles[series.round]}</h3>
          <div className="flex items-center gap-2">
            {isLive && (
              <span className="inline-flex h-[22px] items-center bg-[var(--color-gold)] px-2">
                <span className="t-caption text-[var(--color-ink-invert)]">In Progress</span>
              </span>
            )}
          </div>
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

        {isLive ? null : (
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

const LeagueBracketDesktop: React.FC<{
  bracket: LeagueBracketView;
  league: AnyLeague;
  pipFill: string;
  flipped?: boolean;
}> = ({
  bracket,
  league,
  pipFill,
  flipped = false,
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
      {/*
        THE MIRROR, AND IT IS TWO LINES.

        Each card sits at the top of its grid cell and is pushed down by a padding offset, so the league
        series is the lowest card on the bracket and the wild cards are the highest. Swapping which round
        carries which offset flips the whole thing vertically: the league series moves to the top, the
        wild cards to the bottom, the divisionals stay put in the middle. Nothing about the column order
        changes, so the connectors -- which are measured from the DOM by `BracketConnectors`, not drawn to
        fixed coordinates -- re-route themselves onto the new positions without being told.
      */}
      <div className="relative grid grid-cols-5 gap-6">
        {card(bracket.wildCard[0], flipped ? 'pt-32' : '')}
        {card(bracket.divisional[0], 'pt-16')}
        {card(bracket.leagueSeries, flipped ? '' : 'pt-32')}
        {card(bracket.divisional[1], 'pt-16')}
        {card(bracket.wildCard[1], flipped ? 'pt-32' : '')}
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
const LeagueBracketStacked: React.FC<{
  bracket: LeagueBracketView;
  league: AnyLeague;
  pipFill: string;
  flipped?: boolean;
}> = ({ bracket, league, pipFill, flipped = false }) => {
  const groups: Array<{ title: string; series: BracketSeriesView[] }> = [
    { title: 'Wild Card', series: [...bracket.wildCard] },
    { title: 'Divisional', series: [...bracket.divisional] },
    { title: 'League Series', series: [bracket.leagueSeries] },
  ];
  // The same mirror the desktop bracket gets: the league series leads, the wild cards close it out, so
  // the two league brackets read the same way on a phone as they do on a desk.
  if (flipped) groups.reverse();

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

const LeagueSection: React.FC<{
  bracket: LeagueBracketView;
  league: AnyLeague;
  pipFill: string;
  flipped?: boolean;
}> = ({ bracket, league, pipFill, flipped = false }) => {
  const pipFillVar = league === 'Prestige' ? 'bg-[var(--color-prestige)]' : 'bg-[var(--color-platinum)]';

  return (
    <Panel className="overflow-hidden">
      {/*
        THE HEADER CARRIES THE LEAGUE, NOT THE TOP SEED.

        It read "TOP SEED" over the league's best club's full name. Three things are wrong with that on
        this screen: the seeds are printed on every card in the bracket below, so the header restated the
        most visible thing on it; it named the league's best club before a single game was played, which
        is a promise the bracket may not keep; and it was the only place on the section that could have
        said WHICH LEAGUE this was in anything but plain white text.

        The `LeagueBadge` that replaces it is the same chip the power rankings, the club page and the
        standings use beside a club's name, so the two leagues are identified here by the same object
        that identifies them everywhere else. It is an identity chip and not an accent, which matters:
        prestige brass measures 1.52:1 from this app's gold, so a prestige-tinted accent here would be
        indistinguishable from the gold that marks a leader. The chip is filled with dark text at 8.70:1,
        so it states the league without arguing with anything else on the screen.
      */}
      <div className="chrome-bar flex flex-wrap items-center gap-3 px-4">
        <h2 className="t-h2">{bracket.league} League</h2>
        <LeagueBadge variant={league === 'Prestige' ? 'prestige' : 'platinum'} size="sm" />
      </div>
      <div className="flex flex-col gap-5 p-4">
        <LeagueBracketDesktop bracket={bracket} league={league} pipFill={pipFillVar} flipped={flipped} />
        <LeagueBracketStacked bracket={bracket} league={league} pipFill={pipFillVar} flipped={flipped} />
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
  const alignRight = align === 'right';

  if (!participant) {
    return (
      <div className={`flex flex-col gap-3 ${alignRight ? 'items-end text-right' : 'items-start text-left'}`}>
        <p className="t-caption text-[var(--color-ink-faint)]">{leagueLabel}</p>
        <span className="h-24 w-24 border border-dashed border-[var(--color-chrome-lo)]" aria-hidden="true" />
        <p className="t-h3 text-[var(--color-ink-dim)]">Awaiting Winner</p>
      </div>
    );
  }

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col gap-3 ${
        alignRight ? 'items-end text-right' : 'items-start text-left'
      } ${isWinner ? 'border-l-[3px] border-l-[var(--color-gold)] pl-3' : ''}`}
    >
      <span className={`t-label ${isWinner ? 'text-[var(--color-gold)]' : 'text-[var(--color-ink-dim)]'}`}>
        {leagueLabel}
      </span>
      <TeamLogo team={participant.team} sizeClass="h-32 w-32" />
      <div className="min-w-0">
        <p className={`truncate t-h1 ${isWinner ? 'text-[var(--color-gold-hi)]' : ''}`}>{participant.team.city}</p>
        <p className="truncate t-h3 mt-1 text-[var(--color-ink-dim)]">{participant.team.name}</p>
        <p className="t-caption mt-1.5 text-[var(--color-ink-faint)]">
          {fmtRecord(participant.wins, participant.losses)} · RD {fmtDiff(participant.runDiff)}
        </p>
      </div>
      <SeriesPips wins={wins} bestOf={bestOf} fill={pipFill} size="md" />
    </div>
  );
};

/**
 * World Series -- the climax of the screen and the one element permitted to
 * break the bracket's column symmetry.
 *
 * Rebuilt after the first full-season playthrough, where it read as two grey
 * cards and a trophy rather than a championship. Three changes: the two
 * finalists now sit on either side of a single large score, so the contest is
 * legible at a glance rather than having to be assembled by reading two separate
 * cards; the World Series mark is a masthead at 120px instead of a 32px
 * thumbnail buried in a chrome bar; and the champion block below states the
 * result in display type instead of a label and a crest.
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
  const decided = Boolean(overallChampion);

  return (
    <Panel variant="hero" className="overflow-hidden">
      {/* Masthead. The mark is the identity of this event and was previously a
          32px thumbnail sharing a bar with a heading. The wordmark is the only
          text here: the "World Series / Best of 7 / Awaiting Champions" stack
          underneath it repeated what the artwork says and then added a status
          line that duplicated the series score already shown below. */}
      <div className="flex items-center justify-center border-b border-[var(--color-gold-dim)] bg-[var(--color-base-2)] px-4 py-8">
        <img
          src={worldSeriesLogo}
          alt="GPB World Series"
          className="h-32 w-auto object-contain md:h-40"
        />
      </div>

      <div className="flex flex-col items-stretch gap-4 p-5 md:flex-row md:items-center md:gap-6">
        <WorldSeriesTeamPanel
          participant={platinumChampion}
          wins={platinumWins}
          bestOf={series.bestOf}
          leagueLabel="Platinum Champion"
          align="left"
          isWinner={platinumWinner}
          pipFill="bg-[var(--color-platinum)]"
        />

        {/* One score, centred between the two finalists, rather than a win count
            on each card that the reader has to pair up. */}
        <div className="flex shrink-0 flex-col items-center justify-center gap-1 px-2">
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className={`t-stat-lg ${platinumWins > prestigeWins ? 'text-[var(--color-gold-hi)]' : 'text-[var(--color-ink-dim)]'}`}>
              {platinumChampion ? platinumWins : '–'}
            </span>
            <span className="t-h2 text-[var(--color-chrome-hi)]">–</span>
            <span className={`t-stat-lg ${prestigeWins > platinumWins ? 'text-[var(--color-gold-hi)]' : 'text-[var(--color-ink-dim)]'}`}>
              {prestigeChampion ? prestigeWins : '–'}
            </span>
          </div>
          <span className="t-caption text-[var(--color-ink-faint)]">Series</span>
        </div>

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

      <div className="border-t border-[var(--color-gold-dim)] bg-[var(--color-base-2)] px-4 py-8">
        {/*
          THE PRIZE, AND WHY IT IS HERE RATHER THAN IN THE HEADER.

          The bracket is the one screen in the product where thirty-two clubs are doing something and
          nothing on it says what they are doing it for. The wordmark above names the event; it does not
          put anything in it. So this block -- the empty case at the foot of the World Series -- is
          where the trophy belongs: it is literally the case somebody is going to fill, and until they
          do it is sitting there waiting, which is the whole feeling the bracket was missing.

          Sizing is driven by the artwork's shape rather than by a square. It is 1492x2676, portrait and
          narrow, so it is sized by HEIGHT and given `w-auto`, and the flex column centres it. A width-
          sized trophy here would have been a wide, short smudge on a tall pedestal-shaped object.

          It is dimmed while unclaimed and full-strength once somebody has it, which is the same signal
          the rest of the screen uses for decided and undecided, so the two agree without a label.
        */}
        <div className="flex flex-col items-center gap-3 text-center">
          <img
            src={trophyImage}
            alt=""
            aria-hidden="true"
            className={`h-40 w-auto object-contain drop-shadow-[0_10px_22px_rgba(0,0,0,0.45)] md:h-52 ${
              overallChampion ? '' : 'opacity-55'
            }`}
          />
          {overallChampion ? (
            <>
              <p className="t-label text-[var(--color-ink-dim)]">World Series Champion</p>
              <TeamLogo team={overallChampion.team} sizeClass="h-28 w-28" />
              <p className="t-display text-[var(--color-gold-hi)]">{overallChampion.team.city}</p>
              <p className="t-h1 text-[var(--color-gold)]">{overallChampion.team.name}</p>
              <p className="t-caption text-[var(--color-ink-dim)]">
                {fmtRecord(overallChampion.wins, overallChampion.losses)} · RD {fmtDiff(overallChampion.runDiff)}
              </p>
            </>
          ) : (
            <>
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
  currentDate,
  selectedDate,
  isSimulating,
  onSimulateToDate,
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
  const nextPlayoffDate = upcomingPlayoffGames[0]?.date ?? null;
  const gameQueue = upcomingPlayoffGames.slice(0, 12);

  /*
    `firstScheduledPlayoffDate`, `completedPlayoffGames` and `bracketStatusCopy` are gone with the
    status caption they fed. Left in place they would have been three useMemos running on every render
    to compute a string nobody printed -- and worse, `bracketStatusCopy` had a fourth branch to keep
    current, so it was a place a stale sentence could have lived without anyone noticing it was no
    longer read.
  */
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
            {/*
              NO TITLE BLOCK, BECAUSE THE WORDMARK ALREADY IS THE TITLE.

              This band carried the scripted `playoffsLogo` wordmark immediately followed by an `h1`
              reading "Playoffs" and a status caption underneath it -- the screen announcing its own name
              twice, in two typefaces, one of them the actual design asset.

              The caption is the worse of the two. "Playoff field projected. Simulate forward to begin
              bracket games" restates what the bracket already says: empty division slots read TBD, the
              league sections print the seeds, and the game queue prints the scheduled count. A sentence
              summarising what is on screen is also the kind that goes stale -- it was derived from four
              separate signals and had to be re-derived whenever any of them moved.
            */}
            {/*
              THE PRIZE, IN THE MASTHEAD, FROM THE FIRST ROUND.

              The World Series block below only mounts once a league champion exists, so a trophy living
              only there is invisible for the division series and the league championships -- which is
              most of the bracket, and precisely the part where thirty-two clubs are still working their
              way toward it. This is the same object at masthead scale, after a divider, so the band reads
              left to right as logos, then the event, then the thing being fought over.

              Sized by height for the same reason as the large one: the artwork is portrait and narrow,
              and `w-auto` keeps that shape instead of stretching it into a wide, short smudge.

              Dimmed by OPACITY only. A first pass also dropped saturation, which turned the gold into silver
              and quietly changed the object: a trophy is a gold object, and desaturating it to read as
              "unclaimed" is a different claim from the one being made. Faded gold still reads as gold
              sitting on a shelf; grey reads as a pewter ornament.
            */}
            <span className="h-16 w-px self-stretch bg-[var(--color-chrome-lo)] md:h-20" aria-hidden="true" />
            <img
              src={trophyImage}
              alt=""
              aria-hidden="true"
              className={`h-16 w-auto object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)] md:h-20 ${
                bracket.champion ? '' : 'opacity-60'
              }`}
            />
          </div>
          <div className="text-right">
            <p className="t-caption text-[var(--color-ink-faint)]">NEXT PLAYOFF DATE</p>
            <p className="t-stat-lg text-[var(--color-gold)]">
              {nextPlayoffDate ? formatHeaderDate(nextPlayoffDate) : 'NONE SCHEDULED'}
            </p>
          </div>
        </div>

        {/*
          ONE CONTROL, AND IT IS A DAY NOT A GAME.

          This row had a date picker, "Sim Next Game", "Sim To Date" and "Next Playoff Day" in a row,
          which is three different notions of "advance the league" sitting shoulder to shoulder. Three of
          them are gone.

          The date input went with "Sim To Date", which was its only consumer -- leaving a picker that
          set a value nothing read. "Sim Next Game" went because it and "Next Playoff Day" sat adjacent
          and meant different amounts of movement, which is the whole reason the second one reads as a
          bug (see the note on its scope below).

          `shape="parallelogram"` rather than the default chevron: this is the one forward action on the
          screen, and the chevron is used by every other primary button in the product, so it stopped
          meaning "the thing to press here" the moment it joined the others.
        */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <RetroButton
            variant="primary"
            shape="parallelogram"
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
                /*
                  THE CRESTS CARRY THE MATCHUP; THE NAMES GO ON THE HOVER.

                  "Aerial City @ Duskcove Mustangs" is eleven words to say what two logos say
                  instantly, and in a horizontal queue that width is what forced the minimum card size
                  and truncated the longer club names. The marks are also how the rest of this screen
                  identifies a club -- every bracket card is a crest and a score -- so the queue was the
                  one place breaking the visual language of the page it sits on.

                  Not lost, though: both names are the button's accessible name and its tooltip, so a
                  screen reader and a hover both get the full answer. `TeamLogo`'s own alt carries the
                  club name for the images.
                */
                const matchupLabel = `${awayTeam ? `${awayTeam.city} ${awayTeam.name}` : game.awayTeam} at ${
                  homeTeam ? `${homeTeam.city} ${homeTeam.name}` : game.homeTeam
                }`;
                return (
                  <button
                    key={game.gameId}
                    type="button"
                    onClick={() => onSimulateToGame(game.gameId)}
                    disabled={simControlsLocked}
                    title={matchupLabel}
                    aria-label={`${game.playoff?.seriesLabel ?? 'Playoff'} game ${game.playoff?.gameNumber ?? ''}: ${matchupLabel}`}
                    className="flex min-w-[188px] shrink-0 flex-col gap-2 border border-[var(--color-chrome-lo)] bg-[var(--color-sunken)] px-3 py-2 text-left transition-colors hover:border-[var(--color-gold-lo)] hover:bg-[var(--color-panel-2)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-gold)]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="t-caption text-[var(--color-ink-faint)]">
                        {formatHeaderDate(game.date)}
                      </span>
                      <span className="t-caption shrink-0 text-[var(--color-ink-faint)]">
                        G{game.playoff?.gameNumber ?? '?'}
                      </span>
                    </div>
                    <p className="truncate t-label text-[var(--color-gold)]">
                      {game.playoff?.seriesLabel ?? 'Playoff'}
                    </p>
                    <div className="flex items-center gap-2">
                      {awayTeam ? <TeamLogo team={awayTeam} sizeClass="h-9 w-9" /> : null}
                      <span className="t-caption text-[var(--color-ink-faint)]" aria-hidden="true">@</span>
                      {homeTeam ? <TeamLogo team={homeTeam} sizeClass="h-9 w-9" /> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 t-caption text-[var(--color-ink-faint)]">No playoff games are currently scheduled.</p>
          )}
        </div>
      </Panel>

      {/* The World Series floats to the top of the screen as soon as either
          league has a champion. Before that it is a placeholder, so it belongs
          after the brackets where it costs nothing; the moment a finalist
          exists the actual final is the most important thing on the page and
          should not require scrolling past two full brackets to find. Keyed on
          the champion ids so it promotes once and stays put. */}
      {(bracket.platinum.champion || bracket.prestige.champion) && (
        <WorldSeriesShowcase
          series={bracket.worldSeries}
          platinumChampion={bracket.platinum.champion}
          prestigeChampion={bracket.prestige.champion}
          overallChampion={bracket.champion}
        />
      )}

      {/* Full width rather than side by side. Two five-round brackets abreast
          would leave roughly 150px per series card, which cannot hold a logo, a
          city name and a series record -- and the connector layer is the reason
          the bracket is worth building this way in the first place. */}
      {/*
        THE TWO LEAGUES MIRROR EACH OTHER, WHICH IS WHAT MAKES THIS A TOURNAMENT.

        Stacked one above the other, both brackets running the same way leaves two identical ladders. A
        tournament reads because the two halves face each other: the rounds narrow toward a shared
        middle. So the Prestige bracket is flipped vertically -- its League Series card at the TOP, its
        wild cards at the bottom -- and the two league finals come to rest opposite one another in the
        middle of the screen, with the World Series above them waiting for exactly those two clubs.

        Only the vertical offsets swap; the columns stay in the same order, so the connector layer, which
        measures the cards rather than assuming their positions, redraws the paths onto the new geometry
        without any change of its own.
      */}
      <LeagueSection bracket={bracket.platinum} league="Platinum" pipFill="bg-[var(--color-platinum)]" />

      <LeagueSection
        bracket={bracket.prestige}
        league="Prestige"
        pipFill="bg-[var(--color-prestige)]"
        flipped
      />

      {!(bracket.platinum.champion || bracket.prestige.champion) && (
        <WorldSeriesShowcase
          series={bracket.worldSeries}
          platinumChampion={null}
          prestigeChampion={null}
          overallChampion={null}
        />
      )}
    </section>
  );
};
