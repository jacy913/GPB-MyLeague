/**
 * Does the dashboard render AT ALL?
 *
 * A separate tool from the probes, and deliberately much smaller than them. When
 * tools/probeSlateHeader.mjs reports that the Simulation Desk is not on screen and the page has no
 * headings at all, the useful next question is not "which of my 14 assertions failed" -- it is "is this
 * app broken, or is my harness broken". Those have very different fixes and the expensive probes cannot
 * tell them apart: they all report the same empty result.
 *
 * So this loads the page, waits a fixed moment, and reports three things that separate the cases:
 *
 *   - CONSOLE ERRORS. A Vite transform failure, a bad import or a thrown render shows up here, and
 *     nowhere else in the probe output.
 *   - ROOT ELEMENT COUNT. Whether React mounted anything at all.
 *   - VISIBLE TEXT. Which gate the app is sitting on. "repair player pool" means it is waiting on the
 *     universe rebuild and the probe simply has not waited long enough; blank means it never rendered.
 *
 * Run: node tools/checkRenders.mjs [url]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3005/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-renders-'));
const port = 9400 + Math.floor(Math.random() * 400);

let browser = null;
let sessionId = null;

async function endpoint() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never opened a debugging port');
}

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1600,1200', '--hide-scrollbars', url,
], { stdio: 'ignore' });

const evaluate = async (expression) => {
  const r = await browser.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text ?? 'evaluate threw');
  }
  return r.result?.value;
};

const consoleErrors = [];

try {
  const wsUrl = await endpoint();
  const sock = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    sock.once('open', resolve);
    sock.once('error', reject);
  });

  let id = 0;
  const pending = new Map();
  sock.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
      consoleErrors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params?.exceptionDetails?.text ?? 'exception thrown');
    }
  });

  browser = {
    send: (method, params = {}, target) => new Promise((resolve, reject) => {
      id += 1;
      pending.set(id, { resolve, reject });
      sock.send(JSON.stringify({ id, method, params, sessionId: target }));
    }),
  };

  const { targetInfos } = await browser.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const attached = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  sessionId = attached.sessionId;
  await browser.send('Runtime.enable', {}, sessionId);
  await sleep(6000);

  const state = await evaluate(`(() => {
    const root = document.getElementById('root');
    const text = (document.body.innerText || '').trim();
    return {
      mounted: !!root && root.children.length > 0,
      rootChildren: root ? root.children.length : 0,
      h2Count: document.querySelectorAll('h2').length,
      buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 12),
      textLength: text.length,
      textHead: text.slice(0, 200).replace(/\\s+/g, ' '),
      images: [...document.querySelectorAll('img')].map((i) => ({
        alt: i.alt, complete: i.complete, w: i.naturalWidth,
      })),
    };
  })()`);

  console.log(`\nRENDER CHECK ${url}\n`);
  console.log(`  mounted          ${state.mounted} (${state.rootChildren} root children)`);
  console.log(`  h2 headings      ${state.h2Count}`);
  console.log(`  text length      ${state.textLength}`);
  console.log(`  first buttons    ${state.buttons.join(' | ') || '(none)'}`);
  console.log(`  text             "${state.textHead}"`);

  const broken = state.images.filter((i) => i.complete && i.w === 0);
  console.log(`  images           ${state.images.length} total, ${broken.length} broken`);
  for (const b of broken) console.log(`      BROKEN alt="${b.alt}"`);

  console.log(`\n  console errors   ${consoleErrors.length}`);
  for (const e of consoleErrors.slice(0, 8)) console.log(`      ${String(e).slice(0, 220)}`);

  const ok = state.mounted && state.h2Count > 0 && consoleErrors.length === 0 && broken.length === 0;
  console.log(`\n  ${ok ? 'the app renders cleanly' : 'the app is NOT rendering cleanly'}\n`);
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error('check failed:', error.message);
  process.exitCode = 1;
} finally {
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  chrome.kill();
}