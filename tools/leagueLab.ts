/**
 * GPB League Lab — headless diagnostic harness.
 *
 * Runs the real simulation pipeline (same modules the app and the simulation
 * worker use) for N seasons with no UI, then prints a statistical report.
 *
 * This exists so that model changes can be measured instead of guessed at.
 * Every number below is computed from an actual season of your own data.
 *
 *   npx tsx tools/leagueLab.ts --seasons=100 --seed=1337
 *   npx tsx tools/leagueLab.ts --seasons=25 --granularity=season --no-market
 *
 * Flags:
 *   --seasons=N        number of complete seasons to simulate   (default 100)
 *   --seed=N           master seed for the universe              (default 1337)
 *   --start-year=N     first season year                         (default 2026)
 *   --granularity=day|season
 *                      day    = one SimulationManager.run per day, plus the
 *                              auto free-agency / auto-trade market between
 *                              days. Matches the app's worker exactly. Slow.
 *                      season = one run per phase. No market. Fast. Use for
 *                              pure distributional measurement.
 *   --no-market        skip auto free agency and auto trades
 *   --quiet            suppress per-season progress output
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate, recalculateTeamRatings } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { completeRosterVacancies, getOpenSlots } from '../src/logic/rosterCompletion';
import { applyOffseasonFreeAgencyRollover, applyOffseasonRetirements } from '../src/logic/offseasonFreeAgency';
import {
  applyNextDraftPick,
  createDraftClassState,
  DRAFT_CLASS_SIZE,
  DRAFT_ROUNDS,
  generateDraftClassBundle,
} from '../src/logic/draftLogic';
import { applyPlayerDevelopment } from '../src/logic/playerDevelopment';
import { repairRosterSlotsForTeams } from '../src/logic/rosterManagement';
import { automaticallyAcceptTrades, automaticallySignFreeAgents } from '../src/logic/automaticMarket';
import { generatePendingTradeProposals } from '../src/logic/tradeLogic';
import { isRegularSeasonGame } from '../src/logic/playoffs';
import { readGameEngineProbe, startGameEngineProbe, stopGameEngineProbe } from '../src/logic/gameEngine';
import type { GameEngineProbe } from '../src/logic/gameEngine';
import type {
  Game,
  LeaguePlayerState,
  PendingTradeProposal,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerStatus,
  Team,
} from '../src/types';

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Rng = () => number;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
  const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
  if (match) args.set(match[1], match[2] ?? 'true');
}

const SEASONS = Number(args.get('seasons') ?? '100');
const SEED = Number(args.get('seed') ?? '1337');
const START_YEAR = Number(args.get('start-year') ?? '2026');
const GRANULARITY = args.get('granularity') === 'season' ? 'season' : 'day';
const RUN_MARKET = args.get('no-market') !== 'true';
const QUIET = args.get('quiet') === 'true';

if (!Number.isFinite(SEASONS) || SEASONS < 1) throw new Error('--seasons must be a positive number');
if (!Number.isFinite(SEED)) throw new Error('--seed must be a number');

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};

const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
};

const pearson = (xs: number[], ys: number[]): number => {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
};

const pythagoreanWins = (runsScored: number, runsAllowed: number, games: number): number => {
  const rs = runsScored * runsScored;
  const ra = runsAllowed * runsAllowed;
  const den = rs + ra;
  if (den === 0) return games / 2;
  return (rs / den) * games;
};

const pad = (value: string, width: number): string => value.padEnd(width, ' ');
const padL = (value: string, width: number): string => value.padStart(width, ' ');

const fixed = (value: number, decimals: number): string =>
  Number.isFinite(value) ? value.toFixed(decimals) : 'n/a';

const bar = (value: number, max: number, width = 28): string => {
  if (!Number.isFinite(value) || max <= 0) return '';
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '#'.repeat(filled);
};

// ---------------------------------------------------------------------------
// Career accumulation (so we can prune per-season rows and keep memory flat)
// ---------------------------------------------------------------------------

interface CareerLine {
  seasons: number;
  atBats: number;
  runs: number;
  hits: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  plateAppearances: number;
  runsAllowed: number;
  outsRecorded: number;
  wins: number;
  saves: number;
}

const createCareerLine = (): CareerLine => ({
  seasons: 0,
  atBats: 0,
  runs: 0,
  hits: 0,
  homeRuns: 0,
  walks: 0,
  strikeouts: 0,
  plateAppearances: 0,
  runsAllowed: 0,
  outsRecorded: 0,
  wins: 0,
  saves: 0,
});

const careerByPlayer = new Map<string, CareerLine>();

const getCareer = (playerId: string): CareerLine => {
  let line = careerByPlayer.get(playerId);
  if (!line) {
    line = createCareerLine();
    careerByPlayer.set(playerId, line);
  }
  return line;
};

// ---------------------------------------------------------------------------
// Lifecycle tracking
//
// Career length measured off stat rows is misleading: a player only accrues a
// season when he records a plate appearance or an inning, so bench players and
// short-stint guys look like one-season flukes. The trackers below follow every
// player across the offseason instead, which is also the only way to see who is
// leaving the league and why. Retirements and free-agent age-outs are very
// different events with different causes, and lumping them into "career length"
// hides both.
// ---------------------------------------------------------------------------

type ExitReason = 'retired' | 'aged_out' | 'still_in_league';

interface ExitRecord {
  reason: ExitReason;
  seasonYear: number;
  age: number;
  /** The rating the game actually used when it made the decision. */
  overall: number;
  yearsPro: number;
}

interface PlayerTracking {
  playerId: string;
  playerType: 'batter' | 'pitcher';
  draftClassYear: number | null;
  /**
   * True only for a player who was actually selected in a draft. The generator
   * fabricates a `draftClassYear` for free agents by backfilling
   * `seasonYear - yearsPro`, so that field cannot be used to identify a draftee:
   * an unsigned veteran carries a draftClassYear just as a first-rounder does.
   */
  actuallyDrafted: boolean;
  firstSeenYear: number;
  /** Seasons the player was unsigned before holding a roster slot, for real. */
  unsignedBeforeFirstContract: number;
  firstContractYear: number | null;
  seasonsOnRoster: number;
  seasonsUnsigned: number;
  seasonsWithPAs: number;
  peakOverall: number;
  exit: ExitRecord | null;
}

const tracking = new Map<string, PlayerTracking>();

interface PlayerSnapshotRow {
  status: PlayerStatus;
  age: number;
  yearsPro: number;
  overall: number;
  playerType: 'batter' | 'pitcher';
  draftClassYear: number | null;
  draftRound: number | null;
}

/**
 * Latest `overall` per player, preferring the batting rating when a two-way
 * player has both. Mirrors getPlayerOverall in offseasonFreeAgency so the
 * number we report is the number the retirement check actually saw.
 */
const buildOverallByPlayerId = (playerState: LeaguePlayerState): Map<string, number> => {
  const overalls = new Map<string, number>();
  const consider = (rows: Array<{ playerId: string; seasonYear: number; overall: number }>): void => {
    for (const row of [...rows].sort((left, right) => right.seasonYear - left.seasonYear)) {
      if (!overalls.has(row.playerId)) {
        overalls.set(row.playerId, row.overall);
      }
    }
  };
  consider(playerState.battingRatings);
  consider(playerState.pitchingRatings);
  return overalls;
};

/** Plate appearances by player for a single season, for the "did he actually play" check. */
const buildPAMap = (playerState: LeaguePlayerState, seasonYear: number): Map<string, number> => {
  const pas = new Map<string, number>();
  for (const stat of playerState.battingStats) {
    if (stat.seasonYear !== seasonYear || stat.seasonPhase !== 'regular_season') continue;
    pas.set(stat.playerId, stat.plateAppearances);
  }
  for (const stat of playerState.pitchingStats) {
    if (stat.seasonYear !== seasonYear || stat.seasonPhase !== 'regular_season') continue;
    if (stat.games === 0) continue;
    pas.set(stat.playerId, (pas.get(stat.playerId) ?? 0) + 1);
  }
  return pas;
};

const snapshotPlayers = (playerState: LeaguePlayerState): Map<string, PlayerSnapshotRow> => {  const overalls = buildOverallByPlayerId(playerState);
  const rows = new Map<string, PlayerSnapshotRow>();
  for (const player of playerState.players) {
    rows.set(player.playerId, {
      status: player.status,
      age: player.age,
      yearsPro: player.yearsPro,
      overall: overalls.get(player.playerId) ?? 0,
      playerType: player.playerType,
      draftClassYear: player.draftClassYear,
      draftRound: player.draftRound,
    });
  }
  return rows;
};

/**
 * Walk the offseason boundary once per player. Anything that disappears from
 * the state was removed by the free-agent age-out; anything newly marked
 * retired was retired. Everything else accrues a season on the roster or a
 * season unsigned.
 */
const trackOffseason = (
  before: LeaguePlayerState,
  after: LeaguePlayerState,
  seasonYear: number,
  paByPlayerId: Map<string, number>,
): void => {
  const beforeRows = snapshotPlayers(before);
  const afterRows = snapshotPlayers(after);

  for (const [playerId, beforeRow] of beforeRows) {
    let tracked = tracking.get(playerId);
    if (!tracked) {
      tracked = {
        playerId,
        playerType: beforeRow.playerType,
        draftClassYear: beforeRow.draftClassYear,
        actuallyDrafted: beforeRow.draftRound !== null,
        firstSeenYear: seasonYear,
        unsignedBeforeFirstContract: 0,
        firstContractYear: null,
        seasonsOnRoster: 0,
        seasonsUnsigned: 0,
        seasonsWithPAs: 0,
        peakOverall: 0,
        exit: null,
      };
      tracking.set(playerId, tracked);
    }

    tracked.draftClassYear = beforeRow.draftClassYear ?? tracked.draftClassYear;
    // Sticky: a player keeps the fact that a club drafted him even after the
    // roster rows that recorded the round fall out of history.
    if (beforeRow.draftRound !== null) tracked.actuallyDrafted = true;
    tracked.peakOverall = Math.max(tracked.peakOverall, beforeRow.overall);

    const afterRow = afterRows.get(playerId);
    if (!afterRow) {
      // Removed from playerState entirely: the free-agent age-out.
      tracked.exit = {
        reason: 'aged_out',
        seasonYear,
        age: beforeRow.age,
        overall: beforeRow.overall,
        yearsPro: beforeRow.yearsPro,
      };
      continue;
    }

    if (afterRow.status === 'retired') {
      if (!tracked.exit) {
        tracked.exit = {
          reason: 'retired',
          seasonYear,
          // applyOffseasonRetirements ages the player before it rolls the dice.
          age: beforeRow.age + 1,
          overall: beforeRow.overall,
          yearsPro: beforeRow.yearsPro,
        };
      }
      continue;
    }

    if (afterRow.status === 'active') {
      if (tracked.firstContractYear === null) tracked.firstContractYear = seasonYear + 1;
      tracked.seasonsOnRoster += 1;
    } else if (afterRow.status === 'free_agent') {
      tracked.seasonsUnsigned += 1;
      // Captured before any signing so it stays true even if the player signs in
      // the same offseason that created the record. Counting unsigned seasons and
      // then deriving a year difference loses that case entirely.
      if (tracked.firstContractYear === null) tracked.unsignedBeforeFirstContract += 1;
    }

    if ((paByPlayerId.get(playerId) ?? 0) > 0) tracked.seasonsWithPAs += 1;
  }

  // Anyone still in the league hasn't left, so they get no exit record. The
  // report treats them as 'still_in_league' rather than dropping them.
};

// ---------------------------------------------------------------------------
// Season snapshot
// ---------------------------------------------------------------------------

interface SeasonSnapshot {
  year: number;
  runEnvironment: number;
  homeRunEnvironment: number;
  leagueAvg: number;
  leagueObp: number;
  leagueSlg: number;
  leagueEra: number;
  plateAppearancesPerTeamGame: number;
  totalBasesPerTeamGame: number;
  hitsPerTeamGame: number;
  singlesPerTeamGame: number;
  doublesPerTeamGame: number;
  triplesPerTeamGame: number;
  walksPerTeamGame: number;
  strikeoutsPerTeamGame: number;
  runsPerPlateAppearance: number;
  totalGamesPlayed: number;
  teamGamesPlayed: number;
  /** Per-at-bat run environment, from the engine's opt-in probe. Null under --no-games. */
  probe: GameEngineProbe | null;
  teamWins: number[];
  ninetyWinTeams: number;
  hundredWinTeams: number;
  homeWins: number;
  homeGames: number;
  pythagoreanError: number;
  runDiffWinCorrelation: number;
  ratingsByAge: Map<number, number[]>;
  topPlayerAges: number[];
  retirements: number;
  activeCount: number;
  freeAgentCount: number;
  pipeline: OffseasonPipeline | null;
}

/**
 * The unsigned-player ledger for one offseason. Every number here is a count of
 * something the offseason actually did, read off the return values of the real
 * functions rather than inferred from pool sizes. Without this the free agent
 * pool's growth could be attributed to any of four different causes.
 */
interface OffseasonPipeline {
  /** Slots vacant when the offseason began, i.e. what there is to fill. */
  openSlotsEntering: number;
  /** Contracts that ran out and put a player on the market. */
  releasedToMarket: number;
  /** Players the market's rules sent to free agency (qualifying offer declined). */
  qualifiersDeclined: number;
  /** Existing free agents the offseason market signed. */
  freeAgentsSigned: number;
  /** Open slots the offseason market could not fill, and drafted a rookie instead. */
  rookiesAdded: number;
  /** Vacancies left over after the market and the rookie class both ran out. */
  openSlotsLeft: number;
  /** Free agents removed by the age-out backstop. */
  agedOutFreeAgents: number;
  /** Draft class size actually consumed by picks. */
  draftPicks: number;
  /** Of this class's picks, how many ended the offseason still unsigned. */
  drafteesUnsigned: number;
  /** Of this class's picks, how many kept a roster slot into the new season. */
  drafteesOnRoster: number;
  /** Age of the unsigned pool, median. Low means the surplus is young and cheap. */
  unsignedMedianAge: number;
  /** Free agents still unsigned when the next season begins. */
  unsignedRemaining: number;
  /** Of those, how many are good enough that any club should have taken them. */
  unsigned78Plus: number;
  /** Median overall of the unsigned pool. Low means the pool is surplus depth. */
  unsignedMedianOverall: number;
  /** Signings made by the in-season daily market, which runs on different rules. */
  inSeasonMarketSignings: number;
}

/**
 * The ledger from the most recent offseason. Held outside runSeason because the
 * snapshot is taken before the offseason runs, so the report has to read it
 * after the fact.
 */
let lastPipeline: OffseasonPipeline | null = null;

const snapshots: SeasonSnapshot[] = [];

// ---------------------------------------------------------------------------
// Universe construction
// ---------------------------------------------------------------------------

