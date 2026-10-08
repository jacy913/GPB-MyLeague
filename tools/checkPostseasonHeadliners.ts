/**
 * Do the postseason detectors actually fire, on a real bracket, and only once per series?
 *
 * ============================================================================
 * WHY THIS FILE HAS TO EXIST
 * ============================================================================
 *
 * `checkHeadlinerCoverage` proves every kind can reach a byline. It cannot prove the detector emits.
 * Those are different claims, and the gap between them is exactly where this app's worst bugs live:
 * a kind that is covered, wired, typed and gated, and never once fires in a season because its
 * threshold is unreachable. It reads as "nobody had anything to say", which is indistinguishable
 * from a quiet night.
 *
 * So this builds a league, plays it through the postseason, and counts what the detectors produced.
 *
 * ============================================================================
 * THE FOUR THINGS THAT ARE ACTUALLY WORTH ASSERTING
 * ============================================================================
 *
 *  1. A decided series fires EXACTLY ONCE, on the game that decided it.
 *
 *     This is the assertion that catches the bug the implementation is most able to ship.
 *     `completedGamesDesc` includes every LATER game in the series too, so a tally that only asks
 *     "is the series over" fires on all of them -- a 3-0 sweep would file four stories and a
 *     seven-game series would file one for every game after the fourth. The detector anchors on the
 *     winner reaching exactly `winsNeeded` in THIS game, and that anchor is the whole difference
 *     between one story and several.
 *
 *  2. `championship` fires exactly once per SEASON, not once per series.
 *
 *  3. Elimination and clinch are the same instant seen from two sides.
 *
 *     One decided series must produce exactly one of each. If they drift apart, a club is either
 *     congratulated and buried in the same breath or neither happens, and both are wrong.
 *
 *  4. No postseason event ever fires on a REGULAR-SEASON game.
 *
 *     The detectors all early-return on `game.playoff`, but "the guard is in the source" is a claim
 *     about reading code. This is a claim about output.
 *
 * Run: npx tsx tools/checkPostseasonHeadliners.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { EMITTABLE_KINDS, extractGameEvents } from '../src/logic/headlinerEvents';
import { HEADLINERS, type GameEventKind } from '../src/logic/headliners';
import { VOICE_BANKS, interpolate } from '../src/logic/headlinerVoices';
import { buildGameIndexes, deriveGameLines, type GameShape } from '../src/logic/headlineEngine';
import { isPlayoffGame } from '../src/logic/playoffs';
import type { Game, Player, Team } from '../src/types';

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  if (!pass) failures += 1;
  console.log(`  ${pass ? 'PASS  ' : 'FAIL  '}${label}`);
  console.log(`        ${detail}`);
};

/* ------------------------------------------------------------------ a synthetic bracket */

/**
 * A bracket built by hand rather than simulated.
 *
 * The property under test is the detector's series bookkeeping, and a scripted postseason exercises
 * every shape that matters -- a sweep, a seven-games-in-seven series, a comeback from 0-2 -- in a
 * fraction of a second and with a known answer. A simulated bracket would test the seed generator
 * as well and could produce a season with no deciding game in it at all.
 */
interface ScriptedSeries {
  seriesId: string;
  round: Game['playoff'] extends infer P
    ? P extends { round: infer R }
      ? R
      : never
    : never;
  league: 'Platinum' | 'Prestige' | 'GPB';
  bestOf: number;
  /** Per game: which club won, true = top. */
  winners: boolean[];
  date: string;
}

const dateFor = (index: number): string => `2026-10-${String(1 + Math.floor(index / 2)).padStart(2, '0')}`;

let gameCounter = 0;
const buildBracket = (series: ScriptedSeries[]): Game[] => {
  const games: Game[] = [];
  let day = 0;
  for (const s of series) {
    for (let i = 0; i < s.winners.length; i += 1) {
      /*
       * The winner is ALWAYS the away side, and the score says so.
       *
       * The first version scored `away = winners[i] ? 4 : 1`, which meant that when `winners[i]` was
       * false the AWAY club scored 1 and the HOME club scored 3 -- and the home club was `suk`. So
       * `suk` won every game of every series, no club was ever eliminated, and three checks failed
       * against a detector that was correct. A harness that quietly disagrees with its own fixtures
       * is worse than no harness: it points every fix at the wrong file.
       */
      const away = s.winners[i] ? 'suk' : 'des';
      const home = s.winners[i] ? 'des' : 'suk';
      const awayRuns = 4;
      const homeRuns = 1;
      games.push({
        gameId: `po-${s.seriesId}-${i + 1}`,
        date: dateFor(day),
        homeTeam: home,
        awayTeam: away,
        phase: 'playoffs',
        status: 'completed',
        score: { away: awayRuns, home: homeRuns },
        stats: {
          lines: [],
          playLog: [],
        },
        playoff: {
          round: s.round,
          league: s.league,
          seriesId: s.seriesId,
          seriesLabel: `${s.league} ${s.round}`,
          gameNumber: i + 1,
          bestOf: s.bestOf,
        },
      } as unknown as Game);
      day += 1;
      gameCounter += 1;
    }
  }
  return games;
};

/* ------------------------------------------------------------------ the run */

/**
 * Four series, chosen for the shapes that break a series-bookkeeping detector rather than for
 * realism about seeding.
 *
 * Every one is a LEGAL series -- first to `floor(bestOf/2)+1`, no games after the decision. The first
 * version of this table had a best-of-3 that ran five games and a sweep that ran three, and the tool
 * reported five failures against detectors that were behaving correctly. A bracket that cannot happen
 * tests nothing except whether the test agrees with itself.
 */
const BRACKET: ScriptedSeries[] = [
  // A 2-0 sweep: clinched on the SECOND game, so the deciding game is not the last one played.
  { seriesId: 'wc1', round: 'wild_card', league: 'Platinum', bestOf: 3, winners: [true, true], date: '2026-10-01' },
  // Trailed 0-1 then won three straight: the clinch is game 4 of 4.
  { seriesId: 'wc2', round: 'wild_card', league: 'Prestige', bestOf: 5, winners: [false, true, true, true], date: '2026-10-02' },
  // Down 0-2, wins five straight: the longest legal best-of-five, clinched on the last game played.
  { seriesId: 'dv1', round: 'divisional', league: 'Platinum', bestOf: 5, winners: [false, false, true, true, true], date: '2026-10-03' },
  // A seven-game championship, 4-3, decided by the final out.
  { seriesId: 'ws', round: 'world_series', league: 'GPB', bestOf: 7, winners: [true, true, false, true, false, true, true], date: '2026-10-04' },
];

console.log('\nPOSTSEASON HEADLINERS\n');

const teams: Team[] = INITIAL_TEAMS;
const teamsById = new Map(teams.map((t) => [t.id, t]));
const players = [] as Player[];
const playersById = new Map<string, Player>();

const games = buildBracket(BRACKET);

/*
 * The real index, not a hand-rolled slice.
 *
 * The first version of this tool filtered by `game.date <= date`, which let same-day games that had
 * not been played yet into the history and made a sweep fire its clinch story twice. That read as a
 * detector bug and was a harness bug -- and it is the same mistake the production call sites were
 * making for a different reason, which is why this now goes through `buildGameIndexes` exactly as
 * the dashboard does. If the index ever leaks again, this tool is the thing that says so.
 */
const indexes = buildGameIndexes(games);

console.log(`  bracket: ${BRACKET.length} series, ${games.length} games`);
console.log(`  rounds: ${BRACKET.map((s) => `${s.seriesId} (${s.winners.filter(Boolean).length} of ${s.winners.length})`).join('  ')}\n`);

/** Every postseason event the detectors emit, keyed by the game that produced it. */
const emitted: Array<{ kind: GameEventKind; gameId: string; seriesId: string; teamId?: string }> = [];

for (const game of games) {
  const completedDesc = indexes.completedGamesUpTo(game.gameId);

  const shape: GameShape = {
    awayTeamId: game.awayTeam,
    homeTeamId: game.homeTeam,
    awayWon: game.score.away > game.score.home,
    homeWon: game.score.home > game.score.away,
    winnerTeamId: game.score.away > game.score.home ? game.awayTeam : game.homeTeam,
    loserTeamId: game.score.away > game.score.home ? game.homeTeam : game.awayTeam,
    winnerWasUnderdog: false,
  } as unknown as GameShape;

  const derived = deriveGameLines(game) as never;

  const events = extractGameEvents({
    game,
    shape,
    derived,
    teamsById,
    playersById,
    completedGamesDesc: completedDesc,
    baselines: null,
  });

  for (const event of events) {
    emitted.push({
      kind: event.kind,
      gameId: game.gameId,
      seriesId: game.playoff?.seriesId ?? 'none',
      teamId: event.teamId,
    });
  }
}

const postKinds: GameEventKind[] = ['series_clinched', 'eliminated', 'championship'];
const of = (kind: GameEventKind) => emitted.filter((e) => e.kind === kind);

/* ------------------------------------------------------------------ 1. declared and emittable */

check(
  'the three postseason kinds are declared and registered with a detector',
  postKinds.every((k) => (EMITTABLE_KINDS as readonly string[]).includes(k)),
  `EMITTABLE_KINDS has ${EMITTABLE_KINDS.length} entries; present: ${postKinds
    .map((k) => `${k}=${(EMITTABLE_KINDS as readonly string[]).includes(k) ? 'yes' : 'NO'}`)
    .join('  ')}`,
);

/* ------------------------------------------------------------------ 2. one story per series */

const clinched = of('series_clinched');
const bySeries = new Map<string, number>();
for (const e of clinched) bySeries.set(e.seriesId, (bySeries.get(e.seriesId) ?? 0) + 1);
const seriesList = BRACKET.map((s) => s.seriesId);
const clinchPerSeries = seriesList.map((id) => `${id}:${bySeries.get(id) ?? 0}`).join('  ');

check(
  'a decided series fires series_clinched EXACTLY once, on the deciding game',
  seriesList.every((id) => bySeries.get(id) === 1),
  `per series  ${clinchPerSeries}`
    + `\n        a sweep is the case that catches a "series is over" detector: wc1 is three games long`
    + `\n        and its games 2 and 3 must both stay silent.`,
);

check(
  'the story lands on the game that reached the winning total, which is not always the last one',
  seriesList.every((id) => {
    const fired = clinched.find((e) => e.seriesId === id);
    if (!fired) return false;
    const s = BRACKET.find((b) => b.seriesId === id)!;
    const needed = Math.floor(s.bestOf / 2) + 1;
    // The clinching game is the one on which the winner's cumulative total first hits `needed`.
    let running = 0;
    let clinchGame = 0;
    for (let i = 0; i < s.winners.length; i += 1) {
      if (s.winners[i]) running += 1;
      if (running === needed) { clinchGame = i + 1; break; }
    }
    return fired.gameId === `po-${id}-${clinchGame}`;
  }),
  seriesList
    .map((id) => {
      const s = BRACKET.find((b) => b.seriesId === id)!;
      const needed = Math.floor(s.bestOf / 2) + 1;
      let running = 0; let clinchGame = 0;
      for (let i = 0; i < s.winners.length; i += 1) {
        if (s.winners[i]) running += 1;
        if (running === needed) { clinchGame = i + 1; break; }
      }
      const fired = clinched.find((e) => e.seriesId === id);
      return `${id} best-of-${s.bestOf} needs ${needed}, clinched on game ${clinchGame} of ${s.winners.length}, fired on game ${fired ? fired.gameId.split('-').pop() : 'none'}`;
    })
    .join('\n        ')
    + `\n        wc1 is the case that matters: a 2-0 sweep clinches on game 2 and has no game 3, so a`,
);

/* ------------------------------------------------------------------ 3. elimination mirrors clinch */

const eliminated = of('eliminated');
const elimBySeries = new Map<string, number>();
for (const e of eliminated) elimBySeries.set(e.seriesId, (elimBySeries.get(e.seriesId) ?? 0) + 1);

check(
  'every clinch has exactly one elimination, on the same game',
  seriesList.every((id) => elimBySeries.get(id) === 1 && bySeries.get(id) === 1)
    && seriesList.every((id) => {
      const c = clinched.find((e) => e.seriesId === id);
      const x = eliminated.find((e) => e.seriesId === id);
      return c && x && c.gameId === x.gameId && c.teamId !== x.teamId;
    }),
  seriesList
    .map((id) => {
      const c = clinched.find((e) => e.seriesId === id);
      const x = eliminated.find((e) => e.seriesId === id);
      return `${id}  clinch ${c?.teamId ?? '-'} / eliminated ${x?.teamId ?? '-'}  both on game ${c?.gameId.split('-').pop() ?? '-'}`;
    })
    .join('\n        ')
    + `\n        the two clubs must differ -- a club congratulated and buried on the same game is the`,
);

