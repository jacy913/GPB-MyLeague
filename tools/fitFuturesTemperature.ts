/**
 * Fitting the futures temperature against seasons that actually finished.
 *
 * A futures board is only meaningful if the club it makes shortest really does
 * win its division. The shape can be eyeballed from a screenshot, but the
 * temperature that produces a good shape and the temperature that produces
 * good forecasts are different questions, and only the second one can be
 * measured: run a season, take a read partway through, and check how often the
 * club priced shortest went on to win.
 *
 * Scored two ways, because they answer different questions:
 *
 *   Brier    the usual probability score. Rewards being right, and it barely
 *            moves when a board is shaped wrongly, so a flat board can look
 *            acceptable here.
 *   rank     how often the shortest price is the actual winner, and how far
 *            down the true order the board's order is. This is what makes a
 *            board useful rather than merely correct.
 *
 *   npx tsx tools/fitFuturesTemperature.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import type { Team } from '../src/types';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

/** Take a read this many games into the season, before the outcome is known. */
const SAMPLE_AFTER = 400;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

interface GroupSample {
  groupId: string;
  /** Team ids ordered by the forecaster's own score, best first. */
  order: string[];
  /** The team that actually won. */
  winner: string;
}

const main = async (): Promise<void> => {
  const samples: GroupSample[] = [];

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const built = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year, seed: SEED, effectiveDate: `${year}-12-15`,
    });
    const playerState = built.playerState;
    const teams = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      playerState, year,
    );
    const manager = new SimulationManager({
      teams, games: buildSchedule(teams, year), playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });
    let taken = false;

    for (let guard = 0; guard < 220; guard += 1) {
      const played = state.games.filter((g) => g.status === 'completed').length;

      if (!taken && played >= SAMPLE_AFTER) {
        const { scores } = buildMediaReads({
          teams: state.teams,
          players: state.playerState.players,
          battingRatings: state.playerState.battingRatings,
          pitchingRatings: state.playerState.pitchingRatings,
          battingStats: state.playerState.battingStats,
          pitchingStats: state.playerState.pitchingStats,
          playerState: state.playerState,
          seasonYear: year,
        });

        // One sample per division per forecaster, taken from the read only.
        MEDIA_PROFILES.forEach((profile) => {
          const groups = new Map<string, Team[]>();
          state.teams.forEach((team) => {
            const key = `${team.league} ${team.division}`;
            groups.set(key, [...(groups.get(key) ?? []), team]);
          });
          groups.forEach((members, groupId) => {
            samples.push({
              groupId: `${groupId}`,
              order: [...members]
                .sort((a, b) => (scores[profile.id].get(b.id) ?? 0) - (scores[profile.id].get(a.id) ?? 0))
                .map((t) => t.id),
              winner: '',
            });
          });
        });
        taken = true;
      }

      state = await manager.run({ scope: 'day' });
    }

    // Attach the truth once the season is over: most wins in each division.
    const groups = new Map<string, Team[]>();
    state.teams.forEach((team) => {
      const key = `${team.league} ${team.division}`;
      groups.set(key, [...(groups.get(key) ?? []), team]);
    });
    groups.forEach((members, groupId) => {
      const champ = [...members].sort((a, b) => b.wins - a.wins)[0];
      MEDIA_PROFILES.forEach((profile) => {
        const match = samples.find(
          (s) => s.groupId === groupId && s.order.length === members.length
            && s.winner === '' && s.order.includes(champ.id),
        );
        if (match) match.winner = champ.id;
      });
    });
  }

  const usable = samples.filter((s) => s.winner);
  console.log(`seed ${SEED}   ${SEASONS} seasons   ${usable.length} division reads taken after ${SAMPLE_AFTER} games\n`);

  if (usable.length === 0) {
    console.log('No samples were matched to an outcome. The season loop or the group');
    console.log('keying is wrong, and nothing below can be trusted.');
    return;
  }

  /** Score a temperature by turning each read into a probability distribution. */
  const scoreFor = (temperature: number) => {
    let brierSum = 0;
    let topHit = 0;
    let rankSum = 0;
    const fieldSize = usable[0].order.length;

    usable.forEach((sample) => {
      const scores = sample.order.map(() => 0);
      // Recreate the spread from the ordering, since only the ORDER survives
      // into this file. Rank distance stands in for score distance, which is
      // exactly the substitution being tested.
      const mean = (fieldSize - 1) / 2;
      const weights = sample.order.map((_, i) => Math.exp((i - mean) * -temperature));
      const total = weights.reduce((a, b) => a + b, 0);
      const p = weights.map((w) => w / total);
      const winIndex = sample.order.indexOf(sample.winner);

      brierSum += p.reduce((sum, prob, i) => sum + (prob - (i === winIndex ? 1 : 0)) ** 2, 0);
      if (p.indexOf(Math.max(...p)) === winIndex) topHit += 1;
      rankSum += winIndex;
      void scores;
    });

    return {
      brier: brierSum / usable.length,
      topRate: topHit / usable.length,
      meanRank: rankSum / usable.length,
      fair: 1 / fieldSize,
    };
  };

  console.log('TEMPERATURE SWEEP');
  console.log('Probability is a soft-max over RANK DISTANCE, which is the only');
  console.log('ordering information available here. The question this answers is');
  console.log('narrower than the real one: given a forecaster has put the clubs in');
  console.log('this order, how hard should the board lean on it?\n');
  console.log('  temp    brier   top pick hits   mean rank of winner   even money');

  let best: { t: number; brier: number } | null = null;
  [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50].forEach((t) => {
    const { brier, topRate, meanRank, fair } = scoreFor(t);
    if (!best || brier < best.brier) best = { t, brier };
    console.log(
      `  ${t.toFixed(2).padStart(5)}${brier.toFixed(4).padStart(9)}` +
      `${(topRate * 100).toFixed(1).padStart(15)}%` +
      `${meanRank.toFixed(2).padStart(22)} / ${usable[0].order.length}` +
      `${(fair * 100).toFixed(1).padStart(14)}%`,
    );
  });

  if (best) {
    const { brier, topRate, meanRank } = scoreFor(best.t);
    console.log(`\n  Best Brier at temperature ${best.t.toFixed(2)}: ${brier.toFixed(4)}.`);
    console.log(`  There it names the right winner ${(topRate * 100).toFixed(1)}% of the time,`);
    console.log(`  against ${(100 / usable[0].order.length).toFixed(1)}% for a blind pick.`);
    console.log(`  The winner sits ${meanRank.toFixed(2)} places down on average, out of ${usable[0].order.length}.`);
  }

  console.log('\n  A note on what this does and does not show. The soft-max here runs');
  console.log('  over RANK DISTANCE, because a read ordering is all that survives');
  console.log('  into the diagnostic. The shipped board runs over the forecaster\'s');
  console.log('  RAW SCORE, which carries the actual strength gap a rank discards.');
  console.log('  So the numbers below are the right SHAPE for a board and the right');
  console.log('  BEHAVIOUR to want, but the temperature in src/lib/mediaMarkets.ts is');
  console.log('  in score units, not rank units, and the two are not interchangeable.');
};

void main();
