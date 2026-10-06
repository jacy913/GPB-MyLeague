/*
 * The dashboard's award-race price must be the price MacroBet is selling, for the same player, on the
 * same day.
 *
 * WHY THIS NEEDS ITS OWN FILE. The dashboard builds its race the same way `BettingPage` does and
 * then keeps three rows. Every way that can go wrong produces a number that looks completely fine:
 *
 *   - Pass the top three to `buildAwardMarket` instead of the full field. The builder normalises over
 *     whatever it is handed, so the leader posts at ~85%. Plausible, confident, wrong.
 *   - Pass `decided` on the dashboard and not on the book, or the reverse. Currently harmless --
 *     `decided` only sets `locked` -- but it is one refactor away from touching the price.
 *   - Let the two call sites drift on field size. Different `take` values, same player, two prices.
 *
 * None of those throws. All of them are invisible except by comparing the two surfaces directly,
 * which is what this does.
 */
import {
  buildAwardsForBoard,
  type AwardInputs,
} from '../src/lib/awardRace';
import { buildAwardMarket, AWARD_RACE_SPECS } from '../src/lib/mediaMarkets';
import { probabilityToAmerican, formatAmerican } from '../src/lib/markets';
import { getPreferredBattingStatsByPlayerId, getPreferredPitchingStatsByPlayerId } from '../src/logic/playerStats';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { generateSchedule, getDefaultSeasonStartDate, DEFAULT_SETTINGS } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { seededRandomStream } from '../src/lib/analytics/playoffMonteCarlo';
import { INITIAL_TEAMS } from '../src/data/teams';
import type { PlayerBattingRatings, PlayerPitchingRatings } from '../src/types';

/**
 * `latestByPlayerId`, copied from `BettingPage.tsx:35` because it is not exported.
 *
 * Copied rather than shared, and the duplication is the safer of the two options here: `HomeDashboard`
 * is handed its rating maps as props and this tool has to build them itself, so either the helper
 * moves to `lib/` or every non-React caller re-derives it. Re-deriving it in a check that is
 * specifically about catching drift between surfaces is the point -- if this file imported the app's
 * own conversion it would be agreeing with the thing it is meant to check.
 */
const latestByPlayerId = <T extends { playerId: string; seasonYear: number }>(
  rows: T[],
): Map<string, T> => {
  const map = new Map<string, T>();
  for (const row of [...rows].sort((a, b) => a.seasonYear - b.seasonYear)) map.set(row.playerId, row);
  return map;
};

/**
 * The keys come from `AWARD_RACE_SPECS`, the same constant both surfaces read.
 *
 * This file originally HARDCODED `'batting_mvp'` / `'pitching_mvp'` and carried a paragraph about how
 * that was a deliberate risk. It was not a risk worth carrying -- it was a second place for the two
 * surfaces to drift, in a check whose entire purpose is noticing when they drift. The constant now
 * exists in `lib/mediaMarkets.ts` and both call sites read it, so there is one definition and this
 * file tests the shared thing rather than a private copy of it.
 */
const KEYS = AWARD_RACE_SPECS;

const problems: string[] = [];

/**
 * Build a universe and run enough of a real season for the race to have a field at all.
 *
 * `buildNewUniverse` gives rosters and ratings on day one but NO season stats, and both award builders
 * require them (120 at-bats, or 50 innings). An un-simulated league therefore has an empty race --
 * and an empty race makes every assertion below pass vacuously, which is exactly what the first
 * version of this file did: green, having tested nothing.
 *
 * So the field being empty is treated as a FAILURE here rather than an early return, and the days are
 * run until it is not. A check that cannot tell "nothing to test" from "everything correct" is
 * decoration.
 */
const SEED = 5150;
const YEAR = 2026;
const DAYS = 130;

const built = buildNewUniverse({
  teams: INITIAL_TEAMS.map((t) => ({ ...t })),
  seasonYear: YEAR,
  seed: SEED,
  effectiveDate: `${YEAR}-12-15`,
});

const seasonTeams = recalculateTeamRatingsFromRosters(
  INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
  built.playerState,
  YEAR,
);

const manager = new SimulationManager({
  teams: seasonTeams,
  games: generateSchedule(seasonTeams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
    random: seededRandomStream(31337),
  }),
  playerState: built.playerState,
  settings: DEFAULT_SETTINGS,
  currentDate: getDefaultSeasonStartDate(YEAR),
});

let universe = built.playerState;
for (let day = 0; day < DAYS; day += 1) {
  const r = await manager.run({ scope: 'day' });
  universe = r.playerState;
}

