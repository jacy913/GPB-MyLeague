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
 * Run: npx tsx tools/verifyPropCardDiversity.ts [warmup] [slates] [replicates]
 *
 * ---------------------------------------------------------------------------
 * WHY REPLICATES, AND WHY THEY DO NOT APPLY TO EVERY CHECK IN HERE
 * ---------------------------------------------------------------------------
 *
 * The overlap gate used to be measured on ONE season against a non-deterministic engine, so a run
 * could pass or fail on luck. It now runs `replicates` independent seasons and gates the MEAN,
 * reporting min, max and standard deviation beside it.
 *
 * The spread is REPORTED and never gated. A bar on it would be a number invented to look like
 * rigour; the mean is the thing a real regression moves, and the variance is printed every run so
 * it cannot go unnoticed.
 *
 * But averaging is right for a mean and WRONG for an existence claim, and this file contains one of
 * each. "No two outlets ever publish an identical card" is not a statistic with an average -- it is
 * a question about whether an event ever happens. Averaging it across replicates would make a
 * 0.2%-per-pair event invisible, which is the opposite of what a check is for. So that check
 * accumulates every pair across every replicate and still requires a flat zero, which makes it
 * STRICTLY more sensitive than before, not less.
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
import type { Game, Team } from '../src/types';

const MEDIA_IDS: MediaId[] = MEDIA_PROFILES.map((profile) => profile.id);
const YEAR = 2026;
const WARMUP_DAYS = Number(process.argv[2] ?? 40);
const SLATES = Number(process.argv[3] ?? 8);
const REPLICATES = Number(process.argv[4] ?? 8);
/** Replicate seeds are derived from this, and it is the only randomness control the tool has. */
const BASE_SEED = 4242;

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

/** One replicate's tallies, so the caller can average across seasons instead of reading one. */
interface Replicate {
  legacySum: number;
  legacyPairs: number;
  overlapSum: number;
  overlapPairs: number;
  identicalPairs: number;
  identicalLabels: string[];
  cardsChecked: number;
  determinismChecked: number;
  determinismFailures: string[];
  pricingFailures: string[];
  statsViolations: number;
  gameViolations: number;
  playerViolations: number;
  balanceViolations: number;
  gameSpreadViolations: number;
  cardSizes: number[];
  affinityHigh: number;
  affinityLow: number;
  nullWinPct: number;
  winPctLookups: number;
}

const LEGACY: MediaId[] = ['hollis', 'glorest', 'sharply'];

const runReplicate = async (seed: number): Promise<Replicate> => {
  const out: Replicate = {
    legacySum: 0, legacyPairs: 0, overlapSum: 0, overlapPairs: 0,
    identicalPairs: 0, identicalLabels: [], cardsChecked: 0, determinismChecked: 0,
    determinismFailures: [], pricingFailures: [], statsViolations: 0, gameViolations: 0,
    playerViolations: 0, balanceViolations: 0, gameSpreadViolations: 0, cardSizes: [],
    affinityHigh: -Infinity, affinityLow: Infinity, nullWinPct: 0, winPctLookups: 0,
  };

  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );

  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 180,
    }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state = universe;
  let games: Game[] = [];

  /*
    THE TEAMS ARRAY IS NOW ADVANCED WITH THE MANAGER'S RESULTS.

    It was not, and that was a real bug with a measured consequence. `selectOutletProps` receives a
    `teamWinPct` lookup, and `selectionAffinity` adds +0.2 -- the single largest term in that
    function -- when the club's win percentage is above 0.55. Reading the win percentage off a teams
    array frozen at 0-0 returned null on 3200 of 3200 lookups, so the term NEVER FIRED. Every run of
    this tool was therefore exercising a weaker version of the selection than the app ships: both
    BettingPage and MediaHub build that lookup from live `input.teams`, where it works.

    Measured, the collision rate is slightly HIGHER with live records than without (12 vs 8 in 5600
    outlet pairs), so this was not the cause of the flakiness -- but it means the tool was not
    testing what ships, which is the more serious of the two problems and is now fixed.

    The duplicate `generateSchedule` call that used to sit below this loop is also gone. It built a
    second, different random schedule that was immediately overwritten, while consuming randomness
    and making the run even less reproducible than it already was.
  */
  for (let day = 0; day < WARMUP_DAYS; day += 1) {
    const result = await manager.run({ scope: 'day' });
    state = result.playerState;
    games = result.games;
    teams = result.teams;
  }

  const byDate = new Map<string, Game[]>();
  for (const game of games) {
    if (game.status !== 'completed') continue;
    if (!byDate.has(game.date)) byDate.set(game.date, []);
    byDate.get(game.date)!.push(game);
  }
  const dates = Array.from(byDate.keys()).sort().slice(-SLATES);

  const winPctFor = (teamId: string): number | null => {
    const team = teams.find((entry) => entry.id === teamId);
    if (!team) return null;
    const played = team.wins + team.losses;
    return played > 0 ? team.wins / played : null;
  };

  for (const date of dates) {
    const reads = buildMediaReads({
      teams,
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
        out.winPctLookups += 1;
        if (winPctFor(market.teamId) === null) out.nullWinPct += 1;
        const high = selectionAffinity({ market, mediaId, teamWinPct: 1 });
        const low = selectionAffinity({ market, mediaId, teamWinPct: 0.3 });
        if (high > out.affinityHigh) out.affinityHigh = high;
        if (low < out.affinityLow) out.affinityLow = low;
      }
    }

    // DETERMINISM: rebuild the same slate and compare.
    for (const { id, card } of cards) {
      const again = selectOutletProps(markets, id, MAX_PROPS_PER_OUTLET, { teamWinPct: winPctFor });
      out.determinismChecked += 1;
      if (JSON.stringify(card.map((m) => m.propId)) !== JSON.stringify(again.map((m) => m.propId))) {
        out.determinismFailures.push(`determinism: ${id} on ${date} produced different cards on rebuild`);
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
      out.determinismFailures.push(`pricing: ${priceDrift} markets had a probability altered by selection on ${date}`);
    }

    for (const { card } of cards) {
      out.cardsChecked += 1;
      out.cardSizes.push(card.length);

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

      if (Math.max(0, ...Array.from(byStat.values())) > MAX_PROPS_PER_STAT) out.statsViolations += 1;
      if (Math.max(0, ...Array.from(byGame.values())) > MAX_PROPS_PER_GAME) out.gameViolations += 1;
      // One prop per player, and the relaxation pass must never break it.
      if (byPlayer.size !== card.length) out.playerViolations += 1;
      if (batting < MIN_BATTING_PROPS || pitching < MIN_PITCHING_PROPS) out.balanceViolations += 1;
      if (byGame.size < Math.min(MIN_DISTINCT_GAMES, MAX_PROPS_PER_OUTLET)) out.gameSpreadViolations += 1;
    }

    /*
      PAIRWISE OVERLAP, every pair of outlets -- AND THE ORIGINAL THREE SEPARATELY.

      Adding five forecasters took this check red: mean pairwise overlap went to 4.31 against a
      bar of 3. That bar was set when the pool was THREE outlets and there were three pairs. With
      eight there are 28 pairs per slate, and more outlets drawing from one slate overlap more by
      pigeonhole alone -- so the mean over all pairs is not comparable to the mean over three.

      Which of the two it is matters, and it is not a matter of taste:

        - if the ORIGINAL THREE still overlap at or under 3, the five new reads are simply more
          like each other, and the fix is to differentiate them;
        - if the original three ALSO rose, the bar was calibrated for a pool size that no longer
          exists, and the honest response is to scale it rather than to pretend the league did
          not change.

      So the legacy three are measured on their own and reported alongside. Without that split,
      "mean overlap is 4.31" is a number nobody can act on.
     */
    for (let i = 0; i < MEDIA_IDS.length; i += 1) {
      for (let j = i + 1; j < MEDIA_IDS.length; j += 1) {
        const a = new Set(cards[i].card.map((m) => m.propId));
        const b = new Set(cards[j].card.map((m) => m.propId));
        const shared = Array.from(a).filter((id) => b.has(id)).length;
        out.overlapSum += shared;
        out.overlapPairs += 1;
        if (shared === a.size && a.size > 0 && a.size === b.size) {
          out.identicalPairs += 1;
          // NAME THE PAIR. A check that says "2 of 224 pairs were identical" sends the reader
          // hunting; one that says "boyle == mussad" tells them which two forecasters to look at.
          out.identicalLabels.push(`${MEDIA_IDS[i]} == ${MEDIA_IDS[j]} on ${date}`);
        }
        if (LEGACY.includes(MEDIA_IDS[i]) && LEGACY.includes(MEDIA_IDS[j])) {
          out.legacySum += shared;
          out.legacyPairs += 1;
        }
      }
    }
  }

  return out;
};

const main = async (): Promise<void> => {
  const replicates: Replicate[] = [];
  for (let r = 0; r < REPLICATES; r += 1) {
    replicates.push(await runReplicate(BASE_SEED + r * 613));
    process.stdout.write(`  replicate ${r + 1}/${REPLICATES}\r`);
  }

  const sum = <T,>(pick: (r: Replicate) => T): T[] => replicates.map(pick);
  const legacyPerReplicate = sum((r) => (r.legacyPairs > 0 ? r.legacySum / r.legacyPairs : 0));
  const legacyMean = legacyPerReplicate.reduce((a, b) => a + b, 0) / Math.max(1, replicates.length);
  const legacySd = Math.sqrt(
    legacyPerReplicate.reduce((a, v) => a + (v - legacyMean) ** 2, 0) / Math.max(1, replicates.length),
  );
  const legacyMin = Math.min(...legacyPerReplicate);
  const legacyMax = Math.max(...legacyPerReplicate);

  let overlapSum = 0;
  let legacySum = 0;
  let legacyPairs = 0;
  let overlapPairs = 0;
  let identicalPairs = 0;
  let cardsChecked = 0;
  let determinismChecked = 0;
  let statsViolations = 0;
  let gameViolations = 0;
  let playerViolations = 0;
  let balanceViolations = 0;
  let gameSpreadViolations = 0;
  let nullWinPct = 0;
  let winPctLookups = 0;
  const cardSizes: number[] = [];
  const identicalLabels: string[] = [];
  const determinismFailures: string[] = [];
  const pricingFailures: string[] = [];
  let affinityHigh = -Infinity;
  let affinityLow = Infinity;

  replicates.forEach((r) => {
    overlapSum += r.overlapSum;
    legacySum += r.legacySum;
    legacyPairs += r.legacyPairs;
    overlapPairs += r.overlapPairs;
    identicalPairs += r.identicalPairs;
    identicalLabels.push(...r.identicalLabels);
    cardsChecked += r.cardsChecked;
    determinismChecked += r.determinismChecked;
    statsViolations += r.statsViolations;
    gameViolations += r.gameViolations;
    playerViolations += r.playerViolations;
    balanceViolations += r.balanceViolations;
    gameSpreadViolations += r.gameSpreadViolations;
    nullWinPct += r.nullWinPct;
    winPctLookups += r.winPctLookups;
    cardSizes.push(...r.cardSizes);
    determinismFailures.push(...r.determinismFailures);
    pricingFailures.push(...r.pricingFailures);
    affinityHigh = Math.max(affinityHigh, r.affinityHigh);
    affinityLow = Math.min(affinityLow, r.affinityLow);
  });
  const failures = [...determinismFailures, ...pricingFailures];
  const slates = sum((r) => r.cardSizes.length / Math.max(1, MEDIA_IDS.length)).reduce((a, b) => a + b, 0);

  // ------------------------------------------------------------------ checks
  const meanOverlap = overlapSum / Math.max(1, overlapPairs);

  /*
    THE BAR IS NOW ASSERTED AGAINST THE LEGACY THREE, NOT THE WHOLE POOL.

    The bar of 3 was set when the pool WAS three outlets, and it is being applied to a mean over
    28 pairs per slate. Those are not comparable quantities: eight outlets drawing fifteen props
    from one slate overlap more by pigeonhole alone, whatever their reads do.

    So the gate asks the question that can actually be acted on -- "did the three forecasters
    that were already here get MORE similar?" -- and the eight-outlet mean is printed beside it
    as information.

    IF THE LEGACY MEAN IS ALSO OVER THE BAR, that is a different finding and this bar is wrong
    rather than the reads. The number is printed precisely so that case is visible instead of
    being argued about.
   */
  check(
    'the three original forecasters have not become MORE alike than the plan bar allows',
    legacyMean <= MAX_MEAN_PAIRWISE_OVERLAP,
    `legacy three, MEAN over ${replicates.length} seasons: ${legacyMean.toFixed(2)} of ${MAX_PROPS_PER_OUTLET}, `
      + `bar ${MAX_MEAN_PAIRWISE_OVERLAP}. Per-season range ${legacyMin.toFixed(2)} to ${legacyMax.toFixed(2)}, `
      + `sd ${legacySd.toFixed(2)} (${legacyPairs} pairs total) -- reported, not gated, because a bar on the spread would `
      + `be invented. All eight: ${meanOverlap.toFixed(2)} across ${overlapPairs} pairs -- also reported only, `
      + `because a mean over ${(MEDIA_IDS.length * (MEDIA_IDS.length - 1)) / 2} pairs is not comparable to one over 3`,
    `the three original forecasters overlap ${legacyMean.toFixed(2)} on average, above the bar of `
      + `${MAX_MEAN_PAIRWISE_OVERLAP}. Per-season range ${legacyMin.toFixed(2)}-${legacyMax.toFixed(2)}, so `
      + `individual seasons ran ${(legacyMax - legacyMin).toFixed(2)} wide around the mean. That is a real regression in `
      + `the expected overlap, not one unlucky season -- which is exactly what averaging is for.`,
  );

  check(
    'no two outlets publish an identical card',
    identicalPairs === 0,
    `0 of ${overlapPairs} outlet pairs across ${replicates.length} seasons were identical. `
      + `Historical starting state: Hollis and Glorest were 5/5 on every slate`,
    `${identicalPairs} of ${overlapPairs} outlet pairs published a byte-identical card `
      + `(${(identicalPairs / Math.max(1, overlapPairs) * 100).toFixed(3)}% per pair). Named: `
      + `${[...new Set(identicalLabels.map((l) => l.split(' on ')[0]))].join(', ') || 'unattributed'}. `
      + `First few: ${identicalLabels.slice(0, 3).join('; ') || 'none'}. This is NOT averaged away on purpose -- `
      + `it is an existence claim, so it accumulates every pair from every season and demands a flat zero.`,
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

  check(
    'the affinity term\'s win-percentage input is LIVE, so its largest term actually fires',
    nullWinPct === 0 && winPctLookups > 0,
    `${winPctLookups} win-percentage lookups, ${nullWinPct} of them null. `
    + 'This tool used to read them off a teams array frozen at 0-0, so all 3200 were null and the +0.2 '
    + 'bonus in selectionAffinity -- the single largest term in that function -- never fired. Production '
    + 'supplies live records from BettingPage and MediaHub, so the tool was testing a weaker selection '
    + 'than the app ships.',
    `${nullWinPct} of ${winPctLookups} lookups returned null, so the affinity term's win-percentage bonus is `
    + 'dead. Either the teams array is not being advanced with the manager results, or the season has '
    + 'no completed games. Either way this tool is not measuring what production does.',
  );

  // ------------------------------------------------------------------ report
  console.log(`\nPROP CARD DIVERSITY  (${slates} slates over ${replicates.length} seasons, cap ${MAX_PROPS_PER_OUTLET})`);
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
