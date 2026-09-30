/**
 * Drive headless Chrome over the DevTools protocol to see what the page does.
 *
 * There is no desktop browser attached to this session, and no Playwright in
 * node_modules, so this speaks CDP directly over the websocket that `ws` already
 * provides. It loads the app, collects every console message and page error,
 * optionally clicks through to a view, and writes a screenshot.
 *
 *   node tools/cdp.mjs <url> [viewLabel] [outPng]
 *
 * The screenshot is the point: a page that throws during render paints a blank
 * frame, and a screenshot distinguishes "did not run" from "ran and looked wrong".
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const url = process.argv[2] ?? 'http://localhost:3000/';
const wantView = process.argv[3] ?? '';
const outPng = process.argv[4] ?? '';

const profile = mkdtempSync(join(tmpdir(), 'gpb-cdp-'));
const port = 9222 + Math.floor(Math.random() * 400);

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--window-size=1600,1100',
  '--hide-scrollbars',
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
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.handlers = []; }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cdp = new CDP(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && cdp.waiting.has(msg.id)) {
        const { resolve, reject } = cdp.waiting.get(msg.id);
        cdp.waiting.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
        else resolve(msg.result);
      } else if (msg.method) {
        cdp.handlers.forEach((h) => h(msg));
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

  on(fn) { this.handlers.push(fn); }
}

const main = async () => {
  const wsUrl = await endpoint();
  const browser = await CDP.attach(wsUrl);

  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  const logs = [];
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.unserializableValue ?? JSON.stringify(a.preview ?? ''))
        .join(' ');
      logs.push({ level: msg.params.type, text });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push({
        level: 'exception',
        text: d.exception?.description ?? d.text ?? 'unknown exception',
      });
    }
    if (msg.method === 'Log.entryAdded') {
      logs.push({ level: msg.params.entry.level, text: msg.params.entry.text });
    }
  });

  await browser.send('Runtime.enable', {}, sessionId);
  await browser.send('Log.enable', {}, sessionId);
  await browser.send('Page.enable', {}, sessionId);
  await browser.send('Page.navigate', { url }, sessionId);
  await sleep(4000);

  /**
   * Click a chain of labels in one session.
   *
   * Each run gets a throwaway browser profile, so localStorage starts empty and
   * a save built by a previous run is gone. Anything that has to follow a repair
   * or a rebuild therefore has to happen inside a single session, which is why
   * this takes a list rather than one label.
   */
  const clickLabel = async (label) => {
    const script = `(() => {
      const want = ${JSON.stringify(label.toLowerCase())};
      const nodes = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
      const hit = nodes.find((n) => (n.textContent || '').trim().toLowerCase() === want)
        || nodes.find((n) => (n.textContent || '').trim().toLowerCase().includes(want));
      if (hit) { hit.click(); return 'clicked: ' + (hit.textContent || '').trim(); }
      return 'NOT FOUND: ' + want + ' | visible: ' + nodes.map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 30).join(' ~ ');
    })()`;
    const { result } = await browser.send('Runtime.evaluate', { expression: script, returnByValue: true }, sessionId);
    console.log('NAV:', result.value);
  };

  for (const label of wantView ? wantView.split('|').map((s) => s.trim()).filter(Boolean) : []) {
    await clickLabel(label);
    await sleep(label.toLowerCase().includes('repair') || label.toLowerCase().includes('rebuild') ? 12000 : 3000);
  }

  /**
   * Nav folders are collapsed by default, so a leaf like Betting is not in the
   * DOM until its folder is opened. Every clickable element is tried in turn and
   * the requested label is looked for again after each, which reaches a leaf
   * without hardcoding the folder layout.
   */
  // Expand the nav folders and open Betting, whenever a screenshot is wanted.
  // Passing "Betting" in the label chain is enough to trigger this too.
  if (process.env.GPB_BETTING || wantView.split('|').some((s) => /betting/i.test(s))) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const { result } = await browser.send('Runtime.evaluate', {
        expression: `(() => {
          if ([...document.querySelectorAll('button,a,[role="button"]')]
            .some((n) => /betting/i.test(n.textContent || ''))) return 'already visible';
          const folders = [...document.querySelectorAll('button,a,[role="button"]')]
            .filter((n) => /^(HOME|COMMISSIONER|SCORES|LEAGUE|TEAMS|PLAYOFFS|SYSTEM)$/i.test((n.textContent || '').trim()));
          if (!folders.length) return 'no folders found';
          const next = folders.find((f) => f.getAttribute('aria-expanded') !== 'true') || folders[0];
          next.click();
          return 'expanded: ' + (next.textContent || '').trim();
        })()`,
        returnByValue: true,
      }, sessionId);
      console.log('FOLDER:', result.value);
      await sleep(700);
      const { result: check } = await browser.send('Runtime.evaluate', {
        expression: `(() => {
          const hit = [...document.querySelectorAll('button,a,[role="button"]')]
            .find((n) => /betting/i.test(n.textContent || ''));
          if (!hit) return 'not yet';
          hit.click();
          return 'clicked Betting';
        })()`,
        returnByValue: true,
      }, sessionId);
      if (check.value === 'clicked Betting') break;
    }
    await sleep(3000);
  }

  /*
   * The final screenshot is taken at the very END, after navigation, tab
   * selection and any bet. It used to fire here, immediately after load, which
   * meant a run that navigated to Betting and placed a bet still produced a
   * picture of the dashboard -- the evidence looked like the navigation had
   * failed when it had actually worked.
   */
  const shoot = async (file) => {
    const shot = await browser.send(
      'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId,
    );
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT:', file);
  };

  /**
   * Open a specific nav leaf. Expanding folders alone does not pick a view, and
   * which leaf ends up selected depends on the expansion order, so a screenshot
   * of "the dashboard" needs the dashboard asked for by name.
   */
  /**
   * Dump a slice of the DOM, for when a screenshot shows something wrong and
   * the question is which class is actually on the element.
   */
  /** Read a computed style property off a matched element. */
  if (process.env.GPB_CSS) {
    const [label, prop] = process.env.GPB_CSS.split('|');
    const css = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify((label || '').toLowerCase())};
        const n = [...document.querySelectorAll('button, div, span')]
          .find((b) => (b.textContent||'').trim().toLowerCase() === want);
        if (!n) return 'not found';
        const cs = getComputedStyle(n);
        return JSON.stringify({
          backgroundImage: cs.backgroundImage.slice(0, 220),
          backgroundSize: cs.backgroundSize,
          backgroundPosition: cs.backgroundPosition,
          isolation: cs.isolation,
          chev: cs.getPropertyValue('--chev'),
          clip: cs.clipPath,
          paddingRight: cs.paddingRight,
          width: n.getBoundingClientRect().width,
          textWidth: (() => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().width; })(),
        });
      })()`,
      returnByValue: true,
    }, sessionId);
    console.log('CSS:', String(css.result?.value ?? JSON.stringify(css.result)));
  }

  /** Screenshot a single element, for inspecting a detail at full resolution. */
  if (process.env.GPB_CLIP && outPng) {
    const box = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify(process.env.GPB_CLIP)};
        const n = [...document.querySelectorAll('button')].find((b) => (b.textContent||'').trim().toLowerCase() === want.toLowerCase());
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, scale: 3 });
      })()`,
      returnByValue: true,
    }, sessionId);
    const parsed = JSON.parse(String(box.result?.value ?? 'null') ?? 'null');
    if (parsed) {
      const shot = await browser.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height, scale: parsed.scale },
      }, sessionId);
      const clipFile = outPng.replace(/\.png$/, '-clip.png');
      writeFileSync(clipFile, Buffer.from(shot.data, 'base64'));
      console.log('CLIP:', clipFile, `${Math.round(parsed.width)}x${Math.round(parsed.height)}`);
    } else {
      console.log('CLIP: element not found');
    }
  }

  if (process.env.GPB_PROBE) {
    const probe = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify(process.env.GPB_PROBE)};
        const nodes = [...document.querySelectorAll('button, h2, span, div')];
        const hit = nodes.filter((n) => (n.textContent || '').trim().toLowerCase().includes(want.toLowerCase()));
        return hit.slice(-3).map((n) => n.tagName + ' :: ' + (n.className || '(none)').toString().slice(0, 400)).join('  |  ');
      })()`,
      returnByValue: true,
    }, sessionId);
    console.log('PROBE:\n' + String(probe.result?.value ?? JSON.stringify(probe.result)));
  }

  if (process.env.GPB_VIEW) {
    const opened = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        // Open every collapsed folder in ONE pass. An earlier version clicked
        // "the first folder that is not expanded" on each pass, which toggles
        // the same folder back and forth forever and never reaches the one you
        // wanted. This is a test-harness bug, not a product one, but it looks
        // exactly like the app refusing to navigate.
        const folders = [...document.querySelectorAll('button[aria-expanded]')]
          .filter((f) => f.getAttribute('aria-expanded') !== 'true');
        folders.forEach((f) => f.click());
        return 'expanded ' + folders.length + ' folders';
      })()`,
      returnByValue: true,
    }, sessionId);
    console.log('FOLDERS:', opened.result?.value);
    await sleep(900);

    const { result } = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify(process.env.GPB_VIEW)};
        const n = [...document.querySelectorAll('button,a,[role="treeitem"]')]
          .find((x) => (x.textContent || '').trim().toLowerCase() === want.toLowerCase());
        if (!n) return 'NOT FOUND: ' + want;
        n.click();
        return 'opened ' + want;
      })()`,
      returnByValue: true,
    }, sessionId);
    console.log('VIEW:', result.value);
    await sleep(2500);
  }

  /**
   * Visit a tab on the current screen, for the parts of the page no single
   * screenshot covers. Season Futures and Awards were wired and type-checked
   * but never rendered, which is exactly the gap a smoke test leaves.
   */
  if (process.env.GPB_TAB) {
    const { result } = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify(process.env.GPB_TAB)};
        const b = [...document.querySelectorAll('button,[role="tab"]')]
          .find((n) => (n.textContent||'').trim().toLowerCase() === want.toLowerCase());
        if (!b) return 'tab not found: ' + want;
        b.click();
        return 'clicked ' + want;
      })()`,
      returnByValue: true,
    }, sessionId);
    console.log('TAB:', result.value);
    await sleep(2500);

    if (outPng) {
      const shot = await browser.send(
        'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId,
      );
      const tabFile = outPng.replace(/\.png$/, `-${process.env.GPB_TAB.replace(/\W+/g, '')}.png`);
      writeFileSync(tabFile, Buffer.from(shot.data, 'base64'));
      console.log('SCREENSHOT:', tabFile);
    }
  }

  /**
   * Place one bet, to check the slip actually commits and the balance moves.
   *
   * A board that renders and throws on click looks identical to one that works
   * in a screenshot, and "the numbers are on the page" is not the same claim as
   * "a stake is recorded against them".
   */
  if (process.env.GPB_BET) {
    const evalJs = async (expression) => {
      const { result } = await browser.send(
        'Runtime.evaluate', { expression, returnByValue: true }, sessionId,
      );
      return result.value;
    };

    console.log('BET:', await evalJs(`(() => {
      const pick = [...document.querySelectorAll('button')].find((b) => /^Over \\d/.test((b.textContent||'').trim()));
      if (!pick) return 'no Over button found';
      pick.click();
      return 'clicked ' + (pick.textContent||'').trim();
    })()`));
    await sleep(1200);

    console.log('SLIP:', await evalJs(`(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => /Bet Slip/i.test(x.textContent||''));
      const panel = h && h.closest('div[class*="overflow"]');
      return panel ? (panel.innerText||'').replace(/\\s+/g,' ').slice(0,300) : 'slip panel not found';
    })()`));

    console.log('CONFIRM:', await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^Place \\$\\d+ bet$/.test((x.textContent||'').trim()));
      if (!b) return 'confirm button not found';
      b.click();
      return 'placed';
    })()`));
    await sleep(1500);

    /**
     * Play the slate out, so the bet can settle against real results.
     *
     * A bet that records and never resolves is half a feature, and the only way
     * to see settlement is to let the simulation run past the games the bets are
     * on. This clicks Sim Day repeatedly and then reads the record back.
     */
    if (process.env.GPB_SETTLE) {
      for (let day = 0; day < Number(process.env.GPB_SETTLE); day += 1) {
        const clicked = await evalJs(`(() => {
          const nav = [...document.querySelectorAll('button,a')]
            .find((n) => /^Dashboard$/i.test((n.textContent||'').trim()));
          if (nav) nav.click();
          return 'nav';
        })()`);
        void clicked;
        await sleep(700);
        const sim = await evalJs(`(() => {
          const b = [...document.querySelectorAll('button')].find((n) => /sim day/i.test((n.textContent||'').trim()));
          if (!b) return 'no Sim Day';
          b.click();
          return 'sim';
        })()`);
        if (sim !== 'sim') { console.log('SIM:', sim); break; }
        await sleep(1600);
        // Back to the board.
        await evalJs(`(() => {
          const nav = [...document.querySelectorAll('button,a')]
            .find((n) => /^Betting$/i.test((n.textContent||'').trim()));
          if (nav) { nav.click(); return 'back'; }
          return 'nav missing';
        })()`);
        await sleep(1200);
      }

      console.log('RECORD:', await evalJs(`(() => {
        const h = [...document.querySelectorAll('h2')].find((x) => /Betting Record/i.test(x.textContent||''));
        const panel = h && h.closest('div[class*="overflow"]');
        const open = [...document.querySelectorAll('h2')].find((x) => /Open Bets/i.test(x.textContent||''));
        return JSON.stringify({
          record: panel ? (panel.innerText||'').replace(/\\s+/g,' ').slice(0,260) : 'no record panel',
          openBets: open ? 'still open' : 'none open',
        });
      })()`));

      console.log('BALANCE:', await evalJs(`(() => {
        const bal = [...document.querySelectorAll('span,p')].find((n) => /^\\$\\d{2,}$/.test((n.textContent||'').trim()));
        return bal ? bal.textContent.trim() : 'not found';
      })()`));
    }

    console.log('AFTER:', await evalJs(`(() => {
      const bal = [...document.querySelectorAll('span,p')]
        .find((n) => /^\\$\\d{2,}$/.test((n.textContent||'').trim()));
      const open = [...document.querySelectorAll('h2')].find((h) => /Open Bets/i.test(h.textContent||''));
      return JSON.stringify({
        balance: bal ? bal.textContent.trim() : 'not found',
        openBets: open ? (open.closest('div[class*="overflow"]')?.innerText||'').replace(/\\s+/g,' ').slice(0,220) : 'NO OPEN BETS',
      });
    })()`));
  }

  /**
   * Capture the gold sweep mid-travel.
   *
   * A hover style that only exists while the pointer is down cannot be seen in a
   * normal screenshot, so the sweep is checked by holding the pointer on a nav
   * item and grabbing frames across the transition. If the gradient does not
   * move, the whole point of it is missing and nothing else in the screenshot
   * would say so.
   */
  if (process.env.GPB_HOVER) {
    const target = await browser.send('Runtime.evaluate', {
      expression: `(() => {
        const want = ${JSON.stringify(process.env.GPB_HOVER)};
        const n = [...document.querySelectorAll('button,a,[role="treeitem"]')]
          .find((x) => (x.textContent || '').trim().toLowerCase() === want.toLowerCase());
        if (!n) return null;
        const r = n.getBoundingClientRect();
        n.scrollIntoView({ block: 'center' });
        return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height });
      })()`,
      returnByValue: true,
    }, sessionId);
    const t = JSON.parse(String(target.result?.value ?? 'null') ?? 'null');
    if (t) {
      await browser.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: t.x, y: t.y, buttons: 0,
      }, sessionId);
      for (const [i, delay] of [0, 90, 200, 420].entries()) {
        await sleep(i === 0 ? 0 : delay);
        const shot = await browser.send('Page.captureScreenshot', {
          format: 'png',
          clip: {
            x: Math.max(0, t.x - t.w - 20), y: Math.max(0, t.y - t.h - 8),
            width: t.w + 40, height: t.h * 3 + 24, scale: 3,
          },
        }, sessionId);
        const file = outPng
          ? outPng.replace(/\.png$/, `-hover${i}.png`)
          : `hover${i}.png`;
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        console.log('HOVER FRAME:', file);
      }
    } else {
      console.log('HOVER: target not found');
    }
  }

  // Final state, after everything above has run.
  const finalProbe = await browser.send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.getElementById('root');
      return JSON.stringify({
        title: document.title,
        rootChildren: root ? root.children.length : -1,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  console.log('PAGE:', finalProbe.result.value);

  if (outPng) await shoot(outPng);

  console.log('\n--- console (' + logs.length + ') ---');
  const seen = new Set();
  logs.forEach((l) => {
    const key = `${l.level}:${l.text.slice(0, 120)}`;
    if (seen.has(key)) return;
    seen.add(key);
    console.log(`  [${l.level}] ${l.text.slice(0, 700)}`);
  });
  if (logs.length === 0) console.log('  (silent)');

  browser.ws.close();
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
};

main().catch((err) => {
  console.error('CDP FAILED:', err.message);
  chrome.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  process.exit(1);
});
