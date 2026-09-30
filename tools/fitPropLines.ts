/**
 * Fit and validate the prop model.
 *
 * playerProps.ts ships two constants and one line ladder that have to come from
 * measurement rather than taste, and this is where they come from:
 *
 *   priorGames    how much league average to blend into a player's own season
 *                 rate. Too little and April's batting champion is priced as a
 *                 certainty off nine games; too much and every player in the
 *                 league prices at the same line, which is a prop board with
 *                 nothing on it.
 *   dispersion    how fat the tails are above the mean. Player game totals are
 *                 not Poisson: there is a ceiling on plate appearances and a
 *                 floor at zero, so a plain Poisson is overconfident at both
 *                 ends and prices a 4.5-hit line as near-certain.
 *   line offsets  where each stat's offered line sits relative to a player's own
 *                 mean, so that a "safe" pick means the same probability on
 *                 every board rather than a different one per player.
 *
 * Method: build a league, walk it day by day, and for every completed game ask
 * the model what it expected of every player who appeared, using ONLY the season
 * totals as they stood BEFORE that game. That is the information a bettor has
 * when the prop is published, so it is the information the model is allowed.
 * Using post-game totals would fit a model that cannot exist at the moment it is
 * needed, and would score beautifully while being useless.
 *
 * Ground truth is the reconstructed box score, which is exact (see
 * verifyPlayLogProps.ts), so every number here is measured against truth rather
 * than against another model.
 *
 * Reported alongside the fit, because a model that is well calibrated on average
 * and useless in the tails is not usable for this feature:
 *
 *   - Brier score, lower better, across all props offered.
 *   - A calibration table, predicted bucket against realised hit rate. A model
 *     that claims 0.70 and hits 0.70 is calibrated; one that claims 0.70 and hits
 *     0.55 is not, and averaging hides that.
 *   - Safe versus hot. The feature promises that safe picks win more often and
 *     pay less, so this has to be true in the data, not just in the styling. The
 *     safe and hot buckets are formed by ranking on predicted probability, which
 *     is how the outlets will choose them, and their realised hit rates are
 *     reported against each other.
 *
 * Run: npx tsx tools/fitPropLines.ts [seed] [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import type {
  Game, LeaguePlayerState, PlayerSeasonBatting, PlayerSeasonPitching,
} from '../src/types';
import {
  BATTING_PROP_STATS, PITCHING_PROP_STATS, PROP_STATS,
  leaguePropBaselines, playerPropRate, propStatMaps, reconstructPlayerGameLines,
  type PropBattingLine, type PropStatKey,
} from '../src/lib/playerProps';

const SEED = Number(process.argv[2] ?? 4242);
const DAYS = Number(process.argv[3] ?? 70);
const YEAR = 2026;

const clampProbability = (value: number) => Math.min(0.995, Math.max(0.005, value));

const factorial = (n: number): number => {
  let total = 1;
  for (let k = 2; k <= n; k += 1) total *= k;
  return total;
};

/** Probability of clearing the line, for arbitrary model constants. */
const overProbability = (
  meanPerGame: number, line: number, priorGames: number, dispersion: number,
): number => {
  // Ceiling, not rounding: over 0.5 means one or more. See the note on
  // propOverProbability in playerProps.ts for what this off-by-one cost.
  const threshold = Math.max(1, Math.ceil(line));
  if (meanPerGame <= 0) return 0;
  const scaled = meanPerGame / dispersion;
  let cumulative = 0;
  for (let k = 0; k < threshold; k += 1) cumulative += (Math.exp(-scaled) * scaled ** k) / factorial(k);
  return clampProbability(1 - cumulative);
};

const shrunkPerGame = (
  seasonTotal: number, gamesPlayed: number, leaguePerGame: number, priorGames: number,
): number => {
  const denominator = gamesPlayed + priorGames;
  if (denominator <= 0) return leaguePerGame;
  return (seasonTotal + leaguePerGame * priorGames) / denominator;
};

/** The line for a stat under a given offset ladder. */
const lineFor = (
  stat: PropStatKey, mean: number, offset: number,
): number => {
  const step = 0.5;
  const raw = Math.round((mean + offset) / step) * step;
  return Math.round(raw * 2) / 2;
};

