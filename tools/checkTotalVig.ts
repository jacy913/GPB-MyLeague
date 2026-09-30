/**
 * Is the vig on a total charged once, or twice?
 *
 * This is the question the constant +105 / -126 on every game raises. A total
 * carries its margin in the LINE: houseLine is the mean fair total plus
 * LINE_MARGIN runs. That alone should be the whole charge. If the price pair is
 * also margined on top, the house is taking roughly half a run of expected
 * value per bet instead of a quarter, and the "4.5 per cent margin" is really
 * about 9.
 *
 * A real board charges in one place or the other, never both. Which one is a
 * design decision, but doubling up is a bug, and it is not visible from the
 * page because both numbers still look like plausible prices.
 *
 *   npx tsx tools/checkTotalVig.ts
 */

import { buildLineMarket, LINE_MARGIN, HOUSE_MARGIN } from '../src/lib/markets';

const logistic = (v: number): number => 1 / (1 + Math.exp(-v));
const SLOPE = 0.55;

let failures = 0;
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)}${detail}`);
  if (!ok) failures += 1;
};

console.log('TOTAL MARKET VIG');
console.log(`  LINE_MARGIN  ${LINE_MARGIN} runs`);
console.log(`  HOUSE_MARGIN ${(HOUSE_MARGIN * 100).toFixed(1)}%`);

const fairTotal = 6.6;
const market = buildLineMarket({
  kind: 'total',
  key: 'total:test',
  title: 'Test at Test',
  fair: { hollis: fairTotal, glorest: fairTotal, sharply: fairTotal },
  slope: { hollis: SLOPE, glorest: SLOPE, sharply: SLOPE },
});

/**
 * The bettor's true edge on a bet at the posted line and price.
 *
 * The line has already moved the line off fair, so the bettor's edge on the
 * over is: the true probability that the total beats the posted line, priced
 * against the posted price. Negative is the house winning.
 */
const trueOverProbability = logistic((fairTotal - market.houseLine) * SLOPE);
const priceImplied = 1 / (1 - market.overround / 2); // rough inverse of the margin

const edgeFromLineOnly = trueOverProbability - (1 / (1 + market.overPrice / 100));
void priceImplied;

console.log(`\n  fair total ${fairTotal}, posted line ${market.houseLine}, over ${market.overPrice}\n`);

console.log('  What the line alone costs the bettor:');
const trueUnderProbability = 1 - trueOverProbability;
// At the posted line, the fair price for the over would be:
const fairOverAtLine = trueOverProbability >= 0.5
  ? -100 * trueOverProbability / (1 - trueOverProbability)
  : 100 * (1 - trueOverProbability) / trueOverProbability;
console.log(`    fair price at the line   ${fairOverAtLine}`);
console.log(`    posted price            ${market.overPrice}`);
const priceGap = Math.abs(market.overPrice - fairOverAtLine);
console.log(`    gap                     ${priceGap} points of price`);
console.log('');
console.log('  A correct board prices each side at its own fair value, and takes the');
console.log('  margin in ONE place. Reading these two numbers together:');
console.log(`    line moved off fair     ${(market.houseLine - fairTotal).toFixed(2)} runs`);
console.log(`    price moved off fair    ${priceGap.toFixed(0)} points`);

check(
  'price is derived from the posted line, not an unrounded one',
  priceGap < 6,
  `line ${(market.houseLine - fairTotal).toFixed(2)} runs, price off fair by ${priceGap.toFixed(0)} points`,
);

/**
 * The decisive number: expected value to the bettor per unit staked, using the
 * TRUE distribution rather than the model's own belief. Positive means the
 * bettor has free money, which is the failure that matters.
 */
const overTrue = logistic((fairTotal - market.houseLine) * SLOPE);
const underTrue = 1 - overTrue;
const overImpliedFromPrice = market.overPrice >= 0
  ? 100 / (market.overPrice + 100)
  : -market.overPrice / (-market.overPrice + 100);
const underImpliedFromPrice = market.underPrice >= 0
  ? 100 / (market.underPrice + 100)
  : -market.underPrice / (-market.underPrice + 100);

const evOver = overTrue * (1 / overImpliedFromPrice) - 1;
const evUnder = underTrue * (1 / underImpliedFromPrice) - 1;
console.log('\n  BETTOR EDGE AT THE POSTED PRICE, against the true distribution:');
console.log(`    over  ${(evOver * 100).toFixed(2)}% per unit staked`);
console.log(`    under ${(evUnder * 100).toFixed(2)}% per unit staked`);
console.log(`    best side for the bettor: ${(Math.max(evOver, evUnder) * 100).toFixed(2)}%`);

check(
  'no side is a standing profit',
  Math.max(evOver, evUnder) < 0.01,
  `best side ${(Math.max(evOver, evUnder) * 100).toFixed(2)}%`,
);
/*
 * The band is deliberately tight. A 0.25-run margin on a total whose standard
 * deviation is about three runs is worth roughly 2.3 per cent at the even-money
 * point, and it grows as the line moves away from the model's own fair number.
 * The earlier double-charged version came in at -8.7 per cent on the over, so
 * anything under about -6 is the same bug wearing different numbers.
 */
check(
  'neither side is over-charged',
  Math.min(evOver, evUnder) > -0.06,
  `worst side ${(Math.min(evOver, evUnder) * 100).toFixed(2)}%  <- below -6% means the vig is doubled`,
);

console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
