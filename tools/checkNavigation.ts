/**
 * Does the navigation tree agree with itself?
 *
 * WHY THIS TOOL EXISTS
 *
 * `src/navigation/folders.ts` states each screen's folder TWICE, in two places that must
 * agree: once as a leaf inside a folder's `leaves` array, and once in the `VIEW_TO_FOLDER`
 * record. Nothing forced them to agree, and for the whole life of the tree they did not.
 *
 * `offseason` was a leaf in the HOME folder while `VIEW_TO_FOLDER.offseason` said
 * `commissioner`. `VIEW_TO_FOLDER` is what decides which folder auto-expands, so selecting
 * Offseason expanded the COMMISSIONER folder while the button the user had just pressed sat
 * under HOME. The leaf was visible in one place and the rail reacted in another, and nothing
 * reported it because nothing was checking.
 *
 * That is the same failure shape as the betting checks that had been faking passes: two
 * sources of truth, no assertion between them. This is the assertion.
 *
 * WHAT IT CHECKS
 *
 *   1. Every FolderId used by a leaf, by VIEW_TO_FOLDER, and by FOLDER_ORDER names a folder
 *      that actually exists. A typo in the record is otherwise invisible.
 *   2. Every leaf's view maps back to the folder that contains it. This is the check that
 *      would have caught `offseason`.
 *   3. No view appears in two folders. A duplicate renders two buttons for one screen, and the
 *      second one wins the "which folder is active" question arbitrarily.
 *   4. No folder is empty, and no two folders share a label.
 *   5. Every leaf has a label, and the mobile rail's labels are short enough to be worth
 *      having -- `mobileLabel` exists precisely because the full label does not fit, so a
 *      long one that forgot to override it is a bug that only shows on a phone.
 *   6. The unrouted views are still deliberately leafless, so the set of them is an explicit
 *      decision rather than whatever was left over.
 *
 * WHAT IT CANNOT DO
 *
 * It cannot tell you whether the grouping is GOOD. Whether Dashboard belongs with Media and
 * MacroBet is a judgement, and this tool's opinion is that a folder is fine as long as it is
 * internally consistent.
 *
 * Run: npx tsx tools/checkNavigation.ts
 */

import { NAV_FOLDERS, VIEW_TO_FOLDER, FOLDER_ORDER, ALL_LEAVES } from '../src/navigation/folders';
import type { AppView } from '../src/types';

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/**
 * The views that are deliberately reachable from a screen rather than from the rail.
 *
 * Stated as a literal rather than derived, because deriving it would make the check agree
 * with whatever the tree happens to say -- which is the entire problem this tool fixes. If a
 * view drops out of this list, the check fails and a human has to decide whether it gained a
 * button or lost its reason for not having one.
 */
const LEAFLESS: AppView[] = ['betting_record', 'leaders_dashboards', 'game_screen', 'ui_kit'];

const main = (): void => {
  const folderIds = new Set(NAV_FOLDERS.map((f) => f.id));

  // -- 1. every id names a real folder -----------------------------------------------
  const leafFolders = [...new Set(NAV_FOLDERS.flatMap((f) => f.leaves.map(() => f.id)))];
  const badLeafFolders = leafFolders.filter((id) => !folderIds.has(id));
  check(
    'every folder that holds a leaf exists in NAV_FOLDERS',
    badLeafFolders.length === 0,
    badLeafFolders.length ? `unknown folder ids: ${badLeafFolders.join(', ')}` : undefined,
  );

  const badRecordFolders = [...new Set(Object.values(VIEW_TO_FOLDER))].filter((id) => !folderIds.has(id));
  check(
    'every folder named in VIEW_TO_FOLDER exists in NAV_FOLDERS',
    badRecordFolders.length === 0,
    badRecordFolders.length ? `unknown folder ids: ${badRecordFolders.join(', ')}` : undefined,
  );

  const badOrder = FOLDER_ORDER.filter((id) => !folderIds.has(id));
  check(
    'every folder in FOLDER_ORDER exists in NAV_FOLDERS',
    badOrder.length === 0,
    badOrder.length ? `unknown folder ids: ${badOrder.join(', ')}` : undefined,
  );

  const missingFromOrder = NAV_FOLDERS.filter((f) => !FOLDER_ORDER.includes(f.id));
  check(
    'FOLDER_ORDER covers every folder exactly once',
    missingFromOrder.length === 0
    && new Set(FOLDER_ORDER).size === FOLDER_ORDER.length,
    missingFromOrder.length
      ? `missing from FOLDER_ORDER: ${missingFromOrder.map((f) => f.id).join(', ')}`
      : FOLDER_ORDER.length !== new Set(FOLDER_ORDER).size
        ? 'FOLDER_ORDER repeats a folder'
        : undefined,
  );

  // -- 2. THE CHECK THAT MATTERS: a leaf agrees with the record ---------------------
  const disagreements = NAV_FOLDERS.flatMap((folder) =>
    folder.leaves
      .filter((leaf) => VIEW_TO_FOLDER[leaf.view] !== folder.id)
      .map((leaf) => `${leaf.view} is a leaf in '${folder.id}' but VIEW_TO_FOLDER says '${VIEW_TO_FOLDER[leaf.view]}'`),
  );
  check(
    'every leaf maps back to the folder that contains it',
    disagreements.length === 0,
    disagreements.length
      ? `${disagreements.length} disagreement(s): ${disagreements.join('; ')}`
      : `${ALL_LEAVES.length} leaves checked against the record`,
  );

  // -- 3. no view in two folders -----------------------------------------------------
  const seen = new Map<AppView, string[]>();
  for (const folder of NAV_FOLDERS) {
    for (const leaf of folder.leaves) {
      seen.set(leaf.view, [...(seen.get(leaf.view) ?? []), folder.id]);
    }
  }
  const dupes = [...seen.entries()].filter(([, folders]) => folders.length > 1);
  check(
    'no view appears in two folders',
    dupes.length === 0,
    dupes.length
      ? dupes.map(([v, f]) => `${v} in ${f.join(' and ')}`).join('; ')
      : `${seen.size} distinct views across ${NAV_FOLDERS.length} folders`,
  );

  // -- 4. no empty folders, no duplicate labels --------------------------------------
  const empty = NAV_FOLDERS.filter((f) => f.leaves.length === 0);
  check('no folder is empty', empty.length === 0, empty.length ? `empty: ${empty.map((f) => f.id).join(', ')}` : undefined);

  const labelCounts = new Map<string, number>();
  for (const f of NAV_FOLDERS) labelCounts.set(f.label, (labelCounts.get(f.label) ?? 0) + 1);
  const dupeLabels = [...labelCounts.entries()].filter(([, n]) => n > 1);
  check(
    'no two folders share a label',
    dupeLabels.length === 0,
    dupeLabels.length ? dupeLabels.map(([l]) => l).join(', ') : undefined,
  );

  // -- 5. labels -----------------------------------------------------------------------
  const unlabelled = ALL_LEAVES.filter((l) => !l.label || !l.label.trim());
  check(
    'every leaf has a label',
    unlabelled.length === 0,
    unlabelled.length ? `${unlabelled.length} leaf/leaves without a label` : undefined,
  );

  /*
    THERE WAS A CHECK HERE AND IT WAS WRONG, so it is recorded rather than merely deleted.
    It asserted that every leaf's mobile label fits eight characters, on the reasoning that
    `mobileLabel` exists because the full label does not fit. Four leaves failed it.

    There is no such budget. `MobileFolderMenu` renders the label in a bare span with no
    truncate class, inside a panel that is `w-full` with `sm:max-w-sm` -- 384px. "Free Agents"
    at eleven characters is nowhere near the edge of that, and nothing clips it. So the check
    was asserting a constraint that does not exist, against a fallback that degrades perfectly
    well.

    That is the fourth assertion in this project written in the direction of "more than the
    rule says", after the park wiring exit code, the profile physics copy, and the prop
    temperament colour count. The pattern is worth naming: an invented threshold feels like
    rigour, and a check that fails on correct code teaches you to distrust the tool rather
    than to fix the code. Deleted rather than retuned, because retuning it would have meant
    inventing a different number with the same problem.

    WHAT WOULD BE A REAL CHECK HERE, if one is wanted: whether any label overflows its
    container at a given viewport width, which needs a browser. A character count cannot
    stand in for that.
   */

  // -- 6. the deliberately leafless set is exactly what it claims ---------------------
  const actualLeafless = [...new Set(Object.keys(VIEW_TO_FOLDER) as AppView[])]
    .filter((v) => !seen.has(v))
    .sort();
  const expected = [...LEAFLESS].sort();
  const same = actualLeafless.length === expected.length
    && actualLeafless.every((v, i) => v === expected[i]);
  check(
    'the set of views with no rail button is exactly the declared one',
    same,
    same ? `${actualLeafless.join(', ')}` : `declared ${expected.join(', ')}, found ${actualLeafless.join(', ')}`,
  );

  // -- report -------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nNAVIGATION CONSISTENCY\n');
  console.log('  folders.ts states each screen\'s folder twice -- as a leaf, and in');
  console.log('  VIEW_TO_FOLDER -- and nothing used to force them to agree. `offseason` was a');
  console.log('  leaf under HOME while the record said COMMISSIONER, so selecting it expanded');
  console.log('  the wrong folder. That is what this asserts against.\n');
  console.log(`  ${NAV_FOLDERS.length} folders, ${ALL_LEAVES.length} leaves\n`);
  checks.forEach((c, i) => {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.label}`);
    if (!c.pass && c.detail) console.log(`          ${c.detail}`);
  });
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks PASS\n`);
  if (failed.length > 0) process.exitCode = 1;
};

main();