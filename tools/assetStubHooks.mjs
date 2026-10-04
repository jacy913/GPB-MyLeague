/**
 * The hook half of `assetStub.mjs`. See that file for why.
 *
 * Two things go wrong when Node renders a real component, in this order.
 *
 *   1. An asset import. `import masthead from '../assets/media/x.jpg'` RESOLVES -- Node produces a
 *      `file:` URL perfectly happily -- and then fails when asked for a module format. So this is a
 *      `load` hook, not a `resolve` hook: catching it in `resolve` would mean second-guessing
 *      extensions Node already resolved, which is where a broad stub starts hiding genuinely missing
 *      modules.
 *
 *   2. `import.meta.env`. Vite replaces it at build time. Under Node it is undefined, and the very
 *      first property read throws `Cannot read properties of undefined`. Anything importing
 *      `lib/supabaseClient` -- which is most of the app -- dies here.
 *
 * ============================================================================
 * WHY THE ENV SHIM REWRITES TEXT INSTEAD OF PREPENDING A LINE
 * ============================================================================
 *
 * The obvious fix is to prepend `import.meta.env ??= {}` to every file. That shifts every line number
 * by one, so the first error in a failing check points at the wrong line, and a suite that exists to
 * tell you what is wrong should not be the thing making it harder to find out.
 *
 * Rewriting the expression to `(globalThis.__gpbEnv ??= {})` is self-initialising, needs no prelude,
 * and leaves every line where it was.
 *
 * ============================================================================
 * SCOPE, DELIBERATELY NARROW
 * ============================================================================
 *
 * Only asset URLs are stubbed, and only files inside this project are rewritten -- never `node_modules`,
 * where `import.meta.env` has a legitimate meaning we would be overwriting.
 */
import { fileURLToPath } from 'node:url';

/** Only these. A `.ts` file that fails to resolve must still throw. */
const ASSET = /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico|mp3|mp4|m4a|wav|ogg|webm|woff2?|ttf|otf|eot)$/i;

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;

/**
 * An empty module with a default export, because `import masthead from './x.jpg'` needs one to bind.
 *
 * The default is `null` rather than `''` deliberately. A stubbed crest is still rendered into an
 * `<img src>`, and React warns loudly about an empty string there -- which would bury the actual
 * failures under several hundred lines of an artefact of stubbing. `null` draws the same fallback
 * (`logoUrl && ...` is falsy either way, so the crest is not rendered) without the noise.
 */
const STUB = 'export default null;\nexport const src = null;\n';

/** Self-initialising, so no prelude and no line-number shift. */
const ENV_REPLACEMENT = '(globalThis.__gpbImportMetaEnv ??= {})';

/**
 * `import.meta.glob(pattern, opts)` -> `__gpbGlobFrom(import.meta.url)(pattern, opts)`.
 *
 * A token replacement rather than a call rewrite on purpose. Swapping the whole `import.meta.glob(...)`
 * expression would mean finding its matching paren and adding one, which is the kind of text surgery
 * that works until a nested paren or a comment appears. The receiver form is just as correct to read
 * and cannot desynchronise: `X(a)(b)` binds as `(X(a))(b)`, which is exactly what the original did.
 */
const GLOB_REPLACEMENT = '__gpbGlobFrom(import.meta.url)';

const projectRoot = process.cwd().replace(/\\/g, '/');

const isProjectSource = (url) => {
  if (!url.startsWith('file:')) return false;
  let path;
  try {
    path = fileURLToPath(url).replace(/\\/g, '/');
  } catch {
    return false;
  }
  return path.startsWith(projectRoot) && !path.includes('/node_modules/');
};

export async function load(url, context, nextLoad) {
  if (ASSET.test(url)) {
    return { format: 'module', source: STUB, shortCircuit: true };
  }

  if (isProjectSource(url)) {
    const result = await nextLoad(url, context);
    const source = typeof result.source === 'string' ? result.source : result.source?.toString('utf8') ?? '';
    let patched = source;
    if (patched.includes('import.meta.env')) {
      patched = patched.replaceAll('import.meta.env', ENV_REPLACEMENT);
    }
    if (patched.includes('import.meta.glob')) {
      patched = patched.replaceAll('import.meta.glob', GLOB_REPLACEMENT);
    }
    if (patched !== source) {
      return { ...result, source: patched };
    }
  }

  return nextLoad(url, context);
}
