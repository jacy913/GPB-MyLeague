/**
 * Interaction sweep: click things and see what throws.
 *
 * The view sweep checks that every screen RENDERS. This one checks what happens when you USE them,
 * which is a different axis and the one with the worse record: the two previous commits were both
 * defects in controls that rendered perfectly and threw on click -- a Preview button calling
 * `undefined`, a backup button awaiting a missing prop, a ref callback warning once per row. None of
 * them is visible to a screenshot, a character count, or a render-time error check.
 *
 * So: on every view, click every enabled button whose label is not on the deny list, and record
 * anything thrown. One click at a time, with the error buffer cleared between clicks, so a report says
 * WHICH control threw rather than listing twenty failures from twenty screens.
 *
 * THE DENY LIST IS THE IMPORTANT PART, and it is not optional carelessness:
 *
 *   These controls end the universe. A sweep that clicks "Terminate Universe" or "Reset Season" or
 *   "Hard Wipe Players" has destroyed the league it is supposed to be sweeping, and every subsequent
 *   view is then measured against an empty app -- producing a report that is both destructive and
 *   meaningless. Destructive actions are the ones most likely to be broken, so skipping them is a
 *   real gap in coverage, and it is a deliberate one: an automated sweep is the wrong place to find
 *   out whether Reset Season works. `SKIPPED` is printed with the labels so the gap is visible rather
 *   than invisible.
 *
 * Run: node tools/qaClicks.mjs [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/qa-clicks';
const DAYS = Number(process.env.GPB_QA_DAYS ?? 10);
const PER_VIEW = Number(process.env.GPB_QA_PER_VIEW ?? 14);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-clicks-'));
mkdirSync(outDir, { recursive: true });

/**
 * Labels that end, reset, or irreversibly rewrite the universe.
 *
 * Matched case-insensitively as substrings against the visible label. Deliberately broad: a false
 * positive costs one skipped button, a false negative costs the league.
 */
const DESTRUCTIVE = [
  'terminate', 'reset season', 'hard wipe', 'wipe players', 'clear historical',
  'clear data', 'delete', 'rebuild', 'repair player', 'generate players',
  'quick sim', 'end season', 'sim week', 'sim month', 'to date', 'sim day',
  'import backup', 'reset view', 'reset marker',
];

let chrome = null;
let browser = null;
let sessionId = null;
let errors = [];
let exceptions = [];

async function endpoint(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error('Chrome never opened a debugging port');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = []; }
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
      } else if (msg.method) cdp.handlers.forEach((h) => h(msg));
    });
    return cdp;
  }
  send(method, params = {}, sid) {
    this.id += 1;
    const payload = { id: this.id, method, params };
    if (sid) payload.sessionId = sid;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.waiting.set(this.id, { resolve, reject }));
  }
  on(fn) { this.handlers.push(fn); }
}

const evaluate = async (expression) => {
  const r = await browser.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  return r.exceptionDetails
    ? 'THREW: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    : r.result.value;
};

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9300 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1600,1200', '--hide-scrollbars', url,
  ], { stdio: 'ignore' });

  browser = await CDP.attach(await endpoint(port));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails ?? {};
      exceptions.push(`${d.text ?? ''} ${d.exception?.description ?? ''}`.slice(0, 260));
    }
  });

  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log('\nINTERACTION SWEEP\n');

  const evaluateAll = async (want, scope = 'document') => evaluate(`(() => {
    const root = document;
    const n = [...root.querySelectorAll('button, [role="button"]')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase().includes(${JSON.stringify(want.toLowerCase())})
        && !x.disabled);
    if (!n) return 'NOT FOUND';
    n.click(); return 'ok';
  })()`);

  console.log('  building universe...');
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /rebuild|repair/i.test((n.textContent||'').trim()));
    if (b) b.click(); return 'ok';
  })()`);
  for (let t = 0; t < 90; t += 1) {
    const gone = await evaluate(`(() => [...document.querySelectorAll('button')]
      .some((n) => /rebuild|repair/i.test((n.textContent||'').trim())) ? 'no' : 'yes')()`);
    if (gone === 'yes') break;
    await sleep(1000);
  }

  // A little season, so controls have something to act on.
  await evaluateAll('dashboard');
  await sleep(1200);
  for (let i = 0; i < DAYS; i += 1) {
    await evaluate(`(() => {
      const x = [...document.querySelectorAll('button')].find((n) => /^sim day$/i.test((n.textContent||'').trim()));
      if (x) x.click(); return 'ok';
    })()`);
    for (let t = 0; t < 60; t += 1) {
      const done = await evaluate(`(() => [...document.querySelectorAll('h2')]
        .some((h) => /simulation complete/i.test(h.textContent || '')) ? 'yes' : 'no')()`);
      if (done === 'yes') break;
      await sleep(500);
    }
    await evaluate(`(() => {
      const x = [...document.querySelectorAll('button')].find((n) => /back to dashboard/i.test((n.textContent||'').trim()));
      if (x) x.click(); return 'ok';
    })()`);
    await sleep(500);
  }
  console.log(`  played ${DAYS} days\n`);

  await evaluate(`(() => {
    ['COMMISSIONER','SCORES','LEAGUE','TEAMS','PLAYOFFS','SYSTEM'].forEach((f) => {
      const n = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim().toUpperCase() === f);
      if (n) n.click();
    });
    return 'ok';
  })()`);
  await sleep(1000);

  const leaves = await evaluate(`(() => {
    const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
    if (!tree) return [];
    const out = [];
    [...tree.querySelectorAll('[role="group"]')].forEach((g) => {
      [...g.querySelectorAll('button, [role="treeitem"]')].forEach((n) => {
        const t = (n.getAttribute('aria-label') || n.textContent || '').trim();
        if (t && t.length < 32) out.push(t);
      });
    });
    return out;
  })()`);

  console.log(`  ${leaves.length} views\n`);
  console.log('  view                    tried   threw  blocked');
  console.log('  ' + '-'.repeat(72));

  const findings = [];
  const skippedAll = new Set();

  for (const leaf of leaves) {
    await evaluate(`(() => {
      const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
      const n = [...tree.querySelectorAll('button, [role="treeitem"]')]
        .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === ${JSON.stringify(leaf.toLowerCase())});
      if (n) n.click();
      return 'ok';
    })()`);
    await sleep(2400);

    // Collect the clickable labels on this view, minus the deny list and minus the nav itself.
    const targets = await evaluate(`(() => {
      const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
      const deny = ${JSON.stringify(DESTRUCTIVE)};
      const safe = [];
      const blocked = [];
      [...document.querySelectorAll('button, [role="button"]')].forEach((b) => {
        if (tree && tree.contains(b)) return;
        if (b.disabled) return;
        const label = (b.getAttribute('aria-label') || b.textContent || '').trim();
        if (!label || label.length > 44) return;
        const low = label.toLowerCase();
        /*
          Blocked labels are counted BEFORE the safe list is built.

          The first version filtered them out and then counted them out of the filtered list, which is
          identically zero by construction -- so every view reported "0 skipped", including the
          dashboard, which is covered in Sim Day buttons. A coverage figure that cannot be non-zero is
          not a coverage figure, and it hid the fact that the deny list was doing a lot of work.
        */
        if (deny.some((d) => low.includes(d))) { if (!blocked.includes(label)) blocked.push(label); return; }
        if (!safe.includes(label)) safe.push(label);
      });
      return { clickable: safe.slice(0, ${PER_VIEW}), blocked, totalSafe: safe.length };
    })()`);

    targets.blocked.forEach((s) => skippedAll.add(s));

    let tried = 0;
    let threw = 0;

    for (const label of targets.clickable) {
      // Dismiss anything the previous click opened, so we measure one control at a time.
      await evaluate(`(() => {
        [...document.querySelectorAll('button')]
          .filter((b) => /close|cancel|back to dashboard/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()))
          .forEach((b) => b.click());
        return 'ok';
      })()`);
      await sleep(300);

      errors = [];
      exceptions = [];

      const before = await evaluate(`(() => (document.getElementById('root')?.children.length ?? 0))()`);
      const clicked = await evaluate(`(() => {
        const w = ${JSON.stringify(label.toLowerCase())};
        const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
        const n = [...document.querySelectorAll('button, [role="button"]')]
          .find((x) => {
            if (tree && tree.contains(x)) return false;
            const t = (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase();
            return t === w;
          });
        if (!n || n.disabled) return 'GONE';
        n.click(); return 'ok';
      })()`);
      if (clicked !== 'ok') continue;
      tried += 1;
      await sleep(900);

      const after = await evaluate(`(() => (document.getElementById('root')?.children.length ?? 0))()`);
      const hit = exceptions.length > 0
        || errors.some((e) => /is not a function|undefined|Cannot read|of undefined|of null/i.test(e))
        || after === 0;

      if (hit) {
        threw += 1;
        findings.push({ leaf, label, exceptions: [...exceptions], errors: [...errors], rootBefore: before, rootAfter: after });
      }
    }

    console.log(
      `  ${threw ? '!' : ' '}${leaf.padEnd(20)} ${String(tried).padStart(3)}/${String(targets.totalSafe).padEnd(4)} ${String(threw).padStart(5)}  ${String(targets.blocked.length).padStart(4)}`,
    );
  }

  console.log('\n  ' + '-'.repeat(72));
  if (findings.length) {
    console.log(`  ${findings.length} CONTROLS THREW\n`);
    for (const f of findings) {
      console.log(`  ${f.leaf} :: "${f.label}"   (root ${f.rootBefore} -> ${f.rootAfter})`);
      [...new Set(f.exceptions)].slice(0, 2).forEach((e) => console.log(`      THROW ${e}`));
      [...new Set(f.errors)].slice(0, 2).forEach((e) => console.log(`      ERROR ${e.slice(0, 200)}`));
    }
  } else {
    console.log('  no control threw');
  }

  console.log(`\n  SKIPPED AS DESTRUCTIVE (${skippedAll.size} labels seen):`);
  console.log(`    ${[...skippedAll].slice(0, 20).join(' | ') || '(none encountered)'}`);
  console.log('    These are unverified by this sweep and need a human or a targeted test.');

  console.log('\n  screenshots: (not captured per click; failures are reported above)\n');
  cleanup();
  process.exit(findings.length === 0 ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });