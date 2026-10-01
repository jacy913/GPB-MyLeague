/**
 * Will this wordmark actually be legible on the app's dark chrome?
 *
 * The logo is white artwork with thin grey outlines and a silver gradient, on transparency.
 * "White on transparent" reads fine on a dark surface, so the question is not whether the fill
 * is light -- it plainly is -- but whether the parts that are NOT white fill will disappear:
 * the hairline outlines around the swashes, and the chrome gradient on the M and the ball.
 *
 * Those outlines are the whole character of this wordmark. If they are a low-contrast grey at
 * low alpha, then on the app's panel background they will vanish and the logo will render as
 * a white blob with the flourishes missing. That is not visible in a preview against a white
 * page, which is where anyone would look at it.
 *
 * So this samples the artwork rather than the canvas: the luminance range of the visible
 * pixels, and specifically whether any of them are dark enough to disappear against
 * `--color-panel`. A wordmark whose darkest visible pixel sits close to the panel colour has
 * lost its detail on this theme, whatever it looks like on white.
 *
 * Run: npx tsx tools/probeMacroBetContrast.ts
 */

import { readFileSync } from 'node:fs';
import { decodePng, type DecodedImage } from './pngCodec';

const PATH = 'src/assets/macrobetlogo-trim.png';

/** The panel background the logo will actually sit on. */
const PANEL_RGB: [number, number, number] = [16, 18, 24];

const relativeLuminance = (r: number, g: number, b: number): number => {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const contrast = (a: number, b: number): number => {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Perceived luminance of a source pixel over a dark background, given its alpha.
 *
 * Alpha matters and cannot be skipped: a grey outline at alpha 40 composited onto a dark
 * panel is much darker than the same grey at alpha 255, and a logo made of soft edges can
 * composite away to nothing.
 */
const compositeLuminance = (r: number, g: number, b: number, a: number): number => {
  const alpha = a / 255;
  const cr = r * alpha + PANEL_RGB[0] * (1 - alpha);
  const cg = g * alpha + PANEL_RGB[1] * (1 - alpha);
  const cb = b * alpha + PANEL_RGB[2] * (1 - alpha);
  return relativeLuminance(cr, cg, cb);
};

const main = (): void => {
  const img: DecodedImage = decodePng(readFileSync(PATH));
  const panelL = relativeLuminance(...PANEL_RGB);

  const luminances: number[] = [];
  let visible = 0;
  let dark = 0;
  let faint = 0;
  const darkest: Array<{ x: number; y: number; rgba: string; lum: number; contrast: number }> = [];

  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a <= 8) continue;
    visible += 1;
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const lum = compositeLuminance(r, g, b, a);
    luminances.push(lum);
    const c = contrast(lum, panelL);
    if (c < 1.15) dark += 1;
    if (c < 1.4) faint += 1;
    if (darkest.length < 40 && c < 1.6) {
      const px = i / 4;
      darkest.push({
        x: px % img.width,
        y: Math.floor(px / img.width),
        rgba: `(${r},${g},${b},${a})`,
        lum,
        contrast: c,
      });
    }
  }

  luminances.sort((x, y) => x - y);
  const pct = (q: number) => luminances[Math.min(luminances.length - 1, Math.floor(luminances.length * q))];

  console.log('\nMACROBET LOGO CONTRAST, composited onto --color-panel\n');
  console.log(`  panel luminance       ${panelL.toFixed(4)}`);
  console.log(`  visible pixels        ${visible.toLocaleString()} of ${(img.width * img.height).toLocaleString()}`);
  console.log(`  composited luminance  p01 ${pct(0.01).toFixed(4)}   p10 ${pct(0.10).toFixed(4)}   p50 ${pct(0.5).toFixed(4)}   p90 ${pct(0.9).toFixed(4)}   p99 ${pct(0.99).toFixed(4)}`);

  const brightShare = luminances.filter((l) => contrast(l, panelL) > 2).length / luminances.length;
  console.log(`  share above 2:1 contrast   ${(brightShare * 100).toFixed(1)}%  <- the readable part`);
  console.log(`  share below 1.4:1 contrast  ${((faint / luminances.length) * 100).toFixed(1)}%  <- the flourishes`);
  console.log(`  share below 1.15:1 contrast ${((dark / luminances.length) * 100).toFixed(1)}%  <- effectively invisible`);

  darkest.sort((a, b) => a.contrast - b.contrast);
  if (darkest.length > 0) {
    console.log('\n  DARKEST VISIBLE PIXELS (these are the outlines that could disappear)');
    darkest.slice(0, 6).forEach((d) => {
      console.log(`    (${d.x},${d.y}) ${d.rgba.padEnd(20)} contrast ${d.contrast.toFixed(3)}`);
    });
  }

  console.log('\n  VERDICT');
  if (brightShare > 0.5 && faint / luminances.length < 0.25) {
    console.log('    LEGIBLE. Most of the wordmark is high-contrast on the panel, and the');
    console.log('    low-contrast flourishes are a small minority.');
  } else if (faint / luminances.length > 0.4) {
    console.log('    MOSTLY INVISIBLE OUTLINE. A large share of the artwork sits within 1.4:1 of');
    console.log('    the panel, so the swashes and hairline strokes will drop out on this theme');
    console.log('    even though the word reads on a white preview. Needs a treatment: a light');
    console.log('    plate behind the logo, or a re-export with stronger outline contrast.');
  } else {
    console.log('    MIXED. The word will read; the decorative strokes may not. Worth eyeballing on');
    console.log('    the real chrome before shipping.');
  }
  console.log();
};

main();