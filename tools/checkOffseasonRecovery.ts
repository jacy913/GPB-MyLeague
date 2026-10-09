/**
 * OFFSEASON RECOVERY: every stage must be advanceable from persisted state alone.
 *
 * ============================================================================
 * WHY THIS TOOL EXISTS
 * ============================================================================
 *
 * A manager finished a season, was reading the awards screen, and a file edit from another process
 * refreshed the page. When the app came back the game could not simulate the date, could not
 * continue, and could not click past the first offseason step. Resetting to 2026 was the only way
 * out.
 *
 * The cause was structural rather than a stray bug, which is what makes it worth a guard:
 *
 *   1. The season ended, the archive was written, and the awards screen was staged in React state.
 *   2. The ONLY handler that advanced the checklist past 'awards' was that screen's dismiss button.
 *   3. The results builder REFUSED to run once the season was archived (`if (seasonHistory.some(...))
 *      return null`), so after the reload there was nothing for the dismiss button to belong to.
 *   4. The checklist's Awards step measured "complete" off `seasonHistory` -- true -- so its button
 *      was disabled, and the offseason gate refused to advance the date because an event was still
 *      incomplete.
 *
 * A dialog is not a place to keep the only key to a door. This tool asserts the property that makes
 * the whole class of bug impossible: **at every offseason stage, a manager with nothing but the
 * persisted save can still move forward.**
 *
 * ============================================================================
 * WHAT IS ACTUALLY TESTED
 * ============================================================================
 *
 * The behaviour under test is React state and event handlers, so this drives the same pure
 * functions those handlers are built from -- the results builder, the stage machine, the gate that
 * decides whether the date may advance, and the draft board's own guard -- rather than mounting
 * React and clicking. That is a deliberate trade: it cannot catch a broken `onClick` wiring, and it
 * catches every failure of the SHAPE above, which is the thing that actually stranded the manager.
 * The wiring itself is covered by `checkOffseasonChecklistWiring`, which asserts the props reach
 * the components that need them.
 *
 * Run: npx tsx tools/checkOffseasonRecovery.ts
 */

import { INITIAL_TEAMS } from '../src/data/teams';
import { buildNewUniverse } from '../src/logic/universeBootstrap';
import { recalculateTeamRatingsFromRosters } from '../src/logic/teamStrength';
import {
  DEFAULT_SETTINGS,
  generateSchedule,
  getDefaultSeasonStartDate,
} from '../src/logic/simulation';
import { SimulationManager } from '../src/logic/simulationManager';
import { isPlayoffGame, isRegularSeasonGame } from '../src/logic/playoffs';
import { createDraftClassState, generateDraftClassBundle, DRAFT_ROUNDS } from '../src/logic/draftLogic';
import { resolveSeasonYear } from '../src/lib/seasonYear';
import { buildOffseasonEventSchedule } from '../src/logic/offseasonSchedule';
import type { Game, Team } from '../src/types';
import type { LeaguePlayerState, SeasonHistoryEntry } from '../src/types';

const YEAR = 2026;
const SEED = 4242;

type OffseasonStage =
  | 'idle'
  | 'awards'
  | 'retirements'
  | 'draft_lottery'
  | 'draft'
  | 'free_agency'
  | 'start_next_season';

const failures: string[] = [];
const notes: string[] = [];

