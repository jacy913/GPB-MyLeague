/**
 * Render the deduped prop card, collapsed and open, and check the markup.
 *
 * ============================================================================
 * WHY THIS EXISTS INSTEAD OF A SCREENSHOT
 * ============================================================================
 *
 * The rebuild's two claims are structural: one card per prop however many outlets published it,
 * and every one of those outlets still reachable. A screenshot can show the first. It cannot show
 * the second, because the open state needs a click, and a click in a screenshot harness is a thing
 * that silently stops working.
 *
 * So the disclosure is rendered directly here, in both states, and the assertions are about what
 * is IN the markup -- one disclosure row per publisher, the widest gap first, a fade button only
 * where a fade is warranted, and no orphan outlet.
 *
 * Run: npm run propcard
 *
 * The `--import ./tools/assetStub.mjs` in that script is not optional. This file imports real
 * components, and three things in that import graph do not exist under Node: image assets,
 * `import.meta.env`, and `import.meta.glob`. Without the loader the file dies on the imports and runs
 * zero assertions -- which is worse than having no check, because it looks like coverage.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropCard, PropOutletDisclosure } from '../src/components/betting/PropCard';
import { buildPropRows } from '../src/components/betting/propRows';
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import { propTemperamentFor } from '../src/lib/mediaProps';
import type { PropMarket } from '../src/lib/playerProps';
import type { GameLine } from '../src/lib/mediaOdds';

let failures = 0;
const check = (name: string, condition: boolean, detail = '') => {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
};

const market = (propId: string, probabilities: Partial<Record<MediaId, number>>): PropMarket => {
  const values = Object.values(probabilities) as number[];
  const consensus = values.reduce((sum, value) => sum + value, 0) / values.length;
  const spread = Math.max(...values) - Math.min(...values);
  const farthest = (Object.entries(probabilities) as [MediaId, number][])
    .reduce((worst, entry) => (Math.abs(entry[1] - consensus) > Math.abs(worst[1] - consensus) ? entry : worst));
  const temperament = {} as Record<MediaId, 'safe' | 'hot'>;
  for (const [id, value] of Object.entries(probabilities) as [MediaId, number][]) {
    temperament[id] = propTemperamentFor(value);
  }
  return {
    propId,
    gameId: propId.split(':')[0],
    playerId: propId.split(':')[1],
    stat: 'hits',
    statSingular: 'hit',
    statPlural: 'hits',
    line: Number(propId.split(':')[3]),
    playerName: 'Alvarez',
    date: '2026-04-14',
    probability: probabilities as Record<MediaId, number>,
    consensusProbability: consensus,
    temperament,
    spread,
    outlier: farthest[0],
  } as unknown as PropMarket;
};

const noop = () => undefined;
const RICH_BALANCE = 10_000;

/**
 * A slate fixture, with the two clubs the card paints crests for.
 *
 * The city names are asserted on because they are the crests' accessible name -- the one thing
 * that must survive painting a picture instead of the words.
 */
const FIXTURE = {
  gameId: 'g1',
  awayTeam: { id: 'reno', city: 'Reno', name: 'Renegades' },
  homeTeam: { id: 'mesa', city: 'Mesa', name: 'Mesquite' },
} as unknown as GameLine;

const row = (propId: string, probabilities: Partial<Record<MediaId, number>>) => {
  const boards = new Map<MediaId, PropMarket[]>();
  for (const [mediaId] of Object.entries(probabilities) as [MediaId, number][]) {
    boards.set(mediaId, [market(propId, probabilities)]);
  }
  return buildPropRows(boards)[0];
};

const card = (r: ReturnType<typeof row>) =>
  renderToStaticMarkup(
    React.createElement(PropCard, {
      row: r, focused: false, balance: RICH_BALANCE, fixture: FIXTURE,
      onPlace: noop, registerRef: noop,
    }),
  );

const disclosure = (r: ReturnType<typeof row>) =>
  renderToStaticMarkup(
    React.createElement(PropOutletDisclosure, {
      id: 'prop-detail-test', row: r, balance: RICH_BALANCE, onPlace: noop,
    }),
  );

const countOf = (html: string, needle: string) => html.split(needle).length - 1;

/** One dot in the outlet strip. Tailwind classes, not inline width. */
const DOTS = 'class="h-[6px] w-[6px] shrink-0"';

/* --- 1. one card, however many outlets published the prop ------------------ */
console.log('\n== 1. one card per prop, not one per outlet ==');
const threeWay = row('g1:p1:hits:2.5', { hollis: 0.62, sharply: 0.55, glorest: 0.58 });
check('the model holds one row', buildPropRows(new Map([
  ['hollis' as MediaId, [market('g1:p1:hits:2.5', { hollis: 0.62 })]],
  ['sharply' as MediaId, [market('g1:p1:hits:2.5', { sharply: 0.55 })]],
  ['glorest' as MediaId, [market('g1:p1:hits:2.5', { glorest: 0.58 })]],
])).length === 1);
const htmlThree = card(threeWay);
check('the card is marked with the prop id', htmlThree.includes('data-prop-row="g1:p1:hits:2.5"'));
check('the card says three outlets published it', htmlThree.includes('3 outlets published this'));
check('the strip carries three dots', countOf(htmlThree, DOTS) === 3, `got ${countOf(htmlThree, DOTS)}`);

console.log('\n== 2. the collapsed card shows the HOUSE price, not an outlet read ==');
check('house over button present', /Over\s*[+-]\d+/.test(htmlThree));
check('house under button present', /Under\s*[+-]\d+/.test(htmlThree));
check('collapsed card shows no outlet names', !htmlThree.includes('The Hollis Sentinel'));
check('collapsed card shows no outlet percentages', !/\d+% over/.test(htmlThree));
check('the disclosure is closed by default', htmlThree.includes('aria-expanded="false"'));

console.log('\n== 3. the disclosure names EVERY publisher, by person ==');
const openHtml = disclosure(threeWay);
for (const profile of MEDIA_PROFILES.filter((p) => threeWay.reads.some((r) => r.mediaId === p.id))) {
  check(`${profile.name} is present`, openHtml.includes(profile.name));
}
check('the house probability is stated', /House reads \d+% over/.test(openHtml));

console.log('\n== 3b. no two forecasters share a label ==');
/*
 * The regression this file now guards.
 *
 * Nine forecasters publish under five mastheads: three are "The Booth", two are "Glorest Sports",
 * two are "Calibrated Sports". Labelling a disclosure row by masthead rendered three identical words
 * beside three different probabilities, which is exactly the ambiguity the disclosure exists to
 * remove. Nine forecasters, nine names -- so the labels have to be unique, and this asserts it
 * rather than trusting it.
 */
const labels = MEDIA_PROFILES.map((p) => p.name);
check('all nine names are distinct', new Set(labels).size === MEDIA_PROFILES.length,
  `${new Set(labels).size} distinct of ${labels.length}`);
check('no name is empty', labels.every((name) => name.trim().length > 0));

const mastheads = MEDIA_PROFILES.map((p) => p.outlet);
const sharedMastheads = mastheads.filter((m, i) => mastheads.indexOf(m) !== i);
check('mastheads ARE shared, which is why names are required', sharedMastheads.length > 0,
  'if this ever fails the labels are no longer ambiguous and the guard above is vacuous');

console.log('\n== 4. the disclosure leads with the widest disagreement ==');
const wide = row('g1:p1:hits:2.5', { hollis: 0.50, sharply: 0.70, mussad: 0.66 });
const wideHtml = disclosure(wide);
const positions = (['The Hollis Sentinel', 'Sharply', 'Mussad'] as const)
  .map((name) => ({ name, at: wideHtml.indexOf(name) }))
  .filter((entry) => entry.at >= 0)
  .sort((a, b) => a.at - b.at);
check('read order is by gap, not by registry',
  positions[0]?.name === 'Sharply', positions.map((p) => `${p.name}@${p.at}`).join(' '));
check('the outlier is badged', wideHtml.includes('OUTLIER'));

console.log('\n== 5. the fade button appears only where a fade is warranted ==');
const tight = row('g1:p1:hits:2.5', { hollis: 0.52, sharply: 0.54 });
check('a 2pt gap offers no fade', !disclosure(tight).includes('Fade to theirs'));
const huge = row('g1:p1:hits:2.5', { hollis: 0.20, sharply: 0.80 });
check('a 60pt gap offers fades', disclosure(huge).includes('Fade to theirs'));
check('a wide prop states the spread', disclosure(huge).includes('spread across the pack'));

console.log('\n== 6. the fade button is NOT on the collapsed card face ==');
check('collapsed card has no fade button', !htmlThree.includes('Fade to theirs'));

console.log('\n== 7. a single-publisher prop still renders and says so ==');
const soloHtml = card(row('g1:p1:hits:2.5', { hollis: 0.62 }));
check('says one outlet, singular', soloHtml.includes('1 outlet published this'), soloHtml.slice(0, 0));
check('one dot', countOf(soloHtml, DOTS) === 1);
check('open state names the person', disclosure(row('g1:p1:hits:2.5', { hollis: 0.62 })).includes('Quincy Hollis'));

