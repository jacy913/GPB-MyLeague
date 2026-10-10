/**
 * HOW THE WORLD SERIES MVP IS ACTUALLY DECIDED.
 *
 * THE BUG THIS REPLACES, STATED PLAINLY
 *
 * The old formula was a rate-stat contest with a rounding error for innings:
 *
 *     clamp(8 - ERA, 0, 8) * 52 + clamp(2.2 - WHIP, 0, 2.2) * 58 + K*2 + wins*10 + saves*8 + IP*3
 *     OPS*110 + HR*8 + RBI*3.2 + runs*1.8 + hits
 *
 * Measured against the same series, that produced this ordering:
 *
 *     6 IP, 0.00 ERA, 1 SV          ~= 557   <- a middle reliever's cameo
 *    14 IP, 1.93 ERA, 2 W           ~= 485   <- an ace who won twice
 *     4 HR, 10 RBI, 1.450 OPS       ~= 247   <- a legendary series
 *
 * Which is backwards, and it was backwards for a structural reason rather than a tuning one.
 *
 * `clamp(8 - ERA, 0, 8) * 52` is worth up to 416 points on its own, and a reliever reaches that
 * ceiling by throwing six or seven shutout innings -- the SAME points an eighteen-inning starter
 * earns. Innings were worth three points apiece, so volume was a rounding error. The award was
 * therefore "lowest ERA and WHIP of anyone who happened to appear", which is not the question real
 * voters answer, and it put a batter's entire possible range (about 250) below the score a single
 * relief outing could reach. A spectacular hitter could not win under any circumstances.
 *
 * WHAT REAL VOTERS ARE REWARDING
 *
 * Impact on who won the series, and volume is what carries it. A middle reliever's 1.00 ERA over
 * six innings is genuinely excellent and genuinely not an MVP. Two dominant starts or four home
 * runs are. So this module inverts the shape of the formula:
 *
 *   - PITCHING IS VOLUME-FIRST. Innings are the term; rate only MULTIPLIES them, so a short outing
 *     cannot vault past a full rotation's worth of work. Quality is a multiplier rather than an
 *     addend precisely so that on a short sample dominance buys a PROPORTION of your innings rather
 *     than the whole award.
 *   - BATTERS ARE PRODUCTION-FIRST. Runs, RBIs and home runs carry it, with OPS as a garnish. The
 *     scale is set so a monster series and a two-win ace can each win depending on which was more
 *     spectacular, which is the entire point.
 *   - LEVERAGE WEIGHTS THE CONSEQUENTIAL PLAYS ONLY. Runs, home runs and strikeouts are multiplied
 *     by the situation they happened in; counting stats and rate stats are not. A go-ahead home run
 *     in the seventh of a one-run game counts more than the same swing in the first of a nine-run
 *     rout, because the first one is why the trophy is being handed over.
 *
 * DETERMINISM IS LOAD-BEARING
 *
 * `archiveSeasonAwards` takes `candidates[0]`, and the repair path added for the truncated-MVP bug
 * recomputes this ranking from the same season later. Both are only safe because the same games
 * always produce the same winner. Nothing here samples and nothing here reads the clock.
 */

import type {
  Game,
  LeaguePlayerState,
  PlayLogEvent,
  SeasonHistoryAwardWinner,
  SeasonHistoryTeamRecord,
  Team,
} from '../types';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * LEAGUE ERA: THE DENOMINATOR FOR "HOW DOMINANT".
 *
 * Pitching quality is measured against a fixed league baseline rather than against the old fixed
 * 8.00 and 2.20 ceilings. Those constants were doing something subtler than they looked: they made
 * the maximum reachable score a function of the ABSOLUTE run environment, so the same points meant
 * "ERA under 8.00" -- trivially cleared in a low-scoring series, unreachable in a high-scoring one.
 * Normalised against league average, a given score always means the same thing: this pitcher was
 * this much better than average, series pace or not.
 */
export const WORLD_SERIES_MVP_LEAGUE_ERA = 4.3;

/**
 * THE WEIGHTS, IN ONE PLACE.
 *
 * Exported because `tools/verifyWorldSeriesMvp.ts` asserts against these numbers directly. A
 * rebalance that silently moves the crossover between a batter and an ace should have to update a
 * test rather than pass unnoticed.
 */