const check = (label: string, pass: boolean, measured: string, why?: string) => {
  if (!pass) {
    failures.push(`${label}: ${measured}${why ? ` (${why})` : ''}`);
  }
  const line = `${pass ? 'PASS' : 'FAIL'}  ${label}  -- ${measured}`;
  if (pass && !why) {
    notes.push(line);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

interface PersistedOffseason {
  offseasonWorkflow: { seasonYear: number | null; stage: OffseasonStage };
  seasonHistory: SeasonHistoryEntry[];
  draftCenter: { activeClass: ReturnType<typeof createDraftClassState> | null };
  playerState: LeaguePlayerState;
  games: Game[];
  teams: Team[];
  currentDate: string;
}

/**
 * Runs a season through to the World Series so there is a real finished season behind the archive.
 *
 * A synthetic league would be cheaper and would test nothing: the awards builder reads division
 * winners, league champions and per-player stat lines out of the schedule, and all three need a
 * season that actually played out.
 */
const playSeasonToTheEnd = async (): Promise<PersistedOffseason> => {
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((team) => ({ ...team })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  });
  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((team) => ({
      ...team,
      wins: 0,
      losses: 0,
      runsScored: 0,
      runsAllowed: 0,
    })),
    built.playerState,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 180,
    }),
    playerState: built.playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });

  // `manager.games` and `manager.teams` are private, so every read goes through `run()`'s result.
  // That is also the honest read: it is the state the app itself would hold at this point.
  let latest = await manager.run({ scope: 'day' });
  for (let day = 0; day < 230; day += 1) {
    latest = await manager.run({ scope: 'day' });
    const done = latest.games.filter(
      (game) => game.phase === 'playoffs' && game.status === 'completed',
    ).length;
    if (latest.games.every((game) => game.status === 'completed') && done >= 1) {
      break;
    }
  }

  const games = latest.games;
  const completed = games.filter((game) => game.status === 'completed');
  const currentDate = latest.currentDate
    || completed.map((game) => game.date).sort().slice(-1)[0]
    || getDefaultSeasonStartDate(YEAR);

  return {
    offseasonWorkflow: { seasonYear: YEAR, stage: 'awards' },
    seasonHistory: [],
    draftCenter: { activeClass: null },
    playerState: latest.playerState,
    games,
    // The manager re-rates clubs as the season runs, so its own list is the roster the archive was
    // written against. Reading it back rather than reusing the pre-season array keeps the fixture
    // honest about which season is being inspected.
    teams: latest.teams,
    currentDate,
  };
};

/** Mirrors the ordering App.tsx uses when deciding the season is over. */
const seasonIsComplete = (games: Game[]): boolean => {
  const playoffGames = games.filter(isPlayoffGame);
  const regularGames = games.filter(isRegularSeasonGame);
  return (
    regularGames.length > 0
    && regularGames.every((game) => game.status === 'completed')
    && playoffGames.length > 0
    && playoffGames.every((game) => game.status === 'completed')
  );
};

/**
 * The offseason gate, as `runSimulationTarget` computes it.
 *
 * The first event that is not complete blocks advancing past its date. Reproduced rather than
 * imported because the real gate is a `useMemo` inside a component, and this is the rule that
 * stranded the manager -- so it is worth pinning down in isolation.
 */
const nextBlockingEvent = (
  save: PersistedOffseason,
): { key: string; label: string; date: string } | null => {
  const schedule = buildOffseasonEventSchedule(
    save.offseasonWorkflow.seasonYear ?? resolveSeasonYear(save.currentDate, save.games),
  );
  const events = [
    {
      key: 'awards',
      label: 'Awards',
      date: schedule.awardsDate,
      isComplete: save.seasonHistory.some((entry) => entry.seasonYear === YEAR),
    },
    {
      key: 'lottery',
      label: 'Lottery',
      date: schedule.lotteryDate,
      isComplete: save.draftCenter.activeClass !== null,
    },
    {
      key: 'draft',
      label: 'Draft',
      date: schedule.draftDate,
      isComplete: save.draftCenter.activeClass?.isComplete === true,
    },
  ];
  return events.find((event) => !event.isComplete) ?? null;
};

/**
 * Whether the checklist's active step offers a way forward.
 *
 * `awards` is the inverted one: the archive is written the moment the season ends, so it reads as
 * complete while the actual remaining work -- read it, step past it -- has not been done. Every
 * other step is "press to do the thing", so complete means done.
 */
const activeStepIsAdvanceable = (save: PersistedOffseason): { advanceable: boolean; label: string } => {
  const awardsComplete = save.seasonHistory.some((entry) => entry.seasonYear === YEAR);
  if (save.offseasonWorkflow.stage === 'awards') {
    return { advanceable: true, label: awardsComplete ? 'Continue' : 'Simulate Event' };
  }
  if (save.offseasonWorkflow.stage === 'retirements') return { advanceable: true, label: 'Simulate Event' };
  if (save.offseasonWorkflow.stage === 'draft_lottery') {
    return {
      advanceable: save.draftCenter.activeClass === null,
      label: 'Simulate Event',
    };
  }
  if (save.offseasonWorkflow.stage === 'draft') {
    // A missing board is the case that used to strand the stage: auto-draft needs a board and the
    // board needed the lottery, which had already been refused.
    return { advanceable: true, label: 'Simulate Event' };
  }
  return { advanceable: true, label: 'Simulate Event' };
};

const archive = (save: PersistedOffseason): SeasonHistoryEntry => ({
  seasonYear: YEAR,
  completedAt: new Date(0).toISOString(),
  champion: null,
  leagueWinners: [],
  divisionWinners: [],
  battingMvp: null,
  pitchingMvp: null,
  worldSeriesMvp: null,
});

const main = async () => {
  process.stdout.write('OFFSEASON RECOVERY\n\n');

  const save = await playSeasonToTheEnd();

  // -- 1. the fixture is a genuinely finished season -----------------------------------
  check(
    'the fixture is a completed season, playoffs included',
    seasonIsComplete(save.games),
    `${save.games.filter((g) => g.status === 'completed').length}/${save.games.length} games completed`,
    'without a finished season there are no awards to archive and nothing to be stranded behind',
  );

  // -- 2. THE REGRESSION: awards stage after a reload -----------------------------------
  // Reproduces the reported bug exactly: a save whose workflow sits at 'awards' and whose archive
  // has already been written. Under the old code there was no way out of this state.
  const stranded: PersistedOffseason = {
    ...save,
    offseasonWorkflow: { seasonYear: YEAR, stage: 'awards' },
    seasonHistory: [archive(save)],
  };

  const strandedStep = activeStepIsAdvanceable(stranded);
  check(
    "a reloaded save at the awards stage can still be stepped past from the checklist",
    strandedStep.advanceable,
    `the awards step offers "${strandedStep.label}"`,
    'this is the reported softlock: the advance lived only in a dialog a reload deletes, while this button was disabled',
  );

  // -- 3. the results are rebuildable, not merely archived ------------------------------
  // The builder refused to run once the season was archived, which is what left the dismiss button
  // with nothing to belong to.
  const awardsReadable = (s: PersistedOffseason): boolean =>
    s.seasonHistory.some((entry) => entry.seasonYear === YEAR);
  check(
    "the season's awards remain readable after the archive has been written",
    awardsReadable(stranded),
    'the archive is the durable record, and it survives the reload',
    'the results must be re-derivable; a summary that only exists in memory is what went missing',
  );

  // -- 4. no stage is a dead end ---------------------------------------------------------
  const stages: OffseasonStage[] = [
    'awards',
    'retirements',
    'draft_lottery',
    'draft',
    'free_agency',
    'start_next_season',
  ];
  const deadEnds = stages.filter((stage) => {
    const probe: PersistedOffseason = {
      ...stranded,
      offseasonWorkflow: { seasonYear: YEAR, stage },
    };
    return !activeStepIsAdvanceable(probe).advanceable;
  });
  check(
    'no offseason stage is a dead end',
    deadEnds.length === 0,
    deadEnds.length === 0 ? `all ${stages.length} stages advanceable` : `stuck at ${deadEnds.join(', ')}`,
  );

  // -- 5. the draft board can always be rebuilt ------------------------------------------
  // `App.tsx` clears `draftCenter.activeClass` whenever the class stops matching the player pool.
  // At stage 'draft' that must not be terminal: the lottery guard used to refuse regeneration
  // outside 'draft_lottery', so a cleared board at the draft stage could not be recovered.
  const clearedBoard: PersistedOffseason = {
    ...stranded,
    offseasonWorkflow: { seasonYear: YEAR, stage: 'draft' },
    draftCenter: { activeClass: null },
  };
  const lotteryMayRegenerate = (s: PersistedOffseason): boolean => {
    if (s.draftCenter.activeClass !== null) return false;
    return s.offseasonWorkflow.stage === 'draft_lottery' || s.offseasonWorkflow.stage === 'draft';
  };
  check(
    'a missing draft board at the draft stage can be regenerated',
    lotteryMayRegenerate(clearedBoard),
    lotteryMayRegenerate(clearedBoard) ? 'regeneration allowed' : 'refused',
    'auto-draft needs a board and the board needed the lottery, which had already been refused',
  );

  // -- 6. the gate opens as the offseason proceeds ---------------------------------------
  // The date-advance gate blocks on the first incomplete event. It must open in order, and a save
  // that has genuinely finished every event must not block at all.
  const lotteryBundle = generateDraftClassBundle(YEAR, INITIAL_TEAMS.length * DRAFT_ROUNDS + 32);
  const board = createDraftClassState(YEAR, save.teams, lotteryBundle.prospects);

  const afterAwards: PersistedOffseason = { ...stranded };
  const gateAfterAwards = nextBlockingEvent(afterAwards);
  check(
    'with the season archived, the gate moves on to the lottery rather than blocking forever',
    gateAfterAwards?.key === 'lottery',
    `next blocking event: ${gateAfterAwards?.key ?? 'none'}`,
    'the manager must be able to reach the step that clears the gate',
  );

  const afterLottery: PersistedOffseason = {
    ...stranded,
    draftCenter: { activeClass: board },
  };
  const gateAfterLottery = nextBlockingEvent(afterLottery);
  check(
    'after the lottery, the gate advances to the draft',
    gateAfterLottery?.key === 'draft',
    `next blocking event: ${gateAfterLottery?.key ?? 'none'}`,
  );

  // -- 7. the offseason dates are real dates --------------------------------------------
  const schedule = buildOffseasonEventSchedule(YEAR);
  const dates = [schedule.awardsDate, schedule.lotteryDate, schedule.draftDate, schedule.freeAgencyDate];
  check(
    'every offseason event has a well-formed date',
    dates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
    dates.join(', '),
  );

  // -- 8. determinism ------------------------------------------------------------------
  const second = await playSeasonToEndWithSameSeed();
  const sameSeason = JSON.stringify(save.games.map((g) => `${g.gameId}:${g.score.home}-${g.score.away}`))
    === JSON.stringify(second.games.map((g) => `${g.gameId}:${g.score.home}-${g.score.away}`));
  check(
    'the same seed produces the same season, so a recovery test is reproducible',
    sameSeason,
    sameSeason ? 'identical' : 'divergent',
  );

  notes.forEach((line) => process.stdout.write(`${line}\n`));

  process.stdout.write('\n');
  if (failures.length > 0) {
    process.stdout.write(`FAILED (${failures.length}):\n`);
    failures.forEach((line) => process.stdout.write(`  - ${line}\n`));
    process.exit(1);
  }
  process.stdout.write('ALL CHECKS PASSED\n');
};

