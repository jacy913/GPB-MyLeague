export interface Team {
  id: string;
  name: string;
  city: string;
  league: 'Platinum' | 'Prestige';
  division: 'North' | 'South' | 'East' | 'West';
  rating: number; // Current calculated strength rating
  previousBaselineWins: number; // Historical performance (static/saved)
  
  // Stats
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
}

export interface Game {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  played: boolean;
}

export interface SimulationSettings {
  continuityWeight: number; // 0-1
  winLossVariance: number; // Standard deviation for random baseline
  homeFieldAdvantage: number; // Probability boost (e.g., 0.035)
  gameLuckFactor: number; // Noise factor (e.g., 0-1)
}

export interface SeasonState {
  teams: Team[];
  games: Game[];
  isSimulated: boolean;
  progress: number;
}
