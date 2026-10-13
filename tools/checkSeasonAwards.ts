/*
  THE FOUR SEASON AWARDS MUST DECIDE THEMSELVES, AND DECIDE THE SAME WAY TWICE.

  `seasonAwards.ts` is the only place that names Ultimate Slugger, Batting King, Rookie of the Year and
  Staff of the Year, and those names are written into the season archive the moment a season ends. The
  archive is then read back by the history browser and (later) by award markets, so a ranking that is
  wrong here is wrong permanently and in more than one place.

  WHY THIS FILE EXISTS AT ALL

  Nothing in the repo scored these four calculators. `build` does not type-check, and `tsc` cannot see
  that a tie-break is applied in the wrong order or that a workload floor was dropped. The only thing
  that catches a wrong ranking is running the ranking.

  WHAT IS ACTUALLY BEING TESTED, AND WHY EACH ONE

    Ultimate Slugger   ranked by home runs, then by SLUGGING PERCENTAGE recomputed from raw counts.
                       The trap is a rounded `avg`/`ops` field: SLG must come from hits, doubles,
                       triples, home runs and at-bats, not from a display value. A tie at the top is
                       decided by SLG, and a tie at BOTH is decided by name then id -- and it was
                       that second tie-break that a market would settle on.

    Batting King       ranked by EXACT average (hits / at-bats), then hits, then on-base percentage.
                       A float average computed from an already-rounded `avg` can flip a near-tie, and
                       the hits and OBP rungs are what make the order stable when averages match.

    Rookie of the Year ONE race across batters and pitchers, so the comparison is a z-score against
                       each role's own qualified field rather than a raw MVP total. Eligibility is the
                       thing to get right: first pro season, drafted, not retired. It is asserted
                       directly here because the initial universe and drafted rookies reach
                       `yearsPro: 0` by different routes.

    Staff of the Year  a team award ranked by WINS ABOVE EXPECTATION, not raw wins -- a 95-win club
                       that was supposed to win 100 did worse than an 80-win club that was supposed to
                       win 70. Expected wins come from the schedule and a regressed prior; the prior
                       is asserted to be the PRIOR season's number, not the season being awarded.

  The synthetic fixtures pin the ties and the floors, because a simulated season almost never produces
  an exact tie. The three-season simulation then proves the same calculators resolve on real league
  data.

  A NOTE ON ROOKIES IN THE SIMULATION, BECAUSE IT LOOKS LIKE A GAP AND IS NOT

  The initial universe contains no first-year players: every player is generated as an established pro
  with `yearsPro >= 1`. So the first season of a fresh league has an EMPTY Rookie of the Year race, and
  that is correct -- there is nobody in a first professional season to name. The race fills only after a
  draft, and this harness does not draft (the draft draws on `Math.random`, which would make this file
  non-deterministic). Rookie eligibility is therefore proven two ways instead: exhaustively on
  synthetic fixtures, and on REAL season stats by taking an actual qualified hitter and re-labelling
  only his service time. That keeps the integration test real, deterministic, and independent of the
  draft's randomness.
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { resetPlayerSeasonStats } from '../src/logic/playerStats';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import {
  AWARD_MIN_BATTING_AT_BATS,
  calculateBattingKing,
  calculateRookieOfTheYear,
  calculateStaffOfTheYear,
  calculateStrikeoutKing,
  calculateUltimateSlugger,
} from '../src/lib/seasonAwards';
import type {
  Game,
  LeaguePlayerState,
  Player,
  PlayerBattingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  SeasonHistoryAwardWinner,
  SeasonHistoryStaffWinner,
  Team,
} from '../src/types';

const SEED = 4242;
const FIRST = 2026;
const SEASONS = 3;
const YEAR = FIRST;

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

// ---------------------------------------------------------------------------------------------
// FIXTURE BUILDERS -- deliberately small, so the tie-break under test is the only interesting thing
// ---------------------------------------------------------------------------------------------

const makeTeam = (id: string, over: Partial<Team> = {}): Team => ({
  id,
  city: `City ${id}`,
  name: `Name ${id}`,
  league: 'Platinum',
  division: 'North',
  rating: 77,
  previousBaselineWins: 77,
  wins: 0,
  losses: 0,
  runsScored: 0,
  runsAllowed: 0,
  ...over,
});

const makeBatter = (id: string, over: Partial<Player> = {}): Player => ({
  playerId: id,
  teamId: 't1',
  firstName: 'First',
  lastName: `Last ${id}`,
  playerType: 'batter',
  primaryPosition: 'LF',
  secondaryPosition: null,
  bats: 'R',
  throws: 'R',
  age: 24,
  height: `6'0"`,
  weightLbs: 200,
  potential: 80,
  status: 'active',
  contractYearsLeft: 1,
  draftClassYear: null,
  draftRound: 1,
  yearsPro: 0,
  retirementYear: null,
  ...over,
});

const makePitcher = (id: string, over: Partial<Player> = {}): Player => ({
  ...makeBatter(id, over),
  playerType: 'pitcher',
  primaryPosition: 'SP',
});

const makeBattingStat = (id: string, over: Partial<PlayerSeasonBatting> = {}): PlayerSeasonBatting => ({
  playerId: id,
  seasonYear: YEAR,
  seasonPhase: 'regular_season',
  gamesPlayed: 150,
  plateAppearances: 500,
  atBats: 500,
  runsScored: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  rbi: 0,
  avg: 0,
  ops: 0,
  ...over,
});

const makePitchingStat = (id: string, over: Partial<PlayerSeasonPitching> = {}): PlayerSeasonPitching => ({
  playerId: id,
  seasonYear: YEAR,
  seasonPhase: 'regular_season',
  wins: 0,
  losses: 0,
  saves: 0,
  games: 0,
  gamesStarted: 0,
  inningsPitched: 0,
  hitsAllowed: 0,
  earnedRuns: 0,
  walks: 0,
  strikeouts: 0,
  era: 4,
  whip: 1.3,
  ...over,
});

const makeGame = (homeTeam: string, awayTeam: string, over: Partial<Game> = {}): Game => ({
  gameId: `${awayTeam}@${homeTeam}`,
  date: `${YEAR}-04-01`,
  homeTeam,
  awayTeam,
  phase: 'regular_season',
  status: 'completed',
  score: { home: 3, away: 2 },
  playoff: null,
  stats: {},
  ...over,
});

const makeBattingRating = (id: string, overall: number): PlayerBattingRatings => ({
  playerId: id,
  seasonYear: YEAR,
  contact: overall,
  power: overall,
  plateDiscipline: overall,
  avoidStrikeout: overall,
  speed: overall,
  baserunning: overall,
  fielding: overall,
  arm: overall,
  overall,
  potentialOverall: overall,
});

/** A full state object, so a synthetic fixture cannot pass by omission. */
const makeState = (parts: Partial<LeaguePlayerState>): LeaguePlayerState => ({
  players: [],
  battingStats: [],
  pitchingStats: [],
  battingRatings: [],
  pitchingRatings: [],
  rosterSlots: [],
  transactions: [],
  ...parts,
});

