/**
 * Browser-side check that the localStorage games mirror survives a real quota.
 *
 * verifyLocalGamesMirror.ts proves the mirror is correctly sized against the
 * 5 MB quota. This proves the thing that actually matters in a browser:
 *
 *  1. A full season of games can be written to localStorage WITHOUT throwing.
 *  2. Every game survives with its identity, score, line score and box-score
 *     scalars, so the season still renders and still settles first-five bets.
 *  3. Recent games keep their play logs, which is what prop settlement and the
 *     game story read.
 *  4. The play log the app READS BACK is byte-identical to the one written --
 *     the round trip is where a truncation or escaping bug would surface.
 *  5. Nothing anywhere threw.
 *
 * Run: node tools/verifyStorageBudgetBrowser.mjs [http://localhost:3000/]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const url = process.argv[2] ?? 'http://localhost:3000/';
const profile = mkdtempSync(join(tmpdir(), 'gpb-quota-'));
const port = 9622 + Math.floor(Math.random() * 300);
// Same absolute path tools/cdp.mjs uses. Bare 'chrome' is not resolvable from
// this shell, and a missing browser looks exactly like a failing quota test.
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--window-size=1280,900',
  url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanup = () => {
  try { chrome.kill(); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }
};

let ws;
let nextId = 1;
const pending = new Map();

const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const evaluate = async (expression, sessionId) => {
  const res = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sessionId);
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  }
  return res.result.value;
};

try {
  let version = null;
  for (let i = 0; i < 60 && !version; i += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch { await sleep(250); }
  }
  if (!version) throw new Error('Chrome never opened a debugging port');

  ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await sleep(4000);

  // Build the season-sized game list the same shape the engine writes: a full
  // stats payload per game, including a realistic play log. A list of envelope-
  // only games would prove nothing, because those always fit.
  //
  // Dates are real SLATES: 32 teams means 16 games a day, and every team plays
  // exactly once. The first version of this file cycled the day-of-month, which
  // piled 28 games onto a single date -- a shape no 32-team league produces, and
  // one that made the mirror's date-aligned retention look like it was
  // stranding slates when it was only failing to fit an impossible one.
  const built = await evaluate(`(() => {
    const TEAMS = 32;
    const PER_SLATE = TEAMS / 2;
    const SLATES = Math.ceil(2592 / PER_SLATE);
    const teamIds = Array.from({ length: TEAMS }, (_, i) => 'tm-' + i);
    const playerIds = Array.from({ length: 400 }, (_, i) => 'pl-' + i);

    const makeEvents = (n) => Array.from({ length: n }, (_, k) => ({
      seq: k,
      inning: 1 + Math.floor(k / 6),
      half: k % 2 === 0 ? 'top' : 'bottom',
      battingTeamId: teamIds[k % TEAMS],
      outcome: ['OUT','SO','BB','1B','2B','3B','HR','ERR'][k % 8],
      batterId: playerIds[k % playerIds.length],
      batterName: 'Batter Number ' + (k % playerIds.length),
      pitcherId: playerIds[(k * 7) % playerIds.length],
      pitcherName: 'Pitcher Number ' + ((k * 7) % playerIds.length),
      defenderId: playerIds[(k * 13) % playerIds.length],
      defenderName: 'Defender Number ' + ((k * 13) % playerIds.length),
      description: 'A description of play ' + k + ' that is a realistic length of prose.',
      runsScored: k % 11 === 0 ? 1 : 0,
      rbi: k % 11 === 0 ? 1 : 0,
      scoringPlayerIds: k % 11 === 0 ? [playerIds[(k * 3) % playerIds.length]] : [],
      outs: k % 3,
      scoreAway: Math.floor(k / 20),
      scoreHome: Math.floor(k / 25),
      bases: { first: null, second: null, third: null },
    }));

    const iso = (offset) => {
      const d = new Date(Date.UTC(2026, 3, 1) + offset * 86400000);
      return d.toISOString().slice(0, 10);
    };

    const games = [];
    for (let s = 0; s < SLATES; s += 1) {
      const date = iso(s);
      for (let p = 0; p < PER_SLATE; p += 1) {
        // Rotate the slate order each day so home and away alternate, and pair
        // consecutive teams so no team plays twice in a slate.
        const a = teamIds[(p + s) % TEAMS];
        const b = teamIds[(p + s + PER_SLATE) % TEAMS];
        const i = games.length;
        const events = makeEvents(95 + ((i * 7) % 25));
        games.push({
          gameId: 'g-' + i,
          date,
          homeTeam: b,
          awayTeam: a,
          phase: 'regular_season',
          status: 'completed',
          score: { home: 4 + (i % 6), away: 3 + (i % 5) },
          playoff: null,
          stats: {
            awayHits: 7 + (i % 5),
            homeHits: 8 + (i % 4),
            awayErrors: i % 3 === 0 ? 1 : 0,
            homeErrors: 0,
            playLog: JSON.stringify(events),
            lineScore: JSON.stringify(Array.from({ length: 9 }, (_, inn) => ({ inning: inn + 1, away: inn % 3, home: (inn + 1) % 3 }))),
            participants: JSON.stringify({
              awayLineup: playerIds.slice(0, 9).map((id) => ({ playerId: id, teamId: a, fullName: 'Player ' + id, bats: 'R', primaryPosition: 'SS', battingRatings: { playerId: id, seasonYear: 2026, contact: 70 + (i % 20), power: 70, plateDiscipline: 70, avoidStrikeout: 70, speed: 70, baserunning: 70, fielding: 70, arm: 70, overall: 70, potentialOverall: 75 }, battingStat: { playerId: id, seasonYear: 2026, seasonPhase: 'regular_season', gamesPlayed: 40, plateAppearances: 150, atBats: 130, runsScored: 20, hits: 35, doubles: 8, triples: 1, homeRuns: 5, walks: 15, strikeouts: 30, rbi: 20, avg: 0.27, ops: 0.75 } })),
              homeLineup: playerIds.slice(9, 18).map((id) => ({ playerId: id, teamId: b, fullName: 'Player ' + id, bats: 'L', primaryPosition: '2B', battingRatings: { playerId: id, seasonYear: 2026, contact: 70, power: 70, plateDiscipline: 70, avoidStrikeout: 70, speed: 70, baserunning: 70, fielding: 70, arm: 70, overall: 70, potentialOverall: 75 }, battingStat: null })),
              awayStarter: null,
              homeStarter: null,
              awayBullpen: [],
              homeBullpen: [],
            }),
            winningPitcherId: playerIds[(i * 5) % playerIds.length],
            losingPitcherId: playerIds[(i * 11) % playerIds.length],
            savePitcherId: null,
            finalInning: 9,
            interactiveSim: true,
            simulatedAt: date + 'T12:00:00.000Z',
          },
        });
      }
    }

    const perDate = new Map();
    games.forEach((g) => perDate.set(g.date, (perDate.get(g.date) || 0) + 1));
    const sizes = Array.from(new Set(Array.from(perDate.values()))).sort((x, y) => x - y);

    // Stash the list for the next two probes. The write and the audit both
    // need the ORIGINAL payload to compare against, and an expression's locals
    // do not survive a Runtime.evaluate boundary.
    window.__quotaGames = games;
    return {
      full: JSON.stringify(games).length,
      count: games.length,
      slates: perDate.size,
      distinctSlateSizes: sizes,
      dateRange: [games[0].date, games[games.length - 1].date],
    };
  })()`, sessionId);
  console.log('SOURCE:', JSON.stringify(built));

  // Populate the sibling keys at the sizes a real league measures, so the
  // origin is under the same pressure the app creates. localStorage is a
  // per-origin budget, so an empty origin would let the mirror take 5 MB and
  // prove nothing about the 3.6 MB it actually gets.
  //
  // Filler strings, not fake league state: what matters here is only how many
  // units the origin holds, and the per-key figures come from
  // tools/probeStorageBudget.ts.
  const SIBLING_UNITS = {
    glb_teams: 5669,
    glb_settings: 152,
    glb_players: 488248,
    glb_batting_stats: 188572,
    glb_pitching_stats: 144273,
    glb_batting_ratings: 322803,
    glb_pitching_ratings: 231845,
    glb_roster_slots: 98049,
    glb_player_transactions: 2,
  };
  const seeded = await evaluate(`(() => {
    const total = () => {
      let n = 0;
      for (let i = 0; i < localStorage.length; i += 1) {
        n += (localStorage.getItem(localStorage.key(i)) || '').length;
      }
      return n;
    };
    // The app has already written keys of its own by the time this runs
    // (gpb_betting_wallet_v1, gpb_season_history_v1, and a partial glb_games
    // from page load). They are part of the origin pressure, so they are
    // measured rather than cleared.
    const before = total();
    const beforeKeys = Object.keys(localStorage);
    // The games key is the ONE key the budget measurement excludes, so it has
    // to be subtracted from the expectation below rather than counted. This is
    // also the assertion that proves the exclusion works: if the measurement
    // were counting the stale payload it was about to replace, it would be
    // 436,964 units too large and the budget would ratchet down on every save.
    const beforeGames = (localStorage.getItem('glb_games') || '').length;

    const SIZES = ${JSON.stringify(SIBLING_UNITS)};
    Object.keys(SIZES).forEach((k) => {
      // '\\u0000' is one UTF-16 code unit, so the written length is exact.
      localStorage.setItem(k, '\\u0000'.repeat(SIZES[k]));
    });

    return {
      beforeUnits: before,
      beforeGamesKeyUnits: beforeGames,
      afterUnits: total(),
      appOwnedKeys: beforeKeys.length,
    };
  })()`, sessionId);
  console.log('SEEDED SIBLINGS:', JSON.stringify(seeded));

  // Write through the app's own save path, so this exercises the shipping
  // mirror rather than a reimplementation of it.
  const write = await evaluate(`(async () => {
    const before = [];
    const orig = console.warn;
    console.warn = (...a) => { before.push(a.map(String).join(' ')); };

    // Pull the mirror out of the app's own module graph. Vite serves source
    // modules, so this is the same function storage.ts calls, including the
    // occupied-units measurement that sizes the budget.
    const mod = await import('/src/lib/localGamesMirror.ts');
    const games = window.__quotaGames;
    const occupied = mod.measureOccupiedUnits();
    const budget = mod.measureGamesBudgetUnits();
    const t0 = performance.now();
    const mirror = mod.buildLocalGamesMirror(games, budget);
    const buildMs = performance.now() - t0;

    let threw = null;
    let wrote = null;
    const t1 = performance.now();
    try {
      localStorage.setItem(mod.LOCAL_GAMES_STORAGE_KEY, mirror.serialized);
      wrote = mirror.serialized.length;
    } catch (e) {
      threw = String(e && e.name) + ': ' + String(e && e.message);
    }
    const writeMs = performance.now() - t1;

    // Read it back exactly as the app does.
    let readBack = null;
    let readThrew = null;
    try {
      readBack = JSON.parse(localStorage.getItem(mod.LOCAL_GAMES_STORAGE_KEY));
    } catch (e) {
      readThrew = String(e);
    }

    console.warn = orig;
    return {
      buildMs: Math.round(buildMs),
      writeMs: Math.round(writeMs),
      measuredOccupiedUnits: occupied,
      budgetUnits: budget,
      mirrorBudgetUnits: mirror.budgetUnits,
      wrote,
      threw,
      warnings: before,
      readBackCount: readBack ? readBack.length : null,
      readThrew,
      reportedPlayLogs: mirror.retainedPlayLogs,
      reportedParticipants: mirror.retainedParticipants,
    };
  })()`, sessionId);
  console.log('WRITE:', JSON.stringify(write, null, 1));

  if (write.threw) {
    console.log('\nVERDICT: FAIL -- the mirror overflowed a real browser quota.');
    process.exitCode = 1;
  } else {
    // Now audit the round trip in the page.
    const audit = await evaluate(`(() => {
      const games = JSON.parse(localStorage.getItem('glb_games'));
      const source = window.__quotaGames;
      const byId = new Map(source.map((g) => [g.gameId, g]));

      const QUOTA = 5 * 1024 * 1024;
      const stored = localStorage.getItem('glb_games').length;

      let envelopeOk = 0, lineScoreOk = 0, scalarsOk = 0, scoreOk = 0;
      let withLog = 0, logIdentical = 0, logParses = 0;

      games.forEach((g) => {
        const src = byId.get(g.gameId);
        if (!src) return;
        if (g.gameId && g.date && g.homeTeam && g.awayTeam && g.phase) envelopeOk += 1;
        if (g.score.home === src.score.home && g.score.away === src.score.away) scoreOk += 1;
        if (g.stats.lineScore === src.stats.lineScore) lineScoreOk += 1;
        if (g.stats.awayHits === src.stats.awayHits
          && g.stats.homeHits === src.stats.homeHits
          && g.stats.awayErrors === src.stats.awayErrors
          && g.stats.homeErrors === src.stats.homeErrors
          && g.stats.winningPitcherId === src.stats.winningPitcherId
          && g.stats.losingPitcherId === src.stats.losingPitcherId
          && g.stats.savePitcherId === src.stats.savePitcherId
          && g.stats.finalInning === src.stats.finalInning) scalarsOk += 1;
        if (typeof g.stats.playLog === 'string' && g.stats.playLog.length > 0) {
          withLog += 1;
          if (g.stats.playLog === src.stats.playLog) logIdentical += 1;
          try { const a = JSON.parse(g.stats.playLog); if (Array.isArray(a) && a.length) logParses += 1; } catch (e) { /* counted below */ }
        }
      });

      // Retention must favour recent dates.
      const dates = games.map((g) => g.date);
      const keptDates = games.filter((g) => typeof g.stats.playLog === 'string' && g.stats.playLog.length).map((g) => g.date);
      const droppedDates = games.filter((g) => !(typeof g.stats.playLog === 'string' && g.stats.playLog.length)).map((g) => g.date);
      keptDates.sort(); droppedDates.sort();
      const oldestKept = keptDates[0] || null;
      const newestDropped = droppedDates.length ? droppedDates[droppedDates.length - 1] : null;

      // Every key this origin holds, so the games key is not measured alone.
      const allKeys = Object.keys(localStorage);
      let totalOrigin = 0;
      allKeys.forEach((k) => { totalOrigin += (localStorage.getItem(k) || '').length; });

      // An independent count of everything EXCEPT the games key, which is what
      // the shipping measurement is supposed to report. Computed here by a
      // different route so the two can be cross-checked.
      let nonGames = 0;
      allKeys.forEach((k) => {
        if (k !== 'glb_games') nonGames += (localStorage.getItem(k) || '').length;
      });

      // Retention depth in slates. Props and headlines are same-slate, so the
      // mirror is only worth what its newest slate is worth.
      const perDate = new Map();
      games.forEach((g) => perDate.set(g.date, (perDate.get(g.date) || 0) + 1));
      const slates = Array.from(perDate.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const newestDate = slates[slates.length - 1][0];
      const newestSlateGames = slates[slates.length - 1][1];
      const newestSlateKept = games.filter((g) => g.date === newestDate
        && typeof g.stats.playLog === 'string' && g.stats.playLog.length > 0).length;
      const largestSlate = Math.max.apply(null, Array.from(perDate.values()));

      return {
        games: games.length,
        storedUnits: stored,
        quotaUnits: QUOTA,
        totalOriginUnits: totalOrigin,
        nonGamesUnits: nonGames,
        originKeys: allKeys,
        envelopeOk, scoreOk, lineScoreOk, scalarsOk,
        withLog, logIdentical, logParses,
        oldestKept, newestDropped,
        newestSlate: { date: newestDate, games: newestSlateGames, kept: newestSlateKept },
        retentionDepthInSlates: +(withLog / largestSlate).toFixed(2),
        dateRange: [dates[0], dates[dates.length - 1]],
      };
    })()`, sessionId);
    console.log('AUDIT:', JSON.stringify(audit, null, 1));

    const problems = [];
    if (audit.games !== built.count) problems.push(`game count ${audit.games} != ${built.count}`);
    // The whole ORIGIN, not just the games key. This is the assertion a
    // fixed-fraction budget fails, and the one that matters to a real user:
    // it is the difference between degrading gracefully and a thrown
    // QuotaExceededError that aborts the save.
    if (audit.totalOriginUnits >= audit.quotaUnits) {
      problems.push(`origin holds ${audit.totalOriginUnits} of ${audit.quotaUnits} units -- over quota`);
    }
    if (audit.storedUnits > write.budgetUnits) {
      problems.push(`wrote ${audit.storedUnits} against a ${write.budgetUnits} budget`);
    }
    // The budget must be derived from what the origin actually held, not from
    // an assumed fraction of the quota.
    //
    // The expectation is the origin's REAL non-games total, not an arithmetic
    // sum of nominal key sizes: seeding overwrites keys the app had already
    // written (glb_teams held 5,763 units, the filler is 5,669), so nominal
    // arithmetic is 94 units wrong and asserting on it produced two false
    // failures before this. What is exact, and what actually matters, is that
    // the shipping measurement agrees with an independent count of the origin.
    const expectedBudget = audit.quotaUnits - audit.nonGamesUnits - 128 * 1024;
    if (write.measuredOccupiedUnits !== audit.nonGamesUnits) {
      problems.push(`shipping measurement ${write.measuredOccupiedUnits} != independent count of the origin ${audit.nonGamesUnits}`);
    }
    if (write.budgetUnits !== expectedBudget) {
      problems.push(`budget ${write.budgetUnits} is not quota - occupied ${audit.nonGamesUnits} - reserve 131072 (${expectedBudget})`);
    }
    if (write.mirrorBudgetUnits !== write.budgetUnits) {
      problems.push(`builder used budget ${write.mirrorBudgetUnits}, caller passed ${write.budgetUnits}`);
    }
    // The origin must be under the measured pressure, or the budget arithmetic
    // above is being tested against an empty origin.
    const nominalSeeded = Object.values(SIBLING_UNITS).reduce((a, b) => a + b, 0);
    if (audit.nonGamesUnits < nominalSeeded) {
      problems.push(`origin holds only ${audit.nonGamesUnits} non-games units, below the ${nominalSeeded} seeded`);
    }
    if (audit.envelopeOk !== audit.games) problems.push(`envelope intact on only ${audit.envelopeOk}/${audit.games}`);
    if (audit.scoreOk !== audit.games) problems.push(`score intact on only ${audit.scoreOk}/${audit.games}`);
    if (audit.lineScoreOk !== audit.games) problems.push(`lineScore intact on only ${audit.lineScoreOk}/${audit.games}`);
    if (audit.scalarsOk !== audit.games) problems.push(`scalars intact on only ${audit.scalarsOk}/${audit.games}`);
    if (audit.withLog === 0) problems.push('no play logs retained');
    if (audit.logIdentical !== audit.withLog) problems.push(`only ${audit.logIdentical}/${audit.withLog} logs byte-identical after round trip`);
    if (audit.logParses !== audit.withLog) problems.push(`only ${audit.logParses}/${audit.withLog} logs parse`);
    if (audit.newestDropped && audit.oldestKept && audit.oldestKept < audit.newestDropped) {
      problems.push(`retention scattered: kept from ${audit.oldestKept} but dropped ${audit.newestDropped}`);
    }
    if (audit.newestSlate && audit.newestSlate.kept !== audit.newestSlate.games) {
      problems.push(`newest slate ${audit.newestSlate.date} lost play logs `
        + `(${audit.newestSlate.kept}/${audit.newestSlate.games}), so same-slate props could not settle`);
    }
    if (write.reportedPlayLogs !== audit.withLog) {
      problems.push(`builder reported ${write.reportedPlayLogs} logs, ${audit.withLog} stored`);
    }

    console.log('\nBUDGET: ' + JSON.stringify({
      quotaUnits: audit.quotaUnits,
      appOwnedKeysBeforeSeeding: seeded.appOwnedKeys,
      measuredOccupiedUnits: write.measuredOccupiedUnits,
      budgetUnits: write.budgetUnits,
      gamesKeyUnits: audit.storedUnits,
      originTotalUnits: audit.totalOriginUnits,
      originHeadroomUnits: audit.quotaUnits - audit.totalOriginUnits,
      budgetUsedPct: +((audit.storedUnits / write.budgetUnits) * 100).toFixed(1),
      slatesInSeason: built.slates,
      distinctSlateSizes: built.distinctSlateSizes,
      retentionDepthInSlates: audit.retentionDepthInSlates,
      newestSlate: audit.newestSlate,
      buildMs: write.buildMs,
      writeMs: write.writeMs,
    }, null, 1));

    if (problems.length) {
      console.log('\nPROBLEMS:\n - ' + problems.join('\n - '));
      process.exitCode = 1;
    } else {
      console.log('\nVERDICT: PASS -- a full season round-trips through a shared localStorage origin, '
        + 'with every game intact and the newest slate\'s play logs whole.');
    }
  }
} catch (e) {
  console.error('THREW', e);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already closed */ }
  cleanup();
}
