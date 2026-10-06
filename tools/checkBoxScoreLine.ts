/*
 * The box score line a finished game puts under each player's name.
 *
 * Two things are being asserted, and the second is the one that keeps being wrong.
 *
 *  1. THE SENTENCES. What a player actually did, in the words a reader expects, with nothing printed
 *     for a category that did not happen.
 *
 *  2. THAT IT READS THE SAME SOURCE THE BETTING SETTLEMENT READS. The prop market sells a number
 *     derived from `reconstructPlayerGameLines`. If the screen showing what happened on the night
 *     read any other source, then every prop that settled near its line would look like a mistake --
 *     and the manager would have no way to tell a bad settlement from a wrong box score.
 */
import { battingGameLine, gameLineFor, pitchingGameLine } from '../src/lib/analytics/boxScoreLine';
import { reconstructPlayerGameLines } from '../src/lib/playerProps';
import type { Game } from '../src/types';

const problems: string[] = [];

console.log('\nBOX SCORE LINE -- what a finished game prints under each name\n');

// -- 1. the batter sentences --------------------------------------------------------
console.log('  BATTERS\n');
const cases: Array<[string, Record<string, number>, string]> = [
  ['3 for 4 with a homer', { atBats: 4, hits: 3, homeRuns: 1, strikeouts: 0, walks: 0, runsScored: 1, rbi: 1, doubles: 0, triples: 0 }, '3 for 4  ·  1 HR  ·  1 R  ·  1 RBI'],
  ['went oh-for-four', { atBats: 4, hits: 0, homeRuns: 0, strikeouts: 1, walks: 0, runsScored: 0, rbi: 0, doubles: 0, triples: 0 }, '0 for 4  ·  1 SO'],
  ['drew three walks, no hit', { atBats: 3, hits: 0, homeRuns: 0, strikeouts: 0, walks: 3, runsScored: 0, rbi: 0, doubles: 0, triples: 0 }, '0 for 3  ·  3 BB'],
  ['a clean single', { atBats: 3, hits: 1, homeRuns: 0, strikeouts: 0, walks: 0, runsScored: 0, rbi: 0, doubles: 0, triples: 0 }, '1 for 3'],
];
for (const [label, line, want] of cases) {
  const got = battingGameLine(line as never);
  console.log(`    ${label.padEnd(26)} ${got}`);
  if (got !== want) problems.push(`${label}: got "${got}", want "${want}"`);
}

// The rule that keeps this from becoming a row of zeroes: a category that did not happen is not
// printed, and "0 for 3 · 3 BB" must not also carry a "0 SO" or a "0 RBI".
const ohFor = battingGameLine({ atBats: 3, hits: 0, homeRuns: 0, strikeouts: 0, walks: 3, runsScored: 0, rbi: 0, doubles: 0, triples: 0 });
console.log(`\n    a 0-for-3 with 3 walks omits the other zeros: ${!ohFor.includes('0 SO') && !ohFor.includes('0 RBI') ? 'yes' : 'NO'}`);
if (ohFor.includes('0 SO') || ohFor.includes('0 RBI')) {
  problems.push('a line prints categories that did not happen');
}

// -- 2. the pitcher sentence --------------------------------------------------------
console.log('\n  PITCHERS\n');
const arm = pitchingGameLine({ strikeouts: 7, hitsAllowed: 4, walks: 2, earnedRuns: 1 });
console.log(`    seven K, four H, two BB, one ER   ${arm}`);
if (arm !== '7 K  ·  4 H  ·  2 BB  ·  1 ER') problems.push(`pitching line reads "${arm}"`);

// AND THE ONE THAT MATTERS MOST HERE: there is no innings figure, and inventing one is the failure.
console.log(`\n    NO INNINGS IS PRINTED, because none is counted: ${arm.includes('IP') ? 'NO -- it invented one' : 'correct'}`);
if (arm.includes('IP')) problems.push('a pitching line prints innings the reconstruction never counted');

// -- 3. a player who did neither ----------------------------------------------------
console.log('\n  AND A PLAYER WHO DID NOTHING\n');
console.log(`    a bench player with no line returns: ${gameLineFor('nobody', new Map(), new Map()) ?? 'undefined'}`);
if (gameLineFor('nobody', new Map(), new Map()) !== undefined) {
  problems.push('a player who never appeared produces a line, which is nine zeroes on screen');
}

// -- 4. THE SAME SOURCE AS THE BETTING SETTLEMENT -----------------------------------
console.log('\n  AND IT READS THE SOURCE THE BETTING SETTLEMENT READS\n');

const BASE = { first: null, second: null, third: null };
const atBat = (seq: number, batterId: string, outcome: string) => ({
  seq, inning: 1, half: 'top', battingTeamId: 'away', outcome,
  batterId, batterName: batterId, pitcherId: 'sp', pitcherName: 'Starter',
  defenderId: null, defenderName: null, description: outcome,
  runsScored: outcome === 'HR' ? 1 : 0, rbi: outcome === 'HR' ? 1 : 0,
  scoringPlayerIds: outcome === 'HR' ? [batterId] : [],
  outs: outcome === 'OUT' || outcome === 'SO' ? 1 : 0,
  scoreAway: 0, scoreHome: 0, bases: BASE,
});

/* Three singles and a homer: the player's hits figure is 4, and it has to be 4 here too. */
const game = {
  gameId: 'g1', date: '2026-04-12', awayTeam: 'a', homeTeam: 'h', status: 'completed',
  score: { home: 5, away: 3 },
  stats: {
    playLog: JSON.stringify([
      atBat(1, 'hitter', '1B'), atBat(2, 'hitter', '1B'),
      atBat(3, 'hitter', '1B'), atBat(4, 'hitter', 'HR'),
    ]),
  },
} as unknown as Game;

const { batting, pitching } = reconstructPlayerGameLines(game);
const line = gameLineFor('hitter', batting, pitching);
console.log(`    four at-bats, one a homer   ${line}`);
console.log(`    the hits the settlement would score: ${batting.get('hitter')?.hits}`);

const hits = batting.get('hitter')?.hits ?? 0;
if (hits !== 4) {
  problems.push(`the reconstruction says ${hits} hits, so this fixture is wrong and every assertion above is vacuous`);
}
// The headline figure on the box score must be the figure the bet settled on.
if (!line?.startsWith(`${hits} for `)) {
  problems.push(`the box score says "${line}" but settlement scored ${hits} hits -- two screens, two facts`);
}
if (pitching.size === 0) console.log('    (no pitching line reconstructed, so the pitcher path is covered by the unit cases above)');

console.log('');
if (problems.length) {
  problems.forEach((p) => console.log(`  FAIL  ${p}`));
  console.log(`\n  ${problems.length} problem(s).`);
  process.exit(1);
}
console.log('  one line per player, no invented innings, and the same hits figure the betting settles on.');