/**
 * An ESM loader that turns asset imports into strings, so a component can be rendered under bare
 * node.
 *
 * `PropCard` pulls in outlet logos from `mediaImages.ts`, which are `.jpg` and `.png` imports that
 * Vite resolves to URLs at build time. Bare node has no such loader and dies with
 * `ERR_UNKNOWN_FILE_EXTENSION` before a single assertion runs -- so the component under test is
 * untestable unless the assets are stubbed.
 *
 * The stub is deliberately a string, not a module: every consumer here wants the URL that Vite
 * would have produced, and an assertion on which outlet logo a row points at is still meaningful
 * when that URL is `asset:glorest.jpg` rather than a hashed path. What these checks are for is
 * WHICH asset a row names, not whether the file exists.
 *
 * Only asset extensions are touched. A `.ts` file that fails to resolve still fails loudly, which
 * is the behaviour a check script needs.
 */

const ASSET = /\.(png|jpe?g|gif|webp|avif|svg|mp3|wav|woff2?|ttf|eot)$/i;

const STUB = 'data:text/javascript,export default "asset-stub:"';

/** @type {import('node:module').ResolveHook} */
export async function resolve(specifier, context, nextResolve) {
  if (ASSET.test(specifier.split('?')[0])) {
    return { url: STUB, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}

/**
 * Shim `import.meta.glob` to an empty result.
 *
 * Vite-only, and reached as soon as a component under test imports `TeamLogo`, which uses it to
 * make the bundled club crests addressable at build time. Bare node has no `import.meta.glob`, so
 * `TeamLogo` throws `glob is not a function` on import -- which kills the whole render before a
 * single assertion runs.
 *
 * Returning `{}` is the honest stub: it means "no local logo files resolved", so `TeamLogo` takes
 * its documented fallback branch and paints the team's initials. That is a real rendering path,
 * not a crash, and it is what these checks need anyway -- the question is whether TWO crest slots
 * appear in the right order with the right accessible names, not whether the PNGs decoded.
 */
const GLOB_STUB = '__gpImportMetaGlobStub';
const ENV_STUB = '__gpImportMetaEnvStub';

/*
 * `import.meta.env` needs the same treatment, for the same reason.
 *
 * `supabaseClient` reads `import.meta.env.VITE_SUPABASE_URL` at module scope, and under bare node
 * `import.meta.env` is `undefined` -- so the read throws before any component using a crest can
 * render. An empty object is also the honest stub: it means "no env supplied", which is what makes
 * `isSupabaseConfigured` false and `TeamLogo` take its local-files path. `TeamLogo` reaching
 * `supabaseClient` at all is incidental to what these checks are about.
 */
const PREAMBLE = `const ${GLOB_STUB} = () => ({});\nconst ${ENV_STUB} = {};\n`;

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  const source = result.source?.toString?.();
  if (typeof source !== 'string') return result;
  if (!source.includes('import.meta.glob') && !source.includes('import.meta.env')) return result;

  const patched = PREAMBLE
    + source
      .replaceAll('import.meta.glob', GLOB_STUB)
      .replaceAll('import.meta.env', ENV_STUB);

  return { ...result, source: patched };
}