const buildFreshTeams = (teams: Team[]): Team[] =>
  recalculateTeamRatings(
    teams.map((team) => ({ ...team, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    DEFAULT_SETTINGS,
  );

const buildSchedule = (teams: Team[], seasonYear: number): Game[] =>
  generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(seasonYear), seasonDays: 180 });

const NO_GAMES = args.get('no-games') === 'true';

const latestRatingsByPlayer = (
  playerState: LeaguePlayerState,
  seasonYear: number,
): Map<string, { overall: number; seasonYear: number }> => {
  const result = new Map<string, { overall: number; seasonYear: number }>();
  for (const rating of [...playerState.battingRatings, ...playerState.pitchingRatings]) {
    if (rating.seasonYear > seasonYear) continue;
    const existing = result.get(rating.playerId);
    if (!existing || rating.seasonYear >= existing.seasonYear) {
      result.set(rating.playerId, { overall: rating.overall, seasonYear: rating.seasonYear });
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// Season runner
// ---------------------------------------------------------------------------

const stableTradeKey = (proposal: PendingTradeProposal): string =>
  [proposal.fromTeamId, proposal.toTeamId, proposal.fromPlayerId, proposal.toPlayerId, proposal.needSlot].join(':');

const runSeason = async (
  initialTeams: Team[],
  initialPlayerState: LeaguePlayerState,
  initialGames: Game[],
  seasonYear: number,
  rng: Rng,
): Promise<{ teams: Team[]; games: Game[]; playerState: LeaguePlayerState; retirements: number }> => {
  const started = Date.now();

  let teams = initialTeams;
  let games = initialGames;
  let playerState = initialPlayerState;
  let currentDate = games[0]?.date ?? getDefaultSeasonStartDate(seasonYear);

  // The in-season market works on completely different rules from the offseason
  // one (strict upgrade, capped signings, incumbents protected), so its signings
  // are counted separately. Without a separate count there is no way to tell an
  // offseason market failure from an offseason market that was never needed.
  let inSeasonMarketSignings = 0;

  const manager = new SimulationManager({
    teams,
    games,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate,
  });

  const knownTradeKeys = new Set(
    generatePendingTradeProposals(teams, playerState, games.filter(isRegularSeasonGame), currentDate).map(stableTradeKey),
  );

  const runPhase = async (scope: 'day' | 'regular_season' | 'season'): Promise<number> => {
    const result = await manager.run({ scope });
    const complete = result.games.every((game) => game.status === 'completed');
    teams = complete ? result.teams.map((team) => ({ ...team, previousBaselineWins: team.wins })) : result.teams;
    games = result.games;
    playerState = result.playerState;
    currentDate = result.currentDate;
    return result.simulatedGameCount;
  };

  const applyMarket = () => {
    if (!RUN_MARKET) return;
    // Counted from the resulting free agent roster rather than from the market's
    // return value, which the game does not expose. A signing always moves one
    // player from free_agent to active, so the drop is the count.
    const freeAgentsBefore = playerState.players.filter((player) => player.status === 'free_agent').length;
    playerState = automaticallySignFreeAgents(teams, playerState, currentDate);
    const freeAgentsAfter = playerState.players.filter((player) => player.status === 'free_agent').length;
    inSeasonMarketSignings += Math.max(0, freeAgentsBefore - freeAgentsAfter);
    const proposals = generatePendingTradeProposals(teams, playerState, games.filter(isRegularSeasonGame), currentDate);
    const fresh = proposals.filter((proposal) => !knownTradeKeys.has(stableTradeKey(proposal)));
    for (const proposal of proposals) knownTradeKeys.add(stableTradeKey(proposal));
    if (fresh.length > 0) {
      playerState = automaticallyAcceptTrades(fresh, playerState, currentDate);
    }
  };

  // --- regular season ---
  // --no-games exercises the offseason chain alone (ageing, development, draft,
  // roster completion) without paying for 2464 games. It produces no usable
  // stat sample, so the stat reports are meaningless in that mode; the point is
  // to check that the player pool stays bounded and the offseason stays stable.
  if (NO_GAMES) {
    if (!QUIET) process.stdout.write(`  ${seasonYear}  skipping regular season (--no-games)\n`);
  } else {
    // Watch the run environment from the first at-bat of the season. The probe is
    // what makes the scoring report diagnostic rather than merely descriptive:
    // it records base occupancy and runs per outcome, which is the only way to
    // tell a league that swings too little from one that strands its runners.
    startGameEngineProbe();
    if (GRANULARITY === 'day') {
      for (let day = 0; day < 220; day += 1) {
        if (games.every((game) => game.status === 'completed')) break;
        const before = games.filter((game) => game.status === 'scheduled').length;
        await runPhase('day');
        applyMarket();
        if (!QUIET && before > 0 && day % 20 === 0) {
          const remaining = games.filter((game) => game.status === 'scheduled').length;
          process.stdout.write(`  ${seasonYear}  day ${String(day + 1).padStart(3)}  ${remaining} games left\n`);
        }
      }
    } else {
      if (!QUIET) process.stdout.write(`  ${seasonYear}  simulating regular season...\n`);
      await runPhase('regular_season');
      applyMarket();
    }
  }

  // --- playoffs ---
  if (!NO_GAMES) {
    // The manager builds each round lazily, so we keep feeding it until the whole
    // bracket is done. Scope 'season' drains every currently scheduled game and
    // then advances the bracket, so each call is one round's worth of work.
    for (let round = 0; round < 40; round += 1) {
      if (games.every((game) => game.status === 'completed')) break;
      const progressed = await runPhase('season');
      if (progressed === 0) break;
    }
  }

  // --- snapshot before the offseason mutates anything ---
  const snapshot = collectSnapshot(seasonYear, teams, games, playerState);
  if (!NO_GAMES) {
    snapshot.probe = readGameEngineProbe();
    stopGameEngineProbe();
  }
  snapshots.push(snapshot);
  if (!QUIET && !NO_GAMES) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(
      `  ${seasonYear}  done in ${elapsed}s  |  R/G ${fixed(snapshot.runEnvironment, 2)}` +
        `  HR/G ${fixed(snapshot.homeRunEnvironment, 2)}` +
        `  avg wins ${fixed(mean(snapshot.teamWins), 1)}` +
        `  90+ ${snapshot.ninetyWinTeams}\n`,
    );
  }

  // --- offseason: age + retire, then contracts/FA, then roster refresh ---
  const retirementResult = applyOffseasonRetirements({
    playerState,
    seasonYear,
    effectiveDate: `${seasonYear + 1}-11-01`,
  });

  const nextYear = seasonYear + 1;

  const rollover = applyOffseasonFreeAgencyRollover({
    playerState: retirementResult.nextPlayerState,
    teams,
    seasonYear,
    effectiveDate: `${seasonYear + 1}-12-01`,
    rng,
    skipAgeAndRetirements: true,
  });

  // Ageing and retirements have already happened, so players now carry the age
  // they will be next season. Development writes a fresh ratings row for that
  // year before the roster is refilled, so free agency evaluates current talent.
  const development = applyPlayerDevelopment({
    playerState: rollover.nextPlayerState,
    seasonYear: nextYear,
    effectiveDate: `${nextYear}-12-10`,
    retainRatingYears: 10,
  });

  // The real draft, matching the app's order: age, then develop, then draft,
  // then fill remaining vacancies. Running the actual draft matters for
  // measurement fidelity, because applyNextDraftPick deletes every undrafted
  // prospect when the class is exhausted. Approximating the draft with
  // completeRosterVacancies alone leaves them all in the pool forever and
  // silently corrupts every age-based statistic in the report below.
  const draft = runDraft(development.nextPlayerState, teams, nextYear);

  const nextRoster = completeRosterVacancies(
    teams,
    draft.playerState,
    nextYear,
    `${nextYear}-12-15`,
  );

  // Vacancy has to be counted on the repaired next-season slot rows, not on the
  // state as it stands beforehand. The new season owns no rows yet, so counting
  // slots before repair reports all 928 as open and tells you nothing. This
  // replicates the repair the filler performs first, then reads the vacancies it
  // left behind: the real size of the job the market was given.
  const repairedForMeasure = repairRosterSlotsForTeams(draft.playerState, teams.map((team) => team.id), nextYear);
  const openSlotsEntering = getOpenSlots(repairedForMeasure.rosterSlots, teams, nextYear).length;

  const retirements = retirementResult.retiredPlayers;

  // --- free agent ledger ---------------------------------------------------
  // Rated from the ratings rows development just wrote for nextYear, so the
  // unsigned pool is judged on the talent it has now, not the talent it had
  // when it last held a roster slot.
  const latestBatting = new Map<string, PlayerBattingRatings>();
  const latestPitching = new Map<string, PlayerPitchingRatings>();
  for (const row of nextRoster.playerState.battingRatings) {
    const held = latestBatting.get(row.playerId);
    if (!held || row.seasonYear > held.seasonYear) latestBatting.set(row.playerId, row);
  }
  for (const row of nextRoster.playerState.pitchingRatings) {
    const held = latestPitching.get(row.playerId);
    if (!held || row.seasonYear > held.seasonYear) latestPitching.set(row.playerId, row);
  }
  const unsignedOverall = (playerId: string): number =>
    latestBatting.get(playerId)?.overall ?? latestPitching.get(playerId)?.overall ?? 0;

  const unsignedPool = nextRoster.playerState.players.filter((p) => p.status === 'free_agent');
  const unsignedOveralls = unsignedPool.map((p) => unsignedOverall(p.playerId)).sort((a, b) => a - b);

  const signedPlayerIds = new Set(
    nextRoster.playerState.players.filter((p) => p.status === 'active').map((p) => p.playerId),
  );
  const unsignedDrafted = draft.draftedPlayerIds.filter((playerId) => {
    const player = nextRoster.playerState.players.find((entry) => entry.playerId === playerId);
    return player ? player.status === 'free_agent' : false;
  }).length;
  const unsignedAges = unsignedPool.map((p) => p.age).sort((a, b) => a - b);

  const pipeline: OffseasonPipeline = {
    openSlotsEntering,
    releasedToMarket: rollover.summary.releasedToMarket,
    qualifiersDeclined: rollover.summary.qualifyingOffersDeclined,
    freeAgentsSigned: nextRoster.freeAgentsSigned,
    rookiesAdded: nextRoster.rookiesAdded,
    openSlotsLeft: nextRoster.remainingOpenSlots,
    agedOutFreeAgents: nextRoster.agedOutFreeAgents,
    draftPicks: draft.picks,
    drafteesUnsigned: unsignedDrafted,
    drafteesOnRoster: draft.draftedPlayerIds.filter((id) => signedPlayerIds.has(id)).length,
    unsignedMedianAge: unsignedAges.length > 0 ? percentile(unsignedAges, 0.5) : 0,
    unsignedRemaining: unsignedPool.length,
    unsigned78Plus: unsignedPool.filter((p) => unsignedOverall(p.playerId) >= 78).length,
    unsignedMedianOverall: unsignedOveralls.length > 0 ? percentile(unsignedOveralls, 0.5) : 0,
    inSeasonMarketSignings,
  };
  lastPipeline = pipeline;

  // Lifecycle tracking needs both sides of the offseason boundary: who was in
  // the league going in, and who is still there coming out. Everything that
  // vanished was aged out, everything newly retired retired, everything else
  // accrued a roster season or an unsigned one.
  trackOffseason(playerState, nextRoster.playerState, nextYear, buildPAMap(playerState, seasonYear));

  if (!QUIET) {
    const s = development.summary;
    const pool = nextRoster.playerState.players.length;
    const prospects = nextRoster.playerState.players.filter((p) => p.status === 'prospect').length;
    const freeAgents = nextRoster.playerState.players.filter((p) => p.status === 'free_agent').length;
    process.stdout.write(
      `         dev: ${s.playersDeveloped} players  avg ${s.averageOverall.toFixed(1)}` +
        `  +${s.bigGains} / -${s.bigDeclines}  injured ${s.injuredPlayers}\n` +
        `         draft: ${draft.picks} picks  |  pool ${pool}` +
        `  (active ${pool - prospects - freeAgents}, FA ${freeAgents}, prospect ${prospects})` +
        `  aged out ${nextRoster.agedOutFreeAgents}\n`,
    );
    process.stdout.write(
      `         FA: ${pipeline.openSlotsEntering} open` +
      `  ->  signed ${pipeline.freeAgentsSigned} FA / drafted ${pipeline.rookiesAdded}` +
      `  ->  left ${pipeline.openSlotsLeft}  |  unsigned ${pipeline.unsignedRemaining}` +
      `  (med OVR ${pipeline.unsignedMedianOverall.toFixed(1)}, ${pipeline.unsigned78Plus} at 78+)\n`,
    );
  }

  // The snapshot is collected before the offseason mutates anything, so this
  // ledger belongs to the season that snapshot will report on.
  if (snapshots.length > 0) snapshots[snapshots.length - 1].pipeline = pipeline;

  return {
    teams,
    games,
    playerState: nextRoster.playerState,
    retirements,
  };
};

/**
 * Runs a complete amateur draft the same way the app's draft center does:
 * generate a class, add those players to the league, then apply every pick
 * until the class is exhausted.
 */
const runDraft = (
  inputPlayerState: LeaguePlayerState,
  teams: Team[],
  seasonYear: number,
): { playerState: LeaguePlayerState; picks: number; draftedPlayerIds: string[] } => {
  const effectiveDate = `${seasonYear}-12-12`;
  const targetProspectCount = Math.max(DRAFT_CLASS_SIZE, teams.length * DRAFT_ROUNDS + 32);
  const bundle = generateDraftClassBundle(seasonYear, targetProspectCount);
  const draftedPlayerIds: string[] = [];

  const existingPlayerIds = new Set(inputPlayerState.players.map((player) => player.playerId));
  let playerState: LeaguePlayerState = {
    ...inputPlayerState,
    players: [...inputPlayerState.players, ...bundle.players.filter((player) => !existingPlayerIds.has(player.playerId))],
    battingStats: [...inputPlayerState.battingStats, ...bundle.battingStats],
    pitchingStats: [...inputPlayerState.pitchingStats, ...bundle.pitchingStats],
    battingRatings: [...inputPlayerState.battingRatings, ...bundle.battingRatings],
    pitchingRatings: [...inputPlayerState.pitchingRatings, ...bundle.pitchingRatings],
  };

  let draftClass = createDraftClassState(seasonYear, teams, bundle.prospects);
  let picks = 0;

  while (!draftClass.isComplete) {
    const step = applyNextDraftPick(draftClass, playerState, teams, effectiveDate);
    if (!step) break;
    // A pick removes its prospect from the board, so the ones that disappeared
    // are exactly the players drafted. Watching this is the only way to tell a
    // drafted player who kept a roster spot all offseason from one the market
    // pushed straight back out.
    const after = new Set(step.draftClass.prospects.map((prospect) => prospect.playerId));
    for (const prospect of draftClass.prospects) {
      if (!after.has(prospect.playerId)) draftedPlayerIds.push(prospect.playerId);
    }
    draftClass = step.draftClass;
    playerState = step.playerState;
    picks += 1;
  }

  return { playerState, picks, draftedPlayerIds };
};

// ---------------------------------------------------------------------------
// Snapshot collection
// ---------------------------------------------------------------------------

const collectSnapshot = (
  seasonYear: number,
  teams: Team[],
  games: Game[],
  playerState: LeaguePlayerState,
): SeasonSnapshot => {
  const regular = games.filter(isRegularSeasonGame);
  const completed = regular.filter((game) => game.status === 'completed');
  const totalGames = completed.length;

  let runs = 0;
  for (const game of completed) {
    runs += game.score.away + game.score.home;
  }

  // League batting environment from qualified hitters.
  const qualifiedBatting = playerState.battingStats.filter(
    (stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season' && stat.plateAppearances >= 100,
  );
  let avgTotal = 0;
  let obpTotal = 0;
  let slgTotal = 0;
  for (const stat of qualifiedBatting) {
    const atBats = Math.max(1, stat.atBats);
    const totalBases = stat.hits + stat.doubles + stat.triples * 2 + stat.homeRuns * 3;
    avgTotal += stat.hits / atBats;
    obpTotal += (stat.hits + stat.walks) / Math.max(1, stat.plateAppearances);
    slgTotal += totalBases / atBats;
  }
  const divisor = Math.max(1, qualifiedBatting.length);

  // Home runs come from the player ledger, not the game record.
  let leagueHomeRuns = 0;
  for (const stat of playerState.battingStats) {
    if (stat.seasonYear !== seasonYear || stat.seasonPhase !== 'regular_season') continue;
    leagueHomeRuns += stat.homeRuns;
  }

  const qualifiedPitching = playerState.pitchingStats.filter(
    (stat) =>
      stat.seasonYear === seasonYear &&
      stat.seasonPhase === 'regular_season' &&
      stat.inningsPitched >= 20,
  );
  let eraTotal = 0;
  for (const stat of qualifiedPitching) {
    eraTotal += (stat.earnedRuns / Math.max(1, stat.inningsPitched)) * 9;
  }

  // Volume metrics, computed league-wide rather than from qualified hitters.
  //
  // The AVG/OBP/SLG rows above are per-player ratios over 100+ PA hitters, which
  // tells you how good a hitter hits but nothing about how much hitting there is.
  // A league can post a perfectly normal SLG and still score 50% too many runs if
  // runs are tallied more generously than the bases justify.
  //
  // References are real MLB per team per game (~33.5 AB, SLG .415, 4.4 R):
  //   plate appearances   37.0
  //   hits                8.6      singles 5.6  doubles 1.76  triples 0.23  HR 1.06
  //   total bases        14.0      (SLG .415 x 33.5 AB)
  //   runs                4.4
  //
  // That gives the raw scoring ratio R/TB ~= 0.31. Note this is NOT the familiar
  // "0.9 runs per total base" figure -- that one is a linear-weights constant
  // describing runs above replacement, not the raw ratio of scored runs to bases
  // collected. Using 0.9 here makes any league look broken.
  let leaguePlateAppearances = 0;
  let leagueTotalBases = 0;
  let leagueHits = 0;
  let leagueWalks = 0;
  let leagueStrikeouts = 0;
  let leagueDoubles = 0;
  let leagueTriples = 0;
  for (const stat of playerState.battingStats) {
    if (stat.seasonYear !== seasonYear || stat.seasonPhase !== 'regular_season') continue;
    leaguePlateAppearances += stat.plateAppearances;
    leagueTotalBases += stat.hits + stat.doubles + stat.triples * 2 + stat.homeRuns * 3;
    leagueHits += stat.hits;
    leagueWalks += stat.walks;
    leagueStrikeouts += stat.strikeouts;
    leagueDoubles += stat.doubles;
    leagueTriples += stat.triples;
  }
  // Every completed game is one team-game for the home side and one for the away
  // side, so the league plays twice as many team-games as there are games.
  const teamGames = Math.max(1, completed.length * 2);
  const perTeamGame = (total: number): number => total / teamGames;
  const leagueSingles = Math.max(0, leagueHits - leagueDoubles - leagueTriples - leagueHomeRuns);

  const teamWins = teams.map((team) => team.wins);
  const ninetyWinTeams = teamWins.filter((wins) => wins >= 90).length;
  const hundredWinTeams = teamWins.filter((wins) => wins >= 100).length;

  let homeWins = 0;
  let homeGames = 0;
  for (const game of completed) {
    homeGames += 1;
    if (game.score.home > game.score.away) homeWins += 1;
  }

  const pythErrors: number[] = [];
  const runDiffs: number[] = [];
  const winTotals: number[] = [];
  for (const team of teams) {
    const gamesPlayed = team.wins + team.losses;
    if (gamesPlayed === 0) continue;
    runDiffs.push(team.runsScored - team.runsAllowed);
    winTotals.push(team.wins);
    pythErrors.push(team.wins - pythagoreanWins(team.runsScored, team.runsAllowed, gamesPlayed));
  }

  const ratingsByAge = new Map<number, number[]>();
  const overallByPlayer = latestRatingsByPlayer(playerState, seasonYear);
  for (const player of playerState.players) {
    if (player.status !== 'active') continue;
    const rating = overallByPlayer.get(player.playerId);
    if (!rating) continue;
    const bucket = ratingsByAge.get(player.age) ?? [];
    bucket.push(rating.overall);
    ratingsByAge.set(player.age, bucket);
  }

  const topPlayerAges = [...playerState.players]
    .filter((player) => player.status === 'active')
    .map((player) => ({ player, overall: overallByPlayer.get(player.playerId)?.overall ?? 0 }))
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 25)
    .map((entry) => entry.player.age);

  return {
    year: seasonYear,
    // Per TEAM-game, not per game. `runs` above sums both sides of every game, so
    // dividing by the game count yields the combined scoring of a game, which is
    // roughly double the number people mean by "runs per game" and the number
    // every MLB reference is quoted against. Dividing by team-games puts this on
    // the same footing as those references and as the volume metrics below.
    runEnvironment: perTeamGame(runs),
    homeRunEnvironment: perTeamGame(leagueHomeRuns),
    leagueAvg: avgTotal / divisor,
    leagueObp: obpTotal / divisor,
    leagueSlg: slgTotal / divisor,
    leagueEra: eraTotal / Math.max(1, qualifiedPitching.length),
    // Volume, league-wide. See the comment above: these are what separate "the
    // hitters are too good" from "there is too much hitting."
    plateAppearancesPerTeamGame: perTeamGame(leaguePlateAppearances),
    totalBasesPerTeamGame: perTeamGame(leagueTotalBases),
    hitsPerTeamGame: perTeamGame(leagueHits),
    singlesPerTeamGame: perTeamGame(leagueSingles),
    doublesPerTeamGame: perTeamGame(leagueDoubles),
    triplesPerTeamGame: perTeamGame(leagueTriples),
    walksPerTeamGame: perTeamGame(leagueWalks),
    strikeoutsPerTeamGame: perTeamGame(leagueStrikeouts),
    runsPerPlateAppearance: leaguePlateAppearances > 0 ? runs / leaguePlateAppearances : 0,
    totalGamesPlayed: totalGames,
    teamGamesPlayed: teamGames,
    // Filled in by the caller, which owns the probe lifecycle.
    probe: null,
    teamWins,
    ninetyWinTeams,
    hundredWinTeams,
    homeWins,
    homeGames,
    pythagoreanError: mean(pythErrors),
    runDiffWinCorrelation: pearson(runDiffs, winTotals),
    ratingsByAge,
    topPlayerAges,
    retirements: 0,
    activeCount: playerState.players.filter((player) => player.status === 'active').length,
    freeAgentCount: playerState.players.filter((player) => player.status === 'free_agent').length,
    pipeline: null,
  };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Year one, before any season has been played. This is the universe a player
 * gets from the New Universe screen, so if the age shape is wrong here the
 * whole league starts wrong and every later measurement inherits it.
 */
const reportOpeningUniverse = (diagnostics: {
  seasonYear: number;
  seed: number;
  playerCount: number;
  activeCount: number;
  freeAgentCount: number;
  prospectCount: number;
  expectedRosterSlots: number;
  filledRosterSlots: number;
  averageOverall: number;
  medianOverall: number;
  peakAge: number;
  callUpCount: number;
  age35PlusCount: number;
  ageRows: Array<{ age: number; count: number; medianOverall: number }>;
  tierRows: Array<{ label: string; count: number }>;
}) => {
  console.log('\n--- OPENING UNIVERSE (before any season) ---------------------------------');
  console.log(`  season ${diagnostics.seasonYear}   seed ${diagnostics.seed}`);
  console.log(
    `  pool ${diagnostics.playerCount}   active ${diagnostics.activeCount}` +
      `   FA ${diagnostics.freeAgentCount}   prospects ${diagnostics.prospectCount}`,
  );
  const rostersOk = diagnostics.filledRosterSlots >= diagnostics.expectedRosterSlots;
  console.log(
    `  rosters filled ${diagnostics.filledRosterSlots}/${diagnostics.expectedRosterSlots}   ${rostersOk ? 'complete' : '** INCOMPLETE **'}`,
  );
  console.log(`  overall avg ${diagnostics.averageOverall.toFixed(1)}   median ${diagnostics.medianOverall.toFixed(0)}`);

  const maxCount = Math.max(...diagnostics.ageRows.map((row) => row.count), 1);
  console.log('\n  age   n   med ovr   distribution');
  for (const row of diagnostics.ageRows) {
    const marker = row.age === diagnostics.peakAge ? ' <- peak' : '';
    console.log(
      `  ${padL(String(row.age), 4)}${padL(String(row.count), 6)}${padL(row.medianOverall.toFixed(0), 10)}   ${bar(row.count, maxCount)}${marker}`,
    );
  }

  const maxTier = Math.max(...diagnostics.tierRows.map((row) => row.count), 1);
  console.log('\n  talent tiers');
  for (const row of diagnostics.tierRows) {
    console.log(`  ${pad(row.label, 20)}${padL(String(row.count), 6)}   ${bar(row.count, maxTier, 20)}`);
  }

  console.log(`\n  call-ups (age 23-)  ${diagnostics.callUpCount}   age 35+  ${diagnostics.age35PlusCount}`);

  // Deliberately no peak-age check here. A generated pool is flat by age on
  // purpose: overall comes from the talent tier quotas, not from a player's
  // birthday. Any "peak" this table shows is sampling noise, and the real age
  // curve is supposed to be carved out later by playerDevelopment. Testing for
  // a peak at birth would be testing for the thing the model is meant to add.
  const problems: string[] = [];
  if (!rostersOk) problems.push('roster slots are not fully occupied');
  if (diagnostics.callUpCount === 0) problems.push('no players under 24 -- the league has no pipeline');
  const share35 = diagnostics.playerCount > 0 ? diagnostics.age35PlusCount / diagnostics.playerCount : 0;
  if (share35 > 0.15) problems.push(`${(share35 * 100).toFixed(0)}% of the pool is 35+ (real MLB ~6%)`);
  if (diagnostics.tierRows.every((row) => row.count === 0)) problems.push('no talent tiers were populated');

  if (problems.length === 0) {
    console.log('\n  ** VERDICT: opening universe is coherent. **');
    console.log('     Full rosters, a real age shape, a young cohort feeding the majors,');
    console.log('     and talent spread across every tier. Median overall is flat by age,');
    console.log('     which is correct: the age curve is development\'s job, not the');
    console.log('     generator\'s. See THE AGING CURVE for the curve that emerges.');
  } else {
    console.log('\n  ** VERDICT: opening universe is not coherent yet. **');
    for (const problem of problems) console.log(`     - ${problem}`);
  }
};

const reportEnvironment = () => {
  const runEnv = snapshots.map((s) => s.runEnvironment);
  const hrEnv = snapshots.map((s) => s.homeRunEnvironment);
  const avg = snapshots.map((s) => s.leagueAvg);
  const obp = snapshots.map((s) => s.leagueObp);
  const slg = snapshots.map((s) => s.leagueSlg);
  const era = snapshots.map((s) => s.leagueEra);

  const rows: Array<[string, number, number, [number, number], string]> = [
    ['Runs / team-game', mean(runEnv), 4.28, [4.1, 4.6], mean(runEnv).toFixed(2)],
    ['HR / team-game', mean(hrEnv), 1.06, [1.0, 1.15], mean(hrEnv).toFixed(2)],
    ['League AVG', mean(avg), 0.248, [0.24, 0.255], mean(avg).toFixed(3)],
    ['League OBP', mean(obp), 0.322, [0.315, 0.33], mean(obp).toFixed(3)],
    ['League SLG', mean(slg), 0.415, [0.395, 0.44], mean(slg).toFixed(3)],
    ['League ERA', mean(era), 4.2, [3.9, 4.5], mean(era).toFixed(2)],
  ];

  console.log('\n--- LEAGUE ENVIRONMENT -------------------------------------------------');
  console.log('  per team-game (a completed game is one team-game per side)');
  console.log(`${pad('metric', 20)}${padL('value', 10)}${padL('MLB ref', 10)}${padL('expected', 16)}diagnostic`);
  let outOfRange = 0;
  for (const [label, value, reference, [low, high], display] of rows) {
    // Test the band that is actually printed. This used to apply a blanket 35%
    // tolerance instead, which reported 3.78 runs/game as "in range" while
    // printing an expected range of 4.10 - 4.60 directly beside it. The band is
    // also printed at full precision so the displayed range and the tested range
    // are the same number -- rounding a 0.315 floor to "0.32" made a league at
    // .316 look like it was inside a band that started above it.
    const ok = value >= low && value <= high;
    if (!ok) outOfRange += 1;
    const gap = value - reference;
    const detail = ok ? 'in range' : `${gap >= 0 ? '+' : ''}${gap.toFixed(3)} vs ref`;
    console.log(
      `${pad(label, 20)}${padL(display, 10)}${padL(reference.toFixed(3), 10)}` +
        `${padL(`${low.toFixed(3)} - ${high.toFixed(3)}`, 16)}${detail}`,
    );
  }
  if (outOfRange === 0) {
    console.log('  ** every environment metric is inside its real-MLB band. **');
  } else {
    console.log(`  ** ${outOfRange} of ${rows.length} environment metrics are outside their real band. **`);
  }
  console.log(`  season-to-season stdev: R/G ${stdev(runEnv).toFixed(3)}   AVG ${stdev(avg).toFixed(4)}`);
  reportRunDecomposition();
};

/**
 * Where the runs actually come from.
 *
 * Runs/game is a product of two independent things: how much hitting there is
 * (plate appearances) and how much each plate appearance is worth (total bases).
 * A normal SLG alongside an inflated R/G means one of the two is off, and which
 * one decides where the fix goes. Runs track total bases at roughly 0.9 per base,
 * so R/G should land near 0.9 x TB/game; that identity is the thing to check.
 */
const reportRunDecomposition = () => {
  const pa = snapshots.map((s) => s.plateAppearancesPerTeamGame);
  const tb = snapshots.map((s) => s.totalBasesPerTeamGame);
  const hits = snapshots.map((s) => s.hitsPerTeamGame);
  const singles = snapshots.map((s) => s.singlesPerTeamGame);
  const doubles = snapshots.map((s) => s.doublesPerTeamGame);
  const triples = snapshots.map((s) => s.triplesPerTeamGame);
  const walks = snapshots.map((s) => s.walksPerTeamGame);
  const k = snapshots.map((s) => s.strikeoutsPerTeamGame);
  const rpa = snapshots.map((s) => s.runsPerPlateAppearance);
  const rg = snapshots.map((s) => s.runEnvironment);

  const paMean = mean(pa);
  const tbMean = mean(tb);
  const hitsMean = mean(hits);
  const walksMean = mean(walks);
  const kMean = mean(k);
  const rpaMean = mean(rpa);
  const rgMean = mean(rg);

  console.log('\n--- RUN DECOMPOSITION -----------------------------------------------');
  console.log('  volume per team-game (a completed game = 2 team-games)');
  console.log(`${pad('metric', 30)}${padL('sim', 9)}${padL('MLB ref', 9)}${padL('delta', 8)}reads as`);
  const rows: Array<[string, number, number, string]> = [
    ['PA / team-game', paMean, 37.0, 'how much hitting exists'],
    ['Hits / team-game', hitsMean, 8.6, 'batting average in volume'],
    ['  singles', mean(singles), 5.55, 'the bread and butter'],
    ['  doubles', mean(doubles), 1.76, 'extra-base gaps'],
    ['  triples', mean(triples), 0.23, 'should be rare'],
    ['Walks / team-game', walksMean, 3.40, 'patience'],
    ['Strikeouts / team-game', kMean, 6.85, 'missed swings'],
    ['Total bases / team-game', tbMean, 14.0, 'how much each PA is worth'],
    ['Runs / PA', rpaMean, 0.119, 'scoring rate per trip'],
    ['Runs / game', rgMean, 4.28, 'the product of the above'],
  ];
  for (const [label, value, reference, reads] of rows) {
    const ratio = reference > 0 ? value / reference : 0;
    const delta = Math.abs(ratio - 1) <= 0.12 ? 'ok' : `${ratio > 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%`;
    console.log(`${pad(label, 30)}${padL(value.toFixed(3), 9)}${padL(reference.toFixed(3), 9)}${padL(delta, 8)}${reads}`);
  }

  // The raw scoring ratio. Real MLB collects ~14.0 bases per team-game and scores
  // ~4.4 runs from them, so roughly 0.31 runs per base. The familiar "0.9 runs
  // per total base" constant is a linear-weights figure for runs above
  // replacement, not this ratio -- using it as a target makes any league look
  // broken, because it is ~3x too high.
  const realRatio = 0.314;
  const simRatio = tbMean > 0 ? rgMean / tbMean : 0;
  const predicted = tbMean * realRatio;
  console.log(`\n  scoring ratio (runs / total bases):  sim ${simRatio.toFixed(3)}   MLB ${realRatio.toFixed(3)}`);
  console.log(`  if bases were converted at the real rate:  ${predicted.toFixed(2)} R/game   (actual ${rgMean.toFixed(2)})`);
  const residual = rgMean - predicted;
  console.log(`  residual:  ${residual >= 0 ? '+' : ''}${residual.toFixed(2)} runs/game`);

  console.log('\n  attribution:');
  const paRatio = paMean / 37.0;
  const tbRatio = tbMean / 14.0;
  const conversionRatio = realRatio > 0 ? simRatio / realRatio : 1;
  const notes: string[] = [];
  if (paRatio > 1.12) {
    notes.push(`PA/game is ${((paRatio - 1) * 100).toFixed(0)}% high -> too many batters in the box.`);
  }
  if (Math.abs(tbRatio - 1) > 0.12) {
    notes.push(`TB/game is ${((tbRatio - 1) * 100).toFixed(0)}% off -> the hit mix itself is wrong.`);
  }
  if (Math.abs(conversionRatio - 1) > 0.12) {
    const direction = conversionRatio < 1 ? 'too stingy' : 'too generous';
    notes.push(`runs convert at ${simRatio.toFixed(3)} per base against a real ${realRatio.toFixed(3)}, i.e. ${direction}.`);
    notes.push('Volume and the hit mix are both close to real, so this is about what');
    notes.push('happens to runners already aboard, not to the hitters. See SCORING');
    notes.push('MECHANICS below for base occupancy.');
  }
  if (notes.length === 0) {
    console.log('    volume, hit mix, and scoring rate are all within 12% of real MLB.');
  } else {
    for (const line of notes) console.log(`    - ${line}`);
  }
  reportScoringMechanics();
};

/**
 * Why bases turn into runs, or fail to.
 *
 * Once the hit mix is right, the only remaining question about scoring is what
 * happens to runners already aboard. Two failure modes look identical in the
 * box score -- a league that simply swings too little, and one that gets plenty
 * of runners on but never brings them home. The probe separates them by
 * recording, per at-bat, how many runners were on and how many runs each outcome
 * produced.
 *
 * Real MLB averages roughly 0.80 runners on base per plate appearance, and
 * carries about 1.30 runs per home run (the batter plus whoever was aboard).
 */
const reportScoringMechanics = () => {
  const probes = snapshots.map((s) => s.probe).filter((p): p is GameEngineProbe => p !== null);
  if (probes.length === 0) {
    return;
  }

  const totalPas = probes.reduce((sum, p) => sum + p.plateAppearances, 0);
  const totalRunners = probes.reduce((sum, p) => sum + p.runnersOnBase, 0);
  if (totalPas === 0) return;

  const runnersPerPa = totalRunners / totalPas;
  const basesLoadedRate = probes.reduce((sum, p) => sum + (p.baseCounts[3] ?? 0), 0) / totalPas;
  const basesEmptyRate = probes.reduce((sum, p) => sum + (p.baseCounts[0] ?? 0), 0) / totalPas;

  console.log('\n--- SCORING MECHANICS ------------------------------------------------');
  console.log('  base state at the moment of each plate appearance');
  console.log(`${pad('outcome', 12)}${padL('PAs', 12)}${padL('share', 9)}${padL('runs', 10)}${padL('R/event', 10)}`);

  const order: Array<[string, string]> = [
    ['HR', 'home run'],
    ['3B', 'triple'],
    ['2B', 'double'],
    ['1B', 'single'],
    ['BB', 'walk'],
    ['ERR', 'error'],
  ];
  for (const [key, label] of order) {
    let pas = 0;
    let runs = 0;
    for (const probe of probes) {
      pas += probe.plateAppearancesByOutcome[key] ?? 0;
      runs += probe.runsByOutcome[key] ?? 0;
    }
    if (pas === 0) continue;
    const perPa = pas / totalPas;
    const perEvent = runs / pas;
    console.log(
      `${pad(label, 12)}${padL(pas.toLocaleString(), 12)}${padL(`${(perPa * 100).toFixed(2)}%`, 9)}` +
        `${padL(runs.toLocaleString(), 9)}${padL(perEvent.toFixed(3), 9)}`,
    );
  }

  console.log(`\n  runners on base per PA      ${runnersPerPa.toFixed(3)}`);
  console.log(`  bases empty                 ${(basesEmptyRate * 100).toFixed(1)}%`);
  console.log(`  bases loaded                ${(basesLoadedRate * 100).toFixed(1)}%`);

  console.log('\n  read:');
  if (runnersPerPa < 0.72) {
    console.log('    runner occupancy is below real baseball. The hitters are reaching at a');
    console.log('    normal rate and the advance probabilities reproduce real per-event');
    console.log('    scoring, so there are simply too few men on the bases at any moment.');
    console.log('    That is the whole remaining scoring gap.');
  } else if (runnersPerPa > 0.92) {
    console.log('    runner occupancy is well above real baseball -- runners are piling up');
    console.log('    because nothing strands them. The advance rates are too generous.');
  } else {
    console.log('    runner occupancy looks like real baseball, so the advance rates are');
    console.log('    behaving and any remaining gap sits in the weights table.');
  }
};

const reportTeamStructure = () => {
  const allWins = snapshots.flatMap((s) => s.teamWins);
  const ninety = snapshots.map((s) => s.ninetyWinTeams);
  const hundred = snapshots.map((s) => s.hundredWinTeams);
  const homePct = snapshots
    .filter((s) => s.homeGames > 0)
    .map((s) => s.homeWins / s.homeGames);
  const pyth = snapshots.map((s) => s.pythagoreanError);
  const corr = snapshots.map((s) => s.runDiffWinCorrelation);

  console.log('\n--- TEAM STRUCTURE ----------------------------------------------------');
  console.log(`  wins per team      mean ${padL(mean(allWins).toFixed(1), 7)}  p5 ${padL(percentile(allWins, 0.05).toFixed(0), 4)}  p95 ${padL(percentile(allWins, 0.95).toFixed(0), 4)}  sd ${stdev(allWins).toFixed(1)}`);
  console.log(`  teams >= 90 wins   mean ${padL(mean(ninety).toFixed(2), 7)}  max ${Math.max(...ninety)}   (real MLB ~1-2)`);
  console.log(`  teams >= 100 wins  mean ${padL(mean(hundred).toFixed(2), 7)}  max ${Math.max(...hundred)}   (real MLB ~0-1)`);
  console.log(`  home win rate      mean ${padL(mean(homePct).toFixed(3), 7)}   (real MLB ~0.535-0.545)`);
  console.log(`  Pythagorean error  mean ${padL(mean(pyth).toFixed(2), 7)} wins   (real MLB ~0-1)`);
  console.log(`  run diff -> wins   mean ${padL(mean(corr).toFixed(3), 7)} r    (real MLB ~0.95+)`);
  reportMeasurementNoise();
};

/**
 * How much of a difference between two runs is real.
 *
 * The universe build (generate -> develop -> fill) is fully deterministic on
 * `seed`, so a change to that chain reproduces exactly. The at-bat engine is
 * not: `simulation.ts` draws ~14 Math.random() values per game (luck noise, the
 * home-win coin flip, tiebreakers) and `draftLogic.ts` draws 4 more. So two runs
 * on the same seed share their player pool but not their game results.
 *
 * Measured on seed 1337, 5 seasons, three identical runs:
 *   R/G per season      6.45/6.48/6.45 at year 1 (range 0.03)
 *                       6.19/6.56/6.40 at year 2 (range 0.37)
 *   90+ win teams       same seed, same season, ranged 2 to 8
 *
 * The consequence: aggregate metrics are trustworthy, single-season ones are
 * not. A one-season shift in "teams >= 90 wins" means nothing. The R/G gap
 * against a real 4.3 is far outside this noise, so that finding stands.
 */
/** Unseeded randomness still in the simulation path, counted rather than guessed. */
const UNSEEDED_RANDOM_SITES: Array<[string, number]> = [
  ['src/logic/simulation.ts', 12],
  ['src/logic/draftLogic.ts', 4],
  ['src/logic/playerGenerator.ts', 2],
  ['src/logic/automaticMarket.ts', 1],
  ['src/logic/offseasonFreeAgency.ts', 1],
];

const reportMeasurementNoise = () => {
  // This section used to print hardcoded R/G figures captured from an earlier run
  // and label them "3 identical runs". They were stale to the point of being
  // wrong -- they predated the runs-per-team-game fix and were roughly double any
  // real value -- and no repeat runs were ever executed. A diagnostic that
  // invents its own numbers is worse than no diagnostic, so this reports only
  // what the run above actually observed, and says what has not been measured.
  console.log('\n--- MEASUREMENT NOISE ----------------------------------------------');
  console.log('  the universe build is deterministic on seed (verified by fingerprint).');
  console.log('  the at-bat engine is NOT: unseeded Math.random remains in');
  for (const [file, count] of UNSEEDED_RANDOM_SITES) {
    console.log(`    ${pad(file, 27)}${count} call${count === 1 ? '' : 's'}`);
  }
  console.log('  so one seed does not reproduce the same season.');

  const counts = snapshots.map((s) => s.ninetyWinTeams);
  console.log(`\n  observed in THIS run (${snapshots.length} season${snapshots.length === 1 ? '' : 's'}):`);
  console.log(`    runs/team-game by season   ${snapshots.map((s) => s.runEnvironment.toFixed(2)).join(' / ')}`);
  console.log(`    90+ win teams by season     ${counts.join(' / ')}`);
  console.log(`    season-to-season stdev     ${stdev(snapshots.map((s) => s.runEnvironment)).toFixed(3)}`);
  if (counts.length > 1) {
    const spread = Math.max(...counts) - Math.min(...counts);
    console.log(`    the 90+ count swings by ${spread} between seasons of the same league,`);
    console.log('    which is engine noise, not a trend in team strength.');
  }
  console.log('\n  => compare aggregates averaged over 3+ seasons, never a single season');
  console.log('  => treat single-season 90+ or 100+ counts as noise, not as a finding');
  console.log('  NOT YET MEASURED: same-seed repeat runs, which would put a number on the');
  console.log('    spread. That needs the at-bat engine seeded first -- see the call sites above.');
};

const reportAgingCurve = () => {
  const ages = new Map<number, number[]>();
  for (const snapshot of snapshots) {
    snapshot.ratingsByAge.forEach((values, age) => {
      const bucket = ages.get(age) ?? [];
      bucket.push(...values);
      ages.set(age, bucket);
    });
  }

  const ordered = [...ages.entries()].sort((a, b) => a[0] - b[0]);

  // Ages below this floor are dominated by prospects who never reached a major
  // league roster, so their medians describe the amateur pool rather than the
  // league. Measuring an aging curve from age 17 compares two different
  // populations, which is what produced a bogus "too flat" verdict earlier.
  const ROSTER_FLOOR = 22;
  /** Minimum cohort size before an age can claim the league's peak. */
  const PEAK_MIN_SAMPLE = 25;
  // A median over a handful of players is noise, so an age needs a real cohort
  // before it can claim the peak. A six-player tail can otherwise out-rank the
  // prime-age band on luck alone and produce a nonsense verdict.
  const rosterAges = ordered.filter(([age, values]) => age >= ROSTER_FLOOR && values.length >= PEAK_MIN_SAMPLE);
  const rosterMedians = rosterAges.map(([, values]) => percentile(values, 0.5));
  const allPeak = Math.max(...ordered.map(([, values]) => percentile(values, 0.5)), 1);
  const peak = rosterMedians.length > 0 ? Math.max(...rosterMedians, 1) : allPeak;
  const peakAge = rosterAges[rosterMedians.indexOf(peak)]?.[0] ?? 0;

  console.log('\n--- THE AGING CURVE (median overall by age) ----------------------------');
  console.log(`  ${pad('age', 5)}${padL('n', 8)}${padL('median', 9)}${padL('p90', 7)}   curve`);
  for (const [age, values] of ordered) {
    if (values.length < 5) continue;
    const median = percentile(values, 0.5);
    const label = age >= ROSTER_FLOOR ? String(age) : `${age}p`;
    console.log(
      `  ${pad(label, 5)}${padL(String(values.length), 8)}${padL(median.toFixed(1), 9)}${padL(percentile(values, 0.9).toFixed(1), 7)}   ${bar(median, allPeak)}`,
    );
  }
  console.log('  (rows suffixed "p" are the amateur prospect pool, excluded from the verdict)');

  if (rosterAges.length < 3) {
    console.log('\n  ** VERDICT: not enough roster-age samples to judge. **');
    return;
  }

  const oldestAge = rosterAges[rosterAges.length - 1][0];
  const oldestMedian = percentile(rosterAges[rosterAges.length - 1][1], 0.5);
  const decline = oldestMedian - peak;

  console.log(`\n  peak age:            ${peakAge}  (median ${peak.toFixed(1)})`);
  console.log(`  age ${oldestAge} median:        ${oldestMedian.toFixed(1)}`);
  console.log(`  decline ${peakAge} -> ${oldestAge}:    ${decline.toFixed(1)} pts`);
  console.log('  expected decline:     roughly -8 to -16 pts');

  if (Math.abs(decline) < 3) {
    console.log('\n  ** VERDICT: FLAT. Ratings never change year to year. **');
    console.log('     This is the core "no substance" bug. See src/logic/playerDevelopment.ts.');
  } else if (decline > -5) {
    console.log('\n  ** VERDICT: TOO FLAT. Aging exists but decline is understated. **');
    console.log('     Survivor bias flatters this. Weak players retire, so the old players');
    console.log('     still on a roster are a selected group and decline less than the raw');
    console.log('     age curve would suggest.');
  } else if (decline < -22) {
    console.log('\n  ** VERDICT: TOO STEEP. Decline outruns the real game. **');
  } else {
    console.log('\n  ** VERDICT: Curve has a realistic shape. **');
    console.log('     Survivor bias still flatters the tail, so true decline is steeper');
    console.log('     than this table shows.');
  }

  const topAges = snapshots.flatMap((s) => s.topPlayerAges);
  const starBands = [0, 0, 0, 0];
  for (const age of topAges) {
    if (age < 27) starBands[0] += 1;
    else if (age < 31) starBands[1] += 1;
    else if (age < 35) starBands[2] += 1;
    else starBands[3] += 1;
  }
  const total = topAges.length || 1;
  console.log(`\n  age of the 25 best players in the league:`);
  console.log(`    under 27   ${padL(((starBands[0] / total) * 100).toFixed(1), 6)}%`);
  console.log(`    27-30      ${padL(((starBands[1] / total) * 100).toFixed(1), 6)}%   (real MLB peak)`);
  console.log(`    31-34      ${padL(((starBands[2] / total) * 100).toFixed(1), 6)}%`);
  console.log(`    35+        ${padL(((starBands[3] / total) * 100).toFixed(1), 6)}%`);
};

const reportCareers = () => {
  const retired = [...careerByPlayer.entries()].filter(([playerId]) => retiredIds.has(playerId));
  const statSeasons = retired.map(([, line]) => Math.max(1, line.seasons));
  const homeRunTotals = retired.map(([, line]) => line.homeRuns);
  const hitTotals = retired.map(([, line]) => line.hits);

  console.log('\n--- CAREERS ------------------------------------------------------------');
  console.log(`  retirees recorded   ${retired.length}`);
  if (statSeasons.length > 0) {
    console.log(`  career length       median ${percentile(statSeasons, 0.5).toFixed(1)} seasons   max ${Math.max(...statSeasons)}   (by stat seasons -- see CAREER FLOW)`);
  }
  if (homeRunTotals.length > 0) {
    console.log(`  career HR           median ${percentile(homeRunTotals, 0.5).toFixed(0)}   max ${Math.max(...homeRunTotals)}   (real MLB max ~762)`);
  }
  if (hitTotals.length > 0) {
    console.log(`  career hits         median ${percentile(hitTotals, 0.5).toFixed(0)}   max ${Math.max(...hitTotals)}   (real MLB max ~4256)`);
  }
  const active = [...careerByPlayer.values()].filter((line) => line.seasons > 0);
  const activeHR = active.map((line) => line.homeRuns);
  if (activeHR.length > 0) {
    console.log(`  active career HR    max ${Math.max(...activeHR)}`);
  }
};

const QUALITY_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '85+ elite', min: 85, max: 200 },
  { label: '80-84 star', min: 80, max: 85 },
  { label: '75-79 solid', min: 75, max: 80 },
  { label: '70-74 average', min: 70, max: 75 },
  { label: '65-69 replacement', min: 65, max: 70 },
  { label: '<65 fringe', min: 0, max: 65 },
];

const bandOf = (overall: number) => QUALITY_BANDS.find((band) => overall >= band.min && overall < band.max) ?? QUALITY_BANDS[QUALITY_BANDS.length - 1];

/**
 * The main question this section answers: are we retiring players who are still
 * good? A retirement rate that outruns a band's share of the league means good
 * players are walking. Real MLB retires almost nobody below 35, and players
 * above 80 overall essentially only leave at 38-42, so the 85+ row should be
 * near the bottom of the age table and its rate ratio should sit below 1.
 */
const reportCareerFlow = () => {
  const all = [...tracking.values()];
  if (all.length === 0) return;

  const exited = all.filter((entry) => entry.exit !== null);
  const stillHere = all.filter((entry) => entry.exit === null);
  const retired = exited.filter((entry) => entry.exit!.reason === 'retired');
  const agedOut = exited.filter((entry) => entry.exit!.reason === 'aged_out');

  console.log('\n--- CAREER FLOW --------------------------------------------------------');
  console.log(`  players tracked     ${all.length}   exited ${exited.length}   still in league ${stillHere.length}`);

  const exitRow = (label: string, entries: typeof all) => {
    const ages = entries.map((entry) => entry.exit!.age);
    const overalls = entries.map((entry) => entry.exit!.overall);
    const rate = (entries.length / Math.max(1, SEASONS)).toFixed(1);
    console.log(
      `  ${padL(label, 20)}${padL(String(entries.length), 5)}${padL(rate, 8)}` +
        `${padL(ages.length ? percentile(ages, 0.5).toFixed(1) : '-', 12)}` +
        `${padL(overalls.length ? percentile(overalls, 0.5).toFixed(0) : '-', 15)}`,
    );
  };

  console.log(`  ${pad('', 20)}${padL('count', 5)}${padL('per yr', 8)}${padL('med age', 12)}${padL('med overall', 15)}`);
  exitRow('retired', retired);
  exitRow('aged out (FA 35+)', agedOut);

  // --- the quality check -------------------------------------------------
  console.log('\n  RETIRING BY QUALITY  (rate ratio > 1 = retiring faster than they should)');
  console.log(`  ${pad('band', 20)}${padL('retired', 9)}${padL('%of ret', 10)}${padL('med age', 10)}${padL('league %', 11)}${padL('ratio', 8)}`);

  const leagueBandCounts = new Map<string, number>();
  for (const entry of all) {
    const band = bandOf(entry.peakOverall).label;
    leagueBandCounts.set(band, (leagueBandCounts.get(band) ?? 0) + 1);
  }

  const retireBandCounts = new Map<string, number>();
  const retireBandAges = new Map<string, number[]>();
  for (const entry of retired) {
    const band = bandOf(entry.exit!.overall).label;
    retireBandCounts.set(band, (retireBandCounts.get(band) ?? 0) + 1);
    retireBandAges.set(band, [...(retireBandAges.get(band) ?? []), entry.exit!.age]);
  }

  const totalRetired = Math.max(1, retired.length);
  const totalLeague = Math.max(1, all.length);
  // Retirement ratios swing hard on small samples: with 29 retirements a single
  // band landing 2 above its expected count moves its ratio by 0.3, which is
  // enough to fake a "good players are retiring" verdict. Below these floors the
  // table is still printed, but it is not allowed to make a claim.
  const MIN_RETIREMENTS_FOR_VERDICT = 80;
  const MIN_BAND_RETIREMENTS = 15;
  const sampleIsBigEnough = retired.length >= MIN_RETIREMENTS_FOR_VERDICT;
  let worstRatio = 0;
  let worstBand = '';
  let flagged = 0;
  for (const band of QUALITY_BANDS) {
    const count = retireBandCounts.get(band.label) ?? 0;
    const retireShare = count / totalRetired;
    const leagueShare = (leagueBandCounts.get(band.label) ?? 0) / totalLeague;
    // Compare each band's share of retirements against its share of the league.
    // Above 1.0 means this tier is over-represented among departures.
    const ratio = leagueShare > 0 ? retireShare / leagueShare : 0;
    // Only the top tiers are a problem when they over-retire. Fringe players
    // leaving is the system working, so a high ratio down there is expected and
    // gets a different label rather than being reported as a fault.
    const isGoodBand = band.min >= 75;
    const countable = count >= MIN_BAND_RETIREMENTS;
    if (isGoodBand && countable && ratio > worstRatio) {
      worstRatio = ratio;
      worstBand = band.label;
    }
    if (isGoodBand && countable && ratio > 1.15) flagged += 1;
    const ages = retireBandAges.get(band.label) ?? [];
    const note = isGoodBand
      ? ratio > 1.15 && countable
        ? '  <-- GOOD PLAYERS LEAVING'
        : ''
      : ratio > 1.5
        ? '  (expected churn)'
        : '';
    console.log(
      `  ${pad(band.label, 20)}${padL(String(count), 9)}${padL(`${(retireShare * 100).toFixed(1)}%`, 10)}` +
        `${padL(ages.length ? percentile(ages, 0.5).toFixed(0) : '-', 10)}` +
        `${padL(`${(leagueShare * 100).toFixed(1)}%`, 11)}` +
        `${padL(ratio.toFixed(2), 8)}${note}`,
    );
  }

  const elite = retired.filter((entry) => entry.exit!.overall >= 85);
  const eliteEarly = elite.filter((entry) => entry.exit!.age < 38);
  const under35 = retired.filter((entry) => entry.exit!.age < 35);
  console.log(`\n  retirements of 85+ players   ${elite.length}` + (elite.length ? `  (median age ${percentile(elite.map((e) => e.exit!.age), 0.5).toFixed(0)})` : ''));
  if (eliteEarly.length > 0) {
    console.log(`  ...before age 38             ${eliteEarly.length}   <-- elite players are leaving too young`);
    for (const entry of eliteEarly.slice(0, 8)) {
      const exit = entry.exit!;
      console.log(`       age ${padL(String(exit.age), 3)} overall ${padL(String(exit.overall), 3)}  ${exit.yearsPro} yr pro  retired ${exit.seasonYear}`);
    }
  }
  if (under35.length > 0) {
    const under35Early = under35.filter((entry) => entry.exit!.overall >= 78);
    console.log(`  retirements before age 35    ${under35.length}   of which 78+ overall: ${under35Early.length}   (real MLB: near zero)`);
  }

  if (!sampleIsBigEnough) {
    console.log(`\n  ** NO VERDICT: only ${retired.length} retirements, below the ${MIN_RETIREMENTS_FOR_VERDICT} floor. **`);
    console.log(`     The table above is real but the ratios are unstable at this sample.`);
    console.log('     Re-run with more seasons before drawing any conclusion here.');
  } else if (flagged > 0) {
    console.log(`\n  ** VERDICT: ${flagged} good tier(s) over-retire. ${worstBand} at ${worstRatio.toFixed(2)}x. **`);
    console.log('     Talented players are being pushed out faster than they should be.');
  } else {
    console.log(`\n  ** VERDICT: good players are NOT retiring early. **`);
    console.log(`     Every tier at 75+ retires below its league share (worst: ${worstBand} at ${worstRatio.toFixed(2)}x).`);
    console.log('     The churn is all in the replacement and fringe tiers, which is');
    console.log('     where it belongs -- see CAREER LENGTH and FREE AGENT EXPOSURE below.');
  }

  // --- career length, three ways -----------------------------------------
  console.log('\n  CAREER LENGTH, THREE WAYS  (all for retired players)');
  const statBased = retired.map((entry) => Math.max(1, careerByPlayer.get(entry.playerId)?.seasons ?? 1));
  const rosterBased = retired.map((entry) => entry.seasonsOnRoster);
  const yearsProBased = retired.map((entry) => entry.exit!.yearsPro);
  const fmtLengths = (label: string, values: number[], note: string) => {
    if (values.length === 0) return;
    console.log(
      `  ${pad(label, 26)}median ${padL(percentile(values, 0.5).toFixed(1), 5)}  p90 ${padL(percentile(values, 0.9).toFixed(1), 5)}  n ${padL(String(values.length), 4)}  ${note}`,
    );
  };
  fmtLengths('seasons with a PA', statBased, 'undercounts bench players');
  fmtLengths('seasons on a roster', rosterBased, 'the honest one');
  // Not comparable to a "median career length" reference. yearsPro is years of
  // MLB service, and getYearsPro backfills it as age - 21 for generated veterans
  // who never actually played those seasons, so it tracks the age of the
  // retiring cohort by construction. The question worth asking is whether it
  // has run AHEAD of what the cohort's age implies, which is what a per-offseason
  // increment for unsigned players used to do -- that produced a median of 11
  // against a median of 1 season actually spent on a roster.
  const medianYearsPro = percentile(yearsProBased, 0.5);
  const medianRetireAge = percentile(retired.map((entry) => entry.exit!.age), 0.5);
  const serviceImpliedByAge = Math.max(1, medianRetireAge - 21);
  const serviceDrift = medianYearsPro - serviceImpliedByAge;
  const serviceNote =
    serviceDrift > 2.5
      ? `RUNS ${serviceDrift.toFixed(1)} AHEAD of age-implied service -> still inflating`
      : `age-implied ${serviceImpliedByAge.toFixed(0)} at retirement age ${medianRetireAge.toFixed(0)}`;
  fmtLengths('yearsPro at retirement', yearsProBased, serviceNote);
  const stars = retired.filter((entry) => entry.peakOverall >= 80);
  if (stars.length > 0) {
    fmtLengths('seasons on roster (80+)', stars.map((entry) => entry.seasonsOnRoster), 'good players should last');
  }

  // --- free agent exposure -----------------------------------------------
  console.log('\n  FREE AGENT EXPOSURE');
  const neverSigned = all.filter((entry) => entry.firstContractYear === null && entry.seasonsUnsigned > 0);
  const unsignedSeasons = neverSigned.map((entry) => entry.seasonsUnsigned);

  // Only real draftees. The generator backfills a synthetic draftClassYear for
  // every free agent (`seasonYear - yearsPro`), so measuring the wait over all
  // players charges unsigned veterans for a draft class they never had. The old
  // "5.0 years" figure was that artifact: it was mostly measuring free agents
  // against invented dates, not drafted players against the draft.
  const draftees = all.filter((entry) => entry.actuallyDrafted);
  const drafteeWait = draftees.map((entry) => entry.unsignedBeforeFirstContract);

  console.log(`  players who spent time unsigned  ${neverSigned.length}   of ${all.length}`);
  console.log(`  actually drafted (real picks)    ${draftees.length}   of ${all.length}`);
  if (unsignedSeasons.length > 0) {
    console.log(`  seasons unsigned (median/p90)    ${percentile(unsignedSeasons, 0.5).toFixed(0)} / ${percentile(unsignedSeasons, 0.9).toFixed(0)}`);
  }
  if (drafteeWait.length > 0) {
    console.log(`  draftees: unsigned seasons before first roster spot`);
    console.log(`    (median/p90)                    ${percentile(drafteeWait, 0.5).toFixed(1)} / ${percentile(drafteeWait, 0.9).toFixed(1)}` +
      `   (real MLB ~0.05; almost every pick signs)`);
    const signedImmediately = drafteeWait.filter((value) => value === 0).length;
    console.log(`    signed in their first season    ${signedImmediately} (${(signedImmediately / drafteeWait.length * 100).toFixed(0)}%)`);
  }
  const unsignedAndGood = neverSigned.filter((entry) => entry.peakOverall >= 78);
  if (unsignedAndGood.length > 0) {
    console.log(`  good (78+) players who never signed ${unsignedAndGood.length}   <-- talent being wasted`);
  }
  const ageOutBands = new Map<number, number>();
  for (const entry of agedOut) {
    const age = entry.exit!.age;
    ageOutBands.set(age, (ageOutBands.get(age) ?? 0) + 1);
  }
  if (ageOutBands.size > 0) {
    const ages = [...ageOutBands.keys()].sort((left, right) => left - right);
    console.log(`  age-outs by age  ${ages.map((age) => `${age}:${ageOutBands.get(age)}`).join('  ')}`);
  }

  // --- the unsigned ledger, per offseason ---------------------------------
  // The exposure numbers above are symptoms measured over careers. These are the
  // causes, counted off the offseason's own return values, so a growing unsigned
  // pool can be attributed to vacancies, to contracts ending, or to the market
  // refusing to sign, rather than guessed at.
  const withPipeline = snapshots.filter((snapshot) => snapshot.pipeline !== null);
  if (withPipeline.length > 0) {
    console.log('\n  UNSIGNED LEDGER (mean per offseason)');
    const p = withPipeline.map((snapshot) => snapshot.pipeline!);
    const avg = (pick: (ledger: OffseasonPipeline) => number): number =>
      mean(p.map(pick));
    const slotsOpen = avg((l) => l.openSlotsEntering);
    const signed = avg((l) => l.freeAgentsSigned);
    const drafted = avg((l) => l.rookiesAdded);
    const leftOpen = avg((l) => l.openSlotsLeft);
    const unsigned = avg((l) => l.unsignedRemaining);

    // releasedToMarket counts every player whose contract ran out, whether or
    // not they were offered a qualifying offer first, so qualifiersDeclined is a
    // SUBSET of it and the two must not be added together.
    const released = avg((l) => l.releasedToMarket);
    const declined = avg((l) => l.qualifiersDeclined);
    console.log(`  slots vacant at offseason start   ${slotsOpen.toFixed(1)}`);
    console.log(`  released to market (total)        ${released.toFixed(1)}`);
    console.log(`    of which declined a QO          ${declined.toFixed(1)}   (subset, not additional supply)`);
    console.log(`  free agents signed                 ${signed.toFixed(1)}`);
    console.log(`  rookies drafted instead            ${drafted.toFixed(1)}`);
    console.log(`  vacancies left unfilled            ${leftOpen.toFixed(1)}`);
    console.log(`  in-season market signings          ${avg((l) => l.inSeasonMarketSignings).toFixed(1)}`);
    console.log(`  still unsigned after offseason     ${unsigned.toFixed(0)}`);

    // The signings are the point. A market that signs nearly nothing while
    // vacancies exist is not a healthy market, it is a market that has no
    // entries, and the unsigned pool then only ever grows.
    const fillRate = slotsOpen > 0 ? (signed + drafted) / slotsOpen : 1;
    const demandVsSupply = unsigned > 0 ? signed / unsigned : 0;
    console.log('');
    console.log(`  vacancy fill rate                 ${(fillRate * 100).toFixed(0)}%`);
    console.log(`  signings vs unsigned pool         ${(demandVsSupply * 100).toFixed(0)}%`);
    // Supply against demand, on the true totals. Anything released that the
    // market cannot absorb has to survive as unsigned depth, and the age-out is
    // what eventually removes it, so this ratio is what sets the pool size.
    console.log(`  supply vs vacancies               ${released.toFixed(0)} released for ${slotsOpen.toFixed(0)} slots   (${(released / Math.max(1, slotsOpen)).toFixed(2)}x)`);
    console.log(`  aged out as backstop               ${avg((l) => l.agedOutFreeAgents).toFixed(1)}`);
    const draftPicks = avg((l) => l.draftPicks);
    const drafteesUnsigned = avg((l) => l.drafteesUnsigned);
    console.log(`  draft picks                       ${draftPicks.toFixed(0)}`);
    console.log(`  draftees still unsigned           ${drafteesUnsigned.toFixed(0)}   (${(drafteesUnsigned / Math.max(1, draftPicks) * 100).toFixed(0)}% of the class)`);
    console.log(`  unsigned pool median overall      ${avg((l) => l.unsignedMedianOverall).toFixed(1)}`);
    console.log(`  unsigned pool median age          ${avg((l) => l.unsignedMedianAge).toFixed(1)}`);
    console.log(`  unsigned at 78+                   ${avg((l) => l.unsigned78Plus).toFixed(0)}`);

    // Two different failures look identical from the pool size alone. A market
    // that fills its vacancies but is outrun by supply grows the pool; a market
    // that refuses to fill them stalls drafted players. Both are reported.
    const marketWorks = fillRate >= 0.98;
    const supplyBalanced = drafteesUnsigned / Math.max(1, draftPicks) <= 0.15;
    const verdict = !marketWorks
      ? 'offseason market is NOT filling its vacancies'
      : !supplyBalanced
        ? 'market fills every vacancy, but supply outruns demand'
        : 'offseason market fills its vacancies AND absorbs the class';
    console.log(`  VERDICT                           ${verdict}`);
  }
};

const reportRosterHealth = () => {
  const last = snapshots[snapshots.length - 1];
  if (!last) return;
  console.log('\n--- ROSTER HEALTH ------------------------------------------------------');
  console.log(`  active players      ${last.activeCount}   (32 teams x 29 = 928, plus FAs)`);
  console.log(`  free agents         ${last.freeAgentCount}`);
  const early = snapshots.filter((s) => s.year <= last.year - 5);
  const late = snapshots.filter((s) => s.year > last.year - 5);
  if (early.length > 0 && late.length > 0) {
    const earlyAvg = mean(early.map((s) => s.activeCount));
    const lateAvg = mean(late.map((s) => s.activeCount));
    const drift = lateAvg - earlyAvg;
    const verdict = Math.abs(drift) < 25 ? 'stable' : 'LEAKING';
    console.log(`  active count drift  ${earlyAvg.toFixed(0)} -> ${lateAvg.toFixed(0)}  (${drift >= 0 ? '+' : ''}${drift.toFixed(0)})  ${verdict}`);
  }
};

const retiredIds = new Set<string>();
const playerById = new Map<string, { draftClassYear: number | null; yearsPro: number }>();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const startedAt = Date.now();
  const rng = mulberry32(SEED);

  console.log('=======================================================================');
  console.log('  GPB LEAGUE LAB');
  console.log('=======================================================================');
  console.log(`  seasons       ${SEASONS}`);
  console.log(`  seed          ${SEED}`);
  console.log(`  start year    ${START_YEAR}`);
  console.log(`  granularity   ${GRANULARITY}`);
  console.log(`  market        ${RUN_MARKET ? 'auto free agency + auto trades' : 'disabled'}`);
  console.log(`  games         ${NO_GAMES ? 'SKIPPED (offseason chain only)' : 'simulated'}`);

  let teams = buildFreshTeams(INITIAL_TEAMS.map((team) => ({ ...team })));
  let games = buildSchedule(teams, START_YEAR);

  // The same bootstrap the game uses, so the lab measures the universe a
  // player would actually get from the New Universe screen rather than a
  // parallel construction that can drift from it.
  const built = buildNewUniverse({
    teams,
    seasonYear: START_YEAR,
    seed: SEED,
    effectiveDate: `${START_YEAR}-03-20`,
  });
  let playerState = built.playerState;

  console.log(`\n  universe: ${teams.length} teams, ${playerState.players.length} players, ${games.length} games`);
  console.log(`  bootstrap: generate -> develop -> fill, seed ${built.diagnostics.seed}, ${built.diagnostics.elapsedMs}ms`);
  console.log(
    `            rosters ${built.diagnostics.filledRosterSlots}/${built.diagnostics.expectedRosterSlots}` +
      `  avg OVR ${built.diagnostics.averageOverall.toFixed(1)}  peak age ${built.diagnostics.peakAge}` +
      `  call-ups ${built.diagnostics.callUpCount}  35+ ${built.diagnostics.age35PlusCount}`,
  );
  console.log('');

  for (let index = 0; index < SEASONS; index += 1) {
    const seasonYear = START_YEAR + index;
    const result = await runSeason(teams, playerState, games, seasonYear, rng);

    teams = buildFreshTeams(result.teams);
    playerState = result.playerState;
    games = buildSchedule(teams, seasonYear + 1);

    for (const player of playerState.players) playerById.set(player.playerId, player);
    for (const player of playerState.players) {
      if (player.status === 'retired') retiredIds.add(player.playerId);
    }

    // Fold the season into career totals, then prune history to keep memory flat.
    for (const stat of playerState.battingStats) {
      if (stat.seasonYear !== seasonYear || stat.seasonPhase !== 'regular_season') continue;
      if (stat.plateAppearances === 0) continue;
      const line = getCareer(stat.playerId);
      line.seasons += 1;
      line.atBats += stat.atBats;
      line.runs += stat.runsScored;
      line.hits += stat.hits;
      line.homeRuns += stat.homeRuns;
      line.walks += stat.walks;
      line.strikeouts += stat.strikeouts;
      line.plateAppearances += stat.plateAppearances;
    }
    for (const stat of playerState.pitchingStats) {
      if (stat.seasonYear !== seasonYear || stat.seasonPhase !== 'regular_season') continue;
      if (stat.games === 0) continue;
      const line = getCareer(stat.playerId);
      line.seasons += 1;
      line.runsAllowed += stat.earnedRuns;
      line.wins += stat.wins;
      line.saves += stat.saves;
    }

    playerState = pruneHistory(playerState, seasonYear);
  }

  reportOpeningUniverse(built.diagnostics);
  reportEnvironment();
  reportTeamStructure();
  reportAgingCurve();
  reportCareers();
  reportCareerFlow();
  reportRosterHealth();

  const totalSeconds = (Date.now() - startedAt) / 1000;
  console.log('\n=======================================================================');
  console.log(`  completed ${SEASONS} seasons in ${totalSeconds.toFixed(1)}s`);
  console.log('=======================================================================');
};

/** Keep only the two most recent seasons of per-season rows. */
const pruneHistory = (playerState: LeaguePlayerState, seasonYear: number): LeaguePlayerState => {
  const cutoff = seasonYear - 1;
  return {
    ...playerState,
    battingStats: playerState.battingStats.filter((stat) => stat.seasonYear >= cutoff),
    pitchingStats: playerState.pitchingStats.filter((stat) => stat.seasonYear >= cutoff),
    transactions: playerState.transactions.slice(-500),
  };
};

void main();
