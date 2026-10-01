/**
 * Convert the headliner portraits to 96x96 WebP.
 *
 * WHY THIS EXISTS AS A TOOL RATHER THAN A BUILD STEP. The portraits are authored at
 * 1024-2048px and render at 28-40px, so they ship roughly 16.3 MB for five avatars.
 * They are also currently referenced by nothing, which means they are dead weight
 * that has never been in a commit and never been measured.
 *
 * WHY IT DRIVES CHROME. The obvious tools are all absent on this machine:
 *
 *   - ImageMagick: not installed. `magick` is not on PATH, and the `convert.exe`
 *     that IS on PATH is the Windows FAT-to-NTFS filesystem converter, which is
 *     not an image tool and will not do this.
 *   - sharp: not in node_modules.
 *   - ffmpeg: not installed.
 *
 * Chrome is already a dependency of this repo (tools/cdp.mjs drives it over the
 * DevTools protocol), and `canvas.toDataURL('image/webp', q)` encodes WebP natively.
 * So the conversion runs in the same browser the portraits will be displayed in,
 * which also means the output is encoded by the renderer that has to decode it.
 *
 * QUALITY: prefers `createImageBitmap` with `resizeQuality: 'high'`, which Chrome
 * implements as a proper multi-step downscale. A single `drawImage` from 2048px to
 * 96px in one step aliases badly on faces, and faces are the subject. Falls back to
 * drawImage with imageSmoothingQuality high if createImageBitmap is unavailable.
 *
 * It reports INPUT and OUTPUT bytes for every portrait and the total reduction, and
 * it fails loudly if the output is not actually smaller -- a converter that silently
 * produces larger files is worse than no converter.
 *
 * Run: node tools/portraitToWebp.mjs [--size=96] [--quality=0.8] [--keep-png]
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ASSET_DIR = join(REPO, 'src', 'assets', 'headliners');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = new Map(
  process.argv.slice(2).map((raw) => {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    return match ? [match[1], match[2] ?? 'true'] : [raw, 'true'];
  }),
);

const SIZE = Number(args.get('size') ?? '96');
const QUALITY = Number(args.get('quality') ?? '0.8');
const KEEP_PNG = args.get('keep-png') === 'true';

/**
 * Files to convert, in registry order.
 *
 * Listed explicitly rather than globbed so a stray file dropped in the folder is a
 * visible no-op instead of silently becoming a sixth persona.
 */
const PORTRAITS = ['hidalgoperez', 'christinesoo', 'chrisgatz', 'scintilla', 'tombuccelli'];

if (!Number.isFinite(SIZE) || SIZE <= 0) throw new Error('--size must be a positive number');
if (!Number.isFinite(QUALITY) || QUALITY <= 0 || QUALITY > 1) throw new Error('--quality must be between 0 and 1');
if (!existsSync(ASSET_DIR)) throw new Error(`no portrait directory at ${ASSET_DIR}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function endpoint(port) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome never opened a debugging port');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); }
  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cdp = new CDP(ws);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && cdp.waiting.has(msg.id)) {
        const { resolve: ok, reject } = cdp.waiting.get(msg.id);
        cdp.waiting.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else ok(msg.result);
      }
    });
    return cdp;
  }
  send(method, params = {}, sessionId) {
    this.id += 1;
    const id = this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((res, rej) => this.waiting.set(id, { resolve: res, reject: rej }));
  }
}

/**
 * The in-page converter.
 *
 * Runs in the page rather than being injected as an expression because the work is
 * async (fetch, decode, encode) and five images' worth of base64 does not belong in a
 * single Runtime.evaluate payload.
 */
const HARNESS = `<!doctype html><meta charset="utf-8"><title>portrait converter</title>
<script>
window.__result = { done: false, error: null, items: {}, order: ${JSON.stringify(PORTRAITS)} };

const toImageBitmap = async (blob) => {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    return await createImageBitmap(blob, {
      resizeWidth: ${SIZE},
      resizeHeight: ${SIZE},
      resizeQuality: 'high',
    });
  } catch { return null; }
};

(async () => {
  try {
    for (const name of ${JSON.stringify(PORTRAITS)}) {
      const res = await fetch(name + '.png');
      if (!res.ok) throw new Error(name + '.png -> HTTP ' + res.status);
      const blob = await res.blob();

      const canvas = document.createElement('canvas');
      canvas.width = ${SIZE};
      canvas.height = ${SIZE};
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      let drawn = false;
      const bitmap = await toImageBitmap(blob);
      if (bitmap) { ctx.drawImage(bitmap, 0, 0, ${SIZE}, ${SIZE}); drawn = true; bitmap.close && bitmap.close(); }

      if (!drawn) {
        const img = new Image();
        img.src = URL.createObjectURL(blob);
        await img.decode();
        ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE});
        URL.revokeObjectURL(img.src);
      }

      const dataUrl = canvas.toDataURL('image/webp', ${QUALITY});
      if (!dataUrl.startsWith('data:image/webp')) {
        throw new Error(name + ': encoder returned ' + dataUrl.slice(0, 32) + ', not webp');
      }
      const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      window.__result.items[name] = { base64: b64, bytes: bytes.length };
    }
    window.__result.done = true;
  } catch (error) {
    window.__result.error = String((error && error.message) || error);
    window.__result.done = true;
  }
})();
</script>`;

const main = async () => {
  const harnessPath = join(ASSET_DIR, '__convert.html');
  writeFileSync(harnessPath, HARNESS, 'utf8');

  const profile = mkdtempSync(join(tmpdir(), 'gpb-webp-'));
  const port = 9222 + Math.floor(Math.random() * 400);
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      // Required for the harness to fetch its sibling PNGs from a file:// page.
      '--allow-file-access-from-files',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const cleanup = () => {
    try { if (existsSync(harnessPath)) unlinkSync(harnessPath); } catch { /* best effort */ }
    try { chrome.kill(); } catch { /* best effort */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  try {
    const wsUrl = await endpoint(port);
    const browser = await CDP.attach(wsUrl);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Page.navigate', { url: pathToFileURL(harnessPath).href }, sessionId);

    let result = null;
    for (let i = 0; i < 240; i += 1) {
      const { result: probe } = await browser.send(
        'Runtime.evaluate',
        { expression: 'JSON.stringify(window.__result ? { done: window.__result.done, error: window.__result.error } : null)', returnByValue: true },
        sessionId,
      );
      const state = probe?.value ? JSON.parse(probe.value) : null;
      if (state?.done) { result = state; break; }
      await sleep(250);
    }
    if (!result) throw new Error('the in-page converter never finished');
    if (result.error) throw new Error(`in-page conversion failed: ${result.error}`);

    console.log(`headliner portraits -> ${SIZE}x${SIZE} WebP q${QUALITY}\n`);
    console.log('  portrait          in        out      saved');
    let totalIn = 0;
    let totalOut = 0;
    const written = [];
    for (const name of PORTRAITS) {
      const { result: payload } = await browser.send(
        'Runtime.evaluate',
        { expression: `window.__result.items[${JSON.stringify(name)}].base64`, returnByValue: true },
        sessionId,
      );
      if (!payload?.value) throw new Error(`${name}: no encoded output`);
      const bytes = Buffer.from(payload.value, 'base64');
      const outPath = join(ASSET_DIR, `${name}.webp`);
      writeFileSync(outPath, bytes, 'utf8');
      written.push(outPath);

      const inBytes = statSync(join(ASSET_DIR, `${name}.png`)).size;
      totalIn += inBytes;
      totalOut += bytes.length;
      const saved = inBytes > 0 ? (1 - bytes.length / inBytes) * 100 : 0;
      console.log(
        `  ${name.padEnd(16)}${String(inBytes).padStart(9)}${String(bytes.length).padStart(10)}` +
          `${saved.toFixed(2).padStart(11)}%`,
      );
    }

    const reduction = totalIn > 0 ? (1 - totalOut / totalIn) * 100 : 0;
    console.log(
      `  ${'TOTAL'.padEnd(16)}${String(totalIn).padStart(9)}${String(totalOut).padStart(10)}` +
        `${reduction.toFixed(2).padStart(11)}%`,
    );

    if (totalOut >= totalIn) {
      throw new Error(
        `output (${totalOut}) is not smaller than input (${totalIn}); refusing to delete the sources`,
      );
    }

    if (KEEP_PNG) {
      console.log('\n  --keep-png: source PNGs left in place.');
    } else {
      for (const name of PORTRAITS) {
        const png = join(ASSET_DIR, `${name}.png`);
        if (existsSync(png)) unlinkSync(png);
      }
      console.log('\n  Source PNGs deleted. Verify the portraits render before committing.');
    }

    console.log(`\n  wrote ${written.length} files to ${ASSET_DIR}`);
    browser.ws.close();
  } finally {
    cleanup();
  }
};

main().catch((error) => {
  console.error(`portraitToWebp FAILED: ${error.message}`);
  process.exitCode = 1;
});