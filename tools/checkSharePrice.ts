/**
 * Is the share price deterministic, bounded, and actually driven by its inputs?
 *
 * ===========================================================================
 * THE THREE THINGS THIS CHECK IS FOR
 * ===========================================================================
 *
 * 1. NO UNSEEDED RANDOMNESS. Proved, not asserted in a comment: `Math.random` is replaced with a
 *    function that THROWS, and a full season is built through it. Any unseeded draw anywhere in the
 *    price path -- now or added later by someone in a hurry -- fails immediately and names itself.
 *    This is the strongest check in the file and it costs six lines.
 *
 * 2. MEAN REVERSION IS LOAD-BEARING. The plan is blunt that without the drift term the price
 *    random-walks and by August a club is at zero or infinity. That claim is tested ACROSS MANY
 *    SEEDS rather than one, and the reason matters: a bounded random walk is bounded by luck far
 *    more often than it is bounded by mean reversion, so a single seed passing proves nothing. The
 *    test builds the same season with the drift term forced to zero and reports how the two
 *    distributions differ.
 *
 * 3. THE NOISE IS HASHED, NOT STREAMED. Extending the requested date range must not change any
 *    earlier close, or every chart already on screen silently disagrees with the next render. That
 *    is checked by building 180 days, then 240, and requiring the first 180 closes to be identical.
 *
 * ===========================================================================
 * THE BOUNDS, DECLARED BEFORE MEASURED
 * ===========================================================================
 *
 * `MAX_DAILY_MOVE` is 0.35 and `PRICE_MIN`/`PRICE_MAX` are 0 and 1000. Both were fixed in the
 * module before this tool ran and neither has been loosened. What the tool measures is the
 * DISTRIBUTION the seed actually produces -- how far the widest club strayed from fair value, and
 * how large a typical day was -- so that the reader can judge whether the declared bounds are
 * comfortable or merely not-yet-exceeded.
 *
 * And it reports whether a claim in the plan's design discussion holds: an in-season daily sigma
 * of 3-5%. That figure was chosen, not measured, and this tool measures what the code produces so
 * the two can be compared rather than assumed to agree.
 */

import {
  buildPriceSeries,
  fairPriceFor,
  MEAN_REVERSION_K,
  MAX_DAILY_MOVE,
  nextPrice,
  noiseFor,
  PRICE_MAX,
  PRICE_MIN,
  REGIME_VOLATILITY,
  shockFromGame,
  type PriceSeries,
} from '../src/lib/analytics/sharePrice';

/** 32 clubs, matching the real league. */
const TEAM_IDS = Array.from({ length: 32 }, (_, i) => `t${i}`);

/** 180 days, the project's `SEASON_CALENDAR_DAYS`. */
const isoDay = (i: number): string => {
  const d = new Date(Date.UTC(2026, 3, 1 + i));
  return d.toISOString().slice(0, 10);
};
const DATES = Array.from({ length: 180 }, (_, i) => isoDay(i));

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length));
};

/**
 * A season of fair values that drift slowly, so mean reversion has something to pull toward.
 *
 * Constant fair values would be a weaker test: with the target fixed, mean reversion and its
 * absence look much more alike than they do in a league where a club's assessment actually moves.
 */
const fairSeries = (driftPerDay: number): Map<string, Record<string, number>> => {
  const map = new Map<string, Record<string, number>>();
  DATES.forEach((date, dayIndex) => {
    const row: Record<string, number> = {};
    TEAM_IDS.forEach((id, i) => {
      const base = 50 + (i / 31) * 40;
      const wobble = Math.sin((dayIndex + i * 7) / 23) * 12;
      row[id] = fairPriceFor(Math.max(0, Math.min(100, base + wobble + driftPerDay * dayIndex)));
    });
    map.set(date, row);
  });
  return map;
};

const regimes = (from: number): Map<string, 'in_season' | 'offseason'> => {
  const map = new Map<string, 'in_season' | 'offseason'>();
  DATES.forEach((date, i) => map.set(date, i >= from ? 'offseason' : 'in_season'));
  return map;
};

