/**
 * Is the betting layer actually honest?
 *
 * Three things have to hold for a market with money on it, and none of them are
 * visible from the UI:
 *
 *   1. The house cannot be beaten by doing nothing. If the margin is wrong, or
 *      if the favourite's price is mis-scaled, then always backing the favourite
 *      turns a profit, and the game is broken rather than hard.
 *   2. Settlement must agree with the simulation. A bet is only meaningful if the
 *      engine that decides it is the engine that produced the numbers, so every
 *      bet is settled from the real game object rather than from a re-derivation.
 *   3. The outlets must actually be worth telling apart. If the three prices are
 *      nearly identical there is no decision to make, and the whole premise of
 *      betting against a forecaster quietly stops being true.
 *
 *   npx tsx tools/verifyBetting.ts 1337 2
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters, getTeamRosterStrength } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { buildGameLine, probabilityToAmerican } from '../src/lib/mediaOdds';
import { buildTotalMarkets } from '../src/lib/mediaMarkets';
import { createWallet, placeBet, settleWallet, settleReturn, STARTING_BALANCE } from '../src/lib/wallet';
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import type { Game } from '../src/types';

const SEED = Number(process.argv[2] ?? 1337);
const SEASONS = Number(process.argv[3] ?? 2);
const START_YEAR = 2026;

const buildSchedule = (roster: typeof INITIAL_TEAMS, year: number) =>
  generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180 });

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);

const brier = (samples: Array<{ probability: number; hit: boolean }>): number =>
  mean(samples.map((s) => (s.probability - (s.hit ? 1 : 0)) ** 2));

const fmt = (value: number): string => (value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2));

/** Play a season of always-backing-one-side strategies, to see if the house holds. */
const runStrategy = (
  games: Array<{ game: Game; awayId: string; homeId: string; awayProbability: number }>,
  pick: (probability: number) => 'away' | 'home',
  stakeOf: (balance: number) => number,
): { balance: number; bets: number } => {
  let balance = STARTING_BALANCE;
  let bets = 0;
  games.forEach(({ game, awayId, homeId, awayProbability }) => {
    const choice = pick(awayProbability);
    // Use the same conversion the app posts with. An earlier version re-derived
    // the price here and got the sign backwards, which handed the bettor the
    // favourite at +67 on a 60 per cent side and made a sound book look broken
    // by twenty-one thousand dollars.
    const price = probabilityToAmerican(choice === 'away' ? awayProbability : 1 - awayProbability);
    if (!Number.isFinite(price) || price === 0 || price <= -1000 || price >= 1000) return;
    const stake = Math.min(stakeOf(balance), balance);
    if (stake < 5) return;

    const awayWon = game.score.away > game.score.home;
    const won = (choice === 'away') === awayWon;
    balance -= stake;
    balance += settleReturn(stake, price, won);
    bets += 1;
  });
  return { balance, bets };
};

