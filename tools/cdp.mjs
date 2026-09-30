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

  const probe = await browser.send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.getElementById('root');
      return JSON.stringify({
        title: document.title,
        rootChildren: root ? root.children.length : -1,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 900),
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  console.log('PAGE:', probe.result.value);

  if (outPng) {
    const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
    writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
    console.log('SCREENSHOT:', outPng);
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
