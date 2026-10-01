/**
 * The padded crop reproduces every committed trim's SIZE but not its pixels. Why?
 *
 * Three possibilities, and they have very different consequences:
 *
 *   (a) MY ALPHA FLOOR IS DIFFERENT from the one used to define the bbox. The bbox size
 *       matched on all three, so if this is it the difference is confined to pixels at or
 *       below the floor -- invisible, and safe to proceed.
 *
 *   (b) THE TRIMS WERE MADE FROM A DIFFERENT SOURCE IMAGE than the raw PNGs sitting beside
 *       them. That would mean the raw files have been replaced since the trims were cut, and
 *       that the committed trim is the better evidence of what the artwork actually is.
 *
 *   (c) AN EXTERNAL TOOL re-encoded the pixels on the way out -- a colour-space or
 *       premultiplication change -- so no straight crop of the raw can ever match.
 *
 * This reports where the first difference is, what the two pixels actually are, and how many
 * pixels differ and by how much, so the question is answered rather than argued about.
 *
 * Run: npx tsx tools/probeTrimPixelDiff.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { alphaBounds, crop, decodePng, type Bounds } from './pngCodec';

const DIR = resolve(process.cwd(), 'src', 'assets', 'media');
const load = (name: string) => decodePng(readFileSync(resolve(DIR, name)));

const PAIRS: Array<[string, string]> = [
  ['quincyhollislogo.png', 'quincyhollislogo-trim.png'],
  ['linedsharplylogo.png', 'linedsharplylogo-trim.png'],
  ['glorestpresslogo.png', 'glorestpresslogo-trim.png'],
];

const padBox = (b: Bounds, w: number, h: number, pad: number): Bounds => ({
  left: Math.max(0, b.left - pad),
  top: Math.max(0, b.top - pad),
  right: Math.min(w - 1, b.right + pad),
  bottom: Math.min(h - 1, b.bottom + pad),
});

const main = (): void => {
  console.log('\nWHY THE PADDED CROP DOES NOT MATCH THE COMMITTED TRIM BYTE FOR BYTE\n');

  for (const [rawName, trimName] of PAIRS) {
    const raw = load(rawName);
    const trim = load(trimName);
    const bounds = alphaBounds(raw);
    if (!bounds) continue;
    const padded = crop(raw, padBox(bounds, raw.width, raw.height, 8));

    let differing = 0;
    let maxChannelDelta = 0;
    let onlyLowAlpha = 0;
    let firstAt: { x: number; y: number } | null = null;
    const samples: string[] = [];

    for (let i = 0; i < trim.data.length; i += 4) {
      let same = true;
      let delta = 0;
      for (let c = 0; c < 4; c += 1) {
        const d = Math.abs(trim.data[i + c] - padded.data[i + c]);
        if (d > 0) { same = false; delta = Math.max(delta, d); }
      }
      if (!same) {
        differing += 1;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
        const px = i / 4;
        const x = px % trim.width;
        const y = Math.floor(px / trim.width);
        if (delta <= 8) onlyLowAlpha += 1;
        if (!firstAt) firstAt = { x, y };
        if (samples.length < 3) {
          samples.push(
            `(${x},${y}) trim rgba(${trim.data[i]},${trim.data[i + 1]},${trim.data[i + 2]},${trim.data[i + 3]})`
            + ` vs padded rgba(${padded.data[i]},${padded.data[i + 1]},${padded.data[i + 2]},${padded.data[i + 3]})`,
          );
        }
      }
    }

    const total = trim.width * trim.height;
    console.log(`  ${rawName} -> ${trimName}`);
    console.log(`    pixels                ${total}`);
    console.log(`    differing             ${differing}  (${((differing / total) * 100).toFixed(4)}%)`);
    console.log(`    of which delta <= 8   ${onlyLowAlpha}`);
    console.log(`    largest channel delta ${maxChannelDelta}`);
    console.log(`    first difference      ${firstAt ? `(${firstAt.x},${firstAt.y})` : 'none'}`);
    samples.forEach((s) => console.log(`      ${s}`));
    console.log('');
  }

  /*
   * THE DECISIVE TEST.
   *
   * If the trims were cut from these exact raw files, then for every pixel where the trim is
   * fully transparent the padded crop must be too, and vice versa -- regardless of colour
   * handling, because a straight crop cannot invent or remove coverage. An alpha SILHOUETTE
   * mismatch therefore means the sources differ, and no amount of tuning an encoder fixes it.
   */
  console.log('  THE DECISIVE TEST -- do the two versions cover the same shape?\n');
  for (const [rawName, trimName] of PAIRS) {
    const raw = load(rawName);
    const trim = load(trimName);
    const bounds = alphaBounds(raw);
    if (!bounds) continue;
    const padded = crop(raw, padBox(bounds, raw.width, raw.height, 8));

    let silhouetteMismatch = 0;
    let trimOpaque = 0;
    let paddedOpaque = 0;
    for (let i = 0; i < trim.data.length; i += 4) {
      const a = trim.data[i + 3] > 0;
      const b = padded.data[i + 3] > 0;
      if (a) trimOpaque += 1;
      if (b) paddedOpaque += 1;
      if (a !== b) silhouetteMismatch += 1;
    }
    console.log(`  ${rawName}`);
    console.log(`    trim opaque pixels      ${trimOpaque}`);
    console.log(`    padded opaque pixels    ${paddedOpaque}`);
    console.log(`    silhouette mismatches   ${silhouetteMismatch}`);
    console.log(`    verdict: ${silhouetteMismatch === 0
      ? 'SAME SOURCE. The raw PNG is what the trim was cut from; only the encoder differs.'
      : 'DIFFERENT SOURCE. The raw PNG has been replaced since the trim was cut.'}`);
    console.log('');
  }
};

main();