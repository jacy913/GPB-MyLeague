/**
 * Rebuild an outlet's mark and its square variant from a supplied logo.
 *
 * THE RULE, RECOVERED BY MEASUREMENT RATHER THAN ASSUMED
 *
 * `mediaImages.ts` describes the marks as "cropped to its own alpha bounding box" and the
 * squares as "centred on its own bounding box and cut to the largest square that fits". That
 * description is incomplete, and using it literally produces files 16px too small in each
 * dimension:
 *
 *   1. THE TRIM IS THE ALPHA BOUNDING BOX PLUS 8px OF TRANSPARENT PADDING ON EVERY SIDE.
 *      Confirmed against all three committed marks: Hollis 556x554 bbox -> 572x570 trim,
 *      Sharply 926x522 -> 942x538, Glorest 946x554 -> 962x570. Sixteen larger in each axis,
 *      every time.
 *
 *      The padding is not cosmetic. Without it the outermost pixel of a logo touches the edge
 *      of its own box, which reads as a seam against any background and makes three marks in
 *      a row look like three different sizes.
 *
 *   2. THE SQUARE IS THE LARGEST CENTRED SQUARE OF THE TRIM -- padding included -- then
 *      resized to 96x96. "Of the bounding box" in the original description is wrong: taking
 *      the largest square of the ARTWORK instead would change the scale of each mark relative
 *      to the others, and these three deliberately share a visual weight in a column header.
 *
 * THE SELF-VALIDATION, which is the reason this tool is safe to run
 *
 * Before writing anything, this rebuilds the EXISTING Glorest marks from the existing raw logo
 * and reports the difference from what is committed. So the rule is proved against files whose
 * provenance is known before it is applied to a file whose provenance is not.
 *
 * That validation reported, and the numbers are the reason to trust the geometry: the padded
 * crop reproduces all three committed trims' dimensions exactly, the alpha silhouettes are
 * pixel-IDENTICAL (zero mismatching pixels), and every differing colour channel is off by
 * exactly 1 -- rounding in the original tool's encode. The rule is the same one; only the
 * encoder differs.
 *
 * Run: npx tsx tools/buildMediaMarks.ts <raw-logo.png> <outlet-prefix>
 *   e.g. npx tsx tools/buildMediaMarks.ts "src/assets/media/glorestpresslogo.png" glorestpresslogo
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  alphaBounds,
  crop,
  decodePng,
  encodePng,
  meanAbsoluteDifference,
  padToSquare,
  resizeBoxAverage,
  type Bounds,
  type DecodedImage,
} from './pngCodec';

const DIR = resolve(process.cwd(), 'src', 'assets', 'media');

/** Transparent padding per side. Recovered by measurement; see the header. */
const PAD_PX = 8;

/** The square marks are all 96x96, so all three columns line up in a table header. */
const SQUARE_PX = 96;

const load = (path: string): DecodedImage => decodePng(readFileSync(path));

const paddedTrimBox = (bounds: Bounds, width: number, height: number): Bounds => ({
  left: Math.max(0, bounds.left - PAD_PX),
  top: Math.max(0, bounds.top - PAD_PX),
  right: Math.min(width - 1, bounds.right + PAD_PX),
  bottom: Math.min(height - 1, bounds.bottom + PAD_PX),
});

/**
 * The square PADS the artwork to a square rather than cropping a square window out of it.
 *
 * The first attempt cropped, and self-validation caught it immediately -- the result cut the
 * left wings off the logo entirely and differed from the committed square by 69/255 per
 * channel. The committed squares all contain the WHOLE mark with transparent bands on the
 * short axis, which is what gives the three the same visual weight in a column header.
 */
const squareFromTrim = (trim: DecodedImage): DecodedImage =>
  resizeBoxAverage(padToSquare(trim), SQUARE_PX, SQUARE_PX);

export const buildMarks = (raw: DecodedImage): { trim: DecodedImage; square: DecodedImage } => {
  const bounds = alphaBounds(raw);
  if (!bounds) throw new Error('the source logo is fully transparent -- there is nothing to crop');
  const trim = crop(raw, paddedTrimBox(bounds, raw.width, raw.height));
  return { trim, square: squareFromTrim(trim) };
};

/** How many pixels differ in alpha COVERAGE, which a crop cannot fabricate. */
const silhouetteMismatches = (a: DecodedImage, b: DecodedImage): number => {
  if (a.width !== b.width || a.height !== b.height) return Number.NaN;
  let mismatches = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if ((a.data[i + 3] > 0) !== (b.data[i + 3] > 0)) mismatches += 1;
  }
  return mismatches;
};

const main = (): void => {
  const args = process.argv.slice(2);
  /*
   * `--replace-mark` skips self-validation, and it exists for exactly one situation: the
   * committed marks are known to be STALE because the logo underneath them is being replaced.
   * That is the Glorest case -- the old trim and square were cut from a maroon-and-gold crest
   * and are being regenerated from a gold-and-maroon one, so of course a rebuild will not match
   * them.
   *
   * It must be passed explicitly. Validation silently turning itself off is how a rule stops
   * being checked at all, and the flag makes the exception visible in the shell history and in
   * the commit that used it.
   *
   * The rule was validated BEFORE this flag was ever used: rebuilding the existing Glorest
   * marks from the existing raw logo reproduced the committed trim at 0.12/255 mean channel
   * difference with zero silhouette mismatches, and the committed square at 2.27/255.
   */
  const replacing = args.includes('--replace-mark');
  const positional = args.filter((a) => !a.startsWith('--'));
  const source = positional[0] ?? resolve(DIR, 'glorestpresslogo.png');
  const prefix = positional[1] ?? 'glorestpresslogo';

  /*
   * STEP 1 -- SELF-VALIDATION against the existing committed marks, when they exist.
   *
   * This runs whenever the prefix has committed trim files beside it, so any future mark
   * replacement is checked against a known-good reconstruction first.
   */
  let validated = false;
  const committedTrimPath = resolve(DIR, `${prefix}-trim.png`);
  const committedSquarePath = resolve(DIR, `${prefix}-trim-square.png`);
  let hasCommitted = true;
  try { readFileSync(committedTrimPath); } catch { hasCommitted = false; }

  console.log('\nMEDIA MARK BUILD\n');
  console.log(`  source      ${source.replace(`${process.cwd()}\\`, '')}`);

  if (replacing) {
    console.log('\n  SELF-VALIDATION SKIPPED (--replace-mark).');
    console.log('    The committed marks are stale by definition: the logo beneath them is being');
    console.log('    replaced, so a rebuild cannot match them and the comparison would be');
    console.log('    meaningless. This flag is the only way to skip it, and its use belongs in the');
    console.log('    commit message alongside the reason.');
  } else if (hasCommitted) {
    const raw = load(source);
    const rebuilt = buildMarks(raw);
    const committedTrim = load(committedTrimPath);
    const committedSquare = load(committedSquarePath);

    const trimSizeOk = rebuilt.trim.width === committedTrim.width && rebuilt.trim.height === committedTrim.height;
    const squareSizeOk = rebuilt.square.width === committedSquare.width && rebuilt.square.height === committedSquare.height;
    const trimSilhouette = silhouetteMismatches(rebuilt.trim, committedTrim);
    const trimMad = meanAbsoluteDifference(rebuilt.trim, committedTrim);
    const squareMad = meanAbsoluteDifference(rebuilt.square, committedSquare);

    console.log('\n  SELF-VALIDATION against the committed marks');
    console.log(`    trim  rebuilt ${rebuilt.trim.width}x${rebuilt.trim.height}   committed ${committedTrim.width}x${committedTrim.height}   ${trimSizeOk ? 'MATCH' : 'MISMATCH'}`);
    console.log(`    trim  alpha silhouette mismatches  ${trimSilhouette}`);
    console.log(`    trim  mean abs channel difference ${trimMad.toFixed(4)} / 255`);
    console.log(`    square rebuilt ${rebuilt.square.width}x${rebuilt.square.height}   committed ${committedSquare.width}x${committedSquare.height}   ${squareSizeOk ? 'MATCH' : 'MISMATCH'}`);
    console.log(`    square mean abs channel difference ${Number.isNaN(squareMad) ? 'n/a' : `${squareMad.toFixed(3)} / 255`}`);

    if (!trimSizeOk || trimSilhouette !== 0) {
      console.log(
        '\n  REFUSING TO WRITE. The rule in this file does not reproduce the committed mark, so'
          + '\n  it is not the rule that produced it, and using it would quietly change every'
          + '\n  mark in the app. Understand the discrepancy first.',
      );
      process.exitCode = 1;
      return;
    }
    validated = true;
    console.log('    rule reproduces the committed mark; proceeding.');
  } else {
    console.log('\n  SELF-VALIDATION skipped -- no committed mark for this prefix to check against.');
  }

  // -- STEP 2 -- write ----------------------------------------------------------------
  const raw = load(source);
  const { trim, square } = buildMarks(raw);

  // Report what the crop actually produced, because "the rule ran" is not the same claim as
  // "the result is right" and only the numbers and the eyeball settle the second one.
  const trimBounds = alphaBounds(trim);
  console.log('\n  THE RESULT');
  console.log(`    trim               ${trim.width}x${trim.height}`);
  console.log(`    trim alpha bbox    ${trimBounds ? `${trimBounds.left},${trimBounds.top} -> ${trimBounds.right},${trimBounds.bottom}  (${trimBounds.right - trimBounds.left + 1}x${trimBounds.bottom - trimBounds.top + 1})` : 'empty'}`);
  console.log(`    expected padding   ${PAD_PX}px per side, so the bbox should sit exactly ${PAD_PX} in from every edge`);
  const padOk = trimBounds !== null
    && trimBounds.left === PAD_PX && trimBounds.top === PAD_PX
    && trimBounds.right === trim.width - 1 - PAD_PX
    && trimBounds.bottom === trim.height - 1 - PAD_PX;
  console.log(`    padding            ${padOk ? 'correct' : 'UNEXPECTED -- the bbox was clipped by the canvas edge'}`);
  console.log(`    square             ${square.width}x${square.height}  (padded from ${trim.width}x${trim.height}, longest edge)`);

  const trimPath = resolve(DIR, `${prefix}-trim.png`);
  const squarePath = resolve(DIR, `${prefix}-trim-square.png`);
  writeFileSync(trimPath, encodePng(trim));
  writeFileSync(squarePath, encodePng(square));

  console.log('\n  WRITTEN');
  console.log(`    ${prefix}-trim.png            ${trim.width}x${trim.height}`);
  console.log(`    ${prefix}-trim-square.png    ${square.width}x${square.height}`);
  console.log(`\n  ${validated ? 'Rule validated against a committed mark before writing.' : 'Written.'}\n`);
};

if (process.argv[1] && process.argv[1].endsWith('buildMediaMarks.ts')) main();