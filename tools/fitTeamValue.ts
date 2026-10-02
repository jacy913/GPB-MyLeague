/**
 * Fit the team-value weights against REALISED SEASON WIN TOTALS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TARGET
 * ---------------------------------------------------------------------------
 *
 * A valuation function fitted against nothing is a vibe with a number on it. The target here is
 * the win total a club ACTUALLY finishes with -- observable, settled, and the same shape of target
 * `fitMediaOdds` uses when it fits a forecaster against settled games.
 *
 * The question being answered is narrow and worth stating plainly: **given what is knowable
 * part-way through a season, how much does each term actually contribute to predicting how many
 * games that club goes on to win?**
 *
 * ---------------------------------------------------------------------------
 * WHY ORDINARY LEAST SQUARES ON Z-SCORES, AND WHY THE WEIGHTS ARE JUST THE COEFFICIENTS
 * ---------------------------------------------------------------------------
 *
 * `teamValueFor` computes `50 + (50/3) * SUM(w_i * z_i)`. Every term is already standardised by
 * `measureLeague`, so the value is an affine function of the linear predictor `SUM(w_i * z_i)`,
 * and any weight vector proportional to the true regression coefficients predicts identically.
 *
 * Rescaling a linear predictor does not change its correlation with the target by a single digit.
 * So the fitted coefficients ARE the weights up to a positive constant, and dividing them by their
 * sum to make them sum to 1 costs nothing statistically -- it only sets where the 0-100 scale sits.
 * That is the whole reason the module can be both "a 0-100 valuation" and "the thing that best
 * predicts wins".
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MEASURED, AND WHAT IS REPORTED
 * ---------------------------------------------------------------------------
 *
 * Each replicate is a full simulated season from a fresh universe. The season is stepped day by
 * day, and at three points the four predictors are measured and recorded alongside where that
 * club ends up. Every observation is therefore a genuine forecast: what was knowable at date D,
 * scored against what actually happened.
 *
 * Reported, and not quietly smoothed:
 *
 *   - the four coefficients, each with a STANDARD ERROR and a t-statistic, because a coefficient
 *     that cannot be distinguished from zero should not be shipped as though it were measured
 *   - the joint R-squared, which is the honest headline: how much of the variance in final win
 *     totals these four terms explain
 *   - each term's partial R-squared, i.e. what it adds ON TOP OF the other three, because a term
 *     can correlate with wins and still add nothing once the others are present
 *
 * ---------------------------------------------------------------------------
 * WHAT WOULD MAKE THIS FIT WRONG, STATED BEFORE THE NUMBERS
 * ---------------------------------------------------------------------------
 *
 * If a coefficient comes out NEGATIVE, that is a real finding -- the term is anti-informative in
 * this sample -- and it is NOT shipped negative. A negative weight would mean "more playoff
 * probability lowers this club's value", which is incoherent for a valuation. Such a term ships
 * at the floor and the report says so.
 *
 * If a coefficient's t-statistic is small, the term has no measurable edge here. That is reported
 * as "no edge, shipping at the floor" rather than presented as a fitted number.
 *
 * The same three-point discipline as `fitMediaOdds`: the bar is applied to the FITTED OPTIMUM, not
 * to a shipped value, so the gate cannot punish a preserved construction.
 *
 * Run: npx tsx tools/fitTeamValue.ts [replicates] [mcTrials]
 */

import {
  buildValueInputs,
  TEAM_VALUE_TERMS,
  type TeamValueInput,
  type TeamValueTerm,
} from '../src/lib/analytics/teamValue';
import { playoffMonteCarlo } from '../src/lib/analytics/playoffMonteCarlo';
import { INITIAL_TEAMS } from '../src/data/teams';
import { weightedConsensus } from '../src/lib/markets';
import { buildMediaReads } from '../src/lib/mediaReads';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { getTeamRosterStrength, getTeamStrengthEdge, recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import type { Game, LeaguePlayerState, Team } from '../src/types';

/**
 * Games played per club at which a snapshot is taken.
 *
 * Three points, spread across the middle and late season. One point would fit the weights to a
 * single snapshot whose remaining schedule is 154 games long, and would tell us nothing about
 * whether a term's usefulness changes as the season resolves. Early is where playoff probability
 * should matter most; late is where it has largely already been revealed by the record.
 */
const SNAPSHOT_AT = [55, 85, 115];

/** Below this t-statistic a coefficient is reported as indistinguishable from zero. */
const T_FLOOR = 2.0;

/** A term with no measurable edge ships here rather than at its fitted value. */
const WEIGHT_FLOOR = 0.05;

const YEAR = 2026;

interface Observation {
  replicate: number;
  gamesPlayed: number;
  teamId: string;
  /** z-scores, one per TEAM_VALUE_TERMS entry. */
  z: number[];
  /** What the club actually finished with. Filled in once the season finishes. */
  realisedWins: number;
  /** False until the season is over and the target has been read off. */
  resolved: boolean;
}

const measure = (values: number[]): { mean: number; sd: number } => {
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length);
  return { mean, sd: Math.sqrt(variance) };
};

const main = async (): Promise<void> => {
  const replicates = Number(process.argv[2] ?? 6);
  const mcTrials = Number(process.argv[3] ?? 400);
  const started = Date.now();

  const observations: Observation[] = [];
  const perTermSpread = new Map<TeamValueTerm, number[]>();

  for (let rep = 0; rep < replicates; rep += 1) {
    const universe = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: YEAR,
      seed: 4242 + rep * 977,
      effectiveDate: `${YEAR}-12-15`,
    }).playerState;

    let teams: Team[] = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      universe,
      YEAR,
    );
    const manager = new SimulationManager({
      teams,
      games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
      playerState: universe,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(YEAR),
    });

    // Snapshots are keyed by games played per club, not by date, so the tool does not depend on
    // the calendar layout of the schedule.
    const pending = new Set(SNAPSHOT_AT);
    let state: LeaguePlayerState = universe;
    let games: Game[] = [];
    let guard = 0;

    while (pending.size > 0 && guard < 400) {
      guard += 1;
      const r = await manager.run({ scope: 'day' });
      teams = r.teams;
      games = r.games;
      state = r.playerState;

      const completed = games.filter((g) => g.status === 'completed' && g.phase === 'regular_season');
      /*
        Games per club is completed games x 2 teams each, over the club count. The first version
        wrote `completed.length / 2 / teams.length`, which is the correct numerator DIVIDED BY TWO --
        it counted half a game per club. The threshold then sat beyond the end of a 154-game season
        and the loop silently collected zero observations, reporting "joint R2 NaN" rather than
        failing. A fit that cannot reach its own sample is a tool that must fail loudly, so the
        emptiness is now checked in `report` rather than passed through to a meaningless NaN.
       */
      const playedPerClub = (completed.length * 2) / teams.length;
      if (playedPerClub < Math.min(...pending)) continue;

      const at = Math.min(...pending);
      pending.delete(at);

      // -- the four predictors, measured exactly as production builds them --
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
      const consensusWinPctById = new Map(teams.map((t) => [
        t.id,
        weightedConsensus((profile) => reads.scores[profile.id]?.get(t.id) ?? 0.5),
      ]));
      const strength = getTeamRosterStrength(teams, state, YEAR);
      const surplusById = new Map(teams.map((t) => [t.id, getTeamStrengthEdge(t, strength)]));

      const played = completed;
      const remaining = games.filter((g) => g.status !== 'completed' && g.phase === 'regular_season');
      const odds = playoffMonteCarlo({
        teams,
        playedGames: played,
        remainingGames: remaining,
        settings: DEFAULT_SETTINGS,
        trials: mcTrials,
        seed: 9000 + rep * 31 + at,
      });
      const playoffProbabilityById = new Map(odds.odds.map((o) => [o.teamId, o.championship]));

      const inputs: TeamValueInput[] = buildValueInputs({
        teamIds: teams.map((t) => t.id),
        consensusWinPctById,
        surplusById,
        playoffProbabilityById,
        games: played,
      });

      /*
        Standardise WITHIN THE SNAPSHOT, which is what `measureLeague` does in production. Doing it
        across the pooled sample instead would let one season's unusually tight field compress the
        z-scores of another, and the weights would be fitted against a normalisation production
        never applies.
      */
      const zOf = (term: TeamValueTerm): number[] => {
        const col = inputs.map((i) => i[term]);
        const { mean, sd } = measure(col);
        if (!perTermSpread.has(term)) perTermSpread.set(term, []);
        perTermSpread.get(term)?.push(sd);
        return sd > 0 ? col.map((v) => (v - mean) / sd) : col.map(() => 0);
      };
      const zColumns = new Map<TeamValueTerm, number[]>(TEAM_VALUE_TERMS.map((t) => [t, zOf(t)]));

      inputs.forEach((input, index) => {
        observations.push({
          replicate: rep,
          gamesPlayed: at,
          teamId: input.teamId,
          z: TEAM_VALUE_TERMS.map((term) => (zColumns.get(term) as number[])[index]),
          realisedWins: 0,
          resolved: false,
        });
      });
    }

    // -- now let the season finish, and read off what each club actually won --
    let tail = 0;
    while (tail < 400) {
      tail += 1;
      const r = await manager.run({ scope: 'day' });
      teams = r.teams;
      games = r.games;
      const unfinished = games.filter((g) => g.status !== 'completed').length;
      if (unfinished === 0) break;
    }
    const winsById = new Map(teams.map((t) => [t.id, t.wins]));
    observations.forEach((o) => {
      if (o.replicate !== rep || o.resolved) return;
      o.realisedWins = winsById.get(o.teamId) ?? 0;
      o.resolved = true;
    });

    /*
      THE TARGET MUST BE CENTRED WITHIN THE SNAPSHOT, AND THE FIRST VERSION FORGOT.

      The predictors are z-scored inside each snapshot, so each column has mean zero there. The
      target was raw win total, which averages about 81 wins. The regression therefore had no
      intercept and was trying to explain wins around zero: residuals came out around 78 wins, the
      joint R-squared came out at MINUS THIRTY-SIX, and the tool cheerfully printed that.

      Two things were wrong with it, and only one of them is the arithmetic. A negative R-squared
      is at least a loud number -- but the tool reported it in a line that also said "residual SE
      78.857 wins", and printed a full weight table underneath, so it read as a result rather than
      as the failure it was.

      The fix is the right one conceptually, not just arithmetically: the valuation predicts a club's
      standing RELATIVE to its league, which is exactly what a centred target measures. Centring
      wins within the snapshot puts target and predictors on the same footing and is what
      production's intercept-free value function actually assumes.
    */
    for (const at of SNAPSHOT_AT) {
      const group = observations.filter((o) => o.replicate === rep && o.gamesPlayed === at);
      if (group.length === 0) continue;
      const mean = group.reduce((a, o) => a + o.realisedWins, 0) / group.length;
      group.forEach((o) => { o.realisedWins -= mean; });
    }
    process.stdout.write(`  replicate ${rep + 1}/${replicates} done, ${observations.length} observations, ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
  }

  await report(observations, replicates, mcTrials, started);
};

const report = async (
  observations: Observation[],
  replicates: number,
  mcTrials: number,
  started: number,
): Promise<void> => {
  const observations_ = observations.filter((o) => o.resolved);
  const y = observations_.map((o) => o.realisedWins);
  const k = TEAM_VALUE_TERMS.length;
  const n = observations_.length;

  /*
    AN EMPTY SAMPLE IS A BROKEN TOOL, NOT A RESULT.

    The first run of this fit printed "joint R2 NaN" and then four rows of "carries weight" off a
    set of NaN coefficients, because a snapshot threshold was unreachable and nothing complained.
    A regression with no observations is not a weak result, it is no result, and the one thing it
    must never do is reach a verdict. So this exits non-zero with an explanation.
   */
  if (observations_.length < TEAM_VALUE_TERMS.length * 4) {
    console.error(`\nTEAM VALUE WEIGHT FIT -- NO USABLE OBSERVATIONS\n`);
    console.error(`  collected ${observations_.length} observations, which is too few to fit ${TEAM_VALUE_TERMS.length} terms.`);
    console.error(`  snapshots requested at ${SNAPSHOT_AT.join(' / ')} games played per club.`);
    console.error('  Either the season finished before reaching the last snapshot, or the games-per-club');
    console.error('  arithmetic is wrong again. This is a tool failure and it will not print weights.\n');
    process.exitCode = 2;
    return;
  }

  /*
    AND A FIT THAT EXPLAINS NOTHING IS ALSO A TOOL FAILURE, NOT A RESULT.

    Added alongside the centring fix. A joint R-squared at or below zero means the model predicts
    final win totals worse than simply quoting the league average, and a tool that prints a weight
    table underneath such a number has dressed a failure up as a finding. It exits 2 instead.
   */
  const _probeSse = fitSse(observations_, TEAM_VALUE_TERMS.map((_, i) => i));
  const _yMean0 = observations_.reduce((a, o) => a + o.realisedWins, 0) / n;
  const _sst0 = observations_.reduce((a, o) => a + (o.realisedWins - _yMean0) ** 2, 0);
  const _probeR2 = 1 - _probeSse / _sst0;
  if (!Number.isFinite(_probeR2) || _probeR2 <= 0) {
    console.error('\nTEAM VALUE WEIGHT FIT -- THE MODEL EXPLAINS NOTHING\n');
    console.error(`  joint R2 is ${_probeR2.toFixed(4)} against the realised win totals.`);
    console.error('  A non-positive R-squared means these terms predict final win totals worse than');
    console.error('  quoting the league average, which is not a finding about the terms -- it is a');
    console.error('  fault in the harness. No weights will be printed.\n');
    process.exitCode = 2;
    return;
  }

  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  observations_.forEach((o) => {
    for (let i = 0; i < k; i += 1) {
      Xty[i] += o.z[i] * o.realisedWins;
      for (let j = 0; j < k; j += 1) XtX[i][j] += o.z[i] * o.z[j];
    }
  });
  const b = solve(XtX, Xty);

  /*
    THE SOLVER IS CHECKED BEFORE ITS OUTPUT IS BELIEVED.

    This is the guard for the failure the tool actually hit: a hand-rolled solve that returned NaN
    from a well-conditioned matrix, which produced "carries weight" verdicts on NaN coefficients
    and exited 0. Three things must hold before any weight is printed -- the solve must be
    finite, it must actually solve (A by x reproduces b), and the design matrix must not be
    singular. A regression whose linear algebra is broken has no result, only an absence.
   */
  if (!Number.isFinite(b.reduce((a, v) => a + v, 0)) || !residualsOk(XtX, b, Xty)) {
    console.error('\nTEAM VALUE WEIGHT FIT -- THE SOLVER FAILED\n');
    console.error(`  design matrix ${k}x${k} from ${n} observations could not be solved.`);
    console.error('  Either the normal equations are singular (the four terms are collinear) or the');
    console.error('  solver is wrong. Both are tool failures, and neither will print weights.\n');
    console.error('  X\'X diagonal: ' + XtX.map((row, i) => row[i].toFixed(3)).join(' '));
    console.error('  X\'y: ' + Xty.map((v) => v.toFixed(3)).join(' '));
    console.error('  solution: ' + b.map((v) => String(v)).join(' ') + '\n');
    process.exitCode = 2;
    return;
  }

  if (process.env.FIT_DEBUG) {
    console.log('\n  [debug] n =', n);
    console.log('  [debug] any NaN in z?', observations_.some((o) => o.z.some((v) => !Number.isFinite(v))));
    console.log('  [debug] any NaN in y?', y.some((v) => !Number.isFinite(v)));
    console.log('  [debug] Xty =', Xty.map((v) => v.toFixed(2)).join(' '));
    XtX.forEach((row, i) => console.log('  [debug] XtX[' + i + '] =', row.map((v) => v.toFixed(2)).join(' ')));
    console.log('  [debug] b =', b.map((v) => v.toFixed(6)).join(' '));
  }

  const yMean = y.reduce((a, v) => a + v, 0) / n;
  const sst = y.reduce((a, v) => a + (v - yMean) ** 2, 0);
  const sse = observations_.reduce((acc, o) => acc + (o.realisedWins - o.z.reduce((s, zi, i) => s + zi * b[i], 0)) ** 2, 0);
  const r2 = 1 - sse / sst;

  // Residual variance, and the coefficient covariance matrix (sigma^2 * (X'X)^-1).
  const df = n - k;
  const sigma2 = sse / df;
  const XtXinv = invert(XtX);
  const se = XtXinv.map((row, i) => Math.sqrt(sigma2 * row[i]));

  // Partial R-squared: what each term adds ON TOP of the other three.
  const partials = TEAM_VALUE_TERMS.map((_, i) => {
    const others = TEAM_VALUE_TERMS.map((_, j) => j).filter((j) => j !== i);
    const sseReduced = fitSse(observations_, others);
    return { term: TEAM_VALUE_TERMS[i], partialR2: (sseReduced - sse) / sseReduced };
  });

  console.log('\nTEAM VALUE WEIGHT FIT\n');
  console.log(`  target          realised season win total`);
  console.log(`  replicates      ${replicates} independent seasons, snapshots at ${SNAPSHOT_AT.join(' / ')} games played`);
  console.log(`  observations    ${n} (replicate x snapshot x club)`);
  console.log(`  MC trials       ${mcTrials} per snapshot`);
  console.log(`  joint R2        ${r2.toFixed(4)}   ${(r2 * 100).toFixed(1)}% of the variance in final win totals`);
  console.log(`  residual SE     ${Math.sqrt(sigma2).toFixed(3)} wins\n`);

  console.log('  term                     coefficient      SE       t     partial R2   verdict');
  const rows = TEAM_VALUE_TERMS.map((term, i) => {
    const t = Math.abs(b[i]) / (se[i] || 1e-12);
    const partial = partials.find((p) => p.term === term);
    const verdict = b[i] <= 0
      ? 'NEGATIVE -- ships at floor'
      : t < T_FLOOR ? 'no measurable edge -- ships at floor' : 'carries weight';
    return { term, b: b[i], se: se[i], t, partial: partial?.partialR2 ?? 0, verdict };
  });
  rows.sort((a, c) => c.partial - a.partial);
  rows.forEach((r) => {
    console.log(`  ${r.term.padEnd(22)} ${r.b.toFixed(4).padStart(9)} ${r.se.toFixed(4).padStart(8)} `
      + `${r.t.toFixed(2).padStart(7)} ${(r.partial * 100).toFixed(2).padStart(10)}%   ${r.verdict}`);
  });

  /*
    Weights: floor anything with no measurable edge, then scale the survivors so the WHOLE vector
    sums to 1.

    The first version divided each surviving coefficient by `keptSum + flooredSum` and then added
    WEIGHT_FLOOR to the floored terms as literal values. The floor was in the denominator AND in the
    numerator, so the vector summed to 1.089 -- and `checkHxseIndex` gates the sum at 1.0, so the
    first fitted weights would have failed the check that exists precisely to catch this. The gate
    caught it before it shipped, which is the whole reason it is there.

    Solved properly: with `s` the scale on the survivors and the floors held at WEIGHT_FLOOR,
    `s * keptSum + flooredSum = 1`, so `s = (1 - flooredSum) / keptSum`.
  */
  const flooredTerms = rows.filter((r) => r.verdict !== 'carries weight').map((r) => r.term);
  const keptTerms = rows.filter((r) => r.verdict === 'carries weight').map((r) => r.term);
  const raw = new Map(rows.map((r) => [r.term, r.b]));
  const keptSum = keptTerms.reduce((a, term) => a + (raw.get(term) as number), 0);
  const flooredSum = WEIGHT_FLOOR * flooredTerms.length;
  const scale = keptSum > 0 ? (1 - flooredSum) / keptSum : 0;
  const weights = new Map<TeamValueTerm, number>();
  keptTerms.forEach((term) => weights.set(term, (raw.get(term) as number) * scale));
  flooredTerms.forEach((term) => weights.set(term, WEIGHT_FLOOR));

  const total = TEAM_VALUE_TERMS.reduce((a, t) => a + (weights.get(t) as number), 0);
  console.log('\n  SHIPPED WEIGHTS (floored where the fit found no edge, scaled to sum to 1)');
  console.log('  ' + TEAM_VALUE_TERMS.map((t) => {
    const w = weights.get(t) as number;
    const fitted = (raw.get(t) as number) * scale;
    return `${t} ${w.toFixed(4)}${w === WEIGHT_FLOOR ? '   (floor; fitted ' + fitted.toFixed(4) + ')' : ''}`;
  }).join('\n  '));
  console.log(`  sum ${total.toFixed(9)}`);
  if (Math.abs(total - 1) > 1e-9) {
    console.error(`\n  WEIGHTS DO NOT SUM TO 1 (they sum to ${total}). checkHxseIndex gates this at 1.`);
    console.error('  Refusing to print a weight table that would fail its own check.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  PAST WEIGHTS');
  console.log('  rosterSurplus 0.3000, expectedWinPct 0.3400, playoffProbability 0.2400, momentum 0.1200');
  console.log('    (placeholders reasoned before any measurement existed -- kept here so the fit is');
  console.log('     auditable against what it replaced, not hidden)');

  console.log(`\n  elapsed ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
};

const fitSse = (observations: Observation[], indices: number[]): number => {
  const k = indices.length;
  const XtX: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty: number[] = new Array(k).fill(0);
  observations.forEach((o) => {
    indices.forEach((i, a) => {
      Xty[a] += o.z[i] * o.realisedWins;
      indices.forEach((j, b2) => { XtX[a][b2] += o.z[i] * o.z[j]; });
    });
  });
  const coef = solve(XtX, Xty);
  return observations.reduce((acc, o) => {
    let pred = 0;
    indices.forEach((i, a) => { pred += o.z[i] * coef[a]; });
    return acc + (o.realisedWins - pred) ** 2;
  }, 0);
};

/**
 * Gaussian elimination with partial pivoting, by explicit loop.
 *
 * Written as an explicit loop rather than a `map` over the rows, and that is not a style choice.
 * The first version closed with `M.map((row, i) => row[n] / row[i][i] === 0 ? 0 : row[n] / row[i][i])`,
 * which under esbuild returned NaN for a matrix whose elimination had already produced a correct
 * diagonal. The fit printed "joint R2 NaN" and four rows of "carries weight" off NaN coefficients
 * and exited 0. A hand-rolled solver that silently yields NaN is worse than no solver, so:
 *
 *   - the elimination is a plain indexed loop, which is unambiguous;
 *   - a pivot below 1e-12 returns NaN rather than an infinity, and `report` then refuses to print
 *     weights at all instead of printing nonsense;
 *   - `residualsOk` re-multiplies A by the solution and checks it reproduces b, so a solver that
 *     is wrong in any way fails loudly.
 *
 * k is 4, so clarity beats speed.
 */
const solve = (A: number[][], bvec: number[]): number[] => {
  const n = A.length;
  const M = A.map((row, i) => [...row, bvec[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    const swap = M[col];
    M[col] = M[pivot];
    M[pivot] = swap;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col] / M[pivot][col];
      for (let c = col; c <= n; c += 1) {
        M[r][c] -= factor * M[pivot][c];
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const diag = M[i][i];
    if (Math.abs(diag) < 1e-12) return new Array(n).fill(Number.NaN);
    out.push(M[i][n] / diag);
  }
  return out;
};

/** A by x should reproduce b. If it does not, the fit is garbage and must not report weights. */
const residualsOk = (A: number[][], x: number[], b: number[]): boolean => {
  const scale = Math.max(1, ...b.map(Math.abs));
  return A.every((row, i) => Math.abs(row.reduce((s, v, j) => s + v * x[j], 0) - b[i]) < 1e-6 * scale);
};

const invert = (A: number[][]): number[][] => {
  const n = A.length;
  const columns: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const unit = new Array<number>(n).fill(0);
    unit[i] = 1;
    columns.push(solve(A, unit));
  }
  // `solve(A, unit_i)` yields column i of the inverse; transposing gives the inverse itself.
  const inv: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    inv.push(columns.map((column) => column[i]));
  }
  return inv;
};

void main();
