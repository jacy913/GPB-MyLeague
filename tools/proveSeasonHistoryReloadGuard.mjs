/**
 * Does anything catch the season-history writer erasing the archive on reload?
 *
 * ============================================================================
 * WHY THIS IS A `prove` TOOL AND NOT A CHECK
 * ============================================================================
 *
 * App.tsx had three localStorage writers that were not gated on the matching reads. On mount the
 * reads queue a state update while the writers persist the value belonging to the render that just
 * committed -- the initial empty value -- so the empty value lands in localStorage while the real
 * contents sit unused in a local variable. In a production build that self-corrects on the re-render.
 * Under StrictMode it does not: the effects re-run immediately and the read RE-READS what the first
 * pass just overwrote.
 *
 * Measured, three seasons seeded then reloaded:
 *
 *     StrictMode on, ungated    [2023,2024,2025] -> []                 n=3 -> n=0
 *     StrictMode off, ungated    [2023,2024,2025] -> [2025,2024,2023] n=3 -> n=3
 *     StrictMode on,  gated      [2023,2024,2025] -> [2025,2024,2023] n=3 -> n=3
 *
 * Three archived seasons reduced to none on every reload. A manager sees that as "it only remembers
 * the last season", which is the report this answers.
 *
 * A check that seeds and reloads and finds the seasons intact is worth almost nothing on its own,
 * because it passes for the correct code AND for the broken code if it asserts the wrong thing. So
 * the gate is REMOVED -- the real regression, in the real file, as it shipped -- and the measurement
 * is required to notice.
 *
 * Only two of the three writers are required to bite. The offseason workflow key is injected and
 * applied for real but never decides the verdict, because the app repairs that key on a fresh
 * profile for reasons of its own -- see the note on the key below, which is the more useful output
 * of this whole exercise than the pass or fail.
 *
 * Requires the dev server. Vite serves the edited App.tsx, and this tool reloads rather than relying
 * on HMR, so the injected build is what actually mounts.
 *
 * Run:  npm run dev            (in another shell)
 *       node tools/proveSeasonHistoryReloadGuard.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const TARGET = 'src/App.tsx';
const url = process.argv[2] ?? 'http://localhost:3000/';

// Same absolute path tools/cdp.mjs and verifyStorageBudgetBrowser.mjs use. Bare 'chrome' does not
// resolve from this shell, and a missing browser is indistinguishable from a passing guard.
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

/** The three keys the gate protects, and a value for each that a clobber cannot fake. */
const KEYS = {
  gpb_season_history_v1: {
    label: 'season history',
    // Three seasons. One is not a test: a single entry is indistinguishable from "kept the latest",
    // which is exactly the bug's symptom.
    seed: JSON.stringify([
      { seasonYear: 2023, completedAt: 'x', champion: { teamId: 'a', teamCity: 'A', teamName: 'A' }, leagueWinners: [], divisionWinners: [], battingMvp: null, pitchingMvp: null, worldSeriesMvp: null },
      { seasonYear: 2024, completedAt: 'x', champion: { teamId: 'b', teamCity: 'B', teamName: 'B' }, leagueWinners: [], divisionWinners: [], battingMvp: null, pitchingMvp: null, worldSeriesMvp: null },
      { seasonYear: 2025, completedAt: 'x', champion: { teamId: 'c', teamCity: 'C', teamName: 'C' }, leagueWinners: [], divisionWinners: [], battingMvp: null, pitchingMvp: null, worldSeriesMvp: null },
    ]),
    intact: (raw) => {
      const a = JSON.parse(raw);
      return Array.isArray(a) && a.length === 3 && a.map((e) => e.seasonYear).sort().join(',') === '2023,2024,2025';
    },
    assert: true,
  },
  gpb_draft_center_v1: {
    label: 'draft center',
    seed: JSON.stringify({ activeClass: { year: 2026, round: 1, teamId: 'z' }, history: [{ year: 2023 }, { year: 2024 }, { year: 2025 }] }),
    intact: (raw) => Array.isArray(JSON.parse(raw)?.history) && JSON.parse(raw).history.length === 3,
    assert: true,
  },
  gpb_offseason_workflow_v1: {
    /*
      REPORTED BUT NOT ASSERTED, and the reason is worth more than the assertion would be.

      A non-idle offseason stage is only reachable when `seasonComplete` is true, and
      `useSeasonLifecycle.ts:384` resets the stage to idle whenever it is false:

          if (!seasonComplete && offseasonWorkflow.stage !== 'idle') setOffseasonWorkflow(idle)

      That is the app being CORRECT -- you cannot be at the lottery with an unfinished season. But a
      throwaway browser profile starts with no league at all, so `seasonComplete` is false and the
      seeded stage is repaired back to idle about 17ms after the correct write lands.

      Caught by watching writes rather than only reading the key at the end: the key is written with
      `draft_lottery`, then overwritten with `idle`. Reading only at the end attributes that to
      whichever writer ran last, which would have made the ungated-writer injections look like they
      clobbered this key when they never touched it.

      So the gate on this writer is real and was fixed alongside the other two, but proving it needs a
      genuinely completed season, which is a full simulated season of setup. A harness that fought the
      app's own startup repair to manufacture the precondition would be measuring the repair.
    */
    label: 'offseason workflow (not asserted)',
    seed: JSON.stringify({ seasonYear: 2025, stage: 'draft_lottery' }),
    intact: (raw) => JSON.parse(raw)?.stage === 'draft_lottery',
    assert: false,
  },
};

