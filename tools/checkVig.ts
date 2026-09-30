/**
 * Does every market on the board actually charge?
 *
 * A two-sided market is only a market if the two prices together ask for more
 * than the probability they represent. Sum the implied probabilities of both
 * sides: exactly 1.0 means the house is paying out the full fair value and
 * taking nothing, and any mispricing in either direction becomes free money.
 *
 * Three different constructions are in play and they fail differently:
 *
 *   moneyline  the second side is the negation of the first      -> sums to 1.0
 *   total      the line carries the margin, prices quote it     -> sums to 1.0
 *   futures    margin taken off the favourite alone             -> sums UNDER 1
 *
 * That last one is the opposite failure and just as wrong. Taking the margin
 * off one side of a field and leaving the rest alone makes the whole book sum
 * to 1 - margin/2, so the house is paying 2.25 per cent MORE than fair on
 * every futures and award market, and a bettor can exploit that without any
 * forecasting skill at all.
 *
 *   npx tsx tools/checkVig.ts
 */

import { americanToProbability } from '../src/lib/markets';
import { buildGameLine } from '../src/lib/mediaOdds';
import { buildFieldMarket } from '../src/lib/markets';
import { buildDivisionMarkets } from '../src/lib/mediaMarkets';
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import type { Team } from '../src/types';

let failures = 0;
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(42)}${detail}`);
  if (!ok) failures += 1;
};

console.log('MONEYLINE');

/*
 * A neutral pairing: both reads level, so the consensus is close to even and
 * the overround is not being masked by a one-sided favourite.
 */
const level = { hollis: 0.5, glorest: 0.5, sharply: 0.5 };
const teams = {
  away: { id: 'a', city: 'Away', name: 'A' } as unknown as Team,
  home: { id: 'h', city: 'Home', name: 'H' } as unknown as Team,
};
const line = buildGameLine({
  game: { gameId: 'g1', date: '2026-04-02' } as never,
  away: teams.away, home: teams.home,
  awayScores: level, homeScores: level,
  spread: { hollis: 1, glorest: 1, sharply: 1 },
});

/*
 * Both sides come from the module, not from negating one of them. Negating is
 * exactly the bug being guarded: a -X/+X pair decodes to X/(X+100) and
 * 100/(X+100), which sum to exactly 1.0000 for every X.
 */
const awayPrice = line.houseOdds;
const homePrice = line.homeOdds;
const overround = americanToProbability(awayPrice) + americanToProbability(homePrice) - 1;
console.log(`  away ${awayPrice}  home ${homePrice}  overround ${(overround * 100).toFixed(2)}%`);
check('both sides are distinct prices', awayPrice !== homePrice, `${awayPrice} / ${homePrice}`);
check('moneyline is not a negated pair', awayPrice !== -homePrice, `${awayPrice} vs -${homePrice}`);
check('moneyline carries a margin', overround > 0.03, `overround ${(overround * 100).toFixed(2)}%`);

console.log('\nFUTURES');

/*
 * Eight clubs in one division, with a clear favourite so the margin lands on a
 * real favourite rather than being spread evenly.
 */
/*
 * The score field has to be in the units the board prices on. A 0-100 index
 * looked plausible here and is a rank, not a score: the first version of this
 * test fed the futures builder values like 95 down to 53, and with the real
 * temperature that produces eight outsized longshots which all round to the
 * same price cap. Two distinct prices out of eight looked like the old
 * "every club gets the leader's number" bug, and was purely a bad fixture.
 *
 * fitFuturesScale measures the real spread inside a division at roughly 0.15
 * to 0.50, so that is the range used here.
 */
const score = new Map<string, number>();
for (let i = 0; i < 8; i += 1) score.set(`t${i}`, 0.40 - i * 0.05);
const division = buildDivisionMarkets({
  teams: Array.from({ length: 8 }, (_, i) => ({
    id: `t${i}`, city: `City${i}`, name: 'Club',
    league: 'Prestige', division: 'North',
  } as unknown as Team)),
  scoreBy: {
    hollis: score, glorest: score, sharply: score,
  },
})[0];

if (!division) {
  check('a division market was built', false, 'none returned');
} else {
  const sum = division.outcomes.reduce((acc, o) => acc + americanToProbability(o.houseOdds), 0);
  const overround = sum - 1;
  console.log(`  ${division.outcomes.length} clubs, sum of implied ${sum.toFixed(4)}, overround ${(overround * 100).toFixed(2)}%`);

  /*
   * Every club must carry its OWN probability. A builder that hands the
   * favourite's number to the whole field passes the overround check by luck
   * in one direction and fails it badly in the other, so the prices themselves
   * are checked to be distinct -- the leader should not be the same price as
   * the seventh-best team.
   */
  const prices = division.outcomes.map((o) => o.houseOdds);
  const distinct = new Set(prices).size;
  check('all eight clubs are priced', division.outcomes.length === 8, `${division.outcomes.length} outcomes`);
  check(
    'each club carries its own price, not the leader\'s',
    distinct >= 7,
    `${distinct} distinct prices across ${prices.length} clubs`,
  );
  check('futures does not pay out over fair', overround > 0.01, `overround ${(overround * 100).toFixed(2)}%`);
  check('futures charges a real margin', overround < 0.12, `overround ${(overround * 100).toFixed(2)}%`);
}

console.log('\nAWARDS');

/*
 * A field market is only meaningful if each outlet's probabilities sum to 1
 * across the candidates. The first version of this test handed buildFieldMarket
 * a descending ramp summing to 1.56, which is not a distribution, and read the
 * resulting 53.78 per cent overround as a pricing bug. It was a malformed input.
 * The probabilities are normalised here so the overround means what it says.
 */
const rawRamp = Array.from({ length: 8 }, (_, i) => 0.3 - i * 0.03);
const rampTotal = rawRamp.reduce((s, v) => s + v, 0);
const award = buildFieldMarket({
  kind: 'award',
  key: 'award:batting_mvp',
  title: 'Batting MVP',
  entries: Array.from({ length: 8 }, (_, i) => ({
    key: `p${i}`, label: `Player ${i}`,
    probability: Object.fromEntries(
      MEDIA_PROFILES.map((m) => [m.id, rawRamp[i] / rampTotal]),
    ) as Record<MediaId, number>,
  })),
});
const awardSum = award.outcomes.reduce((acc, o) => acc + americanToProbability(o.houseOdds), 0);
const awardRound = awardSum - 1;
console.log(`  8 candidates, sum of implied ${awardSum.toFixed(4)}, overround ${(awardRound * 100).toFixed(2)}%`);
check('awards does not pay out over fair', awardRound > 0.01, `overround ${(awardRound * 100).toFixed(2)}%`);
check('awards margin is sane, not a field-wide tax', awardRound < 0.15, `overround ${(awardRound * 100).toFixed(2)}%`);

console.log(`\n  ${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
