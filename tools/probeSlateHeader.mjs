/**
 * Does the Postseason section's header carry its maple leaf and its date?
 *
 * A small thing, and separately checked because the browser screenshot cannot answer it: the
 * completion receipt slides in from the right and covers the right-hand end of every panel header,
 * which is exactly where this section's aside sits. Both screenshots therefore showed a bare
 * "Postseason" title whether or not the aside rendered at all.
 *
 * The DOM is the evidence here, which is the standing rule in this project anyway -- I cannot see
 * screenshots, so anything asserted about the UI should have been read out of the DOM.
 *
 * Run: node tools/probeSlateHeader.mjs [url]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3005/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-slatehdr-'));
const port = 9222 + Math.floor(Math.random() * 400);

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
  if (r.exceptionDetails) return { threw: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

const clickByText = (pattern) => `(() => {
  const re = new RegExp(${JSON.stringify(pattern)}, 'i');
  const b = [...document.querySelectorAll('button')].find((x) => re.test((x.textContent || '').trim()));
  if (!b) return 'NOT FOUND';
  if (b.disabled) return 'DISABLED';
  b.click();
  return 'clicked';
})()`;

/*
 * The slate row, located by its own content rather than by a heading.
 *
 * There is no "Postseason" heading any more -- that was the change this probe was rewritten for --
 * so the row is found by the box buttons themselves. The absence of the heading is itself asserted,
 * below, because a probe that cannot find the thing it is looking for is how a removal ships
 * silently.
 */
const READ_HEADER = `(() => {
  const boxes = [...document.querySelectorAll('button')].filter((b) => {
    const t = (b.textContent || '').trim();
    return b.querySelector('svg, img') && /@/.test(t) && /\\d/.test(t);
  });
  const hasPostseasonHeading = [...document.querySelectorAll('h2')]
    .some((x) => /^postseason$/i.test((x.textContent || '').trim()));
  if (boxes.length === 0) return { found: false, hasPostseasonHeading };

  const text = (boxes[0].textContent || '').trim();
  // The standing and the venue are the second and third lines; read them back out of the rendered
  // text rather than out of the source, so this measures what a reader actually sees.
  const parts = text.split(/\\s{2,}|\\n/).map((s) => s.trim()).filter(Boolean);

  // Every standing line on the page, so the wording rules can be checked against all of them at
  // once instead of one sample. On day one of the bracket every box reads "Game 1", which is the
  // least interesting case; checking the shape here means the rule is still enforced once the probe
  // is pointed at a later day.
  const standings = boxes.map((b) => {
    const t = (b.textContent || '').trim();
    const m = /(Game \\d|Win or Go Home \\d-\\d|Series tied \\d-\\d|[A-Z][^@|]*? lead \\d-\\d|\\w+ advancing \\d-\\d)/.exec(t);
    return m ? m[1].trim() : null;
  });

  return {
    found: true,
    gameBoxes: boxes.length,
    svgs: boxes[0].querySelectorAll('svg').length,
    imgs: boxes[0].querySelectorAll('img').length,
    sampleText: text.slice(0, 80),
    standings,
    sampleStanding: standings[0] ?? null,
    sampleVenue: parts.find((p) => /\\|/.test(p)) ?? null,
    hasStanding: standings.every((s) => s !== null),
    hasVenue: parts.some((p) => /\\|/.test(p)),
    hasBracketButton: [...document.querySelectorAll('button')]
      .some((b) => /go to bracket/i.test((b.textContent || '').trim())),
    // The bracket button must be a plain rectangle, not a chevron. A chevron is this app's signal
    // for "primary action", and a route link beside four fixtures is not more important than them.
    bracketIsChevron: (() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /go to bracket/i.test((x.textContent || '').trim()));
      if (!b) return null;
      const cs = getComputedStyle(b);
      return cs.clipPath !== 'none' && /polygon/.test(cs.clipPath);
    })(),
    hasPostseasonHeading,
    // Measured, because "the masthead fills its slot" is not something to eyeball. The wordmark being
    // CLIPPED AT THE SIDES is the failure this catches: a CSS scale on an object-cover image
    // overflows on BOTH axes, so it crops left and right as well as top and bottom, and a wordmark
    // loses its first and last letter before anyone notices why.
    // The masthead must show the WHOLE artwork. The image element fills the track either way, so
    // what matters is the fit mode: cover on a source wider than the slot crops the SIDES, which is
    // how "Playoffs" lost its first and last letter twice on this project.
    masthead: (() => {
      const img = document.querySelector('img[alt*="Playoffs" i]');
      if (!img) return null;
      const r = img.getBoundingClientRect();
      const w = img.parentElement.getBoundingClientRect();
      const cs = getComputedStyle(img);
      return {
        wrapW: Math.round(w.width), wrapH: Math.round(w.height),
        imgW: Math.round(r.width), imgH: Math.round(r.height),
        fit: cs.objectFit,
        // Ancestor chain, because "the wrapper is 1280x0" does not say WHY. Each level reports the
        // box it occupies and the three properties that decide it: display, aspect-ratio, height.
        // A percentage height that fails to resolve because its parent has no definite height looks
        // exactly like a height of 0, and the chain is the only way to see which link broke.
        chain: (() => {
          const out = [];
          let node = img.parentElement;
          for (let i = 0; i < 5 && node; i += 1) {
            const c = getComputedStyle(node);
            const r = node.getBoundingClientRect();
            out.push(
              (node.tagName + '.' + String(node.className).split(' ').slice(0, 4).join('.'))
              + ' [' + Math.round(r.width) + 'x' + Math.round(r.height) + ']'
              + ' display=' + c.display
              + ' aspect=' + c.aspectRatio
              + ' height=' + c.height
              + ' alignSelf=' + c.alignSelf,
            );
            node = node.parentElement;
          }
          return out;
        })(),
        natural: img.naturalWidth + 'x' + img.naturalHeight,
        renderedRatio: (r.width / r.height).toFixed(2),
        naturalRatio: (img.naturalWidth / img.naturalHeight).toFixed(2),
        // How close the source is to the slot's shape. Below ~1.2 there is almost nothing to crop.
        closeness: (img.naturalWidth / img.naturalHeight) / (w.width / w.height),
      };
    })(),
    // The alignment this exists for: the masthead is sized so the panel beneath it in the right
    // column -- the Primetime Game -- starts on the same line as the Sideline Reports panel in the
    // left column. Both columns are flex-cols with the same gap, so that holds exactly when the
    // masthead is as tall as the HEADLINE panel above the newsroom.
    alignment: (() => {
      const topOf = (needle) => {
        const h = [...document.querySelectorAll('h2')]
          .find((x) => new RegExp(needle, 'i').test((x.textContent || '').trim()));
        const panel = h?.closest('.panel, section');
        return panel ? Math.round(panel.getBoundingClientRect().top) : null;
      };
      const panelOf = (needle) => {
        const h = [...document.querySelectorAll('h2')]
          .find((x) => new RegExp(needle, 'i').test((x.textContent || '').trim()));
        // '.panel-hero' is in the list because the Headline panel is a <Panel variant="hero">, and
        // that renders class "panel-hero", which a bare ".panel" selector does NOT match. Asking for
        // ".panel" alone fell through to some outer section and reported the headline as 38px -- the
        // height of its own chrome-bar.
        return h?.closest('.panel, .panel-hero, section') ?? null;
      };
      const heightOf = (needle) => {
        const panel = panelOf(needle);
        return panel ? Math.round(panel.getBoundingClientRect().height) : null;
      };
      const newsroom = topOf('sideline reports');
      const primetime = topOf('primetime game');
      return {
        headlineH: heightOf('headline of the day'),
        mastheadH: (() => {
          const img = document.querySelector('img[alt*="Playoffs" i]');
          return img ? Math.round(img.parentElement.getBoundingClientRect().height) : null;
        })(),
        newsroomTop: newsroom,
        primetimeTop: primetime,
        // The number that has to be zero. Null when either panel is absent.
        delta: newsroom !== null && primetime !== null ? primetime - newsroom : null,
      };
    })(),
  };
})()`;

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1600,1400', '--hide-scrollbars', url,
], { stdio: 'ignore' });

let failures = 0;
const report = (ok, what, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  console.log(`        ${detail}`);
};

try {
  browser = await CDP.attach(await endpoint());
  const { targetInfos } = await browser.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const attached = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  sessionId = attached.sessionId;
  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  await sleep(2500);

  console.log('\nPOSTSEASON SLATE ROW\n');

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /repair player pool/i.test(n.textContent || ''));
    if (b) b.click();
    return 'repaired';
  })()`);

  /*
   * Poll for the Simulation Desk rather than sleeping a fixed interval.
   *
   * A fresh profile lands on the playerless-universe gate. Repairing the pool is a real
   * regeneration of every roster and its duration is not bounded by anything this probe can reason
   * about, so a fixed wait races it -- and when it loses, the desk button is simply not there yet and
   * the click reports NOT FOUND, which reads exactly like a missing feature rather than a race.
   *
   * 150 seconds rather than 60. The rebuild is CPU-bound and this machine accumulates dev servers
   * over a session; on a loaded box 60s was not enough, and the symptom is indistinguishable from a
   * broken app. tools/checkRenders.mjs exists to separate those two cases -- it confirmed zero console
   * errors while this probe was reporting that nothing rendered at all.
   */
  let deskReady = false;
  for (let i = 0; i < 150 && !deskReady; i += 1) {
    await sleep(1000);
    deskReady = await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((x) => /^to reg finale$/i.test((x.textContent || '').trim()));
      return !!b && !b.disabled;
    })()`);
  }

  const clicked = await evaluate(clickByText('^to reg finale$'));
  console.log(`  desk ready after polling: ${deskReady}; clicked To Reg Finale: ${clicked}`);

  let header = null;
  let lastSeason = null;
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    header = await evaluate(READ_HEADER);
    lastSeason = await evaluate(`(() => {
      const root = document.documentElement;
      return {
        season: root.getAttribute('data-season'),
        panel: getComputedStyle(root).getPropertyValue('--color-panel').trim(),
        headings: [...document.querySelectorAll('h2')].map((h) => (h.textContent || '').trim()),
      };
    })()`);
    if (header.found) break;
  }

  /*
   * Re-check the alignment across a carousel rotation.
   *
   * The headline panel is a carousel whose height grows when a headline wraps, so an alignment that
   * holds on one slide is not evidence that it holds on the next. Sampling across a rotation is the
   * only way to catch a masthead sized to a single slide's height -- which is precisely what a fixed
   * aspect ratio would produce, and precisely the bug the subgrid replaced.
   */
  const alignSamples = [header?.alignment?.delta ?? null];
  for (let i = 0; i < 3; i += 1) {
    await sleep(7500);
    const next = await evaluate(READ_HEADER);
    if (next?.alignment?.delta !== null && next?.alignment?.delta !== undefined) {
      alignSamples.push(next.alignment.delta);
    }
  }
  const worstDelta = Math.max(...alignSamples.filter((n) => n !== null).map(Math.abs));
  report(
    alignSamples.filter((n) => n !== null).length >= 3 && worstDelta <= 2,
    'the alignment survives carousel rotation, not just the slide it was measured on',
    `deltas across ${alignSamples.length} samples spanning ~22s of rotation:`
      + ` ${alignSamples.join(', ')}`
      + `\n        a masthead sized to one slide's height drifts by the height of the next one;`
      + `\n        sharing the grid track is what makes this immune to the headline's length`,
  );

  /*
   * Screenshot the slate row with the completion receipt dismissed.
   *
   * The receipt slides in from the right and sits over the right-hand column -- which is exactly
   * where the playoff masthead now lives. The DOM assertions below can see past it; a screenshot
   * cannot, so an undismissed capture of this page shows an empty right column and reads as though
   * the masthead failed to render. Dismissing first is what makes the picture worth taking.
   */
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /back to dashboard/i.test((x.textContent || '').trim()));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(1200);
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync('slate-row.png', Buffer.from(shot.data, 'base64'));

  if (!header || !header.found) {
    report(false, 'the postseason slate row is on screen',
      `clicked: ${clicked}`
        + `\n        after 180s: data-season=${lastSeason.season}, --color-panel=${lastSeason.panel}`
        + `\n        h2 headings present: ${lastSeason.headings.join(' | ')}`);
  } else {
    report(header.gameBoxes > 0, 'the game boxes render',
      `${header.gameBoxes} boxes in the row, ${header.svgs} inline svg, ${header.imgs} raster images`
      + `\n        the two images per box are the club crests, which are legitimately raster; the`
        + `\n        maple-leaf motif on this panel is the inline svg and has to stay one`);
    report(header.hasStanding, 'every box carries a series standing in one of the four forms',
      `all ${header.standings.length}: ${header.standings.map((s) => '"' + s + '"').join(', ')}`
        + `\n        the four are: "Game n" unstarted, "<Club> lead n-m", "Series tied n-n", and`
        + `\n        "Win or Go Home n-n" on the deciding game -- which must beat the tied case,`
        + `\n        because the deciding game is always level on paper`);
    report(header.hasVenue, 'each box carries the home park and a start time',
      `sample: "${header.sampleVenue}"`);
    report(header.hasBracketButton && header.bracketIsChevron === false,
      'Go to Bracket is a plain box beside the row, not a chevron',
      `present=${header.hasBracketButton}, chevron=${header.bracketIsChevron}`
        + `\n        a chevron means "primary action" in this app, and a route link is not one`);
    const m = header.masthead;
    report(!!m && m.fit === 'contain' && m.closeness > 1.1,
      'the masthead shows the whole wordmark, cropped at the source rather than in the box',
      m
        ? `slot ${m.wrapW}x${m.wrapH}, natural ${m.natural}, object-fit ${m.fit}`
          + `\n        source aspect ${m.naturalRatio} vs slot ${(m.wrapW / m.wrapH).toFixed(2)},`
          + ` closeness ${m.closeness.toFixed(2)}`
          + `\n        tools/measureMastheadArt.ts trimmed 31% empty above and 23% below off a`
          + `\n        1200x1200 square; the sponsor line at the foot was what that crop took`
        : 'masthead not found');
    if (m?.chain) {
      for (const line of m.chain) console.log(`        ${line}`);
    }
    const a = header.alignment;
    report(!!a && a.delta !== null && Math.abs(a.delta) <= 2,
      'the Primetime Game starts on the same line as Sideline Reports',
      a
        ? `headline ${a.headlineH}px, masthead ${a.mastheadH}px,`
          + ` newsroom top ${a.newsroomTop}, primetime top ${a.primetimeTop}, delta ${a.delta}px`
          + `\n        the two columns share a subgrid row track, so the masthead is as tall as the`
          + `\n        headline whatever height that carousel slide happens to be`
        : 'alignment not measurable');
    report(!header.hasPostseasonHeading,
      'the "Postseason" heading is gone',
      `headings on page: ${lastSeason.headings.join(' | ')}`);
  }

  console.log(`\n  ${failures} problem(s).\n`);
} catch (error) {
  console.error('probe failed:', error.message);
  failures += 1;
} finally {
  try { browser?.ws.close(); } catch { /* already closed */ }
  chrome.kill();
  for (let i = 0; i < 5; i += 1) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(400); }
  }
}

process.exitCode = failures === 0 ? 0 : 1;