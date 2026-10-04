/**
 * Node-side rendering of components that import image and font assets, or that use Vite-only
 * `import.meta` APIs.
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * Several checks render real components to static markup so their assertions can be about the
 * MARKUP rather than about a screenshot. That works in Node until the module graph reaches something
 * Node has never heard of. Three such walls, in the order they are hit:
 *
 *   1. `import masthead from '../assets/media/x.jpg'` -- the import RESOLVES fine, Node happily makes
 *      a `file:` URL, and then throws when asked for a module format.
 *   2. `import.meta.env.VITE_SUPABASE_URL` -- Vite substitutes this at build time; under Node it is
 *      undefined and the first property read throws.
 *   3. `import.meta.glob('../../assets/cured logos/*.png', { eager: true })` -- Vite-only, and it is
 *      not decoration: it builds the map that `TeamLogo` resolves a club's crest from, so stubbing it
 *      to `{}` would silently change what the component renders.
 *
 * This used to be misdiagnosed as "tsx cannot load .tsx". It can, and does. The extension in the
 * filename was a coincidence; the failure was an asset three imports away.
 *
 * ============================================================================
 * WHY A LOADER AND NOT STUBS IN THE SOURCE
 * ============================================================================
 *
 * Editing the components would change the thing under test. A loader leaves the source exactly as
 * Vite sees it and changes only what Node is willing to load, so a check keeps rendering the real
 * component.
 *
 * Run: npx tsx --import ./tools/assetStub.mjs tools/checkPropCard.tsx
 *
 * Every other check in tools/ is plain data and runs with bare `npx tsx`. This flag is needed only by
 * checks that render components, because only they reach any of the three walls above.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

register('./assetStubHooks.mjs', import.meta.url);

/**
 * A working `import.meta.glob`, set as a global BEFORE the entry module loads -- `--import` files run
 * first, so this is in place before anything that calls it is evaluated.
 *
 * Only the option shapes this codebase actually uses are honoured, and an unknown shape throws rather
 * than returning something plausible. A glob helper that quietly ignores what it does not recognise is
 * a glob helper that will make a component render the wrong thing and report a clean run.
 */
const readDirIfPresent = (dir) => {
  try {
    return statSync(dir).isDirectory() ? readdirSync(dir) : [];
  } catch {
    return [];
  }
};

/** `*` is the only wildcard used here; treat it as one path segment. */
const expandGlob = (baseDir, pattern) => {
  const segments = pattern.split('/');
  let candidates = [baseDir];
  for (const segment of segments) {
    const next = [];
    for (const dir of candidates) {
      if (!segment.includes('*')) {
        next.push(resolvePath(dir, segment));
        continue;
      }
      const matcher = new RegExp('^' + segment.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      for (const entry of readDirIfPresent(dir)) {
        if (matcher.test(entry)) next.push(resolvePath(dir, entry));
      }
    }
    candidates = next;
  }
  return candidates.filter((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  });
};

globalThis.__gpbGlobFrom = (baseUrl) => (pattern, options = {}) => {
  const baseDir = dirname(fileURLToPath(baseUrl));
  const matches = expandGlob(baseDir, pattern);

  if (options.eager) {
    const wanted = options.import;
    if (wanted !== undefined && wanted !== 'default' && wanted !== '*') {
      throw new Error(`assetStub: unsupported import.meta.glob option import=${JSON.stringify(wanted)}`);
    }
    // Keys stay Vite-shaped, because the component derives a club id from the file name. The value is
    // the same empty stub the asset load hook hands back -- `null`, not `''`, so no `<img src="">`
    // warnings drown out the real failures.
    return Object.fromEntries(matches.map((p) => [p, null]));
  }

  return Object.fromEntries(matches.map((p) => [p, () => Promise.resolve({ default: null })]));
};

void pathToFileURL;
