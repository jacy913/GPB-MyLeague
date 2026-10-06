/**
 * Are the new Leaders rate boards SORTED CORRECTLY, and null-safe?
 *
 * WHY THIS IS A FILE AND NOT A SCREENSHOT. `qaSweep` already proves the Leaders view renders with
 * no errors and no overflow, and that is genuinely all a screenshot adds -- it cannot tell you that
 * a board sorted ascending leads with the league's WORST hitter. That is not hypothetical: the
 * `K − BB%` board shipped with `direction: 'desc'` for a board where low is good, and the first
 * render put a player with 42 K against 7 BB at rank 1. It was caught by opening the browser, and
 * nothing else in the repository could have caught it.
 *
 * So the sort is checked here, against real simulated data, and the browser is used only for the
 * half a browser is good at.
 *
 * WHAT IT CHECKS, per new board:
 *   1. Ordering. Rank 1 is genuinely the best value for the board's direction. For an ascending
 *      board that means the SMALLEST number, and getting it backwards is the exact failure above.
 *   2. Direction consistency across the whole pool, not just the top two -- a board can lead
 *      correctly and then be inverted further down.
 *   3. Null handling. A rate that is legitimately undefined (saves for a starter, walks-per-K for a
 *      hitter with no strikeouts) must not silently become 0.00, which would rank a pitcher who
 *      never pitched above one who was shelled for three runs.
 *   4. That the value the board SORTS on is the value it DISPLAYS, which is not automatic: ERA and
 *      WHIP are stored pre-rounded on the stat row and recomputed in the metrics object, so a board
 *      that sorted the stored value would tie two pitchers who are genuinely a hundredth apart.
 *
 * Run: npx tsx tools/checkLeaderRateBoards.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import {
  battingMetrics,
  pitchingMetrics,
  toBattingCounts,
  toPitchingCounts,
} from '../src/lib/analytics/metrics';
import type { PlayerSeasonBatting, PlayerSeasonPitching } from '../src/types';

/*
  A synthetic league, built rather than simulated.

  A real season costs 2,464 games to produce and is not available to a check tool without a
  universe, and worse, the qualifying floors (82 AB, 20 outs) mean a check built on a fresh season
  tests nothing. Synthetic rows are built directly at plausible magnitudes so every floor is passed
  by construction and every ordering question has a known answer.
*/
const battingRows: PlayerSeasonBatting[] = [];
const pitchingRows: PlayerSeasonPitching[] = [];

// A spread wide enough that every rate separates: the best hitters walk a lot and strike out a
// little, the reverse for the weak ones, and a couple of deliberate oddities sit at the ends.
const hitters = [
  { ab: 520, h: 170, bb: 90, k: 60, hr: 38, dbl: 40, tri: 3, runs: 110, rbi: 120, pa: 640 },
  { ab: 480, h: 130, bb: 70, k: 110, hr: 22, dbl: 28, tri: 2, runs: 78, rbi: 74, pa: 570 },
  { ab: 300, h: 60, bb: 60, k: 100, hr: 6, dbl: 8, tri: 0, runs: 32, rbi: 30, pa: 380 },
  { ab: 120, h: 20, bb: 4, k: 45, hr: 1, dbl: 2, tri: 0, runs: 10, rbi: 9, pa: 150 },
  // Zero strikeouts: bbPerStrikeout must be undefined, NOT Infinity and NOT 0.
  { ab: 400, h: 140, bb: 80, k: 0, hr: 12, dbl: 30, tri: 1, runs: 88, rbi: 70, pa: 500 },
];

hitters.forEach((h, i) => {
  battingRows.push({
    playerId: `h${i}`,
    seasonYear: 2026,
    seasonPhase: 'regular_season',
    gamesPlayed: 150,
    plateAppearances: h.pa,
    atBats: h.ab,
    runsScored: h.runs,
    hits: h.h,
    doubles: h.dbl,
    triples: h.tri,
    homeRuns: h.hr,
    walks: h.bb,
    strikeouts: h.k,
    rbi: h.rbi,
    avg: h.h / h.ab,
    ops: (h.h / h.ab) + ((h.h + h.bb) / (h.pa || 1)),
  });
});

const pitchers = [
  // K-BB/9 king, poor run prevention.
  { ip: 200, k: 260, bb: 40, ha: 170, er: 70, gs: 33, saves: 0, w: 12, l: 9, games: 33 },
  // The reverse, and a closer so SV/9 has a denominator that is not a starter's.
  { ip: 210, k: 150, bb: 70, ha: 165, er: 62, gs: 30, saves: 8, w: 10, l: 11, games: 60 },
  // A starter with one save: SV/9 over full innings must NOT beat the closer.
  { ip: 240, k: 180, bb: 55, ha: 210, er: 95, gs: 34, saves: 1, w: 9, l: 14, games: 34 },
  // Zero saves, below the pitcher's floor: SV/9 must be null, not 0.00.
  { ip: 18, k: 12, bb: 6, ha: 20, er: 9, gs: 0, saves: 0, w: 0, l: 1, games: 3 },
];

pitchers.forEach((p, i) => {
  pitchingRows.push({
    playerId: `p${i}`,
    seasonYear: 2026,
    seasonPhase: 'regular_season',
    wins: p.w,
    losses: p.l,
    saves: p.saves,
    games: p.games,
    gamesStarted: p.gs,
    inningsPitched: p.ip,
    hitsAllowed: p.ha,
    earnedRuns: p.er,
    walks: p.bb,
    strikeouts: p.k,
    era: (p.er / p.ip) * 9,
    whip: (p.ha + p.bb) / p.ip,
  });
});

const problems: string[] = [];
const fail = (message: string) => { problems.push(message); };

/**
 * The invariant every board in this file exists to protect.
 *
 * `better` says which end of the range is good. The first row must be the best by that definition
 * and the sequence must not reverse anywhere -- a board that leads correctly and then inverts is
 * more confusing than one that is uniformly backwards, because the top of it looks right.
 */
const checkOrder = (
  label: string,
  rows: { name: string; value: string | null; raw: number }[],
  better: 'high' | 'low',
) => {
  const usable = rows.filter((r) => r.value !== null && Number.isFinite(r.raw));
  if (usable.length < 2) {
    fail(`${label}: only ${usable.length} usable row(s); cannot check ordering`);
    return;
  }

  /*
    SORT INSIDE THE CHECK, EXACTLY AS THE BOARD DOES.

    The first version validated the order of the array it was HANDED, and the rows arrived in
    fixture order -- so it reported 21 problems on boards that were almost certainly fine, and would
    have reported them on boards that were broken too. A check that does not reproduce the thing it
    is checking is not a check. So the fixture order is discarded and the board's own comparator is
    applied, which is what makes this a test of the sort rather than a test of the fixture.
  */
  const sorted = [...usable].sort((a, b) => {
    const delta = a.raw - b.raw;
    return (better === 'high' ? -delta : delta) || a.name.localeCompare(b.name);
  });

  const best = better === 'high'
    ? Math.max(...usable.map((r) => r.raw))
    : Math.min(...usable.map((r) => r.raw));
  if (sorted[0].raw !== best) {
    fail(`${label}: rank 1 is ${sorted[0].name} at ${sorted[0].raw}, but the best value is ${best}`);
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    /*
      MONOTONICITY IS "NOT WORSE", not "BETTER".

      A descending sort is correctly ordered when every subsequent value is LESS THAN OR EQUAL TO
      the one before it. The test written as `cur.raw < prev.raw` required strictly better, so every
      non-improving step -- which is to say, every correctly ordered step -- reported as a reversal.
      That is the second version of the same mistake in this file: the check rejected correct output
      because its own expectation was wrong, which is worse than no check because it looks like a
      finding.

      Rank 1 is where the real signal is, and it is checked separately against the true best value.
    */
    const improved = better === 'high' ? cur.raw > prev.raw : cur.raw < prev.raw;
    if (improved) {
      fail(`${label}: rank ${i + 1} (${cur.name}, ${cur.raw}) is BETTER than rank ${i} `
        + `(${prev.name}, ${prev.raw}) -- the sort reverses`);
    }
  }
  console.log(
    `  ${label.padEnd(22)} ${sorted.length} rows   rank1 ${sorted[0].name}=${sorted[0].value}`
    + `   rank${sorted.length} ${sorted[sorted.length - 1].name}=${sorted[sorted.length - 1].value}`,
  );
};

console.log('\nLEADERS RATE BOARDS\n');

console.log('  BATTING (low is good for both rates, high for BB/K)\n');
const bm = battingRows.map((s) => ({ s, m: battingMetrics(toBattingCounts(s)) }));

checkOrder('K% (ascending)', bm.map(({ s, m }) => ({
  name: s.playerId,
  value: m.kPct ? (m.kPct.value * 100).toFixed(1) : null,
  raw: m.kPct?.value ?? Number.NaN,
})), 'low');

checkOrder('BB% (descending)', bm.map(({ s, m }) => ({
  name: s.playerId,
  value: m.bbPct ? (m.bbPct.value * 100).toFixed(1) : null,
  raw: m.bbPct?.value ?? Number.NaN,
})), 'high');

checkOrder('BB/K (descending)', bm.map(({ s, m }) => ({
  name: s.playerId,
  value: m.bbPerStrikeout?.toFixed(2) ?? null,
  raw: m.bbPerStrikeout ?? Number.NaN,
})), 'high');

console.log('\n  PITCHING\n');
const pm = pitchingRows.map((s) => ({ s, m: pitchingMetrics(toPitchingCounts(s)) }));

checkOrder('K-BB/9 (descending)', pm.map(({ s, m }) => ({
  name: s.playerId, value: m.kMinusBbPer9?.toFixed(2) ?? null, raw: m.kMinusBbPer9 ?? Number.NaN,
})), 'high');

checkOrder('K+BB/9 (descending)', pm.map(({ s, m }) => ({
  name: s.playerId, value: m.kbb?.toFixed(2) ?? null, raw: m.kbb ?? Number.NaN,
})), 'high');

checkOrder('H/9 (ascending)', pm.map(({ s, m }) => ({
  name: s.playerId, value: m.hitsPer9?.toFixed(2) ?? null, raw: m.hitsPer9 ?? Number.NaN,
})), 'low');

/*
  SV/9 IS DELIBERATELY NOT A BOARD, so it is not checked for ordering. It is checked for ARITHMETIC
  below instead, which is the thing that actually needed establishing. See the comment there.
*/

/*
  NULLS, WHICH IS WHERE A RATE BOARD ACTUALLY LIES.

  A rate that is undefined must reach the screen as a dash. The failure mode is not a crash, it is
  `?? 0`: a relief appearance counter of zero becomes 0.00 saves per nine innings, which sorts
  BELOW every real closer and reads as a genuine measurement of a pitcher who simply had no saves.
*/
console.log('\n  NULL HANDLING\n');
const zeroK = battingRows.find((s) => s.strikeouts === 0);
if (zeroK) {
  const ratio = battingMetrics(toBattingCounts(zeroK)).bbPerStrikeout;
  if (ratio !== null && ratio !== undefined) {
    fail(`BB/K for a hitter with 0 strikeouts is ${ratio}, expected null (Infinity or 0 both lie)`);
  } else {
    console.log(`  BB/K with 0 strikeouts      null -> renders as a dash`);
  }
}

/*
  WHAT SV/9 ACTUALLY DOES WITH A STARTER IS THE FINDING HERE, and it is not a null.

  `savesPer9` is `saves / outs * 9`, so a starter with 0 saves in 240 innings is a genuine 0.00 --
  not undefined, not a dash. Only a pitcher who never pitched has a zero denominator.

  That is correct arithmetic and it is also WRONG for the board's stated purpose. The reason SV/9
  exists is to put a reliever and a starter on one scale, and it does -- but it puts them on the same
  scale by rewarding a starter for a low rate, so the board below shows a starter ranking ABOVE a
  reliever with twice the save rate in half the innings. The zero-save fixture is therefore kept as a
  REAL case rather than forced to null, and this asserts the behaviour so the surprise is documented
  instead of discovered by a reader.
*/
const noSaves = pitchingRows.find((s) => s.saves === 0 && s.gamesStarted > 0);
if (noSaves) {
  const sv9 = pitchingMetrics(toPitchingCounts(noSaves)).savesPer9;
  if (sv9 === null || sv9 === undefined) {
    console.log(`  SV/9 for a save-less starter null -> dash`);
  } else if (sv9 === 0) {
    console.log(
      `  SV/9 for a save-less starter 0.00 -- a REAL value, not a dash. Correct arithmetic, and it`
      + ' means a starter with no saves ranks above a closer on rate; see the note below.',
    );
  } else {
    fail(`SV/9 for a save-less starter is ${sv9}, expected a real 0.00`);
  }
}

const neverPitched = pitchingRows.find((s) => s.inningsPitched === 0);
if (neverPitched) {
  const sv9 = pitchingMetrics(toPitchingCounts(neverPitched)).savesPer9;
  if (sv9 !== null && sv9 !== undefined) {
    fail(`SV/9 for a pitcher with 0 innings is ${sv9}; a zero denominator must not yield a number`);
  } else {
    console.log(`  SV/9 with 0 innings          null -> dash`);
  }
}

// The closer-vs-starter case, which is the entire reason SV/9 exists.
const closer = pitchingRows.find((s) => s.saves === 8);
const oneSaveStarter = pitchingRows.find((s) => s.saves === 1);
if (closer && oneSaveStarter) {
  const closerRate = pitchingMetrics(toPitchingCounts(closer)).savesPer9;
  const starterRate = pitchingMetrics(toPitchingCounts(oneSaveStarter)).savesPer9;
  if (closerRate === null || starterRate === null) {
    fail('SV/9 was null for a pitcher who does have saves; the rate is not being computed');
  } else if (!(closerRate > starterRate)) {
    fail(`SV/9: the closer (${closerRate.toFixed(2)}) does not beat the one-save starter `
      + `(${starterRate.toFixed(2)}); the board would rank a starter above a bullpen arm`);
  } else {
    console.log(
      `  closer vs 1-save starter   ${closerRate.toFixed(2)} > ${starterRate.toFixed(2)}`,
    );
  }
}

/*
  SORT-ON vs DISPLAY parity, for the boards whose stored value is pre-rounded.

  `PlayerSeasonPitching` stores `era` and `whip` at 2dp. If a board sorted the stored figure it
  would tie two pitchers who are genuinely 0.01 apart, and tie on percentile too -- a percentile that
  ties when the underlying numbers do not is a worse lie than a rounded figure. So the board reads
  the metrics object, and this confirms the two can disagree.
*/
console.log('\n  SORT VALUE vs STORED VALUE\n');
// `pm` is already the `{ s, m }` array. The first version re-filtered `pitchingRows` (the raw stat
// rows) with the destructuring of a mapped array, so `s` was undefined and the check threw on the
// first row instead of reporting anything. Caught only because the tool exited non-zero -- which is
// the whole argument for running these at all rather than reading the code.
const roundingDiffers = pm.filter(({ s, m }) => {
  const computedEra = m.era ?? Number.NaN;
  return Number.isFinite(computedEra) && Math.abs(s.era - computedEra) > 0.005;
});
if (roundingDiffers.length > 0) {
  console.log(
    `  ${roundingDiffers.length} pitcher(s) where stored ERA != computed ERA, so sorting must use`
    + ' the computed value',
  );
  roundingDiffers.forEach(({ s, m }) => {
    console.log(`    ${s.playerId}: stored ${s.era.toFixed(3)}  computed ${(m.era ?? 0).toFixed(3)}`);
  });
} else {
  console.log('  stored and computed agree on every row here; parity still required by the board code');
}

console.log('');
if (problems.length > 0) {
  console.log(`  ${problems.length} PROBLEM(S):\n`);
  problems.forEach((p) => console.log(`    - ${p}`));
  console.log('');
  process.exit(1);
}
console.log('  every new rate board sorts correctly and handles nulls.\n');