/**
 * Every injection removes one writer's gate.
 *
 * The anchor includes the following `setItem` line because the three gates are byte-identical, so a
 * bare `if (!isLocalKeysLoaded)` anchor would only ever hit the first one and the other two
 * injections would silently become no-ops -- an injection that cannot be applied is an assertion
 * nobody made.
 */
const injections = [
  {
    name: 'THE SHIPPED BUG: the season-history writer is ungated again, so a reload empties the archive',
    key: 'gpb_season_history_v1',
    from: `    if (!isLocalKeysLoaded) {
      return;
    }
    try {
      localStorage.setItem(SEASON_HISTORY_STORAGE_KEY`,
    to: `    try {
      localStorage.setItem(SEASON_HISTORY_STORAGE_KEY`,
  },
  {
    name: 'SAME BUG, DRAFT CENTER: the writer is ungated, so the accumulated draft-class list is lost',
    key: 'gpb_draft_center_v1',
    from: `    if (!isLocalKeysLoaded) {
      return;
    }
    try {
      localStorage.setItem(DRAFT_CENTER_STORAGE_KEY`,
    to: `    try {
      localStorage.setItem(DRAFT_CENTER_STORAGE_KEY`,
  },
  {
    /*
      Same gate, same bug, but this one is REPORTED rather than required to bite, for the reason set
      out on the key itself: `useSeasonLifecycle.ts:384` resets a non-idle stage to idle whenever the
      season is not complete, and a throwaway profile has no completed season. So the key loses its
      value under this injection whether or not the gate is there, and requiring it to bite would be
      requiring the harness to detect something the key cannot tell it.

      Still injected, and still applied for real, so the gate's disappearance is visible in the log
      and so the anchor stays exercised. It just does not decide pass or fail.
    */
    name: 'SAME BUG, OFFSEASON CHECKLIST -- reported only; this key cannot be asserted from a fresh profile',
    key: 'gpb_offseason_workflow_v1',
    reportedOnly: true,
    from: `    if (!isLocalKeysLoaded) {
      return;
    }
    try {
      localStorage.setItem(OFFSEASON_WORKFLOW_STORAGE_KEY`,
    to: `    try {
      localStorage.setItem(OFFSEASON_WORKFLOW_STORAGE_KEY`,
  },
  {
    /*
      A DIFFERENT KIND OF REGRESSION, and this one is recorded rather than required to bite.
      It swaps the shared gate for a PER-KEY flag set in that key's own load, which is the shape a
      reasonable person would reach for -- one flag per key reads tidier than one flag for three.

      It survives, and that is the correct result, because all three loads are declared before all
      three writers. Every read completes inside the same effect flush that runs the writers, so a
      writer gated on its own read is already satisfied by the time it runs.

      So the shared `isLocalKeysLoaded` is a SIMPLICITY choice, not a correctness requirement. The
      comment at its declaration used to claim otherwise -- that a per-key flag "would let a writer
      unblock while an earlier sibling in the same commit is still in flight" -- and that claim is
      what this leg exists to check. It does not hold, and the comment was corrected.

      Left in deliberately. An injection that is required to fail teaches the next reader that
      per-key flags are dangerous, which is not what the code does.
    */
    name: 'A PER-KEY GATE INSTEAD OF THE SHARED ONE -- expected to survive, and the reason is structural',
    key: null,
    expectSurvivor: true,
    from: '  const [isLocalKeysLoaded, setIsLocalKeysLoaded] = useState(false);',
    to: '  const [isLocalKeysLoaded, setIsLocalKeysLoaded] = useState(false);\n  // per-key gate, injected by proveSeasonHistoryReloadGuard',
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServer() {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) return true;
  } catch { /* not reachable */ }
  return false;
}

async function endpoint(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never opened a debugging port');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cdp = new CDP(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && cdp.waiting.has(msg.id)) {
        const { resolve, reject } = cdp.waiting.get(msg.id);
        cdp.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      }
    });
    return cdp;
  }
  send(method, params = {}, sessionId) {
    this.id += 1;
    const payload = { id: this.id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.waiting.set(this.id, { resolve, reject }));
  }
}

let chrome = null;
let browser = null;
let sessionId = null;

const evaluate = async (expression) => {
  const r = await browser.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  return r.exceptionDetails
    ? 'THREW: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    : r.result.value;
};

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  if (profile) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ } }
};

const profile = mkdtempSync(join(tmpdir(), 'gpb-histguard-'));

/**
 * One measurement: seed the three keys into a mounted page, reload, read back.
 *
 * The seed is verified BEFORE the reload and the run is discarded if it did not stick. Without that
 * precondition a harness that cannot even hold a value in memory reports "destroyed" for every
 * injection, which looks like a biting check and measures nothing.
 */
const measure = async (label) => {
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(5500);

  const seedScript = `(() => {
    const seeds = ${JSON.stringify(Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, v.seed])))};
    for (const [k, v] of Object.entries(seeds)) localStorage.setItem(k, v);
    return Object.keys(seeds).length;
  })()`;
  await evaluate(seedScript);
  await sleep(2500);

  const precondition = await evaluate(`(() => {
    const seeds = ${JSON.stringify(Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, v.seed])))};
    return Object.entries(seeds).filter(([k, v]) => localStorage.getItem(k) === v).length;
  })()`);
  if (precondition !== Object.keys(KEYS).length) {
    return { label, aborted: `the seed did not hold before reloading (${precondition}/${Object.keys(KEYS).length} keys intact) -- the harness is not measuring the app` };
  }

  await browser.send('Page.reload', {}, sessionId);
  await sleep(6000);

  const results = {};
  for (const [key, spec] of Object.entries(KEYS)) {
    const raw = await evaluate(`localStorage.getItem(${JSON.stringify(key)})`);
    let intact = false;
    let detail;
    if (typeof raw !== 'string') {
      detail = 'key absent';
    } else {
      try { intact = spec.intact(raw); detail = raw.slice(0, 60); } catch { detail = 'unparseable'; }
    }
    results[key] = { intact, detail, label: spec.label, assert: spec.assert };
  }
  return { label, results };
};

/**
 * Prints every key and returns whether every ASSERTED key survived.
 *
 * Non-asserted keys are printed with their own marker so a reader can see them being clobbered and
 * not mistake it for a verdict. Failing the run on a key the app legitimately repairs would make
 * this tool permanently red and teach the next person to ignore it.
 */
const report = (m) => {
  if (m.aborted) { console.log(`  ABORTED: ${m.aborted}`); return false; }
  let allIntact = true;
  for (const r of Object.values(m.results)) {
    if (!r.intact && r.assert) allIntact = false;
    const mark = r.intact ? 'kept   ' : r.assert ? 'DESTROYED' : 'clobberd';
    console.log(`  ${mark} ${r.label.padEnd(42)} ${r.detail}`);
  }
  return allIntact;
};

