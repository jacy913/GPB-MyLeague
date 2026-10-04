/**
 * Does the exploit-closed suite actually FAIL when the exploit comes back?
 *
 * ============================================================================
 * WHY THIS FILE EXISTS AT ALL
 * ============================================================================
 *
 * A green suite proves nothing on its own. `verifyLockedRaces.ts` could be asserting the right
 * things beautifully while measuring nothing -- a regex that silently stopped matching, a fixture
 * that stopped discriminating, a variable that became `undefined` and compared equal to itself. The
 * only way to tell a guard from a decoration is to break the thing it guards and watch it catch it.
 *
 * So this re-injects each bug that was fixed, one at a time, and requires the suite to notice.
 *
 * ============================================================================
 * THREE WAYS THIS HARNESS LIED TO ITSELF, AND WHAT WAS DONE ABOUT IT
 * ============================================================================
 *
 * These are recorded because each one produced a clean, confident, completely wrong result, and each
 * is a way a test harness can report success while measuring nothing.
 *
 *   1. `spawnSync` could not resolve the `npx` shim on Windows without `shell: true`. It returned
 *      empty stdout and a null error, so all six injections reported "0 failures" -- which the
 *      harness was about to print as "DID NOT BITE", i.e. as a real finding. It was an absence of
 *      output being read as an absence of bugs. `shell: true` fixes it, and `ranNothing` now makes
 *      an empty run an explicit error rather than a silent zero.
 *
 *   2. Injection anchors were written with `\n` while three of the target files are CRLF, so the
 *      text never matched and nothing was injected. A failed injection and a missed bug look the
 *      same from outside. Anchors are now re-stamped to each file's own line ending before use.
 *
 *   3. Two anchors were simply wrong about the code -- one had 24 spaces of indentation where the
 *      file has 22, and one named a `division:${team.league} ${team.division}` key that the function
 *      actually builds as `division:${divisionId}` from a local. Both had to be read out of the real
 *      source. That is the honest cost of injecting by text match, and it is why the "COULD NOT
 *      INJECT" branch is treated as a FAILURE of this harness rather than a skipped test: an
 *      injection that cannot be applied is an assertion nobody made.
 *
 * Run: node tools/proveLockedRacesGuard.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const runSuite = () => {
  const r = spawnSync('npx', ['tsx', 'tools/verifyLockedRaces.ts'], {
    encoding: 'utf8',
    cwd: process.cwd(),
    shell: true, // see the header: without this, Windows returns empty stdout and null error
  });
  const out = `${r.stdout ?? ''}`;
  const fails = out.match(/^\s+FAIL\s+.*$/gm) ?? [];
  const passes = out.match(/^\s+PASS\s+/gm) ?? [];
  return {
    failed: fails.length,
    fails,
    // An empty run is an error, not a pass. This is the check that stops lesson 1 from recurring.
    ranNothing: passes.length === 0 && fails.length === 0,
    status: r.status,
    stderr: `${r.stderr ?? ''}`.trim().split('\n').slice(0, 2).join(' / '),
  };
};

const injections = [
  {
    name: 'BOTH slip guards are disabled -- the sale goes through again',
    file: 'src/hooks/useBettingSlip.ts',
    swaps: [
      ['if (slip.locked) {', 'if (false && slip.locked) {'],
      ['if (entry.locked) {', 'if (false && entry.locked) {'],
    ],
  },
  {
    name: 'the futures card stops passing the closure on its house button',
    file: 'src/components/betting/BettingHub.tsx',
    // 22 spaces of indentation, which is what the file has. The first attempt used 24 and silently
    // injected nothing.
    swaps: [[
      '                      price: outcome.houseOdds,\n                      resolvesOn,\n                      locked: market.locked,',
      '                      price: outcome.houseOdds,\n                      resolvesOn,',
    ]],
  },
  {
    name: 'the futures card stops passing the closure on its FADE button',
    file: 'src/components/betting/BettingHub.tsx',
    swaps: [[
      '                        locked: market.locked,\n                        lockedWinnerName: lockedWinnerLabel,\n                        backedMedia: outcome.outlier,',
      '                        lockedWinnerName: lockedWinnerLabel,\n                        backedMedia: outcome.outlier,',
    ]],
  },
  {
    name: 'the award race stops closing when the season is archived',
    file: 'src/lib/mediaMarkets.ts',
    swaps: [[
      "...(decided\n      ? { locked: { winnerKey: entries[0]?.playerId ?? '', reason: 'voting_open' as const } }\n      : {}),",
      "...(false ? { locked: { winnerKey: entries[0]?.playerId ?? '', reason: 'voting_open' as const } } : {}),",
    ]],
  },
  {
    name: 'the season archives nothing -- the old lazy path',
    file: 'src/hooks/useSeasonLifecycle.ts',
    swaps: [[
      'setSeasonAwardsSeen(false);\n        archiveSeasonAwards(selection);',
      'setSeasonAwardsSeen(false);',
    ]],
  },
  {
    name: 'a hand-picked MVP is written straight into the archive',
    file: 'src/hooks/useSeasonLifecycle.ts',
    swaps: [[
      'battingMvp: pickWinner(selection.battingCandidates),',
      "battingMvp: { playerId: 'p-honest', playerName: 'Someone', summary: 'picked', teamCity: 'X', teamName: 'Y', seasonYear: selection.seasonYear },",
    ]],
  },
  {
    name: 'a decided division is never locked -- the ORIGINAL bug',
    file: 'src/lib/futuresRisk.ts',
    // Injected at the DECISION, not at the write. The first attempt put a `continue` above
    // `locked.set`, which is not inside a loop, so the module failed to compile and the suite
    // never ran. The harness did report "DID NOT MEASURE" rather than a false pass, which is the
    // behaviour that guard was added for -- but a non-compiling injection measures nothing at all,
    // so the anchor had to be fixed rather than the report.
    swaps: [[
      'if (leader.wins > bestRivalCeiling) {',
      'if (leader.wins > leader.wins) { // INJECTED: a decided division is never locked',
    ]],
  },
  {
    name: 'a TIE closes a division, freezing a live race shut',
    file: 'src/lib/futuresRisk.ts',
    // The other half of the same line, and the boundary the suite exists to hold: `>=` treats a
    // tiebreaker-decided race as decided. That contradicts `titleContenders` and shuts a market
    // that is still genuinely open -- the worse of the two error directions.
    swaps: [[
      'if (leader.wins > bestRivalCeiling) {',
      'if (leader.wins >= bestRivalCeiling) { // INJECTED: a tie counts as decided',
    ]],
  },
  {
    name: 'the league stops closing on a won series',
    file: 'src/lib/futuresRisk.ts',
    swaps: [[
      'locked.set(`league:${series.league}`',
      "if (series.league !== '') continue; // INJECTED: a won series never closes a league\n    locked.set(`league:${series.league}`",
    ]],
  },
];

let allBite = true;
let allInjected = true;

console.log('\nBASELINE');
{
  const r = runSuite();
  const clean = r.failed === 0 && !r.ranNothing;
  if (!clean) allBite = false;
  console.log(`  ${r.ranNothing
    ? '*** THE SUITE DID NOT RUN ***'
    : clean ? 'clean' : 'UNEXPECTED FAILURES'} -- ${r.failed} failing, status ${r.status} ${r.stderr}`);
  if (r.ranNothing) {
    console.log('\nAborting: a harness that cannot run the suite cannot prove anything.');
    process.exit(1);
  }
}

for (const injection of injections) {
  const original = readFileSync(injection.file, 'utf8');
  // Re-stamp the anchors to this file's own line ending. Three of the first six injections silently
  // did nothing on the first run for exactly this reason.
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original;
  let ok = true;
  for (const [from, to] of injection.swaps) {
    const F = from.replace(/\n/g, eol);
    if (!text.includes(F)) { ok = false; break; }
    text = text.replace(F, to.replace(/\n/g, eol));
  }

  console.log(`\n${injection.name}`);
  if (!ok) {
    // Treated as a harness FAILURE, not a skipped test. An injection that cannot be applied is an
    // assertion nobody made, and reporting it as anything softer is how a rot guard stays green.
    console.log('  COULD NOT INJECT -- the anchor text has moved.');
    allInjected = false;
    allBite = false;
  } else {
    writeFileSync(injection.file, text);
    try {
      const r = runSuite();
      const bites = r.failed > 0 && !r.ranNothing;
      if (!bites) allBite = false;
      console.log(`  ${r.ranNothing
        ? '*** THE SUITE DID NOT RUN, SO NOTHING WAS MEASURED ***'
        : bites ? 'BITES' : '*** DID NOT BITE ***'} -- ${r.failed} check(s) failed`);
      for (const f of r.fails.slice(0, 4)) console.log(`    ${f.trim().slice(0, 130)}`);
      if (r.fails.length > 4) console.log(`    ...and ${r.fails.length - 4} more`);
    } finally {
      // Restored in a `finally`, so a crash mid-measurement cannot leave a bug in the working tree.
      writeFileSync(injection.file, original);
    }
  }
}

console.log('\nRESTORED');
{
  const r = runSuite();
  const clean = r.failed === 0 && !r.ranNothing;
  if (!clean) allBite = false;
  console.log(`  ${clean ? 'clean again' : '*** STILL BROKEN ***'} -- ${r.failed} failing`);
}

if (!allInjected) {
  console.log('\nAT LEAST ONE INJECTION COULD NOT BE APPLIED. Fix the anchors before trusting this.\n');
} else if (allBite) {
  console.log(`\nALL ${injections.length} INJECTED BUGS WERE CAUGHT. The guard holds.\n`);
} else {
  console.log('\nAT LEAST ONE INJECTED BUG SURVIVED. The guard is not trustworthy.\n');
}
process.exit(allBite && allInjected ? 0 : 1);
