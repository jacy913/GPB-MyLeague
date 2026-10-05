/**
 * Does the power rankings story lead the deck on a pristine universe?
 *
 * The dashboard renders `powerRankingsStory` as the lead slide when there are no completed games and no
 * transaction stories -- which is exactly the state after Terminate Universe, and the one the empty
 * dashboard was reported from. The strip on the same page proves `powerRankings` arrives, so if the
 * story is not leading, the fault is between the prop and `generateHeadlineDeck`, not in the board.
 *
 * Reads the carousel's own slide count and the text of every slide, because "is slide 1 the rankings
 * story" is the property and the deck's internal priority sort is not.
 *
 * Run: node tools/probePowerRankingsHeadline.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-prhead-'));

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
  send(method, params = {}, sid) {
    this.id += 1;
    const payload = { id: this.id, method, params };
    if (sid) payload.sessionId = sid;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.waiting.set(this.id, { resolve, reject }));
  }
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
    '--window-size=1500,1100', '--hide-scrollbars', url,
  ], { stdio: 'ignore' });

  browser = await CDP.attach(await endpoint(port));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);

  console.log('\nPOWER RANKINGS HEADLINE\n');
  console.log('  ', await click('repair player pool'));
  await sleep(22000);

  /*
    CLICK BACK TO SLIDE 1 BEFORE READING, or the probe measures the carousel's clock.

    `HeadlinePanel` advances every `SLIDE_INTERVAL_MS` (7000) and re-arms on each change. This probe
    waits 22s after repairing, so by the time it reads, the index has advanced three times and landed
    on slide 2 -- the pennant note -- and slide 1's text is no longer in the DOM at all. The first
    version of this probe therefore reported "the rankings story is absent" for a feature that was
    working, which is worse than no probe: it reads as a product failure.

    So: return to slide 1 explicitly, then read. Each dot's aria-label is "Headline N of M", which is
    the panel's own naming, so nothing here is guessed.
  */
  console.log('   ', await evaluate(`(() => {
    const dots = [...document.querySelectorAll('[aria-label^="Headline "]')];
    const first = dots.find((d) => /^Headline 1 of /.test(d.getAttribute('aria-label') || ''));
    if (!first) return 'no slide-1 dot found; dots=' + dots.length;
    first.click();
    return 'returned to slide 1 of ' + dots.length;
  })()`));
  await sleep(700);

  const report = await evaluate(`(() => {
    const text = (document.body.innerText || '').replace(/\\s+/g, ' ');
    const dots = [...document.querySelectorAll('[aria-label^="Headline "]')];
    const activeDot = dots.find((d) => d.getAttribute('aria-selected') === 'true');
    const shown = document.querySelector('h1');
    return {
      stripPresent: /POWER RANKINGS/i.test(text),
      slideCount: dots.length,
      activeSlide: activeDot ? activeDot.getAttribute('aria-label') : '(none selected)',
      headlineShown: shown ? (shown.textContent || '').trim() : '(no h1)',
      hasPennant: /PENNANT RACE BEGINS/i.test(text),
      hasRankingsStory: /TOP THE POWER RANKINGS/i.test(text),
    };
  })()`);

  console.log(`    strip rendered:         ${report.stripPresent}`);
  console.log(`    slides:                 ${report.slideCount}, active ${report.activeSlide}`);
  console.log(`    headline on screen:     "${report.headlineShown}"`);
  console.log(`    pennant note present:   ${report.hasPennant}`);
  console.log(`    rankings story present: ${report.hasRankingsStory ? 'yes' : 'NO'}`);

  const leads = /TOP THE POWER RANKINGS/i.test(report.headlineShown);
  console.log(`\n  ${leads
    ? 'PASS -- the rankings story leads on a pristine universe'
    : '*** THE RANKINGS STORY IS NOT LEADING. The empty-deck branch is not receiving it. ***'}`);
  console.log('');
  cleanup();
  process.exit(leads ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });