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
        //
        // Scoped to the nav's treeitem role, NOT to [aria-expanded] alone. The
        // header's Parlays button is a disclosure too and carries
        // aria-expanded, so a bare attribute selector opened the betting slip
        // on every run and then the explicit click closed it again -- which read
        // as the button doing nothing.
        const folders = [...document.querySelectorAll('button[role="treeitem"][aria-expanded]')]
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

  /*
   * Evaluate in the page and return the value.
   *
   * Hoisted to this scope deliberately. It used to be declared inside the
   * GPB_BET block, which meant every later block that called it -- GPB_SETTLE
   * included -- only worked if GPB_BET was ALSO set, and threw a bare
   * ReferenceError otherwise. A harness probe that silently requires another
   * probe is worse than no probe.
   */
  const evalJs = async (expression) => {
    const { result } = await browser.send(
      'Runtime.evaluate', { expression, returnByValue: true }, sessionId,
    );
    return result.value;
  };

  /*
   * Run a simulation from the Simulation Desk and report the completion panel.
   *
   * Does NOT navigate afterwards, unlike GPB_SETTLE: the panel is shell-level,
   * so hopping to Betting would hide whether the dashboard jump actually
   * happened, which is half of what this is here to check.
   */
  if (process.env.GPB_SIM) {
    /*
     * Clear the empty-player gate first.
     *
     * Every run gets a throwaway profile, so a fresh one lands on a save with 32
     * clubs, a schedule, and no players -- and there is no Sim Day button to
     * press, so the run reports "no button" and stops. That is a real condition,
     * not a harness fault: the gate is the one that catches a universe build
     * interrupted by a refresh. Clearing it here is what makes a single session
     * able to reach a played season, which anything about season aggregates
     * needs.
     */
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')]
        .find((n) => /rebuild/i.test((n.textContent||'').trim()));
      if (!b) return 'no repair gate';
      b.click();
      return 'repairing';
    })()`);
    // Repair generates and develops every player, so it is not quick. Poll for
    // the gate to disappear rather than sleeping a guessed interval.
    for (let t = 0; t < 90; t += 1) {
      const gone = await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')]
          .find((n) => /rebuild/i.test((n.textContent||'').trim()));
        return b ? 'no' : 'yes';
      })()`);
      if (gone === 'yes') break;
      await sleep(1000);
    }

    await evalJs(`(() => {
      const nav = [...document.querySelectorAll('button,a')]
        .find((n) => /^Dashboard$/i.test((n.textContent||'').trim()));
      if (nav) nav.click();
      return 'nav';
    })()`);
    await sleep(700);

    for (let i = 0; i < Number(process.env.GPB_SIM); i += 1) {
      // Dismiss a panel left over from the previous iteration.
      await evalJs(`(() => {
        const dismiss = [...document.querySelectorAll('button')]
          .find((n) => /back to dashboard/i.test((n.textContent||'').trim()));
        if (dismiss) dismiss.click();
        return 'dismissed';
      })()`);
      await sleep(500);

      const hit = await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')]
          .find((n) => new RegExp('^sim ' + ${JSON.stringify(process.env.GPB_SIM_SCOPE ?? 'day')} + '$', 'i')
            .test((n.textContent||'').trim()));
        if (!b) return 'no button';
        b.click();
        return 'sim';
      })()`);
      console.log('SIM', i + 1 + ':', hit);
      if (hit !== 'sim') break;

      // Poll for the panel rather than sleeping a fixed time: the run length
      // varies with the scope and a fixed sleep either races it or wastes 10s.
      let seen = false;
      for (let t = 0; t < 60; t += 1) {
        const ok = await evalJs(`(() => {
          const h = [...document.querySelectorAll('h2')].find((x) => /simulation complete/i.test(x.textContent||''));
          return h ? 'yes' : 'no';
        })()`);
        if (ok === 'yes') { seen = true; break; }
        await sleep(500);
      }
      console.log('PANEL', i + 1 + ':', seen ? 'opened' : 'never opened');
      if (!seen) break;

      console.log('STATE', i + 1 + ':', await evalJs(`(() => {
        const panel = [...document.querySelectorAll('h2')]
          .find((x) => /simulation complete/i.test(x.textContent||''))?.closest('div[class*="max-w"]');
        const active = [...document.querySelectorAll('[aria-current="page"], [aria-selected="true"]')]
          .map((n) => (n.textContent||'').trim()).slice(0, 3).join('/');

        // The day headline is the number and its unit as two flex children.
        // A screenshot cannot settle whether the space between them survived
        // the display face at 30px -- a narrow gap beside "1" reads as absent.
        // Measuring the gap answers it exactly.
        //
        // Located by child text, not by the paragraph's own textContent: the two
        // spans are adjacent, so that string is "1day", and a \\bday\\b pattern
        // cannot match across a digit-letter pair because both are word
        // characters. Matching the regex on the parent returns null and looks
        // like a layout failure rather than a selector failure.
        const headline = panel && [...panel.querySelectorAll('p')].find((p) =>
          [...p.children].some((c) => /^(day|days)$/i.test((c.textContent || '').trim())));
        const kids = headline ? [...headline.children].map((c) => c.getBoundingClientRect()) : [];
        const dayGap = kids.length === 2 ? Math.round(kids[1].left - kids[0].right) : null;

        return JSON.stringify({
          panel: (panel ? panel.innerText : '').replace(/\\s+/g, ' ').slice(0, 240),
          dayGap,
          active,
        });
      })()`));
    }
    // The dashboard re-mounts behind the panel when the run finishes, and it
    // needs a tick to paint. Without this the final screenshot catches the
    // view mid-mount and shows a blank body behind a correct panel, which reads
    // as the dashboard failing to render.
    await sleep(1200);
  }

  /*
   * Press a key for real, through the Input domain.
   *
   * Dispatched rather than synthesised with `new KeyboardEvent` inside the page:
   * an in-page event skips the browser's own key routing, so a handler that only
   * works because it was called directly still reports as working. Going through
   * CDP exercises the same path a person's keystroke takes.
   */
  if (process.env.GPB_KEY) {
    for (const spec of process.env.GPB_KEY.split('|').map((s) => s.trim()).filter(Boolean)) {
      const [name, rawKey] = spec.split('=');
      const key = rawKey || name;
      const code = {
        Escape: { windowsVirtualKeyCode: 27, code: 'Escape', text: '' },
        Enter: { windowsVirtualKeyCode: 13, code: 'Enter', text: '\r' },
        Tab: { windowsVirtualKeyCode: 9, code: 'Tab', text: '' },
        Space: { windowsVirtualKeyCode: 32, code: 'Space', text: ' ' },
      }[key] || { windowsVirtualKeyCode: 0, code: key, text: key };

      for (const type of ['keyDown', 'keyUp']) {
        await browser.send('Input.dispatchKeyEvent', {
          type,
          key,
          code: code.code,
          windowsVirtualKeyCode: code.windowsVirtualKeyCode,
          nativeVirtualKeyCode: code.windowsVirtualKeyCode,
          text: type === 'keyDown' ? code.text : undefined,
        }, sessionId);
      }
      console.log('KEY:', name, '->', 'dispatched');
      // Settle before reporting. React has not processed the event yet at the
      // instant the key goes down, and AnimatePresence keeps the node mounted
      // through a 0.32s exit -- so checking straight away reports "still open"
      // for a panel that closed correctly, which is how a working Escape gets
      // written off as a broken one.
      await sleep(800);
      console.log('  after ' + name + ':', await evalJs(`(() => {
        const h = [...document.querySelectorAll('h2')].find((x) => /simulation complete/i.test(x.textContent||''));
        return h ? 'PANEL STILL OPEN' : 'panel closed';
      })()`));
      await sleep(200);
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

  }

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

  /** Click any visible control by its label. */
  if (process.env.GPB_CLICK) {
    for (const label of process.env.GPB_CLICK.split('|').map((s) => s.trim()).filter(Boolean)) {
      const { result } = await browser.send('Runtime.evaluate', {
        expression: `(() => {
          const want = ${JSON.stringify(label.toLowerCase())};
          const n = [...document.querySelectorAll('button,a,[role="tab"],[role="treeitem"]')]
            .find((x) => (x.textContent || '').trim().toLowerCase().includes(want));
          if (!n) return 'not found: ' + want;
          const before = n.getAttribute('aria-expanded');
          n.click();
          return 'clicked <' + n.tagName + '> "' + (n.textContent || '').trim().slice(0, 30)
            + '" aria-expanded ' + before;
        })()`,
        returnByValue: true,
      }, sessionId);
      console.log('CLICK:', result.value);
      await sleep(1500);

      // Report the sim receipt's state alongside the click.
      //
      // This is what catches a stale receipt. Starting a second run while the
      // first run's panel is still up used to leave the old day count and
      // signing figure on screen for the whole second run -- stale numbers that
      // still look authoritative, which is worse than no panel.
      console.log('  receipt:', await evalJs(`(() => {
        const h = [...document.querySelectorAll('h2')].find((x) => /simulation complete/i.test(x.textContent||''));
        if (!h) return 'no receipt on screen';
        const p = h.closest('div[class*="max-w"]');
        return 'OPEN: ' + (p ? (p.innerText||'').replace(/\\s+/g,' ').slice(0,110) : '?');
      })()`));
    }
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

  /*
   * An arbitrary measurement, last.
   *
   * The fixed probes all run BEFORE GPB_SIM, because the file reads top to
   * bottom and the simulation block sits in the middle. Anything that needs a
   * played season -- which is most of what props depend on, since a prop is
   * priced off season aggregates -- therefore had nowhere to ask its question.
   * This takes an expression and evaluates it once everything else has run, so a
   * probe can measure the state the run actually produced.
   *
   * GPB_EVAL_MORE repeats the step, because a single expression cannot drive a
   * click and then measure the consequence of it. Each is a whole expression
   * returning anything JSON-serialisable; the harness prints whatever comes back.
   */
  for (const key of ['GPB_EVAL', 'GPB_EVAL_MORE', 'GPB_EVAL_THIRD']) {
    if (!process.env[key]) continue;
    const result = await browser.send('Runtime.evaluate', {
      expression: String(process.env[key]),
      returnByValue: true,
      awaitPromise: true,
    }, sessionId);
    const value = result.exceptionDetails
      ? 'THREW: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
      : result.result.value;
    console.log(`${key}:`, typeof value === 'string' ? value : JSON.stringify(value));
  }

  // Final state, after everything above has run.
  const finalProbe = await browser.send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.getElementById('root');
      const parlays = [...document.querySelectorAll('button')]
        .find((b) => /parlays/i.test(b.textContent || ''));
      return JSON.stringify({
        title: document.title,
        rootChildren: root ? root.children.length : -1,
        // Whether the header's Parlays control reports itself expanded, and
        // whether a dialog is actually in the tree. A button that toggles state
        // without rendering anything is the failure this catches.
        parlaysExpanded: parlays ? parlays.getAttribute('aria-expanded') : 'button missing',
        slipOpen: Boolean(document.querySelector('[role="dialog"]')),
        /*
         * Table geometry: header cells / body cells, per table. A mismatch is
         * the column-misalignment bug, and it is invisible in a downscaled
         * screenshot because both rows look individually plausible -- you have
         * to count them.
         */
        tables: [...document.querySelectorAll('table')].slice(0, 8).map((t) => {
          const head = t.querySelector('thead tr');
          const first = t.querySelector('tbody tr');
          if (!head || !first) return 'none';
          // Cell counts can agree while the geometry is wrong, so compare the
          // actual left edges too. Matching left edges is the real assertion.
          const hx = [...head.children].map((c) => Math.round(c.getBoundingClientRect().left));
          const bx = [...first.children].map((c) => Math.round(c.getBoundingClientRect().left));
          const drift = hx.map((x, i) => (bx[i] === undefined ? 999 : x - bx[i]));
          const maxDrift = Math.max(...drift.map(Math.abs));
          return head.children.length + '/' + first.children.length
            + ' drift ' + (drift.join(',') || '-') + ' max ' + maxDrift;
        }).join(' | '),
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
