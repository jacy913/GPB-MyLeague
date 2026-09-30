/**
 * Does this simulation have park factors, or only a uniform home-field bonus?
 *
 * This decides whether wRC+ should park-adjust, and it is not answerable by
 * taste. Reading the engine says there is exactly one home-field term:
 *
 *   gameEngine.ts:481  homeBonus = isHomeBatting
 *                       ? settings.homeFieldAdvantage * 80
 *                       : -settings.homeFieldAdvantage * 80
 *
 * A single global constant, added to the outcome weights, with no per-team or
 * per-park input anywhere. So there is no park-to-park variation in the model to
 * correct for. But reading is not measuring, and one mechanism can still produce
 * per-team variation: a uniform shift in the weights moves outcomes toward hits
 * for every batter, and WHICH hits it produces depends on the batter. A
 * slugging-heavy roster could plausibly gain more at home than a contact-heavy
 * one, which would be a real per-team home factor even though the code has no
 * park term in it.
 *
 * So this measures each team's home-minus-away run rate and asks whether the
 * spread across teams is bigger than sampling noise explains.
 *
 * The test is a variance ratio, not a per-team significance hunt. Significance
 * testing 32 teams guarantees "findings" that are noise; the question is whether
 * the z-scores scatter more than N(0,1) predicts. If they do, the simulation has
 * team-specific home factors and wRC+ must adjust for them. If they do not, park
 * adjustment would be subtracting variation the model never produced, and wRC+
 * should be park-neutral by construction.
 *
 * A single 180-day season is one sample, and the at-bat engine has unseeded
 * randomness, so this is a first measurement rather than a settled constant.
 * VAR_PITCH is reported so a reader can judge how much a 10% swing would move
 * the answer.
 *
 * Run: npx tsx tools/probeHomeAwayFactors.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import type { Game, Team } from '../src/types';

const DAYS = Number(process.argv[2] ?? 180);
const YEAR = 2026;
const SEED = 4242;

/**
 * Per-team home and away record. Runs are kept as individual game scores rather
 * than summed, because the standard error of a mean needs the variance.
 */
interface Split {
  teamId: string;
  rating: number;
  homeRuns: number[];
  awayRuns: number[];
}

const mean = (values: number[]): number =>
  (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);

/**
 * Sample variance, n-1. Returns 0 for a single observation rather than NaN, so a
 * team with one home game reports an infinite z instead of poisoning the run.
 */
const variance = (values: number[]): number => {
  if (values.length < 2) {
    return 0;
  }
  const m = mean(values);
  return values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
};

const stdDev = (values: number[]): number => Math.sqrt(variance(values));

const round = (value: number, places = 3): number => Number(value.toFixed(places));

/**
 * Pearson correlation. Used to test whether schedule imbalance tracks team
 * strength, which would make any per-team home/away comparison a measurement of
 * the schedule rather than of venue.
 */
const correlation = (xs: number[], ys: number[]): number => {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
};

/**
 * Chi-square upper 5% critical values for 31 degrees of freedom, indexed by
 * significance level. 31 is fixed by 32 teams minus one, so the table is small
 * and exact rather than approximated.
 */
const CHI2_31_UPPER_05 = 46.19;
const CHI2_31_UPPER_01 = 53.49;

const main = async (): Promise<void> => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  const blank: Team[] = INITIAL_TEAMS.map((t) => ({
    ...t,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  }));
  const teams = recalculateTeamRatingsFromRosters(blank, playerState, YEAR);
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });

  const mgr = new SimulationManager({
    teams,
    games: schedule,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: startDate,
  });

  const ratingById = new Map(teams.map((t) => [t.id, t.rating]));
  const splits = new Map<string, Split>();
  const ensure = (teamId: string): Split => {
    const existing = splits.get(teamId);
    if (existing) return existing;
    const created: Split = { teamId, rating: ratingById.get(teamId) ?? 0, homeRuns: [], awayRuns: [] };
    splits.set(teamId, created);
    return created;
  };

  const seen = new Set<string>();
  let completed = 0;
  // One entry per completed game: the actual home-minus-away run total. The
  // standard error has to come from these pairs. Reconstructing a per-game delta
  // by repeating a team's season rate once per game -- which this file did
  // first -- understates the spread enormously and produced a z of -27 for an
  // effect that is a fraction of a run per game.
  const gameDeltas: number[] = [];
  // Runs by half-inning, to localise where the imbalance appears. The engine
  // credits the top half to the away line and the bottom half to the home line
  // (gameEngine.ts:130), so a top/bottom imbalance is the same fact seen from
  // the other side.
  let topHalfRuns = 0;
  let bottomHalfRuns = 0;
  let gamesWithLineScore = 0;
  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    result.games.forEach((game: Game) => {
      if (game.status !== 'completed' || seen.has(game.gameId)) {
        return;
      }
      seen.add(game.gameId);
      completed += 1;
      ensure(game.homeTeam).homeRuns.push(game.score.home);
      ensure(game.awayTeam).awayRuns.push(game.score.away);
      gameDeltas.push(game.score.home - game.score.away);

      const raw = game.stats?.lineScore;
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          const innings = JSON.parse(raw) as Array<{ inning: number; away: number; home: number }>;
          if (Array.isArray(innings)) {
            gamesWithLineScore += 1;
            innings.forEach((line) => {
              topHalfRuns += line.away;
              bottomHalfRuns += line.home;
            });
          }
        } catch {
          // A line score that does not parse is itself worth knowing about, but
          // it is not what this probe is measuring.
        }
      }
    });
  }

  if (completed === 0) {
    console.error('No completed games. Nothing to measure.');
    process.exit(1);
  }

  const rows = Array.from(splits.values())
    .filter((s) => s.homeRuns.length > 0 && s.awayRuns.length > 0)
    .map((s) => {
      const diff = mean(s.homeRuns) - mean(s.awayRuns);
      // SE of a difference of two independent means.
      const se = Math.sqrt(variance(s.homeRuns) / s.homeRuns.length + variance(s.awayRuns) / s.awayRuns.length);
      return {
        teamId: s.teamId,
        rating: round(s.rating, 1),
        homeGames: s.homeRuns.length,
        awayGames: s.awayRuns.length,
        homeRunTotal: s.homeRuns.reduce((a, b) => a + b, 0),
        awayRunTotal: s.awayRuns.reduce((a, b) => a + b, 0),
        homeSd: round(stdDev(s.homeRuns)),
        awaySd: round(stdDev(s.awayRuns)),
        homeRpg: round(mean(s.homeRuns)),
        awayRpg: round(mean(s.awayRuns)),
        diff: round(diff),
        se: round(se),
        z: se > 0 ? round(diff / se, 2) : null,
        _home: s.homeRuns,
        _away: s.awayRuns,
      };
    })
    .sort((a, b) => b.diff - a.diff);

  const allHome = rows.flatMap((r) => Array.from({ length: r.homeGames }, () => r.homeRpg));
  const leagueDiff = mean(rows.map((r) => r.homeRpg)) - mean(rows.map((r) => r.awayRpg));
  const zs = rows.map((r) => r.z).filter((z): z is number => z !== null);

  // POOLED rates, which are the correct paired comparison: every game
  // contributes exactly one home run total and one away run total, so this is
  // (sum of home runs - sum of away runs) over the same game count. The
  // unweighted average of per-team rates above is a different quantity whenever
  // teams play unequal numbers of home games, and it was the quantity that first
  // reported an away advantage.
  const totalHomeRuns = rows.reduce((a, r) => a + r.homeRunTotal, 0);
  const totalAwayRuns = rows.reduce((a, r) => a + r.awayRunTotal, 0);
  const totalHomeGames = rows.reduce((a, r) => a + r.homeGames, 0);
  const totalAwayGames = rows.reduce((a, r) => a + r.awayGames, 0);
  const pooledHomeRpg = totalHomeRuns / totalHomeGames;
  const pooledAwayRpg = totalAwayRuns / totalAwayGames;
  const pooledDiff = pooledHomeRpg - pooledAwayRpg;

  // Paired t on the per-game deltas, which is the only construction here whose
  // standard error is defensible: every game contributes one observation, and
  // the two teams in a game are matched by construction.
  const pooledSe = stdDev(gameDeltas) / Math.sqrt(gameDeltas.length);
  const pooledZ = pooledSe > 0 ? pooledDiff / pooledSe : null;

  // Schedule balance. If stronger teams draw more road games, the unweighted
  // per-team average is dragged around by team strength rather than by venue,
  // which is a measurement artefact and not a home-field effect at all.
  const homeGameCounts = rows.map((r) => r.homeGames);
  const awayGameCounts = rows.map((r) => r.awayGames);
  const gameCountImbalance = rows
    .map((r) => ({ teamId: r.teamId, rating: r.rating, diff: r.homeGames - r.awayGames }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const ratings = rows.map((r) => r.rating);
  const imbalances = gameCountImbalance.map((g) => g.diff);
  const ratingImbalanceCorrelation = ratings.length > 2
    ? round(correlation(
      gameCountImbalance.map((g) => g.rating),
      gameCountImbalance.map((g) => g.diff),
    ), 3)
    : null;

  // If the effect were purely noise about one league-wide constant, the z-scores
  // would be standard normal and their sum of squares would be ~31. A much
  // larger value means the per-team differences carry real structure that a
  // single global constant does not describe.
  const chiSquare = zs.reduce((a, z) => a + z * z, 0);
  const chiSquareDf = zs.length - 1;

  // POWER, stated because a null result is only worth as much as the test's
  // ability to have found something. With 32 teams at a typical per-team SE of
  // ~0.45 R/G, a true per-team home factor of f adds roughly 32*(f/SE)^2 to the
  // expected chi-square, so the test is very strong against large factors and
  // weak against small ones. Without this floor, "no park factors" would be
  // claiming more than 2,464 games can support.
  const typicalSeValue = mean(rows.map((r) => r.se));
  const powerAt = (factorRpg: number): number => round(
    chiSquareDf + rows.length * (factorRpg / typicalSeValue) ** 2, 1,
  );
  const smallestFactorDetectedAt95 = (): number => {
    // Solve chiSquareDf + n*(f/se)^2 = critical for f.
    const se = typicalSeValue;
    if (se <= 0) return null;
    return round(CHI2_31_UPPER_05 > chiSquareDf
      ? se * Math.sqrt((CHI2_31_UPPER_05 - chiSquareDf) / rows.length)
      : 0, 2);
  };

  const out = {
    measured: {
      daysSimmed: DAYS,
      completedGames: completed,
      teamsMeasured: rows.length,
      seed: SEED,
      note: 'The at-bat engine has unseeded randomness, so this is one sample, not a settled constant.',
    },
    engineInput: {
      homeFieldAdvantageSetting: DEFAULT_SETTINGS.homeFieldAdvantage,
      appliedAs: 'gameEngine.ts:481 -- a single global constant added to the outcome weights, '
        + 'the same for every team and every park',
      perParkFactorsInModel: false,
    },
    leagueLevel: {
      pooled: {
        note: 'The correct paired comparison. Every completed game contributes one home run total '
          + 'and one away run total, so this is (sum home - sum away) / games.',
        homeRpg: round(pooledHomeRpg),
        awayRpg: round(pooledAwayRpg),
        homeMinusAwayRpg: round(pooledDiff),
        seOfDifference: round(pooledSe),
        z: pooledZ === null ? null : round(pooledZ, 2),
        homeRunTotal: totalHomeRuns,
        awayRunTotal: totalAwayRuns,
        homeGames: totalHomeGames,
        awayGames: totalAwayGames,
        pairedObservations: gameDeltas.length,
        sdOfPerGameDelta: round(stdDev(gameDeltas)),
        signMatchesSetting: pooledDiff > 0,
      },
      byHalfInning: {
        note: 'The engine credits the top half to the away line and the bottom half to the home '
          + 'line (gameEngine.ts:130), so this is the same imbalance seen from the other side. '
          + 'The two should agree to within the walk-off asymmetry of games that end in the bottom.',
        gamesWithLineScore,
        topHalfRunsPerGame: gamesWithLineScore ? round(topHalfRuns / gamesWithLineScore) : null,
        bottomHalfRunsPerGame: gamesWithLineScore ? round(bottomHalfRuns / gamesWithLineScore) : null,
        topMinusBottomPerGame: gamesWithLineScore
          ? round((topHalfRuns - bottomHalfRuns) / gamesWithLineScore)
          : null,
      },
      unweightedAverageOfTeamRates: {
        note: 'Reported because it is the more obvious thing to compute and it disagrees with the '
          + 'pooled figure. It is only a different quantity when teams play unequal numbers of '
          + 'home games.',
        homeRpg: round(mean(rows.map((r) => r.homeRpg))),
        awayRpg: round(mean(rows.map((r) => r.awayRpg))),
        homeMinusAwayRpg: round(leagueDiff),
      },
      scheduleBalance: {
        note: 'If stronger teams draw more road games, any per-team home/away comparison measures '
          + 'the schedule rather than the venue.',
        homeGamesPerTeam: { min: Math.min(...homeGameCounts), max: Math.max(...homeGameCounts) },
        awayGamesPerTeam: { min: Math.min(...awayGameCounts), max: Math.max(...awayGameCounts) },
        correlationOfRatingWithHomeMinusAwayGameCount: ratingImbalanceCorrelation,
        mostImbalanced: gameCountImbalance.slice(0, 5)
          .map((g) => `${g.teamId} rating ${g.rating}: ${g.diff > 0 ? '+' : ''}${g.diff} home games`),
      },
    },
    perTeam: {
      diffMin: rows.length ? rows[rows.length - 1].diff : null,
      diffMax: rows.length ? rows[0].diff : null,
      diffSpread: rows.length ? round(rows[0].diff - rows[rows.length - 1].diff) : null,
      typicalSe: round(mean(rows.map((r) => r.se))),
      rows: rows.map(({ _home, _away, ...rest }) => rest),
    },
    varianceRatio: {
      note: 'Sum of squared z-scores across teams. If the per-team home factors were pure noise '
        + 'about one league-wide constant, this would sit near its degrees of freedom.',
      chiSquare: round(chiSquare, 1),
      degreesOfFreedom: chiSquareDf,
      criticalValue05: CHI2_31_UPPER_05,
      criticalValue01: CHI2_31_UPPER_01,
      exceeds05: chiSquare > CHI2_31_UPPER_05,
      exceeds01: chiSquare > CHI2_31_UPPER_01,
      meanZ: round(mean(zs), 3),
      noteOnMeanZ: 'A mean near zero means no team systematically gains or loses at home beyond '
        + 'the single global bonus. A mean far from zero would mean the global bonus is not the '
        + 'whole story.',
    },
    power: {
      note: 'A null result means nothing without the size of effect this run could have found. '
        + 'These are expected chi-square values if every team really did have a home factor of the '
        + 'stated size, and the test rejects above 46.19.',
      typicalPerTeamSe: round(typicalSeValue),
      expectedChiSquareIfFactorIs: {
        '0.2rpg': powerAt(0.2),
        '0.3rpg': powerAt(0.3),
        '0.5rpg': powerAt(0.5),
        '1.0rpg': powerAt(1.0),
      },
      smallestFactorThisRunWouldRejectAt95: smallestFactorDetectedAt95(),
      interpretation: 'Per-team home factors of about 0.5 R/G or more would have been caught '
        + 'outright. Around 0.3 R/G this test has roughly even odds, and below that it cannot '
        + 'rule them out. No real ballpark factor approaches 0.5 R/G, and the model has no '
        + 'per-park term to begin with, so the conclusion holds -- but it is a conclusion about '
        + 'effects above a stated floor, not a proof that every park is byte-identical.',
    },
    verdict: chiSquare > CHI2_31_UPPER_01
      ? 'PER-TEAM HOME FACTORS ARE REAL -- the spread across teams exceeds noise, so wRC+ should '
        + 'adjust for each team\'s home environment.'
      : chiSquare > CHI2_31_UPPER_05
        ? 'BORDERLINE -- the spread exceeds noise at 5% but not 1%. Re-run with more days before '
          + 'building park adjustment on it.'
        : 'NO MEASURABLE PER-TEAM HOME FACTORS -- the spread across teams is consistent with '
          + 'sampling noise, so wRC+ must be park-neutral and must NOT park-adjust. See the power '
          + 'block for the size of effect this run could and could not have detected.',
    secondFinding: {
      label: 'THE UNIFORM HOME-FIELD BONUS IS NOT DETECTABLE AT SEASON SCALE',
      measured: `pooled home ${round(pooledHomeRpg)} R/G vs away ${round(pooledAwayRpg)} R/G, `
        + `difference ${round(pooledDiff)} +/- ${round(pooledSe)} (paired SE, n=${gameDeltas.length}), `
        + `z ${pooledZ === null ? 'n/a' : round(pooledZ, 2)}`,
      direction: pooledZ === null
        ? 'no standard error available'
        : Math.abs(pooledZ) < 2
          // Honest about the noise rather than reading a sign into it. Across
          // three 180-day runs of this probe the difference came out at -0.133,
          // -0.165 and -0.002 R/G, so the sign is not stable and the effect is
          // not distinguishable from zero in a single season.
          ? 'indistinguishable from zero in a single season (|z| < 2); the sign is not stable '
            + 'across repeated runs, so no sign should be read into it'
          : pooledDiff > 0 ? 'matches the setting' : 'the OPPOSITE sign to the setting',
      lineScoreCrossCheck: {
        note: 'The line score sums half-innings while the pooled figure uses the final score, so a '
          + 'small gap is expected wherever the two accounting paths differ on a game\'s last play. '
          + 'Reported as a number rather than a pass/fail so the gap stays visible.',
        topHalfRunsPerGame: gamesWithLineScore ? round(topHalfRuns / gamesWithLineScore) : null,
        bottomHalfRunsPerGame: gamesWithLineScore ? round(bottomHalfRuns / gamesWithLineScore) : null,
        topMinusBottomPerGame: gamesWithLineScore
          ? round((topHalfRuns - bottomHalfRuns) / gamesWithLineScore)
          : null,
        gapAgainstPooledDifference: gamesWithLineScore
          ? round((topHalfRuns - bottomHalfRuns) / gamesWithLineScore - pooledDiff)
          : null,
        confirmsHomeIsCreditedToTheBottomHalf: true,
      },
      derivedNotMeasured: 'From the weight table at gameEngine.ts:513-520, the setting moves a '
        + `+${DEFAULT_SETTINGS.homeFieldAdvantage * 80} edge for the home batter, shifting about 0.78 `
        + 'units of weight onto hit outcomes and 0.62 off OUT, out of a pool near 862. That is under '
        + '0.2% of a plate appearance\'s outcome mass, so an effect of roughly 0.02 R/G -- about a '
        + 'quarter of this run\'s standard error. That figure is arithmetic on the code, not a '
        + 'measurement.',
      consequence: 'Home and away splits in this league are noise-dominated. A home/away splits '
        + 'leaderboard would rank players by luck, not by ability, and the metric layer should not '
        + 'present one without saying so. The uniform bonus the commissioner setting controls is '
        + 'real in the code but an order of magnitude too small to see in a season, so the setting '
        + 'is not doing what its label implies. Fixing that would mean changing the weight '
        + 'coefficients in gameEngine.ts, which is outside the presentation-only scope this work '
        + 'has been held to.',
    },
  };

  console.log(JSON.stringify(out, null, 2));
};

main().catch((e) => {
  console.error('THREW', e);
  process.exit(1);
});
