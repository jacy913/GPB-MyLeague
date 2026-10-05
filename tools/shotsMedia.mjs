/**
 * Screenshot each tab of The Media and check the browser console, in one run.
 *
 * The rail probe reads the DOM and cannot see whether the page LOOKS right. This one opens the view,
 * walks the three tabs, and writes a PNG of each so the layout can be judged rather than asserted.
 *
 * Run: node tools/shotsMedia.mjs [outDir]
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-mediashots-'));
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

const click = async (want) => evaluate(`(() => {
  const w = ${JSON.stringify(want.toLowerCase())};
  const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="radio"], [role="treeitem"]')];
  const hit = nodes.find((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().toLowerCase().includes(w));
  if (!hit) return 'NOT FOUND: ' + w;
  hit.click();
  return 'clicked: ' + (hit.getAttribute('aria-label') || hit.textContent || '').trim();
})()`);

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

const errors = [];

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9700 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1600,2400', '--hide-scrollbars', url,
  ], { stdio: 'ignore' });

  browser = await CDP.attach(await endpoint(port));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      /*
        The `%s` placeholders in React's warnings are filled from `args`, and the interesting part --
        which style property conflicts with which -- is in there. Joining only `.value` throws the
        answer away, because these args are strings React formats, not primitives, and the report
        comes back as eight identical useless lines.
      */
      const args = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? '');
      errors.push(args.join(' '));
    }
  });

  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log('\nMEDIA TABS\n');
  console.log('  ', await click('repair player pool'));
  await sleep(22000);
  console.log('  ', await click('the media'));
  await sleep(3500);

  const tabs = ['Published Lines', 'Ranking', 'Disagreement'];
  for (const [i, tab] of tabs.entries()) {
    console.log('  ', await click(tab));
    await sleep(1400);
    console.log(`    -> ${await shot(`media-tab-${i}-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`)}`);
  }

  /*
    THE SCORE CRAWL, checked as a live computed style rather than trusted.

    Its `animation` was just rewritten from the shorthand to five longhands so React would stop
    warning about `animationPlayState`. A rewrite like that is exactly where a silent regression
    hides -- the shorthand parses `score-crawl 60s linear infinite` into four longhands, and a typo in
    the hand-expanded form (wrong name, iteration count of 1, duration of 0) leaves a crawl that
    renders perfectly and never moves. So the running animation is measured, not eyeballed.

    Two reads a second apart: if the transform is identical both times under a running animation, the
    strip is static and something in the rewrite stopped it.
  */
  const crawl = await evaluate(`(() => {
    const all = [...document.querySelectorAll('div')].filter((d) => {
      const s = getComputedStyle(d);
      return s.animationName && s.animationName !== 'none';
    });
    return all.map((d) => {
      const s = getComputedStyle(d);
      return {
        name: s.animationName,
        duration: s.animationDuration,
        iter: s.animationIterationCount,
        state: s.animationPlayState,
        transform: s.transform,
      };
    });
  })()`);
  await sleep(2000);
  const crawlLater = await evaluate(`(() => {
    const all = [...document.querySelectorAll('div')].filter((d) => {
      const s = getComputedStyle(d);
      return s.animationName && s.animationName !== 'none';
    });
    return all.map((d) => getComputedStyle(d).transform);
  })()`);

  console.log('\n    SCORE CRAWL');
  if (!crawl.length) {
    console.log('      (no running animation found -- crawl may be disabled)');
  }
  crawl.forEach((c, i) => {
    const moved = crawlLater[i] !== c.transform;
    console.log(`      ${c.name} ${c.duration} x${c.iter} ${c.state}`
      + `   ${moved ? 'MOVING' : '*** STATIC ***'}`);
  });

  console.log(`\n    console errors: ${errors.length}`);
  const seen = new Set();
  for (const e of errors) {
    const line = e.replace(/%s/g, (m, i) => '§').slice(0, 400);
    if (seen.has(line)) continue;
    seen.add(line);
    console.log(`      ${line}`);
  }

  cleanup();
  process.exit(0);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });