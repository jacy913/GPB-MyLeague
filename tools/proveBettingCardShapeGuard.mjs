/**
 * Do checkBettingCardShape.ts's four RESTATED checks actually fail when the thing they protect is broken?
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 *
 * Checks 15, 16 and 17 were failing, and the fix was to restate them to their intent rather than to
 * the exact class strings and phrase they happened to quote. Checks 21-23 were replaced by one
 * negative assertion.
 *
 * That is the most dangerous kind of test change there is. A stale check fails loudly and costs an
 * afternoon. A restated check can pass without ever measuring anything, and the failure mode is
 * invisible: green output, a test file that looks busy, and a regression that walks straight through.
 *
 * I have been wrong about exactly this three times in two days. A venue tally read 2-2 and eliminated
 * nobody. An award closure tested `size > 0` on a map that is EMPTY when the season is finished. An
 * eight-cap assertion passed against broken code because the fixture had four players.
 *
 * So: each check is broken on purpose, in the real source, and required to be noticed.
 *
 * ============================================================================
 * THE FIFTH INJECTION IS THE ONE THAT MATTERS MOST
 * ============================================================================
 *
 * `sliceOf` returned '' for a missing start marker and ran to end-of-file for a missing end marker --
 * both silently. `propsView`'s end marker did not exist, so that slice was 46KB instead of 6KB and
 * three checks were reading the whole rest of the file. A blob that big contains most strings, so the
 * checks did not merely fail for the wrong reason; they could have PASSED for the wrong reason.
 *
 * A slicing helper that cannot fail is the same species as a guard that cannot bite, so breaking a
 * marker has to be a hard error rather than a differently-shaped pass.
 *
 * Run: node tools/proveBettingCardShapeGuard.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TARGET = 'src/components/betting/BettingHub.tsx';
const TOOL = 'tools/checkBettingCardShape.ts';

const runSuite = () => {
  // `shell: true` because without it spawnSync cannot resolve the npx shim on Windows and returns
  // empty stdout with a null error -- which reads as "0 failures" for every injection. That mistake
  // was made once already in this session; see proveLockedRacesGuard.mjs.
  const r = spawnSync('npx', ['tsx', TOOL], { encoding: 'utf8', cwd: process.cwd(), shell: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const fails = out.match(/^\s*FAIL\s+.*$/gm) ?? [];
  const passes = out.match(/^\s*PASS\s+/gm) ?? [];
  return {
    failed: fails.length,
    fails: fails.map((f) => f.trim()),
    ranNothing: passes.length === 0 && fails.length === 0,
    head: out.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3).join(' | ').slice(0, 260),
    // `head` truncated the throw away. When `sliceOf` throws there are no PASS or FAIL lines at all,
    // so the first three lines are the npx banner and the actual message never made it into the
    // window the check was looking in -- and a harness guard reported "DID NOT THROW" for a guard that
    // did throw. Carried whole, so a thrown error can be found wherever in the output it lands.
    full: out,
  };
};

/** One named check, addressed by its label, so an injection can be required to fail THAT one. */
const labelled = (label) => ({ label });

const injections = [
  {
    ...labelled('the side buttons are full-width columns, not chips'),
    name: 'CHECK 15 REINJECTED: the side button becomes a chip sized to its text',
    swaps: [['className="w-full flex-col gap-2.5 py-4', 'className="w-fit flex-col gap-2.5 py-4']],
  },
  {
    ...labelled('the side buttons are full-width columns, not chips'),
    name: 'CHECK 15 REINJECTED: the button stops filling its half of the tile',
    swaps: [['className="w-full flex-col gap-2.5 py-4', 'className="justify-self-center flex-col gap-2.5 py-4']],
  },
  {
    ...labelled('the footer outlet marks are demoted to h-4'),
    name: 'CHECK 16 REINJECTED: an outlet mark grows past h-4',
    swaps: [['className="h-3 w-3', 'className="h-6 w-6 object-contain"']],
  },
  {
    ...labelled('the footer outlet marks are demoted to h-4'),
    name: 'CHECK 16 REINJECTED: the outlet count stops coming from the registry',
    swaps: [['All ${MEDIA_PROFILES.length} forecasters', 'All three forecasters']],
  },
  {
    ...labelled('the footer says which side the outlet prices are for'),
    name: 'CHECK 17 REINJECTED: the card stops naming the visiting club at all',
    // Scoped AND every-copy. `game.awayTeam.city` occurs nine times in BettingHub.tsx, and inside the
    // card it occurs twice: once in the visible footer and once in the tooltip. An unscoped replace
    // took the first occurrence in some earlier component; a scoped single replace took the tooltip
    // one. Either way the visible footer was untouched and the check passed against a card that had
    // been broken -- the false negative this harness exists to rule out. Found by running it.
    scope: 'const GameBetCard',
    all: true,
    swaps: [['{game.awayTeam.city}', '{`Away`}']],
  },
  {
    ...labelled('the footer says which side the outlet prices are for'),
    name: 'CHECK 17 REINJECTED: the card stops saying the forecasters disagree',
    scope: 'const GameBetCard',
    all: true,
    // BOTH statements have to go. The visible footer says "differ by N points" and the tooltip says
    // "disagree by N points", so removing only one leaves the other -- and the assertion, correctly,
    // still passes: the card is still telling the reader they disagree. Removing the phrase from the
    // interpolation alone was the first attempt and it changed nothing the check could see, because
    // "differ by" is static JSX text, not part of the expression.
    swaps: [
      ['differ by {Math.round(game.disagreement * 100)} points', 'nothing to report'],
      [' disagree by ${Math.round(game.disagreement * 100)} points.', ' nothing to report.'],
    ],
  },
  {
    ...labelled('the per-outlet panel fan-out does not come back'),
    name: 'CHECK 21 REINJECTED: the three outlet panels come back',
    file: TARGET,
    swaps: [[
      'rows.map((row) => (',
      'rows.map((row) => (\n      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">\n      <div className="flex flex-col gap-2 p-3">',
    ]],
  },
];

