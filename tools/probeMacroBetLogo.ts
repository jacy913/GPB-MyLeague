/**
 * The MacroBet logo: what shape is it, and does it have usable transparency?
 *
 * It arrives at 2048x2048 RGBA, but the preview shows white artwork on a white field, and
 * "has an alpha channel" and "has transparency" are not the same thing. A logo that is
 * opaque white inside a bounding box will render as a white rectangle on this app's dark
 * chrome, which is the single most likely way this change goes wrong.
 *
 * So: the alpha bounding box, the actual opacity distribution, and the corner and centre
 * pixels. What comes back decides whether the header gets the file as supplied, a trim, or
 * needs the user to re-export it.
 *
 * Run: npx tsx tools/probeMacroBetLogo.ts
 */

import { readFileSync } from 'node:fs';
import { alphaBounds, decodePng, type DecodedImage } from './pngCodec';

const PATH = 'src/assets/macrobetlogo.png';

const pixelAt = (img: DecodedImage, x: number, y: number): string => {
  const i = (y * img.width + x) * 4;
  return `(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]},${img.data[i + 3]})`;
};

const main = (): void => {
  const img = decodePng(readFileSync(PATH));
  const total = img.width * img.height;
  const bounds = alphaBounds(img);

  let opaque = 0;
  let partial = 0;
  let transparent = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  let sumAlpha = 0;
  for (let i = 3; i < img.data.length; i += 4) {
    const a = img.data[i];
    if (a === 255) opaque += 1;
    else if (a === 0) transparent += 1;
    else partial += 1;
    if (a < minAlpha) minAlpha = a;
    if (a > maxAlpha) maxAlpha = a;
    sumAlpha += a;
  }
  const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;

  console.log('\nMACROBET LOGO\n');
  console.log(`  size                ${img.width}x${img.height}`);
  console.log(`  alpha bbox          ${bounds ? `${bounds.left},${bounds.top} -> ${bounds.right},${bounds.bottom}  (${bounds.right - bounds.left + 1}x${bounds.bottom - bounds.top + 1})` : 'none'}`);
  console.log(`  fully opaque        ${pct(opaque)}`);
  console.log(`  partially opaque    ${pct(partial)}`);
  console.log(`  fully transparent   ${pct(transparent)}`);
  console.log(`  alpha range         ${minAlpha}-${maxAlpha}, mean ${(sumAlpha / total).toFixed(1)}`);
  console.log(`  corners             ${pixelAt(img, 0, 0)}  ${pixelAt(img, img.width - 1, 0)}  ${pixelAt(img, 0, img.height - 1)}  ${pixelAt(img, img.width - 1, img.height - 1)}`);
  console.log(`  centre              ${pixelAt(img, img.width >> 1, img.height >> 1)}`);
  console.log(`  quarter             ${pixelAt(img, img.width >> 2, img.height >> 2)}`);

  const artSharesCanvas = bounds
    ? ((bounds.right - bounds.left + 1) * (bounds.bottom - bounds.top + 1)) / total
    : 1;

  console.log('\n  VERDICT');
  if (transparent / total > 0.5 && bounds) {
    console.log(`    TRANSPARENT BACKGROUND. Artwork occupies ${(artSharesCanvas * 100).toFixed(1)}% of the`);
    console.log('    canvas and the rest is see-through, so it can sit directly on the app chrome.');
  } else if (opaque / total > 0.9) {
    console.log('    OPAQUE BACKGROUND. This will render as a white block on the dark chrome.');
    console.log('    It needs keying out before it can be used, or a light container behind it.');
  } else {
    console.log(`    MIXED. Only ${pct(transparent)} transparent, so there is a visible field around the`);
    console.log('    artwork. Treat as opaque unless the corners prove otherwise.');
  }

  const cornersClear = ['0,0', `${img.width - 1},0`, `0,${img.height - 1}`, `${img.width - 1},${img.height - 1}`]
    .map((c) => c.split(',').map(Number))
    .every(([x, y]) => img.data[(y * img.width + x) * 4 + 3] === 0);
  console.log(`    all four corners fully transparent: ${cornersClear ? 'yes' : 'NO'}`);
  console.log(`    artwork aspect (w/h): ${bounds ? (((bounds.right - bounds.left + 1) / (bounds.bottom - bounds.top + 1)).toFixed(3)) : 'n/a'}`);
  console.log();
};

main();