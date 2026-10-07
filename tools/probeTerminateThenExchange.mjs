/**
 * Reproduces the reported bug: Terminate Universe, then click Exchange -> blank screen, freeze.
 *
 * ============================================================================
 * WHY A DEDICATED PROBE AND NOT A SMOKE TEST
 * ============================================================================
 *
 * `cdp.mjs` loads the app, repairs the empty player pool, and moves on. That path never reaches the
 * Exchange after a TERMINATION, because on a fresh profile terminate is reached from NoPlayersGate
 * and the repair path does not clear the ledger. So the blank screen was invisible to every check
 * that existed: the Exchange rendered fine before terminate and fine after a plain repair.
 *
 * The crash is a single unguarded `undefined.length`. Terminate Universe is what made `undefined`
 * reachable on the Exchange, because a new universe has never traded -- which is the correct claim
 * for it to make, and is exactly what `priceLedger: PriceSeries[] | undefined` exists to express.
 * The other two universe builders were never changed, so they never cleared a ledger that existed.
 *
 * The probe therefore has to do three things in ONE session, in this order:
 *   1. get to a playable league (repair the pool),
 *   2. terminate it, which is what clears the ledger,
 *   3. open Exchange, which is what used to throw.
 *
 * A throw during render leaves a blank frame and an error in the console. Both are reported, and
 * neither alone is a verdict: a blank frame could also be a slow first paint, and a console error
 * could be a harmless warning. The verdict is "the Exchange has content AND no render error".
 *
 * Requires the dev server.
 * Run: npm run dev (separate shell), then node tools/probeTerminateThenExchange.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-termexchange-'));

let chrome = null;
let browser = null;
let sessionId = null;

const errors = [];

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
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        cdp.handlers.forEach((h) => h(msg));
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
  on(fn) { this.handlers.push(fn); }
}

const evaluate = async (expression) => {
  const r = await browser.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  if (r.exceptionDetails) return 'THREW: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

/** Click the first button whose trimmed text contains `want`. Returns what it clicked, or a miss. */
const click = async (want) => evaluate(`(() => {
  const w = ${JSON.stringify(want.toLowerCase())};
  const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="treeitem"]')];
  const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase().includes(w));
  if (!hit) return 'NOT FOUND: ' + w;
  hit.click();
  return 'clicked: ' + (hit.textContent || '').trim();
})()`);

/**
 * Click a button INSIDE the open modal.
 *
 * Scoped deliberately. A document-wide search for "terminate" finds RunBoard's own "Terminate
 * Universe" button first, because it precedes the modal in DOM order -- so an unscoped confirm
 * click closed the modal it was supposed to submit, and the termination never ran. The tool then
 * reported that the ledger had not been cleared, which reads like an app bug and was a harness bug.
 */
const clickInDialog = async (want) => evaluate(`(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return 'NO DIALOG OPEN';
  const w = ${JSON.stringify(want.toLowerCase())};
  const hit = [...dialog.querySelectorAll('button')]
    .find((n) => (n.textContent || '').trim().toLowerCase().includes(w));
  if (!hit) return 'NOT FOUND IN DIALOG: ' + w;
  hit.click();
  return 'clicked in dialog: ' + (hit.textContent || '').trim();
})()`);

/** What the user is actually looking at, in enough detail to tell "rendered" from "blank". */
const readScreen = () => evaluate(`(() => {
  const main = document.querySelector('main') || document.body;
  const text = (main.innerText || '').replace(/\\s+/g, ' ').trim();
  return {
    length: text.length,
    canvas: document.querySelectorAll('canvas').length,
    svg: document.querySelectorAll('svg').length,
    tables: document.querySelectorAll('table').length,
    sample: text.slice(0, 160),
  };
})()`);

/**
 * Expand every collapsed nav folder.
 *
 * Leaves are not in the DOM until their folder is, so a click that misses here looks exactly like an
 * app that refused to navigate. The first version of this probe omitted this step, could not find
 * "Simulate", and went on to report a bug it had not reproduced.
 */
const expandFolders = () => evaluate(`(() => {
  const folders = [...document.querySelectorAll('button[role="treeitem"][aria-expanded]')]
    .filter((f) => f.getAttribute('aria-expanded') !== 'true');
  folders.forEach((f) => f.click());
  return folders.length;
})()`);

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. This probe drives the real app, so start it first:`);
    console.error('    npm run dev\n');
    cleanup();
    process.exit(1);
  }

  const port = 9800 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1400,1000',
    '--hide-scrollbars',
    url,
  ], { stdio: 'ignore' });

  browser = await CDP.attach(await endpoint(port));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Log.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);

  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description ?? d.text ?? 'unknown exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  console.log('\n1. LOAD + REPAIR THE POOL');
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log('  ', await click('repair player pool'));
  // Generating 32 rosters is the long synchronous chain; 20s is generous.
  await sleep(20000);
  const afterRepair = await readScreen();
  console.log(`    league playable: ${afterRepair.length > 200 ? 'yes' : 'NO'} (${afterRepair.length} chars)`);

  /*
    SEED A LEDGER AND A BOOK, because on a throwaway profile both are already empty and the probe
    would prove nothing.

    The first run of this tool terminated a league that had never traded. "No prices yet" was
    therefore correct before the termination too, and a page that renders correctly before and after
    cannot demonstrate a bug that only appears when the ledger is cleared. `undefined` has to be
    REACHED: the Exchange must be handed a ledger on the way in and none on the way out.

    Seeded after the repair, because the repair itself writes league state and would race the seed.
  */
  console.log('\n1b. SEED A LEDGER AND A BOOK (so the termination has something to clear)');
  console.log('  ', await evaluate(`(() => {
    const ledger = [];
    const close = {};
    for (let i = 0; i < 20; i += 1) {
      const day = {};
      day.date = '2026-01-' + String(i + 1).padStart(2, '0');
      day.close = { 'bos-nighthawks': 400 + i };
      ledger.push(day);
    }
    localStorage.setItem('glb_share_price_ledger', JSON.stringify(ledger));
    localStorage.setItem('gpb_hxse_portfolio_v1', JSON.stringify({
      positions: [{ teamId: 'bos-nighthawks', units: 0.5, costCents: 25000, openedOn: '2026-01-01' }],
      cashCents: 75000, realisedCents: 0,
    }));
    return 'seeded ledger(' + ledger.length + ' days) + portfolio';
  })()`));
  await browser.send('Page.reload', {}, sessionId);
  await sleep(7000);
  const seeded = await evaluate(`(() => {
    const l = localStorage.getItem('glb_share_price_ledger');
    const p = localStorage.getItem('gpb_hxse_portfolio_v1');
    return 'ledger ' + (l ? JSON.parse(l).length + ' days' : 'ABSENT') + ', portfolio ' + (p ? 'present' : 'ABSENT');
  })()`);
  console.log('    after reload:', seeded);
  if (!/ledger \d+ days/.test(seeded)) {
    console.log('\n*** THE SEED DID NOT HOLD, so this run cannot test anything. ***');
    cleanup();
    process.exit(1);
  }

  console.log('\n2. TERMINATE THE UNIVERSE (this is what clears the ledger)');
  // The leaf is called "Simulate", not "Simulation" -- navigation/folders.ts:133. Guessing the label
  // is how the first run of this probe silently skipped the entire thing it exists to test.
  console.log('    folders expanded:', await expandFolders());
  await sleep(900);
  console.log('  ', await click('simulate'));
  await sleep(3000);
  console.log('  ', await click('terminate universe'));
  await sleep(1500);
  // The modal has its own confirm button. Read its label rather than assuming it repeats the title.
  console.log('    modal buttons:');
  console.log('     ', await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return 'no dialog open';
    return [...dialog.querySelectorAll('button')]
      .map((b) => (b.textContent || '').trim())
      .filter(Boolean).join(' | ') || 'dialog has no buttons';
  })()`));
  /*
    SAMPLE THE OVERLAY FROM BEFORE THE CLICK, because sampling afterwards cannot see it.

    `buildNewUniverse` is a long synchronous chain. While it runs the main thread is blocked, so a CDP
    `Runtime.evaluate` issued during the build QUEUES and only returns once the build is over -- by
    which time the overlay is gone. Every earlier run of this probe reported "overlay NOT shown" for
    exactly that reason, which is indistinguishable from the overlay genuinely never rendering. A
    measurement that cannot tell those apart is not measuring the thing.

    So: install a requestAnimationFrame sampler FIRST, let it record the body text of every frame
    into a global, and only then click. The build blocks the thread, but the frames BEFORE the block
    -- which are the frames the overlay is supposed to appear on -- were already recorded and survive
    the block. This is the same reasoning as the season-history tool's write log: watch the frames,
    not just the final state.
  */
  console.log('  ', await evaluate(`(() => {
    window.__frames = [];
    window.__sampling = true;
    const tick = () => {
      if (!window.__sampling) return;
      const text = (document.body.innerText || '').replace(/\\s+/g, ' ').trim();
      window.__frames.push(text.slice(0, 140));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return 'sampler installed';
  })()`));
  await sleep(250);
  console.log('  ', await clickInDialog('terminate'));
  await sleep(6000);

  console.log('    overlay during terminate:');
  console.log('     ', await evaluate(`(() => {
    window.__sampling = false;
    const frames = window.__frames || [];
    const overlay = frames.filter((f) => /terminating universe/i.test(f));
    if (overlay.length === 0) {
      return 'OVERLAY NEVER RENDERED -- frames captured: ' + frames.length
        + ' | last frame: ' + JSON.stringify(frames[frames.length - 1] || '').slice(0, 90);
    }
    return 'overlay shown on ' + overlay.length + ' frame(s), e.g. "' + overlay[0].slice(0, 80) + '"';
  })()`));

  await sleep(22000);
  const ledgerState = await evaluate(`(() => {
    const raw = localStorage.getItem('glb_share_price_ledger');
    const port = localStorage.getItem('gpb_hxse_portfolio_v1');
    return { ledger: raw === null ? 'absent' : raw.length, portfolio: port === null ? 'absent' : port.length };
  })()`);
  console.log(`    ledger in storage: ${ledgerState.ledger}, portfolio: ${ledgerState.portfolio}`);

  const afterTermScreen = await readScreen();
  console.log(`    landed on: "${afterTermScreen.sample.slice(0, 90)}"`);

  if (ledgerState.ledger !== 'absent') {
    console.log('\n*** THE TERMINATION DID NOT CLEAR THE LEDGER, so this run cannot test the Exchange. ***');
    cleanup();
    process.exit(1);
  }

  console.log('\n3. OPEN THE EXCHANGE (this is what used to throw)');
  console.log('    folders expanded:', await expandFolders());
  await sleep(900);
  const opened = await click('exchange');
  console.log('  ', opened);
  await sleep(4000);

  const screen = await readScreen();
  console.log(`    rendered: ${screen.length} chars, ${screen.canvas} canvas, ${screen.svg} svg, ${screen.tables} tables`);
  console.log(`    sample: "${screen.sample}"`);

  const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  const out = 'C:/Users/ADMIN/AppData/Local/Temp/terminate-then-exchange.png';
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('    screenshot:', out);

  /*
    THE VERDICT IS "DID IT RENDER THE EXCHANGE", NOT "IS THE TEXT LONG".

    An empty market renders a real page: a masthead, the portfolio readout, and an explicit "No prices
    yet". That is the CORRECT outcome after a termination, because a new universe has never traded --
    it is the same honest `undefined` the ledger state exists to express. Scoring that as a blank
    screen would fail a correct build, which is how a probe teaches the next person to ignore it.

    So the check is for the Exchange's own words plus any thrown error. A blank frame, a missing
    masthead, or an exception in `latestClose` all fail; "No prices yet" passes.
  */
  const renderedTheExchange = /hanax stock exchange/i.test(screen.sample) || /no prices yet/i.test(screen.sample);
  const threw = errors.filter((e) => /latestClose|Cannot read propert|is not a function|of undefined/.test(e));

  if (threw.length > 0) {
    console.log('\n--- render errors ---');
    threw.forEach((e) => console.log('  ', String(e).split('\n')[0]));
  }

  if (!renderedTheExchange || threw.length > 0) {
    console.log('\n*** THE EXCHANGE DOES NOT RENDER AFTER A TERMINATION. THIS IS THE REPORTED BUG. ***\n');
    cleanup();
    process.exit(1);
  }

  console.log('\nThe Exchange renders after a termination, with no render error.');
  console.log('It correctly shows the empty-market state, because a new universe has never traded.\n');
  cleanup();
  process.exit(0);
};

main().catch((err) => {
  console.error('\nPROBE FAILED:', err.message);
  cleanup();
  process.exit(1);
});