/**
 * THE CALIBRATION, AND WHY THESE NUMBERS AND NOT ROUNDER ONES.
 *
 * Two things were measured rather than argued, both on eight simulated postseasons plus hand-built
 * head-to-heads.
 *
 * 1. THE REPORTED CASE. A batter going .400 / 3 HR / 8 RBI across a series, against a pitcher who
 *    worked 11.0 IP at a 1.64 ERA with no win and no save. At the first calibration those scored
 *    238.6 and 242.0 -- the pitcher took it by three points, which is exactly the complaint. Home
 *    runs now carry 40 and RBIs 5, which puts the hitter at 265 and the pitcher unchanged at 242.
 *
 * 2. THE SPLIT. The award was going to hitters in 3 of 8 simulated postseasons. Real World Series
 *    MVP history runs about 40-45% hitters, so a formula that the manager reads as "pitchers keep
 *    winning" was measurably off. The same rebalance is what closes that gap.
 *
 * The pitching weights are untouched by this. The reported case was never about making pitchers
 * cheaper -- the volume-first shape already fixed that -- it is that the two disciplines had to be
 * brought onto a scale where a spectacular hitter is worth slightly MORE than a merely good outing,
 * because that is how the award is actually voted.
 */
export const WORLD_SERIES_MVP_WEIGHTS = {
  batter: {
    /**
     * The largest term on the board, deliberately beating OPS.
     *
     * That ordering is the design, not an accident of tuning. OPS is the one RATE stat that
     * survives to a real weight, and it is worth having -- a .350 hitter who keeps hitting ahead of
     * the count has done something -- but it has to be a garnish. While OPS outweighed the
     * home-run term, a hitter could post a handsome average in a series where every home run was
     * hit in a nine-run rout, and the rate would carry him past a guy who tied a game in the ninth.
     * Production first, rate last.
     */
    homeRun: 40,
    rbi: 5,
    run: 2.8,
    hit: 2,
    extraBaseHit: 3,
    ops: 30,
  },
  pitcher: {
    /** Points per QUALITY INNING -- an inning pitched under league-average conditions. */
    qualityInning: 19,
    /** What a league-average inning is scaled BY, so average work is still worth something. */
    qualityFloor: 0.45,
    win: 14,
    save: 7,
    strikeout: 1.4,
  },
} as const;

/**
 * THE SITUATION A PLAY HAPPENED IN, AS A MULTIPLIER.
 *
 * `margin` is from the CHAMPION's point of view and must be the margin BEFORE the play resolved --
 * a leverage weight has to know what the game looked like when the decision was made, not after the
 * runs were already on the board. `basesOccupied` and `outs` are the same: two outs with runners
 * everywhere is a different situation from a leadoff plate appearance in a rout.
 *
 * The shape is the standard intuition written as four factors that multiply:
 *
 *   late       1.00 by the ninth, 0.00 through the second
 *   closeness  1.00 when tied, falling to 0.00 at a four-run margin either way
 *   outs       about a third more when two outs are on
 *   traffic    a little more with runners aboard
 *
 * bounded to [0.55, 2.00]. The FLOOR matters as much as the ceiling. A home run in a nine-nothing
 * game is the explicit case the old formula could not distinguish from a walk-off, and it should
 * not be worth double a game-winner merely because it was a home run.
 */
export const computeLeverageWeight = ({
  inning,
  margin,
  outs,
  basesOccupied,
}: {
  inning: number;
  margin: number;
  outs: number;
  basesOccupied: number;
}): number => {
  const lateInSeries = clamp((inning - 2.5) / 5.5, 0, 1);
  const closeness = 1 - clamp(Math.abs(margin) / 4, 0, 1);
  const outsWeight = 0.85 + 0.15 * clamp(outs / 3, 0, 1);
  const traffic = 1 + 0.12 * clamp(basesOccupied / 3, 0, 1);
  return clamp(0.55 + 1.55 * lateInSeries * (0.3 + 0.7 * closeness) * outsWeight * traffic, 0.55, 2);
};

export interface WorldSeriesBattingLine {
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbi: number;
  walks: number;
  strikeouts: number;
  /**
   * Leverage-weighted totals of the CONSEQUENTIAL events only.
   *
   * Deliberately not present for hits, walks or strikeouts: those describe how often a batter
   * appeared, not what happened because of him, and weighting them would make a leadoff hitter in a
   * blowout out-score a guy who tied a game in the ninth.
   */
  weightedHomeRuns: number;
  weightedRbi: number;
  weightedRuns: number;
  weightedExtraBaseHits: number;
}

