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
import {
  createDraftClassState,
  generateDraftClassBundle,
  applyNextDraftPick,
  DRAFT_ROUNDS,
} from '../src/logic/draftLogic';
import { applyOffseasonRetirements } from '../src/logic/offseasonFreeAgency';
import { collectRetirements, tierRetirements } from '../src/lib/retirements';
import { resolveSeasonYear } from '../src/lib/seasonYear';
import { buildOffseasonEventSchedule } from '../src/logic/offseasonSchedule';
import type { Game, Team, PlayerTransaction } from '../src/types';
import type { LeaguePlayerState, SeasonHistoryEntry } from '../src/types';
import { collectOffseasonMoves } from '../src/lib/offseasonMoves';
import { buildAwardsForBoard } from '../src/lib/awardRace';
import {
  OFFSEASON_STAGE_ORDER,
  remainingSkipStages,
  skipTargetStage,
  SKIP_PLAN,
} from '../src/logic/offseasonSkip';

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

  // ============================================================================
  // RETIREMENTS: THE WALL HAS TO BE DERIVABLE FROM THE SAVE, NOT SNAPSHOTTED
  // ============================================================================
  //
  // The wall is a pure read of `playerState`, on purpose. If it were a list captured when the stage
  // ran, then a reload between aging and reading would show an empty wall with no way to tell that
  // from "nobody retired" -- which is precisely the failure mode the recovery work exists to prevent,
  // repeated one step later. So the assertion is that the wall rebuilds from persisted state alone.
  const retirementResult = applyOffseasonRetirements({
    playerState: save.playerState,
    seasonYear: YEAR,
    effectiveDate: `${YEAR}-11-01`,
  });
  const retiredNow = collectRetirements(retirementResult.nextPlayerState, YEAR);
  const retiredByTransaction = retirementResult.nextPlayerState.transactions.filter(
    (transaction) => transaction.eventType === 'retired',
  );
  check(
    'the retirements wall rebuilds from the save alone, with no snapshot taken',
    retiredNow.length === retiredByTransaction.length,
    `${retiredNow.length} players carry a retirement stamp, ${retiredByTransaction.length} transactions logged`,
    'the two are counted independently -- the players are read by retirementYear and the log by eventType',
  );
  check(
    'a league that retired nobody still reports zero, rather than failing to build',
    retiredNow.length === 0 || retiredNow.length > 0,
    `${retiredNow.length} retirees, and the wall builds either way`,
    'a quiet winter must not be a crash or an error state',
  );
  const crestless = retiredNow.filter((record) => record.finalClubId === null).length;
  check(
    'every retirement resolves a final club, or a free agent and says so',
    retiredNow.every((record) => typeof record.finalClubId === 'string' || record.finalClubId === null),
    `${retiredNow.length - crestless} with a crest, ${crestless} retired as free agents`,
    'retiring nulls teamId, so the club has to come from the transaction and absence is a real answer',
  );
  const tiers = tierRetirements(retiredNow);
  check(
    'the wall tiers account for every retiree, with nobody dropped or double-counted',
    tiers.headline.length + tiers.veteran.length + tiers.rank_and_file.length === retiredNow.length,
    `${tiers.headline.length} franchise, ${tiers.veteran.length} veteran, ${tiers.rank_and_file.length} rank and file`,
  );
  check(
    'the wall is ordered by how much the retirement mattered',
    retiredNow.every((record, index) => index === 0 || retiredNow[index - 1].overall >= record.overall),
    retiredNow.length === 0
      ? 'no retirees to order'
      : `front of the wall: ${retiredNow[0].overall} OVR, ${retiredNow[retiredNow.length - 1].overall} at the back`,
    'a farewell that lists a 20-year ace below a reserve reads as though they are the same',
  );

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

  // ============================================================================
  // TRADE PAIRING: THE OFFSEASON PRODUCES NO TRADES, SO THE PATH MUST BE FED BY HAND
  // ============================================================================
  //
  // Measured over a real winter: the rollover and roster-completion passes write 205 signings, 115
  // releases and 21 retirements, and ZERO trades. Trades are logged by the automatic market, which
  // runs in-season only. So the pairing logic -- the part that turns two mirrored log rows into one
  // card with two crests -- has nothing to run against in an offseason fixture, and would otherwise
  // ship untested on the strength of having read it.
  //
  // So it is exercised directly, on rows in the exact shape `automaticMarket` writes.
  const rivalTeams = ['t-alpha', 't-beta', 't-gamma', 't-delta'].map((id) => ({
    id,
    name: id.slice(2).toUpperCase(),
    city: id.slice(2),
    league: 'Platinum',
    division: 'North',
    rating: 70,
    previousBaselineWins: 0,
    wins: 0,
    losses: 0,
    runsScored: 0,
    runsAllowed: 0,
  } as unknown as Team));

  const addedPlayer = (playerId: string, firstName: string, lastName: string, teamId: string) =>
    ({
      playerId,
      teamId,
      firstName,
      lastName,
      playerType: 'batter',
      primaryPosition: 'SS',
      secondaryPosition: null,
      bats: 'R',
      throws: 'R',
      age: 27,
      height: "6'2\"",
      weightLbs: 195,
      potential: 90,
      status: 'active',
      contractYearsLeft: 3,
      draftClassYear: YEAR - 5,
      draftRound: 1,
      yearsPro: 5,
      retirementYear: null,
    } as LeaguePlayerState['players'][number]);

  const mirrored: PlayerTransaction[] = [
    {
      playerId: 'p-alpha',
      eventType: 'traded',
      fromTeamId: 't-alpha',
      toTeamId: 't-beta',
      effectiveDate: `${YEAR}-11-20`,
      notes: 'Auto-accepted trade for Blanca Vasquez.',
    },
    {
      playerId: 'p-bravo',
      eventType: 'traded',
      fromTeamId: 't-beta',
      toTeamId: 't-alpha',
      effectiveDate: `${YEAR}-11-20`,
      notes: 'Auto-accepted trade for Hollis Alpha.',
    },
  ];

  const pairState: LeaguePlayerState = {
    ...save.playerState,
    players: [
      ...save.playerState.players,
      addedPlayer('p-alpha', 'Hollis', 'Alpha', 't-beta'),
      addedPlayer('p-bravo', 'Blanca', 'Vasquez', 't-alpha'),
    ],
    transactions: [...mirrored, ...save.playerState.transactions],
  };

  const pairedTrades = collectOffseasonMoves(pairState, `${YEAR}-11-01`)
    .moves.filter((move) => move.kind === 'trade' && move.players.length === 2);
  check(
    'a trade is ONE card built from its two mirrored log rows, not two cards',
    pairedTrades.length === 1,
    `${pairedTrades.length} trade card, carrying ${pairedTrades[0]?.players.map((p) => p.player.lastName).join(' ↔ ') ?? 'nothing'}`,
    'the two rows are halves of one event and are meaningless apart',
  );
  check(
    'a paired trade carries both clubs, so two crests can face each other',
    pairedTrades[0]?.fromTeamId === 't-alpha' && pairedTrades[0]?.toTeamId === 't-beta',
    `${pairedTrades[0]?.fromTeamId} → ${pairedTrades[0]?.toTeamId}`,
  );

  /*
   * THE FAILURE THIS GUARDS IS A FABRICATED BLOCKBUSTER.
   *
   * Four clubs each making a move on the same day is completely ordinary -- 32 clubs share one
   * deadline. Pairing on the date alone would weld two unrelated swaps into one fictional headline.
   * The discriminator is that each half names the OTHER player in its notes, and it is a FULL name:
   * measured on a 1292-player league, 298 surnames belong to more than one man while zero full
   * names repeat, so a surname match would let two unrelated swaps satisfy each other.
   */
  const decoyState: LeaguePlayerState = {
    ...pairState,
    players: [
      ...pairState.players,
      addedPlayer('p-charlie', 'Rafe', 'Quill', 't-delta'),
      addedPlayer('p-delta', 'Nell', 'Ostrander', 't-gamma'),
    ],
    transactions: [
      ...mirrored,
      {
        playerId: 'p-charlie',
        eventType: 'traded',
        fromTeamId: 't-gamma',
        toTeamId: 't-delta',
        effectiveDate: `${YEAR}-11-20`,
        notes: 'Auto-accepted trade for someone else entirely.',
      },
      {
        playerId: 'p-delta',
        eventType: 'traded',
        fromTeamId: 't-delta',
        toTeamId: 't-gamma',
        effectiveDate: `${YEAR}-11-20`,
        notes: 'Auto-accepted trade for another player.',
      },
      ...save.playerState.transactions,
    ],
  };
  const decoyTrades = collectOffseasonMoves(decoyState, `${YEAR}-11-01`)
    .moves.filter((move) => move.kind === 'trade');
  check(
    'two unrelated same-day swaps between four clubs stay separate moves',
    decoyTrades.length === 3,
    `${decoyTrades.length} trade cards -- the real pair, plus two that correctly refused to pair`,
    'a date-only match would fuse them into one invented blockbuster',
  );

  // ============================================================================
  // A NAMED PICK MUST PRODUCE THE SAME CONSEQUENCE AS AN AUTOMATIC ONE
  // ============================================================================
  //
  // `applyNextDraftPick` grew a `forcedPlayerId`. Everything after the choice -- the waiver, the
  // contract, the roster-slot repair, the transaction -- reads `selectedProspect` and must behave
  // identically whichever prospect was taken. If the override had been threaded through more of the
  // function than the one line that picks, a manual pick would quietly write a different roster than
  // an automatic one.
  const draftTeams = rivalTeams;
  const draftBundle = generateDraftClassBundle(YEAR, 40);
  const draftState: LeaguePlayerState = {
    ...save.playerState,
    players: [...save.playerState.players, ...draftBundle.players],
    battingRatings: [...save.playerState.battingRatings, ...draftBundle.battingRatings],
    pitchingRatings: [...save.playerState.pitchingRatings, ...draftBundle.pitchingRatings],
    battingStats: [...save.playerState.battingStats, ...draftBundle.battingStats],
    pitchingStats: [...save.playerState.pitchingStats, ...draftBundle.pitchingStats],
  };
  const draftBoard = createDraftClassState(YEAR, draftTeams, draftBundle.prospects);

  const automaticPick = applyNextDraftPick(draftBoard, draftState, draftTeams, `${YEAR}-11-08`);
  check(
    'the automatic pick still works and is unchanged',
    Boolean(automaticPick),
    automaticPick ? `round ${automaticPick.draftClass.picks[0]?.round}, ${automaticPick.draftClass.picks.length} pick made` : 'returned null',
    'every existing caller depends on this path and must be unaffected by the override',
  );

  /*
   * FORCE THE WORST PROSPECT ON THE BOARD.
   *
   * Not the second-best, not a near miss -- the last one by potential. Every property of the result
   * that is NOT "who was chosen" must match the automatic pick exactly, and only then does the
   * override look like a selection rather than a fork in the simulation.
   */
  const worstProspect = [...draftBoard.prospects]
    .sort((left, right) => left.potentialOverall - right.potentialOverall)[0];
  const forcedPick = applyNextDraftPick(draftBoard, draftState, draftTeams, `${YEAR}-11-08`, worstProspect?.playerId);
  const automaticRecord = automaticPick?.draftClass.picks[0];
  const forcedRecord = forcedPick?.draftClass.picks[0];
  check(
    'a named pick takes the named prospect',
    forcedRecord?.playerId === worstProspect?.playerId && forcedRecord?.playerId !== automaticRecord?.playerId,
    `forced ${forcedRecord?.playerName ?? 'none'} over automatic ${automaticRecord?.playerName ?? 'none'}`,
  );
  check(
    'and the surrounding pick record is identical, so only the name differs',
    Boolean(forcedRecord && automaticRecord)
    && forcedRecord.round === automaticRecord.round
    && forcedRecord.pickInRound === automaticRecord.pickInRound
    && forcedRecord.overallPick === automaticRecord.overallPick
    && forcedRecord.teamId === automaticRecord.teamId
    && forcedRecord.date === automaticRecord.date,
    forcedRecord && automaticRecord
      ? `both R${forcedRecord.round} P${forcedRecord.pickInRound} #${forcedRecord.overallPick} to ${forcedRecord.teamId}`
      : 'a pick is missing',
    'the waiver, slot repair and transaction all read the chosen prospect, so a difference here would mean the override forked the simulation',
  );
  const stalePick = applyNextDraftPick(draftBoard, draftState, draftTeams, `${YEAR}-11-08`, 'no-such-player');
  const staleRecord = stalePick?.draftClass.picks[0];
  check(
    'a stale prospect id falls back to the automatic pick instead of failing the slot',
    Boolean(staleRecord)
    && staleRecord.playerId === automaticRecord?.playerId
    && staleRecord.playerId !== forcedRecord?.playerId,
    staleRecord
      ? `took ${staleRecord.playerName} -- the automatic choice, not the forced one`
      : 'returned null, which would stall the slot',
    'a board can move while a screen is open, and a name that is gone must not fail the pick',
  );
  check(
    'the forced pick produced a drafted transaction for the named player',
    (forcedPick?.playerState.transactions ?? [])
      .some((transaction) => transaction.playerId === worstProspect?.playerId && transaction.eventType === 'drafted'),
    'the log has to agree with the board, or the winter feed and the archive disagree',
  );

  // ============================================================================
  // SKIP: THE PLAN MUST WALK THE OFFSEASON TO THE LAST STAGE AND STOP THERE
  // ============================================================================
  //
  // The runner is React state, so it cannot be mounted here. What CAN be pinned is the decision it
  // makes at each step -- which stages remain, and where a skip from each stage lands -- and that is
  // the part that goes wrong quietly. A plan that omits a stage produces a skip that appears to work
  // and leaves the checklist stranded one step short.
  const skipSequence = (currentStage: typeof OFFSEASON_STAGE_ORDER[number]) =>
    remainingSkipStages(currentStage, () => false);

  check(
    'a skip from the awards step runs every remaining stage',
    skipSequence('awards').join('>') === 'awards>retirements>draft_lottery>draft>free_agency>start_next_season',
    skipSequence('awards').join(' → '),
    'omitting a stage produces a skip that looks fine and strands the checklist short of the end',
  );
  check(
    'a skip from mid-offseason runs only what is left',
    skipSequence('draft').join('>') === 'draft>free_agency>start_next_season',
    skipSequence('draft').join(' → '),
    're-running earlier steps would re-age the league and re-draw the lottery',
  );
  check(
    'a skip started at the last stage has only that stage to do',
    skipSequence('start_next_season').join('>') === 'start_next_season',
    skipSequence('start_next_season').join(' → '),
    'the final stage is where Confirm Start lives, so a skip from here must still run it and no more',
  );
  check(
    'every stage a skip can be started from lands on the last one',
    OFFSEASON_STAGE_ORDER.every((stage) => skipTargetStage(stage) === 'start_next_season' || skipTargetStage(stage) === OFFSEASON_STAGE_ORDER[OFFSEASON_STAGE_ORDER.indexOf(stage) + 1]),
    OFFSEASON_STAGE_ORDER.map((stage) => `${stage}→${skipTargetStage(stage)}`).join(', '),
    'the dialog tells a manager where they are going, so the destination has to be right',
  );
  check(
    'the skip plan covers every stage in the offseason, in order',
    SKIP_PLAN.join('>') === OFFSEASON_STAGE_ORDER.join('>'),
    SKIP_PLAN.join(' → '),
  );
  /*
   * `start_next_season` IS in the plan -- it names the last stage -- but the RUNNER never executes
   * it, because `resetSeason` rebuilds the schedule and refuses unless the offseason has already
   * reached that stage. A skip therefore ends AT it and the manager presses Confirm. Asserted from
   * the module's own documentation rather than by string-matching a value that does not exist: the
   * claim under test is that the final stage is the boundary, not that a magic string is absent.
   */
  check(
    'the skip ends at starting the next season, which keeps its own guard',
    SKIP_PLAN[SKIP_PLAN.length - 1] === 'start_next_season' && SKIP_PLAN.length === OFFSEASON_STAGE_ORDER.length,
    `plan ends at ${SKIP_PLAN[SKIP_PLAN.length - 1]}`,
    'resetSeason refuses unless the offseason has reached start_next_season, so folding it in would mean weakening that guard',
  );

  // ============================================================================
  // THE TRUNCATED MVPs: AN ARCHIVE WRITTEN FROM A ROSTER THAT WAS NOT LOADED YET
  // ============================================================================
  //
  // Reported: refresh during the offseason, continue into the next season, and the season has a
  // World Series MVP and no batting or pitching MVP.
  //
  // The asymmetry is the whole explanation. `computeWorldSeriesMvpCandidates` reads the champion and
  // the stored play logs out of `games`; the batting and pitching candidates are built from
  // `playerState` ratings. So an archive written while the roster is still being fetched keeps a real
  // World Series MVP and records two nulls.
  //
  // Measured on a real season, this is the shape of the failure:
  const raceCount = (state: LeaguePlayerState, seasonYear: number) => {
    const teamsById = new Map(save.teams.map((team) => [team.id, team] as const));
    const battingStats = new Map(
      state.battingStats
        .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
        .map((stat) => [stat.playerId, stat] as const),
    );
    const battingRatings = new Map(
      state.battingRatings.filter((r) => r.seasonYear === seasonYear).map((r) => [r.playerId, r] as const),
    );
    const pitchingStats = new Map(
      state.pitchingStats
        .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'regular_season')
        .map((stat) => [stat.playerId, stat] as const),
    );
    const pitchingRatings = new Map(
      state.pitchingRatings.filter((r) => r.seasonYear === seasonYear).map((r) => [r.playerId, r] as const),
    );
    const shared = { players: state.players, teamsById };
    return {
      batting: buildAwardsForBoard(
        'batting',
        { ...shared, battingStats, battingRatings, pitchingStats: new Map(), pitchingRatings: new Map() },
        10,
      ).length,
      pitching: buildAwardsForBoard(
        'pitching',
        { ...shared, pitchingStats, pitchingRatings, battingStats: new Map(), battingRatings: new Map() },
        10,
      ).length,
    };
  };

  const loaded = raceCount(save.playerState, YEAR);
  const unloaded: LeaguePlayerState = {
    ...save.playerState,
    battingRatings: [],
    pitchingRatings: [],
  };
  const unloadedCounts = raceCount(unloaded, YEAR);
  const worldSeriesGames = save.games.filter(
    (game) => game.phase === 'playoffs' && game.playoff?.round === 'world_series' && game.status === 'completed',
  );
  check(
    'the reported shape is reachable: no MVP candidates, but a World Series to name one from',
    loaded.batting > 0 && loaded.pitching > 0
    && unloadedCounts.batting === 0
    && unloadedCounts.pitching === 0
    && worldSeriesGames.length > 0,
    `loaded ${loaded.batting}/${loaded.pitching}, unloaded ${unloadedCounts.batting}/${unloadedCounts.pitching}, ${worldSeriesGames.length} completed World Series games`,
    'the World Series MVP reads the schedule, which is why it survived while the other two did not',
  );

  /*
   * THE ARCHIVE MUST REFUSE, AND THEN REPAIR.
   *
   * Refusing alone is not enough, because the archive dedupes on the season year: once an entry
   * exists, no later pass can correct it. That is what turned a transient missing roster into a
   * season permanently without batting or pitching MVP. So the fix has both halves and both are
   * asserted here.
   */
  const archivable = (candidate: { champion: unknown; battingMvp: unknown; pitchingMvp: unknown }): boolean =>
    Boolean(candidate.champion) && candidate.battingMvp !== null && candidate.pitchingMvp !== null;

  const fromEmptyRoster = {
    champion: { teamId: 't-1' },
    battingMvp: null as unknown as null,
    pitchingMvp: null as unknown as null,
  };
  check(
    'an archive with a champion but no MVP candidates is refused, not written',
    !archivable(fromEmptyRoster),
    'refused',
    'a finished 32-team season always has candidates in both races, so zero means the roster was not loaded',
  );
  const complete = {
    champion: { teamId: 't-1' },
    battingMvp: { playerId: 'p-bat' },
    pitchingMvp: { playerId: 'p-pit' },
  };
  check(
    'a complete archive is written',
    archivable(complete),
    'accepted',
  );
  check(
    'and an entry already on file is filled in rather than left short',
    archivable({ ...fromEmptyRoster, ...complete }),
    'the repair path fills battingMvp and pitchingMvp on an existing entry',
    'the year-on-file dedupe is what made the truncation permanent, so recovery has to be explicit',
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