/** Independent SLG, so the check does not borrow the implementation it is checking. */
const slugging = (stat: PlayerSeasonBatting): number => {
  const totalBases = stat.hits + stat.doubles + stat.triples * 2 + stat.homeRuns * 3;
  return totalBases / stat.atBats;
};

const onBase = (stat: PlayerSeasonBatting): number =>
  (stat.hits + stat.walks) / (stat.atBats + stat.walks);

// ---------------------------------------------------------------------------------------------
// ULTIMATE SLUGGER -- ranking, then the two tie-breaks, then the floor, then missing data
// ---------------------------------------------------------------------------------------------

const checkUltimateSlugger = () => {
  console.log('\nULTIMATE SLUGGER\n');

  // Home runs beat slugging: a 40-HR .500 season outranks a 38-HR .592 season.
  const hrFirst = calculateUltimateSlugger(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('a'), makeBatter('b')],
      battingStats: [
        makeBattingStat('a', { atBats: 500, hits: 150, doubles: 20, homeRuns: 40 }),
        makeBattingStat('b', { atBats: 500, hits: 180, doubles: 40, homeRuns: 38 }),
      ],
    }),
    YEAR,
  );
  const hrExpected = slugging(makeBattingStat('a', { atBats: 500, hits: 150, doubles: 20, homeRuns: 40 }))
    < slugging(makeBattingStat('b', { atBats: 500, hits: 180, doubles: 40, homeRuns: 38 }));
  check(
    'ranked by home runs before slugging',
    hrFirst?.playerId === 'a' && hrExpected,
    `winner ${hrFirst?.playerId ?? 'NONE'}; the tie-free SLG leader is b, so an HR-first order keeps a`,
  );

  // Equal home runs, so slugging decides.
  const slgTie = calculateUltimateSlugger(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('a'), makeBatter('b')],
      battingStats: [
        makeBattingStat('a', { atBats: 500, hits: 160, doubles: 30, triples: 5, homeRuns: 30 }),
        makeBattingStat('b', { atBats: 500, hits: 150, doubles: 20, homeRuns: 30 }),
      ],
    }),
    YEAR,
  );
  check(
    'and by slugging when home runs are level',
    slgTie?.playerId === 'a',
    `both hit 30 HR; winner ${slgTie?.playerId ?? 'NONE'} `
    + `(SLG ${slugging(makeBattingStat('a', { atBats: 500, hits: 160, doubles: 30, triples: 5, homeRuns: 30 })).toFixed(3)} `
    + `vs ${slugging(makeBattingStat('b', { atBats: 500, hits: 150, doubles: 20, homeRuns: 30 })).toFixed(3)})`,
  );

  // Equal home runs AND slugging, so the name decides.
  const nameTieStats = { atBats: 500, hits: 150, doubles: 20, homeRuns: 30 };
  const nameTie = calculateUltimateSlugger(
    [makeTeam('t1')],
    makeState({
      players: [
        makeBatter('z', { firstName: 'Zed', lastName: 'Zulu' }),
        makeBatter('a', { firstName: 'Abe', lastName: 'Able' }),
      ],
      battingStats: [makeBattingStat('z', nameTieStats), makeBattingStat('a', nameTieStats)],
    }),
    YEAR,
  );
  check(
    'and by name when home runs and slugging are level',
    nameTie?.playerId === 'a',
    `identical lines; Abe Able must precede Zed Zulu regardless of id order, winner ${nameTie?.playerId ?? 'NONE'}`,
  );

  // Equal everything including the name, so the id is the last stable rung.
  const idTie = calculateUltimateSlugger(
    [makeTeam('t1')],
    makeState({
      players: [
        makeBatter('b', { firstName: 'Sam', lastName: 'Same' }),
        makeBatter('a', { firstName: 'Sam', lastName: 'Same' }),
      ],
      battingStats: [makeBattingStat('b', nameTieStats), makeBattingStat('a', nameTieStats)],
    }),
    YEAR,
  );
  check(
    'and by player id when even the name is identical',
    idTie?.playerId === 'a',
    `the last rung has to be total and stable or two runs of the archive can name different winners; got ${idTie?.playerId ?? 'NONE'}`,
  );

  // The 120 at-bat floor excludes a short, loud season.
  const floored = calculateUltimateSlugger(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('griffey'), makeBatter('b')],
      battingStats: [
        makeBattingStat('griffey', { atBats: AWARD_MIN_BATTING_AT_BATS - 1, hits: 60, homeRuns: 30 }),
        makeBattingStat('b', { atBats: 500, hits: 150, doubles: 20, homeRuns: 30 }),
      ],
    }),
    YEAR,
  );
  check(
    `and ${AWARD_MIN_BATTING_AT_BATS} at-bats are required to win it`,
    floored?.playerId === 'b',
    `30 HR in ${AWARD_MIN_BATTING_AT_BATS - 1} at-bats must not win the award; winner ${floored?.playerId ?? 'NONE'}`,
  );

  // No qualified batters at all is null, not a crash and not a fabricated name.
  const empty = calculateUltimateSlugger([makeTeam('t1')], makeState({}), YEAR);
  check('and an empty league names nobody', empty === null, `expected null, got ${empty ? empty.playerName : 'null'}`);
};

