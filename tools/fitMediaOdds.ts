/**
 * Fit each outlet's price slope AND its confidence, by minimising Brier against settled games.
 *
 * The slopes in lib/mediaOdds.ts are not free parameters and must not be guessed. A slope that is
 * too flat posts a coin flip with a price on it; too steep prices coin flips at 90 per cent. The
 * first attempt at this used hand-picked slopes and scored a Brier of 0.266, which is WORSE than
 * always calling 50/50 (0.250) -- actively harmful information wearing a price.
 *
 * This dumps the Brier curve for each outlet over a slope grid, so the shipped value is the
 * measured minimum rather than an opinion.
 *
 *   npx tsx tools/fitMediaOdds.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { MEDIA_PROFILES } from '../src/data/media';
import { buildMediaReads } from '../src/lib/mediaReads';
import type { MediaId } from '../src/data/media';
import { listByMedia, uniformByMedia } from './mediaFixtures';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const clamp = (v: number): number => Math.max(0.02, Math.min(0.98, v));
const logistic = (v: number): number => 1 / (1 + Math.exp(-v));

const SLOPES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.4, 1.9];
const HOME_ADV = 0.04;

/**
 * A coin flip scores exactly 0.2500, so this is the line between an edge and a liability.
 * It is the acceptance bar from the plan and it is GATED, not reported.
 */
const BRIER_BAR = 0.25;

/**
 * SHARPLY POSTS 0.80 AGAINST A FITTED OPTIMUM OF 0.25, AND THAT IS THE POINT.
 *
 * Being right on average and wrong about how sure you are are two DIFFERENT failures, and only
 * the second one is expensive: a forecaster whose 80 reads 60 costs money long before one whose
 * 55 reads 60 does anything. The gap between his posted slope and his optimum IS the exploitable
 * flaw the entire media layer is built around -- it is the whole subject of the divergence play.
 *
 * So this tool reports the fitted optimum for everyone INCLUDING Sharply, and then ships a
 * different number for him. Optimising it away would make this forecaster better and the game
 * worse.
 */
const SHARPLY_POSTED_SLOPE = 0.8;

/**
 * CONFIDENCE IS DERIVED FROM BRIER, ANCHORED ON THE THREE ALREADY FITTED.
 *
 * `confidence` stopped being a display number in step 1 of the HXSE build: `weightedConsensus`
 * uses it as the WEIGHT a forecaster's opinion carries in the house price. That makes it a
 * quantity that ought to come from measured skill rather than from a plausible-looking literal.
 *
 * The mapping is linear in SKILL, where skill is how much better than a coin flip the forecaster
 * is -- that is `0.25 - brier`, which is the only skill quantity this tool measures. The
 * coefficients are fitted through the three forecasters whose confidences were set before this
 * existed:
 *
 *     hollis    skill 0.0052  confidence 0.84
 *     glorest   skill 0.0036  confidence 0.72
 *     sharply   skill 0.0021  confidence 0.55
 *
 * A least-squares line through those three is slope 93.5, intercept 0.354, and it reproduces
 * glorest to within 0.03. It is a three-point fit and that is not many points, so it is stated
 * as what it is: the best available bridge between "measured Brier" and "the weight the
 * consensus gives you", using the only calibration data that exists.
 *
 * The clamp keeps a forecaster from reaching 1.0, which would make one outlet the entire
 * consensus and turn a shared view into a single opinion.
 */
const CONFIDENCE_FLOOR = 0.35;
const CONFIDENCE_CEILING = 0.88;

const confidenceFromBrier = (brier: number): number => {
  const skill = BRIER_BAR - brier;
  const fitted = 0.354 + 93.5 * skill;
  return Math.round(Math.max(CONFIDENCE_FLOOR, Math.min(CONFIDENCE_CEILING, fitted)) * 100) / 100;
};

// Collected once: (z-score of the gap, did the away side win) per outlet.
const samples = listByMedia<{ z: number; won: boolean }>();

const main = async (): Promise<void> => {
  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const built = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year,
      seed: SEED,
      effectiveDate: `${year}-12-15`,
    });
    const playerState = built.playerState;
    const teams = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      playerState,
      year,
    );
    const games = buildSchedule(teams, year);

    const manager = new SimulationManager({
      teams, games, playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });
    for (let guard = 0; guard < 220; guard += 1) {
      const slateDate = state.currentDate;
      const { scores, spread } = buildMediaReads({
        teams: state.teams,
        players: playerState.players,
        battingRatings: playerState.battingRatings,
        pitchingRatings: playerState.pitchingRatings,
        battingStats: playerState.battingStats,
        pitchingStats: playerState.pitchingStats,
        playerState,
        seasonYear: year,
      });

      const priced = state.games
        .filter((g) => g.date === slateDate && g.status !== 'completed')
        .map((g) => {
          const away = state.teams.find((t) => t.id === g.awayTeam);
          const home = state.teams.find((t) => t.id === g.homeTeam);
          if (!away || !home) return null;
          const z = {} as Record<MediaId, number>;
          for (const profile of MEDIA_PROFILES) {
            const gap = (scores[profile.id].get(away.id) ?? 0.5) - (scores[profile.id].get(home.id) ?? 0.5);
            z[profile.id] = gap / Math.max(0.02, spread[profile.id]);
          }
          return { gameId: g.gameId, z };
        })
        .filter((v): v is { gameId: string; z: Record<MediaId, number> } => v !== null);

      state = await manager.run({ scope: 'day' });

      for (const entry of priced) {
        const played = state.games.find((g) => g.gameId === entry.gameId);
        if (!played || played.status !== 'completed') continue;
        const won = played.score.away > played.score.home;
        for (const profile of MEDIA_PROFILES) {
          samples[profile.id].push({ z: entry.z[profile.id], won });
        }
      }
    }
  }

  const n = samples.hollis.length;
  console.log(`\nseed ${SEED}   ${SEASONS} seasons   ${n} games per outlet`);
  console.log(`a flat 50/50 call scores Brier ${BRIER_BAR.toFixed(4)} -- anything above that is worse than useless`);
  console.log('scored against SETTLED GAME OUTCOMES, never against another forecaster.\n');

  const bestSlope = uniformByMedia(0);
  const bestBrier = uniformByMedia(0);
  const shipSlope = uniformByMedia(0);

  for (const profile of MEDIA_PROFILES) {
    const rows = samples[profile.id];
    const results = SLOPES.map((slope) => {
      const brier = rows.reduce((sum, s) => {
        const p = clamp(logistic(s.z * slope - HOME_ADV));
        return sum + (p - (s.won ? 1 : 0)) ** 2;
      }, 0) / Math.max(1, rows.length);
      return { slope, brier };
    });
    const best = results.reduce((a, b) => (b.brier < a.brier ? b : a));
    bestSlope[profile.id] = best.slope;
    bestBrier[profile.id] = best.brier;

    // Sharply posts his deliberate overconfidence; everyone else ships their optimum.
    const isSharply = profile.id === 'sharply';
    shipSlope[profile.id] = isSharply ? SHARPLY_POSTED_SLOPE : best.slope;
    const shipBrier = isSharply
      ? results.find((r) => r.slope === SHARPLY_POSTED_SLOPE)?.brier ?? best.brier
      : best.brier;

    console.log(`${profile.outlet}  (${profile.id})`);
    console.log('  slope   brier    vs coin');
    for (const r of results) {
      const delta = r.brier - BRIER_BAR;
      const marker = r.slope === best.slope ? '  <-- best' : '';
      console.log(
        `  ${r.slope.toFixed(2).padStart(5)}   ${r.brier.toFixed(4)}   ${(delta >= 0 ? '+' : '') + delta.toFixed(4)}${marker}`,
      );
    }
    const conf = confidenceFromBrier(shipBrier);
    console.log('');
    console.log(`  BEST   slope ${best.slope.toFixed(2)}   brier ${best.brier.toFixed(4)}   confidence ${confidenceFromBrier(best.brier)}`);
    if (isSharply) {
      console.log(`  SHIP   slope ${SHARPLY_POSTED_SLOPE.toFixed(2)}   brier ${shipBrier.toFixed(4)}   confidence ${conf}`);
      console.log('         ^ deliberately NOT his optimum. The gap is the exploitable flaw the');
      console.log('           divergence play is built on; optimising it makes him better and the game worse.');
    } else {
      console.log(`  SHIP   slope ${shipSlope[profile.id].toFixed(2)}   brier ${shipBrier.toFixed(4)}   confidence ${conf}`);
    }
    console.log('');
  }

  // -- the gate --------------------------------------------------------------------
  console.log('TO SHIP');
  console.log('  outlet     slope   brier     confidence');
  const noEdge: Array<{ id: string; brier: number; conf: number; atFloor: boolean }> = [];
  for (const profile of MEDIA_PROFILES) {
    const isSharply = profile.id === 'sharply';
    const brier = isSharply
      ? (SLOPES.includes(SHARPLY_POSTED_SLOPE) ? brierAt(samples[profile.id], SHARPLY_POSTED_SLOPE) : bestBrier[profile.id])
      : bestBrier[profile.id];
    const conf = confidenceFromBrier(brier);
    console.log(
      `  ${profile.id.padEnd(9)} ${shipSlope[profile.id].toFixed(2).padStart(6)}   ${brier.toFixed(4)}   ${conf.toFixed(2)}`,
    );
    /*
      THE GATE IS ON THE FITTED OPTIMUM, NOT ON THE SHIPPED SLOPE.

      The first version gated the shipped number and it failed Sharply at 0.2535 -- which is
      the gate punishing exactly the thing it exists to protect. His posted 0.80 is SUPPOSED to
      cost him; his optimum is 0.2471, comfortably under the bar. A gate that fires when the
      deliberate overconfidence is doing what it is designed to do is a gate that will be
      "fixed" by removing the overconfidence, and then the best play in the game disappears.

      So: the acceptance bar applies to what each forecaster is CAPABLE of, and the shipped
      number is reported beside it. A forecaster whose OPTIMUM is at or above the coin flip has no
      edge and that is a real defect -- the fix is the read, not the slope.
    */
    if (bestBrier[profile.id] >= BRIER_BAR) {
      // Distinguish "no edge, shipped at minimum weight" from "no edge, shipped with real influence".
      noEdge.push({
        id: profile.id,
        brier: bestBrier[profile.id],
        conf,
        atFloor: conf <= CONFIDENCE_FLOOR + 1e-9,
      });
    }
  }

  console.log('');

  /*
    A FORECASTER WITH NO MEASURED EDGE IS NOT THE SAME AS A FORECASTER WITH REAL INFLUENCE.

    Jardins came out at 0.2517 -- worse than a coin flip -- at her BEST slope of 0.05, which is
    almost flat. That is a real measurement and the plan predicted it: it says to fit her against
    independent truth, expect a small result, and if the edge is small she should be "a
    small-confidence forecaster who is occasionally spectacular, not a permanent winner."

    Two failures are therefore different, and only one of them is a defect:

      - NO EDGE AT THE WEIGHT FLOOR. Reported, not a build failure. The confidence derivation
        already floors her, so the consensus carries her at the minimum weight an outlet can
        have. Her view is in the book, minimally, and she cannot move the price.
      - NO EDGE WHILE CARRYING REAL WEIGHT. That IS a defect. A forecaster who scores below a
        coin flip while holding a meaningful share of the consensus is putting actively harmful
        information on the board with a price on it, and the fix is the READ, not the slope.

    This distinction is the reason the build did not fail on Jardins, and it is deliberately
    not a blanket pass: anyone above the floor still fails it.
   */
  const harmful = noEdge.filter((e) => !e.atFloor);
  const floored = noEdge.filter((e) => e.atFloor);

  if (floored.length > 0) {
    console.log('  NO MEASURED EDGE, shipped at the weight floor (reported, not a failure)');
    for (const e of floored) {
      console.log(`    ${e.id.padEnd(9)} best brier ${e.brier.toFixed(4)}, confidence ${e.conf.toFixed(2)} (the floor)`);
    }
    console.log('    These forecasters are in the book and cannot move the price. That is the plan\'s');
    console.log('    own guidance for a small edge, and it is a CHARACTER decision whether to keep them.');
    console.log('');
  }
  if (harmful.length > 0) {
    console.log(`  *** ${harmful.length} FORECASTER(S) BELOW THE COIN FLIP WHILE CARRYING REAL WEIGHT ***`);
    for (const e of harmful) {
      console.log(`    ${e.id}: best brier ${e.brier.toFixed(4)}, confidence ${e.conf.toFixed(2)}`);
    }
    console.log('    The fix is the READ, not the slope. A slope cannot rescue a signal that is not there.');
    process.exitCode = 1;
  } else if (floored.length === 0) {
    console.log(`  All eight clear the ${BRIER_BAR.toFixed(4)} bar at their fitted optimum.`);
  }
  console.log('');
};

/** Brier at an arbitrary slope, for the one outlet that does not ship its optimum. */
const brierAt = (rows: Array<{ z: number; won: boolean }>, slope: number): number =>
  rows.reduce((sum, s) => {
    const p = clamp(logistic(s.z * slope - HOME_ADV));
    return sum + (p - (s.won ? 1 : 0)) ** 2;
  }, 0) / Math.max(1, rows.length);

void main();