// The sliceOf guard is a different shape: it must THROW, not fail a check.
const sliceInjections = [
  {
    name: 'sliceOf REINJECTED: a start marker that does not exist',
    file: TOOL,
    swaps: [["'const GameBetCard'", "'const GameBetCardX'"]],
    expectThrow: true,
  },
  {
    name: 'sliceOf REINJECTED: an end marker that does not exist, the 46KB slice',
    file: TOOL,
    swaps: [["'const FieldMarketCard');", "'const propRowKey');"]],
    expectThrow: true,
  },
];

let allBite = true;
let allInjected = true;

console.log('\nBASELINE');
{
  const r = runSuite();
  const clean = r.failed === 0 && !r.ranNothing;
  if (!clean) allBite = false;
  console.log(`  ${r.ranNothing ? '*** THE SUITE DID NOT RUN ***' : clean ? 'clean' : 'UNEXPECTED FAILURES'} -- ${r.failed} failing`);
  if (r.ranNothing) {
    console.log('\nAborting: a harness that cannot run the suite cannot prove anything.');
    process.exit(1);
  }
}

const runInjection = (injection) => {
  const file = injection.file ?? TARGET;
  // The good copy is taken BEFORE anything is written. Taking it after is how the tie-break edit
  // broke the working tree earlier in this session -- the "backup" contained the injected version.
  const original = readFileSync(file, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  let text = original;

  console.log(`\n${injection.name}`);
  console.log(injection.label
    ? `  must break: check ${injection.label}`
    : '  must break: the tool must refuse to run at all');

  // An anchor that occurs more than once must be replaced INSIDE the region under test, not at its
  // first occurrence anywhere in the file. Replacing the first of nine copies of a string is how an
  // injection "succeeds", changes nothing that is asserted, and is then read as the guard holding.
  const scopeAt = injection.scope ? text.indexOf(injection.scope) : 0;
  if (injection.scope && scopeAt < 0) {
    console.log('  COULD NOT INJECT -- the scope marker has moved.');
    console.log('    an injection that cannot be applied is an assertion nobody made');
    allInjected = false;
    allBite = false;
    return;
  }

  for (const [from, to] of injection.swaps) {
    const F = from.replace(/\n/g, eol);
    const T = to.replace(/\n/g, eol);
    const scoped = text.slice(scopeAt);
    if (!scoped.includes(F)) {
      console.log('  COULD NOT INJECT -- the anchor text has moved.');
      console.log('    an injection that cannot be applied is an assertion nobody made');
      allInjected = false;
      allBite = false;
      return;
    }
    // `all: true` replaces every copy inside the region. Necessary when the check is about a
    // property of the whole card, because an anchor that occurs more than once -- and here the ones
    // that matter occur in both the visible footer and its tooltip -- otherwise edits the first copy,
    // leaves the other, and the check passes against a card that is still wrong.
    const patched = injection.all ? scoped.replaceAll(F, T) : scoped.replace(F, T);
    text = text.slice(0, scopeAt) + patched;
  }

  writeFileSync(file, text);
  try {
    const r = runSuite();
    // A throw leaves no PASS and no FAIL line, so `ranNothing` is the signal -- and the message has to
    // be read from the whole output rather than the first three lines, which are the npx banner.
    const threw = /sliceOf:/.test(r.full);
    const targeted = r.fails.some((f) => f.includes(injection.label));
    const ok = injection.expectThrow ? threw : (targeted && !r.ranNothing);

    if (!ok) allBite = false;
    console.log(`  ${injection.expectThrow
      ? (threw ? 'THROWS' : '*** DID NOT THROW ***')
      : (r.ranNothing
        ? '*** THE SUITE DID NOT RUN, SO NOTHING WAS MEASURED ***'
        : (targeted ? 'BITES' : '*** DID NOT BITE ***'))}`);
    if (injection.expectThrow) {
      const line = (r.full.split(/\r?\n/).find((l) => l.includes('sliceOf:')) ?? '(no sliceOf error found)').trim();
      console.log(`    ${line.slice(0, 150)}`);
    } else {
      console.log(`    ${r.failed} check(s) failed in total`);
      r.fails.slice(0, 3).forEach((f) => console.log(`      ${f.slice(0, 110)}`));
    }
  } finally {
    writeFileSync(file, original);
  }
};

injections.forEach(runInjection);
sliceInjections.forEach(runInjection);

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
  console.log(`\nALL ${injections.length + sliceInjections.length} INJECTED BUGS WERE CAUGHT. The guard holds.\n`);
} else {
  console.log('\nAT LEAST ONE INJECTED BUG SURVIVED. The guard is not trustworthy.\n');
}
process.exit(allBite && allInjected ? 0 : 1);
