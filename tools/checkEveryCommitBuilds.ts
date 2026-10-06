/**
 * Does every commit on this branch build on its own?
 *
 * WHY THIS EXISTS, and it is not hypothetical. Two commits in the park work shipped a consumer of
 * `ParkProfile.parkCity` while leaving the module that declares it in a LATER commit. `tsc` at the
 * tip was clean, `vite build` was clean, every one of the 41 check tools passed, and both browser
 * sweeps were clean -- all of them run against the tip. The broken intermediate commits would have
 * shipped, and anyone bisecting to find out which of the three changes broke something would have
 * hit a commit that never compiled.
 *
 * The failure is invisible at the tip by construction, so the check has to move the tip. That makes
 * it slow (a full tsc and build per commit) and it makes it destructive, which is why it restores
 * the original branch in a `finally` rather than trusting the happy path.
 *
 * WHAT IT DOES NOT DO: it does not run the check tools or the browser sweeps per commit, because
 * that is minutes per commit and none of the changes under test are data-only. A commit that
 * changes only `parks.json` can still break a check tool while compiling perfectly, so this is a
 * necessary condition and not a sufficient one.
 *
 * Run: npx tsx tools/checkEveryCommitBuilds.ts [count]
 */

import { execFileSync } from 'node:child_process';

const COUNT = Number(process.argv[2] ?? 6);

/**
 * TWO RUNNERS, because one flag cannot serve both commands, and getting this wrong is why the
 * first two versions of this tool reported every commit as broken.
 *
 * `execFileSync('npx', ...)` returns `status: null` with zero bytes of output on every call here --
 * the process is never really launched. Because that produces no output, a build that "failed" and
 * a build that never ran are indistinguishable, so the check confidently reported FAIL against
 * five commits verified minutes earlier. `npx` therefore needs `shell: true`.
 *
 * But `shell: true` runs git's arguments through cmd.exe, which mangles `--format=%h %s` into a
 * usage error -- so git needs `shell: false` and its own runner. One flag for both was wrong twice
 * in two directions, which is why this is spelled out rather than tidied into a single helper.
 */
const capture = (
  cmd: string,
  args: string[],
  shell: boolean,
): { out: string; spawned: boolean } => {
  try {
    return {
      out: execFileSync(cmd, args, { encoding: 'utf8', shell, stdio: ['ignore', 'pipe', 'pipe'] }),
      spawned: true,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number | null };
    return {
      out: `${e.stdout ?? ''}${e.stderr ?? ''}`,
      // `status === null` means no exit code at all: killed, or never launched. Not a build failure.
      spawned: e.status !== null && e.status !== undefined,
    };
  }
};

const gitRun = (args: string[]) => capture('git', args, false);
const npxRun = (args: string[]) => capture('npx', args, true);

type Verdict = 'ok' | 'broken' | 'unknown';

/**
 * `npx vite build` exits 1 on SUCCESS, so the exit code is useless and the output is the signal.
 *
 * Three states rather than two, which is the whole point of the rewrite. The first version reported
 * a boolean and turned a spawn failure into "does not build" -- and duly reported FAIL against four
 * commits that had been verified minutes earlier. A check that reports a confident wrong answer is
 * worse than no check, so `unknown` is carried all the way through to the summary.
 */
const compiles = (): { tsc: Verdict; build: Verdict } => {
  const tscRun = npxRun(['tsc', '--noEmit']);
  const buildRun = npxRun(['vite', 'build']);

  // TSC IS SILENT ON SUCCESS, so empty output is the PASS, not an absence of evidence. An earlier
  // version of this treated empty as "could not tell" and reported every commit as undetermined,
  // which is the same mistake as reporting them broken -- just in the other direction, and equally
  // useless. Only a genuine failure to launch is `unknown`.
  const tsc: Verdict = !tscRun.spawned ? 'unknown'
    : (/error TS\d+/.test(tscRun.out) ? 'broken' : 'ok');

  // VITE ALWAYS PRINTS "built in Xs", including when it exits non-zero, so the exit code is
  // useless here and the output is the only signal. Empty output means it never ran.
  const build: Verdict = !buildRun.spawned || buildRun.out.trim() === '' ? 'unknown'
    : (/built in/.test(buildRun.out) ? 'ok' : 'broken');
  return { tsc, build };
};