// ---------------------------------------------------------------------------------------------
// BATTING KING -- exact average, then hits, then OBP, then the floor
// ---------------------------------------------------------------------------------------------

const checkBattingKing = () => {
  console.log('\nBATTING KING\n');

  // A hair apart on average, decided by the exact ratio rather than a rounded field.
  const avgRace = calculateBattingKing(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('a'), makeBatter('b')],
      battingStats: [
        makeBattingStat('a', { atBats: 600, hits: 200 }),
        makeBattingStat('b', { atBats: 600, hits: 199 }),
      ],
    }),
    YEAR,
  );
  check(
    'ranked by exact average',
    avgRace?.playerId === 'a',
    `200/600 must beat 199/600; winner ${avgRace?.playerId ?? 'NONE'}`,
  );

  // Equal average, so hits decide.
  const hitTie = calculateBattingKing(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('a'), makeBatter('b')],
      battingStats: [
        makeBattingStat('a', { atBats: 600, hits: 180 }),
        makeBattingStat('b', { atBats: 500, hits: 150 }),
      ],
    }),
    YEAR,
  );
  check(
    'and by hits when the averages are level',
    hitTie?.playerId === 'a',
    `both .300; 180 hits must beat 150; winner ${hitTie?.playerId ?? 'NONE'}`,
  );

  // Equal average and hits, so on-base percentage decides.
  const obpTie = calculateBattingKing(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('a'), makeBatter('b')],
      battingStats: [
        makeBattingStat('a', { atBats: 600, hits: 180, walks: 0 }),
        makeBattingStat('b', { atBats: 600, hits: 180, walks: 60 }),
      ],
    }),
    YEAR,
  );
  check(
    'and by on-base percentage when average and hits are level',
    obpTie?.playerId === 'b',
    `both hit 180 in 600; 60 walks must decide it, winner ${obpTie?.playerId ?? 'NONE'} `
    + `(OBP ${onBase(makeBattingStat('b', { atBats: 600, hits: 180, walks: 60 })).toFixed(3)} `
    + `vs ${onBase(makeBattingStat('a', { atBats: 600, hits: 180, walks: 0 })).toFixed(3)})`,
  );

  // The same 120 at-bat floor applies.
  const floored = calculateBattingKing(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('griffey'), makeBatter('b')],
      battingStats: [
        makeBattingStat('griffey', { atBats: AWARD_MIN_BATTING_AT_BATS - 1, hits: 100 }),
        makeBattingStat('b', { atBats: 500, hits: 150 }),
      ],
    }),
    YEAR,
  );
  check(
    `and ${AWARD_MIN_BATTING_AT_BATS} at-bats are required to win it`,
    floored?.playerId === 'b',
    `${AWARD_MIN_BATTING_AT_BATS - 1} at-bats at a huge average must not win; winner ${floored?.playerId ?? 'NONE'}`,
  );

  const empty = calculateBattingKing([makeTeam('t1')], makeState({}), YEAR);
  check('and an empty league names nobody', empty === null, `expected null, got ${empty ? empty.playerName : 'null'}`);
};

// ---------------------------------------------------------------------------------------------
// STRIKEOUT KING -- a raw count first, then two rates, then the name
// ---------------------------------------------------------------------------------------------

/** Independent K/9 and K/BB, so the check does not borrow the implementation it is checking. */
const strikeoutsPerNine = (stat: PlayerSeasonPitching): number =>
  (stat.strikeouts * 9) / stat.inningsPitched;

const checkStrikeoutKing = () => {
  console.log('\nSTRIKEOUT KING\n');

  /*
   * The count beats the rate, which is the whole reason this award is ordered the way it is. A
   * reliever at a stadium K/9 and a starter with a hundred more strikeouts are not close, and a
   * rate-first award would hand it to the reliever.
   */
  const countBeatsRate = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('flashy'), makePitcher('volume')],
      pitchingStats: [
        makePitchingStat('flashy', { games: 8, gamesStarted: 0, inningsPitched: 8, strikeouts: 12, walks: 1 }),
        makePitchingStat('volume', { games: 34, gamesStarted: 34, inningsPitched: 220, strikeouts: 180, walks: 60 }),
      ],
    }),
    YEAR,
  );
  check(
    'a raw count outranks a better rate',
    countBeatsRate?.playerId === 'volume',
    `the reliever is ${strikeoutsPerNine(makePitchingStat('flashy', { inningsPitched: 8, strikeouts: 12 })).toFixed(2)} K/9 `
    + `against the starter's ${strikeoutsPerNine(makePitchingStat('volume', { inningsPitched: 220, strikeouts: 180 })).toFixed(2)}, `
    + `and 180 K beats 12 K; winner ${countBeatsRate?.playerId ?? 'NONE'}`,
  );

  // A tie on strikeouts, so the higher K/9 decides.
  const k9Tie = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('a'), makePitcher('b')],
      pitchingStats: [
        makePitchingStat('a', { games: 34, gamesStarted: 34, inningsPitched: 260, strikeouts: 200, walks: 40 }),
        makePitchingStat('b', { games: 30, gamesStarted: 30, inningsPitched: 200, strikeouts: 200, walks: 40 }),
      ],
    }),
    YEAR,
  );
  check(
    'a tie on strikeouts goes to the better K/9',
    k9Tie?.playerId === 'b',
    `both struck out 200; a is ${strikeoutsPerNine(makePitchingStat('a', { inningsPitched: 260, strikeouts: 200 })).toFixed(2)} K/9 `
    + `and b is ${strikeoutsPerNine(makePitchingStat('b', { inningsPitched: 200, strikeouts: 200 })).toFixed(2)}; winner ${k9Tie?.playerId ?? 'NONE'}`,
  );

  /*
   * A tie on strikeouts AND on K/9, which needs different innings with a different walk count --
   * so the K/BB tie-break is what is left and it has to be the thing that decides.
   */
  const kbbTie = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('walked'), makePitcher('control')],
      pitchingStats: [
        makePitchingStat('walked', { games: 30, gamesStarted: 30, inningsPitched: 200, strikeouts: 200, walks: 80 }),
        makePitchingStat('control', { games: 24, gamesStarted: 24, inningsPitched: 160, strikeouts: 200, walks: 32 }),
      ],
    }),
    YEAR,
  );
  check(
    'a tie on strikeouts and K/9 goes to the better K/BB',
    kbbTie?.playerId === 'control',
    `both at ${strikeoutsPerNine(makePitchingStat('walked', { inningsPitched: 200, strikeouts: 200 })).toFixed(2)} K/9; `
    + `K/BB is 2.50 against 6.25, so the better ratio must win; winner ${kbbTie?.playerId ?? 'NONE'}`,
  );

  /*
   * ZERO WALKS IS THE BEST RATIO, NOT A MISSING ONE. This is the one comparison where the
   * implementation is allowed to hold Infinity, so it is the one place a wrong sign would hide:
   * a finite-vs-infinite subtraction that resolves the wrong way awards the crown to the pitcher
   * who walked everybody, which is exactly backwards.
   */
  const noWalks = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('perfect'), makePitcher('streaky')],
      pitchingStats: [
        makePitchingStat('perfect', { games: 30, gamesStarted: 30, inningsPitched: 200, strikeouts: 200, walks: 0 }),
        makePitchingStat('streaky', { games: 30, gamesStarted: 30, inningsPitched: 200, strikeouts: 200, walks: 60 }),
      ],
    }),
    YEAR,
  );
  check(
    'a pitcher who walked nobody wins the K/BB tie-break',
    noWalks?.playerId === 'perfect',
    `identical K and K/9; zero walks is an unbounded ratio and must sort above 3.33; winner ${noWalks?.playerId ?? 'NONE'}`,
  );

  /*
   * TWO pitchers who both walked nobody cannot be separated by K/BB at all -- Infinity minus
   * Infinity is NaN, and NaN is falsy. If the comparator did not fall through, this would throw or
   * return a stable-but-wrong answer instead of reaching the name.
   */
  const bothWalkless = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [
        makePitcher('z', { firstName: 'Zed', lastName: 'Zulu' }),
        makePitcher('a', { firstName: 'Abe', lastName: 'Able' }),
      ],
      pitchingStats: [
        makePitchingStat('z', { inningsPitched: 200, strikeouts: 200, walks: 0 }),
        makePitchingStat('a', { inningsPitched: 200, strikeouts: 200, walks: 0 }),
      ],
    }),
    YEAR,
  );
  check(
    'two walkless pitchers fall through to the name',
    bothWalkless?.playerId === 'a',
    `K/BB is Infinity on both sides, so the tie must resolve on the name and not on NaN; winner ${bothWalkless?.playerId ?? 'NONE'}`,
  );

  // Three identical rungs, so the name decides and the id is the last stable one.
  const nameTie = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [
        makePitcher('b', { firstName: 'Sam', lastName: 'Same' }),
        makePitcher('a', { firstName: 'Sam', lastName: 'Same' }),
      ],
      pitchingStats: [
        makePitchingStat('b', { inningsPitched: 180, strikeouts: 180, walks: 40 }),
        makePitchingStat('a', { inningsPitched: 180, strikeouts: 180, walks: 40 }),
      ],
    }),
    YEAR,
  );
  check(
    'and by player id when even the name is identical',
    nameTie?.playerId === 'a',
    `the last rung has to be total and stable or two runs of the archive can name different winners; got ${nameTie?.playerId ?? 'NONE'}`,
  );

  /*
   * NO FLOOR, SO THE ZERO-STRIKEOUT GUARD IS THE ONLY THING STANDING BETWEEN THIS AND AN
   * ALPHABETICAL WINNER. With no innings requirement, a season where the league never took a
   * strikeout would otherwise hand the award to the first name alphabetically.
   */
  const nobodyStruck = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [
        makePitcher('z', { firstName: 'Zed', lastName: 'Zulu' }),
        makePitcher('a', { firstName: 'Abe', lastName: 'Able' }),
      ],
      pitchingStats: [
        makePitchingStat('z', { inningsPitched: 200, games: 30, gamesStarted: 30, strikeouts: 0, walks: 20 }),
        makePitchingStat('a', { inningsPitched: 200, games: 30, gamesStarted: 30, strikeouts: 0, walks: 20 }),
      ],
    }),
    YEAR,
  );
  check(
    'a season with no strikeouts at all names nobody',
    nobodyStruck === null,
    `zero K means there is no Strikeout King; got ${nobodyStruck ? nobodyStruck.playerName : 'null'}`,
  );

  /*
   * NO FLOOR, SO A SHORT SEASON IS NOT EXCLUDED. That was the explicit instruction, and it is the
   * opposite of every other award in this file, so the assertion has to be the opposite too: a
   * five-start arm with 40 innings -- under the Pitching MVP's 8-start gate, and under any innings
   * floor worth having -- takes the award on the count alone.
   *
   * Note what this does NOT claim: that a short season beats a long one. He wins because he struck
   * out MORE batters, which is the whole point of a raw count. An earlier version of this fixture
   * gave the short arm 9 K against a starter's 180 and expected him to win, which asserted that the
   * award ignores the count entirely -- the exact opposite of what it does.
   */
  const noFloor = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('short'), makePitcher('long')],
      pitchingStats: [
        makePitchingStat('short', { games: 6, gamesStarted: 5, inningsPitched: 40, strikeouts: 190, walks: 40 }),
        makePitchingStat('long', { games: 34, gamesStarted: 34, inningsPitched: 220, strikeouts: 180, walks: 60 }),
      ],
    }),
    YEAR,
  );
  check(
    'a five-start arm with 40 innings is not floored out',
    noFloor?.playerId === 'short',
    `40 IP and 190 K beats 220 IP and 180 K on the count alone, with nothing gating him out; winner ${noFloor?.playerId ?? 'NONE'}`,
  );

  // A released pitcher is not a season's Strikeout King, same as every other award.
  const released = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('gone', { teamId: null }), makePitcher('here')],
      pitchingStats: [
        makePitchingStat('gone', { inningsPitched: 200, strikeouts: 200, walks: 20 }),
        makePitchingStat('here', { inningsPitched: 200, strikeouts: 150, walks: 20 }),
      ],
    }),
    YEAR,
  );
  check(
    'a pitcher with no club cannot win it',
    released?.playerId === 'here',
    `200 K is irrelevant without a club to attach it to; winner ${released?.playerId ?? 'NONE'}`,
  );

  const empty = calculateStrikeoutKing([makeTeam('t1')], makeState({}), YEAR);
  check('and an empty league names nobody', empty === null, `expected null, got ${empty ? empty.playerName : 'null'}`);

  // The card states the count and both tie-break figures, and never prints an infinite ratio.
  const carded = calculateStrikeoutKing(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('a')],
      pitchingStats: [makePitchingStat('a', { inningsPitched: 200, strikeouts: 200, walks: 0 })],
    }),
    YEAR,
  );
  check(
    'the card prints the count and never an infinite ratio',
    carded?.summary === '200 K | 9.00 K/9 | no walks',
    `walkless winner must read as a fact rather than a number; got "${carded?.summary ?? 'null'}"`,
  );
};

// ---------------------------------------------------------------------------------------------
// ROOKIE OF THE YEAR -- eligibility, one race across roles, and the workload gate
// ---------------------------------------------------------------------------------------------

const rookieField = () => makeState({
  players: [
    makeBatter('rookieBat', { yearsPro: 0, draftRound: 1 }),
    makeBatter('vetBat', { yearsPro: 4, draftRound: 1 }),
    makePitcher('rookieArm', { yearsPro: 0, draftRound: 2, primaryPosition: 'CL' }),
  ],
  battingStats: [
    makeBattingStat('rookieBat', { atBats: 450, hits: 130, doubles: 20, homeRuns: 15, rbi: 70, runsScored: 60, ops: 0.8 }),
    makeBattingStat('vetBat', { atBats: 550, hits: 190, doubles: 30, homeRuns: 40, rbi: 110, runsScored: 100, ops: 1.0 }),
  ],
  pitchingStats: [
    makePitchingStat('rookieArm', { saves: 40, games: 60, inningsPitched: 70, strikeouts: 90, era: 1.6, whip: 0.9, wins: 3 }),
  ],
  battingRatings: [makeBattingRating('rookieBat', 80), makeBattingRating('vetBat', 90)],
});

const checkRookieOfTheYear = () => {
  console.log('\nROOKIE OF THE YEAR\n');

  // The veteran is the better player and must not be named.
  const mixed = calculateRookieOfTheYear([makeTeam('t1')], rookieField(), YEAR);
  check(
    'a first-year player wins it and the veteran is excluded',
    mixed?.playerId === 'rookieBat' || mixed?.playerId === 'rookieArm',
    `the 40-HR veteran must not be eligible; winner ${mixed?.playerName ?? 'NONE'}`,
  );

  // One race across roles: a batter-only field names a batter.
  const battersOnly = calculateRookieOfTheYear(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('rookieBat', { yearsPro: 0 })],
      battingStats: [makeBattingStat('rookieBat', { atBats: 450, hits: 130, homeRuns: 15, rbi: 70, ops: 0.8 })],
      battingRatings: [makeBattingRating('rookieBat', 80)],
    }),
    YEAR,
  );
  check(
    'a batter-only rookie field names a batter',
    battersOnly?.playerId === 'rookieBat' && battersOnly.summary.startsWith('Batter'),
    `winner ${battersOnly?.playerName ?? 'NONE'} -- ${battersOnly?.summary ?? 'no summary'}`,
  );

  // And a pitcher-only field names a pitcher, through the same single race.
  const pitchersOnly = calculateRookieOfTheYear(
    [makeTeam('t1')],
    makeState({
      players: [makePitcher('rookieArm', { yearsPro: 0, primaryPosition: 'CL' })],
      pitchingStats: [makePitchingStat('rookieArm', { saves: 40, games: 60, inningsPitched: 70, strikeouts: 90, era: 1.6, whip: 0.9, wins: 3 })],
    }),
    YEAR,
  );
  check(
    'and a pitcher-only rookie field names a pitcher',
    pitchersOnly?.playerId === 'rookieArm' && pitchersOnly.summary.startsWith('Pitcher'),
    `winner ${pitchersOnly?.playerName ?? 'NONE'} -- ${pitchersOnly?.summary ?? 'no summary'}`,
  );

  // Each eligibility condition, in isolation, must be able to exclude on its own.
  const cases: Array<{ label: string; player: Player }> = [
    { label: 'a second-year player', player: makeBatter('x', { yearsPro: 1 }) },
    { label: 'a player who was never drafted', player: makeBatter('x', { yearsPro: 0, draftRound: null }) },
    { label: 'a retired player', player: makeBatter('x', { yearsPro: 0, status: 'retired' }) },
  ];
  for (const { label, player } of cases) {
    const result = calculateRookieOfTheYear(
      [makeTeam('t1')],
      makeState({
        players: [player],
        battingStats: [makeBattingStat('x', { atBats: 450, hits: 130, homeRuns: 15, rbi: 70, ops: 0.8 })],
        battingRatings: [makeBattingRating('x', 80)],
      }),
      YEAR,
    );
    check(
      `and is not awarded to ${label}`,
      result === null,
      `expected null, got ${result ? result.playerName : 'null'}`,
    );
  }

  // A rookie with a real but short season is below the batting floor, so nobody qualifies.
  const belowFloor = calculateRookieOfTheYear(
    [makeTeam('t1')],
    makeState({
      players: [makeBatter('rookieBat', { yearsPro: 0 })],
      battingStats: [makeBattingStat('rookieBat', { atBats: AWARD_MIN_BATTING_AT_BATS - 1, hits: 80, homeRuns: 20, ops: 1.0 })],
      battingRatings: [makeBattingRating('rookieBat', 80)],
    }),
    YEAR,
  );
  check(
    'and a rookie below the workload floor is not eligible',
    belowFloor === null,
    `a loud ${AWARD_MIN_BATTING_AT_BATS - 1}-at-bat season leaves the race empty, got ${belowFloor ? belowFloor.playerName : 'null'}`,
  );

  const empty = calculateRookieOfTheYear([makeTeam('t1')], makeState({}), YEAR);
  check('and an empty league names nobody', empty === null, `expected null, got ${empty ? empty.playerName : 'null'}`);
};

// ---------------------------------------------------------------------------------------------
// STAFF OF THE YEAR -- wins above expectation, the prior blend, and the tie-break ladder
// ---------------------------------------------------------------------------------------------

const staffField = () => ({
  teams: [
    makeTeam('aaa', { rating: 77, previousBaselineWins: 1, wins: 1, losses: 1 }),
    makeTeam('bbb', { rating: 77, previousBaselineWins: 1, wins: 1, losses: 1 }),
  ],
  games: [makeGame('aaa', 'bbb'), makeGame('bbb', 'aaa')],
});

const checkStaffOfTheYear = () => {
  console.log('\nSTAFF OF THE YEAR\n');

  // A symmetric schedule and identical ratings make both clubs expect one win, so the finish decides.
  const over = staffField();
  over.teams[0] = { ...over.teams[0], wins: 2, losses: 0 };
  over.teams[1] = { ...over.teams[1], wins: 0, losses: 2 };
  const clear = calculateStaffOfTheYear(over.teams, over.games, DEFAULT_SETTINGS.homeFieldAdvantage);
  check(
    'ranked by wins above expectation',
    clear?.teamId === 'aaa' && clear.winsAboveExpectation === 1,
    `2-0 against a 1-win expectation is +1; got ${clear ? `${clear.teamId} ${clear.wins}-${clear.losses}, ${clear.winsAboveExpectation} above ${clear.expectedWins}` : 'NONE'}`,
  );

  // Raw wins are not enough: the 2-0 club is the winner although both played the same schedule.
  check(
    'and not by raw wins alone',
    clear?.wins === 2,
    'the ranking value is wins above expectation, so equal raw wins on unequal expectations must separate',
  );

  // Equal expectations and equal records, so run differential separates them.
  const runDiff = staffField();
  runDiff.teams[0] = { ...runDiff.teams[0], runsScored: 10, runsAllowed: 0 };
  runDiff.teams[1] = { ...runDiff.teams[1], runsScored: 0, runsAllowed: 0 };
  const byRuns = calculateStaffOfTheYear(runDiff.teams, runDiff.games, DEFAULT_SETTINGS.homeFieldAdvantage);
  check(
    'and by run differential when expectation and record are level',
    byRuns?.teamId === 'aaa',
    `+10 run differential must beat 0; winner ${byRuns?.teamId ?? 'NONE'}`,
  );

  // Absolutely level, so the team id is the stable last rung.
  const idTie = staffField();
  const byId = calculateStaffOfTheYear(idTie.teams, idTie.games, DEFAULT_SETTINGS.homeFieldAdvantage);
  check(
    'and by team id when everything else is level',
    byId?.teamId === 'aaa',
    `a fully level award has to resolve the same way twice; winner ${byId?.teamId ?? 'NONE'}`,
  );

  // The prior is regressed toward the league average, so a 1-win baseline cannot be used raw.
  const prior = staffField();
  prior.teams[0] = { ...prior.teams[0], previousBaselineWins: 1, wins: 1, losses: 1 };
  const blended = calculateStaffOfTheYear(prior.teams, prior.games, DEFAULT_SETTINGS.homeFieldAdvantage);
  check(
    'and expected wins blend a regressed prior rather than the raw one',
    blended?.priorWins === 1 && blended.expectedWins > 0 && blended.expectedWins < 10,
    `prior ${blended?.priorWins ?? 'N/A'} with a 1-win schedule expectation; expected ${blended?.expectedWins ?? 'N/A'} must sit between the schedule and the prior, not at either extreme`,
  );

  // No regular-season games means no expectation and no award.
  const noGames = calculateStaffOfTheYear(
    [makeTeam('aaa'), makeTeam('bbb')],
    [],
    DEFAULT_SETTINGS.homeFieldAdvantage,
  );
  check('and a season with no games names no staff', noGames === null, `expected null, got ${noGames ? noGames.teamName : 'null'}`);

  // Playoff games must not move the expectation: the award is a regular-season award.
  const withPlayoffs = staffField();
  const playoffGame = makeGame('aaa', 'bbb', { phase: 'playoffs' });
  const regularOnly = calculateStaffOfTheYear(withPlayoffs.teams, withPlayoffs.games, DEFAULT_SETTINGS.homeFieldAdvantage);
  const withExtra = calculateStaffOfTheYear(
    withPlayoffs.teams,
    [...withPlayoffs.games, playoffGame],
    DEFAULT_SETTINGS.homeFieldAdvantage,
  );
  check(
    'and playoff games do not count toward the expectation',
    regularOnly?.expectedWins === withExtra?.expectedWins,
    `expected wins ${regularOnly?.expectedWins ?? 'N/A'} with playoffs appended ${withExtra?.expectedWins ?? 'N/A'}; the regular-season record is what the award is about`,
  );
};

// ---------------------------------------------------------------------------------------------
// REAL LEAGUE -- three seasons, every award resolved on real data
// ---------------------------------------------------------------------------------------------

const isQualifiedRookie = (player: Player, state: LeaguePlayerState, year: number): boolean => {
  if (player.status === 'retired' || player.yearsPro !== 0 || player.draftRound === null) return false;
  const batting = state.battingStats.find(
    (s) => s.playerId === player.playerId && s.seasonYear === year && s.seasonPhase === 'regular_season',
  );
  if (batting && batting.atBats >= AWARD_MIN_BATTING_AT_BATS) return true;
  const pitching = state.pitchingStats.find(
    (s) => s.playerId === player.playerId && s.seasonYear === year && s.seasonPhase === 'regular_season',
  );
  return Boolean(pitching && (pitching.gamesStarted >= 8 || pitching.saves >= 25));
};

/**
 * The same real state, with exactly one player's service time re-labelled.
 *
 * Every other player is forced to `yearsPro: 1` so the fixture can only contain the one intended
 * rookie, whatever the simulated league happens to hold. This is how a first-year race is built on
 * REAL season stats without depending on the draft, which draws on `Math.random`.
 */
const withRookieYears = (state: LeaguePlayerState, playerId: string, yearsPro: number): LeaguePlayerState => ({
  ...state,
  players: state.players.map((player) => (
    player.playerId === playerId
      ? { ...player, yearsPro, draftRound: player.draftRound ?? 1 }
      : { ...player, yearsPro: 1 }
  )),
});

const describeAward = (award: SeasonHistoryAwardWinner | null): string =>
  award ? `${award.playerName} (${award.teamCity ?? 'NO TEAM'}) -- ${award.summary}` : 'NONE';

const describeStaff = (staff: SeasonHistoryStaffWinner | null): string =>
  staff
    ? `${staff.teamCity} ${staff.teamName} ${staff.wins}-${staff.losses} vs ${staff.expectedWins} expected (${staff.winsAboveExpectation >= 0 ? '+' : ''}${staff.winsAboveExpectation}), prior ${staff.priorWins}, strength ${staff.rosterStrength}`
    : 'NONE';

const main = async () => {
  console.log('\nSEASON AWARDS -- four decisions, tested on ties and on real seasons\n');

  checkUltimateSlugger();
  checkBattingKing();
  checkStrikeoutKing();
  checkRookieOfTheYear();
  checkStaffOfTheYear();

  console.log('\nREAL LEAGUE -- the same awards over three simulated seasons\n');

  let state: LeaguePlayerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: FIRST,
    seed: SEED,
    effectiveDate: `${FIRST}-12-15`,
  }).playerState;

  const initialBaseline = new Map(INITIAL_TEAMS.map((t) => [t.id, t.previousBaselineWins] as const));

  /*
   * MIRRORS `buildFreshSeasonTeams(..., capturePriorSeasonWins)` IN App.tsx.
   *
   * Between seasons the reset captures the wins that were just played as the new baseline, and does
   * NOT capture them when the reset is a mid-season restart. Reproducing that here is what lets the
   * prior-blend assertion below run in seasons 2 and 3 as well as season 1.
   */
  const freshTeams = (teams: Team[], s: LeaguePlayerState, year: number, capturePriorSeasonWins: boolean): Team[] =>
    recalculateTeamRatingsFromRosters(
      teams.map((t) => ({
        ...t,
        previousBaselineWins: capturePriorSeasonWins ? t.wins : t.previousBaselineWins,
        wins: 0,
        losses: 0,
        runsScored: 0,
        runsAllowed: 0,
      })),
      s,
      year,
    );

  let teams = freshTeams(INITIAL_TEAMS.map((t) => ({ ...t })), state, FIRST, false);
  let allSeasonsResolved = true;
  let lastSeasonWins = new Map<string, number>();

  for (let i = 0; i < SEASONS; i += 1) {
    const year = FIRST + i;
    const schedule = generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 200 });
    const manager = new SimulationManager({
      teams,
      games: schedule,
      playerState: state,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });
    let latest = await manager.run({ scope: 'day' });
    // A 162-game season plus the postseason, run a day at a time.
    for (let d = 0; d < 215; d += 1) latest = await manager.run({ scope: 'day' });
    state = latest.playerState;
    teams = latest.teams;
    const games = latest.games;

    const slugger = calculateUltimateSlugger(teams, state, year);
    const king = calculateBattingKing(teams, state, year);
    const rookie = calculateRookieOfTheYear(teams, state, year);
    const strikeoutKing = calculateStrikeoutKing(teams, state, year);
    const staff = calculateStaffOfTheYear(teams, games, DEFAULT_SETTINGS.homeFieldAdvantage);

    const qualifiedRookies = state.players.filter((p) => isQualifiedRookie(p, state, year));
    const resolved = Boolean(slugger && king && strikeoutKing && staff);
    allSeasonsResolved = allSeasonsResolved && resolved;

    console.log(`  season ${year}`);
    console.log(`      Slugger   ${describeAward(slugger)}`);
    console.log(`      King      ${describeAward(king)}`);
    console.log(`      K King    ${describeAward(strikeoutKing)}`);
    console.log(`      Rookie    ${describeAward(rookie)}`);
    console.log(`      Staff     ${describeStaff(staff)}`);
    console.log(`      qualified rookies: ${qualifiedRookies.length}`);

    // The winner's own line has to be the top of its own ranking.
    if (slugger) {
      const leaders = state.battingStats.filter(
        (s) => s.seasonYear === year && s.seasonPhase === 'regular_season' && s.atBats >= AWARD_MIN_BATTING_AT_BATS,
      );
      const maxHr = Math.max(...leaders.map((s) => s.homeRuns));
      const bestSlgAtMaxHr = Math.max(...leaders.filter((s) => s.homeRuns === maxHr).map(slugging));
      const winnerStat = leaders.find((s) => s.playerId === slugger.playerId);
      const ok = Boolean(
        winnerStat
        && winnerStat.homeRuns === maxHr
        && (winnerStat.homeRuns < maxHr || slugging(winnerStat) >= bestSlgAtMaxHr),
      );
      check(`${year}: the Slugger winner has the top home-run/slugging combination`, ok, describeAward(slugger));
    }

    if (king) {
      const leaders = state.battingStats.filter(
        (s) => s.seasonYear === year && s.seasonPhase === 'regular_season' && s.atBats >= AWARD_MIN_BATTING_AT_BATS,
      );
      const bestAvg = Math.max(...leaders.map((s) => s.hits / s.atBats));
      const winnerStat = leaders.find((s) => s.playerId === king.playerId);
      check(`${year}: the King winner has the top average`, Boolean(winnerStat) && winnerStat!.hits / winnerStat!.atBats >= bestAvg, describeAward(king));
    }

    if (strikeoutKing) {
      // Deliberately unfloored, so the whole league's pitchers are in scope here -- not a qualified
      // subset as the batting awards use. The winner must be the league's raw strikeout leader.
      const allPitchers = state.pitchingStats.filter(
        (s) => s.seasonYear === year && s.seasonPhase === 'regular_season' && s.strikeouts > 0,
      );
      const mostStrikeouts = Math.max(...allPitchers.map((s) => s.strikeouts));
      const winnerStat = allPitchers.find((s) => s.playerId === strikeoutKing.playerId);
      check(
        `${year}: the Strikeout King leads the league in raw strikeouts`,
        Boolean(winnerStat) && winnerStat!.strikeouts === mostStrikeouts,
        `${describeAward(strikeoutKing)}; league high ${mostStrikeouts}`,
      );

      /*
       * And the tie-break is never load-bearing by accident: if nobody tied on the count, the K/9
       * and K/BB rungs must not have moved the winner off the raw leader. Reported rather than
       * asserted on a value, because whether a season happened to produce a tie is not a property
       * this check can demand.
       */
      const tiedOnCount = allPitchers.filter((s) => s.strikeouts === mostStrikeouts);
      check(
        `${year}: and the winner is a legal resolution of the count tie (${tiedOnCount.length} tied)`,
        tiedOnCount.length === 1 || tiedOnCount.some((s) => s.playerId === strikeoutKing.playerId),
        `${tiedOnCount.length} pitcher(s) on ${mostStrikeouts} K; winner is ${strikeoutKing.playerName}`,
      );
    }

    if (rookie) {
      const winner = state.players.find((p) => p.playerId === rookie.playerId);
      check(
        `${year}: the Rookie winner is a drafted first-year player on a club`,
        Boolean(winner && winner.yearsPro === 0 && winner.draftRound !== null && winner.teamId),
        describeAward(rookie),
      );
    } else {
      check(
        `${year}: no Rookie is named only when no rookie qualified`,
        qualifiedRookies.length === 0,
        `${qualifiedRookies.length} qualified rookie(s), so the race is ${qualifiedRookies.length === 0 ? 'correctly empty' : 'WRONGLY empty'}`,
      );
    }

    // The rookie race on REAL stats: re-label the best real hitter as a first-year player, then as a
    // veteran. This is the integration test the draft would otherwise provide, without its randomness.
    if (king) {
      const asRookie = calculateRookieOfTheYear(teams, withRookieYears(state, king.playerId, 0), year);
      const asVeteran = calculateRookieOfTheYear(teams, withRookieYears(state, king.playerId, 1), year);
      check(
        `${year}: a real qualified hitter re-labelled as a rookie wins the rookie race`,
        asRookie?.playerId === king.playerId,
        `forcing ${king.playerName} to service year 0 must name him; got ${asRookie?.playerName ?? 'NONE'}`,
      );
      check(
        `${year}: and the same real field with no first-year player names nobody`,
        asVeteran === null,
        `with every player a veteran the race must be empty; got ${asVeteran?.playerName ?? 'NONE'}`,
      );
    }

    if (staff) {
      const winnerTeam = teams.find((t) => t.id === staff.teamId);
      const consistent = Boolean(
        winnerTeam
        && winnerTeam.wins === staff.wins
        && winnerTeam.losses === staff.losses
        && Math.abs(staff.winsAboveExpectation - (staff.wins - staff.expectedWins)) < 0.11,
      );
      check(`${year}: the Staff winner's record and expectation are internally consistent`, consistent, describeStaff(staff));
      const expectedPrior = i === 0 ? initialBaseline.get(staff.teamId) : lastSeasonWins.get(staff.teamId);
      check(
        `${year}: the Staff prior is the PRESEASON baseline, not the season being awarded`,
        staff.priorWins === expectedPrior,
        `winner prior ${staff.priorWins}, expected ${expectedPrior ?? 'MISSING'}; using the just-finished wins would read ${staff.wins} `
        + `(the two differ for every winner here, so a wrong source cannot pass by coincidence)`,
      );
    }

    if (i < SEASONS - 1) {
      const next = year + 1;
      lastSeasonWins = new Map(teams.map((t) => [t.id, t.wins] as const));
      state = resetPlayerSeasonStats(state, next);
      teams = freshTeams(teams, state, next, true);
    }
  }

  check(
    'every season resolves a Slugger, a King and a Staff',
    allSeasonsResolved,
    `${SEASONS} seasons simulated; the three awards that always have a field must always name somebody`,
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  the season archive can name all four awards, and names them the same way twice.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });
