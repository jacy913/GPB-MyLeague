/**
 * Which total-bases formula does the persisted `ops` actually agree with?
 *
 * LeadersHub.tsx:37-46 says its total-bases formula is copied from
 * playerStats.ts "so a leaderboard can never disagree with the OPS it sits
 * beside". That is the claim to test. The two are not the same expression:
 *
 *   playerStats.ts:116  singles = hits - doubles - triples - homeRuns
 *   playerStats.ts:117  totalBases = singles + 2*d + 3*t + 4*h
 *                      which expands to  hits + 1*d + 2*t + 3*h
 *
 *   LeadersHub.tsx:46   totalBases = hits + 2*d + 3*t + 3*h
 *
 * The difference is exactly (doubles + triples). Expanded by hand it is easy to
 * be wrong about which one is correct, so this measures instead: for every
 * player in a real season, take the persisted `ops`, subtract the persisted
 * `avg` to recover the engine's own slugging figure, and see which candidate
 * reproduces it.
 *
 * Recovering SLG from ops is only valid because the accumulator computes
 * ops = obp + slg exactly (playerStats.ts:126) and both are rounded to 3dp, so
 * the recovered value carries up to +/-0.001 of rounding. That tolerance is
 * stated and asserted rather than assumed.
 *
 * Run: npx tsx tools/probeTotalBases.ts [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import type { Game, GameParticipantsSnapshot, PlayerSeasonBatting } from '../src/types';

const DAYS = Number(process.argv[2] ?? 45);
const YEAR = 2026;
const SEED = 4242;

/** playerStats.ts:116-117, expanded. */
const accumulatorTotalBases = (s: PlayerSeasonBatting): number => {
  const singles = Math.max(0, s.hits - s.doubles - s.triples - s.homeRuns);
  return singles + s.doubles * 2 + s.triples * 3 + s.homeRuns * 4;
};

/** LeadersHub.tsx:46, verbatim. */
const leaderboardTotalBases = (s: PlayerSeasonBatting): number =>
  s.hits + s.doubles * 2 + s.triples * 3 + s.homeRuns * 3;

const main = async (): Promise<void> => {
  const playerState = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;
  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    playerState,
    YEAR,
  );
  const startDate = getDefaultSeasonStartDate(YEAR);
  const schedule = generateSchedule(teams, { seasonStartDate: startDate, seasonDays: 180 });
  const mgr = new SimulationManager({
    teams,
    games: schedule,
    playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: startDate,
  });

  // Latest pre-game snapshot per player: the biggest sample each player has.
  const latest = new Map<string, { atBats: number; stat: PlayerSeasonBatting }>();
  const seen = new Set<string>();
  let games = 0;

  for (let day = 0; day < DAYS; day += 1) {
    const result = await mgr.run({ scope: 'day' });
    result.games.forEach((game: Game) => {
      if (game.status !== 'completed' || game.phase !== 'regular_season' || seen.has(game.gameId)) return;
      seen.add(game.gameId);
      games += 1;
      const raw = game.stats?.participants;
      if (typeof raw !== 'string' || raw.length === 0) return;
      const participants = JSON.parse(raw) as GameParticipantsSnapshot;
      [...participants.awayLineup, ...participants.homeLineup].forEach((batter) => {
        if (!batter.battingStat) return;
        const current = latest.get(batter.playerId);
        if (!current || batter.battingStat.atBats > current.atBats) {
          latest.set(batter.playerId, { atBats: batter.battingStat.atBats, stat: batter.battingStat });
        }
      });
    });
  }

  // Both stored rates are rounded to 3dp (playerStats.ts:125-126), so a
  // recovered SLG can differ from the true one by up to 0.001.
  const TOLERANCE = 0.001;
  const rows = Array.from(latest.values()).filter((r) => r.stat.atBats > 0 && r.stat.ops > 0);
  let accumulatorMatches = 0;
  let leaderboardMatches = 0;
  let bothMatch = 0;
  const disagreements: Array<{ id: string; recovered: number; accumulator: number; leaderboard: number }> = [];

  rows.forEach(({ stat }) => {
    // ops = obp + slg, and obp is separately recoverable from counts, so
    // slg = ops - (hits + walks) / (atBats + walks).
    const obp = (stat.hits + stat.walks) / (stat.atBats + stat.walks);
    const recoveredSlg = stat.ops - obp;
    const accSlg = accumulatorTotalBases(stat) / stat.atBats;
    const leadSlg = leaderboardTotalBases(stat) / stat.atBats;
    const accOk = Math.abs(accSlg - recoveredSlg) <= TOLERANCE;
    const leadOk = Math.abs(leadSlg - recoveredSlg) <= TOLERANCE;
    if (accOk) accumulatorMatches += 1;
    if (leadOk) leaderboardMatches += 1;
    if (accOk && leadOk) bothMatch += 1;
    if (accOk && !leadOk && disagreements.length < 6) {
      disagreements.push({
        id: stat.playerId,
        recovered: Number(recoveredSlg.toFixed(4)),
        accumulator: Number(accSlg.toFixed(4)),
        leaderboard: Number(leadSlg.toFixed(4)),
      });
    }
  });

  const withExtraBases = rows.filter((r) => r.stat.doubles + r.stat.triples > 0);
  const extraBaseOverstatement = rows.map((r) =>
    (leaderboardTotalBases(r.stat) - accumulatorTotalBases(r.stat)) / r.stat.atBats,
  );
  const worstOverstatement = extraBaseOverstatement.length
    ? Math.max(...extraBaseOverstatement)
    : 0;

  console.log(JSON.stringify({
    measured: { daysSimmed: DAYS, seed: SEED, games, players: rows.length },
    agreementWithPersistedOps: {
      note: 'SLG recovered from the persisted ops by subtracting the separately computable OBP. '
        + `Tolerance ${TOLERANCE} covers the 3dp rounding of both stored rates.`,
      accumulatorFormulaMatches: accumulatorMatches,
      leaderboardFormulaMatches: leaderboardMatches,
      bothMatch,
      playersWithDoublesOrTriples: withExtraBases.length,
    },
    reportedBug: {
      claimUnderTest: 'LeadersHub.tsx:41-43 says its total-bases formula is copied from playerStats.ts '
        + '"so a leaderboard can never disagree with the OPS it sits beside"',
      difference: 'the leaderboard formula exceeds the accumulator formula by exactly (doubles + triples)',
      playersWhereTheTwoFormulasDisagree: rows.length - bothMatch,
      worstSlgOverstatement: Number(worstOverstatement.toFixed(4)),
      sampleDisagreements: disagreements,
      verdict: accumulatorMatches === rows.length && leaderboardMatches < rows.length
        ? 'CONFIRMED: the accumulator formula reproduces the persisted OPS for every player, and the '
          + 'leaderboard formula does not'
        : accumulatorMatches !== rows.length
          ? 'INCONCLUSIVE: the accumulator formula did not reproduce the persisted OPS, so this run '
            + 'cannot adjudicate the claim'
          : 'NOT REPRODUCED: both formulas agree with the persisted OPS in this run',
    },
  }, null, 2));
};

main().catch((error) => {
  console.error('THREW', error);
  process.exit(1);
});
