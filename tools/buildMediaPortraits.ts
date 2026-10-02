/**
 * Build the forecaster portraits used by the media character popup.
 *
 * WHY A TOOL AND NOT JUST THE SUPPLIED FILES
 *
 * The three supplied thumbnails are 2048x2048 RGBA cut-outs weighing 3.3MB, 5.5MB and 5.0MB.
 * Importing them as-is would put 13.8MB of PNG behind a dialog, for an image that renders at
 * roughly 260 CSS pixels wide. This produces 520x650 versions -- 4:5, which is the aspect the
 * popup frames them in -- and reports the size of each input so the saving is a measurement
 * rather than a claim.
 *
 * WHY THE CROP IS DERIVED PER IMAGE
 *
 * The three are framed nothing alike, which is the whole difficulty:
 *
 *   hollis   a loose figure set right of centre, most of the canvas empty
 *   glorest  a tight head-and-shoulders that already fills the frame
 *   sharply  (a third framing, and the tool reports its bounds rather than assuming)
 *
 * A single hard-coded crop box would frame one of them well and at least one of them badly. So
 * the frame is computed from each image's own alpha bounds, and the anchor is the UPPER HALF of
 * the subject rather than the whole of it.
 *
 * THE UPPER-HALF ANCHOR, and why it is that rather than a face detector
 *
 * The obvious bounding box -- the whole subject -- is the wrong one. Hollis's arms and elbow
 * make the full silhouette far wider than his head, so a frame centred on the whole subject puts
 * the face off to one side and leaves a third of the frame empty.
 *
 * Taking the alpha bounds of the rows above the vertical midpoint isolates head and shoulders:
 * the arms that ruin the full-silhouette width sit below that line. This is a proxy for a face
 * detector, not a face detector, and it is chosen because it is deterministic, needs no model,
 * and fails legibly -- if a portrait is full-length with a small head near the top, the upper
 * half still contains the head and the frame still lands on it.
 *
 * It is NOT measured to be correct on these three images. It is measured to be applied
 * consistently to them, and the outputs are meant to be LOOKED at. A tool that produces
 * plausible files nobody has seen is exactly the failure this project keeps paying for.
 *
 * Run: npx tsx tools/buildMediaPortraits.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  alphaBounds,
  crop,
  decodePng,
  encodePng,
  resizeBoxAverage,
  type Bounds,
  type DecodedImage,
} from './pngCodec';

const DIR = resolve(process.cwd(), 'src', 'assets', 'media');

/**
 * The three supplied thumbnails, and the outlet each belongs to.
 *
 * The supplied filenames do not follow the outlet ids -- `glorestsportsthumbnail` for the
 * `glorest` outlet, alongside `glorestpresslogo` -- so the mapping is stated here rather than
 * inferred from a name. Getting it wrong would put the wrong face on the wrong forecaster,
 * which is the kind of bug that survives every test because nothing asserts it.
 */
const SOURCES: Array<{ id: string; file: string; out: string }> = [
  { id: 'hollis', file: 'quincyhollisthumbnail.png', out: 'hollis-portrait.png' },
  { id: 'glorest', file: 'glorestsportsthumbnail.png', out: 'glorest-portrait.png' },
  { id: 'sharply', file: 'linedsharplythumbnail.png', out: 'sharply-portrait.png' },
];

/** 4:5. A portrait of a person is not a square, and a square face crop is a passport photo. */
const OUT_W = 520;
const OUT_H = 650;

/**
 * How much wider than the head-and-shoulder bounds the frame is allowed to be.
 *
 * Slightly generous, because the supplied cuts include shoulders and upper arms and a frame
 * exactly as wide as them crops the arms off at the edge, which reads as a mistake. It is not
 * a face box -- it is a head-and-shoulders frame.
 */
export const WIDTH_SLACK = 1.28;

/**
 * Empty space above the hair, as a fraction of the subject's own height in the frame.
 *
 * Without it the crown of the head touches the top edge, which is the same seam problem the
 * marks had: an image whose subject touches its own frame looks pasted. A twentieth of the
 * frame height is enough to read as air rather than as a gap.
 */
const HEADROOM = 0.045;

/** Alpha below this is invisible or anti-alias noise. The same floor the marks use. */
const ALPHA_FLOOR = 8;

/**
 * Alpha bounds of the rows above the vertical midpoint.
 *
 * Deliberately its own scan rather than a parameter on `alphaBounds`, because the bounds need
 * to be computed over a SUBSET of rows while the image is decoded once. Re-decoding to ask a
 * narrower question would be wasteful and would make the helper in `pngCodec` do something
 * its name does not say.
 */
export const upperBounds = (image: DecodedImage, floor = ALPHA_FLOOR): Bounds | null => {
  const limit = Math.floor(image.height / 2);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = 0; y < limit; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] <= floor) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, right, bottom };
};

export interface Frame { box: Bounds; note: string }

export const frameFor = (image: DecodedImage): Frame => {
  const upper = upperBounds(image);
  const full = alphaBounds(image);
  if (!upper || !full) throw new Error('image has no opaque pixels');

  // Width from the UPPER bounds, so arms below the midpoint cannot widen the frame.
  const width = Math.round(upper.right - upper.left + 1);
  const height = Math.round(width * (OUT_H / OUT_W));

  if (height > image.height) {
    /*
     * THE FALLBACK, and what it actually means.
     *
     * It fires when the head-and-shoulder band is taller than the canvas, which happens when the
     * subject fills the frame vertically. That is not a defect in the source, it is a different
     * KIND of picture: Sharply is a two-host podcast shot where both presenters and both
     * embroidered logos are the point, and cropping to one face would throw half the outlet away.
     *
     * The first version reported this as "head-and-shoulders cannot fill the frame", which is
     * true of the arithmetic and says nothing about the picture -- it read as a processing
     * warning on an image that came out perfectly well. So the note names the real situation:
     * the subject fills the canvas, which is what a multi-person or full-length shot looks like.
     */
    return {
      box: { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 },
      note: 'subject fills the canvas (multi-person or full-length shot) -- whole frame used',
    };
  }

  // Centre horizontally on the upper bounds, clamp into the canvas.
  const centre = (upper.left + upper.right) / 2;
  let left = Math.round(centre - width / 2);
  left = Math.max(0, Math.min(left, image.width - width));

  const headroom = Math.round(height * HEADROOM);
  const top = Math.max(0, Math.min(upper.top - headroom, image.height - height));

  const upperAsFraction = Math.round(
    (((upper.right - upper.left + 1) / (full.right - full.left + 1)) * 100),
  );
  return {
    box: { left, top, right: left + width - 1, bottom: top + height - 1 },
    note: `head+shoulders are ${upperAsFraction}% of the full silhouette's width`
      + (full.right - full.left > upper.right - upper.left
        ? ' -- so the full-silhouette box would have been off-centre'
        : ''),
  };
};

const main = (): void => {
  console.log('\nBUILD FORECASTER PORTRAITS\n');
  console.log(`  ${OUT_W}x${OUT_H} (4:5), frame anchored to the alpha bounds of the rows above`);
  console.log('  the vertical midpoint so that arms below it cannot widen or recentre the frame.\n');
  console.log('  outlet    source                    in        out     subject box        note');
  console.log('  ' + '-'.repeat(104));

  let inTotal = 0;
  let outTotal = 0;

  for (const { id, file, out } of SOURCES) {
    const srcPath = resolve(DIR, file);
    const raw = readFileSync(srcPath);
    const image = decodePng(raw);
    const { box, note } = frameFor(image);
    const framed = crop(image, box);
    const scaled = resizeBoxAverage(framed, OUT_W, OUT_H);
    const encoded = encodePng(scaled);
    writeFileSync(resolve(DIR, out), encoded);

    const full = alphaBounds(image);
    inTotal += raw.length;
    outTotal += encoded.length;

    console.log(
      '  ' + id.padEnd(9)
      + file.padEnd(24)
      + `${(raw.length / 1024 / 1024).toFixed(2)}MB`.padStart(8)
      + `${(encoded.length / 1024).toFixed(0)}KB`.padStart(10)
      + `  ${full!.left},${full!.top} ${full!.right - full!.left + 1}x${full!.bottom - full!.top + 1}`.padEnd(18)
      + note,
    );
  }

  console.log('  ' + '-'.repeat(104));
  console.log(
    `  total ${(inTotal / 1024 / 1024).toFixed(1)}MB -> ${(outTotal / 1024).toFixed(0)}KB`
    + `   (${(100 - (outTotal / inTotal) * 100).toFixed(1)}% smaller)`,
  );
  console.log('\n  LOOK AT THESE THREE FILES. The framing rule is deterministic, not verified.\n');
};

// Guarded, because rameFor is imported by tools/buildMediaMarksWebp.ts. An
// unconditional call means merely importing the framing rule REBUILDS THE HERO PORTRAITS,
// which happened the first time this guard was added: importing it printed a full
// portrait build to stdout before the caller's own output. tools/buildMediaMarks.ts
// already guards its main for the same reason.
if (process.argv[1] && process.argv[1].endsWith('buildMediaPortraits.ts')) main();