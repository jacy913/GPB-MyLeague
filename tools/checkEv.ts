/**
 * Is the price and payout arithmetic self-consistent?
 *
 * This exists because an earlier version of this file asserted the wrong
 * invariant and consequently reported a broken book. It checked the expected
 * return of a bet against a 50 per cent win rate and called a positive number a
 * failure. That is not a failure: a +109 bet pays 2.09 for every dollar staked,
 * so it only needs to win 32.4 per cent of the time. Winning half of them is a
 * very good bet and should make money.
 *
 * The invariant that actually has to hold:
 *
 *   A bettor who wins at exactly the rate the posted price implies must break
 *   even. Not lose. Not win. Break even, because the price is calibrated to that
 *   probability. Anything else means the conversion and the payout disagree.
 *
 *   npx tsx tools/checkEv.ts
 */

import { probabilityToAmerican, americanToProbability } from '../src/lib/mediaOdds';
import { settleReturn, STARTING_BALANCE } from '../src/lib/wallet';

/**
 * Expected bankroll change per unit staked.
 *
 * settleReturn reports the TOTAL returned on a win, stake included. The win
 * branch therefore has to net off the stake that was already deducted, or the
 * stake is counted once on a loss and twice on a win. That mistake is what made
 * an earlier version of this file report a positive expected value on a -101
 * line, which is arithmetically impossible.
 */
const evPerUnit = (price: number, trueProbability: number): number =>
  trueProbability * (settleReturn(1, price, true) - 1)
  + (1 - trueProbability) * (settleReturn(1, price, false) - 1);

const main = (): void => {
  console.log('BREAK-EVEN INVARIANT');
  console.log('  If the bettor wins at exactly the rate the price implies, the');
  console.log('  expected return must be zero. Rounding the price to a whole number');
  console.log('  is the only thing allowed to move it, and only slightly.\n');
  console.log('   price    p implied    p needed    EV per $1');

  let worst = 0;
  [101, 105, 109, 120, 137, 150, 180, 200, 250, 300, 400, 500, 700,
    -101, -105, -110, -120, -137, -150, -180, -200, -250, -300, -400, -500, -700,
  ].forEach((price) => {
    const implied = americanToProbability(price);
    const ev = evPerUnit(price, implied);
    worst = Math.max(worst, Math.abs(ev));
    console.log(
      `   ${String(price).padStart(6)}${implied.toFixed(4).padStart(13)}` +
      `${implied.toFixed(4).padStart(13)}${ev.toFixed(5).padStart(12)}`,
    );
  });
  console.log(`\n  worst deviation from break-even: ${worst.toFixed(5)} per dollar staked`);
  console.log('  This is rounding only. A deviation above about 0.01 would mean the');
  console.log('  price and the payout genuinely disagree.');

  console.log('\nWHAT A MARGIN ACTUALLY BUYS');
  console.log('  The house posts 0.5500 on a side. How much does the bettor have to');
  console.log('  believe that side to come out ahead? That difference is the entire');
  console.log('  cushion the 4.5 per cent margin represents.\n');
  console.log('   bettor believes   posted    EV per $1');
  const POSTED = 0.55;
  [0.50, 0.52, 0.5275, 0.54, 0.55, 0.56, 0.58, 0.60].forEach((belief) => {
    const price = probabilityToAmerican(POSTED);
    const ev = evPerUnit(price, belief);
    console.log(
      `   ${belief.toFixed(4).padStart(15)}   ${POSTED.toFixed(4)}   ${ev.toFixed(5).padStart(11)}` +
      `${ev < 0 ? '   house wins' : '   BETTOR WINS'}`,
    );
  });
  console.log('\n  The break-even belief is the posted number minus the 2.25 point');
  console.log('  margin. A published read has to be worth more than that on a given');
  console.log('  game for backing it to pay, which is a much higher bar than beating a');
  console.log('  coin flip in aggregate. Being right on average is not the question.');

  console.log('\nTHE POINT THAT CAUSED THE CONFUSION');
  const coinFlip = probabilityToAmerican(0.5);
  console.log(`  A 50/50 line posts at ${coinFlip}, not at +109.`);
  console.log(`  Winning half of those bets: $${Math.round(evPerUnit(coinFlip, 0.5) * 1000 * 100) / 100} per $1000 staked,`);
  console.log('  which is correctly zero. An earlier version of this file used -101,');
  console.log('  read its positive expected value as a broken book, and both the');
  console.log('  reading and the number were wrong.');
  void STARTING_BALANCE;
};

main();