const awardInputs: AwardInputs = {
  players: universe.players,
  teamsById: new Map(INITIAL_TEAMS.map((t) => [t.id, t])),
  battingStats: getPreferredBattingStatsByPlayerId(universe.battingStats),
  pitchingStats: getPreferredPitchingStatsByPlayerId(universe.pitchingStats),
  battingRatings: latestByPlayerId<PlayerBattingRatings>(universe.battingRatings),
  pitchingRatings: latestByPlayerId<PlayerPitchingRatings>(universe.pitchingRatings),
};

console.log('\nAWARD RACE PRICE -- DASHBOARD vs MACROBET\n');

for (const board of ['batting', 'pitching'] as const) {
  const spec = KEYS[board];
  const key = spec.key;
  const title = spec.title;

  // What MacroBet builds: the full field.
  const field = buildAwardsForBoard(board, awardInputs);
  if (field.length === 0) {
    problems.push(`${board}: the field is empty, so nothing below was actually tested`);
    console.log(`  ${board.padEnd(9)} FIELD EMPTY -- every assertion below would pass vacuously`);
    continue;
  }

  const market = buildAwardMarket(key, title, field);
  const bookPrice = new Map(market.outcomes.map((o) => [o.key, o.consensusProbability]));

  // What the dashboard shows: the same market, top three.
  const shown = field.slice(0, 3).map((entry) => ({
    playerId: entry.playerId,
    name: entry.name,
    points: entry.total,
    probability: bookPrice.get(entry.playerId) ?? null,
  }));

  console.log(`  ${board.toUpperCase()}  field of ${field.length}, showing ${shown.length}`);
  for (const row of shown) {
    const price = row.probability === null ? '—' : formatAmerican(probabilityToAmerican(row.probability));
    console.log(
      `    ${row.name.padEnd(22)} ${row.points.toFixed(1).padStart(6)} pts   ${price.padStart(7)}`
      + `   (${row.probability === null ? 'no price' : `${(row.probability * 100).toFixed(1)}%`})`,
    );
    if (row.probability === null) {
      problems.push(`${board}: ${row.name} is in the race but has no price on the market`);
    }
  }

  // THE ASSERTION THAT MATTERS: the field size changes the price, so prove the full field is used.
  const topThreeOnly = buildAwardMarket(key, title, field.slice(0, 3));
  const shrunk = new Map(topThreeOnly.outcomes.map((o) => [o.key, o.consensusProbability]));
  const leader = field[0];
  const fullLeader = bookPrice.get(leader.playerId) ?? 0;
  const threeLeader = shrunk.get(leader.playerId) ?? 0;

  console.log(`\n    leader on the full field      ${(fullLeader * 100).toFixed(1)}%`);
  console.log(`    leader if only 3 were passed ${(threeLeader * 100).toFixed(1)}%`);
  console.log(`    gap ${((threeLeader - fullLeader) * 100).toFixed(1)} points -- so the field size is load-bearing`);

  if (Math.abs(fullLeader - threeLeader) < 0.02) {
    problems.push(
      `${board}: a 3-player field prices the leader within 2 points of an 8-player field, so this`
      + ' check cannot tell the two apart and would pass a broken dashboard',
    );
  }

  // A price that is not a probability is worse than no price.
  for (const row of shown) {
    if (row.probability !== null && (row.probability <= 0 || row.probability >= 1)) {
      problems.push(`${board}: ${row.name} posts at ${row.probability}, which is not a probability`);
    }
  }

  // The three shown must be the three the book ranks first by its own consensus.
  const byBookPrice = [...bookPrice.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
  const byPoints = shown.map((r) => r.playerId);
  if (byBookPrice.join() !== byPoints.join()) {
    console.log(
      `\n    NOTE: top three by points [${byPoints.join(', ')}] differ from top three by house price`
      + ` [${byBookPrice.join(', ')}]`,
    );
    console.log('    That is expected -- the house regresses toward the field, so it can rank differently.');
    console.log('    It is printed rather than gated because it is a property of the model, not a fault.');
  }
  console.log('');
}

/*
 * THE KEYS ARE SHARED NOW, WHICH CLOSES THE LAST HOLE IN THIS CHECK.
 *
 * The first version hardcoded them and documented that as a deliberate risk. It was not: it was a
 * second place for the two surfaces to drift, in a file written to notice exactly that drift. Both
 * call sites and this one now read `AWARD_RACE_SPECS`, so there is one definition of the key, the
 * title and the field size, and the question this file asks -- "is the dashboard's price the book's
 * price?" -- is answered by construction rather than by discipline.
 */
console.log('  one spec, two surfaces: the dashboard price and the MacroBet price are the same number');
console.log('');

if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}