/*
  ONE TEMPERATURE PER GAME, AND THE SAME ONE EVERY TIME IT IS ASKED.

  `gameTemperature.ts` is computed on the fly, deliberately: the game screen shows it, and a future
  ranking ("team with the most wins in cold weather, 61F and below") will bucket games by it without
  a stored field. Both uses depend on the module being right twice over:

    1. PURE -- the same (home team, date, game id) must return the identical number on every call,
       across refreshes and archive round-trips, because a ranking recomputed later must bucket the
       same game the same way. A stray `Math.random` or a seed that read a mutable value would make
       the ranking unreproducible and the screen a liar.

    2. GROUNDED -- the value must actually be the park's monthly mean plus a bounded jitter. If the
       month index is off by one, a July game gets June's weather; if the jitter is unbounded, a
       "cold weather" cutoff becomes meaningless; if a parkless team gets a number, a custom league
       is being told a temperature for a park that does not exist.

  What is checked here, and why:

    - Determinism: the same inputs give the same Celsius and Fahrenheit on every call.
    - The base is the park's own monthly curve: for every park and every season month, the game
      temperature within that month is within the jitter band of that month's `climateMonthC` value.
    - The month mapping is the calendar season: April reads index 0, October the last index, and
      months outside the season clamp to the nearest edge instead of indexing out of range.
    - Jitter actually moves: distinct game ids on the same park and date are not all identical.
    - F is derived from C, rounded to a whole degree, so a 61F cutoff and the screen cannot disagree.
    - The whole league stays in a sane physical band (no NaN, nothing below -30C or above 50C).
    - A parkless club returns null, and the 32 shipped clubs all have a temperature.
*/
import { INITIAL_TEAMS } from '../src/data/teams';
import { CLIMATE_MONTHS, climateMonthC, parkProfile, toF } from '../src/lib/analytics/parkProfile';
import {
  GAME_TEMPERATURE_JITTER_C,
  formatGameTemperature,
  gameTemperatureC,
  gameTemperatureF,
} from '../src/lib/gameTemperature';

const problems: string[] = [];

const check = (label: string, pass: boolean, detail: string) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`          ${detail}`);
  if (!pass) problems.push(label);
};

const integer = (value: number): boolean => Number.isInteger(value) && Number.isFinite(value);

const dates = [
  `${2026}-04-01`,
  `${2026}-04-30`,
  `${2026}-05-15`,
  `${2026}-06-10`,
  `${2026}-07-04`,
  `${2026}-08-20`,
  `${2026}-09-05`,
  `${2026}-10-31`,
];

const ids = ['t1', ...INITIAL_TEAMS.map((team) => team.id)];

console.log('\nGAME-TIME TEMPERATURE -- the thermostat, checked for purity and grounding\n');

// ---------------------------------------------------------------------------------------------
// DETERMINISM -- the same game always reads the same number
// ---------------------------------------------------------------------------------------------

{
  let deterministic = true;
  const seen = new Map<string, string>();
  for (const homeTeam of ids) {
    for (const date of dates) {
      for (let k = 0; k < 12; k += 1) {
        const gameId = `${homeTeam}@${date}#${k}`;
        const key = `${homeTeam}|${date}|${gameId}`;
        for (let pass = 0; pass < 3; pass += 1) {
          const c = gameTemperatureC(homeTeam, date, gameId);
          const f = gameTemperatureF(homeTeam, date, gameId);
          const label = formatGameTemperature(homeTeam, date, gameId);
          // `null` is a valid, stable answer for a parkless club -- the point is that it does not
          // CHANGE, not that it is non-null.
          const serialised = `${c}|${f}|${label}`;
          const prior = seen.get(key);
          if (prior === undefined) seen.set(key, serialised);
          else if (prior !== serialised) deterministic = false;
        }
      }
    }
  }
  check(
    'every game reads the same temperature on every pass',
    deterministic,
    deterministic ? 'C, F and the formatted label are stable across repeated calls and parks/dates' : 'a value changed between passes -- the seed or the math is not pure',
  );
}

// ---------------------------------------------------------------------------------------------
// GROUNDING -- each value is that park's monthly mean plus a bounded jitter
// ---------------------------------------------------------------------------------------------

{
  let grounded = true;
  let detail = '';
  for (const team of INITIAL_TEAMS) {
    const profile = parkProfile(team.id);
    if (!profile) {
      grounded = false;
      detail = `${team.id} has no park profile`;
      break;
    }
    const monthly = climateMonthC(profile);
    for (let monthIdx = 0; monthIdx < monthly.length; monthIdx += 1) {
      const date = `${2026}-${String(monthIdx + 4).padStart(2, '0')}-15`;
      const temp = gameTemperatureC(team.id, date, `${team.id}@${date}#m${monthIdx}`);
      if (temp === null) {
        grounded = false;
        detail = `${team.id} returned null on ${date}`;
        break;
      }
      const lower = monthly[monthIdx] - GAME_TEMPERATURE_JITTER_C - 1e-9;
      const upper = monthly[monthIdx] + GAME_TEMPERATURE_JITTER_C + 1e-9;
      if (temp < lower || temp > upper) {
        grounded = false;
        detail = `${team.id} on ${date}: ${temp}C is outside ${monthly[monthIdx].toFixed(1)} +- ${GAME_TEMPERATURE_JITTER_C}C`;
        break;
      }
    }
    if (!grounded) break;
  }
  check(
    `every shipped park's game temperature sits within ${GAME_TEMPERATURE_JITTER_C}C of its own monthly mean`,
    grounded,
    grounded ? 'all 32 parks, all season months, inside the band' : detail,
  );
}

// ---------------------------------------------------------------------------------------------
// MONTH MAPPING -- April is index 0, October the last index, outside months clamp
// ---------------------------------------------------------------------------------------------

{
  const team = INITIAL_TEAMS[0];
  const monthly = climateMonthC(parkProfile(team.id)!);
  const first = gameTemperatureC(team.id, `${2026}-04-15`, 'april-game');
  const last = gameTemperatureC(team.id, `${2026}-10-15`, 'october-game');
  const before = gameTemperatureC(team.id, `${2026}-03-15`, 'march-game');
  const after = gameTemperatureC(team.id, `${2026}-11-15`, 'november-game');
  const aprilBandOk = first !== null && Math.abs(first - monthly[0]) <= GAME_TEMPERATURE_JITTER_C + 1e-9;
  const octoberBandOk = last !== null && Math.abs(last - monthly[monthly.length - 1]) <= GAME_TEMPERATURE_JITTER_C + 1e-9;
  const marchClamps = before !== null && Math.abs(before - monthly[0]) <= GAME_TEMPERATURE_JITTER_C + 1e-9;
  const novemberClamps = after !== null && Math.abs(after - monthly[monthly.length - 1]) <= GAME_TEMPERATURE_JITTER_C + 1e-9;
  check(
    `April maps to the first of ${CLIMATE_MONTHS.length} months and October to the last`,
    aprilBandOk && octoberBandOk,
    `April ${first}C vs mean ${monthly[0]}C; October ${last}C vs mean ${monthly[monthly.length - 1]}C`,
  );
  check(
    'games outside the season clamp to the nearest season month',
    marchClamps && novemberClamps,
    `March ${before}C must read like April ${monthly[0]}C; November ${after}C like October ${monthly[monthly.length - 1]}C`,
  );
}

// ---------------------------------------------------------------------------------------------
// JITTER -- distinct game ids on the same park and date are not all the same game
// ---------------------------------------------------------------------------------------------

{
  const team = INITIAL_TEAMS[0];
  const date = `${2026}-07-04`;
  const values = new Set<number>();
  for (let k = 0; k < 40; k += 1) {
    const temp = gameTemperatureC(team.id, date, `jitter-probe-${k}`);
    if (temp !== null) values.add(temp);
  }
  check(
    'the seeded jitter spreads a day of games rather than freezing them',
    values.size >= 2,
    `${values.size} distinct temperatures across 40 game ids at one park on one date`,
  );
}

// ---------------------------------------------------------------------------------------------
// FAHRENHEIT -- derived from the Celsius, and a whole degree the screen can print
// ---------------------------------------------------------------------------------------------

{
  let fOk = true;
  let detail = '';
  let scanned = 0;
  for (const team of INITIAL_TEAMS) {
    for (const date of dates) {
      const c = gameTemperatureC(team.id, date, `f-check-${team.id}-${date}`);
      const f = gameTemperatureF(team.id, date, `f-check-${team.id}-${date}`);
      if (c === null || f === null || !integer(f) || f !== Math.round(toF(c))) {
        fOk = false;
        detail = `${team.id} on ${date}: C ${c}, F ${f}`;
        break;
      }
      scanned += 1;
    }
    if (!fOk) break;
  }
  check(
    'Fahrenheit is the whole-degree conversion of the Celsius value',
    fOk,
    fOk ? `${scanned} park/date pairs converted consistently` : detail,
  );
}

// ---------------------------------------------------------------------------------------------
// PHYSICAL BAND -- nothing NaN, nothing absurd; parkless clubs correctly get nothing
// ---------------------------------------------------------------------------------------------

{
  let bandOk = true;
  let detail = '';
  let coldest = Infinity;
  let warmest = -Infinity;
  for (const team of INITIAL_TEAMS) {
    for (const date of dates) {
      const temp = gameTemperatureC(team.id, date, `band-${team.id}-${date}`);
      if (temp === null || !Number.isFinite(temp) || temp < -30 || temp > 50) {
        bandOk = false;
        detail = `${team.id} on ${date}: ${temp}C`;
        break;
      }
      coldest = Math.min(coldest, temp);
      warmest = Math.max(warmest, temp);
    }
    if (!bandOk) break;
  }
  check(
    'the whole league stays inside a sane physical band',
    bandOk,
    bandOk ? `league game-time range ${coldest.toFixed(1)}C to ${warmest.toFixed(1)}C (${Math.round(toF(coldest))}F to ${Math.round(toF(warmest))}F)` : detail,
  );

  const parkless = [gameTemperatureC('no-such-team', dates[0], 'g'), gameTemperatureF('no-such-team', dates[0], 'g'), formatGameTemperature('no-such-team', dates[0], 'g')];
  check(
    'a club with no park profile has no temperature at all',
    parkless.every((v) => v === null),
    `parkless reads ${parkless.join(' / ')}; a custom-league club must not be told a temperature for a park that does not exist`,
  );
}

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).\n`);
  process.exit(1);
}
console.log('  the game-time thermostat is pure, grounded in park and month, and reproducible.\n');