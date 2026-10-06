/*
 * ONE-OFF. Stamps `altitudeFt` into `parks.json` for every park, from a deterministic hash of the
 * team id, and rewrites the file in place. Kept in the repo rather than run and deleted so the
 * numbers are reproducible: re-running it on an already-stamped file is a no-op, and anyone who
 * wants to re-roll the altitudes has the exact procedure rather than having to reconstruct it.
 *
 * WHY THE VALUES ARE HAND-STORED AND NOT COMPUTED AT RUNTIME. `altitudeFt` is display-only -- the
 * physics still reads the band midpoint through `ALTITUDE_FT` -- but a value that changed on every
 * page load would still be wrong, in the way this file is specifically written to avoid: a park's
 * stated identity would not be a fixed fact about that park. So the value is chosen once, written
 * down, and hand-editable afterwards, exactly as `meanTempC` and `parkCity` are.
 *
 * WHY A HASH OF THE ID. The values have to be uncorrelated between parks, or every `sea` park
 * lands in the same corner of its band, and an LCG over a shared counter has exactly that failure
 * mode: the first run put 12 of 13 `sea` parks below 40 ft. FNV-1a decorrelates properly and is
 * stable across machines and Node versions, which a `Math.random()` would not be.
 *
 * THE BANDS, and the gap between them. The four bands are not contiguous: `moderate` tops out at
 * 1,150 and `high` starts at 3,000, so nothing in this league can be between 1,151 and 2,999 ft.
 * That is inherited, not introduced -- `parks.json` has always documented `high` as 3,000-4,500 --
 * and it is left alone rather than papered over by stretching a band to fill it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/data/parks.json';

const BAND_FT: Record<string, [number, number]> = {
  sea: [-10, 100],
  moderate: [101, 1150],
  high: [3000, 4500],
  extreme: [5000, 6500],
};

/** FNV-1a, 32-bit, masked so JS's float multiply cannot overflow the accumulator. */
const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

const raw = readFileSync(FILE, 'utf8');
const lines = raw.split(/\r?\n/);

let current = '';
const out: string[] = [];
let stamped = 0;

for (const line of lines) {
  const idMatch = /^ {2}"([a-z]+)": \{$/.exec(line);
  if (idMatch) current = idMatch[1];

  const altMatch = /^ {4}"altitude": "(sea|moderate|high|extreme)",$/.exec(line);
  if (altMatch && current) {
    const [lo, hi] = BAND_FT[altMatch[1]];
    const ft = lo + (fnv1a(current) % (hi - lo + 1));
    out.push(line);
    out.push(`    "altitudeFt": ${ft},`);
    stamped += 1;
    continue;
  }

  // Drop any pre-existing stamp so this is idempotent rather than doubling the field.
  if (/^ {4}"altitudeFt": -?\d+,$/.test(line)) continue;

  out.push(line);
}

writeFileSync(FILE, out.join('\r\n'), 'utf8');
console.log(`stamped ${stamped} parks`);