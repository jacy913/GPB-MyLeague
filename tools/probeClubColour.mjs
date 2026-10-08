/**
 * Does the club identity bar actually render, for every club, at a legible contrast?
 *
 * `checkClubInk.ts` proves the derivation arithmetically -- all 32 clubs clear 3:1 on all four
 * surfaces, computed in Node. That is necessary and not sufficient, because it says nothing about
 * whether the value reaches the screen. Four things can break between the module and a pixel, and
 * each has broken something in this project before:
 *
 *   1. The component resolves the colour itself and disagrees with the tool (two implementations).
 *   2. The colour is passed but the element carrying it is not the one that was styled.
 *   3. A CSS custom property is set on one element and read by another that is not its descendant.
 *   4. Something overrides it -- a `border-*` utility, a `!important`, a later rule.
 *
 * So this measures the RENDERED `::before` for all 32 clubs by driving the real roster screen and
 * clicking the real directory. It reads `getComputedStyle` on the pseudo-element and resolves the
 * colour, then computes WCAG contrast against the panel it sits on, in the page.
 *
 * The three clubs that motivate the whole module are called out separately: `ock`, `urb` and `dwi`
 * whose raw primaries measure 1.04, 1.03 and 1.14 against `--color-panel` and would draw nothing at
 * all. A pass that did not include them would be worthless.
 *
 * Run: node tools/probeClubColour.mjs [url]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3001/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-clubcolour-'));
const port = 9222 + Math.floor(Math.random() * 400);

/** The three whose own hex cannot be drawn here. The reason the module exists. */
const INVISIBLE_RAW = ['ock', 'urb', 'dwi'];

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

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.waiting = new Map();
  }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });
    const cdp = new CDP(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && cdp.waiting.has(msg.id)) {
        const { resolve, reject } = cdp.waiting.get(msg.id);
        cdp.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
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
  if (r.exceptionDetails) {
    return { threw: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  }
  return r.result.value;
};

/**
 * Resolve a computed colour to `#rrggbb` and its WCAG luminance against a surface.
 *
 * The in-page colour is whatever the browser computed, which may be `oklab(...)`, `color-mix(...)`
 * or `rgb(...)`. Rather than parse all three, this round-trips through a canvas: paint the colour,
 * read the pixel back. That is the only conversion guaranteed to agree with what is actually on
 * screen, which is the entire point of measuring rather than asserting.
 */
const MEASURE = `(() => {
  const panel = document.querySelector('.club-accent');
  if (!panel) return { error: 'no .club-accent on screen -- wrong view?' };
  const before = getComputedStyle(panel, '::before');
  const accent = getComputedStyle(panel).getPropertyValue('--club-accent').trim();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const toHex = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    const [hi, lo] = x > y ? [x, y] : [y, x];
    return (hi + 0.05) / (lo + 0.05);
  };

  const ruleHex = toHex(before.backgroundColor);
  const panelHex = toHex(getComputedStyle(panel).backgroundColor);

  // The bench rows and the selected-row rule, read from the same club.
  const bench = document.querySelector('.club-bench-row');
  const selected = document.querySelector('.club-row-selected');

  return {
    accent,
    ruleWidth: before.width,
    ruleHex,
    panelHex,
    contrast: ratio(ruleHex, panelHex),
    ruleVisible: before.content !== 'none' && before.width !== '0px',
    benchCount: document.querySelectorAll('.club-bench-row').length,
    benchBorder: bench ? getComputedStyle(bench).borderLeftColor : null,
    selectedPresent: !!selected,
    selectedShadow: selected ? getComputedStyle(selected.querySelector('td')).boxShadow : null,
    // Layout guard. A new left rule is exactly the sort of thing that shifts a column, and this
    // project lost a debugging session to column drift that cell-counts and screenshots both
    // reported as clean.
    drift: (() => {
      let worst = 0;
      for (const t of document.querySelectorAll('table')) {
        const head = t.querySelector('thead tr');
        const body = t.querySelector('tbody tr');
        if (!head || !body) continue;
        const h = [...head.children].map((c) => c.getBoundingClientRect().left);
        const b = [...body.children].map((c) => c.getBoundingClientRect().left);
        for (let i = 0; i < Math.min(h.length, b.length); i += 1) {
          worst = Math.max(worst, Math.abs(h[i] - b[i]));
        }
      }
      return worst;
    })(),
    chromeBar: (() => {
      const bar = document.querySelector('.club-accent .chrome-bar');
      return bar ? bar.getBoundingClientRect().height : null;
    })(),
  };
})()`;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1600,1100',
    '--hide-scrollbars',
    url,
  ],
  { stdio: 'ignore' },
);

let failures = 0;

try {
  browser = await CDP.attach(await endpoint());
  const { targetInfos } = await browser.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const attached = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  sessionId = attached.sessionId;

  await browser.send('Runtime.enable', {}, sessionId);
  await sleep(2500);

  // Fresh profile lands on a save with 32 clubs and no players. Repair the pool, play a week so the
  // roster has something in it, then navigate.
  const repair = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /repair player pool/i.test(n.textContent || ''));
    if (!b) return 'no repair button';
    b.click();
    return 'repaired';
  })()`);
  console.log(`\nPOOL: ${repair}`);
  await sleep(1500);

  const sim = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /^sim week$/i.test((n.textContent || '').trim()));
    if (!b) return 'no sim week button';
    b.click();
    return 'simmed';
  })()`);
  console.log(`SIM:  ${sim}`);
  await sleep(9000);

  const nav = await evaluate(`(() => {
    const click = (re) => {
      const n = [...document.querySelectorAll('button, a, [role="treeitem"], [role="button"]')]
        .find((x) => re.test((x.textContent || '').trim()));
      if (!n) return 'NOT FOUND';
      n.click();
      return 'ok';
    };
    click(/^back to dashboard$/i);
    return 'navigating';
  })()`);
  await sleep(1200);
  const teams = await evaluate(`(() => {
    const n = [...document.querySelectorAll('button')].find((x) => /^teams$/i.test((x.textContent || '').trim()));
    if (!n) return 'NOT FOUND';
    n.click();
    return 'ok';
  })()`);
  await sleep(900);
  const rosters = await evaluate(`(() => {
    const n = [...document.querySelectorAll('button')].find((x) => /^rosters$/i.test((x.textContent || '').trim()));
    if (!n) return 'NOT FOUND';
    n.click();
    return 'ok';
  })()`);
  console.log(`NAV:  ${nav} / ${teams} / ${rosters}`);
  await sleep(1800);

  // The club list is read out of the data file in Node rather than imported in the page.
  //
  // An earlier version did `await import('/src/data/teamColors.ts')` inside Runtime.evaluate and
  // handed the result to JSON.parse. That returns a Promise, not a value, because the call did not
  // set `awaitPromise`, so the parse failed on "[object Object]". Reading the same file here keeps
  // one source of truth and no eval plumbing.
  const source = readFileSync(join(process.cwd(), 'src', 'data', 'teamColors.ts'), 'utf8');
  const CLUBS = [...source.matchAll(/^\s{2}([a-z]{3}):\s*\{/gm)].map((m) => m[1]);
  console.log(`\nDriving ${CLUBS.length} clubs through the directory\n`);
  console.log('  club   rule      width  contrast  drift  chrome  bench  selected');
  console.log('  ' + '-'.repeat(66));

  for (const club of CLUBS) {
    // Open the directory, click the club by its id, close, measure.
    // The disclosure is labelled "Choose Team". An earlier version looked for "directory" and silently
    // matched nothing, so every one of the 32 clubs reported NOT FOUND -- a failure that reads as a
    // broken feature rather than a broken probe, which is the worse of the two.
    await evaluate(`(() => {
      const dir = [...document.querySelectorAll('button')]
        .find((x) => /choose team/i.test(x.textContent || ''));
      if (!dir) return 'NOT FOUND';
      dir.click();
      return 'opened';
    })()`);
    await sleep(500);

    // Selected by the `data-team-id` hook, not by text. Text matching picks the wrong club for
    // `and` (substring of "Grandland") and would have reported a pass for the wrong team.
    const picked = await evaluate(`(() => {
      const hit = document.querySelector('[data-team-id="${club}"]');
      if (!hit) return 'NOT FOUND';
      hit.click();
      return 'picked';
    })()`);
    if (picked !== 'picked') {
      console.log(`  ${club.padEnd(6)} DIRECTORY ENTRY NOT FOUND`);
      failures += 1;
      continue;
    }
    await sleep(700);

    const m = await evaluate(MEASURE);
    if (m.error || m.threw) {
      console.log(`  ${club.padEnd(6)} ${m.error ?? m.threw}`);
      failures += 1;
      continue;
    }

    const bad = [];
    if (!m.ruleVisible) bad.push('rule not painted');
    if (m.ruleWidth !== '4px') bad.push(`width ${m.ruleWidth}`);
    if (m.contrast < 3) bad.push(`contrast ${m.contrast.toFixed(2)}`);
    if (m.drift > 0.5) bad.push(`drift ${m.drift}`);
    if (m.chromeBar !== 38) bad.push(`chrome-bar ${m.chromeBar}`);
    if (!m.benchCount) bad.push('no bench rows');
    if (bad.length) failures += 1;

    const flag = bad.length ? '  <-- ' + bad.join(', ') : '';
    const mark = INVISIBLE_RAW.includes(club) ? ' *' : '  ';
    console.log(
      `  ${club.padEnd(6)}${mark}${m.ruleHex}  ${m.ruleWidth.padStart(4)}  ${m.contrast
        .toFixed(2)
        .padStart(7)}:1  ${String(m.drift).padStart(5)}  ${String(m.chromeBar).padStart(6)}  ${String(
        m.benchCount,
      ).padStart(5)}  ${m.selectedPresent ? 'yes' : 'no'}${flag}`,
    );
  }

  console.log(`\n  * = raw primary below 1.2:1 on this surface, invisible without the lift.`);
  console.log(`    ${INVISIBLE_RAW.join(', ')} are the reason clubInk exists.\n`);
  console.log(`  ${CLUBS.length} clubs driven, ${failures} problem(s).\n`);
} catch (error) {
  console.error('probe failed:', error.message);
  failures += 1;
} finally {
  try { browser?.ws.close(); } catch { /* already closed */ }
  chrome.kill();
  // Chrome keeps a lock on CrashpadMetrics-active.pma for a moment after the kill signal, so the
  // profile is removed on a retry rather than throwing out of a `finally` and masking whatever the
  // probe actually reported.
  for (let i = 0; i < 5; i += 1) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(400);
    }
  }
}

process.exitCode = failures === 0 ? 0 : 1;