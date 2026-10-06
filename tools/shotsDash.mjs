/*
 * Minimal dashboard probe: navigate, wait, dump text, screenshot. No retries, no cleverness.
 *
 * Written because `shotsDashboard.mjs` hung and the useful thing to find out was WHERE. Every step has
 * an explicit timeout so a hang names itself instead of stalling the run.
 *
 * Run: node tools/shotsDash.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = 'http://localhost:3000/';
const outDir = 'C:/Users/ADMIN/AppData/Local/Temp/dashboard';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'gpb-dash2-'));

const step = async (label, fn, ms = 45000) => {
  const t = Promise.resolve().then(fn);
  const guard = new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT at ${label}`)), ms));
  return Promise.race([t, guard]);
};

let chrome;
try {
  const port = 9500 + Math.floor(Math.random() * 80);
  console.log(`  step 1: spawn chrome on ${port}`);
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1500,1600', '--hide-scrollbars', url,
  ], { stdio: 'ignore' });

  console.log('  step 2: wait for the debugging port');
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) });
      if (res.ok) wsUrl = (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up */ }
    if (!wsUrl) await sleep(500);
  }
  if (!wsUrl) throw new Error('chrome never opened the port');

  console.log('  step 3: attach websocket');
  const ws = new WebSocket(wsUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  let id = 0;
  const pending = new Map();
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  console.log('  step 4: open a target and attach');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  console.log('  step 5: navigate');
  await send('Page.navigate', { url }, sessionId);

  console.log('  step 6: wait 20s for the universe to build');
  await sleep(20000);

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    return r.result?.value;
  };

  /*
    CLICK PAST NoPlayersGate, BECAUSE A FRESH PROFILE ALWAYS LANDS ON IT.

    This is the designed recovery screen -- 32 clubs and a schedule, no players -- and it appears on
    every cold profile because the app will not silently build a universe. The first version of this
    probe reported "primetime: false, award race: false" and stopped, which reads like a broken
    dashboard and was actually a recovery screen it had no way past. Verified against 94d5879 that the
    gate predates any of the work it was being used to check.

    So: find the repair button, click it, wait for the build, and only then read the page. A probe
    that gives up on a screen it cannot pass is not measuring the dashboard, it is measuring itself.
  */
  const gate = await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => /rebuild universe|repair player pool/i.test(b.textContent || ''));
    return { present: !!btn, label: btn ? btn.textContent.trim() : null };
  })()`);

  if (gate.present) {
    console.log(`  step 6b: the NoPlayersGate is up ("${gate.label}") -- clicking it`);
    await evaluate(`(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find((b) => /rebuild universe|repair player pool/i.test(b.textContent || ''));
      if (btn) btn.click();
      return true;
    })()`);
    // Generating, developing and roster-filling 1,282 players is not instant.
    console.log('  step 6c: wait 45s for the universe to build');
    await sleep(45000);
  }

  /*
    SIMULATE A MONTH, because on day one the award race is legitimately EMPTY.

    Both award builders require 120 at-bats or 50 innings, so a fresh universe renders the panel's
    "MVP candidates appear once enough regular-season data exists" line and the row layout -- the
    bigger crest, the name, the MacroBet price -- is never drawn at all. A probe that stops here would
    report a working award race having verified nothing about it, which is the exact failure the park
    probe documented: asserting against a screen it had not actually reached.
  */
  const sim = await evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => /sim month/i.test(b.textContent || ''));
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  })()`);
  if (sim.clicked) {
    console.log('  step 6d: Sim Month clicked -- waiting 40s for the season to run');
    await sleep(40000);
  } else {
    console.log('  step 6d: NO Sim Month button found');
  }

  console.log('  step 7: read the DOM');
  const info = await step('evaluate', () => evaluate(`(() => {
    const t = document.body.innerText;
    return {
      chars: t.length,
      head: t.slice(0, 260).replace(/\\n+/g, ' | '),
      primetime: /PRIMETIME/i.test(t),
      awardRace: /AWARD RACE/i.test(t),
      powerRankings: /POWER RANKINGS/i.test(t),
      viewers: (t.match(/[\\d.]+[MK] expected viewers/gi) || []),
      attendance: /EXPECTED ATTENDANCE/i.test(t),
      american: (t.match(/[-+]\\d{3,4}\\b/g) || []).slice(0, 10),
    };
  })()`));

  console.log('\n  WHAT IS ON THE SCREEN\n');
  console.log(`    body text      ${info.chars} chars`);
  console.log(`    head           ${info.head}`);
  console.log(`    primetime      ${info.primetime}`);
  console.log(`    award race     ${info.awardRace}`);
  console.log(`    power rankings ${info.powerRankings}`);
  console.log(`    viewers line   ${info.viewers.length ? info.viewers.join(' | ') : '(absent)'}`);
  console.log(`    attendance     ${info.attendance}`);
  console.log(`    american odds  ${info.american.join(' ') || '(none)'}\n`);

  console.log('  step 8: screenshot');
  const png = await step('screenshot', () => send('Page.captureScreenshot', { format: 'png' }, sessionId), 60000);
  const p = join(outDir, 'dash.png');
  writeFileSync(p, Buffer.from(png.data, 'base64'));
  console.log(`    wrote ${p}\n`);
  ws.close();
} catch (e) {
  console.log(`\n  FAILED: ${e.message}\n`);
} finally {
  try { chrome?.kill(); } catch { /* already gone */ }
}