console.log('\n== 8. all nine outlets on one prop ==');
const everyOutlet = row('g1:p1:hits:2.5', Object.fromEntries(
  MEDIA_PROFILES.map((p) => [p.id, 0.5]),
) as Partial<Record<MediaId, number>>);
const everyHtml = disclosure(everyOutlet);
const named = MEDIA_PROFILES.filter((p) => everyHtml.includes(p.name)).length;
check(`all ${MEDIA_PROFILES.length} forecasters named`, named === MEDIA_PROFILES.length, `got ${named}`);
check('nine DISTINCT names, not nine copies of a masthead',
  new Set(MEDIA_PROFILES.map((p) => p.name).filter((n) => everyHtml.includes(n))).size === MEDIA_PROFILES.length);
check('nine dots on the strip', countOf(card(everyOutlet), DOTS) === MEDIA_PROFILES.length);
check('a flat pack offers no fade', !everyHtml.includes('Fade to theirs'));

console.log('\n== 9. the fixture strip paints CRESTS, and says so in words ==');
/*
 * The first pass at this card took a `string` fixture and rendered "Reno at Mesa". That is the
 * same information in more bytes and less speed: a crest is recognised from the standings, a city
 * pair is read. The crests come back, with the city names as an sr-only accessible name.
 */
const withFixture = renderToStaticMarkup(React.createElement(PropCard, {
  row: threeWay, focused: false, balance: RICH_BALANCE,
  fixture: FIXTURE, onPlace: noop, registerRef: noop,
}));
/*
 * The crest slots are asserted by their accessible name, not by `<img`.
 *
 * `TeamLogo` paints an `<img>` only when it can resolve a logo file, and falls back to the team's
 * initials otherwise -- which is exactly what happens here, because these checks stub
 * `import.meta.glob` to nothing. Both branches are real rendering paths and both identify the club
 * the same way, so the assertion is on the name rather than on which branch ran. Asserting on
 * `<img>` would have tested the stub, not the card.
 */
check('two crest slots render', countOf(withFixture, 'aria-label=') >= 2, `got ${countOf(withFixture, 'aria-label=')}`);
check('the away crest comes before the home crest',
  withFixture.indexOf('Renegades') < withFixture.indexOf('Mesquite'));
check('the crests are followed by "at"', withFixture.includes('>at<'));
check('city names are the accessible name', withFixture.includes('sr-only'));
check('the city names are spelled out for a screen reader',
  withFixture.includes('Reno') && withFixture.includes('Mesa'));
check('the resolution date is still on the strip', withFixture.includes('04/14/26'));

console.log('\n== 9b. a prop whose fixture left the slate says so ==');
const noFixture = renderToStaticMarkup(React.createElement(PropCard, {
  row: threeWay, focused: false, balance: RICH_BALANCE, fixture: null,
  onPlace: noop, registerRef: noop,
}));
check('says the fixture is not on the slate', noFixture.includes('Fixture not on this slate'));
check('no crests are invented', countOf(noFixture, 'aria-label=') === 0, `got ${countOf(noFixture, 'aria-label=')}`);
check('still renders the prop', noFixture.includes('data-prop-row'));

console.log('\n== 10. a focused card is ringed, an unfocused one is not ==');
const focusedHtml = renderToStaticMarkup(React.createElement(PropCard, {
  row: threeWay, focused: true, balance: RICH_BALANCE, fixture: null,
  onPlace: noop, registerRef: noop,
}));
check('focused card marks itself', focusedHtml.includes('data-focused="true"'));
check('unfocused card does not', !noFixture.includes('data-focused'));

console.log('\n== 11. a broke manager cannot press a button ==');
const brokeHtml = renderToStaticMarkup(React.createElement(PropOutletDisclosure, {
  id: 'prop-detail-test', row: huge, balance: 0, onPlace: noop,
}));
check('fade is disabled at zero balance', brokeHtml.includes('disabled'));

console.log('\n== 12. the disclosure id survives the colons in a prop id ==');
/*
 * A prop id is `game:player:stat:line`, and a colon is legal in an HTML id but not in a CSS
 * selector -- `#prop-detail-g1:p1:hits:2.5` parses as an unknown pseudo-class. Anything reaching
 * for the panel by selector has to be able to, so the DOM id is sanitised while the data
 * attribute keeps the readable original.
 */
check('the DOM id has no colons', !htmlThree.includes('prop-detail-g1:p1:hits:2.5'));
check('aria-controls matches a legal id', /aria-controls="prop-detail-g1_p1_hits_2_5"/.test(htmlThree));
check('the data attribute keeps the readable prop id', htmlThree.includes('data-prop-row="g1:p1:hits:2.5"'));

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
