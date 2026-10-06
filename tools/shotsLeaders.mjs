/**
 * Screenshot the Leaders boards so the new rate categories can be LOOKED at.
 *
 * Built because `qaSweep` reports that a view is clean, and "clean" means no errors and no
 * overflow. It cannot tell you that a board titled "Strikeout Rate" is sorted so the league's
 * worst hitter is rank 1 -- which is exactly what happened to `K − BB%` before someone opened the
 * browser, and which no type checker or unit test catches. A new category whose `direction` is
 * wrong is a green build and a wrong screen.
 *
 * So this walks the batting and pitching category selectors, screenshots each, and prints the
 * top row. A rate board that leads with the wrong player is visible in the numbers even when it
 * looks fine in a picture.
 *
 * Run: node tools/shotsLeaders.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const outDir = process.argv[3] ?? 'C:/Users/ADMIN/AppData/Local/Temp/leaders';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gpb-leaders-'));
mkdirSync(outDir, { recursive: true });

const width = Number(process.env.GPB_QA_WIDTH ?? 1500);
const height = Number(process.env.GPB_QA_HEIGHT ?? 1250);
const tag = process.env.GPB_QA_TAG ?? `${width}`;

let chrome = null;
let browser = null;
let sessionId = null;

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
  const r = await browser.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  return r.exceptionDetails
    ? 'THREW: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    : r.result.value;
};

let errors = [];
let exceptions = [];

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

/**
 * Open a board by clicking its CARD, not by looking for a button with the board's name.
 *
 * The first version searched for `button, [role=tab], [role=radio]` matching the board title and
 * reported NOT FOUND for all seven new boards -- because a board is not a control with that label.
 * It is a `CategoryPanel` card in a grid, and the segmented control above only switches
 * players/teams and batting/pitching/awards. So the click target is the element carrying the
 * board title, whatever tag that turns out to be, and the probe says which tag it found so a miss
 * is diagnosable instead of looking like a missing board.
 */
/**
 * Open a board by clicking its CARD HEADER, matched on the `t-label` span inside the button.
 *
 * THREE FAILED VERSIONS, all "NOT FOUND" on boards the survey proved were on screen:
 *
 *   1. `textContent === title` -- no. The button's textContent is title + mean + count, so an
 *      exact match never hits. The title is one span among three children.
 *   2. `aria-label === title` -- no. `CategoryPanel` puts the title in a SPAN and uses
 *      `aria-pressed` for state; the button carries no aria-label at all.
 *   3. Clicking the `[role="table"][aria-label$=" leaders"]` wrapper -- the table is not clickable;
 *      the card HEADER is, and it calls `onSelect`.
 *
 * So: find the `t-label` span whose text is exactly the title, then click its closest button.
 * The survey above prints every `role="table"` label, so a future miss names what was actually
 * there instead of reporting a confident absence.
 */
const openBoard = (title) => evaluate(`(() => {
  const w = ${JSON.stringify(title.toLowerCase())};
  const spans = [...document.querySelectorAll('span.t-label')]
    .filter((s) => (s.textContent || '').trim().toLowerCase() === w);
  if (spans.length === 0) {
    const seen = [...document.querySelectorAll('span.t-label')]
      .map((s) => (s.textContent || '').trim()).slice(0, 20);
    return 'NOT FOUND. on screen: ' + JSON.stringify(seen);
  }
  const btn = spans[0].closest('button');
  if (!btn) return 'title span has no button ancestor';
  btn.click();
  return 'clicked';
})()`);

/** Switch the players/teams and batting/pitching/awards segmented controls by their aria-label. */
const setSegment = (groupLabel, optionLabel) => evaluate(`(() => {
  const g = [...document.querySelectorAll('[role="group"]')]
    .find((x) => (x.getAttribute('aria-label') || '') === ${JSON.stringify(groupLabel)});
  if (!g) return 'NO GROUP ' + ${JSON.stringify(groupLabel)};
  const btn = [...g.querySelectorAll('button')]
    .find((b) => (b.textContent || '').trim().toLowerCase() === ${JSON.stringify(optionLabel.toLowerCase())});
  if (!btn) return 'NO OPTION ' + ${JSON.stringify(optionLabel)};
  btn.click();
  return 'ok';
})()`);

