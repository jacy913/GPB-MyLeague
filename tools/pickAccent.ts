/**
 * Find the accent that maximises the minimum pairwise OKLab distance.
 *
 * The first hand-picked palette failed: jardins and wardley came out 0.090 apart against a floor
 * of 0.10, because the spread was reasoned about on the RGB hue wheel and the measurement is in
 * OKLab. Guessing a second replacement colour is the same mistake with a different number, so
 * this searches instead.
 *
 * It sweeps candidate hex values for the ONE family being moved and keeps whichever maximises
 * the minimum distance across all 28 pairs. The other seven are held fixed, because moving all
 * eight at once would find a palette that satisfies the metric and bears no relation to the
 * character colours already chosen.
 *
 * Run: npx tsx tools/pickAccent.ts <outletId> <hueStartDeg> <hueSpanDeg>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUTLETS = ['hollis', 'glorest', 'sharply', 'sallow', 'jardins', 'boyle', 'mussad', 'wardley', 'shinonome'];

interface Rgb { r: number; g: number; b: number }

const linearise = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

const toOklab = ({ r, g, b }: Rgb) => {
  const lr = linearise(r), lg = linearise(g), lb = linearise(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
};

const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
};
const dist = (x: ReturnType<typeof toOklab>, y: ReturnType<typeof toOklab>): number =>
  Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);

/** OKLCH -> sRGB hex. The search space is generated, not enumerated, so it can be dense. */
const oklchToHex = (L: number, C: number, hDeg: number): string => {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3, m3 = m_ ** 3, s3 = s_ ** 3;
  const r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;
  const enc = (v: number): number => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return '#' + [enc(r), enc(g), enc(bb)].map((v) => v.toString(16).padStart(2, '0')).join('');
};

const main = (): void => {
  const css = readFileSync(resolve(process.cwd(), 'src', 'index.css'), 'utf8');
  const base: Record<string, string> = {};
  for (const id of OUTLETS) {
    base[id] = new RegExp('--color-media-' + id + ':\\s*(#[0-9a-fA-F]{3,8})').exec(css)?.[1] ?? '';
  }

  const target = process.argv[2] ?? 'wardley';
  const hStart = Number(process.argv[3] ?? 60);
  const hSpan = Number(process.argv[4] ?? 90);

  const others = OUTLETS.filter((o) => o !== target).map((o) => toOklab(hexToRgb(base[o])));
  const othersHex = OUTLETS.filter((o) => o !== target);

  let best: { hex: string; min: number; hue: number; L: number } | null = null;

  const lLo = Number(process.argv[5] ?? 0.45);
  const lHi = Number(process.argv[6] ?? 0.82);
  const cLo = Number(process.argv[7] ?? 0.08);
  const cHi = Number(process.argv[8] ?? 0.22);

  for (let L = lLo; L <= lHi; L += 0.01) {
    for (let C = cLo; C <= cHi; C += 0.005) {
      for (let h = hStart; h <= hStart + hSpan; h += 1) {
        const hex = oklchToHex(L, C, h);
        const lab = toOklab(hexToRgb(hex));
        let min = Infinity;
        for (const o of others) min = Math.min(min, dist(lab, o));
        if (!best || min > best.min) best = { hex, min, hue: h, L };
      }
    }
  }

  if (!best) { console.log('no candidate'); return; }
  console.log(`\nbest ${target}: ${best.hex}   OKLab L ${best.L.toFixed(3)}  hue ${best.hue} deg  min pair distance ${best.min.toFixed(4)}`);
  console.log(`  from the current ${base[target]} (min was 0.090)`);

  const lab = toOklab(hexToRgb(best.hex));
  const pairs = othersHex.map((o, i) => ({ o, d: dist(lab, others[i]) })).sort((a, b) => a.d - b.d);
  console.log('  nearest others:');
  for (const p of pairs.slice(0, 3)) console.log('    ' + (p.o + '').padEnd(12) + p.d.toFixed(3));
  console.log('');
};

main();