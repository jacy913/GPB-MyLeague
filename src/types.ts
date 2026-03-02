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

export type PlayerType = 'batter' | 'pitcher';
export type PlayerStatus = 'active' | 'free_agent' | 'prospect' | 'retired';
export type BatHand = 'L' | 'R' | 'S';
export type ThrowHand = 'L' | 'R';
export type BatterPosition = 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH';
export type PitcherPosition = 'SP' | 'RP' | 'CL';
export type PlayerPosition = BatterPosition | PitcherPosition;
export type StartingPitcherSlot = 'SP1' | 'SP2' | 'SP3' | 'SP4' | 'SP5';
export type ReliefPitcherSlot = 'RP1' | 'RP2' | 'RP3' | 'RP4';
export type CloserSlot = 'CL';
export type RosterSlotCode = BatterPosition | StartingPitcherSlot | ReliefPitcherSlot | CloserSlot;
export type SeasonPhase = 'regular_season' | 'playoffs';
export type PlayerTransactionType = 'drafted' | 'signed' | 'released' | 'promoted' | 'demoted' | 'traded' | 'retired';

export const BATTING_POSITIONS: BatterPosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const PITCHING_POSITIONS: PitcherPosition[] = ['SP', 'RP', 'CL'];
export const BATTING_ROSTER_SLOTS: BatterPosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const STARTING_PITCHER_SLOTS: StartingPitcherSlot[] = ['SP1', 'SP2', 'SP3', 'SP4', 'SP5'];
export const RELIEF_PITCHER_SLOTS: ReliefPitcherSlot[] = ['RP1', 'RP2', 'RP3', 'RP4'];
export const BULLPEN_ROSTER_SLOTS: Array<ReliefPitcherSlot | CloserSlot> = ['RP1', 'RP2', 'RP3', 'RP4', 'CL'];
export const ALL_ROSTER_SLOTS: RosterSlotCode[] = [
  ...BATTING_ROSTER_SLOTS,
  ...STARTING_PITCHER_SLOTS,
  ...BULLPEN_ROSTER_SLOTS,
];

export interface Player {
  playerId: string;
  teamId: string | null;
  firstName: string;
  lastName: string;
  playerType: PlayerType;
  primaryPosition: PlayerPosition;
  secondaryPosition: PlayerPosition | null;
  bats: BatHand;
  throws: ThrowHand;
  age: number;
  potential: number;
  status: PlayerStatus;
  draftClassYear: number | null;
  draftRound: number | null;
  yearsPro: number;
  retirementYear: number | null;
}

export interface PlayerSeasonBatting {
  playerId: string;
  seasonYear: number;
  seasonPhase: SeasonPhase;
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  runsScored: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  rbi: number;
  avg: number;
  ops: number;
}

export interface PlayerSeasonPitching {
  playerId: string;
  seasonYear: number;
  seasonPhase: SeasonPhase;
  wins: number;
  losses: number;
  saves: number;
  games: number;
  gamesStarted: number;
  inningsPitched: number;
  hitsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  era: number;
  whip: number;
}

export interface PlayerBattingRatings {
  playerId: string;
  seasonYear: number;
  contact: number;
  power: number;
  plateDiscipline: number;
  avoidStrikeout: number;
  speed: number;
  baserunning: number;
  fielding: number;
  arm: number;
  overall: number;
  potentialOverall: number;
}

export interface PlayerPitchingRatings {
  playerId: string;
  seasonYear: number;
  stuff: number;
  command: number;
  control: number;
  movement: number;
  stamina: number;
  holdRunners: number;
  fielding: number;
  overall: number;
  potentialOverall: number;
}

export interface TeamRosterSlot {
  seasonYear: number;
  teamId: string;
  slotCode: RosterSlotCode;
  playerId: string;
}

export interface PlayerTransaction {
  playerId: string;
  eventType: PlayerTransactionType;
  fromTeamId: string | null;
  toTeamId: string | null;
  effectiveDate: string;
  notes: string | null;
}

