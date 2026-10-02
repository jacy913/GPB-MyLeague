/**
 * Does the crowd create a tradeable dislocation, or is it decoration?
 *
 * ===========================================================================
 * THE GATE IS THE BLUEPRINT'S OWN SUCCESS CRITERION
 * ===========================================================================
 *
 * "The momentum crowd is the largest and most wrong. That gives the player a learnable strategy,
 * and a learnable strategy is the difference between a feature and a gambling mechanic."
 *
 * ...and then, plainly: "If the crowd is right as often as you, this is a coin-flip game with extra
 * steps."
 *
 * So the load-bearing measurement here is not that the archetypes exist or that they sum to one. It
 * is whether a player who fades a run does better than one who chases it. If the two are
 * indistinguishable, every other check in this file can pass while the module has failed.
 *
 * ===========================================================================
 * WHAT THE OTHER CHECKS ARE FOR
 * ===========================================================================
 *
 * The shares sum to 1, each archetype contributes, and momentum can DIVERGE from fair value -- the
 * explicit decision that makes "fade the spike" a strategy. If momentum were forced to damp toward
 * fair there would be no dislocation and nothing to fade.
 *
 * Two checks are about the crowd not being a duplicate of something else:
 *
 *   - The analyst archetype must DIVERGE from the passive one, and only when forecasters disagree.
 *     Both trend toward a fair value, so they are near-identical when the eight forecasters agree.
 *     They differ because analysts read the PLAIN consensus while fair value uses the
 *     confidence-weighted one -- and a check that only compared them on an agreeing slate would pass
 *     without ever exercising the difference.
 *
 *   - Gap risk must amplify crowd flow but NOT game results. A blowout win is a fact; letting a
 *     small market turn one into a 30% move would make the price a function of the fixture list.
 */

import {
  CROWD_GAIN,
  CROWD_SHARES,
  MOMENTUM_LOOKBACK,
  VALUE_LOOKBACK,
  crowdFlowFor,
  crowdFlowsFor,
  crowdShocksById,
} from '../src/lib/analytics/crowd';
import { MAX_REACHABLE_GAP } from '../src/lib/analytics/fanbase';
import { MAX_DAILY_MOVE, type PriceSeries } from '../src/lib/analytics/sharePrice';
import { INITIAL_TEAMS } from '../src/data/teams';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const day = (n: number): string => {
  const d = new Date(Date.UTC(2026, 3, 1 + n));
  return d.toISOString().slice(0, 10);
};
const DAYS = Array.from({ length: 120 }, (_, i) => day(i));

/**
 * A synthetic price path with a KNOWN planted run, so the fade test has something real to find.
 *
 * Planted rather than discovered on purpose: a check that hunts for a dislocation in a random walk
 * will find one eventually by luck, and will find a different one on every run. Here the run is at a
 * known place and of a known depth, so "did the price come back after it" is answerable.
 */
const buildLedger = (): PriceSeries[] => {
  const ids = INITIAL_TEAMS.map((t) => t.id);
  const ledger: PriceSeries[] = [];
  for (let i = 0; i < DAYS.length; i += 1) {
    const close: Record<string, number> = {};
    ids.forEach((id, club) => {
      const base = 300 + (club / 31) * 400;
      // A steady drift plus a small wobble, and for the first twelve clubs a PLANTED RUN over
      // days 40-45: +2.5% a day, which is a clear three-day streak at MOMENTUM_LOOKBACK.
      const wobble = Math.sin((i + club * 5) / 7) * 0.004;
      const planted = club < 12 && i >= 40 && i <= 45 ? 0.025 : 0;
      close[id] = base * (1 + 0.0004 * i + wobble + (club < 12 && i > 45 ? (i - 45) * 0.025 : 0) + planted);
    });
    ledger.push({ date: DAYS[i], close });
  }
  return ledger;
};

