/**
 * Guards on the power rankings.
 *
 * ============================================================================
 * WHY THESE, AND WHY THEY ARE WORTH WRITING
 * ============================================================================
 *
 * Both headline properties here are INVISIBLE when broken. Neither produces an error, a warning or a
 * wrong shape -- it produces a board that looks entirely reasonable while quietly answering a
 * different question than the one asked.
 *
 * 1. THE BOARD MUST AGREE WITH THE MARKET. `buildPowerRankings` reads the same fair layer the HXSE
 *    prices from, so for the same seed, date and trial count the two must produce identical fair
 *    values. If they drift -- a different default seed, a different `mcTrials` in one caller -- the
 *    rankings and the Exchange would rank one club differently, and the manager would find the
 *    contradiction within a single screen. Nothing upstream complains; both numbers look fine.
 *
 * 2. DIVISION STRENGTH MUST NOT MOVE ANY RANK. The Monte Carlo already knows who each club has to
 *    beat, so a weak division is inside the championship probability. Scoring it as well would count it
 *    twice -- and a double-count is the easiest defect to ship, because the board still looks good.
 *
 * On (2), note what the test is and is NOT. A perturbation test cannot prove it: change the
 * valuations and a valuation-ranked order legitimately reorders, so such a test only measures that
 * the sort works. The property that matters is structural -- a ranking row carries no division-derived
 * score, and the published order is *exactly* a pure sort of the fair layer's valuations. That is
 * asserted directly below, and it is what makes the naming-convention claim trustworthy.
 *
 * Run: npx tsx tools/checkPowerRankings.ts
 */

import {
  DEFAULT_RANK_BASIS,
  DIVISION_TAG_SPREAD,
  buildPowerRankings,
  summariseDivisions,
} from '../src/lib/analytics/powerRankings';
import { fairLayerFor, leaguePriceSeed, clearFairLayerCache } from '../src/lib/analytics/priceBoard';
import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { normalizeSeed } from '../src/lib/random';
import type { Team } from '../src/types';

const YEAR = 2026;
const SEED = normalizeSeed('check-power-rankings');

const playerState = buildNewUniverse({
  teams: INITIAL_TEAMS.map((t) => ({ ...t })),
  seasonYear: YEAR,
  seed: SEED,
  effectiveDate: `${YEAR}-12-15`,
}).playerState;

const teams: Team[] = recalculateTeamRatingsFromRosters(
  INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
  playerState,
  YEAR,
);

const games = generateSchedule(teams, {
  seasonStartDate: getDefaultSeasonStartDate(YEAR),
  seasonDays: 180,
});
const date = getDefaultSeasonStartDate(YEAR);

const checks: Array<{ label: string; pass: boolean; detail: string }> = [];
const check = (label: string, pass: boolean, detail: string): void => {
  checks.push({ label, pass, detail });
};

/*
  The SAME cache key on both calls, deliberately.

  A cache hit means the board is being compared against the layer it actually read, which is the thing
  that has to agree. Different keys would recompute an identical layer and prove nothing about caching,
  only about purity.
*/
const CACHE_KEY = 'check-power-rankings|board';
const rankings = buildPowerRankings({
  teams, games, playerState, seasonYear: YEAR, date, settings: DEFAULT_SETTINGS, fairCacheKey: CACHE_KEY,
});
const board = fairLayerFor({
  teams, games, date, playerState, seasonYear: YEAR, seed: leaguePriceSeed(teams),
  mcTrials: 250, settings: DEFAULT_SETTINGS, fairCacheKey: CACHE_KEY,
});

// -- 1. AGREEMENT WITH THE MARKET ----------------------------------------------------------
const sameIds = Object.keys(board.layer.fair).sort().join(',')
  === rankings.rows.map((r) => r.teamId).sort().join(',');
const priceMismatches = rankings.rows.filter((r) => Math.abs(board.layer.fair[r.teamId] - r.fairPrice) > 1e-9);
const valMismatches = rankings.rows.filter((r) => Math.abs(board.layer.valuation[r.teamId] - r.valuation) > 1e-9);

check(
  'the board and the market read the same fair layer, so they cannot rank a club differently',
  sameIds && priceMismatches.length === 0 && valMismatches.length === 0,
  `across ${rankings.rows.length} clubs the fair prices and valuations are identical to the layer the HXSE `
  + `prices from (${priceMismatches.length} price mismatches, ${valMismatches.length} valuation mismatches). `
  + 'A divergence here would put two different rankings for one club on two screens, and neither number '
  + 'would look wrong on its own.',
);

// -- 2. THE ODDS MUST SURVIVE A CACHE HIT ---------------------------------------------------
/*
  This is the check whose ABSENCE put 0% in the board's title column, so it is worth being explicit
  about how it was missed.

  React StrictMode invokes the render twice in development, so the dashboard's memo calls
  `fairLayerFor` twice with the same key: once on a miss, once on a hit. `fairLayerFor` cached only
  the valuations and fair prices, so the HIT returned a layer with no odds in it -- and every "make"
  and "title" cell on the board read 0% while the valuation beside it was correct.

  Check 1 could not have caught it: it compares fair prices and valuations, which were always right.
  The defect lived entirely in a field nobody was comparing. So this compares a MISS against a HIT.
*/
clearFairLayerCache();
const cacheKey = 'check-power-rankings|cache-hit';
const missCall = fairLayerFor({
  teams, games, date, playerState, seasonYear: YEAR, seed: leaguePriceSeed(teams),
  mcTrials: 250, settings: DEFAULT_SETTINGS, fairCacheKey: cacheKey,
});
const hitCall = fairLayerFor({
  teams, games, date, playerState, seasonYear: YEAR, seed: leaguePriceSeed(teams),
  mcTrials: 250, settings: DEFAULT_SETTINGS, fairCacheKey: cacheKey,
});
const missOdds = missCall.odds;
const hitOdds = hitCall.odds;
const oddsMatch = missOdds.length > 0
  && hitOdds.length === missOdds.length
  && hitOdds.every((o, i) => o.teamId === missOdds[i].teamId
    && Math.abs(o.championship - missOdds[i].championship) < 1e-12);

check(
  'a CACHE HIT still returns the playoff probabilities, rather than an empty array',
  oddsMatch && hitOdds.some((o) => o.championship > 0),
  `a miss returned ${missOdds.length} odds, top title chance `
  + `${(Math.max(...missOdds.map((o) => o.championship)) * 100).toFixed(1)}%; the following hit returned `
  + `${hitOdds.length} and they match to 1e-12. When the odds were not cached the hit returned none, and `
  + 'every title cell on the board read 0% while the valuations beside it stayed correct -- so no check '
  + 'comparing prices could ever have seen it.',
);

// -- 3. DIVISION STRENGTH IS DESCRIBED, NEVER SCORED ----------------------------------------
const weakest = rankings.divisions[rankings.divisions.length - 1];
const weakestKey = `${weakest.league}-${weakest.division}`;

const boosted = { ...board.layer.valuation };
for (const teamId of weakest.teamIds) {
  boosted[teamId] = Math.min(100, (boosted[teamId] ?? 50) + 25);
}
const perturbed = summariseDivisions(teams, boosted);

/*
  Look the perturbed division up BY KEY, not by position.

  `summariseDivisions` sorts by mean descending, so after a 25-point boost the weakest division is no
  longer the weakest and `perturbed[perturbed.length - 1]` names a DIFFERENT one. Read positionally,
  the check compared Platinum East before the boost against whichever division had fallen to last
  after it -- reported a z-score moving the wrong way, and looked like the tag was broken.
*/
const weakestAfter = perturbed.find((d) => `${d.league}-${d.division}` === weakestKey);
if (!weakestAfter) {
  throw new Error(`perturbed divisions lost ${weakestKey}`);
}

const baselineTags = new Map(rankings.rows.map((r) => [r.teamId, r.divisionTag]));
const perturbedTags = new Map<string, string>();
for (const division of perturbed) {
  for (const teamId of division.teamIds) perturbedTags.set(teamId, division.tag);
}
/*
  `.length`, not the array. An earlier version concatenated the filter result straight into the message
  and printed "changed cal,deep,dwi,soft..." instead of a count -- while also comparing an array to a
  number, which is why it failed for a type reason rather than a real one.
*/
const tagsMoved = [...baselineTags].filter(([teamId, tag]) => perturbedTags.get(teamId) !== tag).length;

/*
  NO `weakest.tag === 'soft'` PRECONDITION, and removing it was the fix.

  An earlier version asserted the weakest division starts tagged 'soft'. It does not, and cannot be
  relied on to: the tag is one standard deviation from the league mean, and with eight divisions the
  minimum z is only guaranteed to be about -1.5. This run's weakest sat at z -0.94 -- inside the band --
  so it read 'even', and the check failed on an INCIDENTAL fact about one league rather than on any
  property of the code. It flipped between runs and looked like the tag was broken.

  The property that actually matters is that the tag RESPONDS: it changes, and the mean and z both rise.
*/
check(
  'the division tag RESPONDS to a division getting stronger, so it is measuring something',
  weakestAfter.tag !== weakest.tag
  && weakestAfter.meanValuation > weakest.meanValuation
  && weakestAfter.z > weakest.z
  && tagsMoved >= weakest.teamIds.length,
  `raising all four clubs in ${weakest.league} ${weakest.division} by 25 points moved that division from `
  + `'${weakest.tag}' (z ${weakest.z.toFixed(2)}, mean ${weakest.meanValuation.toFixed(1)}) to `
  + `'${weakestAfter.tag}' (z ${weakestAfter.z.toFixed(2)}, mean ${weakestAfter.meanValuation.toFixed(1)}) `
  + `and changed ${tagsMoved} tags overall. Mean and z both rose, which is what distinguishes a measurement `
  + 'from a label.',
);

