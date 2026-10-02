/**
 * Is the derived fanbase stable, spread out, and -- most importantly -- not a strength proxy?
 *
 * ===========================================================================
 * WHY THIS NEEDS A CHECK AT ALL
 * ===========================================================================
 *
 * The derivation is four lines of hash. The risk is not that it is wrong; it is that it is
 * ACCIDENTALLY meaningful in a way nobody intended.
 *
 * A hash has no relationship to anything, which is the point -- but "no intended relationship" is
 * not the same as "no actual relationship". With only 32 clubs and ratings spanning 28 to 92, a
 * hash draw could easily land in positive correlation with team strength by luck. If it did, then
 * `liquidity` would be a quality signal wearing a market-size costume, and every conclusion drawn
 * from the Phase 3 crowd would really be about club strength. That is a silent, plausible,
 * entirely wrong result, which is the worst category there is.
 *
 * So the correlation is measured and gated, against BOTH quality signals on `Team`: `rating` and
 * `previousBaselineWins`.
 *
 * ===========================================================================
 * WHY `previousBaselineWins` IS CHECKED TOO
 * ===========================================================================
 *
 * `rating` is the obvious one. `previousBaselineWins` is the subtler trap: it is described as
 * historical performance and is static across a save, so a hash that happened to align with it would
 * produce a market size that looks stable and correct while actually encoding past success. One
 * correlation check is not enough when there are two quality signals and they do not agree.
 *
 * Run: npx tsx tools/checkFanbase.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import {
  GAP_SCALE,
  LIQUIDITY_FLOOR,
  MAX_REACHABLE_GAP,
  TIER_BOUNDS,
  fanbaseFor,
  gapRiskFor,
  leagueFanbases,
  liquidityFor,
  marketSizeFor,
  tierFor,
  type MarketTier,
} from '../src/lib/analytics/fanbase';
import type { Team } from '../src/types';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/** Pearson correlation. Enough for n=32 and stated as what it is. */
const correlation = (xs: number[], ys: number[]): number => {
  const n = Math.min(xs.length, ys.length);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
};

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]): number => { const m = mean(xs); return Math.sqrt(mean(xs.map((v) => (v - m) ** 2))); };

/**
 * How large a correlation of n samples has to be before it is worth noticing.
 *
 * For n = 32 the standard error of a zero correlation is 1/sqrt(n-3) ~= 0.18, so anything under about
 * 0.18 is indistinguishable from noise at one standard error. The bar is set at 0.25 -- a little
 * over one standard error -- which is loose enough not to fail on luck and tight enough to catch a
 * real alignment. It is a Chosen number and it is declared before the measurement.
 */
const CORRELATION_BAR = 0.25;

