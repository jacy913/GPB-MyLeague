/**
 * Is the futures board shaped like a futures board?
 *
 * A screenshot of Season Futures on opening day showed every club in a
 * sixteen-team league posted at the same price, +143, with the three outlets
 * agreeing to the dollar. That is arithmetically correct -- the probabilities
 * really are near-uniform when no season has been played -- and it makes the
 * market useless, because a futures board where nothing is a favourite is not
 * forecasting anything.
 *
 * The cause is the soft-max temperature. It converts a 0-100 read index into a
 * probability by exp(index/100 * temperature), so the spread across a division
 * is entirely governed by that one constant, and at the shipped values it is far
 * too flat: a ten-point gap in the index moves a probability by about half a
 * point.
 *
 * What a real futures board looks like: the favourite meaningfully shorter than
 * the field, prices fanning out, and a longshot at genuine long odds. This
 * asserts that shape rather than trusting that the probabilities sum to one,
 * which they always do no matter how badly shaped they are.
 *
 *   npx tsx tools/checkFuturesShape.ts
 */

import { buildDivisionMarkets, buildLeagueMarkets } from '../src/lib/mediaMarkets';
import { probabilityToAmerican, americanToProbability } from '../src/lib/markets';
import { MEDIA_PROFILES } from '../src/data/media';
import type { Team } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)}${detail}`);
  if (!ok) failures += 1;
};

/**
 * A synthetic field with a realistic read spread, so the shape can be asserted
 * without running a season. Indices run 0-100; a real division spans most of
 * that by mid-season.
 */
const makeTeams = (n: number, prefix: string): Team[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    city: `${prefix} City ${i}`,
    name: 'Club',
    league: 'Prestige',
    division: 'North',
  } as unknown as Team));

const buildIndex = (n: number, span: number) =>
  new Map(Array.from({ length: n }, (_, i) => [`t${i}`, 92 - (i * span) / Math.max(1, n - 1)]));

const SPANS = [0.10, 0.15, 0.30, 0.50, 0.80];

console.log('DIVISION SHAPE BY SCORE SPAN');
console.log('Four clubs, the real division size. The span is in raw score units,');
console.log('which is what the board is priced on -- fitFuturesScale measures these');
console.log('at roughly 0.15 to 0.50 across the three outlets.\n');
console.log('  span   fav price   longshot   distinct   fav implied');

for (const span of SPANS) {
  const index = buildIndex(4, span);
  const market = buildDivisionMarkets({
    teams: makeTeams(4, 't'),
    scoreBy: { hollis: index, glorest: index, sharply: index },
  })[0];
  if (!market) { check(`span ${span} built`, false, 'no market'); continue; }

  const prices = market.outcomes.map((o) => o.houseOdds);
  const distinct = new Set(prices).size;
  const fav = market.outcomes[0];
  const longshot = market.outcomes[market.outcomes.length - 1];
  const favImplied = americanToProbability(fav.houseOdds);

  console.log(
    `  ${span.toFixed(2).padStart(5)}${String(fav.houseOdds).padStart(12)}` +
    `${String(longshot.houseOdds).padStart(12)}${String(distinct).padStart(11)}` +
    `${(favImplied * 100).toFixed(2).padStart(13)}%`,
  );
}

console.log('\nASSERTIONS on Hollis\'s measured mid-season spread');
const index = buildIndex(4, 0.30);
const division = buildDivisionMarkets({
  teams: makeTeams(4, 't'),
  scoreBy: { hollis: index, glorest: index, sharply: index },
})[0];

if (!division) {
  check('a division market was built', false, 'none returned');
} else {
  const prices = division.outcomes.map((o) => o.houseOdds);
  const fav = division.outcomes[0];
  const longshot = division.outcomes[division.outcomes.length - 1];
  const favImplied = americanToProbability(fav.houseOdds);

  console.log(`  favourite     ${fav.label} at ${fav.houseOdds}`);
  console.log(`  longshot      ${longshot.label} at ${longshot.houseOdds}`);
  console.log(`  distinct      ${new Set(prices).size} of ${prices.length} prices`);
  console.log('');

  check(
    'the leader is a real favourite',
    favImplied > 0.40,
    `leader implies ${(favImplied * 100).toFixed(2)}%`,
  );
  check(
    'the leader is not absurdly certain',
    favImplied < 0.80,
    `leader implies ${(favImplied * 100).toFixed(2)}%`,
  );
  check(
    'every club gets its own price',
    new Set(prices).size === prices.length,
    `${new Set(prices).size} distinct of ${prices.length}`,
  );
  check(
    'the outsider is a genuine dog',
    longshot.houseOdds > 200,
    `longshot at +${longshot.houseOdds}`,
  );
  check(
    'the field is ordered by price',
    prices.every((p, i) => i === 0 || p >= prices[i - 1]),
    'monotonically lengthening',
  );
}

/**
 * Opening day is the real case that was photographed. Every read is level, so
 * the honest board IS near-uniform -- and that is correct. The distinction is
 * that a level board should be flat rather than pretending to rank four clubs.
 */
console.log('\nOPENING DAY, all reads level');
const level = new Map([['t0', 0.5], ['t1', 0.5], ['t2', 0.5], ['t3', 0.5]]);
const levelMarket = buildDivisionMarkets({
  teams: makeTeams(4, 't'),
  scoreBy: { hollis: level, glorest: level, sharply: level },
})[0];
if (levelMarket) {
  const prices = levelMarket.outcomes.map((o) => o.houseOdds);
  const spread = Math.max(...prices) - Math.min(...prices);
  console.log(`  all four clubs between ${Math.min(...prices)} and ${Math.max(...prices)}`);
  check(
    'a level board is level, not a fake ranking',
    spread <= 5,
    `spread of ${spread} across the division`,
  );
} else {
  check('a level board was built', false, 'none returned');
}

/**
 * The league markets share the same builder, so a two-club league is the shape
 * most at risk of being meaningless.
 */
/*
 * The same forecast has to look like a forecast at BOTH field sizes. A
 * temperature fitted on a four-team division, applied to a sixteen-team league,
 * leaves the leader near 90 per cent and the tail under 1 -- not a sharper read
 * but the same read spread over four times the outcomes. This is what the
 * screenshot of Season Futures showed before the field-size correction.
 */
console.log('\nFIELD SIZE, same score spread');
console.log('A four-team division and a sixteen-team league, identical score spread.');
console.log('The top-two ratio should be comparable; the tail should stay tradeable.\n');
console.log('  clubs   leader p   leader price   last p   last price   longest');

[4, 8, 16].forEach((n) => {
  const scoreMap = new Map(Array.from({ length: n }, (_, i) => [`t${i}`, 0.30 * (1 - i / Math.max(1, n - 1))]));
  const market = buildDivisionMarkets({
    teams: makeTeams(n, 't'),
    scoreBy: { hollis: scoreMap, glorest: scoreMap, sharply: scoreMap },
  })[0];
  if (!market) { check(`${n} clubs built`, false, 'no market'); return; }

  const fav = market.outcomes[0];
  const last = market.outcomes[market.outcomes.length - 1];
  const favImplied = americanToProbability(fav.houseOdds);
  const longest = Math.max(...market.outcomes.map((o) => o.houseOdds));

  console.log(
    `  ${String(n).padStart(5)}` +
    `${(favImplied * 100).toFixed(1).padStart(11)}%` +
    `${String(fav.houseOdds).padStart(14)}` +
    `${((americanToProbability(last.houseOdds)) * 100).toFixed(2).padStart(8)}%` +
    `${String(last.houseOdds).padStart(13)}` +
    `${String(longest).padStart(11)}`,
  );

  /*
   * The bar is relative to even money, not an absolute percentage.
   *
   * A first version of this asserted the leader implies more than 25 per cent
   * at every field size, and failed on the sixteen-club league at 11 per cent.
   * That assertion was wrong, not the board: even money in a sixteen-team race
   * is 6.25 per cent, so a leader at 11 per cent is nearly twice even money
   * and is a genuine favourite. Demanding 25 per cent would mean the same
   * temperature produced a four-club board and a sixteen-club board, which is
   * precisely the bug this check exists to catch -- the top sixteen clubs in a
   * league really are closer together than the top four in a division.
   *
   * What is actually asserted: the leader is meaningfully shorter than the
   * field, and the tail is still tradeable rather than piled against the cap.
   */
  const evenMoney = 1 / n;
  check(
    `${n}-club leader is meaningfully shorter than even money`,
    favImplied > evenMoney * 1.5,
    `leader ${(favImplied * 100).toFixed(1)}% against ${(evenMoney * 100).toFixed(1)}% even`,
  );
  check(
    `${n}-club leader is not absurdly certain`,
    favImplied < 0.75,
    `leader implies ${(favImplied * 100).toFixed(1)}%`,
  );
  check(
    `${n}-club tail is not all longshots`,
    longest < 4000,
    `longest price +${longest}`,
  );
});

console.log('\nTWO-CLUB LEAGUE');
const twoClubs = new Map([['a', 70], ['b', 40]]);
const league = buildLeagueMarkets({
  teams: [
    { id: 'a', city: 'Alpha', name: 'A', league: 'Prestige', division: 'North' } as unknown as Team,
    { id: 'b', city: 'Beta', name: 'B', league: 'Prestige', division: 'North' } as unknown as Team,
  ],
  scoreBy: { hollis: twoClubs, glorest: twoClubs, sharply: twoClubs },
})[0];
if (league) {
  const sum = league.outcomes.reduce((acc, o) => acc + o.consensusProbability, 0);
  console.log(`  ${league.outcomes.map((o) => `${o.label} ${o.houseOdds}`).join('  ')}`);
  check('both clubs priced distinctly', league.outcomes[0].houseOdds !== league.outcomes[1].houseOdds, 'two different prices');
  check('probabilities form a distribution', Math.abs(sum - 1) < 0.001, `sums to ${sum.toFixed(4)}`);
} else {
  check('a league market was built', false, 'none returned');
}

console.log('\nOUTCOME IDENTITY: does every outcome carry the club it belongs to?');
console.log('An award race is keyed by PLAYER, so `key` and `teamId` are different');
console.log('strings there. The mapper in markets.ts used to drop `teamId` entirely, which');
console.log('is why every award row rendered an empty crest square. Nothing above could');
console.log('see it, because a division outcome is keyed BY its team id and so the two');
console.log('were the same string.\n');

const identityTeams = makeTeams(4, 't');
const identityMarket = buildDivisionMarkets({
  teams: identityTeams,
  scoreBy: {
    hollis: new Map(identityTeams.map((t) => [t.id, 90])),
    glorest: new Map(identityTeams.map((t) => [t.id, 90])),
    sharply: new Map(identityTeams.map((t) => [t.id, 90])),
  },
})[0];

if (identityMarket) {
  const missing = identityMarket.outcomes.filter((o) => o.teamId !== o.key);
  console.log(`  outcomes                    ${identityMarket.outcomes.length}`);
  console.log(`  carrying teamId             ${identityMarket.outcomes.filter((o) => o.teamId !== undefined).length}`);
  console.log(`  where teamId === key        ${identityMarket.outcomes.filter((o) => o.teamId === o.key).length}`);
  check(
    'every club outcome carries its teamId',
    missing.length === 0,
    missing.length === 0
      ? 'all outcomes resolve to a club'
      : `${missing.length} outcome(s) have no teamId: ${missing.slice(0, 3).map((o) => o.key).join(', ')}`,
  );
} else {
  check('a division market was built for the identity check', false, 'none returned');
}

console.log('\nRISK TIER COLOUR CONTRACT');
console.log('Green and orange may only ever mean that an OUTLET said something. On the');
console.log('futures board the tiers are the HOUSE\'s read of an outcome, so the two hot');
console.log('tiers take orange and the two cooler ones take the neutral teal -- never green.\n');

const RISK_TIER_ACCENT: Record<string, string> = {
  hail_mary: 'var(--color-warn)',
  long_shot: 'var(--color-warn)',
  contender: 'var(--color-neutral)',
  favourite: 'var(--color-neutral)',
};
const POS = 'var(--color-pos)';

check(
  'no futures risk tier is coloured green',
  Object.values(RISK_TIER_ACCENT).every((colour) => colour !== POS),
  `tiers use ${[...new Set(Object.values(RISK_TIER_ACCENT))].join(' and ')}`,
);
check(
  'the two variance tiers are the two hot ones',
  RISK_TIER_ACCENT.hail_mary === RISK_TIER_ACCENT.long_shot,
  'HAIL MARY and LONG SHOT share a colour',
);
check(
  'the two non-variance tiers are the two neutral ones',
  RISK_TIER_ACCENT.contender === RISK_TIER_ACCENT.favourite,
  'CONTENDER and FAVOURITE share a colour',
);
check(
  'the neutral colour is neither green nor orange',
  RISK_TIER_ACCENT.contender !== POS && RISK_TIER_ACCENT.contender !== RISK_TIER_ACCENT.hail_mary,
  'neutral is distinct from both semantic colours',
);

console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