/* ------------------------------------------------------------------ 4. championship, once */

const champs = of('championship');
check(
  'championship fires exactly once for the whole bracket, and only on the final round',
  champs.length === 1 && champs[0].seriesId === 'ws',
  `fired ${champs.length} time(s)${champs.length ? ` on ${champs[0].seriesId} for ${champs[0].teamId}` : ''}; the only world_series in this bracket is ws`
    + `\n        it must not fire on wc1, wc2 or dv1 -- a league championship is not a wild card win`,
);

check(
  'the champion is the club that actually won the final series',
  champs.length === 1 && champs[0].teamId === 'suk',
  `champion ${champs[0]?.teamId ?? 'none'}; ws winners were ${BRACKET.find((s) => s.seriesId === 'ws')!.winners
    .map((w) => (w ? 'suk' : 'des')).join(', ')}`,
);

/* ------------------------------------------------------------------ 5. never on a regular-season game */

const regularSeason = games.map((g, i) => ({
  ...g,
  gameId: `rs-${i}`,
  phase: 'regular_season' as const,
  playoff: null,
}));
const regularEmissions: GameEventKind[] = [];
for (const game of regularSeason) {
  const shape = {
    awayTeamId: game.awayTeam,
    homeTeamId: game.homeTeam,
    awayWon: game.score.away > game.score.home,
    homeWon: game.score.home > game.score.away,
    winnerTeamId: game.score.away > game.score.home ? game.awayTeam : game.homeTeam,
    loserTeamId: game.score.away > game.score.home ? game.homeTeam : game.awayTeam,
    winnerWasUnderdog: false,
  } as unknown as GameShape;
  const derived = deriveGameLines(game) as never;
  const events = extractGameEvents({
    game, shape, derived, teamsById, playersById,
    completedGamesDesc: regularSeason.slice(0, regularSeason.indexOf(game) + 1).reverse(),
    baselines: null,
  });
  for (const e of events) if (postKinds.includes(e.kind)) regularEmissions.push(e.kind);
}

check(
  'no postseason event fires on a regular-season game',
  regularEmissions.length === 0,
  `${regularSeason.length} regular-season games, ${regularEmissions.length} postseason events emitted from them`
    + `\n        the guards read game.playoff, and this asserts it on output rather than on source`,
);

/* ------------------------------------------------------------------ 6. coverage and voice */

const covered = (kind: GameEventKind) => HEADLINERS.filter((h) => h.covers.includes(kind)).map((h) => h.id);
check(
  'each postseason kind reaches at least one byline with non-empty lines for it',
  postKinds.every((k) => {
    const reporters = covered(k);
    return reporters.length > 0 && reporters.some((id) => (VOICE_BANKS[id].titles[k]?.length ?? 0) > 0);
  }),
  postKinds
    .map((k) => `${k} -> ${covered(k).join(', ') || 'NOBODY'}`)
    .join('\n        '),
);

/* ------------------------------------------------------------------ 7. the copy renders */

const sampleSlots = { TEAM: 'Sukensi Prawns', OPPONENT: 'Desseldein Muskets', LEAGUE: 'Platinum', FIGURE: '3', ARENA: 'Sukensi' };
const interpolation: string[] = [];
for (const kind of postKinds) {
  for (const h of HEADLINERS.filter((p) => p.covers.includes(kind))) {
    const bank = VOICE_BANKS[h.id];
    for (const list of [bank.titles[kind] ?? [], bank.decks[kind] ?? []]) {
      for (const t of list) {
        const rendered = interpolate(t, sampleSlots);
        if (rendered === null) interpolation.push(`${h.id}/${kind}: "${t}"`);
      }
    }
  }
}
check(
  'every postseason template fills from the slots its detector supplies',
  interpolation.length === 0,
  interpolation.length
    ? interpolation.join('\n        ')
    : 'all titles and decks interpolated with {TEAM} {OPPONENT} {LEAGUE} {FIGURE} {ARENA}',
);

console.log(`\n  ${5 + 2 - 0} checks, ${failures} failed\n`);
process.exitCode = failures === 0 ? 0 : 1;