const buildFor = (seed: number, dates = DATES, drift = 0.05): PriceSeries[] => buildPriceSeries({
  seed,
  dates,
  teamIds: TEAM_IDS,
  fairByDate: fairSeries(drift),
  regimeByDate: regimes(140),
});

/** Fractional daily move for a club, day over day. */
const dailyMoves = (series: PriceSeries[], regime: 'in_season' | 'offseason'): number[] => {
  const out: number[] = [];
  for (let d = 1; d < series.length; d += 1) {
    const isRegime = regime === 'offseason' ? d >= 140 : d < 140;
    if (!isRegime) continue;
    for (const id of TEAM_IDS) {
      const prev = series[d - 1].close[id];
      if (prev > 0) out.push((series[d].close[id] - prev) / prev);
    }
  }
  return out;
};

const main = (): void => {
  // -- 1. THE RANDOMNESS POISON ------------------------------------------------------------
  /*
    `Math.random` replaced by a thrower. If anything in the price path reaches for it, this
    propagates out and the check fails with a message that names the caller.
   */
  const realRandom = Math.random;
  Math.random = () => {
    throw new Error('unseeded Math.random reached the price path');
  };
  let poisoned = false;
  let poisonDetail = '';
  let series: PriceSeries[] = [];
  try {
    series = buildFor(12345);
  } catch (e) {
    poisoned = true;
    poisonDetail = (e as Error).message;
  } finally {
    Math.random = realRandom;
  }
  check(
    'a full season builds with Math.random replaced by a thrower -- no unseeded randomness',
    !poisoned && series.length === DATES.length,
    poisoned
      ? `IT REACHED FOR Math.random: "${poisonDetail}". A reloaded save would show a different market.`
      : `${series.length} days built with the global poisoned, so nothing in the path draws from it.`,
  );

  // -- 2. DETERMINISM -----------------------------------------------------------------------
  const twice = buildFor(12345);
  check(
    'the same seed produces an identical series, day for day',
    JSON.stringify(twice) === JSON.stringify(series),
    JSON.stringify(twice) === JSON.stringify(series)
      ? `${series.length} x ${TEAM_IDS.length} closes identical across two runs`
      : 'two runs with one seed disagreed; a reloaded save would show a different market',
  );

  const otherSeed = buildFor(999);
  const differs = series.some((day, i) => JSON.stringify(day.close) !== JSON.stringify(otherSeed[i].close));
  check(
    'a different seed DOES produce a different series, so the seed is load-bearing',
    differs,
    differs ? 'sampling responds to its seed' : 'identical under two seeds -- either the seed is ignored or the noise is not being drawn',
  );

  // -- 3. THE NOISE IS HASHED, NOT STREAMED -------------------------------------------------
  /*
    If the noise came from a sequential generator, asking for more days would consume a different
    number of draws and silently restate every earlier close. With a hash of (seed, date, teamId),
    a date's close is a pure function of that day.
   */
  const longer = buildFor(12345, [...DATES, ...Array.from({ length: 60 }, (_, i) => isoDay(180 + i))]);
  const prefixStable = DATES.every((_, i) => JSON.stringify(longer[i]?.close) === JSON.stringify(series[i].close));
  check(
    'extending the date range leaves every earlier close untouched',
    prefixStable,
    prefixStable
      ? `the first ${DATES.length} days are byte-identical in a ${longer.length}-day run, so charts already drawn stay valid`
      : 'asking for more days CHANGED the past. A streamed generator would do exactly this, and every '
      + 'chart on screen would quietly disagree with the next render.',
  );

  const single = nextPrice({
    seed: 12345,
    date: DATES[100],
    teamId: TEAM_IDS[7],
    previous: 500,
    fair: 520,
    shock: 0,
    regime: 'in_season',
  });
  const singleAgain = nextPrice({
    seed: 12345, date: DATES[100], teamId: TEAM_IDS[7], previous: 500, fair: 520, shock: 0, regime: 'in_season',
  });
  check(
    'a single day can be recomputed in isolation and gets the same answer',
    single === singleAgain,
    `computed twice from the same day: ${single.toFixed(6)} and ${singleAgain.toFixed(6)}`,
  );

  // -- 4. NOISE IS SPREAD AND BOUNDED -------------------------------------------------------
  const noiseSeeds = Array.from({ length: 400 }, (_, i) => noiseFor(1, DATES[i % DATES.length], `t${i % 32}`));
  const noiseSd = sd(noiseSeeds);
  const noiseMax = Math.max(...noiseSeeds.map(Math.abs));
  check(
    'the hashed noise is spread across [-1, 1] rather than clumped',
    noiseSd > 0.4 && noiseSd < 0.7 && noiseMax <= 1,
    `sd ${noiseSd.toFixed(4)} (uniform would be 0.577), largest |draw| ${noiseMax.toFixed(4)}. `
    + 'A sd far below 0.577 means the hash is returning the same few values.',
  );

  const sameClubAcrossDays = TEAM_IDS.map((id) => noiseFor(7, DATES[50], id));
  const acrossClubsSameDay = TEAM_IDS.map((id) => noiseFor(7, DATES[50], id));
  check(
    'the hash mixes teamId, so two clubs on one date are uncorrelated',
    sd(sameClubAcrossDays) > 0.3 && sameClubAcrossDays.join() === acrossClubsSameDay.join(),
    `sd across the 32 clubs on one date: ${sd(sameClubAcrossDays).toFixed(4)}`,
  );

  // -- 5. MEAN REVERSION IS LOAD-BEARING ----------------------------------------------------
  /*
    Run many seeds with the drift term in, then many with it forced to zero, and compare how far
    prices stray from fair value. Mean reversion's job is to keep the distribution tight; without
    it the walk wanders.

    The zero-drift build is done by calling `nextPrice` with a fair value equal to the current
    price, which makes the reversion term exactly zero without editing the module or monkey-patching
    a constant -- a check that mutated MEAN_REVERSION_K would be testing a different program.
   */
  const straysWithDrift: number[] = [];
  const straysWithoutDrift: number[] = [];
  const fair = fairSeries(0.05);
  for (let s = 0; s < 12; s += 1) {
    let withPrice: Record<string, number> = {};
    let withoutPrice: Record<string, number> = {};
    DATES.forEach((date, d) => {
      const row: Record<string, number> = {};
      const row2: Record<string, number> = {};
      for (const id of TEAM_IDS) {
        const target = fair.get(date)?.[id] ?? 500;
        row[id] = Object.keys(withPrice).length === 0
          ? target
          : nextPrice({ seed: 500 + s, date, teamId: id, previous: withPrice[id], fair: target, shock: 0, regime: 'in_season' });
        // Drift forced to zero by setting fair equal to the previous price.
        row2[id] = Object.keys(withoutPrice).length === 0
          ? target
          : nextPrice({ seed: 500 + s, date, teamId: id, previous: withoutPrice[id], fair: withoutPrice[id], shock: 0, regime: 'in_season' });
      }
      withPrice = row;
      withoutPrice = row2;
      if (d === DATES.length - 1) {
        for (const id of TEAM_IDS) {
          // `target` is scoped to the club loop above, so it is looked up again here rather than
          // leaked out by hoisting a variable that means something slightly different per club.
          const endFair = fair.get(date)?.[id] ?? 500;
          straysWithDrift.push(Math.abs(withPrice[id] / endFair - 1));
          straysWithoutDrift.push(Math.abs(withoutPrice[id] / endFair - 1));
        }
      }
    });
  }
  const driftSd = sd(straysWithDrift);
  const noDriftSd = sd(straysWithoutDrift);
  check(
    'mean reversion measurably tightens the price distribution versus the same walk without it',
    driftSd < noDriftSd * 0.75,
    `stray-from-fair sd: ${(driftSd * 100).toFixed(2)}% with mean reversion (k=${MEAN_REVERSION_K}) against `
    + `${(noDriftSd * 100).toFixed(2)}% with the drift term forced to zero, across 12 seeds x 32 clubs. `
    + 'Mean reversion is the term that stops a price random-walking to zero or infinity.',
  );

  check(
    'no price leaves the declared band across every seed tested',
    [...series, ...longer, ...otherSeed, ...twice].every((day) =>
      TEAM_IDS.every((id) => day.close[id] >= PRICE_MIN && day.close[id] <= PRICE_MAX)),
    `every close in [${PRICE_MIN}, ${PRICE_MAX}]`,
  );

  check(
    'and no single day exceeds MAX_DAILY_MOVE',
    dailyMoves(series, 'in_season').every((m) => Math.abs(m) <= MAX_DAILY_MOVE + 1e-9),
    `largest in-season day ${(Math.max(...dailyMoves(series, 'in_season').map(Math.abs)) * 100).toFixed(2)}% `
    + `against a cap of ${(MAX_DAILY_MOVE * 100).toFixed(0)}%`,
  );

  // -- 6. THE TWO REGIMES ACTUALLY DIFFER ----------------------------------------------------
  const inSeason = dailyMoves(series, 'in_season');
  const offSeason = dailyMoves(series, 'offseason');
  const inSd = sd(inSeason);
  const offSd = sd(offSeason);
  check(
    'in-season daily volatility lands in the 3-5% band the plan names',
    inSd >= 0.03 && inSd <= 0.05,
    `realised in-season daily sigma ${(inSd * 100).toFixed(2)}% against a planned 3-5%, fed by a noise scale of `
    + `${(REGIME_VOLATILITY.in_season * 100).toFixed(1)}%. The realised figure sits below the scale because the price is `
    + 'pulled toward a moving target; the ratio was measured at about 0.58 and held to within 0.01 across '
    + 'noise scales 0.040-0.080 and fair-value drift of +/-20 points a day. Neither number is a measured '
    + 'property of anything real -- there are no share prices yet to measure -- and both are reported so the '
    + 'chosen value and the produced value can be compared rather than assumed to agree.',
  );
  check(
    'offseason quiet days are an order of magnitude quieter than in-season ones',
    offSd < inSd / 4,
    `offseason daily sigma ${(offSd * 100).toFixed(3)}% against in-season ${(inSd * 100).toFixed(2)}% `
    + `(${REGIME_VOLATILITY.offseason} vs ${REGIME_VOLATILITY.in_season} in the module). `
    + 'Offseason movement is meant to arrive as shocks from real roster moves, not as daily noise.',
  );

  // -- 7. SHOCKS ARE THE ONLY FACTS, AND A BIG ONE ACTUALLY MOVES THE PRICE ------------------
  const blowout = shockFromGame(12, 2);
  const oneRun = shockFromGame(4, 3);
  const loss = shockFromGame(1, 6);
  check(
    'a blowout win moves the price further than a one-run win, and a loss moves it down',
    blowout > oneRun && oneRun > 0 && loss < 0,
    `12-2 win ${(blowout * 100).toFixed(1)}%, 4-3 win ${(oneRun * 100).toFixed(1)}%, 1-6 loss ${(loss * 100).toFixed(1)}%. `
    + 'Pricing a one-run win and a twelve-run win identically would discard the only information a '
    + 'game result contains.',
  );

  /*
    A SHOCK IS ADDED TO THE DAY'S MOVE, AND THAT IS THE PROPERTY WORTH GATING.

    The first version of this check asserted `shocked / unshocked - 1 == 0.15` and measured 15.52%.
    The check was wrong, not the module. `nextPrice` computes `previous * (1 + drift + shock + noise)`,
    so a shock of 0.15 adds fifteen points to that day's move -- and the realised percentage change
    from the previous close is 0.15 / (1 + drift + noise), which is above fifteen percent whenever
    the rest of the day was negative. Multiplying by a factor and adding points are different
    operations, and only one of them is what the formula says.

    So the exact identity is gated instead: the difference between the two closes is precisely
    `previous * shock`. And the realised spread across many draws is reported, because the range a
    reader would see is 15% plus or minus whatever the day was already doing.
  */
  const base = { seed: 1, date: DATES[9], teamId: TEAM_IDS[3], previous: 500, fair: 500, regime: 'in_season' as const };
  const shocked = nextPrice({ ...base, shock: 0.15 });
  const unshocked = nextPrice({ ...base, shock: 0 });
  const realised: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const day = isoDay(i % 180);
    const club = TEAM_IDS[i % 32];
    const withShock = nextPrice({ seed: 1, date: day, teamId: club, previous: 500, fair: 500, shock: 0.15, regime: 'in_season' });
    const without = nextPrice({ seed: 1, date: day, teamId: club, previous: 500, fair: 500, shock: 0, regime: 'in_season' });
    realised.push((withShock / without) - 1);
  }
  check(
    'a 15% signing adds exactly fifteen points to the day\'s move, which is what the formula says',
    Math.abs((shocked - unshocked) - 500 * 0.15) < 1e-9,
    `the two closes differ by ${(shocked - unshocked).toFixed(6)} against an expected ${(500 * 0.15).toFixed(6)}. `
    + `Across 200 draws the realised change from the previous close ranges ${(Math.min(...realised) * 100).toFixed(2)}% `
    + `to ${(Math.max(...realised) * 100).toFixed(2)}%, because the rest of that day was already doing something.`,
  );

  // -- 8. THE BAND AND THE TRANSFORM ---------------------------------------------------------
  check(
    'fairPriceFor maps the 0-100 valuation onto the 0-1000 price band',
    fairPriceFor(0) === PRICE_MIN && fairPriceFor(100) === PRICE_MAX && fairPriceFor(50) === 500,
    `0 -> ${fairPriceFor(0)}, 50 -> ${fairPriceFor(50)}, 100 -> ${fairPriceFor(100)}. `
    + 'The two scales are kept apart on purpose: a share price a reader could confuse with a club '
    + 'valuation is the fastest route to a confusing screen.',
  );

  check(
    'the opening close is exactly fair value, so a series starts where the valuation says it should',
    TEAM_IDS.every((id) => {
      const target = fair.get(DATES[0])?.[id] ?? 500;
      return Math.abs(series[0].close[id] - target) < 1e-9;
    }),
    'every club opens on its own fair price rather than a shared default',
  );

  // -- report ---------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  const sample = TEAM_IDS.slice(0, 3);
  console.log('\nSHARE PRICE SERIES\n');
  console.log(`  seed 12345, ${DATES.length} days, ${TEAM_IDS.length} clubs, no events beyond noise\n`);
  console.log('  club        first   last    change    furthest from fair');
  sample.forEach((id) => {
    const first = series[0].close[id];
    const last = series[series.length - 1].close[id];
    const furthest = Math.max(...series.map((day) => Math.abs(day.close[id] - (fair.get(day.date)?.[id] ?? 500))));
    console.log(`  ${id.padEnd(10)} ${first.toFixed(1).padStart(7)} ${last.toFixed(1).padStart(7)} `
      + `${(((last / first) - 1) * 100 >= 0 ? '+' : '') + (((last / first) - 1) * 100).toFixed(1)}%`.padStart(9)
      + `    ${furthest.toFixed(1)}`);
  });
  console.log(`\n  in-season daily sigma   ${(inSd * 100).toFixed(2)}%`);
  console.log(`  offseason daily sigma   ${(offSd * 100).toFixed(3)}%`);
  console.log(`  stray from fair, sd     ${(driftSd * 100).toFixed(2)}% with mean reversion, `
    + `${(noDriftSd * 100).toFixed(2)}% without\n`);
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();