const expectedOrder = [...teams]
  .sort((l, r) => (board.layer.valuation[r.id] ?? 0) - (board.layer.valuation[l.id] ?? 0)
    || l.id.localeCompare(r.id))
  .map((t) => t.id)
  .join(',');
check(
  'the published order IS a pure sort of the fair layer valuations, so the tag provably cannot feed it',
  rankings.rows.map((r) => r.teamId).join(',') === expectedOrder,
  `the board's ${rankings.rows.length} rows, in order, are exactly \`teams\` sorted by fair-layer valuation `
  + 'descending with the same id tiebreak. Nothing else participates in the comparison. This is the check '
  + 'that fails first if anyone ever adds a division term.',
);

const summaryShape = Object.keys(perturbed[0]).sort().join(',');
check(
  'and there is no channel for a tag to reach a rank, so the double-count cannot return by accident',
  summaryShape === 'division,league,meanValuation,tag,teamIds,z'
  && rankings.rows.every((r) => !('divisionBonus' in r)
    && !('divisionAdjustment' in r)
    && !('divisionStrength' in r)),
  `a division summary carries only {${summaryShape}} and a ranking row carries no division-derived score `
  + 'field at all. The order assertion above is what makes this structural claim trustworthy rather than '
  + 'a naming convention.',
);

// -- 3. THE TAG IS RELATIVE, SO IT CANNOT BE WRONG IN AN ABSOLUTE SENSE -----------------------
/*
  A Proxy that reports 50 for every club: eight divisions, all identical. Every z must be 0 and every
  tag 'even'. A fixed threshold would have called four of them soft and four deep and been wrong about
  all eight.
*/
const flat = summariseDivisions(teams, new Proxy({} as Record<string, number>, { get: () => 50 }));
check(
  'a league where every division is identical reads all-even, so "soft" is never an absolute claim',
  flat.every((d) => d.tag === 'even' && Math.abs(d.z) < 1e-9),
  `all ${flat.length} divisions flattened to a single valuation: every tag is 'even', every z is 0. The tag `
  + `is measured against the spread of division means in THIS league, at ${DIVISION_TAG_SPREAD} sd, so it `
  + 'degrades to "no division is remarkable" when no division is.',
);

// -- 4. THE RANK BASIS IS THE MEASURED ONE ---------------------------------------------------
check(
  'the default rank basis is valuation, because championship cannot order clubs at this trial count',
  DEFAULT_RANK_BASIS === 'valuation',
  'measured by tools/probePowerRankings.ts across a pristine universe, a month in and mid season: the gap '
  + 'between neighbouring clubs on championship probability comes out at 0.0 points while the valuation gap '
  + 'is ~0.1, and ranking by championship put the strongest club in a pristine league at number 14. At 250 '
  + 'trials a 10% probability carries about 1.9 points of standard error, so ordering by it is ordering by '
  + 'the simulation dice.',
);

check(
  'the board reports the basis it actually sorted on, rather than implying the more obvious one',
  rankings.rankBasis === DEFAULT_RANK_BASIS
  && (rankings.rankBasis === 'championship'
    ? rankings.rows.every((r, i) => i === 0 || rankings.rows[i - 1].championshipPct >= r.championshipPct)
    : rankings.rows.every((r, i) => i === 0 || rankings.rows[i - 1].valuation >= r.valuation)),
  `the board reports rankBasis "${rankings.rankBasis}", the default is "${DEFAULT_RANK_BASIS}", and the `
  + 'published rows are monotonic in that column. A board that sorts on one number while labelling '
  + 'another is the quietest kind of wrong.',
);

// -- report ---------------------------------------------------------------------------------
const failed = checks.filter((c) => !c.pass);
console.log('\nPOWER RANKINGS\n');
console.log(`  ${rankings.rows.length} clubs, ${rankings.divisions.length} divisions, `
  + `${rankings.mcTrials} simulation trials, as of ${rankings.asOf}\n`);
checks.forEach((c, i) => {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.label}`);
  console.log(`          ${c.detail}`);
});
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks PASS\n`);
if (failed.length > 0) process.exitCode = 1;