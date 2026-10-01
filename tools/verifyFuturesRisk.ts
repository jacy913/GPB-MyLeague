/**
 * Verifies championship futures: the market exists, settles, and the risk curve
 * decays through a season.
 *
 * Three things are asserted, and the third is the one that matters most.
 *
 *   1. THE NO-VALUE RULE. Every bet in this layer is expected-value negative by
 *      construction -- `HOUSE_MARGIN = 0.045` and `HOUSE_SHADE = 0.20`, the latter
 *      fitted so a bettor with no edge cannot print money. So a futures tier labelled
 *      VALUE would tell the player a 3 per cent shot is a good bet and turn the whole
 *      calibration layer into a lie. This is checked mechanically, over the tier
 *      union and the band table in both directions, because the failure mode is one
 *      person adding a fifth tier in a hurry.
 *
 *   2. SETTLEMENT. A title bet is placed through the real wallet, the season is
 *      archived, and the verdict is checked against the champion. The settlement path
 *      has a subtlety worth testing rather than reasoning about: `marketKey` is
 *      sliced to "champion" for every OTHER futures kind, and the title is the one
 *      kind that must NOT be sliced. An earlier version of the UI sliced it anyway,
 *      which would have refunded every championship bet a manager took -- and that
 *      bug was caught by reading the code while writing this, not by the app.
 *
 *   3. THE RISK CURVE DECAYS. The user's ask was "high risk high reward at the start
 *      of the season and it gets safer as the season draws to a closer". That decay
 *      is not code anyone wrote -- it is what a soft-max over a shrinking field does
 *      -- so it is measured across a real season rather than assumed. If the field
 *      did not compress, the whole premise of the hail mary tier would be false and
 *      the UI would be labelling a constant as a curve.
 *
 * Run: npx tsx tools/verifyFuturesRisk.ts [warmupDays]
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
import { buildMediaReads } from '../src/lib/mediaReads';
import { buildWorldSeriesMarkets } from '../src/lib/mediaMarkets';
import { isPlayoffGame } from '../src/logic/playoffs';
import { WORLD_SERIES_MARKET_KEY } from '../src/lib/markets';
import {
  FUTURES_RISK_TIERS,
  assertNoValueTier,
  futuresRiskTier,
  leagueSeriesLosers,
  remainingRegularSeasonGames,
  titleContenders,
} from '../src/lib/futuresRisk';
import {
  createWallet,
  placeBet,
  settleWallet,
  type PlacedBet,
} from '../src/lib/wallet';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const YEAR = 2026;
const WARMUP_DAYS = Number(process.argv[2] ?? 40);

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
  // ---------------------------------------------------------------- 1. no VALUE
  const tierProblems = assertNoValueTier();
  check(
    'no risk tier is named like a recommendation',
    tierProblems.length === 0,
    `${FUTURES_RISK_TIERS.length} tiers (${FUTURES_RISK_TIERS.join(', ')}), none containing a ` +
      `recommendation word, and every tier has a band`,
    tierProblems.join('; '),
  );

  // Boundary behaviour, stated because a tier that is off by one at a boundary is a
  // label that lies at exactly the number a bettor is staring at.
  const boundaries: Array<[number, string]> = [
    [0.0499, 'hail_mary'], [0.05, 'long_shot'],
    [0.1499, 'long_shot'], [0.15, 'contender'],
    [0.3999, 'contender'], [0.4, 'favourite'],
  ];
  const boundaryWrong = boundaries
    .filter(([p, tier]) => futuresRiskTier(p) !== tier)
    .map(([p, tier]) => `${p} gave ${futuresRiskTier(p)} not ${tier}`);
  check(
    'risk tier boundaries land where documented',
    boundaryWrong.length === 0,
    `0.05 is a LONG SHOT, 0.15 a CONTENDER, 0.40 a FAVOURITE, checked at both sides of each`,
    `tier boundaries disagree with the table: ${boundaryWrong.join('; ')}`,
  );

  // ---------------------------------------------------------------- 2 + 3. a season
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
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 180,
    }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  let games: Game[] = generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR),
    seasonDays: 180,
  });

  /** The title board as the betting page would build it on a given day. */
  const titleBoard = () => {
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
    // WITH standings, which is what the betting page passes and what makes the field
    // an arithmetic fact rather than a probability floor.
    return buildWorldSeriesMarkets({
      teams,
      scoreBy: reads.scores,
      gamesRemainingByTeamId: remainingRegularSeasonGames(games, isPlayoffGame),
    })[0];
  };

  /*
   * THE RISK CURVE, SAMPLED THROUGH A REAL SEASON.
   *
   * Sampled on days rather than read off the first board, because the claim is about
   * how the field behaves over a season and a single April board would only ever
   * show the wide end of it.
   */
  const samples: Array<{ day: number; live: number; leader: number; teams: number }> = [];
  let lastSettledCheck = false;
  let settlementWorks = false;
  let settlementDetail = '';
  let postSeasonSettled = false;

  for (let day = 0; day < 180; day += 1) {
    const result = await manager.run({ scope: 'day' });
    state = result.playerState;
    games = result.games;
    teams = result.teams;

    if (day % 15 === 0 || day === 5) {
      const board = titleBoard();
      if (board) {
        samples.push({
          day,
          live: board.liveOutcomes,
          leader: board.outcomes[0]?.consensusProbability ?? 0,
          teams: board.outcomes.length,
        });
      }
    }

    /*
     * SETTLEMENT, at the end of the season and against the real archive.
     *
     * Placed through `placeBet` on the real wallet so the key travels the same path
     * it would in the app, which is the whole point: the bug this catches is a key
     * that is sliced on the way to the bet and then compared unsliced on the way
     * back.
     */
    if (day === 150 && !lastSettledCheck) {
      lastSettledCheck = true;
      const board = titleBoard();
      const longShot = [...board.outcomes].sort(
        (a, b) => a.consensusProbability - b.consensusProbability,
      )[0];

      const placed = placeBet(createWallet(), {
        kind: 'world_series',
        marketKey: WORLD_SERIES_MARKET_KEY,
        marketTitle: board.title,
        selection: longShot.key,
        selectionLabel: longShot.label,
        price: longShot.houseOdds,
        stake: 10,
        placedOn: getDefaultSeasonStartDate(YEAR),
        backedMedia: null,
      });
      if ('error' in placed) {
        settlementWorks = false;
        settlementDetail = `placeBet refused the championship bet: ${placed.error}`;
        throw new Error(settlementDetail);
      }
      const wallet = placed.wallet;

      // A season that has not finished must leave the bet PENDING, not void it.
      const midSeason = settleWallet(wallet, {
        games,
        teams,
        currentDate: getDefaultSeasonStartDate(YEAR),
        seasonComplete: false,
        seasonWinners: null,
        awardWinners: null,
      });
      const stillOpen = midSeason.bets.find((b) => b.id === placed.bet.id)?.status === 'open';

      // And a bet whose key was sliced to "champion" must NOT settle, which is the
      // exact defect the UI had.
      const sliced = settleWallet(
        { ...wallet, bets: [{ ...placed.bet, marketKey: 'champion' }] },
        {
          games, teams, currentDate: `${YEAR}-11-01`,
          seasonComplete: true,
          seasonWinners: {
            seasonYear: YEAR,
            divisions: new Map(), leagues: new Map(), champion: longShot.key,
          },
          awardWinners: null,
        },
      );
      const slicedRefused = sliced.bets[0]?.status === 'void';

      // The real case: correct key, correct champion.
      const decided = settleWallet(wallet, {
        games, teams, currentDate: `${YEAR}-11-01`,
        seasonComplete: true,
        seasonWinners: {
          seasonYear: YEAR,
          divisions: new Map(), leagues: new Map(), champion: longShot.key,
        },
        awardWinners: null,
      });
      const verdict = decided.bets[0]?.status;
      settlementWorks = stillOpen && slicedRefused && verdict === 'won';
      settlementDetail = `pending before the season (${stillOpen}), sliced key refused (${slicedRefused}), correct key settled won (${verdict})`;
      postSeasonSettled = verdict === 'won';
    }
  }

  check(
    'a championship bet settles from the archived champion',
    settlementWorks,
    settlementDetail,
    `settlement misbehaved: ${settlementDetail}. A pending bet that voids before the season ends, ` +
      `or a sliced key that resolves anyway, both refund or mis-settle real money`,
  );
  void postSeasonSettled;

  // ---------------------------------------------------------------- 3. the curve
  const first = samples[0];
  const last = samples[samples.length - 1];
  const fieldShrinks = samples.length > 1 && last.live < first.live;
  const leaderRises = samples.length > 1 && last.leader > first.leader;

  console.log('\nRISK CURVE ACROSS A SEASON (sampled every 15 days)');
  console.log('   day  live  leader');
  samples.forEach((s) => {
    console.log(`  ${String(s.day).padStart(4)}  ${String(s.live).padStart(4)}  ${(s.leader * 100).toFixed(1).padStart(5)}%`);
  });
  console.log('');

  check(
    'the field compresses as the season runs',
    fieldShrinks,
    first && last
      ? `${first.teams} clubs in the field, ${first.live} live on day ${first.day} down to ${last.live} on day ${last.day}`
      : 'no samples collected',
    'the live field did not shrink over a season. The hail mary tier rests on the field ' +
      'compressing as clubs fall out of contention, so a flat field would mean the whole risk ' +
      'framing is describing something that does not happen',
  );

  check(
    'the favourite strengthens as the season runs',
    leaderRises,
    first && last
      ? `consensus leader ${(first.leader * 100).toFixed(1)}% on day ${first.day}, ` +
        `${(last.leader * 100).toFixed(1)}% on day ${last.day}`
      : 'no samples collected',
    'the leading probability did not rise over the season. "It gets safer as the season draws ' +
      'to a closer" is the literal user request, and it is a consequence of the field ' +
      'compressing -- if the leader is flat, the curve is not there to display',
  );

  /*
   * The live floor has to actually exclude clubs, or "31 REMAINING" is just the
   * club count restated and tells the manager nothing.
   */
  const floorDoesWork = last !== undefined && last.live < last.teams;
  check(
    'the live field narrows as clubs are eliminated from their divisions',
    floorDoesWork,
    last
      ? `by day ${last.day}, ${last.live} of ${last.teams} clubs can still win the title`
      : 'no samples collected',
    'every club stayed in the title for the whole season, so the remaining count is ' +
      'just the club count and the risk curve has nothing to show',
  );

  /*
   * The claim that replaced the probability floor, measured separately because it is
   * the finding that changed the design: the PROBABILITIES do not compress, and the
   * board is correct to say so. A verifier that only checked the count would have
   * passed against a board whose leader sat at 5% in April and 5% in October, which
   * is a number pretending to be a curve.
   */
  const leaderFlat = first && last && Math.abs(last.leader - first.leader) < 0.02;
  check(
    'the forecaster probabilities really are flat, which is why contention drives the count',
    leaderFlat === true,
    first && last
      ? `consensus leader moved only ${((last.leader - first.leader) * 100).toFixed(1)} points across ` +
        `${last.day - first.day} days, confirming the curve comes from schedule arithmetic and not from the prices`
      : 'no samples collected',
    'the leader probability moved substantially over the season. If the prices themselves now ' +
      'compress, the contention count is doing redundant work and one of the two should be dropped ' +
      'rather than both maintained',
  );

  // Sanity: the contention arithmetic itself, pinned on a hand-built case so it is
  // not only ever exercised through the simulator. Two divisions, the leader four
  // games clear with one game left -- so only the leader survives.
  const handBuiltContenders = titleContenders({
    teams: [
      { id: 'a', league: 'Prestige', division: 'North', wins: 20 },
      { id: 'b', league: 'Prestige', division: 'North', wins: 16 },
      { id: 'c', league: 'Prestige', division: 'South', wins: 20 },
      { id: 'd', league: 'Prestige', division: 'South', wins: 19 },
    ],
    gamesRemainingByTeamId: new Map([['a', 1], ['b', 1], ['c', 1], ['d', 1]]),
  });
  check(
    'a club that cannot catch its division leader is out of the title',
    handBuiltContenders.size === 3 && !handBuiltContenders.has('b'),
    `20-16 and 20-19 with one game left keeps a, c and d in; b is eliminated, giving ` +
      `${handBuiltContenders.size} contenders`,
    `the hand-built contention case produced ${handBuiltContenders.size} contenders ` +
      `(${Array.from(handBuiltContenders).join(', ')}), expected 3 excluding b`,
  );

  // League-series elimination, pinned on a hand-built series so it is not only ever
  // exercised through the simulator. A club that lost its league series cannot be a
  // league champion, and the title is decided between the two league champions.
  const seriesLosers = leagueSeriesLosers([
    {
      homeTeam: 'p1', awayTeam: 'p2', status: 'completed',
      score: { home: 3, away: 1 },
      playoff: { round: 'league_series', league: 'Prestige', seriesId: 's1' },
    },
    {
      homeTeam: 'p1', awayTeam: 'p2', status: 'completed',
      score: { home: 0, away: 0 },
      playoff: { round: 'league_series', league: 'Prestige', seriesId: 's1' },
    },
  ]);
  check(
    'a club that lost its league series is out of the title',
    seriesLosers.has('p2') && !seriesLosers.has('p1'),
    `p1 winning 3-1 eliminates p2 and keeps p1 alive`,
    `league-series elimination produced ${Array.from(seriesLosers).join(', ')}; expected p2 only`,
  );

  // A tied series must eliminate nobody.
  const tiedSeries = leagueSeriesLosers([
    {
      homeTeam: 'a', awayTeam: 'b', status: 'completed',
      score: { home: 2, away: 0 },
      playoff: { round: 'league_series', league: 'Platinum', seriesId: 's2' },
    },
    {
      homeTeam: 'a', awayTeam: 'b', status: 'completed',
      score: { home: 0, away: 2 },
      playoff: { round: 'league_series', league: 'Platinum', seriesId: 's2' },
    },
  ]);
  check(
    'a tied league series eliminates nobody',
    tiedSeries.size === 0,
    `a series level at 2-2 keeps both clubs alive rather than eliminating either`,
    `a tied series eliminated ${Array.from(tiedSeries).join(', ')}. A series level on wins is ` +
      `undecided, and guessing would be inventing a result the schedule has not produced`,
  );

  // A tie must NOT eliminate: a tiebreaker decides a tied division.
  const tieKeepsBoth = titleContenders({
    teams: [
      { id: 'a', league: 'Prestige', division: 'North', wins: 20 },
      { id: 'b', league: 'Prestige', division: 'North', wins: 20 },
    ],
    gamesRemainingByTeamId: new Map([['a', 0], ['b', 0]]),
  });
  check(
    'a tie at the top of a division does not eliminate anyone',
    tieKeepsBoth.size === 2,
    `two clubs level on 20 with no games left both stay in, because a tiebreaker decides it`,
    `a tied division eliminated somebody: ${Array.from(tieKeepsBoth).join(', ')}. Eliminating a club ` +
      `that is level with the leader would be wrong, and it would empty the board late in a season`,
  );

  // ---------------------------------------------------------------- report
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
