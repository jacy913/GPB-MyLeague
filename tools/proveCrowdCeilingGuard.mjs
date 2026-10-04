/**
 * Does checkCrowdOnRealPath catch the ceiling bug it used to ASSERT?
 *
 * ============================================================================
 * WHY THIS IS THE ONE INJECTION THAT MATTERS HERE
 * ============================================================================
 *
 * Check 5 used to assert `close <= PRICE_MAX`. That assertion WAS the historical bug: clamping the
 * close to the fair-value ceiling pinned a dominant club at exactly $1,000 and made its entire price
 * mechanism go inert for a whole window -- mean reversion, the crowd, game shocks, all of it, on the
 * best club in the league.
 *
 * So the check now asserts the opposite: no price PINNED at a bound, and every close inside the
 * corrupt-save guard. A rewritten assertion is exactly the kind that can pass without measuring
 * anything, and "no price is pinned" is easy to write in a way that can never fire.
 *
 * So the bug is re-injected -- the real one, in the real place, as it shipped -- and required to be
 * caught. Clamping `nextPrice` to `PRICE_MAX` reproduces the pin, and the whole point is that the
 * check notices the PIN rather than the overshoot, since the overshoot is legitimate and now counts
 * as expected.
 *
 * Run: node tools/proveCrowdCeilingGuard.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TARGET = 'src/lib/analytics/sharePrice.ts';
const TOOL = 'tools/checkCrowdOnRealPath.ts';

/** `shell: true` or spawnSync cannot resolve the npx shim on Windows and returns empty output. */
const runSuite = () => {
  const r = spawnSync('npx', ['tsx', TOOL], { encoding: 'utf8', cwd: process.cwd(), shell: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    fails: out.match(/^\s*FAIL\s+.*$/gm) ?? [],
    passes: out.match(/^\s*PASS\s+/gm) ?? [],
    full: out,
  };
};
const injections = [
  {
    name: 'THE SHIPPED BUG: the close is clamped to PRICE_MAX again, so a saturated club pins at $1,000',
    // The line as it exists in the fixed source. `nextPrice` returns the sanity-guarded price; this
    // puts the fair-value ceiling back on top of it, which is precisely the two-saturations-stacked
    // mechanism `sharePrice.ts` documents.
    from: '  return Math.max(PRICE_MIN, Math.min(PRICE_SANITY_MAX, next));',
    to: '  return Math.max(PRICE_MIN, Math.min(PRICE_MAX, next));',
    mustBreak: 'no price is PINNED at a bound',
  },
  {
    name: 'A WEIRDER VERSION: the clamp is looser, so it pins at a number nobody would recognise',
    from: '  return Math.max(PRICE_MIN, Math.min(PRICE_SANITY_MAX, next));',
    to: '  return Math.max(PRICE_MIN, Math.min(PRICE_SANITY_MAX, Math.round(next / 50) * 50));',
    mustBreak: 'no price is PINNED at a bound',
  },
  {
    /*
      There is deliberately no injection here for removing PRICE_SANITY_MAX, and the reason is worth
      recording rather than papering over.

      I wrote one. It aimed at checkCrowdOnRealPath first, where it left the suite reporting six of six,
      because nothing in sixteen days of real play comes within two orders of magnitude of 100,000. So I
      re-aimed it at checkSharePrice, which drives fair at exactly PRICE_MAX for sixty days to reach the
      saturated case on purpose -- and it did not bite there either. Removing the guard entirely changed
      no assertion anywhere in the project.

      That is not a gap in the harness. It is the nature of the guard. `PRICE_SANITY_MAX` "exists to
      catch a corrupt save rather than to bound a market", and no run of the model produces the corrupt
      save it defends against. A unit test over computed closes cannot reach it, because by construction
      those closes are not corrupt.

      So the guard is asserted as a cheap invariant and NOT claimed as covered by a fault injection.
      Asserting coverage it does not have is the exact mistake this file exists to catch -- it is what
      the old check 5 did with `close <= PRICE_MAX`, and what my deleted clause did with the same
      constant. If someone later adds a load path that accepts closes from a stored ledger, THAT is
      where an injection for this belongs, because that is where bad numbers can enter.
    */
    name: 'THE CORRUPT-SAVE GUARD IS REMOVED, and nothing catches it -- recorded, not asserted',
    from: '  return Math.max(PRICE_MIN, Math.min(PRICE_SANITY_MAX, next));',
    to: '  return Math.max(PRICE_MIN, next);',
    tool: 'tools/checkSharePrice.ts',
    mustBreak: 'no price leaves the SANITY GUARD',
    expectSurvivor: true,
  },
];

const runSuiteFor = (tool) => {
  const r = spawnSync('npx', ['tsx', tool], { encoding: 'utf8', cwd: process.cwd(), shell: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    fails: out.match(/^\s*FAIL\s+.*$/gm) ?? [],
    passes: out.match(/^\s*PASS\s+/gm) ?? [],
    full: out,
  };
};

let allBite = true;
let allInjected = true;

console.log('\nBASELINE');
{
  const r = runSuite();
  const clean = r.fails.length === 0 && r.passes.length > 0;
  if (!clean) allBite = false;
  console.log(`  ${r.passes.length === 0 ? '*** THE SUITE DID NOT RUN ***' : clean ? 'clean' : 'UNEXPECTED FAILURES'}`
    + ` -- ${r.fails.length} failing`);
  if (r.passes.length === 0) {
    console.log('\nAborting: a harness that cannot run the suite cannot prove anything.');
    process.exit(1);
  }
}

for (const injection of injections) {
  // Backup BEFORE the edit. Taking it after is how a restore became the thing that caused the damage
  // earlier in this project.
  const original = readFileSync(TARGET, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = injection.from.replace(/\n/g, eol);
  const to = injection.to.replace(/\n/g, eol);

  console.log(`\n${injection.name}`);
  console.log(`  must break: check ${injection.mustBreak}`);

  if (!original.includes(from)) {
    console.log('  COULD NOT INJECT -- the anchor text has moved.');
    console.log('    an injection that cannot be applied is an assertion nobody made');
    allInjected = false;
    allBite = false;
    continue;
  }

  writeFileSync(TARGET, original.replace(from, to));
  try {
    const r = runSuiteFor(injection.tool ?? TOOL);
    const targeted = r.fails.some((f) => f.includes(injection.mustBreak));
    const ranNothing = r.passes.length === 0 && r.fails.length === 0;

    if (injection.expectSurvivor) {
      // An expected survivor is not a pass and not a failure. It is a documented absence of coverage,
      // and the run is only clean if reality matched the note above it.
      const asDocumented = !targeted && !ranNothing;
      if (!asDocumented) allBite = false;
      console.log(`  ${asDocumented
        ? 'SURVIVES, AS DOCUMENTED -- no test in the project can reach this guard'
        : '*** BEHAVIOUR CHANGED: this now bites, so the note above is out of date ***'}`);
      continue;
    }

    if (!targeted || ranNothing) allBite = false;
    console.log(`  ${ranNothing
      ? '*** THE SUITE DID NOT RUN, SO NOTHING WAS MEASURED ***'
      : (targeted ? 'BITES' : '*** DID NOT BITE ***')} -- ${r.fails.length} check(s) failed`
      + `${injection.tool ? ` (in ${injection.tool})` : ''}`);
    r.fails.slice(0, 3).forEach((f) => console.log(`    ${f.trim().slice(0, 130)}`));
  } finally {
    writeFileSync(TARGET, original);
  }
}

console.log('\nRESTORED');
{
  const r = runSuite();
  const clean = r.fails.length === 0 && r.passes.length > 0;
  if (!clean) allBite = false;
  console.log(`  ${clean ? 'clean again' : '*** STILL BROKEN ***'} -- ${r.fails.length} failing`);
}

if (!allInjected) console.log('\nAT LEAST ONE INJECTION COULD NOT BE APPLIED.\n');
else if (allBite) console.log(`\nALL ${injections.length} INJECTED BUGS WERE CAUGHT. The guard holds.\n`);
else console.log('\nAT LEAST ONE INJECTED BUG SURVIVED. The guard is not trustworthy.\n');
process.exit(allBite && allInjected ? 0 : 1);