const main = async () => {
  if (!(await ensureServer())) {
    console.error(`\nCannot reach ${url}.`);
    console.error('This tool measures the app in a real browser, so the dev server must be running:');
    console.error('    npm run dev');
    console.error('A harness that cannot run the app cannot prove anything about it.\n');
    process.exit(1);
  }

  const port = 9900 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1280,900',
    url,
  ], { stdio: 'ignore' });

  browser = await CDP.attach(await endpoint(port));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);

  let allBite = true;
  let allInjected = true;

  console.log('\nBASELINE -- the gate is in place, so a reload must keep every asserted key');
  console.log('  (the offseason key is printed but never asserted; see the note on it below)');
  const baseline = await measure('baseline');
  const baselineOk = report(baseline);
  if (!baselineOk) {
    console.log('\n*** THE ARCHIVE IS NOT SURVIVING A RELOAD ON UNMODIFIED SOURCE ***');
    console.log('Aborting: injecting into code that is already broken measures the wrong thing.\n');
    cleanup();
    process.exit(1);
  }

  const original = readFileSync(TARGET, 'utf8');

  for (const injection of injections) {
    console.log(`\n${injection.name}`);
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const from = injection.from.replace(/\n/g, eol);
    const to = injection.to.replace(/\n/g, eol);

    if (!original.includes(from)) {
      console.log('  COULD NOT INJECT -- the anchor text has moved.');
      console.log('    an injection that cannot be applied is an assertion nobody made');
      allInjected = false;
      allBite = false;
      continue;
    }

    // Backup taken BEFORE the edit, and the restore is in `finally`. Taking the backup afterwards is
    // how a restore becomes the thing that causes the damage.
    writeFileSync(TARGET, original.replace(from, to));
    try {
      const m = await measure(injection.name);
      const allIntact = report(m);
      const clobbered = m.aborted ? true : Object.values(m.results).filter((r) => !r.intact);

      if (injection.expectSurvivor) {
        const asDocumented = allIntact;
        if (!asDocumented) allBite = false;
        console.log(`  ${asDocumented
          ? 'SURVIVES, AS DOCUMENTED -- a per-key gate is sufficient here, so the shared flag is a'
            + '\n    simplicity choice rather than a correctness requirement'
          : '*** BEHAVIOUR CHANGED: a per-key gate now loses data, so the note at the flag is out of date ***'}`);
        continue;
      }

      if (injection.reportedOnly) {
        console.log('  REPORTED ONLY -- this key is repaired by the app on a fresh profile either way,');
        console.log('    so its value here cannot tell the harness whether the gate is present.');
        continue;
      }

      const targetLost = clobbered.some((r) => r.assert && r.label === KEYS[injection.key].label);
      if (!targetLost || m.aborted) allBite = false;
      console.log(`  ${m.aborted
        ? '*** THE HARNESS DID NOT RUN, SO NOTHING WAS MEASURED ***'
        : targetLost
          ? `BITES -- ${KEYS[injection.key].label} did not survive the reload`
          : `*** DID NOT BITE -- ${KEYS[injection.key].label} survived a reload with its gate removed ***`}`);
    } finally {
      writeFileSync(TARGET, original);
    }
  }

  console.log('\nRESTORED -- source is back to unmodified and the archive survives again');
  const restored = await measure('restored');
  if (!report(restored)) allBite = false;
  if (restored.aborted) allBite = false;

  console.log(`\n${TARGET} byte-identical to the pre-run source: ${readFileSync(TARGET, 'utf8') === original}`);

  const mustBite = injections.filter((i) => !i.expectSurvivor && !i.reportedOnly).length;
  const reportedOnly = injections.filter((i) => i.reportedOnly).length;

  if (!allInjected) console.log('\nAT LEAST ONE INJECTION COULD NOT BE APPLIED.\n');
  else if (allBite) {
    console.log(`\nALL ${mustBite} INJECTED BUGS WERE CAUGHT`);
    console.log(`${reportedOnly} further injection applied and reported without a verdict, 1 expected survivor behaved as documented.`);
    console.log('The guard holds.\n');
  } else console.log('\nAT LEAST ONE INJECTED BUG SURVIVED. The guard is not trustworthy.\n');

  cleanup();
  process.exit(allBite && allInjected ? 0 : 1);
};

main().catch((err) => {
  console.error('\nPROBE FAILED:', err.message);
  cleanup();
  process.exit(1);
});
