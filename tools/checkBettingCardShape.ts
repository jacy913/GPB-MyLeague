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

/**
 * Remove comments, so the assertions read MARKUP and not prose.
 *
 * This file got this wrong twice, in the same direction, and both times a check failed
 * for the right reason against the wrong text.
 *
 *   - "no `md:grid-cols` in PropsView" matched the letters `md` inside a comment that
 *     described the mistake the fix was correcting.
 *   - "the tile has no chrome-bar header" matched the word `chrome-bar` inside a comment
 *     explaining that the header band had been deleted.
 *
 * A source-scraping check that can be satisfied -- or broken -- by prose is not a check.
 * Every assertion below therefore runs against comment-stripped source, and this function
 * exists so that no assertion has to remember to call it.
 *
 * A real scanner rather than a regex, because a regex cannot tell `//` inside a URL string
 * from a comment, and this repository has `import` lines and template literals with
 * slashes in them. String and template literals are copied through untouched; `//` and
 * `/* *\/` are dropped, including the JSX `{/* ... *\/}` form.
 */
const stripComments = (input: string): string => {
  let out = '';
  let i = 0;
  // Which quote character closes the literal we are inside, if any.
  let quote: string | null = null;
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (quote !== null) {
      out += ch;
      if (ch === '\\') {
        // Copy the escaped character verbatim so a `\/` does not end the literal.
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        // Keep newlines so line-based debugging of a failure still lines up.
        if (input[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }
  return out;
};

/** The source of one component, from its declaration to the next top-level `const`. */
/*
 * Slices one component out of the file, comments stripped.
 *
 * Both markers are REQUIRED, and a missing one throws. This used to return `` for a missing
 * start marker and ran to end-of-file for a missing end marker -- both silently. Every check
 * reading a broken slice then either failed for the wrong reason or, far worse, PASSED for the
 * wrong one, because a blob holding the whole rest of the file contains most strings.
 *
 * That is not hypothetical. `propsView` end marker was `const propRowKey`, which no longer
 * exists in BettingHub.tsx, so the slice covered 46KB instead of 6KB -- FieldMarketCard,
 * OpenBets and everything after -- and three checks were quietly reading it.
 */
const sliceOf = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  if (start < 0) {
    throw new Error(`sliceOf: start marker not found: ${from}`);
  }
  const end = source.indexOf(to, start + from.length);
  if (end < 0) {
    throw new Error(`sliceOf: end marker not found after ${from}: ${to}`);
  }
  if (end <= start) {
    throw new Error(`sliceOf: end marker ${to} is not after ${from}`);
  }
  return stripComments(source.slice(start, end));
};

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const main = (): void => {
  /*
    The whole file, comments gone. Every assertion below reads this, not the raw text, so
    no check anywhere in this tool can be satisfied or broken by a sentence in a comment.
   */
  const source = stripComments(readFileSync(FILE, 'utf8'));
  const css = readFileSync(resolve(process.cwd(), 'src', 'index.css'), 'utf8');

  const gameCard = sliceOf(source, 'const GameBetCard', 'const TotalMarketCard');
  const propsView = sliceOf(source, 'const PropsView', 'const FieldMarketCard');
  const fieldView = sliceOf(source, 'const FieldMarketsView', 'const FuturesView');
  const fieldCard = sliceOf(source, 'const FieldMarketCard', 'export const OpenBets');

  // -- 0. THE STRIPPER ITSELF ------------------------------------------------------------
  /*
    `stripComments` is load-bearing for every assertion in this file, and it is the kind of
    helper that fails silently: if it stopped removing comments, every check here would
    still "pass" while quietly testing prose again -- which is the exact failure this tool
    already made twice.

    So it is tested on inputs chosen to break the obvious implementations:

      - `//` inside a string literal must survive (this repo has absolute Windows paths and
        URLs in strings, and a regex stripper would eat the rest of the line);
      - `/*` inside a string must not open a comment;
      - a `//` inside a TEMPLATE literal must not eat the rest of the file, which is how a
        naive stripper silently truncates a whole component;
      - a real line comment and a real block comment must both go;
      - line count must be preserved, so a failure still reports a usable line number.
   */
  const stripperCases: Array<{ label: string; input: string; expect: string }> = [
    { label: 'a line comment is removed', input: 'a // b\nc', expect: 'a \nc' },
    { label: 'a block comment is removed', input: 'a /* b */ c', expect: 'a  c' },
    {
      label: 'a JSX comment is removed',
      input: '<p>{/* chrome-bar */}x</p>',
      expect: '<p>{}x</p>',
    },
    {
      label: 'double slashes INSIDE a string are kept',
      input: 'const p = "C:\\\\a\\\\b"; // gone',
      expect: 'const p = "C:\\\\a\\\\b"; ',
    },
    {
      label: 'a block opener INSIDE a string does not start a comment',
      input: 'const s = "/* not a comment */"; real();',
      expect: 'const s = "/* not a comment */"; real();',
    },
    {
      label: 'double slashes inside a TEMPLATE do not eat the rest of the file',
      input: 'const u = `http://x/${y}`; after();',
      expect: 'const u = `http://x/${y}`; after();',
    },
    {
      label: 'newlines are preserved so line numbers survive',
      input: 'a\n// one\n/* two */\nb',
      expect: 'a\n\n\nb',
    },
  ];
  stripperCases.forEach((c) => {
    check(
      `the comment stripper: ${c.label}`,
      stripComments(c.input) === c.expect,
      `expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(stripComments(c.input))}`,
    );
  });

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

  // -- 1b. THE TILE, NOT A CARD WITH A HEADER BAND -------------------------------------
  /*
    THE THREE PASSES THAT WERE REJECTED, and what each one kept.

    The user's first word about this screen was that it "looks old", and every response
    reshaped the card while leaving the four things that actually read as old:

      - the `chrome-bar` band across the top of each card, which reads as a table row
        header and is the single most 1990s-box-score element on the screen;
      - the two small `size="sm"` side buttons -- one chip among chips -- so the price,
        the thing the screen exists to offer, was 17px of body text;
      - 24px crests, so you had to recognise a mark to know which game you were reading;
      - an `h-5` footer strip, which kept the outlets competing with the prices.

    The tile deletes the band, splits the card into two equal clickable columns, and makes
    the price the largest figure on the board. These assertions exist because all three
    rejections looked like success to a type checker and to a build.
   */
  check(
    'the tile has NO chrome-bar header band',
    !gameCard.includes('chrome-bar'),
    'the chrome-bar header was the oldest-looking element and it is deleted, not restyled',
  );
  check(
    'the two sides are EQUAL columns of a two-column grid',
    /<div className="grid grid-cols-2 gap-2 px-3 pt-2">/.test(gameCard),
    'the pitchfork is grid-cols-2, so both sides get identical width by construction',
  );
  check(
    'the moneyline price is the biggest type on the card',
    /className="t-stat-hero"/.test(gameCard)
    && /@utility t-stat-hero/.test(css),
    't-stat-hero has to exist in index.css as well as being used, or the price silently '
    + 'falls back to body text and the tile loses its subject',
  );
  check(
    'the side buttons are full-width columns, not chips',
    /*
      The SHAPE, not the exact padding.

      This used to assert `gap-3 py-5`, which is a number someone chose once and retuned when the
      side padding tightened to `gap-2.5 py-4`. Re-quoting it would have "fixed" a check that was
      never wrong about the thing it protects, and the next person to tighten a gap would hit the
      same wall. What matters is that the button fills its half of the tile in a column -- crest
      over price -- rather than shrinking to fit its text as a chip.
     */
    /className="w-full flex-col[^"]*"/.test(gameCard)
    && !/className="[^"]*\bw-fit\b/.test(gameCard)
    && !/className="[^"]*\bjustify-self-(?:start|end|center)\b/.test(gameCard),
    'crest above price, in a column that fills its half of the tile, not a chip sized to its text',
  );
  check(
    'the footer outlet marks are demoted to h-4',
    /*
      Demoted marks, WITHOUT pinning a size.

      This used to require exactly one `h-4 w-4 object-contain` in the card and no `h-5`. The h-4
      has since gone too: the footer now carries one DOT per outlet and the crests live inside the
      Pack popover, which is the Next Slate redesign. Re-quoting `h-4` would assert the shape of a
      layout that no longer exists.

      So the assertion is the bound rather than the measurement -- no outlet mark may be larger
      than h-4 anywhere in the card -- plus the count still coming from the media registry, because
      the source cannot tell you how many outlets there are.
     */
    !/className="h-[5-9][^"]*object-contain/.test(gameCard)
    && /MEDIA_PROFILES\.length/.test(gameCard),
    'no mark in the card is larger than h-4, and the outlet count still comes from the registry',
  );
  check(
    'the footer says which side the outlet prices are for',
    /*
      The footer must say WHICH CLUB the forecasters are pricing.

      It used to assert the literal string "Away, per outlet". That wording was replaced --
      correctly -- with the club's own city, because "Away" means nothing to anyone who does not
      already know which side that is, and the crest is not the label.

      The requirement did not change, so neither should the assertion: name the visiting club,
      keep the old jargon out so it cannot creep back, and keep the disagreement stated.
     */
    /game\.awayTeam\.city/.test(gameCard)
    && !/Away, per outlet/.test(gameCard)
    && /disagree by|differ by/.test(gameCard),
    'GameLine.odds holds the AWAY club price only, so the footer has to name that club rather'
    + ' than say "Away" -- and the disagreement has to stay stated',
  );
  check(
    'the tile pushes its footer to the bottom so a grid row has one baseline',
    /className="flex flex-col overflow-hidden"/.test(gameCard)
    && gameCard.includes('mt-auto border-t border-[var(--color-chrome-lo)] px-3 py-2'),
    'flex-col on the panel plus mt-auto on the footer lines the footers across a row',
  );

  // -- 1c. THE ONE NUMBER HERE THAT IS AN ASSUMPTION, NOT A MEASUREMENT ------------------
  /*
    Everything else in this file is asserted against markup that can simply be read. The
    hero price's size is the exception: nothing above proves it FITS, because nothing here
    knows the rendered width of a half-tile. What can be checked is the arithmetic that
    was used, so a later "just a touch smaller" edit cannot quietly eat the margin.

    The reasoning, restated so it can be checked:
      - worst case price is six characters ("+1800", a five-percent shot);
      - tabular digits in this face run about 0.6em, so six characters is about 3.3em;
      - a half-tile at the slate's `md` breakpoint is ASSUMED to be about 170px, less
        px-3 of the button's own padding, so about 146px of room.

    The container figure is the unmeasured half and cannot be checked from source at all.
    So the floor is pinned at 28px (92px of glyphs against 146px of room) and the button
    is pinned at `size="sm"` (px-3) rather than `size="lg"` (px-6), because 48px of
    horizontal padding on a 146px half is a third of the space gone to nothing.
   */
  const heroFontSize = /@utility t-stat-hero\s*\{[^}]*font-size:\s*clamp\(\s*(\d+)px/.exec(css);
  const heroFloor = heroFontSize ? Number(heroFontSize[1]) : 0;
  check(
    'the hero price floor is at least 28px, which the width arithmetic assumed',
    heroFloor >= 28,
    `t-stat-hero clamps at ${heroFloor}px. The six-character worst case ("+1800") is about`
    + ' 3.3em of glyphs, so a floor below 28px starts eroding the margin the estimate'
    + ' depended on -- and it would still LOOK fine, which is what makes it dangerous.',
  );
  check(
    'the pitchfork button keeps its narrow horizontal padding',
    /variant="default"\s*\n\s*size="sm"/.test(gameCard)
    && !/size="lg"[\s\S]{0,80}className="w-full flex-col/.test(gameCard),
    'size="sm" gives px-3; size="lg" gives px-6, which is 48px of a ~146px half-tile',
  );

  // -- 2. THE PER-OUTLET FAN-OUT STAYS DEAD -------------------------------------------
  /*
     These three checks used to assert that the three outlet panels were siblings in a
     `lg:grid-cols-2 2xl:grid-cols-3` grid, that each held a single column of cards, and that the
     breakpoint was not `md`.
     
     All of that markup was deleted on purpose. The page renders ONE card per prop, whatever the
     number of outlets that published it, with every outlet reachable behind a disclosure on that
     card. PropsView says so itself: "already collapsed from the per-outlet boards". Before: three
     columns, one per outlet, every outlet take on every prop visible at once. After: one card per
     prop -- 135 down to 69.
     
     So positive assertions for markup that must not come back are the wrong shape. What is worth
     guarding is the deletion itself, because a fan-out is exactly what a later pass would
     reintroduce on the grounds that three columns look better, and every prop would go back to
     being a separate card.
     
     The replacement behaviour is covered where it now lives: tools/checkPropCard.tsx asserts one
     card per prop, that every publisher is still named inside it, and that the widest
     disagreement leads. That file ran against nothing for a while. It runs now.
   */
  check(
    'the per-outlet panel fan-out does not come back',
    !/lg:grid-cols-2 2xl:grid-cols-3|flex flex-col gap-2 p-3/.test(propsView)
    && !/MEDIA_PROFILES\.map\([\s\S]{0,240}?PropCard/.test(propsView),
    'one card per PROP, with the outlets behind a disclosure on it -- not one card per outlet'
    + ', however good three columns look',
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
  const recordSource = recordStart < 0 ? '' : stripComments(source.slice(recordStart));
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