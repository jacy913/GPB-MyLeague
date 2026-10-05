/**
 * Does a universe built from a fixed seed come back identical?
 *
 * Found while building power rankings, and it is worth being precise about where the non-determinism
 * is. Three runs of `probePowerRankings` produced three different top valuations (82.7, 86.6, 87.7)
 * for a PRISTINE universe. The pricing is innocent -- `probeFairLayerDeterminism` shows the fair
 * layer is bit-identical across repeated calls in one process -- so the variation has to be in the
 * rosters, which are generated upstream.
 *
 * This matters well beyond a probe. `handleTerminateUniverse` says in its own comment that seeding
 * it "means the same universe can be rebuilt to A/B a model change", and `NoPlayersGate` tells the
 * player that repairing with their seed returns "exactly the same league back". If that is not true,
 * the seed is not the A/B handle the product claims it is, and a model change cannot be compared
 * against a control.
 *
 * Run: npx tsx tools/probeUniverseDeterminism.ts
 */

import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { INITIAL_TEAMS } from '../src/data/teams';
import { getTeamRosterStrength } from '../src/logic/teamStrength';
import { generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { normalizeSeed } from '../src/lib/random';

const YEAR = 2026;
const SEED = normalizeSeed('probe-universe-determinism');

const build = () => buildNewUniverse({
  teams: INITIAL_TEAMS.map((t) => ({ ...t })),
  seasonYear: YEAR,
  seed: SEED,
  effectiveDate: `${YEAR}-12-15`,
}).playerState;

const runs = [build(), build(), build()];

console.log(`\nUNIVERSE DETERMINISM -- three builds, seed "${SEED}"\n`);

console.log(`  player count        ${runs.map((r) => r.players.length).join(' / ')}`);

const ids = runs[0].players.map((p) => p.playerId);
const overallOf = (state: typeof runs[number], id: string) => {
  const bat = state.battingRatings.find((r) => r.playerId === id);
  const pit = state.pitchingRatings.find((r) => r.playerId === id);
  return bat?.overall ?? pit?.overall ?? null;
};

const idSets = runs.map((r) => new Set(r.players.map((p) => p.playerId)).size);
console.log(`  distinct player ids ${idSets.join(' / ')}`);

const sameIds = runs.slice(1).every((r) =>
  r.players.length === runs[0].players.length
  && r.players.every((p, i) => p.playerId === runs[0].players[i].playerId));

const ovSpread = ids.map((id) => {
  const values = runs.map((r) => overallOf(r, id) ?? -1);
  return Math.max(...values) - Math.min(...values);
});
const worstOverall = Math.max(...ovSpread);
const differingRatings = ovSpread.filter((s) => s > 0).length;

console.log(`  identical id order  ${sameIds ? 'yes' : 'NO'}`);
console.log(`  rating spread       max ${worstOverall.toFixed(2)} overall points`
  + `  (${differingRatings}/${ids.length} players differ between runs)`);

const strength = runs.map((r) => getTeamRosterStrength(INITIAL_TEAMS, r, YEAR));
const teamIds = [...strength[0].keys()];
const strengthSpread = teamIds.map((id) => {
  const values = strength.map((s) => s.get(id) ?? -1);
  return Math.max(...values) - Math.min(...values);
});
console.log(`  roster strength     max spread ${Math.max(...strengthSpread).toFixed(4)} across ${teamIds.length} clubs`);

/*
  THE SCHEDULE, which both earlier probes missed.

  `probeFairLayerDeterminism` proved the fair layer is deterministic for FIXED games -- it built the
  schedule once and priced it three times. `probePowerRankings` regenerates the schedule for every
  scenario and produced three different top valuations (82.7 / 86.6 / 87.7) across three runs of the
  same code. So the variation is downstream of the rosters and upstream of the pricing, and the only
  thing sitting in between is `generateSchedule`.

  It matters less than it looks: the app generates a schedule once at universe creation and PERSISTS
  it, so a reload re-reads the saved schedule rather than making a new one. The consequence is
  therefore not "prices drift on reload" but "terminate with seed X does not reproduce the same
  slate" -- a weaker but still real version of the A/B promise the terminate comment makes.
*/
const schedules = [0, 1, 2].map(() => generateSchedule(INITIAL_TEAMS, {
  seasonStartDate: getDefaultSeasonStartDate(YEAR),
  seasonDays: 180,
}));
const sig = (g: typeof schedules[number]) =>
  g.map((x) => `${x.date}:${x.homeTeam}v${x.awayTeam}`).join('|');
const sigs = schedules.map(sig);
const pairingsStable = sigs.every((s) => s === sigs[0]);
const datesStable = schedules.every((s) => s.length === schedules[0].length
  && s.every((x, i) => x.date === schedules[0][i].date));

console.log(`\n  schedule length      ${schedules.map((s) => s.length).join(' / ')}`);
console.log(`  schedule dates       ${datesStable ? 'identical across builds' : 'DIFFER'}`);
console.log(`  schedule pairings    ${pairingsStable ? 'identical across builds' : '*** DIFFER ***'}`);
if (!pairingsStable) {
  const first = schedules[0];
  const diffs = schedules[1].map((x, i) => ({ x, i }))
    .filter(({ x, i }) => `${x.date}:${x.homeTeam}v${x.awayTeam}`
      !== `${first[i]?.date}:${first[i]?.homeTeam}v${first[i]?.awayTeam}`);
  console.log(`    ${diffs.length} of ${schedules[1].length} games land on a different date or matchup`);
  for (const { x, i } of diffs.slice(0, 3)) {
    console.log(`      was ${first[i]?.date} ${first[i]?.homeTeam}v${first[i]?.awayTeam}`
      + `   now ${x.date} ${x.homeTeam}v${x.awayTeam}`);
  }
}

const names = [...teamIds].sort((a, b) => (strengthSpread[teamIds.indexOf(b)] - strengthSpread[teamIds.indexOf(a)]));
if (strengthSpread.some((s) => s > 0)) {
  console.log(`\n  most affected clubs: ${names.slice(0, 4).map((id) => `${id} (${strengthSpread[teamIds.indexOf(id)].toFixed(3)})`).join(', ')}`);
}

const deterministic = sameIds && worstOverall === 0 && pairingsStable;
console.log(`\n  VERDICT: ${deterministic
  ? 'a seeded universe rebuilds identically -- rosters AND slate -- so the seed IS a usable A/B handle'
  : '*** A SEEDED UNIVERSE DOES NOT REBUILD IDENTICALLY -- see which layer moved above ***'}`);
console.log('');

process.exitCode = deterministic ? 0 : 1;