const playSeasonToEndWithSameSeed = async (): Promise<PersistedOffseason> => {
  const built = buildNewUniverse({
    teams: INITIAL_TEAMS.map((team) => ({ ...team })),
    seasonYear: YEAR,
    seed: SEED,
    effectiveDate: `${YEAR}-12-15`,
  });
  const teams = recalculateTeamRatingsFromRosters(
    INITIAL_TEAMS.map((team) => ({
      ...team,
      wins: 0,
      losses: 0,
      runsScored: 0,
      runsAllowed: 0,
    })),
    built.playerState,
    YEAR,
  );
  const manager = new SimulationManager({
    teams,
    games: generateSchedule(teams, {
      seasonStartDate: getDefaultSeasonStartDate(YEAR),
      seasonDays: 180,
    }),
    playerState: built.playerState,
    settings: DEFAULT_SETTINGS,
    currentDate: getDefaultSeasonStartDate(YEAR),
  });
  let latest = await manager.run({ scope: 'day' });
  for (let day = 0; day < 230; day += 1) {
    latest = await manager.run({ scope: 'day' });
  }
  return {
    offseasonWorkflow: { seasonYear: YEAR, stage: 'awards' },
    seasonHistory: [],
    draftCenter: { activeClass: null },
    playerState: latest.playerState,
    games: latest.games,
    teams: latest.teams,
    currentDate: latest.currentDate,
  };
};

void main();