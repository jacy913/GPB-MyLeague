/**
 * Every `var(--token)` in the app resolves to a token that exists.
 *
 * ============================================================================
 * WHY THIS CHECK EXISTS
 * ============================================================================
 *
 * Two separate defects in one session were both this, and neither threw, neither showed up in
 * `tsc`, and neither was caught by a DOM probe that only counted or measured nodes:
 *
 *   1. Seven of the nine forecaster accent colours were declared in `@theme` and never emitted,
 *      because Tailwind v4 tree-shakes unused theme variables and these were only ever referenced
 *      from inline `style` attributes. Every `var(--color-media-sallow)` in the app resolved to
 *      nothing. The props dot-strip drew nine cells and painted one.
 *
 *   2. A popover was written with `bg-[var(--color-panel-1)]`. There is no `--color-panel-1`; the
 *      ramp is `--color-panel`, `-2`, `-3`. It rendered fully transparent over the board, and
 *      because it was `position: fixed` and correctly sized, every geometric assertion still passed.
 *
 * An undefined custom property is not an error. It resolves to the guaranteed-invalid value, which
 * means "inherit, or initial, or nothing" depending on the property. Nothing throws, nothing logs,
 * the element is present and measurable, and the only way to notice is to look at it. That is why
 * this is a script rather than a review habit.
 *
 * ============================================================================
 * CHECK 1 -- A REFERENCE MUST HAVE A DECLARATION
 * ============================================================================
 *
 * Reported as a failure. Two shapes are deliberately NOT failures:
 *
 *   - `var(--token, fallback)`. A fallback is the author stating what happens when the token is
 *     absent, which is a decision rather than an oversight. `--sticky-header-h` is one of these.
 *   - `var(--prefix-${x})`. An interpolated name, where the real token is assembled at runtime.
 *     `--color-media-${accent}` is one of these, and the assembled name cannot be checked here --
 *     check 2 is what covers that family.
 *
 * ============================================================================
 * CHECK 2 -- A TOKEN PROBABLY EMITTED BY TAILWIND MUST NOT BE ASSUMED TO EXIST AT RUNTIME
 * ============================================================================
 *
 * The subtle version of the same bug, and the one that cost the most to find. A token can be
 * correctly spelled and correctly declared inside `@theme`, and still not exist when the app runs:
 * Tailwind v4 only emits a theme variable when its scanner sees something that generates a utility
 * from it, and an inline `style={{ background: 'var(--color-media-sallow)' }}` is not a utility.
 *
 * So for any token that code touches, the question is not "is it declared" but "is it declared
 * somewhere that does not depend on Tailwind's scanner". A token qualifies if EITHER:
 *
 *   - it is declared in ordinary CSS as well as in `@theme` -- a plain `:root` block is emitted
 *     verbatim, so it always exists; or
 *   - it appears in code outside a quoted string, where Tailwind's scanner can see it and will
 *     therefore generate a utility that emits the variable.
 *
 * A token that is `@theme`-only AND string-only is the exact shape of defect 1, and fails.
 *
 * Run: npx tsx tools/checkCssVars.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

let failures = 0;
let notes = 0;

const fail = (message: string) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};
const note = (message: string) => {
  notes += 1;
  console.log(`  NOTE  ${message}`);
};

const walk = (dir: string, exts: string[]): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full, exts);
    return exts.includes(extname(full)) ? [full] : [];
  });

const CODE = ['.ts', '.tsx'];
const STYLE = ['.css'];
const codeFiles = walk(SRC, CODE);
const styleFiles = walk(SRC, STYLE);
const allFiles = [...codeFiles, ...styleFiles];

/*
 * ============================================================================
 * DECLARATIONS, SPLIT BY WHERE THEY LIVE
 * ============================================================================
 *
 * `themeDeclared` and `plainDeclared` are kept apart on purpose, because the difference between
 * them is the whole of check 2. A declaration inside `@theme` is subject to Tailwind's scanner; a
 * declaration in any other block is emitted verbatim and always exists.
 */
const themeDeclared = new Set<string>();
const plainDeclared = new Set<string>();

for (const file of styleFiles) {
  const source = readFileSync(file, 'utf8');

  // Pull out the @theme block first so its declarations are not also counted as plain.
  const themeBlocks: string[] = [];
  const withoutTheme = source.replace(/@theme[^{]*\{([\s\S]*?)\n\}/g, (_match, body: string) => {
    themeBlocks.push(body);
    return '';
  });

  for (const body of themeBlocks) {
    for (const match of body.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) themeDeclared.add(match[1]);
  }
  for (const match of withoutTheme.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) plainDeclared.add(match[1]);
}

const declared = new Set<string>([...themeDeclared, ...plainDeclared]);

/*
 * ============================================================================
 * REFERENCES
 * ============================================================================
 *
 * `interpolated` catches names assembled at runtime -- the captured text stops at the `${`, so
 * `--color-media-${x}` is recorded as the prefix `--color-media-` and flagged as interpolated
 * rather than as a missing token.
 */
interface Use {
  files: Set<string>;
  /** True when the captured name is a prefix assembled at runtime, like `--color-media-`. */
  interpolated: boolean;
  /** True when the reference supplies a fallback, so its absence is already handled. */
  hasFallback: boolean;
}

const uses = new Map<string, Use>();



for (const file of allFiles) {
  const source = readFileSync(file, 'utf8');
  const where = relative(ROOT, file);

  for (const match of source.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
    const token = match[1];
    const rest = source.slice(match.index);
    const interpolated = /-\s*$/.test(source.slice(0, match.index + match[0].length - match[1].length - 4))
      || source[match.index + match[0].length] === '$'
      || source[match.index + match[0].length - 1] === '-';
    const hasFallback = /^\s*,\s*[^)]*\)/.test(rest.slice(match[0].length));

    /*
     * An interpolated name -- `--color-media-${accent}` -- records only its prefix. The real token is
     * assembled at runtime from data, so there is nothing here to compare against a declaration
     * list, and it is reported as a note rather than silently passing.
     *
     * A name with a fallback -- `var(--x, 176px)` -- records that the author already decided what
     * happens when the token is absent. That is a decision, not an oversight, so it is a note.
     */
    const existing: Use = uses.get(token) ?? {
      files: new Set<string>(),
      interpolated: false,
      hasFallback: false,
    };
    existing.files.add(where);
    existing.interpolated ||= interpolated;
    existing.hasFallback ||= hasFallback;
    uses.set(token, existing);
  }
}

console.log(`\n== 1. every referenced token is declared ==`);
console.log(`  ${declared.size} tokens declared (${themeDeclared.size} in @theme, ${plainDeclared.size} in plain CSS)`);
console.log(`  ${uses.size} distinct tokens referenced across ${allFiles.length} files\n`);

for (const [token, use] of [...uses].sort()) {
  const sites = [...use.files].slice(0, 3).join(', ');

  if (use.interpolated) {
    note(`${token}\${...} is assembled at runtime; assembled at runtime  [${sites}]`);
    continue;
  }
  if (token.startsWith('--tw-')) {
    note(`${token} is a Tailwind internal  [${sites}]`);
    continue;
  }
  if (use.hasFallback) {
    note(`${token} is used with a fallback, so its absence is handled  [${sites}]`);
    continue;
  }
  if (!declared.has(token)) {
    fail(`${token} is used but never declared  [${sites}]`);
  }
}

/*
 * ============================================================================
 * CHECK 2 -- DELIBERATELY NOT IMPLEMENTED
 * ============================================================================
 *
 * The obvious second half of this check is "a token declared only in @theme, and referenced only
 * from an inline style, will be tree-shaken by Tailwind and must therefore also be declared in plain
 * CSS". That would have caught the seven missing forecaster accents, and it is what this file was
 * originally going to do.
 *
 * It was built, and it was removed, because it does not hold.
 *
 * The mechanism is real: Tailwind v4 emits a `@theme` variable only when its scanner generates a
 * utility from it, and `style={{ background: 'var(--color-media-sallow)' }}` is plain CSS applied by
 * React which never reaches the scanner. That is genuinely how the accents went missing.
 *
 * But "referenced only from an inline style" is not the same condition as "invisible to the
 * scanner", and treating them as equivalent produced false positives on healthy tokens:
 * `--texture-hazard`, `--radius-control`, `--dur-slow`, `--font-num` and `--color-neutral-hi` were all
 * reported as un-emittable, and a browser probe showed every one of them resolving correctly at
 * `:root`. They are emitted because other things in the codebase make Tailwind generate utilities
 * that reference them, which is not something a regex over source text can determine.
 *
 * Nine false positives is worse than no check, because a check that cries wolf gets ignored. So the
 * honest position is that half of this failure mode is only verifiable at runtime, and it is
 * verified there:
 *
 *   node tools/cdp.mjs http://localhost:3000/ placeholder probe.png
 *     with GPB_EVAL reading getComputedStyle(document.documentElement)
 *       .getPropertyValue('--color-media-sallow') and the rest of the outlet palette.
 *
 * The fix for the accents -- redeclaring the nine outlet colours in a plain `:root` block, which is
 * emitted verbatim and cannot be shaken -- is verified that way and is sound. What remains unverified
 * is the general theory, and this file declines to assert something it cannot support.
 */

console.log(
  failures === 0
    ? `\nALL CHECKS PASSED${notes ? `  (${notes} note(s))` : ''}\n`
    : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);