export interface WorldSeriesPitchingLine {
  outsRecorded: number;
  hitsAllowed: number;
  runsAllowed: number;
  walks: number;
  strikeouts: number;
  wins: number;
  saves: number;
  weightedStrikeouts: number;
}

export const blankWorldSeriesBattingLine = (): WorldSeriesBattingLine => ({
  plateAppearances: 0,
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbi: 0,
  walks: 0,
  strikeouts: 0,
  weightedHomeRuns: 0,
  weightedRbi: 0,
  weightedRuns: 0,
  weightedExtraBaseHits: 0,
});

export const blankWorldSeriesPitchingLine = (): WorldSeriesPitchingLine => ({
  outsRecorded: 0,
  hitsAllowed: 0,
  runsAllowed: 0,
  walks: 0,
  strikeouts: 0,
  wins: 0,
  saves: 0,
  weightedStrikeouts: 0,
});

/** Doubles, triples and home runs. The extra bases, i.e. the part of a hit that actually moved a runner. */
const countExtraBaseHits = (line: WorldSeriesBattingLine): number =>
  line.doubles + line.triples + line.homeRuns;

export const worldSeriesBattingAverage = (line: WorldSeriesBattingLine): number =>
  line.atBats > 0 ? line.hits / line.atBats : 0;

export const worldSeriesPitchingEra = (line: WorldSeriesPitchingLine): number => {
  const inningsPitched = line.outsRecorded / 3;
  return inningsPitched > 0 ? (line.runsAllowed * 9) / inningsPitched : 99;
};

/**
 * BATTER SCORE: PRODUCTION FIRST, RATE LAST.
 *
 * The home-run term is the largest single weight on the board, because a home run is the one
 * offensive event that is spectacular in isolation -- and because a leverage-weighted RBI total is
 * the closest thing this simulation has to "did he decide the games".
 */
export const scoreWorldSeriesBatter = (line: WorldSeriesBattingLine): number => {
  const { batter } = WORLD_SERIES_MVP_WEIGHTS;
  const singles = Math.max(0, line.hits - countExtraBaseHits(line));
  const totalBases =
    singles + line.doubles * 2 + line.triples * 3 + line.homeRuns * 4;
  const onBasePct =
    line.plateAppearances > 0 ? (line.hits + line.walks) / line.plateAppearances : 0;
  const slugging = line.atBats > 0 ? totalBases / line.atBats : 0;
  const ops = onBasePct + slugging;

  return (
    line.weightedHomeRuns * batter.homeRun
    + line.weightedRbi * batter.rbi
    + line.weightedRuns * batter.run
    + line.hits * batter.hit
    + line.weightedExtraBaseHits * batter.extraBaseHit
    + ops * batter.ops
  );
};

/**
 * PITCHER SCORE: VOLUME FIRST, DOMINANCE AS A MULTIPLIER.
 *
 * `qualityInnings` is the whole fix. A league-average inning counts as 1.45 quality innings, a
 * dominant one as 1.90 (the `qualityFloor` is 0.45, so quality contributes 0 to 1.0 on top), and a
 * historically bad one as 0.45. Two starts of dominance therefore lands around 14 quality innings
 * -- roughly 360 points -- while six shutout relief innings lands around 8.7, or 165. The gap used
 * to be the other way round, and by a much smaller margin than it should have been.
 */
export const scoreWorldSeriesPitcher = (line: WorldSeriesPitchingLine): number => {
  const { pitcher } = WORLD_SERIES_MVP_WEIGHTS;
  const inningsPitched = line.outsRecorded / 3;
  const era = worldSeriesPitchingEra(line);
  const quality = clamp((WORLD_SERIES_MVP_LEAGUE_ERA - era) / WORLD_SERIES_MVP_LEAGUE_ERA, 0, 1);
  const qualityInnings = inningsPitched * (pitcher.qualityFloor + quality);

  return (
    qualityInnings * pitcher.qualityInning
    + line.wins * pitcher.win
    + line.saves * pitcher.save
    + line.weightedStrikeouts * pitcher.strikeout
  );
};

/**
 * THE SPECTACULAR FLOOR.
 *
 * The volume-first score already prevents a cameo from winning, but a board is not just its top
 * entry: it is the list a manager reads in the offseason, and a player who walked once in the
 * series and threw one pitch should not be on it. These bars are the minimum that still admits the
 * cases that SHOULD appear -- a pinch hitter who hit a go-ahead home run, a closer who converted
 * one save, an opener who worked two scoreless innings of a clincher.
 */
export const isWorldSeriesBatterCandidate = (line: WorldSeriesBattingLine): boolean =>
  line.plateAppearances >= 5 || line.homeRuns > 0 || line.rbi >= 2;

export const isWorldSeriesPitcherCandidate = (line: WorldSeriesPitchingLine): boolean => {
  const inningsPitched = line.outsRecorded / 3;
  if (line.outsRecorded < 3) {
    return false;
  }
  /*
   * ONE SAVE IS NOT A SERIES.
   *
   * This bar was originally `saves > 0`, which let a closer who finished a single game two innings
   * onto the board -- and onto it high, because a short outing is nearly all quality innings and
   * quality innings is the biggest term in the score. The floor and the score were pulling against
   * each other: the volume-first weighting made short outings score *well*, so the floor is what has
   * to hold them off. Two saves is the threshold because that is the shape of a real closer's series,
   * and it is where a closer's case stops being "he finished one game".
   *
   * A starter is unaffected: six innings of a scoreless no-decision is still a candidate, because
   * that is a full outing rather than a cameo.
   */
  return line.wins > 0 || line.saves >= 2 || inningsPitched >= 6;
};

/**
 * THE POSTSEASON FALLBACK, ON THE SAME SCALE.
 *
 * When a champion's World Series logs are too thin to fill the board, the old code reached for
 * `seasonPhase === 'playoffs'` aggregates. That was a sound idea and a broken one: the fallback
 * scored on the OLD formula, whose top end was around 200, so a fallback player could never beat a
 * player who actually had World Series at-bats. The two boards were priced in different currencies.
 *
 * These now use the same weights, so a fallback candidate competes on merit rather than by virtue
 * of which side of the board he was found on. The absence of leverage weighting is a real
 * limitation and is called out rather than hidden: season aggregates record no game state, so these
 * lines are scored as if every run happened at neutral leverage. They are only reached for when the
 * World Series sample cannot fill the board, and they still out-score a cameo because the volume
 * terms are identical.
 */
export const scoreWorldSeriesBatterFromPostseasonStats = (stat: {
  plateAppearances: number;
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runsScored: number;
  rbi: number;
  walks: number;
  ops: number;
}): number => {
  const line: WorldSeriesBattingLine = {
    plateAppearances: stat.plateAppearances,
    atBats: stat.atBats,
    hits: stat.hits,
    doubles: stat.doubles,
    triples: stat.triples,
    homeRuns: stat.homeRuns,
    runs: stat.runsScored,
    rbi: stat.rbi,
    walks: stat.walks,
    strikeouts: 0,
    weightedHomeRuns: stat.homeRuns,
    weightedRbi: stat.rbi,
    weightedRuns: stat.runsScored,
    weightedExtraBaseHits: stat.doubles + stat.triples + stat.homeRuns,
  };
  return scoreWorldSeriesBatter(line);
};

export const scoreWorldSeriesPitcherFromPostseasonStats = (stat: {
  inningsPitched: number;
  /**
   * `PlayerSeasonPitching` records EARNED runs, not total, and its `era` is built from those. The
   * play-log path scores against total runs allowed, so the two only agree if this passes earned
   * runs too -- which it does, and which is why the field is named for the type rather than
   * reaching for the play-log name.
   */
  earnedRuns: number;
  strikeouts: number;
  wins: number;
  saves: number;
}): number => {
  const line: WorldSeriesPitchingLine = {
    outsRecorded: stat.inningsPitched * 3,
    hitsAllowed: 0,
    runsAllowed: stat.earnedRuns,
    walks: 0,
    strikeouts: stat.strikeouts,
    wins: stat.wins,
    saves: stat.saves,
    // Neutral leverage, for the same reason as the batting fallback above.
    weightedStrikeouts: stat.strikeouts,
  };
  return scoreWorldSeriesPitcher(line);
};

/*
 * ============================================================================
 * THE BOARD
 * ============================================================================
 *
 * Everything below is the wiring: read the champion's World Series out of the stored play logs, turn
 * it into the two candidate lists, and rank them.
 *
 * This lives here rather than in `App.tsx` for one reason that is not tidiness. A formula nobody can
 * call is a formula nobody can check, and the claim this whole module makes -- that the MVP is now
 * spectacular rather than merely lowest-ERA -- is an empirical claim about what wins across many
 * simulated postseasons. `tools/verifyWorldSeriesMvp.ts` imports THIS function and measures it. Left
 * inside a React component, the only way to test it would be to render the app and read pixels.
 */

