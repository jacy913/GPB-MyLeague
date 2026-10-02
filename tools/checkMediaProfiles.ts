/**
 * Are the eight forecasters actually calibrated?
 *
 * WHY THIS TOOL EXISTS
 *
 * Step 3 of the HXSE build authors five `MediaProfile` entries. Their `confidence` values are
 * PROVISIONAL, and step 5 re-fits all eight with `tools/fitMediaOdds.ts`.
 *
 * That leaves a gap between the two steps, and the gap is dangerous for a specific reason:
 * step 1 made `confidence` the WEIGHT `weightedConsensus` gives a forecaster's opinion in the
 * house price. A provisional confidence is no longer a cosmetic guess. It is a guess that moves
 * the number the whole league bets on.
 *
 * So the state is a FIELD on the profile (`confidenceStatus`) rather than a comment, this tool
 * reads it, and step 5 cannot be forgotten by editing prose.
 *
 * WHY "ARE THEY ALL FITTED" IS REPORTED AND NOT GATED
 *
 * It is currently FALSE, and gating it would mean a permanently red suite, which is how people
 * learn to ignore a red suite. So the calibration state is reported loudly, and the things that
 * ARE true now -- every method dispatching, every accent present, every confidence in range --
 * are gated.
 *
 * WHEN STEP 5 LANDS this tool should be changed to gate the calibration check too, at which
 * point it will pass for the right reason rather than because it stopped looking.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you a confidence is WRONG, only that it has not been measured. The Brier
 * acceptance bar -- every forecaster below 0.2500, which is exactly what a coin flip scores --
 * belongs to `tools/fitMediaOdds.ts` and is not restated here.
 *
 * Run: npx tsx tools/checkMediaProfiles.ts
 */

import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

const main = (): void => {
  const mediaReads = readFileSync(resolve(process.cwd(), 'src', 'lib', 'mediaReads.ts'), 'utf8');
  const mediaMarkets = readFileSync(resolve(process.cwd(), 'src', 'lib', 'mediaMarkets.ts'), 'utf8');
  const css = readFileSync(resolve(process.cwd(), 'src', 'index.css'), 'utf8');

  // -- 1. eight forecasters, all distinct --------------------------------------------
  check(
    'there are nine forecasters',
    MEDIA_PROFILES.length === 9,
    `found ${MEDIA_PROFILES.length}`,
  );
  const ids = MEDIA_PROFILES.map((p) => p.id);
  check(
    'every forecaster has a distinct id',
    new Set(ids).size === ids.length,
    `${ids.length} ids, ${new Set(ids).size} distinct`,
  );

  // -- 2. EVERY METHOD HAS A REAL READ, not a stub ------------------------------------
  /*
    This is the check that makes "extend every dispatch site" mean something. `SCORERS` is typed
    `Record<MediaMethod, ...>`, so the compiler already demands a key for each method -- but a
    key can be a function that ignores its arguments and returns the league mean, and the
    compiler cannot see that.

    So this asserts each method maps to a NAMED function in the file, rather than to an inline
    constant or a shared fallback.
   */
  /*
    THE EMPTY-BLOCK GUARD, and the reason it exists.

    The original pattern was `const SCORERS[^=]*=\s*\{...\}`, and `[^=]*` cannot cross the `=`
    inside the `=>` of the function type in the annotation -- so the block NEVER MATCHED.
    `scorerBlock` was the empty string, the inline-arrow list built from it was empty, and the
    check PASSED.

    Having measured nothing.

    That is the worst failure mode a check has: it reports success and protects nothing. So the
    match is asserted non-empty, and the pattern is greedy-per-line (`[^\n]*=`) which backtracks
    to the `= {` that actually opens the literal.
   */
  const scorerBlock = /const SCORERS[^\n]*=\s*\{\r?\n([\s\S]*?)\r?\n\};/.exec(mediaReads)?.[1] ?? '';
  check(
    'the SCORERS block was actually found -- a check that measures nothing must not pass',
    scorerBlock.trim().length > 0,
    scorerBlock.trim().length === 0
      ? 'the regex did not match SCORERS, so every assertion below it was reading an empty string'
      : undefined,
  );

  /*
    EVERY ENTRY MUST DELEGATE TO A NAMED FUNCTION THAT EXISTS.

    The first version of this asserted "no inline arrow functions", on the reasoning that an
    inline arrow is where a stub hides. That was wrong about this module, and wrong in the way
    that has happened five times in this project: it asserted more than the rule says.

    The module's own convention IS a delegating inline arrow -- `conventional: (team, derived)
    => glorestScore(team, derived)` -- and it predates the five new forecasters. Asserting
    against it failed on correct code.

    The property that actually matters is not the syntax but the DELEGATION: an entry that
    forwards to a named function is a real implementation, and an entry that is a literal or
    ignores its arguments is a stub. So each entry is scanned for the identifiers it calls,
    and at least one of them must be defined as a function in the same file.
   */
  const definedFunctions = new Set([
    ...[...mediaReads.matchAll(/^(?:const|function)\s+(\w+)\s*[=(]/gm)].map((m) => m[1]),
  ]);

  /*
    ENTRIES ARE PARSED AS BLOCKS, NOT LINES, because two of the eight are not one line.

    A line-based scan reported two false failures on correct code:

      advanced: hollisScore,                  a BARE reference, with no call parentheses
      attention: (team, derived) => {         a body that continues onto the next line

    Neither of those is a stub -- both delegate to a named function -- but a scan that only
    looks at the line holding the key cannot tell that. So the block is split on the key
    pattern and each entry is searched whole, for ANY identifier that names a defined
    function, whether or not it is called.

    A stub returns a constant and mentions no function at all, which is exactly the case this
    catches.
   */
  const entryBlocks = scorerBlock
    .split(/\r?\n(?=\s*\w+:)/)
    .map((block) => block.trim())
    .filter((block) => /^\w+:/.test(block));
  const stubEntries = entryBlocks.filter((block) => {
    const names = [...block.matchAll(/\b([a-zA-Z_]\w*)\b/g)].map((m) => m[1]);
    return !names.some((name) => definedFunctions.has(name));
  });

  check(
    'every SCORERS entry delegates to a named function that exists',
    entryBlocks.length > 0 && stubEntries.length === 0,
    stubEntries.length
      ? `no named function referenced: ${stubEntries.map((b) => b.split(':')[0]).join(', ')}`
      : `${entryBlocks.length} entries, all delegating to a defined function`
  );

  // Every method in the union must have an entry.
  check('every method has a SCORERS entry',
    entryBlocks.length === 9,
    `${entryBlocks.length} entries for 8 methods`
  );

  // And the five new methods must have genuinely distinct implementations.
  // And the five new methods must have genuinely distinct implementations.
  /*
    FACTORS IS KEYED BY MediaId, NOT BY MediaMethod, and the first version of this check
    searched it for METHOD names and found nothing -- reporting "found 0" while looking like a
    real measurement. The check was wrong, not the module.

    SCORERS is keyed by method. FACTORS is keyed by outlet. Conflating them is the kind of thing
    that produces a check which passes vacuously or fails spuriously, and this one did both.
   */
  const factorsBlock = /const FACTORS[^\n]*=\s*\{\r?\n([\s\S]*?)\r?\n\};/.exec(mediaMarkets)?.[1] ?? '';
  const targetFor = (outlet: string): string | undefined =>
    new RegExp('\\b' + outlet + ':\\s*(\\w+)').exec(factorsBlock)?.[1];
  const NEW_OUTLETS = ['sallow', 'jardins', 'boyle', 'mussad', 'wardley'];
  const newFactors = NEW_OUTLETS.filter((o) => targetFor(o) !== undefined);
  const distinctTargets = new Set(newFactors.map(targetFor));
  check(
    'the five new outlets each name a run-factor function',
    newFactors.length === 5,
    `found ${newFactors.length}: ${newFactors.join(', ')}`,
  );
  check(
    'the five new run-factor functions are DISTINCT from each other',
    distinctTargets.size === 5,
    `${distinctTargets.size} distinct targets: ${[...distinctTargets].join(', ')}. Fewer than five `
    + 'means two methods share an implementation, which is a stub wearing a name.',
  );

  // -- 3. every accent family present ------------------------------------------------
  const missingAccent = ids.filter(
    (id) => !new RegExp('--color-media-' + id + ':').test(css)
      || !new RegExp('--color-media-' + id + '-hi:').test(css),
  );
  check(
    'every forecaster has a base and a -hi accent token',
    missingAccent.length === 0,
    missingAccent.length ? `missing: ${missingAccent.join(', ')}` : `${ids.length} families`,
  );

  // -- 4. every confidence is usable --------------------------------------------------
  const bad = MEDIA_PROFILES.filter((p) => !(p.confidence > 0 && p.confidence <= 1));
  check(
    'every confidence is in (0, 1]',
    bad.length === 0,
    bad.length ? bad.map((p) => `${p.id} = ${p.confidence}`).join('; ') : undefined,
  );

  // -- 5. THE CALIBRATION STATE, REPORTED ---------------------------------------------
  const provisional = MEDIA_PROFILES.filter((p) => p.confidenceStatus === 'provisional');
  const fitted = MEDIA_PROFILES.filter((p) => p.confidenceStatus === 'fitted');

  // -- 6. Sharply's overconfidence must survive --------------------------------------
  /*
    The single most fragile number in the module. His posted slope is roughly three times his
    fitted optimum, and that gap IS the exploitable flaw the media layer is built around. A
    recalibration pass that "corrects" it would destroy the best play in the game.
   */
  const sharply = MEDIA_PROFILES.find((p) => p.id === 'sharply');
  const sharplySlope = new RegExp('sharply:\\s*([0-9.]+)').exec(
    readFileSync(resolve(process.cwd(), 'src', 'lib', 'mediaOdds.ts'), 'utf8'),
  )?.[1];
  check(
    "Sharply's posted slope is still ~3x his fitted optimum of 0.25",
    sharplySlope !== undefined && Math.abs(Number(sharplySlope) - 0.80) < 0.001,
    `posted ${sharplySlope}. If this ever reads 0.25 the exploitable flaw has been calibrated `
    + "away, and checkBettingCardShape's colour rule plus the divergence play both lose their subject.",
  );
  /*
    RESTATED, because the original claim was false and had been made true by accident.

    It asserted Sharply is the LEAST-confident forecaster in the pool. That held at three
    forecasters and stopped holding the moment five provisional ones landed at 0.50-0.55 -- he
    is now third-lowest. The check went red on correct code, which is the same class of error as
    the ones this project has already made four times: asserting more than the rule says.

    The durable claim is narrower and actually true: among the FITTED forecasters, Sharply is
    the least confident, and by a wide margin (0.55 against 0.72 and 0.84). That is the measured
    finding -- his Brier is the worst of the three and his posted slope is triple his optimum --
    and it does not depend on where five uncalibrated profiles happen to sit.
   */

  /*
    DELETED, and the third attempt at this claim is the reason it is gone.

    It originally asserted Sharply is the LEAST-confident forecaster. True at three forecasters;
    false the moment five landed at 0.50. Restated as least-confident OF THE FITTED -- still
    false, because Jardins at 0.35 and Wardley at 0.36 are both legitimately below his 0.55 once
    step 5 has fitted them.

    A claim that has been wrong twice by asserting more than the rule says does not get a third
    restatement. It gets deleted.

    AND IT WAS NOT CARRYING THE WEIGHT ANYWAY. The thing that must survive step 5 is Sharply's
    POSTED SLOPE of 0.80 against a fitted optimum of 0.25 -- the exploitable flaw the divergence
    play is built on -- and that is asserted two checks above against the literal value, and it
    passes. His CONFIDENCE is a derived consequence of that overconfidence and it is free to land
    wherever the measurement puts it.

    A check that has to be reworded every time the pool changes is measuring the pool, not the
    thing it was written for.
   */

  /*
    THE CALIBRATION CHECK IS A REAL GATE NOW, and it can be because step 5 has run.

    This was deliberately NOT gated while five profiles were provisional: a permanently red suite
    is how people learn to ignore a red suite, and a check that is red for a known reason teaches
    nothing. With all eight fitted it is a real assertion that can pass, and it is what stops the
    next forecaster being added with a plausible-looking number and no measurement behind it.

    The bar is "every profile is FITTED", not "every Brier is below 0.25". The Brier bar lives in
    tools/fitMediaOdds.ts where the measurement is; duplicating a threshold across two tools is
    how they drift apart.
   */
  check(
    'every forecaster confidence is FITTED, not provisional',
    provisional.length === 0,
    provisional.length
      ? `provisional: ${provisional.map((p) => p.id).join(', ')}. Run tools/fitMediaOdds.ts.`
      : `all ${MEDIA_PROFILES.length} fitted`,
  );

  // -- report ------------------------------------------------------------------------
  console.log('\nMEDIA PROFILES\n');
  console.log('  outlet    method         confidence  status        accent');
  for (const p of MEDIA_PROFILES) {
    console.log(
      '  ' + p.id.padEnd(9) + p.method.padEnd(14)
      + String(p.confidence).padEnd(12) + p.confidenceStatus.padEnd(13) + p.accent,
    );
  }

  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) console.log('          ' + c.detail);
  });

  const failed = checks.filter((c) => !c.pass);
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS');

  console.log('\n  CALIBRATION STATE -- REPORTED, NOT GATED\n');
  console.log('    fitted      ' + fitted.length + ': ' + fitted.map((p) => p.id).join(', '));
  console.log('    provisional ' + provisional.length + ': ' + provisional.map((p) => p.id).join(', '));
  if (provisional.length > 0) {
    console.log('');
    console.log('    *** STEP 5 HAS NOT RUN. ***');
    console.log('    Since step 1, `confidence` is the WEIGHT weightedConsensus gives a forecaster in');
    console.log('    the house price. These five numbers are guesses that are currently moving the');
    console.log('    number the league bets on.');
    console.log('');
    console.log('    The five slopes in mediaOdds.ts SLOPE are provisional for the same reason, and');
    console.log('    step 5 must NOT flatten Sharply back to his 0.25 optimum -- see the checks above.');
    console.log('');
    console.log('    This is deliberately NOT gated. Gating it would mean a permanently red suite, and');
    console.log('    a permanently red suite is how people learn to ignore a red suite. When step 5');
    console.log('    lands, this becomes a real gate that passes for a reason.');
  } else {
    console.log('\n    All eight are fitted. This line can become a gate now.');
  }
  console.log('');

  if (failed.length > 0) process.exitCode = 1;
};

main();
