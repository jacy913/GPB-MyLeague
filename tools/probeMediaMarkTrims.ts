/**
 * How were the existing outlet marks trimmed? Reverse the rule before replacing one.
 *
 * `mediaImages.ts` says each supplied mark was "cropped to its own alpha bounding box" and
 * that the square variant is "centred on its own bounding box and cut to the largest square
 * that fits". That is a description, not a specification, and two details matter enough to be
 * worth recovering exactly rather than assuming:
 *
 *   1. The ALPHA THRESHOLD. Crop to `alpha > 0` and crop to `alpha > 8` differ by a pixel or
 *      two on an anti-aliased edge, and the committed files record which one was used.
 *
 *   2. THE SQUARE'S GEOMETRY. "Largest square that fits, centred" is ambiguous about whether
 *      the square is allowed to overhang the artwork -- and for a wide mark it must be, or the
 *      square would be as wide as the mark and as tall as the mark, with big empty bands.
 *
 * So this measures the existing files rather than assuming, and prints what it finds. If the
 * reconstruction does not reproduce the committed bytes, the rule is not the one described and
 * that is worth knowing BEFORE a new logo is cropped with it.
 *
 * Run: npx tsx tools/probeMediaMarkTrims.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alphaBounds, crop, decodePng, encodePng, type Bounds, type DecodedImage } from './pngCodec';

const DIR = resolve(process.cwd(), 'src', 'assets', 'media');

const load = (name: string): DecodedImage => decodePng(readFileSync(resolve(DIR, name)));

const identical = (a: Buffer, b: Buffer): boolean => a.equals(b);

const describe = (b: Bounds | null): string => (b ? `${b.left},${b.top} -> ${b.right},${b.bottom}  (${b.right - b.left + 1}x${b.bottom - b.top + 1})` : 'fully transparent');

/**
 * Transparent padding added around the alpha bounding box, in pixels, per side.
 *
 * Recovered by measurement, not assumed -- see the note at the crop site below.
 */
const PAD_PX = 8;

const main = (): void => {
  console.log('\nMEDIA MARK TRIMS -- what the existing files actually did\n');

  for (const outlet of [
    { raw: 'quincyhollislogo.png', trim: 'quincyhollislogo-trim.png', square: 'quincyhollislogo-trim-square.png' },
    { raw: 'linedsharplylogo.png', trim: 'linedsharplylogo-trim.png', square: 'linedsharplylogo-trim-square.png' },
    { raw: 'glorestpresslogo.png', trim: 'glorestpresslogo-trim.png', square: 'glorestpresslogo-trim-square.png' },
  ]) {
    const raw = load(outlet.raw);
    const trim = load(outlet.trim);
    const square = load(outlet.square);
    const rawBounds = alphaBounds(raw);
    const trimBounds = alphaBounds(trim);

    console.log(`  ${outlet.raw}`);
    console.log(`    raw            ${raw.width}x${raw.height}`);
    console.log(`    alpha bbox     ${describe(rawBounds)}`);
    console.log(`    trim           ${trim.width}x${trim.height}   alpha bbox ${describe(trimBounds)}`);

    if (!rawBounds) {
      console.log('    raw is fully transparent; nothing to reverse');
      console.log('');
      continue;
    }

    // Does the committed trim equal the raw cropped to the raw's own bbox?
    const rebuilt = crop(raw, rawBounds);
    const exact = identical(encodePng(rebuilt), readFileSync(resolve(DIR, outlet.trim)));
    const sameSize = rebuilt.width === trim.width && rebuilt.height === trim.height;
    const samePixels = sameSize && identical(rebuilt.data, trim.data);

    console.log(`    crop to bbox   ${rebuilt.width}x${rebuilt.height}   `
      + `size ${sameSize ? 'MATCHES' : 'DIFFERS'}   pixels ${samePixels ? 'MATCH' : 'DIFFER'}`
      + `   re-encoded bytes ${exact ? 'IDENTICAL' : 'differ (encoder, not geometry)'}`);

    /*
     * THE PADDING. A bare bbox crop does NOT reproduce any of the three committed trims --
     * every one is exactly 16px larger in each dimension than its own alpha bbox. So the real
     * rule is "crop to the alpha bounding box, then expand by 8px on every side", which is
     * what `mediaImages.ts` does not say.
     *
     * That padding matters and is not cosmetic: it is what stops a logo's outermost pixel
     * touching the edge of its box, which shows as a visible seam against any background and
     * makes adjacent marks in a row look different sizes.
     *
     * The padded crop IS tested for exact pixel equality below, so this is a recovered rule
     * and not a guess.
     */
    const pad = PAD_PX;
    const padded = crop(raw, {
      left: Math.max(0, rawBounds.left - pad),
      top: Math.max(0, rawBounds.top - pad),
      right: Math.min(raw.width - 1, rawBounds.right + pad),
      bottom: Math.min(raw.height - 1, rawBounds.bottom + pad),
    });
    const paddedExact = padded.width === trim.width
      && padded.height === trim.height
      && identical(padded.data, trim.data);
    console.log(`    +${pad}px padding  ${padded.width}x${padded.height}   `
      + `size ${padded.width === trim.width && padded.height === trim.height ? 'MATCHES' : 'DIFFERS'}   `
      + `pixels ${paddedExact ? 'IDENTICAL' : 'DIFFER'}`);
    if (!paddedExact) {
      console.log(`    !! the recovered padding rule does NOT reproduce the committed file.`);
      console.log('       Do not use it on the new logo until this is understood.');
    }
    console.log(`    trim touches canvas edge: `
      + `${trimBounds ? `left ${trimBounds.left === 0}, top ${trimBounds.top === 0}, right ${trimBounds.right === trim.width - 1}, bottom ${trimBounds.bottom === trim.height - 1}` : 'n/a'}`);

    // The square: is it the largest centred square that FITS the trim, or one that overhangs?
    const side = Math.min(trim.width, trim.height);
    const centred: Bounds = {
      left: Math.round((trim.width - side) / 2),
      top: Math.round((trim.height - side) / 2),
      right: Math.round((trim.width - side) / 2) + side - 1,
      bottom: Math.round((trim.height - side) / 2) + side - 1,
    };
    const squareCrop = crop(trim, centred);
    const squareTarget = square.width;
    const resized = squareTarget === side ? squareCrop : null;
    console.log(`    square         ${square.width}x${square.height}`);
    console.log(`    trim aspect    ${trim.width}:${trim.height}  -> largest square that fits is ${side}px`);
    console.log(`    centred square ${squareCrop.width}x${squareCrop.height}  `
      + (resized ? 'same size as the committed square' : `committed square is ${squareTarget}px, so it was RESIZED from ${side}px`));
    if (resized) {
      console.log(`    pixels match   ${identical(resized.data, square.data) ? 'YES' : 'NO'}`);
    } else {
      // Does the committed square look like a resize of the centred square crop?
      const shrunk = alphaBounds(squareCrop);
      console.log(`    centred crop bbox ${describe(shrunk)}`);
    }
    console.log('');
  }
};

main();