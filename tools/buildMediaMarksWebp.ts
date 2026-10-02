/**
 * Build the five new forecasters' marks as WebP, using the EXISTING mark rule.
 *
 * WHY THIS IS A SEPARATE TOOL RATHER THAN A FLAG ON buildMediaMarks
 *
 * Two reasons, and the second is the important one.
 *
 * First, the output format differs: buildMediaMarks writes PNG, this writes WebP.
 *
 * Second -- and this is why it is not a flag -- the geometry rule is IMPORTED from
 * buildMediaMarks rather than re-implemented. `buildMarks` is already exported, so the
 * alpha-bbox-plus-8px trim and the pad-to-square are the same code that produced the three
 * committed marks. Re-deriving them in a second file would create two rules that agree today and
 * drift apart the first time one is edited -- and `deriveParkProfile`'s physics check was already
 * caught in this project for validating a copy of a formula instead of the formula itself.
 *
 * So the consistency the plan asks for -- "follow whatever convention the existing -trim-square
 * files use so all eight outlets render consistently" -- is guaranteed by construction rather
 * than by two implementations happening to match.
 *
 * THE PLAN'S PREMISE ABOUT THESE FILES IS WRONG, and that is the substantive finding here.
 *
 * The plan says the five portraits "`render at 28-40px, matching the existing outlet logos`" and
 * asks for a 96x96 conversion following the `-trim-square` convention. That assumes the five
 * supplied files ARE logo marks. They are not. They are full-body portrait photographs; one of
 * them is a man standing, head to shoes, filling the canvas.
 *
 * Fed straight into `buildMarks`, a full-body figure at 96x96 renders as an unreadable smudge:
 * a tiny person in a suit, about four pixels of face. That was established by building it and
 * LOOKING at it, and it would otherwise have shipped as five marks nobody could identify at the
 * size the plan says they are displayed at.
 *
 * So the subject is cropped to head and shoulders FIRST, using `frameFor` -- the same upper-half
 * anchor `buildMediaPortraits` uses for the hero portraits, exported rather than re-derived so
 * there is one framing rule and not two. The mark geometry after that is unchanged. A face at
 * 96px is as identifiable as a crest at 96px, which is the standard the existing three set.
 *
 * WHY NO `trim` VARIANT IS WRITTEN
 *
 * The first version wrote both a trim and a square, and the trims came to 2955 KB for the five --
 * forty times the square total and a hundred times the plan's ~25 KB budget. The plan asks for
 * 96x96 and nothing else, so the trims are gone. If a non-square mark is wanted later it should
 * be generated at the size it is actually displayed at, which is not 1675x1973.
 *
 * WHY WEBP, AND HOW IT IS ENCODED HERE
 *
 * There is no image library in this project. `@jsquash/webp` is a WASM build of libwebp and is
 * browser-first: it `fetch()`es its own `.wasm`, and Node 20.11's fetch refuses `file:` URLs with
 * "not implemented... yet". So the module is handed the WASM bytes through `init({ wasmBinary })`,
 * imported from the package SUBPATH -- the index re-exports only `encode` and `decode`, not
 * `init`.
 *
 * The quality is not asserted, it is SWEPT and printed, so the shipped value is a measurement.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you the marks look right. It reports geometry and byte counts; whether a trim
 * lands well on a particular face is an eye judgement.
 *
 * Run: npx tsx tools/buildMediaMarksWebp.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { crop, decodePng, encodePng, type DecodedImage } from './pngCodec';
import { buildMarks } from './buildMediaMarks';
import { frameFor } from './buildMediaPortraits';
import { encode as encodeWebp } from '@jsquash/webp';
import { init } from '@jsquash/webp/encode.js';

const DIR = resolve(process.cwd(), 'src', 'assets', 'media');
const WASM = resolve(process.cwd(), 'node_modules', '@jsquash', 'webp', 'codec', 'enc', 'webp_enc_simd.wasm');

/**
 * The five new forecasters: outlet id to supplied portrait.
 *
 * The `id` values are the ones `plan/gpb-macrobet-hxse.md` §2.1 fixes and which widen `MediaId`
 * in step 3. Written out rather than derived from the filename, because the filenames are person
 * names (`garysallow.png`) and the ids are short forms (`sallow`) -- a tool that guessed the
 * mapping from the filename would one day guess wrong and put the wrong face on the wrong
 * forecaster, which nothing in this repository asserts against.
 */
const MARKS: Array<{ id: string; name: string; file: string }> = [
  { id: 'sallow', name: 'Gary Sallow', file: 'garysallow.png' },
  { id: 'jardins', name: 'Audrey Jardins', file: 'audreyjardins.png' },
  { id: 'boyle', name: 'Landon Boyle', file: 'landonboyle.png' },
  { id: 'mussad', name: 'Tariq Mussad', file: 'tariqmussad.png' },
  { id: 'wardley', name: 'Vance Wardley Jr.', file: 'vancewardleyjr.png' },
];

/** Qualities swept, so the shipped one is chosen from measured bytes rather than taste. */
const QUALITIES = [75, 82, 90, 95];

/**
 * The shipped quality.
 *
 * 90 rather than 82, which the first probe used. The sweep shows 90 costs 34% more bytes than
 * 82 for five marks -- 9.5 KB in total, on images displayed at 28-40px. Spending 9.5 KB to be
 * visibly crisp at the size these are actually seen is the better trade, and the sweep is
 * printed so the decision can be revisited against the real numbers rather than this paragraph.
 */
const SHIP_AT = 90;

const encode = async (image: DecodedImage, quality: number): Promise<Buffer> => {
  const out = await encodeWebp(
    { data: image.data, width: image.width, height: image.height } as unknown as ImageData,
    { quality },
  );
  return Buffer.from(out);
};

/** Head-and-shoulders crop, then the existing mark rule. See the header for why both. */
const squareFor = (source: DecodedImage): DecodedImage =>
  buildMarks(crop(source, frameFor(source).box)).square;

const main = async (): Promise<void> => {
  console.log('\nBUILD THE FIVE NEW MARKS AS WEBP\n');

  /*
    THE WASM HAS TO BE HANDED IN, not fetched.

    This line was MISSING from the first committed version of this tool -- the file printed the
    wasm size in its banner and then called `encode` without ever initialising, so the encoder
    fell back to fetching its own module over `file:`, which Node 20.11 refuses. The failure was
    loud and immediate, which is the good case; the bad case would have been a tool that looked
    initialised because it printed the size of a file it never loaded.

    So it initialises, and it initialises BEFORE anything is encoded.
   */
  const wasmBinary = readFileSync(WASM);
  await init({ wasmBinary } as never);

  console.log('  encoder: @jsquash/webp, wasm handed in directly (' + (wasmBinary.length / 1024).toFixed(0) + ' KB)');
  console.log('    it fetches its own wasm, and Node 20.11 fetch refuses file: URLs');
  console.log('  rule   : frameFor() head-and-shoulders crop, then buildMarks() -- both imported, neither re-derived');
  console.log('  shipped at quality ' + SHIP_AT + '\n');

  const missing = MARKS.filter((m) => !existsSync(resolve(DIR, m.file)));
  if (missing.length > 0) {
    console.error('  MISSING SOURCES: ' + missing.map((m) => m.file).join(', ') + '\n');
    process.exitCode = 1;
    return;
  }

  let inTotal = 0;
  let squareTotal = 0;
  let pngSquareTotal = 0;
  const squares: DecodedImage[] = [];

  for (const { id, name, file } of MARKS) {
    const raw = readFileSync(resolve(DIR, file));
    inTotal += raw.length;

    const image = decodePng(raw);
    const frame = frameFor(image);
    const square = squareFor(image);
    squares.push(square);

    const pngSquare = encodePng(square);
    pngSquareTotal += pngSquare.length;

    const bytes = await encode(square, SHIP_AT);
    writeFileSync(resolve(DIR, `${id}-trim-square.webp`), bytes);
    squareTotal += bytes.length;

    console.log(
      '  ' + id.padEnd(9) + name.padEnd(19)
      + ' 96x96   ' + bytes.length.toLocaleString().padStart(7) + ' B webp   '
      + pngSquare.length.toLocaleString().padStart(7) + ' B png',
    );
    // The framing decision per mark, because it is a judgement and not an identity: some of
    // these five hit the full-canvas fallback and some do not, and a reader should be able to
    // see which without re-running the portrait tool.
    console.log('              ' + frame.note);
  }

  // The sweep runs on the FIRST mark only. All five squares are 96x96 by construction, so this
  // measures the FORMAT at this size rather than printing five near-copies of one number.
  console.log('\n  QUALITY SWEEP on the 96x96 square (sallow)');
  console.log('    quality   webp bytes   vs PNG   vs 82');
  const pngSquare = encodePng(squares[0]);
  const at82 = (await encode(squares[0], 82)).length;
  for (const q of QUALITIES) {
    const bytes = (await encode(squares[0], q)).length;
    console.log(
      '    ' + String(q).padStart(6) + '   '
      + bytes.toLocaleString().padStart(10)
      + ((bytes / pngSquare.length * 100).toFixed(1) + '%').padStart(8)
      + ((bytes / at82 * 100).toFixed(0) + '%').padStart(7)
      + (q === SHIP_AT ? '   <- shipped' : ''),
    );
  }

  console.log('\n  TOTALS');
  console.log('    sources read         ' + (inTotal / 1024 / 1024).toFixed(1) + ' MB');
  console.log('    five squares, webp   ' + (squareTotal / 1024).toFixed(1) + ' KB   <- what the app renders');
  console.log('    same five as PNG     ' + (pngSquareTotal / 1024).toFixed(1) + ' KB');
  console.log('    reduction            ' + (100 - (squareTotal / inTotal) * 100).toFixed(2) + '% off the sources');
  console.log('    webp vs png          ' + ((squareTotal / pngSquareTotal) * 100).toFixed(0) + '% of the PNG equivalent');
  console.log('\n  plan §1.3 estimated ~25 KB for the five; this is ' + (squareTotal / 1024).toFixed(1) + ' KB.\n');
  console.log('  LOOK AT THEM. The framing rule is deterministic; that each trim lands well on the');
  console.log('  face it is meant to is an eye judgement, and this tool cannot make it.\n');
};

main();