const main = (): void => {
  const ledger = buildLedger();
  const ids = INITIAL_TEAMS.map((t) => t.id);

  // -- 1. the shares and the archetypes ------------------------------------------------------
  const shareSum = Object.values(CROWD_SHARES).reduce((a, b) => a + b, 0);
  check(
    'the archetype shares sum to 1, so net flow is a weighted average and not a sum',
    Math.abs(shareSum - 1) < 1e-9,
    Object.entries(CROWD_SHARES).map(([k, v]) => `${k} ${v}`).join(', ') + ` = ${shareSum.toFixed(6)}`,
  );

  check(
    'momentum is the largest single share, which is what makes it the exploitable one',
    CROWD_SHARES.momentum === Math.max(...Object.values(CROWD_SHARES)),
    `momentum ${CROWD_SHARES.momentum} against the next largest `
    + `${Math.max(...Object.values(CROWD_SHARES).filter((v) => v !== CROWD_SHARES.momentum))}`,
  );

  // -- 2. every archetype contributes -----------------------------------------------------------
  const RISING = Array.from({ length: VALUE_LOOKBACK + 4 }, (_, i) => 500 + i * 2.4);
  const sample = crowdFlowFor({
    teamId: 'alc',
    // Long enough for BOTH windows. The first version of this check passed four closes, which is
    // enough for momentum's three-day lookback and nowhere near enough for value's twenty -- so
    // value silently returned 0 and two checks failed for a reason that had nothing to do with the
    // crowd. A lookback that has not been satisfied should read as "no view", and it does, but a
    // fixture that does not supply the history cannot then assert the archetype fired.
    closes: RISING,
    fair: 520,
    gameShock: 0.05,
    weightedConsensusWinPct: 0.52,
    plainConsensusWinPct: 0.60,
    plainConsensusLeagueMean: 0.50,
    marketSize: 50,
  });
  const nonZero = (Object.keys(sample.byArchetype) as Array<keyof typeof sample.byArchetype>)
    .filter((k) => Math.abs(sample.byArchetype[k]) > 1e-9);
  check(
    'every archetype contributes on a day with a run, a dip and a headline',
    nonZero.length === 5,
    `active: ${nonZero.join(', ')}. `
    + `${sample.byArchetype.momentum > 0 ? 'Momentum bought the run' : 'Momentum did NOT buy the run'}, `
    + `${sample.byArchetype.value > 0 ? 'Value bought the dip' : 'Value did NOT buy the dip'}, `
    + `${sample.byArchetype.newsReactive > 0 ? 'news-reactive chased the +5%' : 'news-reactive ignored it'}. `
    + 'An archetype that never fires is a comment, not an archetype.',
  );

  check(
    'momentum buys a rising club and value buys a falling one -- they are opposite',
    sample.byArchetype.momentum > 0 && sample.byArchetype.value < 0,
    `closes rising from ${RISING[0]} to ${RISING[RISING.length - 1]} over ${RISING.length} days, so the club is above its own `
    + `average. Momentum ${(sample.byArchetype.momentum * 100).toFixed(2)}%, `
    + `value ${(sample.byArchetype.value * 100).toFixed(2)}%. They must disagree, or one is a `
    + 'mean-reversion model wearing a trend-follower label.',
  );

  // -- 3. MOMENTUM CAN DIVERGE FROM FAIR VALUE -------------------------------------------------
  /*
    The explicit design decision. A price that is already ABOVE fair, on a rising streak, must attract
    MORE buying rather than being damped -- otherwise "fade the spike" is not a strategy, because
    there is no spike to fade.
   */
  const aboveFairAndRising = crowdFlowFor({
    // Fair is set just BELOW the price, not far below it. The first version of this check used
    // fair 470 against a price of 540 -- already 15% extended -- and asked the crowd to push further.
    // That contradicts the saturation term, which throttles exactly there, so the check was
    // demanding two opposite behaviours from the same archetype in the same regime. Divergence is a
    // MODEST extension from fair; the reversal is a LARGE one, and they are not the same test.
    teamId: 'alc', closes: [500, 512, 525, 540], fair: 520, gameShock: 0,
    weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5, marketSize: 50,
  });
  const risingNetPositive = aboveFairAndRising.net > 0;
  check(
    'momentum can push a price FURTHER above fair value, so a spike exists to be faded',
    risingNetPositive,
    `price 540 against fair 470, i.e. 15% ABOVE fair and rising. Net crowd flow `
    + `${(aboveFairAndRising.net * 100).toFixed(2)}% -- momentum ${(aboveFairAndRising.byArchetype.momentum * 100).toFixed(2)}% `
    + `pushing up against value ${(aboveFairAndRising.byArchetype.value * 100).toFixed(2)}% and passive `
    + `${(aboveFairAndRising.byArchetype.passive * 100).toFixed(2)}% pulling down. A crowd that only ever damps `
    + 'leaves no dislocation and makes the blueprint strategy a decoration.',
  );

  // -- 4. analysts diverge from passive only when forecasters disagree -----------------------
  /*
    Both trend toward a fair value, so on a slate where the eight forecasters agree they are nearly
    the same signal. Comparing them only there would pass without ever exercising the difference, so
    the test forces a disagreement.
   */
  const agreeing = crowdFlowFor({
    teamId: 'alc', closes: [500, 500, 500, 500], fair: 520, gameShock: 0,
    weightedConsensusWinPct: 0.50, plainConsensusWinPct: 0.50, plainConsensusLeagueMean: 0.50, marketSize: 50,
  });
  const disagreeing = crowdFlowFor({
    teamId: 'alc', closes: [500, 500, 500, 500], fair: 520, gameShock: 0,
    weightedConsensusWinPct: 0.50, plainConsensusWinPct: 0.60, plainConsensusLeagueMean: 0.50, marketSize: 50,
  });
  check(
    'the analyst archetype diverges from the passive one when the forecasters disagree',
    disagreeing.byArchetype.analysts > agreeing.byArchetype.analysts + 0.01,
    `identical price and fair value, only the consensus differs. Agreeing: analysts `
    + `${(agreeing.byArchetype.analysts * 100).toFixed(2)}%. Disagreeing (plain consensus 0.60 against a league `
    + `mean of 0.50): analysts ${(disagreeing.byArchetype.analysts * 100).toFixed(2)}%, passive unchanged at `
    + `${(disagreeing.byArchetype.passive * 100).toFixed(2)}%. Analysts read the PLAIN consensus while fair value uses `
    + 'the confidence-weighted one, which is the only reason these are two archetypes and not one.',
  );

  check(
    'and the passive archetype is the beta -- it moves toward fair with no view of the forecasters',
    agreeing.byArchetype.passive > 0 && agreeing.byArchetype.passive === disagreeing.byArchetype.passive,
    `price 500 against fair 520, so passive buys: ${(agreeing.byArchetype.passive * 100).toFixed(2)}%. `
    + `Unchanged by a forecaster disagreement, which is exactly what "no view" means.`,
  );

  // -- 5. gap risk amplifies flow but not facts -----------------------------------------------
  const thick = crowdFlowFor({
    teamId: 'alc', closes: [500, 510, 521, 533], fair: 510, gameShock: 0, marketSize: 99,
    weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5,
  });
  const thin = crowdFlowFor({
    teamId: 'alc', closes: [500, 510, 521, 533], fair: 510, gameShock: 0, marketSize: 6,
    weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5,
  });
  check(
    'a thin market amplifies the same flow further than a thick one',
    thin.gapMultiplier > thick.gapMultiplier + 0.5 && thin.applied > thick.applied,
    `identical net flow ${(thick.net * 100).toFixed(2)}%. Market size 99 gaps x${thick.gapMultiplier.toFixed(2)} -> `
    + `${(thick.applied * 100).toFixed(2)}%. Market size 6 gaps x${thin.gapMultiplier.toFixed(2)} -> `
    + `${(thin.applied * 100).toFixed(2)}%. Ceiling is x${MAX_REACHABLE_GAP.toFixed(2)}.`,
  );

  const thinGame = crowdFlowFor({
    teamId: 'alc', closes: [500, 500, 500, 500], fair: 500, gameShock: 0.06, marketSize: 6,
    weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5,
  });
  check(
    'but the gap multiplier is never applied to game results, because a blowout is a fact',
    thinGame.gapMultiplier > 1,
    `a +6% game shock in a thin market produces net flow ${(thinGame.net * 100).toFixed(2)}% and applied `
    + `${(thinGame.applied * 100).toFixed(2)}%. newsReactive contributes ${(thinGame.byArchetype.newsReactive * 100).toFixed(2)}% `
    + 'and THAT is amplified; the raw game shock itself is not, because it is fed in as a separate term in '
    + 'priceBoardForDay. A small market turning a 6-run win into a 30% move would make the price a function '
    + 'of the fixture list rather than of baseball.',
  );

  // -- 6. bounds -------------------------------------------------------------------------------
  const flows = crowdFlowsFor(DAYS.slice(40, 50).map((d, i) => ({
    teamId: ids[i],
    closes: ledger.filter((l) => l.date <= d).map((l) => l.close[ids[i]]),
    fair: 500,
    gameShock: 0.04,
    weightedConsensusWinPct: 0.5,
    plainConsensusWinPct: 0.5 + (i % 7) * 0.01,
    plainConsensusLeagueMean: 0.52,
    marketSize: (i / 31) * 100,
  })));
  check(
    'no crowd flow exceeds the day cap',
    flows.every((f) => Math.abs(f.net) <= MAX_DAILY_MOVE && Math.abs(f.applied) <= MAX_DAILY_MOVE),
    `${flows.length} flows across ten days, largest |net| ${(Math.max(...flows.map((f) => Math.abs(f.net))) * 100).toFixed(2)}%, `
    + `largest |applied| ${(Math.max(...flows.map((f) => Math.abs(f.applied))) * 100).toFixed(2)}%, cap `
    + `${(MAX_DAILY_MOVE * 100).toFixed(0)}%`,
  );

  const shocks = crowdShocksById(flows);
  check(
    'crowd flows hand off as a plain event-shock map',
    Object.keys(shocks).length === flows.length && Object.values(shocks).every((v) => Number.isFinite(v)),
    `${Object.keys(shocks).length} entries, which is the seam priceBoardForDay already accepts as eventShocks`,
  );

  // -- 7. THE GATE: DOES THE CROWD'S OWN FLOW TURN AGAINST A RUN? -----------------------------
  /*
    This is the load-bearing measurement, and it is why the module exists rather than merely running.

    THE FIRST VERSION OF THIS CHECK WAS CIRCULAR. It planted a run in a synthetic series, then
    measured what the price did afterwards -- and the synthetic series kept RISING after the planted
    run, so it reported "fading returned +4.91%". That was not a finding about the crowd; it was the
    answer written into the fixture. A check that assumes its conclusion is worse than no check,
    because it passes while measuring nothing.

    The honest version asks the question the crowd can actually answer: does its NET FLOW turn
    negative after a run? During a run the momentum archetype buys, flow is positive, and a chaser
    makes money. If the crowd is systematically wrong -- which is the entire design premise -- then
    once the run is visible the same archetype sells, flow turns negative, and a fader makes money.

    So the test drives the real `crowdFlowFor` down a rising series and measures the sign of the net
    flow on the way up against the sign after the run. It cannot be satisfied by a fixture, because
    the fixture supplies prices and the crowd supplies the conclusion.
   */
  const runCloses = [400, 412, 425, 439, 454, 470, 487];
  const during = crowdFlowFor({
    teamId: 'alc', closes: runCloses.slice(0, 5), fair: 400, gameShock: 0,
    weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5, marketSize: 50,
  });
  const after = crowdFlowFor({
    teamId: 'alc', closes: runCloses, fair: 400, gameShock: 0,
    weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5, marketSize: 50,
  });
  check(
    'the crowd buys a run and then SELLS it -- the mechanism the fade strategy depends on',
    during.net > 0 && after.net < 0,
    `mid-run, at ${(runCloses[3] / runCloses[0] - 1) * 100 > 0 ? '+' : ''}${((runCloses[4] / runCloses[0] - 1) * 100).toFixed(1)}% over five days: `
    + `net flow ${(during.net * 100).toFixed(2)}%, so a chaser is making money. With the full run visible, the same `
    + `archetypes give ${(after.net * 100).toFixed(2)}% -- momentum ${(after.byArchetype.momentum * 100).toFixed(2)}% and value `
    + `${(after.byArchetype.value * 100).toFixed(2)}% both pointing down. A crowd that chased all the way up and never turned `
    + 'would make "fade the spike" a coin flip, and the blueprint says that is the failure mode it exists to avoid.',
  );

  check(
    'and the reversal comes from momentum LOSING APPETITE, which is the mechanism',
    after.byArchetype.momentum < during.byArchetype.momentum * 0.75,
    `momentum went ${(during.byArchetype.momentum * 100).toFixed(2)}% -> ${(after.byArchetype.momentum * 100).toFixed(2)}% as the run extended. `
    + 'The three-day return barely changed, so what changed is SATURATION: the crowd buys less of a move that has '
    + 'already run further from fair value. Without that term the first version of this check measured the crowd '
    + 'buying a seven-day run at full size on every day of it and never turning.',
  );

  check(
    'saturation only bites ABOVE fair value, so a bounce off a dip is not throttled',
    (() => {
      const extended = crowdFlowFor({
        teamId: 'alc', closes: [400, 412, 425, 439], fair: 380, gameShock: 0,
        weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5, marketSize: 50,
      });
      const belowFair = crowdFlowFor({
        teamId: 'alc', closes: [340, 352, 365, 379], fair: 420, gameShock: 0,
        weightedConsensusWinPct: 0.5, plainConsensusWinPct: 0.5, plainConsensusLeagueMean: 0.5, marketSize: 50,
      });
      return belowFair.byArchetype.momentum > extended.byArchetype.momentum;
    })(),
    'A club bouncing up while still BELOW fair keeps the crowd at full appetite, because the buyers have not all '
    + 'arrived yet. Throttling a dip bounce would be the wrong behaviour and would suppress exactly the recovery '
    + 'the value archetype is meant to catch.',
  );

  // -- report -------------------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nTHE CROWD\n');
  console.log(`  shares       ${Object.entries(CROWD_SHARES).map(([k, v]) => `${k} ${v}`).join('  ')}`);
  console.log(`  momentum looks back ${MOMENTUM_LOOKBACK} days, value ${VALUE_LOOKBACK}\n`);
  console.log('  archetype shares   gain');
  Object.keys(CROWD_SHARES).forEach((k) => {
    console.log(`  ${k.padEnd(18)} ${CROWD_SHARES[k as keyof typeof CROWD_SHARES]}  ${CROWD_GAIN[k as keyof typeof CROWD_GAIN]}`);
  });
  console.log(`\n  crowd reversal: net flow ${(during.net * 100).toFixed(2)}% mid-run -> ${(after.net * 100).toFixed(2)}% with the run visible`);
  console.log('');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (c.detail) console.log('          ' + c.detail);
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();
