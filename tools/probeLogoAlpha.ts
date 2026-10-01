/**
 * Does the supplied replacement logo have a usable alpha channel?
 *
 * The new Glorest mark arrived as a 1024x1024 PNG, where the previous one was a 1408x768
 * canvas with the artwork small and centred in a large transparent margin. That difference
 * matters a great deal to the trim pipeline, and it is worth measuring rather than assuming:
 *
 *   - If the corners are TRANSPARENT, the alpha bounding box finds the artwork and the
 *     existing rule works unchanged.
 *   - If the corners are OPAQUE WHITE, the bounding box is the whole canvas, the trim becomes
 *     the entire image, and the logo ships with a white box around it -- which shows as a
 *     white rectangle on every dark surface in the app.
 *
 * This distinguishes those cases, and also reports partial-alpha coverage so a logo with a
 * soft drop shadow is not mistaken for one with a hard matte.
 *
 * Run: npx tsx tools/probeLogoAlpha.ts
 */

import { readFileSync } from 'node:fs';
import { alphaBounds, decodePng, type DecodedImage } from './pngCodec';

const DIR = 'src/assets/media/';

const FILES = ['glorestpresslogo (2).png', 'glorestpresslogo.png'];

const pixelAt = (img: DecodedImage, x: number, y: number): string => {
  const i = (y * img.width + x) * 4;
  return `rgba(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]},${img.data[i + 3]})`;
};

const main = (): void => {
  console.log('\nLOGO ALPHA SURVEY\n');

  FILES.forEach((name) => {
    const img = decodePng(readFileSync(DIR + name));
    const bounds = alphaBounds(img);
    const total = img.width * img.height;

    let opaque = 0;
    let partial = 0;
    let transparent = 0;
    let minAlpha = 255;
    let maxAlpha = 0;
    for (let i = 3; i < img.data.length; i += 4) {
      const a = img.data[i];
      if (a === 255) opaque += 1;
      else if (a === 0) transparent += 1;
      else partial += 1;
      if (a < minAlpha) minAlpha = a;
      if (a > maxAlpha) maxAlpha = a;
    }

    const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
    console.log(`  ${name}`);
    console.log(`    size                ${img.width}x${img.height}`);
    console.log(`    alpha bbox          ${bounds ? `${bounds.left},${bounds.top} -> ${bounds.right},${bounds.bottom}  (${bounds.right - bounds.left + 1}x${bounds.bottom - bounds.top + 1})` : 'fully transparent'}`);
    console.log(`    fully opaque        ${pct(opaque)}`);
    console.log(`    partially opaque    ${pct(partial)}`);
    console.log(`    fully transparent   ${pct(transparent)}`);
    console.log(`    lowest alpha seen   ${minAlpha}`);
    console.log(`    highest alpha seen  ${maxAlpha}`
      + `${maxAlpha < 255 ? `   <-- nothing in this file is fully opaque; the whole logo renders ${((255 - maxAlpha) / 255 * 100).toFixed(1)}% translucent` : ''}`);

    /*
     * THE VEIL CHECK.
     *
     * A near-transparent haze across the whole canvas is the failure mode that matters and it
     * is invisible on a white background, which is exactly where a logo is usually inspected.
     * On a dark surface it renders as a faint rectangle. So the alpha is sampled on a coarse
     * grid over the margin, well away from the artwork, and anything above the alpha floor
     * there is a veil.
     *
     * Sampled rather than inferred from the totals: 71% of the canvas being fully transparent
     * is consistent with both "clean margin with a little edge noise" and "a faint veil over
     * everything", and those need different answers.
     */
    const bound = alphaBounds(img);
    let veilSamples = 0;
    let veilMax = 0;
    if (bound) {
      const grid = 16;
      for (let gy = 1; gy < grid; gy += 1) {
        for (let gx = 1; gx < grid; gx += 1) {
          const x = Math.floor((gx * img.width) / grid);
          const y = Math.floor((gy * img.height) / grid);
          const inside = x >= bound.left && x <= bound.right && y >= bound.top && y <= bound.bottom;
          if (inside) continue;
          const a = img.data[(y * img.width + x) * 4 + 3];
          veilSamples += 1;
          if (a > veilMax) veilMax = a;
        }
      }
    }
    console.log(`    margin samples      ${veilSamples}, highest alpha outside the artwork ${veilMax}`
      + `${veilMax > 8 ? '   <-- VEIL: a faint box will render on dark surfaces' : '   clean margin'}`);
    console.log(`    corners             ${pixelAt(img, 0, 0)}  ${pixelAt(img, img.width - 1, 0)}  ${pixelAt(img, 0, img.height - 1)}  ${pixelAt(img, img.width - 1, img.height - 1)}`);
    console.log(`    centre              ${pixelAt(img, img.width >> 1, img.height >> 1)}`);

    // The first version of this verdict keyed on the four CORNER pixels being alpha 0 and called
    // the new logo "mixed -- inspect before trusting an automatic trim". That was the wrong
    // test: the corner pixels there are alpha 1 to 4, which is a few pixels of edge rounding at
    // the very border of the canvas and nothing else. A 16x16 grid across the margin finds 120
    // sample points outside the artwork and every one is alpha 0, which is the measurement that
    // actually answers the question.
    const bboxFillsCanvas = bounds !== null
      && bounds.left === 0 && bounds.top === 0
      && bounds.right === img.width - 1 && bounds.bottom === img.height - 1;

    const verdict = bboxFillsCanvas
      ? 'OPAQUE TO THE EDGE -- the alpha bbox is the whole canvas, so the trim would be the entire'
        + ' image and the logo would ship with a solid box around it'
      : veilMax > 8
        ? 'VEIL DETECTED -- a faint non-transparent haze covers the margin and will render as a'
          + ' rectangle on any dark surface. Do not trim this automatically.'
        : bounds && bounds.left > 0 && bounds.top > 0 && bounds.right < img.width - 1 && bounds.bottom < img.height - 1
          ? 'TRANSPARENT MARGIN -- the existing trim rule applies unchanged'
          : 'artwork touches at least one canvas edge -- the bbox crop will lose nothing, but check it';

    console.log(`    verdict             ${verdict}`);
    console.log('');
  });
};

main();