const main = async (): Promise<void> => {
  const samples: Array<{ probability: number; hit: boolean }> = { } as never;
  const perOutlet: Record<MediaId, Array<{ probability: number; hit: boolean }>> = {
    hollis: [], glorest: [], sharply: [],
  };
  const totals: Array<{ line: number; over: boolean }> = [];
  const playedGames: Array<{ game: Game; awayId: string; homeId: string; awayProbability: number }> = [];
  const spreads: number[] = [];
  let games = 0;

  void samples;

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const built = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year, seed: SEED, effectiveDate: `${year}-12-15`,
    });
    const playerState = built.playerState;
    const teams = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      playerState, year,
    );
    const schedule = buildSchedule(teams, year);

    const manager = new SimulationManager({
      teams, games: schedule, playerState, settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state = await manager.run({ scope: 'week' });

    for (let guard = 0; guard < 220; guard += 1) {
      const slateDate = state.currentDate;
      const teamById = new Map(state.teams.map((t) => [t.id, t]));
      const { scores, spread } = buildMediaReads({
        teams: state.teams,
        players: state.playerState.players,
        battingRatings: state.playerState.battingRatings,
        pitchingRatings: state.playerState.pitchingRatings,
        battingStats: state.playerState.battingStats,
        pitchingStats: state.playerState.pitchingStats,
        playerState: state.playerState,
        seasonYear: year,
      });

      // Z-score the roster strength properly, exactly as the page does. A mean
      // of zero and a spread of one here would silently make the diagnostic
      // measure a different model from the one that ships.
      const strength = getTeamRosterStrength(state.teams, state.playerState, year);
      const strengthValues = [...strength.values()];
      const strengthMean = strengthValues.reduce((s, v) => s + v, 0) / Math.max(1, strengthValues.length);
      const strengthSd = Math.sqrt(
        strengthValues.reduce((s, v) => s + (v - strengthMean) ** 2, 0) / Math.max(1, strengthValues.length),
      );

      const lines = buildTotalMarkets(
        state.games.filter((g) => g.date === slateDate && g.status !== 'completed'),
        {
          teams: state.teams,
          strength, strengthMean, strengthSd,
          hasSeasonOutput: state.teams.some((t) => t.wins + t.losses > 0),
        },
        teamById,
      );

      const pending = state.games
        .filter((game) => game.date === slateDate)
        .map((game) => {
          const away = teamById.get(game.awayTeam);
          const home = teamById.get(game.homeTeam);
          if (!away || !home) return null;
          const scoreFor = (teamId: string) => ({
            hollis: scores.hollis.get(teamId) ?? 0.5,
            glorest: scores.glorest.get(teamId) ?? 0.5,
            sharply: scores.sharply.get(teamId) ?? 0.5,
          });
          return buildGameLine({
            game, away, home,
            awayScores: scoreFor(away.id), homeScores: scoreFor(home.id), spread,
          });
        })
        .filter((line): line is NonNullable<typeof line> => line !== null);

      state = await manager.run({ scope: 'day' });

      pending.forEach((line) => {
        const game = state.games.find((g) => g.gameId === line.gameId);
        if (!game || game.status !== 'completed') return;
        games += 1;

        const awayWon = game.score.away > game.score.home;
        playedGames.push({
          game, awayId: line.awayTeam.id, homeId: line.homeTeam.id,
          awayProbability: line.consensusProbability,
        });

        MEDIA_PROFILES.forEach((profile) => {
          perOutlet[profile.id].push({ probability: line.probability[profile.id], hit: awayWon });
        });
        spreads.push(line.disagreement);
      });

      lines.forEach((market) => {
        const game = state.games.find((g) => g.gameId === market.key.replace('total:', ''));
        if (!game || game.status !== 'completed') return;
        const actual = game.score.away + game.score.home;
        totals.push({ line: market.houseLine, over: actual > market.houseLine });
      });
    }
  }

  console.log(`seed ${SEED}   ${SEASONS} seasons   ${games} games\n`);

  /* ---------------- 1. the house holds ---------------- */

  console.log('1. CAN THE HOUSE BE BEATEN BY DOING NOTHING?');
  console.log('   Flat $25 on one side of every game, full season(s).\n');
  const strategies: Array<[string, (p: number) => 'away' | 'home', (b: number) => number]> = [
    ['always the favourite', (p) => (p >= 0.5 ? 'away' : 'home'), () => 25],
    ['always the underdog', (p) => (p >= 0.5 ? 'home' : 'away'), () => 25],
    ['the consensus side', (p) => (p >= 0.5 ? 'away' : 'home'), (b) => Math.min(25, b)],
    ['all-in favourite', (p) => (p >= 0.5 ? 'away' : 'home'), (b) => b],
  ];
  console.log('   strategy                 bets   final bankroll   net');
  strategies.forEach(([label, pick, stakeOf]) => {
    const { balance, bets } = runStrategy(playedGames, pick, stakeOf);
    console.log(
      `   ${label.padEnd(24)}${String(bets).padStart(5)}` +
      `${String(Math.round(balance)).padStart(17)}${fmt(balance - STARTING_BALANCE).padStart(9)}`,
    );
  });
  console.log('   A strategy that nets positive across thousands of games is a broken book,');
  console.log('   not a strategy. Flat betting the favourite is the sharpest test here.');

  /* ---------------- 2. settlement agrees with the sim ---------------- */

  console.log('\n2. DOES SETTLEMENT AGREE WITH THE SIMULATION?');
  // Replay the season through the wallet and compare the bankroll to the
  // directly-computed result of the same bets.
  const replayWallet = createWallet();
  let replaySettled = 0;
  let replayMismatch = 0;
  let replayMoneyMismatch = 0;
  let balanceBefore = STARTING_BALANCE;

  playedGames.forEach(({ game, awayId, homeId, awayProbability }) => {
    const pick: 'away' | 'home' = awayProbability >= 0.5 ? 'away' : 'home';
    const price = probabilityToAmerican(pick === 'away' ? awayProbability : 1 - awayProbability);
    const placed = placeBet(replayWallet, {
      kind: 'moneyline',
      marketKey: game.gameId,
      marketTitle: 'replay',
      selection: pick,
      selectionLabel: pick,
      stake: 5,
      price,
      placedOn: game.date,
      backedMedia: null,
    });
    if ('error' in placed) return;
    const next = settleWallet(placed.wallet, {
      games: [game], teams: [], currentDate: game.date,
      seasonComplete: false, seasonWinners: null, awardWinners: null,
    });
    const bet = next.bets[0];
    if (bet.status === 'open') return;
    replaySettled += 1;

    // The right question is whether the wallet's verdict matches the score, not
    // whether the bet happened to pick the winning side. An earlier version of
    // this test asked the second thing and reported a quarter of the season as a
    // settlement failure, which was the test being wrong rather than the wallet.
    const awayWon = game.score.away > game.score.home;
    const shouldHaveWon = (pick === 'away') === awayWon;
    const didWin = bet.status === 'won';
    if (shouldHaveWon !== didWin) replayMismatch += 1;

    // And the money must match: a winning bet pays stake plus the price, a
    // losing one pays nothing.
    const expectedBalance = balanceBefore - 5 + (shouldHaveWon ? settleReturn(5, price, true) : 0);
    if (Math.abs(next.balance - expectedBalance) > 0.001) replayMoneyMismatch += 1;
    balanceBefore = next.balance;

    void awayId; void homeId;
    Object.assign(replayWallet, next);
  });

  console.log(`   bets replayed            ${replaySettled}`);
  console.log(`   settled                  ${replayWallet.bets.filter((b) => b.status !== 'open').length}`);
  console.log(`   verdict mismatches       ${replayMismatch}   <- must be 0`);
  console.log(`   money mismatches         ${replayMoneyMismatch}   <- must be 0`);
  console.log(`   bankroll after replay    $${Math.round(replayWallet.balance)}`);

  /* ---------------- 3. are the outlets worth telling apart ---------------- */

  console.log('\n3. ARE THE THREE OUTLETS WORTH TELLING APART?');
  console.log('outlet              brier   vs coin flip   mean gap to the other two');
  const consensusSamples: Array<{ probability: number; hit: boolean }> = [];
  playedGames.forEach(({ game, awayProbability }) => {
    consensusSamples.push({ probability: awayProbability, hit: game.score.away > game.score.home });
  });
  MEDIA_PROFILES.forEach((profile) => {
    const score = brier(perOutlet[profile.id]);
    const gaps = MEDIA_PROFILES
      .filter((other) => other.id !== profile.id)
      .map((other) => mean(perOutlet[profile.id].map((s, i) => Math.abs(s.probability - perOutlet[other.id][i].probability))));
    console.log(
      `  ${profile.outlet.padEnd(20)}${score.toFixed(4)}` +
      `${fmt(score - 0.25).padStart(15)}${fmt(Math.min(...gaps)).padStart(28)}`,
    );
  });
  console.log(`  ${'consensus'.padEnd(22)}${brier(consensusSamples).toFixed(4)}${fmt(brier(consensusSamples) - 0.25).padStart(15)}`);
  console.log('  A coin flip scores 0.2500. Negative is better than guessing.');

  /* ---------------- 4. the margin, measured ---------------- */

  console.log('\n4. IS THE CONSENSUS CALIBRATED, AND WHERE IS IT NOT?');
  console.log('   Binned by the posted probability of the side that was backed.');
  console.log('   The moneyline margin is 2.25 points off the favourite, so a');
  console.log('   correctly priced book should sit about that far below even in the');
  console.log('   favourite band and above even in the underdog band.\n');
  console.log('   band          n     posted   actual   gap    standard error');
  const BANDS: Array<[number, number, string]> = [
    [0.80, 1.01, '80-100%'],
    [0.65, 0.80, '65-80%'],
    [0.575, 0.65, '57.5-65%'],
    [0.525, 0.575, '52.5-57.5%'],
    [0.50, 0.525, '50-52.5%'],
    [0.475, 0.50, '47.5-50%'],
    [0.425, 0.475, '42.5-47.5%'],
    [0.35, 0.425, '35-42.5%'],
    [0.20, 0.35, '20-35%'],
    [0, 0.20, 'under 20%'],
  ];
  BANDS.forEach(([lo, hi, label]) => {
    const all = playedGames.filter(({ awayProbability }) => {
      const backed = awayProbability >= 0.5 ? awayProbability : 1 - awayProbability;
      return backed >= lo && backed < hi;
    });
    if (all.length === 0) return;
    const posted = mean(all.map(({ awayProbability }) => (awayProbability >= 0.5 ? awayProbability : 1 - awayProbability)));
    const hits = all.filter(({ awayProbability, game }) =>
      (awayProbability >= 0.5) === (game.score.away > game.score.home)).length;
    const actual = hits / all.length;
    const error = Math.sqrt(Math.max(1e-9, actual * (1 - actual) / all.length));
    const gap = actual - posted;
    const flagged = Math.abs(gap) > 2 * error ? '  <-- mispriced' : '';
    console.log(
      `   ${label.padEnd(13)}${String(all.length).padStart(5)}${posted.toFixed(3).padStart(10)}` +
      `${actual.toFixed(3).padStart(10)}${fmt(gap * 100).padStart(8)}${fmt(error * 100).padStart(18)}${flagged}`,
    );
  });

  console.log('\n5. RUN TOTALS AGAINST THE POSTED LINE');
  const overCount = totals.filter((t) => t.over).length;
  const overRate = overCount / Math.max(1, totals.length);
  console.log(`  games                       ${totals.length}`);
  console.log(`  over rate                   ${overRate.toFixed(4)}`);
  console.log(`  expected for a +0.25 margin  ~0.46 -- a quarter run of margin on a`);
  console.log('  roughly three-run standard deviation should cost about four points.');

  // A verdict, not just a number, because a rate on its own does not say
  // whether the line is mispriced or the games were merely high scoring.
  const deficit = overRate - 0.5;
  const marginExpected = -0.04;
  const tolerance = 0.02;
  if (overRate > 0.5 + tolerance) {
    console.log('\n  FAIL  the line is set too low. Backing the over is a standing');
    console.log('        profit, so the totals market is not a market.');
  } else if (Math.abs(deficit - marginExpected) <= tolerance) {
    console.log('\n  PASS  the over rate sits about where the stated margin predicts.');
  } else {
    console.log(`\n  CHECK  over rate is ${(deficit * 100).toFixed(1)} points from even against an`);
    console.log(`        expected ${(marginExpected * 100).toFixed(1)}, so either the line is`);
    console.log('        off-centre or the sample is not what the margin assumes.');
  }
};

void main();
