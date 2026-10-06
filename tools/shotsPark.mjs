/**
 * Screenshot the park panel for archetype parks.
 *
 * A geometry module can be correct and still draw badly: a viewBox that crops a label, a roof ring
 * that fills as a bow-tie, five boxes colliding at a short porch. None of that is visible to `tsc` and
 * none of it is visible in a unit test of the arithmetic. It is only visible by looking.
 *
 * So this renders the panel for parks chosen because they are DIFFERENT rather than because they are
 * convenient:
 *
 *   and  Andrard    398/408/410/408/394  32ft dark wall, high altitude   deep and symmetric
 *   fey  Feyford     324/384/393/387/344  26ft light wall                  short porch, tall wall
 *   sta  Stantral    335/401/411/409/397  12ft dark wall                   62ft of asymmetry
 *   cal  Calukan     336/396/404/396/336  7ft light wall, DOME             roofed
 *   hou  Houdan      337/...  6ft wall      EXTREME altitude                thin air
 *
 * Andrard and Calukan are near-mirror images in shape and both are symmetric, which is what makes the
 * difference between them legible at all: the same ballpark, one enormous and one small, so if the
 * diagram is honest the two pictures must be obviously different sizes.
 *
 * Run: node tools/shotsPark.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/parks';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-parks-'));
mkdirSync(outDir, { recursive: true });

/**
 * Viewport, overridable.
 *
 * The panel is `max-w-6xl` and its two columns collapse at `lg`, so there is a whole layout between
 * 640px and 1024px that has never been looked at -- and a 667px-wide SVG with five 62px annotation
 * boxes is exactly the kind of thing that overflows a phone silently. A screenshot is the window
 * width, so overflow past the edge is cropped out of the picture rather than shown; the probe measures
 * `scrollWidth - clientWidth` as well, for that reason.
 */
const width = Number(process.env.GPB_QA_WIDTH ?? 1500);
const height = Number(process.env.GPB_QA_HEIGHT ?? 1250);
const tag = process.env.GPB_QA_TAG ?? `${width}`;

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
  /*
    `awaitPromise` is required here and its absence looked like a data problem rather than a harness
    one: the injected module imports are `async`, so the expression evaluated to a Promise, the
    promise serialised as `{}`, and the club list came back empty. Every other probe in this repo
    evaluates synchronously and never needed it.
  */
  const r = await browser.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
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

  const port = 9100 + Math.floor(Math.random() * 90);
  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    `--window-size=${width},${height}`, '--hide-scrollbars', url,
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
  console.log('\nPARK PANEL\n');

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

  /*
    THE REAL PATH, NOT AN INJECTED RENDER.

    The first two attempts tried to `import()` the panel and React from inside the page and build a
    root by hand. Vite rewrites bare specifiers only in modules it serves, so `/react` is not a URL
    and the import failed -- and even had it worked, a hand-built root proves the panel renders and
    says nothing about whether the button opens it.

    So this drives the interface the way a manager does: open the schedule, open a game, press the
    park button. Which means the screenshots are of the real thing and the button is covered by the
    same pass. The cost is that reaching a game screen needs a built universe, which the repair above
    has already done.
  */
  await evaluate(`(() => {
    ['SCORES'].forEach((f) => {
      const n = [...document.querySelectorAll('button')].find((x) => (x.textContent||'').trim().toUpperCase() === f);
      if (n) n.click();
    });
    return 'ok';
  })()`);
  await sleep(900);
  console.log('  ', await evaluate(`(() => {
    const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
    if (!tree) return 'NO RAIL';
    const n = [...tree.querySelectorAll('button, [role="treeitem"]')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === 'schedule');
    if (!n) return 'NOT IN RAIL';
    n.click(); return 'on schedule';
  })()`));
  await sleep(2600);

  /*
    WHICH PARKS, chosen for being different rather than for being convenient.

      Andrard   398/410/394 behind a 32ft wall, high altitude  -- the biggest park in the league
      Calukan    dome, 336/336, symmetric                      -- the roof rendering
      Stantral   335 LF against 397 RF                         -- 62ft of visible porch
      Houdan     extreme altitude                             -- thin air

    Andrard and Calukan are near mirror images in shape and both symmetric, which is exactly why they
    are worth putting side by side: same ballpark, one enormous and one small, so if the diagram is
    honest the two pictures must be obviously different sizes. A scale normalised per park would make
    them identical and prove nothing at all.
  */
  /*
    MATCHED ON THE THREE-LETTER TICKER, not the club name.

    The schedule's game buttons read "@DESAway0-0", so a search for "Desseldein" or "Muskets" finds
    nothing at all and the sweep reports zero games at every park it was asked about -- which is the
    failure mode where a probe correctly executes and reports nothing, having searched the wrong thing.
  */
  const wantedClubs = (process.env.GPB_PARK_CLUBS ?? 'AND,CAL,STA,HOU')
    .split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`  looking for tickers: ${wantedClubs.join(', ')}\n`);

  const games = await evaluate(`(() => {
    const wanted = ${JSON.stringify(wantedClubs.map((c) => c.toLowerCase()))};
    const nodes = [...document.querySelectorAll('button, [role="button"]')]
      .filter((b) => !b.disabled)
      .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim())
      .filter((t) => t.length > 4 && t.length < 70);
    return [...new Set(nodes)].filter((t) => wanted.some((w) => t.toLowerCase().includes(w)));
  })()`);
  console.log(`  ${games.length} games at those parks\n`);
  console.log(`  found: ${games.slice(0, 8).join(' | ') || '(none)'}\n`);

  /*
    NAVIGATE TO THE SCHEDULE FRESH, EVERY TIME.

    Both earlier attempts to loop over parks failed the same way and for the same reason. "Back to
    Schedule" is a control on the game screen, and clicking it did not reliably return the schedule to
    a state where the game buttons were matchable again; the first version never clicked it at all and
    the second reported "GONE" for every park after the first. Going through the nav rail is slower
    and completely predictable, and predictability is the whole point of a probe that has to visit
    eight screens in a row.
  */
  const gotoSchedule = async () => {
    await evaluate(`(() => {
      const openFolders = () => {
        ['SCORES','LEAGUE','TEAMS','COMMISSIONER','PLAYOFFS','SYSTEM'].forEach((f) => {
          const n = [...document.querySelectorAll('button')]
            .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toUpperCase() === f);
          if (n) n.click();
        });
      };
      const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
      const findLeaf = () => [...document.querySelectorAll('button, [role="button"]')].find((x) => {
        const t = (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase();
        return t === 'schedule';
      });
      if (!findLeaf()) { openFolders(); }
      const leaf = findLeaf();
      if (leaf) { leaf.click(); return 'ok'; }
      return 'no leaf';
    })()`);
    await sleep(2200);
  };

  const seen = [];
  for (const game of games) {
    if (seen.length >= 3) break;
    errors = [];
    exceptions = [];

    await gotoSchedule();

    const opened = await evaluate(`(() => {
      const w = ${JSON.stringify(game.toLowerCase())};
      const n = [...document.querySelectorAll('button, [role="button"]')]
        .find((x) => !x.disabled && (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === w);
      if (!n) return 'GONE';
      n.click(); return 'clicked';
    })()`);
    if (opened !== 'clicked') {
      console.log(`  ${game}: ${opened}`);
      continue;
    }
    await sleep(2600);

    const parkClicked = await evaluate(`(() => {
      const n = [...document.querySelectorAll('button')]
        .find((b) => /\\bpark\\b/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
      if (!n) return 'NO PARK BUTTON';
      n.click(); return 'opened';
    })()`);
    if (parkClicked !== 'opened') {
      console.log(`  ${game}: ${parkClicked}`);
      await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /back to schedule/i.test((x.textContent||'').trim())); if (b) b.click(); return 'ok'; })()`);
      await sleep(1400);
      continue;
    }

    await sleep(2000);
    const info = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      /*
        The field SVG specifically, not the first svg in the dialog. The close button's X icon is an
        inline svg and comes first in the DOM, so the first attempt measured 16px -- the icon -- and
        reported a field that was rendering perfectly at full width as a diagram 16 pixels across.
      */
      const svgs = dialog ? [...dialog.querySelectorAll('svg')] : [];
      const field = svgs.find((s) => (s.getAttribute('aria-label') || '').includes('park diagram'));
      return {
        hasDialog: !!dialog,
        title: (dialog?.querySelector('h2')?.textContent || '').trim(),
        svgCount: svgs.length,
        svgWidth: field ? Math.round(field.getBoundingClientRect().width) : 0,
        svgHeight: field ? Math.round(field.getBoundingClientRect().height) : 0,
        hasWallLabel: field ? /FT WALL/.test(field.textContent || '') : false,
        overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    })()`);
    if (info.hasDialog) {
      const gameTicker = game.replace(/[^A-Za-z]/g, '').slice(0, 3).toLowerCase();
      const file = await shot(`park-${tag}-${seen.length + 1}-${gameTicker}`);
      console.log(`  ${game}`);
      console.log(
        `    "${info.title}"  field ${info.svgWidth}x${info.svgHeight}px`
        + `  wall label: ${info.hasWallLabel ? 'yes' : '*** MISSING ***'}`
        + `  overflowX ${info.overflowX}`,
      );
      if (errors.length || exceptions.length) {
        console.log(`    ERRORS ${errors.length}  EXCEPTIONS ${exceptions.length}`);
        [...new Set([...errors, ...exceptions])].slice(0, 2).forEach((e) => console.log(`      ${e.slice(0, 170)}`));
      }
      console.log(`    -> ${file}`);
      seen.push(info.title);
    }

    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /close/i.test(x.getAttribute('aria-label')||'')); if (b) b.click(); return 'ok'; })()`);
    await sleep(700);
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /back to schedule/i.test((x.textContent||'').trim())); if (b) b.click(); return 'ok'; })()`);
    await sleep(1600);
  }

  console.log(`\n  parks screenshotted: ${seen.length}`);
  console.log(`  total errors ${errors.length}  exceptions ${exceptions.length}`);
  console.log(`\n  screenshots: ${outDir}\n`);
  cleanup();
  process.exit(errors.length === 0 && exceptions.length === 0 ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });