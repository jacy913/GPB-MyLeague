/**
 * Build a headliner reporter MARK from a full-art PNG, using Chrome's canvas WebP encoder.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five reporter portraits live in `src/assets/headliners/*.webp` at ~3 KB each -- circular marks
 * authored for a 28-96px byline badge. Hoani has none, so his dossier falls back to the initials
 * plate. His source art is `simonhoani.png`, a 2048x2048 composition 3.9 MB in size.
 *
 * There is no image tooling on this machine: no ImageMagick, no cwebp, no ffmpeg, and no sharp,
 * jimp or canvas in node_modules. Chrome IS installed, and `canvas.toDataURL('image/webp')` is a
 * real WebP encoder -- so the browser is the converter.
 *
 * WHY IT IS A SEPARATE TOOL AND NOT A ONE-OFF
 * --------------------------------------------
 * `tools/buildMediaPortraits.ts` documents the reasoning for the three existing forecaster
 * portraits, including that the frame is anchored to the alpha bounds of the rows ABOVE the vertical
 * midpoint rather than to the whole silhouette. That is a per-picture judgement about a person, not
 * a formula, which is exactly why it is written down next to the output rather than hidden in a
 * script. This tool takes the CENTRE SQUARE by default and takes explicit crop fractions when the
 * face is not centred, and it PRINTS the crop it used so a human can see what was chosen.
 *
 * It also refuses to write when the source has no alpha channel, because a mark with a white
 * background is not a mark -- `HeadlinerPortrait` masks to a circle, so an opaque square leaves
 * visible corners.
 *
 * Usage: npx tsx tools/buildHeadlinerMark.ts <source.png> <out-basename> [cx] [cy] [size]
 *   cx, cy are crop CENTRE as fractions of width/height (default 0.5, 0.42 -- faces sit high).
 *   size is the output edge in px (default 192, comfortably above the 96px render ceiling).
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const sourceArg = positional[0];
const outName = positional[1];
const cx = Number(positional[2] ?? 0.5);
const cy = Number(positional[3] ?? 0.42);
const size = Number(positional[4] ?? 192);
/*
  How much of the source to crop to, as a fraction of its smaller dimension.

  This exists because the first version of this tool had no zoom and was therefore useless on a
  SQUARE source: `side = min(w, h)` equals the full width, so the centre offsets could not move the
  crop at all and every argument after the name did nothing. The first Hoani mark came out as the
  whole 2048x2048 composition -- a correct cut-out of a man standing far too far away, which at a
  96px render is a face about 30 pixels across next to five tight headshots.

  A byline mark is a HEADSHOT. The face should fill the frame.
*/
const sideFrac = Number(process.env.SIDE_FRAC ?? 0.5);

if (!sourceArg || !outName) {
  console.error('Usage: npx tsx tools/buildHeadlinerMark.ts <source.png> <out-basename> [cx] [cy] [size]');
  process.exit(2);
}

const source = resolve(process.cwd(), sourceArg);
const outPath = resolve(process.cwd(), 'src/assets/headliners', `${outName}.webp`);

if (!existsSync(source)) {
  console.error(`  source not found: ${source}`);
  process.exit(2);
}

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('  no Chrome or Edge found; cannot encode WebP without it.');
  process.exit(2);
}

/*
  A throwaway HTML page rather than a data: URL, because a data: URL cannot load a local file.
  The PNG is inlined as base64 so the page needs no server and no CORS.
*/
const b64 = readFileSync(source).toString('base64');
const mime = source.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

const html = `<!doctype html><meta charset="utf-8"><body><script>
const IMG = "data:${mime};base64,${b64}";
const CX = ${cx}, CY = ${cy}, SIZE = ${size}, SIDE_FRAC = ${sideFrac};
const img = new Image();
img.onload = () => {
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const side = Math.round(Math.min(img.width, img.height) * SIDE_FRAC);
  const sx = Math.max(0, Math.min(img.width - side, CX * img.width - side / 2));
  const sy = Math.max(0, Math.min(img.height - side, CY * img.height - side / 2));
  g.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  // Report the crop so a human can see what was chosen rather than trusting it.
  const probe = g.getImageData(0, 0, SIZE, SIZE).data;
  let opaque = 0;
  for (let i = 3; i < probe.length; i += 4) if (probe[i] > 8) opaque += 1;
  const alphaRatio = opaque / (SIZE * SIZE);
  document.title = JSON.stringify({
    srcW: img.width, srcH: img.height, side,
    cropX: Math.round(sx), cropY: Math.round(sy),
    alphaRatio: Math.round(alphaRatio * 1000) / 1000,
    webp: c.toDataURL('image/webp', 0.92).split(',')[1]
  });
};
img.src = IMG;
</script></body>`;

const tmpHtml = resolve(process.cwd(), '.mark-build.html');
writeFileSync(tmpHtml, html, 'utf8');

const port = 9333 + Math.floor(Math.random() * 400);
const udd = resolve(process.cwd(), '.mark-chrome-profile');

const proc = spawnSync(chrome, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${udd}`,
  '--virtual-time-budget=8000',
  `--dump-dom`,
  `file:///${tmpHtml.replace(/\\/g, '/')}`,
], { encoding: 'utf8', timeout: 90000 });

const dom = proc.stdout ?? '';
// The result rides in the title, which --dump-dom prints inside <title>.
const match = dom.match(/<title>([\s\S]*?)<\/title>/);
if (!match) {
  console.error('  no result from Chrome. Output was:\n' + dom.slice(0, 600));
  process.exit(1);
}

let payload: { srcW: number; srcH: number; side: number; cropX: number; cropY: number; alphaRatio: number; webp: string };
try {
  payload = JSON.parse(match[1].replace(/&quot;/g, '"'));
} catch {
  console.error('  could not parse result: ' + match[1].slice(0, 400));
  process.exit(1);
}

console.log('\nHEADLINER MARK\n');
console.log(`  source        ${sourceArg}  ${payload.srcW}x${payload.srcH}`);
console.log(`  crop          side ${payload.side}, origin ${payload.cropX},${payload.cropY}`);
console.log(`  centre        cx ${cx}  cy ${cy}`);
console.log(`  opaque        ${(payload.alphaRatio * 100).toFixed(1)}% of the square`);

if (payload.alphaRatio > 0.995) {
  console.error('\n  REFUSING TO WRITE. The crop is fully opaque, so the circle mask in');
  console.error('  HeadlinerPortrait will leave visible square corners. This source has no');
  console.error('  alpha channel, or the crop is off the cut-out. Fix the crop or the source.\n');
  process.exit(1);
}

writeFileSync(outPath, Buffer.from(payload.webp, 'base64'));
const kb = (Buffer.from(payload.webp, 'base64').length / 1024);
console.log(`\n  wrote         src/assets/headliners/${outName}.webp  ${kb.toFixed(1)} KB`);
console.log(`  render ceiling is 96px (SIZE_PX in HeadlinerPortrait); ${size}px source is 2x that.\n`);