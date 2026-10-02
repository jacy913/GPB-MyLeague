/**
 * Are the eight outlet accents actually distinguishable?
 *
 * WHY THIS TOOL EXISTS
 *
 * `plan/gpb-macrobet-hxse.md` §2.2 requires five new accent token families and warns that the
 * constraint "must be distinguishable from each other AND from the existing three, on a navy
 * field, at 28px" is "the constraint most likely to fail on first pass and it cannot be checked
 * in isolation".
 *
 * Eight hues chosen by eye is eight hues chosen by hope. Two blues that look obviously different
 * on a colour wheel are much closer once they are 18%-opacity borders and dim text on a dark
 * surface, and nobody notices until three outlets are on screen at once.
 *
 * So this measures. Hues are converted to OKLab -- a perceptually uniform space, so a fixed
 * numeric distance means roughly the same amount of visible difference everywhere -- and every
 * pair is reported by distance. The closest pairs are named rather than averaged away, because
 * "all eight are fine on average" is how a palette with one unusable pair passes.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot see the screen. It measures the tokens, not their rendering, and it knows nothing
 * about the 28px size or the navy field beyond the luminance contrast it is given. A palette can
 * pass here and still be hard to read at 28px on the actual background. This narrows the problem;
 * it does not close it.
 *
 * Run: npx tsx tools/checkMediaAccents.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = resolve(process.cwd(), 'src', 'index.css');

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/** The eight outlets, in the order they appear in index.css. */
const OUTLETS = ['hollis', 'glorest', 'sharply', 'sallow', 'jardins', 'boyle', 'mussad', 'wardley'];

/**
 * The minimum OKLab distance between any two accents.
 *
 * CHOSEN BY REASONING, NOT BY RUNNING THE TOOL AND SEEING WHAT CAME OUT.
 *
 * OKLab's L axis spans roughly 0 to 1 for sRGB, and a difference of 0.05 in any single channel is
 * around the threshold at which two flat fills stop being reliably distinguishable side by side
 * at small size. 0.10 as a three-dimensional distance is therefore about "clearly different",
 * and it is the bar every pair must clear.
 *
 * It is deliberately not loosened after the fact. If the palette cannot clear it, the palette
 * changes -- see the comment in index.css, which names mussad and sharply as the tightest pair
 * and says so before anyone has to discover it.
 */
const MIN_OKLAB_DISTANCE = 0.10;

/** A `-hi` variant must be lighter than its base, or it is not an on-dark variant. */
const MIN_HI_LIFT = 0.05;

interface Rgb { r: number; g: number; b: number }

const hexToRgb = (hex: string): Rgb => {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
};

/** sRGB -> linear, then the OKLab matrices (Björn Ottosson). */
const linearise = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const toOklab = ({ r, g, b }: Rgb): { L: number; a: number; b: number } => {
  const lr = linearise(r);
  const lg = linearise(g);
  const lb = linearise(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

const distance = (x: { L: number; a: number; b: number }, y: { L: number; a: number; b: number }): number =>
  Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);

const main = (): void => {
  const css = readFileSync(CSS, 'utf8');

  const base: Record<string, string> = {};
  const hi: Record<string, string> = {};
  const dim: Record<string, string> = {};

  for (const id of OUTLETS) {
    base[id] = new RegExp('--color-media-' + id + ':\\s*(#[0-9a-fA-F]{3,8})').exec(css)?.[1] ?? '';
    hi[id] = new RegExp('--color-media-' + id + '-hi:\\s*(#[0-9a-fA-F]{3,8})').exec(css)?.[1] ?? '';
    dim[id] = new RegExp('--color-media-' + id + '-dim:\\s*(rgba\\([^)]+\\))').exec(css)?.[1] ?? '';
  }

  // -- 1. every family is complete -------------------------------------------------
  const incomplete = OUTLETS.filter((id) => !base[id] || !hi[id] || !dim[id]);
  check(
    'every outlet has a base, a -hi and a -dim accent token',
    incomplete.length === 0,
    incomplete.length
      ? `incomplete: ${incomplete.join(', ')}`
      : `${OUTLETS.length} families, ${OUTLETS.length * 3} tokens`,
  );
  if (incomplete.length > 0) {
    console.log('\nMEDIA ACCENTS\n');
    console.log('  ' + incomplete.join(', ') + ' has no complete accent family.\n');
    process.exitCode = 1;
    return;
  }

  const labs: Record<string, { L: number; a: number; b: number }> = {};
  for (const id of OUTLETS) labs[id] = toOklab(hexToRgb(base[id]));

  // -- 2. every pair clears the distance floor --------------------------------------
  const pairs: Array<{ a: string; b: string; d: number }> = [];
  for (let i = 0; i < OUTLETS.length; i += 1) {
    for (let j = i + 1; j < OUTLETS.length; j += 1) {
      pairs.push({ a: OUTLETS[i], b: OUTLETS[j], d: distance(labs[OUTLETS[i]], labs[OUTLETS[j]]) });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  const tooClose = pairs.filter((p) => p.d < MIN_OKLAB_DISTANCE);
  check(
    `every pair of accents is at least ${MIN_OKLAB_DISTANCE} apart in OKLab`,
    tooClose.length === 0,
    tooClose.length
      ? tooClose.map((p) => `${p.a}/${p.b} at ${p.d.toFixed(3)}`).join('; ')
      : `closest pair is ${pairs[0].a}/${pairs[0].b} at ${pairs[0].d.toFixed(3)}`,
  );

  // -- 3. the -hi is lighter than its base -------------------------------------------
  /*
    An on-dark variant has to be LIGHTER or the outlet's name is dimmer on the popup than its
    border is on the card. This is a cheap check and it catches a copy-paste where a whole family
    was pasted with its `-hi` and `-dim` left over from the previous outlet.
   */
  const notLifted = OUTLETS.filter((id) => toOklab(hexToRgb(hi[id])).L - labs[id].L < MIN_HI_LIFT);
  check(
    `every -hi accent is at least ${MIN_HI_LIFT} in L lighter than its base`,
    notLifted.length === 0,
    notLifted.length
      ? notLifted.map((id) => `${id} lifts ${(toOklab(hexToRgb(hi[id])).L - labs[id].L).toFixed(3)}`).join('; ')
      : undefined,
  );

  // -- 4. the -dim carries alpha, because it is used as a fill ----------------------
  const noAlpha = OUTLETS.filter((id) => {
    const m = /rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/.exec(dim[id]);
    return !m || Number(m[1]) === 0;
  });
  check(
    'every -dim accent is a translucent fill',
    noAlpha.length === 0,
    noAlpha.length ? `no usable alpha: ${noAlpha.join(', ')}` : undefined,
  );

  // -- 5. contrast against the navy field -------------------------------------------
  /*
    Relative luminance against the panel surface. This is a WEAK check and is labelled as one:
    it only catches an accent so dark it disappears, not one that is merely hard to read at
    28px. A real legibility test needs the rendered screen.
   */
  const bg = new RegExp('--color-panel:\\s*(#[0-9a-fA-F]{3,8})').exec(css)?.[1];
  const relLum = ({ r, g, b }: Rgb): number =>
    0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
  const contrast = (x: Rgb, y: Rgb): number => {
    const a = relLum(x);
    const b = relLum(y);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const tooDark = bg
    ? OUTLETS.filter((id) => contrast(hexToRgb(hi[id]), hexToRgb(bg)) < 3)
    : [];
  check(
    'every -hi accent clears 3:1 against the panel surface',
    tooDark.length === 0,
    tooDark.length
      ? tooDark.map((id) => `${id} at ${contrast(hexToRgb(hi[id]), hexToRgb(bg!)).toFixed(2)}:1`).join('; ')
      : bg ? `panel ${bg}` : 'could not read --color-panel from index.css',
  );

  // -- report ------------------------------------------------------------------------
  console.log('\nMEDIA ACCENTS\n');
  console.log('  Eight hues have to be told apart at 28px on the panel surface. Picked by eye');
  console.log('  they are picked by hope, so every pair is measured in OKLab, which is');
  console.log('  perceptually uniform: a fixed number means the same visible difference everywhere.\n');
  console.log('  outlet     base      hue    L      -hi contrast');
  for (const id of OUTLETS) {
    const lab = labs[id];
    const rgb = hexToRgb(base[id]);
    // Hue angle in OKLab, which is what "these two are both blue-ish" actually means.
    const hue = ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
    console.log(
      '  ' + id.padEnd(10) + base[id].padEnd(9)
      + hue.toFixed(0).padStart(3) + ' deg'
      + lab.L.toFixed(3).padStart(8)
      + (bg ? (contrast(hexToRgb(hi[id]), hexToRgb(bg)).toFixed(2) + ':1').padStart(12) : ''),
    );
  }

  console.log('\n  CLOSEST PAIRS (all ' + pairs.length + ' of them are checked; these are the tightest)');
  for (const p of pairs.slice(0, 5)) {
    const mark = p.d < MIN_OKLAB_DISTANCE ? '  <-- TOO CLOSE' : '';
    console.log('    ' + (p.a + ' / ' + p.b).padEnd(24) + p.d.toFixed(3) + mark);
  }

  console.log('\n  NOTE: the five new marks are PHOTOGRAPHS, not crests, so two outlets with');
  console.log('  nearby hues are separated by their outline where two flat logos of the same hue');
  console.log('  would not be. That is a mitigation, not a fix, and the tightest pair above is');
  console.log('  reported by name rather than averaged away.\n');

  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) {
      for (const line of c.detail.split('; ')) console.log('          ' + line);
    }
  });
  const failed = checks.filter((c) => !c.pass);
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();