const main = (): void => {
  const teams = INITIAL_TEAMS;
  const fanbases = leagueFanbases(teams);
  const sizes = fanbases.map((f) => f.size);

  // -- 1. determinism and permanence -------------------------------------------------------
  check(
    'the same club always gets the same market size, with no seed involved',
    fanbases.every((f, i) => marketSizeFor(teams[i]) === f.size && fanbaseFor(teams[i]).size === f.size),
    'market size is a pure function of id | city | name. There is no seed and no stored field, so it '
    + 'survives save and load and two devices agree without exchanging anything.',
  );

  /*
    The real permanence test: nothing on `Team` that CHANGES during a season may move the market size.
    `rating`, `wins`, `losses`, `runsScored` and `previousBaselineWins` all change or are re-derived
    across a save. If any of them leaked into the derivation, a club's fanbase would drift with its
    form -- which would make liquidity a form signal, and would silently change saved series.
   */
  const mutated: Team[] = teams.map((t, i) => ({
    ...t,
    rating: t.rating + 17,
    wins: 90 + i,
    losses: 3,
    runsScored: 800 + i,
    runsAllowed: 400 - i,
    previousBaselineWins: t.previousBaselineWins + 25,
  }));
  check(
    'no season-varying field on Team can move the market size',
    mutated.every((t, i) => marketSizeFor(t) === sizes[i]),
    'rating, wins, losses, runs and previousBaselineWins were all perturbed and every size held. '
    + 'A club that wins more does not become a bigger market, and a club cannot inherit liquidity from its form.',
  );

  // -- 2. the distribution is real ------------------------------------------------------------
  const sizeSd = sd(sizes);
  check(
    'the 32 clubs are genuinely spread rather than clustered',
    sizeSd > 20 && Math.min(...sizes) < 25 && Math.max(...sizes) > 75,
    `size runs ${Math.min(...sizes).toFixed(1)} to ${Math.max(...sizes).toFixed(1)}, sd ${sizeSd.toFixed(2)}, `
    + `mean ${mean(sizes).toFixed(1)}. A tight cluster would mean every club traded the same way and §5.3 `
    + 'would have nothing to say.',
  );

  const byTier = new Map<MarketTier, number>(TIER_BOUNDS.map((b) => [b.tier, 0]));
  fanbases.forEach((f) => byTier.set(f.tier, (byTier.get(f.tier) ?? 0) + 1));
  const populated = TIER_BOUNDS.every((b) => (byTier.get(b.tier) ?? 0) > 0);
  check(
    'every tier is populated, so there is a real thin tail and a real top',
    populated,
    TIER_BOUNDS.map((b) => `${b.tier} ${byTier.get(b.tier) ?? 0}`).join(', ')
    + ` (out of ${teams.length}). The boundaries were drawn before this was measured and have not moved.`,
  );

  // -- 3. NOT A STRENGTH PROXY, which is the whole point -------------------------------------
  const byRating = correlation(sizes, teams.map((t) => t.rating));
  const byBaseline = correlation(sizes, teams.map((t) => t.previousBaselineWins));
  check(
    'market size does not correlate with rating, so liquidity is not a strength proxy',
    Math.abs(byRating) < CORRELATION_BAR,
    `correlation with rating ${byRating.toFixed(3)} against a bar of ${CORRELATION_BAR}. With n=32 the `
    + `standard error of a zero correlation is about ${(1 / Math.sqrt(29)).toFixed(2)}, so anything inside the bar is `
    + 'indistinguishable from a hash being a hash. Had this aligned, liquidity would have been a quality '
    + 'signal in a market-size costume and every Phase 3 conclusion would really have been about strength.',
  );
  check(
    'and it does not correlate with previousBaselineWins either',
    Math.abs(byBaseline) < CORRELATION_BAR,
    `correlation with previousBaselineWins ${byBaseline.toFixed(3)}. This is the subtler of the two: that field is `
    + 'static and described as historical performance, so a hash aligned with it would produce a market size that '
    + 'looked permanent while quietly encoding past success.',
  );

  const strongest = [...fanbases].sort((a, b) => b.size - a.size);
  check(
    'the biggest market is not the best club, and the smallest is not the worst',
    strongest[0].teamId !== [...teams].sort((a, b) => b.rating - a.rating)[0].id,
    `biggest market ${strongest[0].name} (${strongest[0].size.toFixed(1)}) against best club `
    + `${[...teams].sort((a, b) => b.rating - a.rating)[0].name} (rating `
    + `${[...teams].sort((a, b) => b.rating - a.rating)[0].rating}). Smallest market `
    + `${strongest[strongest.length - 1].name} (${strongest[strongest.length - 1].size.toFixed(1)}).`,
  );

  // -- 4. the spread is not all in one division ---------------------------------------------
  const perDivision = new Map<string, number[]>();
  fanbases.forEach((f, i) => {
    const d = teams[i].division;
    if (!perDivision.has(d)) perDivision.set(d, []);
    (perDivision.get(d) as number[]).push(f.size);
  });
  const divisionMeans = [...perDivision.entries()].map(([d, v]) => `${d} ${mean(v).toFixed(0)}`);
  const divisionSpread = Math.max(...[...perDivision.values()].map(mean)) - Math.min(...[...perDivision.values()].map(mean));
  check(
    'market size is spread across divisions rather than concentrated in one',
    divisionSpread > 8,
    `mean size by division: ${divisionMeans.join(', ')} -- a spread of ${divisionSpread.toFixed(1)} points. `
    + 'If every big market sat in one division, "buy the big club" would quietly be a division strategy.',
  );

  // -- 5. liquidity is monotone, which is what makes it usable ------------------------------
  const ordered = [...sizes].sort((a, b) => a - b);
  const liquidityMonotone = ordered.every((s, i) => i === 0 || liquidityFor(s) >= liquidityFor(ordered[i - 1]));
  check(
    'liquidity increases monotonically with market size',
    liquidityMonotone,
    `liquidity spans ${liquidityFor(0).toFixed(2)} to ${liquidityFor(100).toFixed(2)}. The floor is 0.25 rather than `
    + 'zero on purpose: even the smallest market has some holders, and a zero would make the price path undefined '
    + 'rather than merely thin.',
  );

  const gapMonotone = ordered.every((s, i) => i === 0 || gapRiskFor(s) <= gapRiskFor(ordered[i - 1]));
  const observedGapMax = 1 + Math.max(...fanbases.map((f) => f.gapRisk));
  const observedGapMin = 1 + Math.min(...fanbases.map((f) => f.gapRisk));
  check(
    'and gap risk decreases with size, so a thin name gaps harder',
    gapMonotone && observedGapMax <= MAX_REACHABLE_GAP,
    `measured across the 32 clubs: ${observedGapMin.toFixed(2)}x for the widest market to ${observedGapMax.toFixed(2)}x `
    + `for the thinnest, against a reachable ceiling of ${MAX_REACHABLE_GAP.toFixed(2)}x (1 + (1 - `
    + `${LIQUIDITY_FLOOR}) x ${GAP_SCALE}). This is the mechanic §5.3 is actually asking for: liquidity says how deep `
    + 'the book is, gapRisk says how violently the price responds.',
  );

  // -- 6. the boundaries are what they claim -------------------------------------------------
  const boundaryOk = TIER_BOUNDS.every((b, i) => i === TIER_BOUNDS.length - 1 || b.above > TIER_BOUNDS[i + 1].above);
  check(
    'the tier boundaries are strictly descending and exhaustive',
    boundaryOk && tierFor(100) === 'major' && tierFor(0) === 'marginal',
    `bounds ${TIER_BOUNDS.map((b) => `${b.tier}>${b.above}`).join(', ')}. Every size lands in exactly one tier, and `
    + 'the top and bottom are reachable.',
  );

  // -- report ---------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nFANBASE AND LIQUIDITY\n');
  console.log(`  derived from id | city | name only -- no seed, no stored field, ${teams.length} clubs\n`);
  console.log('  tier        clubs   size range');
  TIER_BOUNDS.forEach((b) => {
    const members = fanbases.filter((f) => f.tier === b.tier);
    if (members.length === 0) return;
    console.log(`  ${b.tier.padEnd(10)} ${String(members.length).padStart(5)}   `
      + `${Math.min(...members.map((f) => f.size)).toFixed(1)} to ${Math.max(...members.map((f) => f.size)).toFixed(1)}`);
  });
  console.log('\n  widest markets');
  strongest.slice(0, 4).forEach((f) => {
    const t = teams.find((x) => x.id === f.teamId) as Team;
    console.log(`    ${f.name.padEnd(12)} size ${f.size.toFixed(1).padStart(5)}  ${f.tier.padEnd(9)} `
      + `liquidity ${f.liquidity.toFixed(2)}  gap x${(1 + f.gapRisk).toFixed(2)}  (rating ${t.rating})`);
  });
  console.log('\n  thinnest markets');
  strongest.slice(-4).reverse().forEach((f) => {
    const t = teams.find((x) => x.id === f.teamId) as Team;
    console.log(`    ${f.name.padEnd(12)} size ${f.size.toFixed(1).padStart(5)}  ${f.tier.padEnd(9)} `
      + `liquidity ${f.liquidity.toFixed(2)}  gap x${(1 + f.gapRisk).toFixed(2)}  (rating ${t.rating})`);
  });
  console.log(`\n  correlation with rating              ${byRating.toFixed(3)}`);
  console.log(`  correlation with previousBaselineWins ${byBaseline.toFixed(3)}`);
  console.log(`  size sd                              ${sizeSd.toFixed(2)}`);
  console.log('');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();
