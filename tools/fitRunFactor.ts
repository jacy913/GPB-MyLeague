/**
 * WHY THE REALISED RUN RESPONSE IS 1.25-1.54x THE DERIVED RUN FACTOR
 *
 * `tools/checkParkWiring.ts` measures a slope: realised home-road scoring gap regressed on
 * the derived `runFactor`'s departure from 100. A correct model gives a slope near 1.00.
 * It measures 1.25 at the default windows and 1.54 at 400/200. Both are too high, which
 * means the engine moves runs between parks by MORE than `runFactor` claims it does.
 *
 * This tool finds out WHY, analytically, and then searches for the coefficients that make the
 * slope 1.00.
 *
 * WHY IT IS ANALYTIC RATHER THAN SIMULATED
 *
 * The response is exactly computable. A park does not change how many runs an outcome is
 * worth -- it changes the PROBABILITY of each outcome, by scaling the engine's weight map.
 * So for a park with scales s_o:
 *
 *     runs per at-bat  R(s)  =  SUM_o  w_o * s_o * r_o  /  SUM_o  w_o * s_o
 *
 * where w_o is the engine's neutral weight for outcome o, s_o is that outcome's park scale,
 * and r_o is the mean runs scored ON outcome o. `w_o` is measured from this engine's own play
 * logs, so the model is fitted to the engine rather than to an assumption about it, and any
 * candidate coefficient set can then be evaluated in microseconds instead of a 125-second
 * season.
 *
 * The simulation is still the arbiter. This tool nominates a candidate and the change is only
 * made after `checkParkWiring` re-measures the slope on real seasons. What this buys is that
 * the search does not need a 125-second run per guess.
 *
 * THE STRUCTURE THAT CAUSES THE OVERSHOOT
 *
 * `OUTCOME_SCALES` splits the eight outcomes three ways:
 *
 *     HR, 2B        ->  hrFactor                      (a 48% range across this league)
 *     1B, 3B        ->  fbFactor                      (a 26% range)
 *     OUT SO BB ERR ->  (runFactor + 1) / 2           (a 19.5% range, and HALVED again)
 *
 * The runs channel gets only HALF of `runFactor`'s departure, while the HR channel gets the
 * FULL `hrFactor` departure -- and `hrFactor`'s range is two and a half times wider than
 * `runFactor`'s. So the total moves more than `runFactor` says it does, and the regression
 * sees a slope above 1.
 *
 * There is also a DOUBLE COUNT, and it is a design error rather than a tuning error.
 * `hrFactor` appears BOTH in its own dedicated channel AND inside `runFactor`, as
 * `hrFactor ** runWeights.hr`. The engine therefore responds to the home-run environment
 * twice, through two independent doors. `runWeights.hr` exists because `runFactor` was
 * calibrated against ARCHETYPE TARGETS, which are run indices carrying some home-run
 * influence -- but the engine never reads those targets. It reads outcome weights. So the
 * term double-counts a channel that already exists.
 *
 * THE SEARCH
 *
 * Two families of candidate, because there are two defensible answers:
 *
 *   A. REMOVE the double count. Set `runWeights.hr` toward 0, so `runFactor` describes only
 *      the non-home-run environment: singles, triples, and the out/walk/error channel that a
 *      suppressing park drives by turning balls into outs. The HR channel keeps the whole
 *      home-run story on its own, where it belongs.
 *
 *   B. KEEP the term and rescale. Leave the structure alone and widen `runFactor` until its
 *      departure matches the realised mixture. Honest that it is a fitted coefficient, but it
 *      leaves the double count in place.
 *
 * The residual HR and FB weights are RESCALED so the blend still sums to 1.0 at the shipped
 * value and 1 - hrWeight at the candidate value. Without that, dropping the HR exponent would
 * shrink the whole run factor toward 1.000, which flatters the slope while doing nothing
 * about the double count -- the search would look successful and be wrong.
 *
 * WHAT IT CANNOT DO
 *
 * It does not verify, and this file's own track record says so. The shipped coefficient was
 * accepted on an archetype check that turned out to be validating a COPY of a formula rather
 * than the formula. So: the analytic prediction is compared against the simulated slope, and
 * if the two disagree by more than 0.05 the search is reported as UNTRUSTWORTHY rather than
 * acted on. A candidate that scores 1.00 here can still measure 1.4 on real seasons.
 *
 * Run: npx tsx tools/fitRunFactor.ts [warmupDays] [days]
 */

import {
  ALL_PARK_FACTORS,
  PARK_COEFFICIENTS,
  parkFactorsFor,
  type ParkFactors,
} from '../src/lib/analytics/parkFactors';
import { ALL_PARK_PROFILES } from '../src/lib/analytics/parkProfile';
import type { AtBatOutcome, Game, LeaguePlayerState, Team } from '../src/types';
import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 20);
const DAYS = Number(process.argv[3] ?? 60);

const OUTCOMES: AtBatOutcome[] = ['OUT', 'SO', '1B', '2B', '3B', 'HR', 'BB', 'ERR'];

/**
 * Expected runs scored ON each outcome, per plate appearance.
 *
 * THE ONE INPUT HERE THAT IS NOT MEASURED, and the tool's main weakness.
 *
 * The play log records one outcome per at-bat but does not attribute runs to at-bats, so a
 * box score cannot be decomposed into runs-per-outcome directly from it. These are therefore
 * the standard expectations for the run value of a plate appearance, with the home run
 * adjusted for the runner-on-third case.
 *
 * The values matter less than they look, because the search is over COEFFICIENTS. A, B and C
 * below are all scaled by the same denominators, so what determines the slope is their RATIO
 * -- roughly how much of a league's scoring comes on each channel -- and that ratio is
 * governed by the outcome mix, which IS measured from this engine. A 10% error in the home
 * run value moves the predicted slope by far less than the 1.25-to-1.54 swing that window
 * size alone produced.
 *
 * The honest fix is to have the engine record runners-on-base before each at-bat, which it
 * does not, and this file does not pretend otherwise.
 */
const RUNS_PER_OUTCOME: Record<AtBatOutcome, number> = {
  OUT: 0,
  SO: 0,
  ERR: 0.42,
  BB: 0.38,
  '1B': 0.86,
  '2B': 1.94,
  '3B': 2.90,
  HR: 1.09,
};

/** Mean runs per at-bat under a weight map scaled by `scales`. */
const runsPerAtBat = (
  weights: Record<AtBatOutcome, number>,
  scales: Record<AtBatOutcome, number>,
): number => {
  let num = 0;
  let den = 0;
  for (const o of OUTCOMES) {
    const w = weights[o] * scales[o];
    num += w * RUNS_PER_OUTCOME[o];
    den += w;
  }
  return den === 0 ? 0 : num / den;
};

const neutralScales = (): Record<AtBatOutcome, number> =>
  Object.fromEntries(OUTCOMES.map((o) => [o, 1])) as Record<AtBatOutcome, number>;

/** Ordinary least squares slope of y on x. */
const slopeOf = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
};

/**
 * Rebuild `runFactor` from a candidate HR weight. A DELIBERATE COPY of the arithmetic in
 * `parkFactorsFor`.
 *
 * Confined to this tool and commented as a copy on purpose. `deriveParkProfile`'s physics
 * check was already caught once for validating a re-derived copy of a formula instead of
 * calling the library -- so this copy is visible, it is the only one, and every number it
 * produces is confirmed against `checkParkWiring` before anything ships.
 *
 * The shipped coefficient is reproduced by `hrWeight = runWeights.hr`, and the tool asserts
 * that, so the copy cannot silently drift away from the library without this failing.
 */
const runFactorWith = (f: ParkFactors, hrWeight: number): number => {
  const w = PARK_COEFFICIENTS.runWeights;
  const fatigueTerm = 1 + f.pitcherFatigueRate * PARK_COEFFICIENTS.fatigueRunImpact;
  const remaining = 1 - w.hr;
  const fb = remaining === 0 ? 0 : (w.fb / remaining) * (1 - hrWeight);
  const gb = remaining === 0 ? 0 : (w.gb / remaining) * (1 - hrWeight);
  return (
    Math.pow(f.hrFactor, hrWeight)
    * Math.pow(f.fbFactor, fb)
    * Math.pow(f.gbFactor, gb)
    * fatigueTerm
  );
};

/** The predicted realised-run slope for a candidate HR weight, across all 32 parks. */
const slopeFor = (
  neutralWeights: Record<AtBatOutcome, number>,
  parks: ParkFactors[],
  hrWeight: number,
): number => {
  const neutral = runsPerAtBat(neutralWeights, neutralScales());

  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of parks) {
    const run = runFactorWith(p, hrWeight);
    // Only the (runFactor + 1) / 2 channel changes; HR, 2B, 1B and 3B are untouched,
    // because that channel is the only one `runFactor` feeds.
    const scales: Record<AtBatOutcome, number> = {
      OUT: (run + 1) / 2,
      SO: (run + 1) / 2,
      BB: (run + 1) / 2,
      ERR: (run + 1) / 2,
      HR: p.hrFactor,
      '2B': p.hrFactor,
      '1B': p.fbFactor,
      '3B': p.fbFactor,
    };
    xs.push(run - 1);
    ys.push(runsPerAtBat(neutralWeights, scales) / neutral - 1);
  }

  return slopeOf(xs, ys);
};

/**
 * Ordinary least squares on TWO regressors, by solving the 2x2 normal equations directly.
 *
 * Written out rather than pulled in because the point of this tool is to be inspectable, and
 * a two-predictor fit is short enough that hiding it behind a library would make the one
 * thing worth checking -- the coefficient signs and magnitudes -- harder to see.
 */
const multiSlope = (
  xs: Array<[number, number]>,
  ys: number[],
): { run: number; hr: number } => {
  let sxx = 0; let sxz = 0; let szz = 0; let sxy = 0; let szy = 0;
  for (let i = 0; i < ys.length; i += 1) {
    const [x, z] = xs[i];
    sxx += x * x; sxz += x * z; szz += z * z;
    sxy += x * ys[i]; szy += z * ys[i];
  }
  const det = sxx * szz - sxz * sxz;
  if (Math.abs(det) < 1e-12) return { run: NaN, hr: NaN };
  return {
    run: (sxy * szz - szy * sxz) / det,
    hr: (szy * sxx - sxy * sxz) / det,
  };
};

const main = async (): Promise<void> => {
  console.log('\nFIT THE RUN FACTOR TO THE REALISED RESPONSE\n');
  console.log(`  Measuring the engine's neutral outcome mix over ${WARMUP} warmup + ${DAYS} days.\n`);

  const universe0 = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR, seed: 4242, effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const initialTeams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe0, YEAR,
  );

  const manager = new SimulationManager({
    teams: initialTeams,
    games: generateSchedule(initialTeams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180,
    }),
    playerState: universe0,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  // Games are collected from the DAY RUNS rather than from any accessor on the manager,
  // because there is no accessor that returns them.
  //
  // DEDUPLICATED BY `gameId`, and that is not defensive tidiness -- it is a correction. The
  // first version appended every day run's `games` array blindly and counted 41,336 completed
  // games across a 60-day window for a 32-team league, which is about 43x the real number. So
  // `run({scope:'day'})` returns every game played SO FAR, not the day's games, and blind
  // accumulation re-counts old games once per subsequent day.
  //
  // The SECOND version fixed the dedupe but keyed it on `g.id`, which `Game` does not have.
  // Every key was therefore `undefined`, one game survived, and the tool confidently reported
  // an outcome mix measured from a SINGLE GAME -- one where 2B (9.57%) outnumbered 1B (8.51%)
  // and 3B never happened. The type checker caught it; nothing else would have, because the
  // tool printed that nonsense with the same formatting as a real measurement and went on to
  // nominate a coefficient from it.
  //
  // That is why the game count is printed next to the mix. A reader has to be able to see the
  // sample size without running anything else.
  const seen = new Set<string>();
  const completed: Game[] = [];
  let state: LeaguePlayerState = universe0;
  for (let d = 0; d < WARMUP + DAYS; d += 1) {
    const r = await manager.run({ scope: 'day' });
    state = r.playerState;
    if (d >= WARMUP) {
      for (const g of r.games) {
        if (g.status !== 'completed' || seen.has(g.gameId)) continue;
        seen.add(g.gameId);
        completed.push(g);
      }
    }
  }
  void state;

  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<AtBatOutcome, number>;
  let total = 0;
  for (const g of completed) {
    const raw = g.stats?.playLog;
    if (typeof raw !== 'string' || raw.length === 0) continue;
    let events: Array<{ outcome: string }>;
    try { events = JSON.parse(raw) as Array<{ outcome: string }>; } catch { continue; }
    for (const e of events) {
      const o = e.outcome as AtBatOutcome;
      if (o in counts) { counts[o] += 1; total += 1; }
    }
  }

  if (total === 0) {
    console.error('  No play logs found. Cannot measure the neutral weight map.\n');
    process.exitCode = 1;
    return;
  }

  const neutralWeights = Object.fromEntries(
    OUTCOMES.map((o) => [o, counts[o] / total]),
  ) as Record<AtBatOutcome, number>;

  console.log(`  ${completed.length} completed games, ${total.toLocaleString()} at-bats.\n`);
  console.log("  NEUTRAL OUTCOME MIX (the engine's weight map, measured from its own play logs)");
  for (const o of OUTCOMES) {
    const share = counts[o] / total;
    console.log(`    ${o.padEnd(4)} ${(share * 100).toFixed(2).padStart(6)}%  ${'#'.repeat(Math.round(share * 150))}`);
  }
  console.log(`\n  Runs per at-bat implied by this mix: ${runsPerAtBat(neutralWeights, neutralScales()).toFixed(4)}`);
  console.log('  (Runs per team-game is NOT checked here -- the mix above spans a whole season');
  console.log('   across both teams. checkParkWiring owns that measurement.)\n');

  const parks = [...ALL_PARK_FACTORS.values()];
  const absolute = [...ALL_PARK_PROFILES.values()].map((p) => parkFactorsFor(p));

  // THE COPY MUST MATCH THE LIBRARY, checked rather than assumed.
  //
  // Compared against `absolute`, NOT against `ALL_PARK_FACTORS`. The shipped map is
  // RE-CENTRED on the league -- every channel divided by its mean -- so its run factors sit
  // around 1.000 by construction, while `parkFactorsFor` returns absolute ones. Comparing a
  // copy of the library against a re-centred value is not a drift check, it is a check that
  // re-centring happened, and the first version of this reported a difference of 8.7e-2 and
  // declared the copy void.
  const copyDrift = Math.max(
    ...absolute.map((p) => Math.abs(runFactorWith(p, PARK_COEFFICIENTS.runWeights.hr) - p.runFactor)),
  );
  console.log(`  Copy-vs-library check at the shipped weight: max difference ${copyDrift.toExponential(2)}`);
  if (copyDrift > 1e-9) {
    console.error('  THE COPY HAS DRIFTED FROM parkFactorsFor. Every number below is void.\n');
    process.exitCode = 1;
    return;
  }
  console.log('  The copy reproduces the library exactly at the shipped coefficient.');

  // And the re-centring claim itself, stated so the two are not confused later.
  const reCentred = ALL_PARK_FACTORS;
  const runMean = reCentred.values().next();
  void runMean;
  const shippedMean = [...reCentred.values()].reduce((a, f) => a + f.runFactor, 0) / reCentred.size;
  console.log(`  (Shipped run factors average ${shippedMean.toFixed(6)}, so the drift check`);
  console.log('   above is against the ABSOLUTE factors -- the shipped map is re-centred.)\n');

  const candidates: number[] = [];
  for (let h = 0; h <= 0.4 + 1e-9; h += 0.01) candidates.push(Number(h.toFixed(2)));
  const scored = candidates
    .map((h) => ({ h, slope: slopeFor(neutralWeights, absolute, h) }))
    .sort((a, b) => Math.abs(a.slope - 1) - Math.abs(b.slope - 1));

  console.log('  CANDIDATE runWeights.hr -- predicted slope, closest to 1.00 first\n');
  console.log('    hr weight    predicted slope');
  console.log('    ' + '-'.repeat(38));
  for (const c of scored.slice(0, 10)) {
    console.log(`    ${c.h.toFixed(2).padStart(9)}    ${c.slope.toFixed(4).padStart(9)}`);
  }

  const shipped = slopeFor(neutralWeights, absolute, PARK_COEFFICIENTS.runWeights.hr);
  console.log(`\n  SHIPPED runWeights.hr = ${PARK_COEFFICIENTS.runWeights.hr}`);
  console.log(`  predicted slope       = ${shipped.toFixed(4)}`);
  console.log('  measured on seasons   = 1.25 (default windows) / 1.54 (400/200 windows)');

  /*
    THE CORRELATION QUESTION, and it is probably the whole explanation.

    `runFactor` is not an independent variable across parks. It contains `hrFactor ** 0.24`,
    and `hrFactor` ranges 48% against `runFactor`'s 19.5%. So a regression of realised runs
    on `runFactor` departure alone is partly regressing on `hrFactor` as well -- and
    `hrFactor` drives runs DIRECTLY, through the HR and 2B channels, with no halving.

    If that is what is happening, then the measured slope above 1.00 is not evidence that
    `runFactor` is miscalibrated. It is evidence that the check's regressor is a proxy for two
    things, one of which it is not naming.

    So the same realised responses are regressed on BOTH departures here. If `hrFactor` takes
    a large coefficient and `runFactor` a small one, the run blend is not the thing driving
    run variation, and no coefficient on the run blend will ever produce a slope near 1.00 --
    which is exactly what the candidate table above shows.
   */
  const neutral = runsPerAtBat(neutralWeights, neutralScales());
  const pairs: Array<[number, number]> = [];
  const responses: number[] = [];
  for (const p of absolute) {
    const scales: Record<AtBatOutcome, number> = {
      OUT: (p.runFactor + 1) / 2,
      SO: (p.runFactor + 1) / 2,
      BB: (p.runFactor + 1) / 2,
      ERR: (p.runFactor + 1) / 2,
      HR: p.hrFactor,
      '2B': p.hrFactor,
      '1B': p.fbFactor,
      '3B': p.fbFactor,
    };
    pairs.push([p.runFactor - 1, p.hrFactor - 1]);
    responses.push(runsPerAtBat(neutralWeights, scales) / neutral - 1);
  }
  const both = multiSlope(pairs, responses);

  console.log('\n  TWO-REGRESSOR FIT -- realised runs on BOTH park departures\n');
  console.log(`    on runFactor alone : slope ${shipped.toFixed(4)}`);
  console.log(`    on both            : runFactor ${both.run.toFixed(4)}, hrFactor ${both.hr.toFixed(4)}`);
  const corr = (() => {
    const mx = pairs.reduce((a, q) => a + q[0], 0) / pairs.length;
    const mz = pairs.reduce((a, q) => a + q[1], 0) / pairs.length;
    let n = 0; let dx = 0; let dz = 0;
    for (const [x, z] of pairs) { n += (x - mx) * (z - mz); dx += (x - mx) ** 2; dz += (z - mz) ** 2; }
    return n / Math.sqrt(dx * dz);
  })();
  console.log(`    correlation between the two departures: r = ${corr.toFixed(4)}`);

  if (Math.abs(both.hr) > Math.abs(both.run) * 1.5) {
    console.log('\n    *** THE HR CHANNEL DOMINATES. `runFactor` is a weak proxy for it.');
    console.log('        A slope above 1.00 on runFactor alone is therefore EXPECTED, and it');
    console.log('        is not evidence that the run blend is wrong.');
    console.log('        No runWeights value can fix a regressor that stands in for something else.');
  }

  /*
    DOES `runFactor` EARN ITS PLACE AT ALL?

    If the two-regressor fit says the HR channel carries the run variation, then the
    uncomfortable question is whether the run blend contributes anything at all. This is
    answerable without a simulation, and it is the question that decides whether there is
    anything to recalibrate.

    The test sets the run blend to a factor of exactly 1.000 at every park -- which is what
    `runWeights` all zero would do -- and asks how much of the realised run spread survives.
    Whatever spread remains is carried entirely by the HR and FB channels.
   */
  const responseSpread = (
    runOf: (p: ParkFactors) => number,
  ): { range: number; min: number; max: number } => {
    const vals = absolute.map((p) => {
      const scales: Record<AtBatOutcome, number> = {
        OUT: (runOf(p) + 1) / 2,
        SO: (runOf(p) + 1) / 2,
        BB: (runOf(p) + 1) / 2,
        ERR: (runOf(p) + 1) / 2,
        HR: p.hrFactor,
        '2B': p.hrFactor,
        '1B': p.fbFactor,
        '3B': p.fbFactor,
      };
      return runsPerAtBat(neutralWeights, scales) / neutral;
    });
    return { range: Math.max(...vals) - Math.min(...vals), min: Math.min(...vals), max: Math.max(...vals) };
  };

  const withBlend = responseSpread((p) => p.runFactor);
  const withoutBlend = responseSpread(() => 1);
  const retained = (withoutBlend.range / withBlend.range) * 100;

  console.log('\n  IS THE RUN BLEND EARNING ITS PLACE?\n');
  console.log(`    realised run response range WITH the blend   : ${(withBlend.range * 100).toFixed(2)}%`);
  console.log(`    the same with runFactor forced to 1.000     : ${(withoutBlend.range * 100).toFixed(2)}%`);
  console.log(`    share of the spread that survives without it: ${retained.toFixed(1)}%`);

  if (retained > 85) {
    console.log('\n    *** THE BLEND BARELY MATTERS. Almost all run variation across parks is');
    console.log('        carried by the HR and FB channels. Setting every runWeight to zero would');
    console.log('        barely change the game, and that is worth knowing before spending effort');
    console.log('        recalibrating a coefficient that has almost no leverage.');
  } else if (retained < 40) {
    console.log('\n    The blend carries a real share of the spread, so it is doing work.');
  }

  const agree = Math.abs(shipped - 1.25) < 0.15 || Math.abs(shipped - 1.54) < 0.15;
  if (!agree) {
    console.log('\n  *** UNTRUSTWORTHY AS A CALIBRATION: the analytic model says the slope should be');
    console.log('      BELOW 1.00 and the simulation says it is ABOVE. Those are not the same');
    console.log('      measurement disagreeing slightly; they disagree in direction.');
    console.log('      Read the two-regressor fit above before changing any coefficient.');
  }

  const best = scored[0];
  const family = best.h < PARK_COEFFICIENTS.runWeights.hr / 2 ? 'A (remove the double count)' : 'B (keep the term)';
  console.log(`\n  NOMINATED: runWeights.hr = ${best.h.toFixed(2)}, predicted slope ${best.slope.toFixed(4)}`);
  console.log(`  That is family ${family}.`);
  console.log('\n  NOTHING HERE SHIPS WITHOUT checkParkWiring RE-MEASURING THE SLOPE ON SEASONS.\n');
};

main();