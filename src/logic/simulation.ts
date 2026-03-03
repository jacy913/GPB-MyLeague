import { Game, SimulationSettings, Team } from '../types';

// Constants (Defaults)
export const DEFAULT_SETTINGS: SimulationSettings = {
  continuityWeight: 0.6,
  winLossVariance: 4,
  homeFieldAdvantage: 0.025,
  gameLuckFactor: 0.08,
  leagueEnvironmentBalance: 0.5,
  battingVarianceFactor: 0.5,
};

export const GAMES_PER_SEASON = 154;
export const SEASON_CALENDAR_DAYS = 180;
const MEAN_WINS = GAMES_PER_SEASON / 2;
const MAX_WINS_FROM_MEAN = 18; // Hard cap to avoid extreme team ratings.
const MAX_GAMES_PER_DAY = 16; // 32 teams => 16 games max/day.

const INTERLEAGUE_DIVISION_PAIRING: Record<Team['division'], Team['division']> = {
  North: 'North',
  South: 'South',
  East: 'East',
  West: 'West',
};

interface ScheduleOptions {
  seasonStartDate?: string; // YYYY-MM-DD
  seasonDays?: number;
}

interface GameTemplate {
  homeTeam: string;
  awayTeam: string;
}

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const addDaysToISODate = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
};

export const getDefaultSeasonStartDate = (year = new Date().getFullYear()): string => `${year}-04-01`;

// Helper to generate normal distribution random number.
const randomNormal = (mean: number, stdDev: number): number => {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
};

// Recalculate team ratings based on settings.
export const recalculateTeamRatings = (teams: Team[], settings: SimulationSettings): Team[] => {
  return teams.map((team) => {
    // Blend historical baseline and random performance.
    const randomWins = randomNormal(MEAN_WINS, settings.winLossVariance);
    const targetWins = team.previousBaselineWins * settings.continuityWeight + randomWins * (1 - settings.continuityWeight);

    // Keep baseline power spread realistic so 100-win teams stay rare.
    const boundedWins = Math.max(MEAN_WINS - MAX_WINS_FROM_MEAN, Math.min(MEAN_WINS + MAX_WINS_FROM_MEAN, targetWins));
    const winsDelta = boundedWins - MEAN_WINS;

    // Map to a compact strength range to avoid runaway win probabilities.
    const newRating = Math.max(35, Math.min(65, 50 + winsDelta * 1.2));

    return { ...team, rating: newRating };
  });
};

const getElo = (rating: number) => rating * 8 + 1200;

const calculateWinProbability = (homeRating: number, awayRating: number, hfa: number): number => {
  const homeElo = getElo(homeRating);
  const awayElo = getElo(awayRating);
  const exponent = (awayElo - homeElo) / 500;
  let prob = 1 / (1 + Math.pow(10, exponent));

  // Apply HFA
  prob += hfa;
  return Math.max(0.01, Math.min(0.99, prob));
};

const calculateRuns = (teamRating: number, oppRating: number, isHome: boolean, luckFactor: number): number => {
  const baseRuns = 4.5;
  const ratingDiff = teamRating - oppRating;

  // Luck factor adds noise to the lambda.
  const noise = (Math.random() - 0.5) * 2 * luckFactor; // -luck to +luck
  const lambda = baseRuns + ratingDiff * 0.03 + (isHome ? 0.12 : -0.12) + noise;

  const L = Math.exp(-Math.max(0.5, lambda));
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= Math.random();
  } while (p > L);

  return k - 1;
};

const calculateEnvironmentAdjustedRuns = (
  teamRating: number,
  oppRating: number,
  isHome: boolean,
  luckFactor: number,
  environmentBalance: number,
): number => {
  const offenseBias = (0.5 - environmentBalance) * 2;
  const baseRuns = 4.45 + offenseBias * 0.65;
  const ratingDiff = teamRating - oppRating;
  const noise = (Math.random() - 0.5) * 2 * luckFactor;
  const lambda = baseRuns + ratingDiff * 0.03 + (isHome ? 0.12 : -0.12) + noise;

  const L = Math.exp(-Math.max(0.5, lambda));
  let k = 0;
  let p = 1;

  do {
    k++;
    p *= Math.random();
  } while (p > L);

  return k - 1;
};

export const simulateGame = (
  homeTeam: Team,
  awayTeam: Team,
  settings: SimulationSettings,
): { homeScore: number; awayScore: number; winProbHome: number } => {
  const winProb = calculateWinProbability(homeTeam.rating, awayTeam.rating, settings.homeFieldAdvantage);

  // Add small game-level probability noise for upset volatility.
  const probNoise = (Math.random() - 0.5) * settings.gameLuckFactor * 0.08;
  const finalProb = Math.max(0.01, Math.min(0.99, winProb + probNoise));
  const homeWins = Math.random() < finalProb;

  let homeScore = calculateEnvironmentAdjustedRuns(
    homeTeam.rating,
    awayTeam.rating,
    true,
    settings.gameLuckFactor,
    settings.leagueEnvironmentBalance,
  );
  let awayScore = calculateEnvironmentAdjustedRuns(
    awayTeam.rating,
    homeTeam.rating,
    false,
    settings.gameLuckFactor,
    settings.leagueEnvironmentBalance,
  );

  if (homeWins && homeScore <= awayScore) {
    homeScore = awayScore + 1 + Math.floor(Math.random() * 2);
  } else if (!homeWins && awayScore <= homeScore) {
    awayScore = homeScore + 1 + Math.floor(Math.random() * 2);
  }

  if (homeScore === awayScore) {
    if (homeWins) {
      homeScore++;
    } else {
      awayScore++;
    }
  }

  return { homeScore, awayScore, winProbHome: finalProb };
};

const hashPair = (a: string, b: string): number => {
  const combined = [a, b].sort().join('|');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * 31 + combined.charCodeAt(i)) % 2147483647;
  }
  return hash;
};

const shuffleArray = <T,>(items: T[]): T[] => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const areInterleaguePaired = (teamA: Team, teamB: Team): boolean =>
  teamA.league !== teamB.league &&
  INTERLEAGUE_DIVISION_PAIRING[teamA.division] === teamB.division &&
  INTERLEAGUE_DIVISION_PAIRING[teamB.division] === teamA.division;

const getMatchupGameCount = (teamA: Team, teamB: Team): number => {
  if (teamA.league === teamB.league) {
    return teamA.division === teamB.division ? 18 : 7;
  }

  return areInterleaguePaired(teamA, teamB) ? 4 : 0;
};

const buildGameTemplates = (teams: Team[]): GameTemplate[] => {
  const templates: GameTemplate[] = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const teamA = teams[i];
      const teamB = teams[j];
      const gameCount = getMatchupGameCount(teamA, teamB);

      if (gameCount <= 0) {
        continue;
      }

      const pairHash = hashPair(teamA.id, teamB.id);
      for (let gameIndex = 0; gameIndex < gameCount; gameIndex++) {
        const homeIsA = (pairHash + gameIndex) % 2 === 0;
        templates.push({
          homeTeam: homeIsA ? teamA.id : teamB.id,
          awayTeam: homeIsA ? teamB.id : teamA.id,
        });
      }
    }
  }

  return templates;
};

const pickBestDayForGame = (
  template: GameTemplate,
  teamBusyByDay: Map<string, boolean[]>,
  dayLoad: number[],
  seasonDays: number,
  allowSoftCapOverflow: boolean,
): number => {
  const homeBusy = teamBusyByDay.get(template.homeTeam);
  const awayBusy = teamBusyByDay.get(template.awayTeam);
  if (!homeBusy || !awayBusy) {
    return -1;
  }

  let bestDay = -1;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let day = 0; day < seasonDays; day++) {
    if (homeBusy[day] || awayBusy[day]) {
      continue;
    }

    if (dayLoad[day] >= MAX_GAMES_PER_DAY) {
      continue;
    }

    const softCap = day % 7 === 6 ? 9 : day % 7 === 5 ? 11 : 15;
    if (!allowSoftCapOverflow && dayLoad[day] >= softCap) {
      continue;
    }

    const prevPenalty =
      (day > 0 && homeBusy[day - 1] ? 1 : 0) + (day > 0 && awayBusy[day - 1] ? 1 : 0);
    const score = dayLoad[day] * 1.5 + prevPenalty * 3 + Math.random() * 0.2;

    if (score < bestScore) {
      bestScore = score;
      bestDay = day;
    }
  }

  return bestDay;
};

const validateSchedule = (games: Game[], teams: Team[]): void => {
  const gamesPerTeam = new Map<string, number>(teams.map((team) => [team.id, 0]));
  const seenByDay = new Map<string, Set<string>>();

  games.forEach((game) => {
    gamesPerTeam.set(game.homeTeam, (gamesPerTeam.get(game.homeTeam) ?? 0) + 1);
    gamesPerTeam.set(game.awayTeam, (gamesPerTeam.get(game.awayTeam) ?? 0) + 1);

    const key = game.date;
    const dayTeams = seenByDay.get(key) ?? new Set<string>();
    dayTeams.add(game.homeTeam);
    dayTeams.add(game.awayTeam);
    seenByDay.set(key, dayTeams);
  });

  const invalidTeams = Array.from(gamesPerTeam.entries()).filter(([, count]) => count !== GAMES_PER_SEASON);
  if (invalidTeams.length > 0) {
    throw new Error(`Invalid schedule generated; team game counts mismatch: ${JSON.stringify(invalidTeams)}`);
  }
};

export const generateSchedule = (teams: Team[], options: ScheduleOptions = {}): Game[] => {
  if (teams.length < 2 || teams.length % 2 !== 0) {
    return [];
  }

  const seasonDays = options.seasonDays ?? SEASON_CALENDAR_DAYS;
  const seasonStartDate = options.seasonStartDate ?? getDefaultSeasonStartDate();
  const baseTemplates = buildGameTemplates(teams);

  for (let attempt = 0; attempt < 20; attempt++) {
    const teamBusyByDay = new Map<string, boolean[]>();
    teams.forEach((team) => {
      teamBusyByDay.set(team.id, new Array(seasonDays).fill(false));
    });

    const dayLoad = new Array<number>(seasonDays).fill(0);
    const dayBuckets: GameTemplate[][] = Array.from({ length: seasonDays }, () => []);
    const templates = shuffleArray(baseTemplates);
    let placementFailed = false;

    for (const template of templates) {
      let day = pickBestDayForGame(template, teamBusyByDay, dayLoad, seasonDays, false);
      if (day < 0) {
        day = pickBestDayForGame(template, teamBusyByDay, dayLoad, seasonDays, true);
      }

      if (day < 0) {
        placementFailed = true;
        break;
      }

      dayBuckets[day].push(template);
      dayLoad[day] += 1;

      const homeBusy = teamBusyByDay.get(template.homeTeam);
      const awayBusy = teamBusyByDay.get(template.awayTeam);
      if (!homeBusy || !awayBusy) {
        continue;
      }
      homeBusy[day] = true;
      awayBusy[day] = true;
    }

    if (placementFailed) {
      continue;
    }

    const games: Game[] = [];
    let gameCounter = 1;

    dayBuckets.forEach((bucket, day) => {
      const date = addDaysToISODate(seasonStartDate, day);
      bucket
        .sort((a, b) => `${a.homeTeam}-${a.awayTeam}`.localeCompare(`${b.homeTeam}-${b.awayTeam}`))
        .forEach((template) => {
          games.push({
            gameId: `g-${String(gameCounter).padStart(5, '0')}`,
            date,
            homeTeam: template.homeTeam,
            awayTeam: template.awayTeam,
            phase: 'regular_season',
            status: 'scheduled',
            score: { home: 0, away: 0 },
            playoff: null,
            stats: {},
          });
          gameCounter++;
        });
    });

    validateSchedule(games, teams);
    return games.sort((a, b) => (a.date === b.date ? a.gameId.localeCompare(b.gameId) : a.date.localeCompare(b.date)));
  }

  throw new Error(`Unable to generate valid ${GAMES_PER_SEASON}-game schedule in ${seasonDays} days after retries.`);
};
