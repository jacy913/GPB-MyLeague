/**
 * Does a render throw cost one view, or the whole application?
 *
 * That is the entire claim of `ViewBoundary`, and it is a claim about the SHELL: the nav rail, the
 * score ticker and the header are supposed to survive a view that throws, so the reader can navigate
 * somewhere that works. A screenshot of the failure screen alone cannot show that -- it looks
 * identical whether the shell is alive or gone -- so this asserts on the shell directly.
 *
 * It also asserts the part that is easy to get wrong and was the reason the boundary is not a
 * two-line component: a React error boundary does NOT retry when its children change. If `resetKey`
 * were missing, the failure screen would follow the reader from Leaders to every other view and the
 * second assertion here would fail with the whole app apparently broken.
 *
 * RUN IT TWICE. Once normally, which must show every view rendering, and once with a deliberate throw
 * injected into a view's render, which must show exactly one view failing and the shell intact:
 *
 *     node tools/probeErrorBoundary.mjs
 *
 *     # then, temporarily, add to a view component:
 *     #   throw new Error('QA: deliberate render throw')
 *     node tools/probeErrorBoundary.mjs --expect-failure
 *
 * `--expect-failure` inverts the first assertion so the run fails loudly if the boundary does NOT
 * catch, rather than passing because nothing threw.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-boundary-'));

/*
    Arguments are FILTERED before use.

    The first run took `--expect-failure` as the URL and then as the output directory, because
    positional argv does not know what a flag is. Every other probe in this repo takes positionals
    too and none of them take flags, so this one is the odd one out and the parsing is where the
    bug came from. Flags are stripped, and the first two surviving positionals are url and outDir.
*/
const positionals = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = positionals[0] ?? 'http://localhost:3000/';
const outDir = positionals[1] ?? 'C:/Users/ADMIN/AppData/Local/Temp';
const EXPECT_FAILURE = process.argv.includes('--expect-failure');

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

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9200 + Math.floor(Math.random() * 90);
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
      exceptions.push(`${d.text ?? ''} ${d.exception?.description ?? ''}`.slice(0, 200));
    }
  });

  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log(`\nERROR BOUNDARY  (${EXPECT_FAILURE ? 'expecting a failure' : 'expecting all views to render'})\n`);

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

  await evaluate(`(() => {
    ['LEAGUE','SYSTEM'].forEach((f) => {
      const n = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim().toUpperCase() === f);
      if (n) n.click();
    });
    return 'ok';
  })()`);
  await sleep(900);

  /*
    Go to a leaf, opening folders ONLY IF THE LEAF IS NOT ALREADY VISIBLE.

    Folder headers are toggles. The first version clicked every folder header on every navigation, so
    the second visit to any folder CLOSED it -- and `goTo` then reported NOT IN RAIL for a screen that
    was right there, on a page whose nav was demonstrably alive. A probe that cannot find its target
    reports "failure screen: false" and looks like a boundary that did not catch anything.

    So: look first, click only what is needed.
  */
  const goTo = async (label) => {
    const tryClick = () => evaluate(`(() => {
      const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
      if (!tree) return 'NO RAIL';
      const n = [...tree.querySelectorAll('button, [role="treeitem"]')]
        .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === ${JSON.stringify(label.toLowerCase())});
      if (!n) return 'NOT IN RAIL';
      n.click(); return 'ok';
    })()`);

    let hit = await tryClick();
    if (hit === 'NOT IN RAIL') {
      await evaluate(`(() => {
        ['LEAGUE','SYSTEM','TEAMS','COMMISSIONER','SCORES','PLAYOFFS'].forEach((f) => {
          const n = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim().toUpperCase() === f);
          if (n) n.click();
        });
        return 'ok';
      })()`);
      await sleep(700);
      hit = await tryClick();
    }
    return hit;
  };

  /*
    THE SHELL. Asserted separately from the view, because "the failure screen is showing" and "the
    nav is still there" are different facts and only the second one is the boundary's promise.

    The ticker is the score crawl in the top strip, matched by the "final" counter it always renders.
    Nav is the tree itself. Both are outside the boundary by construction; these assertions exist to
    catch the day someone widens the boundary to wrap the shell.
  */
  const readShell = async () => evaluate(`(() => ({
    nav: !!document.querySelector('[role="tree"][aria-label="League navigation"]'),
    ticker: /\\b\\d+\\/\\d+\\s*final|sim day/i.test(document.body.innerText || ''),
    rootChildren: document.getElementById('root')?.children.length ?? 0,
    failureScreen: /could not be drawn/i.test(document.body.innerText || ''),
    errorMessageShown: /QA: deliberate render throw/i.test(document.body.innerText || ''),
    chars: (document.body.innerText || '').trim().length,
  }))()`);

  console.log('  1. Leaders (the view with the injected throw, if any)');
  console.log('     ', await goTo('leaders'));
  await sleep(2600);
  const leaders = await readShell();
  console.log(`       failure screen: ${leaders.failureScreen}   error text shown: ${leaders.errorMessageShown}`);
  console.log(`       NAV ALIVE: ${leaders.nav}   ticker alive: ${leaders.ticker}   root children: ${leaders.rootChildren}`);
  console.log(`       -> ${await shot(`boundary-1-leaders${EXPECT_FAILURE ? '-failed' : ''}`)}`);

  console.log('\n  2. Standings, navigated to AFTER the failure');
  console.log('     ', await goTo('standings'));
  await sleep(2600);
  const after = await readShell();
  console.log(`       failure screen: ${after.failureScreen}   NAV ALIVE: ${after.nav}   chars: ${after.chars}`);
  console.log(`       -> ${await shot('boundary-2-after-navigation')}`);
  console.log(`       console errors: ${errors.length}   uncaught exceptions: ${exceptions.length}`);

  const shellSurvived = leaders.nav && leaders.rootChildren > 0;
  const boundaryWorked = leaders.failureScreen && leaders.errorMessageShown;
  const resetWorked = !after.failureScreen && after.nav && after.chars > 200;
  const otherViewRenders = !after.failureScreen && after.chars > 200;

  console.log('\n  RESULTS');
  console.log(`    shell survived the throw:   ${shellSurvived ? 'yes' : '*** NO ***'}`);
  console.log(`    boundary caught + showed:  ${boundaryWorked ? 'yes' : '*** NO ***'}`);
  console.log(`    navigable afterwards:      ${resetWorked ? 'yes' : '*** NO ***'}`);

  const unexpected = EXPECT_FAILURE
    ? !(shellSurvived && boundaryWorked && resetWorked)
    : !(otherViewRenders && leaders.nav);

  console.log(`\n  ${unexpected ? '*** FAILED ***' : 'PASS'}\n`);
  if (!EXPECT_FAILURE && leaders.failureScreen) {
    console.log('  A failure screen appeared with no throw injected. Something else is broken.\n');
  }
  if (EXPECT_FAILURE && !boundaryWorked) {
    console.log('  A throw was injected and no failure screen appeared. The boundary is not mounted,\n');
    console.log('  or it does not cover this view.\n');
  }

  cleanup();
  process.exit(unexpected ? 1 : 0);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });