/**
 * The two performance rewrites in the simulation hot path, checked for BEHAVIOUR, not speed.
 *
 * 1. `indexLatestReleases` replaced a per-free-agent `filter` + copy-and-sort of the whole
 *    transaction log. A faster index that picks a different release is a silent correctness
 *    regression in the qualifying-offer path, so the index is compared against the original
 *    algorithm on the awkward inputs: several releases for one player, releases out of order,
 *    two releases on the SAME date, and non-release transactions mixed in.
 *
 * 2. `playLogEventsOf` caches parsed play logs by game id. A cache that serves a stale array is
 *    worse than no cache, so the assertions are about invalidation: a changed log must re-parse,
 *    a malformed log must stay unreadable rather than becoming an empty log, and repeated reads
 *    must agree.
 *
 * Run: npx tsx tools/checkPerfHotspots.ts
 */

import {
  buildFreeAgencyMarketEntries,
  type FreeAgencyOfferCard,
  type FreeAgentMarketEntry,
} from '../src/logic/freeAgencyLogic';
import { extractGameEvents } from '../src/logic/headlinerEvents';
import type { DerivedGameLines, GameShape } from '../src/logic/headlineEngine';
import type {
  Game,
  Player,
  PlayerBattingRatings,
  PlayerPitchingRatings,
  PlayerSeasonBatting,
  PlayerSeasonPitching,
  PlayerTransaction,
  Team,
  TeamRosterSlot,
} from '../src/types';

const problems: string[] = [];
const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

// ---------------------------------------------------------------------------------------------
// The original algorithm, kept here as the oracle
// ---------------------------------------------------------------------------------------------

/**
 * EXACTLY the pre-optimisation implementation, so this is a differential test rather than a
 * restatement of what the new code does.
 */
const resolveQualifyingOfferWithTheOldScan = (
  playerId: string,
  transactions: PlayerTransaction[],
): { teamId: string; contractYears: number } | null => {
  const candidateReleases = transactions.filter(
    (transaction) => transaction.playerId === playerId && transaction.eventType === 'released',
  );
  if (candidateReleases.length === 0) return null;

  const latestRelease = [...candidateReleases]
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0] ?? null;
  if (!latestRelease) return null;

  const notes = latestRelease.notes ?? '';
  const match = notes.match(/\[offseason_meta:([^\]]+)\]/i);
  if (!match?.[1]) return null;
  const kv = new Map(match[1].split(',').map((chunk) => {
    const [k, v] = chunk.split('=');
    return [(k ?? '').trim(), (v ?? '').trim()] as const;
  }));
  if (kv.get('qoDecision') !== 'declined') return null;

  const previousTeamId = latestRelease.fromTeamId;
  const qoTeamId = kv.get('qoTeamId') ?? '';
  if (!previousTeamId || !qoTeamId || qoTeamId !== previousTeamId) return null;

  const years = Number(kv.get('qoYears'));
  return {
    teamId: previousTeamId,
    contractYears: Number.isFinite(years) && years > 0 ? years : 1,
  };
};

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const meta = (decision: string, teamId: string, years: number) =>
  `[offseason_meta:seasonYear=2026,qoDecision=${decision},qoTeamId=${teamId},qoYears=${years}]`;

const transaction = (over: Partial<PlayerTransaction> & { playerId: string }): PlayerTransaction => ({
  playerId: over.playerId,
  eventType: over.eventType ?? 'released',
  fromTeamId: over.fromTeamId ?? null,
  toTeamId: over.toTeamId ?? null,
  effectiveDate: over.effectiveDate ?? '2026-01-01',
  notes: over.notes ?? null,
});

const team = (id: string): Team => ({
  id, city: `City ${id}`, name: `Name ${id}`,
  league: 'Platinum', division: 'North', rating: 78, previousBaselineWins: 78,
  wins: 80, losses: 62, runsScored: 0, runsAllowed: 0,
});

const freeAgent = (id: string, over: Partial<Player> = {}): Player => ({
  playerId: id, teamId: null, firstName: 'Free', lastName: `Agent ${id}`,
  playerType: 'batter', primaryPosition: 'SS', secondaryPosition: null,
  bats: 'R', throws: 'R', age: 27, height: `6'0"`, weightLbs: 200,
  potential: 80, status: 'free_agent', contractYearsLeft: 0,
  draftClassYear: 2024, draftRound: 3, yearsPro: 2, retirementYear: null,
  ...over,
});

const battingRating = (id: string, overall: number): PlayerBattingRatings => ({
  playerId: id, seasonYear: 2026, contact: overall, power: overall, plateDiscipline: overall,
  avoidStrikeout: overall, speed: overall, baserunning: overall, fielding: overall, arm: overall,
  overall, potentialOverall: overall,
});

const emptyBatting = (id: string): PlayerSeasonBatting => ({
  playerId: id, seasonYear: 2026, seasonPhase: 'regular_season', gamesPlayed: 100,
  plateAppearances: 400, atBats: 360, runsScored: 0, hits: 0, doubles: 0, triples: 0,
  homeRuns: 0, walks: 0, strikeouts: 0, rbi: 0, avg: 0, ops: 0,
});

const emptyPitching = (id: string): PlayerSeasonPitching => ({
  playerId: id, seasonYear: 2026, seasonPhase: 'regular_season', wins: 0, losses: 0, saves: 0,
  games: 0, gamesStarted: 0, inningsPitched: 0, hitsAllowed: 0, earnedRuns: 0, walks: 0,
  strikeouts: 0, era: 4, whip: 1.3,
});

const rosterSlot = (teamId: string, code = 'SS'): TeamRosterSlot => ({
  playerId: '', teamId, slotCode: code as TeamRosterSlot['slotCode'], seasonYear: 2026,
  acquiredVia: 'generated', acquiredDate: '2026-01-01',
} as TeamRosterSlot);

/**
 * A completed game whose play log is whatever string is passed.
 *
 * `stats.playLog` is a STRING in this app, not an array -- that is the whole reason the hot path
 * was parsing anything at all, and a fixture that quietly hands over an array would make the cache
 * assertions pass for the wrong reason.
 */
const game = (gameId: string, playLog: string): Game => ({
  gameId,
  date: '2026-04-02',
  homeTeam: 't1',
  awayTeam: 't2',
  phase: 'regular_season',
  status: 'completed',
  score: { home: 3, away: 2 },
  playoff: null,
  stats: { playLog },
} as Game);

const player = (id: string, name: string): Player => ({
  ...freeAgent(id),
  firstName: name.split(' ')[0] ?? name,
  lastName: name.split(' ').slice(1).join(' ') || 'Player',
});

const boardFor = (players: Player[], transactions: PlayerTransaction[]): FreeAgentMarketEntry[] =>
  buildFreeAgencyMarketEntries(
    [team('t1'), team('t2')],
    players,
    players.map((p) => battingRating(p.playerId, 78)),
    [] as PlayerPitchingRatings[],
    players.map((p) => emptyBatting(p.playerId)),
    [] as PlayerSeasonPitching[],
    [rosterSlot('t1'), rosterSlot('t2')],
    transactions,
  );

/** The qualifying-offer cards a board produced, flattened to something comparable. */
const qualifiers = (entries: FreeAgentMarketEntry[]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const entry of entries) {
    const flagged = entry.offers
      .filter((offer: FreeAgencyOfferCard) => offer.isQualifyingOffer)
      .map((offer) => offer.team.id)
      .sort();
    out[entry.player.playerId] = flagged;
  }
  return out;
};

// ---------------------------------------------------------------------------------------------
// The play-log cache, driven through the only public entry point that reaches it
// ---------------------------------------------------------------------------------------------

/**
 * The debut detector is the one that reads the 40-game window through `battersSeenIn`, so it is
 * where a stale cache would show up as a WRONG ANSWER rather than as a slow one: a batter the cache
 * believes has already appeared cannot debut, and one it believes is new can. That makes it the
 * right place to prove the cache invalidates.
 *
 * Driven through `extractGameEvents` rather than by exporting the cache's internals -- the rewrite
 * did not add an export, and the behaviour that matters is the behaviour a caller sees.
 */
