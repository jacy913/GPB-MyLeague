/**
 * The gate for `src/data/teamColors.ts` and `src/lib/clubColour.ts`.
 *
 * This ASSERTS. `auditClubColour.ts` is the one that reports; the split is deliberate, because a
 * report that also decides pass/fail comes to be read as evidence and stops being re-read when the
 * data changes.
 *
 * Run: `npx tsx tools/checkClubInk.ts`
 *
 * Every check prints the number it measured. A check that prints a label it was told to print
 * passes forever on a wrong formula -- that is how the BABIP denominator bug survived, and this
 * project has paid for that lesson twice since.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { teamColors, PALETTE_SLOTS, type TeamId } from '../src/data/teamColors';
import {
  CLUB_SURFACES,
  INK_CONTRAST_FLOOR,
  clubInk,
  clubInkReport,
  contrastRatio,
  relativeLuminance,
  type ClubSurface,
  type ClubTheme,
} from '../src/lib/clubColour';

const THEMES: ClubTheme[] = ['regular', 'autumn'];

let failures = 0;
let checks = 0;

const check = (name: string, ok: boolean, detail: string) => {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
};

/* ------------------------------------------------------------------ data integrity */

const canonIds = INITIAL_TEAMS.map((t) => t.id).sort();
const colourIds = (Object.keys(teamColors) as TeamId[]).sort();

const missing = canonIds.filter((id) => !colourIds.includes(id as TeamId));
const extra = colourIds.filter((id) => !canonIds.includes(id));

check(
  'every club in INITIAL_TEAMS has an entry, and every entry is a club',
  missing.length === 0 && extra.length === 0,
  missing.length || extra.length
    ? `missing [${missing.join(' ')}]  extra [${extra.join(' ')}]`
    : `${canonIds.length} clubs, ${colourIds.length} entries, no gaps either way`,
);

/**
 * Key order, not just key set.
 *
 * A mapping with the right 32 keys in a different order is still correct as data and still
 * unreviewable as a document -- a reviewer reading down the file is checking divisions and
 * neighbours, which only means something if the order is the canonical one from `teams.ts`.
 */
const fileOrder = Object.keys(teamColors) as TeamId[];
const canonicalOrder = INITIAL_TEAMS.map((t) => t.id);
check(
  'key order matches INITIAL_TEAMS exactly',
  fileOrder.every((id, i) => id === canonicalOrder[i]),
  fileOrder.every((id, i) => id === canonicalOrder[i])
    ? 'all 32 in canonical order (Platinum then Prestige, N/S/W/E each)'
    : `first divergence at ${fileOrder.findIndex((id, i) => id !== canonicalOrder[i])}`,
);

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const badHex: string[] = [];
for (const team of INITIAL_TEAMS) {
  for (const slot of PALETTE_SLOTS) {
    const v = teamColors[team.id as TeamId][slot];
    if (typeof v !== 'string' || !HEX.test(v)) badHex.push(`${team.id}.${slot}=${JSON.stringify(v)}`);
  }
}
check(
  'all three slots present on all 32 clubs, every value a hex colour',
  badHex.length === 0,
  badHex.length
    ? badHex.join('  ')
    : `${INITIAL_TEAMS.length * 3} values, all matching #rgb or #rrggbb`,
);

/* ------------------------------------------------------------------ the derivation */

/**
 * The load-bearing check.
 *
 * If this fails, some club's identity mark is invisible or invisible-plus-1px, which is precisely
 * the defect the module exists to prevent -- and it would be invisible in review, because the code
 * would still read correctly.
 *
 * RUN OVER BOTH THEMES. The postseason repaints `--color-*` (see `html[data-season='postseason']`),
 * so a club mark that clears the navy floor can still be under it in October. Testing one theme and
 * calling the palette covered is how the second one ships unverified.
 */
for (const theme of THEMES) {
  for (const [name, surface] of Object.entries(CLUB_SURFACES[theme])) {
    let worst = Infinity;
    let who = '';
    const failuresList: string[] = [];
    for (const team of INITIAL_TEAMS) {
      const ink = clubInk(team.id as TeamId, name as ClubSurface, theme);
      if (!ink) {
        failuresList.push(`${team.id} returned no ink at all`);
        continue;
      }
      const c = contrastRatio(ink.hex, surface);
      if (c < worst) {
        worst = c;
        who = team.id;
      }
      if (c < INK_CONTRAST_FLOOR) failuresList.push(`${team.id} draws ${ink.hex} at ${c.toFixed(2)}:1`);
    }
    check(
      `[${theme}] all 32 clubs clear ${INK_CONTRAST_FLOOR}:1 on --color-${name}`,
      failuresList.length === 0,
      `worst ${worst.toFixed(2)}:1 (${who})${failuresList.length ? `  ${failuresList.slice(0, 4).join('  ')}` : ''}`,
    );
  }
}

/**
 * A lift must not rotate the hue.
 *
 * This is the check that catches an over-aggressive lift turning Arsagam's pink-red into orange --
 * a mark that is legible, passes the contrast test above, and is simply the wrong club's colour.
 * Nothing else in the file would notice.
 *
 * 12 degrees is chosen. Gamut clamping does move hue slightly on saturated colours and a perfect
 * zero tolerance would fail on clamping that is doing its job; the measured worst across the league
 * is under 1 degree, so 12 is roughly ten times the observed cost and still far below the 30-odd
 * degrees at which two club colours start reading as the same colour.
 */
const HUE_TOLERANCE_DEG = 12;
const hueFailures: string[] = [];
let worstHue = 0;
let worstHueClub = '';
for (const theme of THEMES) {
  for (const team of INITIAL_TEAMS) {
    const r = clubInkReport(team.id as TeamId, 'panel', theme);
    let drift = Math.abs(r.inkHue - r.sourceHue);
    if (drift > 180) drift = 360 - drift;
    if (drift > worstHue) {
      worstHue = drift;
      worstHueClub = `${team.id}/${theme}`;
    }
    if (drift > HUE_TOLERANCE_DEG) {
      hueFailures.push(`${team.id}/${theme} drifted ${drift.toFixed(1)} deg`);
    }
  }
}
check(
  `no lift rotates a colour by more than ${HUE_TOLERANCE_DEG} degrees of hue, in either theme`,
  hueFailures.length === 0,
  hueFailures.length
    ? hueFailures.join('  ')
    : `worst drift ${worstHue.toFixed(1)} deg (${worstHueClub}) across both themes, tolerance ${HUE_TOLERANCE_DEG}`,
);

/**
 * THE LIFT DIRECTION MUST NOT INVERT BETWEEN THEMES.
 *
 * This is the single check the whole autumn swap rests on. `liftForContrast` raises OKLCH lightness,
 * which is only correct while the club's colour is DARKER than the surface. Measured, 30 of 32
 * primaries are lighter than the navy panel -- so the module raises them further, or leaves them.
 * If the autumn panel were ever brightened past a club's primary, the lift would silently start
 * pushing that colour the wrong way and all 32 derived marks would be wrong while still looking
 * plausible. The autumn ramp is luminance-matched to avoid exactly that.
 */
for (const theme of THEMES) {
  const lighter = INITIAL_TEAMS.filter(
    (t) => relativeLuminance(teamColors[t.id as TeamId].primary) > relativeLuminance(CLUB_SURFACES[theme].panel),
  ).length;
  check(
    `[${theme}] the majority of primaries are still LIGHTER than the panel, so lifting is correct`,
    lighter >= 24,
    `${lighter} of 32 primaries lighter than ${CLUB_SURFACES[theme].panel}`
      + `${lighter < 24 ? '  <-- the lift direction is inverting' : ''}`,
  );
}

/**
 * An untouched club is better than a lifted club.
 *
 * Eighteen clubs should be drawing their own uniform with no lift at all. If the floor is ever
 * raised or the lifting broken in a way that makes everything get processed, this catches it --
 * the result would still be legible, still pass the contrast check, and no longer look like the
 * clubs the user supplied.
 */
const untouched = THEMES.map(
  (theme) => INITIAL_TEAMS.filter((t) => clubInkReport(t.id as TeamId, 'panel', theme).lift === 0).length,
);
check(
  'clubs that already clear the floor are drawn untouched, in both themes',
  untouched.every((n) => n >= 15),
  THEMES.map((theme, i) => `${theme} ${untouched[i]}/32`).join('   ')
    + '   a broken lift would push these toward 0',
);

/**
 * The fallback is recorded, not silent.
 *
 * `urb` is the only club that falls through today, and it is right to: #1b1b1a is essentially black,
 * so lifting it yields grey and there is no hue to preserve. The check asserts the fallback is
 * *reported* in the result -- if a caller were handed a lifted grey and believed it was the club's
 * primary, that is a silent lie about identity.
 */
const mislabelled = THEMES.flatMap((theme) =>
  INITIAL_TEAMS.filter((t) => {
    const r = clubInkReport(t.id as TeamId, 'panel', theme);
    return r.fellBack && r.slot === 'primary';
  }),
);
const fellBackIds = INITIAL_TEAMS.filter((t) => clubInkReport(t.id as TeamId).fellBack).map((t) => t.id);
check(
  'every fallback slot is reported as a fallback, in either theme',
  mislabelled.length === 0,
  `${fellBackIds.length} club(s) fell back (${fellBackIds.join(' ') || 'none'}), all reporting their real slot`,
);

/**
 * No club is left with nothing.
 *
 * The defensive floor under the fallback chain. A club whose three slots all failed to produce a
 * usable ink would render a blank panel edge, and the type system cannot catch it because the
 * palette is keyed by union and every key is present.
 */
const stranded = INITIAL_TEAMS.filter((t) => !clubInk(t.id as TeamId));
check(
  'no club is stranded without an ink',
  stranded.length === 0,
  stranded.length ? stranded.map((t) => t.id).join(' ') : `all ${INITIAL_TEAMS.length} resolve to a colour`,
);

/* ------------------------------------------------------------------ palette shape */

const degenerate = INITIAL_TEAMS.filter((t) => {
  const p = teamColors[t.id as TeamId];
  return p.primary === p.secondary && p.primary === p.tertiary;
});
check(
  'no club collapses to a single colour in all three slots',
  degenerate.length === 0,
  degenerate.length
    ? degenerate.map((t) => t.id).join(' ')
    : 'all 32 have three distinguishable slots (re-checked live, not assumed)',
);

const dupPrimary = INITIAL_TEAMS.filter((t) => {
  const p = teamColors[t.id as TeamId];
  return p.primary === p.secondary;
});
console.log(
  `  note  ${dupPrimary.length} club(s) share primary and secondary exactly (${dupPrimary
    .map((t) => t.id)
    .join(' ')}) -- reported, not a failure: it only means the fallback has one fewer step.`,
);

/* ------------------------------------------------------------------ semantic collisions */

/**
 * The rule: club colour may decorate, never carry meaning.
 *
 * This check does not enforce that rule -- it cannot, because "carries meaning" is a property of a
 * position rather than of a colour. What it does is enumerate the near-collisions so the rule has
 * a measured size, and so a club colour edited into a semantic colour is noticed rather than
 * shipped.
 *
 * Reported at dE 12 rather than gated. Gating on it would mean editing a club's real uniform
 * because the design system happens to use a similar shade, which is backwards.
 */
function labOf(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const ch = (i: number) => {
    const v = parseInt(clean.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [ch(0), ch(2), ch(4)];
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    (0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_) * 100,
    (1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_) * 100,
    (0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_) * 100,
  ];
}
const deltaE = (a: string, b: string) => {
  const A = labOf(a);
  const B = labOf(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

const SEMANTIC: Record<string, string> = {
  gold: '#d4bb6a',
  pos: '#4ade80',
  neg: '#f2555a',
  warn: '#e8a33d',
  info: '#5b9bd5',
  neutral: '#3fb8ab',
  platinum: '#17b690',
  prestige: '#a79b00',
};
const collisions: string[] = [];
for (const team of INITIAL_TEAMS) {
  const ink = clubInk(team.id as TeamId);
  if (!ink) continue;
  for (const [token, hex] of Object.entries(SEMANTIC)) {
    const d = deltaE(ink.hex, hex);
    if (d < 12) collisions.push(`${team.id}/${ink.slot} ~ ${token} dE ${d.toFixed(1)}`);
  }
}
checks += 1;
console.log(`  ok    semantic-collision census (reported, not gated)`);
console.log(
  `        ${collisions.length} drawn ink(s) within dE 12 of a semantic token, of ${INITIAL_TEAMS.length} clubs`,
);
if (collisions.length) console.log(`        ${collisions.join('  ')}`);
console.log('        this is why colour may decorate but never carry meaning');

/* ------------------------------------------------------------------ verdict */

console.log(
  `\n  ${checks - 1} checks, ${failures} failed${failures ? '' : ' -- all PASS'}\n`,
);
process.exitCode = failures === 0 ? 0 : 1;