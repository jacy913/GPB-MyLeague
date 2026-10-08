/**
 * Is the autumn palette actually safe, or does it just look like it?
 *
 * ============================================================================
 * WHY THIS FILE HAS TO EXIST
 * ============================================================================
 *
 * The autumn palette is a hue rotation with luminance held constant, and the entire argument that it
 * is safe rests on that being true. Read the CSS, it is a list of hexes. Nothing in the build
 * compares them to the values they replace, so a designer brightening one "because it looks better"
 * would ship a page where every club colour and every ink tone is quietly wrong -- and every suite
 * would stay green, because each one checks its OWN tokens and none of them check this relationship.
 *
 * That is the same shape as the bug this project keeps paying for: a plausible value describing the
 * wrong thing, found by measurement rather than review.
 *
 * ============================================================================
 * WHAT IT ASSERTS
 * ============================================================================
 *
 *  1. LUMINANCE MATCH, per token. The invariant the whole swap rests on. A designer retuning hue or
 *     chroma passes; a designer brightening the panel fails.
 *  2. Every accent clears 3:1 on the autumn panel -- reported as a DELTA beside the navy figure, so
 *     a regression reads as movement rather than as an absolute that may always have been marginal.
 *  3. Ink does not regress. `--color-ink-faint` is the tightest of the three at 4.71:1 and is the one
 *     that would fail first if the panel were lightened.
 *  4. Every token the block overrides EXISTS in `@theme`. A typo'd token name overrides nothing,
 *     silently, and the page comes out half-themed with nothing reporting it.
 *  5. The selector actually exists in this file, and it outranks `@theme`'s output. `@theme` emits on
 *     `:root` -- specificity (0,1,0) -- while `html[data-season='postseason']` is (0,1,1). If that
 *     ever inverts, the palette is dead code and no browser test would be looking for it.
 *
 * Run: npx tsx tools/checkAutumnPalette.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
let checks = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  checks += 1;
  if (!pass) failures += 1;
  console.log(`  ${pass ? 'PASS  ' : 'FAIL  '}${label}`);
  console.log(`        ${detail}`);
};

const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

/* ------------------------------------------------------------------ colour maths */

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const luminance = (hex: string): number => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const x = luminance(a);
  const y = luminance(b);
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};

console.log('\nAUTUMN PALETTE\n');

/* ------------------------------------------------------------------ 0. the block exists at all */

const block = /html\[data-season='postseason'\]\s*\{([\s\S]*?)\n\}/.exec(css);
check(
  "the css declares an html[data-season='postseason'] block",
  block !== null,
  block
    ? `found at line ${css.slice(0, block.index).split('\n').length}`
    : 'NOT FOUND -- the attribute is set by App.tsx but nothing overrides the tokens, so the palette is dead code',
);

if (!block) {
  console.log(`\n  1 check, ${failures} failed\n`);
  process.exit(1);
}

