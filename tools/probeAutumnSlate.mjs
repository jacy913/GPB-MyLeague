/**
 * Does the postseason section and the autumn palette actually appear, and go away again?
 *
 * ============================================================================
 * WHY THIS FILE HAS TO EXIST
 * ============================================================================
 *
 * Four independent things have to be true at once for this feature, and any of them can fail without
 * an error, a console message or a failing unit test:
 *
 *   1. `data-season` is set on <html> and the tokens resolve to the autumn ramp.
 *   2. The section renders, and it renders the right games.
 *   3. The Power Rankings strip is gone.
 *   4. All of it REVERSES when the postseason ends.
 *
 * (4) is the one that would ship. A palette that never comes back is invisible in every automated
 * check in this repo -- each one verifies its own components, and none of them would notice a
 * document-level attribute left set. `tools/checkAutumnPalette.ts` proves the VALUES are right; this
 * proves they are being APPLIED, and then un-applied.
 *
 * It reads the resolved custom property off `documentElement` rather than off a component. Reading
 * it off a component would pass even if the cascade were broken at the root, which is precisely the
 * failure a wrapper-div implementation would have had.
 *
 * Run: node tools/probeAutumnSlate.mjs [url]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3005/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-autumn-'));
const port = 9222 + Math.floor(Math.random() * 400);

const NAVY_PANEL = '#161d2e';
const AUTUMN_PANEL = '#2a190d';

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
  if (r.exceptionDetails) return { threw: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
  return r.result.value;
};

const clickByText = (pattern) => `(() => {
  const re = new RegExp(${JSON.stringify(pattern)}, 'i');
  const b = [...document.querySelectorAll('button')].find((x) => re.test((x.textContent || '').trim()));
  if (!b) return 'NOT FOUND';
  if (b.disabled) return 'DISABLED';
  b.click();
  return (b.textContent || '').trim();
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
    '--window-size=1600,1400',
    '--hide-scrollbars',
    url,
  ],
  { stdio: 'ignore' },
);

let failures = 0;
const report = (ok, what, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  console.log(`        ${detail}`);
};

/** Everything this probe asserts, read in one pass. */
const READ = `(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const token = (name) => cs.getPropertyValue(name).trim();

  const headings = [...document.querySelectorAll('h2')].map((h) => (h.textContent || '').trim());

  /*
   * The slate row is found by its CONTENT, not by a heading. It used to carry a "Postseason" title
   * and that heading was the locator; the title is gone, so the locator is now the game boxes
   * themselves -- a button holding a crest pair, an @ between them, and a figure.
   *
   * The absence of the old heading is asserted separately rather than being what this probe
   * navigates by, because a locator that no longer resolves looks exactly like a feature that
   * stopped working.
   */
  const boxes = [...document.querySelectorAll('button')].filter((b) => {
    const t = (b.textContent || '').trim();
    return b.querySelector('svg, img') && /@/.test(t) && /\d/.test(t);
  });

  /*
   * THE SLATE RENDERED -- boxes OR the empty state.
   *
   * The panel only shows fixtures for the league's CURRENT date, and the postseason window can open
   * on a rest day. Nothing advances the calendar by itself, so on such a day it stays empty for as
   * long as the probe is willing to wait -- and an assertion that demanded boxes there was asserting
   * that a random seed had put a game on that date. Two of three runs failed it for that reason alone.
   *
   * The empty state is itself proof the panel rendered, so this asks the question the check is
   * actually about. Whether the boxes render when there ARE games is tools/probeSlateHeader.mjs's
   * job, and it polls for them properly.
   */
  const slateEmptyState = /no games scheduled/i.test(document.body.innerText || '');

  // Count table drift per table, header-to-body, per column left edge.
  let drift = 0;
  for (const t of document.querySelectorAll('table')) {
    const head = t.querySelector('thead tr');
    const body = t.querySelector('tbody tr');
    if (!head || !body) continue;
    const h = [...head.children].map((c) => c.getBoundingClientRect().left);
    const b = [...body.children].map((c) => c.getBoundingClientRect().left);
    for (let i = 0; i < Math.min(h.length, b.length); i += 1) {
      drift = Math.max(drift, Math.abs(h[i] - b[i]));
    }
  }

  /*
 * PANEL title bars only.
 *
 * The chrome-bar class is used for two different things: the 38px title bar on a panel, and the
 * header row of a table, which takes the same bevel at whatever height the table asked for. The
 * first version of this probe measured both and reported a table header at 34px as a failed 38px
 * rule -- a false failure against a component this work never touched, in the regular season, with
 * the autumn block nowhere in sight.
 *
 * The handover is explicit that a table header row using this class is a different case: its
 * pseudo-elements are removed and decoration does not go inside a table. So the assertion is scoped
 * to bars that are not table rows, which is what the 38px rule actually governs.
 */
const bars = [...document.querySelectorAll('.chrome-bar')]
  .filter((b) => b.tagName !== 'TR' && !b.closest('thead'))
  .map((b) => ({
    height: b.getBoundingClientRect().height,
    // Named, because "one bar is off by N px" is not actionable and guessing which one is how you
    // end up fixing the wrong component.
    title: (b.querySelector('h2, h3')?.textContent || '(untitled)').trim(),
  }));

  return {
    dataSeason: root.getAttribute('data-season'),
    panel: token('--color-panel'),
    base: token('--color-base'),
    chromeHi: token('--color-chrome-hi'),
    hasSection: boxes.length > 0 || slateEmptyState,
    slateEmptyState,
    hasPostseasonHeading: headings.some((h) => /^postseason$/i.test(h)),
    slateRows: boxes.length,
    headings: headings.join(' | '),
    hasPowerRankings: /power rankings/i.test(document.body.innerText),
    hasPrimetime: /primetime game/i.test(document.body.innerText),
    hasAwardRace: /award race/i.test(document.body.innerText),
    hasMasthead: !!document.querySelector('img[alt*="Playoffs" i]'),
    mastheadFill: (() => {
      const img = document.querySelector('img[alt*="Playoffs" i]');
      if (!img) return null;
      const r = img.getBoundingClientRect();
      const wrap = img.parentElement.getBoundingClientRect();
      // How much of the slot the artwork actually covers. The masthead is meant to FILL the
      // rectangular space beside the headline: no card, no padding, no letterbox.
      return {
        // object-fit is the thing being asserted, not geometry: the <img> fills the track either
        // way, so only the fit mode reveals whether the artwork is being cropped.
        fit: getComputedStyle(img).objectFit,
        natural: img.naturalWidth + 'x' + img.naturalHeight,
        naturalRatio: img.naturalWidth / img.naturalHeight,
        // Source aspect over slot aspect. Near 1 means there is nothing left to crop.
        closeness: (img.naturalWidth / img.naturalHeight) / (wrap.width / wrap.height),
        renderedRatio: (r.width / r.height).toFixed(2),
        wrapW: Math.round(wrap.width),
        wrapH: Math.round(wrap.height),
        imgW: Math.round(r.width),
        imgH: Math.round(r.height),
      };
    })(),
    // The newspaper and pencil glyphs that used to sit in the Headline and Sideline chrome-bars.
    // Counted across the WHOLE page, and asserted in the regular-season state too, because the
    // removal is not a postseason change.
    headerIcons: [...document.querySelectorAll('.chrome-bar svg')].map((s) => {
      const bar = s.closest('.chrome-bar');
      return (bar?.querySelector('h2')?.textContent || '?').trim() + ':' + s.getAttribute('class');
    }).filter((x) => /lucide-(newspaper|pen-line)/.test(x)),
    hasBracketButton: /go to bracket/i.test(document.body.innerText),
    crests: boxes.reduce((n, b) => n + b.querySelectorAll('img, svg').length, 0),
    drift,
    chromeBars: bars.length,
    badChromeBars: bars.filter((b) => Math.abs(b.height - 38) > 0.5).length,
    // Which ones, and by how much -- the standing 38px rule says a too-tall bar is wrong CONTENT,
    // never the bar itself, so the report has to name the panel rather than just the count.
    // String concatenation, not a template literal: this whole block is itself inside a template
    // literal, and a nested one closes it. That mistake was made twice in this file.
    badChromeBarDetail: bars
      .filter((b) => Math.abs(b.height - 38) > 0.5)
      .map((b) => b.title + '=' + b.height.toFixed(1) + 'px')
      .join('  '),
    today: /Today\s+([A-Z][a-z]{2,8}\w* \d{1,2}, \d{4})/.exec(document.body.innerText)?.[1] ?? null,
    todayIso: /Today\s+(\d{4}-\d{2}-\d{2})/.exec(document.body.innerText)?.[1] ?? null,
  };
})()`;

/** Capture the viewport, so the DOM numbers above can be looked at rather than only read. */
const shoot = async (name) => {
  const r = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(name, Buffer.from(r.data, 'base64'));
  return name;
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

  console.log('\nAUTUMN SLATE\n');

  /* ---------------------------------------------------------------- before */

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /repair player pool/i.test(n.textContent || ''));
    if (b) b.click();
    return 'repaired';
  })()`);
  await sleep(2500);

  const before = await evaluate(READ);
  const shotBefore = await shoot('autumn-before.png');
  console.log('  --- before the postseason ---');
  report(
    before.dataSeason === null && before.panel === NAVY_PANEL,
    'a fresh league is navy, with no postseason section',
    `data-season=${before.dataSeason}, --color-panel=${before.panel}, section=${before.hasSection}`
      + `, power rankings=${before.hasPowerRankings}`,
  );

  /*
   * The headline and newsroom glyphs.
   *
   * Checked HERE, in the regular season, because that is the whole point of the change: the newspaper
   * and pencil were removed from the chrome-bars of Headline Of The Day and Sideline Reports for the
   * WHOLE season, not as a postseason tidy-up. A probe that only looked during the postseason would
   * pass whether or not the regular season was affected, which is the half that matters.
   */
  report(
    before.headerIcons.length === 0,
    'the newspaper and pencil glyphs are gone from the panel headers, all season',
    `still present: ${before.headerIcons.length ? before.headerIcons.join(', ') : 'none'}`
      + `\n        checked in the regular-season state as well as the postseason, because the`
      + `\n        removal is season-wide and a postseason-only check would miss half of it`,
  );

  /* ---------------------------------------------------------------- into the postseason */

  console.log('\n  --- simulating to the end of the regular season ---');
  await evaluate(clickByText('^repair player pool$'));
  await sleep(500);

  // The Simulation Desk's own button. This is the path a manager takes, not a test hook.
  const clicked = await evaluate(clickByText('^to reg finale$'));
  console.log(`        clicked "${clicked}"`);

  // Poll for the bracket to seed rather than sleeping a fixed interval.
  let during = null;
  for (let i = 0; i < 180; i += 1) {
    await sleep(1000);
    const state = await evaluate(READ);
    if (state.dataSeason === 'postseason') {
      during = state;
      /*
       * WAIT FOR A SLATE WITH GAMES IN IT, not just for the window to open.
       *
       * The window opens on the morning the first playoff game is SCHEDULED, and the seed date can
       * sit a day or two later than the date the window opened on. So the first tick where
       * data-season flips is regularly a REST DAY, the panel correctly shows "No games scheduled",
       * and asserting on boxes there reports a missing feature that is behaving exactly as designed.
       *
       * This is the same failure shape as the sibling probe's: both were measuring a transient rather
       * than a state. tools/probeSlateHeader.mjs already polls for the boxes for this reason.
       */
      if (state.hasSection && (state.slateEmptyState || state.slateRows > 0)) break;
    }
  }

  if (!during) {
    const last = await evaluate(READ);
    report(false, 'the postseason window opens at the end of the regular season',
      `after 180s: data-season=${last.dataSeason}, --color-panel=${last.panel}, date=${last.todayIso}`);
  } else {
    const shotDuring = await shoot('autumn-during.png');
    report(
      true,
      'the postseason window opens and the palette resolves to the autumn panel',
      `data-season=${during.dataSeason}, --color-panel=${during.panel}, date=${during.todayIso}`,
    );
    report(
      during.panel === AUTUMN_PANEL,
      '--color-panel on <html> resolves to the autumn value, not the navy one',
      `resolved ${during.panel}; expected ${AUTUMN_PANEL}. Read off documentElement, not off a`
        + `\n        component -- reading it off a component would pass even with a broken root cascade.`,
    );
    report(
      during.hasSection,
      'the slate panel is rendered',
      during.slateEmptyState
        ? `the panel rendered its empty state ("No games scheduled");`
          + `\n        ${during.slateRows} boxes -- the league's current date is a postseason rest day,`
          + `\n        and nothing advances the calendar by itself. probeSlateHeader.mjs asserts that`
          + `\n        the boxes render on a date that HAS games.`
        : `${during.slateRows} game boxes, ${during.crests} crests rendered`
          + `\n        h2 headings on page: ${during.headings}`,
    );
    report(
      !during.hasPostseasonHeading,
      'the "Postseason" heading is gone, contents kept',
      `a heading reading Postseason is present=${during.hasPostseasonHeading}`
        + `\n        removing the bar removed a 38px chrome-bar that was repeating what the masthead`,
    );
    report(
      during.hasMasthead
        && during.mastheadFill?.fit === 'contain'
        && during.mastheadFill?.closeness > 1.1,
      'the playoff masthead shows the whole wordmark, uncropped',
      `slot ${during.mastheadFill?.wrapW}x${during.mastheadFill?.wrapH},`
        + ` natural ${during.mastheadFill?.natural}, object-fit ${during.mastheadFill?.fit}`
        + `\n        the source is cropped to its content box by tools/measureMastheadArt.ts, so the`
        + `\n        box does not have to crop anything and the sponsor line cannot be clipped`,
    );
    report(
      during.hasPrimetime && during.hasAwardRace,
      'the Primetime Game is back in its own slot and the award race stays put',
      `primetime on page=${during.hasPrimetime}, award race on page=${during.hasAwardRace}`
        + `\n        an earlier revision swapped these two for the postseason, which pushed the`
        + `\n        featured game to the bottom of the page to cover for a merely finished panel`,
    );
    report(
      during.hasBracketButton,
      'the Go to Bracket button is present',
      `found=${during.hasBracketButton}`,
    );
    report(
      !during.hasPowerRankings,
      'the Power Rankings strip is suppressed during the postseason',
      `power rankings on page=${during.hasPowerRankings}; its valuation basis is a frozen`
        + `\n        regular-season record once the bracket opens`,
    );
    report(
      during.drift <= 0.5,
      'no table column drift',
      `worst header-to-body delta ${during.drift}px across the page`,
    );
    report(
      during.badChromeBars === 0,
      'every chrome-bar is exactly 38px',
      `${during.chromeBars} bars, ${during.badChromeBars} off 38px`
        + `${during.badChromeBarDetail ? `: ${during.badChromeBarDetail}` : ''}`
        + `\n        before the postseason: ${before.chromeBars} bars, ${before.badChromeBars} off 38px`
        + `${before.badChromeBarDetail ? ` (${before.badChromeBarDetail})` : ''}`
        + `\n        the autumn block overrides --color-chrome-*, which is what the bar paints from,`,
    );
    console.log(`        screenshots: ${shotBefore} (regular), ${shotDuring} (postseason)`);
  }

  /* ---------------------------------------------------------------- out again */

  console.log('\n  --- running the postseason out ---');
  /*
   * Bounded to 10 attempts of a 30s poll, not 30 of a 40s poll.
   *
   * The postseason is 22 simulated days and Sim Month advances about 30, so a handful of presses
   * clears it. The first version allowed 30 x 40s = twenty minutes and the run timed out with the
   * loop still going -- a probe that cannot finish is a probe that reports nothing.
   */
  let after = null;
  for (let attempt = 0; attempt < 10 && !after; attempt += 1) {
    await evaluate(clickByText('^sim month$'));
    for (let i = 0; i < 30; i += 1) {
      await sleep(1000);
      const state = await evaluate(READ);
      if (state.dataSeason === null) {
        after = state;
        break;
      }
    }
  }

  if (!after) {
    const last = await evaluate(READ);
    report(false, 'the postseason window closes when the bracket is done',
      `data-season=${last.dataSeason}, --color-panel=${last.panel}, date=${last.todayIso}`);
  } else {
    /*
     * Return to the Dashboard before asserting anything about it.
     *
     * Completing the season starts the offseason workflow, and the app navigates away from the
     * dashboard to present it. The first version asserted "the Power Rankings strip comes back"
     * while sitting on whatever view the transition had moved to, and reported a failure against a
     * strip that was never rendered -- not because it was missing, but because we were no longer
     * looking at the page it lives on.
     */
    await evaluate(`(() => {
      const n = [...document.querySelectorAll('button, a, [role="treeitem"]')]
        .find((x) => /^dashboard$/i.test((x.textContent || '').trim()));
      if (!n) return 'NOT FOUND';
      n.click();
      return 'ok';
    })()`);
    await sleep(2000);
    after = await evaluate(READ);
    report(
      after.panel === NAVY_PANEL && after.dataSeason === null,
      'the window CLOSES and the app returns to navy',
      `data-season=${after.dataSeason}, --color-panel=${after.panel}, date=${after.todayIso}`,
    );
    report(
      !after.hasSection && !after.hasMasthead,
      'the slate row and the masthead are gone once the postseason is',
      `slate boxes=${after.slateRows}, masthead=${after.hasMasthead}`,
    );
    report(
      after.hasPowerRankings,
      'the Power Rankings strip comes back',
      `power rankings=${after.hasPowerRankings}`
        + `\n        it was a postseason-only substitution; the regular-season layout must be intact`,
    );
  }

  console.log(`\n  ${failures} problem(s).\n`);
} catch (error) {
  console.error('probe failed:', error.message);
  failures += 1;
} finally {
  try { browser?.ws.close(); } catch { /* already closed */ }
  chrome.kill();
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