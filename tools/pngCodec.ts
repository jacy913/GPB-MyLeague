/**
 * PNG decode/encode, in pure Node, for the media-mark pipeline.
 *
 * There is no image library in this project -- `sharp`, `jimp` and `canvas` are all absent --
 * and the three outlet marks each need a trimmed and a square-trimmed variant cropped from a
 * supplied PNG. So this is a minimal 8-bit RGBA codec: parse IHDR, concatenate IDAT, inflate,
 * undo the per-scanline filters, and the reverse on the way out.
 *
 * It handles ONLY what the supplied files actually are, and says so rather than pretending to
 * be general:
 *
 *   - 8 bits per channel, colour type 6 (RGBA) or 2 (RGB, widened on decode)
 *   - non-interlaced
 *   - all five scanline filter types on decode, filter 0 on encode
 *
 * Anything else throws with the actual header values rather than producing a corrupt image.
 * A codec that quietly mis-decodes interlaced or 16-bit input is worse than one that refuses.
 *
 * Encoding uses filter 0 (None) on every scanline. That is larger than a smart per-line
 * choice would be, and it is the right trade here: these are hand-sized logo crops written
 * once and committed, so encoder cleverness would buy nothing a future reader could verify.
 */

import { deflateSync, inflateSync } from 'node:zlib';

/** CRC-32, as PNG specifies it (IEEE 802.3 polynomial, reflected). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Buffer;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const decodePng = (bytes: Buffer): DecodedImage => {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}; this codec handles 8 only`);
  if (colourType !== 6 && colourType !== 2) {
    throw new Error(`unsupported colour type ${colourType}; this codec handles 2 (RGB) and 6 (RGBA)`);
  }
  if (interlace !== 0) throw new Error('interlaced PNG is not handled by this codec');

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) {
    throw new Error(`inflated ${raw.length} bytes, expected at least ${(stride + 1) * height}`);
  }

  // Undo the per-scanline filters in place.
  const pixels = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[pos + x];
      const a = x >= channels ? pixels[rowStart + x - channels] : 0;
      const b = y > 0 ? pixels[prevStart + x] : 0;
      const c = x >= channels && y > 0 ? pixels[prevStart + x - channels] : 0;
      let restored: number;
      switch (filter) {
        case 0: restored = value; break;
        case 1: restored = value + a; break;
        case 2: restored = value + b; break;
        case 3: restored = value + ((a + b) >> 1); break;
        case 4: restored = value + paeth(a, b, c); break;
        default: throw new Error(`unknown scanline filter ${filter} on row ${y}`);
      }
      pixels[rowStart + x] = restored & 0xff;
    }
    pos += stride;
  }

  // Widen RGB to RGBA so every consumer downstream sees one layout.
  if (channels === 4) return { width, height, data: pixels };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
    rgba[j] = pixels[i];
    rgba[j + 1] = pixels[i + 1];
    rgba[j + 2] = pixels[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
};

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

const chunk = (type: string, body: Buffer): Buffer => {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

export const encodePng = (image: DecodedImage): Buffer => {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

/**
 * The alpha bounding box: the tightest rectangle containing every pixel that is not fully
 * transparent.
 *
 * Threshold is alpha > ALPHA_FLOOR rather than alpha > 0. An alpha of 1 is not visible and
 * anti-aliased edges routinely carry a handful of near-zero pixels; using > 0 would let a
 * single stray pixel stretch the crop by several pixels in each direction. The floor is
 * stated here rather than buried at the call site because it is a judgement, not a constant of
 * the format.
 */
export const ALPHA_FLOOR = 8;

export interface Bounds { left: number; top: number; right: number; bottom: number }

export const alphaBounds = (image: DecodedImage, floor = ALPHA_FLOOR): Bounds | null => {
  const { width, height, data } = image;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > floor) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
};

/** Crop to an exact rectangle. Rejects an out-of-range box rather than clamping it. */
export const crop = (image: DecodedImage, box: Bounds): DecodedImage => {
  const { width, height } = image;
  const w = box.right - box.left + 1;
  const h = box.bottom - box.top + 1;
  if (w <= 0 || h <= 0) throw new Error(`empty crop ${w}x${h}`);
  if (box.left < 0 || box.top < 0 || box.right >= width || box.bottom >= height) {
    throw new Error(`crop ${JSON.stringify(box)} falls outside ${width}x${height}`);
  }
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const src = ((box.top + y) * width + box.left) * 4;
    image.data.copy(out, y * w * 4, src, src + w * 4);
  }
  return { width: w, height: h, data: out };
};

/**
 * Nearest-neighbour resize.
 *
 * NEAREST rather than a smooth filter, deliberately. These are flat-colour logo crops with
 * hard edges and no gradients to preserve, and a nearest-neighbour result is exactly
 * verifiable: every output pixel is one specific input pixel. Any resampling kernel would make
 * the committed file impossible to reason about from the source.
 */
export const resizeNearest = (image: DecodedImage, targetW: number, targetH: number): DecodedImage => {
  const out = Buffer.alloc(targetW * targetH * 4);
  for (let y = 0; y < targetH; y += 1) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / targetH));
    for (let x = 0; x < targetW; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / targetW));
      const src = (sy * image.width + sx) * 4;
      const dst = (y * targetW + x) * 4;
      out[dst] = image.data[src];
      out[dst + 1] = image.data[src + 1];
      out[dst + 2] = image.data[src + 2];
      out[dst + 3] = image.data[src + 3];
    }
  }
  return { width: targetW, height: targetH, data: out };
};

/**
 * Area-average ("box filter") resize.
 *
 * This is what the square marks need, and `resizeNearest` is the wrong tool for it. Reducing
 * a 570px mark to 96px with nearest-neighbour samples roughly one pixel in six and throws away
 * the other five, which on a hard-edged gold crest produces visible stair-stepping on every
 * diagonal -- and this logo's entire silhouette is diagonals.
 *
 * The box filter averages every source pixel that falls inside each destination pixel, which
 * is the correct reconstruction for MINIFICATION (as opposed to magnification, where
 * bilinear is wanted). It is still exactly reproducible: the arithmetic is integer, and
 * `buildMediaMarks.ts` reports its mean absolute difference from the committed files so the
 * quality of the result is measured rather than asserted.
 *
 * Alpha is weighted into the RGB average, because these are RGBA logos with transparent
 * margins and averaging colour channels as if they were opaque drags the edge pixels toward
 * whatever colour happens to sit under them in the file, which is nothing.
 */
export const resizeBoxAverage = (image: DecodedImage, targetW: number, targetH: number): DecodedImage => {
  const out = Buffer.alloc(targetW * targetH * 4);
  const { width, height, data } = image;

  for (let dy = 0; dy < targetH; dy += 1) {
    const y0 = Math.floor((dy * height) / targetH);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * height) / targetH));

    for (let dx = 0; dx < targetW; dx += 1) {
      const x0 = Math.floor((dx * width) / targetW);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * width) / targetW));

      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;
      let count = 0;

      for (let sy = y0; sy < Math.min(y1, height); sy += 1) {
        for (let sx = x0; sx < Math.min(x1, width); sx += 1) {
          const i = (sy * width + sx) * 4;
          const a = data[i + 3];
          rSum += data[i] * a;
          gSum += data[i + 1] * a;
          bSum += data[i + 2] * a;
          aSum += a;
          count += 1;
        }
      }

      const dst = (dy * targetW + dx) * 4;
      if (aSum === 0 || count === 0) {
        out[dst] = 0; out[dst + 1] = 0; out[dst + 2] = 0; out[dst + 3] = 0;
        continue;
      }
      out[dst] = Math.round(rSum / aSum);
      out[dst + 1] = Math.round(gSum / aSum);
      out[dst + 2] = Math.round(bSum / aSum);
      out[dst + 3] = Math.round(aSum / count);
    }
  }
  return { width: targetW, height: targetH, data: out };
};

/**
 * Centre an image on a TRANSPARENT square canvas whose side is its longest edge.
 *
 * NOT a crop. This distinction was wrong on the first attempt and the self-validation in
 * `buildMediaMarks.ts` caught it: reading "the largest square that fits" as a square WINDOW
 * through the artwork cut the left-hand wings off the logo entirely and produced a 96px file
 * that shared almost no pixels with the committed one (mean channel difference 69/255).
 *
 * What the committed squares actually contain is the WHOLE mark, scaled to fit inside a square,
 * with transparent bands on the short axis. That is what gives the three marks the same visual
 * weight in a column header -- a shared box sized to any one of them would make the others
 * look small -- and it is why this pads rather than crops.
 */
export const padToSquare = (image: DecodedImage): DecodedImage => {
  const side = Math.max(image.width, image.height);
  if (side === image.width && side === image.height) return image;
  const out = Buffer.alloc(side * side * 4);
  const left = Math.round((side - image.width) / 2);
  const top = Math.round((side - image.height) / 2);
  for (let y = 0; y < image.height; y += 1) {
    const src = y * image.width * 4;
    const dst = ((y + top) * side + left) * 4;
    image.data.copy(out, dst, src, src + image.width * 4);
  }
  return { width: side, height: side, data: out };
};

/** Mean absolute difference per channel, 0-255. A cheap, honest similarity number. */
export const meanAbsoluteDifference = (a: DecodedImage, b: DecodedImage): number => {
  if (a.width !== b.width || a.height !== b.height) return Number.NaN;
  let total = 0;
  for (let i = 0; i < a.data.length; i += 1) total += Math.abs(a.data[i] - b.data[i]);
  return total / a.data.length;
};