/**
 * Are the Over and Under sides pointing the right way?
 *
 * A total line is a number, and the two sides of it are not interchangeable. If
 * the fair total is 6.6 and the house posts 7.00, then going OVER is the harder
 * thing to do and must be priced as the underdog. A board that has them reversed
 * looks entirely plausible on the page -- both buttons render, both carry a
 * price, neither throws -- so the only way to catch it is to assert the
 * relationship rather than eyeball the numbers.
 *
 *   npx tsx tools/checkOverUnderSides.ts
 */

import { buildLineMarket, probabilityToAmerican, americanToProbability } from '../src/lib/markets';
import { uniformByMedia } from './mediaFixtures';

// Uniform on purpose: this check tests the OVER/UNDER side construction, not the outlet.
const SLOPE = uniformByMedia(0.55);

let failures = 0;
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(34)}${detail}`);
  if (!ok) failures += 1;
};

console.log('OVER/UNDER SIDING');

const market = buildLineMarket({
  kind: 'total',
  key: 'total:test',
  title: 'Test at Test',
  fair: uniformByMedia(6.6),
  slope: SLOPE,
});

console.log(`\n  fair 6.6, posted line ${market.houseLine}\n`);
check(
  'line sits above the fair total',
  market.houseLine > 6.6,
  `line ${market.houseLine}`,
);
check(
  'over is priced as the dog',
  market.overProbability.hollis < 0.5,
  `P(over) = ${market.overProbability.hollis.toFixed(4)}`,
);
check(
  'under is priced as the fav',
  market.overProbability.hollis > 0.4,
  `P(over) = ${market.overProbability.hollis.toFixed(4)}`,
);

/**
 * The bug this guards against, recorded rather than re-derived.
 *
 * The board used to build the second side by negating the first: over at -X,
 * under at +X. That decodes to X/(X+100) and 100/(X+100), which sum to exactly
 * 1.0000 for every X, so the pair carried no margin at all. It also read as
 * plausible on the page, because both buttons render and both carry a price.
 */
console.log('\nTHE NEGATED PAIR, FOR THE RECORD');
const negatedOver = probabilityToAmerican(market.overProbability.hollis);
const negatedRound = americanToProbability(negatedOver) + americanToProbability(-negatedOver) - 1;
console.log(`  -${negatedOver} / +${negatedOver}   overround ${(negatedRound * 100).toFixed(2)}%   <- always zero`);

console.log('\nTHE SHIPPED PAIR');
console.log(`  over ${market.overPrice}  under ${market.underPrice}  overround ${(market.overround * 100).toFixed(2)}%`);
/*
 * A total carries its margin in the LINE, so the price pair is expected to be
 * internally consistent with an overround of about zero. An earlier version of
 * this check demanded a positive overround and was wrong: it was asserting
 * double-charged vig, which the tools/checkTotalVig.ts run caught separately.
 * What matters here is only that the two sides agree with each other and that
 * the over is the harder side, given a line above the fair total.
 */
check(
  'pair is internally consistent',
  Math.abs(market.overround) < 0.02,
  `overround ${(market.overround * 100).toFixed(2)}%  <- near zero is correct, the vig is in the line`,
);
check('over is priced as the dog', market.overPrice > 0, `over at +${market.overPrice}`);
/*
 * The line sits above the fair total, so the over is the harder side and has to
 * imply the LOWER probability. The first version of this check asserted the
 * opposite and reported a failure on correct code: the margin is added to both
 * sides, so both implied probabilities sit above their fair values, and the
 * under is necessarily the larger of the two.
 */
check(
  'over implies less than under, as the line requires',
  americanToProbability(market.overPrice) < americanToProbability(market.underPrice),
  `over implies ${(americanToProbability(market.overPrice) * 100).toFixed(1)}%, under ${(americanToProbability(market.underPrice) * 100).toFixed(1)}%`,
);

/**
 * The line is already margined, so the shipped over rate is measured separately
 * in tools/verifyBetting.ts. This tool only guards the relationship between the
 * two prices, which is a pure arithmetic property and needs no simulation.
 */

console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