const branch = gitRun(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
const head = gitRun(['rev-parse', 'HEAD']).out.trim();
const log = gitRun(['log', '--format=%h %s', `-${COUNT}`]).out.trim().split('\n').filter(Boolean);

if (branch === 'HEAD') {
  console.error('\n  detached HEAD: nothing to restore afterwards, refusing to rewrite anything.\n');
  process.exit(1);
}
if (log.length === 0) {
  console.error('\n  no commits found.\n');
  process.exit(1);
}

/*
  REFUSE TO RUN ON A DIRTY TREE, BEFORE ANY CHECKOUT HAPPENS.

  This block used to walk the history with `git checkout` and finish with `git reset --hard` on the
  original commit. Correct for a tool whose job is to walk history on a clean tree; CATASTROPHIC on
  a dirty one, because returning to the original branch restores every TRACKED file to its committed
  state. It did exactly that twice on this machine, silently, after printing a cheerful
  "restored to local @ <hash>". The second time it destroyed several hours of work that existed in no
  commit and no stash -- and the check tool that had verified that work kept passing, because it had
  no way to know its subject had been deleted.

  The guard is HERE, before the loop, not in the `finally`: a check that runs after the checkouts has
  already missed the only moment it could have helped.
*/
const dirty = gitRun(['status', '--porcelain']).out.trim();
if (dirty) {
  const paths = dirty.split('\n');
  console.log('\n  REFUSING TO RUN: the working tree has uncommitted changes.\n');
  console.log('  This tool checks out every commit in turn. Returning to the original branch restores');
  console.log('  every TRACKED file to its committed state, so anything edited but not committed is');
  console.log('  lost. It has already done that twice on this machine, silently, after printing a');
  console.log('  successful-looking restore message.\n');
  paths.slice(0, 12).forEach((l) => console.log(`    ${l}`));
  if (paths.length > 12) console.log(`    ... and ${paths.length - 12} more`);
  console.log(`\n  ${paths.length} changed path(s). Commit or stash, then re-run.\n`);
  process.exit(2);
}

console.log(`\nDOES EVERY COMMIT BUILD? (${log.length} back from ${branch})\n`);
const failures: string[] = [];
const unknown: string[] = [];

try {
  for (const line of log) {
    const hash = line.split(' ')[0];
    const subject = line.slice(line.indexOf(' ') + 1).slice(0, 52);
    gitRun(['checkout', '-q', hash]);
    const { tsc, build } = compiles();
    const broken = tsc === 'broken' || build === 'broken';
    const unsure = !broken && (tsc === 'unknown' || build === 'unknown');
    if (broken) failures.push(`${hash} ${subject}`);
    if (unsure) unknown.push(`${hash} (tsc:${tsc} build:${build})`);
    const mark = broken ? 'FAIL' : unsure ? '????' : 'ok  ';
    console.log(`  ${mark} ${hash}  tsc:${tsc}  build:${build}  ${subject}`);
  }
} finally {
  /*
    Return to the branch. Deliberately NOT `reset --hard`.

    `git checkout` back to the original branch already restores every tracked file, because each
    intermediate commit left the worktree at that commit. The hard reset's only remaining effect
    would be to delete anything the checkout left alone -- which is precisely how this tool destroyed
    two rounds of uncommitted work while printing a successful-looking restore line.
  */
  gitRun(['checkout', '-q', branch]);
  console.log(`\n  returned to ${branch} @ ${gitRun(['rev-parse', '--short', 'HEAD']).out.trim()}`);
}

if (unknown.length > 0) {
  console.log(`\n  ${unknown.length} commit(s) COULD NOT BE DETERMINED -- not a pass, not a failure:`);
  unknown.forEach((u) => console.log(`    ${u}`));
  console.log('  (usually several `npx` builds contending for the toolchain; re-run them alone)');
}
if (failures.length > 0) {
  console.log(`\n  ${failures.length} COMMIT(S) DO NOT BUILD:\n`);
  failures.forEach((f) => console.log(`    ${f}`));
  process.exit(1);
}
if (unknown.length === 0) {
  console.log(`\n  every commit in the last ${log.length} compiles.\n`);
}