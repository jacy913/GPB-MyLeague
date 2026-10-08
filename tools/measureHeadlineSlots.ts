/**
 * Which headline slots are ACTUALLY POPULATED, per event kind?
 *
 * Written before a single new template, because it is the measurement that decides
 * which templates can be written at all.
 *
 * THE TRAP THIS EXISTS TO AVOID
 *
 * `HeadlineSlots` declares ten optional keys: PLAYER, AGE, TEAM, CITY, RIVAL,
 * RIVAL_PITCHER, ARENA, OPPONENT, LEAGUE, FIGURE. Declared is not populated.
 *
 * `interpolate` in headlinerVoices.ts returns null when a template names a slot the
 * event does not carry, and the pick then falls through to the generic bank. So a deck
 * written against `{RIVAL_PITCHER}` for a detector that never populates it is not a
 * deck -- it is a line in a source file that can never render, and the story silently
 * falls back to whatever the generic bank says instead.
 *
 * That is the same failure shape as the dropped `case` arms in the team-prop fit, and
 * it is invisible: the template looks written, the count goes up, and the output does
 * not change. It is why "titles in play" from measureVoiceBanks.ts is a ceiling and
 * not a count of what a reader ever sees.
 *
 * METHOD
 *
 * Runs the real detectors over real simulated seasons -- no hand-listed fixtures -- and
 * tabulates, per kind, how many events carried each slot non-empty. A slot at 0% is
 * unusable in a template for that kind. A slot at 100% is always safe.
 *
 * Run: npx tsx tools/measureHeadlineSlots.ts [warmupDays] [days]
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
import { extractGameEvents, buildLeagueRateBaselines } from '../src/logic/headlinerEvents';
import { buildGameIndexes, deriveGameLines, deriveGameShape } from '../src/logic/headlineEngine';
import { HEADLINERS, type GameEvent, type GameEventKind } from '../src/logic/headliners';
import type { Game, LeaguePlayerState, Player, Team } from '../src/types';

const YEAR = 2026;
const WARMUP = Number(process.argv[2] ?? 30);
const DAYS = Number(process.argv[3] ?? 120);

const SLOTS = [
  'PLAYER', 'AGE', 'TEAM', 'CITY', 'RIVAL',
  'RIVAL_PITCHER', 'ARENA', 'OPPONENT', 'LEAGUE', 'FIGURE',
] as const;

type SlotName = typeof SLOTS[number];

/** kinds -> slot -> how many of that kind's events carried it non-empty */
const present = new Map<GameEventKind, Map<SlotName, number>>();
const counts = new Map<GameEventKind, number>();

const note = (event: GameEvent): void => {
  const kind = event.kind;
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  let row = present.get(kind);
  if (!row) { row = new Map(); present.set(kind, row); }
  SLOTS.forEach((slot) => {
    const value = event.slots[slot];
    if (value !== undefined && value !== '') row!.set(slot, (row!.get(slot) ?? 0) + 1);
  });
};

const main = async (): Promise<void> => {
  const universe = buildNewUniverse({
    teams: INITIAL_TEAMS.map((t) => ({ ...t })),
    seasonYear: YEAR,
    seed: 4242,
    effectiveDate: `${YEAR}-12-15`,
  }).playerState;

  let teams: Team[] = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((t) => ({ ...t, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0 })),
    universe, YEAR,
  );
  const schedule = () => generateSchedule(teams, {
    seasonStartDate: getDefaultSeasonStartDate(YEAR), seasonDays: 180,
  });
  let games: Game[] = schedule();
  const manager = new SimulationManager({
    teams,
    games,
    playerState: universe,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  let state: LeaguePlayerState = universe;
  for (let day = 0; day < WARMUP; day += 1) {
    const r = await manager.run({ scope: 'day' });
    state = r.playerState; games = r.games; teams = r.teams;
  }

  const playerById = new Map<string, Player>();
  state.players.forEach((p) => playerById.set(p.playerId, p));

  /*
   * The detector input is assembled EXACTLY as HomeDashboard assembles it, because a
   * hand-rolled approximation would measure a different pipeline than the one that
   * runs. `extractGameEvents` is per-game and needs the derived lines, the shape, the
   * history in descending order and the league-rate baselines -- the same four memos
   * the dashboard builds at lines 331-345.
   */
  let total = 0;
  let history: Game[] = [];
  /*
   * Derived lines, held ACROSS days and extended rather than rebuilt.
   *
   * The first version rebuilt all 120 of them on every day of the walk, which is
   * 120 x 150 `deriveGameLines` calls over the run. It was still going after six minutes
   * of CPU and got killed. Production does not do this: HomeDashboard memoises
   * `derivedLinesByGameId` on the completed-game list, so each game's lines are derived
   * once for the life of the view.
   *
   * Same fix here, and the same result: a game's derived lines do not change once the
   * game is over, so deriving them again tomorrow can only produce the same object. The
   * map is keyed by gameId, so a day that completes a game the tool has already seen
   * is a no-op, and only genuinely new games are derived.
   */
  const derivedByGameId = new Map<string, ReturnType<typeof deriveGameLines>>();

  for (let day = 0; day < DAYS; day += 1) {
    const r = await manager.run({ scope: 'day' });
    // Newest first, INCLUDING this game. Streak and debut detectors read the order.
    const completedToday = r.games.filter((g) => g.status === 'completed');
    completedToday.forEach((g) => {
      if (!derivedByGameId.has(g.gameId)) derivedByGameId.set(g.gameId, deriveGameLines(g));
    });
    history = [...completedToday, ...history].slice(0, 400);
    /*
     * Built through `buildGameIndexes` rather than slicing `history` by hand.
     *
     * The per-game "history ends here" boundary is a rule, and this tool was previously passing the
     * whole descending list -- the same leak the dashboard had. Reimplementing the boundary here
     * would be a second copy of the rule that could disagree with the one in `headlineEngine`, which
     * is exactly how a measurement starts disagreeing with the thing it measures.
     */
    const indexes = buildGameIndexes(history);

    const teamsById = new Map(r.teams.map((t) => [t.id, t]));
    const playersById = new Map(r.playerState.players.map((p) => [p.playerId, p]));

    // Newest 120, mirroring the dashboard's slice. Derived lines come from the
    // persistent map above rather than being recomputed.
    const baselines = buildLeagueRateBaselines(history.slice(0, 120), derivedByGameId);

    completedToday
      .filter((g) => derivedByGameId.has(g.gameId))
      .forEach((game) => {
        const derived = derivedByGameId.get(game.gameId)!;
        const shape = deriveGameShape(game, teamsById, derived);
        extractGameEvents({
          game,
          shape,
          derived,
          teamsById,
          playersById,
          completedGamesDesc: indexes.completedGamesUpTo(game.gameId),
          baselines,
        }).forEach((event) => { note(event); total += 1; });
      });

    state = r.playerState; games = r.games; teams = r.teams;
  }
  void playerById;

  console.log(`\nSLOT POPULATION BY EVENT KIND  (${WARMUP} warmup + ${DAYS} days, ${total} events)\n`);
  const header = '  kind'.padEnd(22) + SLOTS.map((s) => s.slice(0, 6).padStart(8)).join('');
  console.log(header);
  console.log('  ' + '-'.repeat(22 + 8 * SLOTS.length));

  const kinds = [...counts.keys()].sort();
  kinds.forEach((kind) => {
    const n = counts.get(kind) ?? 0;
    const row = present.get(kind)!;
    const cells = SLOTS.map((slot) => {
      const have = row.get(slot) ?? 0;
      const pct = Math.round((have / n) * 100);
      // A template using a slot that is not universally present still renders -- but
      // only on the events that carry it. Marked so it is a deliberate choice.
      if (pct === 0) return `${'-'}`.padStart(8);
      if (pct === 100) return `${pct}%`.padStart(8);
      return `${pct}%*`.padStart(8);
    });
    console.log(`  ${kind.padEnd(22)}${cells.join('')}   n=${n}`);
  });

  console.log(`\n  '-'  = never populated for that kind. A template naming it CANNOT render.`);
  console.log(`  '%*' = populated on some events only. Usable, but that template is dead for`);
  console.log(`         the rest, so it silently falls back to generic on those days.`);

  // The actionable summary: which slots are safe to write against, per covered kind.
  console.log('\n  SAFE SLOTS PER PERSONA (present on 100% of the kinds they cover)\n');
  HEADLINERS.forEach((persona) => {
    const lines = persona.covers
      .map((kind) => {
        const n = counts.get(kind) ?? 0;
        if (n === 0) return null;
        const row = present.get(kind)!;
        const safe = SLOTS.filter((s) => (row.get(s) ?? 0) === n);
        return `    ${kind.padEnd(20)} ${safe.length > 0 ? safe.join(' ') : '(none -- generic bank only)'}`;
      })
      .filter((line): line is string => line !== null);
    console.log(`  ${persona.displayName}`);
    console.log(lines.length > 0 ? lines.join('\n') : '    (no events observed for the kinds it covers)');
    console.log('');
  });

  console.log(
    '  Kinds with zero events in this window are listed as absent rather than guessed.\n' +
    '  Widen the window before concluding a detector is dead.',
  );
};

void main();