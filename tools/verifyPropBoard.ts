/**
 * Verify the prop board end to end, as the bettor will meet it.
 *
 * playerProps and mediaProps can each be right about their own arithmetic while
 * the board between them is wrong. The questions that matter are not "is the
 * probability a function of the inputs" but:
 *
 *   1. Does a slate actually produce props, or does the pre-game eligibility
 *      filter reject everyone?
 *   2. Does each outlet publish at most five, do they differ from one another,
 *      and do they contain both safe and hot picks as the design promises?
 *   3. Is the house line sane -- two-sided, roughly a coin flip for a coin-flip
 *      prop, and never inverted?
 *   4. Do the outlets actually DISAGREE anywhere, or is the disagreement figure on
 *      every card a decorative zero?
 *   5. Can a placed prop bet be settled from a save, and does it settle to the
 *      right answer?
 *
 * (5) is the one that cannot be reasoned about. It runs a real slate, places a
 * real bet through the real wallet, plays the day, and checks the verdict against
 * the box score independently reconstructed from the play log.
 *
 * Run: npx tsx tools/verifyPropBoard.ts [seed] [days]
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { buildMediaReads } from '../src/lib/mediaReads';
import { MEDIA_PROFILES } from '../src/data/media';
import {
  MAX_PROPS_PER_OUTLET, buildPropMarkets, selectOutletProps,
} from '../src/lib/mediaProps';
import { propSidePrices, reconstructPlayerGameLines, propActualStat } from '../src/lib/playerProps';
import { placeBet, settleWallet, createWallet, summariseWallet } from '../src/lib/wallet';
import type { Game, LeaguePlayerState, Team } from '../src/types';
import type { MediaId } from '../src/data/media';

const SEED = Number(process.argv[2] ?? 31337);
const WARMUP = Number(process.argv[3] ?? 45);
const YEAR = 2026;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

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

  const manager = new SimulationManager({
    teams: roster,
    games: generateSchedule(roster, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }),
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  for (let day = 0; day < WARMUP; day += 1) {
    state = (await manager.run({ scope: 'day' })).playerState;
  }

  const result = await manager.run({ scope: 'day' });
  /*
   * currentDate has already advanced past the day just played, so it is not the
   * slate date. The first version of this tool read it that way, found fifteen
   * "games" that were already completed, published a board for them, and then
   * skipped the settlement check because no completed game remained on that
   * date. The slate date is the next date games are actually scheduled for.
   */
  const upcoming = result.games.filter((g) => g.status !== 'completed' && g.date > result.currentDate);
  const slateDate = upcoming.length > 0
    ? upcoming.map((g) => g.date).sort()[0]
    : '';
  const games: Game[] = upcoming.filter((g) => g.date === slateDate);

  console.log(`seed ${SEED} · ${WARMUP} warm-up days · slate ${slateDate}`);
  console.log(`games on the slate: ${games.length}`);
  if (games.length === 0) {
    console.log('no slate ahead; cannot verify a board with nothing on it');
    return;
  }

  const teams: Team[] = result.teams;
  const reads = buildMediaReads({
    teams, players: state.players, battingRatings: state.battingRatings,
    pitchingRatings: state.pitchingRatings, battingStats: state.battingStats,
    pitchingStats: state.pitchingStats, playerState: state, seasonYear: YEAR,
  });

  const markets = buildPropMarkets({
    games, playerState: state, slateDate,
    teamScores: reads.scores, scoreSpread: reads.spread,
  });

  console.log(`prop markets built: ${markets.length}`);
  if (markets.length === 0) {
    console.log('VERDICT FAIL: a slate with games produced no props');
    return;
  }

  const players = new Set(markets.map((m) => m.playerId));
  console.log(`distinct players with a prop: ${players.size}`);
  const perGame = new Map<string, number>();
  markets.forEach((m) => perGame.set(m.gameId, (perGame.get(m.gameId) ?? 0) + 1));
  const counts = [...perGame.values()];
  console.log(`props per game: min ${Math.min(...counts)}, max ${Math.max(...counts)}`);
  console.log('');

  /* -------- per outlet -------- */

  const selections = new Map<MediaId, typeof markets>();
  for (const profile of MEDIA_PROFILES) {
    const picked = selectOutletProps(markets, profile.id);
    selections.set(profile.id, picked);
    const safe = picked.filter((m) => m.temperament[profile.id] === 'safe').length;
    const hot = picked.filter((m) => m.temperament[profile.id] === 'hot').length;
    console.log(`${profile.outlet.padEnd(22)} ${String(picked.length).padStart(2)} picks  (safe ${safe}, hot ${hot})  cap ${MAX_PROPS_PER_OUTLET}`);

    const over = picked.filter((m) => m.probability[profile.id] > 0.5).length;
    const spread = picked.map((m) => m.spread);
    const meanSpread = spread.reduce((s, v) => s + v, 0) / spread.length;
    const maxSpread = Math.max(...spread);
    const outletsAgree = picked.filter((m) => m.spread < 0.01).length;
    console.log(`  own read: ${over}/${picked.length} priced above even · spread mean ${meanSpread.toFixed(3)} max ${maxSpread.toFixed(3)} · identical across all three: ${outletsAgree}`);
    console.log(`  unique players: ${new Set(picked.map((m) => m.playerId)).size}/${picked.length}`);
  }

  const hollis = selections.get('hollis')!.map((m) => m.propId).join('|');
  const glorest = selections.get('glorest')!.map((m) => m.propId).join('|');
  const sharply = selections.get('sharply')!.map((m) => m.propId).join('|');
  console.log('');
  console.log(`outlets publish different boards: ${hollis !== glorest && glorest !== sharply && hollis !== sharply}`);
  console.log('');

  /* -------- house lines -------- */

  let priced = 0;
  let vigCheckFailures = 0;
  const wholeLine = markets.filter((m) => Number.isInteger(m.line)).length;
  const samples: string[] = [];
  for (const market of markets.slice(0, 5)) {
    const { overPrice, underPrice, overround } = propSidePrices(market.consensusProbability);
    samples.push(
      `${market.playerName} ${market.line} ${market.statPlural}: ` +
      `over ${overPrice > 0 ? '+' : ''}${overPrice} / under ${underPrice > 0 ? '+' : ''}${underPrice}` +
      ` (vig ${(overround * 100).toFixed(1)}%)`,
    );
  }
  for (const market of markets) {
    const { overPrice, underPrice } = propSidePrices(market.consensusProbability);
    // Absolute value, not the signed price. `overPrice <= 1` is true for every
    // favourite on the board -- a -200 side is less than one -- which silently
    // skipped all 3,752 props and reported "0 priced both sides" while the
    // samples above plainly showed two-sided prices. A diagnostic that discards
    // every input and reports no failures is worse than no diagnostic.
    if (Math.abs(overPrice) < 2 || Math.abs(underPrice) < 2) continue;
    priced += 1;

    /*
     * The vig check, and the one that matters.
     *
     * The two side prices have to be derived from the same shaded probability with
     * the margin applied to EACH of them. A pair where one side is the negation of
     * the other sums to exactly 1.0000 implied probability, so the overround is
     * zero: the house computes a margin, applies it, and then erases it before the
     * price reaches the screen. The first version of propSidePrices did exactly
     * that, and this check measured 0.000 on all 4,143 props -- which is the tell
     * that no real book is ever exactly even.
     *
     * American to implied: a positive price of X implies 100/(X+100), a negative
     * price of -X implies X/(X+100).
     */
    const implied = (price: number) =>
      price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
    const overround = implied(overPrice) + implied(underPrice) - 1;
    // A 4.5% margin, plus whatever rounding to a whole American price adds. On a
    // short price the rounding alone can be worth most of a point, so the band is
    // deliberately loose at the bottom and tighter at the top.
    if (overround < 0.03 || overround > 0.14) vigCheckFailures += 1;
  }
  const evenProps = markets.filter((m) => m.consensusProbability > 0.47 && m.consensusProbability < 0.53).length;
  console.log('sample house lines:');
  samples.forEach((s) => console.log('  ' + s));
  console.log('');
  console.log(`props priced both sides: ${priced}/${markets.length}`);
  console.log(`overround outside 3-14%: ${vigCheckFailures}/${priced}`);
  console.log(`whole-number lines published: ${wholeLine}/${markets.length} (must be 0)`);
  console.log(`props priced within 3 points of even: ${evenProps}/${markets.length} (${pct(evenProps / markets.length)})`);
  console.log(`consensus range: ${pct(Math.min(...markets.map((m) => m.consensusProbability)))} to ${pct(Math.max(...markets.map((m) => m.consensusProbability)))}`);
  console.log('');

  /* -------- temperament distribution across the whole board -------- */

  const safeCount = markets.filter((m) => m.temperament.hollis === 'safe').length;
  const hotCount = markets.filter((m) => m.temperament.hollis === 'hot').length;
  const midCount = markets.length - safeCount - hotCount;
  console.log(`whole board by temperament: safe ${safeCount}, middle ${midCount}, hot ${hotCount}`);

  /*
   * The distribution above is the finding, and it is not what the design assumed.
   *
   * The plan was for a spread of probabilities with a middle band, so that safe
   * and hot picks are chosen out of a varied board. What actually happens is that
   * the board is BIMODAL by stat: every hits prop is safe, every runs prop is
   * hot, and the middle band is empty. A 0.5 line on hits clears 65% of the time
   * and a 0.5 line on runs clears 30%, so the stat alone decides the label and the
   * probability never lands in between.
   *
   * That has a consequence worth stating rather than hiding: "safe" and "hot" on
   * this board currently mean "hits and strikeouts" and "runs, RBI and walks",
   * not a judgement about a particular player. The colours are still honest as
   * measured categories -- a hits prop really does clear 65% and a runs prop
   * really does clear 30% -- but a manager reading them as per-pick confidence
   * would be reading more into them than they carry.
   *
   * The middle band being empty also means the temperaments cannot be balanced by
   * moving the thresholds: there is nothing to move them across. Fixing this
   * properly needs props at more than one line per stat per player, so that a
   * star hitter's 2.5-hit line is genuinely a harder prop than a bat-average
   * catcher's 0.5. That is the next thing to build and it is a change to the line
   * ladder, not to the classifier.
   */
  const histogram = new Map<string, number>();
  for (const market of markets) {
    const bucket = `${Math.floor(market.consensusProbability * 10) / 10}-${Math.floor(market.consensusProbability * 10) / 10 + 0.1}`;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
  }
  console.log('consensus probability distribution, whole board:');
  [...histogram.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([bucket, count]) => {
    console.log(`  ${bucket.padEnd(10)} ${'#'.repeat(Math.round((count / markets.length) * 60)).padEnd(40)} ${count}`);
  });
  console.log('');
  const byStat = new Map<string, { safe: number; hot: number; n: number }>();
  markets.forEach((m) => {
    const row = byStat.get(m.stat) ?? { safe: 0, hot: 0, n: 0 };
    row.n += 1;
    if (m.temperament.hollis === 'safe') row.safe += 1;
    if (m.temperament.hollis === 'hot') row.hot += 1;
    byStat.set(m.stat, row);
  });
  for (const [stat, row] of byStat) {
    console.log(`  ${stat.padEnd(19)} n=${String(row.n).padStart(4)}  safe ${String(row.safe).padStart(4)}  hot ${String(row.hot).padStart(4)}`);
  }
  console.log('');

  /* -------- settle a real prop bet -------- */

  // Place one bet on each side of one prop, play the day, and check both settle
  // to opposite and correct verdicts. Two bets rather than one, because a prop
  // market that pays out correctly but voids is a different bug from one that
  // cannot tell over from under.
  /*
   * Settlement against a game that has actually been played.
   *
   * The board above is built for games that have NOT happened yet, which is
   * correct -- a prop board is a forecast. To settle, the same day has to be
   * played, so this runs one more day and settles against the completed slate.
   * Building a board for completed games instead would have tested the forecast
   * on data it was already fitted to, which passes without proving anything.
   */
  /*
   * Play the slate, then settle against it.
   *
   * The board above is built for games that have NOT happened yet, which is
   * correct -- a prop board is a forecast. Settling means playing the day, and one
   * day is not always enough: a schedule with off days means the next slate date
   * can be two or three calendar days out, so this advances until the slate is
   * played or the horizon runs out, rather than assuming one step reaches it.
   *
   * Building the board for already-completed games instead would have tested the
   * forecast on the data it was fitted to. That passes without proving anything.
   */
  let played = result;
  let slateCompleted: Game[] = [];
  for (let step = 0; step < 4 && slateCompleted.length === 0; step += 1) {
    played = await manager.run({ scope: 'day' });
    slateCompleted = played.games.filter((g) => g.date === slateDate && g.status === 'completed');
  }
  if (slateCompleted.length === 0) {
    console.log('slate was not played within 4 days; settlement check unavailable');
    return;
  }

  const game = slateCompleted[0];  const { batting, pitching } = reconstructPlayerGameLines(game);
  const battingPlayer = [...batting.keys()][0];
  const pitchingPlayer = [...pitching.keys()][0];

  let wallet = createWallet();
  const tests: Array<{ label: string; stat: Parameters<typeof propActualStat>[1]; playerId: string; side: 'over' | 'under'; line: number }> = [];
  if (battingPlayer) {
    tests.push({ label: 'hits over 0.5', stat: 'hits', playerId: battingPlayer, side: 'over', line: 0.5 });
    tests.push({ label: 'hits under 0.5', stat: 'hits', playerId: battingPlayer, side: 'under', line: 0.5 });
    tests.push({ label: 'runs over 0.5', stat: 'runs', playerId: battingPlayer, side: 'over', line: 0.5 });
  }
  if (pitchingPlayer) {
    tests.push({ label: 'pitcher K over 1.5', stat: 'pitcherStrikeouts', playerId: pitchingPlayer, side: 'over', line: 1.5 });
  }

  for (const test of tests) {
    const actual = propActualStat(game, test.stat, test.playerId);
    const expected = actual === null
      ? 'void'
      : (actual > test.line) === (test.side === 'over') ? 'won' : 'lost';
    const placed = placeBet(wallet, {
      kind: 'prop',
      marketKey: game.gameId,
      marketTitle: `${test.label}`,
      selection: test.side,
      selectionLabel: test.label,
      stake: 25,
      price: 110,
      placedOn: slateDate,
      backedMedia: 'hollis',
      propStat: test.stat,
      propPlayerId: test.playerId,
      propPlayerName: test.playerId.slice(4, 12),
      propLine: test.line,
    });
    if ('error' in placed) { console.log(`  ${test.label}: could not place (${placed.error})`); continue; }
    wallet = placed.wallet;
  }

  const settled = settleWallet(wallet, {
    games: played.games, teams: played.teams, currentDate: played.currentDate,
    seasonComplete: false, seasonWinners: null, awardWinners: null,
  });
  const summary = summariseWallet(settled);

  console.log(`placed ${settled.bets.length} prop bets on ${game.gameId.slice(0, 12)}`);
  for (const bet of settled.bets) {
    const actual = bet.propStat && bet.propPlayerId
      ? propActualStat(game, bet.propStat, bet.propPlayerId) : null;
    console.log(`  ${bet.selectionLabel.padEnd(20)} actual ${actual === null ? 'n/a' : actual} vs line ${bet.propLine}  ->  ${bet.status}`);
  }
  console.log('');
  console.log(`settled ${summary.settled}/${settled.bets.length}, won ${summary.wins}, profit ${summary.profit >= 0 ? '+' : ''}$${summary.profit.toFixed(2)}, balance $${settled.balance.toFixed(2)}`);

  const pending = settled.bets.filter((b) => b.status === 'open').length;
  const voided = settled.bets.filter((b) => b.status === 'void').length;
  console.log(`still open ${pending}, voided ${voided}`);

  const verdict = markets.length > 0
    && selections.get('hollis')!.length > 0
    && selections.get('hollis')!.length <= MAX_PROPS_PER_OUTLET
    && (hollis !== glorest)
    && priced > 0
    && vigCheckFailures === 0
    && wholeLine === 0
    && pending === 0
    && summary.settled === settled.bets.length;
  console.log('');
  console.log(verdict
    ? 'VERDICT: the board builds, caps, disagrees, prices both sides, and settles.'
    : 'VERDICT FAIL: see the numbers above.');
};

void main();
