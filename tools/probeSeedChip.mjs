/**
 * IS EVERY SEED NUMBER VISIBLE, IN EVERY SERIES STATE?
 *
 * Run: node tools/probeSeedChip.mjs [url] [outDir]
 *
 * WHY THIS EXISTS. The seed chip rendered the digit of a LEADING team at 1.00:1 against its own
 * background -- invisible -- and nothing caught it. `tsc` cannot see it, the build cannot see it, no
 * existing guard looks at it, and a code read says the chip is fine because the markup reads like a
 * coloured chip with a digit on it. The defect was in paint order (`skew-shadow`'s void `::before` is a
 * positioned child box, so it covers the chip's own background) and in `--color-ink-invert` being the
 * same value as `--color-void`. Only the rendered result is evidence.
 *
 * WHY IT READS PIXELS, NOT JUST COMPUTED STYLES. The first version of this probe compared the digit's
 * colour against the chip's own `backgroundColor` and would have PASSED the broken component: the
 * league colour was genuinely declared, it was simply not what reached the screen. So the probe now
 * hides every digit and reads the pixel underneath each chip, which is the chip. One capture per chip
 * at a 1x1 clip, decoded with zlib -- no image dependency.
 *
 * WHY IT COSTS A WHOLE SEASON TO RUN. The defect is specific to a leading team, and `getSeriesLeader`
 * returns null on a tie, so on a freshly seeded bracket every chip is in the non-leading state and this
 * probe would pass over the exact defect it exists to catch. It runs the league to the regular-season
 * finale and presses "Next Playoff Day" once, which puts the wild card series in progress and puts both
 * states on the same bracket. Leaders are identified STRUCTURALLY -- by the gold left edge on the team
 * row -- not by the digit's colour, so the classification survives the fix changing that colour.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:5183/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/seedchip';
const width = Number(process.env.GPB_QA_WIDTH ?? 1600);
const height = Number(process.env.GPB_QA_HEIGHT ?? 1400);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-seedchip-'));
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

/** `tools/cdp.mjs` exports nothing -- it is a scratch module other probes copy from, not a library. */
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

const send = (method, params = {}, sid = sessionId) => browser.send(method, params, sid);

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluate threw');
  return r.result?.value;
};

const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const p = join(outDir, `${name}.png`);
  writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
};

/**
 * Decode a non-interlaced 8-bit PNG.
 *
 * Written by hand rather than pulled in as a dependency, because the only thing this probe needs from
 * an image is one pixel. `inflateSync` plus the five scanline filters is the whole of it.
 */
const decodePng = (png) => {
  let width = 0;
  let height = 0;
  let colourType = 6;
  let bitDepth = 8;
  const idat = [];
  for (let offset = 8; offset + 8 <= png.length; ) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      bitDepth = png[offset + 16];
      colourType = png[offset + 17];
      if (png[offset + 20] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + len));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (bitDepth !== 8 || (colourType !== 2 && colourType !== 6)) {
    throw new Error(`unsupported PNG: bitDepth ${bitDepth}, colourType ${colourType}`);
  }
  const bpp = colourType === 2 ? 3 : 4;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prior ? prior[i] : 0;
      const upLeft = prior && i >= bpp ? prior[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      row[i] = value & 0xff;
    }
  }
  return { width, height, bpp, data: out };
};

/**
 * The colour of one point, read out of a capture of the viewport itself.
 *
 * There is no `clip` on purpose. A CDP clip is expressed in PAGE coordinates while `scrollIntoView`
 * scrolls the VIEWPORT, and mixing the two is how the first two versions of this probe read the middle
 * of an empty panel and reported four healthy chips as broken. Capturing the viewport and indexing it
 * with the same numbers `getBoundingClientRect` returned removes the translation entirely.
 */
const readViewportPixel = async (x, y) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const img = decodePng(Buffer.from(r.data, 'base64'));
  const px = Math.max(0, Math.min(img.width - 1, x));
  const py = Math.max(0, Math.min(img.height - 1, y));
  const at = (py * img.width + px) * img.bpp;
  return { r: img.data[at], g: img.data[at + 1], b: img.data[at + 2], a: img.bpp === 4 ? img.data[at + 3] : 255 };
};

/**
 * Parse a CSS colour into channels.
 *
 * Both spellings matter, and getting this wrong is silent. A theme token read off `documentElement`
 * comes back as the hex literal from `@theme` (`#d4bb6a`), while a computed style comes back as
 * `rgb(212, 187, 106)`. The first version of this parser only understood the second, so every league
 * token resolved to null and the probe reported a 0.00:1 match against nothing.
 */
const parseColour = (css) => {
  const text = (css || '').trim();
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hexMatch) {
    const digits = hexMatch[1].length === 3
      ? hexMatch[1].split('').map((d) => d + d).join('')
      : hexMatch[1];
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: 1,
    };
  }
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(text);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
};
const luminance = ({ r, g, b }) => {
  const f = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const x = luminance(a); const y = luminance(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (c) => (c
  ? '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  : 'UNREADABLE');

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

  const port = 9700 + Math.floor(Math.random() * 90);
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
  console.log('\nSEED CHIP PROBE  (viewport ' + width + 'x' + height + ')\n');

  // -- build a universe -------------------------------------------------
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
  console.log('  universe built');

  const clickByPattern = async (src) => evaluate(`(() => {
    const re = ${src};
    const n = [...document.querySelectorAll('button')]
      .find((x) => re.test((x.getAttribute('aria-label') || x.textContent || '').trim()));
    if (!n) return 'NOT FOUND';
    n.click();
    return (n.getAttribute('aria-label') || n.textContent || '').trim();
  })()`);
  const waitForRun = async () => {
    for (let t = 0; t < 150; t += 1) {
      const done = await evaluate(`(() => [...document.querySelectorAll('h2, h3')]
        .some((h) => /simulation complete/i.test(h.textContent || '')) ? 'yes' : 'no')()`);
      if (done === 'yes') return 'yes';
      await sleep(1000);
    }
    return 'no';
  };
  const dismiss = async () => {
    await evaluate(`(() => {
      [...document.querySelectorAll('button')]
        .filter((b) => /back to dashboard/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()))
        .forEach((b) => b.click());
      return 'ok';
    })()`);
    await sleep(700);
  };

  // -- to the regular-season finale, so a bracket can seed ----------------
  await dismiss();
  const finale = await clickByPattern('/reg finale|finale/i');
  if (finale === 'NOT FOUND') {
    console.error('  No finale control on the Simulation Desk. Cannot seed a bracket.\n');
    cleanup();
    process.exit(1);
  }
  console.log(`  ran "${finale}", finished: ${await waitForRun()}`);
  await dismiss();

  // -- to the bracket ---------------------------------------------------
  const railLeaf = async (want) => evaluate(`(() => {
    const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
    if (!tree) return 'NO RAIL';
    const n = [...tree.querySelectorAll('button, [role="treeitem"]')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === ${JSON.stringify(want)});
    if (!n) return 'ABSENT';
    n.click(); return 'CLICKED';
  })()`);

  let nav = await railLeaf('bracket');
  if (nav === 'ABSENT') {
    if (await railLeaf('playoffs') !== 'CLICKED') {
      console.error('  Could not open the PLAYOFFS folder.\n');
      cleanup();
      process.exit(1);
    }
    await sleep(900);
    nav = await railLeaf('bracket');
  }
  if (nav !== 'CLICKED') {
    console.error('  Refusing to measure a screen that is not the bracket.\n');
    cleanup();
    process.exit(1);
  }
  console.log('  nav: Bracket');
  await sleep(2500);

  // -- the league tokens, read as the stylesheet spells them ---------------
  /*
    Read raw and parse here rather than in the page. A custom property read off `documentElement`
    comes back as the hex literal from `@theme`, which is a different spelling from a computed style's
    `rgb()`, and the first version of this probe only understood the second -- so every token resolved
    to null and the league comparison silently measured nothing.
  */
  const tokens = await evaluate(`(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      gold: root.getPropertyValue('--color-gold').trim(),
      platinum: root.getPropertyValue('--color-platinum').trim(),
      prestige: root.getPropertyValue('--color-prestige').trim(),
    };
  })()`);
  const gold = parseColour(tokens.gold);
  if (!gold) {
    console.error(`  Could not read --color-gold from the stylesheet (got "${tokens.gold}").\n`);
    cleanup();
    process.exit(1);
  }

  /** A row is leading when its left edge is the gold accent. Structural, so it survives the fix. */
  const isLeadingBorder = (css) => {
    const parsed = parseColour(css);
    return Boolean(parsed) && contrast(parsed, gold) < 1.35;
  };
  const readRowBorders = () => evaluate(`(() => [...document.querySelectorAll('[aria-label^="Seed "]')]
    .filter((chip) => chip.getBoundingClientRect().width > 0)
    .map((chip) => (chip.parentElement ? getComputedStyle(chip.parentElement).borderLeftColor : null)))()`);

  /*
    ADVANCE UNTIL A SERIES IS ACTUALLY IN PROGRESS.

    One press is not always enough and the probe has to be robust to that rather than lucky. Each run
    builds a fresh universe, so the playoff calendar differs, and a press can land on a date whose games
    get scheduled without any being played -- which leaves every series at 0-0, every chip in the
    trailing state, and a probe that passes over the defect it exists to catch. So it presses and then
    CHECKS, up to a bounded number of times, and refuses to report at all if it never reaches a state
    with a leader.
  */
  let leadingCount = 0;
  for (let press = 1; press <= 6; press += 1) {
    const advanced = await clickByPattern('/next playoff day/i');
    if (advanced === 'NOT FOUND') {
      console.error('  No advance control on the bracket, so no series can be in progress.\n');
      cleanup();
      process.exit(1);
    }
    await sleep(4000);
    leadingCount = (await readRowBorders()).filter(isLeadingBorder).length;
    console.log(`  press ${press}: "${advanced}" -> ${leadingCount} leading chip(s)`);
    if (leadingCount > 0) break;
  }
  if (leadingCount === 0) {
    console.error('\n  Six presses produced no leading chip. Refusing to report on an all-tied bracket,\n');
    console.error('  which is a state where this defect cannot appear.\n');
    cleanup();
    process.exit(1);
  }

  /*
    CLOSE THE RESULTS OVERLAY BEFORE LOOKING AT ANYTHING.

    Pressing an advance control leaves the Simulation Complete panel open, and it is a fixed overlay
    across the right of the viewport. It was covering the bracket's right-hand column, which is how four
    perfectly healthy chips spent three rounds of this probe reporting as broken -- the pixels under
    them belonged to the overlay, not to the bracket. The bracket itself was never clipped: measured at a
    1600px viewport the five-column grid is 1246px inside a 1278px panel. A measurement taken under an
    overlay describes the overlay.
  */
  await dismiss();
  await sleep(600);

  const chips = await evaluate(`(() => {
    return [...document.querySelectorAll('[aria-label^="Seed "]')].map((chip) => {
      const digit = chip.querySelector('span span') || chip.querySelector('span');
      const row = chip.parentElement;
      const rect = chip.getBoundingClientRect();
      const chipBox = chip.querySelector('span');
      return {
        aria: chip.getAttribute('aria-label'),
        digitColour: digit ? getComputedStyle(digit).color : null,
        declaresBg: getComputedStyle(chip).backgroundColor,
        innerBg: chipBox ? getComputedStyle(chipBox).backgroundColor : null,
        rowBorderLeft: row ? getComputedStyle(row).borderLeftColor : null,
        pageX: rect.left + window.scrollX,
        pageY: rect.top + window.scrollY,
        w: rect.width,
        h: rect.height,
      };
    });
  })()`);

  /*
    ONLY THE LAID-OUT COPIES.

    The bracket renders its cards twice -- once in the five-column desktop bracket and once in the
    labelled stacked list -- and hides whichever one the viewport does not want. The hidden copy is in
    the DOM with a zero bounding rect, so reading "the pixel at its position" samples the top-left of
    the page instead of a chip. Those chips cannot be seen by a reader, so they are not evidence either
    way; measuring them reported a chip that did not exist.
  */
  const allChipCount = Array.isArray(chips) ? chips.length : 0;
  const laidOut = (Array.isArray(chips) ? chips : []).filter((c) => c.w > 0 && c.h > 0);

  check('the bracket rendered seed chips', laidOut.length > 0,
    `${laidOut.length} laid out, ${allChipCount - laidOut.length} in the hidden viewport variant`);
  if (laidOut.length === 0) {
    console.error('\n  Nothing laid out to measure. Stopping.\n');
    cleanup();
    process.exit(1);
  }

  /*
    READ EACH CHIP'S REAL COLOUR: hide every digit, scroll to it, and capture the pixel underneath.

    This is the measurement that catches the paint-order defect. Computed styles reported the league
    colour as declared while the screen showed void, so the declared value cannot be what this probe
    asserts on.

    Leaders are identified structurally, by the gold left edge on the team row, rather than by the
    digit's colour -- so the classification survives the fix making both states share one ink. The flag
    is carried onto the MEASURED record rather than kept on a parallel list; the first version computed
    it on one list and painted the pixel on another, so the leader-specific check compared `undefined`
    contrasts and reported "none", which is a check that cannot fail.

    Each chip is scrolled into view and captured in VIEWPORT coordinates, with the capture of the
    viewport itself rather than a clip. A CDP clip is expressed in page coordinates while `scrollIntoView`
    moves the viewport, and the two versions of this probe that mixed them read the middle of an empty
    panel and reported four healthy chips as broken.
  */
  await evaluate(`(() => {
    const s = document.createElement('style');
    s.id = 'probe-hide-digits';
    // Only the DIGIT. Hiding the whole inner span also hides the league fill, which is the thing being
    // measured -- the first version used a two-level descendant selector and hid both.
    s.textContent = 'html { scroll-behavior: auto !important; }'
      + '[data-probe-seed] span span span { visibility: hidden !important; }';
    document.head.appendChild(s);
    return 'ok';
  })()`);
  const tagged = await evaluate(`(() => {
    const laid = [...document.querySelectorAll('[aria-label^="Seed "]')]
      .filter((n) => n.getBoundingClientRect().width > 0);
    laid.forEach((n, i) => {
      const r = n.getBoundingClientRect();
      /*
        IS THIS CHIP ACTUALLY VISIBLE, OR JUST LAID OUT?

        A bounding box is not proof of visibility. Advancing the bracket leaves a fixed results overlay
        across the right of the viewport, and a chip underneath it has a real 30x30 box that
        getBoundingClientRect reports happily, while the pixel at that point belongs to the overlay. Those
        chips reported as broken for three rounds of this probe before the frame it was looking at got
        saved.

        So the test is a hit test at the chip's own centre: if the element the browser returns is the
        chip or something inside it, a reader can see it. Anything else means something is on top, or it
        is clipped away, and it is not evidence either way.
      */
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const visible = Boolean(hit && (hit === n || n.contains(hit)));
      n.setAttribute('data-probe-seed', String(i));
      n.setAttribute('data-probe-visible', visible ? '1' : '0');
    });
    return laid.length;
  })()`);
  await sleep(400);

  const read = [];
  let skipped = 0;
  for (let i = 0; i < tagged; i += 1) {
    const geom = await evaluate(`(() => {
      const chip = document.querySelector('[data-probe-seed="${i}"][data-probe-visible="1"]');
      if (!chip) return null;
      chip.scrollIntoView({ block: 'center', inline: 'center' });
      return true;
    })()`);
    await sleep(160);
    const point = await evaluate(`(() => {
      const chip = document.querySelector('[data-probe-seed="${i}"][data-probe-visible="1"]');
      if (!chip) return null;
      const r = chip.getBoundingClientRect();
      return { x: Math.round(r.left) + 5, y: Math.round(r.top) + 5 };
    })()`);
    if (geom === null || point === null) {
      // Either the chip was not hit-testable (clipped or covered) or it moved out from under us. Either
      // way it is not a chip a reader can check, so it is skipped rather than reported.
      skipped += 1;
      continue;
    }
    /*
      WAIT FOR THE SCROLL TO SETTLE, and confirm it has.

      The app scrolls smoothly, so a rect read immediately after `scrollIntoView` describes a position the
      page is still gliding towards. Capturing mid-glide reads somewhere else entirely -- which is how
      four chips in the rightmost column came back as the World Series panel's background several
      hundred pixels above them. Two reads a frame apart, taken only once they agree, means the number
      being sampled is the number the capture will use.
    */
    let settled = point;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(90);
      const again = await evaluate(`(() => {
        const chip = document.querySelector('[data-probe-seed="${i}"][data-probe-visible="1"]');
        if (!chip) return null;
        const r = chip.getBoundingClientRect();
        return { x: Math.round(r.left) + 5, y: Math.round(r.top) + 5 };
      })()`);
      if (again && again.x === settled.x && again.y === settled.y) { settled = again; break; }
      if (again) settled = again;
    }
    let paintedColour = null;
    try {
      paintedColour = await readViewportPixel(settled.x, settled.y);
      // If the pixel under the chip is neither league colour, the probe has found something it cannot
      // explain -- so it saves the frame it looked at. Three earlier rounds of "why is this chip broken"
      // went nowhere because nothing recorded what was actually on screen at the sample point.
      const isLeague = [tokens.platinum, tokens.prestige]
        .map((t) => parseColour(t))
        .some((t) => t && Math.abs(luminance(paintedColour) - luminance(t)) < 0.12);
      if (!isLeague) {
        const frame = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(join(outDir, `fail-chip-${i}.png`), Buffer.from(frame.data, 'base64'));
      }
      read.push({ ...laidOut[i], leading: isLeadingBorder(laidOut[i].rowBorderLeft), painted: paintedColour });
    } catch (e) {
      read.push({ ...laidOut[i], leading: isLeadingBorder(laidOut[i].rowBorderLeft), painted: null, readError: String(e) });
    }
  }
  await evaluate(`(() => {
    document.querySelectorAll('[data-probe-seed]').forEach((n) => {
      n.removeAttribute('data-probe-seed');
      n.removeAttribute('data-probe-visible');
    });
    const s = document.getElementById('probe-hide-digits');
    if (s) s.remove();
    window.scrollTo(0, 0);
    return 'ok';
  })()`);
  await sleep(500);

  check(
    'the probe found chips a reader can actually see',
    read.length > 0,
    `${read.length} measured, ${skipped} skipped as covered`
      + (skipped > 0
        ? '. A chip under the results overlay measures the overlay. The bracket itself does not clip its columns -- measured at a 1600px viewport the five-column grid is 1246px inside a 1278px panel -- so a skip means something was on top, not that the chip is unreachable.'
        : ''),
  );

  const platinum = parseColour(tokens.platinum);
  const prestige = parseColour(tokens.prestige);

  const analysed = read.map((c) => {
    const digit = parseColour(c.digitColour);
    const painted = c.painted;
    // The chip is either teal or brass; the league is whichever of the two the painted pixel matches.
    const asPlatinum = painted && platinum ? contrast(painted, platinum) : Infinity;
    const asPrestige = painted && prestige ? contrast(painted, prestige) : Infinity;
    const league = asPlatinum <= asPrestige ? 'platinum' : 'prestige';
    const leagueToken = league === 'platinum' ? platinum : prestige;
    return {
      ...c,
      league,
      contrast: digit && painted ? contrast(digit, painted) : null,
      leagueMatch: painted && leagueToken ? contrast(painted, leagueToken) : null,
    };
  });

  const leaderChips = analysed.filter((c) => c.leading);
  const worst = analysed.reduce((acc, c) => (c.contrast !== null && c.contrast < acc ? c.contrast : acc), Infinity);
  const worstLeague = analysed.reduce((acc, c) => (c.leagueMatch !== null && c.leagueMatch > acc ? c.leagueMatch : acc), 0);
  const sample = analysed[0];
  const paintedText = sample.painted ? hex(sample.painted) : 'UNREADABLE';
  const ratio = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'none');

  console.log('');
  console.log(`    ${analysed.length} chips -- ${leaderChips.length} leading, ${analysed.length - leaderChips.length} trailing`);
  console.log(`    painted chip   ${paintedText}   (declared ${sample.declaresBg}, inner ${sample.innerBg})`);
  console.log(`    digit          ${sample.digitColour}`);
  console.log(`    league colours platinum ${tokens.platinum} / prestige ${tokens.prestige}`);
  console.log('');

  check(
    'both series states are on the bracket',
    leaderChips.length > 0 && leaderChips.length < analysed.length,
    `${leaderChips.length} leading, ${analysed.length - leaderChips.length} trailing. A run with only one state cannot prove the other.`,
  );
  check(
    'every painted chip IS its league colour',
    analysed.every((c) => c.leagueMatch !== null && c.leagueMatch < 1.35),
    `worst ${ratio(worstLeague)}:1 from the league token. A chip whose declared league colour is not the colour on screen is a league colour nobody sees -- which is how the leading seed went invisible.`,
  );
  check(
    'every seed digit is legible in every state',
    analysed.every((c) => c.contrast !== null && c.contrast >= 4.5),
    `worst ${ratio(worst)}:1 across all ${analysed.length} chips. Before the fix the leading chips measured 1.00:1.`,
  );
  check(
    'and leading seeds are legible specifically',
    leaderChips.length > 0 && leaderChips.every((c) => c.contrast !== null && c.contrast >= 4.5),
    `${leaderChips.length} leading chip(s), worst ${ratio(Math.min(...leaderChips.map((c) => c.contrast ?? Infinity)))}:1. This is the reported defect, isolated.`,
  );

  const p = await shot('seedchip-after');
  console.log('');
  console.log(`  wrote ${p}`);
  writeFileSync(join(outDir, 'chips.json'), JSON.stringify({ tokens, analysed }, null, 2));

  console.log('');
  if (problems.length) {
    problems.forEach((x) => console.log(`  FAIL  ${x}`));
    console.log(`\n  ${problems.length} problem(s).\n`);
    cleanup();
    process.exit(1);
  }
  console.log('  every seed number is visible, in both series states, on its own league colour.\n');
  cleanup();
};

main().catch((e) => { console.error(e); cleanup(); process.exit(1); });