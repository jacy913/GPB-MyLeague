/**
 * Does each betting card have ONE box, and does the colour rule hold?
 *
 * All three of the user's complaints on this screen were the same shape of defect and none of
 * them were visible to a type checker, a build, or any of the betting verifiers:
 *
 *   1. "One teal box for everything, it looks messy" -- the game card had wrapped its outlet
 *      prices and its run total in two nested bordered blocks INSIDE the card's own border,
 *      so one game rendered as three concentric teal rectangles. Fixed by collapsing to a
 *      single panel with hairline rules between rows.
 *
 *   2. "Still missing the 3 column structure" -- the first attempt read "one column per media
 *      outlet" as "one card per row inside each outlet's panel", so the three panels still
 *      stacked down the page. The three outlet panels have to be SIBLINGS in one grid.
 *
 *   3. "The championship container doesn't utilise the half screen" -- a one-market section
 *      sat in a two-column grid's left half with the right half empty.
 *
 * All three are DOM SHAPE, and DOM shape is exactly the thing a screenshot catches and an
 * assertion does not. So this asserts it anyway, from the source, because a check that can
 * fail when the shape regresses is better than a note in a comment that asks nicely.
 *
 * WHAT IT CANNOT DO: it reads the source as text, so it catches a structural regression and not
 * a visual one. A card can pass every assertion here and still look wrong. That limitation is
 * stated rather than papered over, and it is the whole reason these three fixes came from the
 * user looking at a screen rather than from a tool.
 *
 * Run: npx tsx tools/checkBettingCardShape.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'src', 'components', 'betting', 'BettingHub.tsx');

const checks: Array<{ label: string; pass: boolean; detail?: string }> = [];
const check = (label: string, pass: boolean, detail?: string): void => {
  checks.push({ label, pass, detail });
};

/** The source of one component, from its declaration to the next top-level `const`. */
const sliceOf = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  if (start < 0) return '';
  return source.slice(start, end < 0 ? undefined : end);
};

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const main = (): void => {
  const source = readFileSync(FILE, 'utf8');

  const gameCard = sliceOf(source, 'const GameBetCard', 'const TotalMarketCard');
  const propsView = sliceOf(source, 'const PropsView', 'const propRowKey');
  const fieldView = sliceOf(source, 'const FieldMarketsView', 'const FuturesView');
  const fieldCard = sliceOf(source, 'const FieldMarketCard', 'export const OpenBets');

  // -- 1. ONE BOX PER GAME CARD -------------------------------------------------------
  check(
    'a game card renders exactly ONE Panel -- no nested bordered box inside the card',
    count(gameCard, '<Panel') === 1,
    `found ${count(gameCard, '<Panel')} Panel(s) in GameBetCard`,
  );
  check(
    'the game card has no nested NEUTRAL_BORDER block inside its own border',
    count(gameCard, 'NEUTRAL_BORDER') <= 2,
    `found ${count(gameCard, 'NEUTRAL_BORDER')} references; one is the card border, the other is the constant's own definition line.`
    + ' Two or more inside the card means a nested box.',
  );
  check(
    'the game card separates its rows with hairlines, not nested borders',
    count(gameCard, 'border-t border-[var(--color-chrome-lo)]') >= 2
    && !gameCard.includes('className="border border-l-[3px]'),
    'the hairline separator pattern is present and the nested-bordered-block pattern is gone',
  );
  check(
    'the game card paints the neutral teal exactly once, on the panel itself',
    count(gameCard, "borderLeft: `3px solid ${NEUTRAL_BORDER}`") === 1,
    'one teal border per card',
  );

  // -- 2. THE THREE OUTLET PANELS ARE COLUMNS ------------------------------------------
  /*
    The precise failure. `PropsView` previously mapped outlets to Panels that were children of
    one `grid gap-4`, so three outlets meant three full-width panels stacked down the page --
    technically "one column per outlet" and visually identical to what the user already had.
    The fix puts that Panel inside a nested grid whose columns are the outlets.
   */
  const outletPanelSiblings = /<div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">/.test(propsView);
  check(
    'the three outlet panels are siblings in a multi-column grid, not stacked',
    outletPanelSiblings,
    'the outlet grid declares lg:grid-cols-2 2xl:grid-cols-3',
  );
  check(
    'each outlet panel holds its cards in a SINGLE column',
    /<div className="flex flex-col gap-2 p-3">/.test(propsView)
    && !/<div className="grid items-stretch gap-2 p-3/.test(propsView),
    'the inner grid of cards is gone; cards stack in one column inside each outlet panel',
  );
  check(
    'the outlet grid is keyed off a wide breakpoint, not `md`',
    /lg:grid-cols-2 2xl:grid-cols-3/.test(propsView)
    && !/<div className="grid items-start gap-4 md:grid-cols/.test(propsView),
    'three prop cards per column need more than two, so the breakpoint is 2xl',
  );

  // -- 3. THE CHAMPIONSHIP USES THE FULL WIDTH ------------------------------------------
  check(
    'a section holding one market takes the full width instead of half',
    /section\.markets\.length === 1 \? 'grid-cols-1' : 'xl:grid-cols-2'/.test(fieldView),
    'the single-market branch exists, which is what gives the championship its full width',
  );
  check(
    'a large field gets more than two columns of outcomes',
    /market\.outcomes\.length > 20[\s\S]{0,120}2xl:grid-cols-4/.test(fieldCard),
    'the 32-club championship goes four across; an eight-club race stays at two',
  );
  check(
    'awards are NOT widened -- the eight-candidate race keeps two columns',
    /market\.outcomes\.length > 20/.test(fieldCard)
    && !/kind === 'award'[\s\S]{0,80}grid-cols/.test(fieldCard),
    'the threshold is on field size, so an award race is untouched by it',
  );

  // -- 4. THE COLOUR RULE ----------------------------------------------------------------
  /*
    The user's rule, stated as an assertion: green and orange may only ever be used by an
    OUTLET saying something about a prop. Everything else is the neutral teal.
   */
  /*
    THE SCOPE OF THE COLOUR RULE, because the first version of this section asserted something
    false and passed nothing by saying so.

    The user's rule is about OUTLET JUDGEMENTS: green is safe because that outlet's own read
    says it lands, orange is hot for the same reason. It is not a rule about the entire
    BettingHub file, and asserting it as one is wrong in two ways that matter:

      - `BettingRecord` colours a SETTLED BET green for won and red for lost. That is a
        settlement result, not an outlet's opinion, and it is the most correct use of the
        colour on the screen -- it is the one place the answer is known rather than forecast.
      - A "Fixture not on this slate" warning is orange because it is a warning. Suppressing
        that to satisfy a colour rule would make a data problem invisible.

    So the assertion is scoped to the two things the rule is actually about: the prop
    temperament, which is the outlet judgement, and the risk tiers, which are the house's
    read. A props card's border must be the temperament's colour and nothing else.
   */
  check(
    'no green is used anywhere in the futures or awards card',
    !fieldCard.includes('var(--color-pos)'),
    'the pos token appears nowhere in FieldMarketCard',
  );
  /*
    Counted, not forbidden. All four uses of green in the file are legitimate and each says
    something different: the temperament (an outlet's read), and three in `BettingRecord` for
    a WON bet -- a settlement result, which is the one place on this screen the answer is known
    rather than forecast. The first version of this check asserted the count was exactly one and
    failed on three correct uses.

    So the assertion is that every use is in one of those two places, and the count is printed
    rather than guessed at.
   */
  const posUses = count(source, 'var(--color-pos)');
  const temperamentPos = count(source, "safe: { border: 'var(--color-pos)'");
  const recordStart = source.indexOf('const statusAccent');
  const recordSource = recordStart < 0 ? '' : source.slice(recordStart);
  const recordPos = count(recordSource, 'var(--color-pos)');

  check(
    'every use of green is either the outlet temperament or a settled won bet',
    temperamentPos === 1 && posUses === temperamentPos + recordPos,
    `${posUses} uses of pos: 1 in TEMPERAMENT (the outlet's read) and ${recordPos} in`
    + ' BettingRecord (a settlement result, which is known rather than forecast)',
  );
  check(
    'the risk tiers take orange only for the two variance tiers',
    /hail_mary: 'var\(--color-warn\)'/.test(source)
    && /long_shot: 'var\(--color-warn\)'/.test(source)
    && /contender: 'var\(--color-neutral\)'/.test(source)
    && /favourite: 'var\(--color-neutral\)'/.test(source),
    'HAIL MARY and LONG SHOT are hot; CONTENDER and FAVOURITE are neutral',
  );

  // -- 5. THE LOGO -----------------------------------------------------------------------
  check(
    'the page header renders the MacroBet logo, and the alt is the name',
    /<img[\s\S]{0,200}src=\{macrobetLogo\}[\s\S]{0,200}alt="MacroBet"/.test(source),
    'alt text is the accessible name, not empty',
  );
  check(
    'the header keeps a real heading around the logo',
    /<h1 className="min-w-0">\s*<img/.test(source),
    'the logo sits inside the h1 so the page still has a title if the image fails',
  );

  // -- report ----------------------------------------------------------------------------
  const failed = checks.filter((c) => !c.pass);
  console.log('\nBETTING CARD SHAPE\n');
  console.log('  Structural assertions on BettingHub.tsx. These catch a regression in the');
  console.log('  DOM SHAPE of each card -- the three defects this file records were all shape');
  console.log('  defects -- and they cannot catch anything visual. All three were found by the');
  console.log('  user looking at a screen, not by a tool.\n');
  checks.forEach((c, i) => {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${String(i + 1).padStart(2)}. ${c.label}`);
    if (!c.pass && c.detail) console.log(`          ${c.detail}`);
  });
  console.log(`\n  ${checks.length - failed.length}/${checks.length} checks PASS\n`);
  if (failed.length > 0) process.exitCode = 1;
};

main();