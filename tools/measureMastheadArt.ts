/**
 * What is actually IN the playoff masthead artwork?
 *
 * The image is a 1200x1200 square shown in a slot about 1.7:1. `object-cover` therefore fills the
 * width and discards roughly 42% of the height, split evenly above and below. That is a lot to
 * discard on a guess about where the wordmark sits.
 *
 * This decodes the PNG, finds the bounding box of everything that is not fully transparent, and
 * reports it. Two questions it answers that guessing cannot:
 *
 *   1. HOW MUCH OF THE SQUARE IS EMPTY. If the artwork is a wordmark floating in the middle of a
 *      transparent square, most of that square is padding and cropping into it is free.
 *   2. WHERE THE REAL CONTENT SITS. If it is off-centre, a symmetric crop throws away the wrong
 *      amount top and bottom -- which is exactly the reported symptom, the sponsor line at the foot
 *      of the artwork being clipped while empty space above goes untouched.
 *
 * It can also WRITE a cropped copy. Cropping the SOURCE fixes the layout problem properly rather than
 * compensating for it in CSS: a tight image in a 1.7:1 box barely crops at all, so the artwork stops
 * depending on the box being exactly the shape it happens to be today -- which matters, because the
 * box is a subgrid track and grows with the headline carousel.
 *
 * A PNG decoder and encoder, deliberately, rather than a dependency. No image library is installed,
 * and this project has a documented allergy to adding megabytes of node_modules to analyse one file.
 * Node's zlib does the compression; the rest is the format spec.
 *
 * Usage:
 *   node tools/measureMastheadArt.ts            report only
 *   node tools/measureMastheadArt.ts --apply    crop src/assets/playoffdashboard.png in place
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const SOURCE = 'src/assets/playoffdashboard.png';

/** Alpha at or below this counts as empty. PNGs of this kind are anti-aliased at the edges. */
const ALPHA_FLOOR = 8;

/** The eight PNG magic bytes. Module scope because both the decoder and the encoder need it. */
const SIGNATURE = '89504e470d0a1a0a';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([len, typed, crc]);
};

interface Decoded {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, no padding. */
  rgba: Buffer;
}

const decode = (buf: Buffer): Decoded => {
  if (buf.toString('hex', 0, 8) !== SIGNATURE) throw new Error('not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (color !== 6) throw new Error(`unsupported colour type ${color}; only RGBA is handled`);
  if (interlace !== 0) throw new Error('interlaced PNG is not handled');

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);

  // Undo the per-scanline filters. This is the part of the spec nobody enjoys writing.
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;

    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const value = line[x];
      let out8: number;
      switch (filter) {
        case 0: out8 = value; break;
        case 1: out8 = value + a; break;
        case 2: out8 = value + b; break;
        case 3: out8 = value + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          out8 = value + pred;
          break;
        }
        default: throw new Error(`unknown filter ${filter} on row ${y}`);
      }
      cur[x] = out8 & 0xff;
    }
  }

  return { width, height, rgba: out };
};

/**
 * The filter a PNG scanline should use, per the spec's own heuristic.
 *
 * Encoding every row with filter 0 -- "no filter" -- was the first attempt and it produced a file
 * 21% LARGER than the one it replaced, which is the wrong direction for a tool whose other job is
 * making an asset smaller. Filter 0 is the worst of the five for real imagery: it hands deflate raw
 * pixel values with no relationship to their neighbours, so the compressor has nothing to exploit.
 *
 * The spec's heuristic scores each candidate by the sum of absolute differences, treating the bytes
 * as signed, and picks the smallest. For a row of smooth gold-on-transparent artwork that reliably
 * chooses Up or Paeth, both of which turn a gradient into a run of near-identical small values --
 * exactly what deflate is good at.
 */
const filterRow = (cur: Buffer, prev: Buffer | null, bpp: number): { type: number; line: Buffer } => {
  const stride = cur.length;
  const candidates: Array<{ type: number; line: Buffer; score: number }> = [];

  for (let type = 0; type <= 4; type += 1) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value: number;
      switch (type) {
        case 0: value = cur[x]; break;
        case 1: value = cur[x] - a; break;
        case 2: value = cur[x] - b; break;
        case 3: value = cur[x] - ((a + b) >> 1); break;
        default: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          value = cur[x] - pred;
          break;
        }
      }
      line[x] = value & 0xff;
    }

    // Signed magnitude, per the spec: a byte of 0xFF counts as -1, not 255.
    let score = 0;
    for (let x = 0; x < stride; x += 1) {
      const signed = line[x] < 128 ? line[x] : line[x] - 256;
      score += Math.abs(signed);
    }
    candidates.push({ type, line, score });
  }

  candidates.sort((p, q) => p.score - q.score);
  return { type: candidates[0].type, line: candidates[0].line };
};

const encode = (width: number, height: number, rgba: Buffer): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  const used = new Map<number, number>();

  for (let y = 0; y < height; y += 1) {
    const cur = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : null;
    const { type, line } = filterRow(cur, prev, bpp);
    used.set(type, (used.get(type) ?? 0) + 1);
    raw[y * (stride + 1)] = type;
    line.copy(raw, y * (stride + 1) + 1);
  }

  const encoded = Buffer.concat([
    Buffer.from(SIGNATURE, 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const filterNames = ['None', 'Sub', 'Up', 'Average', 'Paeth'];
  console.log(`  filters used: ${[...used.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${filterNames[type]} ${count}`)
    .join(', ')}`);

  return encoded;
};

interface Box { left: number; top: number; right: number; bottom: number }

const contentBox = ({ width, height, rgba }: Decoded, floor = ALPHA_FLOOR): Box => {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > floor) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  if (right < 0) throw new Error('image is entirely transparent');
  return { left, top, right, bottom };
};

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const main = (): void => {
  const apply = process.argv.includes('--apply');
  const original = readFileSync(SOURCE);
  const image = decode(original);
  const { rgba } = image;
  const box = contentBox(image);

  const contentW = box.right - box.left + 1;
  const contentH = box.bottom - box.top + 1;

  console.log(`\nMASTHEAD ARTWORK\n`);
  console.log(`  file${SOURCE}  ${original.length} bytes`);
  console.log(`  canvas   ${image.width}x${image.height}  (aspect ${(image.width / image.height).toFixed(2)})`);
  console.log(`  content  ${contentW}x${contentH}  (aspect ${(contentW / contentH).toFixed(2)})`);
  console.log(`  box      x ${box.left}..${box.right}, y ${box.top}..${box.bottom}`);
  console.log(`  padding  left ${pct(box.left / image.width)}  right ${pct((image.width - 1 - box.right) / image.width)}`
    + `  top ${pct(box.top / image.height)}  bottom ${pct((image.height - 1 - box.bottom) / image.height)}`);
  console.log(`  content occupies ${pct((contentW * contentH) / (image.width * image.height))} of the canvas`);

  // Row-by-row alpha density, so "is the top of the square really empty" is answered rather than
  // inferred from the bounding box alone.
  const bandRows = 12;
  console.log('\n  vertical density (fraction of pixels opaque, top to bottom):');
  for (let b = 0; b < bandRows; b += 1) {
    const y0 = Math.floor((b * image.height) / bandRows);
    const y1 = Math.floor(((b + 1) * image.height) / bandRows);
    let opaque = 0;
    let total = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        total += 1;
        if (rgba[(y * image.width + x) * 4 + 3] > ALPHA_FLOOR) opaque += 1;
      }
    }
    const share = total === 0 ? 0 : opaque / total;
    const bar = '#'.repeat(Math.round(share * 40));
    console.log(`    ${pct(b / bandRows).padStart(6)}..${pct((b + 1) / bandRows).padStart(6)}  ${share.toFixed(3)}  ${bar}`);
  }

  if (!apply) {
    console.log('\n  dry run. pass --apply to write the cropped image in place.\n');
    return;
  }

  /*
   * SAFE TO RUN REPEATEDLY, which matters because this writes over the source.
   *
   * A second run finds content already touching all four edges -- the signature of a previous crop --
   * and would otherwise shave real content a second time. So the crop is skipped in that case and the
   * full canvas is used instead, making the tool idempotent: cropping converges on the first run and
   * every run after it only re-encodes. That is what lets the compression be retried without needing
   * a pristine copy of the original, which no longer exists.
   */
  const alreadyTight = box.left === 0 && box.top === 0
    && box.right === image.width - 1 && box.bottom === image.height - 1;
  const cropBox = alreadyTight
    ? { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 }
    : box;
  if (alreadyTight) {
    console.log('\n  already cropped to its content; re-encoding only, no further crop.');
  }

  const croppedW = cropBox.right - cropBox.left + 1;
  const croppedH = cropBox.bottom - cropBox.top + 1;
  const cropped = Buffer.alloc(croppedW * croppedH * 4);
  for (let y = 0; y < croppedH; y += 1) {
    const srcY = cropBox.top + y;
    for (let x = 0; x < croppedW; x += 1) {
      const srcX = cropBox.left + x;
      const from = (srcY * image.width + srcX) * 4;
      image.rgba.copy(cropped, (y * croppedW + x) * 4, from, from + 4);
    }
  }

  const encoded = encode(croppedW, croppedH, cropped);
  writeFileSync(SOURCE, encoded);

  console.log(`\n  wrote ${SOURCE}`);
  console.log(`  ${image.width}x${image.height} -> ${croppedW}x${croppedH}`
    + `  (aspect ${(croppedW / croppedH).toFixed(2)})`);
  console.log(`  ${original.length} -> ${encoded.length} bytes`
    + `  (${pct(1 - encoded.length / original.length)} smaller)\n`);
};

main();