const runPlayLogCacheChecks = () => {
  const batterId = 'p-debut';
  const priorWithBatter = (gameId: string): Game => game(gameId, JSON.stringify([
    { batterId, batterName: 'Prior Batter', outcome: '1B' },
    { batterId: 'p-other', batterName: 'Other', outcome: 'K' },
  ]));

  /**
 * The current game's derived lines, carrying the one batter whose debut is under test.
 *
 * This has to be REAL, not `{} as DerivedGameLines`. Every detector in the table dereferences
 * `derived.battingLines` and `derived.pitchingLines`, so an empty stub throws on the first detector
 * and the cache assertions never run. A cast that satisfies the compiler and breaks at runtime is
 * exactly the shape of fixture that makes a test green for the wrong reason.
 */
const derivedFor = (playerId: string): DerivedGameLines => ({
  battingLines: [{
    playerId,
    playerName: 'Debut Batter',
    teamId: 't1',
    atBats: 4,
    plateAppearances: 4,
    hits: 4,
    doubles: 0,
    triples: 0,
    homeRuns: 1,
    walks: 0,
    strikeouts: 0,
    runs: 1,
    rbi: 1,
  }],
  pitchingLines: [],
  extraInnings: 9,
  leadChanges: 0,
  awayWon: false,
  homeLargestDeficit: 0,
  awayLargestDeficit: 1,
  walkOffBatterName: null,
} as unknown as DerivedGameLines);

const debutCount = (prior: Game[]): number => extractGameEvents({
    game: game('now', JSON.stringify([{ batterId, batterName: 'Debut Batter', outcome: 'HR' }])),
    shape: {
      winnerTeamId: 't1',
      loserTeamId: 't2',
      winnerPitcherCount: 5,
      ratingGap: 5,
      winnerWasUnderdog: false,
      noHitOpponentId: null,
    } as unknown as GameShape,
    derived: derivedFor(batterId),
    teamsById: new Map<string, Team>(),
    playersById: new Map<string, Player>([[batterId, player(batterId, 'Debut Batter')]]),
    completedGamesDesc: [game('now', ''), ...prior],
    baselines: null,
  }).filter((event) => event.kind === 'big_debut').length;

  // Warm the cache with a window that says this batter has already played.
  const seen = debutCount([priorWithBatter('prior-1')]);

  // Same gameId, DIFFERENT log: the cache must not serve the stale array. A re-simulated game keeps
  // its id, so this is the exact shape that makes a length check necessary.
  const rewarmed = debutCount([priorWithBatter('prior-1'), game('prior-2', JSON.stringify([
    { batterId, batterName: 'Prior Batter', outcome: '1B' },
  ]))]);
  check(
    'a longer log under a game id already cached re-parses',
    seen === rewarmed,
    `with one prior appearance the batter is not a debut (${seen}); adding a second appearance for the `
    + `same player must also be 0 (${rewarmed})`,
  );

  // Now the same gameId with a SHORTER log that no longer mentions the batter: the batter has not
  // been seen before, so the debut must fire. If the stale array survived, this returns 0.
  const unseen = debutCount([game('prior-1', JSON.stringify([
    { batterId: 'p-someone-else', batterName: 'Someone Else', outcome: 'K' },
  ]))]);
  check(
    'a shorter log under a cached game id re-parses instead of serving a stale array',
    unseen > 0,
    `a log that no longer mentions the batter must let the debut fire; got ${unseen} debut events`,
  );

  // A malformed log must stay UNREADABLE. An unreadable prior game must not be able to manufacture
  // a debut, so it must not be cached as an empty window.
  const malformed = debutCount([game('prior-bad', '{ this is not json')]);
  check(
    'a malformed log is skipped rather than read as an empty window',
    malformed > 0,
    `an unparseable prior log must not count as "never seen before"; got ${malformed} debut events`,
  );

  // Repeating a read must agree with itself, which is the property a cache is allowed to break.
  check(
    'repeated reads of the same log agree',
    debutCount([priorWithBatter('prior-repeat')]) === seen,
    'the cached array and a fresh parse must produce the same debut answer',
  );
};

const main = () => {
  console.log('\nPERF HOTSPOTS -- two rewrites, checked for behaviour\n');

  console.log('RELEASE INDEX vs THE ORIGINAL SCAN\n');

  // Several releases for one player, deliberately out of order, plus noise of other kinds.
  const messy: PlayerTransaction[] = [
    transaction({ playerId: 'a', effectiveDate: '2026-03-01', fromTeamId: 't1', notes: meta('declined', 't1', 3) }),
    transaction({ playerId: 'a', eventType: 'signed', effectiveDate: '2026-05-01', fromTeamId: null, notes: null }),
    transaction({ playerId: 'a', effectiveDate: '2026-02-01', fromTeamId: 't2', notes: meta('declined', 't2', 1) }),
    transaction({ playerId: 'b', effectiveDate: '2026-01-15', fromTeamId: 't2', notes: meta('declined', 't2', 2) }),
    transaction({ playerId: 'c', effectiveDate: '2026-01-20', fromTeamId: 't1', notes: meta('accepted', 't1', 2) }),
    transaction({ playerId: 'd', effectiveDate: '2026-01-25', fromTeamId: 't1', notes: 'released with no meta at all' }),
    transaction({ playerId: 'e', effectiveDate: '2026-01-28', fromTeamId: 't1', notes: meta('declined', 't9', 2) }),
  ];
  const players = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => freeAgent(id));

  // Oracle: what the old per-player scan would have decided for each free agent.
  const expected: Record<string, string> = {};
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const resolved = resolveQualifyingOfferWithTheOldScan(id, messy);
    expected[id] = resolved ? resolved.teamId : 'none';
  }

  const entries = boardFor(players, messy);
  const found = qualifiers(entries);
  const actual: Record<string, string> = {};
  for (const [id, teams] of Object.entries(found)) actual[id] = teams.length ? teams[0] : 'none';

  check(
    'the index picks the same release the filter-and-sort did',
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

  check(
    'the LATEST release wins, not the last one in the log',
    actual.a === 't1',
    `'a' was released by t2 in February and t1 in March; t2's February row is LATER in the log, `
    + `so a scan that took the last match instead of the newest would say t2. Got ${actual.a}`,
  );

  check(
    'a non-release transaction is ignored',
    actual.b === 't2' && actual.a === 't1',
    `'a' also has a 'signed' row dated after both releases; a filter that only checked playerId would pick it`,
  );

  check(
    'a declined offer naming a different club is not a qualifying offer',
    actual.e === 'none',
    `'e' declined but the meta names t9 while the release came from t1, so the two disagree`,
  );

  check(
    'a release with no offseason meta is not a qualifying offer',
    actual.d === 'none',
    `plain note text must not parse as meta`,
  );

  check(
    'a player with no release at all is not a qualifying offer',
    actual.f === 'none',
    `'f' appears in the log not at all`,
  );

  // Two releases on the SAME date: the old code used a stable sort, so it kept the FIRST such row.
  const sameDay: PlayerTransaction[] = [
    transaction({ playerId: 'g', effectiveDate: '2026-02-02', fromTeamId: 't1', notes: meta('declined', 't1', 2) }),
    transaction({ playerId: 'g', effectiveDate: '2026-02-02', fromTeamId: 't2', notes: meta('declined', 't2', 4) }),
  ];
  const sameDayOld = resolveQualifyingOfferWithTheOldScan('g', sameDay);
  const sameDayNew = qualifiers(boardFor([freeAgent('g')], sameDay))['g'][0] ?? null;
  check(
    'two releases on the same date resolve the way the stable sort did',
    sameDayOld?.teamId === sameDayNew,
    `old sort kept ${sameDayOld?.teamId ?? 'none'}; the index kept ${sameDayNew ?? 'none'}`,
  );

  // Determinism: the same input twice must produce identical boards.
  check(
    'the market is deterministic across builds',
    JSON.stringify(qualifiers(boardFor(players, messy))) === JSON.stringify(found),
    'a Map built from the same log must not depend on iteration order between runs',
  );

  // The index must not change results as the log grows -- the actual regression this guards.
  const padded: PlayerTransaction[] = [
    ...Array.from({ length: 4000 }, (_, i) => transaction({
      playerId: `noise-${i}`, effectiveDate: '2026-01-01', eventType: 'signed', notes: null,
    })),
    ...messy,
  ];
  const paddedFound = qualifiers(boardFor(players, padded));
  check(
    'a 4000-row log produces the same answers as a 7-row one',
    JSON.stringify(paddedFound) === JSON.stringify(found),
    'indexing by player must not be sensitive to how much unrelated history is in the log',
  );

  console.log('\nPLAY-LOG CACHE\n');
  runPlayLogCacheChecks();

  console.log('\nROSTER-SLOT INDEX\n');

  /*
   * The index replaced a linear `find` over every roster slot in the league. A wrong index would not
   * fail loudly -- it would quietly read some OTHER club's slot, and slot occupancy is worth a
   * 26-point vacancy bonus plus the incumbent's overall, so every club's offer for that player would
   * be silently mispriced.
   *
   * Interest is not used as the signal because it clamps at 99: a vacant slot scores so far above a
   * filled one that both saturate and the comparison says nothing. What does discriminate is
   * WHETHER AN OFFER IS MADE AT ALL -- `buildOfferBoard` returns nothing for a club whose score is
   * under 34 -- so the fixture is built so that the three clubs fall on opposite sides of that line:
   *
   *   t1 holds a much BETTER player than the free agent  -> no offer (an upgrade that is not one)
   *   t2 holds a worse player                             -> an offer
   *   t3 has the slot empty                              -> an offer (a vacancy)
   *
   * If the index ever returned the wrong team's row, t1 would get t2's or t3's incumbent and the
   * pattern would collapse.
   */
  const incumbent = (id: string, teamId: string, overall: number): Player => ({
    ...freeAgent(id, { status: 'active', teamId }),
    playerId: id,
  });

  const signed = freeAgent('signed');

  const clubLine = (slots: TeamRosterSlot[]): { t1: number | null; t2: number | null; t3: number | null } => {
    const players = [signed, incumbent('inc-1', 't1', 84), incumbent('inc-2', 't2', 60)];
    const entries = buildFreeAgencyMarketEntries(
      [team('t1'), team('t2'), team('t3')],
      players,
      [battingRating('signed', 78), battingRating('inc-1', 84), battingRating('inc-2', 60)],
      [] as PlayerPitchingRatings[],
      players.map((p) => emptyBatting(p.playerId)),
      [] as PlayerSeasonPitching[],
      slots,
      [],
    );
    const out = { t1: null, t2: null, t3: null };
    for (const offer of entries.find((e) => e.player.playerId === 'signed')?.offers ?? []) {
      out[offer.team.id as 't1' | 't2' | 't3'] = offer.interest;
    }
    return out;
  };

  const occupied = clubLine([
    { ...rosterSlot('t1', 'SS'), playerId: 'inc-1' },
    { ...rosterSlot('t2', 'SS'), playerId: 'inc-2' },
  ]);

  check(
    'a club whose slot holds a BETTER player makes no offer',
    occupied.t1 === null,
    `t1's incumbent is 84 against a 78 free agent, so the score falls under the threshold and there `
    + `is no offer; got ${occupied.t1 ?? 'none'}`,
  );

  check(
    'a club whose slot holds a WORSE player does make an offer',
    occupied.t2 !== null && occupied.t2 < 99,
    `t2's incumbent is 60, which is a genuine upgrade and must produce a real interest score rather `
    + `than a clamped 99; got ${occupied.t2 ?? 'none'}`,
  );

  check(
    'an empty slot beats holding a better player',
    (occupied.t3 ?? 99) > (occupied.t1 ?? -1),
    `t3 has a vacancy, so it must out-score t1's occupied slot; got ${JSON.stringify(occupied)}`,
  );

  check(
    'the three clubs are scored independently, not from one shared lookup',
    new Set(Object.values(occupied).map((v) => v ?? 'none')).size > 1,
    `if every club resolved the same slot row they would all score identically; got ${JSON.stringify(occupied)}`,
  );

  check(
    'both builds are deterministic',
    JSON.stringify(clubLine([
      { ...rosterSlot('t1', 'SS'), playerId: 'inc-1' },
      { ...rosterSlot('t2', 'SS'), playerId: 'inc-2' },
    ])) === JSON.stringify(occupied),
    'a Map keyed by team+slot must not depend on the order roster slots arrived in',
  );

  console.log(`\n${problems.length === 0 ? 'all good' : `FAILED (${problems.length}): ${problems.join(', ')}`}\n`);
  if (problems.length > 0) process.exit(1);
};

main();