export interface WorldSeriesCandidateBundle {
  champion: SeasonHistoryTeamRecord | null;
  candidates: SeasonHistoryAwardWinner[];
  completedGames: number;
  startDate: string;
  endDate: string;
}

export type ScoredAwardCandidate = {
  score: number;
  winner: SeasonHistoryAwardWinner;
};

export const parseStoredPlayLog = (game: Game): PlayLogEvent[] => {
  const raw = typeof game.stats.playLog === 'string' ? game.stats.playLog : null;
  if (!raw) {
    return [];
  }
  try {
    return JSON.parse(raw) as PlayLogEvent[];
  } catch {
    return [];
  }
};

const compareGamesByDateThenId = (left: Game, right: Game): number =>
  left.date === right.date ? left.gameId.localeCompare(right.gameId) : left.date.localeCompare(right.date);

const toSeasonHistoryTeamRecord = (team: Team): SeasonHistoryTeamRecord => ({
  teamId: team.id,
  teamCity: team.city,
  teamName: team.name,
  wins: team.wins,
  losses: team.losses,
});

/**
 * THE CHAMPION IS READ OFF PLAYED GAMES, NOT A STANDING COLUMN.
 *
 * A best-of-seven needs four wins, so anything short of that returns null rather than naming a
 * leader. That is the same rule the title uses, and it is why this function contributes nothing at
 * all before a series is decided instead of contributing a provisional winner.
 */
export const resolveWorldSeriesChampion = (games: Game[], teamsById: Map<string, Team>): SeasonHistoryTeamRecord | null => {
  const completedWorldSeriesGames = games
    .filter((game) => game.phase === 'playoffs' && game.playoff?.round === 'world_series' && game.status === 'completed')
    .sort(compareGamesByDateThenId);

  if (completedWorldSeriesGames.length === 0) {
    return null;
  }

  const winsByTeamId = new Map<string, number>();
  completedWorldSeriesGames.forEach((game) => {
    const winnerTeamId = game.score.home > game.score.away ? game.homeTeam : game.awayTeam;
    winsByTeamId.set(winnerTeamId, (winsByTeamId.get(winnerTeamId) ?? 0) + 1);
  });

  const [championEntry] = [...winsByTeamId.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }
    return left[0].localeCompare(right[0]);
  });

  if (!championEntry || championEntry[1] < 4) {
    return null;
  }

  const championTeam = teamsById.get(championEntry[0]) ?? null;
  return championTeam ? toSeasonHistoryTeamRecord(championTeam) : null;
};

/**
 * THE BOARD IS HALF BATTERS AND HALF PITCHERS, THEN RANKED.
 *
 * The quotas guarantee the offseason screen shows both disciplines, and the final sort is a plain
 * score ordering across the selected set -- so the winner is the highest score on the board, not
 * the best of a favoured half. The quotas can only ever exclude a player from the DISPLAY; they can
 * never promote one, which is what keeps this from reintroducing the bias in the other direction.
 */
const compareScoredAwardCandidates = (left: ScoredAwardCandidate, right: ScoredAwardCandidate) =>
  left.score === right.score
    ? left.winner.playerName.localeCompare(right.winner.playerName)
    : right.score - left.score;

export const buildBalancedWorldSeriesCandidates = (
  battingEntries: ScoredAwardCandidate[],
  pitchingEntries: ScoredAwardCandidate[],
  limit: number,
): SeasonHistoryAwardWinner[] => {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit === 0) {
    return [];
  }

  const sortedBatting = [...battingEntries].sort(compareScoredAwardCandidates);
  const sortedPitching = [...pitchingEntries].sort(compareScoredAwardCandidates);
  const batterQuota = Math.min(Math.floor(safeLimit / 2), sortedBatting.length);
  const pitcherQuota = Math.min(safeLimit - batterQuota, sortedPitching.length);

  const selected: ScoredAwardCandidate[] = [
    ...sortedBatting.slice(0, batterQuota),
    ...sortedPitching.slice(0, pitcherQuota),
  ];
  const selectedIds = new Set(selected.map((entry) => entry.winner.playerId));
  const remaining = safeLimit - selected.length;

  if (remaining > 0) {
    const extras = [...sortedBatting.slice(batterQuota), ...sortedPitching.slice(pitcherQuota)]
      .filter((entry) => !selectedIds.has(entry.winner.playerId))
      .sort(compareScoredAwardCandidates)
      .slice(0, remaining);
    extras.forEach((entry) => selectedIds.add(entry.winner.playerId));
    selected.push(...extras);
  }

  return selected
    .sort(compareScoredAwardCandidates)
    .map((entry) => entry.winner);
};

