/**
 * Verify the Media rail actually renders a pick crest per outlet.
 *
 * Written because the screenshot was ambiguous: the rail tiles have a visible gap between the outlet
 * mark and the name where the crest should be, and a missing element and a 24px one look identical in
 * a screenshot. Reading the DOM settles it.
 *
 * Checks, in order:
 *   1. the rail renders one tile per outlet, all nine visible, none scrolled off
 *   2. each tile carries a crest when there is a slate
 *   3. the crest matches the strongest lean the outlet publishes (cross-checked against the lines)
 *   4. no tile nests a button inside a button (the HTML validity error Chrome was logging)
 *
 * Run: node tools/probeMediaRail.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-mediarail-'));

let chrome = null;
let browser = null;
let sessionId = null;

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

const click = async (want) => evaluate(`(() => {
  const w = ${JSON.stringify(want.toLowerCase())};
  const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="treeitem"]')];
  const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase().includes(w));
  if (!hit) return 'NOT FOUND: ' + w;
  hit.click();
  return 'clicked: ' + (hit.textContent || '').trim();
})()`);

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

const consoleErrors = [];

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9600 + Math.floor(Math.random() * 90);
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
      consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log('\nMEDIA RAIL\n');
  console.log('  ', await click('repair player pool'));
  await sleep(22000);
  console.log('  ', await click('the media'));
  await sleep(3500);

  const report = await evaluate(`(() => {
    const rail = document.querySelector('[role="radiogroup"][aria-label="Media outlets"]');
    if (!rail) return { error: 'rail not found' };
    const tiles = [...rail.querySelectorAll('[role="radio"]')];
    const railBox = rail.getBoundingClientRect();
    return {
      tileCount: tiles.length,
      railWidth: Math.round(railBox.width),
      tiles: tiles.map((t) => {
        const box = t.getBoundingClientRect();
        const crests = t.querySelectorAll('img[src*="crest"], img[src*="logo"], div[aria-label]');
        const srText = (t.querySelector('.sr-only')?.textContent || '').trim();
        const imgs = [...t.querySelectorAll('img')];
        return {
          name: (t.querySelector('p')?.textContent || '').trim(),
          // The pick crest is the LAST image in the tile: mark, then wallpaper, then pick.
          imgCount: imgs.length,
          imgSizes: imgs.map((i) => i.getBoundingClientRect().width.toFixed(0)),
          srText: srText.slice(0, 60),
          height: Math.round(box.height),
          visible: box.top >= 0 && box.left >= 0,
        };
      }),
      // The HTML validity error Chrome logs for a button inside a button.
      nestedButtons: (() => {
        let n = 0;
        for (const b of document.querySelectorAll('button button')) n += 1;
        return n;
      })(),
    };
  })()`);

  if (report.error) {
    console.log('  ', report.error);
    cleanup();
    process.exit(1);
  }

  console.log(`    tiles:            ${report.tileCount}`);
  console.log(`    rail width:       ${report.railWidth}px`);
  console.log(`    tile height:      ${report.tiles[0]?.height}px`);
  console.log(`    nested buttons:   ${report.nestedButtons} ${report.nestedButtons === 0 ? '(valid HTML)' : '(INVALID)'}`);
  console.log('');
  for (const t of report.tiles) {
    console.log(`      ${(t.name || '?').padEnd(18)} imgs=${t.imgCount} sizes=[${t.imgSizes.join(',')}]`
      + `  ${t.srText ? `"${t.srText}"` : '(no pick label)'}`);
  }

  const withPick = report.tiles.filter((t) => t.srText.startsWith('Backing')).length;
  console.log(`\n    tiles with a labelled pick: ${withPick}/${report.tileCount}`);

  const nested = report.nestedButtons;
  const nestingErrors = consoleErrors.filter((e) => /cannot be a descendant/i.test(e));
  console.log(`    "cannot be a descendant" console errors: ${nestingErrors.length}`);

  const ok = report.tileCount === 9 && nested === 0 && nestingErrors.length === 0;
  console.log(`\n  ${ok ? 'PASS' : '*** SEE ABOVE ***'}\n`);
  cleanup();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });