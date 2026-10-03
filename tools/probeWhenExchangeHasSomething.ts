/**
 * HOW FAR INTO A SEASON UNTIL THE EXCHANGE IS WORTH LOOKING AT?
 *
 * A throwaway measurement, not a check. It answers a product question -- "how long until I can see
 * the thing?" -- with days rather than adjectives, by running the real price board over a real
 * league and recording, for every day, what the page would actually be able to draw.
 *
 * The thresholds are NOT invented here. Each one is read off the code that renders it:
 *
 *   0 days  the page prints "No prices yet" and draws nothing.
 *   1 day   `linePath` returns a single `M` with nothing after it, so there is no line -- but the
 *           LAST-POINT MARKER still renders, so the plot shows one dot. Verified in the browser at
 *           cx 374 (centred), cy 65 (exactly fair value 500), r 2. An earlier draft of this comment
 *           claimed day 1 was blank; it is not, and the marker is why.
 *   2 days  a real segment exists. This is the first day the page shows a price PATH.
 *   2 fair days
 *           `hasFair` is `fairDays >= 2`, so the fair line needs two RECORDED valuations.
 *
 * The dislocation threshold is the interesting one and it is measured, not chosen: it reports the
 * first day on which some club sits a given distance from its own fair value, alongside the daily
 * sigma of the market itself. A dislocation only means something if it is bigger than the noise a
 * quiet day already produces.
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { DEFAULT_SETTINGS, generateSchedule, getDefaultSeasonStartDate } from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import { priceBoardForDay } from '../src/lib/analytics/priceBoard';
import type { Game, LeaguePlayerState, Team } from '../src/types';
import { seededRandomStream, withSeededRandom } from '../src/lib/analytics/playoffMonteCarlo';

const YEAR = 2026;
const SEED = 4242;
const WARMUP_DAYS = 60;
const PRICED_DAYS = 45;
const TRIALS = 250;

const iso = (offset: number): string =>
  new Date(Date.parse(getDefaultSeasonStartDate(YEAR)) + offset * 86400000).toISOString().slice(0, 10);

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe,
    YEAR,
  );

  const schedule = withSeededRandom(seededRandomStream(SEED), () =>
    generateSchedule(teams, { seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180 }));

  const manager = new SimulationManager({
    teams,
    games: schedule,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let playerState: LeaguePlayerState = universe;
  let games: Game[] = [];
  for (let d = 0; d < WARMUP_DAYS; d += 1) {
    const r = await manager.run({ scope: 'day' });
    teams = r.teams; games = r.games; playerState = r.playerState;
  }

  // Price consecutive days off the SAME league state, carrying closes forward exactly as the app does.
  let previous: Record<string, number> | undefined;
  const closes: number[] = [];
  const rows: Array<{
    day: number;
    maxStray: number;
    worstClub: string;
    meanStray: number;
    move: number;
  }> = [];

  for (let d = 0; d < PRICED_DAYS; d += 1) {
    const board = priceBoardForDay({
      teams, games, date: iso(d), playerState, seasonYear: YEAR,
      seed: SEED, previousClose: previous, mcTrials: TRIALS, settings: DEFAULT_SETTINGS,
    });
    previous = board.close;

    let maxStray = 0;
    let worstClub = '';
    let sum = 0;
    let n = 0;
    for (const [id, close] of Object.entries(board.close)) {
      const fair = board.fair[id];
      if (typeof fair !== 'number' || fair === 0) continue;
      const stray = Math.abs(close / fair - 1);
      sum += stray; n += 1;
      if (stray > maxStray) { maxStray = stray; worstClub = id; }
    }
    const moves = Object.entries(board.move ?? {}).map(([, v]) => Math.abs(Number(v)));
    rows.push({
      day: d + 1,
      maxStray,
      worstClub,
      meanStray: n ? sum / n : 0,
      move: moves.length ? Math.max(...moves) : 0,
    });

    const ids = Object.keys(board.close);
    closes.push(ids.reduce((sum2, id) => sum2 + board.close[id], 0) / ids.length);
  }

  /*
    Realised daily sigma of the MEAN close, so a dislocation on the average line can be compared
    against the noise that line already carries.

    It is much smaller than the per-club sigma `checkSharePrice` measures (about 4% in-season), and
    that difference is not a contradiction: averaging 32 independent clubs cancels most of the
    idiosyncratic move. Both numbers are correct for the series they describe, and which one is the
    right yardstick depends on whether you are reading the average line or a single club's.
  */
  const rets = closes.slice(1).map((c, i) => c / closes[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sigma = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1));

  console.log('\nWHEN IS THE EXCHANGE WORTH LOOKING AT?\n');
  console.log(`  league warmed ${WARMUP_DAYS} days, then ${PRICED_DAYS} priced at ${TRIALS} MC trials`);
  console.log(`  realised daily sigma of the mean close: ${(sigma * 100).toFixed(2)}%\n`);

  console.log('  DAY  WHAT THE PAGE CAN DRAW                          WORST STRAY vs FAIR');
  const firstAt = (threshold: number): string => {
    const hit = rows.find((r) => r.maxStray >= threshold);
    return hit ? `day ${hit.day} (${(hit.maxStray * 100).toFixed(1)}%, ${hit.worstClub})` : 'not within 45 days';
  };
  const line = (label: string, day: string) => console.log(`  ${day.padEnd(5)}${label.padEnd(46)}${''}`);
  line('nothing -- the empty state', '0');
  line('one dot at fair value, no trend yet', '1');
  line('a real price line', '2');
  line('the fair line as well (needs 2 recorded)', '2');
  console.log('');
  console.log(`  first day some club is  2 sigma (${(sigma * 2 * 100).toFixed(1)}%) from fair: ${firstAt(sigma * 2)}`);
  console.log(`  first day some club is  5% from fair:                       ${firstAt(0.05)}`);
  console.log(`  first day some club is 10% from fair:                       ${firstAt(0.10)}`);
  console.log(`  first day some club is 20% from fair:                       ${firstAt(0.20)}`);
  console.log('');
  console.log('  first 12 days, in detail');
  console.log('   day  mean stray  worst stray  worst club  biggest daily move');
  for (const r of rows.slice(0, 12)) {
    console.log(`   ${String(r.day).padStart(3)}  ${(r.meanStray * 100).toFixed(2).padStart(8)}%  ${(r.maxStray * 100).toFixed(2).padStart(9)}%  ${r.worstClub.padStart(9)}  ${(r.move * 100).toFixed(2).padStart(8)}%`);
  }
  const best = rows.reduce((a, b) => (b.maxStray > a.maxStray ? b : a));
  console.log(`\n  worst dislocation over ${PRICED_DAYS} days: day ${best.day}, ${(best.maxStray * 100).toFixed(1)}% (${best.worstClub})`);
  console.log('');
};

void main();