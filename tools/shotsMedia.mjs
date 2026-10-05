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
  const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="treeitem"]')];
  const hit = nodes.find((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().toLowerCase().includes(w));
  if (!hit) return 'NOT FOUND: ' + w;
  hit.click();
  return 'clicked: ' + (hit.getAttribute('aria-label') || hit.textContent || '').trim();
})()`);

/**
 * Exact-text click, for short control labels that are substrings of other things.
 *
 * A substring click on "all" lands on "Select Gary Sallow" -- S-a-l-l-o-w contains "all" -- and the
 * probe then reports the filter as irreversible while the filter is fine. Any control whose label is
 * three letters needs this rather than the forgiving matcher above.
 */
const clickExact = async (want) => evaluate(`(() => {
  const w = ${JSON.stringify(want.toLowerCase())};
  const nodes = [...document.querySelectorAll('button, [role="radio"]')];
  const hit = nodes.find((n) => {
    const t = (n.textContent || '').trim().toLowerCase();
    return t === w || t.startsWith(w + ' ');
  });
  if (!hit) return 'NOT FOUND: ' + w;
  hit.click();
  return 'clicked: ' + (hit.textContent || '').trim();
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
const exceptions = [];

/*
 * Go to a view and CONFIRM it, rather than reporting that a click was issued.
 *
 * A plain `click('the media')` returns "clicked: The Media" whether or not the view changed, and the
 * run then spent eight clicks on a Dashboard looking for tabs that were never going to appear. The
 * click succeeded and the navigation did not -- which is exactly the case a click helper cannot see,
 * because the thing it reports is the thing that worked.
 *
 * So this waits for the page's own heading to name the target view, and re-issues the click through an
 * overlay-clearing path if it has not arrived. Every failure afterwards is then a real failure of the
 * view rather than a navigation that quietly went nowhere.
 *
 * The heading pattern is a SOURCE string compiled with `new RegExp` inside the page, not a literal
 * interpolated as one -- `"/the media/i".test(...)` is a string method and throws, which made the
 * first version report "FAILED to reach" for a navigation that had plainly succeeded.
 */
const gotoView = async (label, headingPattern) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Clear anything modal left over from a simulation before reaching for the rail.
    await evaluate(`(() => {
      const d = [...document.querySelectorAll('button')]
        .find((n) => /back to dashboard|close|dismiss/i.test((n.textContent || '').trim()));
      if (d) d.click();
      return 'cleared';
    })()`);
    const hit = await click(label);
    if (hit.startsWith('NOT FOUND')) return hit;
    for (let t = 0; t < 20; t += 1) {
      const there = await evaluate(`(() => {
        const h = [...document.querySelectorAll('h1')]
          .find((x) => new RegExp(${JSON.stringify(headingPattern)}, 'i').test((x.textContent || '').trim()));
        return h ? 'yes' : 'no';
      })()`);
      if (there === 'yes') return hit;
      await sleep(600);
    }
    console.log(`      (${label}: click ${attempt + 1} did not navigate, retrying)`);
  }
  return `FAILED to reach ${label}`;
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
    /*
      Runtime.exceptionThrown, which the error list above misses entirely.

      This is why a blank page came back clean. When React throws during render it does not always
      arrive as a console.error -- an error boundary that renders null, or an exception inside a
      promise, surfaces as a `Runtime.exceptionThrown` event instead, and this probe was filtering on
      consoleAPICalled only. So it reported "0 console errors" on a page whose React root had ZERO
      children, which is the one combination that should have been impossible to read as healthy.

      Captured separately and printed unconditionally, because "the page is blank and nothing was
      logged" is only believable if you have listened on both channels.
    */
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails ?? {};
      exceptions.push(
        `${d.text ?? ''} ${d.exception?.description ?? d.exception?.value ?? ''}`.slice(0, 400),
      );
    }
  });

  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(6000);
  console.log('\nMEDIA TABS\n');
  console.log('  ', await click('repair player pool'));
  await sleep(22000);

  /*
    PLAY ENOUGH DAYS FOR PROPS TO EXIST, then go look at them.

    The prop board is the panel this page leads with, and on a fresh universe it reads "0 published" --
    correctly, because props need a played season to price from. Which means the default probe could
    screenshot the prop panel as an empty state and call the crest header verified without ever
    rendering one. Props need players with games behind them, so the only way to see the header is to
    actually simulate.

    Sim Day lives on the dashboard, so this hops there, presses it, waits for the completion panel,
    and returns. Polling for the panel rather than sleeping a fixed interval, because the run length
    varies and a fixed sleep either races it or wastes ten seconds a day.
  */
  const DAYS = Number(process.env.GPB_MEDIA_DAYS ?? 22);
  console.log('  ', await gotoView('dashboard', '/dashboard/i'));
  for (let i = 0; i < DAYS; i += 1) {
    const dismissed = await evaluate(`(() => {
      const d = [...document.querySelectorAll('button')]
        .find((n) => /back to dashboard/i.test((n.textContent || '').trim()));
      if (!d) return 'none';
      d.click();
      return 'dismissed';
    })()`);
    if (dismissed === 'dismissed') await sleep(600);
    const hit = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((n) => /^sim day$/i.test((n.textContent || '').trim()));
      if (!b) return 'no button';
      b.click();
      return 'sim';
    })()`);
    if (hit !== 'sim') {
      console.log(`    (stopped playing days at ${i}: "${hit}")`);
      break;
    }
    for (let t = 0; t < 60; t += 1) {
      const done = await evaluate(`(() => {
        const h = [...document.querySelectorAll('h2')].find((x) => /simulation complete/i.test(x.textContent || ''));
        return h ? 'yes' : 'no';
      })()`);
      if (done === 'yes') break;
      await sleep(500);
    }
  }
  console.log(`    played ${DAYS} days`);

  console.log('  ', await gotoView('the media', '/the media/i'));
  await sleep(8000);

  /*
    WHAT IS ACTUALLY ON THE PAGE, always.

    A blank screenshot and four "NOT FOUND" clicks with zero console errors is not a self-explaining
    failure, and the first version of this section just reported the empty counts. So the probe now
    always says what it is looking at: how much text the document has, which view heading is up, and
    whether something is covering it. Every one of those answers a question the failure raises, and it
    costs one evaluate on the happy path too.

    "Blank with no console errors" is the signature of a React tree that rendered nothing at all rather
    than one that threw -- an exception would have logged. That is a different bug from a layout one
    and the two need different investigations.
  */
  const state = await evaluate(`(() => ({
    textLen: (document.body.innerText || '').trim().length,
    headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 6).map((h) => (h.textContent || '').trim()),
    onMedia: [...document.querySelectorAll('h1')].some((h) => /the media/i.test((h.textContent || '').trim())),
    rootChildren: document.getElementById('root')?.children.length ?? -1,
    overlays: [...document.querySelectorAll('[class*="fixed"],[class*="absolute inset-0"]')]
      .filter((e) => e.getBoundingClientRect().width > 400).length,
    firstText: (document.body.innerText || '').trim().slice(0, 120),
  }))()`);
  console.log(`    page: ${state.textLen} chars, root children ${state.rootChildren}, `
    + `${state.overlays} full-width overlays`);
  console.log(`    headings: ${state.headings.join(' | ') || '(none)'}`);
  if (state.textLen === 0) console.log(`    *** BLANK PAGE -- first text: "${state.firstText}" ***`);

  /*
  The first tab was called "Published Lines" until the outlet cells stopped printing prices, at which
  point the name described something the panel no longer showed. It is "Who They're On" now, and a
  probe still looking for the old name silently walks away from a working page -- it reported 0 rows
  and "counts agree: yes", which is a probe that passes by measuring nothing.
*/
const tabs = ["Who They're On", 'Ranking', 'Disagreement'];
  for (const [i, tab] of tabs.entries()) {
    console.log('  ', await click(tab));
    await sleep(1400);
    console.log(`    -> ${await shot(`media-tab-${i}-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`)}`);
  }

  /*
    THE SPLIT FILTER, walked both ways.

    It is the newest thing on the page and the easiest thing to ship broken in a way a screenshot of
    the default view cannot show -- "All" looks fine whether or not the filter behind it does
    anything. So: read how many rows render under each setting, confirm the filtered count matches the
    label on the button, and confirm switching back restores every row. A filter that silently shows
    everything is worse than no filter, because the label would be lying.
  */
  console.log('  ', await click("who they're on"));
  await sleep(900);

  /*
    Rows counted by their disagreement figure, which is exactly one per game row.

    Counting the cells that carry a "backing" title gives nine per row plus one per rail tile, so a
    fifteen-game slate reports 144 and the filtered view 63 -- both correct, neither comparable to the
    "Split 6" on the button. The `Npt` label is one per row and nothing else, so it is the only count
    in the same units as the label it is being checked against.
  */
  const readFilter = async () => evaluate(`(() => {
    const rows = [...document.querySelectorAll('span')]
      .filter((s) => /^\\d+pt$/.test((s.textContent || '').trim())).length;
    const btns = [...document.querySelectorAll('[role="radio"]')]
      .map((b) => (b.textContent || '').trim())
      .filter((t) => /^(All|Split)\\b/.test(t));
    const note = [...document.querySelectorAll('span')]
      .map((s) => (s.textContent || '').trim())
      .find((t) => /games? ·|outlets are more than/.test(t)) ?? '';
    return { rows, buttons: btns, note };
  })()`);

  const allView = await readFilter();
  console.log('  ', await clickExact('split'));
  await sleep(900);
  const splitView = await readFilter();
  console.log(`    -> ${await shot('media-tab-lines-split-filter')}`);
  console.log('  ', await clickExact('all'));
  await sleep(900);
  const backToAll = await readFilter();

  const splitLabel = Number((splitView.buttons.find((b) => b.startsWith('Split')) || '').replace(/\D+/g, ''));
  const allLabel = Number((allView.buttons.find((b) => b.startsWith('All')) || '').replace(/\D+/g, ''));

  /*
    The zero-row guard, added because the probe passed vacuously.

    When the first tab was renamed, this section clicked a name that no longer existed, got
    "NOT FOUND" from four clicks in a row, and then reported "counts agree: yes / reversible: yes" --
    because zero rows always equals zero rows, and no labels meant no counts to contradict. Every
    assertion below was satisfied by a page it never reached.

    So: the clicks have to land, and there has to be something to count. A probe that can pass by
    measuring nothing will, the first time a label changes.
  */
  const landed = [
    allView.buttons.length === 2,
    allView.rows > 0,
    splitView.rows > 0,
    backToAll.rows > 0,
    state.onMedia === true,
  ].every(Boolean);

  console.log('\n    SPLIT FILTER');
  console.log(`      All:    ${allView.rows} rows, buttons [${allView.buttons.join(' | ')}]`);
  console.log(`      Split:  ${splitView.rows} rows, label says ${splitLabel}`);
  console.log(`      Back:   ${backToAll.rows} rows`);
  console.log(`      note:   ${splitView.note || '(none)'}`);
  console.log(`      reached the tab:   ${landed ? 'yes' : '*** NO -- the probe measured nothing ***'}`);
  console.log(`      counts agree: ${splitLabel === splitView.rows && allLabel === allView.rows ? 'yes' : '*** NO ***'}`);
  console.log(`      reversible:    ${backToAll.rows === allView.rows ? 'yes' : '*** NO ***'}`);

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

  console.log(`    uncaught exceptions: ${exceptions.length}`);
  const seenEx = new Set();
  for (const e of exceptions) {
    const line = e.slice(0, 400);
    if (seenEx.has(line)) continue;
    seenEx.add(line);
    console.log(`      ${line}`);
  }

  cleanup();
  process.exit(errors.length === 0 && exceptions.length === 0 && landed ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });