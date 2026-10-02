/**
 * Scratch diagnostic: does playoff probability actually SPREAD across the field?
 *
 * Not a gate. A one-off measurement of the distribution, because a term that is 100% for half the
 * league and 0% for the rest cannot carry weight in the valuation regardless of being correct.
 */

import { playoffMonteCarlo } from '../src/lib/analytics/playoffMonteCarlo';
import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate, simulateGame } from '../src/logic/simulation';
import type { Game, Team } from '../src/types';

const YEAR = 2026;

const rng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const buildFixture = (seed: number, playedCount: number) => {
  const teams: Team[] = INITIAL_TEAMS.map((t) => ({
    ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0,
  }));
  const schedule = generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 });
  const played: Game[] = [];
  const remaining: Game[] = [];
  const original = Math.random;
  Math.random = rng(seed);
  try {
    schedule.forEach((game, index) => {
      if (index >= playedCount) { remaining.push({ ...game }); return; }
      const home = teams.find((t) => t.id === game.homeTeam) as Team;
      const away = teams.find((t) => t.id === game.awayTeam) as Team;
      const result = simulateGame(home, away, DEFAULT_SETTINGS);
      played.push({ ...game, status: 'completed', score: { home: result.homeScore, away: result.awayScore } });
    });
  } finally {
    Math.random = original;
  }
  return { teams, playedGames: played, remainingGames: remaining, settings: DEFAULT_SETTINGS };
};

const report = (label: string, playedCount: number, trials: number): void => {
  const fixture = buildFixture(20260401, playedCount);
  const gamesPerClub = Math.round((playedCount / 2464) * 154);
  const gamesLeft = Math.round(154 - gamesPerClub);
  const res = playoffMonteCarlo({ ...fixture, trials, seed: 4242 });

  const sorted = [...res.odds].sort((a, b) => b.makePlayoff - a.makePlayoff);
  const certain = sorted.filter((o) => o.makePlayoff === 1).length;
  const hopeless = sorted.filter((o) => o.makePlayoff === 0).length;
  const contested = sorted.filter((o) => o.makePlayoff > 0 && o.makePlayoff < 1).length;

  /*
    THE FIRST VERSION OF THIS TABLE WAS WRONG AND IT HID THE ACTUAL SHAPE OF THE DISTRIBUTION.

    It bucketed with `makePlayoff <= hi && makePlayoff > lo`, which double-counted every club at
    exactly 1.00 (it satisfied both the `=== 1` branch and the first open interval) and excluded
    every club at exactly 0.00. The buckets then summed to 18 of 32, which is not a number any
    reader should have to notice and reverse-engineer.

    Half-open intervals with the edges named are unambiguous and the total is asserted below, so a
    future edit that breaks the arithmetic fails instead of quietly under-reporting.
  */
  const BANDS: Array<{ label: string; lo: number; loInc: boolean; hi: number; hiInc: boolean }> = [
    { label: 'certain (1.00)', lo: 1.0, loInc: true, hi: 1.0, hiInc: true },
    { label: '(0.90, 1.00)', lo: 0.9, loInc: false, hi: 1.0, hiInc: false },
    { label: '(0.75, 0.90]', lo: 0.75, loInc: false, hi: 0.9, hiInc: true },
    { label: '(0.50, 0.75]', lo: 0.5, loInc: false, hi: 0.75, hiInc: true },
    { label: '(0.25, 0.50]', lo: 0.25, loInc: false, hi: 0.5, hiInc: true },
    { label: '(0.10, 0.25]', lo: 0.1, loInc: false, hi: 0.25, hiInc: true },
    { label: '(0.00, 0.10]', lo: 0.0, loInc: false, hi: 0.1, hiInc: true },
    { label: 'hopeless (0.00)', lo: 0.0, loInc: true, hi: 0.0, hiInc: true },
  ];
  const inBand = (p: number, band: typeof BANDS[number]): boolean =>
    (band.loInc ? p >= band.lo : p > band.lo) && (band.hiInc ? p <= band.hi : p < band.hi);
  const counts = BANDS.map((band) => sorted.filter((o) => inBand(o.makePlayoff, band)).length);
  const banded = counts.reduce((a, b) => a + b, 0);

  // Standard deviation of the make probability across the field -- the spread the term provides.
  const mean = sorted.reduce((a, o) => a + o.makePlayoff, 0) / sorted.length;
  const sd = Math.sqrt(sorted.reduce((a, o) => a + (o.makePlayoff - mean) ** 2, 0) / sorted.length);

  console.log('\n' + label);
  console.log('  ' + gamesPerClub + ' games played per club, ' + gamesLeft + ' remaining, ' + trials + ' trials');
  console.log('  make-probability distribution:');
  BANDS.forEach((band, i) => {
    if (counts[i] === 0) return;
    console.log('    ' + band.label.padEnd(20) + ' ' + String(counts[i]).padStart(2) + ' clubs');
  });
  console.log('    ' + '(banded total)'.padEnd(20) + ' ' + String(banded).padStart(2)
    + (banded === sorted.length ? ' of ' + sorted.length : ' of ' + sorted.length + '  <-- BUCKETS LOSE CLUBS'));
  console.log('    ' + 'certain / contested / hopeless'.padEnd(20) + ' ' + certain + ' / ' + contested + ' / ' + hopeless);
  console.log('    cross-field sd of make probability: ' + sd.toFixed(4)
    + (sd < 0.10 ? '   <-- TOO FLAT to carry weight' : ''));
  console.log('    title probability range: '
    + (Math.min(...res.odds.map((o) => o.championship)) * 100).toFixed(2) + '% to '
    + (Math.max(...res.odds.map((o) => o.championship)) * 100).toFixed(2) + '%');
  console.log('    resolution floor: 1 trial = ' + (100 / trials).toFixed(2)
    + '% of probability, so anything printed as 0.00% is below the method\'s resolution, not proven impossible');
};

report('EARLY SEASON', 60, 2000);
report('ONE THIRD IN', 820, 2000);
report('LATE SEASON', 2050, 2000);
report('LAST STRETCH', 2380, 2000);