const autumnTokens = new Map<string, string>();
for (const m of block[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
  autumnTokens.set(`--${m[1]}`, m[2]);
}

// The navy values, read out of the @theme block rather than transcribed. A transcription would be a
// third place for the two palettes to drift apart, which is the failure this file is about.
const themeBlock = /@theme\s*\{([\s\S]*?)\n\}/.exec(css);
const navyTokens = new Map<string, string>();
if (themeBlock) {
  for (const m of themeBlock[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    navyTokens.set(`--${m[1]}`, m[2]);
  }
}

console.log(`  @theme declares ${navyTokens.size} hex tokens; the autumn block overrides ${autumnTokens.size}\n`);

/* ------------------------------------------------------------------ 1. every override exists */

const unknown = [...autumnTokens.keys()].filter((token) => !navyTokens.has(token));
check(
  'every token the autumn block overrides is declared in @theme',
  unknown.length === 0,
  unknown.length
    ? `NOT DECLARED: ${unknown.join(' ')} -- these override nothing, silently, and the page comes out half-themed`
    : `all ${autumnTokens.size} overrides resolve to a real @theme token`,
);

/* ------------------------------------------------------------------ 2. luminance match */

/**
 * 8%, and the number is a tripwire rather than a claim of exactness.
 *
 * The values were derived by searching OKLCH lightness to land near the original WCAG luminance, and
 * the darkest tokens cannot hit it exactly: a warm brown near black only reaches so many luminances
 * inside sRGB. Measured drift runs 0.5% at `base` to 3.9% at `panel-2`, and OKLCH `L` preservation
 * alone -- the first attempt -- drifts further, because perceptual lightness and WCAG luminance are
 * different functions.
 *
 * So 8% sits an order of magnitude above the gamut floor and far below any deliberate edit. Someone
 * brightening the panel "because it looks warmer" moves its luminance by 50-100% and is caught
 * immediately.
 *
 * THE REAL GUARANTEE IS NOT THIS TOLERANCE. It is that the observable contrast relationships are
 * measured directly below and in `checkClubInk`: ink holds at 15.43 -> 15.51, all eighteen accents
 * move by at most 0.05 points and none drops under 3:1, and every club clears the floor in both
 * themes. This check is the coarse alarm; those are the instruments.
 */
const LUMINANCE_TOLERANCE = 0.08;
const luminanceRows: string[] = [];
const luminanceFailures: string[] = [];
for (const [token, autumnHex] of autumnTokens) {
  const navyHex = navyTokens.get(token);
  if (!navyHex) continue;
  const ln = luminance(navyHex);
  const la = luminance(autumnHex);
  const drift = ln > 0 ? Math.abs(la / ln - 1) : Math.abs(la);
  const ok = drift <= LUMINANCE_TOLERANCE;
  if (!ok) luminanceFailures.push(`${token} ${navyHex}->${autumnHex} ${(drift * 100).toFixed(1)}%`);
  luminanceRows.push(
    `      ${token.padEnd(20)} ${navyHex} -> ${autumnHex}   luminance ${ln.toFixed(4)} -> ${la.toFixed(4)}   ${(drift * 100).toFixed(2)}%${ok ? '' : '  <-- OUT OF TOLERANCE'}`,
  );
}

console.log('  2. LUMINANCE MATCH, per token\n');
for (const row of luminanceRows) console.log(row);
console.log('');
check(
  `every autumn token holds its navy counterpart's luminance within ${(LUMINANCE_TOLERANCE * 100).toFixed(0)}%`,
  luminanceFailures.length === 0,
  luminanceFailures.length
    ? luminanceFailures.join('\n        ')
    : `${luminanceRows.length} tokens, worst ${(Math.max(
        ...[...autumnTokens.keys()].map((token) => {
          const navy = navyTokens.get(token);
          if (!navy) return 0;
          const ln = luminance(navy);
          return Math.abs(luminance(autumnTokens.get(token) as string) / ln - 1) * 100;
        }),
      )).toFixed(1)}% -- a coarse alarm for a brightened panel; the guarantee is the ink and accent`
        + `\n        measurements below plus every club clearing the floor in both themes`,
);

/* ------------------------------------------------------------------ 3. accents hold up */

const autumnPanel = autumnTokens.get('--color-panel') ?? '#2a190d';
const navyPanel = navyTokens.get('--color-panel') ?? '#161d2e';

const ACCENTS: Record<string, string> = {
  gold: '--color-gold',
  pos: '--color-pos',
  neg: '--color-neg',
  warn: '--color-warn',
  info: '--color-info',
  neutral: '--color-neutral',
  platinum: '--color-platinum',
  prestige: '--color-prestige',
  'media-hollis': '--color-media-hollis',
  'media-sharply': '--color-media-sharply',
  'media-glorest': '--color-media-glorest',
  'media-sallow': '--color-media-sallow',
  'media-jardins': '--color-media-jardins',
  'media-boyle': '--color-media-boyle',
  'media-mussad': '--color-media-mussad',
  'media-wardley': '--color-media-wardley',
  'media-scintilla': '--color-media-scintilla',
  'media-shinonome': '--color-media-shinonome',
};

console.log('  3. SEMANTIC AND OUTLET ACCENTS, navy panel -> autumn panel\n');
const accentRows: string[] = [];
const accentFailures: string[] = [];
let worstDelta = 0;
for (const [name, token] of Object.entries(ACCENTS)) {
  const hex = navyTokens.get(token);
  if (!hex) {
    accentFailures.push(`${name}: ${token} not found in @theme`);
    continue;
  }
  const onNavy = contrast(hex, navyPanel);
  const onAutumn = contrast(hex, autumnPanel);
  const delta = onAutumn - onNavy;
  worstDelta = Math.max(worstDelta, Math.abs(delta));
  if (onAutumn < 3) accentFailures.push(`${name} drops to ${onAutumn.toFixed(2)}:1`);
  accentRows.push(
    `      ${name.padEnd(17)} ${hex}   navy ${onNavy.toFixed(2).padStart(5)}   autumn ${onAutumn
      .toFixed(2)
      .padStart(5)}   delta ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`,
  );
}
for (const row of accentRows) console.log(row);
console.log('');
check(
  'every semantic and outlet accent still clears 3:1 on the autumn panel',
  accentFailures.length === 0,
  accentFailures.length
    ? accentFailures.join('  ')
    : `${accentRows.length} accents; largest movement ${worstDelta.toFixed(2)} contrast points`,
);

/* ------------------------------------------------------------------ 4. ink does not regress */

const INK_FLOORS: Record<string, number> = { '--color-ink': 4.5, '--color-ink-dim': 4.5, '--color-ink-faint': 4.5 };
console.log('  4. INK ON THE AUTUMN PANEL\n');
const inkRows: string[] = [];
const inkFailures: string[] = [];
for (const [token, floor] of Object.entries(INK_FLOORS)) {
  const hex = navyTokens.get(token);
  if (!hex) {
    inkFailures.push(`${token} not found`);
    continue;
  }
  const onNavy = contrast(hex, navyPanel);
  const onAutumn = contrast(hex, autumnPanel);
  if (onAutumn < floor) inkFailures.push(`${token} ${hex} is ${onAutumn.toFixed(2)}:1, under ${floor}`);
  inkRows.push(`      ${token.padEnd(20)} ${hex}   navy ${onNavy.toFixed(2)}   autumn ${onAutumn.toFixed(2)}   floor ${floor}`);
}
for (const row of inkRows) console.log(row);
console.log('');
check(
  'ink clears its WCAG text floor on the autumn panel',
  inkFailures.length === 0,
  inkFailures.length
    ? inkFailures.join('  ')
    : `--color-ink-faint is the tightest at ${contrast(navyTokens.get('--color-ink-faint') ?? '#fff', autumnPanel).toFixed(2)}:1 and would fail first if the panel were lightened`,
);

/* ------------------------------------------------------------------ 5. the selector wins */

const themeIndex = css.indexOf('@theme');
const blockIndex = css.indexOf("html[data-season='postseason']");
check(
  "the autumn block is declared AFTER @theme, so it wins the cascade",
  blockIndex > themeIndex && themeIndex !== -1,
  `@theme at line ${css.slice(0, themeIndex).split('\n').length}, autumn block at line ${css
    .slice(0, blockIndex)
    .split('\n').length}`
    + `\n        @theme emits on :root -- (0,1,0); html[data-season] is (0,1,1), so it wins on`
    + `\n        specificity regardless of order. The order check is belt-and-braces: if a future`
    + `\n        edit moved this block above @theme and the specificity claim were ever wrong, the`
    + `\n        palette would silently stop applying.`,
);

console.log(`\n  ${checks} checks, ${failures} failed\n`);
process.exitCode = failures === 0 ? 0 : 1;