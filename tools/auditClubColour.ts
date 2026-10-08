/**
 * The measurement behind `src/lib/clubColour.ts`. Reprints every number the module's header claims.
 *
 * This REPORTS and `checkClubInk.ts` GATES. Two scripts on purpose: merging them is how a report
 * comes to be read as an assertion. Nothing here decides pass or fail.
 *
 * Run: `npx tsx tools/auditClubColour.ts`
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { teamColors, PALETTE_SLOTS, type PaletteSlot, type TeamId } from '../src/data/teamColors';
import {
  CLUB_SURFACES,
  INK_CONTRAST_FLOOR,
  clubInk,
  clubInkReport,
  clubWash,
  clubSurface,
  contrastRatio,
  relativeLuminance,
  type ClubTheme,
} from '../src/lib/clubColour';

const THEMES: ClubTheme[] = ['regular', 'autumn'];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/* ---------------------------------------------------------------- 1. the problem */

console.log('\n=== 1. WHY A RAW HEX CANNOT BE DRAWN ===\n');
console.log('    club        primary   WCAG luma   contrast vs panel   verdict');
console.log('    ' + '-'.repeat(66));

let below = 0;
for (const team of INITIAL_TEAMS) {
  const r = clubInkReport(team.id as TeamId);
  const fails = r.sourceContrast < 1.2;
  if (fails) below += 1;
  console.log(
    `    ${team.id.padEnd(6)} ${r.source.primary.padEnd(9)} ${relativeLuminance(r.source.primary)
      .toFixed(3)
      .padStart(9)}   ${r.sourceContrast.toFixed(2).padStart(6)}:1        ${
      fails ? 'INVISIBLE AS A RULE' : ''
    }`,
  );
}
console.log(
  `\n    --color-panel WCAG luma is ${relativeLuminance(clubSurface('panel')).toFixed(3)}`
    + ` (autumn ${relativeLuminance(clubSurface('panel', 'autumn')).toFixed(3)});`
    + ` --color-ink is ${relativeLuminance('#f2f5ff').toFixed(3)}.`,
);
console.log(
  `\n    ${below} of 32 primaries sit under 1.2:1 on --color-panel and would be invisible as a rule.`,
);

/* ---------------------------------------------------------------- 2. band summary */

console.log('\n=== 2. RAW CONTRAST BANDS, PER SLOT, PER SURFACE ===\n');
console.log('    absent <1.2   subtle <1.6   readable <3.0   strong >=3.0');
console.log('    (the 1.2 edge is CHOSEN, not measured -- see INK_CONTRAST_FLOOR)\n');

for (const theme of THEMES) {
  for (const [name, surface] of Object.entries(CLUB_SURFACES[theme])) {
    const tallies: Record<PaletteSlot, { absent: number; subtle: number; readable: number; strong: number }> = {
      primary: { absent: 0, subtle: 0, readable: 0, strong: 0 },
      secondary: { absent: 0, subtle: 0, readable: 0, strong: 0 },
      tertiary: { absent: 0, subtle: 0, readable: 0, strong: 0 },
    };
    for (const team of INITIAL_TEAMS) {
      for (const slot of PALETTE_SLOTS) {
        const c = contrastRatio(teamColors[team.id as TeamId][slot], surface);
        const bucket = c < 1.2 ? 'absent' : c < 1.6 ? 'subtle' : c < 3 ? 'readable' : 'strong';
        tallies[slot][bucket] += 1;
      }
    }
    console.log(`    [${theme}] --color-${name}  ${surface}`);
    for (const slot of PALETTE_SLOTS) {
      const t = tallies[slot];
      console.log(
        `      ${slot.padEnd(10)} absent ${String(t.absent).padStart(2)}   subtle ${String(t.subtle).padStart(
          2,
        )}   readable ${String(t.readable).padStart(2)}   strong ${String(t.strong).padStart(2)}`,
      );
    }
  }
}

/* ---------------------------------------------------------------- 3. tertiary shape */

console.log('\n=== 3. WHY TERTIARY IS A WASH AND NOT A RULE ===\n');
// Compared as luminance, not as a contrast ratio. Luminance is monotonic, so the old version of
// this said the same thing, but expressing a luminance question as a contrast ratio reads as though
// the 1.2:1 floor were involved and it is not.
const panelLuma = relativeLuminance(clubSurface('panel'));
const darkerThanPanel: string[] = [];
const lighterThanPanel: string[] = [];
for (const team of INITIAL_TEAMS) {
  const t = teamColors[team.id as TeamId].tertiary;
  (relativeLuminance(t) < panelLuma ? darkerThanPanel : lighterThanPanel).push(team.id);
}
console.log(
  `    tertiary DARKER than --color-panel: ${darkerThanPanel.length} of 32  (a rule is invisible, a wash cools)`,
);
console.log(`      ${darkerThanPanel.join(' ')}`);
console.log(
  `    tertiary LIGHTER:                    ${lighterThanPanel.length} of 32  (several are pure white)`,
);
console.log(`      ${lighterThanPanel.join(' ')}`);
console.log(
  `\n    So one treatment cannot serve both halves. A wash works either way; a hairline only works\n    on the lighter half. That is the whole argument for clubWash over a tertiary border.`,
);

/* ---------------------------------------------------------------- 4. the fix */

for (const theme of THEMES) {
  console.log(`\n=== 4. WHAT clubInk PRODUCES, ${theme} (floor ${INK_CONTRAST_FLOOR}:1) ===\n`);
  console.log('    club   slot used    ink       contrast   lift     hue drift');
  console.log('    ' + '-'.repeat(66));

  let untouched = 0;
  let fellBack = 0;
  let worstContrast = Infinity;
  let worstClub = '';

  for (const team of INITIAL_TEAMS) {
    const r = clubInkReport(team.id as TeamId, 'panel', theme);
    let drift = Math.abs(r.inkHue - r.sourceHue);
    if (drift > 180) drift = 360 - drift;
    if (r.lift === 0) untouched += 1;
    if (r.fellBack) fellBack += 1;
    if (r.inkContrast < worstContrast) {
      worstContrast = r.inkContrast;
      worstClub = team.id;
    }
    console.log(
      `    ${team.id.padEnd(6)} ${r.slot.padEnd(10)} ${String(r.ink).padEnd(9)} ${r.inkContrast
        .toFixed(2)
        .padStart(6)}:1   ${pct(r.lift).padStart(6)}   ${drift.toFixed(1).padStart(5)} deg${
        r.fellBack ? '   <- fell back' : ''
      }`,
    );
  }

  console.log(
    `\n    [${theme}] ${untouched} of 32 primaries needed no lift; ${fellBack} fell back.`
      + ` worst drawn contrast ${worstContrast.toFixed(2)}:1 (${worstClub}).`,
  );
}

/* ---------------------------------------------------------------- 5. every surface */

console.log('\n=== 5. EVERY CLUB AGAINST EVERY SURFACE, BOTH THEMES ===\n');
let anyFail = false;
for (const theme of THEMES) {
  for (const [name, surface] of Object.entries(CLUB_SURFACES[theme])) {
    let worst = Infinity;
    let who = '';
    for (const team of INITIAL_TEAMS) {
      const ink = clubInk(team.id as TeamId, name as 'panel', theme);
      if (!ink) continue;
      const c = contrastRatio(ink.hex, surface);
      if (c < worst) {
        worst = c;
        who = team.id;
      }
    }
    const ok = worst >= INK_CONTRAST_FLOOR;
    if (!ok) anyFail = true;
    console.log(
      `    [${theme.padEnd(7)}] --color-${name.padEnd(8)} worst ${worst.toFixed(2)}:1 (${who})   ${
        ok ? 'all clear' : 'BELOW FLOOR'
      }`,
    );
  }
}
if (anyFail) console.log('\n    A club fell below the floor on some surface. clubInk is supposed to make that impossible.');

/* ---------------------------------------------------------------- 6. washes */

console.log('\n=== 6. SAMPLE WASHES (what the bench rows and panel body will read as) ===\n');
for (const id of ['and', 'loy', 'des', 'urb', 'ars', 'sin'] as TeamId[]) {
  console.log(`    ${id}  ink ${clubInk(id)?.hex}   wash 10% ${clubWash(id, 0.1)}`);
}

console.log('\n');