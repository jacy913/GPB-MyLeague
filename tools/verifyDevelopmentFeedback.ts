/**
 * Is it safe to let measured performance move player development?
 *
 * Player development already contains a positive feedback loop: a higher rating
 * makes the top nine, the top nine earns plate appearances, and `getUsageMultiplier`
 * scales development by playing time. Wiring wRC+ in adds a SECOND loop --
 * performance moves the rating, which feeds the first. Two positive loops in series
 * is the shape that turns a league into a permanent hierarchy, where a dynasty is
 * decided in year one and never contested again.
 *
 * So the question is not "does the feedback make players better". It is "does it make
 * the league STRATIFY", and the answer has to be measured over enough seasons to see
 * a drift rather than a wobble.
 *
 * HOW THE EXPERIMENT IS CONTROLLED, which is the part that needed care.
 *
 * A season is NOT reproducible from its universe seed: `generateSchedule` shuffles
 * dates with an unseeded `Math.random` (`simulation.ts:193-200`), so two runs at the
 * same seed are two different leagues. Comparing a baseline run against a feedback run
 * therefore confounds the gain with schedule noise, and the noise is not small --
 * league wOBA alone varies about 5% run to run.
 *
 * Two things address that:
 *
 *   1. THE EFFECT IS ATTRIBUTED EXACTLY, NOT INFERRED. Each leagueLab run calls
 *      `applyPlayerDevelopment` twice on the same input state, once at the run's gain
 *      and once at zero. Everything the two disagree on is caused by the performance
 *      signal, with no schedule term in it at all. That is what makes the liveness
 *      check exact rather than statistical.
 *   2. COMPRESSION IS COMPARED AS A DRIFT AGAINST THE BASELINE'S OWN DRIFT. The
 *      no-feedback league is not flat -- measured, its p90/p50 spread ratio climbs on
 *      its own -- so "the ratio went up" proves nothing. What matters is whether the
 *      feedback's drift exceeds the baseline's by more than run-to-run variation.
 *
 * The liveness check is not optional bookkeeping. Every compression statistic here
 * describes a league, so an INERT wiring would pass all of them while doing nothing.
 * An earlier gain of 0.15 did exactly that: it moved the league by 0.0163 rating
 * points, which reads as a healthy, stable league. A pass is only meaningful next to a
 * number proving the signal is actually reaching the ratings.
 *
 * Run: npx tsx tools/verifyDevelopmentFeedback.ts [seasons] [seed]
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PERFORMANCE_GAIN } from '../src/logic/playerDevelopment';

const SEASONS = Number(process.argv[2] ?? 12);
const SEED = Number(process.argv[3] ?? 4242);

/**
 * The gain the module actually ships.
 *
 * Imported rather than passed in, so the proof covers the constant that ships. A
 * sweep that measured gains the code does not use would be a study, not a check.
 */
const SHIPPED_GAIN = PERFORMANCE_GAIN;

/**
 * Gains to compare. 0 is the baseline; the rest bracket the shipped gain so the
 * sweep shows whether compression degrades gradually or falls off a cliff, which is
 * the difference between picking a gain by measurement and picking one by hope.
 */
const GAINS = [0, 1, 2.5, 5];

/**
 * How many times to run the no-feedback baseline.
 *
 * THIS IS THE PART THAT MAKES THE OTHER NUMBERS MEANINGFUL. Because the schedule is
 * unseeded, two runs at the same seed are two different leagues, so a single
 * baseline drift is one sample of a noisy quantity. Comparing a feedback run's drift
 * against a single baseline number would be comparing a measurement to noise and
 * calling the difference "stratification".
 *
 * Three replicates give a spread to compare against, and the checks below require
 * the feedback's excess drift to clear that spread rather than merely exceed zero.
 * Without this the stratification check is decorative.
 */
const BASELINE_REPLICATES = 3;

interface Talent {
  year: number;
  batterCount: number;
  batterMean: number;
  batterSd: number;
  batterP50: number;
  batterP90: number;
  batterP99: number;
  batterSpreadRatio: number;
  pitcherCount: number;
  pitcherMean: number;
  batterPitcherGap: number;
}

interface FeedbackEffect {
  year: number;
  gain: number;
  playersCompared: number;
  meanShift: number;
  meanAbsoluteShift: number;
  maxAbsoluteShift: number;
  playersMoved: number;
}

interface Snapshot {
  seasons: number;
  seed: number;
  performanceGain: number;
  talent: Talent[];
  feedbackEffects: FeedbackEffect[];
}

interface Check {
  label: string;
  pass: boolean;
  measured: string;
}

const results: Check[] = [];
const failures: string[] = [];

/**
 * `measured` is what the tool actually observed and is always what gets reported.
 * `why` is prose explaining the failure and is only surfaced when the check fails,
 * so a passing run never prints a reason it did not need.
 */
const check = (label: string, pass: boolean, measured: string, why?: string): void => {
  results.push({ label, pass, measured: pass ? measured : (why ?? `FAILED, observed: ${measured}`) });
  if (!pass) {
    failures.push(`${label}: ${why ?? measured}`);
  }
};

/**
 * The tsx launcher, invoked by absolute path.
 *
 * Not `npx`. On Windows `npx` is a `.cmd` shim, and `execFileSync` cannot spawn one
 * without a shell -- which fails with a bare `spawnSync npx ENOENT`. Resolving the
 * local binary also removes a PATH dependency, so the verifier runs the same way on
 * a machine where npx has never been configured.
 */
const TSX_BIN = join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);

const runLab = (gain: number, outDir: string): Snapshot => {
  const jsonPath = join(outDir, `gain-${gain}.json`);
  execFileSync(
    TSX_BIN,
    [
      'tools/leagueLab.ts',
      `--seasons=${SEASONS}`,
      `--seed=${SEED}`,
      '--granularity=season',
      '--no-market',
      '--quiet',
      `--performance-gain=${gain}`,
      `--snapshot-json=${jsonPath}`,
    ],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  return JSON.parse(readFileSync(jsonPath, 'utf8')) as Snapshot;
};

/** Least-squares slope of y against x, the drift per season. */
const slopePerSeason = (points: Array<[number, number]>): number => {
  if (points.length < 2) return NaN;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0;
  let varX = 0;
  points.forEach(([x, y]) => {
    cov += (x - mx) * (y - my);
    varX += (x - mx) ** 2;
  });
  return varX > 0 ? cov / varX : NaN;
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const stdev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
};

const last = <T,>(items: T[]): T => items[items.length - 1];

const main = (): void => {
  console.log(`Verifying performance feedback over ${SEASONS} seasons at seed ${SEED}.`);
  console.log(`Gains compared: ${GAINS.join(', ')}\n`);
  console.log('A season is not reproducible from its seed (the schedule is unseeded), so');
  console.log('compression is judged as DRIFT RELATIVE TO THE BASELINE, not against zero.\n');

  const outDir = mkdtempSync(join(tmpdir(), 'gpb-feedback-'));
  try {
    const snapshots = new Map<number, Snapshot>();
    // Baseline replicates first, so the noise floor is known before any feedback run
    // is compared against it.
    const baselineRuns: Snapshot[] = [];
    for (let replicate = 0; replicate < BASELINE_REPLICATES; replicate += 1) {
      process.stdout.write(`  running baseline ${replicate + 1}/${BASELINE_REPLICATES}... `);
      const started = Date.now();
      baselineRuns.push(runLab(0, outDir));
      console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
    }
    snapshots.set(0, baselineRuns[0]);

    GAINS.filter((gain) => gain > 0).forEach((gain) => {
      process.stdout.write(`  running gain ${gain}... `);
      const started = Date.now();
      snapshots.set(gain, runLab(gain, outDir));
      console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
    });

    const driftOf = (snapshot: Snapshot): number =>
      slopePerSeason(snapshot.talent.map((t) => [t.year, t.batterSpreadRatio] as [number, number]));
    const gapDriftOf = (snapshot: Snapshot): number =>
      slopePerSeason(snapshot.talent.map((t) => [t.year, t.batterPitcherGap] as [number, number]));
    const meanDriftOf = (snapshot: Snapshot): number =>
      slopePerSeason(snapshot.talent.map((t) => [t.year, t.batterMean] as [number, number]));

    const baseline = baselineRuns[0];
    const baselineDrifts = baselineRuns.map(driftOf);
    const baselineDrift = mean(baselineDrifts);
    const baselineSpread = stdev(baselineDrifts);
    /**
     * How much excess drift is required before a feedback run counts as stratifying.
     *
     * Two baseline standard deviations, floored so a freakishly tight set of
     * replicates cannot make the bar vanish. Without the floor this threshold would
     * collapse to nearly zero on a lucky seed and the check would start failing on
     * noise.
     */
    const stratificationBar = Math.max(baselineSpread * 2, 0.0004);

    console.log('\nTHE NOISE FLOOR, FROM REPLICATED BASELINES');
    console.log(`  baseline p90/p50 drift per season: ${baselineDrifts.map((d) => d.toFixed(5)).join(', ')}`);
    console.log(`  mean ${baselineDrift.toFixed(5)}   sd ${baselineSpread.toFixed(5)}`);
    console.log(`  a feedback run must add more than ${stratificationBar.toFixed(5)}/season to count as stratifying`);
    console.log('  The schedule is unseeded, so a single baseline drift is one sample of a noisy');
    console.log('  quantity. Comparing against one run would compare a measurement to noise.');

    console.log('\nCOMPRESSION BY GAIN');
    console.log('  gain  meanEffect  playersMoved  spreadDrift/yr   excess     gapDrift   batterMean');
    const rows: Array<{ gain: number; drift: number; effect: number; moved: number }> = [];
    GAINS.filter((gain) => gain > 0).forEach((gain) => {
      const snapshot = snapshots.get(gain)!;
      const drift = driftOf(snapshot);
      const gapDrift = gapDriftOf(snapshot);
      const effects = snapshot.feedbackEffects;
      const effect = effects.length > 0
        ? effects.reduce((s, e) => s + e.meanAbsoluteShift, 0) / effects.length
        : 0;
      const moved = effects.length > 0
        ? effects.reduce((s, e) => s + e.playersMoved, 0) / effects.length
        : 0;
      const excess = drift - baselineDrift;
      rows.push({ gain, drift, effect, moved });
      console.log(
        `  ${String(gain).padStart(4)}` +
          `${effect.toFixed(4).padStart(12)}` +
          `${moved.toFixed(0).padStart(14)}` +
          `${drift.toFixed(5).padStart(16)}` +
          `${(excess >= 0 ? '+' : '') + excess.toFixed(5)}`.padStart(11) +
          `${gapDrift.toFixed(4).padStart(11)}` +
          `${last(snapshot.talent).batterMean.toFixed(2).padStart(13)}`,
      );
    });

    console.log('\n  baseline itself:');
    console.log(
      `     0  ${(0).toFixed(4).padStart(12)}${(0).toFixed(0).padStart(14)}` +
        `${baselineDrift.toFixed(5).padStart(16)}${'+0.00000'.padStart(11)}` +
        `${gapDriftOf(baseline).toFixed(4).padStart(11)}` +
        `${last(baseline.talent).batterMean.toFixed(2).padStart(13)}`,
    );
    console.log('  The no-feedback league already drifts; the question is whether the feedback');
    console.log('  adds more than the baseline spread, not whether any drift exists.');

    // -------------------------------------------------- liveness
    const feedbackRuns = rows.filter((row) => row.gain > 0);
    const mostActive = feedbackRuns.reduce((best, row) => (row.effect > best.effect ? row : best), feedbackRuns[0]);
    check(
      'the feedback actually moves ratings',
      mostActive.effect > 0.05,
      `strongest gain ${mostActive.gain} moves a batter by ${mostActive.effect.toFixed(4)} rating points on average, ${mostActive.moved.toFixed(0)} players moved per season`,
      `even the strongest gain tested (${mostActive.gain}) moved ratings by only ` +
        `${mostActive.effect.toFixed(4)} points, below the 0.05 needed to clear integer ` +
        `rounding. Every compression check below would then describe a league the ` +
        `feedback never touched, and a "safe" verdict would be meaningless`,
    );

    // -------------------------------------------------- compression
    const worstExcess = feedbackRuns.reduce((worst, row) => Math.max(worst, row.drift - baselineDrift), -Infinity);
    check(
      'feedback does not materially increase league stratification',
      worstExcess < stratificationBar,
      `worst excess spread drift across gains ${worstExcess.toFixed(5)}/season, against a bar of ${stratificationBar.toFixed(5)} from the baseline spread (sd ${baselineSpread.toFixed(5)})`,
      `the worst gain added ${worstExcess.toFixed(5)} per season of spread drift on top of ` +
        `the baseline's ${baselineDrift.toFixed(5)}, which clears the ${stratificationBar.toFixed(5)} ` +
        `bar set by the baseline's own run-to-run spread. That is the league stratifying ` +
        `rather than a healthy league carrying feedback`,
    );

    // -------------------------------------------------- level stability
    const worstMeanDrift = feedbackRuns.reduce((worst, row) => {
      const snapshot = snapshots.get(row.gain)!;
      return Math.max(worst, Math.abs(meanDriftOf(snapshot)));
    }, 0);
    const baselineMeanDrifts = baselineRuns.map((run) => Math.abs(meanDriftOf(run)));
    const baselineMeanDrift = mean(baselineMeanDrifts);
    check(
      'league talent level stays put',
      worstMeanDrift < baselineMeanDrift + stdev(baselineMeanDrifts) + 0.02,
      `worst batter-mean drift ${worstMeanDrift.toFixed(4)}/season against a baseline of ${baselineMeanDrift.toFixed(4)}/season`,
      `batter talent drifted ${worstMeanDrift.toFixed(4)} points per season, beyond the ` +
        `baseline's ${baselineMeanDrift.toFixed(4)} plus its spread. A feedback signal that ` +
        `raises or lowers the whole league is not rewarding performance, it is inflating ratings`,
    );

    // -------------------------------------------------- batter/pitcher balance
    //
    // The signal is batter-side only because there is no pitching wRC+ to feed it.
    // That asymmetry could tilt the two halves of the league apart, and nothing else
    // in this tool would show it.
    const worstGapDrift = feedbackRuns.reduce((worst, row) => {
      const snapshot = snapshots.get(row.gain)!;
      return Math.max(worst, Math.abs(gapDriftOf(snapshot)));
    }, 0);
    const baselineGapDrifts = baselineRuns.map((run) => Math.abs(gapDriftOf(run)));
    const baselineGapDrift = mean(baselineGapDrifts);
    check(
      'batter and pitcher talent stay balanced',
      worstGapDrift < baselineGapDrift + stdev(baselineGapDrifts) + 0.02,
      `worst batter-pitcher gap drift ${worstGapDrift.toFixed(4)}/season against a baseline of ${baselineGapDrift.toFixed(4)}/season`,
      `the batter-pitcher gap drifted ${worstGapDrift.toFixed(4)} per season against a ` +
        `baseline of ${baselineGapDrift.toFixed(4)} plus its spread. The feedback is ` +
        `batter-side only, so this is where an asymmetry would show up`,
    );

    // -------------------------------------------------- centring
    //
    // Measured as a RATIO, not as a raw signed shift. The additive form's expectation
    // is gain * (mean wRC+ - 100), and the mean wRC+ over PLAYERS is not exactly 100
    // even though the pooled plate-appearance-weighted mean is. So a small residual
    // bias is expected; what matters is whether it is a small share of the movement
    // the signal actually produces.
    //
    // The first version of this check took the maximum absolute per-season shift
    // across every gain. That is a maximum over 36 noisy samples, so it is biased
    // upward by construction and reported a ratchet that the mean does not show.
    const allEffects = GAINS.filter((g) => g > 0).flatMap((g) => snapshots.get(g)!.feedbackEffects);
    const meanSigned = allEffects.length > 0
      ? allEffects.reduce((s, e) => s + e.meanShift, 0) / allEffects.length
      : 0;
    const meanAbsolute = allEffects.length > 0
      ? allEffects.reduce((s, e) => s + e.meanAbsoluteShift, 0) / allEffects.length
      : 0;
    const biasRatio = meanAbsolute > 0 ? Math.abs(meanSigned) / meanAbsolute : 0;
    check(
      'the feedback is centred, not a one-way ratchet',
      biasRatio < 0.35,
      `mean signed shift ${meanSigned.toFixed(4)} against a mean absolute ${meanAbsolute.toFixed(4)}, a bias ratio of ${biasRatio.toFixed(3)} across ${allEffects.length} season-gain samples`,
      `the feedback's mean signed shift is ${meanSigned.toFixed(4)} against a mean ` +
        `absolute movement of ${meanAbsolute.toFixed(4)}, a bias ratio of ` +
        `${biasRatio.toFixed(3)}. wRC+ is centred on 100, so a large ratio means the ` +
        `signal is one-directional and would compound every season`,
    );

    const shippedRowForPower = rows.find((row) => row.gain === SHIPPED_GAIN);

    // -------------------------------------------------- POWER OF THE EXPERIMENT ITSELF
    //
    // The check that matters most, and the one whose absence would make every clean
    // pass above misleading.
    //
    // The stratification check can only fail if the feedback moves the spread by more
    // than the noise floor. At the shipped gain the measured excess is a small
    // fraction of the bar -- which means the check passes because there is too little
    // feedback to detect, not because feedback at a useful strength was shown to be
    // safe.
    //
    // "No harm detected at a dose too small to do harm" is a much weaker claim than
    // "the feedback is proven safe", and reporting the first as the second is the
    // exact failure this project has produced repeatedly. So the shortfall is
    // measured and reported: the largest gain whose league-level signature clears the
    // noise floor is compared against the shipped one, and if the shipped gain is far
    // below it, the tool says the proof is out of reach rather than reporting a pass
    // that means nothing.
    const resolvable = feedbackRuns.filter((row) => row.drift - baselineDrift > baselineSpread);
    const strongestResolvable = resolvable.reduce(
      (best, row) => (best === null || row.effect > best.effect ? row : best),
      null as typeof feedbackRuns[number] | null,
    );
    const shippedEffect = shippedRowForPower?.effect ?? 0;
    const proofOutOfReach = strongestResolvable === null
      || strongestResolvable.effect > shippedEffect * 2.5;

    console.log('\nPOWER OF THIS EXPERIMENT');
    console.log(`  noise floor on spread drift: sd ${baselineSpread.toFixed(5)}/season`);
    console.log(
      `  gains whose league-level signature clears it: ` +
        `${resolvable.length > 0 ? resolvable.map((r) => r.gain).join(', ') : 'none'}`,
    );
    console.log(
      `  shipped gain ${SHIPPED_GAIN} moves ratings by ${shippedEffect.toFixed(4)} points;` +
        `${strongestResolvable ? ` the largest effect resolvable above the noise floor is ${strongestResolvable.effect.toFixed(4)} at gain ${strongestResolvable.gain}` : ' nothing is'}`,
    );
    console.log(
      proofOutOfReach
        ? '  => the stratification check CANNOT fail at the shipped gain. It passes because'
        : '  => the shipped gain is inside the range this experiment can resolve.',
    );
    if (proofOutOfReach) {
      console.log('     the feedback is too weak to have a measurable league-level effect, not');
      console.log('     because it has been shown to be safe. Treat the passes above as evidence');
      console.log('     of no DETECTABLE harm, which is a materially weaker claim.');
    }

    /*
     * REPORTED, NOT ASSERTED, and the reason is worth stating.
     *
     * Whether this experiment can resolve the shipped gain depends entirely on the
     * noise floor, and the noise floor is estimated from three replicates. Across
     * invocations of this file that estimate came out at sd 0.00071, 0.00066, 0.00070,
     * 0.00110 and 0.00004 per season -- varying by more than an order of magnitude on
     * the same seed and the same season count.
     *
     * Three replicates cannot pin down a standard deviation that unstable, so any
     * pass/fail built on it would flip from run to run. A check that fails at random
     * is worse than no check, because it trains a reader to ignore it. So this is
     * printed as a standing caveat on every pass rather than asserted.
     *
     * The consequence is stated plainly in the output and in PHASE_HANDOVER.md: the
     * checks above establish NO DETECTABLE harm at the shipped gain. They do not
     * establish that the feedback is safe, and at this magnitude they could not have
     * established it either way.
     */
    console.log(
      proofOutOfReach
        ? '  STANDING CAVEAT: no gain tested produced a signature above the noise floor, so'
        : '  A gain did resolve above the noise floor; the caveat below still applies.',
    );
    if (proofOutOfReach) {
      console.log('  the stratification checks above cannot fail at this gain. They report no');
      console.log('  DETECTABLE harm, which is materially weaker than demonstrated safety.');
    }
    console.log(`  Baseline sd across ${BASELINE_REPLICATES} replicates: ${baselineSpread.toFixed(5)}/season,`);
    console.log('  which has ranged from 0.00004 to 0.00110 across invocations of this file. Power');
    console.log('  therefore cannot be asserted from it, and is reported instead of checked.');

    // -------------------------------------------------- the shipped gain
    //
    // Without this, the sweep is informative but nothing stops the constant in
    // playerDevelopment.ts from drifting away from what was measured. Reading the
    // shipped value out of the module rather than taking it as an argument is
    // deliberate: this is what catches someone tuning the gain by hand and not
    // re-running the proof.
    const shippedRow = rows.find((row) => row.gain === SHIPPED_GAIN);
    check(
      'the shipped gain was one of the gains tested',
      shippedRow !== undefined,
      shippedRow
        ? `PERFORMANCE_GAIN is ${SHIPPED_GAIN}, tested, effect ${shippedRow.effect.toFixed(4)} points, excess drift ${(shippedRow.drift - baselineDrift).toFixed(5)}/season`
        : `PERFORMANCE_GAIN is ${SHIPPED_GAIN} but the sweep tested ${GAINS.join(', ')}`,
      `the shipped PERFORMANCE_GAIN of ${SHIPPED_GAIN} is not in the tested set ` +
        `(${GAINS.join(', ')}), so the constant is not backed by this measurement`,
    );

    const shippedIsLive = shippedRow !== undefined && shippedRow.effect > 0.05;
    check(
      'the shipped gain is live rather than inert',
      shippedIsLive,
      shippedRow
        ? `shipped gain ${SHIPPED_GAIN} moves ${shippedRow.effect.toFixed(4)} rating points on average, ${shippedRow.moved.toFixed(0)} players moved per season`
        : 'no shipped-gain row to measure',
      `the shipped gain of ${SHIPPED_GAIN} moves ratings by ` +
        `${shippedRow?.effect.toFixed(4) ?? 'n/a'} points, which does not clear integer ` +
        `rounding. An inert feedback loop passes every compression check in this file ` +
        `while doing nothing at all`,
    );

    const shippedSafe = shippedRow !== undefined && (shippedRow.drift - baselineDrift) < stratificationBar;
    check(
      'the shipped gain does not stratify the league',
      shippedSafe,
      shippedRow
        ? `excess spread drift ${(shippedRow.drift - baselineDrift).toFixed(5)}/season against a bar of ${stratificationBar.toFixed(5)}`
        : 'no shipped-gain row to measure',
      `the shipped gain of ${SHIPPED_GAIN} adds ` +
        `${(shippedRow ? shippedRow.drift - baselineDrift : NaN).toFixed(5)} per season of ` +
        `spread drift, clearing the ${stratificationBar.toFixed(5)} bar set by the ` +
        `baseline's own run-to-run spread`,
    );

    console.log('\nMEASURED, PER GAIN');
    console.log('  gain   effect   moved   spread drift   gap drift   final mean   final p90/p50');
    // Gain 0 has no row in `rows` -- it has no feedback effect to summarise -- so it
    // is printed from the baseline directly. Reading it out of `rows` as though it
    // were there is exactly the kind of "the code says" failure this project keeps
    // hitting: every compression number would have been right and the table would
    // have thrown.
    GAINS.forEach((gain) => {
      const snapshot = snapshots.get(gain)!;
      const row = rows.find((r) => r.gain === gain);
      const effect = row?.effect ?? 0;
      const moved = row?.moved ?? 0;
      // Gain 0 has three runs and no feedback effect. Print the MEAN drift for it,
      // not run 1's, because the summary table above already prints the mean -- two
      // different numbers under the same "0" label is exactly the kind of thing that
      // makes a reader distrust a table they should be able to trust.
      const drift = gain === 0 ? baselineDrift : driftOf(snapshot);
      console.log(
        `  ${String(gain).padStart(4)}${effect.toFixed(4).padStart(9)}` +
          `${moved.toFixed(0).padStart(8)}${drift.toFixed(5).padStart(15)}` +
          `${gapDriftOf(snapshot).toFixed(4).padStart(12)}` +
          `${last(snapshot.talent).batterMean.toFixed(2).padStart(14)}` +
          `${last(snapshot.talent).batterSpreadRatio.toFixed(4).padStart(17)}`,
      );
    });
    console.log(`  gain 0's drift is the mean of ${BASELINE_REPLICATES} replicates; its gap drift and`);
    console.log('  final columns are from replicate 1, which is the run the rows above use.');

    console.log('\nWHAT THIS DID NOT ESTABLISH');
    console.log('  - One seed. The baseline is replicated so the noise floor is a measured');
    console.log('    spread rather than an assumption, but three replicates characterise a');
    console.log('    distribution only coarsely.');
    console.log('  - The gain that passes here is the largest that survives THIS many seasons.');
    console.log('    A league that stays compressed over a dozen years can still stratify over');
    console.log('    a hundred, and no run here would show it.');
    console.log('  - Nothing here measures whether the feedback makes the simulation more');
    console.log('    believable to a manager. Compression is a safety property, not a proof');
    console.log('    that performance should compound at all.');

    console.log('\nCHECKS');
    results.forEach((entry, index) => {
      console.log(`  ${entry.pass ? 'PASS' : 'FAIL'}  ${String(index + 1).padStart(2)}. ${entry.label}`);
      console.log(`          ${entry.measured}`);
    });

    console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks PASS`);
    if (failures.length > 0) {
      console.log('\nFAILURES');
      failures.forEach((line) => console.log(`  - ${line}`));
      process.exitCode = 1;
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
};

main();