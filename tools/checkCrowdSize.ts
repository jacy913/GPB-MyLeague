/*
 * Is the crowd plausible, and does the stickiness rule actually hold?
 *
 * Every constant in `crowdSize.ts` is chosen, because there are no attendance figures or broadcast
 * ratings in this repo to fit against. A chosen constant that is never printed is a constant nobody
 * can argue with, so this prints all of them: the distribution across a real fixture list, both ends
 * of every league, and -- the one that matters most -- the penalty a bad club takes at each end of the
 * popularity range.
 *
 * The stickiness assertion is the important one. "Big markets only take a slight penalty for losing"
 * is a claim about the SHAPE of the model, and a single attendance number cannot demonstrate it. If
 * both ends took the same penalty, the club's popularity would be doing nothing that a league-average
 * attendance number could not, and the whole module would be decoration.
 */
import { INITIAL_TEAMS } from '../src/data/teams';
import {
  attendanceFor,
  formatCrowd,
  stadiumCapacityFor,
  viewersFor,
  formExponentFor,
} from '../src/lib/analytics/crowdSize';
import { marketSizeFor } from '../src/lib/analytics/fanbase';

const problems: string[] = [];
const byId = new Map(INITIAL_TEAMS.map((t) => [t.id, t]));

/** A mid-tier opponent, so the comparison is not also a test of who is playing. */
const MID = byId.get('hui')!;

console.log('\nCROWD SIZE -- every coefficient in crowdSize.ts, printed\n');

// -- 1. the two ends, at .500 and at .300 ---------------------------------------
console.log('  THE TWO ENDS OF THE LEAGUE, mid-tier opponent, a Tuesday in April\n');
console.log('    club              pop  capacity   .500      .300     penalty');
const sorted = [...INITIAL_TEAMS].sort((a, b) => marketSizeFor(b) - marketSizeFor(a));
const probes = [sorted[0], sorted[Math.floor(sorted.length / 2)], sorted[sorted.length - 1]];
for (const team of probes) {
  const at = (pct: number) => attendanceFor({ home: team, away: MID, date: '2026-04-07', homeWinPct: pct });
  const good = at(0.5);
  const bad = at(0.3);
  const penalty = ((good - bad) / good) * 100;
  console.log(
    `    ${`${team.city} ${team.name}`.padEnd(20)}`
    + `${String(Math.round(marketSizeFor(team))).padStart(3)}`
    + `${stadiumCapacityFor(team).toLocaleString().padStart(9)}`
    + `${formatCrowd(good).padStart(9)}${formatCrowd(bad).padStart(9)}`
    + `${`${penalty.toFixed(0)}%`.padStart(9)}`,
  );
}

console.log('\n  THE RULE: the biggest market must lose a LOT less attendance than the smallest.\n');
const big = sorted[0];
const small = sorted[sorted.length - 1];
const penaltyFor = (team: typeof big): number => {
  const good = attendanceFor({ home: team, away: MID, date: '2026-04-07', homeWinPct: 0.5 });
  const bad = attendanceFor({ home: team, away: MID, date: '2026-04-07', homeWinPct: 0.3 });
  return ((good - bad) / good) * 100;
};
const bigPenalty = penaltyFor(big);
const smallPenalty = penaltyFor(small);
console.log(`    form exponent   ${big.city} ${formExponentFor(marketSizeFor(big)).toFixed(2)}`
  + `   ${small.city} ${formExponentFor(marketSizeFor(small)).toFixed(2)}`);
console.log(`    attendance loss ${bigPenalty.toFixed(1)}%  vs  ${smallPenalty.toFixed(1)}%`);

if (bigPenalty >= smallPenalty) {
  problems.push(`${big.city} is no stickier than ${small.city} (${bigPenalty.toFixed(1)}% vs ${smallPenalty.toFixed(1)}%)`);
}
if (smallPenalty - bigPenalty < 8) {
  problems.push(`the two ends differ by only ${(smallPenalty - bigPenalty).toFixed(1)} points of penalty`);
}
if (bigPenalty > 20) {
  problems.push(`${big.city} loses ${bigPenalty.toFixed(1)}% of its crowd to a bad record: that is not "slight"`);
}

// -- 2. the whole league's spread ------------------------------------------------
console.log('\n  ACROSS EVERY PAIRING IN THE LEAGUE, all clubs at .500\n');

/*
 * EVERY PAIRING, NOT A FIXED OPPONENT.
 *
 * The first version of this section measured the spread with every club playing `hui`, which is rank
 * 30 out of 32. That capped every audience in the league at roughly half of what its two clubs could
 * actually pull together, and it reported two false failures: that no fixture cleared 2.5M viewers
 * (true of `hui`-vs-anyone, false of Stripes-vs-Engineers) and that viewership spread no wider than
 * attendance (an artefact of the same cap).
 *
 * A distribution measured against one pinned opponent is not the league's distribution. Looping the
 * real pairings is barely more expensive and is the only version of this that means anything.
 */
