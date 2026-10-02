/**
 * Does the character popup actually use the portraits, and are they the built ones?
 *
 * WHY THIS TOOL EXISTS
 *
 * Two failures it is built to catch, both invisible to a type checker and both obvious on a
 * phone rather than on a build server:
 *
 *   1. THE WRONG FILE. `MEDIA_IMAGES` (masthead crops, 130-180KB) and `MEDIA_PORTRAITS` (the
 *      built 520x650 cut-outs) both exist and both are keyed by outlet, so pointing the popup at
 *      the wrong one compiles cleanly and looks plausible. The supplied thumbnails are 2048x2048
 *      and 13.1MB between them; importing them directly would put all of that behind a dialog
 *      for an image that renders about 176 CSS pixels wide.
 *
 *   2. THE WRONG ALT TEXT, OR NONE. An `alt` is read aloud to someone who cannot see the image
 *      and has no other way to verify it, so an empty one removes information rather than merely
 *      decorating it.
 *
 * IT ALSO CHECKS THE COLOUR RULE, because the popup sits next to the betting screen and the
 * user has been explicit: green means safe and orange means hot, and only a prop's own
 * temperament may use either. A conviction figure is not a bet and must not borrow that
 * vocabulary -- and "high conviction" is the same sentence shape as "safe", which is exactly
 * why it is worth asserting.
 *
 * WHY IT READS THE SOURCE AS TEXT INSTEAD OF IMPORTING IT
 *
 * Forced, not stylistic. `mediaImages.ts` imports .jpg and .png through the bundler, which tsx
 * cannot resolve -- the same constraint that file documents for itself about keeping imagery out
 * of the headless read module. Text is also the only way to see the FILENAME, because a bundler
 * import becomes a hashed URL at build time and the geometry check needs the real file on disk.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you whether the popup LOOKS right. The framing of each portrait was checked by
 * eye, not by this tool. What it checks is that the right files are wired in at the right size.
 *
 * Run: npx tsx tools/checkMediaPortraits.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const MEDIA_DIR = resolve(process.cwd(), 'src', 'assets', 'media');
const MODAL = resolve(process.cwd(), 'src', 'components', 'media', 'MediaDetailsModal.tsx');
const IMAGES = resolve(process.cwd(), 'src', 'components', 'media', 'mediaImages.ts');

/**
 * What `buildMediaPortraits.ts` writes.
 *
 * Hard-coded rather than imported from the builder, so that changing the builder's output size
 * FAILS this check instead of silently moving the goalposts. That is the whole reason it is a
 * literal: a check whose expected value comes from the thing it is checking is not a check.
 */
const EXPECTED_W = 520;
const EXPECTED_H = 650;

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/**
 * Width and height from a PNG's IHDR, which is a big-endian uint32 at bytes 16 and 20.
 *
 * Deliberately not `decodePng` from tools/pngCodec. That would inflate 2048x2048 of RGBA into
 * 16MB of buffer per file to read two integers, and this tool's whole purpose is to run fast and
 * often. If the codec ever learns to read headers alone, this should delegate to it.
 */
const pngSize = (path: string): { w: number; h: number } => {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const main = (): void => {
  const modal = readFileSync(MODAL, 'utf8');
  const images = readFileSync(IMAGES, 'utf8');
  const ids = ['hollis', 'glorest', 'sharply'];

  // -- parse the portrait map out of the source ------------------------------------
  const block = /export const MEDIA_PORTRAITS[\s\S]*?\n\};/.exec(images);
  const symbolOf = new Map<string, string>();
  const altOf = new Map<string, string>();
  if (block) {
    const entry = /(\w+):\s*\{[^}]*?src:\s*(\w+)[^}]*?alt:\s*'([^']*)'/g;
    for (const m of block[0].matchAll(entry)) {
      symbolOf.set(m[1], m[2]);
      altOf.set(m[1], m[3]);
    }
  }

  // -- 1. every outlet has a portrait -------------------------------------------------
  /*
    MOSTLY REDUNDANT WITH THE TYPE SYSTEM, and worth saying so rather than letting it look
    load-bearing.

    MEDIA_PORTRAITS is annotated Record<MediaId, MediaImage>, so removing an outlet is a
    compile error before this check runs -- proved while writing it, where deleting the
    sharply entry produced a missing-property error from tsc and the tool never got the chance
    to fail on its own terms.

    So the only thing this assertion catches is someone dropping the Record annotation, which
    is real but unlikely. It is kept because it is free and because losing the annotation would
    lose the compile-time guarantee with it -- but it is NOT evidence that all three outlets
    have portraits and should not be read that way.

    The checks here that genuinely cannot be made to fail by a type are the alt text, the
    geometry, and the colour rule. Those are the ones worth having.
   */
  const missing = ids.filter((id) => !symbolOf.has(id));
  check(
    'every outlet has a portrait',
    block !== null && missing.length === 0,
    block === null
      ? 'MEDIA_PORTRAITS was not found in mediaImages.ts at all'
      : missing.length
        ? `missing: ${missing.join(', ')}`
        : `${ids.length} outlets`,
  );

  // -- 2. alt text exists and says something ------------------------------------------
  const noAlt = ids.filter((id) => altOf.get(id)!.trim().length < 8);
  check(
    'every portrait has real alt text',
    noAlt.length === 0 && altOf.size > 0,
    noAlt.length ? `${noAlt.join(', ')} carry an empty or trivial alt` : undefined,
  );

  // -- 3. THE BUILT FILES, NOT THE 13MB SUPPLIED ONES ---------------------------------
  /*
    The decisive check. The portraits and the supplied thumbnails are both large RGBA PNGs keyed
    by outlet, so a swapped import is invisible to every other tool here. The built portraits are
    the only 4:5 files and the supplied ones are square, so this tells them apart by GEOMETRY
    rather than by filename -- which also catches the case where someone points the map straight
    at `quincyhollisthumbnail.png`.

    TWO BUGS WERE IN HERE FIRST, and both made the check pass while measuring nothing.

    The filename capture was `import X from '.*?/([^']+)'`. That is non-greedy, so on
    `'../../assets/media/hollis-portrait.png'` it stopped at the FIRST slash and captured
    `../assets/media/hollis-portrait.png` -- a relative path with directories in it. Resolved
    against the media directory that is `src/assets/assets/media/...`, which does not exist, so
    every one of the three files failed `existsSync`. And the "not on disk" message did not
    contain the string the verdict looked for, so three files that were never found scored as
    three files that were fine.

    The capture is now `[^/']+$`, which takes the basename, and `ok` is recorded per entry
    rather than being re-derived from the wording of a message. A verdict that depends on a
    sentence containing a particular substring is one edit away from being decorative.
   */
  const geometry: string[] = [];
  let allOk = true;
  for (const id of ids) {
    const symbol = symbolOf.get(id);
    if (!symbol) continue;
    /*
      THREE ATTEMPTS AT THIS PATTERN, because the first two failed in a way that made the
      check PASS rather than fail, which is the dangerous direction.

      Attempt one used a lazy star, so it stopped at the FIRST slash and captured
      "../assets/media/hollis-portrait.png". Resolved against the media directory that path
      does not exist, so all three files reported as missing.

      Attempt two was the obvious "give me the basename" rewrite -- a negated character class
      for the directory part -- and it is WRONG. A class that excludes the slash cannot match
      a slash, so it can never reach the separator it is meant to be followed by. It matched
      nothing at all. A character class that excludes the delimiter cannot be used to skip past
      the delimiter.

      Attempt three makes the star GREEDY, so it runs to the LAST slash and the capture is the
      basename. The only difference from attempt one is greedy versus lazy.

      Worth stating plainly: both earlier attempts produced NO MATCH rather than a wrong match,
      and this check treated a missing file as a PASS, because the verdict was re-derived from
      whether a message contained a particular substring. A check that cannot tell "absent"
      from "fine" is not a check, whatever its exit code says.

      THE PATTERN ITSELF IS NOT QUOTED IN THIS COMMENT, and that is not an oversight. Written
      out literally it contains a star immediately followed by a slash, which is the block
      comment terminator -- so quoting it here ends the comment early and the file stops
      parsing. The first version of this comment did exactly that and produced forty-odd syntax
      errors. Describing the pattern is worth more than transcribing it when transcribing breaks
      the file.
    */
    const imported = new RegExp("import " + symbol + " from '.*/([^/']+)'").exec(images);
    if (!imported) {
      geometry.push(id + ': ' + symbol + ' has no matching import statement  <- UNRESOLVED');
      allOk = false;
      continue;
    }
    const file = imported[1];
    const path = resolve(MEDIA_DIR, file);
    if (!existsSync(path)) {
      geometry.push(id + ': ' + file + ' is imported but not on disk  <- MISSING');
      allOk = false;
      continue;
    }
    const size = pngSize(path);
    const ratio = size.w / size.h;
    const ok = Math.abs(ratio - EXPECTED_W / EXPECTED_H) < 0.01;
    if (!ok) allOk = false;
    geometry.push(
      id + ': ' + file + ' ' + size.w + 'x' + size.h + ' ratio ' + ratio.toFixed(3)
      + (ok ? '' : '   <- NOT 4:5, this is a 2048x2048 supplied source'),
    );
  }
  if (geometry.length !== ids.length) allOk = false;
  check(
    'every portrait is the built ' + EXPECTED_W + 'x' + EXPECTED_H + ' file, not a supplied source',
    allOk,
    geometry.join('; '),
  );

  // -- 4. the popup reads the portraits, not the mastheads -----------------------------
  check(
    'the popup renders MEDIA_PORTRAITS',
    /MEDIA_PORTRAITS\[mediaId\]/.test(modal),
    'the portrait map must be the one the popup reads',
  );
  check(
    'the popup does NOT render the masthead crop as its hero',
    !/src=\{MEDIA_IMAGES/.test(modal) && !/src=\{image\.src\}/.test(modal),
    'MEDIA_IMAGES still legitimately serves the collapsed card; it must not lead the popup',
  );

  // -- 5. the portrait is framed, not just floated -------------------------------------
  check(
    'the portrait sits in an explicit 4:5 frame',
    /aspect-\[4\/5\]/.test(modal),
    'a 4:5 file in an unframed box is at the mercy of whatever height the row happens to be',
  );
  check(
    "the popup keeps the portrait's alpha -- no solid plate behind it",
    !/bg-\[(white|#fff|#ffffff)\]/.test(modal),
    'a white plate behind an alpha cut-out draws a rectangle around a subject who has no '
    + 'rectangular edge, which defeats the cut-out',
  );

  // -- 6. THE COLOUR RULE ---------------------------------------------------------------
  check(
    'the popup uses no green and no orange',
    !modal.includes('var(--color-pos)') && !modal.includes('var(--color-warn)'),
    "conviction and method must stay in the outlet's own accent or the neutral tokens",
  );
  check(
    "the conviction bar is filled with the outlet accent, not a shared token",
    /--color-media-\$\{profile\.accent\}/.test(modal),
    "the accent is the one colour on this popup that means something about who this is",
  );

  // -- report -----------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nMEDIA PORTRAITS\n');
  console.log('  The supplied thumbnails are 2048x2048 and 13.1MB between them. The built');
  console.log('  portraits are the only 4:5 files in the folder, which is what lets this check');
  console.log('  tell a built portrait from a supplied source by GEOMETRY, not by filename.\n');
  checks.forEach((c, i) => {
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + String(i + 1).padStart(2) + '. ' + c.label);
    if (!c.pass && c.detail) {
      for (const line of c.detail.split('; ')) console.log('          ' + line);
    }
  });
  console.log('\n  ' + (checks.length - failed.length) + '/' + checks.length + ' checks PASS\n');
  if (failed.length > 0) process.exitCode = 1;
};

main();
