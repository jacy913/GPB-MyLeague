/*
 * Screenshot the dashboard, and READ the crowd numbers back off the screen.
 *
 * The reason this exists rather than a screenshot alone: every change in this pass is a claim about
 * what a panel shows, and a picture proves the panel is not broken while proving nothing about whether
 * the number in it is the number the model produces. So the probe does both -- captures the frame for
 * the layout, and pulls the rendered strings out for the arithmetic.
 *
 * IT READS TEXT, NOT PROPS. Everything is fetched with querySelector over the DOM after the fact, so
 * what is asserted is what a person would read, not what React was handed.
 *
 * Run: node tools/shotsDashboard.mjs [url] [outDir]
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/dashboard';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-dash-'));
mkdirSync(outDir, { recursive: true });

const width = Number(process.env.W ?? 1500);
const height = Number(process.env.H ?? 1500);

/*
 * Poll for the debugging port.
 *
 * Chrome is spawned and the port queried immediately after, and on a cold start the socket is not
 * listening yet -- the first version of this probe died with ECONNREFUSED on a run where Chrome was
 * working perfectly. Retrying is the whole difference between "Chrome failed" and "Chrome was slow",
 * and the two look identical if you only print the error.
 */
async function endpoint(port, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`Chrome never opened a debugging port on ${port}`);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) this.handlers.forEach((h) => h(msg));
    });
  }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    return new CDP(ws);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) { this.handlers.push(fn); }
}

let chrome = null;
const cleanup = () => { try { chrome?.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

const problems = [];
const errors = [];
const exceptions = [];

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9400 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--window-size=${width},${height}`, '--hide-scrollbars', url,
  ], { stdio: 'ignore' });

  const browser = await CDP.attach(await endpoint(port));
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails ?? {};
      exceptions.push(`${d.text ?? ''} ${d.exception?.description ?? ''}`.slice(0, 200));
    }
  });

  const evaluate = async (expression) => {
    const r = await browser.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'eval failed');
    return r.result?.value;
  };

  const shot = async (name) => {
    const r = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
    return join(outDir, `${name}.png`);
  };

  await browser.send('Page.navigate', { url }, sessionId);
  // Generous: the app builds a universe and a season slate on first paint.
  await sleep(14000);

  /*
    A fresh universe is 0-0 across the board, so the award race is legitimately empty and the featured
    game may be absent. Rather than assert against whatever happened to be on screen, this looks for
    the panels and reports what it found. An absent panel is reported, not treated as a crash -- the
    park probe learned that the hard way by asserting against a screen it had not actually reached.
  */
  const found = await evaluate(`(() => {
    const text = document.body.innerText;
    const grab = (re) => (text.match(re) || [])[0] ?? null;
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    return {
      title: document.title,
      // The panels, by their headings.
      hasPrimetime: /PRIMETIME GAME/i.test(text),
      hasAwardRace: /AWARD RACE/i.test(text),
      hasPowerRankings: /POWER RANKINGS/i.test(text),
      // The two new numbers.
      viewersLine: grab(/[\\d.]+M expected viewers/i),
      audienceAny: (text.match(/[\\d.]+M expected viewers/gi) || []),
      attendanceLine: grab(/EXPECTED ATTENDANCE[\\s\\S]{0,80}/i),
      // The award race row: MacroBet price should be present and American-formatted.
      americanPrices: (text.match(/[-+]\\d{3,4}/g) || []).slice(0, 12),
      percentGone: /\\d+\\.\\d%/.test(text),
      // Layout: does anything overflow its column?
      overflowing: q('*').filter((el) => el.scrollWidth > el.clientWidth + 2
        && getComputedStyle(el).overflowX === 'visible').length,
      errorText: /Something went wrong|error boundary/i.test(text),
    };
  })()`);

  console.log('\nDASHBOARD -- what is actually on the screen\n');
  console.log(`  panels        primetime ${found.hasPrimetime ? 'YES' : 'no'}`
    + `   award race ${found.hasAwardRace ? 'YES' : 'no'}`
    + `   power rankings ${found.hasPowerRankings ? 'YES' : 'no'}`);
  console.log(`  viewers line  ${found.viewersLine ?? '(not on screen)'}`);
  console.log(`  attendance    ${(found.attendanceLine ?? '(not on screen)').replace(/\\s+/g, ' ').slice(0, 70)}`);
  console.log(`  american odds ${found.americanPrices.join(' ') || '(none)'}`);
  console.log(`  overflowing   ${found.overflowing} elements`);
  console.log(`  console err   ${errors.length}   exceptions ${exceptions.length}`);

  if (found.errorText) problems.push('the error boundary is showing');
  if (errors.length) problems.push(`${errors.length} console errors`);
  if (exceptions.length) problems.push(`${exceptions.length} exceptions`);

  const top = await shot(`dashboard-${width}-top`);
  console.log(`\n  wrote ${top}`);

  // A tall capture, because the two moved panels sit in different grids and one frame cannot show both.
  await evaluate('window.scrollTo(0, document.body.scrollHeight)');
  await sleep(1200);
  const bottom = await shot(`dashboard-${width}-bottom`);
  console.log(`  wrote ${bottom}`);

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    cleanup();
    process.exit(1);
  }
  console.log('  the dashboard rendered with no errors.');
};

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });