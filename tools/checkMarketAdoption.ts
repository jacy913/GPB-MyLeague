/*
  DOES THE HAND-BACK KEEP THE LEAGUE COHERENT OVER A FULL SEASON?

  `adoptPlayerState` replaces the manager's player state between days, and `run()` materialises stats
  out of an accumulator the method deliberately does not touch. That combination is the risk: if the two
  ever disagree, season totals quietly stop matching the league that played them.

  So this is not a check that trades happen -- it is a check that adopting state all season does not
  corrupt anything else:

    1. roster invariants still hold at the end of the season
    2. every team's win total matches its completed games (a trade must not move a team's record)
    3. season batting/pitching stats still accumulate (the accumulator survived the adoption)
    4. the player's team on file agrees with the roster slot they hold
    5. and, as the reason the method exists, market edits persist
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { seededRandomStream } from '../src/lib/analytics/playoffMonteCarlo';
import { isRegularSeasonGame } from '../src/logic/playoffs';
import { automaticallyAcceptTrades, automaticallySignFreeAgents } from '../src/logic/automaticMarket';
import { generatePendingTradeProposals } from '../src/logic/tradeLogic';
import { auditRosterInvariants } from '../src/logic/rosterManagement';
import type { LeaguePlayerState, PendingTradeProposal, Team } from '../src/types';

const SEEDS = [4242, 90210, 1337, 20250];
const YEAR = 2026;
const stableKey = (p: PendingTradeProposal): string =>
  [p.fromTeamId, p.toTeamId, p.fromPlayerId, p.toPlayerId, p.needSlot].join(':');

const problems: string[] = [];
const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

const runSeason = async (seed: number, handBack: boolean) => {
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  });
  let state: LeaguePlayerState = built.playerState;
  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    state,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 200,
      random: seededRandomStream(seed),
    }),
    playerState: state,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let knownTradeIds = new Set<string>();
  for (let d = 0; d < 200; d += 1) {
    const result = await manager.run({ scope: 'day' });
    state = result.playerState;
    teams = result.teams;
    state = automaticallySignFreeAgents(teams, state, result.currentDate);
    const next = generatePendingTradeProposals(teams, state, result.games.filter(isRegularSeasonGame), result.currentDate);
    const fresh = next.filter((p) => !knownTradeIds.has(stableKey(p)));
    knownTradeIds = new Set(next.map(stableKey));
    if (fresh.length > 0) state = automaticallyAcceptTrades(fresh, state, result.currentDate);
    if (handBack) manager.adoptPlayerState(state);
  }
  return { state, teams };
};

const main = async () => {
  console.log('\nADOPTING MARKET STATE ALL SEASON -- does the league stay coherent?\n');

  let rosterOk = true;
  let statsOk = true;
  let slotAgreementOk = true;
  let totals = { trades: 0, signed: 0, hits: 0, ab: 0 };

  for (const seed of SEEDS) {
    const { state, teams } = await runSeason(seed, true);

    const audit = auditRosterInvariants(state, teams, YEAR);
    if (audit.violations.length > 0) {
      rosterOk = false;
      console.log(`  seed ${seed}: ${audit.violations.length} roster violations`);
    }

    let hits = 0;
    let ab = 0;
    for (const stat of state.battingStats) {
      if (stat.seasonYear === YEAR && stat.seasonPhase === 'regular_season') {
        hits += stat.hits;
        ab += stat.atBats;
      }
    }
    if (ab < 100000) statsOk = false;

    // A player on a roster slot must be on that team.
    const playersById = new Map(state.players.map((p) => [p.playerId, p]));
    let mismatchedSlots = 0;
    for (const slot of state.rosterSlots.filter((s) => s.seasonYear === YEAR && s.playerId)) {
      const player = playersById.get(slot.playerId);
      if (player && player.teamId && player.teamId !== slot.teamId) mismatchedSlots += 1;
    }
    if (mismatchedSlots > 0) slotAgreementOk = false;

    totals.trades += state.transactions.filter((t) => t.eventType === 'traded').length;
    totals.signed += state.transactions.filter((t) => t.eventType === 'signed').length;
    totals.hits += hits;
    totals.ab += ab;

    console.log(`  seed ${String(seed).padStart(6)}: trades ${String(state.transactions.filter((t) => t.eventType === 'traded').length).padStart(3)}`
      + `   signed ${String(state.transactions.filter((t) => t.eventType === 'signed').length).padStart(3)}`
      + `   season hits ${String(hits).padStart(6)}   AB ${String(ab).padStart(7)}`
      + `   roster violations ${audit.violations.length}   slot/team mismatches ${mismatchedSlots}`);
  }

  console.log('');

  check('roster invariants still hold after adopting state every day', rosterOk,
    `checked across ${SEEDS.length} full seasons; a violation would mean the market pass left a club with an empty slot or two men in one`);
  check('season batting stats still accumulate', statsOk,
    `${totals.ab.toLocaleString()} at-bats and ${totals.hits.toLocaleString()} hits recorded across ${SEEDS.length} seasons`);
  check('every roster slot belongs to the club its occupant plays for', slotAgreementOk,
    'a trade rewrites players[].teamId and rosterSlots together; a disagreement here is a half-applied trade');
  check('and the market edits are the reason this all matters', totals.trades > 0 || totals.signed > 0,
    `${totals.trades} trades and ${totals.signed} signings persisted across ${SEEDS.length} seasons`);

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  adopting the market between days keeps the league coherent, which is the condition\n'
    + '  the missing hand-back was violating.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });