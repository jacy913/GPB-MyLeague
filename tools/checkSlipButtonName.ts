/*
 * The header button must not promise a feature that does not exist.
 *
 * THE BUG. The button read "Parlays" and opened the betting slip, which its own header comment
 * describes as "deliberately NOT a parlay" -- parlays were rejected because multiplying legs against
 * three forecasters whose calibration has been fitted makes the combined bet strictly worse value than
 * the same money flat. So a reader who took the visible word at face value went looking for a parlay
 * builder that has never existed.
 *
 * It was worse than a stale label, because the button's `aria-label` has always said "Betting slip".
 * The visible name and the accessible name were two different products, on the same control, for as
 * long as it has been there -- and a screen reader and a sighted reader were being told two different
 * things about what pressing it does.
 *
 * This asserts three things, because any one of them alone is a weaker check than it looks:
 *
 *   1. No user-facing string anywhere says "parlay". Comments may, and one does, explaining this.
 *   2. The button's visible text and its accessible name describe the SAME control.
 *   3. The label names what the badge counts, so the number beside it is explicable.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Recursive walk. globSync is Node 22+ and this runs on Node 20. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    // ONE backslash, not two. Written through a shell here first and doubled, which made the
    // replacement a no-op on Windows, left every key as `src\App.tsx`, and had the file lookup below
    // return an empty string -- so the check read a button that did not exist rather than failing on
    // the button that did.
    else if (/\.tsx?$/.test(entry)) out.push(full.replace(/\\/g, '/'));
  }
  return out;
};

const problems: string[] = [];

const files = walk('src');
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

console.log('\nTHE HEADER BUTTON -- does it name something that exists?\n');

// -- 1. no user-facing "parlay" -----------------------------------------------------
console.log('  USER-FACING STRINGS\n');
/**
 * Is this line inside a comment?
 *
 * NOT by prefix. The first version tested `^\s*(\*|//|/*)` and immediately flagged five lines that
 * were plainly inside comment blocks -- because a JSDoc block's CONTINUATION lines do not start with
 * an asterisk unless every one of them carries it, and one that does not looks exactly like code to a
 * line-prefix test. That produced a check which reported the very comment explaining the removal as
 * evidence the removal had not happened.
 *
 * So it tracks `/* ... *\/` state properly, which is the only way to answer the question.
 */
const codeLines = (src: string): Array<{ text: string; n: number; commented: boolean }> => {
  const out: Array<{ text: string; n: number; commented: boolean }> = [];
  let inBlock = false;
  src.split('\n').forEach((raw, i) => {
    let text = raw;
    let commented = inBlock;
    if (!inBlock && /\/\*/.test(text)) {
      commented = true;
      inBlock = !/\*\//.test(text.replace(/\/\*[\s\S]*/, ''));
    } else if (!inBlock && /^\s*\/\//.test(text)) {
      commented = true;
    }
    out.push({ text, n: i + 1, commented });
  });
  return out;
};

const offenders: string[] = [];

for (const [file, src] of sources) {
  for (const { text, n, commented } of codeLines(src)) {
    if (commented || !/parlay/i.test(text)) continue;
    offenders.push(`${file}:${n}: ${text.trim().slice(0, 90)}`);
  }
}

if (offenders.length) {
  offenders.forEach((o) => console.log(`    ${o}`));
  problems.push(`${offenders.length} user-facing line(s) still mention a parlay`);
} else {
  console.log('    none. Every mention is a comment explaining why the word was removed.');
}

// -- 2. the visible name and the accessible name agree ------------------------------
console.log('\n  VISIBLE NAME vs ACCESSIBLE NAME\n');
const app = sources.get('src/App.tsx') ?? '';

/*
 * FIND THE BUTTON AS A BLOCK, THEN READ ITS TWO NAMES.
 *
 * The first version used two regexes across the whole file: one for `aria-label` immediately followed
 * by `aria-expanded`, and one for a `hidden sm:inline` span shortly after `bettingSlip.toggle`. Both
 * found nothing, and the check correctly reported that it had gone blind -- because the real button
 * has a `className` between those attributes, and there are several `hidden sm:inline` spans in the
 * header.
 *
 * The lesson is the one this repo keeps teaching: a pattern that is written against the shape you
 * remember rather than the shape on disk finds nothing, and "found nothing" and "found nothing
 * wrong" are easy to confuse when the failure is silent. So: take the element, then read it.
 */
const toggleAt = app.indexOf('onClick={bettingSlip.toggle}');
const buttonStart = app.lastIndexOf('<button', toggleAt);
const buttonEnd = app.indexOf('</button>', toggleAt);
const button = buttonStart === -1 ? '' : app.slice(buttonStart, buttonEnd);

const aria = /aria-label="([^"]*)"/.exec(button)?.[1] ?? '(not found)';
const visible = /<span className="hidden sm:inline">([^<]*)<\/span>/.exec(button)?.[1] ?? '(not found)';
console.log(`    aria-label   "${aria}"`);
console.log(`    visible      "${visible}"`);

if (aria === '(not found)' || visible === '(not found)') {
  problems.push('could not find both names on the slip button -- this check has gone blind');
} else {
  const first = (s: string): string => s.trim().split(/\s+/)[0].toLowerCase();
  if (first(aria) !== first(visible)) {
    problems.push(`the button reads "${visible}" to a sighted reader and "${aria}" to a screen reader`);
  } else {
    console.log(`    both start "${first(visible)}" -- a sighted and a blind reader are told the same thing`);
  }
  if (/parlay/i.test(visible) || /parlay/i.test(aria)) problems.push('the button still names a parlay');
}

// -- 3. the badge is explicable ------------------------------------------------------
console.log('\n  AND THE BADGE IS EXPLICABLE\n');
const badge = /openBetCount\s*>\s*0/.test(button) && /\{openBetCount\}/.test(button);
const labelLower = visible.toLowerCase();
console.log(`    a badge is shown: ${badge}`);
console.log(`    the label names money at risk: ${['wager', 'bet', 'slip', 'money'].some((w) => labelLower.includes(w))}`);
if (!badge) problems.push('the open-bet badge is gone, so nothing justifies the position');
if (!['wager', 'bet', 'slip', 'money'].some((w) => labelLower.includes(w))) {
  problems.push(`"${visible}" does not name what the ${badge ? 'badge' : 'button'} counts`);
}

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('  the button names something that exists, both ways, and the badge means what it says.');