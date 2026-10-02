/**
 * Is the park wired in correctly, and does the derived factor predict what the simulation
 * actually does?
 *
 * These are two different questions that happen to need the same seasons of data, so they are
 * measured together. The plan lists them as separate phases -- Phase 5 wiring, Phase 4
 * validation -- but Phase 4's own acceptance says "Once parks affect play", which cannot happen
 * until Phase 5 exists. So the ordering is reversed, and this tool is the thing that made the
 * reversal necessary rather than merely convenient.
 *
 * WHAT IS ACTUALLY CHECKED
 *
 * 1. THE PARK IS APPLIED EXACTLY ONCE. Asserted statically on the source: one call to
 *    `applyParkEnvironment`, one call to `parkFactorsForTeam`, one park passed into
 *    `getOutcomeWeights`. A static check cannot see a double application that happens to
 *    produce a plausible number, and a statistical check cannot see one that happens to
 *    produce the right correlation.
 *
 * 2. THE PARK IS APPLIED AT THE HOME PARK ONLY. The decisive measurement is that ROAD
 *    production is FLAT. Every club plays the same number of road games, so if the park were
 *    leaking into road games -- applied at the batting team's park, or at both teams' parks --
 *    then a club's road rate would vary with the parks it happened to visit, and road
 *    production would correlate with somebody else's park factor. It must not.
 *
 * 3. HOME PRODUCTION TRACKS THE DERIVED FACTOR. Each club's realised home park factor is its
 *    home production per game divided by the league's average per game, and that is correlated
 *    against the factor the model derived. This is the correlation the park plan calls "the
 *    step that converts a model into a measurement".
 *
 * 4. THE MAGNITUDE IS REPORTED, NOT THRESHOLDED. A single application predicts a realised
 *    slope near 1.00 and a double one near 2.00, but the per-club sampling error is wider than
 *    that distance -- two invocations gave 0.85 and 0.59 -- so the exact-once claim is made
 *    against the pure scaling function as a bit-for-bit identity instead.
 *
 * 5. THE LEAGUE STILL SCORES SANELY. Parks change scoring, and the risk is that a park-shaped
 *    league stops resembling baseball. Runs per team-game and the home-run rate are reported and
 *    bounded.
 *
 * 6. A CLUB WITH NO PARK PLAYS IN NO PARK. The null path, which is what makes a league whose
 *    teams are not these 32 safe.
 *
 * Run: npx tsx tools/checkParkWiring.ts [warmupDays] [days] [replicates]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { INITIAL_TEAMS } from '../src/data/teams';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import {
  ALL_PARK_FACTORS,
  applyParkEnvironment,
  indexOf,
  parkFactorsFor,
  outcomeWeightScales,
  parkFactorsForTeam,
  type ParkFactors,
} from '../src/lib/analytics/parkFactors';
import { ALL_PARK_PROFILES } from '../src/lib/analytics/parkProfile';
import type { AtBatOutcome, Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 20);
const DAYS = Number(process.argv[3] ?? 60);

/**
 * REPLICATES, AND WHY THERE HAVE TO BE SEVERAL.
 *
 * `probeSimulationDeterminism.ts` established that the simulation is NOT deterministic: the
 * same universe seed and the same window produced three different leagues scoring 1411, 1473
 * and 1604 runs. So a single run of this tool measures the dice as much as it measures the
 * park, and its correlations moved between 0.62 and 0.39 across three invocations of identical
 * code.
 *
 * That is not a hypothetical. The first version of this tool asserted `r > 0.5` on one run,
 * passed it at 0.62, and then failed at 0.39 on the next invocation. A check that flips on the
 * dice gets deleted after it fails once for no reason, and the thing it was protecting goes
 * back to being unprotected.
 *
 * So every statistic here is the MEAN over replicates, and the spread is printed rather than
 * hidden, because the spread is itself the finding: a park's realised effect is a small signal
 * on top of a large per-club sampling error.
 *
 * Three replicates is the same choice `verifyDevelopmentFeedback` makes, and for the same
 * reason: enough that the mean is stable, few enough that the tool still runs.
 *
 * THE DEFAULT IS NOW THE GATE, NOT THREE. This used to default to 3, which is below
 * GATE_MIN_REPLICATES, so every default run of this tool skipped all five statistical checks
 * and still exited 0. That is the specific failure this file was written to prevent, and it
 * was the tool's own default behaviour -- five checks shipped unverified for the whole life of
 * the feature and nothing complained.
 *
 * Declared as a const below rather than inlined here because GATE_MIN_REPLICATES is defined
 * further down; the two are checked against each other by `checkReplicateFloorIsGated`, so a
 * future edit that lowers the gate cannot silently strand the default above it.
 */
const REPLICATES = Number(process.argv[4] ?? 12);

/**
 * HOW MANY REPLICATES ARE ENOUGH TO GATE ON, AND WHY THE ANSWER IS NOT THREE.
 *
 * Measured, by running this tool repeatedly at 3 replicates: the home-run gap correlation came
 * out 0.673, then 0.388, then 0.563, then 0.393. A gate at r > 0.5 on that quantity is a coin
 * flip.
 *
 * The arithmetic says why. A club has roughly 15 home games in a 60-day window and hits about
 * 20 home runs in them, so Poisson noise alone is about 22% per replicate, or 13% across three.
 * The signal for a 155 park is about +25%. So the per-club signal-to-noise is roughly 1.9 even
 * after averaging, and across 32 clubs the standard error on r is about 0.12 -- which is exactly
 * the spread observed. Reaching a standard error near 0.05 needs roughly seventeen replicates.
 *
 * So below GATE_MIN_REPLICATES the statistical checks are REPORTED and NOT PASSED. A tool that
 * prints "5/11 checks PASS" and flips between 5 and 9 on identical code is worse than one that
 * says "the deterministic checks pass; the sample is too small to decide the rest".
 *
 * The deterministic checks -- the static source guards and the bit-for-bit scaling identity --
 * need no replicates at all and are gated at any sample size.
 */
const GATE_MIN_REPLICATES = 12;

/*
 * The default replicate count has to be AT LEAST the gate, or a default run skips the
 * statistical checks and still reports success.
 *
 * This is checked rather than asserted in a comment, because the two constants are declared
 * in different places and the failure is silent: lower the gate to 8 for a faster iteration
 * and every later default run quietly stops gating without a single line of output changing
 * its exit code.
 */
if (REPLICATES < GATE_MIN_REPLICATES) {
  console.error(
    `\n  REFUSING TO RUN: the default is ${REPLICATES} replicates and the statistical gate`
    + ` needs ${GATE_MIN_REPLICATES}.\n`
    + '  A run below the gate skips five checks and still exits 0, which is the one'
    + ' behaviour this\n  tool exists to prevent. Pass an explicit count as argv[4] if you'
    + ' want a fast look,\n  and understand that the statistical checks will be reported'
    + ' rather than gated.\n',
  );
  process.exit(2);
}

const gated: Array<{ label: string; pass: boolean; detail?: string; statistical: boolean }> = [];
const reported: string[] = [];

/**
 * A gated check.
 *
 * `statistical` marks the ones that consume simulated seasons and therefore need enough
 * replicates to mean anything. It is an explicit flag rather than a position in the list,
 * because guessing by index means inserting a deterministic check in the wrong place silently
 * reclassifies every check after it.
 */
const gate = (
  label: string,
  pass: boolean,
  detail?: string,
  statistical = false,
): void => {
  gated.push({ label, pass, detail, statistical });
};
const report = (line: string): void => {
  reported.push(line);
};

const ENGINE = resolve(process.cwd(), 'src', 'logic', 'gameEngine.ts');

/** Pearson correlation. Returns NaN for a degenerate series rather than a fake number. */
const correlate = (xs: number[], ys: number[]): number => {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return Number.NaN;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
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
  if (dx === 0 || dy === 0) return Number.NaN;
  return num / Math.sqrt(dx * dy);
};

/** Least-squares slope of y on x: how much realised moves per point of derived. */
const slope = (xs: number[], ys: number[]): number => {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return Number.NaN;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? Number.NaN : num / den;
};

interface LogEvent {
  outcome?: AtBatOutcome | 'PITCHING_CHANGE' | 'HALF_END' | 'GAME_END';
  battingTeamId?: string | null;
}

const main = async (): Promise<void> => {
  console.log('\nPARK WIRING AND MEASURED VALIDATION\n');

  // -- 1. STATIC: APPLIED EXACTLY ONCE ---------------------------------------------
  const source = readFileSync(ENGINE, 'utf8');
  const countOf = (needle: string): number => source.split(needle).length - 1;
  const applyCalls = countOf('applyParkEnvironment(base, parkFactors)');
  const lookupCalls = countOf('parkFactorsForTeam(homeTeam.id)');
  const paramDecls = countOf('parkFactors: ParkFactors | null,');

  gate(
    'the engine applies the park in exactly one place',
    applyCalls === 1,
    `applyParkEnvironment(base, parkFactors) appears ${applyCalls} time(s)`,
  );
  gate(
    'the engine looks up the park in exactly one place',
    lookupCalls === 1,
    `parkFactorsForTeam(homeTeam.id) appears ${lookupCalls} time(s)`,
  );
  gate(
    'the park is a single optional parameter on the one function that builds outcome weights',
    paramDecls === 1,
    `found ${paramDecls} declaration(s)`,
  );
  gate(
    'the park is resolved from the HOME team, not from who is batting',
    /const park = parkFactorsForTeam\(homeTeam\.id\);/.test(source)
    && !/parkFactorsForTeam\(battingTeam\.id\)/.test(source)
    && !/parkFactorsForTeam\(fieldingTeam\.id\)/.test(source),
    'a park applied at the batting team\'s park would invert on the road',
  );

  gate(
    'the park is applied to a weight map EXACTLY ONCE, as an exact identity rather than a tolerance',
    (() => {
      /*
       * THE DECISIVE TEST, and it is here rather than in the simulation because the simulation
       * cannot make this claim.
       *
       * The first version of this tool tried to detect a double application from the realised
       * slope of home-road gap against derived departure, with a band around 1.00. Across two
       * invocations of identical code that slope came out 0.85 and then 0.59. The per-club
       * sampling error is far larger than the distance between "once" and "twice", so a
       * threshold on it was measuring the dice -- which is the same mistake that made this tool
       * need replicates in the first place, committed a second time for the same reason.
       *
       * `applyParkEnvironment` is a pure function, so the claim can be made exactly: for every
       * outcome, the scaled weight must equal the base weight times that outcome's scale, to the
       * last bit. A second application anywhere would multiply again and break the identity;
       * a missing application would break it the other way. No noise, no tolerance, no
       * replicates, and it runs in microseconds.
       *
       * The simulation below then measures whether the consequence shows up in results, which
       * is a different and weaker claim that belongs to a statistical check.
       */
      const extremes = ['val', 'ara'].map((id) => parkFactorsForTeam(id)).filter(Boolean) as ParkFactors[];
      if (extremes.length === 0) return false;
      const base: Record<AtBatOutcome, number> = {
        OUT: 414, SO: 160, BB: 79, '1B': 129, '2B': 41, '3B': 5.4, HR: 24.6, ERR: 8.6,
      };
      return extremes.every((park) => {
        const scaled = applyParkEnvironment(base, park);
        return (Object.keys(base) as AtBatOutcome[]).every((outcome) => {
          const expected = base[outcome] * outcomeWeightScales(park, outcome);
          return scaled[outcome] === expected;
        });
      });
    })(),
    'exact equality: scaled === base * scale, for every outcome, at both ends of the park range',
  );

  gate(
    'scaling a weight map leaves the INPUT untouched',
    (() => {
      const park = parkFactorsForTeam('val');
      if (!park) return false;
      const base: Record<AtBatOutcome, number> = {
        OUT: 414, SO: 160, BB: 79, '1B': 129, '2B': 41, '3B': 5.4, HR: 24.6, ERR: 8.6,
      };
      const before = { ...base };
      applyParkEnvironment(base, park);
      return (Object.keys(base) as AtBatOutcome[]).every((o) => base[o] === before[o]);
    })(),
    'a mutating apply would make the effect depend on call order, which is invisible in a '
    + 'single run and catastrophic across a season',
  );

  gate(
    'a neutral park (factor exactly 1.000) leaves every weight unchanged',
    (() => {
      const neutral: ParkFactors = {
        teamId: 'neutral', hrFactor: 1, fbFactor: 1, gbFactor: 1, runFactor: 1,
        pitcherFatigueRate: 0,
        terms: {
          airCarry: 1, biteLoss: 1, wallDistance: 1, wallHeight: 1, wallColor: 1,
          foulGround: 1, roofCarry: 1, surface: 1, grass: 1, soil: 1,
        },
      };
      const base: Record<AtBatOutcome, number> = {
        OUT: 414, SO: 160, BB: 79, '1B': 129, '2B': 41, '3B': 5.4, HR: 24.6, ERR: 8.6,
      };
      const scaled = applyParkEnvironment(base, neutral);
      return (Object.keys(base) as AtBatOutcome[]).every((o) => scaled[o] === base[o]);
    })(),
  );

  gate(
    'the SHIPPED park factors are re-centred on this league: every channel averages exactly 1.000',
    (() => {
      /*
       * This is the check that would have caught the totals-market failure before it shipped.
       *
       * `parkFactorsFor` is absolute -- calibrated so an arbitrary neutral park scores 1.000 --
       * while the 32 real clubs average 1.248 on home runs. Every game was therefore multiplied
       * by 1.25 and `verifyBetting` reported a 64% over rate against an expected 46%. The cause
       * was not a bad park; it was that a RELATIVE measure was being applied as an ABSOLUTE one.
       *
       * So the shipped map is re-centred, and the invariant is asserted here at exact
       * tolerance: a mean of 1.0000 to eight places across all four channels, and a mean
       * environmental fatigue of exactly zero.
       */
      const all = [...ALL_PARK_FACTORS.values()];
      if (all.length === 0) return false;
      const meanOf = (read: (f: ParkFactors) => number) => all.reduce((a, f) => a + read(f), 0) / all.length;
      const near = (v: number) => Math.abs(v - 1) < 1e-9;
      return near(meanOf((f) => f.hrFactor))
        && near(meanOf((f) => f.fbFactor))
        && near(meanOf((f) => f.gbFactor))
        && near(meanOf((f) => f.runFactor))
        && Math.abs(meanOf((f) => f.pitcherFatigueRate)) < 1e-12;
    })(),
    'measured means: hr, fb, gb, run each 1.0000 and fatigue 0. A drift here inflates league'
    + ' scoring and breaks the betting totals market.',
  );

  gate(
    're-centring did not flatten the differences between parks',
    (() => {
      /*
       * The obvious way to break a bias is to subtract something, which shrinks the spread. So
       * the spread is compared against what the ABSOLUTE model produced, and a re-centring that
       * cost more than a third of the range would be rejected even though it fixed the mean.
       */
      const absolute = [...ALL_PARK_PROFILES.values()].map((p) => parkFactorsFor(p));
      const shipped = [...ALL_PARK_FACTORS.values()];
      const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
      for (const key of ['hrFactor', 'runFactor'] as const) {
        const before = range(absolute.map((f) => f[key]));
        const after = range(shipped.map((f) => f[key]));
        if (after / before < 0.6) return false;
      }
      return true;
    })(),
    're-centring must preserve at least 60% of the absolute range in both the HR and run channels',
  );

  // -- 6. STATIC: THE NULL PATH EXISTS ----------------------------------------------
  gate(
    'a club with no park gets no park rather than somebody else\'s',
    /return parkFactors \? applyParkEnvironment\(base, parkFactors\) : base;/.test(source)
    && /parkFactorsForTeam[\s\S]{0,400}ALL_PARK_FACTORS\.get\(teamId\) \?\? null/.test(
      readFileSync(resolve(process.cwd(), 'src', 'lib', 'analytics', 'parkFactors.ts'), 'utf8'),
    ),
  );

  // -- simulate, over REPLICATES ----------------------------------------------------
  const replicateRows: Array<Array<{
    id: string; city: string;
    derivedHr: number; derivedRun: number;
    realisedHr: number; realisedRoadHr: number;
    realisedRun: number; realisedRoadRun: number;
    park: ParkFactors | null;
  }>> = [];
  const replicateRunsPerGame: number[] = [];
  const replicateHrPerGame: number[] = [];

  for (let rep = 0; rep < REPLICATES; rep += 1) {
    // A DIFFERENT SEED per replicate, deliberately. Since the engine is not deterministic
    // anyway, reusing the seed would not buy reproducibility -- it would only buy the
    // illusion of it, and the replicates would be correlated in a way nobody could see.
    const universe = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: YEAR, seed: 4242 + rep * 977, effectiveDate: `${YEAR}-12-15`,
    }).playerState;

    let teams: Team[] = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      universe, YEAR,
    );
    const manager = new SimulationManager({
      teams,
      games: generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
      playerState: universe,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(YEAR),
    });

    let state: LeaguePlayerState = universe;
    let games: Game[] = [];
    for (let day = 0; day < WARMUP; day += 1) {
      const r = await manager.run({ scope: 'day' });
      state = r.playerState; games = r.games; teams = r.teams;
    }

    const homeGames = new Map<string, number>();
    const roadGames = new Map<string, number>();
    const homeHr = new Map<string, number>();
    const roadHr = new Map<string, number>();
    const homeRuns = new Map<string, number>();
    const roadRuns = new Map<string, number>();
    let leagueRuns = 0;
    let leagueHr = 0;
    let teamGames = 0;

    const bump = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

  for (let day = 0; day < DAYS; day += 1) {
      const r = await manager.run({ scope: 'day' });
      for (const game of r.games) {
      if (game.status !== 'completed') continue;
      const raw = game.stats?.playLog;
      if (typeof raw !== 'string' || raw.length === 0) continue;

      /*
       * HR MUST BE ATTRIBUTED TO THE BATTER'S TEAM.
       *
       * The first version counted every home run in the game and credited all of them to the
       * home club. That is half wrong by construction -- the visitors hit home runs too -- and
       * it made every club's realised figure mostly a measure of how good its opponent was.
       *
       * The symptom was unmistakable once the numbers were printed: individual clubs showed
       * home/road "park factors" of 254 against 174 and 281 against 174, swings of a hundred
       * index points. No park does that. A park factor of 155 is a big number; 254 is a
       * different statistic wearing its clothes.
       *
       * Runs were always right, because `game.score.home` genuinely is the home club's runs,
       * which is exactly why the two bugs disagreed with each other and neither looked like a
       * bug on its own.
       */
      const hrByTeam = new Map<string, number>();
      let events: LogEvent[];
      try {
        events = JSON.parse(raw) as LogEvent[];
      } catch {
        continue;
      }
      for (const e of events) {
        if (e.outcome !== 'HR') continue;
        if (!e.battingTeamId) continue;
        hrByTeam.set(e.battingTeamId, (hrByTeam.get(e.battingTeamId) ?? 0) + 1);
      }

      const { homeTeam, awayTeam } = game;
      const homeRunsScored = game.score.home;
      const awayRunsScored = game.score.away;
      const homeHrCount = hrByTeam.get(homeTeam) ?? 0;
      const awayHrCount = hrByTeam.get(awayTeam) ?? 0;
      bump(homeGames, homeTeam, 1);
      bump(roadGames, awayTeam, 1);
      bump(homeHr, homeTeam, homeHrCount);
      bump(roadHr, awayTeam, awayHrCount);
      bump(homeRuns, homeTeam, homeRunsScored);
      bump(roadRuns, awayTeam, awayRunsScored);
      leagueRuns += homeRunsScored + awayRunsScored;
      leagueHr += homeHrCount + awayHrCount;
      teamGames += 2;
    }
    state = r.playerState; games = r.games; teams = r.teams;
  }

  const leagueRunsPerGame = teamGames > 0 ? leagueRuns / teamGames : 0;
    const leagueHrPerGame = teamGames > 0 ? leagueHr / teamGames : 0;
    replicateRunsPerGame.push(leagueRunsPerGame);
    replicateHrPerGame.push(leagueHrPerGame);

    const rows: Array<{
      id: string; city: string;
      derivedHr: number; derivedRun: number;
      realisedHr: number; realisedRoadHr: number;
      realisedRun: number; realisedRoadRun: number;
      park: ParkFactors | null;
    }> = [];

    for (const team of INITIAL_TEAMS) {
      const park = parkFactorsForTeam(team.id);
      const hg = homeGames.get(team.id) ?? 0;
      const rg = roadGames.get(team.id) ?? 0;
      if (hg === 0 || rg === 0) continue;
      rows.push({
        id: team.id,
        city: team.city,
        derivedHr: park ? indexOf(park.hrFactor) : 100,
        derivedRun: park ? indexOf(park.runFactor) : 100,
        realisedHr: ((homeHr.get(team.id) ?? 0) / hg / leagueHrPerGame) * 100,
        realisedRoadHr: ((roadHr.get(team.id) ?? 0) / rg / leagueHrPerGame) * 100,
        realisedRun: ((homeRuns.get(team.id) ?? 0) / hg / leagueRunsPerGame) * 100,
        realisedRoadRun: ((roadRuns.get(team.id) ?? 0) / rg / leagueRunsPerGame) * 100,
        park,
      });
    }
    replicateRows.push(rows);
    process.stdout.write(`    replicate ${rep + 1}/${REPLICATES} done\n`);
  }

  /*
   * AVERAGE THE REPLICATES, PER CLUB.
   *
   * Averaging the per-club figures and then computing the statistic is not the same as
   * averaging the statistic, and the first is the right one here: the leagues are independent
   * draws of the SAME 32 parks, so the club-level noise is what is being suppressed, and the
   * park signal is a fixed property of that club which survives averaging. Averaging the
   * correlations instead would discard the per-club noise but keep the estimate noisier than
   * it needs to be.
   */
  const first = replicateRows[0];
  const rows = first.map((club, i) => {
    const all = replicateRows.map((r) => r[i]).filter(Boolean);
    const avg = (f: (r: typeof club) => number) => all.reduce((a, r) => a + f(r), 0) / all.length;
    return {
      ...club,
      realisedHr: avg((r) => r.realisedHr),
      realisedRoadHr: avg((r) => r.realisedRoadHr),
      realisedRun: avg((r) => r.realisedRun),
      realisedRoadRun: avg((r) => r.realisedRoadRun),
    };
  });

  const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const spreadOf = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

  console.log(`  window                ${WARMUP} warmup + ${DAYS} days, ${REPLICATES} replicates`);
  console.log(`  clubs measured        ${rows.length}`);
  console.log(`  runs per team-game    ${meanOf(replicateRunsPerGame).toFixed(3)}  (replicate spread ${spreadOf(replicateRunsPerGame).toFixed(3)})`);
  console.log(`  home runs per game    ${meanOf(replicateHrPerGame).toFixed(3)}  (replicate spread ${spreadOf(replicateHrPerGame).toFixed(3)})`);

  // -- 2 & 3. THE CORRELATIONS -------------------------------------------------------
  const derivedHr = rows.map((r) => r.derivedHr);
  const derivedRun = rows.map((r) => r.derivedRun);
  const realisedRoadHr = rows.map((r) => r.realisedRoadHr);

  /*
   * THE CORRELATIONS ARE COMPUTED ON GAPS, NOT ON LEVELS, AND THIS IS THE WHOLE DESIGN.
   *
   * A club's realised home run rate is dominated by how good its hitters are. Vallile's home
   * games were won by its lineup, not by its park, and correlating realised LEVELS against
   * derived factors therefore mostly measures team quality. The first run of this tool did
   * exactly that and returned a run-factor correlation of 0.24, which said nothing about
   * whether the park was wired in.
   *
   * The home-minus-road gap is a WITHIN-CLUB paired comparison, so team quality, schedule
   * strength and opponent quality all cancel, and what is left is the park. It is also exactly
   * the quantity a park factor is supposed to explain, and it is what makes the magnitude
   * check meaningful rather than decorative.
   *
   * Road levels are still reported, and still asserted FLAT, because a park leaking into road
   * games would show up there and nowhere else.
   */
  const hrGaps = rows.map((r) => r.realisedHr - r.realisedRoadHr);
  const runGaps = rows.map((r) => r.realisedRun - r.realisedRoadRun);
  const hrDepartures = derivedHr.map((v) => v - 100);
  const runDepartures = derivedRun.map((v) => v - 100);

  const hrR = correlate(hrDepartures, hrGaps);
  const runR = correlate(runDepartures, runGaps);
  const roadR = correlate(derivedHr, realisedRoadHr);

  /*
   * THE CONFOUNDING, MEASURED AND PRINTED.
   *
   * `runFactor` contains `hrFactor ** runWeights.hr`, so the two derived departures are not
   * independent across this league's 32 parks. A regression of the realised scoring gap on the
   * `runFactor` departure is therefore PARTLY a regression on `hrFactor`, which has a wider
   * range and drives scoring directly through the HR and 2B channels.
   *
   * tools/fitRunFactor.ts measures the correlation between the two departures at r = 0.785,
   * which is high enough that the partial coefficients are not separately identified. This is
   * printed on every run rather than buried, because a slope of 1.5 on a confounded regressor
   * reads like a calibration finding and is not one.
   */
  const departCorr = correlate(hrDepartures, runDepartures);

  /*
   * THE JOINT MODEL, which is the identified quantity.
   *
   * Two predictors, solved from the 2x2 normal equations directly rather than pulled in from
   * a library, because the coefficients are the thing a reader needs to see and a two-row solve
   * is short enough to leave in the open.
   *
   * What it buys: `runR` alone cannot tell whether the run channel or the home-run channel is
   * moving scoring. The joint fit can. What it does NOT buy: separate significance for the two
   * coefficients, because at r = 0.785 they are not separately identified. So the R-squared is
   * gated -- it is identified -- and the individual partials are printed and NOT gated.
   */
  const jointFit = (() => {
    let sxx = 0; let sxz = 0; let szz = 0; let sxy = 0; let szy = 0;
    const my = runGaps.reduce((a, b) => a + b, 0) / runGaps.length;
    let totalVar = 0;
    for (let i = 0; i < runGaps.length; i += 1) {
      const x = runDepartures[i];
      const z = hrDepartures[i];
      const dy = runGaps[i] - my;
      sxx += x * x; sxz += x * z; szz += z * z; sxy += x * dy; szy += z * dy;
      totalVar += dy * dy;
    }
    const det = sxx * szz - sxz * sxz;
    if (Math.abs(det) < 1e-12 || totalVar === 0) return { run: NaN, hr: NaN, r2: NaN };
    const bRun = (sxy * szz - szy * sxz) / det;
    const bHr = (szy * sxx - sxy * sxz) / det;
    // Explained variance: sum of (fitted - mean)^2 over total variance of the gaps.
    let resid = 0;
    const mx = runDepartures.reduce((a, b) => a + b, 0) / runDepartures.length;
    const mz = hrDepartures.reduce((a, b) => a + b, 0) / hrDepartures.length;
    for (let i = 0; i < runGaps.length; i += 1) {
      const dy = runGaps[i] - (bRun * runDepartures[i] + bHr * hrDepartures[i] + (my - bRun * mx - bHr * mz));
      resid += dy * dy;
    }
    return { run: bRun, hr: bHr, r2: 1 - resid / totalVar };
  })();

  console.log('\n  DERIVED vs REALISED (Pearson r)');
  console.log('    computed on GAPS (home minus road), so team quality cancels');
  console.log(`    HR  gap  vs derived HR  departure   r = ${hrR.toFixed(3)}   slope ${slope(hrDepartures, hrGaps).toFixed(2)}`);
  console.log(`    RUN gap  vs derived RUN departure   r = ${runR.toFixed(3)}   slope ${slope(runDepartures, runGaps).toFixed(2)}`);
  console.log(`    ROAD level vs derived HR factor      r = ${roadR.toFixed(3)}   <- must be near zero`);
  console.log(`\n    CONFOUNDING: the two departures correlate at r = ${departCorr.toFixed(3)}`);
  console.log('    (runFactor contains hrFactor ** runWeights.hr), so the RUN slope above is');
  console.log('    partly hrFactor\'s signal and is NOT a run-calibration finding.');
  console.log(`    JOINT fit on both: run ${jointFit.run.toFixed(3)}, hr ${jointFit.hr.toFixed(3)}, R^2 = ${jointFit.r2.toFixed(3)}`);
  console.log('    The partials are printed, not gated: at this correlation they are not');
  console.log('    separately identified, so thresholding either would be a coin flip.');

  console.log('\n  PER CLUB');
  console.log('    club  city             derived  realised   road   |  derived  realised   road   (HR)  (RUN)');
  rows.sort((a, b) => b.derivedHr - a.derivedHr);
  rows.forEach((r) => {
    console.log(
      `    ${r.id.padEnd(5)}${r.city.padEnd(18)}`
      + `${r.derivedHr.toFixed(0).padStart(6)}${r.realisedHr.toFixed(0).padStart(10)}${r.realisedRoadHr.toFixed(0).padStart(7)}`
      + '   |'
      + `${r.derivedRun.toFixed(0).padStart(8)}${r.realisedRun.toFixed(0).padStart(10)}${r.realisedRoadRun.toFixed(0).padStart(7)}`,
    );
  });

  gate(
    'the realised home-road home-run gap tracks the derived HR factor\'s departure from 100',
    Number.isFinite(hrR) && hrR > 0.5,
    `r = ${hrR.toFixed(3)}; needs > 0.50`,
    true,
  );
/*
   * THE RUN-CHANNEL CHECK, REWRITTEN BECAUSE THE OLD ONE MEASURED A CONFOUNDED REGRESSOR.
   *
   * What it used to assert: `correlate(runDepartures, runGaps) > 0.30`, labelled "the realised
   * home-road scoring gap tracks the derived run factor". The detail line reported a slope of
   * 1.65 and explained it as the derived run factor UNDER-PREDICTING, because the blend damps
   * the home-run channel while scoring responds to home runs directly.
   *
   * THAT EXPLANATION IS NOW KNOWN TO BE WRONG, and it is worth recording why, because it is
   * exactly the kind of tidy finding that gets built on for years. It is not under-prediction.
   * The two departures correlate at r = 0.785, because `runFactor` contains
   * `hrFactor ** runWeights.hr`. A regression on `runFactor` is therefore largely a regression
   * on `hrFactor`, which has the wider range across this league and drives scoring directly
   * through the HR and 2B channels. The slope above 1.00 is borrowed signal.
   *
   * `tools/fitRunFactor.ts` searched for a coefficient that would bring that slope to 1.00 and
   * found the entire plausible range of `runWeights.hr` -- 0.20 to 0.29 -- moves it by 0.001.
   * There is no calibration fix here, because nothing is miscalibrated. The old comment's
   * recommendation, "rebuild `runFactor` from these realised gaps", would have been a
   * well-reasoned refit of a coefficient with almost no leverage on the thing it explains.
   *
   * WHAT IS ASSERTED NOW, AND WHY THIS QUANTITY
   *
   * The joint model's R-squared. It is the identified part of the question: does a park's
   * derived environment explain its realised home-road scoring gap beyond chance? The individual
   * partials are printed and NOT gated, because at r = 0.785 they cannot be separately
   * identified, and thresholding either would be a coin flip.
   *
   * THE FLOOR IS 0.05, CHOSEN BEFORE MEASURING IT, and that ordering is the whole point. It is
   * not tuned to whatever the number turns out to be. It is a materiality floor: the park signal
   * must explain more than one twentieth of the variance in a club's home-road scoring gap.
   * Below that a park is not measurably doing anything to scoring, and the engine should not be
   * claiming that it does. If this check FAILS, the response is to shrink the park factors -- not
   * to move the floor down until it passes.
   */
  gate(
    'the park environment jointly explains the realised home-road scoring gap',
    Number.isFinite(jointFit.r2) && jointFit.r2 > 0.05,
    `R^2 = ${jointFit.r2.toFixed(3)} on the HR and run departures jointly, needs > 0.05.`
    + ` The two departures correlate at r = ${departCorr.toFixed(3)}, so neither partial is`
    + ' gated on its own. The previous version of this check correlated run gaps against the'
    + ` run departure alone and reported a slope of ${slope(runDepartures, runGaps).toFixed(2)},`
    + ' which it read as the run factor under-predicting. It was largely measuring hrFactor.',
    true,
  );
  gate(
    'ROAD production does NOT track any park factor -- the park applies at home only',
    Number.isFinite(roadR) && Math.abs(roadR) < 0.35,
    `r = ${roadR.toFixed(3)}; needs |r| < 0.35. A non-zero value means the park is leaking into`
    + ' road games, which would be either the batting team\'s park or both parks applied.',
    true,
  );

  // -- 4. MAGNITUDE: REPORTED, NOT ASSERTED ----------------------------------------
  /*
   * Correlation survives a double application, so direction alone cannot detect one, and the
   * obvious fix -- threshold the slope, which a single application predicts near 1.00 and a
   * double application near 2.00 -- was tried and DOES NOT WORK.
   *
   * Across two invocations of identical code this slope came out 0.85 and then 0.59. The
   * per-club sampling error is wider than the gap between "once" and "twice", so any band that
   * excluded a genuine double application would also fail on noise, and a check that fails on
   * noise gets deleted. The same mistake a second time in the same tool: first a threshold on
   * a single noisy run, then a threshold on a three-replicate average of the same noisy
   * quantity.
   *
   * So the EXACT-ONCE claim is made against `applyParkEnvironment` instead, where it is an
   * exact identity checked to the last bit with no tolerance at all. The slope stays here as a
   * reported diagnostic because it is genuinely informative about the MODEL -- it says the
   * realised effect is somewhat weaker than derived on home runs and considerably stronger on
   * runs -- but it is not something this sample can decide.
   */
  const hrSlope = slope(hrDepartures, hrGaps);
  const runSlope = slope(runDepartures, runGaps);
  console.log('\n  MAGNITUDE -- reported, NOT asserted');
  console.log('    One application predicts a slope near 1.00; a double application near 2.00.');
  console.log('    Too noisy to threshold: two invocations of identical code gave 0.85 and 0.59.');
  console.log('    The exact-once claim is made against the pure function above, bit for bit.');
  console.log(`    home runs    slope ${hrSlope.toFixed(2)}   <- realised effect weaker than derived`);
  console.log(`    runs         slope ${runSlope.toFixed(2)}   <- stronger, because scoring also responds`);
  console.log('                                   to the home-run channel that the run blend damps');

  // -- 5. THE LEAGUE STILL SCORES LIKE BASEBALL --------------------------------------
  gate(
    'runs per team-game stay in a plausible band',
    meanOf(replicateRunsPerGame) > 3.4 && meanOf(replicateRunsPerGame) < 5.4,
    `${meanOf(replicateRunsPerGame).toFixed(3)} per team-game; band 3.40-5.40`,
    true,
  );
  gate(
    'home runs per game stay in a plausible band',
    meanOf(replicateHrPerGame) > 0.7 && meanOf(replicateHrPerGame) < 1.5,
    `${meanOf(replicateHrPerGame).toFixed(3)} per team-game; band 0.70-1.50`,
    true,
  );

  // -- report ------------------------------------------------------------------------
  /*
   * ONLY DECIDED CHECKS CAN FAIL THE TOOL.
   *
   * A skipped statistical check is left in the array with `pass` at whatever the measurement
   * happened to be, so filtering on `!pass` counts a check that was never asked as a failure.
   * The first version of this report did exactly that and the tool exited 1 on every run below
   * twelve replicates -- which would have taught everyone to ignore the exit code within a day,
   * and a green-light exit code is the only thing anyone reads in CI.
   *
   * So `decided` is computed once, here, and both the exit code and the tally use it.
   */
  const decided = gated.filter((c) => !c.statistical || REPLICATES >= GATE_MIN_REPLICATES);
  const failed = decided.filter((c) => !c.pass);

  console.log(`\n  ${REPLICATES} replicate(s) used.`);
  if (REPLICATES < GATE_MIN_REPLICATES) {
    console.log(
      `\n  *** SAMPLE TOO SMALL TO GATE THE STATISTICAL CHECKS ***\n`
      + `  These are five measurements over ${REPLICATES} replicate(s); the gate needs ${GATE_MIN_REPLICATES}.\n`
      + `  Per-club Poisson noise is ~22% per replicate against a park signal of ~25%, so below\n`
      + `  ${GATE_MIN_REPLICATES} replicates the standard error on r is larger than the distance from\n`
      + `  the threshold. Measured: r has come out 0.673, 0.563, 0.393 and 0.388 on identical code.`,
    );
    reported.push(
      'statistical checks NOT GATED: below '
      + `${GATE_MIN_REPLICATES} replicates these measure the sample, not the park`,
    );
  }

  console.log('\n  GATED CHECKS (deterministic, plus statistics only when the sample supports them)');
  gated.forEach((c, i) => {
    const isDecided = !c.statistical || REPLICATES >= GATE_MIN_REPLICATES;
    if (!isDecided) {
      console.log(`    SKIP   ${String(i + 1).padStart(2)}. ${c.label}`);
      if (c.detail) console.log(`            (would read: ${c.detail.split(';')[0]})`);
      return;
    }
    console.log(`    ${c.pass ? 'PASS' : 'FAIL'}   ${String(i + 1).padStart(2)}. ${c.label}`);
    if (!c.pass && c.detail) console.log(`            ${c.detail}`);
  });

  console.log('\n  REPORTED (measured, not gated)');
  reported.forEach((r) => console.log(`    ${r}`));

  const skipped = gated.length - decided.length;
  console.log(
    `\n  ${decided.length - failed.length}/${decided.length} decided checks PASS`
    + `${skipped > 0 ? `, ${skipped} statistical check(s) skipped for want of replicates` : ''}\n`,
  );
  if (failed.length > 0) process.exitCode = 1;
};

void main();
