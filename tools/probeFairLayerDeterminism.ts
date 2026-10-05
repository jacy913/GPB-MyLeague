/**
 * Is the fair layer deterministic?
 *
 * Running `probePowerRankings` three times produced three different top valuations for a PRISTINE
 * universe built from a fixed seed -- 82.7, then 86.6, then 87.7. The seed is derived from the club
 * ids (`leaguePriceSeed`), `playoffMonteCarlo` is seeded through `withSeededRandom`, and
 * `checkSharePrice` check 2 asserts that the same seed gives an identical series day for day. So
 * three answers to the same question means something upstream is drawing from an unseeded source.
 *
 * That matters well beyond a probe: a fair price that moves between page loads is a valuation the
 * player cannot trust, and the whole reason `leaguePriceSeed` exists is that this number must not
 * change just because the tab was reopened.
 *
 * Built in ONE process so there is no cross-process variation to confuse the diagnosis, and the
 * universe is built ONCE and priced repeatedly -- so any difference is in the pricing, not the rosters.
 *
 * Run: npx tsx tools/probeFairLayerDeterminism.ts
 */

import { fairLayerFor, leaguePriceSeed, clearFairLayerCache } from '../src/lib/analytics/priceBoard';
import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { normalizeSeed } from '../src/lib/random';

const YEAR = 2026;

const playerState = buildNewUniverse({
  teams: INITIAL_TEAMS.map((t) => ({ ...t })),
  seasonYear: YEAR,
  seed: normalizeSeed('probe-determinism'),
  effectiveDate: `${YEAR}-12-15`,
}).playerState;

const teams = recalculateTeamRatingsFromRosters(
  INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
  playerState,
  YEAR,
);

const games = generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 });
const date = getDefaultSeasonStartDate(YEAR);
const seed = leaguePriceSeed(teams);

const price = () => {
  // Cache cleared every call, so this cannot be a cache hit answering from a previous result.
  clearFairLayerCache();
  return fairLayerFor({
    teams,
    games,
    date,
    playerState,
    seasonYear: YEAR,
    seed,
    mcTrials: 250,
    settings: DEFAULT_SETTINGS,
  });
};

console.log(`\nFAIR LAYER DETERMINISM -- same process, same seed ${seed}, cache cleared each call\n`);

const runs = [price(), price(), price()];
const ids = Object.keys(runs[0].layer.fair);

const fairSpread = ids.map((id) => Math.max(...runs.map((r) => r.layer.fair[id])) - Math.min(...runs.map((r) => r.layer.fair[id])));
const valSpread = ids.map((id) => Math.max(...runs.map((r) => r.layer.valuation[id])) - Math.min(...runs.map((r) => r.layer.valuation[id])));
const champSpread = ids.map((id) => Math.max(...runs.map((r) => r.odds.find((o) => o.teamId === id)?.championship ?? 0))
  - Math.min(...runs.map((r) => r.odds.find((o) => o.teamId === id)?.championship ?? 0)));

const report = (label: string, spreads: number[], scale: string) => {
  const worst = Math.max(...spreads);
  const offending = ids.filter((_, i) => spreads[i] > 1e-9);
  console.log(`  ${label.padEnd(16)} max spread ${worst.toFixed(6)} ${scale}`
    + `   ${offending.length === 0 ? 'IDENTICAL across runs' : `DIFFERS on ${offending.length}/${ids.length} clubs`}`);
  if (offending.length > 0 && offending.length <= 3) {
    for (const id of offending) console.log(`      ${id}: ${spreads[ids.indexOf(id)].toFixed(6)} ${scale}`);
  }
  return worst === 0;
};

const fairSame = report('fair price', fairSpread, '');
const valSame = report('valuation', valSpread, '');
const champSame = report('championship', champSpread, '');

console.log(`\n  VERDICT: ${fairSame && valSame && champSame
  ? 'deterministic -- the earlier probe variation came from somewhere else'
  : 'NOT DETERMINISTIC -- an unseeded draw is reaching the valuation'}`);
console.log('');

process.exitCode = fairSame && valSame && champSame ? 0 : 1;