export const computeWorldSeriesMvpCandidates = (
  teams: Team[],
  games: Game[],
  playerState: LeaguePlayerState,
  seasonYear: number,
  limit = 10,
): WorldSeriesCandidateBundle => {
  const teamsById = new Map<string, Team>(teams.map((team) => [team.id, team] as const));
  const champion = resolveWorldSeriesChampion(games, teamsById);
  const completedWorldSeriesGames = games
    .filter((game) =>
      game.phase === 'playoffs' &&
      game.playoff?.round === 'world_series' &&
      game.status === 'completed' &&
      Number(game.date.slice(0, 4)) === seasonYear,
    )
    .sort(compareGamesByDateThenId);

  const emptyBundle = (): WorldSeriesCandidateBundle => ({
    champion: null,
    candidates: [],
    completedGames: completedWorldSeriesGames.length,
    startDate: completedWorldSeriesGames[0]?.date ?? '',
    endDate: completedWorldSeriesGames[completedWorldSeriesGames.length - 1]?.date ?? '',
  });

  if (!champion?.teamId) {
    return emptyBundle();
  }

  const championTeamId = champion.teamId;
  const playersById = new Map<string, LeaguePlayerState['players'][number]>(
    playerState.players.map((player) => [player.playerId, player] as const),
  );
  const championTeam = teamsById.get(championTeamId) ?? null;

  type TrackedBattingLine = WorldSeriesBattingLine & { games: Set<string> };
  type TrackedPitchingLine = WorldSeriesPitchingLine & { games: Set<string> };

  const battingLines = new Map<string, TrackedBattingLine>();
  const pitchingLines = new Map<string, TrackedPitchingLine>();

  completedWorldSeriesGames.forEach((game) => {
    const championIsHome = game.homeTeam === championTeamId;
    parseStoredPlayLog(game).forEach((log) => {
      if (log.outcome === 'PITCHING_CHANGE' || log.outcome === 'HALF_END' || log.outcome === 'GAME_END') {
        return;
      }

      /*
       * THE MARGIN HAS TO BE THE ONE BEFORE THE PLAY RESOLVED.
       *
       * `scoreAway`/`scoreHome` are the scoreboard as it stood when the log was appended, which is
       * AFTER `addRuns` folded this at-bat's runs in. A leverage weight read off the post-play
       * margin would rate a walk-off home run as a run in a ninth-inning tie and a blowout
       * insurance run as a go-ahead -- exactly backwards. So the runs this at-bat scored are backed
       * out first, and the sign runs opposite ways depending on which side the champion is on.
       */
      const marginAfter = championIsHome
        ? log.scoreHome - log.scoreAway
        : log.scoreAway - log.scoreHome;
      const championIsBating = log.battingTeamId === championTeamId;
      const marginBefore = championIsBating
        ? marginAfter - Math.max(0, log.runsScored)
        : marginAfter + Math.max(0, log.runsScored);

      /*
       * THE TRAFFIC IS THE PRE-PLAY OCCUPANCY.
       *
       * `log.bases` is the state the outcome LEFT BEHIND, so a home run reads as empty bases -- and the
       * biggest swings in baseball were being measured as the least pressured plays on the board. That
       * was the documented limitation of the first version of this formula, and it was the one case
       * worth going to the game engine for.
       *
       * `log.basesBefore` carries the occupancy the plate appearance was actually decided against, which
       * is what makes "bases loaded in the ninth" mean anything here. The fallback is for logs written
       * before the field existed: those have no pre-play record at all and post-play bases are the only
       * thing available. It remains a real approximation in that case, and it is recorded rather than
       * hidden -- but it now applies to historical saves instead of to every game.
       */
      const occupancy = log.basesBefore ?? log.bases;
      const basesOccupied = occupancy
        ? [occupancy.first, occupancy.second, occupancy.third].filter((base): base is string => Boolean(base)).length
        : 0;
      const leverage = computeLeverageWeight({
        inning: log.inning,
        margin: marginBefore,
        outs: log.outs,
        basesOccupied,
      });

      if (championIsBating && log.batterId) {
        const line = battingLines.get(log.batterId) ?? { ...blankWorldSeriesBattingLine(), games: new Set<string>() };
        line.games.add(game.gameId);
        line.plateAppearances += 1;
        if (log.outcome !== 'BB') {
          line.atBats += 1;
        }
        if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
          line.hits += 1;
        }
        if (log.outcome === '2B') {
          line.doubles += 1;
        }
        if (log.outcome === '3B') {
          line.triples += 1;
        }
        if (log.outcome === 'HR') {
          line.homeRuns += 1;
        }
        if (log.outcome === 'BB') {
          line.walks += 1;
        }
        if (log.outcome === 'SO') {
          line.strikeouts += 1;
        }
        const rbi = Math.max(0, log.rbi);
        const scoredRuns = log.scoringPlayerIds.includes(log.batterId) ? 1 : 0;
        line.rbi += rbi;
        line.runs += scoredRuns;

        /*
         * ONLY THE CONSEQUENTIAL PLAYS ARE WEIGHTED.
         *
         * Runs, RBIs and extra bases are multiplied by the situation they happened in. Hits, walks
         * and strikeouts are not: those describe how often a man was there rather than what happened
         * because of him, and weighting them would let a leadoff hitter in a nine-nothing game
         * out-score a man who tied it in the ninth.
         */
        line.weightedHomeRuns += leverage * (log.outcome === 'HR' ? 1 : 0);
        line.weightedRbi += leverage * rbi;
        line.weightedRuns += leverage * scoredRuns;
        if (log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
          line.weightedExtraBaseHits += leverage;
        }
        battingLines.set(log.batterId, line);
      }

      if (!championIsBating && log.pitcherId) {
        const line = pitchingLines.get(log.pitcherId) ?? { ...blankWorldSeriesPitchingLine(), games: new Set<string>() };
        line.games.add(game.gameId);
        if (log.outcome === 'OUT' || log.outcome === 'SO') {
          line.outsRecorded += 1;
        }
        if (log.outcome === '1B' || log.outcome === '2B' || log.outcome === '3B' || log.outcome === 'HR') {
          line.hitsAllowed += 1;
        }
        if (log.outcome === 'BB') {
          line.walks += 1;
        }
        if (log.outcome === 'SO') {
          line.strikeouts += 1;
          line.weightedStrikeouts += leverage;
        }
        line.runsAllowed += Math.max(0, log.runsScored);
        pitchingLines.set(log.pitcherId, line);
      }
    });

    /*
     * WINS AND SAVES COME FROM THE BOX SCORE, NOT THE LOG.
     *
     * A closer can finish a game without appearing as the `pitcherId` on a single plate appearance
     * -- the log's last batter faced somebody else. So the decision and the save are read off the
     * game record, and the per-play line is only merged with what it already recorded rather than
     * replaced by it.
     */
    const winningPitcherId = typeof game.stats.winningPitcherId === 'string' ? game.stats.winningPitcherId : '';
    if (winningPitcherId && playersById.get(winningPitcherId)?.teamId === championTeamId) {
      const line = pitchingLines.get(winningPitcherId) ?? { ...blankWorldSeriesPitchingLine(), games: new Set<string>() };
      line.games.add(game.gameId);
      line.wins += 1;
      pitchingLines.set(winningPitcherId, line);
    }

    const savePitcherId = typeof game.stats.savePitcherId === 'string' ? game.stats.savePitcherId : '';
    if (savePitcherId && playersById.get(savePitcherId)?.teamId === championTeamId) {
      const line = pitchingLines.get(savePitcherId) ?? { ...blankWorldSeriesPitchingLine(), games: new Set<string>() };
      line.games.add(game.gameId);
      line.saves += 1;
      pitchingLines.set(savePitcherId, line);
    }
  });

  const battingCandidates: ScoredAwardCandidate[] = [];
  const pitchingCandidates: ScoredAwardCandidate[] = [];

  playerState.players.forEach((player) => {
    if (player.teamId !== championTeamId) {
      return;
    }

    if (player.playerType === 'batter') {
      const line = battingLines.get(player.playerId);
      if (!line || !isWorldSeriesBatterCandidate(line)) {
        return;
      }
      battingCandidates.push({
        score: scoreWorldSeriesBatter(line),
        winner: {
          playerId: player.playerId,
          playerName: `${player.firstName} ${player.lastName}`,
          teamId: player.teamId,
          teamCity: championTeam?.city ?? null,
          teamName: championTeam?.name ?? null,
          summary: `WS ${line.games.size} G | ${worldSeriesBattingAverage(line).toFixed(3)} AVG | ${line.homeRuns} HR | ${line.rbi} RBI`,
        },
      });
      return;
    }

    if (player.playerType === 'pitcher') {
      const line = pitchingLines.get(player.playerId);
      if (!line || !isWorldSeriesPitcherCandidate(line)) {
        return;
      }
      pitchingCandidates.push({
        score: scoreWorldSeriesPitcher(line),
        winner: {
          playerId: player.playerId,
          playerName: `${player.firstName} ${player.lastName}`,
          teamId: player.teamId,
          teamCity: championTeam?.city ?? null,
          teamName: championTeam?.name ?? null,
          summary: `WS ${line.games.size} G | ${(line.outsRecorded / 3).toFixed(1)} IP | ${worldSeriesPitchingEra(line).toFixed(2)} ERA | ${line.strikeouts} K`,
        },
      });
    }
  });

  /*
   * THE POSTSEASON FALLBACK, AND ITS ONE REAL LIMITATION.
   *
   * When the champion's World Series logs are too thin to fill the board -- a swept series, a
   * bullpen game -- the board is topped up from full-postseason aggregates. It is scored with the
   * SAME weights, deliberately: the old fallback kept the old formula, whose top end was around 200
   * against a play-log board that reached 500, so a fallback player could never win however well he
   * hit. The two boards used to be priced in different currencies.
   *
   * Aggregates record no game state, so those lines are scored at neutral leverage. That is stated
   * rather than hidden: it makes a fallback candidate slightly less situational than a play-log one,
   * and it is the one place where the leverage weighting is genuinely absent.
   */
  const batterQuota = Math.floor(limit / 2);
  const pitcherQuota = limit - batterQuota;
  const takenIds = new Set<string>([
    ...battingCandidates.map((entry) => entry.winner.playerId),
    ...pitchingCandidates.map((entry) => entry.winner.playerId),
  ]);

  if (battingCandidates.length < batterQuota) {
    playerState.battingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'playoffs')
      .forEach((stat) => {
        const player = playersById.get(stat.playerId);
        if (!player || player.teamId !== championTeamId || player.playerType !== 'batter' || stat.atBats < 6 || takenIds.has(player.playerId)) {
          return;
        }
        battingCandidates.push({
          score: scoreWorldSeriesBatterFromPostseasonStats(stat),
          winner: {
            playerId: player.playerId,
            playerName: `${player.firstName} ${player.lastName}`,
            teamId: player.teamId,
            teamCity: championTeam?.city ?? null,
            teamName: championTeam?.name ?? null,
            summary: `Playoffs | ${stat.avg.toFixed(3)} AVG | ${stat.homeRuns} HR | ${stat.rbi} RBI`,
          },
        });
        takenIds.add(player.playerId);
      });
  }

  if (pitchingCandidates.length < pitcherQuota) {
    playerState.pitchingStats
      .filter((stat) => stat.seasonYear === seasonYear && stat.seasonPhase === 'playoffs')
      .forEach((stat) => {
        const player = playersById.get(stat.playerId);
        if (!player || player.teamId !== championTeamId || player.playerType !== 'pitcher' || stat.inningsPitched < 4 || takenIds.has(player.playerId)) {
          return;
        }
        pitchingCandidates.push({
          score: scoreWorldSeriesPitcherFromPostseasonStats(stat),
          winner: {
            playerId: player.playerId,
            playerName: `${player.firstName} ${player.lastName}`,
            teamId: player.teamId,
            teamCity: championTeam?.city ?? null,
            teamName: championTeam?.name ?? null,
            summary: `Playoffs | ${stat.inningsPitched.toFixed(1)} IP | ${stat.era.toFixed(2)} ERA | ${stat.strikeouts} K`,
          },
        });
        takenIds.add(player.playerId);
      });
  }

  const rankedCandidates = buildBalancedWorldSeriesCandidates(battingCandidates, pitchingCandidates, limit);

  return {
    champion,
    candidates: rankedCandidates
      .filter((candidate, index, all) => all.findIndex((entry) => entry.playerId === candidate.playerId) === index)
      .slice(0, limit),
    completedGames: completedWorldSeriesGames.length,
    startDate: completedWorldSeriesGames[0]?.date ?? '',
    endDate: completedWorldSeriesGames[completedWorldSeriesGames.length - 1]?.date ?? '',
  };
};