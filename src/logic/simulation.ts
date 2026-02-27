import { Team, Game, SimulationSettings } from '../types';

// Constants (Defaults)
export const DEFAULT_SETTINGS: SimulationSettings = {
  continuityWeight: 0.7,
  winLossVariance: 10,
  homeFieldAdvantage: 0.035,
  gameLuckFactor: 0.1,
};

const GAMES_PER_SEASON = 154;

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
    // Calculate target wins for the season
    // Mix of previous baseline and fresh random performance
    const freshPerformance = randomNormal(81, settings.winLossVariance); // 81 is .500 in 162 games, roughly .526 in 154? No, 154/2 = 77.
    // Let's use 77 as the mean for 154 games.
    const meanWins = GAMES_PER_SEASON / 2;
    
    const randomWins = randomNormal(meanWins, settings.winLossVariance);
    
    // Continuity blend
    // If continuity is 1.0, we use previousBaselineWins exactly.
    // If 0.0, we use randomWins.
    const targetWins = (team.previousBaselineWins * settings.continuityWeight) + 
                       (randomWins * (1 - settings.continuityWeight));
    
    // Convert target wins to a 0-100 rating
    // Assuming ~40 wins is rating 0, ~114 wins is rating 100.
    // Range is roughly 74 wins.
    // Rating = (Wins - 40) / 0.74
    let newRating = (targetWins - 40) / 0.74;
    newRating = Math.max(5, Math.min(95, newRating)); // Clamp to reasonable bounds
    
    return { ...team, rating: newRating };
  });
};

const getElo = (rating: number) => rating * 15 + 1000;

const calculateWinProbability = (homeRating: number, awayRating: number, hfa: number): number => {
  const homeElo = getElo(homeRating);
  const awayElo = getElo(awayRating);
  
  const exponent = (awayElo - homeElo) / 400;
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
  
  const lambda = baseRuns + (ratingDiff * 0.05) + (isHome ? 0.2 : -0.2) + noise;
  
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
  const probNoise = (Math.random() - 0.5) * settings.gameLuckFactor * 0.2; // Small variance to win prob
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
  
  for (let round = 0; round < 77; round++) {
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i += 2) {
      const home = shuffled[i];
      const away = shuffled[i+1];
      
      games.push({
        id: `g-${gameIdCounter++}`,
        homeTeamId: home.id,
        awayTeamId: away.id,
        homeScore: 0,
        awayScore: 0,
        played: false
      });
      
      games.push({
        id: `g-${gameIdCounter++}`,
        homeTeamId: away.id,
        awayTeamId: home.id,
        homeScore: 0,
        awayScore: 0,
        played: false
      });
    }
  }
  
  return games.sort(() => Math.random() - 0.5);
};
