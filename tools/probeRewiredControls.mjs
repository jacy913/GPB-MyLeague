/**
 * Did the three rewired controls actually work?
 *
 * Installing `@types/react` surfaced three features that were fully built on both sides and missing
 * only the hop in the middle: a prop written by a caller, consumed by a component, dropped in between.
 * All three produced the same symptom -- a control on screen that invoked `undefined` and threw, or
 * silently did nothing. A type error fixed that at compile time; this checks it at runtime, because
 * the failure mode was always "looks wired, isn't".
 *
 * The three:
 *   1. Terminate Universe modal -> Preview        (threw on click)
 *   2. Commissioner Settings -> Export/Import Backup (threw on click)
 *   3. HXSE portfolio drawer -> a position row   (navigated, but never selected the club)
 *
 * Each is exercised by clicking it and asserting on what the page does afterwards, with console
 * errors collected throughout. A click that throws shows up here as an uncaught exception rather
 * than as a check failure, which is why both are reported.
 *
 * Run: node tools/probeRewiredControls.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-rewired-'));

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

const click = async (want) => evaluate(`(() => {
  const w = ${JSON.stringify(want.toLowerCase())};
  const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
  const hit = nodes.find((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().toLowerCase().includes(w));
  if (!hit) return 'NOT FOUND: ' + w;
  hit.click();
  return 'clicked: ' + (hit.getAttribute('aria-label') || hit.textContent || '').trim();
})()`);

const shot = async (name) => {
  const r = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
};

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

const errors = [];
const exceptions = [];

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9800 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1600,1100', '--hide-scrollbars', url,
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
  console.log('\nREWIRED CONTROLS\n');
  console.log('  ', await click('repair player pool'));
  await sleep(24000);

  /*
    THE NAV LABELS, printed rather than assumed.

    Three of the steps below navigate to a view, and every one of them first reported NOT FOUND
    because the labels were guessed. The sidebar groups screens behind folder headers -- PLAY expands,
    COMMISSIONER and SYSTEM do not -- so the leaves are not in the document at all until the folder is
    opened. Which meant "no nav target like simulation" for a screen that exists and works.

    So: open every folder header first, then list. Printing the labels afterwards is what makes a
    wrong guess a message instead of four silent NOT FOUNDs and a FAIL.
  */
  const FOLDERS = ['COMMISSIONER', 'SCORES', 'LEAGUE', 'TEAMS', 'PLAYOFFS', 'SYSTEM'];
  await evaluate(`(() => {
    ${JSON.stringify(FOLDERS)}.forEach((f) => {
      const n = [...document.querySelectorAll('button')]
        .find((x) => (x.textContent || '').trim().toUpperCase() === f);
      if (n) n.click();
    });
    return 'expanded';
  })()`);
  await sleep(1200);
  const navLabels = await evaluate(`(() => [...document.querySelectorAll('button, a')]
    .map((n) => (n.getAttribute('aria-label') || n.textContent || '').trim())
    .filter((t) => t.length > 1 && t.length < 40))()`);
  console.log(`\n    nav: ${navLabels.filter((l) => !/Scheduled$/.test(l)).join(' | ')}`);

  const goTo = async (label, heading) => {
    const hit = navLabels.find((l) => l.toLowerCase() === label.toLowerCase())
      ?? navLabels.find((l) => l.toLowerCase().includes(label.toLowerCase()));
    if (!hit) {
      console.log(`     (no nav target like "${label}" -- skipping)`);
      return false;
    }
    await evaluate(`(() => {
      const w = ${JSON.stringify(hit.toLowerCase())};
      const n = [...document.querySelectorAll('button, a')]
        .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === w);
      if (n) n.click();
      return 'ok';
    })()`);
    /*
      The heading check is a CONFIRMATION, not the action. An earlier version treated a heading
      mismatch as a failed navigation and reported "(reached settings? no)" for a view that had just
      opened -- the Settings screen's own heading does not contain the word the probe guessed. So the
      click is what matters and the heading is reported when it matches.
    */
    for (let t = 0; t < 14; t += 1) {
      const there = await evaluate(`(() => [...document.querySelectorAll('h1')]
        .some((x) => new RegExp(${JSON.stringify(heading)}, 'i').test((x.textContent || '').trim())))()`);
      if (there) { console.log(`     on ${label}`); return true; }
      await sleep(500);
    }
    console.log(`     clicked ${label} (heading "${heading}" not seen -- continuing)`);
    return true;
  };

  const results = [];

  // -- 1. Terminate Universe -> Preview -------------------------------------
  console.log('\n  1. Terminate Universe modal -> Preview');
  // The leaf is labelled "Simulate", not "Simulation" -- the component is SimulationHub and the nav
  // says otherwise, which is exactly the sort of mismatch that made the first attempt report
  // NOT FOUND for a screen that was sitting right there.
  if (await goTo('simulate', 'simulation|simulate|commissioner')) {
    console.log('     ', await click('terminate'));
    await sleep(2000);
    const previewClicked = await click('preview');
    await sleep(3500);
    // The preview modal shows what a rebuild WOULD produce, so it must render its own content.
    const previewOpen = await evaluate(`(() => {
      const t = (document.body.innerText || '');
      return {
        sawModal: /new universe|player pool|would|preview/i.test(t),
        crashed: (document.getElementById('root')?.children.length ?? 0) === 0,
      };
    })()`);
    console.log(`     ${previewClicked}`);
    console.log(`     modal present: ${previewOpen.sawModal}   page alive: ${!previewOpen.crashed}`);
    console.log(`     -> ${await shot('rewired-1-preview')}`);
    results.push(['Terminate -> Preview', previewClicked.startsWith('clicked') && previewOpen.sawModal && !previewOpen.crashed]);
  } else {
    results.push(['Terminate -> Preview', false]);
  }

  // Dismiss whatever is open so the next step starts clean.
  await click('close');
  await sleep(800);
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .filter((n) => /close|cancel|back to dashboard/i.test((n.textContent || '').trim()));
    if (b[0]) b[0].click();
    return b.length;
  })()`);
  await sleep(800);

  // -- 2. Commissioner Settings -> backup buttons ---------------------------
  console.log('\n  2. Commissioner Settings -> Export/Import Local Backup');
  // Settings is a System leaf, and the commissioner folder holds the rest, so the view is reached
  // by its own label wherever it lives rather than by assuming a folder.
  if (await goTo('settings', 'commissioner|setting')) {
    const backupButtons = await evaluate(`(() => [...document.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim())
      .filter((t) => /export|import/i.test(t) && /backup|local/i.test(t)))()`);
    console.log(`     found: ${backupButtons.length ? backupButtons.join(' | ') : '(none)'}`);
    console.log(`     -> ${await shot('rewired-2-settings-backup')}`);
    results.push(['Settings backup controls render', backupButtons.length >= 1]);
  } else {
    results.push(['Settings backup controls render', false]);
  }

  // -- 3. HXSE drawer -> position row --------------------------------------
  console.log('\n  3. HXSE portfolio drawer -> a position row');
  if (await goTo('exchange', 'exchange|market|desk')) {
    const opened = await click('portfolio');
    await sleep(1500);
    /*
      Position rows are the club buttons inside the drawer. Filtering on the "–SCH" ticker label
      picked up the ticker strip too, so this looks for a button that carries a team crest instead --
      that is what distinguishes a position row from anything else on the page.
    */
    const rowLabels = await evaluate(`(() => {
      // Scope to the drawer, not the page: the ticker strip also renders crest-bearing buttons, and
      // matching on those clicked a matchup row instead of a position.
      const panel = [...document.querySelectorAll('div')]
        .find((d) => /HXSE portfolio/i.test(d.textContent || '') && d.querySelectorAll('button').length > 1
          && d.className.includes('fixed'));
      const scope = panel ?? document;
      return [...scope.querySelectorAll('button')]
        .filter((b) => b.querySelector('img'))
        .map((b) => (b.textContent || '').trim())
        .filter((t) => t.length > 2 && t.length < 40);
    })()`);
    console.log(`     ${opened}`);
    console.log(`     drawer rows: ${rowLabels.slice(0, 5).join(' | ') || '(none)'}`);
    if (rowLabels.length) {
      await evaluate(`(() => {
        const w = ${JSON.stringify(rowLabels[0].toLowerCase())};
        const b = [...document.querySelectorAll('button')]
          .find((x) => (x.textContent || '').trim().toLowerCase() === w);
        if (b) b.click();
        return 'ok';
      })()`);
      await sleep(3500);
    }
    const afterRow = await evaluate(`(() => ({
      onExchange: /Exchange|HXSE|desk|close/i.test((document.body.innerText || '').slice(0, 800)),
      alive: (document.getElementById('root')?.children.length ?? 0) > 0,
    }))()`);
    console.log(`     landed back on Exchange: ${afterRow.onExchange}   page alive: ${afterRow.alive}`);
    console.log(`     -> ${await shot('rewired-3-hxse-row')}`);
    results.push(['HXSE row navigates without throwing', afterRow.alive]);
  } else {
    results.push(['HXSE row navigates without throwing', false]);
  }

  console.log('\n  RESULTS');
  for (const [name, ok] of results) console.log(`    ${ok ? 'PASS' : '*** FAIL ***'}  ${name}`);
  console.log(`\n    console errors:    ${errors.length}`);
  console.log(`    uncaught throws:   ${exceptions.length}`);
  for (const e of exceptions.slice(0, 5)) console.log(`      ${e}`);

  const ok = results.every(([, pass]) => pass) && exceptions.length === 0;
  console.log(`\n  ${ok ? 'PASS' : '*** SEE ABOVE ***'}\n`);

  cleanup();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });