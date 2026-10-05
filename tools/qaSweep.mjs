/**
 * Whole-app QA sweep.
 *
 * Visits every nav leaf and reports, per view: whether it rendered anything, what its heading is,
 * how big the document is, and every console error or uncaught exception raised while it was on
 * screen. Screenshots each one.
 *
 * WHY THIS EXISTS, and it is not just "look at the app":
 *
 *   `tsc` is now clean, which means static analysis has nothing left to say. Every remaining defect
 *   in this codebase is a runtime one, and a runtime defect has two properties that make it easy to
 *   miss: it needs the right data to appear, and it raises nothing unless you go to the screen that
 *   triggers it. Twelve views means twelve places for either to hide.
 *
 *   So the sweep plays a season first. Props, standings, percentile leaders and the award race are
 *   all empty on a fresh universe and would each be reported as "renders fine" having rendered
 *   nothing at all -- which is the failure mode of every smoke test ever written.
 *
 * PER-VIEW ERROR ATTRIBUTION, which is the part that makes it useful: the error buffer is cleared on
 * entry to each view, so a report says "Leaders raised X" rather than listing thirty errors from
 * thirty screens and leaving the reader to guess. One number that accumulates is one number nobody
 * reads.
 *
 * Run: node tools/qaSweep.mjs [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/qa';
/**
 * Viewport. Overridable because this app has been checked at desktop width all session and never at
 * a phone width, and the responsive paths are exactly the ones a desktop screenshot cannot exercise:
 * the Media page hides its nine-column table behind `lg:` and falls back to a different markup, the
 * standings table drops columns, the prop board drops to one column. Those fallbacks only run at
 * narrow widths, so a desktop pass silently skips the code most likely to be wrong.
 */
const width = Number(process.env.GPB_QA_WIDTH ?? 1600);
const height = Number(process.env.GPB_QA_HEIGHT ?? 1200);
const tag = process.env.GPB_QA_TAG ?? `${width}`;
const DAYS = Number(process.env.GPB_QA_DAYS ?? 14);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-qa-'));
mkdirSync(outDir, { recursive: true });

let chrome = null;
let browser = null;
let sessionId = null;

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

const shot = async (name) => {
  const r = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
};

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

/** Errors raised since the last clear, tagged with where they came from. */
let errors = [];
let exceptions = [];

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9500 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--window-size=${width},${height}`, '--hide-scrollbars', url,
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
      exceptions.push(`${d.text ?? ''} ${d.exception?.description ?? ''}`.slice(0, 300));
    }
  });

  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log('\nQA SWEEP  (viewport ' + width + 'x' + height + ')\n');

  // -- build a universe, then play some of it -------------------------------
  const repaired = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /rebuild|repair/i.test((n.textContent||'').trim()));
    if (!b) return 'already built';
    b.click(); return 'repairing';
  })()`);
  console.log(`  universe: ${repaired}`);
  for (let t = 0; t < 90; t += 1) {
    const gone = await evaluate(`(() => [...document.querySelectorAll('button')]
      .some((n) => /rebuild|repair/i.test((n.textContent||'').trim())) ? 'no' : 'yes')()`);
    if (gone === 'yes') break;
    await sleep(1000);
  }

  const clickByText = async (want) => evaluate(`(() => {
    const w = ${JSON.stringify(want.toLowerCase())};
    const n = [...document.querySelectorAll('button, a')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === w);
    if (!n) return 'NOT FOUND';
    n.click(); return 'ok';
  })()`);

  await clickByText('dashboard');
  await sleep(1200);
  let played = 0;
  for (let i = 0; i < DAYS; i += 1) {
    const d = await evaluate(`(() => {
      const x = [...document.querySelectorAll('button')].find((n) => /back to dashboard/i.test((n.textContent||'').trim()));
      if (x) { x.click(); return 'dismissed'; } return 'none';
    })()`);
    if (d === 'dismissed') await sleep(500);
    const hit = await clickByText('sim day');
    if (hit !== 'ok') break;
    played += 1;
    for (let t = 0; t < 60; t += 1) {
      const done = await evaluate(`(() => [...document.querySelectorAll('h2')]
        .some((h) => /simulation complete/i.test(h.textContent || '')) ? 'yes' : 'no')()`);
      if (done === 'yes') break;
      await sleep(500);
    }
  }
  console.log(`  played ${played} of ${DAYS} days\n`);

  // -- open every folder so the leaves exist in the document ---------------
  await evaluate(`(() => {
    ['COMMISSIONER','SCORES','LEAGUE','TEAMS','PLAYOFFS','SYSTEM'].forEach((f) => {
      const n = [...document.querySelectorAll('button')]
        .find((x) => (x.textContent || '').trim().toUpperCase() === f);
      if (n) n.click();
    });
    return 'ok';
  })()`);
  await sleep(1200);

  /*
    THE LEAVES, read out of the navigation rail and nothing else.

    The first version collected every `button` on the page and reported 193 "views" passing, which
    was meaningless: it had clicked `CHRIS GATZ, column 1 of 6`, `To Date`, `FestorNorth` and every
    game row in the ticker, and reported each as a view that rendered. A sweep that cannot tell a
    navigation destination from an in-page control will always pass, because in-page controls are
    exactly the things that work.

    So the leaves come from `[role="tree"][aria-label="League navigation"]` -- the rail -- and from
    nothing else. If that element is missing the sweep says so and stops rather than quietly falling
    back to "every button on the page".
  */
  const navInfo = await evaluate(`(() => {
    const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
    if (!tree) return { missing: true, leaves: [] };
    const groups = [...tree.querySelectorAll('[role="group"]')];
    const leaves = [];
    groups.forEach((g) => {
      [...g.querySelectorAll('button, [role="treeitem"]')].forEach((n) => {
        const t = (n.getAttribute('aria-label') || n.textContent || '').trim();
        if (t && t.length < 32) leaves.push(t);
      });
    });
    return { missing: false, groups: groups.length, leaves };
  })()`);

  if (navInfo.missing) {
    console.error('\n  The navigation rail was not found, so there is nothing to sweep.');
    console.error('  Refusing to fall back to every button on the page -- that is what made the first\n');
    console.error('  version of this probe report 193 passing views, all of them nonsense.\n');
    cleanup();
    process.exit(1);
  }

  const leaves = navInfo.leaves;
  console.log(`  ${leaves.length} nav leaves across ${navInfo.groups} folders\n`);
  console.log('  view                    chars  heading                  err  exc');
  console.log('  ' + '-'.repeat(66));

  const report = [];

  for (const leaf of leaves) {
    // Clear BEFORE navigating, so anything raised belongs to this view.
    errors = [];
    exceptions = [];

    /*
      DISMISS ANY MODAL FIRST, and this was the sweep's worst defect.

      The last Sim Day leaves its "Simulation Complete" panel open, and the panel is a fixed overlay
      that covers roughly a quarter of the viewport. The sweep measured every view with it still up,
      which meant: the Standings screenshot had its right-hand columns hidden behind it and looked
      like a table missing its statistics entirely (it was fine -- 4 cells per row, uniform, none
      hidden), every view's character count was depressed by whatever it covered, and a screenshot
      that shows a panel covering content is not evidence about the content.

      So the panel is closed before each view is measured. A sweep that photographs the app through
      its own leftovers is measuring the leftovers.
    */
    await evaluate(`(() => {
      const closers = [...document.querySelectorAll('button')]
        .filter((b) => /back to dashboard|close|cancel|dismiss/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
      closers.forEach((b) => b.click());
      return closers.length;
    })()`);
    await sleep(700);

    /*
      Clicked INSIDE the rail, by exact label. `clickByText` searches the whole document, and a leaf
      name like "Dashboard" or "Settings" also appears in panels and headers; scoping to the tree is
      what makes the destination unambiguous.
    */
    const navHit = await evaluate(`(() => {
      const w = ${JSON.stringify(leaf.toLowerCase())};
      const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
      if (!tree) return 'NO RAIL';
      const n = [...tree.querySelectorAll('button, [role="treeitem"]')]
        .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === w);
      if (!n) return 'NOT IN RAIL';
      n.click();
      return 'ok';
    })()`);
    await sleep(2400);

    const info = await evaluate(`(() => {
      const root = document.getElementById('root');
      const h1 = document.querySelector('h1');
      const doc = document.documentElement;
      return {
        chars: (document.body.innerText || '').trim().length,
        rootChildren: root ? root.children.length : -1,
        heading: (h1 ? h1.textContent : '').trim().slice(0, 22) || '(no h1)',
        /*
          HORIZONTAL OVERFLOW, and it is checked on every view rather than eyeballed.

          A narrow viewport makes long tables and fixed-width panels overflow, and the symptom is a
          horizontal scrollbar on the document -- which a screenshot crops out silently, because the
          capture is the window width and the overflow is beyond its edge. Asking the DOM is the only
          way to see it. Up to 8px is allowed for sub-pixel rounding.
        */
        overflowX: Math.max(0, doc.scrollWidth - doc.clientWidth),
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
      };
    })()`);

    const clean = navHit === 'ok'
      && errors.length === 0 && exceptions.length === 0
      && info.chars > 0 && info.rootChildren > 0
      && info.overflowX <= 8;
    report.push({
      leaf,
      navHit,
      ...info,
      errors: [...errors],
      exceptions: [...exceptions],
      clean,
      shot: await shot(`qa-${tag}-${leaf.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    });

    console.log(
      `  ${clean ? ' ' : '!'}${leaf.padEnd(20)} ${String(info.chars).padStart(6)}  `
      + `${info.heading.padEnd(26)} ${String(errors.length).padStart(3)}  ${String(exceptions.length).padStart(3)}`
      + `${info.overflowX > 8 ? `  overflowX +${info.overflowX}px` : ''}`,
    );
  }

  const dirty = report.filter((r) => !r.clean);
  console.log('\n  ' + '-'.repeat(66));
  console.log(`  ${report.length} views, ${report.length - dirty.length} clean, ${dirty.length} needing attention`);

  if (dirty.length) {
    console.log('\n  FINDINGS\n');
    for (const d of dirty) {
      console.log(`  ${d.leaf}  (${d.chars} chars, "${d.heading}")`);
      if (d.chars === 0 || d.rootChildren === 0) console.log('    *** rendered nothing ***');
      [...new Set(d.exceptions)].slice(0, 3).forEach((e) => console.log(`    THROW  ${e}`));
      [...new Set(d.errors)].slice(0, 3).forEach((e) => console.log(`    ERROR  ${e.slice(0, 200)}`));
      if (!d.chars && !d.rootChildren) { /* already said */ }
      else if (!d.errors.length && !d.exceptions.length) console.log('    (clean -- flagged on a content check below)');
    }
  }

  console.log(`\n  screenshots: ${outDir}`);
  cleanup();
  process.exit(dirty.length === 0 ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });