/**
 * Is fading an outlier actually +EV? Measure it before the UI calls it a play.
 *
 * The expansion plan's 5.4 says the real edge in this layer is "fading the
 * outlier", on the reasoning that Sharply's probability is inflated by his
 * deliberately-inflated 0.80 slope and that "when his number disagrees most with the
 * other two, that is a tradeable signal".
 *
 * That is a claim about money, so it is measured here rather than assumed. A row
 * that says "SHARPLY +180 / CONSENSUS -120 / GAP 9.4pts" reads as an instruction,
 * and if the strategy behind it loses then the UI is lying to a bettor the same way a
 * "VALUE" tier would -- just more politely.
 *
 * WHAT IS TESTED. For every past futures outcome, take the forecaster furthest from
 * the consensus, bet the CONSENSUS price against them (fade), and also bet the other
 * way (follow). Compare the two against the actual result. Run separately per
 * forecaster, because the whole thesis is about Sharply specifically.
 *
 * THE HONEST CAVEAT, STATED UP FRONT. A season's futures have 32 outcomes, so one
 * season gives 32 observations per forecaster and this cannot establish anything on
 * its own. It is run across many seasons and the SEASON is the unit -- a strategy
 * that wins 55 per cent of seasons is worth shipping, one that wins 52 per cent of
 * SEASONS while winning 60 per cent of OUTCOMES is noise, and the distinction is the
 * whole question.
 *
 * Run: npx tsx tools/checkOutlierFade.ts [seasons]
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
import { MEDIA_PROFILES, type MediaId } from '../src/data/media';
import type { Game, LeaguePlayerState, Team } from '../src/types';

const SEASONS = Number(process.argv[2] ?? 8);
const START_YEAR = 2026;

interface FadeTally {
  /** Bets taken. */
  n: number;
  /** Net dollars per unit stake, positive means the strategy printed money. */
  fadeNet: number;
  followNet: number;
  /** Seasons in which the fade strategy was in profit. The unit that matters. */
  fadeWinningSeasons: number;
  /** How many of those seasons the fade actually placed a bet in. */
  seasonsWithBets: number;
}

