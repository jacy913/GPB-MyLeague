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

/** Every renderable application screen, including non-navigation development views. */
export type AppView =
  | 'dashboard'
  | 'games_schedule'
  | 'team_calendar'
  | 'simulation'
  | 'league_standings'
  | 'leaders'
  /**
   * The visual half of the Leaders screen.
   *
   * A separate view rather than a third control inside `leaders`, because that screen
   * already stacks two segmented controls (scope, then board) and the dashboard needs
   * its own again (which plot, which split). Three nested controls is a navigation
   * problem, not a layout one.
   *
   * There is no leaf for it in NAV_FOLDERS, exactly as for `betting_record`: it is
   * reached from a switch on the Leaders screen and from nowhere else, so the rail never
   * offers it. Both screens carry the switch, so neither can strand a reader here.
   */
  | 'leaders_dashboards'
  | 'history'
  | 'media'
  | 'betting'
  /**
   * The HXSE -- where club shares are priced.
   *
   * Its own destination rather than a fifth tab inside MacroBet. MacroBet already stacks four
   * sub-views (slate, props, futures, awards) and they are all things you place a wager on; a share
   * price is not a wager, it is the thing being priced. An exchange is where pricing happens, and
   * putting it under MacroBet would have made the market a feature of the bookmaker.
   */
  | 'exchange'
  | 'betting_record'
  | 'teams'
  | 'players'
  | 'trades'
  | 'lottery'
  | 'draft'
  | 'map'
  | 'free_agency'
  | 'offseason'
  | 'playoffs'
  | 'gpb_book'
  | 'notifications'
  | 'settings'
  | 'game_screen'
  | 'ui_kit';

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
export type ReserveSlot = 'BN1' | 'BN2' | 'BN3' | 'BN4' | 'BN5' | 'BN6' | 'BN7' | 'BN8' | 'BN9' | 'BN10';
export type CoreRosterSlotCode = BatterPosition | StartingPitcherSlot | ReliefPitcherSlot | CloserSlot;
export type RosterSlotCode = CoreRosterSlotCode | ReserveSlot;
export type SeasonPhase = 'regular_season' | 'playoffs';
export type PlayerTransactionType = 'drafted' | 'signed' | 'released' | 'promoted' | 'demoted' | 'traded' | 'retired';

export const BATTING_POSITIONS: BatterPosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const PITCHING_POSITIONS: PitcherPosition[] = ['SP', 'RP', 'CL'];
export const BATTING_ROSTER_SLOTS: BatterPosition[] = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
export const STARTING_PITCHER_SLOTS: StartingPitcherSlot[] = ['SP1', 'SP2', 'SP3', 'SP4', 'SP5'];
export const RELIEF_PITCHER_SLOTS: ReliefPitcherSlot[] = ['RP1', 'RP2', 'RP3', 'RP4'];
export const BULLPEN_ROSTER_SLOTS: Array<ReliefPitcherSlot | CloserSlot> = ['RP1', 'RP2', 'RP3', 'RP4', 'CL'];
export const CORE_ROSTER_SLOTS: CoreRosterSlotCode[] = [...BATTING_ROSTER_SLOTS, ...STARTING_PITCHER_SLOTS, ...BULLPEN_ROSTER_SLOTS];
export const RESERVE_ROSTER_SLOTS: ReserveSlot[] = ['BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6', 'BN7', 'BN8', 'BN9', 'BN10'];
export const ALL_ROSTER_SLOTS: RosterSlotCode[] = [
  ...CORE_ROSTER_SLOTS,
  ...RESERVE_ROSTER_SLOTS,
];
export const TEAM_ACTIVE_ROSTER_SIZE = ALL_ROSTER_SLOTS.length;

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
  height: string;
  weightLbs: number;
  potential: number;
  status: PlayerStatus;
  contractYearsLeft: number;
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

export type PendingTradeCategory = 'contender_push' | 'deadline_push' | 'prospect_swap' | 'blockbuster';

export interface PendingTradeProposal {
  proposalId: string;
  createdDate: string;
  fromTeamId: string;
  toTeamId: string;
  fromPlayerId: string;
  toPlayerId: string;
  fromTeamInterest: number;
  toTeamInterest: number;
  synergy: number;
  category: PendingTradeCategory;
  needSlot: RosterSlotCode;
  summary: string;
  fromTeamReason: string;
  toTeamReason: string;
  isBlockbuster: boolean;
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
  randomState: number;
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
  leagueEnvironmentBalance: number; // 0 = offense-heavy, 1 = pitching-heavy
  battingVarianceFactor: number; // 0 = compressed averages, 1 = wider spread
}

export type SimulationScope =
  | 'next_game'
  | 'next_playoff_game'
  | 'to_game'
  | 'day'
  | 'week'
  | 'month'
  | 'to_date'
  | 'regular_season'
  | 'season';

export interface SimulationTarget {
  scope: SimulationScope;
  targetDate?: string;
  teamId?: string;
  targetGameId?: string;
}

export interface SeasonState {
  teams: Team[];
  games: Game[];
  currentDate: string;
  isSimulated: boolean;
  progress: number;
}

export interface SeasonHistoryTeamRecord {
  teamId: string;
  teamCity: string;
  teamName: string;
  wins: number;
  losses: number;
}

export interface SeasonHistoryDivisionWinner extends SeasonHistoryTeamRecord {
  league: Team['league'];
  division: Team['division'];
}

/**
 * A league champion on the season archive.
 *
 * Carries `league` because the archive is keyed by it -- settlement looks a league champion up by
 * league alone, with no division to narrow by, since the winner of a league championship series is
 * not tied to a division the way a division winner is.
 *
 * Deliberately NOT folded into `SeasonHistoryDivisionWinner`: that adds `division`, and a league
 * champion has no single division to name, because the series is between the winners of two
 * different ones. Reusing it would mean writing a division the club did not win.
 */
export interface SeasonHistoryLeagueWinner extends SeasonHistoryTeamRecord {
  league: Team['league'];
}

export interface SeasonHistoryAwardWinner {
  playerId: string;
  playerName: string;
  teamId: string | null;
  teamCity: string | null;
  teamName: string | null;
  summary: string;
}

export interface SeasonHistoryEntry {
  seasonYear: number;
  completedAt: string;
  champion: SeasonHistoryTeamRecord | null;
  worldSeriesMvp: SeasonHistoryAwardWinner | null;
  battingMvp: SeasonHistoryAwardWinner | null;
  pitchingMvp: SeasonHistoryAwardWinner | null;
  divisionWinners: SeasonHistoryDivisionWinner[];
  /**
   * League champions, one per league, from the league championship SERIES.
   *
   * NOT derived from `divisionWinners`. That was the bug: mapping two division winners onto one
   * league key in a `Map` keeps the last write, so the archived "league champion" was whichever
   * division came last in `DIVISION_ORDER`. Settlement now reads this instead, and a league with no
   * completed series is simply absent -- which settles those bets void rather than paying a club that
   * did not win anything.
   *
   * Optional because seasons archived before this field existed do not have it, and a missing entry
   * has to read as "unknown" rather than as a guess.
   */
  leagueWinners?: SeasonHistoryLeagueWinner[];
}
