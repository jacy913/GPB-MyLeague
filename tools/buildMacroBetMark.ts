/**
 * Trim the MacroBet logo to its artwork, for the same reason the outlet marks are trimmed.
 *
 * The supplied file is 2048x2048 and its artwork occupies a 1737x793 band in the middle --
 * 33% of the canvas, with the rest transparent. Shipping the full canvas means the header
 * reserves a square 2.2x wider than the thing it is drawing, so the logo either renders small
 * or pushes the rest of the header around it.
 *
 * The padding is 4px rather than the 8px used for the outlet marks, because this is chrome and
 * not a mark that sits in a column header: the tighter crop keeps the logo from floating in a
 * box of its own next to the tabs.
 *
 * It is also worth being explicit about WHY this file exists rather than being a one-off
 * command: a 714KB 2048px square is a poor thing to hand to a bundler for a 40px-tall wordmark,
 * and the trim is 100% reproducible from the source with no design tool in the loop.
 *
 * Run: npx tsx tools/buildMacroBetMark.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { alphaBounds, crop, decodePng, encodePng } from './pngCodec';

const SRC = 'src/assets/macrobetlogo.png';
const OUT = 'src/assets/macrobetlogo-trim.png';
const PAD = 4;

const main = (): void => {
  const img = decodePng(readFileSync(SRC));
  const bounds = alphaBounds(img);
  if (!bounds) throw new Error('the logo is fully transparent -- there is nothing to crop');

  const trimmed = crop(img, {
    left: Math.max(0, bounds.left - PAD),
    top: Math.max(0, bounds.top - PAD),
    right: Math.min(img.width - 1, bounds.right + PAD),
    bottom: Math.min(img.height - 1, bounds.bottom + PAD),
  });

  const bytes = encodePng(trimmed);
  writeFileSync(OUT, bytes);

  console.log('\nMACROBET MARK\n');
  console.log(`  source     ${SRC}  ${img.width}x${img.height}`);
  console.log(`  artwork    ${bounds.right - bounds.left + 1}x${bounds.bottom - bounds.top + 1}`
    + `  (${(((bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1)) / (img.width * img.height) * 100).toFixed(1)}% of the canvas)`);
  console.log(`  trimmed    ${trimmed.width}x${trimmed.height}  aspect ${(trimmed.width / trimmed.height).toFixed(3)}`);
  console.log(`  written    ${OUT}  ${(bytes.length / 1024).toFixed(0)}KB`
    + `  (from ${(readFileSync(SRC).length / 1024).toFixed(0)}KB)`);
  console.log(`  padding    ${PAD}px per side\n`);
};

main();