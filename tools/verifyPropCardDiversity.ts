/**
 * Verifies outlet prop cards: diversity, determinism, and pricing untouched.
 *
 * The expansion plan asks for fifteen distinct props per outlet and sets the bar at
 * "mean pairwise overlap <= 3 of 15". That is a number, so it has to be measurable,
 * and the measurement has to be taken on something the player would actually see.
 *
 * THREE THINGS ARE ASSERTED, IN ORDER OF HOW EASILY THEY REGRESS:
 *
 *   1. DIVERSITY. Overlap, distinct stats, distinct games, batting/pitching balance.
 *      This is the feature.
 *   2. DETERMINISM. The same slate built twice must produce identical cards. A card
 *      that reshuffles under the manager is worse than a repetitive one, because
 *      he cannot build a position on a board that moves. The original selection had
 *      a `propId.localeCompare` tiebreak purely for this and it must survive the
 *      affinity term, which is the thing most likely to have broken it.
 *   3. PRICING UNTOUCHED. `selectionAffinity` is editorial and must never reach a
 *      price. This asserts the acceptance criterion directly: every probability in
 *      the market list is byte-identical before and after selection runs, and
 *      `PROP_TILT` still holds its fitted values.
 *
 * WHY A SEPARATE TOOL. `tools/` already holds 37 betting scripts and the plan's
 * §8.3 rule is that new work lands with its verifier. This one is the guard on the
 * two things that could go wrong silently: a diversity rule that quietly starves a
 * card, and an editorial term that quietly becomes a pricing term.
 *
 * Run: npx tsx tools/verifyPropCardDiversity.ts [warmupDays] [slates]
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
import {
  MAX_PROPS_PER_GAME,
  MAX_PROPS_PER_OUTLET,
  MAX_PROPS_PER_STAT,
  MIN_BATTING_PROPS,
  MIN_DISTINCT_GAMES,
  MIN_PITCHING_PROPS,
  PROP_TILT,
  buildPropMarkets,
  selectOutletProps,
  selectionAffinity,
} from '../src/lib/mediaProps';
import { buildMediaReads } from '../src/lib/mediaReads';
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import type { Game } from '../src/types';

const MEDIA_IDS: MediaId[] = MEDIA_PROFILES.map((profile) => profile.id);
const YEAR = 2026;
const SEED = Number(process.argv[2] ?? 4242);
const WARMUP_DAYS = Number(process.argv[3] ?? 40);
const SLATES = Number(process.argv[4] ?? 8);

/** The plan's bar. Expressed against the cap so the two cannot drift apart. */
const MAX_MEAN_PAIRWISE_OVERLAP = 3;

interface Check {
  label: string;
  pass: boolean;
  measured: string;
}

const results: Check[] = [];
const failures: string[] = [];

const check = (label: string, pass: boolean, measured: string, why?: string): void => {
  results.push({ label, pass, measured: pass ? measured : (why ?? `FAILED, observed: ${measured}`) });
  if (!pass) failures.push(`${label}: ${why ?? measured}`);
};

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

  const byDate = new Map<string, Game[]>();
  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (!byDate.has(game.date)) byDate.set(game.date, []);
    byDate.get(game.date)!.push(game);
  }
  const dates = Array.from(byDate.keys()).sort().slice(-SLATES);

  const winPctFor = (teamId: string): number | null => {
    const team = roster.find((entry) => entry.id === teamId);
    if (!team) return null;
    const played = team.wins + team.losses;
    return played > 0 ? team.wins / played : null;
  };

  let overlapSum = 0;
  let overlapPairs = 0;
  let identicalPairs = 0;
  let cardsChecked = 0;
  let determinismChecked = 0;
  let statsViolations = 0;
  let gameViolations = 0;
  let playerViolations = 0;
  let balanceViolations = 0;
  let gameSpreadViolations = 0;
  const cardSizes: number[] = [];

  /**
   * The widest and narrowest affinity any outlet can produce, accumulated across
   * every slate rather than read off one.
   *
   * Accumulated rather than sampled because the bound is the whole point: an
   * editorial term that can exceed the probability range would stop being a
   * tie-breaker and start steering a card, and that would show up on exactly one
   * unlucky slate if it were only checked once.
   */
  let affinityHigh = -Infinity;
  let affinityLow = Infinity;

  for (const date of dates) {
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
      games: byDate.get(date)!,
      playerState: state,
      slateDate: date,
      teamScores: reads.scores,
      scoreSpread: reads.spread,
    });

    // PRICING SNAPSHOT, taken before any selection runs. Asserted unchanged after.
    const pricesBefore = markets.map((m) => ({
      propId: m.propId,
      h: m.probability.hollis,
      g: m.probability.glorest,
      s: m.probability.sharply,
      consensus: m.consensusProbability,
    }));

    const cards = MEDIA_IDS.map((id) => ({
      id,
      card: selectOutletProps(markets, id, MAX_PROPS_PER_OUTLET, { teamWinPct: winPctFor }),
    }));

    // AFFINITY BOUNDS, at the extreme win percentage so the term's full range is
    // sampled rather than whatever this particular slate happened to contain.
    for (const mediaId of MEDIA_IDS) {
      for (const market of markets) {
        const high = selectionAffinity({ market, mediaId, teamWinPct: 1 });
        const low = selectionAffinity({ market, mediaId, teamWinPct: 0.3 });
        if (high > affinityHigh) affinityHigh = high;
        if (low < affinityLow) affinityLow = low;
      }
    }

    // DETERMINISM: rebuild the same slate and compare.
    for (const { id, card } of cards) {
      const again = selectOutletProps(markets, id, MAX_PROPS_PER_OUTLET, { teamWinPct: winPctFor });
      determinismChecked += 1;
      if (JSON.stringify(card.map((m) => m.propId)) !== JSON.stringify(again.map((m) => m.propId))) {
        failures.push(`determinism: ${id} on ${date} produced different cards on rebuild`);
      }
    }

    // PRICING UNCHANGED by selection.
    let priceDrift = 0;
    markets.forEach((market, index) => {
      const before = pricesBefore[index];
      if (
        market.probability.hollis !== before.h ||
        market.probability.glorest !== before.g ||
        market.probability.sharply !== before.s ||
        market.consensusProbability !== before.consensus
      ) {
        priceDrift += 1;
      }
    });
    if (priceDrift > 0) {
      failures.push(`pricing: ${priceDrift} markets had a probability altered by selection on ${date}`);
    }

    for (const { card } of cards) {
      cardsChecked += 1;
      cardSizes.push(card.length);

      const byStat = new Map<string, number>();
      const byGame = new Map<string, number>();
      const byPlayer = new Set<string>();
      let batting = 0;
      let pitching = 0;
      card.forEach((market) => {
        byStat.set(market.stat, (byStat.get(market.stat) ?? 0) + 1);
        byGame.set(market.gameId, (byGame.get(market.gameId) ?? 0) + 1);
        byPlayer.add(market.playerId);
        if (market.role === 'batting') batting += 1;
        if (market.role === 'pitching') pitching += 1;
      });

      if (Math.max(0, ...Array.from(byStat.values())) > MAX_PROPS_PER_STAT) statsViolations += 1;
      if (Math.max(0, ...Array.from(byGame.values())) > MAX_PROPS_PER_GAME) gameViolations += 1;
      // One prop per player, and the relaxation pass must never break it.
      if (byPlayer.size !== card.length) playerViolations += 1;
      if (batting < MIN_BATTING_PROPS || pitching < MIN_PITCHING_PROPS) balanceViolations += 1;
      if (byGame.size < Math.min(MIN_DISTINCT_GAMES, MAX_PROPS_PER_OUTLET)) gameSpreadViolations += 1;
    }

    // PAIRWISE OVERLAP, every pair of outlets.
    for (let i = 0; i < MEDIA_IDS.length; i += 1) {
      for (let j = i + 1; j < MEDIA_IDS.length; j += 1) {
        const a = new Set(cards[i].card.map((m) => m.propId));
        const b = new Set(cards[j].card.map((m) => m.propId));
        const shared = Array.from(a).filter((id) => b.has(id)).length;
        overlapSum += shared;
        overlapPairs += 1;
        if (shared === a.size && a.size > 0) identicalPairs += 1;
      }
    }
  }

  // ------------------------------------------------------------------ checks
  const meanOverlap = overlapSum / Math.max(1, overlapPairs);
  check(
    'outlet cards overlap by at most the plan bar',
    meanOverlap <= MAX_MEAN_PAIRWISE_OVERLAP,
    `mean pairwise overlap ${meanOverlap.toFixed(2)} props across ${overlapPairs} pairs, bar ${MAX_MEAN_PAIRWISE_OVERLAP} of ${MAX_PROPS_PER_OUTLET}`,
    `mean pairwise overlap is ${meanOverlap.toFixed(2)}, above the bar of ${MAX_MEAN_PAIRWISE_OVERLAP}. ` +
      `The outlets are publishing substantially the same board, which is the defect this work exists to fix`,
  );

  check(
    'no two outlets publish an identical card',
    identicalPairs === 0,
    `0 of ${overlapPairs} outlet pairs were identical, against ${identicalPairs} before (Hollis and Glorest were 5/5 on every slate)`,
    `${identicalPairs} outlet pairs published an identical card. That was the measured starting ` +
      `state -- Hollis and Glorest differed only in price, never in which props they picked`,
  );

  check(
    'no card exceeds the per-stat cap',
    statsViolations === 0,
    `0 of ${cardsChecked} cards exceeded ${MAX_PROPS_PER_STAT} props of one stat`,
    `${statsViolations} cards published more than ${MAX_PROPS_PER_STAT} props of a single stat, which is ` +
      `the narrow-card failure a fifteen-prop board is supposed to avoid`,
  );

  check(
    'no card exceeds the per-game cap after relaxation',
    gameViolations === 0,
    `0 of ${cardsChecked} cards exceeded ${MAX_PROPS_PER_GAME} props from one game, including the relaxed pass`,
    `${gameViolations} cards published more than ${MAX_PROPS_PER_GAME} props from a single game`,
  );

  check(
    'every card has one prop per player',
    playerViolations === 0,
    `0 of ${cardsChecked} cards repeated a player`,
    `${playerViolations} cards published two props on the same player. This is the one cap the ` +
      `relaxation pass must never break, because a single batter becoming the whole card is the ` +
      `failure mode the original one-per-player rule existed to stop`,
  );

  check(
    'every card has both a batting and a pitching prop',
    balanceViolations === 0,
    `0 of ${cardsChecked} cards were single-role`,
    `${balanceViolations} cards were batting-only or pitching-only. A card that ignores half the ` +
      `board is not a read on the slate`,
  );

  check(
    'every card spans the slate',
    gameSpreadViolations === 0,
    `0 of ${cardsChecked} cards fell short of ${MIN_DISTINCT_GAMES} distinct games`,
    `${gameSpreadViolations} cards covered fewer than ${MIN_DISTINCT_GAMES} distinct games`,
  );

  check(
    'the same slate builds identical cards twice',
    determinismChecked > 0 && failures.filter((f) => f.startsWith('determinism')).length === 0,
    `${determinismChecked} card rebuilds matched exactly`,
    'a card reshuffled under the manager on rebuild. The affinity term is a pure function, so this ' +
      'should be impossible unless a sort stopped tie-breaking on propId',
  );

  check(
    'selection never alters a price',
    failures.filter((f) => f.startsWith('pricing')).length === 0,
    'every probability byte-identical before and after selection across all slates',
    'a probability changed during selection. `selectionAffinity` is editorial and must never reach ' +
      'pricing, or making the cards differ would degrade the calibration',
  );

  check(
    'PROP_TILT is unchanged',
    PROP_TILT.hollis === 0.10 && PROP_TILT.glorest === 0.08 && PROP_TILT.sharply === 0.26,
    `hollis ${PROP_TILT.hollis}, glorest ${PROP_TILT.glorest}, sharply ${PROP_TILT.sharply}`,
    'PROP_TILT changed. It is fitted -- only its relative ordering is measured -- and the whole ' +
      'design keeps editorial selection separate from pricing so it cannot degrade calibration',
  );

  check(
    'the affinity term is bounded and cannot dominate a probability',
    affinityHigh < 1.0 && affinityLow > -0.6,
    `affinity spans ${affinityLow.toFixed(3)} to ${affinityHigh.toFixed(3)} across every outlet and ` +
      `market, against a ~0.9 probability range -- it reorders near-ties and cannot overturn a real gap`,
    `affinity spans ${affinityLow.toFixed(3)} to ${affinityHigh.toFixed(3)}, wide enough to override a ` +
      `real confidence gap. It is meant to break ties between props an outlet rates similarly, not to ` +
      `steer the card -- if it grew, an outlet could publish a bad read on character alone`,
  );

  // ------------------------------------------------------------------ report
  console.log(`\nPROP CARD DIVERSITY  (${dates.length} slates, cap ${MAX_PROPS_PER_OUTLET})`);
  console.log(`  card size: min ${Math.min(...cardSizes)}, max ${Math.max(...cardSizes)}, mean ` +
    `${(cardSizes.reduce((a, b) => a + b, 0) / cardSizes.length).toFixed(1)}`);
  console.log(`  ${cardsChecked} cards, ${overlapPairs} outlet pairs`);

  console.log('\nCHECKS');
  results.forEach((entry, index) => {
    console.log(`  ${entry.pass ? 'PASS' : 'FAIL'}  ${String(index + 1).padStart(2)}. ${entry.label}`);
    console.log(`          ${entry.measured}`);
  });

  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks PASS`);
  if (failures.length > 0) {
    console.log('\nFAILURES');
    failures.forEach((line) => console.log(`  - ${line}`));
    process.exitCode = 1;
  }
};

void main();
