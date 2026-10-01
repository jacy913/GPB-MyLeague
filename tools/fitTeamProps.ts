/**
 * Fit the team prop model, the way fitPropLines does for players.
 *
 * The expansion plan's constraint 3 is the reason this file exists rather than a
 * table of guesses: "a team hits line guessed from the team batting average will be
 * mispriced -- team-level aggregates are smoother than player rates and will look
 * plausible while being wrong."
 *
 * THE MODEL IS THE SAME SHAPE AS THE PLAYER ONE, AND THAT IS THE POINT. A team total
 * is closer to Poisson than a player's is, which sounds like it would make the model
 * MORE accurate. It does the opposite: a smoother distribution is a NARROWER one, so
 * a model slightly too fat on a player's line is badly too fat on a team's, because
 * the team line sits in the body of the distribution where the tails are everything.
 * The per-stat dispersion is the thing that has to be right, and it has to be
 * measured rather than borrowed from the player fit.
 *
 * WHERE A TEAM'S SEASON RATE COMES FROM, and why it is not a new source of truth: a
 * club's season hits ARE the sum of its batters' season hits, and the engine asserts
 * that player hits sum to team hits at the end of every game. So the rate is summed
 * from the SAME player aggregates the player props use, which means there is no second
 * definition of "how many hits does this club get" anywhere in the model.
 *
 * Method is identical to fitPropLines: walk day by day, and for each completed game
 * ask the model what it expected of each side using ONLY the totals as they stood
 * BEFORE that game. Post-game totals would fit a model that cannot exist at the moment
 * it is needed.
 *
 * Run: npx tsx tools/fitTeamProps.ts [warmupDays] [days]
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
import { propStatMaps } from '../src/lib/playerProps';
import {
  TEAM_LINE_RANGE,
  TEAM_MODEL_CONSTANTS,
  TEAM_PROP_STATS,
  reconstructTeamGameLines,
  teamActualStat,
  type TeamStatKey,
} from '../src/lib/teamProps';
import type { Game, LeaguePlayerState, PlayerSeasonBatting, Team } from '../src/types';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 40);
const DAYS = Number(process.argv[3] ?? 90);
const PRIOR_GRID = [8, 16, 24, 40, 64, 96];
const DISP_GRID = [0.6, 0.8, 1.0, 1.1, 1.2, 1.3, 1.5, 1.7, 2.0];

/** Shrink a club's own total toward the league rate. Mirrors the player model. */
const shrunkPerGame = (
  total: number, games: number, leagueRate: number, priorGames: number,
): number => {
  if (games <= 0) return leagueRate;
  return (total + leagueRate * priorGames) / (games + priorGames);
};

const logit = (p: number): number => {
  const safe = Math.min(0.995, Math.max(0.005, p));
  return Math.log(safe / (1 - safe));
};
const logistic = (v: number): number => 1 / (1 + Math.exp(-v));
const clampProbability = (p: number): number => Math.min(0.97, Math.max(0.03, p));

/**
 * Over a half line means strictly more, so "over 2.5" is three or more.
 *
 * THE LOGISTIC SHORTCUT, DELIBERATELY, AFTER A PROPER NORMAL CDF MADE IT WORSE.
 *
 * Replacing `logistic(-z * 1.7)` with an accurate normal CDF (Abramowitz and Stegun
 * 7.1.26) was tried because the fit was running to the top of the dispersion grid for
 * five of six stats, which reads like a misshapen tail. The numbers disagreed:
 *
 *                    logistic      proper CDF
 *   teamRuns           0.2076        0.2490
 *   teamHits           0.3503        0.4016
 *   teamWalks          0.2821        0.3359
 *
 * The shortcut is better on every stat, by 0.04 to 0.06 of Brier. So the tail
 * compression was compensating for a bias elsewhere rather than causing a problem,
 * and the accurate CDF removed a crutch that was hiding it. The shortcut stays, and
 * the real cause is still open -- see the note on the fitted constants.
 */
const overProbability = (mean: number, line: number, dispersion: number): number => {
  // Variance proportional to the mean -- the Poisson shape the player model uses --
  // scaled by a fitted dispersion.
  const variance = mean * (dispersion * dispersion);
  const sd = Math.sqrt(Math.max(variance, 1e-6));
  const z = (line + 0.5 - mean) / sd;
  return clampProbability(logistic(-z * 1.7));
};

const lineFor = (stat: TeamStatKey, mean: number): number => {
  const range = TEAM_LINE_RANGE[stat];
  const raw = Math.round((mean + range.offset) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, Math.round(raw * 2) / 2));
};

