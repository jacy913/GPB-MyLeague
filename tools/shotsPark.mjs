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
    const tree = document.querySelector('[role="tree"][aria-label="League navigation"]');
    const findLeaf = () => [...document.querySelectorAll('button, [role="button"]')]
      .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toLowerCase() === 'rosters');
    if (!findLeaf()) {
      ['TEAMS','LEAGUE','SCORES','COMMISSIONER','PLAYOFFS','SYSTEM'].forEach((f) => {
        const n = [...document.querySelectorAll('button')]
          .find((x) => (x.getAttribute('aria-label') || x.textContent || '').trim().toUpperCase() === f);
        if (n) n.click();
      });
    }
    const leaf = findLeaf();
    if (leaf) leaf.click();
    return 'ok';
  })()`);
  await sleep(3000);

  const readDialog = () => evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { open: false };
    const field = [...dialog.querySelectorAll('svg')]
      .find((s) => (s.getAttribute('aria-label') || '').includes('park diagram'));
    return {
      open: true,
      title: (dialog.querySelector('h2')?.textContent || '').trim(),
      fieldWidth: field ? Math.round(field.getBoundingClientRect().width) : 0,
      hasWallLabel: field ? /FT WALL/.test(field.textContent || '') : false,
      overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  })()`);

  // -- 1. THE ROSTERS VIEW, which is where the request actually meant. ---------
  console.log('\n  A. TEAMS -> Rosters');

  /*
    A CLUB HAS TO BE SELECTED FIRST.

    `TeamsHub` opens with `if (!selectedTeam) return null`, so the whole screen renders nothing until
    a club is chosen -- which the probe reported as "NO PARK BUTTON" on a fresh universe and would
    have reported as a missing feature rather than as a screen that had not been told what to show.

    That guard is pre-existing and correct (there is no roster to show without a club), but it means a
    walk to this screen has to go through the team directory.
  */
  const picked = await evaluate(`(() => {
    const hasPark = () => [...document.querySelectorAll('button')]
      .some((b) => /\\bpark\\b/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    if (hasPark()) return 'already showing';
    const dirToggle = [...document.querySelectorAll('button')]
      .find((b) => /directory|all clubs|select club|teams/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    if (dirToggle) { dirToggle.click(); return 'opened directory'; }
    return 'no directory toggle';
  })()`);
  console.log(`     club selection: ${picked}`);
  await sleep(1400);
  if (picked === 'opened directory') {
    const chosen = await evaluate(`(() => {
      const clubs = [...document.querySelectorAll('button')]
        .filter((b) => {
          const t = (b.getAttribute('aria-label') || b.textContent || '').trim();
          return t.length > 3 && t.length < 34 && /\\b\\w+ \\w+\\b/.test(t);
        });
      if (!clubs.length) return 'no clubs listed';
      clubs[0].click();
      return 'chose ' + (clubs[0].textContent || '').trim().slice(0, 24);
    })()`);
    console.log(`     ${chosen}`);
    await sleep(2600);
  }

  const rosterHit = await evaluate(`(() => {
    const n = [...document.querySelectorAll('button')]
      .find((b) => /\\bpark\\b/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    if (!n) return 'NO PARK BUTTON';
    n.click(); return 'opened';
  })()`);
  console.log(`     park button: ${rosterHit}`);
  await sleep(1800);
  const rosterDialog = await readDialog();
  if (rosterDialog.open) {
    console.log(`     "${rosterDialog.title}"  field ${rosterDialog.fieldWidth}px  wall label ${rosterDialog.hasWallLabel ? 'yes' : 'MISSING'}  overflowX ${rosterDialog.overflowX}`);
    console.log(`     -> ${await shot(`park-rosters-${tag}`)}`);
  } else {
    console.log('     *** NO DIALOG OPENED ***');
  }
  await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /close/i.test(x.getAttribute('aria-label')||'')); if (b) b.click(); return 'ok'; })()`);
  await sleep(800);

  // -- 2. THE GAME SCREEN, which is where it already was. ----------------------
  console.log('\n  B. Schedule -> a game');
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
    MATCHED ON THE HOME CLUB'S FULL NAME, READ OUT OF GameCard's aria-label.

    Three wrong approaches came before this one, and all three produced a confident wrong answer
    rather than an error:

      1. Matching club names against the button text found nothing, because the compact strip reads
         "@DESAway0-0".
      2. Matching the three-letter ticker then found things, but by SUBSTRING -- so `HOU` also
         matched Houssen when Houdan was wanted, and `STA` opened a fixture whose home club was
         Braasshoem. The sweep reported "3 parks screenshotted" and delivered the wrong three.
      3. Asking for `DES` and getting Vallile again, the same bug a third time.

    `GameCard` renders `aria-label="Open <away> at <home>, <status>"`, which names BOTH clubs in
    full. So the wanted park is found by asking for a card whose aria-label ends that home club's
    name, and the club's name is resolved from `INITIAL_TEAMS` in the page rather than guessed at
    from a ticker. A miss now returns nothing instead of the wrong park, which is the property that
    was missing all along.
  */
  const wantedClubs = (process.env.GPB_PARK_CLUBS ?? 'and,cal,sta,hou')
    .split(',').map((s) => s.trim()).filter(Boolean);
  console.log(`  looking for parks of: ${wantedClubs.join(', ')}\n`);

  const games = await evaluate(`(async () => {
    const wanted = ${JSON.stringify(wantedClubs)};
    const { INITIAL_TEAMS } = await import('/src/data/teams.ts');
    const nameOf = Object.fromEntries(INITIAL_TEAMS.map((t) => [t.id, t.name]));

    const found = [];
    for (const id of wanted) {
      const clubName = nameOf[id];
      if (!clubName) { found.push({ id, error: 'no such club' }); continue; }
      // The HOME club is the park in play, so match the name that follows " at ".
      const card = [...document.querySelectorAll('button[aria-label]')]
        .find((b) => !b.disabled
          && new RegExp('\\\\bat ' + clubName.replace(/[.*+?^$()|[\\]{}\\\\]/g, '\\\\$&') + '\\\\s*,').test(b.getAttribute('aria-label') || ''));
      if (!card) { found.push({ id, club: clubName, error: 'no scheduled home game' }); continue; }
      found.push({ id, club: clubName, aria: (card.getAttribute('aria-label') || '').trim() });
    }
    return found;
  })()`);
  const playable = games.filter((g) => !g.error);
  console.log(
    `  ${playable.length} of ${games.length} park${games.length === 1 ? '' : 's'} `
    + `${playable.length === 1 ? 'has' : 'have'} a home game today\n`,
  );
  games.forEach((g) => console.log(
    `    ${g.id.padEnd(4)} ${g.error ? `SKIPPED: ${g.error}` : g.aria}`,
  ));
  console.log('');

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
    if (game.error) {
      console.log(`  ${game.id}: ${game.error}${game.club ? ` (${game.club})` : ''}`);
      continue;
    }
    if (seen.length >= 3) break;
    errors = [];
    exceptions = [];

    await gotoSchedule();

    /*
      Clicked BY THE SAME ARIA-LABEL THAT WAS MATCHED ABOVE, re-resolved in the page rather than by
      replaying a label string through the node. Matching once to discover a game and then matching
      again by text to open it is two chances to pick the wrong button, and this file has taken both.
    */
    const opened = await evaluate(`(() => {
      const clubName = ${JSON.stringify(game.club)};
      const n = [...document.querySelectorAll('button[aria-label]')]
        .find((b) => !b.disabled
          && new RegExp('\\\\bat ' + clubName.replace(/[.*+?^$()|[\\]{}\\\\]/g, '\\\\$&') + '\\\\s*,').test(b.getAttribute('aria-label') || ''));
      if (!n) return 'GONE';
      n.click(); return 'clicked';
    })()`);
    if (opened !== 'clicked') {
      console.log(`  ${game.id} (${game.club}): ${opened}`);
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
      console.log(`  ${game.id} (${game.club}): ${parkClicked}`);
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
      // Named by the club id we asked for, not by a ticker scraped out of a label -- which is the whole
    // point of the change above.
    const gameTicker = game.id;
      const file = await shot(`park-${tag}-${seen.length + 1}-${gameTicker}`);
      console.log(`  ${game.id} (${game.club})`);
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