export interface LeaguePlayerState {
  players: Player[];
  battingStats: PlayerSeasonBatting[];
  pitchingStats: PlayerSeasonPitching[];
  battingRatings: PlayerBattingRatings[];
  pitchingRatings: PlayerPitchingRatings[];
  rosterSlots: TeamRosterSlot[];
  transactions: PlayerTransaction[];
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

export type InningHalf = 'top' | 'bottom';
export type AtBatOutcome = 'OUT' | 'SO' | 'BB' | '1B' | '2B' | '3B' | 'HR' | 'ERR';

export interface BaseState {
  first: string | null;
  second: string | null;
  third: string | null;
}

export interface InningLine {
  inning: number;
  away: number;
  home: number;
}

export interface GameParticipantBatter {
  playerId: string;
  teamId: string;
  fullName: string;
  bats: BatHand;
  primaryPosition: BatterPosition;
  battingRatings: PlayerBattingRatings;
  battingStat: PlayerSeasonBatting | null;
}

export interface GameParticipantPitcher {
  playerId: string;
  teamId: string;
  fullName: string;
  throws: ThrowHand;
  role: PitcherPosition;
  pitchingRatings: PlayerPitchingRatings;
  pitchingStat: PlayerSeasonPitching | null;
}

export interface GameParticipantsSnapshot {
  awayLineup: GameParticipantBatter[];
  homeLineup: GameParticipantBatter[];
  awayStarter: GameParticipantPitcher | null;
  homeStarter: GameParticipantPitcher | null;
  awayBullpen: GameParticipantPitcher[];
  homeBullpen: GameParticipantPitcher[];
}

export interface PlayerGameBattingLine {
  playerId: string;
  gamesPlayed: number;
  plateAppearances: number;
  atBats: number;
  runsScored: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  rbi: number;
}

export interface PlayerGamePitchingLine {
  playerId: string;
  wins: number;
  losses: number;
  saves: number;
  games: number;
  gamesStarted: number;
  inningsPitched: number;
  hitsAllowed: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
}

export interface PlayerGameStatDelta {
  batting: Record<string, PlayerGameBattingLine>;
  pitching: Record<string, PlayerGamePitchingLine>;
  winningPitcherId: string | null;
  losingPitcherId: string | null;
  savePitcherId: string | null;
}

export interface PlayLogEvent {
  seq: number;
  inning: number;
  half: InningHalf;
  battingTeamId: string;
  outcome: AtBatOutcome | 'PITCHING_CHANGE' | 'HALF_END' | 'GAME_END';
  batterId: string | null;
  batterName: string | null;
  pitcherId: string | null;
  pitcherName: string | null;
  defenderId: string | null;
  defenderName: string | null;
  description: string;
  runsScored: number;
  rbi: number;
  scoringPlayerIds: string[];
  outs: number;
  scoreAway: number;
  scoreHome: number;
  bases: BaseState;
}

export interface GameSessionScoreboard {
  awayRuns: number;
  homeRuns: number;
  awayHits: number;
  homeHits: number;
  awayErrors: number;
  homeErrors: number;
}

export interface TeamPitchingState {
  currentPitcherId: string | null;
  pitchCount: number;
  battersFaced: number;
  enteredInning: number;
  bullpenUsedIds: string[];
}

export interface GameSessionState {
  gameId: string;
  date: string;
  awayTeamId: string;
  homeTeamId: string;
  participants: GameParticipantsSnapshot | null;
  status: 'pregame' | 'in_progress' | 'completed';
  inning: number;
  half: InningHalf;
  outs: number;
  bases: BaseState;
  awayBatterIndex: number;
  homeBatterIndex: number;
  awayPitching: TeamPitchingState;
  homePitching: TeamPitchingState;
  scoreboard: GameSessionScoreboard;
  lineScore: InningLine[];
  logs: PlayLogEvent[];
  playerStats: PlayerGameStatDelta;
  nextEventSeq: number;
}

export interface CompletedGameResult {
  game: Game;
  playerStatDelta: PlayerGameStatDelta;
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