const main = async (): Promise<void> => {
  console.log(`\nFADING THE OUTLIER: ${SEASONS} seasons of championship futures`);
  console.log('  Betting the CONSENSUS price against whichever forecaster is furthest from it.');
  console.log('  A dollar is a unit stake. Positive means the strategy printed money.\n');

  const tallies = new Map<MediaId, FadeTally>();
  MEDIA_PROFILES.forEach((profile) => {
    tallies.set(profile.id, {
      n: 0, fadeNet: 0, followNet: 0, fadeWinningSeasons: 0, seasonsWithBets: 0,
    });
  });

  for (let season = 0; season < SEASONS; season += 1) {
    const year = START_YEAR + season;
    const universe = buildNewUniverse({
      teams: INITIAL_TEAMS.map((t) => ({ ...t })),
      seasonYear: year,
      seed: 4242 + season,
      effectiveDate: `${year}-12-15`,
    }).playerState;

    let teams: Team[] = recalculateTeamRatingsFromRosters(
      INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
      universe,
      year,
    );
    const manager = new SimulationManager({
      teams,
      games: generateSchedule(teams, {
        seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180,
      }),
      playerState: universe,
      settings: DEFAULT_SETTINGS,
      currentDate: getDefaultSeasonStartDate(year),
    });

    let state: LeaguePlayerState = universe;
    let games: Game[] = generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(year), seasonDays: 180,
    });

    /*
     * Price the board ONCE, at the start of the season, and settle it against the
     * champion at the end.
     *
     * Once per season on purpose. Re-pricing every day would let a strategy "fade"
     * a price that had already absorbed the information, which is the classic way to
     * manufacture an edge that does not exist: by the time the board disagrees, the
     * board is right.
     */
    const reads = buildMediaReads({
      teams, players: state.players,
      battingRatings: state.battingRatings, pitchingRatings: state.pitchingRatings,
      battingStats: state.battingStats, pitchingStats: state.pitchingStats,
      playerState: state, seasonYear: year,
    });
    const board = buildWorldSeriesMarkets({ teams, scoreBy: reads.scores })[0];
    const openingPrices = board.outcomes.map((outcome) => ({
      key: outcome.key,
      odds: { ...outcome.odds },
      houseOdds: outcome.houseOdds,
      outlier: outcome.outlier,
    }));

    /*
     * `scope: 'season'`, not 180 manual day-steps.
     *
     * A day-step loop stops at the end of the regular season, so the championship
     * series is never played and there is no champion to settle against -- which is
     * what the first version of this tool did, and it reported zero bets for every
     * outlet rather than admitting it had measured nothing. `season` runs the
     * playoffs too.
     */
    const finished = await manager.run({ scope: 'season' });
    state = finished.playerState; games = finished.games; teams = finished.teams;

    /*
     * THE CHAMPION, read off the completed championship series.
     *
     * Taken from the played games rather than from the simulation manager's private
     * seed map or from a standings calculation, for two reasons. The seed map is
     * private, so reaching it would mean a cast. And a standings re-derivation would
     * be a SECOND way of deciding who won, which is precisely how a settlement
     * disagreement gets introduced into what is only meant to be a pricing
     * measurement.
     */
    const series = games.filter(
      (game) => game.status === 'completed' && game.playoff?.round === 'world_series',
    );
    const champion = series.length > 0
      ? ([...series].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.score.away ?? 0) >
        ([...series].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.score.home ?? 0)
        ? [...series].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.awayTeam
        : [...series].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.homeTeam
      : undefined;

    if (!champion) {
      console.log(`  season ${year}: no completed championship series, skipped`);
      continue;
    }

    const seasonNet = new Map<MediaId, number>();

    for (const outcome of openingPrices) {
      const won = outcome.key === champion;
      for (const profile of MEDIA_PROFILES) {
        const tally = tallies.get(profile.id)!;
        // Only the forecaster who IS the outlier is faded. Everyone else is not the
        // signal, so including them would dilute the measurement with noise and
        // understate whatever edge exists.
        if (outcome.outlier !== profile.id) continue;

        const theirOdds = outcome.odds[profile.id];
        // Fade: take the consensus against them. A +price pays on a win, so fading
        // is betting the OUTCOME LOSES at that outlet's price, which pays
        // -theirOdds/100 per unit when the outcome does lose.
        const fadeReturn = won
          ? (100 / -theirOdds) * -1
          : 100 / -theirOdds;
        const followReturn = won ? 100 / theirOdds : -1;

        tally.n += 1;
        tally.fadeNet += fadeReturn;
        tally.followNet += followReturn;
        seasonNet.set(profile.id, (seasonNet.get(profile.id) ?? 0) + fadeReturn);
      }
    }
    seasonNet.forEach((net, id) => {
      if (net > 0) tallies.get(id)!.fadeWinningSeasons += 1;
    });
    MEDIA_PROFILES.forEach((p) => {
      if (seasonNet.has(p.id)) tallies.get(p.id)!.seasonsWithBets += 1;
    });
  }

  console.log('  outlet    bets    fade $/bet   follow $/bet   seasons in profit');
  console.log('  ' + '-'.repeat(62));
  const anyProfitable = new Set<string>();
  MEDIA_PROFILES.forEach((profile) => {
    const t = tallies.get(profile.id)!;
    if (t.n === 0) {
      console.log(`  ${profile.id.padEnd(9)} ${String(0).padStart(4)}   (never the outlier)`);
      return;
    }
    const fadePer = t.fadeNet / t.n;
    const followPer = t.followNet / t.n;
    if (t.seasonsWithBets > 0 && t.fadeWinningSeasons / t.seasonsWithBets > 0.5) {
      anyProfitable.add(profile.id);
    }
    console.log(
      `  ${profile.id.padEnd(9)} ${String(t.n).padStart(4)}` +
      `   ${fadePer >= 0 ? '+' : ''}${fadePer.toFixed(3).padStart(8)}` +
      `   ${followPer >= 0 ? '+' : ''}${followPer.toFixed(3).padStart(8)}` +
      `   ${t.fadeWinningSeasons}/${t.seasonsWithBets}`,
    );
  });

  console.log('\nREADING THIS.');
  if (anyProfitable.size === 0) {
    console.log('  No outlet fades profitably in a majority of seasons. The board should therefore');
    console.log('  NOT present the outlier gap as a tradeable signal. It can still show the gap as');
    console.log('  information -- "these two disagree by 9 points" is true and useful -- but the');
    console.log('  UI must not imply that acting on it pays, because measured here it does not.');
  } else {
    console.log(`  Fading prints money for: ${Array.from(anyProfitable).join(', ')}. That is a real`);
    console.log('  finding and the UI can say so with a number behind it rather than a hint.');
  }
  console.log('');
  console.log('  CAVEAT: the schedule is unseeded, so these are different leagues each run and the');
  console.log('  figures move between invocations. The per-outlet SIGN is the finding; the');
  console.log('  magnitude is not, and a strategy that wins 52% of seasons is not worth shipping.');
};

void main();