/**
 * Navigate by nav-rail leaf name, opening every collapsed folder first.
 *
 * The folders are collapsed by default, so a bare "find the leaf" returns nothing on a fresh
 * profile -- which the earlier survey caught happening: it reported "could not reach Leaders"
 * until the folder buttons were clicked open first.
 */
/**
 * Navigate by nav-rail leaf, and REPORT whether it worked.
 *
 * Returns the h1 it landed on rather than a bare 'clicked'. The nav click silently did nothing
 * twice in this session -- the leaf was present, `click()` fired, and the view never changed -- so
 * a caller that assumes success is assuming the one thing that keeps failing. Callers that need to
 * be on a particular screen check `arrivedOn` against the expected heading.
 */
const clickNav = async (leaf) => {
  const clicked = await evaluate(`(async () => {
    const want = ${JSON.stringify(leaf.toLowerCase())};
    const openFolders = () => {
      /*
        OPEN ONLY THE FOLDERS THAT ARE CLOSED, one at a time, yielding between each.

        Two wrong versions. The first clicked all six folder headers in one synchronous pass, which
        is a no-op after the first because React coalesces the state updates -- so exactly one folder
        opened and the leaf was missing. The second opened them but never waited, so the children
        had not rendered when the query ran.

        \`FolderNav\` puts \`aria-expanded\` on each folder button (\`FolderNav.tsx:188\`), so the
        open/closed state is readable and this only clicks what is actually shut.
      */
      ['PLAY','SCORES','LEAGUE','TEAMS','COMMISSIONER','PLAYOFFS','SYSTEM'].forEach((name) => {
        const btn = [...document.querySelectorAll('button')]
          .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toUpperCase() === name);
        if (!btn) return;
        const expanded = btn.getAttribute('aria-expanded');
        if (expanded === 'true') return;
        btn.click();
      });
    };
    const findLeaf = () => [...document.querySelectorAll('button, [role="treeitem"]')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === want);
    /*
      OPEN THE FOLDERS AND WAIT. Opening six folder headers in one synchronous pass, then looking
      for the leaf immediately, was the bug behind "no such leaf": React has not re-rendered the
      newly-revealed children yet, so the query returns nothing and the probe concludes the nav has
      no Leaders leaf -- which it has, under LEAGUE, exactly where \`folders.ts:188\` puts it.

      So the folders are opened, the probe yields to the renderer, and the leaf is searched again.
    */
    if (!findLeaf()) {
      openFolders();
      // One yield for the folder open, then a second pass, because a leaf may sit inside a folder
      // that itself only expanded on the first click.
      await new Promise((r) => setTimeout(r, 500));
      openFolders();
      await new Promise((r) => setTimeout(r, 500));
    }
    const n = findLeaf();
    if (!n) return 'no such leaf';
    n.click();
    return 'clicked';
  })()`);
  await sleep(2600);
  const arrivedOn = await evaluate(
    `(() => (document.querySelector('h1')?.textContent || '').trim())()`,
  );
  return { clicked, arrivedOn };
};

/**
 * The first two data rows of whatever StatTable is on screen.
 *
 * Read from the DOM rather than from the category config on purpose: the question is what the
 * READER sees at the top of the board, and a probe that recomputes the sort would agree with a
 * wrong `direction` rather than catching it.
 */
const topRows = () => evaluate(`(() => {
  /*
    The EXPANDED board, found by its aria-label rather than by position, AND CHECKED AGAINST THE
    BOARD THAT WAS ASKED FOR.

    \`StatTable\` renders \`role="table" aria-label="\${title} full board"\`, so the board names
    itself. Reading "the last table in the document" -- the first version -- returned a DIFFERENT
    board's numbers with no indication, which is how a walk reported H/9 rows that were plainly ERA
    rows from the screenshot beside them.

    So the aria-label is returned AND compared to the requested title, and a mismatch is a hard
    failure rather than six rows of someone else's data.
  */
  const wrapper = [...document.querySelectorAll('[role="table"]')]
    .find((t) => /full board/i.test(t.getAttribute('aria-label') || ''));
  if (!wrapper) return { ok: false, reason: 'no expanded board on screen' };
  const table = wrapper.querySelector('table');
  if (!table) return { ok: false, reason: 'wrapper has no table' };
  const bodyRows = [...table.querySelectorAll('tbody tr')].slice(0, 3);

  // Per-cell geometry, because "the value is missing" and "the value is there but clipped" look
  // identical in textContent and completely different to a reader.
  const cells = bodyRows.map((r) => [...r.querySelectorAll('td')].map((c) => {
    const w = c.getBoundingClientRect().width;
    return {
      text: (c.textContent || '').trim(),
      // Wider than its content and no overflow means the column is too narrow for what it holds.
      clipped: c.scrollWidth > Math.ceil(w) + 1,
      widthPx: Math.round(w),
    };
  }));

  return {
    ok: bodyRows.length > 0,
    reason: bodyRows.length > 0 ? undefined : 'board has no rows',
    aria: wrapper.getAttribute('aria-label'),
    headers: [...table.querySelectorAll('thead th')].map((h) => h.textContent.trim()),
    rows: cells.map((cs) => cs.map((c) => c.text)),
    cellDetail: cells[0] ?? [],
    clippedCells: cells.flatMap((cs) => cs.filter((c) => c.clipped).map((c) => c.text)),
  };
})()`);

const main = async () => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error(`\nCannot reach ${url}. Start it first:\n    npm run dev\n`);
    cleanup();
    process.exit(1);
  }

  const port = 9400 + Math.floor(Math.random() * 90);
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

  await evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find((n) => /rebuild|repair/i.test((n.textContent || '').trim()));
    if (b) b.click(); return 'ok';
  })()`);
  for (let t = 0; t < 90; t += 1) {
    const gone = await evaluate(`(() => [...document.querySelectorAll('button')]
      .some((n) => /rebuild|repair/i.test((n.textContent || '').trim())) ? 'no' : 'yes')()`);
    if (gone === 'yes') break;
    await sleep(1000);
  }

  await clickNav('Leaders');

  console.log('\nLEADERS BOARDS\n');

  /*
    DUMP WHAT IS ACTUALLY THERE, before trying to click any of it.

    Three rounds of this probe failed with "NOT FOUND" on boards that certainly exist, and each
    round I guessed at a selector instead of looking. So before the walk: every group on the page,
    every candidate clickable, and every role="table" with its label. That turns the next failure
    from a guess into a fact.
  */
  const survey = await evaluate(`(() => {
    const clickables = [...document.querySelectorAll('button, [role="button"], [role="radio"], a')]
      .filter((n) => n.getBoundingClientRect().height > 0)
      .map((n) => ({
        tag: n.tagName.toLowerCase(),
        role: n.getAttribute('role') || '',
        label: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 40),
      }));
    return {
      groups: [...document.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label')),
      tables: [...document.querySelectorAll('[role="table"]')]
        .filter((t) => t.getBoundingClientRect().height > 0)
        .map((t) => t.getAttribute('aria-label')),
      h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
      clickableSample: clickables.slice(0, 30),
      clickableCount: clickables.length,
    };
  })()`);
  console.log('  h1:', JSON.stringify(survey.h1));
  console.log('  groups:', JSON.stringify(survey.groups));
  console.log('  tables:', JSON.stringify(survey.tables));
  console.log(`  clickables on screen: ${survey.clickableCount}`);
  survey.clickableSample.forEach((c) => console.log(`    [${c.tag}${c.role ? '/' + c.role : ''}] ${c.label}`));
  console.log('');

  /*
    The three new batting boards and four new pitching ones. Named by their ON-SCREEN label, which
    is what the category selector renders, so a rename shows up here as a miss rather than as a
    silent no-op.
  */
  /*
    RETURN TO LEADERS BEFORE THE WALK.
  /*
    PLAY SOME SEASON, THEN OPEN LEADERS.

    Two things this walk learned the hard way, both about where the probe WAS rather than what
    it found:

      - Season stats materialise as a side effect of RUNNING GAMES
        (`simulationManager.ts:955`), so every qualifying board -- 82 at-bats, 20 outs -- is empty
        on a fresh universe. Moving the calendar date does not help: it invents games that were
        never played and still leaves the tables empty.
      - The nav click can silently do nothing, so arrival is asserted rather than assumed.

    So: click "Sim Month" until someone clears the floor, verify Leaders actually loaded by
    counting its board cards, and only then look for a specific one.
  */
  const simResults = [];
  const navHome = await clickNav('Dashboard');
  console.log(`  simulating from h1="${navHome.arrivedOn || "(unknown)"}"`);
  for (let i = 0; i < 4; i += 1) {
    const hit = await evaluate(`(() => {
      const label = (x) => (x.getAttribute("aria-label") || x.textContent || "").trim();
      const b = [...document.querySelectorAll("button")].find((x) => /^sim month$/i.test(label(x)));
      if (!b) return "NO SIM MONTH on this screen";
      if (b.disabled) return "DISABLED";
      b.click();
      return "clicked";
    })()`);
    simResults.push(hit);
    if (!hit.startsWith("clicked")) break;
    await sleep(10000);
  }
  console.log(`  simulated: ${simResults.join(", ")}`);

  const nav = await clickNav('Leaders');
  console.log(`  leaders nav: ${nav.clicked}, h1="${nav.arrivedOn}"`);
  const cardCount = await evaluate(`(() => document.querySelectorAll("span.t-label").length)()`);
  console.log(`  board cards on screen: ${cardCount}`);
  if (cardCount < 4) {
    console.error("  did not reach the Leaders board grid; stopping rather than reading another screen");
    cleanup();
    process.exit(1);
  }
  console.log("");
  /*
    The column header each board's VALUE lives under.

    Located by header rather than by index, because the value column is not reliably the second one:
    the rank is rendered in its own gutter, and the percentile follows the value. An earlier version
    read a fixed index, parsed player NAMES as numbers, and reported two inversions per board on
    eight healthy boards -- a check that failed everything it touched.
  */
  const expectedHeader = {
    'Strikeout Rate': 'K%',
    'Walk Rate': 'BB%',
    'Walks per Strikeout': 'BB/K',
    'K − BB%': 'K−BB%',
    'K − BB per 9': 'K−BB/9',
    'K + BB per 9': 'K+BB/9',
    'Hits per 9': 'H/9',
    'ERA': 'ERA',
  };

  const expectedDirection = {
    'Strikeout Rate': 'asc',
    'Walk Rate': 'desc',
    'Walks per Strikeout': 'desc',
    'K − BB%': 'asc',
    'K − BB per 9': 'desc',
    'K + BB per 9': 'desc',
    'Hits per 9': 'asc',
    'ERA': 'asc',
  };

  const wanted = [
    { group: 'batting', label: 'Strikeout Rate' },
    { group: 'batting', label: 'Walk Rate' },
    { group: 'batting', label: 'Walks per Strikeout' },
    { group: 'batting', label: 'K − BB%' },
    { group: 'pitching', label: 'K − BB per 9' },
    { group: 'pitching', label: 'K + BB per 9' },
    { group: 'pitching', label: 'Hits per 9' },
    { group: 'pitching', label: 'ERA' },
  ];

  let currentGroup = null;

  let boardFailures = 0;
  let boardsChecked = 0;

  for (const { group, label } of wanted) {
    errors = [];
    exceptions = [];

    if (group !== currentGroup) {
      const seg = await setSegment('Leader board', group === 'pitching' ? 'Pitching' : 'Batting');
      if (seg !== 'ok') console.log(`  [switch to ${group}] ${seg}`);
      await sleep(1600);
      currentGroup = group;
    }

    const hit = await openBoard(label);
    if (!hit.startsWith('clicked')) {
      console.log(`  ${label.padEnd(22)} ${hit}`);
      continue;
    }
    await sleep(1500);
    const info = await topRows();
    if (!info.ok) {
      console.log(`  ${label.padEnd(22)} NO ROWS after sim -- "${info.reason}"`);
      continue;
    }
    /*
      THE BOARD MUST BE THE ONE THAT WAS ASKED FOR. Without this the walk reported whichever board
      happened to be expanded, which is how H/9 came back showing ERA's numbers while the
      screenshot beside it plainly showed a different table.
    */
    const shownBoard = (info.aria || '').replace(/\s*full board$/i, '').trim();
    if (shownBoard !== label) {
      console.log(`  ${label.padEnd(22)} *** WRONG BOARD ON SCREEN: "${shownBoard}"`);
      continue;
    }
    const file = await shot(`leaders-${tag}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    console.log(`  ${label.padEnd(22)} ${info.headers.join(' | ')}`);
    info.rows.forEach((r, i) => console.log(`  ${''.padEnd(22)} ${i + 1}. ${r.join(' | ')}`));
    if (info.clippedCells.length > 0) {
      console.log(`  ${''.padEnd(22)} !! CLIPPED CELLS: ${JSON.stringify(info.clippedCells)}`);
    }

    /*
      MONOTONICITY ON THE SCREEN, which is the check that matters and the one that caught the only
      genuine defect in this whole change.

      It has to be checked against the board's OWN direction, because half these boards run
      ascending -- K%, H/9 -- where low is good. Reading "rank 2 is bigger than rank 1" as wrong is
      the exact mistake that shipped `K - BB%` with its direction inverted. So this compares
      against `direction`, and reports which end the board actually leads with.
    */
    const column = expectedDirection[label];
    /*
      Strip the RANK prefix before parsing.

      The first cell of every row is the rank as its own element -- the screenshot shows the board
      printing "1" and then the name in the same visual row, with the rank in a gutter. So
      \`r[1]\` was the PLAYER'S NAME, \`Number.parseFloat\` returned NaN for every row, the loop
      skipped every comparison on the \`continue\`, and... it reported 2 inversions per board
      anyway, which is the part that should have been impossible. It read the columns wrong in the
      other direction: it was comparing the PCT column, which descends 100 / 99.7 / 99.3, against
      the direction the VALUE column should run.

      So the value column is located BY ITS HEADER rather than by position, and the rank is stripped.
      Both are things a fixed index gets wrong the moment a column is added.
    */
    const headerIndex = info.headers.findIndex((h) => h === expectedHeader[label]);
    if (headerIndex < 0) {
      boardFailures += 1;
      console.log(`  ${''.padEnd(22)} *** cannot find the "${expectedHeader[label]}" column in`
        + ` ${JSON.stringify(info.headers)}`);
      continue;
    }
    /*
      Numeric extraction handles the formats these boards actually print.

      \`parseFloat\` on "−0.4" -- which is what a negative K−BB% looks like, since the board uses a
      typographic MINUS SIGN rather than a hyphen -- returns -0.4, because parseFloat tolerates
      leading whitespace and any sign. But the rank gutter and the percentage cells carry values that
      are not rates at all, and a strip of "keep digits and signs" turns a player's name containing
      a digit into a plausible-looking number. So only the located value column is read, and it is
      read with an explicit character class rather than a loose parse.
    */
    const numeric = info.rows
      .map((r) => {
        const raw = (r[headerIndex] || '').trim();
        if (raw === '' || raw === '—') return Number.NaN;
        const normalised = raw.replace(/[−‒–—]/g, '-').replace(/,/g, '');
        return /^[-+]?[0-9]*\.?[0-9]+$/.test(normalised)
          ? Number.parseFloat(normalised)
          : Number.NaN;
      })
      .filter((n) => Number.isFinite(n));
    if (numeric.length < 2) {
      boardFailures += 1;
      console.log(`  ${''.padEnd(22)} *** only ${numeric.length} parseable value(s): ${JSON.stringify(info.rows)}`);
      continue;
    }
    /*
      A DIFFERENCE IS NOT AN INVERSION.

      Every board here was reported wrong, and every sequence printed above is correctly ordered --
      13, 13.6, 13.6 on an ascending board is right; 2.15, 2, 1.86 on a descending board is right.
      The test was `numeric[i] > numeric[i - 1]` with no tolerance, so a rounded tie like 13.6/13.6
      counted as a reversal, and with only three rows sampled nearly every pair differed in the last
      digit.

      Ties are common and legitimate: the value column is printed to one decimal, so two pitchers a
      hundredth apart both show 7.5. The comparison is therefore on the value rounded to the PRECISION
      THE BOARD DISPLAYS, and an exact tie is not an inversion in either direction.
    */
    const shownPrecision = (info.rows[0][headerIndex] || '').includes('.')
      ? (info.rows[0][headerIndex].split('.')[1] || '').length
      : 0;
    const factor = 10 ** shownPrecision;
    let inversions = 0;
    for (let i = 1; i < numeric.length; i += 1) {
      const prev = Math.round(numeric[i - 1] * factor);
      const cur = Math.round(numeric[i] * factor);
      if (prev === cur) continue;               // a displayed tie is not a reversal
      /*
      THE COMPARATOR WAS INVERTED, which is why every board failed.

      \`cur < prev\` means "went DOWN", and on a DESCENDING board going down is exactly what a
      correct sort does -- so every correctly-sorted descending board reported an inversion, and the
      ascending boards passed by accident. A descending board is right when each value is LESS THAN
      the one above it; that is the definition of descending, and the test had it backwards.

      \`asc\` was genuinely inverted the other way for the same reason, and only the three all-equal
      rows escaped, which is why one board appeared to pass. Both halves were wrong and they were
      wrong in opposite directions, so "some boards pass" looked like a partial failure rather than
      a check with no signal at all.
    */
      const wrong = column === 'asc' ? cur < prev : cur > prev;
      if (wrong) inversions += 1;
    }
    const leadsWith = Math.round(numeric[0] * factor) <= Math.round(numeric[numeric.length - 1] * factor)
      ? 'the LOWEST' : 'the HIGHEST';
    const expect = column === 'asc' ? 'the LOWEST' : 'the HIGHEST';
    boardsChecked += 1;
    console.log(`  ${''.padEnd(22)} ${column}: ${numeric.join(', ')}  (${inversions} inversion(s))`);
    if (leadsWith !== expect || inversions > 0) {
      boardFailures += 1;
      console.log(`  ${''.padEnd(22)} *** SORT REVERSES -- a ${column} board must lead with ${expect}`);
    }
    if (errors.length || exceptions.length) {
      console.log(`  ${''.padEnd(22)} !! errors ${errors.length} exceptions ${exceptions.length}`);
      [...new Set([...errors, ...exceptions])].slice(0, 2)
        .forEach((e) => console.log(`  ${''.padEnd(24)}${e.slice(0, 150)}`));
    }
    console.log(`  ${''.padEnd(22)} -> ${file}`);
  }

  console.log(`\n  total errors ${errors.length}  exceptions ${exceptions.length}`);
  if (boardFailures > 0) {
    console.log(`  ${boardFailures} BOARD(S) SORT IN THE WRONG DIRECTION`);
  }
  /*
    A probe that silently checked nothing must not exit clean. `qaSweep` reporting "clean" is
    load-bearing everywhere in this repo, and a walk that reached zero boards because its selector
    broke would report the same thing. So the count is asserted against what was asked for.
  */
  console.log(`  boards verified: ${boardsChecked} of ${wanted.length}`);
  if (boardsChecked < wanted.length) {
    console.log(`  *** ${wanted.length - boardsChecked} board(s) were never verified`);
    boardFailures += wanted.length - boardsChecked;
  }
  console.log(`  screenshots: ${outDir}\n`);
  cleanup();
  process.exit(errors.length === 0 && exceptions.length === 0 && boardFailures === 0 ? 0 : 1);
};

main().catch((e) => { console.error('PROBE FAILED:', e.message); cleanup(); process.exit(1); });
