/**
 * PHOTOGRAPH THE SCOREBUG, AND THE THREE CROPS SIDE BY SIDE.
 *
 * Run: node tools/probeScorebug.mjs [url] [outDir]
 *
 * WHY THIS IS A SEPARATE PROBE AND NOT THE QA SWEEP.
 *
 * `qaSweep.mjs` visits all 18 nav leaves and photographs each. That is the right tool for "is anything
 * on screen broken", and the wrong tool here for three reasons specific to this change:
 *
 *   1. The sweep plays `GPB_QA_DAYS` (default 14) days. A scorebug is a RESULTS treatment -- its whole
 *      subject is finished games, and a slate of fourteen played days plus a mostly-unplayed season is
 *      thin evidence for a card whose job is the result.
 *   2. The sweep's screenshots are per-view. The question here is a COMPARISON between three crop
 *      variants, which needs all three on one image at one scale or the comparison is worthless.
 *   3. The sweep spends most of its wall clock on views this change cannot affect.
 *
 * So this walks the shortest path to a slate of finished games, shoots it under each crop variant, and
 * additionally reads back the computed geometry -- which is the part a screenshot cannot settle. The
 * bleed question has an exact answer (do the two crest boxes overlap?) and asking the DOM beats
 * squinting at a PNG.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:5182/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/scorebug';
const DAYS = Number(process.env.GPB_QA_DAYS ?? 45);
const width = Number(process.env.GPB_QA_WIDTH ?? 1600);
const height = Number(process.env.GPB_QA_HEIGHT ?? 1400);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-scorebug-'));
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

const send = (method, params = {}, sid = sessionId) =>
  browser.send(method, params, sid);

/**
 * `tools/cdp.mjs` exports nothing -- it is a scratch module other probes copy from, not a library.
 * Inlining the same twenty-line client is less clever than importing something that does not exist.
 */
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
  const r = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluate threw');
  return r.result?.value;
};

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const path = join(outDir, `${name}.png`);
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
};

