import { Team, Game, SimulationSettings } from '../types';

// Constants (Defaults)
export const DEFAULT_SETTINGS: SimulationSettings = {
  continuityWeight: 0.6,
  winLossVariance: 4,
  homeFieldAdvantage: 0.025,
  gameLuckFactor: 0.08,
};

const GAMES_PER_SEASON = 154;
const MEAN_WINS = GAMES_PER_SEASON / 2;
const MAX_WINS_FROM_MEAN = 18; // Hard cap to avoid extreme team ratings.

// Helper to generate normal distribution random number
const randomNormal = (mean: number, stdDev: number): number => {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdDev + mean;
};

// Recalculate team ratings based on settings
export const recalculateTeamRatings = (teams: Team[], settings: SimulationSettings): Team[] => {
  return teams.map(team => {
    // Blend historical baseline and random performance.
    const randomWins = randomNormal(MEAN_WINS, settings.winLossVariance);
    const targetWins =
      (team.previousBaselineWins * settings.continuityWeight) +
      (randomWins * (1 - settings.continuityWeight));

    // Keep baseline power spread realistic so 100-win teams stay rare.
    const boundedWins = Math.max(MEAN_WINS - MAX_WINS_FROM_MEAN, Math.min(MEAN_WINS + MAX_WINS_FROM_MEAN, targetWins));
    const winsDelta = boundedWins - MEAN_WINS;

    // Map to a compact strength range to avoid runaway win probabilities.
    const newRating = Math.max(35, Math.min(65, 50 + (winsDelta * 1.2)));

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
  
  // Luck factor adds noise to the lambda
  const noise = (Math.random() - 0.5) * 2 * luckFactor; // -luck to +luck
  
  const lambda = baseRuns + (ratingDiff * 0.03) + (isHome ? 0.12 : -0.12) + noise;
  
  const L = Math.exp(-Math.max(0.5, lambda));
  let k = 0;
  let p = 1;
  
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  
  return k - 1;
};

export const simulateGame = (homeTeam: Team, awayTeam: Team, settings: SimulationSettings): { homeScore: number, awayScore: number } => {
  const winProb = calculateWinProbability(homeTeam.rating, awayTeam.rating, settings.homeFieldAdvantage);
  
  // Game level luck/noise check
  // We can adjust the probability slightly by the luck factor?
  // Or just use the luck factor in the run generation (done above).
  // Let's also add some noise to the win prob itself.
  const probNoise = (Math.random() - 0.5) * settings.gameLuckFactor * 0.08;
  const finalProb = Math.max(0.01, Math.min(0.99, winProb + probNoise));

  const roll = Math.random();
  const homeWins = roll < finalProb;
  
  let homeScore = calculateRuns(homeTeam.rating, awayTeam.rating, true, settings.gameLuckFactor);
  let awayScore = calculateRuns(awayTeam.rating, homeTeam.rating, false, settings.gameLuckFactor);
  
  if (homeWins && homeScore <= awayScore) {
    homeScore = awayScore + 1 + Math.floor(Math.random() * 2);
  } else if (!homeWins && awayScore <= homeScore) {
    awayScore = homeScore + 1 + Math.floor(Math.random() * 2);
  }
  
  if (homeScore === awayScore) {
    if (homeWins) homeScore++;
    else awayScore++;
  }
  
  return { homeScore, awayScore };
};

export const generateSchedule = (teams: Team[]): Game[] => {
  const games: Game[] = [];
  let gameIdCounter = 1;
  const teamIds = teams.map((team) => team.id);
  const teamCount = teamIds.length;

  if (teamCount < 2 || teamCount % 2 !== 0) {
    return games;
  }

  // Circle method round-robin: every team faces every other team once per cycle.
  const rotating = [...teamIds];
  const rounds: Array<Array<{ home: string; away: string }>> = [];

  for (let round = 0; round < teamCount - 1; round++) {
    const roundGames: Array<{ home: string; away: string }> = [];

    for (let i = 0; i < teamCount / 2; i++) {
      const first = rotating[i];
      const second = rotating[teamCount - 1 - i];
      const shouldSwap = (round + i) % 2 === 0;

      roundGames.push({
        home: shouldSwap ? first : second,
        away: shouldSwap ? second : first,
      });
    }

    rounds.push(roundGames);

    const moved = rotating.pop();
    if (!moved) {
      break;
    }
    rotating.splice(1, 0, moved);
  }

  const cycles = 5; // 31 * 5 = 155 games/team

  for (let cycle = 0; cycle < cycles; cycle++) {
    // Drop one full round in final cycle so each team plays 154 games.
    const roundsToPlay = cycle === cycles - 1 ? rounds.slice(0, rounds.length - 1) : rounds;

    roundsToPlay.forEach((roundGames, roundIndex) => {
      roundGames.forEach((matchup, matchupIndex) => {
        const flipHomeAway = (cycle + roundIndex + matchupIndex) % 2 === 1;
        const homeTeamId = flipHomeAway ? matchup.away : matchup.home;
        const awayTeamId = flipHomeAway ? matchup.home : matchup.away;

        games.push({
          id: `g-${gameIdCounter++}`,
          homeTeamId,
          awayTeamId,
          homeScore: 0,
          awayScore: 0,
          played: false,
        });
      });
    });
  }

  return games;
};