const gates: number[] = [];
const draws: number[] = [];
for (const home of INITIAL_TEAMS) {
  for (const away of INITIAL_TEAMS) {
    if (home.id === away.id) continue;
    gates.push(attendanceFor({ home, away, date: '2026-04-07', homeWinPct: 0.5 }));
    draws.push(viewersFor({ home, away, date: '2026-04-07', homeWinPct: 0.5, awayWinPct: 0.5 }));
  }
}
console.log(`    ${gates.length.toLocaleString()} pairings measured`);

const pct = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];
console.log(`    attendance   min ${formatCrowd(Math.min(...gates))}`
  + `   median ${formatCrowd(pct(gates, 0.5))}   p95 ${formatCrowd(pct(gates, 0.95))}`
  + `   max ${formatCrowd(Math.max(...gates))}`);
console.log(`    viewers      min ${formatCrowd(Math.min(...draws))}`
  + `   median ${formatCrowd(pct(draws, 0.5))}   p95 ${formatCrowd(pct(draws, 0.95))}`
  + `   max ${formatCrowd(Math.max(...draws))}`);

const fills = INITIAL_TEAMS.map((t) => attendanceFor({
  home: t, away: MID, date: '2026-04-07', homeWinPct: 0.5,
}) / stadiumCapacityFor(t));
console.log(`    ground fill  min ${(Math.min(...fills) * 100).toFixed(0)}%`
  + `   median ${(pct(fills, 0.5) * 100).toFixed(0)}%   max ${(Math.max(...fills) * 100).toFixed(0)}%`);

// The marquee night, named, because "the max" is a number and this is a sentence a reader can picture.
const marquee = viewersFor({
  home: sorted[0], away: sorted[1], date: '2026-04-07', homeWinPct: 0.66, awayWinPct: 0.64,
});
console.log(`\n    the marquee night   ${sorted[0].city} v ${sorted[1].city}, both contending`
  + `  ->  ${formatCrowd(marquee)} viewers`);

// Nothing below is a statistic. They are sanity bands, and they are wide on purpose: the point is to
// catch "3.4M for a Tuesday game between two small clubs", not to certify a number.
if (Math.min(...fills) < 0.08) {
  problems.push(`the smallest gate is only ${(Math.min(...fills) * 100).toFixed(0)}% full`);
}
if (Math.max(...fills) > 1) {
  problems.push('attendance exceeds capacity: the clamp is not holding');
}
if (pct(draws, 0.5) < 400_000 || pct(draws, 0.5) > 2_500_000) {
  problems.push(`the median audience is ${formatCrowd(pct(draws, 0.5))}, outside the 400K-2.5M band`);
}
if (marquee < 2_500_000 || marquee > 6_000_000) {
  problems.push(`the marquee night draws ${formatCrowd(marquee)}, outside the 2.5M-6M band`);
}

// -- 3. viewership must concentrate harder than attendance ------------------------
console.log('\n  VIEWERSHIP MUST CONCENTRATE HARDER THAN ATTENDANCE\n');
const ratio = (xs: number[]): number => Math.max(...xs) / Math.max(1, Math.min(...xs));
const attnRatio = ratio(gates);
const viewRatio = ratio(draws);
console.log(`    spread of attendance  max/min ${attnRatio.toFixed(1)}x`);
console.log(`    spread of viewership   max/min ${viewRatio.toFixed(1)}x`);
console.log('    An audience is not capped by a building, so it has to be the wider of the two.');
if (viewRatio <= attnRatio) {
  problems.push(`viewership spread (${viewRatio.toFixed(1)}x) is not wider than attendance (${attnRatio.toFixed(1)}x)`);
}

// -- 4. it must not be a strength proxy ------------------------------------------
console.log('\n  AND IT MUST NOT BE A HIDDEN STRENGTH SIGNAL\n');
const corr = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
};
const pops = INITIAL_TEAMS.map((t) => marketSizeFor(t));
const ratings = INITIAL_TEAMS.map((t) => t.rating);
const popRating = corr(pops, ratings);
const se = 1 / Math.sqrt(pops.length - 3);
console.log(`    popularity vs rating  ${popRating.toFixed(3)}  (z ${(popRating / se).toFixed(2)} SE, 2 SE bar ${(2 * se).toFixed(3)})`);
if (Math.abs(popRating) > 2 * se) {
  problems.push(`popularity correlates with rating at ${popRating.toFixed(3)}: a crowd would be a strength proxy`);
}

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`  the biggest market is stickier than the smallest (${bigPenalty.toFixed(0)}% vs ${smallPenalty.toFixed(0)}%),`);
console.log('  every gate is inside its ground, and viewership spreads wider than attendance.');