const LADDER: Record<PropStatKey, { offset: number; min: number; max: number }> = {
  hits: { offset: -0.35, min: 0.5, max: 4.5 },
  runs: { offset: -0.3, min: 0.5, max: 2.5 },
  rbi: { offset: -0.3, min: 0.5, max: 2.5 },
  homeRuns: { offset: -0.2, min: 0.5, max: 1.5 },
  walks: { offset: -0.3, min: 0.5, max: 2.5 },
  battingStrikeouts: { offset: -0.3, min: 0.5, max: 2.5 },
  pitcherStrikeouts: { offset: -1.5, min: 1.5, max: 7.5 },
  hitsAllowed: { offset: -1.5, min: 0.5, max: 6.5 },
};

interface Observation {
  stat: PropStatKey;
  predicted: number;
  actual: number;
  won: boolean;
  gamesPlayedAtBet: number;
}

/** Everything the model is allowed to see, from one pre-game state. */
interface Prior {
  baselines: Record<PropStatKey, number>;
  batting: Map<string, PlayerSeasonBatting>;
  pitching: Map<string, PlayerSeasonPitching>;
}

const buildPrior = (state: LeaguePlayerState): Prior => {
  const maps = propStatMaps(state);
  return {
    baselines: leaguePropBaselines(maps.batting, maps.pitching),
    batting: maps.batting,
    pitching: maps.pitching,
  };
};

/**
 * Read a prop stat off a reconstructed box score.
 *
 * Mapped by hand because the reconstructed lines name their fields the way a box
 * score does -- `runsScored`, `strikeouts` -- and the prop keys do not: the prop
 * is `runs`, whose box-score field is `runsScored`, and `battingStrikeouts`,
 * whose box-score field is `strikeouts`. Indexing straight through with the prop
 * key silently yields undefined, which compares false and scores as a permanent
 * loss. That is exactly what the first run of this tool reported for batting
 * strikeouts: a realised hit rate of 0.000, which is not a finding about
 * baseball, it is a mapping bug wearing a finding's clothes.
 */
const boxScoreValue = (stat: PropStatKey, line: PropBattingLine): number =>
  stat === 'runs' ? line.runsScored
  : stat === 'battingStrikeouts' ? line.strikeouts
  : stat === 'homeRuns' ? line.homeRuns
  : stat === 'hits' ? line.hits
  : stat === 'rbi' ? line.rbi
  : stat === 'walks' ? line.walks
  : 0;

const statValue = (
  stat: PropStatKey,
  batting: Map<string, { hits: number; runsScored: number; rbi: number; homeRuns: number; walks: number; strikeouts: number }>,
  pitching: Map<string, { hitsAllowed: number; strikeouts: number }>,
  playerId: string,
): number | null => {
  if (stat === 'pitcherStrikeouts') return pitching.get(playerId)?.strikeouts ?? null;
  if (stat === 'hitsAllowed') return pitching.get(playerId)?.hitsAllowed ?? null;
  const row = batting.get(playerId);
  if (!row) return null;
  switch (stat) {
    case 'hits': return row.hits;
    case 'runs': return row.runsScored;
    case 'rbi': return row.rbi;
    case 'homeRuns': return row.homeRuns;
    case 'walks': return row.walks;
    case 'battingStrikeouts': return row.strikeouts;
    default: return null;
  }
};

/**
 * Collect every prop the model would have published, for one league.
 *
 * Observations are gathered once with the winning constants and re-scored for
 * other constants, so the grid search is a scoring pass and not a re-simulation
 * per candidate. Each observation keeps the pre-game inputs it was built from,
 * which is what allows re-scoring without holding the whole season in memory
 * twice over.
 */
interface RawObservation {
  stat: PropStatKey;
  seasonTotal: number;
  gamesPlayed: number;
  leaguePerGame: number;
  offset: number;
  min: number;
  max: number;
  actual: number;
}

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

  const games = generateSchedule(roster, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
  });

  const manager = new SimulationManager({
    teams: roster,
    games,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  const raw: RawObservation[] = [];
  const seen = new Set<string>();
  let previous: LeaguePlayerState = universe;
  let gamesScored = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const prior = buildPrior(previous);
    const result = await manager.run({ scope: 'day' });
    previous = result.playerState;

    const fresh: Game[] = result.games.filter(
      (game) => game.status === 'completed' && !seen.has(game.gameId),
    );
    for (const game of fresh) seen.add(game.gameId);

    for (const game of fresh) {
      gamesScored += 1;
      const { batting: batLines, pitching: pitLines } = reconstructPlayerGameLines(game);

      const score = (stat: PropStatKey, playerId: string, actual: number) => {
        const ladder = LADDER[stat];
        const rate = playerPropRate(stat, playerId, prior.batting, prior.pitching);
        raw.push({
          stat,
          seasonTotal: rate.seasonTotal,
          gamesPlayed: rate.gamesPlayed,
          leaguePerGame: prior.baselines[stat],
          offset: ladder.offset,
          min: ladder.min,
          max: ladder.max,
          actual,
        });
      };

      batLines.forEach((line, playerId) => {
        for (const stat of BATTING_PROP_STATS) score(stat, playerId, boxScoreValue(stat, line));
      });
      pitLines.forEach((line, playerId) => {
        for (const stat of PITCHING_PROP_STATS) {
          score(stat, playerId, line[stat === 'hitsAllowed' ? 'hitsAllowed' : 'strikeouts']);
        }
      });
    }
  }

  console.log(`seed ${SEED} · ${DAYS} days · ${gamesScored} completed games`);
  console.log(`prop observations offered: ${raw.length}`);
  console.log('');

  const score = (priorGames: number, dispersion: number): { brier: number; count: number } => {
    let sum = 0;
    let count = 0;
    for (const row of raw) {
      const mean = shrunkPerGame(row.seasonTotal, row.gamesPlayed, row.leaguePerGame, priorGames);
      const line = Math.min(row.max, Math.max(row.min, lineFor(row.stat, mean, row.offset)));
      const predicted = overProbability(mean, line, priorGames, dispersion);
      const won = row.actual > line ? 1 : 0;
      sum += (predicted - won) ** 2;
      count += 1;
    }
    return { brier: count > 0 ? sum / count : 1, count };
  };

  /* ---------------- grid search ---------------- */

  const priors = [4, 8, 12, 16, 24, 32, 48, 64, 96];
  const dispersions = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5, 1.7, 2.0, 2.5];

  let best = { priorGames: 12, dispersion: 1.0, brier: 1 };
  console.log('priorGames x dispersion, Brier score, pooled across all stats (lower is better)');
  const header = ['disp'.padEnd(8), ...priors.map((p) => String(p).padStart(8))].join('');
  console.log(header);
  for (const dispersion of dispersions) {
    const cells = priors.map((priorGames) => {
      const { brier } = score(priorGames, dispersion);
      if (brier < best.brier) best = { priorGames, dispersion, brier };
      return brier.toFixed(4).padStart(8);
    });
    console.log([dispersion.toFixed(2).padEnd(8), ...cells].join(''));
  }
  console.log('');
  console.log(`pooled best: priorGames=${best.priorGames} dispersion=${best.dispersion.toFixed(2)} Brier=${best.brier.toFixed(4)}`);
  console.log('');

  /*
   * A single pooled dispersion is a compromise between stats that are not
   * compromises of each other. The first pooled fit came out at 1.35 and left
   * hitsAllowed claiming 0.747 on lines that cleared 0.601, because hits allowed
   * is far more concentrated around its mean than the model assumed -- a pitcher
   * who allows a lot tends to allow a lot every time, rather than alternating
   * between a shutout and a nine-hit outing. Meanwhile walks were UNDERconfident.
   *
   * So dispersion is fitted per stat. That is not a fudge factor per stat, it is
   * one parameter measured where it belongs, and the per-stat table below is
   * reported so the differences can be checked rather than trusted.
   */
  const scoreStat = (
    stat: PropStatKey, priorGames: number, dispersion: number,
  ): { brier: number; count: number } => {
    const rows = raw.filter((r) => r.stat === stat);
    let sum = 0;
    for (const row of rows) {
      const mean = shrunkPerGame(row.seasonTotal, row.gamesPlayed, row.leaguePerGame, priorGames);
      const line = Math.min(row.max, Math.max(row.min, lineFor(stat, mean, row.offset)));
      const predicted = overProbability(mean, line, priorGames, dispersion);
      sum += (predicted - (row.actual > line ? 1 : 0)) ** 2;
    }
    return { brier: rows.length > 0 ? sum / rows.length : 1, count: rows.length };
  };

  console.log('per-stat fit: priorGames and dispersion searched independently');
  console.log('stat                n     best prior  best disp    Brier   (at pooled, for contrast)');

  const perStat: Partial<Record<PropStatKey, { priorGames: number; dispersion: number }>> = {};
  const offeredStats = (Object.keys(PROP_STATS) as PropStatKey[])
    .filter((stat) => raw.some((r) => r.stat === stat));

  for (const stat of offeredStats) {
    let winner = { priorGames: 12, dispersion: 1.0, brier: 1 };
    for (const dispersion of dispersions) {
      for (const priorGames of priors) {
        const { brier } = scoreStat(stat, priorGames, dispersion);
        if (brier < winner.brier) winner = { priorGames, dispersion, brier };
      }
    }
    perStat[stat] = { priorGames: winner.priorGames, dispersion: winner.dispersion };
    const pooled = scoreStat(stat, best.priorGames, best.dispersion);
    console.log(
      `${stat.padEnd(18)} ${String(winner.brier === 1 ? 0 : raw.filter((r) => r.stat === stat).length).padStart(6)}  ` +
      `${String(winner.priorGames).padStart(11)}  ${winner.dispersion.toFixed(2).padStart(9)}   ` +
      `${winner.brier.toFixed(4)}   ${pooled.brier.toFixed(4)}`,
    );
  }
  console.log('');

  const effective = (stat: PropStatKey): { priorGames: number; dispersion: number } =>
    perStat[stat] ?? { priorGames: best.priorGames, dispersion: best.dispersion };

  // Score the per-stat model as a whole, so it can be compared to the pooled one
  // on the same footing rather than by eye.
  let perStatSum = 0;
  for (const row of raw) {
    const constants = effective(row.stat);
    const mean = shrunkPerGame(row.seasonTotal, row.gamesPlayed, row.leaguePerGame, constants.priorGames);
    const line = Math.min(row.max, Math.max(row.min, lineFor(row.stat, mean, row.offset)));
    const predicted = overProbability(mean, line, constants.priorGames, constants.dispersion);
    perStatSum += (predicted - (row.actual > line ? 1 : 0)) ** 2;
  }
  const perStatBrier = perStatSum / Math.max(1, raw.length);
  console.log(`pooled Brier   ${best.brier.toFixed(4)}`);
  console.log(`per-stat Brier ${perStatBrier.toFixed(4)}  ${perStatBrier < best.brier ? 'better' : 'WORSE -- keep the pooled fit'}`);
  console.log('');

  const USE_PER_STAT = perStatBrier < best.brier;
  const fitted = USE_PER_STAT
    ? perStat
    : Object.fromEntries(offeredStats.map((s) => [s, { priorGames: best.priorGames, dispersion: best.dispersion }]));
  console.log(`fitting per-stat constants: ${USE_PER_STAT ? 'yes' : 'no, pooled'}`);
  console.log('');

  /* ---------------- calibration at the fit ---------------- */

  const observations: Observation[] = raw.map((row) => {
    const constants = fitted[row.stat] ?? { priorGames: best.priorGames, dispersion: best.dispersion };
    const mean = shrunkPerGame(row.seasonTotal, row.gamesPlayed, row.leaguePerGame, constants.priorGames);
    const line = Math.min(row.max, Math.max(row.min, lineFor(row.stat, mean, row.offset)));
    const predicted = overProbability(mean, line, constants.priorGames, constants.dispersion);
    return {
      stat: row.stat,
      predicted,
      actual: row.actual,
      won: row.actual > line,
      gamesPlayedAtBet: row.gamesPlayed,
    };
  });

  const edges = [0.05, 0.2, 0.35, 0.5, 0.62, 0.72, 0.8, 0.88, 1.01];
  console.log('calibration, over probabilities');
  console.log('bucket            n       predicted   realised');
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const bucket = observations.filter((o) => o.predicted >= lo && o.predicted < hi);
    if (bucket.length === 0) continue;
    const meanPredicted = bucket.reduce((s, o) => s + o.predicted, 0) / bucket.length;
    const realised = bucket.filter((o) => o.won).length / bucket.length;
    const label = `${lo.toFixed(2)}-${hi === 1.01 ? '1.00' : hi.toFixed(2)}`;
    console.log(
      `${label.padEnd(16)} ${String(bucket.length).padStart(6)}   ${meanPredicted.toFixed(3).padStart(9)}   ${realised.toFixed(3).padStart(8)}`,
    );
  }
  console.log('');

  /* ---------------- safe versus hot ---------------- */

  /*
   * The ranking here is by predicted probability across ALL props, which is how
   * the outlets will pick: their five safest, and their five most ambitious. If
   * the buckets do not separate, the safe/hot framing on the cards is decoration.
   */
  const ranked = [...observations].sort((a, b) => b.predicted - a.predicted);
  const bucketSize = Math.floor(ranked.length * 0.2);
  const safest = ranked.slice(0, bucketSize);
  const hottest = ranked.slice(-bucketSize);

  const summarise = (label: string, set: Observation[]) => {
    const meanPredicted = set.reduce((s, o) => s + o.predicted, 0) / set.length;
    const realised = set.filter((o) => o.won).length / set.length;
    console.log(
      `${label.padEnd(10)} n=${String(set.length).padStart(6)}  predicted ${meanPredicted.toFixed(3)}  realised ${realised.toFixed(3)}`,
    );
    return { meanPredicted, realised };
  };

  console.log('safe versus hot, ranked on predicted probability');
  const safeStats = summarise('safest 20%', safest);
  const hotStats = summarise('hottest 20%', hottest);
  console.log('');
  console.log(`separation: safe hits ${(safeStats.realised * 100).toFixed(1)}%, hot hits ${(hotStats.realised * 100).toFixed(1)}%`);
  console.log(safeStats.realised > hotStats.realised
    ? 'safe really is safer than hot.'
    : 'WARNING: safe is not safer than hot. The framing would be decoration.');
  console.log('');

  /* ---------------- per stat ---------------- */

  console.log('per stat, at the fit');
  console.log('stat                n      Brier  mean predicted  realised  mean line');
  for (const stat of Object.keys(PROP_STATS) as PropStatKey[]) {
    const set = observations.filter((o) => o.stat === stat);
    if (set.length === 0) { console.log(`${stat.padEnd(18)} (none offered)`); continue; }
    const brier = set.reduce((s, o) => s + (o.predicted - (o.won ? 1 : 0)) ** 2, 0) / set.length;
    const meanPredicted = set.reduce((s, o) => s + o.predicted, 0) / set.length;
    const realised = set.filter((o) => o.won).length / set.length;
    const constants = fitted[stat] ?? { priorGames: best.priorGames, dispersion: best.dispersion };
    const meanLine = raw
      .filter((r) => r.stat === stat)
      .reduce((s, r) => {
        const mean = shrunkPerGame(r.seasonTotal, r.gamesPlayed, r.leaguePerGame, constants.priorGames);
        return s + Math.min(r.max, Math.max(r.min, lineFor(stat, mean, r.offset)));
      }, 0) / set.length;
    console.log(
      `${stat.padEnd(18)} ${String(set.length).padStart(6)}   ${brier.toFixed(4)}   ${meanPredicted.toFixed(3).padStart(12)}   ${realised.toFixed(3).padStart(8)}  ${meanLine.toFixed(2).padStart(8)}`,
    );
  }
  console.log('');

  /* ---------------- early versus late ---------------- */

  console.log('does it hold early in the season, when the rates are thin?');
  for (const threshold of [5, 10, 20, 40]) {
    const thin = observations.filter((o) => o.gamesPlayedAtBet < threshold);
    if (thin.length === 0) continue;
    const brier = thin.reduce((s, o) => s + (o.predicted - (o.won ? 1 : 0)) ** 2, 0) / thin.length;
    const realised = thin.filter((o) => o.won).length / thin.length;
    const meanPredicted = thin.reduce((s, o) => s + o.predicted, 0) / thin.length;
    console.log(`  under ${String(threshold).padStart(2)} games: n=${String(thin.length).padStart(6)} Brier=${brier.toFixed(4)} predicted ${meanPredicted.toFixed(3)} realised ${realised.toFixed(3)}`);
  }
  const thick = observations.filter((o) => o.gamesPlayedAtBet >= 40);
  if (thick.length > 0) {
    const brier = thick.reduce((s, o) => s + (o.predicted - (o.won ? 1 : 0)) ** 2, 0) / thick.length;
    const realised = thick.filter((o) => o.won).length / thick.length;
    const meanPredicted = thick.reduce((s, o) => s + o.predicted, 0) / thick.length;
    console.log(`  40+ games:        n=${String(thick.length).padStart(6)} Brier=${brier.toFixed(4)} predicted ${meanPredicted.toFixed(3)} realised ${realised.toFixed(3)}`);
  }
};

void main();