const ladderFor = (stat: TeamStatKey, mean: number): number[] => {
  const range = TEAM_LINE_RANGE[stat];
  const centre = lineFor(stat, mean);
  const steps = Math.max(1, Math.round(range.span / range.step));
  const out: number[] = [];
  for (let i = -steps; i <= steps; i += 1) {
    const value = Math.round((centre + i * range.step) * 2) / 2;
    if (value >= range.min && value <= range.max) out.push(value);
  }
  return out.length === 0 ? [centre] : out;
};

interface Observation {
  stat: TeamStatKey;
  /** RAW season total and games, not a pre-shrunk mean. */
  total: number;
  gamesPlayed: number;
  leagueRate: number;
  actual: number;
}

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: 4242,
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
      seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180,
    }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  let games: Game[] = generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180,
  });

  for (let day = 0; day < WARMUP; day += 1) {
    const r = await manager.run({ scope: 'day' });
    state = r.playerState; games = r.games; teams = r.teams;
  }

  const rosterByTeam = new Map<string, string[]>();
  state.players.forEach((player) => {
    if (player.status !== 'active') return;
    if (!rosterByTeam.has(player.teamId)) rosterByTeam.set(player.teamId, []);
    rosterByTeam.get(player.teamId)!.push(player.playerId);
  });

  const observations: Observation[] = [];
  const scoredGames = new Set<string>();

  for (let day = 0; day < DAYS; day += 1) {
    // Season totals as they stand BEFORE the day's games, which is the information a
    // bettor has when the prop is published.
    const maps = propStatMaps(state);
    const teamTotals = buildTeamSeasonTotals(maps.batting, rosterByTeam, teams);
    const leagueRates = leagueTeamRates(teamTotals);

    const result = await manager.run({ scope: 'day' });

    for (const game of result.games) {
      if (game.status !== 'completed') continue;
      if (scoredGames.has(game.gameId)) continue;
      scoredGames.add(game.gameId);
      const lines = reconstructTeamGameLines(game);
      if (!lines.away || !lines.home) continue;

      for (const [side, teamId] of [['away', game.awayTeam], ['home', game.homeTeam]] as const) {
        const line = side === 'away' ? lines.away : lines.home;
        const totals = teamTotals.get(teamId);
        if (!totals || totals.gamesPlayed <= 0) continue;
        for (const stat of TEAM_PROP_STATS) {
          // ONE observation per (side, stat), not one per rung.
          //
          // The first version pushed an observation per ladder line AND looped the
          // ladder again inside the scorer, so every side-game was scored ~22 times
          // over with a different mean each time. The symptom was unmistakable once
          // the numbers came in: every Brier between 0.34 and 0.56 -- far worse than a
          // coin flip -- and improving monotonically as dispersion ran to the top of
          // the grid. A model that wants to be maximally unconfident has a systematic
          // bias; it does not need fattening.
          observations.push({
            stat,
            total: totals.by[stat],
            gamesPlayed: totals.gamesPlayed,
            leagueRate: leagueRates[stat],
            actual: teamActualStat(line, stat),
          });
        }
      }
    }
    state = result.playerState;
    games = result.games;
  }

  console.log(`\nTEAM PROP FIT  (${WARMUP} warmup days, ${DAYS} measured days)`);
  console.log(`  ${observations.length} prop observations over ${scoredGames.size} completed games\n`);

  /**
   * Brier for one stat at one (prior, dispersion).
   *
   * The line is re-derived inside the score from the shrunk mean at THAT prior, so a
   * grid point that changes the prior gets a line that matches it. Scoring a
   * fixed line against a re-shrunk mean would quietly bias the search toward the
   * prior the lines happened to be built with.
   */
  const score = (stat: TeamStatKey, prior: number, dispersion: number): number => {
    let total = 0;
    let n = 0;
    for (const o of observations) {
      if (o.stat !== stat) continue;
      const mean = shrunkPerGame(o.total, o.gamesPlayed, o.leagueRate, prior);
      for (const line of ladderFor(stat, mean)) {
        const predicted = overProbability(mean, line, dispersion);
        const hit = o.actual > line ? 1 : 0;
        total += (predicted - hit) ** 2;
        n += 1;
      }
    }
    return n === 0 ? 1 : total / n;
  };

  console.log('  per-stat Brier at each dispersion, prior fixed at the shipped value');
  console.log('  stat                ' + DISP_GRID.map((d) => d.toFixed(2).padStart(8)).join(''));
  for (const stat of TEAM_PROP_STATS) {
    const row = DISP_GRID.map((d) => score(stat, TEAM_MODEL_CONSTANTS[stat].priorGames, d).toFixed(4).padStart(8));
    console.log(`  ${stat.padEnd(18)}${row.join('')}`);
  }

  console.log('\n  best (prior, dispersion) per stat by grid search');
  const fitted: Array<{ stat: TeamStatKey; prior: number; dispersion: number; brier: number }> = [];
  for (const stat of TEAM_PROP_STATS) {
    let best = { prior: TEAM_MODEL_CONSTANTS[stat].priorGames, dispersion: TEAM_MODEL_CONSTANTS[stat].dispersion, brier: 1 };
    for (const prior of PRIOR_GRID) {
      for (const dispersion of DISP_GRID) {
        const brier = score(stat, prior, dispersion);
        if (brier < best.brier) best = { prior, dispersion, brier };
      }
    }
    fitted.push({ stat, ...best });
    console.log(
      `  ${stat.padEnd(18)} prior ${String(best.prior).padStart(3)}  dispersion ${best.dispersion.toFixed(2)}` +
      `  Brier ${best.brier.toFixed(4)}   (shipped: prior ${TEAM_MODEL_CONSTANTS[stat].priorGames}, ` +
      `dispersion ${TEAM_MODEL_CONSTANTS[stat].dispersion})`,
    );
  }

  console.log('\n  The prior IS searched honestly here: the line is re-derived from the shrunk mean');
  console.log('  at each grid point, so a prior that changes gets a line that matches it.');
  console.log('\n  CALIBRATION PER LINE at the fitted point -- the table that finds bugs');
  console.log('  stat                line   n     predicted  realised');
  for (const stat of TEAM_PROP_STATS) {
    const best = fitted.find((f) => f.stat === stat)!;
    const byLine = new Map<number, { n: number; p: number; hit: number }>();
    for (const o of observations) {
      if (o.stat !== stat) continue;
      const mean = shrunkPerGame(o.total, o.gamesPlayed, o.leagueRate, best.prior);
      for (const line of ladderFor(stat, mean)) {
        const row = byLine.get(line) ?? { n: 0, p: 0, hit: 0 };
        row.n += 1;
        row.p += overProbability(mean, line, best.dispersion);
        row.hit += o.actual > line ? 1 : 0;
        byLine.set(line, row);
      }
    }
    Array.from(byLine.entries()).sort((a, b) => a[0] - b[0]).forEach(([line, row]) => {
      console.log(
        `  ${stat.padEnd(18)} ${String(line).padStart(5)}  ${String(row.n).padStart(5)}` +
        `   ${(row.p / row.n).toFixed(3).padStart(8)}  ${(row.hit / row.n).toFixed(3).padStart(8)}`,
      );
    });
  }

  console.log('\n  PLACEHOLDERS ARE NOT SHIPPABLE ON THESE NUMBERS -- copy the fitted values into');
  console.log('  TEAM_MODEL_CONSTANTS, then gate them with tools/verifyTeamProps.ts.');
};

