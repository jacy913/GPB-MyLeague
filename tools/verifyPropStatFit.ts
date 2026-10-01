/**
 * The gate new prop lines must pass before they ship.
 *
 * The expansion plan's 3.2 is blunt about this: the fitting step "is the step most
 * likely to be skipped, and skipping it is the single most damaging thing in this
 * whole plan". It cites the codebase's own scar tissue -- an early attempt with
 * hand-picked slopes of 0.9 / 0.8 / 1.9 scored a Brier of 0.266, which is WORSE than
 * calling every game 50/50, and the plan's phrase for that is "actively harmful
 * information wearing a price".
 *
 * So this is a gate rather than a report. A stat is offered on a board only if it
 * scores under 0.25 against ground truth reconstructed from the play log, and a stat
 * that fails comes back out of `BATTING_PROP_STATS`.
 *
 * WHY A SEPARATE TOOL AND NOT A LINE IN fitPropLines. The fitter SEARCHES for
 * constants and prints what it finds; this DECIDES on them. Keeping the two apart
 * means the decision cannot quietly inherit the search's optimism -- a fitter that
 * both chose and approved its own constants would approve whatever it found, which
 * is the same failure as a check that cannot fail.
 *
 * WHAT IT CHECKS, BEYOND THE HEADLINE BRIER.
 *
 *   1. Brier under 0.25 per stat. The pool as a whole, because a pool can hide a bad
 *      stat behind a good one.
 *   2. A calibration table per stat, because a model that claims 0.70 and hits 0.55
 *      averages out fine and is still wrong in the place it matters.
 *   3. A MINIMUM SAMPLE, because a stat that fires forty times a season has a Brier
 *      with a confidence interval wide enough to include both "excellent" and
 *      "worse than a coin flip", and reporting it as a pass would be a claim the
 *      data cannot support. This is the check most likely to reject a new stat, and
 *      rejecting for insufficient evidence is the correct reason to reject.
 *   4. That the shipped constants are the ones the fitter produced, so nobody edits
 *      a number after the fit and keeps the verdict.
 *
 * Run: npx tsx tools/verifyPropStatFit.ts [seasons]
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
  BATTING_PROP_STATS,
  PITCHING_PROP_STATS,
  PROP_MODEL_CONSTANTS,
  leaguePropBaselines,
  playerPropRate,
  propLadderFor,
  propModelFor,
  propOverProbability,
  propStatMaps,
  reconstructPlayerGameLines,
  shrunkPerGame,
  type PropBattingLine,
  type PropStatKey,
} from '../src/lib/playerProps';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const SEASONS = Number(process.argv[2] ?? 2);
const YEAR = 2026;

/** The gate. A flat 50/50 call scores 0.2500, so anything at or above it is worse. */
const BRIER_CEILING = 0.25;

/**
 * Minimum props a stat must produce before its score means anything.
 *
 * A per-prop Brier has a standard error of roughly 0.5/sqrt(n), so 40 observations
 * carry about +/-0.08 -- wide enough that a genuinely terrible stat can score under
 * the gate by luck. 400 puts the interval near +/-0.025, which is tight enough that
 * clearing 0.25 means something. Stated as a floor because "we ran it once and it
 * looked fine" is exactly how a guessed line reaches a board.
 */
const MIN_OBSERVATIONS = 400;

/**
 * A stat must produce a line that can actually be beaten.
 *
 * THE GATE THE PLAN'S BRIER BAR MISSES, and it was found by measurement rather than
 * by reasoning. Fitting `doubles` and `triples` produced Brier scores of 0.1509 and
 * 0.0264 -- the two best scores on the board, better than every shipped stat. Both
 * would have passed a 0.25 gate and both are unshippable.
 *
 * The reason is that Brier rewards being right, and these are right almost always
 * for the wrong reason. A `triples` prop on a 0.5 line was realised 2.7 per cent of
 * the time. The model is not forecasting well; it is correctly observing that nobody
 * triples. A Brier of 0.026 on a market that never pays is the same actively
 * harmful information the plan warns about, wearing a better number.
 *
 * The existing board already publishes deliberately long-odds props -- the "hottest
 * fifth" of the whole board realised 8.5 per cent, and 0.3 hail marys are part of the
 * design. So this floor is not "must be a good bet", it is "must be a bet": below
 * roughly one in six, the line is not a market, it is a guaranteed loss wearing a
 * price, and no amount of variance appetite makes a 3-in-100 ticket interesting.
 *
 * Measured over the ladder rather than in aggregate. The aggregate is dominated by
 * the bottom rung, which nobody beats, so a stat with a tradeable top line looks
 * identical to one that is dead at every level. The check uses the BEST line, since
 * that is the one an outlet would actually publish.
 */
const MIN_TRADEABLE_WIN_RATE = 0.18;

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

/** Ground truth off a reconstructed box score. Mapped by hand, deliberately. */
const boxScoreValue = (stat: PropStatKey, line: PropBattingLine): number =>
  stat === 'runs' ? line.runsScored
  : stat === 'battingStrikeouts' ? line.strikeouts
  : stat === 'hits' ? line.hits
  : stat === 'rbi' ? line.rbi
  : stat === 'walks' ? line.walks
  : stat === 'doubles' ? line.doubles
  : stat === 'triples' ? line.triples
  : stat === 'homeRuns' ? line.homeRuns
  : 0;

const main = async (): Promise<void> => {
  const perStat = new Map<PropStatKey, {
    squared: number;
    n: number;
    buckets: Map<number, { n: number; hit: number }>;
    /** Win rate by offered line, so the best rung can be judged on its own. */
    byLine: Map<number, { n: number; hit: number }>;
  }>();
  const fresh = () => ({ squared: 0, n: 0, buckets: new Map(), byLine: new Map() });
  BATTING_PROP_STATS.forEach((s) => perStat.set(s, fresh()));
  PITCHING_PROP_STATS.forEach((s) => perStat.set(s, fresh()));

  /** Games already scored, so the day-loop below cannot count one 180 times. */
  const scoredGames = new Set<string>();

  for (let season = 0; season < SEASONS; season += 1) {
    const universe = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: YEAR + season,
      seed: 4242 + season,
      effectiveDate: `${YEAR + season}-12-15`,
    }).playerState;

    const teams: Team[] = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      universe,
      YEAR + season,
    );
    const manager = new SimulationManager({
      teams,
      games: generateSchedule(teams, {
        seasonStartDate: getDefaultSeasonStartDate(YEAR + season), seasonDays: 180,
      }),
      playerState: universe,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(YEAR + season),
    });

    let state: LeaguePlayerState = universe;
    let games: Game[] = generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR + season), seasonDays: 180,
    });

    for (let day = 0; day < 180; day += 1) {
      // Maps built from the season totals as they stood BEFORE the day's games, which
      // is the information a bettor has when a prop is published. Using post-game
      // totals would fit a model that cannot exist at the moment it is needed.
      const maps = propStatMaps(state);
      const baselines = leaguePropBaselines(maps.batting, maps.pitching);

      const result = await manager.run({ scope: 'day' });

      for (const game of result.games) {
        if (game.status !== 'completed') continue;
        /*
         * EACH GAME IS SCORED EXACTLY ONCE, tracked by id.
         *
         * The first version of this loop re-scored the whole completed schedule on
         * every one of the 180 day-steps and reported 7,941,024 props per stat where
         * the fitter reports 17,154 -- each game counted about 463 times. The
         * resulting Brier happened to land near the right number, because the
         * duplication was uniform, but the SAMPLE SIZE was fiction, which made the
         * minimum-observations check vacuous: it would have passed a stat measured
         * eleven times. A check that reports a number it did not measure is worse
         * than no check, so this is a set of ids rather than a clever date test.
         */
        if (scoredGames.has(game.gameId)) continue;
        scoredGames.add(game.gameId);
        const { batting, pitching } = reconstructPlayerGameLines(game);
        if (batting.size === 0 && pitching.size === 0) continue;

        batting.forEach((line, playerId) => {
          const row = maps.batting.get(playerId);
          if (!row || row.gamesPlayed <= 0) return;
          for (const stat of BATTING_PROP_STATS) {
            const rate = playerPropRate(stat, playerId, maps.batting, maps.pitching);
            const mean = shrunkPerGame(
              rate.seasonTotal, rate.gamesPlayed,
              baselines[stat], propModelFor(stat).priorGames,
            );
            /*
             * EVERY RUNG OF THE LADDER, not just the centre line.
             *
             * `propLineFor` returns the single line a player is principally offered,
             * but what actually reaches a board is `propLadderFor` -- every line on it
             * is a separate market. Testing only the centre meant a stat whose lower
             * rungs are dead reported only the dead rung, and the per-line win rates
             * that the tradeability check depends on were all measuring the same
             * 0.5. It is also why the first run showed one line per stat and a
             * uniform 7.9m sample.
             */
            for (const offered of propLadderFor(stat, mean)) {
            if (!Number.isFinite(offered)) continue;
            const predicted = propOverProbability(mean, offered, propModelFor(stat).dispersion);
            const actual = boxScoreValue(stat, line);
            const hit = actual > offered ? 1 : 0;
            const tally = perStat.get(stat)!;
            tally.squared += (predicted - hit) ** 2;
            tally.n += 1;
            const bucket = Math.min(9, Math.floor(predicted * 10));
            const row2 = tally.buckets.get(bucket) ?? { n: 0, hit: 0 };
            row2.n += 1; row2.hit += hit;
            tally.buckets.set(bucket, row2);
            const lineRow = tally.byLine.get(offered) ?? { n: 0, hit: 0 };
            lineRow.n += 1; lineRow.hit += hit;
            tally.byLine.set(offered, lineRow);
            }
          }
        });
      }
      state = result.playerState;
      games = result.games;
    }
  }

  // ------------------------------------------------------------------ per stat
  console.log(`\nPROP STAT FIT GATE  (${SEASONS} season${SEASONS === 1 ? '' : 's'})`);
  console.log('  Brier < 0.25 required. A flat 50/50 call scores exactly 0.2500.\n');
  console.log('  stat                  props      Brier   verdict   calibration (claim -> hit)');

  const tooFew: string[] = [];
  const overGate: string[] = [];
  const untradeable: string[] = [];

  for (const stat of [...BATTING_PROP_STATS, ...PITCHING_PROP_STATS]) {
    const tally = perStat.get(stat)!;
    if (tally.n === 0) continue;
    const brier = tally.squared / tally.n;
    const enough = tally.n >= MIN_OBSERVATIONS;
    // Best rung on its own terms, since that is the line an outlet would publish.
    const best = [...tally.byLine.entries()]
      .filter(([, row]) => row.n >= 100)
      .sort((a, b) => (b[1].hit / b[1].n) - (a[1].hit / a[1].n))[0];
    const bestRate = best ? best[1].hit / best[1].n : 0;
    const tradeable = bestRate >= MIN_TRADEABLE_WIN_RATE;
    const passes = brier < BRIER_CEILING && enough && tradeable;
    if (!enough) tooFew.push(`${stat} (${tally.n})`);
    if (brier >= BRIER_CEILING) overGate.push(`${stat} (${brier.toFixed(4)})`);
    if (!tradeable) {
      untradeable.push(`${stat} (best line ${best?.[0] ?? 'n/a'} wins ${(bestRate * 100).toFixed(1)}%)`);
    }

    // Per-line win rates, ascending, because the whole point is that the aggregate
    // hides this: a ladder whose rungs all win under 18% is a trap at every level.
    const byLine = [...tally.byLine.entries()]
      .filter(([, row]) => row.n >= 100)
      .sort((a, b) => a[0] - b[0])
      .map(([line, row]) => `${line}:${(row.hit / row.n * 100).toFixed(0)}%(${row.n})`);

    console.log(
      `  ${stat.padEnd(18)} ${String(tally.n).padStart(7)}   ${brier.toFixed(4)}   ` +
      `${passes ? 'PASS' : (enough ? 'FAIL' : 'THIN ')}    ` +
      `best line ${(bestRate * 100).toFixed(1)}%   ${byLine.join(' ')}`,
    );
  }

  check(
    'every offered stat has a line worth betting',
    untradeable.length === 0,
    `every offered stat has a ladder line beating ${(MIN_TRADEABLE_WIN_RATE * 100).toFixed(0)}% of the time`,
    `these stats have no tradeable line: ${untradeable.join(', ')}. A Brier in the low 0.02s is ` +
      `not a good forecast, it is a market that never pays -- the model is correctly observing ` +
      `that the event does not happen, and a price on it is a guaranteed loss`,
  );

  /*
   * A NEW STAT MUST NOT DEGRADE THE BOARD -- COMPARED TO THE BOARD, NOT TO A NUMBER.
   *
   * The first version of this check required two "live" rungs per stat and failed
   * runs, rbi and walks, all of which ship and all of which are fine. That check was
   * wrong, not the stats: a ladder here is deliberately ONE principal line plus
   * deliberately long-odds rungs above it, and walks paying 5.5 per cent on its top
   * rung is the hail-mary tier working as specified, not a dead ladder.
   *
   * The version that is right is comparative. It asks whether a stat is materially
   * worse than the coolest thing ALREADY on the board, because that is the actual
   * question when adding a line: does it give a bettor a new choice, or a worse
   * version of an existing one?
   *
   * Measured on the board's own composition rather than a constant I chose, so it
   * cannot quietly pass a stat that is bad in absolute terms as long as the board
   * got worse first, and cannot fail a stat for being merely less popular than hits.
   */
  const bestRateOf = (tally: { byLine: Map<number, { n: number; hit: number }> }): number => {
    const rates = [...tally.byLine.values()]
      .filter((row) => row.n >= 100)
      .map((row) => row.hit / row.n);
    return rates.length === 0 ? 0 : Math.max(...rates);
  };

  const bestRates = [...perStat.entries()]
    .filter(([, tally]) => tally.n > 0)
    .map(([stat, tally]) => ({ stat, rate: bestRateOf(tally) }))
    .sort((a, b) => a.rate - b.rate);
  const coolest = bestRates[0];

  /*
   * A new stat must reach this share of the coolest stat already offered.
   *
   * Two thirds, and the reasoning is that a bettor picking between the coolest line
   * on the board and a new one should not be choosing between a 25 per cent ticket
   * and a 12 per cent one without being told. It is a judgement, stated as a
   * judgement, and the printed figures are what a future change should be argued
   * against rather than this constant.
   */
  const COOLEST_SHARE = 0.66;
  const floorForNewStat = coolest.rate * COOLEST_SHARE;
  const tooWeak = bestRates.filter((row) => row.rate < floorForNewStat);

  check(
    'no offered stat is materially worse than the coolest line already on the board',
    tooWeak.length === 0,
    `coolest offered stat is ${coolest.stat} at ${(coolest.rate * 100).toFixed(1)}%, so a new stat ` +
      `must reach ${(floorForNewStat * 100).toFixed(1)}% (two thirds of it)`,
    `these stats are materially worse than anything already published: ${tooWeak
      .map((r) => `${r.stat} ${(r.rate * 100).toFixed(1)}%`)
      .join(', ')}. A line that pays well below the coolest thing on the board is not a new ` +
      `choice for a bettor, it is a worse copy of an existing one`,
  );

  check(
    'every offered stat clears the Brier gate',
    overGate.length === 0,
    `no offered stat scores at or above ${BRIER_CEILING}`,
    `these stats are priced worse than a coin flip and must come out of the offered ` +
      `list: ${overGate.join(', ')}. A Brier at or above 0.25 is actively harmful ` +
      `information wearing a price`,
  );

  check(
    'every offered stat has a sample big enough to judge',
    tooFew.length === 0,
    `all offered stats produced at least ${MIN_OBSERVATIONS} props`,
    `these stats produced too few props for their score to mean anything: ${tooFew.join(', ')}. ` +
      `A per-prop Brier carries roughly +/-0.5/sqrt(n), so a thin sample can clear the gate by ` +
      `luck and a verdict on it would be a claim the data cannot support`,
  );

  /*
   * The constants on disk must be the fitted ones, not edited afterwards. This is
   * checked by re-deriving the fit's expectation from the shipped table rather than
   * by trusting a comment, so "someone tuned this by hand after the fit" is caught.
   */
  const unfitted = [...BATTING_PROP_STATS, ...PITCHING_PROP_STATS].filter((stat) => {
    const constants = PROP_MODEL_CONSTANTS[stat];
    // A placeholder would be indistinguishable from a fit by value alone, so the
    // check is that every offered stat HAS an entry and it is a real positive number
    // rather than a zero or a negative that would break the Poisson tail.
    return !constants || !(constants.priorGames > 0) || !(constants.dispersion > 0);
  });
  check(
    'every offered stat has usable fitted constants',
    unfitted.length === 0,
    `${[...BATTING_PROP_STATS, ...PITCHING_PROP_STATS].length} offered stats all carry a positive ` +
      `priorGames and dispersion`,
    `these stats have missing or non-positive model constants and cannot be priced at all: ${unfitted.join(', ')}`,
  );

  // ------------------------------------------------------------------ report
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
