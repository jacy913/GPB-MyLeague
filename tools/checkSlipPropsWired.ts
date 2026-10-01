/**
 * Does the betting slip actually receive what it needs?
 *
 * A regression guard for a shipped freeze, not a style check.
 *
 * WHAT HAPPENED. `BettingSlip` was changed to take `games` and `teams` so it could
 * resolve a bet to the fixture it belongs to. That edit landed. The matching edit at
 * the call site in App.tsx did NOT: a PowerShell `.Replace()` whose newline-escaped
 * search string did not match the file, which reports nothing and writes the file back
 * unchanged. `BettingSlip` is mounted in the shell, OUTSIDE any view, so its props were
 * `undefined` on every route -- and `new Map(teams.map(...))` threw on the first render,
 * which unmounts the whole React tree. The symptom was a blank dark-blue page on every
 * screen after a refresh.
 *
 * WHY A TYPECHECK SHOULD HAVE CAUGHT IT, and did not get the chance to.
 *
 * Missing required JSX props IS a TypeScript error, so `tsc` would have caught it had
 * the props actually been required at the moment the call site was checked. They were.
 * That tsc run reported the usual 10 pre-existing diagnostics and I read that as green,
 * because I had also been diffing App.tsx and the diff looked right -- I was reading the
 * diff of a different file.
 *
 * This tool exists because the class of bug is invisible to review-by-reading: the
 * component and its call site are 3,000 lines apart in different files, the failure is a
 * runtime throw, and the only signal is "the app does not start".
 *
 * THE CHECK: every prop `BettingSlip` declares as REQUIRED must appear at its call site
 * in App.tsx. This is deliberately a source-level check rather than a render, because the
 * failure is a throw before anything paints and a renderer would need a browser to
 * observe it -- which is exactly the tool that was unavailable when the bug shipped.
 *
 * Run: npx tsx tools/checkSlipPropsWired.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// ES modules have no `__dirname`. Resolved from this file's own URL rather than from
// `process.cwd()`, so the tool reads the same files regardless of where it is invoked
// from -- a check that only works when run in one directory is a check that will be
// skipped in the one place it was needed.
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..', 'src', 'App.tsx');
const SLIP = resolve(HERE, '..', 'src', 'components', 'betting', 'BettingSlip.tsx');

/** Props that have a type but no `?` -- i.e. the caller MUST supply them. */
const requiredProps = (source: string): string[] => {
  const open = source.indexOf('export const BettingSlip: React.FC<{');
  if (open < 0) throw new Error('BettingSlip props block not found -- has the component been restructured?');
  const start = source.indexOf('{', open);
  // Walk to the matching close brace, so a nested type object cannot end it early.
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('could not find the end of the BettingSlip props block');

  const body = source.slice(start, end);
  const props: string[] = [];
  const re = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/gm;
  let match = re.exec(body);
  while (match !== null) {
    if (!body.slice(match.index).startsWith('  ' + match[1] + '?') && !/^\s{2}[A-Za-z_][A-Za-z0-9_]*\s*\?:/.test(match[0])) {
      props.push(match[1]);
    }
    match = re.exec(body);
  }
  return props;
};

const main = (): void => {
  const appSource = readFileSync(APP, 'utf8');
  const slipSource = readFileSync(SLIP, 'utf8');

  const required = requiredProps(slipSource);
  const callStart = appSource.indexOf('<BettingSlip');
  if (callStart < 0) {
    console.log('\nFAIL  BettingSlip is not rendered from App.tsx.');
    console.log('      If it moved, point this tool at the new call site rather than deleting it.\n');
    process.exitCode = 1;
    return;
  }
  const callEnd = appSource.indexOf('/>', callStart);
  const callSite = appSource.slice(callStart, callEnd);

  const missing = required.filter((prop) => !new RegExp(`\\b${prop}=`).test(callSite));

  console.log(`\nSLIP PROPS WIRING -- BettingSlip requires ${required.length} props\n`);
  required.forEach((prop) => {
    const wired = !missing.includes(prop);
    console.log(`  ${wired ? 'PASS' : 'FAIL'}  ${prop}`);
  });

  if (missing.length === 0) {
    console.log(`\n  ${required.length}/${required.length} required props are supplied at the call site.`);
    console.log('  BettingSlip renders unconditionally in the shell, so a missing prop here is a');
    console.log('  throw on every route, not just on the betting screen.\n');
    return;
  }

  console.log(`\n  MISSING: ${missing.join(', ')}`);
  console.log('  BettingSlip renders unconditionally in the shell. An unsupplied prop reaches');
  console.log('  `teams.map` on the first render and unmounts the entire React tree, which is a');
  console.log('  blank page on every screen. This is the freeze, not a warning.\n');
  process.exitCode = 1;
};

main();