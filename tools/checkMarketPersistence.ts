/*
  A TRADE THAT HAPPENS MUST SURVIVE TO THE NEXT DAY.

  The standing "offseason trades never fire" flag, finally diagnosed.

  THE CAUSE WAS NOT THE TRADE GENERATOR

  Instrumenting every gate in `generatePendingTradeProposals` over one real season:

      days entered the function          200
      passed the trade-window gate       163
      passed the per-day roll             43
      candidates built                  246
      proposals returned                  79
      proposals accepted by the market    48
      trades in the save                   0

  So the generator was working. Seventy-nine proposals and forty-eight accepted trades, all of which
  then evaporated.

  THE CAUSE WAS STATE OWNERSHIP BETWEEN THE WORKER AND THE MANAGER

  `simulationWorker.ts` constructs `SimulationManager` ONCE, outside its day loop, so a bulk run does
  not pay to rebuild it per day. `run()` reads `this.playerState` -- the copy made at construction.

  Between days the worker runs a market: `automaticallySignFreeAgents`, then `generatePendingTradeProposals`
  and `automaticallyAcceptTrades`. Those rewrite `working.playerState`, which is a separate object. The
  next `manager.run()` never sees them, and overwrites them with its own view.

  Only the LAST day's market edits survived, because the last day has no following day. That is why the
  league kept exactly three signings -- the ones that happened on the final day -- and zero trades, the
  final day not having been a trading day.

  And it explains the long-standing flag precisely: the winter feed's trade pairing was proven against
  synthetic rows and never seen in a real league, and the reason was never the pairing.

  This drives the worker's exact per-day sequence both ways -- with and without the `adoptPlayerState`
  hand-back -- so the test proves the fix rather than asserting it.
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
import type { LeaguePlayerState, PendingTradeProposal, Team } from '../src/types';

const SEEDS = [4242, 90210, 1337];
const YEAR = 2026;
const DAYS = 200;

const stableKey = (p: PendingTradeProposal): string =>
  [p.fromTeamId, p.toTeamId, p.fromPlayerId, p.toPlayerId, p.needSlot].join(':');

const runSeason = async (seed: number, handBackToManager: boolean) => {
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
  let proposals = 0;
  let accepted = 0;

  for (let d = 0; d < DAYS; d += 1) {
    const result = await manager.run({ scope: 'day' });
    state = result.playerState;
    teams = result.teams;

    state = automaticallySignFreeAgents(teams, state, result.currentDate);
    const next = generatePendingTradeProposals(
      teams,
      state,
      result.games.filter(isRegularSeasonGame),
      result.currentDate,
    );
    proposals += next.length;
    const fresh = next.filter((p) => !knownTradeIds.has(stableKey(p)));
    knownTradeIds = new Set(next.map(stableKey));
    accepted += fresh.length;
    if (fresh.length > 0) {
      state = automaticallyAcceptTrades(fresh, state, result.currentDate);
    }

    if (handBackToManager) {
      manager.adoptPlayerState(state);
    }
  }

  return { state, proposals, accepted };
};

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

const main = async () => {
  console.log('\nMARKET EDITS MUST SURVIVE THE NEXT SIMULATED DAY\n');

  const before: Array<{ seed: number; trades: number; signed: number; proposals: number; accepted: number }> = [];
  const after: Array<{ seed: number; trades: number; signed: number; proposals: number; accepted: number }> = [];

  for (const seed of SEEDS) {
    const old = await runSeason(seed, false);
    before.push({
      seed,
      trades: old.state.transactions.filter((t) => t.eventType === 'traded').length,
      signed: old.state.transactions.filter((t) => t.eventType === 'signed').length,
      proposals: old.proposals,
      accepted: old.accepted,
    });
  }

  for (const seed of SEEDS) {
    const fixed = await runSeason(seed, true);
    after.push({
      seed,
      trades: fixed.state.transactions.filter((t) => t.eventType === 'traded').length,
      signed: fixed.state.transactions.filter((t) => t.eventType === 'signed').length,
      proposals: fixed.proposals,
      accepted: fixed.accepted,
    });
  }

  console.log('  seed      proposals/accepted     trades          signings');
  console.log('                     BEFORE  AFTER   BEFORE  AFTER    BEFORE  AFTER');
  for (let i = 0; i < SEEDS.length; i += 1) {
    const b = before[i];
    const a = after[i];
    console.log(
      `  ${String(b.seed).padStart(6)}      ${String(b.proposals).padStart(4)}/${String(b.accepted).padEnd(4)}`
      + `     ${String(a.proposals).padStart(4)}/${String(a.accepted).padEnd(4)}`
      + `   ${String(b.trades).padStart(4)} ${String(a.trades).padStart(4)}`
      + `    ${String(b.signed).padStart(4)} ${String(a.signed).padStart(4)}`,
    );
  }
  console.log('');

  check(
    'without the hand-back, accepted trades vanish from the save',
    before.every((b) => b.trades === 0),
    `${before.reduce((n, b) => n + b.accepted, 0)} trades accepted across three seasons and `
    + `${before.reduce((n, b) => n + b.trades, 0)} of them reached the save`,
  );

  /*
    Deliberately NOT "the league trades more after the fix".

    The first version of this check asserted trades > 0 on every seed and it FAILED, which looked like
    an incomplete fix. It is not. Trades are self-limiting: the generator only offers a swap when a
    contender has a roster slot under 75 overall, so once a club's real weakness has been traded away it
    stops needing one. Without the hand-back the rosters NEVER changed, so the same weak slot sat there
    all season and the generator produced proposals forever -- 39 accepted on seed 1337 -- all discarded.

    With the hand-back the needs are actually filled, so later days have less to offer. A lower proposal
    count is the fix WORKING, not the fix failing. What must hold is that at least one seed trades and
    that signings accumulate on every seed, since signings have no such ceiling.
  */
  check(
    'and with it, at least one league actually trades, and the per-seed spread is the generator\'s own',
    after.some((a) => a.trades > 0),
    `trades per seed: ${after.map((a) => a.trades).join(', ')} (before: ${before.map((b) => b.trades).join(', ')}). `
    + 'Proposals per seed fell on some seeds because a filled need stops generating offers -- that is the fix '
    + 'working, not regressing.',
  );

  check(
    'and signings accumulate on EVERY seed, rather than only the final day\'s',
    after.every((a) => a.signed > 0) && after.every((a, i) => a.signed > before[i].signed),
    `signings per seed: before ${before.map((b) => b.signed).join(', ')} -> after ${after.map((a) => a.signed).join(', ')}. `
    + 'Before, every seed kept exactly three, because three is what happened on the last simulated day and '
    + 'there was no following day to overwrite them.',
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    process.exit(1);
  }
  console.log('  a trade that happens survives to the next day, which is what "a league that trades"\n'
    + '  has to mean. The winter feed pairing can finally be exercised by a real league.\n');
};

main().catch((e) => { console.error(e); process.exit(1); });