interface TeamTotals {
  gamesPlayed: number;
  by: Record<TeamStatKey, number>;
}

/** A club's season totals, summed from its OWN batters' aggregates. */
const buildTeamSeasonTotals = (
  batting: Map<string, PlayerSeasonBatting>,
  rosterByTeam: Map<string, string[]>,
  teams: Team[],
): Map<string, TeamTotals> => {
  const totals = new Map<string, TeamTotals>();
  teams.forEach((team) => {
    const by = {
      teamRuns: 0, teamHits: 0, teamWalks: 0, teamStrikeouts: 0,
      teamExtraBaseHits: 0, teamTotalBases: 0,
    } as Record<TeamStatKey, number>;
    const ids = rosterByTeam.get(team.id) ?? [];
    ids.forEach((playerId) => {
      const row = batting.get(playerId);
      if (!row) return;
      by.teamHits += row.hits;
      by.teamWalks += row.walks;
      by.teamStrikeouts += row.strikeouts;
      by.teamExtraBaseHits += row.doubles + row.triples + row.homeRuns;
      by.teamTotalBases += row.hits + row.doubles + 2 * row.triples + 3 * row.homeRuns;
    });
    // Runs come from the team record rather than the batters, because a run is a
    // scoring event and summing batter runs is exactly the inference that could
    // disagree with the scoreboard.
    by.teamRuns = team.runsScored;
    totals.set(team.id, { gamesPlayed: team.wins + team.losses, by });
  });
  return totals;
};

const leagueTeamRates = (totals: Map<string, TeamTotals>): Record<TeamStatKey, number> => {
  let games = 0;
  const sum: Record<TeamStatKey, number> = {
    teamRuns: 0, teamHits: 0, teamWalks: 0, teamStrikeouts: 0,
    teamExtraBaseHits: 0, teamTotalBases: 0,
  };
  totals.forEach((row) => {
    games += row.gamesPlayed;
    (Object.keys(sum) as TeamStatKey[]).forEach((stat) => { sum[stat] += row.by[stat]; });
  });
  const out = {} as Record<TeamStatKey, number>;
  (Object.keys(sum) as TeamStatKey[]).forEach((stat) => {
    out[stat] = games > 0 ? sum[stat] / games : 0;
  });
  return out;
};

void main();