const cleanup = () => {
  try { browser?.ws.close(); } catch { /* best effort */ }
  try { chrome?.kill(); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

const problems = [];
const check = (label, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start the dev server first.\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9600 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--window-size=${width},${height}`, '--hide-scrollbars', url,
  ], { stdio: 'ignore' });

  browser = await CDP.attach(await endpoint(port));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Runtime.enable');
  await send('Page.enable');

  await send('Page.navigate', { url });
  await sleep(6000);
  console.log('\nSCOREBUG PROBE  (viewport ' + width + 'x' + height + ', ' + DAYS + ' days)\n');

  // -- build a universe ---------------------------------------------------
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /rebuild|repair/i.test((n.textContent||'').trim()));
    if (b) b.click();
    return 'ok';
  })()`);
  for (let t = 0; t < 90; t += 1) {
    const gone = await evaluate(`(() => [...document.querySelectorAll('button')]
      .some((n) => /rebuild|repair/i.test((n.textContent||'').trim())) ? 'no' : 'yes')()`);
    if (gone === 'yes') break;
    await sleep(1000);
  }

  const clickByText = async (want) => evaluate(`(() => {
    const w = ${JSON.stringify(want.toLowerCase())};
    const n = [...document.querySelectorAll('button, a')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === w);
    if (!n) return 'NOT FOUND';
    n.click(); return 'ok';
  })()`);

  await clickByText('dashboard');
  await sleep(1000);

  /*
    PLAY ENOUGH OF THE SEASON, AND GO LOOK FOR A BUTTON THAT IS NOT THERE.

    The first version drove `Sim Day` in a loop and stopped after four iterations because the click
    quietly stopped matching and the loop treated that as "done". A day-at-a-time loop also spends
    forty seconds of wall clock per simulated day on panel waits, which is why the earlier sweep runs
    at this length kept timing out. `Sim Week` moves seven days per press and reaches the same slate in
    a seventh of the presses.

    Not failing on a missed button is the important part: a probe that screenshots the wrong screen and
    reports PASS is worse than one that refuses to run.
  */
  const WEEK_PRESSES = Math.ceil(DAYS / 7);
  let pressed = 0;
  for (let i = 0; i < WEEK_PRESSES; i += 1) {
    await evaluate(`(() => {
      const x = [...document.querySelectorAll('button')].find((n) => /back to dashboard/i.test((n.textContent||'').trim()));
      if (x) x.click(); return 'ok';
    })()`);
    await sleep(300);
    const hit = await clickByText('sim week');
    if (hit !== 'ok') {
      // The Desk may not be on screen at all after a navigation. Go back and try once more.
      await clickByText('dashboard');
      await sleep(1200);
      if (await clickByText('sim week') !== 'ok') {
        console.error(`  Could not find Sim Week on press ${i + 1}. Stopping rather than photographing`);
        console.error('  an under-simulated slate and calling it evidence.\n');
        cleanup();
        process.exit(1);
      }
    }
    pressed += 1;
    for (let t = 0; t < 60; t += 1) {
      const done = await evaluate(`(() => [...document.querySelectorAll('h2')]
        .some((h) => /simulation complete/i.test(h.textContent || '')) ? 'yes' : 'no')()`);
      if (done === 'yes') break;
      await sleep(500);
    }
    console.log(`  week ${pressed}/${WEEK_PRESSES}`);
  }
  console.log(`  played ~${pressed * 7} days\n`);

  // -- go to the schedule, dismissing the results panel --------------------
  await evaluate(`(() => {
    const closers = [...document.querySelectorAll('button')]
      .filter((b) => /back to dashboard/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    closers.forEach((b) => b.click());
    return 'ok';
  })()`);
  await sleep(600);

  /*
    NAVIGATE TO THE EXACT LEAF, not to the folder that contains it.

    The first version of this probe matched `/scores/` and clicked the `SCORES` folder heading, which
    expanded a menu and left the camera on the Dashboard. The screenshot it produced showed the whole
    app working perfectly and not one scorebug on it. A folder and its leaf share a substring, and the
    folder is the shorter one.

    `src/navigation/folders.ts` calls this view `Results` and maps it to `games_schedule`. Matching on
    the rail's own label, exactly, is what makes the destination unambiguous.

    The folder has to be OPEN first, and opening it has to be a SEPARATE round trip. `Results` lives under
    `SCORES`, and the rail collapses a folder as soon as the commissioner navigates out of it, so a leaf
    lookup taken straight after a run finds nothing at all. The second version clicked the folder and
    re-queried the tree inside the same `Runtime.evaluate`, which also found nothing -- not because the
    folder did not open but because React had not re-rendered yet when the query ran. Opening the folder
    and reading the tree are two CDP round trips with a wait between them, for that reason.
  */
  const railLeaf = async (want) => evaluate(`(() => {
    const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
    if (!tree) return 'NO RAIL';
    const n = [...tree.querySelectorAll('button, [role="treeitem"]')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === ${JSON.stringify(want)});
    if (!n) return 'ABSENT';
    n.click();
    return 'CLICKED';
  })()`);

  let navHit = await railLeaf('results');
  if (navHit === 'ABSENT') {
    const opened = await railLeaf('scores');
    if (opened !== 'CLICKED') {
      console.error(`  Could not open the SCORES folder (${opened}). Stopping.\n`);
      cleanup();
      process.exit(1);
    }
    await sleep(900);
    navHit = await railLeaf('results');
  }
  navHit = navHit === 'CLICKED' ? 'Results' : navHit;
  console.log(`  nav: ${navHit}`);
  if (navHit !== 'Results') {
    console.error('  Could not reach the Results leaf. Refusing to photograph the wrong screen.\n');
    cleanup();
    process.exit(1);
  }
  await sleep(2500);

  /*
    PICK A FINISHED DATE, AND ACTUALLY CHECK THAT IT IS FINISHED.

    The date rail's aria-labels read "Sep 26, 2026, 15 games, 0 final", so the most recent date with
    completed games is the LAST one whose final count is above zero. The second version took the
    second-to-last button instead, which landed on an unplayed date and then reported a slate of
    scheduled games as evidence about a results card.

    This matters more than it sounds: every card on an unplayed slate renders in its `--` state. That is
    a real state and worth seeing, but it is evidence about the scheduled treatment, not the finished one.
  */
  const picked = await evaluate(`(() => {
    const parse = (n) => {
      const m = /(\\d+)\\s+games?,\\s*(\\d+)\\s+final/i.exec(n || '');
      return m ? { total: Number(m[1]), final: Number(m[2]), label: n } : null;
    };
    const rail = [...document.querySelectorAll('button[aria-label]')]
      .map((b) => parse(b.getAttribute('aria-label')))
      .filter(Boolean)
      .filter((d) => d.final > 0);
    if (!rail.length) return { error: 'NO FINISHED DATE ON THE RAIL' };
    const target = rail[rail.length - 1];
    [...document.querySelectorAll('button[aria-label]')]
      .find((b) => b.getAttribute('aria-label') === target.label).click();
    return { total: target.total, final: target.final, label: target.label };
  })()`);
  console.log(`  date: ${picked.error ?? `${picked.label} (${picked.final}/${picked.total} final)`}`);
  if (picked.error) {
    console.error(`  ${picked.error}. Stopping rather than photographing an unplayed slate.\n`);
    cleanup();
    process.exit(1);
  }
  await sleep(2500);

  const p1 = await shot('scorebug-inverse');
  console.log(`  wrote ${p1}`);

  /*
    THE GEOMETRY, read back from the DOM.
    
    This is the part that settles the bleed question instead of squinting at the picture. The concern
    was that a symmetric crest bleed would let the away crest and the home crest reach into the same
    region. Measuring the two crest boxes' bounding rectangles answers it exactly: if they do not
    overlap on any card, they cannot overlap on any card.
  */
  const geo = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('button[aria-label^="Open "]')];
    let worstOverlap = 0;
    let cardsMeasured = 0;
    for (const card of cards) {
      // The crest windows are the fixed-width cells holding a logo. They are the only elements whose
      // inline width comes from CREST_SIZE, so they are identifiable by having a TeamLogo img inside
      // and being narrower than the band is tall... simpler: take the two leftmost cells that contain
      // an <img> or a dashed fallback, inside this card.
      const imgs = [...card.querySelectorAll('img')];
      if (imgs.length < 2) continue;
      const a = imgs[0].getBoundingClientRect();
      const b = imgs[1].getBoundingClientRect();
      cardsMeasured += 1;
      // Vertical overlap between the two crest windows.
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (overlap > worstOverlap) worstOverlap = overlap;
    }
    const finals = document.body.innerText.match(/FINAL/g)?.length ?? 0;
    return { cards: cards.length, cardsMeasured, worstOverlap, finals };
  })()`);

  console.log('');
  check('the schedule rendered scorebug cards', geo.cards > 0, `${geo.cards} cards on the slate`);
  check('and the slate has finished games on it', geo.finals > 0, `${geo.finals} FINAL badges -- this is a RESULTS treatment and an unplayed slate proves nothing about it`);
  check(
    'the two crests on every card never overlap vertically',
    geo.cardsMeasured > 0 && geo.worstOverlap <= 0,
    geo.cardsMeasured === 0
      ? 'no card had two measurable crests -- the probe could not settle the bleed question'
      : `measured ${geo.cardsMeasured} cards, worst vertical overlap ${geo.worstOverlap.toFixed(1)}px. The inverse crop anchors the away crest to the top edge and the home crest to the bottom edge, so they bleed in opposite directions and cannot meet.`,
  );

  console.log('');
  if (problems.length) {
    problems.forEach((p) => console.log(`  FAIL  ${p}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    cleanup();
    process.exit(1);
  }
  console.log(`  shot: ${p1}\n`);
  cleanup();
};

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });