/**
 * What does each Simulation Desk button actually DO?
 *
 * Both defects this probe exists for produced no error, no console message and no visual sign that
 * anything was wrong -- they were reported as "seems to just sim the day", which is a complaint
 * about behaviour and not a failing assertion anywhere.
 *
 *   Next Game  read `date >= startDate` when looking for the club's next fixture. All 32 clubs are
 *              scheduled on all but a handful of slate dates, so the club's next game was always
 *              today's, the plan collapsed to a single date, and the button did exactly what Sim Day
 *              does -- silently, two buttons apart.
 *
 *   Quick Sim  ran `{ scope: 'season' }`, which is regular-season end plus seventy days. One press
 *              took a league through the postseason and into the offseason with nothing on screen
 *              saying so. Now bounded by `nextSeasonStop`.
 *
 * The measurement is the completion receipt's own day count, read off the panel rather than inferred
 * from the date, because that count comes from the plan handed to the worker -- it is the number the
 * app itself reports for how far it went. Asserting on a date difference instead would pass on a run
 * that simulated the right span in the wrong number of steps.
 *
 * Run: node tools/probeSimDesk.mjs [url]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-simdesk-'));
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

/**
 * The date the league is on, plus the completion receipt.
 *
 * Both date shapes have to be handled, and getting this wrong cost a whole run of the probe before
 * it was caught: the receipt prints ISO (`2026-04-07`) while the Season Cycle strip and the ticker
 * print `Apr 7, 2026`. The first version of this matched only the long form, so the receipt regex
 * never fired and two real, passing runs reported as "no receipt within 60s" -- a broken probe
 * reading exactly like broken behaviour, which is the more expensive of the two mistakes.
 *
 * Everything is normalised to ISO before it is compared, so the two surfaces can be compared at all.
 *
 * The receipt's day count is the measurement rather than a date subtraction: it comes off the plan
 * handed to the worker, so it is the app's own answer for how far it went.
 */
const READ_STATE = `(() => {
  const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const toIso = (value) => {
    if (!value) return null;
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return value;
    const m = /^([A-Za-z]{3})\\w* (\\d{1,2}), (\\d{4})$/.exec(value.trim());
    if (!m) return null;
    const mm = MONTHS[m[1].toLowerCase()];
    return mm ? m[3] + '-' + mm + '-' + m[2].padStart(2, '0') : null;
  };

  /*
   * The receipt is read from its own role="status" element, not by regexing the page.
   *
   * Two versions of this failed before it worked, and both failed as "no receipt within 60s" on runs
   * that had actually completed -- a broken probe that reads exactly like broken behaviour.
   *
   * The first matched "N days simulated" across the whole body's innerText. It never fired because
   * the receipt deliberately renders the number and its unit as SEPARATE elements with a real gap
   * between them, so innerText contains "1\\nday\\nsimulated", never "1 day simulated". The second
   * attempt fixed the date format and still failed, because the same line-break problem was
   * unrelated to the format.
   *
   * So: take the element, read textContent (which does not insert line breaks between inline boxes),
   * and take the day count off the element that holds it rather than parsing it out of a sentence.
   */
  const panel = document.querySelector('[role="status"]');
  const daysEl = panel ? panel.querySelector('.tabular-nums') : null;
  const panelText = panel ? panel.textContent : '';

  // A whitespace class between the two words, not a literal space. The receipt's JSX wraps that line,
  // so textContent carries a newline between "completed" and "through". A literal space there is
  // what made the date read as null on a run that had genuinely landed on the right day -- the
  // receipt was correct and the probe was asserting against a string it could never match.
  const through = /completed\\s+through\\s+(\\d{4}-\\d{2}-\\d{2})/.exec(panelText);
  const label = panel ? (panel.querySelector('p') ? panel.querySelector('p').textContent : null) : null;

  const text = document.body.innerText;
  const todayLong = /Today\\s+([A-Z][a-z]{2,8}\\w* \\d{1,2}, \\d{4})/.exec(text);
  const todayIso = /Today\\s+(\\d{4}-\\d{2}-\\d{2})/.exec(text);

  return {
    today: toIso(todayIso ? todayIso[1] : (todayLong ? todayLong[1] : null)),
    todayRaw: todayIso ? todayIso[1] : (todayLong ? todayLong[1] : null),
    receiptPresent: !!panel,
    receiptLabel: label,
    receiptDays: daysEl ? Number(daysEl.textContent) : null,
    receiptThrough: through ? toIso(through[1]) : null,
    receiptThroughRaw: through ? through[1] : null,
    panelText: panelText.slice(0, 120),
  };
})()`;

const CLICK_DESK = (pattern) => `(() => {
  const re = ${pattern};
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
    '--window-size=1600,1100',
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

/**
 * Click one desk button and wait for the run to finish.
 *
 * Polls rather than sleeping a fixed interval: a fixed sleep is a flake that only shows up on a slow
 * machine, and the receipt only exists after the transition into `complete`. The bound is generous
 * because the milestone run crosses most of a season.
 */
const runDeskButton = async (pattern, maxSeconds) => {
  const before = await evaluate(READ_STATE);
  const clicked = await evaluate(CLICK_DESK(pattern));
  if (clicked === 'NOT FOUND' || clicked === 'DISABLED' || (clicked && clicked.threw)) {
    return { clicked, before, after: null };
  }
  let after = null;
  for (let i = 0; i < maxSeconds; i += 1) {
    await sleep(1000);
    const state = await evaluate(READ_STATE);
    if (state.receiptDays !== null) {
      after = state;
      break;
    }
  }
  return { clicked, before, after };
};

try {
  browser = await CDP.attach(await endpoint());
  const { targetInfos } = await browser.send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const attached = await browser.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  sessionId = attached.sessionId;
  await browser.send('Runtime.enable', {}, sessionId);
  await sleep(2500);

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /repair player pool/i.test(n.textContent || ''));
    if (b) b.click();
    return 'repaired';
  })()`);
  await sleep(2000);

  // The milestone dates the desk is supposed to stop at, read from the Season Cycle strip already
  // on screen. Comparing the run's destination against the app's own published date is the whole
  // point: a hardcoded expectation here would pass even if both moved together.
  const milestones = await evaluate(`(() => {
    const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const toIso = (v) => {
      const m = /^([A-Za-z]{3})\\w* (\\d{1,2}), (\\d{4})$/.exec((v || '').trim());
      return m && MONTHS[m[1].toLowerCase()] ? m[3] + '-' + MONTHS[m[1].toLowerCase()] + '-' + m[2].padStart(2, '0') : null;
    };
    const text = document.body.innerText;
    const grab = (label) => {
      const m = new RegExp(label + '\\\\s+([A-Z][a-z]{2,8}\\\\w* \\\\d{1,2}, \\\\d{4})').exec(text);
      return m ? toIso(m[1]) : null;
    };
    return {
      allStar: grab('All-Star Break'),
      trade: grab('Trade Deadline'),
      finale: grab('Regular Season Finale'),
      playoffs: grab('Playoffs Begin'),
    };
  })()`);
  console.log(`\nSEASON EVENTS as the app publishes them:`);
  console.log(`  All-Star Break ${milestones.allStar}   Trade Deadline ${milestones.trade}`);
  console.log(`  Regular Season Finale ${milestones.finale}   Playoffs Begin ${milestones.playoffs}\n`);

  /* ---------------------------------------------------------------- 1. the buttons themselves */

  console.log('=== 1. WHAT IS ON THE DESK ===\n');
  const desk = await evaluate(`(() => {
    const wanted = [/^sim day$/i, /^sim week$/i, /^sim month$/i, /next game$/i, /^to /i, /reg finale$/i];
    const all = [...document.querySelectorAll('button')];
    return all.filter((b) => wanted.some((re) => re.test((b.textContent || '').trim())))
      .map((b) => ({
        label: (b.textContent || '').trim(),
        disabled: b.disabled,
        clip: getComputedStyle(b).clipPath,
        pl: getComputedStyle(b).paddingLeft,
        pr: getComputedStyle(b).paddingRight,
      }));
  })()`);

  const labels = desk.map((b) => b.label);
  report(
    !labels.some((l) => /^quick sim$/i.test(l)),
    '"Quick Sim" is gone from the desk',
    `labels: ${labels.join(' | ')}`,
  );
  report(
    !labels.some((l) => /^reset season$/i.test(l)),
    '"Reset Season" is gone from the desk',
    'a reset is reachable from the offseason panel, labelled for what it does there',
  );
  report(
    !labels.some((l) => /^to date$/i.test(l)),
    'the bare "To Date" button is gone from the desk',
    'it depended on a selected date the dashboard never offers a way to set; it survives on the Simulation screen above a date field',
  );
  report(
    !labels.some((l) => /next game$/i.test(l)),
    '"Next Game" is gone from the desk',
    'it resolved to Sim Day on every ordinary day, because every club has a fixture on the current slate; removed rather than repaired, and the scope is untouched elsewhere',
  );
  report(
    desk.every((b) => b.clip.startsWith('polygon')),
    'every desk button is a clipped shape',
    `${desk.filter((b) => b.clip.startsWith('polygon')).length}/${desk.length} carry a clip-path`,
  );
  report(
    desk.every((b) => b.pl === b.pr),
    'every desk button has symmetric padding',
    `left/right: ${desk.map((b) => `${b.pl}/${b.pr}`).join(' ')} -- asymmetric padding shears the label at one cut corner`,
  );

  /* ---------------------------------------------------------------- 2. the bounded long run */

  console.log('\n=== 2. THE LONG RUN STOPS AT A SEASON EVENT ===\n');
  const longRun = await runDeskButton('/^to all-star break$/i', 240);
  const before = longRun.before;
  const after = longRun.after;

  if (!after) {
    report(false, 'the milestone run completes', `clicked: ${longRun.clicked}, no receipt within 240s`);
  } else {
    console.log(`        started ${before.today}, receipt "${after.receiptDays} days through ${after.receiptThrough}"`);
    report(
      after.receiptThrough === milestones.allStar,
      'the run stops exactly on the All-Star Break the app publishes',
      `landed ${after.receiptThrough}, app publishes All-Star Break as ${milestones.allStar}`
        + (after.receiptDays !== null ? `, over ${after.receiptDays} days` : ''),
    );
    report(
      after.receiptThrough !== milestones.playoffs && after.receiptThrough !== milestones.finale,
      'the run does NOT run past the regular season into the playoffs',
      `the old "Quick Sim" targeted finale + 70 days, which is past Playoffs Begin (${milestones.playoffs})`,
    );
  }

  /* ---------------------------------------------------------------- 3. the desk relabels */

  console.log('\n=== 3. THE BUTTON RENAMES ITSELF AS THE SEASON MOVES ===\n');
  const relabel = await evaluate(`(() => {
    const wanted = [/^to /i];
    return [...document.querySelectorAll('button')]
      .filter((b) => wanted.some((re) => re.test((b.textContent || '').trim())))
      .map((b) => (b.textContent || '').trim());
  })()`);
  report(
    relabel.some((l) => /trade deadline|season finale|season end/i.test(l)),
    'the long-run button now names a later event',
    `now reads: ${relabel.join(' | ')} -- it should have moved past the All-Star Break the run just stopped on`,
  );

  console.log(`\n  ${failures} failure(s).\n`);
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