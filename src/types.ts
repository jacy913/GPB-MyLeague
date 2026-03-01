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

export type GameStatus = 'scheduled' | 'completed';
export type GamePhase = 'regular_season' | 'playoffs';
export type PlayoffRoundKey = 'wild_card' | 'divisional' | 'league_series' | 'world_series';
export type PlayoffLeague = Team['league'] | 'GPB';

export interface GameScore {
  home: number;
  away: number;
}

export interface PlayoffGameDetails {
  round: PlayoffRoundKey;
  league: PlayoffLeague;
  seriesId: string;
  seriesLabel: string;
  gameNumber: number;
  bestOf: number;
}

export interface Game {
  gameId: string;
  date: string; // YYYY-MM-DD
  homeTeam: string; // Team ID
  awayTeam: string; // Team ID
  phase: GamePhase;
  status: GameStatus;
  score: GameScore;
  playoff?: PlayoffGameDetails | null;
  stats: Record<string, number | string | boolean | null>;
}

export interface SimulationSettings {
  continuityWeight: number; // 0-1
  winLossVariance: number; // Standard deviation for random baseline
  homeFieldAdvantage: number; // Probability boost (e.g., 0.035)
  gameLuckFactor: number; // Noise factor (e.g., 0-1)
}

export type SimulationScope = 'next_game' | 'day' | 'week' | 'month' | 'to_date' | 'regular_season' | 'season';

export interface SimulationTarget {
  scope: SimulationScope;
  targetDate?: string;
  teamId?: string;
}

export interface SeasonState {
  teams: Team[];
  games: Game[];
  currentDate: string;
  isSimulated: boolean;
  progress: number;
}
