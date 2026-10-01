/**
 * Baseline measurement: how identical are the three outlet prop cards today?
 *
 * The expansion plan's §0.2 claims `selectOutletProps` returns near-identical cards
 * because all three outlets rank the SAME board and `PROP_TILT` is a small offset on
 * a shared base rate. Before changing the cap or the selection function, that claim
 * needs a number attached, because the acceptance criterion is a number
 * ("mean pairwise overlap <= 3 of 15") and a fix that cannot be shown to move a
 * measured quantity is indistinguishable from a fix that does nothing.
 *
 * This measures, per slate:
 *   - the cards each outlet publishes, at the CURRENT cap of 5
 *   - pairwise overlap between every pair of outlets
 *   - how many DISTINCT games and DISTINCT stats each card covers
 *   - how many of the 15 prop-market slots a 15-card board could even reach, i.e.
 *     whether the supply of distinct (player, stat) pairs is the binding constraint
 *
 * Supply matters as much as selection. If one slate only has nine eligible
 * (player, stat) pairs, no selection function can produce fifteen distinct props
 * and the diversity criteria would be unreachable for a supply reason rather than
 * an editorial one. That distinction decides whether Work Item 2 (more stats) or
 * Work Item 3 (better selection) is the binding constraint, which is a sequencing
 * question the plan guesses at but does not measure.
 *
 * Run: npx tsx tools/probePropCardOverlap.ts [warmupDays] [slates]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildPropMarkets, selectOutletProps, MAX_PROPS_PER_OUTLET } from '../src/lib/mediaProps';
import { buildMediaReads } from '../src/lib/mediaReads';
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import type { Game } from '../src/types';

const MEDIA_IDS: MediaId[] = MEDIA_PROFILES.map((profile) => profile.id);

const YEAR = 2026;
const SEED = Number(process.argv[2] ?? 4242);
const WARMUP_DAYS = Number(process.argv[3] ?? 40);
const SLATES = Number(process.argv[4] ?? 8);
const PROBE_CAP = 15;

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const roster = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );

  const manager = new SimulationManager({
    teams: roster,
    games: generateSchedule(roster, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 180,
    }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state = universe;
  let games: Game[] = generateSchedule(roster, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
  });
  for (let day = 0; day < WARMUP_DAYS; day += 1) {
    const result = await manager.run({ scope: 'day' });
    state = result.playerState;
    games = result.games;
  }

  // Completed games grouped by date, newest last, so each "slate" is one real day.
  const byDate = new Map<string, Game[]>();
  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (!byDate.has(game.date)) byDate.set(game.date, []);
    byDate.get(game.date)!.push(game);
  }
  const dates = Array.from(byDate.keys()).sort().slice(-SLATES);

  console.log(`\nPROP CARD OVERLAP BASELINE`);
  console.log(`  ${WARMUP_DAYS} warmup days, ${dates.length} slates, current cap ${MAX_PROPS_PER_OUTLET}\n`);

  let overlapSum = 0;
  let overlapCount = 0;
  let distinctPlayerStatSum = 0;
  let supplySum = 0;
  let insufficientSupply = 0;

  for (const date of dates) {
    const slateGames = byDate.get(date)!;
    const reads = buildMediaReads({
      teams: roster,
      players: state.players,
      battingRatings: state.battingRatings,
      pitchingRatings: state.pitchingRatings,
      battingStats: state.battingStats,
      pitchingStats: state.pitchingStats,
      playerState: state,
      seasonYear: YEAR,
    });
    const markets = buildPropMarkets({
      games: slateGames,
      playerState: state,
      slateDate: date,
      teamScores: reads.scores,
      scoreSpread: reads.spread,
    });

    // SUPPLY: how many distinct (player, stat) pairs exist on this slate at all?
    // A 15-card board needs 15 of them. This is the supply ceiling, and it is the
    // number that says whether selection or statistics is the binding constraint.
    const distinctPlayerStat = new Set(markets.map((m) => `${m.playerId}|${m.stat}`));
    supplySum += distinctPlayerStat.size;
    if (distinctPlayerStat.size < PROBE_CAP) insufficientSupply += 1;

    const cards = MEDIA_IDS.map((id) => ({ id, card: selectOutletProps(markets, id) }));
    const at5 = cards[0].card.length;
    void at5;

    const ids = (id: MediaId): Set<string> =>
      new Set(selectOutletProps(markets, id).map((m) => m.propId));

    const line: string[] = [];
    for (let i = 0; i < MEDIA_IDS.length; i += 1) {
      for (let j = i + 1; j < MEDIA_IDS.length; j += 1) {
        const a = ids(MEDIA_IDS[i]);
        const b = ids(MEDIA_IDS[j]);
        const shared = Array.from(a).filter((id) => b.has(id)).length;
        overlapSum += shared;
        overlapCount += 1;
        line.push(`${MEDIA_IDS[i]}/${MEDIA_IDS[j]} ${shared}`);
      }
    }

    const stats = cards.map(({ card }) => new Set(card.map((m) => m.stat)).size);
    const gameCounts = cards.map(({ card }) => new Set(card.map((m) => m.gameId)).size);
    distinctPlayerStatSum += Math.min(...cards.map(({ card }) => new Set(card.map((m) => `${m.playerId}|${m.stat}`)).size));

    console.log(
      `  ${date}  ${String(markets.length).padStart(4)} markets, ${String(distinctPlayerStat.size).padStart(3)} distinct (player,stat)` +
      `   overlap: ${line.join('  ')}` +
      `   distinct stats/card: ${stats.join('/')}   games/card: ${gameCounts.join('/')}`,
    );
  }

  console.log(`\nMEAN PAIRWISE OVERLAP AT THE CURRENT CAP: ${(overlapSum / Math.max(1, overlapCount)).toFixed(2)} props`);
  console.log(`  (out of ${MAX_PROPS_PER_OUTLET} per card; the target for a 15-card board is <= 3 of 15)`);
  console.log(`\nSUPPLY, the ceiling no selection function can beat:`);
  console.log(`  mean distinct (player,stat) pairs per slate: ${(supplySum / Math.max(1, dates.length)).toFixed(1)}`);
  console.log(`  slates with fewer than ${PROBE_CAP} distinct pairs: ${insufficientSupply} of ${dates.length}`);
  console.log(`  a 15-card board needs 15 distinct pairs per outlet; if supply is the binding`);
  console.log(`  constraint then adding stats (Work Item 2) precedes better selection (Work Item 3).`);
  console.log(`\n  mean distinct (player,stat) actually USED per card: ${(distinctPlayerStatSum / Math.max(1, dates.length)).toFixed(2)}`);
};

void main();
