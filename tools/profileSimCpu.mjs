/**
 * CPU profile of a live sim, to name the function that owns the long tasks.
 *
 * Usage: node tools/profileSimCpu.mjs [url] [days]
 * Prints the top self-time frames from a `Profiler.start` / `Profiler.stop` pair
 * taken across N simulated days, grouped by source file where possible.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] ?? 'http://localhost:3000/';
const days = Number(process.argv[3] ?? 3);

const profile = mkdtempSync(join(tmpdir(), 'gpb-prof-'));
const port = 9800 + Math.floor(Math.random() * 300);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1600,1100', '--hide-scrollbars',
  url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint() {
  for (let i = 0; i < 60; i += 1) {
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
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
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
    const id = this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }
}

const main = async () => {
  const browser = await CDP.attach(await endpoint());
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(4000);

  const evaluate = async (expression, awaitPromise = false) => {
    const { result, exceptionDetails } = await browser.send(
      'Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId,
    );
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };

  const click = async (re) => evaluate(`(() => {
    const want = ${re};
    const n = [...document.querySelectorAll('button,a,[role="treeitem"]')]
      .find((x) => want.test((x.textContent||'').trim()));
    if (!n) return false; n.click(); return true;
  })()`);

  // Repair the pool, then land on the dashboard.
  for (let t = 0; t < 150; t += 1) {
    if (await click('/rebuild/i')) break;
    await sleep(1000);
  }
  await sleep(1500);
  await click('/^Dashboard$/i');
  await sleep(1500);

  await browser.send('Profiler.enable', {}, sessionId);
  await browser.send('Profiler.setSamplingInterval', { interval: 200 }, sessionId);
  await browser.send('Profiler.start', {}, sessionId);

  const t0 = Date.now();
  for (let i = 0; i < days; i += 1) {
    if (!await click('/^Sim Day$/i')) { await sleep(1500); continue; }
    await sleep(2800);
    await click('/back to dashboard/i');
    await sleep(800);
    process.stdout.write(`day ${i + 1} `);
  }
  const wall = Date.now() - t0;

  const { profile: p } = await browser.send('Profiler.stop', {}, sessionId);
  const total = p.samples.length;
  const byId = new Map(p.nodes.map((n) => [n.id, n]));

  // Self time per node, aggregated onto a readable label.
  const self = new Map();
  for (const id of p.samples) {
    const n = byId.get(id);
    if (!n) continue;
    const f = n.callFrame;
    const url2 = (f.url || '').split('?')[0].replace('http://localhost:3000/', '');
    const label = `${f.functionName || '(anonymous)'}  @  ${url2}:${f.lineNumber + 1}`;
    self.set(label, (self.get(label) || 0) + 1);
  }

  console.log(`\n\nsampled ${total} frames over ${(wall / 1000).toFixed(1)}s of ${days} sim day(s)\n`);
  console.log('SELF TIME, TOP 30');
  [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([label, n]) => {
      const pct = ((n / total) * 100).toFixed(1);
      console.log(`  ${pct.padStart(5)}%  ${(n / (total / 100)).toFixed(0).padStart(6)}ms  ${label}`);
    });

  // Also aggregate per file, which is the level you act at.
  const perFile = new Map();
  for (const id of p.samples) {
    const n = byId.get(id);
    if (!n) continue;
    const file = (n.callFrame.url || '(native)').split('?')[0].replace('http://localhost:3000/', '');
    perFile.set(file, (perFile.get(file) || 0) + 1);
  }
  console.log('\nSELF TIME BY FILE, TOP 20');
  [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .forEach(([file, n]) => console.log(`  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${file}`));

  await shutdown();
};

/**
 * Chrome keeps a lock on its crashpad files for a moment after `kill`, so a bare `rmSync` of the
 * profile directory fails with EBUSY on Windows -- and that failure then reads as "the profiler
 * crashed", which is the opposite of true. The profile is already printed by this point, so the
 * cleanup is best-effort and the exit code stays 0.
 */
const shutdown = async () => {
  chrome.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* a locked crashpad file is not a profiling failure */ }
};

main().catch(async (e) => {
  console.error('PROFILE FAILED:', e.message);
  await shutdown();
  process.exit(1);
});